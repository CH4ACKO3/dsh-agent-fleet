import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  FleetAuthorizationNamespace,
  FleetCollaborationTeam,
  FleetTeamLiveEvent,
} from 'dsh-agent-fleet'
import type {} from 'dsh-agent-fleet'
import type { MemoryData, MemoryPluginOutcome, PatchouliCore } from './patchouli.js'

export const name = 'dsh-fleet-patchouli/adapter'

const SOURCE = { type: 'fleet', id: name } as const

type IntegrationContext = Context & Pick<Context, 'fleetAuthorization' | 'fleetCollaboration' | 'fleetRuns'> & {
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
  readonly items: QueuedEvent[]
  worker: Promise<void>
}

function teamScope(teamId: string): string {
  return `fleet:${teamId}:shared`
}

function conversationScope(teamId: string, conversation: string): string {
  return `fleet:${teamId}:conversation:${conversation}`
}

function stableParticipant(team: FleetCollaborationTeam, sessionId: string): string {
  if (sessionId === `fleet-user:${team.id}`) return 'user'
  return team.memberNamesById.get(sessionId) ?? sessionId
}

function directConversation(left: string, right: string): string {
  return `dm:${[left, right].sort().map(encodeURIComponent).join(':')}`
}

function eventRoute(team: FleetCollaborationTeam, event: FleetTeamLiveEvent): EventRoute | undefined {
  if (!event.type.startsWith('coordination.')) {
    return event.type.startsWith('team_')
      || event.type.startsWith('work_')
      || event.type.startsWith('member_')
      ? { scope: teamScope(team.id) }
      : undefined
  }
  if (typeof event.data !== 'object' || event.data === null) return undefined
  const data = event.data as Record<string, unknown>

  if (event.type === 'coordination.message') {
    const message = data.message
    if (typeof message !== 'object' || message === null) return undefined
    const value = message as Record<string, unknown>
    const target = value.conversation
    const from = value.from
    if (typeof target !== 'string' || typeof from !== 'string') return undefined
    if (target.startsWith('@')) {
      const conversation = directConversation(
        stableParticipant(team, from),
        stableParticipant(team, target.slice(1)),
      )
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

function recallRoute(
  teamId: string,
  member: string,
  conversation: string | undefined,
  hasMember: (member: string) => boolean,
): EventRoute {
  if (conversation === undefined) return { scope: teamScope(teamId) }
  const target = conversation.trim()
  if (target.startsWith('@')) {
    const peer = target.slice(1)
    if (!hasMember(peer)) throw new Error(`unknown Fleet member ${peer}`)
    const direct = directConversation(member, peer)
    return { scope: conversationScope(teamId, direct), conversation: target }
  }
  if (target.startsWith('#') || target.startsWith('meeting:')) {
    return { scope: conversationScope(teamId, target), conversation: target }
  }
  throw new Error('conversation must use #channel, @member, or meeting:id form')
}

function output(outcomes: readonly MemoryPluginOutcome<MemoryData>[]): string {
  if (outcomes.length === 0) return 'No installed Patchouli provider accepted this Fleet recall request.'
  return outcomes.map(outcome => outcome.ok
    ? `[${outcome.pluginId}] ${JSON.stringify(outcome.value)}`
    : `[${outcome.pluginId}] error: ${outcome.error}`).join('\n\n')
}

function eventContent(event: FleetTeamLiveEvent): string {
  return `[Fleet event ${event.sequence}: ${event.type}]\n${JSON.stringify(event.data)}`
}

function publicTimelineRoute(route: EventRoute): boolean {
  return route.conversation === undefined
    || route.conversation.startsWith('#')
    || route.conversation.startsWith('meeting:')
}

function successfulProviders(outcomes: readonly MemoryPluginOutcome<MemoryData>[]): string[] {
  return outcomes.flatMap(outcome => outcome.ok ? [outcome.pluginId] : [])
}

function warnFailures(
  ctx: Context,
  operation: 'update' | 'retrieve',
  outcomes: readonly MemoryPluginOutcome<MemoryData>[],
): void {
  const logger = ctx.logger(name)
  for (const outcome of outcomes) {
    if (!outcome.ok) logger.warn(`Patchouli ${operation} through ${outcome.pluginId} failed: ${outcome.error}`)
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
      warnFailures(scope, 'update', outcomes)
      const providers = successfulProviders(outcomes)
      if (providers.length > 0 && publicTimelineRoute(route)) {
        scope.fleetRuns.recordDataEvent(team.id, 'memory.stored', {
          sourceSequence: event.sequence,
          eventType: event.type,
          providers,
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
      const item = queue.items.shift()
      if (item === undefined) break
      await dispatch(item)
    }
    if (queues.get(teamId) === queue) queues.delete(teamId)
  }

  const enqueue = (team: FleetCollaborationTeam, event: FleetTeamLiveEvent): void => {
    const route = eventRoute(team, event)
    if (route === undefined) return
    const queued: QueuedEvent = { team, event, route }
    const existing = queues.get(team.id)
    if (existing !== undefined) {
      existing.items.push(queued)
      return
    }
    const queue: TeamQueue = { items: [queued], worker: Promise.resolve() }
    queues.set(team.id, queue)
    queue.worker = drain(team.id, queue).catch(error => {
      if (!lifetime.signal.aborted) scope.logger(name).warn(
        `Patchouli event worker for Fleet team ${team.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      if (queues.get(team.id) === queue) queues.delete(team.id)
    })
  }

  const namespace: FleetAuthorizationNamespace = {
    namespace: 'memory',
    actions: [{ id: 'recall', description: 'Recall historical Team information through Patchouli.' }],
    defaultActions: () => ['recall'],
    installTools(ctx, input) {
      return ctx.tools.register(defineTool({
        name: 'fleet_recall',
        description: 'Recall older Team events and conversations from Patchouli. The tool call stays visible in the Team member trace.',
        parameters: {
          query: { type: 'string', required: true, description: 'What historical information to find.' },
          conversation: { type: 'string', description: 'Optional #channel, @member, or meeting:id scope. Omit for shared Team history.' },
          limit: { type: 'integer', description: 'Optional positive result limit requested from each Patchouli provider.' },
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args, exec) {
          const agent = exec.agent as Agent | undefined
          if (agent === undefined) throw new Error('fleet_recall requires a calling Agent')
          const actor = scope.fleetAuthorization.actorForAgent(String(agent.id))
          if (actor === undefined || actor.teamId !== input.teamId || actor.subject.id !== input.member.id) {
            throw new Error(`Agent ${String(agent.id)} is not an active member of Fleet team ${input.teamId}`)
          }
          scope.fleetAuthorization.require({
            teamId: input.teamId,
            subject: actor.subject,
            action: 'memory.recall',
          })
          const query = args.query.trim()
          if (query.length === 0) throw new Error('fleet_recall query cannot be empty')
          if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1)) {
            throw new Error('fleet_recall limit must be a positive safe integer')
          }
          const route = recallRoute(input.teamId, input.member.id, args.conversation, input.hasMember)
          if (route.conversation !== undefined) {
            scope.fleetAuthorization.require({
              teamId: input.teamId,
              subject: actor.subject,
              action: 'message.read',
              resource: { kind: 'conversation', id: route.conversation.startsWith('dm:') ? args.conversation ?? '' : route.conversation },
            })
            const team = scope.fleetCollaboration.require(input.teamId)
            if (route.conversation.startsWith('#')
              && !team.messages.listChannels(agent).some(channel => `#${channel.id}` === route.conversation)) {
              throw new Error(`Fleet conversation ${route.conversation} is not visible to ${input.member.id}`)
            }
            if (route.conversation.startsWith('meeting:')
              && !team.messages.listMeetings(agent).some(meeting => `meeting:${meeting.id}` === route.conversation)) {
              throw new Error(`Fleet conversation ${route.conversation} is not visible to ${input.member.id}`)
            }
          }
          const outcomes = await scope.patchouli.retrieve({
            meta: {
              source: SOURCE,
              scope: route.scope,
              attributes: {
                fleetPoint: 'tool/recall',
                teamId: input.teamId,
                member: input.member.id,
                ...(route.conversation === undefined ? {} : { conversation: route.conversation }),
              },
            },
            data: {
              query,
              ...(args.limit === undefined ? {} : { limit: args.limit }),
            },
          }, exec.signal)
          warnFailures(scope, 'retrieve', outcomes)
          const providers = successfulProviders(outcomes)
          if (publicTimelineRoute(route)) {
            scope.fleetRuns.recordDataEvent(input.teamId, 'memory.recalled', {
              member: input.member.id,
              query: query.length <= 240 ? query : `${query.slice(0, 239)}…`,
              providers,
              ...(route.conversation === undefined ? {} : { conversation: route.conversation }),
            })
          }
          return output(outcomes)
        },
        presentCall: args => ({ card: 'generic', title: 'Recall Team history', kind: 'read', rawInput: args.query }),
      }))
    },
  }

  const stopNamespace = scope.fleetAuthorization.registerNamespace(namespace)
  const stopEvents = scope.on('fleet/team/event', ({ team, event }) => { enqueue(team, event) })
  return async () => {
    stopEvents()
    stopNamespace()
    lifetime.abort(new Error('dsh-fleet-patchouli disposed'))
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
  host.inject(['fleetAuthorization', 'fleetCollaboration', 'fleetRuns', 'patchouli'], install)
}
