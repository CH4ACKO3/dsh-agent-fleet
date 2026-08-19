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
    conversation: { type: 'string', required: true },
    from: { type: 'string', required: true },
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
    open: { type: 'boolean', required: true },
    members: { type: 'array', required: true, items: { type: 'string' } },
    createdBy: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
    archived: { type: 'boolean', required: true },
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

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messages: { type: 'array', required: true, items: MESSAGE_SCHEMA },
    hasMore: { type: 'boolean', required: true },
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
    action: { type: 'string', required: true, enum: ['list', 'create', 'archive'] },
    channels: { type: 'array', items: CHANNEL_SCHEMA },
    channel: CHANNEL_SCHEMA,
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

export function apply(ctx: Context): void {
  const hub = new MessageHub({
    get(id): MessageAgent | undefined {
      return ctx.agents.get(SessionId(id))
    },
    list(): MessageAgent[] {
      return ctx.agents.list()
    },
  })
  ctx.provide('fleetMessages', hub)
  ctx.effect(() => () => { hub.close() }, 'fleetMessages.close()')

  ctx.tools.register(defineTool({
    name: 'fleet_send',
    description: 'Send a process-local Fleet message without waking an idle Agent. Use @agent-id for a direct message or #channel for a Channel post.',
    parameters: {
      to: { type: 'string', required: true, description: 'Target in @agent-id or #channel form.' },
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
    description: 'Send a process-local Fleet message and start the target Agent\'s next turn. A Channel target requires explicit @agent-id mentions and never wakes the whole Channel.',
    parameters: {
      to: { type: 'string', required: true, description: 'Target in @agent-id or #channel form.' },
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
    description: 'Read process-local Fleet message history for one direct conversation or Channel. This is a history query and does not acknowledge an inbox.',
    parameters: {
      conversation: { type: 'string', required: true, description: 'Conversation in @agent-id or #channel form.' },
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
    description: 'Wait for the next process-local Fleet message or Channel change. This does not read messages or wake another Agent.',
    parameters: {
      timeout_ms: { type: 'integer', description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.' },
    },
    output: jsonOutput(WAIT_SCHEMA),
    execute(args, exec) {
      const timeoutMs = args.timeout_ms ?? 30_000
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
        throw new Error('timeout_ms must be an integer from 10000 through 3600000')
      }
      callingAgent(exec.agent, 'fleet_wait')
      return hub.wait(timeoutMs, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_channel',
    description: 'List visible process-local Fleet Channels, create one, or archive one. Omit members when creating an open Channel; provide explicit @agent-id members for a private Channel.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'create', 'archive'] },
      name: { type: 'string', description: 'Lower-kebab-case Channel name without #.' },
      topic: { type: 'string', description: 'Short Channel topic used when creating.' },
      members: { type: 'array', items: { type: 'string' }, description: 'Optional private Channel members in @agent-id form.' },
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
          }),
        })
      }
      return Promise.resolve({
        action: 'archive' as const,
        channel: hub.archiveChannel(caller, args.name),
      })
    },
  }))
}
