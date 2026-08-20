import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

import { FleetCore } from './core.js'
import type { RuntimeAgent, RuntimeAgentHandle } from './types.js'

export * from './core.js'
export * from './types.js'

export const name = 'dsh-agent-fleet-core'
export const inject = ['agents', 'tools']

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetCore: FleetCore
  }
}

const AGENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    target: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'string', required: true },
    capabilities: { type: 'array', required: true, items: { type: 'string' } },
    status: { type: 'string', required: true, enum: ['idle', 'running', 'offline'] },
    managed: { type: 'boolean', required: true },
    createdBy: { type: 'string' },
    registeredAt: { type: 'string', required: true },
  },
} as const

const AGENT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      required: true,
      enum: ['list', 'get', 'register', 'update', 'unregister', 'create', 'cancel', 'stop'],
    },
    agents: { type: 'array', items: AGENT_SCHEMA },
    agent: AGENT_SCHEMA,
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

function callingAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('fleet_agent requires a calling Agent')
  return agent
}

export function apply(ctx: Context): void {
  const core = new FleetCore({
    get(id): RuntimeAgent | undefined {
      return ctx.agents.get(SessionId(id))
    },
    async create(owner, input): Promise<RuntimeAgentHandle> {
      const nativeOwner = ctx.agents.get(SessionId(owner.id))
      if (nativeOwner === undefined) throw new Error(`Agent ${owner.id} is not running in this process`)
      const handle: AgentHandle = await nativeOwner.ctx.agents.create({
        sessionId: SessionId(input.id),
        meta: {
          origin: 'subagent',
          delegationDepth: (nativeOwner.session.header.delegationDepth ?? 0) + 1,
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        },
        agentOptions: {
          ...(input.provider === undefined ? {} : { provider: input.provider }),
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
        },
      })
      return handle
    },
  })
  ctx.provide('fleetCore', core)
  ctx.effect(() => async () => { await core.close() }, 'fleetCore.close()')

  ctx.tools.register(defineTool({
    name: 'fleet_agent',
    description: 'Register and inspect Fleet members, update your own metadata, or create and control process-local DSH Agents owned by the caller.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['list', 'get', 'register', 'update', 'unregister', 'create', 'cancel', 'stop'],
      },
      name: { type: 'string', description: 'Unique lower-kebab-case Fleet member name.' },
      role: { type: 'string', description: 'Fleet role used when registering, creating, or updating.' },
      capabilities: { type: 'array', items: { type: 'string' }, description: 'Fleet capability labels.' },
      cwd: { type: 'string', description: 'Absolute working directory for a newly created Agent.' },
      provider: { type: 'string', description: 'Optional DSH provider route for a newly created Agent.' },
      model: { type: 'string', description: 'Optional model id for a newly created Agent.' },
      max_tokens: { type: 'integer', description: 'Optional positive output token limit for a newly created Agent.' },
    },
    output: jsonOutput(AGENT_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent)
      if (args.action === 'list') {
        return { action: 'list' as const, agents: core.list() }
      }
      if (args.action === 'register') {
        if (args.name === undefined || args.role === undefined) {
          throw new Error('fleet_agent register requires name and role')
        }
        return {
          action: 'register' as const,
          agent: core.register(caller, {
            name: args.name,
            role: args.role,
            ...(args.capabilities === undefined ? {} : { capabilities: args.capabilities }),
          }),
        }
      }
      if (args.action === 'update') {
        return {
          action: 'update' as const,
          agent: core.update(caller, {
            ...(args.role === undefined ? {} : { role: args.role }),
            ...(args.capabilities === undefined ? {} : { capabilities: args.capabilities }),
          }),
        }
      }
      if (args.action === 'unregister') {
        return { action: 'unregister' as const, agent: core.unregister(caller) }
      }
      if (args.name === undefined) throw new Error(`fleet_agent ${args.action} requires name`)
      if (args.action === 'get') {
        return { action: 'get' as const, agent: core.get(args.name) }
      }
      if (args.action === 'create') {
        if (args.role === undefined) throw new Error('fleet_agent create requires role')
        return {
          action: 'create' as const,
          agent: await core.create(caller, {
            name: args.name,
            role: args.role,
            ...(args.capabilities === undefined ? {} : { capabilities: args.capabilities }),
            ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
            ...(args.provider === undefined ? {} : { provider: args.provider }),
            ...(args.model === undefined ? {} : { model: args.model }),
            ...(args.max_tokens === undefined ? {} : { maxTokens: args.max_tokens }),
          }),
        }
      }
      if (args.action === 'cancel') {
        return { action: 'cancel' as const, agent: core.cancel(caller, args.name) }
      }
      return { action: 'stop' as const, agent: await core.stop(caller, args.name) }
    },
  }))
}
