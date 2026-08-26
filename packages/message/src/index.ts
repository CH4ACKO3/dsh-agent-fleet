import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

import { MessageHub } from './hub.js'
import type { FleetMessage, FleetReadMessage, FleetTarget, FleetVote, MessageAgent } from './types.js'

export * from './hub.js'
export * from './types.js'

export const name = 'dsh-agent-fleet-message'
export const inject = ['agents', 'tools']

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetMessages: MessageHub
  }
}

const MESSAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    sequence: { type: 'integer', required: true },
    kind: {
      type: 'string',
      required: true,
      enum: ['text', 'meeting_opened', 'meeting_closed', 'vote_opened', 'vote_cast', 'vote_closed', 'task_notification', 'calendar_notification'],
    },
    conversation: { type: 'string', required: true },
    conversationId: { type: 'string' },
    from: { type: 'string', required: true },
    fromName: { type: 'string' },
    text: { type: 'string', required: true },
    replyTo: { type: 'string' },
    mustReply: { type: 'boolean' },
    resources: { type: 'array', required: true, items: { type: 'string' } },
    mentions: { type: 'array', required: true, items: { type: 'string' } },
    delivery: { type: 'string', required: true, enum: ['quiet', 'wakeup', 'interrupt'] },
    createdAt: { type: 'string', required: true },
    readRange: {
      type: 'object',
      additionalProperties: false,
      properties: {
        start: { type: 'integer', required: true },
        end: { type: 'integer', required: true },
        total: { type: 'integer', required: true },
      },
    },
  },
} as const

const CHANNEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    topic: { type: 'string', required: true },
    summary: { type: 'string', required: true },
    body: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    open: { type: 'boolean', required: true },
    members: { type: 'array', required: true, items: { type: 'string' } },
    createdBy: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
    archived: { type: 'boolean', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

const SEND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    recipients: { type: 'integer', required: true },
    delivered: { type: 'integer', required: true },
    woken: { type: 'integer', required: true },
  },
} as const

const MEETING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    agenda: { type: 'string', required: true },
    initiator: { type: 'string', required: true },
    participants: { type: 'array', required: true, items: { type: 'string' } },
    attendance: { type: 'object', required: true, additionalProperties: true },
    status: { type: 'string', required: true, enum: ['open', 'closed'] },
    summary: { type: 'string' },
    decisions: { type: 'array', required: true, items: { type: 'string' } },
    actionItems: { type: 'array', required: true, items: {
      type: 'object', additionalProperties: false, properties: {
        text: { type: 'string', required: true }, assignee: { type: 'string' }, taskId: { type: 'string' },
      },
    } },
    resources: { type: 'array', required: true, items: { type: 'string' } },
    createdAt: { type: 'string', required: true },
    closedAt: { type: 'string' },
  },
} as const

const REACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    reaction: { type: 'string', required: true },
    members: { type: 'array', required: true, items: { type: 'string' } },
    updatedAt: { type: 'string', required: true },
  },
} as const

const PIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    conversation: { type: 'string', required: true },
    pinnedBy: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
  },
} as const

const INBOX_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    message: { ...MESSAGE_SCHEMA, required: true },
    reasons: { type: 'array', required: true, items: { type: 'string', enum: ['direct', 'mention', 'meeting'] } },
    acknowledged: { type: 'boolean', required: true },
  },
} as const

const MESSAGE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['search', 'inbox', 'react', 'reactions', 'pin', 'unpin', 'pins', 'text'] },
    messages: { type: 'array', items: MESSAGE_SCHEMA },
    inbox: { type: 'array', items: INBOX_ITEM_SCHEMA },
    reaction: REACTION_SCHEMA,
    reactions: { type: 'array', items: REACTION_SCHEMA },
    pin: PIN_SCHEMA,
    pins: { type: 'array', items: PIN_SCHEMA },
    hasMore: { type: 'boolean' },
    revision: { type: 'integer' },
    chunk: {
      type: 'object',
      additionalProperties: false,
      properties: {
        messageId: { type: 'string', required: true },
        offset: { type: 'integer', required: true },
        text: { type: 'string', required: true },
        totalLength: { type: 'integer', required: true },
        hasMore: { type: 'boolean', required: true },
        nextOffset: { type: 'integer' },
        readThrough: { type: 'integer', required: true },
      },
    },
  },
} as const

const MESSAGE_PREVIEW_CHARS = 2_000
const MESSAGE_PAGE_TEXT_CHARS = 12_000

function messageOutput(): {
  schema: typeof MESSAGE_RESULT_SCHEMA
  render: (args: unknown, value: InferValue<typeof MESSAGE_RESULT_SCHEMA>) => [{ type: 'text'; text: string }]
} {
  const compactMessages = (messages: readonly FleetMessage[]): Record<string, unknown>[] => {
    let remaining = MESSAGE_PAGE_TEXT_CHARS
    const previews = new Map<string, { readonly text: string; readonly shown: number }>()
    for (const message of [...messages].reverse()) {
      const shown = Math.min(message.text.length, MESSAGE_PREVIEW_CHARS, remaining)
      previews.set(message.id, { text: message.text.slice(0, shown), shown })
      remaining -= shown
    }
    return messages.map(message => {
      const preview = previews.get(message.id) ?? { text: '', shown: 0 }
      return {
        id: message.id,
        sequence: message.sequence,
        ...(message.kind === 'text' ? {} : { kind: message.kind }),
        conversation: message.conversation,
        ...(message.conversationId === undefined ? {} : { conversation_id: message.conversationId }),
        from: message.fromName ?? message.from,
        text: preview.text,
        ...(preview.shown < message.text.length
          ? { text_more: { action: 'text', message_id: message.id, total_length: message.text.length } }
          : {}),
        ...(message.replyTo === undefined ? {} : { reply_to: message.replyTo }),
        ...(message.mustReply === true ? { must_reply: true } : {}),
        ...(message.resources.length === 0 ? {} : { resources: message.resources }),
        ...(message.mentions.length === 0 ? {} : { mentions: message.mentions }),
        ...(message.delivery === 'quiet' ? {} : { delivery: message.delivery }),
        created_at: message.createdAt,
      }
    })
  }
  const readMessages = (messages: readonly FleetReadMessage[]): Record<string, unknown>[] => messages.map(message => ({
    id: message.id,
    sequence: message.sequence,
    ...(message.kind === 'text' ? {} : { kind: message.kind }),
    conversation: message.conversation,
    ...(message.conversationId === undefined ? {} : { conversation_id: message.conversationId }),
    from: message.fromName ?? message.from,
    text: message.text,
    read_range: {
      start: message.readRange.start,
      end: message.readRange.end,
      total: message.readRange.total,
    },
    ...(message.readRange.end < message.readRange.total
      ? {
          text_more: {
            action: 'text',
            message_id: message.id,
            offset: message.readRange.end,
            total_length: message.readRange.total,
          },
        }
      : {}),
    ...(message.replyTo === undefined ? {} : { reply_to: message.replyTo }),
    ...(message.mustReply === true ? { must_reply: true } : {}),
    ...(message.resources.length === 0 ? {} : { resources: message.resources }),
    ...(message.mentions.length === 0 ? {} : { mentions: message.mentions }),
    ...(message.delivery === 'quiet' ? {} : { delivery: message.delivery }),
    created_at: message.createdAt,
  }))
  return {
    schema: MESSAGE_RESULT_SCHEMA,
    render: (_args, value) => {
      if (value.chunk !== undefined) return [{ type: 'text', text: JSON.stringify(value) }]
      if (value.messages !== undefined) {
        const messages = value.messages as Array<FleetMessage & { readonly readRange?: unknown }>
        const rendered = messages.every(message => message.readRange !== undefined)
          ? readMessages(messages as FleetReadMessage[])
          : compactMessages(messages)
        return [{ type: 'text', text: JSON.stringify({
          ...(value.action === undefined ? {} : { action: value.action }),
          messages: rendered,
          ...(value.hasMore === undefined ? {} : { hasMore: value.hasMore }),
          ...(value.revision === undefined ? {} : { revision: value.revision }),
        }) }]
      }
      if (value.inbox !== undefined) {
        const messages = value.inbox.map(item => item.message) as FleetMessage[]
        const compact = compactMessages(messages)
        return [{ type: 'text', text: JSON.stringify({
          action: value.action,
          inbox: value.inbox.map((item, index) => ({
            message: compact[index], reasons: item.reasons, acknowledged: item.acknowledged,
          })),
        }) }]
      }
      return [{ type: 'text', text: JSON.stringify(value) }]
    },
  }
}

const WAIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    revision: { type: 'integer', required: true },
    reason: { type: 'string', required: true, enum: ['changed', 'timeout', 'disconnected', 'stopped'] },
  },
} as const

const CHANNEL_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['list', 'create', 'update', 'archive'] },
    channels: { type: 'array', items: CHANNEL_SCHEMA },
    channel: CHANNEL_SCHEMA,
  },
} as const

const VOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    channel: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['start_work', 'finish', 'blocked', 'message'] },
    statement: { type: 'string', required: true },
    initiator: { type: 'string', required: true },
    voters: { type: 'array', required: true, items: { type: 'string' } },
    approvals: { type: 'array', required: true, items: { type: 'string' } },
    rejection: {
      type: 'object',
      additionalProperties: false,
      properties: {
        voter: { type: 'string', required: true },
        reason: { type: 'string', required: true },
      },
    },
    status: { type: 'string', required: true, enum: ['open', 'approved', 'rejected'] },
    createdAt: { type: 'string', required: true },
    closedAt: { type: 'string' },
  },
} as const

const VOTE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'cast'] },
    votes: { type: 'array', items: VOTE_SCHEMA },
    vote: VOTE_SCHEMA,
  },
} as const

function voteOutput(): {
  schema: typeof VOTE_RESULT_SCHEMA
  render: (args: unknown, value: InferValue<typeof VOTE_RESULT_SCHEMA>) => [{ type: 'text'; text: string }]
} {
  const compact = (vote: FleetVote, includeStatement = false): Record<string, unknown> => ({
    id: vote.id,
    channel: vote.channel,
    kind: vote.kind,
    status: vote.status,
    approvals: `${String(vote.approvals.length)}/${String(vote.voters.length)}`,
    ...(includeStatement ? { statement: vote.statement } : {}),
    ...(vote.rejection === undefined ? {} : { rejection: vote.rejection.reason }),
  })
  return {
    schema: VOTE_RESULT_SCHEMA,
    render: (_args, value) => {
      if (value.action === 'list') {
        return [{ type: 'text', text: JSON.stringify((value.votes ?? []).map(vote => compact(vote as FleetVote, true))) }]
      }
      if (value.action === 'get') return [{ type: 'text', text: JSON.stringify(value) }]
      const vote = value.vote as FleetVote | undefined
      return [{
        type: 'text',
        text: JSON.stringify(vote === undefined ? { action: value.action } : compact(vote)),
      }]
    },
  }
}

const MEETING_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['list', 'open', 'join', 'leave', 'close'] },
    meetings: { type: 'array', items: MEETING_SCHEMA },
    meeting: MEETING_SCHEMA,
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function callingAgent(agent: Agent | undefined, tool: string): Agent {
  if (agent === undefined) throw new Error(`${tool} requires a calling Agent`)
  return agent
}

interface FleetDirectory {
  resolveTarget(value: string): `@${string}`
  nameForAgent(id: string): string | undefined
}

function fleetDirectory(ctx: Context): FleetDirectory | undefined {
  return ctx.get('fleetCore') as FleetDirectory | undefined
}

export function apply(ctx: Context): void {
  const hub = new MessageHub({
    get(id): MessageAgent | undefined {
      const core = fleetDirectory(ctx)
      if (core !== undefined && core.nameForAgent(id) === undefined) return undefined
      return ctx.agents.get(SessionId(id))
    },
    participantIds(): string[] {
      return this.list().map(agent => String(agent.id))
    },
    list(): MessageAgent[] {
      const agents = ctx.agents.list()
      const core = fleetDirectory(ctx)
      return core === undefined ? agents : agents.filter(agent => core.nameForAgent(String(agent.id)) !== undefined)
    },
    resolve(reference): string {
      const core = fleetDirectory(ctx)
      return core?.resolveTarget(reference).slice(1) ?? reference
    },
    displayName(id): string | undefined {
      return fleetDirectory(ctx)?.nameForAgent(id)
    },
  })
  ctx.provide('fleetMessages', hub)
  ctx.effect(() => () => { hub.close() }, 'fleetMessages.close()')

  installMessageTools(ctx, hub)
}

export interface FleetMessageToolOptions {
  readonly messages?: boolean
  readonly coordination?: boolean
  readonly permissions?: ReadonlySet<import('./types.js').FleetMessagePermission>
  readonly authorize?: (
    agentId: string,
    action: string,
    resource?: { readonly kind: 'team' | 'conversation'; readonly id: string },
  ) => boolean
}

export function installMessageTools(
  ctx: Context,
  hub: MessageHub,
  options: FleetMessageToolOptions = {},
): () => void {
  const stops: Array<() => void> = []
  const register = (tool: Parameters<typeof ctx.tools.register>[0]): void => {
    stops.push(ctx.tools.register(tool))
  }
  const requireAction = (
    agent: Agent,
    action: string,
    resource?: { readonly kind: 'team' | 'conversation'; readonly id: string },
  ): void => {
    if (options.authorize?.(String(agent.id), action, resource) === false) {
      throw new Error(`Agent ${String(agent.id)} is not authorized for ${action}`)
    }
  }
  if (options.messages !== false) {
  register(defineTool({
    name: 'fleet_send',
    description: 'Send a process-local Fleet message without waking an idle Agent. Use #channel as a shared asynchronous coordination log and reply_to to continue a task thread without creating an Agent hierarchy. Meeting messages enter every other participant\'s context in full.',
    parameters: {
      to: { type: 'string', required: true, description: 'Target in @fleet-name, @agent-id, #channel, or meeting:id form.' },
      message: { type: 'string', required: true, description: 'Self-contained message text.' },
      reply_to: { type: 'string', description: 'Stable Fleet message id in the same conversation.' },
      must_reply: { type: 'boolean', description: 'Require each recipient to send a later message in this direct conversation or Channel before remaining idle.' },
      resources: { type: 'array', items: { type: 'string' }, description: 'Resource ids supplied by the Resources module.' },
    },
    output: jsonOutput(SEND_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_send')
      requireAction(caller, 'message.post', { kind: 'conversation', id: args.to })
      return Promise.resolve(hub.send(caller, {
        to: args.to as FleetTarget,
        text: args.message,
        delivery: 'quiet',
        ...(args.reply_to === undefined ? {} : { replyTo: args.reply_to }),
        ...(args.must_reply === undefined ? {} : { mustReply: args.must_reply }),
        ...(args.resources === undefined ? {} : { resources: args.resources }),
      }))
    },
  }))

  register(defineTool({
    name: 'fleet_followup',
    description: 'Send a process-local Fleet message and start selected Agents\' next turns. Set interrupt only for urgent information that makes in-flight work unsafe or obsolete. In a Channel, only explicitly mentioned peers wake or interrupt.',
    parameters: {
      to: { type: 'string', required: true, description: 'Target in @fleet-name, @agent-id, #channel, or meeting:id form.' },
      message: { type: 'string', required: true, description: 'Self-contained follow-up text.' },
      mentions: { type: 'array', items: { type: 'string' }, description: 'Required explicit @agent-id targets for a Channel follow-up.' },
      reply_to: { type: 'string', description: 'Stable Fleet message id in the same conversation.' },
      must_reply: { type: 'boolean', description: 'Require each recipient to send a later message in this direct conversation or Channel before remaining idle.' },
      resources: { type: 'array', items: { type: 'string' }, description: 'Resource ids supplied by the Resources module.' },
      interrupt: { type: 'boolean', description: 'Cancel the recipients current Agent step, preserve pending inbox work, and steer this message immediately.' },
    },
    output: jsonOutput(SEND_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_followup')
      requireAction(caller, 'message.post', { kind: 'conversation', id: args.to })
      requireAction(
        caller,
        args.interrupt === true ? 'message.interrupt' : 'message.wakeup',
        { kind: 'conversation', id: args.to },
      )
      return Promise.resolve(hub.send(caller, {
        to: args.to as FleetTarget,
        text: args.message,
        delivery: args.interrupt === true ? 'interrupt' : 'wakeup',
        ...(args.mentions === undefined ? {} : { mentions: args.mentions }),
        ...(args.reply_to === undefined ? {} : { replyTo: args.reply_to }),
        ...(args.must_reply === undefined ? {} : { mustReply: args.must_reply }),
        ...(args.resources === undefined ? {} : { resources: args.resources }),
      }))
    },
  }))

  register(defineTool({
    name: 'fleet_messages',
    description: 'Read Fleet message text progressively, search without marking results read, continue long text in bounded chunks, inspect the calling member inbox, react to messages, and manage pinned messages. Only text returned by read or text advances persistent per-message read progress; notifications and replies do not.',
    parameters: {
      action: { type: 'string', enum: ['read', 'search', 'inbox', 'react', 'reactions', 'pin', 'unpin', 'pins', 'text'], description: 'Defaults to read. Use text with message_id and the returned offset to continue a partially read message.' },
      conversation: { type: 'string', description: 'Conversation in @fleet-name, @agent-id, #channel, or meeting:id form.' },
      after: { type: 'string', description: 'Return messages after this stable Fleet message id.' },
      limit: { type: 'integer', description: 'For read, 1-50 messages (default 10). For other list actions, up to 100. For text continuation, 1-12000 characters (default 12000).' },
      max_chars: { type: 'integer', description: 'For read, total returned message text budget from 1 through 12000 characters (default 12000).' },
      query: { type: 'string', description: 'Case-insensitive text query for search.' },
      from: { type: 'string', description: 'Optional sender filter for search.' },
      resource: { type: 'string', description: 'Optional resource id filter for search.' },
      unread_only: { type: 'boolean', description: 'For read, defaults true and skips fully read messages; set false to inspect history. For inbox, return only unread items.' },
      message_id: { type: 'string', description: 'Message id for text continuation, react, reactions, pin, or unpin.' },
      offset: { type: 'integer', description: 'Character offset for text continuation. Omit to continue from recorded progress, or use the exact offset returned in text_more.' },
      reaction: { type: 'string', description: 'Reaction label for react.' },
      remove: { type: 'boolean', description: 'Remove the calling member reaction instead of adding it.' },
    },
    output: messageOutput(),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_messages')
      const action = args.action ?? 'read'
      requireAction(
        caller,
        action === 'react' || action === 'pin' || action === 'unpin' ? 'message.post' : 'message.read',
        args.conversation === undefined ? undefined : { kind: 'conversation', id: args.conversation },
      )
      if (action === 'read') {
        if (args.conversation === undefined) throw new Error('fleet_messages read requires conversation')
        return Promise.resolve(hub.read(caller, {
          conversation: args.conversation as FleetTarget,
          ...(args.after === undefined ? {} : { after: args.after }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          ...(args.max_chars === undefined ? {} : { maxChars: args.max_chars }),
          ...(args.unread_only === undefined ? {} : { unreadOnly: args.unread_only }),
        }))
      }
      if (action === 'search') {
        return Promise.resolve({ action, messages: hub.search(caller, {
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.conversation === undefined ? {} : { conversation: args.conversation as FleetTarget }),
          ...(args.from === undefined ? {} : { from: args.from }),
          ...(args.resource === undefined ? {} : { resource: args.resource }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
        }) })
      }
      if (action === 'inbox') {
        return Promise.resolve({ action, inbox: hub.inbox(caller, {
          ...(args.unread_only === undefined ? {} : { unreadOnly: args.unread_only }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
        }) })
      }
      if (action === 'pins') {
        return Promise.resolve({ action, pins: hub.listPins(caller, args.conversation as FleetTarget | undefined) })
      }
      if (args.message_id === undefined) throw new Error(`fleet_messages ${action} requires message_id`)
      if (action === 'text') {
        return Promise.resolve({
          action,
          chunk: hub.readMessageText(caller, args.message_id, args.offset, args.limit ?? 12_000),
        })
      }
      if (action === 'reactions') return Promise.resolve({ action, reactions: hub.listReactions(caller, args.message_id) })
      if (action === 'react') {
        if (args.reaction === undefined) throw new Error('fleet_messages react requires reaction')
        return Promise.resolve({ action, reaction: hub.react(caller, {
          messageId: args.message_id,
          reaction: args.reaction,
          ...(args.remove === undefined ? {} : { remove: args.remove }),
        }) })
      }
      return Promise.resolve({
        action,
        pin: hub.pin(caller, args.message_id, action === 'unpin'),
      })
    },
  }))

  register(defineTool({
    name: 'fleet_wait',
    description: 'Wait for the next Fleet change visible to the calling Agent. Returns a reason when state changes, the timeout expires, the Agent is paused/disconnected, or the Team message service stops. Unrelated private conversations and Channels do not complete the wait.',
    parameters: {
      after_revision: { type: 'integer', description: 'Last revision returned by fleet_messages or fleet_wait. Returns immediately if Fleet has advanced.' },
      timeout_ms: { type: 'integer', description: 'Short wait slice in milliseconds, from 1000 through 5000. Defaults to 5000 so queued steer messages return to the native Agent loop promptly.' },
    },
    output: jsonOutput(WAIT_SCHEMA),
    execute(args, exec) {
      const timeoutMs = args.timeout_ms ?? 5_000
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 5_000) {
        throw new Error('timeout_ms must be an integer from 1000 through 5000')
      }
      const caller = callingAgent(exec.agent, 'fleet_wait')
      requireAction(caller, 'message.read')
      return hub.wait(caller, args.after_revision, timeoutMs, exec.signal)
    },
  }))
  }

  if (options.coordination !== false) {
  const canManageChannels = options.permissions === undefined || options.permissions.has('channel.manage')
  const canManageMeetings = options.permissions === undefined || options.permissions.has('meeting.manage')
  const canCreateVotes = options.permissions === undefined || options.permissions.has('vote.create')
  register(defineTool({
    name: 'fleet_channel',
    description: 'List, create, update, or archive shared asynchronous coordination Channels. Summary and body are the current shared state; messages remain the chronological log.',
    parameters: {
      action: { type: 'string', required: true, enum: canManageChannels
        ? ['list', 'create', 'update', 'archive'] as const
        : ['list'] as const },
      name: { type: 'string', description: 'Lower-kebab-case Channel name without #.' },
      topic: { type: 'string', description: 'Short Channel topic used when creating.' },
      members: { type: 'array', items: { type: 'string' }, description: 'Optional private Channel members in @agent-id form.' },
      summary: { type: 'string', description: 'Concise current Channel summary.' },
      body: { type: 'string', description: 'Free-form current Channel work state.' },
      add_members: { type: 'array', items: { type: 'string' }, description: 'Members to add to a private Channel.' },
      remove_members: { type: 'array', items: { type: 'string' }, description: 'Members to remove from a private Channel.' },
    },
    output: jsonOutput(CHANNEL_RESULT_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_channel')
      requireAction(
        caller,
        args.action === 'list' ? 'message.read' : 'channel.manage',
        args.name === undefined ? undefined : { kind: 'conversation', id: `#${args.name}` },
      )
      if (args.action === 'list') {
        return Promise.resolve({ action: 'list' as const, channels: hub.listChannels(caller) })
      }
      if (args.name === undefined) throw new Error(`fleet_channel ${args.action} requires name`)
      if (args.action === 'create') {
        return Promise.resolve({
          action: 'create' as const,
          channel: hub.createChannel(caller, {
            name: args.name,
            ...(args.topic === undefined ? {} : { topic: args.topic }),
            ...(args.members === undefined ? {} : { members: args.members }),
            ...(args.summary === undefined ? {} : { summary: args.summary }),
            ...(args.body === undefined ? {} : { body: args.body }),
            ...(args.topic === undefined ? {} : { topic: args.topic }),
            ...(args.add_members === undefined ? {} : { addMembers: args.add_members }),
            ...(args.remove_members === undefined ? {} : { removeMembers: args.remove_members }),
          }),
        })
      }
      if (args.action === 'update') {
        return Promise.resolve({
          action: 'update' as const,
          channel: hub.updateChannel(caller, args.name, {
            ...(args.summary === undefined ? {} : { summary: args.summary }),
            ...(args.body === undefined ? {} : { body: args.body }),
          }),
        })
      }
      return Promise.resolve({
        action: 'archive' as const,
        channel: hub.archiveChannel(caller, args.name),
      })
    },
  }))

  register(defineTool({
    name: 'fleet_vote',
    description: 'Create or cast a non-blocking Channel Vote. Selected voters, or by default every other active member who can read the Channel, vote once; one rejection rejects, and unanimous approval passes.',
    parameters: {
      action: { type: 'string', required: true, enum: canCreateVotes
        ? ['list', 'get', 'create', 'cast'] as const
        : ['list', 'get', 'cast'] as const },
      id: { type: 'string', description: 'Vote id required for get. For cast, omit it when only one open Vote awaits your response.' },
      channel: { type: 'string', description: 'Channel target such as #main. Required for create; optional filter for list.' },
      kind: { type: 'string', enum: ['start_work', 'finish', 'blocked', 'message'], description: 'Vote outcome kind required for create.' },
      statement: { type: 'string', description: 'Concrete proposal and evidence required for create.' },
      voters: { type: 'array', items: { type: 'string' }, description: 'Optional eligible voters in @member form. Defaults to every other active member who can read the Channel.' },
      response: { type: 'string', enum: ['approve', 'reject'], description: 'Vote response required for cast.' },
      reason: { type: 'string', description: 'Required when rejecting.' },
    },
    output: voteOutput(),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_vote')
      requireAction(
        caller,
        args.action === 'create'
          ? 'vote.create'
          : args.action === 'cast'
            ? 'message.post'
            : 'message.read',
        args.channel === undefined ? undefined : { kind: 'conversation', id: args.channel },
      )
      if (args.action === 'list') {
        return Promise.resolve({
          action: 'list' as const,
          votes: hub.listVotes(caller, args.channel),
        })
      }
      if (args.action === 'get') {
        if (args.id === undefined) throw new Error('fleet_vote get requires id')
        return Promise.resolve({ action: 'get' as const, vote: hub.getVote(caller, args.id) })
      }
      if (args.action === 'create') {
        if (args.channel === undefined || args.kind === undefined || args.statement === undefined) {
          throw new Error('fleet_vote create requires channel, kind, and statement')
        }
        return Promise.resolve({
          action: 'create' as const,
          vote: hub.createVote(caller, {
            channel: args.channel as `#${string}`,
            kind: args.kind,
            statement: args.statement,
            ...(args.voters === undefined ? {} : { voters: args.voters }),
          }),
        })
      }
      if (args.response === undefined) throw new Error('fleet_vote cast requires response')
      return Promise.resolve({
        action: 'cast' as const,
        vote: hub.castVote(caller, {
          response: args.response,
          ...(args.id === undefined ? {} : { id: args.id }),
          ...(args.reason === undefined ? {} : { reason: args.reason }),
        }),
      })
    },
  }))

  register(defineTool({
    name: 'fleet_meeting',
    description: 'List, join, leave, open, or close Fleet Meetings. Close can persist a summary, decisions, action items linked to project tasks, and resource references.',
    parameters: {
      action: { type: 'string', required: true, enum: canManageMeetings
        ? ['list', 'open', 'join', 'leave', 'close'] as const
        : ['list', 'join', 'leave'] as const },
      id: { type: 'string', description: 'Lower-kebab-case Meeting id used as meeting:id.' },
      title: { type: 'string', description: 'Meeting title required when opening.' },
      agenda: { type: 'string', description: 'Opening agenda delivered to all participants.' },
      participants: { type: 'array', items: { type: 'string' }, description: 'Invited participants in @agent-id form.' },
      summary: { type: 'string', description: 'Meeting summary saved when closing.' },
      decisions: { type: 'array', items: { type: 'string' }, description: 'Decisions saved when closing.' },
      action_items: { type: 'array', items: {
        type: 'object', additionalProperties: false, properties: {
          text: { type: 'string', required: true },
          assignee: { type: 'string' },
          task_id: { type: 'string' },
        },
      }, description: 'Action items; task_id may link an external task tracked by an optional integration.' },
      resources: { type: 'array', items: { type: 'string' }, description: 'Resource ids attached to the meeting result.' },
    },
    output: jsonOutput(MEETING_RESULT_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_meeting')
      requireAction(
        caller,
        args.action === 'open' || args.action === 'close'
          ? 'meeting.manage'
          : args.action === 'join' || args.action === 'leave'
            ? 'meeting.join'
            : 'message.read',
        args.id === undefined ? undefined : { kind: 'conversation', id: `meeting:${args.id}` },
      )
      if (args.action === 'list') {
        return Promise.resolve({ action: 'list' as const, meetings: hub.listMeetings(caller) })
      }
      if (args.id === undefined) throw new Error(`fleet_meeting ${args.action} requires id`)
      if (args.action === 'open') {
        if (args.title === undefined || args.agenda === undefined || args.participants === undefined) {
          throw new Error('fleet_meeting open requires title, agenda, and participants')
        }
        return Promise.resolve({
          action: 'open' as const,
          meeting: hub.openMeeting(caller, {
            id: args.id,
            title: args.title,
            agenda: args.agenda,
            participants: args.participants,
          }),
        })
      }
      if (args.action === 'join' || args.action === 'leave') {
        return Promise.resolve({
          action: args.action,
          meeting: args.action === 'join' ? hub.joinMeeting(caller, args.id) : hub.leaveMeeting(caller, args.id),
        })
      }
      return Promise.resolve({
        action: 'close' as const,
        meeting: hub.closeMeeting(caller, args.id, {
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.decisions === undefined ? {} : { decisions: args.decisions }),
          ...(args.action_items === undefined ? {} : { actionItems: args.action_items.map(item => ({
            text: item.text,
            ...(item.assignee === undefined ? {} : { assignee: item.assignee }),
            ...(item.task_id === undefined ? {} : { taskId: item.task_id }),
          })) }),
          ...(args.resources === undefined ? {} : { resources: args.resources }),
        }),
      })
    },
  }))
  }
  return () => {
    for (const stop of stops.reverse()) stop()
  }
}
