export interface FleetPanelNavigationRequest {
  readonly revision: number
  readonly sessionId: string
  readonly teamId: string
  readonly memberId: string
  readonly target: 'details' | 'context'
}

let revision = 0
let request: FleetPanelNavigationRequest | undefined
const listeners = new Set<() => void>()

function publish(): void {
  for (const listener of listeners) listener()
}

export function requestFleetPanelNavigation(
  input: Omit<FleetPanelNavigationRequest, 'revision'>,
): void {
  request = { ...input, revision: ++revision }
  publish()
}

export function completeFleetPanelNavigation(requestRevision: number): void {
  if (request?.revision !== requestRevision) return
  request = undefined
  publish()
}

export function subscribeFleetPanelNavigation(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getFleetPanelNavigationRequest(): FleetPanelNavigationRequest | undefined {
  return request
}
