import type { Context } from '@deepseek-ai/cordis'

import {
  callerSessionId,
  fleetCaller,
  forEachBounded,
  participantSessions,
  positiveLimit,
  record,
  requestQuery,
  searchSessionDocuments,
  sessionSearchConcurrency,
  service,
  string,
} from './fleet-context.js'
import type {
  FleetCaller,
  FleetRunsLike,
  SessionEventLike,
  SessionQueryLike,
  SearchedSession,
} from './fleet-context.js'
import type {
  FleetMemoryAlgorithm,
  FleetMemoryEffort,
  FleetMemoryRecallAudit,
  MemoryRequest,
} from './patchouli.js'

export const FLEET_SELF_HISTORY_ALGORITHM_ID = 'fleet-self-history'

const SEARCHED_EVENT_TYPES = [
  'user/message',
  'assistant/message',
  'tool/call',
  'tool/result',
] as const

export interface FleetSelfHistorySource {
  readonly kind: 'session-event'
  readonly sessionId: string
  readonly sequence: number
}

export interface FleetSelfHistoryRelatedEvent {
  readonly source: FleetSelfHistorySource
  readonly type: 'tool/call' | 'tool/result'
  readonly createdAt: string
  readonly text: string
  readonly toolName?: string
  readonly callId: string
}

export interface FleetSelfHistoryItem {
  readonly source: FleetSelfHistorySource
  readonly type: 'user/message' | 'assistant/message' | 'tool/call' | 'tool/result'
  readonly createdAt: string
  readonly text: string
  readonly snippet: string
  readonly toolName?: string
  readonly callId?: string
  readonly related?: FleetSelfHistoryRelatedEvent
}

function contentText(value: unknown): string {
  const content = record(value)?.content
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => {
    const item = record(block)
    return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : []
  }).join('\n')
}

function messageText(data: Readonly<Record<string, unknown>>): string {
  return contentText(record(data.message) ?? data)
}

function toolCallId(data: Readonly<Record<string, unknown>>): string | undefined {
  return string(data.callId)
}

function toolResultCallId(data: Readonly<Record<string, unknown>>): string | undefined {
  return string(data.callId) ?? string(record(record(data.message)?.source)?.callId)
}

function toolCallText(data: Readonly<Record<string, unknown>>): string {
  const name = string(data.name) ?? 'tool'
  const args = typeof data.arguments === 'string'
    ? data.arguments
    : data.arguments === undefined ? '' : JSON.stringify(data.arguments)
  return args.length > 0 ? `${name} ${args}` : name
}

function fleetRelay(data: Readonly<Record<string, unknown>>): boolean {
  const message = record(data.message) ?? data
  const source = record(message.source)
  return source?.kind === 'plugin'
    && source.plugin === 'dsh-agent-fleet'
    && source.form === 'relay'
}

function excludedFleetCall(data: Readonly<Record<string, unknown>>): boolean {
  return data.name === 'fleet_send' || data.name === 'fleet_followup'
}

function relatedEvent(
  sessionId: string,
  event: SessionEventLike | undefined,
  callId: string,
): FleetSelfHistoryRelatedEvent | undefined {
  if (event === undefined) return undefined
  const data = record(event.data)
  if (data === undefined) return undefined
  if (event.type === 'tool/call') {
    if (excludedFleetCall(data)) return undefined
    const toolName = string(data.name)
    return {
      source: { kind: 'session-event', sessionId, sequence: event.seq },
      type: 'tool/call',
      createdAt: new Date(event.time).toISOString(),
      text: toolCallText(data),
      ...(toolName === undefined ? {} : { toolName }),
      callId,
    }
  }
  if (event.type !== 'tool/result') return undefined
  const text = messageText(data)
  if (text.length === 0) return undefined
  return {
    source: { kind: 'session-event', sessionId, sequence: event.seq },
    type: 'tool/result',
    createdAt: new Date(event.time).toISOString(),
    text,
    callId,
  }
}

function sessionItems(
  searched: SearchedSession,
  effort: FleetMemoryEffort,
): FleetSelfHistoryItem[] {
  const events = new Map(searched.events.map(event => [event.seq, event]))
  const fleetCallIds = new Set(searched.events.flatMap(event => {
    if (event.type !== 'tool/call') return []
    const data = record(event.data)
    const callId = data === undefined ? undefined : toolCallId(data)
    return data !== undefined && excludedFleetCall(data) && callId !== undefined ? [callId] : []
  }))
  const calls = new Map<string, SessionEventLike>()
  const results = new Map<string, SessionEventLike>()
  if (effort === 'high') {
    for (const event of searched.events) {
      const data = record(event.data)
      if (data === undefined) continue
      const callId = event.type === 'tool/call'
        ? toolCallId(data)
        : event.type === 'tool/result' ? toolResultCallId(data) : undefined
      if (callId === undefined || fleetCallIds.has(callId)) continue
      if (event.type === 'tool/call') calls.set(callId, event)
      if (event.type === 'tool/result') results.set(callId, event)
    }
  }
  const seen = new Set<number>()
  return searched.hits.flatMap(hit => {
    if (seen.has(hit.seq)) return []
    seen.add(hit.seq)
    const event = events.get(hit.seq)
    const data = event === undefined ? undefined : record(event.data)
    if (event === undefined || data === undefined) return []
    if (event.type === 'user/message' && fleetRelay(data)) return []
    if (event.type === 'tool/call' && excludedFleetCall(data)) return []
    const callId = event.type === 'tool/call'
      ? toolCallId(data)
      : event.type === 'tool/result' ? toolResultCallId(data) : undefined
    if (callId !== undefined && fleetCallIds.has(callId)) return []

    const text = event.type === 'tool/call' ? toolCallText(data) : messageText(data)
    if (text.length === 0) return []
    const type = event.type
    if (!SEARCHED_EVENT_TYPES.includes(type as typeof SEARCHED_EVENT_TYPES[number])) return []
    const toolName = event.type === 'tool/call' ? string(data.name) : undefined
    const related = effort !== 'high' || callId === undefined
      ? undefined
      : event.type === 'tool/call'
        ? relatedEvent(searched.sessionId, results.get(callId), callId)
        : event.type === 'tool/result'
          ? relatedEvent(searched.sessionId, calls.get(callId), callId)
          : undefined
    return [{
      source: { kind: 'session-event' as const, sessionId: searched.sessionId, sequence: event.seq },
      type: type as FleetSelfHistoryItem['type'],
      createdAt: new Date(event.time).toISOString(),
      text,
      snippet: hit.snippet,
      ...(toolName === undefined ? {} : { toolName }),
      ...(callId === undefined ? {} : { callId }),
      ...(related === undefined ? {} : { related }),
    }]
  })
}

async function retrieveSelfHistory(
  ctx: Context,
  runs: FleetRunsLike,
  caller: FleetCaller,
  request: MemoryRequest,
  effort: FleetMemoryEffort,
  signal?: AbortSignal,
  deferRecallAudit?: (audit: FleetMemoryRecallAudit) => void,
): Promise<unknown> {
  const query = requestQuery(request)
  const sessionQuery = service<SessionQueryLike>(ctx, 'sessionQuery')
  if (query === undefined || sessionQuery === undefined) return { handled: false, items: [] }
  const limit = positiveLimit(record(request.data)?.limit, effort)
  const sessionIds = await participantSessions(ctx, caller, effort)
  let items: FleetSelfHistoryItem[] = []
  let failures = 0
  const modes = new Set<SearchedSession['mode']>()
  await forEachBounded(sessionIds, sessionSearchConcurrency(effort), signal, async sessionId => {
    try {
      const searched = await searchSessionDocuments(
        sessionQuery,
        sessionId,
        query,
        SEARCHED_EVENT_TYPES,
        limit,
        effort,
        signal,
      )
      modes.add(searched.mode)
      items = [...items, ...sessionItems(searched, effort)]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
    } catch {
      signal?.throwIfAborted()
      failures += 1
    }
  })
  signal?.throwIfAborted()
  const degraded = [...modes].filter(mode => mode !== 'full-text')
  if (items.length === 0) {
    return {
      handled: false,
      items: [],
      searchedSessions: sessionIds.length,
      failures,
      modes: [...modes],
      ...(degraded.length === 0 ? {} : { degraded }),
    }
  }
  deferRecallAudit?.({
    teamId: caller.team.id,
    member: caller.participant,
    resultCount: items.length,
  })
  return {
    handled: true,
    kind: 'fleet-self-history',
    teamId: caller.team.id,
    participant: caller.participant,
    algorithm: FLEET_SELF_HISTORY_ALGORITHM_ID,
    effort,
    modes: [...modes],
    ...(degraded.length === 0 ? {} : { degraded }),
    items,
    count: items.length,
    searchedSessions: sessionIds.length,
    failures,
  }
}

export function createFleetSelfHistoryAlgorithm(
  ctx: Context,
  runs: FleetRunsLike,
): FleetMemoryAlgorithm {
  return {
    id: FLEET_SELF_HISTORY_ALGORITHM_ID,
    minimumEffort: 'low',
    filter: call => {
      const sessionId = callerSessionId(call)
      return sessionId !== undefined && fleetCaller(runs, sessionId)?.kind === 'member'
    },
    async retrieve(request, context) {
      context.signal?.throwIfAborted()
      const sessionId = callerSessionId({ operation: 'retrieve', meta: request.meta })
      if (sessionId === undefined) return { handled: false, items: [] }
      const caller = fleetCaller(runs, sessionId)
      if (caller?.kind !== 'member') return { handled: false, items: [] }
      return retrieveSelfHistory(
        ctx,
        runs,
        caller,
        request,
        context.effort,
        context.signal,
        context.deferRecallAudit,
      )
    },
  }
}
