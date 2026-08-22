import { randomUUID } from 'node:crypto'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'

export type SharedFileName = 'plan' | 'checklist'

export interface WorkClaim {
  readonly agentId: string
  readonly paths: string[]
  readonly note?: string
}

export interface WorkOverlap {
  readonly agentId: string
  readonly path: string
  readonly conflictingPath: string
}

export interface FleetResource {
  readonly id: string
  readonly path: string
  readonly label?: string
  readonly mediaType?: string
  readonly size?: number
  readonly createdBy: string
  readonly createdAt: string
}

export interface AddFleetResourceInput {
  readonly id?: string
  readonly path: string
  readonly label?: string
  readonly mediaType?: string
  readonly size?: number
}

export interface FleetResourceRevision {
  readonly id: string
  readonly resourceId: string
  readonly before: string | null
  readonly after: string
  readonly updatedBy: string
  readonly updatedAt: string
}

export interface FleetDocumentVersion {
  readonly version: number
  readonly content: string
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
}

export interface FleetDocument {
  readonly id: string
  readonly name: string
  readonly title: string
  readonly content: string
  readonly version: number
  readonly versions: FleetDocumentVersion[]
  readonly comments: FleetDocumentComment[]
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedAt: string
}

export type FleetResourceEvent =
  | { readonly type: 'work_claimed'; readonly claim: WorkClaim; readonly overlaps: WorkOverlap[] }
  | { readonly type: 'work_released'; readonly agentId: string }
  | { readonly type: 'resource_added'; readonly resource: FleetResource }
  | { readonly type: 'resource_revised'; readonly revision: FleetResourceRevision }
  | { readonly type: 'document_created' | 'document_updated' | 'document_commented' | 'document_resolved' | 'document_reverted'; readonly document: FleetDocument }

interface StoredWorkClaim extends WorkClaim {
  readonly targets: readonly FsTarget[]
}

const SHARED_PATHS: Record<SharedFileName, string> = {
  plan: '.fleet/plan.md',
  checklist: '.fleet/checklist.md',
}

export function sharedPath(name: SharedFileName): string {
  return SHARED_PATHS[name]
}

export class FleetResources {
  private readonly claims = new Map<string, StoredWorkClaim>()
  private readonly files = new Map<string, FleetResource>()
  private readonly documents = new Map<string, FleetDocument>()
  private readonly observers = new Set<(event: FleetResourceEvent) => void>()

  constructor(private readonly fs: Pick<FileSystem, 'contains'>) {}

  onEvent(observer: (event: FleetResourceEvent) => void): () => void {
    this.observers.add(observer)
    return () => { this.observers.delete(observer) }
  }

  reset(): void {
    this.claims.clear()
    this.files.clear()
    this.documents.clear()
  }

  restoreResources(resources: readonly FleetResource[]): void {
    this.files.clear()
    for (const resource of resources) this.files.set(resource.id, structuredClone(resource))
  }

  restoreDocuments(events: readonly Extract<FleetResourceEvent, { document: FleetDocument }>[]): void {
    this.documents.clear()
    for (const event of events) this.documents.set(event.document.id, structuredClone(event.document))
  }

  claim(agentId: string, targets: readonly FsTarget[], note?: string): WorkOverlap[] {
    const uniqueTargets = [...new Map(targets.map(target => [target.targetKey, target])).values()]
    const overlaps: WorkOverlap[] = []

    for (const [otherAgentId, other] of this.claims) {
      if (otherAgentId === agentId) continue
      for (const target of uniqueTargets) {
        for (const otherTarget of other.targets) {
          if (!this.fs.contains(target, otherTarget) && !this.fs.contains(otherTarget, target)) continue
          overlaps.push({
            agentId: otherAgentId,
            path: target.displayPath,
            conflictingPath: otherTarget.displayPath,
          })
        }
      }
    }

    const claim: StoredWorkClaim = {
      agentId,
      paths: uniqueTargets.map(target => target.displayPath),
      targets: uniqueTargets,
      ...(note === undefined ? {} : { note }),
    }
    this.claims.set(agentId, claim)
    this.emit({
      type: 'work_claimed',
      claim: {
        agentId,
        paths: [...claim.paths],
        ...(claim.note === undefined ? {} : { note: claim.note }),
      },
      overlaps,
    })
    return overlaps
  }

  release(agentId: string): void {
    if (this.claims.delete(agentId)) this.emit({ type: 'work_released', agentId })
  }

  list(): WorkClaim[] {
    return [...this.claims.values()]
      .sort((left, right) => left.agentId.localeCompare(right.agentId))
      .map(({ agentId, paths, note }) => ({
        agentId,
        paths,
        ...(note === undefined ? {} : { note }),
      }))
  }

  addResource(agentId: string, input: AddFleetResourceInput): FleetResource {
    const resource: FleetResource = {
      id: input.id ?? `res_${randomUUID()}`,
      path: input.path,
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
      ...(input.size === undefined ? {} : { size: input.size }),
      createdBy: agentId,
      createdAt: new Date().toISOString(),
    }
    this.files.set(resource.id, resource)
    this.emit({ type: 'resource_added', resource })
    return { ...resource }
  }

  recordRevision(
    agentId: string,
    resourceId: string,
    before: string | null,
    after: string,
  ): FleetResourceRevision | undefined {
    this.getResource(resourceId)
    if (before === after) return undefined
    const revision: FleetResourceRevision = {
      id: `rev_${randomUUID()}`,
      resourceId,
      before,
      after,
      updatedBy: agentId,
      updatedAt: new Date().toISOString(),
    }
    this.emit({ type: 'resource_revised', revision })
    return { ...revision }
  }

  getResource(id: string): FleetResource {
    const resource = this.files.get(id)
    if (resource === undefined) throw new Error(`Unknown Fleet resource: ${id}`)
    return { ...resource }
  }

  listResources(): FleetResource[] {
    return [...this.files.values()].map(resource => ({ ...resource }))
  }

  listDocuments(query?: string): FleetDocument[] {
    const normalized = query?.trim().toLowerCase()
    return [...this.documents.values()]
      .filter(document => normalized === undefined || normalized.length === 0
        || document.name.toLowerCase().includes(normalized)
        || document.title.toLowerCase().includes(normalized)
        || document.content.toLowerCase().includes(normalized))
      .map(document => structuredClone(document))
  }

  getDocument(id: string): FleetDocument {
    const document = this.documents.get(id)
    if (document === undefined) throw new Error(`Unknown Fleet document: ${id}`)
    return structuredClone(document)
  }

  createDocument(agentId: string, input: { readonly name: string; readonly title: string; readonly content?: string }): FleetDocument {
    const name = input.name.trim()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('Fleet document name must use lower-kebab-case')
    if ([...this.documents.values()].some(document => document.name === name)) {
      throw new Error(`Fleet document ${name} already exists`)
    }
    const title = input.title.trim()
    if (title.length === 0) throw new Error('Fleet document title cannot be empty')
    const now = new Date().toISOString()
    const content = input.content ?? ''
    const version: FleetDocumentVersion = { version: 1, content, updatedBy: agentId, updatedAt: now }
    const document: FleetDocument = {
      id: `doc_${randomUUID()}`,
      name,
      title,
      content,
      version: 1,
      versions: [version],
      comments: [],
      createdBy: agentId,
      createdAt: now,
      updatedAt: now,
    }
    this.documents.set(document.id, document)
    this.emit({ type: 'document_created', document })
    return structuredClone(document)
  }

  updateDocument(agentId: string, id: string, input: { readonly title?: string; readonly content?: string }): FleetDocument {
    const current = this.requireDocument(id)
    if (input.title === undefined && input.content === undefined) throw new Error('Fleet document update requires title or content')
    const now = new Date().toISOString()
    const content = input.content ?? current.content
    const version = current.version + 1
    const updated: FleetDocument = {
      ...current,
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      content,
      version,
      versions: [...current.versions, { version, content, updatedBy: agentId, updatedAt: now }],
      updatedAt: now,
    }
    if (updated.title.length === 0) throw new Error('Fleet document title cannot be empty')
    this.documents.set(id, updated)
    this.emit({ type: 'document_updated', document: updated })
    return structuredClone(updated)
  }

  commentDocument(agentId: string, id: string, text: string, parentId?: string): FleetDocument {
    const current = this.requireDocument(id)
    const content = text.trim()
    if (content.length === 0) throw new Error('Fleet document comment cannot be empty')
    if (parentId !== undefined && !current.comments.some(comment => comment.id === parentId)) {
      throw new Error(`Unknown Fleet document comment: ${parentId}`)
    }
    const comment: FleetDocumentComment = {
      id: `comment_${randomUUID()}`,
      author: agentId,
      text: content,
      ...(parentId === undefined ? {} : { parentId }),
      resolved: false,
      createdAt: new Date().toISOString(),
    }
    const updated = { ...current, comments: [...current.comments, comment], updatedAt: comment.createdAt }
    this.documents.set(id, updated)
    this.emit({ type: 'document_commented', document: updated })
    return structuredClone(updated)
  }

  resolveDocumentComment(agentId: string, id: string, commentId: string): FleetDocument {
    const current = this.requireDocument(id)
    const comment = current.comments.find(candidate => candidate.id === commentId)
    if (comment === undefined) throw new Error(`Unknown Fleet document comment: ${commentId}`)
    const now = new Date().toISOString()
    const updated = {
      ...current,
      comments: current.comments.map(candidate => candidate.id === commentId
        ? { ...candidate, resolved: true, resolvedAt: now }
        : candidate),
      updatedAt: now,
    }
    this.documents.set(id, updated)
    this.emit({ type: 'document_resolved', document: updated })
    return structuredClone(updated)
  }

  revertDocument(agentId: string, id: string, version: number): FleetDocument {
    const current = this.requireDocument(id)
    const target = current.versions.find(candidate => candidate.version === version)
    if (target === undefined) throw new Error(`Unknown Fleet document version: ${version}`)
    const now = new Date().toISOString()
    const nextVersion = current.version + 1
    const updated: FleetDocument = {
      ...current,
      content: target.content,
      version: nextVersion,
      versions: [...current.versions, { version: nextVersion, content: target.content, updatedBy: agentId, updatedAt: now }],
      updatedAt: now,
    }
    this.documents.set(id, updated)
    this.emit({ type: 'document_reverted', document: updated })
    return structuredClone(updated)
  }

  private requireDocument(id: string): FleetDocument {
    const document = this.documents.get(id)
    if (document === undefined) throw new Error(`Unknown Fleet document: ${id}`)
    return document
  }

  private emit(event: FleetResourceEvent): void {
    const value = structuredClone(event)
    for (const observer of this.observers) observer(value)
  }
}
