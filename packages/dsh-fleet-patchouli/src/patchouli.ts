export type MemoryData = unknown

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

export interface PatchouliCore {
  register(plugin: MemoryPlugin): () => void
  update(request: MemoryRequest, signal?: AbortSignal): Promise<readonly MemoryPluginOutcome[]>
  retrieve(request: MemoryRequest, signal?: AbortSignal): Promise<readonly MemoryPluginOutcome[]>
}
