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

const DOCUMENT_COMMENT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, author: { type: 'string', required: true }, text: { type: 'string', required: true },
    parentId: { type: 'string' }, resolved: { type: 'boolean', required: true },
    createdAt: { type: 'string', required: true }, resolvedAt: { type: 'string' },
  },
} as const

const DOCUMENT_VERSION_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    version: { type: 'integer', required: true }, content: { type: 'string', required: true },
    updatedBy: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
  },
} as const

const DOCUMENT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, name: { type: 'string', required: true }, title: { type: 'string', required: true },
    content: { type: 'string', required: true }, version: { type: 'integer', required: true },
    versions: { type: 'array', required: true, items: DOCUMENT_VERSION_SCHEMA },
    comments: { type: 'array', required: true, items: DOCUMENT_COMMENT_SCHEMA },
    createdBy: { type: 'string', required: true }, createdAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
  },
} as const

const DOCUMENT_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'search', 'get', 'create', 'update', 'comment', 'reply', 'resolve', 'revert'] },
    document: DOCUMENT_SCHEMA, documents: { type: 'array', items: DOCUMENT_SCHEMA },
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

export interface FleetResourceToolOptions {
  readonly projectRoot?: string
  readonly sharedDirectory?: string
  readonly canWrite?: (agentId: string) => boolean
  readonly canWriteDocument?: (agentId: string) => boolean
  readonly resources?: boolean
  readonly documents?: boolean
  readonly resourceWrite?: boolean
  readonly documentWrite?: boolean
  readonly workspacesFor?: (agentId: string) => readonly { readonly path: string; readonly access: 'read' | 'write' }[]
}

export function apply(ctx: Context): void {
  const resources = new FleetResources(ctx.fs)
  ctx.provide('fleetResources', resources)

  installResourceTools(ctx, resources)
}

export function installResourceTools(
  ctx: Context,
  resources: FleetResources,
  options: FleetResourceToolOptions = {},
): () => void {
  const stops: Array<() => void> = [
    ctx.on('agent/disposed', ({ agent }) => { resources.release(String(agent.id)) }),
  ]
  const register = (tool: Parameters<typeof ctx.tools.register>[0]): void => {
    stops.push(ctx.tools.register(tool))
  }

  const sandboxPolicy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (ctx.fs.sandboxMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('dsh-agent-fleet-resources: sandboxed filesystem requires ctx.sandboxPolicy')
  }
  const requireWrite = (agent: Agent): void => {
    if (options.canWrite?.(String(agent.id)) === false) {
      throw new Error(`Agent ${String(agent.id)} lacks Fleet permission resource.write`)
    }
  }
  const requireDocumentWrite = (agent: Agent): void => {
    if (options.canWriteDocument?.(String(agent.id)) === false) {
      throw new Error(`Agent ${String(agent.id)} lacks Fleet permission document.write`)
    }
  }
  const requireWorkspace = async (agent: Agent, target: FsTarget, write: boolean, signal: AbortSignal): Promise<void> => {
    if (options.workspacesFor === undefined) return
    const workspaces = options.workspacesFor(String(agent.id))
      .filter(workspace => !write || workspace.access === 'write')
    const roots = await Promise.all(workspaces.map(workspace => ctx.fs.resolve(workspace.path, { signal })))
    if (!roots.some(root => ctx.fs.contains(root, target))) {
      throw new Error(`Path ${target.displayPath} is outside this Fleet member's ${write ? 'writable ' : ''}workspaces`)
    }
  }

  if (options.resources !== false) {
  register(defineTool({
    name: 'fleet_shared',
    description: 'Read or replace the Fleet plan or checklist in the current session workspace. Read an existing file before replacing it.',
    parameters: {
      action: { type: 'string', required: true, enum: options.resourceWrite === false
        ? ['read'] as const
        : ['read', 'write'] as const },
      name: { type: 'string', required: true, enum: ['plan', 'checklist'] },
      content: { type: 'string', description: 'Complete Markdown content. Required for write.' },
    },
    output: jsonOutput(SHARED_RESULT_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent, 'fleet_shared')
      const file = options.sharedDirectory === undefined
        ? sharedPath(args.name)
        : `${options.sharedDirectory}/${args.name}.md`
      const policy = sandboxPolicy?.resolve({ session: agent.session })
      const target = await ctx.fs.resolve(file, {
        cwd: options.projectRoot ?? sharedWorkspace(ctx, agent),
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

      requireWrite(agent)
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
      resources.addResource(String(agent.id), {
        id: `shared:${args.name}`,
        path: ctx.fs.processPath(target),
        label: `${args.name}.md`,
        mediaType: 'text/markdown',
        size: new TextEncoder().encode(args.content).byteLength,
      })
      resources.recordRevision(String(agent.id), `shared:${args.name}`, outcome.before, outcome.after)
      return {
        action: 'write' as const,
        name: args.name,
        path: target.displayPath,
        exists: true,
      }
    },
  }))

  register(defineTool({
    name: 'fleet_work',
    description: 'Declare, release, or list the file and directory paths Fleet Agents are currently working on. Overlaps are advisory and never block work.',
    parameters: {
      action: { type: 'string', required: true, enum: options.resourceWrite === false
        ? ['list'] as const
        : ['list', 'claim', 'release'] as const },
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
        requireWrite(agent)
        resources.release(agentId)
        return { action: 'release' as const, claims: resources.list(), overlaps: [] }
      }
      if (args.paths === undefined || args.paths.length === 0) {
        throw new Error('fleet_work claim requires at least one path')
      }
      if (args.paths.some(path => path.trim().length === 0)) {
        throw new Error('fleet_work paths must be non-empty')
      }
      requireWrite(agent)
      const cwd = workspace(agent)
      const targets: FsTarget[] = await Promise.all(args.paths.map(path => ctx.fs.resolve(path, {
        cwd,
        signal: exec.signal,
      })))
      await Promise.all(targets.map(target => requireWorkspace(agent, target, true, exec.signal)))
      const overlaps = resources.claim(agentId, targets, args.note)
      return { action: 'claim' as const, claims: resources.list(), overlaps }
    },
  }))

  register(defineTool({
    name: 'fleet_resource',
    description: 'Register an existing regular file as a Fleet resource, or resolve and list registered resources. The file is referenced in place and may contain text or binary data.',
    parameters: {
      action: { type: 'string', required: true, enum: options.resourceWrite === false
        ? ['get', 'list'] as const
        : ['add', 'get', 'list'] as const },
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
      requireWrite(agent)
      const target = await ctx.fs.resolve(args.path, {
        cwd: workspace(agent),
        signal: exec.signal,
      })
      await requireWorkspace(agent, target, false, exec.signal)
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

  if (options.documents !== false) {
  register(defineTool({
    name: 'fleet_document',
    description: 'Manage persistent shared Markdown documents, versions, comments, replies, resolution, search, and reverts.',
    parameters: {
      action: { type: 'string', required: true, enum: options.documentWrite === false
        ? ['list', 'search', 'get'] as const
        : ['list', 'search', 'get', 'create', 'update', 'comment', 'reply', 'resolve', 'revert'] as const },
      id: { type: 'string' }, name: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
      query: { type: 'string' }, text: { type: 'string' }, comment_id: { type: 'string' }, version: { type: 'integer' },
    },
    output: jsonOutput(DOCUMENT_RESULT_SCHEMA),
    execute(args, exec) {
      const agent = callingAgent(exec.agent, 'fleet_document')
      const agentId = String(agent.id)
      if (args.action === 'list' || args.action === 'search') {
        return Promise.resolve({ action: args.action, documents: resources.listDocuments(args.action === 'search' ? args.query : undefined) })
      }
      if (args.action === 'create') {
        requireDocumentWrite(agent)
        if (args.name === undefined || args.title === undefined) throw new Error('fleet_document create requires name and title')
        return Promise.resolve({ action: 'create' as const, document: resources.createDocument(agentId, {
          name: args.name, title: args.title, ...(args.content === undefined ? {} : { content: args.content }),
        }) })
      }
      if (args.id === undefined) throw new Error(`fleet_document ${args.action} requires id`)
      if (args.action === 'get') return Promise.resolve({ action: 'get' as const, document: resources.getDocument(args.id) })
      requireDocumentWrite(agent)
      if (args.action === 'update') return Promise.resolve({ action: 'update' as const, document: resources.updateDocument(agentId, args.id, {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.content === undefined ? {} : { content: args.content }),
      }) })
      if (args.action === 'comment' || args.action === 'reply') {
        if (args.text === undefined) throw new Error(`fleet_document ${args.action} requires text`)
        if (args.action === 'reply' && args.comment_id === undefined) throw new Error('fleet_document reply requires comment_id')
        return Promise.resolve({ action: args.action, document: resources.commentDocument(
          agentId, args.id, args.text, args.action === 'reply' ? args.comment_id : undefined,
        ) })
      }
      if (args.action === 'resolve') {
        if (args.comment_id === undefined) throw new Error('fleet_document resolve requires comment_id')
        return Promise.resolve({ action: 'resolve' as const, document: resources.resolveDocumentComment(agentId, args.id, args.comment_id) })
      }
      if (args.version === undefined) throw new Error('fleet_document revert requires version')
      return Promise.resolve({ action: 'revert' as const, document: resources.revertDocument(agentId, args.id, args.version) })
    },
  }))
  }
  return () => {
    for (const stop of stops.reverse()) stop()
  }
}
