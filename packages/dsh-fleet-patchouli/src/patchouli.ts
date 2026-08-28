export type MemoryData = unknown

export const FLEET_MEMORY_PROCESSOR_ID = 'dsh-agent-fleet-patchouli'
export const FLEET_MEMORY_EFFORTS = ['low', 'medium', 'high'] as const
export type FleetMemoryEffort = typeof FLEET_MEMORY_EFFORTS[number]
export const DEFAULT_FLEET_MEMORY_EFFORT: FleetMemoryEffort = 'medium'

export interface MemoryCallMeta {
  readonly source: { readonly type: string; readonly id: string }
  readonly scope: string
  readonly attributes?: Record<string, unknown>
}

export interface MemoryRequest {
  readonly meta: MemoryCallMeta
  readonly data: MemoryData
}

export type MemoryPluginOutcome<T = MemoryData> = {
  readonly pluginId: string
  readonly ok: true
  readonly value: T
} | {
  readonly pluginId: string
  readonly ok: false
  readonly error: string
}

export interface MemoryRouteCall {
  readonly operation: 'update' | 'retrieve' | 'subscribe'
  readonly meta: MemoryCallMeta
}

export interface MemoryPlugin {
  readonly id: string
  readonly filter?: (call: MemoryRouteCall) => boolean
  update(request: MemoryRequest, context: { readonly signal?: AbortSignal }): Promise<MemoryData>
  retrieve(request: MemoryRequest, context: { readonly signal?: AbortSignal }): Promise<MemoryData>
}

export interface FleetMemoryAlgorithmContext {
  readonly effort: FleetMemoryEffort
  readonly agent: boolean
  readonly signal?: AbortSignal
  /** Queue a successful recall for audit after the complete processor request settles. */
  readonly deferRecallAudit?: (audit: FleetMemoryRecallAudit) => void
}

export interface FleetMemoryRecallAudit {
  readonly teamId: string
  readonly member: string
  readonly resultCount: number
  readonly conversation?: string
}

export interface FleetMemoryCommittedRecallAudit extends FleetMemoryRecallAudit {
  readonly algorithm: string
  readonly effort: FleetMemoryEffort
  readonly agent: boolean
}

/** One independently selectable processing block behind the Fleet Patchouli adapter. */
export interface FleetMemoryAlgorithm {
  readonly id: string
  readonly minimumEffort?: FleetMemoryEffort
  /** Skip this block when the caller opted out of Agent participation. */
  readonly requiresAgent?: boolean
  filter(call: MemoryRouteCall): boolean
  update?(
    request: MemoryRequest,
    context: FleetMemoryAlgorithmContext,
  ): Promise<MemoryData>
  retrieve?(
    request: MemoryRequest,
    context: FleetMemoryAlgorithmContext,
  ): Promise<MemoryData>
}

export function fleetMemoryEffort(
  meta: MemoryCallMeta,
  fallback: FleetMemoryEffort = DEFAULT_FLEET_MEMORY_EFFORT,
): FleetMemoryEffort {
  const effort = meta.attributes?.fleetEffort
  return effort === 'low' || effort === 'medium' || effort === 'high' ? effort : fallback
}

export function fleetMemoryEffortForCall(call: MemoryRouteCall): FleetMemoryEffort {
  return fleetMemoryEffort(call.meta)
}

export function fleetMemoryEffortForRequest(
  operation: 'update' | 'retrieve',
  request: MemoryRequest,
  fallback: FleetMemoryEffort = DEFAULT_FLEET_MEMORY_EFFORT,
): FleetMemoryEffort {
  const routed = request.meta.attributes?.fleetEffort
  if (routed === 'low' || routed === 'medium' || routed === 'high') return routed
  if (operation === 'retrieve' && typeof request.data === 'object' && request.data !== null
    && !Array.isArray(request.data)) {
    const metadata = (request.data as Record<string, unknown>).metadata
    if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
      const requested = (metadata as Record<string, unknown>).fleetEffort
      if (requested === 'low' || requested === 'medium' || requested === 'high') return requested
    }
  }
  return fallback
}

export function fleetMemoryAgentForRequest(
  operation: 'update' | 'retrieve',
  request: MemoryRequest,
  fallback = true,
): boolean {
  const routed = request.meta.attributes?.fleetAgent
  if (typeof routed === 'boolean') return routed
  if (operation === 'retrieve' && typeof request.data === 'object' && request.data !== null
    && !Array.isArray(request.data)) {
    const metadata = (request.data as Record<string, unknown>).metadata
    if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
      const requested = (metadata as Record<string, unknown>).fleetAgent
      if (typeof requested === 'boolean') return requested
    }
  }
  return fallback
}

export function fleetMemoryEffortAtLeast(
  actual: FleetMemoryEffort,
  required: FleetMemoryEffort,
): boolean {
  return FLEET_MEMORY_EFFORTS.indexOf(actual) >= FLEET_MEMORY_EFFORTS.indexOf(required)
}

export interface PatchouliCore {
  register(plugin: MemoryPlugin): () => void
  update(request: MemoryRequest, signal?: AbortSignal): Promise<readonly MemoryPluginOutcome[]>
  retrieve(request: MemoryRequest, signal?: AbortSignal): Promise<readonly MemoryPluginOutcome[]>
}
