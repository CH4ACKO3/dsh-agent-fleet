import { randomUUID } from 'node:crypto'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'

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

export type FleetResourceEvent =
  | { readonly type: 'work_claimed'; readonly claim: WorkClaim; readonly overlaps: WorkOverlap[] }
  | { readonly type: 'work_released'; readonly agentId: string }
  | { readonly type: 'resource_added'; readonly resource: FleetResource }
  | { readonly type: 'resource_revised'; readonly revision: FleetResourceRevision }

interface StoredWorkClaim extends WorkClaim {
  readonly targets: readonly FsTarget[]
}

export class FleetResources {
  private readonly claims = new Map<string, StoredWorkClaim>()
  private readonly files = new Map<string, FleetResource>()
  private readonly observers = new Set<(event: FleetResourceEvent) => void>()

  constructor(private readonly fs: Pick<FileSystem, 'contains'>) {}

  onEvent(observer: (event: FleetResourceEvent) => void): () => void {
    this.observers.add(observer)
    return () => { this.observers.delete(observer) }
  }

  reset(): void {
    this.claims.clear()
    this.files.clear()
  }

  restoreResources(resources: readonly FleetResource[]): void {
    this.files.clear()
    for (const resource of resources) this.files.set(resource.id, structuredClone(resource))
  }

  restoreClaims(claims: readonly { readonly agentId: string; readonly paths: readonly string[]; readonly targets: readonly FsTarget[]; readonly note?: string }[]): void {
    this.claims.clear()
    for (const claim of claims) {
      this.claims.set(claim.agentId, {
        agentId: claim.agentId,
        paths: [...claim.paths],
        targets: [...claim.targets],
        ...(claim.note === undefined ? {} : { note: claim.note }),
      })
    }
  }

  claim(agentId: string, targets: readonly FsTarget[], note?: string): WorkOverlap[] {
    const uniqueTargets = targets.filter((target, index) =>
      targets.findIndex(candidate => candidate.displayPath === target.displayPath) === index)
    const overlaps: WorkOverlap[] = []
    for (const [otherAgent, current] of this.claims) {
      if (otherAgent === agentId) continue
      for (const requested of uniqueTargets) {
        for (const existing of current.targets) {
          if (!this.fs.contains(requested, existing) && !this.fs.contains(existing, requested)) continue
          overlaps.push({ agentId: otherAgent, path: requested.displayPath, conflictingPath: existing.displayPath })
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
      claim: { agentId, paths: [...claim.paths], ...(claim.note === undefined ? {} : { note: claim.note }) },
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
      .map(({ agentId, paths, note }) => ({ agentId, paths, ...(note === undefined ? {} : { note }) }))
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

  recordRevision(agentId: string, resourceId: string, before: string | null, after: string): FleetResourceRevision | undefined {
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

  private emit(event: FleetResourceEvent): void {
    for (const observer of this.observers) observer(event)
  }
}
