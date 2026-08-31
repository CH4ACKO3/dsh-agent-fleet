import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'

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
  FleetPendingDelivery,
  FleetMessageKind,
  FleetMessagePin,
  FleetMessageReceipt,
  FleetMessageReaction,
  FleetMeeting,
  FleetMessagePermission,
  FleetTarget,
  FleetUnreadInbox,
  FleetSystemNotificationInput,
  FleetSystemNotificationResult,
  FleetVote,
  InitializeChannelInput,
  MessageAgent,
  OpenMeetingInput,
  ReadMessagesInput,
  ReadMessagesResult,
  SearchMessagesInput,
  SendMessageDecision,
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

interface DeliveryAttempt {
  readonly participantId: string
  readonly sessionId: string
  readonly messageId: string
  readonly content: 'full' | 'notice'
  state: 'pending' | 'claimed' | 'superseded'
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

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function replyInstruction(message: FleetMessage): string {
  return `Use fleet_reply with the Reply Task for message ${message.id}. Ordinary model output does not deliver the reply or complete its receipt.`
}

export interface MessageHubOptions {
  readonly validateTaskReference?: (taskId: string, assigneeId?: string) => void
  readonly beforeSend?: (sender: MessageAgent, input: SendMessageInput) => SendMessageDecision
  readonly requiredActionInstruction?: (message: FleetMessage, participantId: string) => string
}

export class MessageHub {
  private readonly channels = new Map<string, FleetChannel>()
  private readonly meetings = new Map<string, FleetMeeting>()
  private readonly votes = new Map<string, FleetVote>()
  private readonly reactions = new Map<string, FleetMessageReaction>()
  private readonly pins = new Map<string, FleetMessagePin>()
  private readonly readThroughByParticipant = new Map<string, Map<string, number>>()
  private readonly deliveredParticipantsByMessage = new Map<string, Set<string>>()
  private readonly pendingDeliveriesByMessage = new Map<string, Map<string, FleetPendingDelivery>>()
  private readonly contextDeliveries = new Map<string, DeliveryAttempt>()
  private readonly history: FleetMessage[] = []
  private readonly pendingWakeupsByAgent = new Map<string, Map<string, FleetMessage>>()
  private readonly requiredRepliesByParticipant = new Map<string, Map<string, FleetMessage>>()
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
    this.readThroughByParticipant.clear()
    this.deliveredParticipantsByMessage.clear()
    this.pendingDeliveriesByMessage.clear()
    this.contextDeliveries.clear()
    this.history.length = 0
    this.pendingWakeupsByAgent.clear()
    this.requiredRepliesByParticipant.clear()
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
        this.rememberMessage(this.normalizeMessage(snapshot(event.message)))
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
          const participantId = this.resolveAgent(event.agentId)
          this.rememberDelivery(
            participantId,
            event.messageId,
            event.contextMessageId,
            event.sessionId ?? event.agentId,
            event.content ?? this.inferDeliveryContent(participantId, event.messageId),
          )
        } else if (event.action === 'superseded') {
          const attempt = this.contextDeliveries.get(event.contextMessageId)
          if (attempt !== undefined) attempt.state = 'superseded'
        } else if (event.action === 'blocked') {
          this.rememberDeliveryBlock({
            participantId: this.resolveAgent(event.agentId),
            reason: event.reason,
            ...(event.detail === undefined ? {} : { detail: event.detail }),
            blockedAt: event.blockedAt,
          }, event.messageId)
        } else if (event.action === 'read') {
          this.rememberReadThrough(this.resolveAgent(event.agentId), event.messageId, event.through)
        }
        else if (event.action === 'acknowledged') {
          this.rememberReadThrough(this.resolveAgent(event.agentId), event.messageId, Number.MAX_SAFE_INTEGER)
        }
      }
    }
    this.restoreUnreadTextMentions()
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

  private restoreUnreadTextMentions(): void {
    for (let index = 0; index < this.history.length; index += 1) {
      const message = this.history[index]
      if (message === undefined || message.kind !== 'text' || message.conversation.startsWith('meeting:')) continue
      const parsed = this.textMentions(message.text).filter(participantId =>
        participantId !== message.from
        && !message.mentions.includes(participantId)
        && this.canSeeMessage(participantId, message)
        && !this.isFullyRead(participantId, message),
      )
      if (parsed.length === 0) continue
      const restored = { ...message, mentions: [...new Set([...message.mentions, ...parsed])] }
      this.history[index] = restored
      const conversationId = restored.conversationId ?? restored.conversation
      for (const participantId of parsed) {
        const required = this.requiredRepliesByParticipant.get(participantId) ?? new Map<string, FleetMessage>()
        required.set(conversationId, restored)
        this.requiredRepliesByParticipant.set(participantId, required)
      }
    }
  }

  onEvent(observer: (event: FleetCoordinationEvent) => void): () => void {
    this.assertOpen()
    this.observers.add(observer)
    return () => { this.observers.delete(observer) }
  }

  connectAgent(agentId: string, channelIds: readonly string[] = []): void {
    this.assertOpen()
    agentId = this.resolveAgent(agentId)
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
    agentId = this.resolveAgent(agentId)
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
        }, text, [], [updated.initiator], [updated.initiator], 'vote_closed')
        this.addPendingWakeup(updated.initiator, message)
        this.deliverOrBlock(updated.initiator, message, 'full', true)
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

  retireAgent(agentId: string, successorId: string): void {
    this.assertOpen()
    agentId = this.resolveAgent(agentId)
    successorId = this.resolveAgent(successorId)
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
        }, closed.summary ?? 'The meeting has ended.', [], [], [...closed.participants], 'meeting_closed')
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
        }, text, [], [updated.initiator], [updated.initiator], 'vote_closed')
        this.addPendingWakeup(updated.initiator, message)
        this.deliverOrBlock(updated.initiator, message, 'full', true)
      }
    }

    this.pendingWakeupsByAgent.delete(agentId)
    this.requiredRepliesByParticipant.delete(agentId)
    for (const [contextMessageId, delivered] of this.contextDeliveries) {
      if (delivered.participantId === agentId) this.contextDeliveries.delete(contextMessageId)
    }
    for (const message of this.history) {
      if (message.recipientIds?.includes(agentId) === true
        && !this.deliveredParticipantsByMessage.get(message.id)?.has(agentId)) {
        this.recordDeliveryBlock(agentId, message.id, 'participant_retired')
      }
    }
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
    for (const member of members) this.requireKnownParticipant(member)
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
      }, input.initialMessage.trim(), [], [], [])
    }
    this.changed(this.visibleChannelAgentIds(channel))
    return snapshot(channel)
  }

  send(sender: MessageAgent, input: SendMessageInput): SendMessageResult {
    return this.sendWithOrigin(sender, input)
  }

  /** Send host-attested human input while keeping Fleet as the durable message record. */
  sendHuman(sender: MessageAgent, input: SendMessageInput): SendMessageResult {
    return this.sendWithOrigin(sender, input, 'user')
  }

  private sendWithOrigin(
    sender: MessageAgent,
    input: SendMessageInput,
    origin?: FleetMessage['origin'],
  ): SendMessageResult {
    this.assertOpen()
    sender = this.requireParticipant(sender)
    const target = input.to
    const decision = this.options.beforeSend?.(sender, snapshot(input)) ?? { kind: 'send', input }
    if (decision.kind === 'reject') throw new Error(decision.reason.trim() || 'Fleet message was rejected')
    if (decision.input.to !== target) throw new Error('Fleet message hooks cannot change the sender or target')
    input = decision.input
    const text = input.text.trim()
    if (text.length === 0) throw new Error('message text cannot be empty')
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`message text cannot exceed ${MAX_MESSAGE_LENGTH} characters`)
    }

    const resources = uniqueStrings(input.resources ?? [], 'resource id')
    const explicitMentions = uniqueStrings(input.mentions ?? [], 'mention')
      .map(target => this.resolveAgent(target))
    const mentions = [...new Set([
      ...explicitMentions,
      ...this.textMentions(text).filter(target => target !== sender.id),
    ])]
    if (input.to.startsWith('meeting:')) {
      if (mentions.length > 0) throw new Error('meeting messages do not accept mentions')
      return this.sendMeeting(sender, input, text, resources, origin)
    }
    if (input.to.startsWith('@')) {
      const recipient = this.resolveAgent(input.to)
      if (mentions.some(mention => mention !== recipient)) {
        throw new Error('a direct message can only mention its recipient')
      }
      return this.sendDirect(sender, { ...input, to: `@${recipient}` }, text, resources, mentions, origin)
    }
    if (!input.to.startsWith('#')) throw new Error(`invalid Fleet target ${input.to}`)
    return this.sendChannel(sender, input, text, resources, mentions, origin)
  }

  pendingWakeups(agentId: string): FleetMessage[] {
    agentId = this.resolveAgent(agentId)
    return snapshot([...(this.pendingWakeupsByAgent.get(agentId)?.values() ?? [])])
  }

  pendingUnread(reference: string): FleetMessage | undefined {
    this.assertOpen()
    const participantId = this.resolveAgent(reference)
    const message = this.history.findLast(candidate => candidate.from !== participantId
      && this.canSeeMessage(participantId, candidate)
      && this.isInboxRelevant(participantId, candidate)
      && !this.isFullyRead(participantId, candidate))
    return message === undefined ? undefined : snapshot(message)
  }

  pendingUnreadInbox(reference: string): FleetUnreadInbox | undefined {
    this.assertOpen()
    const participantId = this.resolveAgent(reference)
    const latest = this.history.findLast(message => message.from !== participantId
      && this.canSeeMessage(participantId, message)
      && this.isInboxRelevant(participantId, message)
      && !this.isFullyRead(participantId, message))
    if (latest === undefined) return undefined
    const conversation = this.inboxConversation(participantId, latest)
    const unread = this.history.filter(message => message.from !== participantId
      && this.canSeeMessage(participantId, message)
      && this.isInboxRelevant(participantId, message)
      && this.sameConversation(participantId, message, conversation)
      && !this.isFullyRead(participantId, message))
    return {
      conversation,
      latestMessageId: latest.id,
      unreadMessages: unread.length,
      unreadChars: unread.reduce((total, message) =>
        total + message.text.length - this.readThrough(participantId, message.id), 0),
    }
  }

  unreadSummary(reference: string): { readonly unreadMessages: number; readonly unreadChars: number } {
    this.assertOpen()
    const participantId = this.resolveAgent(reference)
    const unread = this.history.filter(message => message.from !== participantId
      && this.canSeeMessage(participantId, message)
      && this.isInboxRelevant(participantId, message)
      && !this.isFullyRead(participantId, message))
    return {
      unreadMessages: unread.length,
      unreadChars: unread.reduce((total, message) =>
        total + message.text.length - this.readThrough(participantId, message.id), 0),
    }
  }

  /** Consume the newest unread messages across every visible conversation in one bounded batch. */
  readInbox(sender: MessageAgent, maxChars = 12_000): ReadMessagesResult {
    this.assertOpen()
    sender = this.requireParticipant(sender)
    if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 12_000) {
      throw new Error('maxChars must be an integer from 1 through 12000')
    }
    const unread = this.history.filter(message => message.from !== sender.id
      && this.canSeeMessage(sender.id, message)
      && this.isInboxRelevant(sender.id, message)
      && !this.isFullyRead(sender.id, message))
    const selected: FleetMessage[] = []
    let selectedChars = 0
    for (let index = unread.length - 1; index >= 0; index -= 1) {
      const message = unread[index]
      if (message === undefined) continue
      const unreadChars = message.text.length - this.readThrough(sender.id, message.id)
      if (selected.length > 0 && selectedChars + unreadChars > maxChars) break
      selected.unshift(message)
      selectedChars += Math.min(unreadChars, maxChars)
      if (selectedChars >= maxChars) break
    }
    const page: ReadMessagesResult['messages'][number][] = []
    let remaining = maxChars
    let changed = false
    for (const message of selected) {
      if (remaining === 0) break
      const total = message.text.length
      const current = this.readThrough(sender.id, message.id)
      const start = current > 0 && current < total ? current : 0
      const end = Math.min(total, start + remaining)
      const text = message.text.slice(start, end)
      page.push({ ...message, text, readRange: { start, end, total } })
      remaining -= text.length
      if (end > current) changed = this.markReadThrough(sender.id, message, end) || changed
      if (end < total) break
    }
    if (changed) this.changed([sender.id])
    const summary = this.unreadSummary(sender.id)
    return {
      messages: snapshot(page),
      hasMore: summary.unreadMessages > 0,
      remainingUnread: summary.unreadMessages,
      remainingUnreadChars: summary.unreadChars,
      revision: this.agentRevision(sender.id),
    }
  }

  sendSystemNotification(
    agentId: string,
    notification: FleetSystemNotificationInput,
  ): FleetSystemNotificationResult {
    this.assertOpen()
    agentId = this.resolveAgent(agentId)
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
    if (pending !== undefined && (notification.delivery === 'quiet'
      || (notification.delivery === 'wakeup' && pending.queue === 'nextTurn'))) {
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

  followupUnread(target: MessageAgent): FleetUnreadInbox | undefined {
    const participantId = this.resolveAgent(target.id)
    const inbox = this.pendingUnreadInbox(participantId)
    if (inbox === undefined) return undefined
    const messageLabel = inbox.unreadMessages === 1 ? 'message' : 'messages'
    this.sendSystemNotification(target.id, {
      kind: 'message_notice',
      text: `[Fleet inbox ${inbox.conversation}] ${String(inbox.unreadMessages)} unread ${messageLabel} (${String(inbox.unreadChars)} text characters) are waiting. Call fleet_inbox with action="read" to consume unread messages from all visible sources in one bounded batch. hasMore=true and remainingUnread > 0 mean unread information is still waiting. Continue before going idle when either is reported. This notification and ordinary model output do not mark the inbox as read.`,
      delivery: 'wakeup',
      coalesceKey: this.messageNoticeKey(this.requireVisibleMessage(participantId, inbox.latestMessageId)),
      relatedMessageId: inbox.latestMessageId,
    })
    return inbox
  }

  pendingRequiredReply(reference: string): FleetMessage | undefined {
    this.assertOpen()
    const participantId = this.resolveAgent(reference)
    const message = [...(this.requiredRepliesByParticipant.get(participantId)?.values() ?? [])]
      .sort((left, right) => right.sequence - left.sequence)[0]
    return message === undefined ? undefined : snapshot(message)
  }

  pendingRequiredReplies(reference: string): FleetMessage[] {
    this.assertOpen()
    const participantId = this.resolveAgent(reference)
    return [...(this.requiredRepliesByParticipant.get(participantId)?.values() ?? [])]
      .sort((left, right) => left.sequence - right.sequence)
      .map(snapshot)
  }

  completeRequiredReply(reference: string, messageId: string): FleetMessage | undefined {
    this.assertOpen()
    const participantId = this.resolveAgent(reference)
    const required = this.requiredRepliesByParticipant.get(participantId)
    if (required === undefined) return undefined
    const match = [...required.entries()].find(([, message]) => message.id === messageId)
    if (match === undefined) return undefined
    const [conversationId, message] = match
    required.delete(conversationId)
    if (required.size === 0) this.requiredRepliesByParticipant.delete(participantId)
    const target = this.agents.get(participantId)
    if (target !== undefined) this.removePendingSystemNotification(target, this.requiredReplyNoticeKey(message))
    this.changed([participantId])
    return snapshot(message)
  }

  followupRequiredReply(target: MessageAgent): FleetMessage | undefined {
    const message = this.pendingRequiredReply(target.id)
    if (message === undefined) return undefined
    const sender = `@${message.fromName ?? message.from}`
    this.sendSystemNotification(target.id, {
      kind: 'message_notice',
      text: `[Fleet ${message.conversation}] Message ${message.id} from ${sender} requires an action before going idle. ${this.requiredActionInstruction(message, target.id)}`,
      delivery: 'wakeup',
      coalesceKey: this.requiredReplyNoticeKey(message),
      relatedMessageId: message.id,
    })
    return message
  }

  read(sender: MessageAgent, input: ReadMessagesInput): ReadMessagesResult {
    this.assertOpen()
    sender = this.requireParticipant(sender)
    const unreadOnly = input.unreadOnly !== false
    const requestedLimit = input.limit ?? 10
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_HISTORY_MESSAGES) {
      throw new Error(`limit must be an integer from 1 through ${String(MAX_HISTORY_MESSAGES)}`)
    }
    // An unread inbox is one character-bounded unit. Older agents often retain
    // `limit: 5` in context from the former paged API; honoring that would turn
    // one inbox wake into several model steps even when the whole inbox is tiny.
    const limit = unreadOnly ? MAX_HISTORY_MESSAGES : requestedLimit
    const maxChars = input.maxChars ?? 12_000
    if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 12_000) {
      throw new Error('maxChars must be an integer from 1 through 12000')
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

    let candidates: FleetMessage[]
    if (input.after !== undefined) {
      const index = messages.findIndex(message => message.id === input.after)
      if (index < 0) throw new Error(`message ${input.after} is not in this conversation`)
      candidates = messages.slice(index + 1)
    } else if (input.unreadOnly === false) {
      candidates = messages.slice(-limit)
    } else {
      candidates = messages
    }
    if (unreadOnly) {
      candidates = candidates.filter(message => message.from !== sender.id && !this.isFullyRead(sender.id, message))
    }
    if (unreadOnly) {
      const selected: FleetMessage[] = []
      let selectedChars = 0
      for (let index = candidates.length - 1; index >= 0 && selected.length < limit; index -= 1) {
        const message = candidates[index]
        if (message === undefined) continue
        const unreadChars = message.text.length - this.readThrough(sender.id, message.id)
        if (selected.length > 0 && selectedChars + unreadChars > maxChars) break
        selected.unshift(message)
        selectedChars += Math.min(unreadChars, maxChars)
        if (selectedChars >= maxChars) break
      }
      candidates = selected
    }
    const page: ReadMessagesResult['messages'][number][] = []
    let remaining = maxChars
    let inspected = 0
    let partial = false
    let changed = false
    for (const message of candidates) {
      if (page.length >= limit || remaining === 0) break
      inspected += 1
      const total = message.text.length
      const current = message.from === sender.id ? 0 : this.readThrough(sender.id, message.id)
      const start = current > 0 && current < total ? current : 0
      const end = Math.min(total, start + remaining)
      const text = message.text.slice(start, end)
      page.push({ ...message, text, readRange: { start, end, total } })
      remaining -= text.length
      if (message.from !== sender.id && end > current) {
        changed = this.markReadThrough(sender.id, message, end) || changed
      }
      if (end < total) {
        partial = true
        break
      }
    }
    if (changed) this.changed([sender.id])
    const remainingUnreadMessages = messages.filter(message => message.from !== sender.id
      && !this.isFullyRead(sender.id, message))
    const remainingUnreadChars = remainingUnreadMessages.reduce((total, message) =>
      total + message.text.length - this.readThrough(sender.id, message.id), 0)
    const hasMore = unreadOnly
      ? remainingUnreadMessages.length > 0
      : partial || inspected < candidates.length
    return {
      messages: snapshot(page),
      hasMore,
      remainingUnread: remainingUnreadMessages.length,
      remainingUnreadChars,
      revision: this.agentRevision(sender.id),
    }
  }

  readMessageText(sender: MessageAgent, messageId: string, offset?: number, limit = 12_000): import('./types.js').FleetMessageTextChunk {
    this.assertOpen()
    sender = this.requireParticipant(sender)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12_000) {
      throw new Error('limit must be an integer from 1 through 12000')
    }
    const message = this.requireVisibleMessage(sender.id, messageId)
    const current = message.from === sender.id ? 0 : this.readThrough(sender.id, message.id)
    const start = offset ?? (current > 0 && current < message.text.length ? current : 0)
    if (!Number.isSafeInteger(start) || start < 0) throw new Error('offset must be a non-negative integer')
    if (start > message.text.length) throw new Error(`offset ${String(start)} is beyond message ${messageId}`)
    if (message.from !== sender.id && current < message.text.length && start > current) {
      throw new Error(`offset ${String(start)} skips unread text; next unread offset is ${String(current)}`)
    }
    const text = message.text.slice(start, start + limit)
    const nextOffset = start + text.length
    const hasMore = nextOffset < message.text.length
    const changed = message.from !== sender.id && nextOffset > current
      ? this.markReadThrough(sender.id, message, nextOffset)
      : false
    if (changed) this.changed([sender.id])
    return {
      messageId,
      offset: start,
      text,
      totalLength: message.text.length,
      hasMore,
      ...(hasMore ? { nextOffset } : {}),
      readThrough: Math.min(message.text.length, Math.max(current, nextOffset)),
    }
  }

  /** Mark a delivered Fleet message read when its native context item is consumed. */
  markDeliveredContextRead(participantId: string, contextMessageId: string): boolean {
    this.assertOpen()
    participantId = this.resolveAgent(participantId)
    const delivered = this.contextDeliveries.get(contextMessageId)
    if (delivered?.participantId !== participantId || delivered.state !== 'pending') return false
    delivered.state = 'claimed'
    if (delivered.content !== 'full') return false
    const message = this.history.find(candidate => candidate.id === delivered.messageId)
    if (message === undefined) return false
    const changed = this.markReadThrough(participantId, message, message.text.length)
    return changed
  }

  /** Recreate pending native deliveries after a stable participant binds to another Session. */
  refreshAgent(reference: string): number {
    this.assertOpen()
    const participantId = this.resolveAgent(reference)
    const target = this.requireAgent(participantId)
    const sessionId = target.sessionId ?? target.id
    const stale = [...this.contextDeliveries.entries()].filter(([, attempt]) =>
      attempt.participantId === participantId
      && attempt.sessionId !== sessionId
      && attempt.state === 'pending'
      && this.history.some(message => message.id === attempt.messageId && !this.isFullyRead(participantId, message)),
    )
    const redeliver = new Map<string, 'full' | 'notice'>()
    for (const [contextMessageId, attempt] of stale) {
      attempt.state = 'superseded'
      if (attempt.content === 'full' || redeliver.get(attempt.messageId) === undefined) {
        redeliver.set(attempt.messageId, attempt.content)
      }
      this.emit({
        type: 'inbox',
        action: 'superseded',
        agentId: participantId,
        sessionId: attempt.sessionId,
        messageId: attempt.messageId,
        contextMessageId,
        content: attempt.content,
      })
    }
    for (const [messageId, content] of redeliver) {
      const message = this.history.find(candidate => candidate.id === messageId)
      if (message === undefined) continue
      this.deliverOrBlock(participantId, message, content, content === 'full' && message.delivery !== 'quiet')
    }
    const pending = this.history.filter(message =>
      message.recipientIds?.includes(participantId) === true
      && !this.deliveredParticipantsByMessage.get(message.id)?.has(participantId),
    )
    let delivered = 0
    for (const message of pending) {
      const content = this.inferDeliveryContent(participantId, message.id)
      if (this.deliverOrBlock(
        participantId,
        message,
        content,
        content === 'full' && message.delivery !== 'quiet',
      )) delivered += 1
    }
    if (redeliver.size > 0 || pending.length > 0) this.changed([participantId])
    return redeliver.size + delivered
  }

  receipt(messageId: string): FleetMessageReceipt {
    this.assertOpen()
    const message = this.history.find(candidate => candidate.id === messageId)
    if (message === undefined) throw new Error(`unknown Fleet message ${messageId}`)
    const recordedDelivered = [...(this.deliveredParticipantsByMessage.get(messageId) ?? [])]
    const recipientIds = message.recipientIds === undefined
      ? recordedDelivered
      : [...message.recipientIds]
    const recipients = new Set(recipientIds)
    const deliveredParticipantIds = recordedDelivered.filter(participantId => recipients.has(participantId))
    const delivered = new Set(deliveredParticipantIds)
    const readThrough = Object.fromEntries(recipientIds.map(participantId => [
      participantId,
      this.readThrough(participantId, messageId),
    ]))
    const readParticipantIds = deliveredParticipantIds.filter(
      participantId => readThrough[participantId]! >= message.text.length,
    )
    const read = new Set(readParticipantIds)
    const pendingParticipantIds = recipientIds.filter(participantId => !delivered.has(participantId))
    const pending = this.pendingDeliveriesByMessage.get(messageId)
    return snapshot({
      messageId,
      inbox: message.conversation,
      recipientIds,
      deliveredParticipantIds,
      pendingParticipantIds,
      pendingDeliveries: pendingParticipantIds.flatMap(participantId => {
        const delivery = pending?.get(participantId)
        return delivery === undefined ? [] : [delivery]
      }),
      participantIds: deliveredParticipantIds,
      readParticipantIds,
      unreadParticipantIds: deliveredParticipantIds.filter(participantId => !read.has(participantId)),
      readThrough,
    })
  }

  getMessage(sender: MessageAgent, messageId: string): FleetMessage {
    this.assertOpen()
    sender = this.requireParticipant(sender)
    return snapshot(this.requireVisibleMessage(sender.id, messageId))
  }

  search(sender: MessageAgent, input: SearchMessagesInput = {}): FleetMessage[] {
    this.assertOpen()
    sender = this.requireParticipant(sender)
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
    sender = this.requireParticipant(sender)
    const limit = input.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer from 1 through 100')
    }
    const items = this.history.flatMap((message): FleetInboxItem[] => {
      if (message.from === sender.id || !this.canSeeMessage(sender.id, message)) return []
      const reasons: FleetInboxItem['reasons'] = []
      if (message.conversation.startsWith('@') && agentTarget(message.conversation) === sender.id) reasons.push('direct')
      if (message.mentions.includes(sender.id)) reasons.push('mention')
      if (message.conversation.startsWith('meeting:')) reasons.push('meeting')
      if (reasons.length === 0) return []
      const isAcknowledged = this.isFullyRead(sender.id, message)
      if (input.unreadOnly === true && isAcknowledged) return []
      return [{ message: snapshot(message), reasons, acknowledged: isAcknowledged }]
    })
    return items.slice(-limit)
  }

  react(sender: MessageAgent, input: { readonly messageId: string; readonly reaction: string; readonly remove?: boolean }): FleetMessageReaction {
    this.assertOpen()
    sender = this.requireParticipant(sender)
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
    sender = this.requireParticipant(sender)
    this.requireVisibleMessage(sender.id, messageId)
    return snapshot([...this.reactions.values()].filter(reaction => reaction.messageId === messageId))
  }

  pin(sender: MessageAgent, messageId: string, remove = false): FleetMessagePin {
    this.assertOpen()
    sender = this.requireParticipant(sender)
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
    sender = this.requireParticipant(sender)
    return snapshot([...this.pins.values()].filter(pin => {
      const message = this.history.find(candidate => candidate.id === pin.messageId)
      return message !== undefined
        && this.canSeeMessage(sender.id, message)
        && (conversation === undefined || this.sameConversation(sender.id, message, conversation))
    }))
  }

  listChannels(sender: MessageAgent): FleetChannel[] {
    this.assertOpen()
    sender = this.requireParticipant(sender)
    return snapshot([...this.channels.values()].filter(channel => this.canRead(channel, sender.id)))
  }

  createChannel(sender: MessageAgent, input: CreateChannelInput): FleetChannel {
    this.assertOpen()
    sender = this.requireParticipant(sender)
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
      this.requireKnownParticipant(member)
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
    sender = this.requireParticipant(sender)
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
      this.requireKnownParticipant(id)
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
    sender = this.requireParticipant(sender)
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
    sender = this.requireParticipant(sender)
    return snapshot([...this.meetings.values()].filter(meeting =>
      meeting.participants.includes(sender.id),
    ))
  }

  openMeeting(sender: MessageAgent, input: OpenMeetingInput): FleetMeeting {
    this.assertOpen()
    sender = this.requireParticipant(sender)
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
      this.requireKnownParticipant(participant)
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
    }, agenda, [], [], participants.filter(participant => participant !== sender.id), 'meeting_opened')
    for (const participant of participants) {
      if (participant !== sender.id) this.addPendingWakeup(participant, message)
    }
    this.deliverMeeting(meeting, sender.id, message, true)
    this.changed(meeting.participants)
    return snapshot(meeting)
  }

  joinMeeting(sender: MessageAgent, id: string): FleetMeeting {
    this.assertOpen()
    sender = this.requireParticipant(sender)
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
    sender = this.requireParticipant(sender)
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
    sender = this.requireParticipant(sender)
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
      if (assignee !== undefined) this.requireKnownParticipant(assignee)
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
    }, text, [], [], closed.participants.filter(participant => participant !== sender.id), 'meeting_closed')
    this.deliverMeeting(closed, sender.id, message, true)
    this.changed(closed.participants)
    return snapshot(closed)
  }

  listVotes(sender: MessageAgent, channel?: string): FleetVote[] {
    this.assertOpen()
    sender = this.requireParticipant(sender)
    if (channel !== undefined) this.requireReadableChannel(sender.id, channelId(channel))
    return snapshot([...this.votes.values()].filter(vote => {
      if (channel !== undefined && vote.channel !== channel) return false
      const target = this.channels.get(channelId(vote.channel))
      return target !== undefined && this.canRead(target, sender.id)
    }))
  }

  getVote(sender: MessageAgent, id: string): FleetVote {
    this.assertOpen()
    sender = this.requireParticipant(sender)
    const vote = this.requireVote(id)
    this.requireReadableChannel(sender.id, channelId(vote.channel))
    return snapshot(vote)
  }

  createVote(sender: MessageAgent, input: CreateVoteInput): FleetVote {
    this.assertOpen()
    sender = this.requireParticipant(sender)
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
      this.requireKnownParticipant(voter)
      if (!(this.agents.canVote?.(voter) ?? true)) throw new Error(`Agent ${voter} is not eligible to vote`)
      if (input.voters !== undefined) this.requireContact(sender.id, voter)
      if (!this.canRead(channel, voter)) throw new Error(`Agent ${voter} cannot access #${channel.id}`)
    }
    const requestedId = input.id?.trim()
    if (input.id !== undefined && requestedId?.length === 0) throw new Error('vote id cannot be empty')
    const existing = requestedId === undefined ? undefined : this.votes.get(requestedId)
    if (existing !== undefined) {
      const sameVoters = input.voters === undefined
        || (existing.voters.length === voters.length && existing.voters.every(voter => voters.includes(voter)))
      if (existing.initiator !== sender.id
        || existing.channel !== `#${channel.id}`
        || existing.kind !== input.kind
        || existing.statement !== statement
        || !sameVoters) {
        throw new Error(`vote id ${requestedId} already exists with different input`)
      }
      return snapshot(existing)
    }
    this.clearPendingWakeups(sender.id, input.channel)
    const vote: FleetVote = {
      id: requestedId ?? `vote_${String(++this.voteSequence)}`,
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
    }, `Vote ${vote.id} opened (${vote.kind}): ${statement}`, [], voters, voters, 'vote_opened')
    for (const voter of voters) {
      this.addPendingWakeup(voter, message)
      this.deliverOrBlock(voter, message, 'full', true)
    }
    if (vote.status === 'approved') this.emit({ type: 'vote', action: 'closed', vote })
    this.changed([sender.id, ...voters])
    return snapshot(vote)
  }

  castVote(sender: MessageAgent, input: CastVoteInput): FleetVote {
    this.assertOpen()
    sender = this.requireParticipant(sender)
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
    this.clearPendingWakeups(sender.id, vote.channel)
    this.emit({ type: 'vote', action: 'cast', vote })
    this.appendMessage(sender.id, {
      to: vote.channel,
      text: input.response === 'approve'
        ? `Approved vote ${vote.id}.`
        : `Rejected vote ${vote.id}: ${reason ?? ''}`,
      delivery: 'quiet',
    }, input.response === 'approve'
      ? `Approved vote ${vote.id}.`
      : `Rejected vote ${vote.id}: ${reason ?? ''}`, [], [], [], 'vote_cast')

    if (vote.status !== 'open') {
      this.emit({ type: 'vote', action: 'closed', vote })
      const text = `Vote ${vote.id} ${vote.status}: ${vote.statement}`
      const message = this.appendMessage('fleet', {
        to: vote.channel,
        text,
        delivery: 'wakeup',
      }, text, [], [vote.initiator], [vote.initiator], 'vote_closed')
      this.addPendingWakeup(vote.initiator, message)
      this.deliverOrBlock(vote.initiator, message, 'full', true)
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
    sender = this.requireParticipant(sender)
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
    if (signal?.aborted === true) return Promise.reject(signal.reason ?? new Error('MessageHub wait aborted'))

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
        waiter.fail(signal?.reason ?? new Error('MessageHub wait aborted'))
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
    mentions: string[],
    origin?: FleetMessage['origin'],
  ): SendMessageResult {
    const targetId = agentTarget(input.to)
    if (targetId === sender.id) throw new Error('an Agent cannot message itself')
    this.requireContact(sender.id, targetId)
    this.requireKnownParticipant(targetId)
    this.clearPendingWakeups(sender.id, input.to)
    // The @ in a direct target is routing syntax, not a mention. Only trusted
    // user input or an explicitly parsed mention creates a Reply Task.
    const message = this.appendMessage(
      sender.id,
      input,
      text,
      resources,
      mentions,
      [targetId],
      input.kind ?? 'text',
      origin,
    )
    this.acknowledgeInputsByReply(sender.id, input.to)
    this.removePendingSystemNotification(sender, this.requiredReplyNoticeKey(message))
    const wake = input.delivery !== 'quiet'
    if (wake) this.addPendingWakeup(targetId, message)
    const delivered = this.deliverOrBlock(targetId, message, 'full', wake) ? 1 : 0
    this.changed([sender.id, targetId])
    return { messageId: message.id, recipients: 1, delivered, woken: wake ? delivered : 0 }
  }

  private sendChannel(
    sender: MessageAgent,
    input: SendMessageInput,
    text: string,
    resources: string[],
    mentions: string[],
    origin?: FleetMessage['origin'],
  ): SendMessageResult {
    const channel = this.requireReadableChannel(sender.id, channelId(input.to))
    if (channel.archived) throw new Error(`channel #${channel.id} is archived`)
    if (input.delivery !== 'quiet' && mentions.length === 0) {
      throw new Error('a Channel follow-up requires at least one explicit mention')
    }
    for (const mention of mentions) {
      if (mention === sender.id) throw new Error('a Channel follow-up cannot mention its sender')
      this.requireKnownParticipant(mention)
      this.requireContact(sender.id, mention)
      if (!this.canRead(channel, mention)) {
        throw new Error(`Agent ${mention} cannot access #${channel.id}`)
      }
    }

    this.clearPendingWakeups(sender.id, input.to)
    const recipientIds = this.visibleChannelParticipantIds(channel).filter(participantId => participantId !== sender.id)
    const message = this.appendMessage(sender.id, input, text, resources, mentions, recipientIds, input.kind ?? 'text', origin)
    this.acknowledgeInputsByReply(sender.id, input.to)
    this.removePendingSystemNotification(sender, this.requiredReplyNoticeKey(message))
    const mentioned = new Set(mentions)
    let delivered = 0
    let woken = 0
    for (const participantId of recipientIds) {
      const wake = input.delivery !== 'quiet' && mentioned.has(participantId)
      if (wake) this.addPendingWakeup(participantId, message)
      if (this.deliverOrBlock(participantId, message, wake ? 'full' : 'notice', wake)) {
        delivered += 1
        if (wake) woken += 1
      }
    }
    this.changed([sender.id, ...recipientIds])
    return {
      messageId: message.id,
      recipients: recipientIds.length,
      delivered,
      woken,
    }
  }

  private sendMeeting(
    sender: MessageAgent,
    input: SendMessageInput,
    text: string,
    resources: string[],
    origin?: FleetMessage['origin'],
  ): SendMessageResult {
    const meeting = this.requireMeeting(sender.id, meetingId(input.to))
    if (meeting.status === 'closed') throw new Error(`meeting ${meeting.id} is closed`)
    this.clearPendingWakeups(sender.id, input.to)
    const recipientIds = meeting.participants.filter(participant => participant !== sender.id)
    const message = this.appendMessage(sender.id, input, text, resources, [], recipientIds, input.kind ?? 'text', origin)
    const wake = input.delivery !== 'quiet'
    for (const participant of recipientIds) if (wake) this.addPendingWakeup(participant, message)
    const delivered = this.deliverMeeting(meeting, sender.id, message, wake)
    this.changed(meeting.participants)
    return {
      messageId: message.id,
      recipients: recipientIds.length,
      delivered,
      woken: wake ? delivered : 0,
    }
  }

  private appendMessage(
    sender: string,
    input: SendMessageInput,
    text: string,
    resources: string[],
    mentions: string[],
    recipientIds: string[],
    kind: FleetMessageKind = 'text',
    origin?: FleetMessage['origin'],
  ): FleetMessage {
    this.requireReply(sender, input.to, input.replyTo)
    const fromName = this.agents.displayName?.(sender)
    const sequence = ++this.sequence
    const message: FleetMessage = {
      id: `msg_${String(sequence)}`,
      sequence,
      kind,
      conversation: input.to,
      conversationId: this.conversationId(sender, input.to),
      from: sender,
      ...(fromName === undefined ? {} : { fromName }),
      ...(origin === undefined ? {} : { origin }),
      recipientIds: [...new Set(recipientIds)],
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
    const conversationId = message.conversationId ?? message.conversation
    if (message.kind === 'text' && !message.conversation.startsWith('meeting:')) {
      const requiredParticipants = message.origin === 'user' && message.conversation.startsWith('@')
        ? message.recipientIds ?? []
        : message.mentions
      for (const participantId of requiredParticipants) {
        const required = this.requiredRepliesByParticipant.get(participantId) ?? new Map<string, FleetMessage>()
        required.set(conversationId, message)
        this.requiredRepliesByParticipant.set(participantId, required)
      }
    }
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
    for (const [agentId, readThrough] of this.readThroughByParticipant) {
      readThrough.delete(messageId)
      if (readThrough.size === 0) this.readThroughByParticipant.delete(agentId)
    }
    for (const [agentId, pending] of this.pendingWakeupsByAgent) {
      pending.delete(messageId)
      if (pending.size === 0) this.pendingWakeupsByAgent.delete(agentId)
    }
    this.deliveredParticipantsByMessage.delete(messageId)
    this.pendingDeliveriesByMessage.delete(messageId)
    for (const [contextMessageId, delivered] of this.contextDeliveries) {
      if (delivered.messageId === messageId) this.contextDeliveries.delete(contextMessageId)
    }
  }

  private pruneMessageMetadata(): void {
    const retained = new Set(this.history.map(message => message.id))
    for (const messageId of this.pins.keys()) {
      if (!retained.has(messageId)) this.pins.delete(messageId)
    }
    for (const [key, reaction] of this.reactions) {
      if (!retained.has(reaction.messageId)) this.reactions.delete(key)
    }
    for (const [agentId, readThrough] of this.readThroughByParticipant) {
      for (const messageId of readThrough.keys()) {
        if (!retained.has(messageId)) readThrough.delete(messageId)
      }
      if (readThrough.size === 0) this.readThroughByParticipant.delete(agentId)
    }
    for (const messageId of this.deliveredParticipantsByMessage.keys()) {
      if (!retained.has(messageId)) this.deliveredParticipantsByMessage.delete(messageId)
    }
    for (const messageId of this.pendingDeliveriesByMessage.keys()) {
      if (!retained.has(messageId)) this.pendingDeliveriesByMessage.delete(messageId)
    }
    for (const [contextMessageId, delivered] of this.contextDeliveries) {
      if (!retained.has(delivered.messageId)) this.contextDeliveries.delete(contextMessageId)
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

  private deliver(target: MessageAgent, message: FleetMessage, wake: boolean): void {
    const resourceText = message.resources.length === 0
      ? ''
      : `\nResources: ${message.resources.join(', ')}`
    const sender = `@${message.fromName ?? message.from}`
    const replyRequired = this.requiresReply(message, target.id)
    const replyMarker = replyRequired ? ' | reply-task' : ''
    const requiredInstruction = replyRequired ? `\n${this.requiredActionInstruction(message, target.id)}` : ''
    const directInstruction = message.conversation.startsWith('@')
      ? '\nThis direct message is complete in context; do not call fleet_inbox merely to read it again.'
      : ''
    const text = `[Fleet ${message.conversation} | ${message.id} | from=${sender}${replyMarker}] ${message.text}${resourceText}${requiredInstruction}${directInstruction}`
    const input = createUserMessage({
      content: [{ type: 'text', text }],
      source: message.origin === 'user'
        ? { kind: 'user' }
        : { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'relay' },
    })
    this.dispatchContext(target, input, wake ? message.delivery : 'quiet')
    const sessionId = target.sessionId ?? target.id
    this.rememberDelivery(target.id, message.id, String(input.id), sessionId, 'full')
    const stillPending = target.inbox === undefined
      ? undefined
      : [...target.inbox.nextStep, ...target.inbox.nextTurn].some(candidate => candidate.id === input.id)
    // An idle Agent may synchronously claim a wakeup inside followup()/steer(),
    // before rememberDelivery has installed the context-to-message mapping.
    // Reconcile that narrow race after dispatch; queued input remains unread
    // until the ordinary agent/inbox/claimed event consumes it.
    if (stillPending === false) this.markDeliveredContextRead(target.id, String(input.id))
    this.emit({
      type: 'inbox',
      action: 'delivered',
      agentId: target.id,
      sessionId,
      messageId: message.id,
      contextMessageId: input.id,
      content: 'full',
    })
  }

  private deliverOrBlock(
    participantId: string,
    message: FleetMessage,
    content: 'full' | 'notice',
    wake: boolean,
  ): boolean {
    const target = this.agents.get(participantId)
    if (target === undefined) {
      this.recordDeliveryBlock(participantId, message.id, 'no_active_session')
      return false
    }
    try {
      if (content === 'full') this.deliver(target, message, wake)
      else this.deliverChannelNotice(target, message)
      return true
    } catch (error) {
      this.recordDeliveryBlock(
        participantId,
        message.id,
        'inbox_delivery_failed',
        error instanceof Error ? error.message : String(error),
      )
      return false
    }
  }

  private recordDeliveryBlock(
    participantId: string,
    messageId: string,
    reason: FleetPendingDelivery['reason'],
    detail?: string,
  ): void {
    if (this.deliveredParticipantsByMessage.get(messageId)?.has(participantId)) return
    const delivery: FleetPendingDelivery = {
      participantId,
      reason,
      ...(detail === undefined ? {} : { detail }),
      blockedAt: new Date().toISOString(),
    }
    this.rememberDeliveryBlock(delivery, messageId)
    this.emit({
      type: 'inbox',
      action: 'blocked',
      agentId: participantId,
      messageId,
      reason,
      ...(detail === undefined ? {} : { detail }),
      blockedAt: delivery.blockedAt,
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
      const sessionId = target.sessionId ?? target.id
      this.rememberDelivery(target.id, notification.relatedMessageId, String(input.id), sessionId, 'notice')
      this.emit({
        type: 'inbox',
        action: 'delivered',
        agentId: target.id,
        sessionId,
        messageId: notification.relatedMessageId,
        contextMessageId: input.id,
        content: 'notice',
      })
    }
    return { contextMessageId: String(input.id), disposition }
  }

  private messageNoticeKey(message: FleetMessage): string {
    return `unread:${message.conversationId ?? message.conversation}`
  }

  private requiredReplyNoticeKey(message: FleetMessage): string {
    return `required-reply:${message.conversationId ?? message.conversation}`
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
    const replyInstruction = this.requiresReply(message, target.id) ? ` ${this.requiredActionInstruction(message, target.id)}` : ''
    const text = `[Fleet ${message.conversation}] Unread channel activity is waiting. Latest message ${message.id} is from ${sender}. Read with fleet_inbox when relevant.${replyInstruction}`
    this.sendSystemNotification(target.id, {
      kind: 'message_notice',
      text,
      delivery: 'quiet',
      coalesceKey: this.messageNoticeKey(message),
      relatedMessageId: message.id,
    })
  }

  private requiresReply(message: FleetMessage, participantId: string): boolean {
    if (message.kind !== 'text') return false
    if (message.origin === 'user' && message.conversation.startsWith('@')) {
      return message.recipientIds?.includes(participantId) ?? false
    }
    return message.mentions.includes(participantId)
  }

  private requiredActionInstruction(message: FleetMessage, participantId: string): string {
    return this.options.requiredActionInstruction?.(snapshot(message), participantId) ?? replyInstruction(message)
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
      if (this.deliverOrBlock(participant, message, 'full', wake)) delivered += 1
    }
    return delivered
  }

  private addPendingWakeup(agentId: string, message: FleetMessage): void {
    if (this.isFullyRead(agentId, message)) return
    let pending = this.pendingWakeupsByAgent.get(agentId)
    if (pending === undefined) {
      pending = new Map()
      this.pendingWakeupsByAgent.set(agentId, pending)
    }
    pending.set(message.id, message)
  }

  private clearPendingWakeups(agentId: string, conversation: FleetTarget): void {
    const pending = this.pendingWakeupsByAgent.get(agentId)
    if (pending === undefined) return
    for (const [id, message] of pending) {
      const same = conversation.startsWith('@') && message.conversation.startsWith('@')
        ? directConversation(agentId, agentTarget(conversation))
          === directConversation(message.from, agentTarget(message.conversation))
        : conversation === message.conversation
      if (!same) continue
      pending.delete(id)
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
        if (message.delivery !== 'quiet') this.addPendingWakeup(agentTarget(message.conversation), message)
      } else if (message.conversation.startsWith('#')) {
        if (message.delivery !== 'quiet') {
          for (const mention of message.mentions) this.addPendingWakeup(mention, message)
        }
      } else {
        const meeting = this.meetings.get(meetingId(message.conversation))
        if (meeting === undefined) continue
        if (message.delivery !== 'quiet') {
          for (const participant of meeting.participants) {
            if (participant !== message.from) this.addPendingWakeup(participant, message)
          }
        }
      }
    }
  }

  private readThrough(agentId: string, messageId: string): number {
    return this.readThroughByParticipant.get(agentId)?.get(messageId) ?? 0
  }

  private isFullyRead(agentId: string, message: FleetMessage): boolean {
    return this.readThrough(agentId, message.id) >= message.text.length
  }

  private rememberReadThrough(agentId: string, messageId: string, through: number): boolean {
    if (!Number.isSafeInteger(through) || through < 0) {
      throw new Error(`invalid read offset ${String(through)} for message ${messageId}`)
    }
    const messages = this.readThroughByParticipant.get(agentId) ?? new Map<string, number>()
    const current = messages.get(messageId) ?? 0
    if (through <= current) return false
    messages.set(messageId, through)
    this.readThroughByParticipant.set(agentId, messages)
    const message = this.history.find(candidate => candidate.id === messageId)
    if (message?.recipientIds === undefined || message.recipientIds.includes(agentId)) {
      const delivered = this.deliveredParticipantsByMessage.get(messageId) ?? new Set<string>()
      delivered.add(agentId)
      this.deliveredParticipantsByMessage.set(messageId, delivered)
      this.clearDeliveryBlock(agentId, messageId)
    }
    return true
  }

  private rememberDeliveryBlock(delivery: FleetPendingDelivery, messageId: string): void {
    if (this.deliveredParticipantsByMessage.get(messageId)?.has(delivery.participantId)) return
    const pending = this.pendingDeliveriesByMessage.get(messageId) ?? new Map<string, FleetPendingDelivery>()
    pending.set(delivery.participantId, delivery)
    this.pendingDeliveriesByMessage.set(messageId, pending)
  }

  private clearDeliveryBlock(participantId: string, messageId: string): void {
    const pending = this.pendingDeliveriesByMessage.get(messageId)
    pending?.delete(participantId)
    if (pending?.size === 0) this.pendingDeliveriesByMessage.delete(messageId)
  }

  private rememberDelivery(
    participantId: string,
    messageId: string,
    contextMessageId: string,
    sessionId: string,
    content: 'full' | 'notice',
  ): void {
    const participants = this.deliveredParticipantsByMessage.get(messageId) ?? new Set<string>()
    participants.add(participantId)
    this.deliveredParticipantsByMessage.set(messageId, participants)
    this.clearDeliveryBlock(participantId, messageId)
    this.contextDeliveries.set(contextMessageId, {
      participantId,
      sessionId,
      messageId,
      content,
      state: 'pending',
    })
  }

  private markReadThrough(agentId: string, message: FleetMessage, through: number): boolean {
    if (!this.rememberReadThrough(agentId, message.id, through)) return false
    if (through >= message.text.length) {
      const pending = this.pendingWakeupsByAgent.get(agentId)
      pending?.delete(message.id)
      if (pending?.size === 0) this.pendingWakeupsByAgent.delete(agentId)
      const target = this.agents.get(agentId)
      if (target !== undefined) {
        if (!this.hasUnreadConversation(agentId, message)) {
          this.removePendingSystemNotification(target, this.messageNoticeKey(message))
        }
      }
    }
    this.emit({ type: 'inbox', action: 'read', agentId, messageId: message.id, through })
    return true
  }

  private acknowledgeInputsByReply(agentId: string, conversation: FleetTarget): void {
    for (const message of this.history) {
      if (message.from === agentId
        || this.isFullyRead(agentId, message)
        || !this.sameConversation(agentId, message, conversation)) continue
      const addressed = conversation.startsWith('@')
        || message.mentions.includes(agentId)
      if (addressed) this.markReadThrough(agentId, message, message.text.length)
    }
  }

  private hasUnreadConversation(agentId: string, source: FleetMessage): boolean {
    const conversation = this.inboxConversation(agentId, source)
    return this.history.some(message => this.sameConversation(agentId, message, conversation)
      && message.from !== agentId
      && !this.isFullyRead(agentId, message))
  }

  private inboxConversation(agentId: string, message: FleetMessage): FleetTarget {
    if (!message.conversation.startsWith('@')) return message.conversation
    const peer = message.from === agentId ? agentTarget(message.conversation) : message.from
    return `@${peer}`
  }

  private requireAgent(id: string): MessageAgent {
    const agent = this.agents.get(id)
    if (agent === undefined) throw new Error(`Agent ${id} is not available to Fleet`)
    return agent
  }

  private requireKnownParticipant(id: string): void {
    if (this.agents.get(id) === undefined && !this.agents.participantIds().includes(id)) {
      throw new Error(`unknown Fleet participant ${id}`)
    }
  }

  private requireParticipant(agent: MessageAgent): MessageAgent {
    return this.requireAgent(this.resolveAgent(agent.id))
  }

  private requireContact(senderId: string, recipientId: string): void {
    if (this.agents.canContact?.(senderId, recipientId) === false) {
      throw new Error(`Agent ${senderId} cannot contact Agent ${recipientId}`)
    }
  }

  private conversationId(senderId: string, conversation: FleetTarget): string {
    if (!conversation.startsWith('@')) return conversation
    const recipientId = agentTarget(conversation)
    if (senderId.startsWith('fleet-user:')) return `@${recipientId}`
    if (recipientId.startsWith('fleet-user:')) return `@${senderId}`
    const key = (participantId: string): string =>
      this.agents.conversationKey?.(participantId) ?? participantId
    return `dm:${[key(senderId), key(recipientId)].sort().join(':')}`
  }

  private normalizeMessage(message: FleetMessage): FleetMessage {
    const from = this.resolveAgent(message.from)
    const conversation = message.conversation.startsWith('@')
      ? `@${this.resolveAgent(message.conversation)}` as FleetTarget
      : message.conversation
    const mentions = [...new Set(message.mentions.map(mention => this.resolveAgent(mention)))]
    return {
      ...message,
      from,
      conversation,
      conversationId: this.conversationId(from, conversation),
      mentions,
      ...(message.recipientIds === undefined ? {} : {
        recipientIds: [...new Set(message.recipientIds.map(recipient => this.resolveAgent(recipient)))],
      }),
    }
  }

  private inferDeliveryContent(participantId: string, messageId: string): 'full' | 'notice' {
    const message = this.history.find(candidate => candidate.id === messageId)
    if (message === undefined || !message.conversation.startsWith('#')) return 'full'
    return message.delivery !== 'quiet' && message.mentions.includes(participantId) ? 'full' : 'notice'
  }

  private isInboxRelevant(participantId: string, message: FleetMessage): boolean {
    if (!message.conversation.startsWith('#') || message.mentions.length === 0) return true
    return message.mentions.includes(participantId)
  }

  private requirePermission(agentId: string, permission: FleetMessagePermission): void {
    if (this.agents.hasPermission?.(agentId, permission) === false) {
      throw new Error(`Agent ${agentId} lacks Fleet permission ${permission}`)
    }
  }

  private resolveAgent(reference: string): string {
    const id = reference.startsWith('@') ? agentTarget(reference) : reference
    return this.agents.resolve?.(id) ?? id
  }

  private textMentions(text: string): string[] {
    const references = new Map<string, string>()
    for (const participantId of this.agents.participantIds()) {
      for (const reference of [participantId, this.agents.displayName?.(participantId)]) {
        const normalized = reference?.trim().toLocaleLowerCase()
        if (normalized !== undefined && normalized !== '' && !references.has(normalized)) {
          references.set(normalized, participantId)
        }
      }
    }
    if (references.size === 0) return []
    const alternatives = [...references.keys()]
      .sort((left, right) => right.length - left.length)
      .map(escapeRegularExpression)
    const matcher = new RegExp(`@(?:${alternatives.join('|')})(?=$|[\\s,.;:!?，。；：！？、）)\\]】}])`, 'giu')
    return [...text.matchAll(matcher)].flatMap(match => {
      const previous = match.index === 0 ? '' : text[match.index - 1] ?? ''
      if (/[A-Za-z0-9._%+-]/u.test(previous)) return []
      const participantId = references.get(match[0].slice(1).toLocaleLowerCase())
      return participantId === undefined ? [] : [participantId]
    })
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

  private visibleChannelParticipantIds(channel: FleetChannel): string[] {
    return this.agents.participantIds().filter(participantId => this.canRead(channel, participantId))
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
