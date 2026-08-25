import type { Context } from '@deepseek-ai/cordis'
import type { FleetResourceRevisionSummary } from 'dsh-agent-fleet'

import {
  callerSessionId,
  fleetCaller,
  record,
  requestQuery,
  service,
  type FleetRunsLike,
} from './fleet-context.js'
import type {
  FleetMemoryAlgorithm,
  FleetMemoryEffort,
} from './patchouli.js'

export const FLEET_SHARED_RESOURCES_ALGORITHM_ID = 'fleet-shared-resources'

interface FleetResourceStoreLike {
  listResources(): FleetResourceLike[]
}

interface FleetResourceLike {
  readonly id: string
  readonly path: string
  readonly label?: string
  readonly mediaType?: string
  readonly size?: number
  readonly createdBy: string
  readonly createdAt: string
}

interface FleetResourceRunsLike extends FleetRunsLike {
  resourceStore(runId: string): FleetResourceStoreLike
  readResourceContentSnippets(
    runId: string,
    requests: readonly { readonly id: string; readonly query: string; readonly maxChars?: number }[],
    signal?: AbortSignal,
  ): Promise<readonly {
    readonly id: string
    readonly matched: boolean
    readonly snippet?: string
    readonly history: readonly FleetResourceRevisionSummary[]
    readonly historyTruncated: boolean
    readonly error?: string
  }[]>
  readResourceRevisionSnippets(
    runId: string,
    requests: readonly {
      readonly id: string
      readonly revisionId: string
      readonly query: string
      readonly maxChars?: number
    }[],
    signal?: AbortSignal,
  ): Promise<readonly {
    readonly id: string
    readonly revisionId: string
    readonly matched: boolean
    readonly snippet?: string
    readonly error?: string
  }[]>
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

export interface FleetSharedResourceItem {
  readonly source: {
    readonly kind: 'fleet-resource'
    readonly teamId: string
    readonly resourceId: string
    readonly revision?: string
  }
  readonly resourceId: string
  readonly path: string
  readonly label?: string
  readonly mediaType?: string
  readonly size?: number
  readonly createdBy: string
  readonly createdAt: string
  readonly match: 'metadata' | 'current' | 'revision'
  readonly snippet?: string
  readonly revision?: string
  readonly updatedAt?: string
}

function resultLimit(value: unknown, effort: FleetMemoryEffort): number {
  const maximum = effort === 'low' ? 10 : effort === 'medium' ? 30 : 50
  const fallback = effort === 'low' ? 10 : effort === 'medium' ? 15 : 25
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback
}

function contains(text: string | undefined, query: string): boolean {
  return text?.toLocaleLowerCase().includes(query.toLocaleLowerCase()) === true
}

function metadataMatches(resource: FleetResourceLike, query: string): boolean {
  return [resource.id, resource.path, resource.label, resource.mediaType, resource.createdBy]
    .some(value => contains(value, query))
}

function textResource(resource: FleetResourceLike): boolean {
  const mediaType = resource.mediaType?.split(';', 1)[0]?.trim().toLowerCase()
  const name = (resource.label ?? resource.path).toLowerCase()
  return mediaType?.startsWith('text/') === true
    || ['application/json', 'application/ld+json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(mediaType ?? '')
    || /\.(?:md|markdown|txt|json|jsonl|ya?ml|toml|csv|tsv|xml)$/u.test(name)
}

function snippet(text: string, query: string, maximum = 360): string {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  const start = Math.max(0, index < 0 ? 0 : index - Math.floor(maximum / 3))
  const value = text.slice(start, start + maximum)
  return `${start > 0 ? '…' : ''}${value}${start + value.length < text.length ? '…' : ''}`
}

function item(
  teamId: string,
  resource: FleetResourceLike,
  match: FleetSharedResourceItem['match'],
  details: { readonly snippet?: string; readonly revision?: string; readonly updatedAt?: string } = {},
): FleetSharedResourceItem {
  return {
    source: {
      kind: 'fleet-resource',
      teamId,
      resourceId: resource.id,
      ...(details.revision === undefined ? {} : { revision: details.revision }),
    },
    resourceId: resource.id,
    path: resource.path,
    ...(resource.label === undefined ? {} : { label: resource.label }),
    ...(resource.mediaType === undefined ? {} : { mediaType: resource.mediaType }),
    ...(resource.size === undefined ? {} : { size: resource.size }),
    createdBy: resource.createdBy,
    createdAt: resource.createdAt,
    match,
    ...(details.snippet === undefined ? {} : { snippet: details.snippet }),
    ...(details.revision === undefined ? {} : { revision: details.revision }),
    ...(details.updatedAt === undefined ? {} : { updatedAt: details.updatedAt }),
  }
}

export function createFleetSharedResourcesAlgorithm(
  ctx: Context,
  runs: FleetResourceRunsLike,
): FleetMemoryAlgorithm {
  const authorizedCaller = (sessionId: string) => {
    const caller = fleetCaller(runs, sessionId)
    const authorization = service<FleetAuthorizationLike>(ctx, 'fleetAuthorization')
    const actor = authorization?.actorForAgent(sessionId)
    if (caller === undefined || authorization === undefined || actor === undefined
      || actor.teamId !== caller.team.id || actor.subject.id !== caller.participant
      || actor.subject.kind !== caller.kind
      || !authorization.authorize({
        teamId: caller.team.id,
        subject: actor.subject,
        action: 'resource.read',
      })) return undefined
    return { authorization, caller, subject: actor.subject }
  }
  return {
    id: FLEET_SHARED_RESOURCES_ALGORITHM_ID,
    minimumEffort: 'low',
    filter: call => {
      const sessionId = callerSessionId(call)
      return sessionId !== undefined && authorizedCaller(sessionId) !== undefined
    },
    async retrieve(request, context) {
      context.signal?.throwIfAborted()
      const sessionId = callerSessionId({ operation: 'retrieve', meta: request.meta })
      const query = requestQuery(request)
      if (sessionId === undefined || query === undefined) return { handled: false, items: [] }
      const authorized = authorizedCaller(sessionId)
      if (authorized === undefined) return { handled: false, items: [] }
      const { authorization, caller, subject } = authorized

      let resources: FleetResourceLike[]
      try {
        resources = runs.resourceStore(caller.team.id).listResources().filter(resource =>
          authorization.authorize({
            teamId: caller.team.id,
            subject,
            action: 'resource.read',
            resource: { kind: 'resource', id: resource.id },
          }))
      } catch {
        return { handled: false, items: [] }
      }

      const limit = resultLimit(record(request.data)?.limit, context.effort)
      const currentReadBudget = context.effort === 'medium' ? 25 : context.effort === 'high' ? 50 : 0
      const revisionReadBudget = context.effort === 'high' ? 100 : 0
      const items: FleetSharedResourceItem[] = []
      const textResources = resources.filter(textResource).slice(0, currentReadBudget)
      const currentSnippets = new Map<string, string>()
      const revisionRequests: Array<{
        readonly resource: FleetResourceLike
        readonly revision: FleetResourceRevisionSummary
      }> = []
      if (textResources.length > 0) {
        try {
          const previews = await runs.readResourceContentSnippets(
            caller.team.id,
            textResources.map(resource => ({ id: resource.id, query, maxChars: 360 })),
            context.signal,
          )
          previews.forEach((preview, index) => {
            if (preview.error !== undefined) return
            const resource = textResources[index]
            if (resource === undefined) return
            if (preview.matched && preview.snippet !== undefined) currentSnippets.set(resource.id, preview.snippet)
            if (context.effort !== 'high' || revisionRequests.length >= revisionReadBudget) return
            for (const revision of preview.history) {
              if (!revision.available || revisionRequests.length >= revisionReadBudget) continue
              revisionRequests.push({ resource, revision })
            }
          })
        } catch {
          context.signal?.throwIfAborted()
        }
      }
      const historicalByResource = new Map<string, FleetSharedResourceItem[]>()
      if (revisionRequests.length > 0) {
        try {
          const historical = await runs.readResourceRevisionSnippets(
            caller.team.id,
            revisionRequests.map(({ resource, revision }) => ({
              id: resource.id,
              revisionId: revision.id,
              query,
              maxChars: 360,
            })),
            context.signal,
          )
          historical.forEach((result, index) => {
            const requested = revisionRequests[index]
            if (result.error !== undefined || !result.matched || result.snippet === undefined || requested === undefined) return
            const matches = historicalByResource.get(requested.resource.id) ?? []
            matches.push(item(caller.team.id, requested.resource, 'revision', {
              revision: requested.revision.id,
              updatedAt: requested.revision.updatedAt,
              snippet: result.snippet,
            }))
            historicalByResource.set(requested.resource.id, matches)
          })
        } catch {
          context.signal?.throwIfAborted()
        }
      }

      for (const resource of resources) {
        context.signal?.throwIfAborted()
        let matchedContent = false
        const currentSnippet = currentSnippets.get(resource.id)
        if (currentSnippet !== undefined) {
          items.push(item(caller.team.id, resource, 'current', { snippet: currentSnippet }))
          matchedContent = true
        }
        for (const historical of historicalByResource.get(resource.id) ?? []) {
          if (items.length >= limit) break
          items.push(historical)
          matchedContent = true
        }
        if (!matchedContent && metadataMatches(resource, query) && items.length < limit) {
          items.push(item(caller.team.id, resource, 'metadata'))
        }
        if (items.length >= limit) break
      }

      if (items.length === 0) return { handled: false, items: [] }
      context.deferRecallAudit?.({
        teamId: caller.team.id,
        member: caller.participant,
        resultCount: items.length,
      })
      return {
        handled: true,
        teamId: caller.team.id,
        participant: caller.participant,
        effort: context.effort,
        count: items.length,
        items,
      }
    },
  }
}
