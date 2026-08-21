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
  readonly path: string
  readonly label?: string
  readonly mediaType?: string
  readonly size?: number
}

export type FleetResourceEvent =
  | { readonly type: 'work_claimed'; readonly claim: WorkClaim; readonly overlaps: WorkOverlap[] }
  | { readonly type: 'work_released'; readonly agentId: string }
  | { readonly type: 'resource_added'; readonly resource: FleetResource }

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
      id: `res_${randomUUID()}`,
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

  getResource(id: string): FleetResource {
    const resource = this.files.get(id)
    if (resource === undefined) throw new Error(`Unknown Fleet resource: ${id}`)
    return { ...resource }
  }

  listResources(): FleetResource[] {
    return [...this.files.values()].map(resource => ({ ...resource }))
  }

  private emit(event: FleetResourceEvent): void {
    const value = structuredClone(event)
    for (const observer of this.observers) observer(value)
  }
}
