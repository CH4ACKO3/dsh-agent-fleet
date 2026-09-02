import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

import { FleetResources } from './resources.js'

export * from './resources.js'

export const name = 'dsh-agent-fleet-resources'
export const inject = ['fs', 'tools']

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetResources: FleetResources
  }
}

const SHARED_ENTRY_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    name: { type: 'string', required: true }, path: { type: 'string', required: true },
    type: { type: 'string', required: true, enum: ['file', 'directory', 'other'] }, size: { type: 'number' },
  },
} as const

const SHARED_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'read', 'write', 'delete'] },
    path: { type: 'string', required: true }, exists: { type: 'boolean', required: true },
    content: { type: 'string' }, entries: { type: 'array', items: SHARED_ENTRY_SCHEMA },
  },
} as const

const CLAIM_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    agentId: { type: 'string', required: true }, paths: { type: 'array', required: true, items: { type: 'string' } }, note: { type: 'string' },
  },
} as const

const OVERLAP_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    agentId: { type: 'string', required: true }, path: { type: 'string', required: true }, conflictingPath: { type: 'string', required: true },
  },
} as const

const WORK_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'claim', 'release'] },
    claims: { type: 'array', required: true, items: CLAIM_SCHEMA }, overlaps: { type: 'array', required: true, items: OVERLAP_SCHEMA },
  },
} as const

const RESOURCE_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, path: { type: 'string', required: true }, label: { type: 'string' },
    mediaType: { type: 'string' }, size: { type: 'number' }, createdBy: { type: 'string', required: true }, createdAt: { type: 'string', required: true },
  },
} as const

const RESOURCE_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['add', 'get', 'list'] },
    resource: RESOURCE_SCHEMA, resources: { type: 'array', items: RESOURCE_SCHEMA },
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
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

export interface FleetResourceToolOptions {
  /** Register only these exact tool names. Omit to register the complete resource group. */
  readonly tools?: ReadonlySet<string>
  readonly projectRoot?: string
  readonly sharedDirectory?: string
  readonly canRead?: (agentId: string, kind: 'shared' | 'resource' | 'file' | 'work', id?: string) => boolean
  readonly canWrite?: (agentId: string, kind: 'shared' | 'resource' | 'file' | 'work', id?: string) => boolean
  readonly resourceWrite?: boolean
  readonly deleteShared?: (relativePath: string) => void | Promise<void>
}

export function apply(ctx: Context): void {
  const resources = new FleetResources(ctx.fs)
  ctx.provide('fleetResources', resources)
  installResourceTools(ctx, resources)
}

export function installResourceTools(ctx: Context, resources: FleetResources, options: FleetResourceToolOptions = {}): () => void {
  const stops: Array<() => void> = [ctx.on('agent/disposed', ({ agent }) => { resources.release(String(agent.id)) })]
  const register = (tool: Parameters<typeof ctx.tools.register>[0]): void => {
    if (options.tools !== undefined && !options.tools.has(tool.name)) return
    stops.push(ctx.tools.register(tool))
  }
  const sandboxPolicy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (ctx.fs.sandboxMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('dsh-agent-fleet-resources: sandboxed filesystem requires ctx.sandboxPolicy')
  }
  const requireAccess = (agent: Agent, write: boolean, kind: 'shared' | 'resource' | 'file' | 'work', id?: string): void => {
    const allowed = write ? options.canWrite?.(String(agent.id), kind, id) : options.canRead?.(String(agent.id), kind, id)
    if (allowed === false) throw new Error(`Agent ${String(agent.id)} cannot ${write ? 'write' : 'read'} Fleet ${kind}${id === undefined ? '' : ` ${id}`}`)
  }
  const sharedTarget = async (path: string, signal: AbortSignal): Promise<{ readonly root: FsTarget; readonly target: FsTarget }> => {
    if (options.sharedDirectory === undefined) throw new Error('Fleet shared directory is not configured')
    if (isAbsolute(path)) throw new Error('fleet_shared path must be relative to the Team shared directory')
    const root = await ctx.fs.resolve(options.sharedDirectory, {
      ...(options.projectRoot === undefined ? {} : { cwd: options.projectRoot }),
      signal,
    })
    const target = await ctx.fs.resolve(path === '' ? '.' : path, { cwd: options.sharedDirectory, signal })
    if (!ctx.fs.contains(root, target)) throw new Error(`Path ${target.displayPath} is outside the Team shared directory`)
    return { root, target }
  }

  register(defineTool({
    name: 'fleet_shared',
    description: 'List, read, replace, or delete real files inside this Team shared directory. Paths are relative to the shared directory.',
    parameters: {
      action: { type: 'string', required: true, enum: options.resourceWrite === false || options.deleteShared === undefined
        ? options.resourceWrite === false ? ['list', 'read'] as const : ['list', 'read', 'write'] as const
        : ['list', 'read', 'write', 'delete'] as const },
      path: { type: 'string', description: 'Relative file or directory path. Defaults to the shared directory root.' },
      content: { type: 'string', description: 'Complete UTF-8 text content. Required for write.' },
    },
    output: jsonOutput(SHARED_RESULT_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent, 'fleet_shared')
      const path = args.path?.trim() ?? ''
      const { target } = await sharedTarget(path, exec.signal)
      requireAccess(agent, args.action === 'write' || args.action === 'delete', 'shared', target.displayPath)
      if (args.action === 'list') {
        const entries = await ctx.fs.listDir(target, exec.signal)
        return {
          action: 'list' as const, path: target.displayPath, exists: true,
          entries: entries.map(entry => ({
            name: entry.name, path: entry.target.displayPath, type: entry.type,
            ...(entry.size === undefined ? {} : { size: entry.size }),
          })),
        }
      }
      if (args.action === 'read') {
        const info = await ctx.fs.stat(target, exec.signal)
        if (info === undefined) {
          ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
          return { action: 'read' as const, path: target.displayPath, exists: false, content: '' }
        }
        const content = await ctx.fs.readText(target, exec.signal)
        ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
        return { action: 'read' as const, path: target.displayPath, exists: true, content }
      }
      if (args.action === 'delete') {
        if (path === '') throw new Error('fleet_shared delete requires a file path')
        if (options.deleteShared === undefined) throw new Error('fleet_shared delete is unavailable')
        const info = await ctx.fs.stat(target, exec.signal)
        if (info === undefined) return { action: 'delete' as const, path: target.displayPath, exists: false }
        if (info.type !== 'file') throw new Error(`Fleet shared path is not a regular file: ${target.displayPath}`)
        await options.deleteShared(path)
        resources.removeResource(String(agent.id), `shared:${path}`)
        ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
        return { action: 'delete' as const, path: target.displayPath, exists: false }
      }
      if (path === '') throw new Error('fleet_shared write requires a file path')
      if (args.content === undefined) throw new Error('fleet_shared write requires content')
      const policy = sandboxPolicy?.resolve({ session: agent.session })
      const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
      const outcome: FsWriteOutcome = await ctx.fs.writeText(target, args.content, intent, exec.signal, policy)
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      const id = `shared:${path}`
      resources.addResource(String(agent.id), {
        id, path: ctx.fs.processPath(target), label: path, mediaType: 'text/plain',
        size: new TextEncoder().encode(args.content).byteLength,
      })
      resources.recordRevision(String(agent.id), id, outcome.before, outcome.after)
      return { action: 'write' as const, path: target.displayPath, exists: true }
    },
  }))

  register(defineTool({
    name: 'fleet_work',
    description: 'Declare, release, or list file and directory paths Team members are currently working on. Overlaps are advisory.',
    parameters: {
      action: { type: 'string', required: true, enum: options.resourceWrite === false ? ['list'] as const : ['list', 'claim', 'release'] as const },
      paths: { type: 'array', items: { type: 'string' }, description: 'Paths relative to the current session workspace. Required for claim.' },
      note: { type: 'string' },
    },
    output: jsonOutput(WORK_RESULT_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent, 'fleet_work')
      const agentId = String(agent.id)
      requireAccess(agent, args.action !== 'list', 'work')
      if (args.action === 'list') return { action: 'list' as const, claims: resources.list(), overlaps: [] }
      if (args.action === 'release') {
        resources.release(agentId)
        return { action: 'release' as const, claims: resources.list(), overlaps: [] }
      }
      if (args.paths === undefined || args.paths.length === 0 || args.paths.some(path => path.trim().length === 0)) {
        throw new Error('fleet_work claim requires non-empty paths')
      }
      const cwd = workspace(agent)
      const targets = await Promise.all(args.paths.map(path => ctx.fs.resolve(path, { cwd, signal: exec.signal })))
      const overlaps = resources.claim(agentId, targets, args.note)
      return { action: 'claim' as const, claims: resources.list(), overlaps }
    },
  }))

  register(defineTool({
    name: 'fleet_resource',
    description: 'Register an existing text or binary file by reference, or resolve and list registered Team resources.',
    parameters: {
      action: { type: 'string', required: true, enum: options.resourceWrite === false ? ['get', 'list'] as const : ['add', 'get', 'list'] as const },
      path: { type: 'string', description: 'Existing file path. Required for add.' },
      id: { type: 'string', description: 'Resource ID. Required for get.' },
      label: { type: 'string' }, media_type: { type: 'string' },
    },
    output: jsonOutput(RESOURCE_RESULT_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent, 'fleet_resource')
      if (args.action === 'list') {
        requireAccess(agent, false, 'resource')
        return { action: 'list' as const, resources: resources.listResources() }
      }
      if (args.action === 'get') {
        if (args.id === undefined || args.id.trim().length === 0) throw new Error('fleet_resource get requires id')
        requireAccess(agent, false, 'resource', args.id)
        return { action: 'get' as const, resource: resources.getResource(args.id) }
      }
      if (args.path === undefined || args.path.trim().length === 0) throw new Error('fleet_resource add requires path')
      const target = await ctx.fs.resolve(args.path, { cwd: workspace(agent), signal: exec.signal })
      requireAccess(agent, true, 'file', target.displayPath)
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

  return () => { for (const stop of stops.reverse()) stop() }
}
