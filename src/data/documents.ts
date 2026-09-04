import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'

import type { FleetAccessService } from '../authorization/access.js'
import type { FleetAuthorizationService, FleetEffectiveAuthorization } from '../authorization.js'
import type { FleetRunService } from '../run.js'
import { object, text } from '../validation.js'

export const FLEET_DOCUMENT_STATE_NAMESPACE = 'documents'

export interface FleetDocumentVersion {
  readonly version: number
  readonly updatedBy: string
  readonly updatedAt: string
}

export interface FleetDocumentComment {
  readonly id: string
  readonly author: string
  readonly text: string
  readonly parentId?: string
  readonly resolved: boolean
  readonly createdAt: string
  readonly resolvedAt?: string
  readonly resolvedBy?: string
}

export interface FleetDocument {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly path: string
  readonly content: string
  readonly version: number
  readonly versions: FleetDocumentVersion[]
  readonly comments: FleetDocumentComment[]
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedAt: string
}

interface FleetDocumentMetadata extends Omit<FleetDocument, 'content' | 'path'> {}

export interface FleetDocumentState {
  readonly version: 1
  readonly documents: readonly FleetDocumentMetadata[]
}

export interface FleetDocumentFiles {
  exists(path: string, signal?: AbortSignal): Promise<boolean>
  read(path: string, signal?: AbortSignal): Promise<string>
  write(path: string, content: string, signal?: AbortSignal): Promise<void>
}

const EMPTY_STATE: FleetDocumentState = { version: 1, documents: [] }
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const ID = /^doc_[a-f0-9-]+$/u

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`${label} must be a positive integer`)
  return value as number
}

function parseVersion(value: unknown, label: string): FleetDocumentVersion {
  const input = object(value, label)
  return {
    version: positiveInteger(input.version, `${label}.version`),
    updatedBy: text(input.updatedBy, `${label}.updatedBy`),
    updatedAt: text(input.updatedAt, `${label}.updatedAt`),
  }
}

function parseComment(value: unknown, label: string): FleetDocumentComment {
  const input = object(value, label)
  if (typeof input.resolved !== 'boolean') throw new Error(`${label}.resolved must be a boolean`)
  return {
    id: text(input.id, `${label}.id`),
    author: text(input.author, `${label}.author`),
    text: text(input.text, `${label}.text`),
    ...(input.parentId === undefined ? {} : { parentId: text(input.parentId, `${label}.parentId`) }),
    resolved: input.resolved,
    createdAt: text(input.createdAt, `${label}.createdAt`),
    ...(input.resolvedAt === undefined ? {} : { resolvedAt: text(input.resolvedAt, `${label}.resolvedAt`) }),
    ...(input.resolvedBy === undefined ? {} : { resolvedBy: text(input.resolvedBy, `${label}.resolvedBy`) }),
  }
}

function parseMetadata(value: unknown, label: string): FleetDocumentMetadata {
  const input = object(value, label)
  const id = text(input.id, `${label}.id`)
  const name = text(input.name, `${label}.name`)
  if (!ID.test(id)) throw new Error(`${label}.id is invalid`)
  if (!NAME.test(name)) throw new Error(`${label}.name must use lower-kebab-case`)
  if (!Array.isArray(input.versions) || !Array.isArray(input.comments)) {
    throw new Error(`${label} must contain versions and comments`)
  }
  const version = positiveInteger(input.version, `${label}.version`)
  const versions = input.versions.map((entry, index) => parseVersion(entry, `${label}.versions[${String(index)}]`))
  if (versions.length === 0 || versions.at(-1)?.version !== version) throw new Error(`${label}.versions do not match its current version`)
  return {
    id,
    name,
    title: text(input.title, `${label}.title`),
    version,
    versions,
    comments: input.comments.map((entry, index) => parseComment(entry, `${label}.comments[${String(index)}]`)),
    createdBy: text(input.createdBy, `${label}.createdBy`),
    createdAt: text(input.createdAt, `${label}.createdAt`),
    updatedAt: text(input.updatedAt, `${label}.updatedAt`),
  }
}

export function parseFleetDocumentState(value: JsonValue | undefined): FleetDocumentState {
  if (value === undefined) return structuredClone(EMPTY_STATE)
  const input = object(value, 'Fleet Document state')
  if (input.version !== 1 || !Array.isArray(input.documents)) {
    throw new Error('Fleet Document state must contain version 1 documents')
  }
  const documents = input.documents.map((entry, index) => parseMetadata(entry, `Fleet Document state documents[${String(index)}]`))
  if (new Set(documents.map(document => document.id)).size !== documents.length
    || new Set(documents.map(document => document.name)).size !== documents.length) {
    throw new Error('Fleet Document state contains duplicate ids or names')
  }
  return { version: 1, documents }
}

function cloneMetadata(document: FleetDocumentMetadata): FleetDocumentMetadata {
  return structuredClone(document)
}

export class FleetDocumentService {
  private readonly states = new Map<string, FleetDocumentState>()
  private readonly pending = new Map<string, Promise<void>>()

  constructor(private readonly runs: FleetRunService) {}

  state(teamId: string): FleetDocumentState {
    let state = this.states.get(teamId)
    if (state === undefined) {
      state = parseFleetDocumentState(this.runs.readExtensionState(teamId, FLEET_DOCUMENT_STATE_NAMESPACE))
      this.states.set(teamId, state)
    }
    return structuredClone(state)
  }

  has(teamId: string, id: string): boolean {
    return id === '*' || this.state(teamId).documents.some(document => document.id === id)
  }

  async list(teamId: string, files: FleetDocumentFiles, query?: string, signal?: AbortSignal): Promise<FleetDocument[]> {
    const normalized = query?.trim().toLowerCase() ?? ''
    const documents = await Promise.all(this.state(teamId).documents.map(document => this.materialize(teamId, document, files, signal)))
    return documents.filter(document => normalized.length === 0
      || document.name.toLowerCase().includes(normalized)
      || document.title.toLowerCase().includes(normalized)
      || document.content.toLowerCase().includes(normalized))
  }

  async get(teamId: string, id: string, files: FleetDocumentFiles, signal?: AbortSignal): Promise<FleetDocument> {
    return this.materialize(teamId, this.requireMetadata(teamId, id), files, signal)
  }

  async create(
    teamId: string,
    actor: string,
    input: { readonly name: string; readonly title: string; readonly content?: string },
    files: FleetDocumentFiles,
    signal?: AbortSignal,
  ): Promise<FleetDocument> {
    const name = input.name.trim()
    if (!NAME.test(name)) throw new Error('Fleet document name must use lower-kebab-case')
    const title = input.title.trim()
    if (title.length === 0) throw new Error('Fleet document title cannot be empty')
    return this.exclusive(teamId, async () => {
      const state = this.state(teamId)
      if (state.documents.some(document => document.name === name)) throw new Error(`Fleet document ${name} already exists`)
      const id = `doc_${randomUUID()}`
      const main = this.documentPath(teamId, name)
      if (await files.exists(main, signal)) throw new Error(`Fleet document file ${name}.md already exists`)
      const now = new Date().toISOString()
      const metadata: FleetDocumentMetadata = {
        id,
        name,
        title,
        version: 1,
        versions: [{ version: 1, updatedBy: actor, updatedAt: now }],
        comments: [],
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      }
      const content = input.content ?? ''
      this.ensureDirectories(teamId, metadata)
      await files.write(this.versionPath(teamId, metadata, 1), content, signal)
      await files.write(main, content, signal)
      this.save(teamId, { version: 1, documents: [...state.documents, metadata] })
      const document = await this.materialize(teamId, metadata, files, signal)
      this.recordChange(teamId, 'created', actor, document)
      return document
    })
  }

  async update(
    teamId: string,
    actor: string,
    id: string,
    input: { readonly title?: string; readonly content?: string },
    files: FleetDocumentFiles,
    signal?: AbortSignal,
  ): Promise<FleetDocument> {
    if (input.title === undefined && input.content === undefined) throw new Error('Fleet document update requires title or content')
    return this.exclusive(teamId, async () => {
      const current = this.requireMetadata(teamId, id)
      const title = input.title?.trim() ?? current.title
      if (title.length === 0) throw new Error('Fleet document title cannot be empty')
      const currentContent = await files.read(this.documentPath(teamId, current.name), signal)
      const content = input.content ?? currentContent
      const now = new Date().toISOString()
      const version = current.version + 1
      const updated: FleetDocumentMetadata = {
        ...current,
        title,
        version,
        versions: [...current.versions, { version, updatedBy: actor, updatedAt: now }],
        updatedAt: now,
      }
      this.ensureDirectories(teamId, updated)
      await files.write(this.versionPath(teamId, updated, version), content, signal)
      await files.write(this.documentPath(teamId, updated.name), content, signal)
      this.replace(teamId, updated)
      const document = await this.materialize(teamId, updated, files, signal)
      this.recordChange(teamId, 'updated', actor, document)
      return document
    })
  }

  async comment(
    teamId: string,
    actor: string,
    id: string,
    value: string,
    files: FleetDocumentFiles,
    parentId?: string,
    signal?: AbortSignal,
  ): Promise<FleetDocument> {
    const text = value.trim()
    if (text.length === 0) throw new Error('Fleet document comment cannot be empty')
    return this.exclusive(teamId, async () => {
      const current = this.requireMetadata(teamId, id)
      if (parentId !== undefined && !current.comments.some(comment => comment.id === parentId)) {
        throw new Error(`Unknown Fleet document comment: ${parentId}`)
      }
      const now = new Date().toISOString()
      const updated: FleetDocumentMetadata = {
        ...current,
        comments: [...current.comments, {
          id: `comment_${randomUUID()}`,
          author: actor,
          text,
          ...(parentId === undefined ? {} : { parentId }),
          resolved: false,
          createdAt: now,
        }],
        updatedAt: now,
      }
      this.replace(teamId, updated)
      const document = await this.materialize(teamId, updated, files, signal)
      this.recordChange(teamId, 'commented', actor, document)
      return document
    })
  }

  async resolveComment(
    teamId: string,
    actor: string,
    id: string,
    commentId: string,
    files: FleetDocumentFiles,
    signal?: AbortSignal,
  ): Promise<FleetDocument> {
    return this.exclusive(teamId, async () => {
      const current = this.requireMetadata(teamId, id)
      if (!current.comments.some(comment => comment.id === commentId)) {
        throw new Error(`Unknown Fleet document comment: ${commentId}`)
      }
      const now = new Date().toISOString()
      const updated: FleetDocumentMetadata = {
        ...current,
        comments: current.comments.map(comment => comment.id === commentId
          ? { ...comment, resolved: true, resolvedAt: now, resolvedBy: actor }
          : comment),
        updatedAt: now,
      }
      this.replace(teamId, updated)
      const document = await this.materialize(teamId, updated, files, signal)
      this.recordChange(teamId, 'resolved', actor, document)
      return document
    })
  }

  async revert(
    teamId: string,
    actor: string,
    id: string,
    targetVersion: number,
    files: FleetDocumentFiles,
    signal?: AbortSignal,
  ): Promise<FleetDocument> {
    return this.exclusive(teamId, async () => {
      const current = this.requireMetadata(teamId, id)
      if (!current.versions.some(version => version.version === targetVersion)) {
        throw new Error(`Unknown Fleet document version: ${String(targetVersion)}`)
      }
      await files.read(this.documentPath(teamId, current.name), signal)
      const content = await files.read(this.versionPath(teamId, current, targetVersion), signal)
      const now = new Date().toISOString()
      const version = current.version + 1
      const updated: FleetDocumentMetadata = {
        ...current,
        version,
        versions: [...current.versions, { version, updatedBy: actor, updatedAt: now }],
        updatedAt: now,
      }
      this.ensureDirectories(teamId, updated)
      await files.write(this.versionPath(teamId, updated, version), content, signal)
      await files.write(this.documentPath(teamId, updated.name), content, signal)
      this.replace(teamId, updated)
      const document = await this.materialize(teamId, updated, files, signal)
      this.recordChange(teamId, 'reverted', actor, document)
      return document
    })
  }

  private recordChange(
    teamId: string,
    action: 'created' | 'updated' | 'commented' | 'resolved' | 'reverted',
    actor: string,
    document: FleetDocument,
  ): void {
    const { content: _content, versions, comments, ...metadata } = document
    this.runs.recordDataEvent(teamId, `resource.document_${action}`, {
      action,
      actor,
      document: {
        ...metadata,
        versionCount: versions.length,
        commentCount: comments.length,
      },
    })
  }

  private requireMetadata(teamId: string, id: string): FleetDocumentMetadata {
    const document = this.state(teamId).documents.find(candidate => candidate.id === id)
    if (document === undefined) throw new Error(`Unknown Fleet document: ${id}`)
    return cloneMetadata(document)
  }

  private async materialize(
    teamId: string,
    metadata: FleetDocumentMetadata,
    files: FleetDocumentFiles,
    signal?: AbortSignal,
  ): Promise<FleetDocument> {
    return {
      ...cloneMetadata(metadata),
      path: join('documents', `${metadata.name}.md`),
      content: await files.read(this.documentPath(teamId, metadata.name), signal),
    }
  }

  private documentsRoot(teamId: string): string {
    const record = this.runs.status(teamId)
    return join(record.projectRoot, '.fleet', record.id, 'documents')
  }

  private documentPath(teamId: string, name: string): string {
    return join(this.documentsRoot(teamId), `${name}.md`)
  }

  private versionPath(teamId: string, document: FleetDocumentMetadata, version: number): string {
    return join(this.documentsRoot(teamId), '.history', document.id, `${String(version)}.md`)
  }

  private ensureDirectories(teamId: string, document: FleetDocumentMetadata): void {
    mkdirSync(this.documentsRoot(teamId), { recursive: true })
    mkdirSync(dirname(this.versionPath(teamId, document, document.version)), { recursive: true })
  }

  private replace(teamId: string, document: FleetDocumentMetadata): void {
    const state = this.state(teamId)
    this.save(teamId, {
      version: 1,
      documents: state.documents.map(current => current.id === document.id ? document : current),
    })
  }

  private save(teamId: string, state: FleetDocumentState): void {
    const stored = structuredClone(state)
    this.runs.writeExtensionState(teamId, FLEET_DOCUMENT_STATE_NAMESPACE, stored as unknown as JsonValue)
    this.states.set(teamId, stored)
  }

  private async exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve()
    let release = (): void => {}
    const current = new Promise<void>(resolve => { release = resolve })
    this.pending.set(key, current)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.pending.get(key) === current) this.pending.delete(key)
    }
  }
}

const DOCUMENT_VERSION_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    version: { type: 'integer', required: true },
    updatedBy: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
  },
} as const

const DOCUMENT_COMMENT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, author: { type: 'string', required: true }, text: { type: 'string', required: true },
    parentId: { type: 'string' }, resolved: { type: 'boolean', required: true }, createdAt: { type: 'string', required: true },
    resolvedAt: { type: 'string' }, resolvedBy: { type: 'string' },
  },
} as const

const DOCUMENT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, name: { type: 'string', required: true }, title: { type: 'string', required: true },
    path: { type: 'string', required: true }, content: { type: 'string', required: true }, version: { type: 'integer', required: true },
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

function callingAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('fleet_document requires a calling Agent')
  return agent
}

function documentFiles(ctx: Context, agent: Agent, execution: object & { readonly signal: AbortSignal }): FleetDocumentFiles {
  const sandboxPolicy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (ctx.fs.sandboxMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('dsh-agent-fleet: sandboxed document filesystem requires ctx.sandboxPolicy')
  }
  return {
    async exists(path, signal) {
      const target = await ctx.fs.resolve(path, signal === undefined ? {} : { signal })
      const info = await ctx.fs.stat(target, signal)
      ctx.emit('fs/observed', target, info === undefined
        ? { kind: 'absent' }
        : { kind: 'present', version: info.version }, execution)
      return info !== undefined
    },
    async read(path, signal) {
      const target = await ctx.fs.resolve(path, signal === undefined ? {} : { signal })
      const info = await ctx.fs.stat(target, signal)
      if (info === undefined) throw new Error(`Fleet document file does not exist: ${target.displayPath}`)
      const content = await ctx.fs.readText(target, signal)
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, execution)
      return content
    },
    async write(path, content, signal) {
      const target = await ctx.fs.resolve(path, signal === undefined ? {} : { signal })
      const policy = sandboxPolicy?.resolve({ session: agent.session })
      const intent = await ctx.waterfall('fs/write-intent', target, execution, () => undefined)
      const outcome = await ctx.fs.writeText(target, content, intent, signal, policy)
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, execution)
    },
  }
}

function installDocumentTool(
  ctx: Context,
  service: FleetDocumentService,
  authorization: FleetAuthorizationService,
  teamId: string,
  effective: FleetEffectiveAuthorization,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_document',
    description: 'Manage Team Markdown documents stored as real files, with version history and review comments.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'search', 'get', 'create', 'update', 'comment', 'reply', 'resolve', 'revert'] },
      id: { type: 'string' }, name: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
      query: { type: 'string' }, text: { type: 'string' }, comment_id: { type: 'string' }, version: { type: 'integer' },
    },
    output: { schema: DOCUMENT_RESULT_SCHEMA, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const agent = callingAgent(exec.agent)
      const actor = authorization.actorForAgent(String(agent.id))
      if (actor === undefined || actor.teamId !== teamId) throw new Error('calling Agent is not attached to this Fleet Team')
      const files = documentFiles(ctx, agent, exec)
      const require = (action: 'read' | 'write' | 'comment', id?: string): void => authorization.require({
        teamId,
        subject: actor.subject,
        action: `document.${action}`,
        resource: id === undefined ? { kind: 'team', id: teamId } : { kind: 'document', id },
      })
      if (args.action === 'list' || args.action === 'search') {
        require('read')
        return { action: args.action, documents: await service.list(teamId, files, args.action === 'search' ? args.query : undefined, exec.signal) }
      }
      if (args.action === 'create') {
        require('write')
        if (args.name === undefined || args.title === undefined) throw new Error('fleet_document create requires name and title')
        return { action: 'create' as const, document: await service.create(
          teamId, actor.subject.id, { name: args.name, title: args.title, ...(args.content === undefined ? {} : { content: args.content }) }, files, exec.signal,
        ) }
      }
      if (args.id === undefined) throw new Error(`fleet_document ${args.action} requires id`)
      if (args.action === 'get') {
        require('read', args.id)
        return { action: 'get' as const, document: await service.get(teamId, args.id, files, exec.signal) }
      }
      if (args.action === 'update') {
        require('write', args.id)
        return { action: 'update' as const, document: await service.update(
          teamId, actor.subject.id, args.id,
          { ...(args.title === undefined ? {} : { title: args.title }), ...(args.content === undefined ? {} : { content: args.content }) },
          files, exec.signal,
        ) }
      }
      if (args.action === 'comment' || args.action === 'reply') {
        require('comment', args.id)
        if (args.text === undefined) throw new Error(`fleet_document ${args.action} requires text`)
        if (args.action === 'reply' && args.comment_id === undefined) throw new Error('fleet_document reply requires comment_id')
        return { action: args.action, document: await service.comment(
          teamId, actor.subject.id, args.id, args.text, files,
          args.action === 'reply' ? args.comment_id : undefined, exec.signal,
        ) }
      }
      if (args.action === 'resolve') {
        require('comment', args.id)
        if (args.comment_id === undefined) throw new Error('fleet_document resolve requires comment_id')
        return { action: 'resolve' as const, document: await service.resolveComment(
          teamId, actor.subject.id, args.id, args.comment_id, files, exec.signal,
        ) }
      }
      require('write', args.id)
      if (args.version === undefined) throw new Error('fleet_document revert requires version')
      return { action: 'revert' as const, document: await service.revert(
        teamId, actor.subject.id, args.id, args.version, files, exec.signal,
      ) }
    },
  }))
}

export function applyDocuments(ctx: Context): void {
  ctx.inject(['fleetAuthorization', 'fleetAccess', 'fleetRuns', 'fs'], scope => {
    const service = new FleetDocumentService(scope.fleetRuns)
    scope.provide('fleetDocuments', service)
    const stopResource = scope.fleetAuthorization.registerResourceKind({
      kind: 'document',
      authorizeBaseline: input => input.resource?.id === '*' || service.has(input.teamId, input.resource?.id ?? ''),
    })
    const stopAdapter = (scope.fleetAccess as FleetAccessService).registerAdapter({
      kind: 'document',
      levelFor: action => action === 'document.read' ? 'read' : action === 'document.write' || action === 'document.comment' ? 'write' : undefined,
      normalize: (_teamId, resourceId) => resourceId,
    })
    const stopNamespace = scope.fleetAuthorization.registerNamespace({
      namespace: 'document',
      actions: [
        { id: 'read', description: 'Read and search Team documents.' },
        { id: 'write', description: 'Create, update, and revert Team documents.' },
        { id: 'comment', description: 'Comment on and resolve Team document reviews.' },
      ],
      defaultActions: ({ member }) => {
        const read = member.toolGroups.includes('documents') || member.permissions.includes('document.write')
        const write = member.permissions.includes('document.write')
        return [...(read ? ['read'] : []), ...(write ? ['write', 'comment'] : [])]
      },
      installTools: (memberCtx, input) => installDocumentTool(
        memberCtx, service, scope.fleetAuthorization, input.teamId, input.authorization,
      ),
    })
    return () => {
      stopNamespace()
      stopAdapter()
      stopResource()
    }
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetDocuments: FleetDocumentService
  }
}
