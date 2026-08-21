import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

import { FleetResources, sharedPath } from './resources.js'

export * from './resources.js'

export const name = 'dsh-agent-fleet-resources'
export const inject = ['fs', 'tools']

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetResources: FleetResources
  }
}

const SHARED_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['read', 'write'] },
    name: { type: 'string', required: true, enum: ['plan', 'checklist'] },
    path: { type: 'string', required: true },
    exists: { type: 'boolean', required: true },
    content: { type: 'string' },
  },
} as const

const CLAIM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agentId: { type: 'string', required: true },
    paths: { type: 'array', required: true, items: { type: 'string' } },
    note: { type: 'string' },
  },
} as const

const OVERLAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agentId: { type: 'string', required: true },
    path: { type: 'string', required: true },
    conflictingPath: { type: 'string', required: true },
  },
} as const

const WORK_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['list', 'claim', 'release'] },
    claims: { type: 'array', required: true, items: CLAIM_SCHEMA },
    overlaps: { type: 'array', required: true, items: OVERLAP_SCHEMA },
  },
} as const

const RESOURCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    path: { type: 'string', required: true },
    label: { type: 'string' },
    mediaType: { type: 'string' },
    size: { type: 'number' },
    createdBy: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
  },
} as const

const RESOURCE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['add', 'get', 'list'] },
    resource: RESOURCE_SCHEMA,
    resources: { type: 'array', items: RESOURCE_SCHEMA },
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

function workspace(agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (cwd === undefined) throw new Error('Fleet workspace tools require a session cwd')
  return cwd
}

function sharedWorkspace(ctx: Context, agent: Agent): string {
  const core = ctx.get('fleetCore') as { projectRoot(): string | undefined } | undefined
  return core?.projectRoot() ?? workspace(agent)
}

export function apply(ctx: Context): void {
  const resources = new FleetResources(ctx.fs)
  ctx.provide('fleetResources', resources)
  ctx.on('agent/disposed', ({ agent }) => { resources.release(String(agent.id)) })

  const sandboxPolicy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (ctx.fs.sandboxMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('dsh-agent-fleet-resources: sandboxed filesystem requires ctx.sandboxPolicy')
  }

  ctx.tools.register(defineTool({
    name: 'fleet_shared',
    description: 'Read or replace the Fleet plan or checklist in the current session workspace. Read an existing file before replacing it.',
    parameters: {
      action: { type: 'string', required: true, enum: ['read', 'write'] },
      name: { type: 'string', required: true, enum: ['plan', 'checklist'] },
      content: { type: 'string', description: 'Complete Markdown content. Required for write.' },
    },
    output: jsonOutput(SHARED_RESULT_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent, 'fleet_shared')
      const file = sharedPath(args.name)
      const policy = sandboxPolicy?.resolve({ session: agent.session })
      const target = await ctx.fs.resolve(file, {
        cwd: sharedWorkspace(ctx, agent),
        signal: exec.signal,
      })

      if (args.action === 'read') {
        const info = await ctx.fs.stat(target, exec.signal)
        if (info === undefined) {
          ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
          return { action: 'read' as const, name: args.name, path: target.displayPath, exists: false, content: '' }
        }
        const content = await ctx.fs.readText(target, exec.signal)
        ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
        return { action: 'read' as const, name: args.name, path: target.displayPath, exists: true, content }
      }

      if (args.content === undefined) throw new Error('fleet_shared write requires content')
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
      const outcome: FsWriteOutcome = await ctx.fs.writeText(
        target,
        args.content,
        intent,
        exec.signal,
        policy,
      )
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return {
        action: 'write' as const,
        name: args.name,
        path: target.displayPath,
        exists: true,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_work',
    description: 'Declare, release, or list the file and directory paths Fleet Agents are currently working on. Overlaps are advisory and never block work.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'claim', 'release'] },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'File or directory paths, relative to the current session workspace. Required for claim.',
      },
      note: { type: 'string', description: 'Short description of the work.' },
    },
    output: jsonOutput(WORK_RESULT_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent, 'fleet_work')
      const agentId = String(agent.id)
      if (args.action === 'list') {
        return { action: 'list' as const, claims: resources.list(), overlaps: [] }
      }
      if (args.action === 'release') {
        resources.release(agentId)
        return { action: 'release' as const, claims: resources.list(), overlaps: [] }
      }
      if (args.paths === undefined || args.paths.length === 0) {
        throw new Error('fleet_work claim requires at least one path')
      }
      if (args.paths.some(path => path.trim().length === 0)) {
        throw new Error('fleet_work paths must be non-empty')
      }
      const cwd = workspace(agent)
      const targets: FsTarget[] = await Promise.all(args.paths.map(path => ctx.fs.resolve(path, {
        cwd,
        signal: exec.signal,
      })))
      const overlaps = resources.claim(agentId, targets, args.note)
      return { action: 'claim' as const, claims: resources.list(), overlaps }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_resource',
    description: 'Register an existing regular file as a Fleet resource, or resolve and list registered resources. The file is referenced in place and may contain text or binary data.',
    parameters: {
      action: { type: 'string', required: true, enum: ['add', 'get', 'list'] },
      path: {
        type: 'string',
        description: 'Existing file path, relative to the current session workspace or absolute. Required for add.',
      },
      id: { type: 'string', description: 'Fleet resource ID. Required for get.' },
      label: { type: 'string', description: 'Optional short human-readable label.' },
      media_type: { type: 'string', description: 'Optional media type, such as image/png or application/zip.' },
    },
    output: jsonOutput(RESOURCE_RESULT_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent, 'fleet_resource')

      if (args.action === 'list') {
        return { action: 'list' as const, resources: resources.listResources() }
      }

      if (args.action === 'get') {
        if (args.id === undefined || args.id.trim().length === 0) {
          throw new Error('fleet_resource get requires id')
        }
        return { action: 'get' as const, resource: resources.getResource(args.id) }
      }

      if (args.path === undefined || args.path.trim().length === 0) {
        throw new Error('fleet_resource add requires path')
      }
      const target = await ctx.fs.resolve(args.path, {
        cwd: workspace(agent),
        signal: exec.signal,
      })
      const info = await ctx.fs.stat(target, exec.signal)
      if (info === undefined) throw new Error(`Fleet resource file does not exist: ${target.displayPath}`)
      if (info.type !== 'file') throw new Error(`Fleet resource must be a regular file: ${target.displayPath}`)

      const resource = resources.addResource(String(agent.id), {
        path: ctx.fs.processPath(target),
        ...(args.label === undefined ? {} : { label: args.label }),
        ...(args.media_type === undefined ? {} : { mediaType: args.media_type }),
        ...(info.size === undefined ? {} : { size: info.size }),
      })
      return { action: 'add' as const, resource }
    },
  }))
}
