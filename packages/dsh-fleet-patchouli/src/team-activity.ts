import type {
  FleetHistorySearchInput,
  FleetHistorySearchResult,
  FleetJournalEvent,
} from 'dsh-agent-fleet'

import {
  callerSessionId,
  fleetCaller,
  positiveLimit,
  record,
  requestQuery,
} from './fleet-context.js'
import type { FleetRunsLike } from './fleet-context.js'
import type { FleetMemoryAlgorithm, FleetMemoryEffort } from './patchouli.js'

export const FLEET_TEAM_ACTIVITY_ALGORITHM_ID = 'fleet-team-activity'

const ACTIVITY_TYPES = [
  'coordination.meeting',
  'coordination.vote',
  'assistant_attached',
  'assistant_rebound',
  'assistant_detached',
  'member_attached',
  'member_continued',
  'member_detached',
  'member_network_recovery_scheduled',
  'member_network_recovery_woken',
  'member_paused',
  'member_resumed',
  'member_session_rotated',
  'member_updated',
  'team_created',
  'team_resumed',
  'team_status',
  'team_woken',
] as const

const ACTIVITY_PREFIXES = [
  'activity.',
  'calendar.',
  'member_status.',
  'resource.',
  'schedule.',
  'task.',
  'work_',
  'workspace.',
] as const

interface TeamActivityRuns extends FleetRunsLike {
  searchTeamHistory(
    runId: string,
    input: FleetHistorySearchInput,
    signal?: AbortSignal,
  ): Promise<FleetHistorySearchResult>
}

function activityLimit(value: unknown, effort: FleetMemoryEffort): number {
  return positiveLimit(value, effort)
}

function milestone(event: FleetJournalEvent): boolean {
  if (event.type === 'coordination.vote' || event.type === 'team_status') return true
  if (event.type === 'work_status') {
    const status = record(event.data)?.status
    return status === 'finished' || status === 'blocked' || status === 'failed'
  }
  if (event.type === 'task.completed') return true
  if (event.type.startsWith('resource.') || event.type.startsWith('workspace.')) return true
  return false
}

export function createFleetTeamActivityAlgorithm(runs: TeamActivityRuns): FleetMemoryAlgorithm {
  return {
    id: FLEET_TEAM_ACTIVITY_ALGORITHM_ID,
    minimumEffort: 'low',
    filter: call => {
      const sessionId = callerSessionId(call)
      return sessionId !== undefined && fleetCaller(runs, sessionId) !== undefined
    },
    async retrieve(request, context) {
      context.signal?.throwIfAborted()
      const sessionId = callerSessionId({ operation: 'retrieve', meta: request.meta })
      const caller = sessionId === undefined ? undefined : fleetCaller(runs, sessionId)
      const query = requestQuery(request)
      if (caller === undefined || query === undefined) return { handled: false, items: [] }

      const limit = activityLimit(record(request.data)?.limit, context.effort)
      const search: FleetHistorySearchInput = {
        query,
        types: ACTIVITY_TYPES,
        typePrefixes: ACTIVITY_PREFIXES,
        visibleToSessionId: caller.sessionId,
        limit,
        ...(context.effort === 'low' ? { recentBytes: 1_024 * 1_024 } : {}),
      }
      const result = await runs.searchTeamHistory(caller.team.id, search, context.signal)
      context.signal?.throwIfAborted()
      if (result.events.length === 0) {
        return {
          handled: false,
          items: [],
          truncated: result.truncated,
        }
      }
      const items = result.events.map(event => ({
        source: { kind: 'team-event' as const, teamId: caller.team.id, sequence: event.sequence },
        createdAt: event.createdAt,
        type: event.type,
        data: event.data,
        ...(context.effort === 'high' ? { milestone: milestone(event) } : {}),
      }))
      context.deferRecallAudit?.({
        teamId: caller.team.id,
        member: caller.participant,
        resultCount: items.length,
      })
      return {
        handled: true,
        kind: 'fleet-team-activity',
        teamId: caller.team.id,
        participant: caller.participant,
        algorithm: FLEET_TEAM_ACTIVITY_ALGORITHM_ID,
        effort: context.effort,
        items,
        count: items.length,
        hasMore: result.hasMore,
        truncated: result.truncated,
      }
    },
  }
}
