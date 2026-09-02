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
    replyTaskIds: { type: 'array', items: { type: 'string' } },
    audienceHint: { type: 'string' },
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
  /** Register only these exact tool names. Omit to keep the legacy group behavior. */
  readonly tools?: ReadonlySet<string>
  readonly permissions?: ReadonlySet<import('./types.js').FleetMessagePermission>
  /** Treat direct sends as response requests unless reply_mode is optional. */
  readonly directReplyByDefault?: boolean
  /** Idempotently reconcile durable Reply Tasks before returning the tool result. */
  readonly reconcileMessageTasks?: (agent: Agent, messageId: string) => string[]
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
    if (options.tools !== undefined && !options.tools.has(tool.name)) return
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
      description: options.directReplyByDefault
        ? 'Send one quiet Fleet message to the smallest necessary audience. A direct @target creates one Reply Task by default; use reply_mode="optional" only for context that needs no answer. Use a #channel only when its full audience needs the exact content. An unmentioned Channel post is delivered quietly to the full Channel without waking anyone or creating Reply Tasks.'
        : 'Send one quiet Fleet message to the smallest necessary audience. Use a direct @target for one-member work and send subset work privately to one accountable owner, who can coordinate with peers. Use a #channel only when its full audience needs the exact content. An unmentioned Channel post is delivered quietly to the full Channel; a post with mentions notifies only those members while remaining visible to everyone. Each mention creates a Reply Task; use fleet_reply to finish an existing Reply Task.',
      parameters: {
        to: { type: 'string', required: true, description: options.directReplyByDefault ? 'Use @fleet-name or @agent-id for a private response request, #channel for Team-visible history, or meeting:id.' : 'Use @fleet-name or @agent-id for private one-member work, #channel for a Team-visible broadcast, or meeting:id. A direct @target delivers the full message but creates no Reply Task unless that recipient is also mentioned in the text or mentions parameter.' },
        message: { type: 'string', required: true, description: 'Self-contained message text.' },
        mentions: { type: 'array', items: { type: 'string' }, description: 'Optional structural Reply Task targets, merged with valid @Name or @member-id mentions parsed from the text. A direct message may mention only its recipient.' },
        reply_mode: { type: 'string', enum: ['required', 'optional'], description: 'For foreground assistants, direct messages default to required. Set optional only when no response is wanted.' },
        reply_to: { type: 'string', description: 'Stable Fleet message id in the same conversation.' },
        resources: { type: 'array', items: { type: 'string' }, description: 'Resource ids supplied by the Resources module.' },
      },
      output: jsonOutput(SEND_SCHEMA),
      execute(args, exec) {
        const caller = callingAgent(exec.agent, 'fleet_send')
        requireAction(caller, 'message.post', { kind: 'conversation', id: args.to })
        const directReply = options.directReplyByDefault === true
          && String(args.to).startsWith('@')
          && args.reply_mode !== 'optional'
        const mentions = directReply
          ? [...new Set([args.to, ...(args.mentions ?? [])])]
          : args.mentions
        const result = hub.send(caller, {
          to: args.to as FleetTarget,
          text: args.message,
          delivery: 'quiet',
          ...(mentions === undefined ? {} : { mentions }),
          ...(args.reply_to === undefined ? {} : { replyTo: args.reply_to }),
          ...(args.resources === undefined ? {} : { resources: args.resources }),
        })
        const replyTaskIds = options.reconcileMessageTasks?.(caller, result.messageId) ?? []
        return Promise.resolve({
          ...result,
          ...(replyTaskIds.length === 0 ? {} : { replyTaskIds }),
        })
      },
    }))
  }

  if (options.coordination !== false) {
    const canManageChannels = options.permissions === undefined || options.permissions.has('channel.manage')
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
  }
  return () => {
    for (const stop of stops.reverse()) stop()
  }
}
