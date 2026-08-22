import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  FleetMemberStatusBoard,
  installCollaborationTools,
} from '@dsh-agent-fleet/core'
import type {
  FleetMemberDirectory,
  FleetMemberStatusEvent,
} from '@dsh-agent-fleet/core'
import { installMessageTools, MessageHub } from '@dsh-agent-fleet/message'
import type {
  AgentDirectory,
  FleetCoordinationEvent,
  FleetMessagePermission,
  MessageAgent,
  SendMessageInput,
  SendMessageResult,
} from '@dsh-agent-fleet/message'
import { FleetResources, installResourceTools } from '@dsh-agent-fleet/resources'
import type { FleetResourceEvent } from '@dsh-agent-fleet/resources'
import {
  fleetMemberCanAccessChannel,
  fleetMemberCanContact,
} from './member-view.js'
import type { FleetMemberView } from './member-view.js'
import type { FleetMemberToolGroup } from './member-view.js'
import { installFleetToolDiscovery } from './tool-discovery.js'
import type { FleetAuthorizationChange, FleetAuthorizationService } from './authorization.js'

export interface FleetCollaborationTeam {
  readonly id: string
  readonly messages: MessageHub
  readonly resources: FleetResources
  readonly memberStatuses: FleetMemberStatusBoard
  readonly memberViews: ReadonlyMap<string, FleetMemberView>
  readonly memberIdsByName: Map<string, string>
  readonly memberNamesById: Map<string, string>
  attachMember(agentId: string, view: FleetMemberView): void
  rebindMember(previousAgentId: string, agentId: string, view: FleetMemberView): void
  detachMember(agentId: string): void
  updateMemberView(view: FleetMemberView): void
  removeMemberView(member: string): void
  retireMember(input: {
    readonly agentId: string
    readonly member: string
    readonly successorAgentId: string
    readonly successor: string
  }): void
  sendUserMessage(input: SendMessageInput): SendMessageResult
  installTools(ctx: Context, member: string, options?: { readonly exposeHostFleetTools?: boolean }): () => void
  refreshAccess(member?: string): void
  restore(input: {
    readonly coordination: readonly FleetCoordinationEvent[]
    readonly resources: Parameters<FleetResources['restoreResources']>[0]
    readonly memberStatuses: readonly FleetMemberStatusEvent[]
  }): void
  close(): void
}

export interface OpenFleetCollaborationTeamInput {
  readonly id: string
  readonly memberViews: readonly FleetMemberView[]
  readonly projectRoot: string
  readonly sharedDirectory: string
  readonly onCoordination: (event: FleetCoordinationEvent) => void
  readonly onResource: (event: FleetResourceEvent) => void
  readonly onMemberStatus: (event: FleetMemberStatusEvent) => void
}

export class FleetCollaborationService {
  private readonly teams = new Map<string, FleetCollaborationTeam>()
  private readonly pendingAccessRefresh = new Map<string, Set<string>>()
  private readonly stopAccess: () => void
  private readonly stopStatus: () => void

  constructor(private readonly ctx: Context, private readonly authorization: FleetAuthorizationService) {
    this.stopAccess = authorization.onChange(change => this.scheduleAccessRefresh(change))
    this.stopStatus = ctx.on('agent/status', ({ agent, status }) => {
      if (status !== 'idle') return
      this.flushAccessRefresh(String(agent.id))
    })
  }

  private scheduleAccessRefresh(change: FleetAuthorizationChange): void {
    for (const [teamId, team] of this.teams) {
      if (change.teamId !== undefined && change.teamId !== teamId) continue
      const members = change.members === undefined || change.members.length === 0
        ? [...team.memberIdsByName.keys()]
        : change.members
      for (const member of members) {
        const agentId = team.memberIdsByName.get(member)
        if (agentId !== undefined && this.ctx.agents.get(SessionId(agentId))?.status === 'idle') {
          team.refreshAccess(member)
          continue
        }
        let pending = this.pendingAccessRefresh.get(teamId)
        if (pending === undefined) {
          pending = new Set()
          this.pendingAccessRefresh.set(teamId, pending)
        }
        pending.add(member)
      }
    }
  }

  private flushAccessRefresh(agentId: string): void {
    for (const [teamId, pending] of this.pendingAccessRefresh) {
      const team = this.teams.get(teamId)
      const member = team?.memberNamesById.get(agentId)
      if (team === undefined || member === undefined || !pending.delete(member)) continue
      team.refreshAccess(member)
      if (pending.size === 0) this.pendingAccessRefresh.delete(teamId)
    }
  }

  open(input: OpenFleetCollaborationTeamInput): FleetCollaborationTeam {
    if (this.teams.has(input.id)) throw new Error(`Fleet collaboration team ${input.id} is already open`)

    const memberIdsByName = new Map<string, string>()
    const memberNamesById = new Map<string, string>()
    const memberViews = new Map(input.memberViews.map(view => [view.id, structuredClone(view)]))
    const defaultVoterNames = new Set(input.memberViews.map(view => view.id))
    const user: MessageAgent = {
      id: `fleet-user:${input.id}`,
      inject: () => {},
      followup: () => {},
      steer: () => {},
      cancel: () => {},
    }
    const viewForAgent = (agentId: string): FleetMemberView | undefined => {
      const name = memberNamesById.get(agentId)
      return name === undefined ? undefined : memberViews.get(name)
    }
    const memberIdForDisplayName = (displayName: string): string | undefined => {
      const matches = [...memberViews.values()]
        .filter(view => view.name === displayName && memberIdsByName.has(view.id))
      if (matches.length > 1) throw new Error(`ambiguous Fleet member display name ${displayName}`)
      return matches[0]?.id
    }
    const hasPermission = (agentId: string, permission: string): boolean => {
      const view = viewForAgent(agentId)
      return view !== undefined && this.authorization.has(input.id, view, permission)
    }
    const agentDirectory: AgentDirectory = {
      get: id => {
        if (id === user.id) return user
        return memberNamesById.has(id) ? this.ctx.agents.get(SessionId(id)) : undefined
      },
      list: () => [...memberNamesById.keys()].flatMap(id => {
        const agent = this.ctx.agents.get(SessionId(id))
        return agent === undefined ? [] : [agent]
      }),
      resolve: reference => {
        if (reference === 'User') return user.id
        const memberId = memberIdsByName.has(reference) ? reference : memberIdForDisplayName(reference)
        return memberId === undefined ? reference : memberIdsByName.get(memberId) ?? reference
      },
      displayName: id => id === user.id ? 'User' : viewForAgent(id)?.name,
      canContact: (senderId, recipientId) => {
        if (senderId === user.id) return memberNamesById.has(recipientId)
        if (recipientId === user.id) return memberNamesById.has(senderId)
        const sender = viewForAgent(senderId)
        const recipient = memberNamesById.get(recipientId)
        return sender !== undefined && recipient !== undefined && fleetMemberCanContact(sender, recipient)
      },
      canAccessChannel: (agentId, channelId) => {
        if (agentId === user.id) return true
        const view = viewForAgent(agentId)
        return view !== undefined && fleetMemberCanAccessChannel(view, channelId)
      },
      hasPermission: (agentId, permission) => agentId !== user.id && hasPermission(agentId, permission),
      defaultVoter: agentId => {
        if (agentId === user.id) return false
        const name = memberNamesById.get(agentId)
        return name !== undefined && defaultVoterNames.has(name)
      },
    }
    const memberDirectory: FleetMemberDirectory = {
      list: () => [...memberIdsByName].map(([name, id]) => ({ id, name })),
      nameForAgent: id => memberNamesById.get(id),
      resolve: reference => {
        const value = reference.startsWith('@') ? reference.slice(1) : reference
        if (memberIdsByName.has(value)) return value
        const memberId = memberIdForDisplayName(value)
        if (memberId !== undefined) return memberId
        return memberNamesById.get(value)
      },
    }
    const resources = new FleetResources(this.ctx.fs)
    const memberStatuses = new FleetMemberStatusBoard(memberDirectory)
    const messages = new MessageHub(agentDirectory)
    const stops = [
      messages.onEvent(input.onCoordination),
      resources.onEvent(input.onResource),
      memberStatuses.onEvent(input.onMemberStatus),
    ]
    interface ToolBinding {
      readonly ctx: Context
      readonly member: string
      readonly exposeHostFleetTools: boolean
      stop: () => void
    }
    const toolBindings = new Set<ToolBinding>()
    const disposeMemberBindings = (member: string): void => {
      for (const binding of [...toolBindings]) {
        if (binding.member !== member) continue
        toolBindings.delete(binding)
        binding.stop()
      }
    }
    const createToolBinding = (ctx: Context, member: string, exposeHostFleetTools: boolean): (() => void) => {
      const view = memberViews.get(member)
      if (view === undefined) throw new Error(`unknown Fleet member view ${member}`)
      const effective = this.authorization.resolve(input.id, view)
      const tools = new Set(effective.toolGroups)
      const permissions = new Set(effective.actions)
      const authorize = (
        agentId: string,
        action: string,
        resource?: { readonly kind: string; readonly id: string },
      ): boolean => {
        const actor = memberNamesById.get(agentId)
        if (actor === undefined) return false
        return this.authorization.authorize({
          teamId: input.id,
          subject: { kind: defaultVoterNames.has(actor) ? 'member' : 'assistant', id: actor },
          action,
          resource: resource ?? { kind: 'team', id: input.id },
        })
      }
      const messagePermissions = new Set<FleetMessagePermission>(
        effective.actions.filter((permission): permission is FleetMessagePermission =>
          permission === 'channel.manage' || permission === 'meeting.manage' || permission === 'vote.create'),
      )
      const loaded = new Set<FleetMemberToolGroup>()
      const localStops: Array<() => void> = []
      const add = (stop: (() => void) | void): (() => void) | void => {
        if (stop !== undefined) localStops.push(stop)
        return stop
      }
      const load = (group: FleetMemberToolGroup): (() => void) | void => {
        if (group === 'coordination') {
          return installMessageTools(ctx, messages, {
            messages: false,
            coordination: true,
            permissions: messagePermissions,
            authorize,
          })
        }
        if (group === 'resources') {
          return installResourceTools(ctx, resources, {
            projectRoot: input.projectRoot,
            sharedDirectory: input.sharedDirectory,
            canRead: (agentId, kind, id) => authorize(
              agentId,
              kind === 'work' ? 'work.read' : 'resource.read',
              kind === 'work'
                ? undefined
                : { kind: kind === 'shared' ? 'file' : kind, id: id ?? '*' },
            ),
            canWrite: (agentId, kind, id) => authorize(
              agentId,
              kind === 'work' ? 'work.claim' : 'resource.write',
              kind === 'work'
                ? undefined
                : { kind: kind === 'shared' ? 'file' : kind, id: id ?? '*' },
            ),
            resourceWrite: permissions.has('resource.write'),
          })
        }
      }
      try {
        if (tools.has('messages')) {
          add(installMessageTools(ctx, messages, { messages: true, coordination: false, authorize }))
          loaded.add('messages')
        }
        if (tools.has('status')) {
          add(installCollaborationTools(ctx, memberStatuses, { authorize }))
          loaded.add('status')
        }
        add(installFleetToolDiscovery(ctx, {
          allowedGroups: tools,
          loadedGroups: loaded,
          permissions,
          load,
        }))
        for (const namespace of this.authorization.namespaces()) {
          if (!this.authorization.visible(namespace, effective)) continue
          add(namespace.installTools?.(ctx, {
            teamId: input.id,
            projectRoot: input.projectRoot,
            member: view,
            hasMember: candidate => memberViews.has(candidate),
            authorization: effective,
          }))
        }
        if (!exposeHostFleetTools) {
          add(ctx.tools.restrict({
            deny: [
              'fleet_agent',
              'fleet_run',
              'fleet_archive',
              'fleet_assistant',
              'fleet_trace',
              'fleet_setup',
              ...(permissions.has('team.manage') || effective.op ? [] : ['fleet_member']),
            ],
          }))
        }
      } catch (error) {
        for (const stop of localStops.reverse()) stop()
        throw error
      }
      return () => {
        for (const stop of localStops.reverse()) stop()
      }
    }
    const refreshBinding = (binding: ToolBinding): void => {
      binding.stop()
      binding.stop = createToolBinding(binding.ctx, binding.member, binding.exposeHostFleetTools)
    }
    let closed = false
    const team: FleetCollaborationTeam = {
      id: input.id,
      messages,
      resources,
      memberStatuses,
      memberViews,
      memberIdsByName,
      memberNamesById,
      attachMember: (agentId, view) => {
        memberViews.set(view.id, structuredClone(view))
        memberIdsByName.set(view.id, agentId)
        memberNamesById.set(agentId, view.id)
      },
      rebindMember: (previousAgentId, agentId, view) => {
        disposeMemberBindings(view.id)
        memberViews.set(view.id, structuredClone(view))
        memberNamesById.delete(previousAgentId)
        memberIdsByName.set(view.id, agentId)
        memberNamesById.set(agentId, view.id)
        messages.rebindAgent(previousAgentId, agentId)
      },
      detachMember: (agentId) => {
        const name = memberNamesById.get(agentId)
        if (name === undefined) return
        disposeMemberBindings(name)
        memberNamesById.delete(agentId)
        if (memberIdsByName.get(name) === agentId) memberIdsByName.delete(name)
      },
      updateMemberView: (view) => {
        memberViews.set(view.id, structuredClone(view))
        defaultVoterNames.add(view.id)
        for (const binding of [...toolBindings]) if (binding.member === view.id) refreshBinding(binding)
      },
      retireMember: ({ agentId, member, successorAgentId, successor }) => {
        messages.retireAgent(agentId, successorAgentId)
        memberStatuses.retireMember(member)
        resources.release(agentId)
      },
      removeMemberView: (member) => {
        disposeMemberBindings(member)
        const agentId = memberIdsByName.get(member)
        if (agentId !== undefined) {
          memberIdsByName.delete(member)
          memberNamesById.delete(agentId)
        }
        memberViews.delete(member)
        defaultVoterNames.delete(member)
      },
      sendUserMessage: message => {
        if (message.to.startsWith('#')) messages.connectAgent(user.id, [message.to.slice(1)])
        return messages.send(user, message)
      },
      installTools: (ctx, member, options = {}) => {
        const binding: ToolBinding = {
          ctx,
          member,
          exposeHostFleetTools: options.exposeHostFleetTools ?? false,
          stop: () => {},
        }
        binding.stop = createToolBinding(ctx, member, binding.exposeHostFleetTools)
        toolBindings.add(binding)
        return () => {
          if (!toolBindings.delete(binding)) return
          binding.stop()
        }
      },
      refreshAccess: (member) => {
        for (const binding of [...toolBindings]) {
          if (member === undefined || binding.member === member) refreshBinding(binding)
        }
      },
      restore: (state) => {
        messages.restore(state.coordination)
        resources.restoreResources(state.resources)
        memberStatuses.restore(state.memberStatuses)
      },
      close: () => {
        if (closed) return
        closed = true
        for (const binding of [...toolBindings]) {
          toolBindings.delete(binding)
          binding.stop()
        }
        for (const stop of stops) stop()
        messages.close()
        resources.reset()
      },
    }
    this.teams.set(input.id, team)
    return team
  }

  has(id: string): boolean {
    return this.teams.has(id)
  }

  get(id: string): FleetCollaborationTeam | undefined {
    return this.teams.get(id)
  }

  require(id: string): FleetCollaborationTeam {
    const team = this.teams.get(id)
    if (team === undefined) throw new Error(`Fleet team ${id} is not active in this process`)
    return team
  }

  ids(): string[] {
    return [...this.teams.keys()]
  }

  entries(): Array<[string, FleetCollaborationTeam]> {
    return [...this.teams.entries()]
  }

  closeTeam(id: string): void {
    this.teams.get(id)?.close()
    this.teams.delete(id)
    this.pendingAccessRefresh.delete(id)
  }

  close(): void {
    for (const team of this.teams.values()) team.close()
    this.teams.clear()
    this.pendingAccessRefresh.clear()
    this.stopStatus()
    this.stopAccess()
  }
}
