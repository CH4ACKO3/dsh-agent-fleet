import type { Context } from '@deepseek-ai/cordis'
import type {
  FleetCollaborationTeam,
  FleetTeamLiveEvent,
} from 'dsh-agent-fleet'
import type {} from 'dsh-agent-fleet'
import { FLEET_MEMORY_PROCESSOR_ID } from './patchouli.js'
import type { MemoryData, MemoryPluginOutcome, PatchouliCore } from './patchouli.js'

export const name = 'dsh-agent-fleet-patchouli/adapter'

const SOURCE = { type: 'fleet', id: name } as const

type IntegrationContext = Context & Pick<Context, 'fleetRuns'> & {
  readonly patchouli: PatchouliCore
}

interface EventRoute {
  readonly scope: string
  readonly conversation?: string
}

interface QueuedEvent {
  readonly team: FleetCollaborationTeam
  readonly event: FleetTeamLiveEvent
  readonly route: EventRoute
}

interface TeamQueue {
  readonly items: (QueuedEvent | undefined)[]
  head: number
  size: number
  dropped: number
  running: boolean
  worker: Promise<void>
}

const TEAM_QUEUE_CAPACITY = 256

const SHARED_EVENT_TYPES = new Set([
  'team_created',
  'team_resumed',
  'team_settled',
  'team_status',
  'team_woken',
  'work_started',
  'work_status',
  'member_attached',
  'member_continued',
  'member_detached',
  'member_network_recovery_scheduled',
  'member_network_recovery_woken',
  'member_protocol_recovery_scheduled',
  'member_protocol_recovery_woken',
  'member_protocol_recovery_exhausted',
  'member_paused',
  'member_resumed',
  'member_session_rotated',
  'member_update_failed',
  'member_updated',
  'member_view_added',
  'member_view_removed',
  'member_view_updated',
  'assistant_attached',
  'assistant_rebound',
  'assistant_detached',
  'team_requests_configured',
])

function teamScope(teamId: string): string {
  return `fleet:${teamId}:shared`
}

function conversationScope(teamId: string, conversation: string): string {
  return `fleet:${teamId}:conversation:${conversation}`
}

function eventRoute(team: FleetCollaborationTeam, event: FleetTeamLiveEvent): EventRoute | undefined {
  if (!event.type.startsWith('coordination.')) {
    return SHARED_EVENT_TYPES.has(event.type) ? { scope: teamScope(team.id) } : undefined
  }
  if (typeof event.data !== 'object' || event.data === null) return undefined
  const data = event.data as Record<string, unknown>

  if (event.type === 'coordination.message') {
    const message = data.message
    if (typeof message !== 'object' || message === null) return undefined
    const value = message as Record<string, unknown>
    const target = value.conversation
    if (typeof target !== 'string') return undefined
    if (target.startsWith('@')) {
      const conversation = value.conversationId
      if (typeof conversation !== 'string') return undefined
      return { scope: conversationScope(team.id, conversation), conversation }
    }
    if (target.startsWith('#') || target.startsWith('meeting:')) {
      return { scope: conversationScope(team.id, target), conversation: target }
    }
    return undefined
  }

  if (event.type === 'coordination.channel') {
    const channel = data.channel
    const id = typeof channel === 'object' && channel !== null
      ? (channel as Record<string, unknown>).id
      : undefined
    return typeof id === 'string'
      ? { scope: conversationScope(team.id, `#${id}`), conversation: `#${id}` }
      : undefined
  }
  if (event.type === 'coordination.meeting') {
    const meeting = data.meeting
    const id = typeof meeting === 'object' && meeting !== null
      ? (meeting as Record<string, unknown>).id
      : undefined
    return typeof id === 'string'
      ? { scope: conversationScope(team.id, `meeting:${id}`), conversation: `meeting:${id}` }
      : undefined
  }
  if (event.type === 'coordination.vote') {
    const vote = data.vote
    const channel = typeof vote === 'object' && vote !== null
      ? (vote as Record<string, unknown>).channel
      : undefined
    return typeof channel === 'string'
      ? { scope: conversationScope(team.id, channel), conversation: channel }
      : undefined
  }

  // Delivery receipts, targeted system notifications, reactions, and pins add noise or
  // cannot be assigned to a conversation without a second lookup.
  return undefined
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function safeMemberView(event: FleetTeamLiveEvent): FleetTeamLiveEvent {
  if (event.type !== 'member_view_added' && event.type !== 'member_view_updated') return event
  const data = record(event.data)
  const view = record(data?.view)
  if (view === undefined) return { ...event, data: {} }
  const safe = Object.fromEntries(['id', 'name', 'color', 'role', 'responsibility']
    .flatMap(key => view[key] === undefined ? [] : [[key, view[key]]]))
  return {
    ...event,
    data: {
      view: safe,
      ...(typeof data?.reason === 'string' ? { reason: data.reason } : {}),
    },
  }
}

function eventContent(event: FleetTeamLiveEvent): string {
  return `[Fleet event ${event.sequence}: ${event.type}]\n${JSON.stringify(event.data)}`
}

function publicTimelineRoute(route: EventRoute): boolean {
  return route.conversation === undefined
    || route.conversation.startsWith('#')
    || route.conversation.startsWith('meeting:')
}

function effectiveWrites(outcomes: readonly MemoryPluginOutcome<MemoryData>[]): {
  readonly providers: readonly string[]
  readonly storedCount: number
} {
  const providers: string[] = []
  let storedCount = 0
  for (const outcome of outcomes) {
    if (!outcome.ok || outcome.pluginId !== FLEET_MEMORY_PROCESSOR_ID
      || typeof outcome.value !== 'object' || outcome.value === null || Array.isArray(outcome.value)) continue
    const result = outcome.value as Record<string, unknown>
    if (result.handled !== true || typeof result.stored !== 'number'
      || !Number.isSafeInteger(result.stored) || result.stored < 1) continue
    providers.push(outcome.pluginId)
    storedCount += result.stored
  }
  return { providers, storedCount }
}

function warnFailures(
  ctx: Context,
  outcomes: readonly MemoryPluginOutcome<MemoryData>[],
): void {
  const logger = ctx.logger(name)
  for (const outcome of outcomes) if (!outcome.ok) {
    logger.warn(`Patchouli update through ${outcome.pluginId} failed: ${outcome.error}`)
  }
}

function install(scope: IntegrationContext): () => Promise<void> {
  const lifetime = new AbortController()
  const queues = new Map<string, TeamQueue>()

  const dispatch = async ({ team, event, route }: QueuedEvent): Promise<void> => {
    if (lifetime.signal.aborted) return
    try {
      const outcomes = await scope.patchouli.update({
        meta: {
          source: SOURCE,
          scope: route.scope,
          attributes: {
            fleetPoint: 'team/event',
            fleetEffort: 'low',
            teamId: team.id,
            eventType: event.type,
            sequence: event.sequence,
            ...(route.conversation === undefined ? {} : { conversation: route.conversation }),
          },
        },
        data: {
          kind: 'fleet-event',
          teamId: team.id,
          event,
          content: eventContent(event),
        },
      }, lifetime.signal)
      warnFailures(scope, outcomes)
      const writes = effectiveWrites(outcomes)
      if (writes.storedCount > 0 && publicTimelineRoute(route)) {
        scope.fleetRuns.recordDataEvent(team.id, 'memory.stored', {
          sourceSequence: event.sequence,
          eventType: event.type,
          providers: writes.providers,
          storedCount: writes.storedCount,
          ...(route.conversation === undefined ? {} : { conversation: route.conversation }),
        })
      }
    } catch (error) {
      if (!lifetime.signal.aborted) scope.logger(name).warn(
        `Patchouli update for Fleet event ${event.sequence} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const drain = async (teamId: string, queue: TeamQueue): Promise<void> => {
    while (!lifetime.signal.aborted) {
      if (queue.size === 0) break
      const item = queue.items[queue.head]
      queue.items[queue.head] = undefined
      queue.head = (queue.head + 1) % TEAM_QUEUE_CAPACITY
      queue.size -= 1
      if (item === undefined) break
      await dispatch(item)
    }
    if (queues.get(teamId) === queue) queues.delete(teamId)
  }

  const enqueue = (team: FleetCollaborationTeam, event: FleetTeamLiveEvent): void => {
    const route = eventRoute(team, event)
    if (route === undefined) return
    const queued: QueuedEvent = { team, event: safeMemberView(event), route }
    let queue = queues.get(team.id)
    if (queue === undefined) {
      queue = {
        items: new Array<QueuedEvent | undefined>(TEAM_QUEUE_CAPACITY),
        head: 0,
        size: 0,
        dropped: 0,
        running: false,
        worker: Promise.resolve(),
      }
      queues.set(team.id, queue)
    }
    if (queue.size === TEAM_QUEUE_CAPACITY) {
      // These are replayable Patchouli indexing inputs; the durable Fleet journal is untouched.
      queue.items[queue.head] = undefined
      queue.head = (queue.head + 1) % TEAM_QUEUE_CAPACITY
      queue.size -= 1
      queue.dropped += 1
      if (queue.dropped === 1 || queue.dropped % 100 === 0) {
        scope.logger(name).warn(
          `Patchouli event queue for Fleet team ${team.id} dropped ${String(queue.dropped)} old derived indexing events; the Fleet journal remains intact`,
        )
      }
    }
    queue.items[(queue.head + queue.size) % TEAM_QUEUE_CAPACITY] = queued
    queue.size += 1
    if (queue.running) return
    queue.running = true
    queue.worker = drain(team.id, queue).catch(error => {
      if (!lifetime.signal.aborted) scope.logger(name).warn(
        `Patchouli event worker for Fleet team ${team.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      if (queues.get(team.id) === queue) queues.delete(team.id)
    })
  }

  const stopEvents = scope.on('fleet/team/event', ({ team, event }) => { enqueue(team, event) })
  return async () => {
    stopEvents()
    lifetime.abort(new Error('dsh-agent-fleet-patchouli disposed'))
    await Promise.allSettled([...queues.values()].map(queue => queue.worker))
    queues.clear()
  }
}

export function apply(ctx: Context): void {
  const host = ctx as unknown as {
    inject(
      services: readonly string[],
      callback: (scope: IntegrationContext) => () => Promise<void>,
    ): void
  }
  host.inject(['fleetRuns', 'patchouli'], install)
}
