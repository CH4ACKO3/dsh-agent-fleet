import type { Context } from '@deepseek-ai/cordis'
import type { FleetRunService } from 'dsh-agent-fleet'

import { createFleetHistorySearchAlgorithm } from './history-search.js'
import {
  fleetMemoryEffortAtLeast,
  fleetMemoryAgentForRequest,
  fleetMemoryEffortForCall,
  fleetMemoryEffortForRequest,
  FLEET_MEMORY_PROCESSOR_ID,
} from './patchouli.js'
import { createFleetSharedResourcesAlgorithm } from './shared-resources.js'
import { createFleetTeamActivityAlgorithm } from './team-activity.js'
import { createFleetTeamStateAlgorithm } from './team-state.js'
import type {
  FleetMemoryEffort,
  FleetMemoryAlgorithm,
  FleetMemoryCommittedRecallAudit,
  FleetMemoryRecallAudit,
  MemoryData,
  MemoryPlugin,
  MemoryRequest,
  MemoryRouteCall,
  PatchouliCore,
} from './patchouli.js'
import type { FleetPatchouliSettings } from './settings.js'

export const name = 'dsh-agent-fleet-patchouli/processor'

export interface FleetMemoryProcessorOptions {
  readonly recordRecallAudit?: (audit: FleetMemoryCommittedRecallAudit) => void
  readonly settings?: () => FleetPatchouliSettings
}

const RETRIEVAL_TOKEN_BUDGET: Record<FleetMemoryEffort, number> = {
  low: 2_048,
  medium: 6_144,
  high: 12_288,
}

const fleetEventIndex: FleetMemoryAlgorithm = {
  id: 'fleet-event-index',
  minimumEffort: 'low',
  filter: call => call.operation === 'update' && call.meta.source.type === 'fleet',
  update: async request => {
    const data = typeof request.data === 'object' && request.data !== null && !Array.isArray(request.data)
      ? request.data as Record<string, unknown>
      : undefined
    return data?.kind === 'fleet-event'
      // Fleet's durable journal remains the source of truth. This acknowledgement
      // marks the event as addressable by the read-through memory algorithms.
      ? { handled: true, stored: 1 }
      : { handled: false, stored: 0 }
  },
}

function estimatedTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4)
}

function withoutItems(value: MemoryData): MemoryData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const { items: _items, ...summary } = value as Record<string, unknown>
  return summary
}

function clippedItemPrefix(value: unknown): Record<string, unknown> {
  const item = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
  return {
    ...(item?.source === undefined ? {} : { source: item.source }),
    truncated: true,
  }
}

function boundedRetrieval(
  base: Record<string, unknown>,
  allItems: readonly unknown[],
  effort: FleetMemoryEffort,
): Record<string, unknown> {
  const tokenBudget = RETRIEVAL_TOKEN_BUDGET[effort]
  const items: unknown[] = []
  const response = (truncated: boolean) => ({
    ...base,
    tokenBudget,
    totalItems: allItems.length,
    truncated,
    items,
  })
  for (const item of allItems) {
    const candidate = [...items, item]
    if (estimatedTokens({ ...response(false), items: candidate }) <= tokenBudget) {
      items.push(item)
      continue
    }
    const prefix = clippedItemPrefix(item)
    const text = JSON.stringify(item)
    let low = 0
    let high = text.length
    while (low < high) {
      const length = Math.ceil((low + high + 1) / 2)
      const clipped = { ...prefix, preview: text.slice(0, length) }
      if (estimatedTokens({ ...response(true), items: [...items, clipped] }) <= tokenBudget) low = length
      else high = length - 1
    }
    const clipped = { ...prefix, preview: text.slice(0, low) }
    if (estimatedTokens({ ...response(true), items: [...items, clipped] }) <= tokenBudget) items.push(clipped)
    break
  }
  return response(items.length < allItems.length || items.some(item => (
    typeof item === 'object' && item !== null && !Array.isArray(item)
      && (item as Record<string, unknown>).truncated === true
  )))
}

function isAutomaticAgentRecall(request: MemoryRequest): boolean {
  if (request.meta.source.type !== 'agent-loop') return false
  const point = request.meta.attributes?.point
  return typeof point === 'string' && point !== 'tool/memory-retrieve'
}

function automaticRecallResult(
  result: Record<string, unknown>,
  handled: boolean,
): MemoryData {
  const items = Array.isArray(result.items) ? result.items : []
  if (!handled || items.length === 0) return null
  return {
    items,
    ...(result.truncated === true ? { truncated: true } : {}),
    ...(result.truncated === true && typeof result.totalItems === 'number'
      ? { totalItems: result.totalItems }
      : {}),
  }
}

function selectAlgorithms(
  algorithms: readonly FleetMemoryAlgorithm[],
  call: MemoryRouteCall,
  effort = fleetMemoryEffortForCall(call),
  agent = true,
): {
  readonly selected: FleetMemoryAlgorithm[]
  readonly failures: { readonly algorithm: string; readonly ok: false; readonly error: string }[]
} {
  const selected: FleetMemoryAlgorithm[] = []
  const failures: { algorithm: string; ok: false; error: string }[] = []
  for (const algorithm of algorithms) {
    if (!fleetMemoryEffortAtLeast(effort, algorithm.minimumEffort ?? 'low')) continue
    if (algorithm.requiresAgent === true && !agent) continue
    try {
      if (algorithm.filter(call)) selected.push(algorithm)
    } catch (error) {
      failures.push({
        algorithm: algorithm.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { selected, failures }
}

async function dispatch(
  algorithms: readonly FleetMemoryAlgorithm[],
  operation: 'update' | 'retrieve',
  request: MemoryRequest,
  options: FleetMemoryProcessorOptions,
  signal?: AbortSignal,
): Promise<MemoryData> {
  const defaults = options.settings?.()
  const effort = fleetMemoryEffortForRequest(operation, request, defaults?.effort)
  const agent = fleetMemoryAgentForRequest(operation, request, defaults?.agent)
  const selection = selectAlgorithms(algorithms, { operation, meta: request.meta }, effort, agent)
  const executed = await Promise.all(selection.selected.flatMap(algorithm => {
    const handler = operation === 'update' ? algorithm.update : algorithm.retrieve
    return handler === undefined ? [] : [(async () => {
      const audits: FleetMemoryRecallAudit[] = []
      try {
        const value = await handler.call(
          algorithm,
          request,
          {
            effort,
            agent,
            ...(signal === undefined ? {} : { signal }),
            deferRecallAudit: audit => { audits.push(audit) },
          },
        )
        return { algorithm: algorithm.id, ok: true as const, value, audits }
      } catch (error) {
        signal?.throwIfAborted()
        return {
          algorithm: algorithm.id,
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
          audits: [] as FleetMemoryRecallAudit[],
        }
      }
    })()]
  }))
  const results = [
    ...selection.failures.map(result => ({ ...result, audits: [] as FleetMemoryRecallAudit[] })),
    ...executed,
  ]
  const handled = results.some(result => {
    if (!result.ok) return false
    const value = typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)
      ? result.value as Record<string, unknown>
      : undefined
    return value?.handled === true
  })
  const stored = operation === 'update' ? results.reduce((total, result) => {
    if (!result.ok || typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)) {
      return total
    }
    const value = result.value as Record<string, unknown>
    return value.handled === true && typeof value.stored === 'number'
      && Number.isSafeInteger(value.stored) && value.stored > 0
      ? total + value.stored
      : total
  }, 0) : undefined
  let auditFailures = 0
  if (operation === 'retrieve' && options.recordRecallAudit !== undefined) {
    signal?.throwIfAborted()
    for (const result of results) {
      if (!result.ok || typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)
        || (result.value as Record<string, unknown>).handled !== true) continue
      for (const audit of result.audits) {
        signal?.throwIfAborted()
        if (audit.teamId.trim().length === 0 || audit.member.trim().length === 0
          || !Number.isSafeInteger(audit.resultCount) || audit.resultCount < 1) continue
        try {
          options.recordRecallAudit({
            teamId: audit.teamId,
            member: audit.member,
            resultCount: audit.resultCount,
            algorithm: result.algorithm,
            effort,
            agent,
            ...(audit.conversation?.startsWith('#') === true
              || audit.conversation?.startsWith('meeting:') === true
              ? { conversation: audit.conversation }
              : {}),
          })
        } catch {
          auditFailures += 1
        }
      }
    }
  }
  const algorithmResults = results.map(({ audits: _audits, ...result }) => result.ok
    ? { ...result, value: withoutItems(result.value) }
    : result)
  const base = {
    handled,
    sourceType: request.meta.source.type,
    scope: request.meta.scope,
    effort,
    agent,
    algorithms: algorithmResults,
    ...(stored === undefined ? {} : { stored }),
    ...(auditFailures === 0 ? {} : { auditFailures }),
  }
  if (operation !== 'retrieve') return base
  const items = results.flatMap(result => {
    if (!result.ok) return []
    const value = typeof result.value === 'object' && result.value !== null && !Array.isArray(result.value)
      ? result.value as Record<string, unknown>
      : undefined
    return Array.isArray(value?.items) ? value.items : []
  })
  const result = boundedRetrieval(base, items, effort)
  return isAutomaticAgentRecall(request) ? automaticRecallResult(result, handled) : result
}

export function createFleetMemoryProcessor(
  algorithms: readonly FleetMemoryAlgorithm[],
  options: FleetMemoryProcessorOptions = {},
): MemoryPlugin {
  return {
    id: FLEET_MEMORY_PROCESSOR_ID,
    filter: call => {
      if (call.meta.source.type === 'fleet') return true
      const routedEffort = call.meta.attributes?.fleetEffort
      const effort = routedEffort === 'low' || routedEffort === 'medium' || routedEffort === 'high'
        ? routedEffort
        : 'high'
      const routedAgent = call.meta.attributes?.fleetAgent
      const agent = typeof routedAgent === 'boolean'
        ? routedAgent
        : options.settings?.().agent ?? true
      return selectAlgorithms(algorithms, call, effort, agent).selected.length > 0
    },
    update: (request, context) => dispatch(algorithms, 'update', request, options, context.signal),
    retrieve: (request, context) => dispatch(algorithms, 'retrieve', request, options, context.signal),
  }
}

export interface Config {
  readonly settings?: () => FleetPatchouliSettings
}

export function apply(ctx: Context, config: Config = {}): void {
  const host = ctx as unknown as {
    inject(
      services: readonly string[],
      callback: (scope: Context & {
        readonly patchouli: PatchouliCore
        readonly fleetRuns: FleetRunService
      }) => () => void,
    ): void
  }
  host.inject(['patchouli', 'fleetRuns'], scope => scope.patchouli.register(
    createFleetMemoryProcessor([
      fleetEventIndex,
      createFleetHistorySearchAlgorithm(scope, scope.fleetRuns),
      createFleetTeamStateAlgorithm(scope, scope.fleetRuns),
      createFleetTeamActivityAlgorithm(scope.fleetRuns),
      createFleetSharedResourcesAlgorithm(scope, scope.fleetRuns),
    ], {
      ...(config.settings === undefined ? {} : { settings: config.settings }),
      recordRecallAudit: audit => scope.fleetRuns.recordDataEvent(audit.teamId, 'memory.recalled', {
        member: audit.member,
        providers: [FLEET_MEMORY_PROCESSOR_ID],
        algorithm: audit.algorithm,
        effort: audit.effort,
        agent: audit.agent,
        resultCount: audit.resultCount,
        ...(audit.conversation === undefined ? {} : { conversation: audit.conversation }),
      }),
    }),
  ))
}
