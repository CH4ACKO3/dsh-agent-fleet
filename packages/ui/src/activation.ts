import {
  encodeFleetActivation,
  parseFleetActivation,
  type FleetActivationRequest,
} from '@dsh-agent-fleet/core/activation'

export interface StagedFleetActivation {
  readonly id: number
  readonly sessionId: string
  readonly request: FleetActivationRequest
}

export interface FleetActivationClientSessions {
  readonly list: {
    getSnapshot(): { readonly current?: string }
    subscribe(listener: () => void): () => void
  }
}

let sequence = 0
let sessions: FleetActivationClientSessions | undefined
const snapshots = new Map<string, StagedFleetActivation>()
const listeners = new Set<() => void>()

function publish(): void {
  for (const listener of listeners) listener()
}

export function configureFleetActivationSessions(next: FleetActivationClientSessions | undefined): void {
  sessions = next
}

export function getCurrentFleetSessionId(): string | undefined {
  return sessions?.list.getSnapshot().current
}

export function subscribeCurrentFleetSession(listener: () => void): () => void {
  return sessions?.list.subscribe(listener) ?? (() => {})
}

export function stageFleetActivation(
  sessionId: string,
  request: FleetActivationRequest,
): StagedFleetActivation {
  const activation = { id: ++sequence, sessionId, request } as const
  snapshots.set(sessionId, activation)
  publish()
  return activation
}

export function clearFleetActivation(sessionId: string, id?: number): void {
  const snapshot = snapshots.get(sessionId)
  if (id !== undefined && snapshot?.id !== id) return
  if (!snapshots.delete(sessionId)) return
  publish()
}

export function consumeFleetActivation(sessionId: string, text: string): string | undefined {
  const activation = snapshots.get(sessionId)
  if (activation === undefined) return undefined
  const encoded = encodeFleetActivation(activation.request, text)
  clearFleetActivation(sessionId, activation.id)
  return encoded
}

/** Restore a failed native submission without exposing the private envelope in the composer. */
export function recoverFleetActivationDraft(sessionId: string, text: string): string | undefined {
  const parsed = parseFleetActivation(text)
  if (parsed === undefined) return undefined
  stageFleetActivation(sessionId, parsed.request)
  return parsed.text
}

export function getFleetActivationSnapshot(sessionId: string | undefined): StagedFleetActivation | null {
  return sessionId === undefined ? null : snapshots.get(sessionId) ?? null
}

export function subscribeFleetActivation(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
