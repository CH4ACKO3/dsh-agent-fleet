import { randomUUID } from 'node:crypto'

import { createUserMessage } from '@deepseek-ai/dsh-llm'

import type {
  AgentDirectory,
  CastVoteInput,
  CreateChannelInput,
  CreateVoteInput,
  FleetCoordinationEvent,
  FleetChannel,
  FleetMessage,
  FleetMessageKind,
  FleetMeeting,
  FleetTarget,
  FleetVote,
  InitializeChannelInput,
  MessageAgent,
  OpenMeetingInput,
  ReadMessagesInput,
  ReadMessagesResult,
  SendMessageInput,
  SendMessageResult,
  UpdateChannelInput,
  WaitResult,
} from './types.js'

const CHANNEL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_MESSAGE_LENGTH = 65_536

interface Waiter {
  readonly agentId: string
  finish(result: WaitResult): void
  fail(error: unknown): void
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

export class MessageHub {
  private readonly channels = new Map<string, FleetChannel>()
  private readonly meetings = new Map<string, FleetMeeting>()
  private readonly votes = new Map<string, FleetVote>()
  private readonly history: FleetMessage[] = []
  private readonly observers = new Set<(event: FleetCoordinationEvent) => void>()
  private readonly waiters = new Set<Waiter>()
  private readonly agentRevisions = new Map<string, number>()
  private sequence = 0
  private revision = 0
  private closed = false

  constructor(private readonly agents: AgentDirectory) {
    this.addGeneralChannel()
  }

  reset(): void {
    this.assertOpen()
    for (const waiter of [...this.waiters]) waiter.fail(new Error('Fleet Message state reset for a new run'))
    this.channels.clear()
    this.meetings.clear()
    this.votes.clear()
    this.history.length = 0
    this.agentRevisions.clear()
    this.sequence = 0
    this.revision = 0
    this.addGeneralChannel()
  }

  restore(events: readonly FleetCoordinationEvent[]): void {
    this.reset()
    for (const event of events) {
      if (event.type === 'message') {
        this.history.push(snapshot(event.message))
        this.sequence = Math.max(this.sequence, event.message.sequence)
      } else if (event.type === 'channel') {
        this.channels.set(event.channel.id, snapshot(event.channel))
      } else if (event.type === 'meeting') {
        this.meetings.set(event.meeting.id, snapshot(event.meeting))
      } else {
        this.votes.set(event.vote.id, snapshot(event.vote))
      }
    }
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
      if (mentions.length > 0) throw new Error('direct messages do not accept mentions')
      return this.sendDirect(sender, { ...input, to: `@${this.resolveAgent(input.to)}` }, text, resources)
    }
    if (!input.to.startsWith('#')) throw new Error(`invalid Fleet target ${input.to}`)
    return this.sendChannel(sender, input, text, resources, mentions)
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
    return {
      messages: snapshot(page),
      hasMore: start + page.length < messages.length,
      revision: this.agentRevision(sender.id),
    }
  }

  listChannels(sender: MessageAgent): FleetChannel[] {
    this.assertOpen()
    this.requireAgent(sender.id)
    return snapshot([...this.channels.values()].filter(channel => this.canRead(channel, sender.id)))
  }

  createChannel(sender: MessageAgent, input: CreateChannelInput): FleetChannel {
    this.assertOpen()
    this.requireAgent(sender.id)
    const name = input.name.trim()
    if (!CHANNEL_NAME.test(name)) {
      throw new Error('channel name must use lower-kebab-case')
    }
    if (this.channels.has(name)) throw new Error(`channel ${name} already exists`)

    const members = input.members === undefined
      ? []
      : uniqueStrings(input.members, 'channel member').map(target => this.resolveAgent(target))
    if (input.members !== undefined && !members.includes(sender.id)) members.unshift(sender.id)
    for (const member of members) this.requireAgent(member)

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
    const channel = this.requireReadableChannel(sender.id, name)
    if (channel.archived) throw new Error(`channel #${name} is archived`)
    if (input.summary === undefined && input.body === undefined) {
      throw new Error('Channel update requires summary or body')
    }
    const updated: FleetChannel = {
      ...channel,
      ...(input.summary === undefined ? {} : { summary: input.summary.trim() }),
      ...(input.body === undefined ? {} : { body: input.body.trim() }),
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
    for (const participant of participants) this.requireAgent(participant)

    const meeting: FleetMeeting = {
      id,
      title,
      agenda,
      initiator: sender.id,
      participants,
      status: 'open',
      createdAt: new Date().toISOString(),
    }
    this.meetings.set(id, meeting)
    this.emit({ type: 'meeting', action: 'opened', meeting })
    const message = this.appendMessage(sender.id, {
      to: `meeting:${id}`,
      text: agenda,
      delivery: 'wakeup',
    }, agenda, [], [], 'meeting_opened')
    this.deliverMeeting(meeting, sender.id, message, true)
    this.changed(meeting.participants)
    return snapshot(meeting)
  }

  closeMeeting(sender: MessageAgent, id: string): FleetMeeting {
    this.assertOpen()
    this.requireAgent(sender.id)
    const meeting = this.requireMeeting(sender.id, id)
    if (meeting.initiator !== sender.id) {
      throw new Error(`only meeting initiator ${meeting.initiator} can close meeting ${id}`)
    }
    if (meeting.status === 'closed') return snapshot(meeting)

    const closed: FleetMeeting = {
      ...meeting,
      status: 'closed',
      closedAt: new Date().toISOString(),
    }
    this.meetings.set(id, closed)
    this.emit({ type: 'meeting', action: 'closed', meeting: closed })
    const text = 'The meeting has ended.'
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
    const channel = this.requireReadableChannel(sender.id, channelId(input.channel))
    if (channel.archived) throw new Error(`channel #${channel.id} is archived`)
    const statement = input.statement.trim()
    if (statement.length === 0) throw new Error('vote statement cannot be empty')
    const voters = this.agents.list()
      .filter(agent => agent.id !== sender.id && this.canRead(channel, agent.id))
      .map(agent => agent.id)
    const vote: FleetVote = {
      id: `vote_${randomUUID()}`,
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
    for (const voter of voters) this.deliver(this.requireAgent(voter), message, true, false)
    if (vote.status === 'approved') this.emit({ type: 'vote', action: 'closed', vote })
    this.changed([sender.id, ...voters])
    return snapshot(vote)
  }

  castVote(sender: MessageAgent, input: CastVoteInput): FleetVote {
    this.assertOpen()
    this.requireAgent(sender.id)
    const current = this.requireVote(input.id)
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
      if (initiator !== undefined) this.deliver(initiator, message, true, false)
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
        return Promise.resolve({ timedOut: false, revision })
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
        waiter.finish({ timedOut: true, revision: this.agentRevision(sender.id) })
      }, timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.add(waiter)
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of [...this.waiters]) waiter.fail(new Error('Fleet Message service stopped'))
  }

  private sendDirect(
    sender: MessageAgent,
    input: SendMessageInput,
    text: string,
    resources: string[],
  ): SendMessageResult {
    const targetId = agentTarget(input.to)
    if (targetId === sender.id) throw new Error('an Agent cannot message itself')
    const target = this.requireAgent(targetId)
    const message = this.appendMessage(sender.id, input, text, resources, [])
    this.deliver(target, message, input.delivery === 'wakeup', false)
    this.changed([sender.id, target.id])
    return { messageId: message.id, recipients: 1, woken: input.delivery === 'wakeup' ? 1 : 0 }
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
    if (input.delivery === 'wakeup' && mentions.length === 0) {
      throw new Error('a Channel follow-up requires at least one explicit mention')
    }
    for (const mention of mentions) {
      if (mention === sender.id) throw new Error('a Channel follow-up cannot mention its sender')
      this.requireAgent(mention)
      if (!this.canRead(channel, mention)) {
        throw new Error(`Agent ${mention} cannot access #${channel.id}`)
      }
    }

    const recipients = this.agents.list().filter(agent =>
      agent.id !== sender.id && this.canRead(channel, agent.id),
    )
    const message = this.appendMessage(sender.id, input, text, resources, mentions)
    const mentioned = new Set(mentions)
    for (const recipient of recipients) {
      const wake = input.delivery === 'wakeup' && mentioned.has(recipient.id)
      this.deliver(recipient, message, wake, !wake)
    }
    this.changed([sender.id, ...recipients.map(recipient => recipient.id)])
    return {
      messageId: message.id,
      recipients: recipients.length,
      woken: input.delivery === 'wakeup'
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
    const message = this.appendMessage(sender.id, input, text, resources, [])
    const wake = input.delivery === 'wakeup'
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
    const message: FleetMessage = {
      id: `msg_${randomUUID()}`,
      sequence: ++this.sequence,
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
    this.history.push(message)
    this.emit({ type: 'message', message })
    return message
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
    const sender = message.fromName === undefined ? message.from : `@${message.fromName}`
    const text = notice
      ? `[Fleet ${message.conversation}] New message ${message.id} from ${sender}. Call fleet_messages to read it.`
      : `[Fleet ${message.conversation} | ${message.id} | from=${sender}] ${message.text}${resourceText}`
    const input = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'relay' },
    })
    if (wake) target.followup(input)
    else target.inject(input)
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

  private requireAgent(id: string): MessageAgent {
    const agent = this.agents.get(id)
    if (agent === undefined) throw new Error(`Agent ${id} is not available to Fleet`)
    return agent
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

  private canRead(channel: FleetChannel, agentId: string): boolean {
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
    const result = { timedOut: false, revision: this.revision }
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
