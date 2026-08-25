import type { Context } from '@deepseek-ai/cordis'
import { FLEET_MESSAGE_MODULE } from 'dsh-agent-fleet'
import type { FleetMemberView } from 'dsh-agent-fleet'

import {
  callerSessionId,
  fleetCaller,
  record,
  requestQuery,
  service,
  string,
} from './fleet-context.js'
import type { FleetRunsLike } from './fleet-context.js'
import type { FleetMemoryAlgorithm } from './patchouli.js'

export const FLEET_TEAM_STATE_ALGORITHM_ID = 'fleet-team-state'

interface TeamStateRuns extends FleetRunsLike {
  memberViews(runId: string): FleetMemberView[]
  moduleConfiguration(runId: string, moduleId: string): unknown
  exportConfiguration(runId: string): Record<string, unknown>
}

interface WorkspaceMount {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly access: 'read' | 'write'
  readonly builtIn: boolean
}

interface FleetWorkspacesLike {
  mounts(teamId: string, member: string): WorkspaceMount[]
}

interface FleetAuthorizationLike {
  actorForAgent(agentId: string): {
    readonly teamId: string
    readonly subject: { readonly kind: string; readonly id: string }
  } | undefined
  authorize(input: {
    readonly teamId: string
    readonly subject: { readonly kind: string; readonly id: string }
    readonly action: string
    readonly resource?: { readonly kind: string; readonly id: string }
  }): boolean
}

const TEAM_STATE_INTENT = /(?:\bteam\b|\bmembers?\b|\broles?\b|\bresponsibilit(?:y|ies)\b|\bstatus\b|\bworkspaces?\b|\brules?\b|\bpreferences?\b|\bconfiguration\b|\bcurrent work\b|团队|成员|角色|职责|状态|工作区|规则|偏好|配置|当前工作)/iu

function relevantQuery(query: string, team: import('dsh-agent-fleet').FleetRunRecord): boolean {
  const normalized = query.toLocaleLowerCase()
  return TEAM_STATE_INTENT.test(query)
    || [team.name, ...team.members.flatMap(member => [member.name, member.displayName, member.role])]
      .some(value => value !== undefined && normalized.includes(value.toLocaleLowerCase()))
}

export function createFleetTeamStateAlgorithm(
  ctx: Context,
  runs: TeamStateRuns,
): FleetMemoryAlgorithm {
  return {
    id: FLEET_TEAM_STATE_ALGORITHM_ID,
    minimumEffort: 'low',
    filter: call => {
      const sessionId = callerSessionId(call)
      return sessionId !== undefined && fleetCaller(runs, sessionId) !== undefined
    },
    async retrieve(request, context) {
      context.signal?.throwIfAborted()
      const sessionId = callerSessionId({ operation: 'retrieve', meta: request.meta })
      const caller = sessionId === undefined ? undefined : fleetCaller(runs, sessionId)
      if (sessionId === undefined || caller === undefined) return { handled: false, items: [] }
      const input = record(request.data)
      const query = requestQuery(request)
      const explicitlyRequested = input?.algorithm === FLEET_TEAM_STATE_ALGORITHM_ID
        || input?.kind === 'fleet-team-state'
      if (!explicitlyRequested && (query === undefined || !relevantQuery(query, caller.team))) {
        return { handled: false, items: [] }
      }

      const team = caller.team
      const views = new Map(runs.memberViews(team.id).map(view => [view.id, view]))
      const members = team.members.map(member => {
        const view = views.get(member.name)
        return {
          id: member.name,
          name: member.displayName ?? view?.name ?? member.name,
          role: member.role,
          status: member.status ?? 'unknown',
          ...(context.effort === 'low' || view?.responsibility === undefined
            ? {}
            : { responsibility: view.responsibility }),
        }
      })
      const item: Record<string, unknown> = {
        source: { kind: 'team-state', teamId: team.id },
        team: {
          id: team.id,
          name: team.name,
          status: team.status,
          startedAt: team.startedAt,
          ...(team.work === undefined ? {} : {
            work: {
              id: team.work.id,
              status: team.work.status,
              startedAt: team.work.startedAt,
              ...(team.work.endedAt === undefined ? {} : { endedAt: team.work.endedAt }),
              ...(team.work.summary === undefined ? {} : { summary: team.work.summary }),
            },
          }),
        },
        members,
      }

      if (context.effort !== 'low') {
        const exported = runs.exportConfiguration(team.id)
        const core = record(exported.core)
        const message = record(runs.moduleConfiguration(team.id, FLEET_MESSAGE_MODULE))
        const channel = record(message?.defaultChannel)
        item.preferences = {
          positioning: string(core?.positioning) ?? '',
          rules: string(message?.rules) ?? '',
          collaborationMethod: string(message?.collaborationMethod) ?? '',
          ...(string(channel?.id) === undefined || string(channel?.name) === undefined
            ? {}
            : { defaultChannel: { id: string(channel?.id), name: string(channel?.name) } }),
        }
        const workspaces = service<FleetWorkspacesLike>(ctx, 'fleetWorkspaces')
        const authorization = service<FleetAuthorizationLike>(ctx, 'fleetAuthorization')
        let actor: ReturnType<FleetAuthorizationLike['actorForAgent']>
        try {
          actor = authorization?.actorForAgent(sessionId)
        } catch {
          actor = undefined
        }
        const canReadMounts = caller.kind === 'member' && workspaces !== undefined
          && authorization !== undefined && actor !== undefined
          && actor.teamId === team.id && actor.subject.kind === caller.kind
          && actor.subject.id === caller.participant
          && authorization.authorize({
            teamId: team.id,
            subject: actor.subject,
            action: 'workspace.read',
          })
        if (canReadMounts && workspaces !== undefined && authorization !== undefined && actor !== undefined) {
          item.workspaces = workspaces.mounts(team.id, caller.participant)
            .filter(workspace => authorization.authorize({
              teamId: team.id,
              subject: actor.subject,
              action: 'workspace.read',
              resource: { kind: 'workspace', id: workspace.path },
            }))
            .map(workspace => ({
              id: workspace.id,
              name: workspace.name,
              path: workspace.path,
              access: workspace.access,
              builtIn: workspace.builtIn,
            }))
        } else {
          item.workspaces = []
        }
      }

      context.deferRecallAudit?.({
        teamId: team.id,
        member: caller.participant,
        resultCount: 1,
      })
      return {
        handled: true,
        kind: 'fleet-team-state',
        teamId: team.id,
        participant: caller.participant,
        algorithm: FLEET_TEAM_STATE_ALGORITHM_ID,
        effort: context.effort,
        items: [item],
        count: 1,
      }
    },
  }
}
