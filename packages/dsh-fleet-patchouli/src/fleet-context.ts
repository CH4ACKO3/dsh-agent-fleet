import type { Context } from '@deepseek-ai/cordis'
import type { FleetRunRecord } from 'dsh-agent-fleet'

import type {
  FleetMemoryEffort,
  MemoryRequest,
  MemoryRouteCall,
} from './patchouli.js'

export interface SessionSearchHit {
  readonly sessionId: string
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly snippet: string
}

export interface SessionSearchDocument extends Omit<SessionSearchHit, 'snippet'> {
  readonly text: string
}

export interface SessionEventLike {
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly data: unknown
}

export interface SessionQueryLike {
  searchEvents(request: {
    readonly sessionId: string
    readonly query: string
    readonly filters?: readonly { readonly kind: 'type'; readonly values: readonly string[] }[]
    readonly limit?: number
    readonly cursor?: unknown
  }, exec?: { readonly signal?: AbortSignal }): Promise<{
    readonly items: readonly SessionSearchHit[]
    readonly nextCursor?: unknown
  }>
  filterEvents(sessionId: string, filters: readonly (
    | { readonly kind: 'type'; readonly values: readonly string[] }
    | { readonly kind: 'text'; readonly text: string }
  )[]): Promise<readonly SessionSearchDocument[]>
  readSession(sessionId: string): Promise<{ readonly events: readonly SessionEventLike[] }>
  readEvent?(request: {
    readonly sessionId: string
    readonly seq: number
    readonly before?: number
    readonly after?: number
  }, signal?: AbortSignal): Promise<{
    readonly target: SessionEventLike
    readonly events: readonly SessionEventLike[]
  }>
}

interface SessionArchiveLike {
  find(logicalId: string): Promise<{
    readonly activeSessionId: string
    readonly segments: readonly { readonly sessionId: string }[]
  } | undefined>
}

export interface FleetRunsLike {
  list(): FleetRunRecord[]
  recordDataEvent(runId: string, type: 'memory.recalled', data: unknown): void
  participantSessionIds(runId: string, participant: string): string[]
  /** Search the stable Fleet message log, newest messages first. */
  searchParticipantMessages(
    runId: string,
    participant: string,
    query: string,
    limit: number,
  ): Promise<readonly FleetMessageLike[]>
}

export interface FleetMessageLike {
  readonly id: string
  readonly sequence: number
  readonly conversation: string
  readonly conversationId?: string
  readonly from: string
  readonly text: string
  readonly createdAt: string
}

export interface FleetCaller {
  readonly team: FleetRunRecord
  readonly participant: string
  readonly kind: 'member' | 'assistant'
  readonly sessionId: string
}

export interface SearchedSession {
  readonly sessionId: string
  readonly events: readonly SessionEventLike[]
  readonly hits: readonly SessionSearchHit[]
  readonly mode: 'full-text' | 'full-text-unavailable' | 'event-read-unavailable'
}

export function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

export function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function service<T>(ctx: Context, name: string): T | undefined {
  return ctx.get(name, false) as T | undefined
}

export function requestQuery(request: MemoryRequest): string | undefined {
  return string(record(request.data)?.query)?.trim() || undefined
}

export function callerSessionId(call: MemoryRouteCall): string | undefined {
  if (call.operation !== 'retrieve' || call.meta.source.type !== 'agent-loop') return undefined
  return string(call.meta.attributes?.sessionId)
}

export function fleetCaller(runs: FleetRunsLike, sessionId: string): FleetCaller | undefined {
  for (const team of runs.list()) {
    const member = team.members.find(candidate => candidate.sessionId === sessionId)
    if (member !== undefined) {
      return { team, participant: member.name, kind: 'member', sessionId }
    }
    const assistant = team.assistants.find(candidate => candidate.sessionId === sessionId)
    if (assistant !== undefined) {
      return { team, participant: assistant.view.id, kind: 'assistant', sessionId }
    }
  }
  return undefined
}

export function positiveLimit(value: unknown, effort: FleetMemoryEffort): number {
  const maximum = effort === 'low' ? 10 : effort === 'medium' ? 50 : 100
  const fallback = effort === 'low' ? 10 : effort === 'medium' ? 20 : 50
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback
}

export async function participantSessions(
  ctx: Context,
  runs: FleetRunsLike,
  caller: FleetCaller,
  effort: FleetMemoryEffort,
): Promise<string[]> {
  if (effort === 'low') return [caller.sessionId]
  const known = runs.participantSessionIds(caller.team.id, caller.participant)
  if (caller.kind !== 'member') return [...new Set([...known, caller.sessionId])]
  const archive = service<SessionArchiveLike>(ctx, 'sessionArchive')
  const timeline = await archive?.find(`fleet/${caller.team.id}/members/${caller.participant}`)
  return [...new Set([
    ...known,
    ...timeline?.segments.map(segment => segment.sessionId) ?? [],
    timeline?.activeSessionId ?? caller.sessionId,
  ])]
}

function searchDisabled(error: unknown): boolean {
  return record(error)?.code === 'SESSION_QUERY_SEARCH_DISABLED'
    || (error instanceof Error && 'code' in error
      && (error as Error & { readonly code?: unknown }).code === 'SESSION_QUERY_SEARCH_DISABLED')
}

interface SessionReadGate {
  active: boolean
  readonly waiters: Array<() => void>
}

const SESSION_READ_GATES = new WeakMap<SessionQueryLike, SessionReadGate>()

function sessionReadGate(query: SessionQueryLike): SessionReadGate {
  let gate = SESSION_READ_GATES.get(query)
  if (gate === undefined) {
    gate = { active: false, waiters: [] }
    SESSION_READ_GATES.set(query, gate)
  }
  return gate
}

async function serialSessionRead<T>(query: SessionQueryLike, read: () => Promise<T>): Promise<T> {
  const gate = sessionReadGate(query)
  if (gate.active) await new Promise<void>(resolve => { gate.waiters.push(resolve) })
  gate.active = true
  try {
    return await read()
  } finally {
    const next = gate.waiters.shift()
    if (next === undefined) gate.active = false
    else next()
  }
}

async function readMatchedEvents(
  query: SessionQueryLike,
  sessionId: string,
  hits: readonly SessionSearchHit[],
  effort: FleetMemoryEffort,
  signal?: AbortSignal,
): Promise<readonly SessionEventLike[]> {
  if (query.readEvent === undefined) return []
  const events = new Map<number, SessionEventLike>()
  for (const hit of hits) {
    signal?.throwIfAborted()
    try {
      const window = await serialSessionRead(query, () => query.readEvent!({
        sessionId,
        seq: hit.seq,
        ...(effort === 'high' ? { before: 1, after: 1 } : {}),
      }, signal))
      for (const event of window.events) events.set(event.seq, event)
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof Error && 'code' in error
        && (error as Error & { readonly code?: unknown }).code === 'SESSION_QUERY_EVENT_NOT_FOUND') continue
      throw error
    }
  }
  return [...events.values()].sort((left, right) => left.seq - right.seq)
}

export async function searchSessionDocuments(
  query: SessionQueryLike,
  sessionId: string,
  text: string,
  types: readonly string[],
  limit: number,
  effort: FleetMemoryEffort,
  signal?: AbortSignal,
): Promise<SearchedSession> {
  const filters = [{ kind: 'type' as const, values: types }]
  const candidateLimit = effort === 'low'
    ? Math.max(50, limit * 3)
    : effort === 'medium'
      ? Math.max(100, limit * 10)
      : Math.max(500, limit * 25)
  let hits: readonly SessionSearchHit[]
  let mode: SearchedSession['mode']
  try {
    const collected: SessionSearchHit[] = []
    let cursor: unknown
    do {
      signal?.throwIfAborted()
      const page = await query.searchEvents({
        sessionId,
        query: text,
        filters,
        limit: Math.min(100, Math.max(20, limit * 3)),
        ...(cursor === undefined ? {} : { cursor }),
      }, signal === undefined ? {} : { signal })
      collected.push(...page.items)
      cursor = page.nextCursor
    } while (cursor !== undefined && collected.length < candidateLimit)
    hits = collected.slice(0, candidateLimit)
    mode = 'full-text'
  } catch (error) {
    if (!searchDisabled(error)) throw error
    signal?.throwIfAborted()
    return { sessionId, events: [], hits: [], mode: 'full-text-unavailable' }
  }
  signal?.throwIfAborted()
  if (hits.length === 0) return { sessionId, events: [], hits, mode }
  const hydrationLimit = effort === 'low' ? limit : effort === 'medium' ? limit * 2 : limit * 3
  const selectedHits = hits.slice(0, hydrationLimit)
  if (query.readEvent === undefined) {
    return { sessionId, events: [], hits: selectedHits, mode: 'event-read-unavailable' }
  }
  const events = await readMatchedEvents(query, sessionId, selectedHits, effort, signal)
  return { sessionId, events, hits: selectedHits, mode }
}

export async function forEachBounded<T>(
  values: readonly T[],
  concurrency: number,
  signal: AbortSignal | undefined,
  visit: (value: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      signal?.throwIfAborted()
      const index = next
      next += 1
      await visit(values[index]!)
    }
  })
  await Promise.all(workers)
}

export function sessionSearchConcurrency(effort: FleetMemoryEffort): number {
  return effort === 'low' ? 2 : effort === 'medium' ? 3 : 4
}
