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
  FleetMemoryEffort,
  FleetMemoryAlgorithm,
} from './patchouli.js'

export const FLEET_HISTORY_SEARCH_ALGORITHM_ID = 'fleet-conversation-history'

export interface FleetHistorySearchItem {
  readonly sessionId: string
  readonly sequence: number
  readonly createdAt: string
  readonly conversation: string
  readonly direction: 'received' | 'sent'
  readonly text: string
  readonly snippet: string
  readonly messageId?: string
  readonly from?: string
}

function messageText(message: Readonly<Record<string, unknown>>): string {
  const content = message.content
  if (!Array.isArray(content)) return ''
  return content.flatMap(block => {
    const value = record(block)
    return value?.type === 'text' && typeof value.text === 'string' ? [value.text] : []
  }).join('\n')
}

const RECEIVED_ENVELOPE = /^\[Fleet (\S+) \| (\S+) \| from=(@[^\]]+)\]\s?([\s\S]*)$/u

function receivedMessage(event: SessionEventLike, snippet: string): FleetHistorySearchItem | undefined {
  if (event.type !== 'user/message') return undefined
  const data = record(event.data)
  const message = record(data?.message) ?? data
  if (message === undefined) return undefined
  const source = record(message.source)
  if (source?.kind !== 'plugin' || source.plugin !== 'dsh-agent-fleet' || source.form !== 'relay') {
    return undefined
  }
  const match = RECEIVED_ENVELOPE.exec(messageText(message))
  if (match === null) return undefined
  return {
    sessionId: '',
    sequence: event.seq,
    createdAt: new Date(event.time).toISOString(),
    conversation: match[1]!,
    messageId: match[2]!,
    from: match[3]!,
    direction: 'received',
    text: match[4]!,
    snippet,
  }
}

function sentMessage(event: SessionEventLike, snippet: string): FleetHistorySearchItem | undefined {
  if (event.type !== 'tool/call') return undefined
  const data = record(event.data)
  if (data?.name !== 'fleet_send' && data?.name !== 'fleet_followup') return undefined
  let args = record(data.arguments)
  if (args === undefined && typeof data.arguments === 'string') {
    try {
      args = record(JSON.parse(data.arguments) as unknown)
    } catch {
      return undefined
    }
  }
  const conversation = string(args?.to)
  const text = string(args?.message)
  if (conversation === undefined || text === undefined) return undefined
  return {
    sessionId: '',
    sequence: event.seq,
    createdAt: new Date(event.time).toISOString(),
    conversation,
    direction: 'sent',
    text,
    snippet,
  }
}

async function searchSession(
  sessionQuery: SessionQueryLike,
  sessionId: string,
  text: string,
  limit: number,
  effort: FleetMemoryEffort,
  signal?: AbortSignal,
): Promise<{
  readonly items: readonly FleetHistorySearchItem[]
  readonly mode: SearchedSession['mode']
}> {
  const searched = await searchSessionDocuments(
    sessionQuery,
    sessionId,
    text,
    ['user/message', 'tool/call'],
    limit,
    effort,
    signal,
  )
  const events = new Map(searched.events.map(event => [event.seq, event]))
  const items = searched.hits.flatMap(hit => {
    const event = events.get(hit.seq)
    if (event === undefined) return []
    const item = receivedMessage(event, hit.snippet) ?? sentMessage(event, hit.snippet)
    return item === undefined ? [] : [{ ...item, sessionId }]
  })
  return { items, mode: searched.mode }
}

export function createFleetHistorySearchAlgorithm(
  ctx: Context,
  runs: FleetRunsLike,
): FleetMemoryAlgorithm {
  return {
    id: FLEET_HISTORY_SEARCH_ALGORITHM_ID,
    minimumEffort: 'low',
    filter: call => {
      const sessionId = callerSessionId(call)
      return sessionId !== undefined && fleetCaller(runs, sessionId) !== undefined
    },
    async retrieve(request, context) {
      context.signal?.throwIfAborted()
      const sessionId = callerSessionId({ operation: 'retrieve', meta: request.meta })
      const text = requestQuery(request)
      const sessionQuery = service<SessionQueryLike>(ctx, 'sessionQuery')
      if (sessionId === undefined || text === undefined || sessionQuery === undefined) {
        return { handled: false, items: [] }
      }
      const caller = fleetCaller(runs, sessionId)
      if (caller === undefined) return { handled: false, items: [] }
      const effort = context.effort
      const limit = positiveLimit(record(request.data)?.limit, effort)
      const sessionIds = await participantSessions(ctx, caller, effort)
      let items: FleetHistorySearchItem[] = []
      let failures = 0
      const modes = new Set<SearchedSession['mode']>()
      await forEachBounded(sessionIds, sessionSearchConcurrency(effort), context.signal, async id => {
        try {
          const searched = await searchSession(sessionQuery, id, text, limit, effort, context.signal)
          modes.add(searched.mode)
          items = [...items, ...searched.items]
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .slice(0, limit)
        } catch {
          context.signal?.throwIfAborted()
          failures += 1
        }
      })
      context.signal?.throwIfAborted()
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
      const publicConversations = [...new Set(items.flatMap(item =>
        item.conversation.startsWith('#') || item.conversation.startsWith('meeting:')
          ? [item.conversation]
          : [],
      ))]
      const containsPrivate = items.some(item => item.conversation.startsWith('@'))
      context.deferRecallAudit?.({
        teamId: caller.team.id,
        member: caller.participant,
        resultCount: items.length,
        ...!containsPrivate && publicConversations.length === 1
          ? { conversation: publicConversations[0] }
          : {},
      })
      return {
        handled: true,
        kind: 'fleet-conversation-history',
        teamId: caller.team.id,
        participant: caller.participant,
        algorithm: FLEET_HISTORY_SEARCH_ALGORITHM_ID,
        effort,
        modes: [...modes],
        ...(degraded.length === 0 ? {} : { degraded }),
        items,
        count: items.length,
        searchedSessions: sessionIds.length,
        failures,
      }
    },
  }
}
