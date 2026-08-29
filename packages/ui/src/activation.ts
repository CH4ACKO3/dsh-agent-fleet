import {
  encodeFleetActivation,
  parseFleetActivation,
  type FleetActivationRequest,
} from '@dsh-agent-fleet/core/activation'

export interface StagedFleetActivation {
  readonly id: number
  /** Undefined while a workspace-backed native new Session is still being materialized. */
  readonly sessionId?: string
  readonly request: FleetActivationRequest
}

export interface FleetActivationClientSessions {
  readonly list: {
    getSnapshot(): {
      readonly current?: string
      readonly byId: Readonly<Record<string, unknown>>
    }
    subscribe(listener: () => void): () => void
  }
  open(sessionId: string): void
}

export interface FleetActivationClientWorkspaces {
  readonly list: {
    getSnapshot(): { readonly archivedSessionIds: readonly string[] }
  }
}

export interface FleetAssistantConnectionReference {
  readonly assistantId: string
  readonly assistantName?: string
  readonly sessionId: string
}

export type FleetExistingAssistantRoute =
  | { readonly kind: 'create' }
  | { readonly kind: 'open'; readonly assistants: readonly FleetAssistantConnectionReference[] }
  | { readonly kind: 'reconnect'; readonly assistants: readonly FleetAssistantConnectionReference[] }

let sequence = 0
let sessions: FleetActivationClientSessions | undefined
let workspaces: FleetActivationClientWorkspaces | undefined
const snapshots = new Map<string, StagedFleetActivation>()
let nextSessionSnapshot: StagedFleetActivation | undefined
const listeners = new Set<() => void>()

function publish(): void {
  for (const listener of listeners) listener()
}

export function configureFleetActivationSessions(next: FleetActivationClientSessions | undefined): void {
  sessions = next
}

export function configureFleetActivationWorkspaces(next: FleetActivationClientWorkspaces | undefined): void {
  workspaces = next
}

export function classifyFleetExistingAssistants(
  assistants: readonly FleetAssistantConnectionReference[],
  knownSessionIds: readonly string[],
  archivedSessionIds: readonly string[],
): FleetExistingAssistantRoute {
  if (assistants.length === 0) return { kind: 'create' }
  const known = new Set(knownSessionIds)
  const archived = new Set(archivedSessionIds)
  const available = assistants.filter(assistant =>
    known.has(assistant.sessionId) && !archived.has(assistant.sessionId))
  return available.length > 0
    ? { kind: 'open', assistants: available }
    : { kind: 'reconnect', assistants }
}

export function fleetExistingAssistantRoute(
  assistants: readonly FleetAssistantConnectionReference[],
): FleetExistingAssistantRoute {
  return classifyFleetExistingAssistants(
    assistants,
    Object.keys(sessions?.list.getSnapshot().byId ?? {}),
    workspaces?.list.getSnapshot().archivedSessionIds ?? [],
  )
}

export function openFleetSession(sessionId: string): void {
  if (sessions === undefined) throw new Error('DSH Session service is unavailable')
  if (sessions.list.getSnapshot().byId[sessionId] === undefined) {
    throw new Error(`Session ${sessionId} is unavailable`)
  }
  if (workspaces?.list.getSnapshot().archivedSessionIds.includes(sessionId) === true) {
    throw new Error(`Session ${sessionId} is archived`)
  }
  sessions.open(sessionId)
}

export function getCurrentFleetSessionId(): string | undefined {
  return sessions?.list.getSnapshot().current
}

export function subscribeCurrentFleetSession(listener: () => void): () => void {
  return sessions?.list.subscribe(listener) ?? (() => {})
}

export function stageFleetActivation(
  sessionId: string | undefined,
  request: FleetActivationRequest,
): StagedFleetActivation {
  const activation: StagedFleetActivation = {
    id: ++sequence,
    request,
    ...(sessionId === undefined ? {} : { sessionId }),
  }
  if (sessionId === undefined) nextSessionSnapshot = activation
  else snapshots.set(sessionId, activation)
  publish()
  return activation
}

export function clearFleetActivation(sessionId: string | undefined, id?: number): void {
  const snapshot = sessionId === undefined ? nextSessionSnapshot : snapshots.get(sessionId)
  if (id !== undefined && snapshot?.id !== id) return
  if (sessionId === undefined) {
    if (nextSessionSnapshot === undefined) return
    nextSessionSnapshot = undefined
  } else if (!snapshots.delete(sessionId)) return
  publish()
}

export function consumeFleetActivation(sessionId: string | undefined, text: string): string | undefined {
  const activation = sessionId === undefined
    ? nextSessionSnapshot
    : snapshots.get(sessionId) ?? nextSessionSnapshot
  if (activation === undefined) return undefined
  const encoded = encodeFleetActivation(activation.request, text)
  clearFleetActivation(activation.sessionId, activation.id)
  return encoded
}

/** Restore a failed native submission without exposing the private envelope in the composer. */
export function recoverFleetActivationDraft(sessionId: string, text: string): string | undefined {
  const parsed = parseFleetActivation(text)
  if (parsed === undefined) return undefined
  stageFleetActivation(sessionId, parsed.request)
  return parsed.text
}

export function getFleetActivationSnapshot(
  sessionId: string | undefined,
  includeNextSession = false,
): StagedFleetActivation | null {
  const exact = sessionId === undefined ? undefined : snapshots.get(sessionId)
  return exact ?? (includeNextSession ? nextSessionSnapshot : undefined) ?? null
}

export function subscribeFleetActivation(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
