import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'

import type {
  AgentDirectory,
  CastVoteInput,
  CreateChannelInput,
  CreateVoteInput,
  CloseMeetingInput,
  FleetCoordinationEvent,
  FleetChannel,
  FleetDelivery,
  FleetInboxItem,
  FleetMessage,
  FleetMessageKind,
  FleetMessagePin,
  FleetMessageReaction,
  FleetMeeting,
  FleetMessagePermission,
  FleetTarget,
  FleetSystemNotificationInput,
  FleetSystemNotificationResult,
  FleetVote,
  InitializeChannelInput,
  MessageAgent,
  OpenMeetingInput,
  ReadMessagesInput,
  ReadMessagesResult,
  SearchMessagesInput,
  SendMessageInput,
  SendMessageResult,
  UpdateChannelInput,
  WaitResult,
} from './types.js'

const CHANNEL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_MESSAGE_LENGTH = 65_536
const MAX_HISTORY_MESSAGES = 1_000
const MAX_HISTORY_TEXT_LENGTH = 8 * 1_024 * 1_024

interface Waiter {
  readonly agentId: string
  finish(result: WaitResult): void
  fail(error: unknown): void
}

interface PendingSystemNotification {
  readonly message: UserMessage
  readonly queue: 'nextStep' | 'nextTurn'
}

function snapshot<T>(value: T): T {
  return structuredClone(value)
}

function uniqueStrings(values: readonly string[], label: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = value.trim()
    if (normalized.length === 0) throw new Error(`${label} cannot be empty`)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}

function agentTarget(target: string): string {
  if (!target.startsWith('@') || target.length === 1) {
    throw new Error(`expected an Agent target such as @agent-id, received ${target}`)
  }
  return target.slice(1)
}

function channelId(target: string): string {
  if (!target.startsWith('#') || target.length === 1) {
    throw new Error(`expected a Channel target such as #general, received ${target}`)
  }
  return target.slice(1)
}

function meetingId(target: string): string {
  if (!target.startsWith('meeting:') || target.length === 'meeting:'.length) {
    throw new Error(`expected a Meeting target such as meeting:design-review, received ${target}`)
  }
  return target.slice('meeting:'.length)
}

function directConversation(left: string, right: string): string {
  return [left, right].sort().join('\u0000')
}

function isCompleteAgentOutput(event: SessionEvent): boolean {
  if (event.type === 'tool/call') return true
  if (event.type !== 'assistant/message' || event.data.interrupted === true) return false
  return event.data.message.content.some(block => {
    if (block.type === 'text' || block.type === 'reasoning') return block.text.trim().length > 0
    return block.type === 'tool-call' || block.type === 'image'
  })
}

export interface MessageHubOptions {
  readonly validateTaskReference?: (taskId: string, assigneeId?: string) => void
}

export class MessageHub {
  private readonly channels = new Map<string, FleetChannel>()
  private readonly meetings = new Map<string, FleetMeeting>()
  private readonly votes = new Map<string, FleetVote>()
  private readonly reactions = new Map<string, FleetMessageReaction>()
  private readonly pins = new Map<string, FleetMessagePin>()
  private readonly acknowledgedByAgent = new Map<string, Set<string>>()
  private readonly deliveredContextByAgent = new Map<string, Map<string, string>>()
  private readonly enteredContextByAgent = new Map<string, Set<string>>()
  private readonly history: FleetMessage[] = []
  private readonly pendingWakeupsByAgent = new Map<string, Map<string, FleetMessage>>()
  private readonly observers = new Set<(event: FleetCoordinationEvent) => void>()
  private readonly waiters = new Set<Waiter>()
  private readonly agentRevisions = new Map<string, number>()
  private historyTextLength = 0
  private sequence = 0
  private voteSequence = 0
  private revision = 0
  private closed = false

  constructor(
    private readonly agents: AgentDirectory,
    private readonly options: MessageHubOptions = {},
  ) {
    this.addGeneralChannel()
  }

  reset(): void {
    this.assertOpen()
    for (const waiter of [...this.waiters]) waiter.fail(new Error('Fleet Message state reset for a new run'))
    this.channels.clear()
    this.meetings.clear()
    this.votes.clear()
    this.reactions.clear()
    this.pins.clear()
    this.acknowledgedByAgent.clear()
    this.deliveredContextByAgent.clear()
    this.enteredContextByAgent.clear()
    this.history.length = 0
    this.pendingWakeupsByAgent.clear()
    this.agentRevisions.clear()
    this.historyTextLength = 0
    this.sequence = 0
    this.voteSequence = 0
    this.revision = 0
    this.addGeneralChannel()
  }

  restore(events: readonly FleetCoordinationEvent[]): void {
    this.reset()
    for (const event of events) {
      if (event.type === 'message') {
        this.rememberMessage(snapshot(event.message))
        this.sequence = Math.max(this.sequence, event.message.sequence)
      } else if (event.type === 'channel') {
        this.channels.set(event.channel.id, snapshot(event.channel))
      } else if (event.type === 'meeting') {
        this.meetings.set(event.meeting.id, snapshot({
          ...event.meeting,
          attendance: event.meeting.attendance ?? {
            [event.meeting.initiator]: { joinedAt: event.meeting.createdAt },
          },
          decisions: event.meeting.decisions ?? [],
          actionItems: event.meeting.actionItems ?? [],
          resources: event.meeting.resources ?? [],
        }))
      } else if (event.type === 'vote') {
        this.votes.set(event.vote.id, snapshot(event.vote))
        const ordinal = /^vote_(\d+)$/.exec(event.vote.id)?.[1]
        if (ordinal !== undefined) this.voteSequence = Math.max(this.voteSequence, Number(ordinal))
      } else if (event.type === 'reaction') {
        const key = this.reactionKey(event.reaction.messageId, event.reaction.reaction)
        if (event.action === 'removed') this.reactions.delete(key)
        else this.reactions.set(key, snapshot(event.reaction))
      } else if (event.type === 'pin') {
        if (event.action === 'unpinned') this.pins.delete(event.pin.messageId)
        else this.pins.set(event.pin.messageId, snapshot(event.pin))
      } else if (event.type === 'inbox') {
        if (event.action === 'delivered') {
          this.rememberDelivery(event.agentId, event.contextMessageId, event.messageId)
        } else {
          let acknowledged = this.acknowledgedByAgent.get(event.agentId)
          if (acknowledged === undefined) {
            acknowledged = new Set()
            this.acknowledgedByAgent.set(event.agentId, acknowledged)
          }
          acknowledged.add(event.messageId)
          this.forgetDelivery(event.agentId, event.messageId)
        }
      }
    }
    this.pruneMessageMetadata()
    this.rebuildPendingWakeups()
    this.revision = events.length
    for (const agent of this.agents.list()) this.agentRevisions.set(agent.id, this.revision)
  }

  private addGeneralChannel(): void {
    this.channels.set('general', {
      id: 'general',
      name: 'general',
      topic: 'Fleet-wide coordination',
      summary: '',
      body: '',
      revision: 0,
      open: true,
      members: [],
      createdBy: 'fleet',
      createdAt: new Date().toISOString(),
      archived: false,
      updatedAt: new Date().toISOString(),
    })
  }

  onEvent(observer: (event: FleetCoordinationEvent) => void): () => void {
    this.assertOpen()
    this.observers.add(observer)
    return () => { this.observers.delete(observer) }
  }

  observeSessionEvent(agentId: string, event: SessionEvent, sessionEvents: readonly SessionEvent[] = []): void {
    const delivered = this.deliveredContextByAgent.get(agentId)
    if (delivered === undefined) return
    const entered = this.enteredContextByAgent.get(agentId) ?? new Set<string>()
    const rememberEntered = (candidate: SessionEvent): void => {
      if (candidate.type === 'user/message' && delivered.has(String(candidate.data.id))) {
        entered.add(String(candidate.data.id))
      }
    }
    rememberEntered(event)
    if (entered.size > 0) this.enteredContextByAgent.set(agentId, entered)
    if (!isCompleteAgentOutput(event)) return
    for (const candidate of sessionEvents) {
      if (candidate.seq <= event.seq) rememberEntered(candidate)
    }
    let changed = false
    for (const contextMessageId of [...entered]) {
      const messageId = delivered.get(contextMessageId)
      if (messageId !== undefined && this.markAcknowledged(agentId, messageId)) changed = true
      entered.delete(contextMessageId)
    }
    if (entered.size === 0) this.enteredContextByAgent.delete(agentId)
    if (changed) this.changed([agentId])
  }

  connectAgent(agentId: string, channelIds: readonly string[] = []): void {
    this.assertOpen()
    this.requireAgent(agentId)
    let connected = false
    for (const id of new Set(channelIds)) {
      const channel = this.channels.get(id)
      if (channel === undefined || channel.open || channel.members.includes(agentId)
        || this.agents.canAccessChannel?.(agentId, id) === false) continue
      this.channels.set(id, { ...channel, members: [...channel.members, agentId] })
      connected = true
    }
    if (connected) this.changed([agentId])
  }

  disconnectAgent(agentId: string): void {
    this.assertOpen()
    const affected = new Set([agentId])
    const removedVotes = new Set<string>()
    for (const [id, vote] of this.votes) {
      if (vote.status !== 'open' || !vote.voters.includes(agentId)) continue
      removedVotes.add(id)
      const voters = vote.voters.filter(voter => voter !== agentId)
      const approvals = vote.approvals.filter(voter => voter !== agentId)
      const approved = approvals.length === voters.length
      const updated: FleetVote = {
        ...vote,
        voters,
        approvals,
        ...(approved ? { status: 'approved', closedAt: new Date().toISOString() } : {}),
      }
      this.votes.set(id, updated)
      this.emit({ type: 'vote', action: 'updated', vote: updated })
      if (approved) {
        this.emit({ type: 'vote', action: 'closed', vote: updated })
        const text = `Vote ${updated.id} approved after a voter went offline: ${updated.statement}`
        const message = this.appendMessage('fleet', {
          to: updated.channel,
          text,
          delivery: 'wakeup',
        }, text, [], [updated.initiator], 'vote_closed')
        const initiator = this.agents.get(updated.initiator)
        if (initiator !== undefined) {
          this.addPendingWakeup(initiator.id, message)
          this.deliver(initiator, message, true, false)
        }
      }
      affected.add(updated.initiator)
      for (const voter of updated.voters) affected.add(voter)
    }
    const pending = this.pendingWakeupsByAgent.get(agentId)
    if (pending !== undefined && removedVotes.size > 0) {
      for (const [messageId, message] of pending) {
        if (message.kind === 'vote_opened'
          && [...removedVotes].some(voteId => message.text.startsWith(`Vote ${voteId} opened`))) {
          pending.delete(messageId)
        }
      }
      if (pending.size === 0) this.pendingWakeupsByAgent.delete(agentId)
    }
    for (const waiter of [...this.waiters]) {
      if (waiter.agentId === agentId) {
        waiter.finish({ timedOut: false, revision: this.agentRevision(agentId), reason: 'disconnected' })
      }
    }
    this.changed([...affected])
  }

  rebindAgent(previousId: string, nextId: string, options: { readonly silent?: boolean } = {}): void {
    this.assertOpen()
    if (previousId === nextId) return
    if (options.silent !== true) this.requireAgent(nextId)
    const replace = (values: readonly string[]): string[] => [...new Set(values.map(value => value === previousId ? nextId : value))]
    for (const [id, channel] of this.channels) {
      if (channel.createdBy !== previousId && !channel.members.includes(previousId)) continue
      this.channels.set(id, {
        ...channel,
        createdBy: channel.createdBy === previousId ? nextId : channel.createdBy,
        members: replace(channel.members),
      })
    }
    for (const [id, meeting] of this.meetings) {
      if (meeting.initiator !== previousId && !meeting.participants.includes(previousId)) continue
      const attendance = { ...meeting.attendance }
      if (attendance[previousId] !== undefined) {
        attendance[nextId] = attendance[nextId] ?? attendance[previousId]
        delete attendance[previousId]
      }
      this.meetings.set(id, {
        ...meeting,
        initiator: meeting.initiator === previousId ? nextId : meeting.initiator,
        participants: replace(meeting.participants),
        attendance,
      })
    }
    for (const [id, vote] of this.votes) {
      if (vote.initiator !== previousId && !vote.voters.includes(previousId)
        && !vote.approvals.includes(previousId) && vote.rejection?.voter !== previousId) continue
      this.votes.set(id, {
        ...vote,
        initiator: vote.initiator === previousId ? nextId : vote.initiator,
        voters: replace(vote.voters),
        approvals: replace(vote.approvals),
        ...(vote.rejection?.voter === previousId
          ? { rejection: { ...vote.rejection, voter: nextId } }
          : {}),
      })
    }
    for (let index = 0; index < this.history.length; index += 1) {
      const message = this.history[index] as FleetMessage
      if (message.from !== previousId && message.conversation !== `@${previousId}`
        && !message.mentions.includes(previousId)) continue
      this.history[index] = {
        ...message,
        from: message.from === previousId ? nextId : message.from,
        conversation: message.conversation === `@${previousId}` ? `@${nextId}` : message.conversation,
        mentions: replace(message.mentions),
      }
    }
    for (const [key, reaction] of this.reactions) {
      if (reaction.members.includes(previousId)) this.reactions.set(key, { ...reaction, members: replace(reaction.members) })
    }
    for (const [id, pin] of this.pins) {
      if (pin.pinnedBy === previousId) this.pins.set(id, { ...pin, pinnedBy: nextId })
    }
    const acknowledged = this.acknowledgedByAgent.get(previousId)
    if (acknowledged !== undefined) {
      const next = this.acknowledgedByAgent.get(nextId) ?? new Set<string>()
      for (const messageId of acknowledged) next.add(messageId)
      this.acknowledgedByAgent.set(nextId, next)
      this.acknowledgedByAgent.delete(previousId)
    }
    const delivered = this.deliveredContextByAgent.get(previousId)
    if (delivered !== undefined) {
      const next = this.deliveredContextByAgent.get(nextId) ?? new Map<string, string>()
      for (const [contextMessageId, messageId] of delivered) next.set(contextMessageId, messageId)
      this.deliveredContextByAgent.set(nextId, next)
      this.deliveredContextByAgent.delete(previousId)
    }
    const entered = this.enteredContextByAgent.get(previousId)
    if (entered !== undefined) {
      const next = this.enteredContextByAgent.get(nextId) ?? new Set<string>()
      for (const contextMessageId of entered) next.add(contextMessageId)
      this.enteredContextByAgent.set(nextId, next)
      this.enteredContextByAgent.delete(previousId)
    }
    const previousRevision = this.agentRevisions.get(previousId)
    if (previousRevision !== undefined) {
      this.agentRevisions.set(nextId, Math.max(previousRevision, this.agentRevisions.get(nextId) ?? 0))
      this.agentRevisions.delete(previousId)
    }
    this.rebuildPendingWakeups()
    for (const waiter of [...this.waiters]) {
      if (waiter.agentId === previousId) waiter.fail(new Error(`Agent ${previousId} rebound to ${nextId}`))
    }
    if (options.silent !== true) this.changed([nextId])
  }

  retireAgent(agentId: string, successorId: string): void {
    this.assertOpen()
    if (agentId === successorId) throw new Error('retired Agent and successor must be different')
    this.requireAgent(successorId)

    for (const [id, channel] of this.channels) {
      if (channel.createdBy !== agentId && !channel.members.includes(agentId)) continue
      const updated: FleetChannel = {
        ...channel,
        createdBy: channel.createdBy === agentId ? successorId : channel.createdBy,
        members: channel.members.filter(member => member !== agentId),
        updatedAt: new Date().toISOString(),
      }
      this.channels.set(id, updated)
      this.emit({ type: 'channel', action: 'updated', channel: updated })
    }

    for (const [id, meeting] of this.meetings) {
      if (!meeting.participants.includes(agentId)) continue
      const remaining = meeting.participants.filter(participant => participant !== agentId)
      const { [agentId]: _retiredAttendance, ...attendance } = meeting.attendance
      if (meeting.status === 'open' && remaining.length < 2) {
        const closed: FleetMeeting = {
          ...meeting,
          initiator: meeting.initiator === agentId ? (remaining[0] ?? successorId) : meeting.initiator,
          participants: remaining,
          attendance,
          status: 'closed',
          summary: 'Meeting closed because a participant left the Team and fewer than two participants remained.',
          closedAt: new Date().toISOString(),
        }
        this.meetings.set(id, closed)
        for (const participant of meeting.participants) this.clearPendingWakeups(participant, `meeting:${id}`)
        this.emit({ type: 'meeting', action: 'closed', meeting: closed })
        const message = this.appendMessage('fleet', {
          to: `meeting:${id}`,
          text: closed.summary ?? 'The meeting has ended.',
          delivery: 'wakeup',
        }, closed.summary ?? 'The meeting has ended.', [], [], 'meeting_closed')
        this.deliverMeeting(closed, 'fleet', message, true)
      } else {
        const updated: FleetMeeting = {
          ...meeting,
          initiator: meeting.initiator === agentId ? (remaining[0] ?? successorId) : meeting.initiator,
          participants: remaining,
          attendance,
        }
        this.meetings.set(id, updated)
        this.emit({ type: 'meeting', action: 'updated', meeting: updated })
      }
    }

    for (const [id, vote] of this.votes) {
      if (vote.status !== 'open' || (vote.initiator !== agentId && !vote.voters.includes(agentId))) continue
      let voters = vote.voters.filter(voter => voter !== agentId)
      let approvals = vote.approvals.filter(voter => voter !== agentId)
      const initiator = vote.initiator === agentId ? successorId : vote.initiator
      if (voters.includes(initiator)) {
        voters = voters.filter(voter => voter !== initiator)
        approvals = approvals.filter(voter => voter !== initiator)
      }
      const approved = approvals.length === voters.length
      const updated: FleetVote = {
        ...vote,
        initiator,
        voters,
        approvals,
        ...(approved ? { status: 'approved', closedAt: new Date().toISOString() } : {}),
      }
      this.votes.set(id, updated)
      this.emit({ type: 'vote', action: 'updated', vote: updated })
      if (approved) {
        this.emit({ type: 'vote', action: 'closed', vote: updated })
        const text = `Vote ${updated.id} approved after Team membership changed: ${updated.statement}`
        const message = this.appendMessage('fleet', {
          to: updated.channel,
          text,
          delivery: 'wakeup',
        }, text, [], [updated.initiator], 'vote_closed')
        const initiatorAgent = this.agents.get(updated.initiator)
        if (initiatorAgent !== undefined) {
          this.addPendingWakeup(initiatorAgent.id, message)
          this.deliver(initiatorAgent, message, true, false)
        }
      }
    }

    this.pendingWakeupsByAgent.delete(agentId)
    this.acknowledgedByAgent.delete(agentId)
    this.deliveredContextByAgent.delete(agentId)
    this.enteredContextByAgent.delete(agentId)
    for (const [key, reaction] of this.reactions) {
      if (!reaction.members.includes(agentId)) continue
      const members = reaction.members.filter(member => member !== agentId)
      if (members.length === 0) this.reactions.delete(key)
      else this.reactions.set(key, { ...reaction, members, updatedAt: new Date().toISOString() })
    }
    this.agentRevisions.delete(agentId)
    this.changed([successorId])
  }

  initializeChannel(input: InitializeChannelInput): FleetChannel {
    this.assertOpen()
    const id = input.id.trim()
    if (!CHANNEL_NAME.test(id)) throw new Error('channel id must use lower-kebab-case')
    if (this.channels.has(id)) throw new Error(`channel ${id} already exists`)
    const members = input.members === undefined
      ? []
      : uniqueStrings(input.members, 'channel member').map(target => this.resolveAgent(target))
    for (const member of members) this.requireAgent(member)
    const now = new Date().toISOString()
    const channel: FleetChannel = {
      id,
      name: input.name.trim() || id,
      topic: input.topic?.trim() ?? '',
      summary: input.summary?.trim() ?? '',
      body: input.body?.trim() ?? '',
      revision: 0,
      open: input.members === undefined,
      members,
      createdBy: 'fleet',
      createdAt: now,
      archived: false,
      updatedAt: now,
    }
    this.channels.set(id, channel)
    this.emit({ type: 'channel', action: 'created', channel })
    if (input.initialMessage?.trim()) {
      this.appendMessage('fleet', {
        to: `#${id}`,
        text: input.initialMessage,
        delivery: 'quiet',
      }, input.initialMessage.trim(), [], [])
    }
    this.changed(this.visibleChannelAgentIds(channel))
    return snapshot(channel)
  }

  send(sender: MessageAgent, input: SendMessageInput): SendMessageResult {
    this.assertOpen()
    this.requireAgent(sender.id)
    const text = input.text.trim()
    if (text.length === 0) throw new Error('message text cannot be empty')
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`message text cannot exceed ${MAX_MESSAGE_LENGTH} characters`)
    }

    const resources = uniqueStrings(input.resources ?? [], 'resource id')
    const mentions = uniqueStrings(input.mentions ?? [], 'mention').map(target => this.resolveAgent(target))
    if (input.to.startsWith('meeting:')) {
      if (mentions.length > 0) throw new Error('meeting messages do not accept mentions')
      return this.sendMeeting(sender, input, text, resources)
    }
    if (input.to.startsWith('@')) {
      const recipient = this.resolveAgent(input.to)
      if (mentions.some(mention => mention !== recipient)) {
        throw new Error('a direct message can only mention its recipient')
      }
      return this.sendDirect(sender, { ...input, to: `@${recipient}` }, text, resources)
    }
    if (!input.to.startsWith('#')) throw new Error(`invalid Fleet target ${input.to}`)
    return this.sendChannel(sender, input, text, resources, mentions)
  }

  pendingWakeups(agentId: string): FleetMessage[] {
    return snapshot([...(this.pendingWakeupsByAgent.get(agentId)?.values() ?? [])])
  }

  sendSystemNotification(
    agentId: string,
    notification: FleetSystemNotificationInput,
  ): FleetSystemNotificationResult {
    this.assertOpen()
    const target = this.requireAgent(agentId)
    const text = notification.text.trim()
    if (text.length === 0) throw new Error('Fleet system notification cannot be empty')
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Fleet system notification cannot exceed ${MAX_MESSAGE_LENGTH} characters`)
    }
    const coalesceKey = notification.coalesceKey?.trim()
    if (notification.coalesceKey !== undefined && coalesceKey?.length === 0) {
      throw new Error('Fleet system notification coalesceKey cannot be empty')
    }
    if (notification.relatedMessageId !== undefined) {
      this.requireVisibleMessage(agentId, notification.relatedMessageId)
    }
    const normalized: FleetSystemNotificationInput = {
      ...notification,
      text,
      ...(coalesceKey === undefined ? {} : { coalesceKey }),
    }
    const created = createUserMessage({
      content: [{ type: 'text', text }],
      source: coalesceKey === undefined
        ? { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'instructions' }
        : {
            kind: 'plugin',
            plugin: 'dsh-agent-fleet',
            form: 'snapshot',
            sections: [{ name: `notification:${coalesceKey}`, text }],
          },
    })
    const pending = coalesceKey === undefined
      ? undefined
      : this.findPendingSystemNotification(target, coalesceKey)
    if (pending !== undefined && notification.delivery !== 'interrupt'
      && (notification.delivery === 'quiet' || pending.queue === 'nextTurn')) {
      const replacement = { ...created, id: pending.message.id }
      if (typeof target.inbox?.replace === 'function'
        && target.inbox.replace(pending.message.id, replacement)) {
        return this.recordSystemNotification(target, replacement, normalized, 'replaced')
      }
    }
    let input = created
    if (pending !== undefined && typeof target.inbox?.remove === 'function'
      && target.inbox.remove(pending.message.id)) {
      input = { ...created, id: pending.message.id }
    }
    const disposition = this.dispatchContext(target, input, notification.delivery)
    return this.recordSystemNotification(target, input, normalized, disposition)
  }

  followupUnread(target: MessageAgent): FleetMessage | undefined {
    const unread = this.inbox(target, { unreadOnly: true, limit: 1 }).at(-1)?.message
    if (unread === undefined) return undefined
    const sender = `@${unread.fromName ?? unread.from}`
    this.sendSystemNotification(target.id, {
      kind: 'message_notice',
      text: `[Fleet ${unread.conversation}] New message ${unread.id} from ${sender}. Call fleet_messages to read it.`,
      delivery: 'wakeup',
      coalesceKey: this.messageNoticeKey(unread),
      relatedMessageId: unread.id,
    })
    return unread
  }

  read(sender: MessageAgent, input: ReadMessagesInput): ReadMessagesResult {
    this.assertOpen()
    this.requireAgent(sender.id)
    const limit = input.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer from 1 through 100')
    }

    let messages: FleetMessage[]
    if (input.conversation.startsWith('#')) {
      const channel = this.requireReadableChannel(sender.id, channelId(input.conversation))
      messages = this.history.filter(message => message.conversation === `#${channel.id}`)
    } else if (input.conversation.startsWith('@')) {
      const peer = this.resolveAgent(input.conversation)
      this.requireContact(sender.id, peer)
      const conversation = directConversation(sender.id, peer)
      messages = this.history.filter(message => {
        if (!message.conversation.startsWith('@')) return false
        return directConversation(message.from, agentTarget(message.conversation)) === conversation
      })
    } else if (input.conversation.startsWith('meeting:')) {
      const meeting = this.requireMeeting(sender.id, meetingId(input.conversation))
      messages = this.history.filter(message => message.conversation === `meeting:${meeting.id}`)
    } else {
      throw new Error(`invalid Fleet conversation ${input.conversation}`)
    }

    let start = Math.max(0, messages.length - limit)
    if (input.after !== undefined) {
      const index = messages.findIndex(message => message.id === input.after)
      if (index < 0) throw new Error(`message ${input.after} is not in this conversation`)
      start = index + 1
    }
    const page = messages.slice(start, start + limit)
    const hasMore = start + page.length < messages.length
    let acknowledged = false
    for (const message of page) {
      if (message.from !== sender.id && this.markAcknowledged(sender.id, message.id)) acknowledged = true
    }
    if (input.conversation.startsWith('#') && !hasMore) {
      this.removePendingSystemNotification(sender, `unread:${input.conversation}`)
    }
    if (acknowledged) this.changed([sender.id])
    return {
      messages: snapshot(page),
      hasMore,
      revision: this.agentRevision(sender.id),
    }
  }

  readMessageText(sender: MessageAgent, messageId: string, offset = 0, limit = 4_000): import('./types.js').FleetMessageTextChunk {
    this.assertOpen()
    this.requireAgent(sender.id)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12_000) {
      throw new Error('limit must be an integer from 1 through 12000')
    }
    const message = this.requireVisibleMessage(sender.id, messageId)
    if (offset > message.text.length) throw new Error(`offset ${String(offset)} is beyond message ${messageId}`)
    const text = message.text.slice(offset, offset + limit)
    const nextOffset = offset + text.length
    const hasMore = nextOffset < message.text.length
    return {
      messageId,
      offset,
      text,
      totalLength: message.text.length,
      hasMore,
      ...(hasMore ? { nextOffset } : {}),
    }
  }

  search(sender: MessageAgent, input: SearchMessagesInput = {}): FleetMessage[] {
    this.assertOpen()
    this.requireAgent(sender.id)
    const limit = input.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer from 1 through 100')
    }
    const query = input.query?.trim().toLowerCase()
    const from = input.from === undefined ? undefined : this.resolveAgent(input.from.startsWith('@') ? input.from : `@${input.from}`)
    return snapshot(this.history.filter(message =>
      this.canSeeMessage(sender.id, message)
      && (input.conversation === undefined || this.sameConversation(sender.id, message, input.conversation))
      && (query === undefined || query.length === 0 || message.text.toLowerCase().includes(query))
      && (from === undefined || message.from === from)
      && (input.resource === undefined || message.resources.includes(input.resource))
    ).slice(-limit))
  }

  inbox(sender: MessageAgent, input: { readonly unreadOnly?: boolean; readonly limit?: number } = {}): FleetInboxItem[] {
    this.assertOpen()
    this.requireAgent(sender.id)
    const limit = input.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer from 1 through 100')
    }
    const acknowledged = this.acknowledgedByAgent.get(sender.id)
    const items = this.history.flatMap((message): FleetInboxItem[] => {
      if (message.from === sender.id || !this.canSeeMessage(sender.id, message)) return []
      const reasons: FleetInboxItem['reasons'] = []
      if (message.conversation.startsWith('@') && agentTarget(message.conversation) === sender.id) reasons.push('direct')
      if (message.mentions.includes(sender.id)) reasons.push('mention')
      if (message.conversation.startsWith('meeting:')) reasons.push('meeting')
      if (reasons.length === 0) return []
      const isAcknowledged = acknowledged?.has(message.id) === true
      if (input.unreadOnly === true && isAcknowledged) return []
      return [{ message: snapshot(message), reasons, acknowledged: isAcknowledged }]
    })
    return items.slice(-limit)
  }

  acknowledge(sender: MessageAgent, messageId: string): FleetInboxItem {
    const item = this.inbox(sender, { limit: 100 }).find(candidate => candidate.message.id === messageId)
    if (item === undefined) throw new Error(`message ${messageId} is not in Agent ${sender.id}'s inbox`)
    if (this.markAcknowledged(sender.id, messageId)) this.changed([sender.id])
    return { ...item, acknowledged: true }
  }

  react(sender: MessageAgent, input: { readonly messageId: string; readonly reaction: string; readonly remove?: boolean }): FleetMessageReaction {
    this.assertOpen()
    this.requireAgent(sender.id)
    this.requireVisibleMessage(sender.id, input.messageId)
    const reactionName = input.reaction.trim()
    if (reactionName.length === 0 || reactionName.length > 32) throw new Error('reaction must be 1 through 32 characters')
    const key = this.reactionKey(input.messageId, reactionName)
    const current = this.reactions.get(key)
    const members = new Set(current?.members ?? [])
    if (input.remove === true) members.delete(sender.id)
    else members.add(sender.id)
    const reaction: FleetMessageReaction = {
      messageId: input.messageId,
      reaction: reactionName,
      members: [...members],
      updatedAt: new Date().toISOString(),
    }
    if (members.size === 0) this.reactions.delete(key)
    else this.reactions.set(key, reaction)
    this.emit({ type: 'reaction', action: members.size === 0 ? 'removed' : 'updated', reaction })
    const message = this.requireVisibleMessage(sender.id, input.messageId)
    this.changed(this.visibleMessageAgentIds(message))
    return snapshot(reaction)
  }

  listReactions(sender: MessageAgent, messageId: string): FleetMessageReaction[] {
    this.assertOpen()
    this.requireAgent(sender.id)
    this.requireVisibleMessage(sender.id, messageId)
    return snapshot([...this.reactions.values()].filter(reaction => reaction.messageId === messageId))
  }

  pin(sender: MessageAgent, messageId: string, remove = false): FleetMessagePin {
    this.assertOpen()
    this.requireAgent(sender.id)
    const message = this.requireVisibleMessage(sender.id, messageId)
    const current = this.pins.get(messageId)
    const pin: FleetMessagePin = current ?? {
      messageId,
      conversation: message.conversation,
      pinnedBy: sender.id,
      createdAt: new Date().toISOString(),
    }
    if (remove) this.pins.delete(messageId)
    else this.pins.set(messageId, pin)
    this.emit({ type: 'pin', action: remove ? 'unpinned' : 'pinned', pin })
    this.changed(this.visibleMessageAgentIds(message))
    return snapshot(pin)
  }

  listPins(sender: MessageAgent, conversation?: FleetTarget): FleetMessagePin[] {
    this.assertOpen()
    this.requireAgent(sender.id)
    return snapshot([...this.pins.values()].filter(pin => {
      const message = this.history.find(candidate => candidate.id === pin.messageId)
      return message !== undefined
        && this.canSeeMessage(sender.id, message)
        && (conversation === undefined || this.sameConversation(sender.id, message, conversation))
    }))
  }

  listChannels(sender: MessageAgent): FleetChannel[] {
    this.assertOpen()
    this.requireAgent(sender.id)
    return snapshot([...this.channels.values()].filter(channel => this.canRead(channel, sender.id)))
  }

  createChannel(sender: MessageAgent, input: CreateChannelInput): FleetChannel {
    this.assertOpen()
    this.requireAgent(sender.id)
    this.requirePermission(sender.id, 'channel.manage')
    const name = input.name.trim()
    if (!CHANNEL_NAME.test(name)) {
      throw new Error('channel name must use lower-kebab-case')
    }
    if (this.channels.has(name)) throw new Error(`channel ${name} already exists`)

    const members = input.members === undefined
      ? []
      : uniqueStrings(input.members, 'channel member').map(target => this.resolveAgent(target))
    if (input.members !== undefined && !members.includes(sender.id)) members.unshift(sender.id)
    for (const member of members) {
      this.requireAgent(member)
      if (member !== sender.id) this.requireContact(sender.id, member)
    }

    const channel: FleetChannel = {
      id: name,
      name,
      topic: input.topic?.trim() ?? '',
      summary: input.summary?.trim() ?? '',
      body: input.body?.trim() ?? '',
      revision: 0,
      open: input.members === undefined,
      members,
      createdBy: sender.id,
      createdAt: new Date().toISOString(),
      archived: false,
      updatedAt: new Date().toISOString(),
    }
    this.channels.set(channel.id, channel)
    this.emit({ type: 'channel', action: 'created', channel })
    this.changed(this.visibleChannelAgentIds(channel))
    return snapshot(channel)
  }

  updateChannel(sender: MessageAgent, name: string, input: UpdateChannelInput): FleetChannel {
    this.assertOpen()
    this.requireAgent(sender.id)
    this.requirePermission(sender.id, 'channel.manage')
    const channel = this.requireReadableChannel(sender.id, name)
    if (channel.archived) throw new Error(`channel #${name} is archived`)
    if (input.topic === undefined && input.summary === undefined && input.body === undefined
      && input.addMembers === undefined && input.removeMembers === undefined) {
      throw new Error('Channel update requires topic, summary, body, addMembers, or removeMembers')
    }
    const members = new Set(channel.members)
    if (channel.open && (input.addMembers !== undefined || input.removeMembers !== undefined)) {
      throw new Error('open Channels do not have an explicit member list')
    }
    for (const reference of input.addMembers ?? []) {
      const id = this.resolveAgent(reference)
      this.requireAgent(id)
      this.requireContact(sender.id, id)
      members.add(id)
    }
    for (const reference of input.removeMembers ?? []) {
      const id = this.resolveAgent(reference)
      if (id === channel.createdBy) throw new Error('Channel creator cannot be removed')
      members.delete(id)
    }
    const updated: FleetChannel = {
      ...channel,
      ...(input.topic === undefined ? {} : { topic: input.topic.trim() }),
      ...(input.summary === undefined ? {} : { summary: input.summary.trim() }),
      ...(input.body === undefined ? {} : { body: input.body.trim() }),
      members: [...members],
      revision: channel.revision + 1,
      updatedAt: new Date().toISOString(),
    }
    this.channels.set(name, updated)
    this.emit({ type: 'channel', action: 'updated', channel: updated })
    this.changed(this.visibleChannelAgentIds(updated))
    return snapshot(updated)
  }

  archiveChannel(sender: MessageAgent, name: string): FleetChannel {
    this.assertOpen()
    this.requireAgent(sender.id)
    this.requirePermission(sender.id, 'channel.manage')
    if (name === 'general') throw new Error('the general channel cannot be archived')
    const channel = this.channels.get(name)
    if (channel === undefined) throw new Error(`unknown channel ${name}`)
    if (!this.canRead(channel, sender.id)) throw new Error(`Agent ${sender.id} cannot access #${name}`)
    if (channel.createdBy !== sender.id) throw new Error(`only Channel creator ${channel.createdBy} can archive #${name}`)
    if (channel.archived) return snapshot(channel)

    const archived = {
      ...channel,
      archived: true,
      revision: channel.revision + 1,
      updatedAt: new Date().toISOString(),
    }
    this.channels.set(name, archived)
    this.emit({ type: 'channel', action: 'archived', channel: archived })
    this.changed(this.visibleChannelAgentIds(archived))
    return snapshot(archived)
  }

  listMeetings(sender: MessageAgent): FleetMeeting[] {
    this.assertOpen()
    this.requireAgent(sender.id)
    return snapshot([...this.meetings.values()].filter(meeting =>
      meeting.participants.includes(sender.id),
    ))
  }

  openMeeting(sender: MessageAgent, input: OpenMeetingInput): FleetMeeting {
    this.assertOpen()
    this.requireAgent(sender.id)
    this.requirePermission(sender.id, 'meeting.manage')
    const id = input.id.trim()
    if (!CHANNEL_NAME.test(id)) throw new Error('meeting id must use lower-kebab-case')
    if (this.meetings.has(id)) throw new Error(`meeting ${id} already exists`)

    const title = input.title.trim()
    if (title.length === 0) throw new Error('meeting title cannot be empty')
    const agenda = input.agenda.trim()
    if (agenda.length === 0) throw new Error('meeting agenda cannot be empty')
    const invited = uniqueStrings(input.participants, 'meeting participant').map(target => this.resolveAgent(target))
    const participants = [sender.id, ...invited.filter(id => id !== sender.id)]
    if (participants.length < 2) {
      throw new Error('a meeting requires at least one invited participant')
    }
    for (const participant of participants) {
      this.requireAgent(participant)
      if (participant !== sender.id) this.requireContact(sender.id, participant)
    }

    const meeting: FleetMeeting = {
      id,
      title,
      agenda,
      initiator: sender.id,
      participants,
      attendance: { [sender.id]: { joinedAt: new Date().toISOString() } },
      status: 'open',
      decisions: [],
      actionItems: [],
      resources: [],
      createdAt: new Date().toISOString(),
    }
    this.meetings.set(id, meeting)
    this.emit({ type: 'meeting', action: 'opened', meeting })
    const message = this.appendMessage(sender.id, {
      to: `meeting:${id}`,
      text: agenda,
      delivery: 'wakeup',
    }, agenda, [], [], 'meeting_opened')
    for (const participant of participants) {
      if (participant !== sender.id) this.addPendingWakeup(participant, message)
    }
    this.deliverMeeting(meeting, sender.id, message, true)
    this.changed(meeting.participants)
    return snapshot(meeting)
  }

  joinMeeting(sender: MessageAgent, id: string): FleetMeeting {
    this.assertOpen()
    this.requireAgent(sender.id)
    const meeting = this.requireMeeting(sender.id, id)
    if (meeting.status !== 'open') throw new Error(`meeting ${id} is already closed`)
    const current = meeting.attendance[sender.id]
    if (current !== undefined && current.leftAt === undefined) return snapshot(meeting)
    const joined = {
      ...meeting,
      attendance: { ...meeting.attendance, [sender.id]: { joinedAt: new Date().toISOString() } },
    }
    this.meetings.set(id, joined)
    this.emit({ type: 'meeting', action: 'joined', meeting: joined })
    this.changed(joined.participants)
    return snapshot(joined)
  }

  leaveMeeting(sender: MessageAgent, id: string): FleetMeeting {
    this.assertOpen()
    this.requireAgent(sender.id)
    const meeting = this.requireMeeting(sender.id, id)
    if (meeting.status !== 'open') throw new Error(`meeting ${id} is already closed`)
    const current = meeting.attendance[sender.id]
    if (current === undefined || current.leftAt !== undefined) return snapshot(meeting)
    const left = {
      ...meeting,
      attendance: {
        ...meeting.attendance,
        [sender.id]: { ...current, leftAt: new Date().toISOString() },
      },
    }
    this.meetings.set(id, left)
    this.emit({ type: 'meeting', action: 'left', meeting: left })
    this.changed(left.participants)
    return snapshot(left)
  }

  closeMeeting(sender: MessageAgent, id: string, input: CloseMeetingInput = {}): FleetMeeting {
    this.assertOpen()
    this.requireAgent(sender.id)
    this.requirePermission(sender.id, 'meeting.manage')
    const meeting = this.requireMeeting(sender.id, id)
    if (meeting.initiator !== sender.id) {
      throw new Error(`only meeting initiator ${meeting.initiator} can close meeting ${id}`)
    }
    if (meeting.status === 'closed') return snapshot(meeting)
    for (const participant of meeting.participants) {
      this.clearPendingWakeups(participant, `meeting:${id}`)
    }

    const summary = input.summary?.trim()
    const decisions = uniqueStrings(input.decisions ?? [], 'meeting decision')
    const resources = uniqueStrings(input.resources ?? [], 'resource id')
    const actionItems = (input.actionItems ?? []).map((item) => {
      const text = item.text.trim()
      if (text.length === 0) throw new Error('meeting action item cannot be empty')
      const assignee = item.assignee === undefined ? undefined : this.resolveAgent(item.assignee)
      if (assignee !== undefined) this.requireAgent(assignee)
      const taskId = item.taskId?.trim()
      if (taskId !== undefined && taskId.length > 0) {
        this.options.validateTaskReference?.(taskId, assignee)
      }
      return {
        text,
        ...(assignee === undefined ? {} : { assignee }),
        ...(taskId === undefined || taskId.length === 0 ? {} : { taskId }),
      }
    })
    const closed: FleetMeeting = {
      ...meeting,
      status: 'closed',
      ...(summary === undefined || summary.length === 0 ? {} : { summary }),
      decisions,
      actionItems,
      resources,
      closedAt: new Date().toISOString(),
    }
    this.meetings.set(id, closed)
    this.emit({ type: 'meeting', action: 'closed', meeting: closed })
    const text = [
      'The meeting has ended.',
      ...(closed.summary === undefined ? [] : [`Summary: ${closed.summary}`]),
      ...(closed.decisions.length === 0 ? [] : [`Decisions:\n${closed.decisions.map(decision => `- ${decision}`).join('\n')}`]),
      ...(closed.actionItems.length === 0 ? [] : [`Action items:\n${closed.actionItems.map(item =>
        `- ${item.text}${item.assignee === undefined ? '' : ` (@${this.agents.displayName?.(item.assignee) ?? item.assignee})`}${item.taskId === undefined ? '' : ` [${item.taskId}]`}`,
      ).join('\n')}`]),
    ].join('\n\n')
    const message = this.appendMessage(sender.id, {
      to: `meeting:${id}`,
      text,
      delivery: 'wakeup',
    }, text, [], [], 'meeting_closed')
    this.deliverMeeting(closed, sender.id, message, true)
    this.changed(closed.participants)
    return snapshot(closed)
  }

  listVotes(sender: MessageAgent, channel?: string): FleetVote[] {
    this.assertOpen()
    this.requireAgent(sender.id)
    if (channel !== undefined) this.requireReadableChannel(sender.id, channelId(channel))
    return snapshot([...this.votes.values()].filter(vote => {
      if (channel !== undefined && vote.channel !== channel) return false
      const target = this.channels.get(channelId(vote.channel))
      return target !== undefined && this.canRead(target, sender.id)
    }))
  }

  getVote(sender: MessageAgent, id: string): FleetVote {
    this.assertOpen()
    this.requireAgent(sender.id)
    const vote = this.requireVote(id)
    this.requireReadableChannel(sender.id, channelId(vote.channel))
    return snapshot(vote)
  }

  createVote(sender: MessageAgent, input: CreateVoteInput): FleetVote {
    this.assertOpen()
    this.requireAgent(sender.id)
    this.requirePermission(sender.id, 'vote.create')
    const channel = this.requireReadableChannel(sender.id, channelId(input.channel))
    if (channel.archived) throw new Error(`channel #${channel.id} is archived`)
    const statement = input.statement.trim()
    if (statement.length === 0) throw new Error('vote statement cannot be empty')
    const voters = input.voters === undefined
      ? this.agents.list()
        .filter(agent => agent.id !== sender.id
          && (this.agents.defaultVoter?.(agent.id) ?? true)
          && this.canRead(channel, agent.id))
        .map(agent => agent.id)
      : uniqueStrings(input.voters, 'vote voter').map(reference => this.resolveAgent(reference))
    if (input.voters !== undefined && voters.length === 0) {
      throw new Error('an explicit voter list cannot be empty')
    }
    for (const voter of voters) {
      if (voter === sender.id) throw new Error('a Vote initiator cannot also be a voter')
      this.requireAgent(voter)
      if (!(this.agents.canVote?.(voter) ?? true)) throw new Error(`Agent ${voter} is not eligible to vote`)
      if (input.voters !== undefined) this.requireContact(sender.id, voter)
      if (!this.canRead(channel, voter)) throw new Error(`Agent ${voter} cannot access #${channel.id}`)
    }
    this.clearPendingWakeups(sender.id, input.channel, true)
    const vote: FleetVote = {
      id: `vote_${String(++this.voteSequence)}`,
      channel: `#${channel.id}`,
      kind: input.kind,
      statement,
      initiator: sender.id,
      voters,
      approvals: [],
      status: voters.length === 0 ? 'approved' : 'open',
      createdAt: new Date().toISOString(),
      ...(voters.length === 0 ? { closedAt: new Date().toISOString() } : {}),
    }
    this.votes.set(vote.id, vote)
    this.emit({ type: 'vote', action: 'opened', vote })
    const message = this.appendMessage(sender.id, {
      to: vote.channel,
      text: `Vote ${vote.id} opened (${vote.kind}): ${statement}`,
      delivery: 'wakeup',
    }, `Vote ${vote.id} opened (${vote.kind}): ${statement}`, [], voters, 'vote_opened')
    for (const voter of voters) {
      this.addPendingWakeup(voter, message)
      this.deliver(this.requireAgent(voter), message, true, false)
    }
    if (vote.status === 'approved') this.emit({ type: 'vote', action: 'closed', vote })
    this.changed([sender.id, ...voters])
    return snapshot(vote)
  }

  castVote(sender: MessageAgent, input: CastVoteInput): FleetVote {
    this.assertOpen()
    this.requireAgent(sender.id)
    const current = input.id === undefined
      ? this.requireOnlyPendingVote(sender.id)
      : this.requireVote(input.id)
    this.requireReadableChannel(sender.id, channelId(current.channel))
    if (current.status !== 'open') throw new Error(`vote ${current.id} is ${current.status}`)
    if (!current.voters.includes(sender.id)) throw new Error(`Agent ${sender.id} is not a voter on ${current.id}`)
    if (current.approvals.includes(sender.id)) throw new Error(`Agent ${sender.id} already voted on ${current.id}`)
    const reason = input.reason?.trim()
    if (input.response === 'reject' && !reason) throw new Error('rejecting a vote requires a reason')

    let vote: FleetVote
    if (input.response === 'reject') {
      vote = {
        ...current,
        rejection: { voter: sender.id, reason: reason ?? '' },
        status: 'rejected',
        closedAt: new Date().toISOString(),
      }
    } else {
      const approvals = [...current.approvals, sender.id]
      const approved = approvals.length === current.voters.length
      vote = {
        ...current,
        approvals,
        ...(approved ? { status: 'approved' as const, closedAt: new Date().toISOString() } : {}),
      }
    }
    this.votes.set(vote.id, vote)
    this.clearPendingWakeups(sender.id, vote.channel, true)
    this.emit({ type: 'vote', action: 'cast', vote })
    this.appendMessage(sender.id, {
      to: vote.channel,
      text: input.response === 'approve'
        ? `Approved vote ${vote.id}.`
        : `Rejected vote ${vote.id}: ${reason ?? ''}`,
      delivery: 'quiet',
    }, input.response === 'approve'
      ? `Approved vote ${vote.id}.`
      : `Rejected vote ${vote.id}: ${reason ?? ''}`, [], [], 'vote_cast')

    if (vote.status !== 'open') {
      this.emit({ type: 'vote', action: 'closed', vote })
      const text = `Vote ${vote.id} ${vote.status}: ${vote.statement}`
      const message = this.appendMessage('fleet', {
        to: vote.channel,
        text,
        delivery: 'wakeup',
      }, text, [], [vote.initiator], 'vote_closed')
      const initiator = this.agents.get(vote.initiator)
      if (initiator !== undefined) {
        this.addPendingWakeup(initiator.id, message)
        this.deliver(initiator, message, true, false)
      }
    }
    this.changed([sender.id, vote.initiator, ...vote.voters])
    return snapshot(vote)
  }

  wait(
    sender: MessageAgent,
    afterRevision: number | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<WaitResult> {
    this.assertOpen()
    this.requireAgent(sender.id)
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('timeout must be a positive integer')
    }
    if (afterRevision !== undefined) {
      if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
        throw new Error('after revision must be a non-negative integer')
      }
      const revision = this.agentRevision(sender.id)
      if (afterRevision > revision) throw new Error('after revision is ahead of Agent-visible Fleet state')
      if (afterRevision < revision) {
        return Promise.resolve({ timedOut: false, revision, reason: 'changed' })
      }
    }
    if (signal?.aborted === true) return Promise.reject(signal.reason ?? new Error('fleet_wait aborted'))

    return new Promise<WaitResult>((resolve, reject) => {
      let settled = false
      const settle = (operation: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.waiters.delete(waiter)
        operation()
      }
      const waiter: Waiter = {
        agentId: sender.id,
        finish: result => { settle(() => { resolve(result) }) },
        fail: error => { settle(() => { reject(error) }) },
      }
      const onAbort = (): void => {
        waiter.fail(signal?.reason ?? new Error('fleet_wait aborted'))
      }
      const timer = setTimeout(() => {
        waiter.finish({ timedOut: true, revision: this.agentRevision(sender.id), reason: 'timeout' })
      }, timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.add(waiter)
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of [...this.waiters]) {
      waiter.finish({ timedOut: false, revision: this.agentRevision(waiter.agentId), reason: 'stopped' })
    }
  }

  private sendDirect(
    sender: MessageAgent,
    input: SendMessageInput,
    text: string,
    resources: string[],
  ): SendMessageResult {
    const targetId = agentTarget(input.to)
    if (targetId === sender.id) throw new Error('an Agent cannot message itself')
    this.requireContact(sender.id, targetId)
    const target = this.requireAgent(targetId)
    this.clearPendingWakeups(sender.id, input.to, true)
    const message = this.appendMessage(sender.id, input, text, resources, [], input.kind ?? 'text')
    const wake = input.delivery !== 'quiet'
    this.addPendingWakeup(target.id, message)
    this.deliver(target, message, wake, false)
    this.changed([sender.id, target.id])
    return { messageId: message.id, recipients: 1, woken: wake ? 1 : 0 }
  }

  private sendChannel(
    sender: MessageAgent,
    input: SendMessageInput,
    text: string,
    resources: string[],
    mentions: string[],
  ): SendMessageResult {
    const channel = this.requireReadableChannel(sender.id, channelId(input.to))
    if (channel.archived) throw new Error(`channel #${channel.id} is archived`)
    if (input.delivery !== 'quiet' && mentions.length === 0) {
      throw new Error('a Channel follow-up requires at least one explicit mention')
    }
    for (const mention of mentions) {
      if (mention === sender.id) throw new Error('a Channel follow-up cannot mention its sender')
      this.requireAgent(mention)
      this.requireContact(sender.id, mention)
      if (!this.canRead(channel, mention)) {
        throw new Error(`Agent ${mention} cannot access #${channel.id}`)
      }
    }

    this.clearPendingWakeups(sender.id, input.to, true)
    const recipients = this.agents.list().filter(agent =>
      agent.id !== sender.id && this.canRead(channel, agent.id),
    )
    const message = this.appendMessage(sender.id, input, text, resources, mentions, input.kind ?? 'text')
    const mentioned = new Set(mentions)
    for (const recipient of recipients) {
      const wake = input.delivery !== 'quiet' && mentioned.has(recipient.id)
      if (wake) this.addPendingWakeup(recipient.id, message)
      if (wake) this.deliver(recipient, message, true, false)
      else this.deliverChannelNotice(recipient, message)
    }
    this.changed([sender.id, ...recipients.map(recipient => recipient.id)])
    return {
      messageId: message.id,
      recipients: recipients.length,
      woken: input.delivery !== 'quiet'
        ? recipients.filter(recipient => mentioned.has(recipient.id)).length
        : 0,
    }
  }

  private sendMeeting(
    sender: MessageAgent,
    input: SendMessageInput,
    text: string,
    resources: string[],
  ): SendMessageResult {
    const meeting = this.requireMeeting(sender.id, meetingId(input.to))
    if (meeting.status === 'closed') throw new Error(`meeting ${meeting.id} is closed`)
    this.clearPendingWakeups(sender.id, input.to, true)
    const message = this.appendMessage(sender.id, input, text, resources, [], input.kind ?? 'text')
    const wake = input.delivery !== 'quiet'
    for (const participant of meeting.participants) {
      if (participant !== sender.id) this.addPendingWakeup(participant, message)
    }
    const recipients = this.deliverMeeting(meeting, sender.id, message, wake)
    this.changed(meeting.participants)
    return {
      messageId: message.id,
      recipients,
      woken: wake ? recipients : 0,
    }
  }

  private appendMessage(
    sender: string,
    input: SendMessageInput,
    text: string,
    resources: string[],
    mentions: string[],
    kind: FleetMessageKind = 'text',
  ): FleetMessage {
    this.requireReply(sender, input.to, input.replyTo)
    const fromName = this.agents.displayName?.(sender)
    const sequence = ++this.sequence
    const message: FleetMessage = {
      id: `msg_${String(sequence)}`,
      sequence,
      kind,
      conversation: input.to,
      from: sender,
      ...(fromName === undefined ? {} : { fromName }),
      text,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      resources,
      mentions,
      delivery: input.delivery,
      createdAt: new Date().toISOString(),
    }
    this.rememberMessage(message)
    this.emit({ type: 'message', message })
    return message
  }

  private rememberMessage(message: FleetMessage): void {
    this.history.push(message)
    this.historyTextLength += message.text.length
    while (this.history.length > MAX_HISTORY_MESSAGES
      || this.historyTextLength > MAX_HISTORY_TEXT_LENGTH) {
      const removed = this.history.shift()
      if (removed === undefined) break
      this.historyTextLength -= removed.text.length
      this.forgetMessageMetadata(removed.id)
    }
  }

  private forgetMessageMetadata(messageId: string): void {
    this.pins.delete(messageId)
    for (const [key, reaction] of this.reactions) {
      if (reaction.messageId === messageId) this.reactions.delete(key)
    }
    for (const [agentId, acknowledged] of this.acknowledgedByAgent) {
      acknowledged.delete(messageId)
      if (acknowledged.size === 0) this.acknowledgedByAgent.delete(agentId)
    }
    for (const [agentId, pending] of this.pendingWakeupsByAgent) {
      pending.delete(messageId)
      if (pending.size === 0) this.pendingWakeupsByAgent.delete(agentId)
    }
    for (const agentId of this.deliveredContextByAgent.keys()) this.forgetDelivery(agentId, messageId)
  }

  private pruneMessageMetadata(): void {
    const retained = new Set(this.history.map(message => message.id))
    for (const messageId of this.pins.keys()) {
      if (!retained.has(messageId)) this.pins.delete(messageId)
    }
    for (const [key, reaction] of this.reactions) {
      if (!retained.has(reaction.messageId)) this.reactions.delete(key)
    }
    for (const [agentId, acknowledged] of this.acknowledgedByAgent) {
      for (const messageId of acknowledged) {
        if (!retained.has(messageId)) acknowledged.delete(messageId)
      }
      if (acknowledged.size === 0) this.acknowledgedByAgent.delete(agentId)
    }
    for (const agentId of this.deliveredContextByAgent.keys()) {
      const delivered = this.deliveredContextByAgent.get(agentId)
      if (delivered === undefined) continue
      for (const messageId of delivered.values()) {
        if (!retained.has(messageId)) this.forgetDelivery(agentId, messageId)
      }
    }
  }

  private requireReply(sender: string, target: FleetTarget, replyTo: string | undefined): void {
    if (replyTo === undefined) return
    const reply = this.history.find(message => message.id === replyTo)
    if (reply === undefined) throw new Error(`unknown reply target ${replyTo}`)
    if (target.startsWith('#')) {
      if (reply.conversation !== target) throw new Error(`reply target ${replyTo} is in another conversation`)
      return
    }
    if (target.startsWith('meeting:')) {
      if (reply.conversation !== target) throw new Error(`reply target ${replyTo} is in another conversation`)
      return
    }
    if (!reply.conversation.startsWith('@')) {
      throw new Error(`reply target ${replyTo} is in another conversation`)
    }
    const expected = directConversation(sender, agentTarget(target))
    const actual = directConversation(reply.from, agentTarget(reply.conversation))
    if (expected !== actual) throw new Error(`reply target ${replyTo} is in another conversation`)
  }

  private deliver(target: MessageAgent, message: FleetMessage, wake: boolean, notice: boolean): void {
    const resourceText = message.resources.length === 0
      ? ''
      : `\nResources: ${message.resources.join(', ')}`
    const sender = `@${message.fromName ?? message.from}`
    const text = notice
      ? `[Fleet ${message.conversation}] New message ${message.id} from ${sender}. Call fleet_messages to read it.`
      : `[Fleet ${message.conversation} | ${message.id} | from=${sender}] ${message.text}${resourceText}`
    const input = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'relay' },
    })
    this.dispatchContext(target, input, wake ? message.delivery : 'quiet')
    this.rememberDelivery(target.id, String(input.id), message.id)
    this.emit({
      type: 'inbox',
      action: 'delivered',
      agentId: target.id,
      messageId: message.id,
      contextMessageId: input.id,
    })
  }

  private dispatchContext(
    target: MessageAgent,
    input: UserMessage,
    delivery: FleetDelivery,
  ): FleetSystemNotificationResult['disposition'] {
    if (delivery === 'interrupt') {
      target.cancel({ kind: 'user' }, { keepInbox: true })
      target.steer(input)
      return 'interrupted'
    }
    if (delivery === 'wakeup') {
      target.followup(input)
      return 'followed-up'
    }
    target.inject(input)
    return 'injected'
  }

  private recordSystemNotification(
    target: MessageAgent,
    input: UserMessage,
    notification: FleetSystemNotificationInput,
    disposition: FleetSystemNotificationResult['disposition'],
  ): FleetSystemNotificationResult {
    this.emit({
      type: 'system_notification',
      action: disposition,
      agentId: target.id,
      contextMessageId: String(input.id),
      notification,
    })
    if (notification.relatedMessageId !== undefined) {
      this.rememberDelivery(target.id, String(input.id), notification.relatedMessageId)
      this.emit({
        type: 'inbox',
        action: 'delivered',
        agentId: target.id,
        messageId: notification.relatedMessageId,
        contextMessageId: input.id,
      })
    }
    return { contextMessageId: String(input.id), disposition }
  }

  private messageNoticeKey(message: FleetMessage): string {
    return message.conversation.startsWith('#')
      ? `unread:${message.conversation}`
      : `unread-message:${message.id}`
  }

  private findPendingSystemNotification(
    target: MessageAgent,
    coalesceKey: string,
  ): PendingSystemNotification | undefined {
    const inbox = target.inbox
    if (inbox === undefined) return undefined
    const sectionName = `notification:${coalesceKey}`
    const matches = (message: UserMessage): boolean => {
      const source = message.source
      return source.kind === 'plugin'
        && source.plugin === 'dsh-agent-fleet'
        && source.form === 'snapshot'
        && source.sections.some(section => section.name === sectionName)
    }
    const nextTurn = inbox.nextTurn.find(matches)
    if (nextTurn !== undefined) return { message: nextTurn, queue: 'nextTurn' }
    const nextStep = inbox.nextStep.find(matches)
    return nextStep === undefined ? undefined : { message: nextStep, queue: 'nextStep' }
  }

  private removePendingSystemNotification(target: MessageAgent, coalesceKey: string): void {
    const pending = this.findPendingSystemNotification(target, coalesceKey)
    if (pending !== undefined && typeof target.inbox?.remove === 'function') {
      target.inbox.remove(pending.message.id)
    }
  }

  private deliverChannelNotice(target: MessageAgent, message: FleetMessage): void {
    const sender = message.fromName === undefined ? message.from : `@${message.fromName}`
    const text = `[Fleet ${message.conversation}] Unread channel activity is waiting. Latest message ${message.id} is from ${sender}. Read with fleet_messages when relevant.`
    this.sendSystemNotification(target.id, {
      kind: 'message_notice',
      text,
      delivery: 'quiet',
      coalesceKey: this.messageNoticeKey(message),
      relatedMessageId: message.id,
    })
  }

  private deliverMeeting(
    meeting: FleetMeeting,
    senderId: string,
    message: FleetMessage,
    wake: boolean,
  ): number {
    let delivered = 0
    for (const participant of meeting.participants) {
      if (participant === senderId) continue
      const agent = this.agents.get(participant)
      if (agent === undefined) continue
      this.deliver(agent, message, wake, false)
      delivered += 1
    }
    return delivered
  }

  private addPendingWakeup(agentId: string, message: FleetMessage): void {
    if (this.acknowledgedByAgent.get(agentId)?.has(message.id) === true) return
    let pending = this.pendingWakeupsByAgent.get(agentId)
    if (pending === undefined) {
      pending = new Map()
      this.pendingWakeupsByAgent.set(agentId, pending)
    }
    pending.set(message.id, message)
  }

  private clearPendingWakeups(agentId: string, conversation: FleetTarget, acknowledge = false): void {
    const pending = this.pendingWakeupsByAgent.get(agentId)
    if (pending === undefined) return
    for (const [id, message] of pending) {
      const same = conversation.startsWith('@') && message.conversation.startsWith('@')
        ? directConversation(agentId, agentTarget(conversation))
          === directConversation(message.from, agentTarget(message.conversation))
        : conversation === message.conversation
      if (!same) continue
      pending.delete(id)
      if (acknowledge) this.markAcknowledged(agentId, id)
    }
    if (pending.size === 0) this.pendingWakeupsByAgent.delete(agentId)
  }

  private rebuildPendingWakeups(): void {
    this.pendingWakeupsByAgent.clear()
    for (const message of this.history) {
      this.clearPendingWakeups(message.from, message.conversation)
      if (message.kind === 'meeting_closed') {
        const meeting = this.meetings.get(meetingId(message.conversation))
        if (meeting !== undefined) {
          for (const participant of meeting.participants) {
            this.clearPendingWakeups(participant, message.conversation)
          }
        }
        continue
      }
      if (message.conversation.startsWith('@')) {
        this.addPendingWakeup(agentTarget(message.conversation), message)
      } else if (message.conversation.startsWith('#')) {
        if (message.delivery !== 'quiet') {
          for (const mention of message.mentions) this.addPendingWakeup(mention, message)
        }
      } else {
        const meeting = this.meetings.get(meetingId(message.conversation))
        if (meeting === undefined) continue
        for (const participant of meeting.participants) {
          if (participant !== message.from) this.addPendingWakeup(participant, message)
        }
      }
    }
  }

  private markAcknowledged(agentId: string, messageId: string): boolean {
    let acknowledged = this.acknowledgedByAgent.get(agentId)
    if (acknowledged === undefined) {
      acknowledged = new Set()
      this.acknowledgedByAgent.set(agentId, acknowledged)
    }
    if (acknowledged.has(messageId)) return false
    acknowledged.add(messageId)
    const pending = this.pendingWakeupsByAgent.get(agentId)
    pending?.delete(messageId)
    if (pending?.size === 0) this.pendingWakeupsByAgent.delete(agentId)
    this.forgetDelivery(agentId, messageId)
    this.emit({ type: 'inbox', action: 'acknowledged', agentId, messageId })
    return true
  }

  private rememberDelivery(agentId: string, contextMessageId: string, messageId: string): void {
    const delivered = this.deliveredContextByAgent.get(agentId) ?? new Map<string, string>()
    delivered.set(contextMessageId, messageId)
    this.deliveredContextByAgent.set(agentId, delivered)
  }

  private forgetDelivery(agentId: string, messageId: string): void {
    const delivered = this.deliveredContextByAgent.get(agentId)
    if (delivered === undefined) return
    const entered = this.enteredContextByAgent.get(agentId)
    for (const [contextMessageId, deliveredMessageId] of delivered) {
      if (deliveredMessageId !== messageId) continue
      delivered.delete(contextMessageId)
      entered?.delete(contextMessageId)
    }
    if (delivered.size === 0) this.deliveredContextByAgent.delete(agentId)
    if (entered?.size === 0) this.enteredContextByAgent.delete(agentId)
  }

  private requireAgent(id: string): MessageAgent {
    const agent = this.agents.get(id)
    if (agent === undefined) throw new Error(`Agent ${id} is not available to Fleet`)
    return agent
  }

  private requireContact(senderId: string, recipientId: string): void {
    if (this.agents.canContact?.(senderId, recipientId) === false) {
      throw new Error(`Agent ${senderId} cannot contact Agent ${recipientId}`)
    }
  }

  private requirePermission(agentId: string, permission: FleetMessagePermission): void {
    if (this.agents.hasPermission?.(agentId, permission) === false) {
      throw new Error(`Agent ${agentId} lacks Fleet permission ${permission}`)
    }
  }

  private resolveAgent(reference: string): string {
    const id = agentTarget(reference)
    return this.agents.resolve?.(id) ?? id
  }

  private requireReadableChannel(agentId: string, id: string): FleetChannel {
    const channel = this.channels.get(id)
    if (channel === undefined) throw new Error(`unknown channel #${id}`)
    if (!this.canRead(channel, agentId)) throw new Error(`Agent ${agentId} cannot access #${id}`)
    return channel
  }

  private requireMeeting(agentId: string, id: string): FleetMeeting {
    const meeting = this.meetings.get(id)
    if (meeting === undefined) throw new Error(`unknown meeting ${id}`)
    if (!meeting.participants.includes(agentId)) {
      throw new Error(`Agent ${agentId} cannot access meeting ${id}`)
    }
    return meeting
  }

  private requireVote(id: string): FleetVote {
    const vote = this.votes.get(id)
    if (vote === undefined) throw new Error(`unknown vote ${id}`)
    return vote
  }

  private requireOnlyPendingVote(agentId: string): FleetVote {
    const pending = [...this.votes.values()].filter(vote =>
      vote.status === 'open'
      && vote.voters.includes(agentId)
      && !vote.approvals.includes(agentId),
    )
    if (pending.length === 0) throw new Error(`Agent ${agentId} has no open Vote awaiting a response`)
    if (pending.length > 1) throw new Error(`Agent ${agentId} has multiple open Votes; pass an id`)
    return pending[0] as FleetVote
  }

  private requireVisibleMessage(agentId: string, id: string): FleetMessage {
    const message = this.history.find(candidate => candidate.id === id)
    if (message === undefined) throw new Error(`unknown Fleet message ${id}`)
    if (!this.canSeeMessage(agentId, message)) throw new Error(`Agent ${agentId} cannot access message ${id}`)
    return message
  }

  private canSeeMessage(agentId: string, message: FleetMessage): boolean {
    if (message.conversation.startsWith('#')) {
      const channel = this.channels.get(channelId(message.conversation))
      return channel !== undefined && this.canRead(channel, agentId)
    }
    if (message.conversation.startsWith('meeting:')) {
      return this.meetings.get(meetingId(message.conversation))?.participants.includes(agentId) === true
    }
    return message.from === agentId || agentTarget(message.conversation) === agentId
  }

  private sameConversation(agentId: string, message: FleetMessage, conversation: FleetTarget): boolean {
    if (conversation.startsWith('@')) {
      if (!message.conversation.startsWith('@')) return false
      return directConversation(agentId, this.resolveAgent(conversation))
        === directConversation(message.from, agentTarget(message.conversation))
    }
    return message.conversation === conversation
  }

  private visibleMessageAgentIds(message: FleetMessage): string[] {
    return this.agents.list().filter(agent => this.canSeeMessage(agent.id, message)).map(agent => agent.id)
  }

  private reactionKey(messageId: string, reaction: string): string {
    return `${messageId}\u0000${reaction}`
  }

  private canRead(channel: FleetChannel, agentId: string): boolean {
    if (channel.createdBy !== agentId && this.agents.canAccessChannel?.(agentId, channel.id) === false) {
      return false
    }
    return channel.open || channel.members.includes(agentId)
  }

  private visibleChannelAgentIds(channel: FleetChannel): string[] {
    return this.agents.list()
      .filter(agent => this.canRead(channel, agent.id))
      .map(agent => agent.id)
  }

  private agentRevision(agentId: string): number {
    return this.agentRevisions.get(agentId) ?? 0
  }

  private changed(agentIds: readonly string[]): void {
    this.revision += 1
    const result = { timedOut: false, revision: this.revision, reason: 'changed' as const }
    const visible = new Set(agentIds)
    for (const agentId of visible) this.agentRevisions.set(agentId, this.revision)
    for (const waiter of [...this.waiters]) {
      if (visible.has(waiter.agentId)) waiter.finish(result)
    }
  }

  private emit(event: FleetCoordinationEvent): void {
    const value = snapshot(event)
    for (const observer of this.observers) observer(value)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Fleet Message service is stopped')
  }
}
