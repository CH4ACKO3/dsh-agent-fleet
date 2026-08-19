import { randomUUID } from 'node:crypto'

import { createUserMessage } from '@deepseek-ai/dsh-llm'

import type {
  AgentDirectory,
  CreateChannelInput,
  FleetChannel,
  FleetMessage,
  FleetMessageKind,
  FleetMeeting,
  FleetTarget,
  MessageAgent,
  OpenMeetingInput,
  ReadMessagesInput,
  ReadMessagesResult,
  SendMessageInput,
  SendMessageResult,
  WaitResult,
} from './types.js'

const CHANNEL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_MESSAGE_LENGTH = 65_536

interface Waiter {
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
  private readonly history: FleetMessage[] = []
  private readonly waiters = new Set<Waiter>()
  private sequence = 0
  private revision = 0
  private closed = false

  constructor(private readonly agents: AgentDirectory) {
    this.channels.set('general', {
      id: 'general',
      name: 'general',
      topic: 'Fleet-wide coordination',
      open: true,
      members: [],
      createdBy: 'fleet',
      createdAt: new Date().toISOString(),
      archived: false,
    })
  }

  send(sender: MessageAgent, input: SendMessageInput): SendMessageResult {
    this.assertOpen()
    const text = input.text.trim()
    if (text.length === 0) throw new Error('message text cannot be empty')
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`message text cannot exceed ${MAX_MESSAGE_LENGTH} characters`)
    }

    const resources = uniqueStrings(input.resources ?? [], 'resource id')
    const mentions = uniqueStrings(input.mentions ?? [], 'mention').map(agentTarget)
    if (input.to.startsWith('meeting:')) {
      if (mentions.length > 0) throw new Error('meeting messages do not accept mentions')
      return this.sendMeeting(sender, input, text, resources)
    }
    if (input.to.startsWith('@')) {
      if (mentions.length > 0) throw new Error('direct messages do not accept mentions')
      return this.sendDirect(sender, input, text, resources)
    }
    if (!input.to.startsWith('#')) throw new Error(`invalid Fleet target ${input.to}`)
    return this.sendChannel(sender, input, text, resources, mentions)
  }

  read(sender: MessageAgent, input: ReadMessagesInput): ReadMessagesResult {
    this.assertOpen()
    const limit = input.limit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer from 1 through 100')
    }

    let messages: FleetMessage[]
    if (input.conversation.startsWith('#')) {
      const channel = this.requireReadableChannel(sender.id, channelId(input.conversation))
      messages = this.history.filter(message => message.conversation === `#${channel.id}`)
    } else if (input.conversation.startsWith('@')) {
      const peer = agentTarget(input.conversation)
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
    }
  }

  listChannels(sender: MessageAgent): FleetChannel[] {
    this.assertOpen()
    return snapshot([...this.channels.values()].filter(channel => this.canRead(channel, sender.id)))
  }

  createChannel(sender: MessageAgent, input: CreateChannelInput): FleetChannel {
    this.assertOpen()
    const name = input.name.trim()
    if (!CHANNEL_NAME.test(name)) {
      throw new Error('channel name must use lower-kebab-case')
    }
    if (this.channels.has(name)) throw new Error(`channel ${name} already exists`)

    const members = input.members === undefined
      ? []
      : uniqueStrings(input.members, 'channel member').map(agentTarget)
    if (input.members !== undefined && !members.includes(sender.id)) members.unshift(sender.id)
    for (const member of members) this.requireAgent(member)

    const channel: FleetChannel = {
      id: name,
      name,
      topic: input.topic?.trim() ?? '',
      open: input.members === undefined,
      members,
      createdBy: sender.id,
      createdAt: new Date().toISOString(),
      archived: false,
    }
    this.channels.set(channel.id, channel)
    this.changed()
    return snapshot(channel)
  }

  archiveChannel(sender: MessageAgent, name: string): FleetChannel {
    this.assertOpen()
    if (name === 'general') throw new Error('the general channel cannot be archived')
    const channel = this.channels.get(name)
    if (channel === undefined) throw new Error(`unknown channel ${name}`)
    if (!this.canRead(channel, sender.id)) throw new Error(`Agent ${sender.id} cannot access #${name}`)
    if (channel.archived) return snapshot(channel)

    const archived = { ...channel, archived: true }
    this.channels.set(name, archived)
    this.changed()
    return snapshot(archived)
  }

  listMeetings(sender: MessageAgent): FleetMeeting[] {
    this.assertOpen()
    return snapshot([...this.meetings.values()].filter(meeting =>
      meeting.participants.includes(sender.id),
    ))
  }

  openMeeting(sender: MessageAgent, input: OpenMeetingInput): FleetMeeting {
    this.assertOpen()
    const id = input.id.trim()
    if (!CHANNEL_NAME.test(id)) throw new Error('meeting id must use lower-kebab-case')
    if (this.meetings.has(id)) throw new Error(`meeting ${id} already exists`)

    const title = input.title.trim()
    if (title.length === 0) throw new Error('meeting title cannot be empty')
    const agenda = input.agenda.trim()
    if (agenda.length === 0) throw new Error('meeting agenda cannot be empty')
    const invited = uniqueStrings(input.participants, 'meeting participant').map(agentTarget)
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
    const message = this.appendMessage(sender.id, {
      to: `meeting:${id}`,
      text: agenda,
      delivery: 'wakeup',
    }, agenda, [], [], 'meeting_opened')
    this.deliverMeeting(meeting, sender.id, message, true)
    return snapshot(meeting)
  }

  closeMeeting(sender: MessageAgent, id: string): FleetMeeting {
    this.assertOpen()
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
    const text = 'The meeting has ended.'
    const message = this.appendMessage(sender.id, {
      to: `meeting:${id}`,
      text,
      delivery: 'wakeup',
    }, text, [], [], 'meeting_closed')
    this.deliverMeeting(closed, sender.id, message, true)
    return snapshot(closed)
  }

  wait(timeoutMs: number, signal?: AbortSignal): Promise<WaitResult> {
    this.assertOpen()
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('timeout must be a positive integer')
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
        finish: result => { settle(() => { resolve(result) }) },
        fail: error => { settle(() => { reject(error) }) },
      }
      const onAbort = (): void => {
        waiter.fail(signal?.reason ?? new Error('fleet_wait aborted'))
      }
      const timer = setTimeout(() => {
        waiter.finish({ timedOut: true, revision: this.revision })
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
    this.deliverMeeting(meeting, sender.id, message, wake)
    return {
      messageId: message.id,
      recipients: meeting.participants.length - 1,
      woken: wake ? meeting.participants.length - 1 : 0,
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
    const message: FleetMessage = {
      id: `msg_${randomUUID()}`,
      sequence: ++this.sequence,
      kind,
      conversation: input.to,
      from: sender,
      text,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      resources,
      mentions,
      delivery: input.delivery,
      createdAt: new Date().toISOString(),
    }
    this.history.push(message)
    this.changed()
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
    const text = notice
      ? `[Fleet ${message.conversation}] New message ${message.id} from ${message.from}. Call fleet_messages to read it.`
      : `[Fleet ${message.conversation} | ${message.id} | from=${message.from}] ${message.text}${resourceText}`
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
  ): void {
    for (const participant of meeting.participants) {
      if (participant !== senderId) this.deliver(this.requireAgent(participant), message, wake, false)
    }
  }

  private requireAgent(id: string): MessageAgent {
    const agent = this.agents.get(id)
    if (agent === undefined) throw new Error(`Agent ${id} is not running in this process`)
    return agent
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

  private canRead(channel: FleetChannel, agentId: string): boolean {
    return channel.open || channel.members.includes(agentId)
  }

  private changed(): void {
    this.revision += 1
    const result = { timedOut: false, revision: this.revision }
    for (const waiter of [...this.waiters]) waiter.finish(result)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Fleet Message service is stopped')
  }
}
