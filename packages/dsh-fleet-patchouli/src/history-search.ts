import type { Context } from '@deepseek-ai/cordis'

import {
  callerSessionId,
  fleetCaller,
  positiveLimit,
  record,
  requestQuery,
} from './fleet-context.js'
import type { FleetRunsLike } from './fleet-context.js'
import type { FleetMemoryAlgorithm } from './patchouli.js'

export const FLEET_HISTORY_SEARCH_ALGORITHM_ID = 'fleet-conversation-history'

export interface FleetHistorySearchItem {
  readonly sequence: number
  readonly createdAt: string
  readonly conversation: string
  readonly direction: 'received' | 'sent'
  readonly text: string
  readonly snippet: string
  readonly messageId: string
  readonly from: string
}

function textSnippet(text: string, query: string, maximum = 600): string {
  if (text.length <= maximum) return text
  const match = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  const start = Math.max(0, match - Math.floor(maximum / 3))
  const value = text.slice(start, start + maximum)
  return `${start > 0 ? '…' : ''}${value}${start + value.length < text.length ? '…' : ''}`
}

/** Search the stable Fleet conversation log; native Session history is not a message source. */
export function createFleetHistorySearchAlgorithm(
  _ctx: Context,
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
      const query = requestQuery(request)
      if (sessionId === undefined || query === undefined) return { handled: false, items: [] }
      const caller = fleetCaller(runs, sessionId)
      if (caller === undefined) return { handled: false, items: [] }
      const limit = positiveLimit(record(request.data)?.limit, context.effort)
      const messages = await runs.searchParticipantMessages(caller.team.id, caller.participant, query, limit)
      context.signal?.throwIfAborted()
      const items: FleetHistorySearchItem[] = messages.map(message => ({
        sequence: message.sequence,
        createdAt: message.createdAt,
        conversation: message.conversationId ?? message.conversation,
        direction: message.from === caller.participant ? 'sent' : 'received',
        text: message.text,
        snippet: textSnippet(message.text, query),
        messageId: message.id,
        from: message.from,
      }))
      if (items.length === 0) return { handled: false, items: [] }
      const publicConversations = [...new Set(messages.flatMap(message =>
        message.conversation.startsWith('#') || message.conversation.startsWith('meeting:')
          ? [message.conversation]
          : [],
      ))]
      const containsPrivate = messages.some(message => message.conversation.startsWith('@'))
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
        effort: context.effort,
        items,
        count: items.length,
      }
    },
  }
}
