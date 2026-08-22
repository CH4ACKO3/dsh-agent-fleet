import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  appendDelegatedPolicyOverrides,
  applyChildComposition,
  captureDelegatedPolicyOverrides,
  childSessionMeta,
  resolveChildAgentOptions,
  resolveChildDepth,
  seedDescriptorTurn,
  snapshotSubagentDescriptor,
} from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

import { FleetCore } from './core.js'
import type { RuntimeAgent, RuntimeAgentHandle } from './types.js'

export * from './core.js'
export * from './activation.js'
export * from './calendar.js'
export * from './collaboration.js'
export * from './names.js'
export * from './tasks.js'
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
    displayName: { type: 'string', required: true },
    color: { type: 'string', required: true },
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

interface SessionArchiveBridge {
  attach(logicalId: string, sessionId: string): Promise<unknown>
  find(logicalId: string): Promise<{
    readonly activeSessionId: string
    readonly segments: readonly { readonly sessionId: string }[]
  } | undefined>
  resume(logicalId: string, options: {
    readonly agentOptions?: AgentOptions
    readonly setup?: AgentSetup
  }): Promise<AgentHandle>
  rotateIfNeeded(logicalId: string, handle: AgentHandle, options: {
    readonly setup?: AgentSetup
  }): Promise<{ readonly handle: AgentHandle } | undefined>
}

function sessionArchive(ctx: Context): SessionArchiveBridge | undefined {
  return ctx.get('sessionArchive', false) as SessionArchiveBridge | undefined
}

export function apply(ctx: Context): void {
  const core = new FleetCore({
    get(id): RuntimeAgent | undefined {
      return ctx.agents.get(SessionId(id))
    },
    async create(owner, input): Promise<RuntimeAgentHandle> {
      const nativeOwner = ctx.agents.get(SessionId(owner.id))
      if (nativeOwner === undefined) throw new Error(`Agent ${owner.id} is not running in this process`)
      const childDepth = resolveChildDepth(nativeOwner, undefined)
      const delegatedPolicies = captureDelegatedPolicyOverrides(nativeOwner)
      const agentProvider = input.provider ?? nativeOwner.options.provider
      const agentModel = input.model ?? nativeOwner.options.model
      const descriptor = snapshotSubagentDescriptor({
        mode: 'continuable',
        provider: 'dsh-agent-fleet',
        label: input.label,
        ...(agentProvider === undefined ? {} : { agentProvider }),
        ...(agentModel === undefined ? {} : { agentModel }),
        ...(input.persona === undefined ? {} : { persona: input.persona }),
      })
      const handle: AgentHandle = await ctx.agents.create({
        sessionId: SessionId(input.id),
        seed: seedDescriptorTurn(SessionId(input.id), undefined, descriptor),
        meta: {
          ...childSessionMeta(nativeOwner, childDepth, 0),
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        },
        agentOptions: resolveChildAgentOptions(nativeOwner, {
          ...(input.provider === undefined ? {} : { provider: input.provider }),
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
        }, childDepth),
        async setup(childCtx) {
          if (childCtx.agent === undefined) throw new Error('Fleet child Agent setup requires ctx.agent')
          appendDelegatedPolicyOverrides(childCtx.agent.session, delegatedPolicies)
          applyChildComposition(childCtx, nativeOwner, {
            ...(input.persona === undefined ? {} : { persona: input.persona }),
          })
          await input.setup?.(childCtx)
        },
      })
      const archiveId = input.archiveId
      const archive = archiveId === undefined ? undefined : sessionArchive(ctx)
      try {
        if (archive !== undefined && archiveId !== undefined) await archive.attach(archiveId, String(handle.agent.id))
        return handle
      } catch (error) {
        await handle.dispose()
        throw error
      }
    },
    async resume(owner, input): Promise<RuntimeAgentHandle> {
      const nativeOwner = ctx.agents.get(SessionId(owner.id))
      if (nativeOwner === undefined) throw new Error(`Agent ${owner.id} is not running in this process`)
      const agentProvider = input.provider ?? nativeOwner.options.provider
      const agentModel = input.model ?? nativeOwner.options.model
      const descriptor = snapshotSubagentDescriptor({
        mode: 'continuable',
        provider: 'dsh-agent-fleet',
        label: input.label,
        ...(agentProvider === undefined ? {} : { agentProvider }),
        ...(agentModel === undefined ? {} : { agentModel }),
        ...(input.persona === undefined ? {} : { persona: input.persona }),
      })
      const agentOptions: AgentOptions = {
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
      }
      const setup: AgentSetup = async (childCtx) => {
        if (childCtx.agent === undefined) throw new Error('Fleet child Agent setup requires ctx.agent')
        if (!childCtx.agent.session.events.some(event => event.type === 'subagent/descriptor')) {
          childCtx.agent.session.append('subagent/descriptor', descriptor)
        }
        applyChildComposition(childCtx, nativeOwner, {
          ...(input.persona === undefined ? {} : { persona: input.persona }),
        })
        await input.setup?.(childCtx)
      }
      const archiveId = input.archiveId
      const archive = archiveId === undefined ? undefined : sessionArchive(ctx)
      const timeline = archive === undefined || archiveId === undefined ? undefined : await archive.find(archiveId)
      if (timeline !== undefined && !timeline.segments.some(segment => segment.sessionId === input.id)) {
        throw new Error(`Fleet member Session ${input.id} does not belong to archive ${archiveId}`)
      }
      let handle: AgentHandle
      if (timeline === undefined) {
        handle = await ctx.agents.resume({ resumeSessionId: SessionId(input.id), agentOptions, setup })
      } else {
        if (archive === undefined || archiveId === undefined) throw new Error('Session Archive disappeared during resume')
        handle = await archive.resume(archiveId, { agentOptions, setup })
      }
      try {
        if (archive !== undefined && archiveId !== undefined && timeline === undefined) {
          await archive.attach(archiveId, String(handle.agent.id))
        }
        return handle
      } catch (error) {
        await handle.dispose()
        throw error
      }
    },
    async rotate(handle, input): Promise<RuntimeAgentHandle | undefined> {
      const archive = sessionArchive(ctx)
      if (archive === undefined) return undefined
      const rotated = await archive.rotateIfNeeded(input.archiveId, handle as AgentHandle, {
        ...(input.setup === undefined ? {} : { setup: input.setup }),
      })
      return rotated?.handle
    },
  })
  ctx.provide('fleetCore', core)
  ctx.on('agent/disposed', ({ agent }) => { core.disposed(String(agent.id)) })
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
      display_name: { type: 'string', description: 'Persistent human-readable member name. Generated when omitted.' },
      color: {
        type: 'string',
        description: 'Persistent member card color in #RRGGBB. Generated from a restrained range when omitted.',
      },
      role: { type: 'string', description: 'Fleet role used when registering, creating, or updating.' },
      capabilities: { type: 'array', items: { type: 'string' }, description: 'Fleet capability labels.' },
      cwd: { type: 'string', description: 'Absolute working directory for a newly created Agent.' },
      provider: { type: 'string', description: 'Optional DSH provider route for a newly created Agent.' },
      model: { type: 'string', description: 'Optional model id for a newly created Agent.' },
      max_tokens: { type: 'integer', description: 'Optional positive output token limit for a newly created Agent.' },
      persona: { type: 'string', description: 'Optional per-Agent persona used by a newly created Agent.' },
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
        const agent = core.register(caller, {
          name: args.name,
          ...(args.display_name === undefined ? {} : { displayName: args.display_name }),
          ...(args.color === undefined ? {} : { color: args.color }),
          role: args.role,
          ...(args.capabilities === undefined ? {} : { capabilities: args.capabilities }),
        })
        const cwd = caller.session.header.cwd
        if (cwd !== undefined) core.bindProjectRoot(cwd)
        return { action: 'register' as const, agent }
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
        const agent = await core.create(caller, {
          name: args.name,
          ...(args.display_name === undefined ? {} : { displayName: args.display_name }),
          ...(args.color === undefined ? {} : { color: args.color }),
          role: args.role,
          ...(args.capabilities === undefined ? {} : { capabilities: args.capabilities }),
          ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          ...(args.provider === undefined ? {} : { provider: args.provider }),
          ...(args.model === undefined ? {} : { model: args.model }),
          ...(args.max_tokens === undefined ? {} : { maxTokens: args.max_tokens }),
          ...(args.persona === undefined ? {} : { persona: args.persona }),
        })
        const cwd = caller.session.header.cwd
        if (cwd !== undefined) core.bindProjectRoot(cwd)
        return { action: 'create' as const, agent }
      }
      if (args.action === 'cancel') {
        return { action: 'cancel' as const, agent: core.cancel(caller, args.name) }
      }
      return { action: 'stop' as const, agent: await core.stop(caller, args.name) }
    },
  }))
}
