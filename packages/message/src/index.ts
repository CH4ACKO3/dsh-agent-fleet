import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

import { MessageHub } from './hub.js'
import type { FleetTarget, MessageAgent } from './types.js'

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
      enum: ['text', 'meeting_opened', 'meeting_closed', 'vote_opened', 'vote_cast', 'vote_closed'],
    },
    conversation: { type: 'string', required: true },
    from: { type: 'string', required: true },
    fromName: { type: 'string' },
    text: { type: 'string', required: true },
    replyTo: { type: 'string' },
    resources: { type: 'array', required: true, items: { type: 'string' } },
    mentions: { type: 'array', required: true, items: { type: 'string' } },
    delivery: { type: 'string', required: true, enum: ['quiet', 'wakeup'] },
    createdAt: { type: 'string', required: true },
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
    status: { type: 'string', required: true, enum: ['open', 'closed'] },
    createdAt: { type: 'string', required: true },
    closedAt: { type: 'string' },
  },
} as const

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messages: { type: 'array', required: true, items: MESSAGE_SCHEMA },
    hasMore: { type: 'boolean', required: true },
    revision: { type: 'integer', required: true },
  },
} as const

const WAIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timedOut: { type: 'boolean', required: true },
    revision: { type: 'integer', required: true },
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

const MEETING_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['list', 'open', 'close'] },
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

  ctx.tools.register(defineTool({
    name: 'fleet_send',
    description: 'Send a process-local Fleet message without waking an idle Agent. Use #channel as a shared asynchronous coordination log and reply_to to continue a task thread without creating an Agent hierarchy. Meeting messages enter every other participant\'s context in full.',
    parameters: {
      to: { type: 'string', required: true, description: 'Target in @fleet-name, @agent-id, #channel, or meeting:id form.' },
      message: { type: 'string', required: true, description: 'Self-contained message text.' },
      reply_to: { type: 'string', description: 'Stable Fleet message id in the same conversation.' },
      resources: { type: 'array', items: { type: 'string' }, description: 'Resource ids supplied by the Resources module.' },
    },
    output: jsonOutput(SEND_SCHEMA),
    execute(args, exec) {
      return Promise.resolve(hub.send(callingAgent(exec.agent, 'fleet_send'), {
        to: args.to as FleetTarget,
        text: args.message,
        delivery: 'quiet',
        ...(args.reply_to === undefined ? {} : { replyTo: args.reply_to }),
        ...(args.resources === undefined ? {} : { resources: args.resources }),
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_followup',
    description: 'Send a process-local Fleet message and start selected Agents\' next turns. In a Channel, the message remains visible to every member but only explicitly mentioned peers wake; no Channel member is its coordinator by default.',
    parameters: {
      to: { type: 'string', required: true, description: 'Target in @fleet-name, @agent-id, #channel, or meeting:id form.' },
      message: { type: 'string', required: true, description: 'Self-contained follow-up text.' },
      mentions: { type: 'array', items: { type: 'string' }, description: 'Required explicit @agent-id targets for a Channel follow-up.' },
      reply_to: { type: 'string', description: 'Stable Fleet message id in the same conversation.' },
      resources: { type: 'array', items: { type: 'string' }, description: 'Resource ids supplied by the Resources module.' },
    },
    output: jsonOutput(SEND_SCHEMA),
    execute(args, exec) {
      return Promise.resolve(hub.send(callingAgent(exec.agent, 'fleet_followup'), {
        to: args.to as FleetTarget,
        text: args.message,
        delivery: 'wakeup',
        ...(args.mentions === undefined ? {} : { mentions: args.mentions }),
        ...(args.reply_to === undefined ? {} : { replyTo: args.reply_to }),
        ...(args.resources === undefined ? {} : { resources: args.resources }),
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_messages',
    description: 'Read process-local Fleet message history for one direct conversation, Channel, or Meeting. This is a history query and does not acknowledge an inbox.',
    parameters: {
      conversation: { type: 'string', required: true, description: 'Conversation in @fleet-name, @agent-id, #channel, or meeting:id form.' },
      after: { type: 'string', description: 'Return messages after this stable Fleet message id.' },
      limit: { type: 'integer', description: 'Number of messages, from 1 through 100. Defaults to 50.' },
    },
    output: jsonOutput(READ_SCHEMA),
    execute(args, exec) {
      return Promise.resolve(hub.read(callingAgent(exec.agent, 'fleet_messages'), {
        conversation: args.conversation as FleetTarget,
        ...(args.after === undefined ? {} : { after: args.after }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_wait',
    description: 'Wait for the next Fleet change visible to the calling Agent. Unrelated private conversations and Channels do not complete the wait. This does not read messages or wake another Agent.',
    parameters: {
      after_revision: { type: 'integer', description: 'Last revision returned by fleet_messages or fleet_wait. Returns immediately if Fleet has advanced.' },
      timeout_ms: { type: 'integer', description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.' },
    },
    output: jsonOutput(WAIT_SCHEMA),
    execute(args, exec) {
      const timeoutMs = args.timeout_ms ?? 30_000
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
        throw new Error('timeout_ms must be an integer from 10000 through 3600000')
      }
      const caller = callingAgent(exec.agent, 'fleet_wait')
      return hub.wait(caller, args.after_revision, timeoutMs, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_channel',
    description: 'List, create, update, or archive shared asynchronous coordination Channels. Summary and body are the current shared state; messages remain the chronological log.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'create', 'update', 'archive'] },
      name: { type: 'string', description: 'Lower-kebab-case Channel name without #.' },
      topic: { type: 'string', description: 'Short Channel topic used when creating.' },
      members: { type: 'array', items: { type: 'string' }, description: 'Optional private Channel members in @agent-id form.' },
      summary: { type: 'string', description: 'Concise current Channel summary.' },
      body: { type: 'string', description: 'Free-form current Channel work state.' },
    },
    output: jsonOutput(CHANNEL_RESULT_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_channel')
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

  ctx.tools.register(defineTool({
    name: 'fleet_vote',
    description: 'Create or cast a non-blocking Channel Vote. Every other active member who can read the Channel votes once; one rejection rejects, and unanimous approval passes.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'cast'] },
      id: { type: 'string', description: 'Vote id required for get or cast.' },
      channel: { type: 'string', description: 'Channel target such as #main. Required for create; optional filter for list.' },
      kind: { type: 'string', enum: ['start_work', 'finish', 'blocked', 'message'], description: 'Vote outcome kind required for create.' },
      statement: { type: 'string', description: 'Concrete proposal and evidence required for create.' },
      response: { type: 'string', enum: ['approve', 'reject'], description: 'Vote response required for cast.' },
      reason: { type: 'string', description: 'Required when rejecting.' },
    },
    output: jsonOutput(VOTE_RESULT_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_vote')
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
          }),
        })
      }
      if (args.id === undefined || args.response === undefined) {
        throw new Error('fleet_vote cast requires id and response')
      }
      return Promise.resolve({
        action: 'cast' as const,
        vote: hub.castVote(caller, {
          id: args.id,
          response: args.response,
          ...(args.reason === undefined ? {} : { reason: args.reason }),
        }),
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_meeting',
    description: 'List visible Fleet Meetings, open a non-blocking Meeting, or close one as its initiator. Opening and closing wake every other participant.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'open', 'close'] },
      id: { type: 'string', description: 'Lower-kebab-case Meeting id used as meeting:id.' },
      title: { type: 'string', description: 'Meeting title required when opening.' },
      agenda: { type: 'string', description: 'Opening agenda delivered to all participants.' },
      participants: { type: 'array', items: { type: 'string' }, description: 'Invited participants in @agent-id form.' },
    },
    output: jsonOutput(MEETING_RESULT_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_meeting')
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
      return Promise.resolve({
        action: 'close' as const,
        meeting: hub.closeMeeting(caller, args.id),
      })
    },
  }))
}
