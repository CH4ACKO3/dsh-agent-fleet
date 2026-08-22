import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  FleetMemberStatusBoard,
  FleetScheduler,
  FleetTaskBoard,
  FleetCalendar,
  installCalendarTools,
  installCollaborationTools,
  installTaskTools,
} from '@dsh-agent-fleet/core'
import type {
  FleetCalendarEvent,
  FleetCalendarEventChange,
  FleetMemberDirectory,
  FleetMemberStatusEvent,
  FleetScheduledTask,
  FleetScheduledTaskEvent,
  FleetProjectTaskEvent,
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
import type { FleetMemberView, FleetWorkspaceMount } from './member-view.js'
import type { FleetMemberToolGroup } from './member-view.js'
import { installFleetToolDiscovery } from './tool-discovery.js'
import type { FleetAccessChange, FleetAccessService } from './access.js'

export interface FleetCollaborationTeam {
  readonly id: string
  readonly messages: MessageHub
  readonly resources: FleetResources
  readonly git?: FleetGitTeamRuntime
  readonly memberStatuses: FleetMemberStatusBoard
  readonly scheduler: FleetScheduler
  readonly tasks: FleetTaskBoard
  readonly calendar: FleetCalendar
  readonly memberViews: ReadonlyMap<string, FleetMemberView>
  readonly memberIdsByName: Map<string, string>
  readonly memberNamesById: Map<string, string>
  readonly memberWorkspaces: ReadonlyMap<string, readonly FleetWorkspaceMount[]>
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
  setMemberWorkspaces(member: string, workspaces: readonly FleetWorkspaceMount[]): void
  sendUserMessage(input: SendMessageInput): SendMessageResult
  installTools(ctx: Context, member: string, options?: { readonly exposeHostFleetTools?: boolean }): () => void
  refreshAccess(member?: string): void
  restore(input: {
    readonly coordination: readonly FleetCoordinationEvent[]
    readonly resources: Parameters<FleetResources['restoreResources']>[0]
    readonly memberStatuses: readonly FleetMemberStatusEvent[]
    readonly scheduledTasks: readonly FleetScheduledTaskEvent[]
    readonly projectTasks: readonly FleetProjectTaskEvent[]
    readonly calendarEvents: readonly FleetCalendarEventChange[]
    readonly documents: readonly Extract<FleetResourceEvent, { document: unknown }>[]
  }): void
  close(): void
}

export interface FleetGitToolOptions {
  readonly memberFor: (agentId: string) => string | undefined
  readonly hasMember: (member: string) => boolean
  readonly hasPermission: (agentId: string, permission: string) => boolean
  readonly workspacesFor: (agentId: string) => readonly FleetWorkspaceMount[]
  readonly permissions: ReadonlySet<string>
}

export interface FleetGitEvent {
  readonly action: 'worktree_created'
  readonly member: string
  readonly path: string
  readonly branch: string
}

/** Optional Team-scoped Git capability supplied by dsh-agent-fleet-git. */
export interface FleetGitTeamRuntime {
  installTools(ctx: Context, options: FleetGitToolOptions): (() => void) | void
  close?(): void
}

/**
 * Runtime extension point for the optional Git sub-plugin. The base Fleet does
 * not create worktrees or register fleet_git when no provider is installed.
 */
export interface FleetGitIntegration {
  open(input: {
    readonly teamId: string
    readonly projectRoot: string
    readonly onEvent: (event: FleetGitEvent) => void
  }): FleetGitTeamRuntime
}

export interface OpenFleetCollaborationTeamInput {
  readonly id: string
  readonly memberViews: readonly FleetMemberView[]
  readonly projectRoot: string
  readonly sharedDirectory: string
  readonly onCoordination: (event: FleetCoordinationEvent) => void
  readonly onResource: (event: FleetResourceEvent) => void
  readonly onGit: (event: FleetGitEvent) => void
  readonly onMemberStatus: (event: FleetMemberStatusEvent) => void
  readonly onScheduledTask: (event: FleetScheduledTaskEvent) => void
  readonly onScheduledTaskDue: (task: FleetScheduledTask) => void
  readonly onProjectTask: (event: FleetProjectTaskEvent) => void
  readonly onProjectTaskDue: (task: FleetProjectTaskEvent['task']) => void
  readonly onCalendar: (event: FleetCalendarEventChange) => void
  readonly onCalendarDue: (event: FleetCalendarEvent) => string | undefined
}

export class FleetCollaborationService {
  private readonly teams = new Map<string, FleetCollaborationTeam>()
  private readonly stopAccess: () => void

  constructor(private readonly ctx: Context, private readonly access: FleetAccessService) {
    this.stopAccess = access.onChange(change => this.refreshAccess(change))
  }

  private refreshAccess(change: FleetAccessChange): void {
    for (const [teamId, team] of this.teams) {
      if (change.teamId !== undefined && change.teamId !== teamId) continue
      if (change.members === undefined || change.members.length === 0) team.refreshAccess()
      else for (const member of change.members) team.refreshAccess(member)
    }
  }

  open(input: OpenFleetCollaborationTeamInput): FleetCollaborationTeam {
    if (this.teams.has(input.id)) throw new Error(`Fleet collaboration team ${input.id} is already open`)

    const memberIdsByName = new Map<string, string>()
    const memberNamesById = new Map<string, string>()
    const memberViews = new Map(input.memberViews.map(view => [view.id, structuredClone(view)]))
    const defaultVoterNames = new Set(input.memberViews.map(view => view.id))
    const memberWorkspaces = new Map<string, FleetWorkspaceMount[]>()
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
      return view !== undefined && this.access.has(input.id, view, permission)
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
    const gitIntegration = this.ctx.get('fleetGitIntegration', false) as FleetGitIntegration | undefined
    const git = gitIntegration?.open({
      teamId: input.id,
      projectRoot: input.projectRoot,
      onEvent: input.onGit,
    })
    const memberStatuses = new FleetMemberStatusBoard(memberDirectory)
    const scheduler = new FleetScheduler(memberDirectory, input.onScheduledTaskDue)
    const tasks = new FleetTaskBoard(
      memberDirectory,
      agentId => hasPermission(agentId, 'task.manage'),
      input.onProjectTaskDue,
    )
    const calendar = new FleetCalendar(
      memberDirectory,
      input.onCalendarDue,
      agentId => hasPermission(agentId, 'calendar.manage'),
    )
    const messages = new MessageHub(agentDirectory, {
      validateTaskReference: (taskId, assigneeId) => {
        const assignee = assigneeId === undefined ? undefined : memberNamesById.get(assigneeId)
        if (assigneeId !== undefined && assignee === undefined) throw new Error(`unknown Fleet member ${assigneeId}`)
        tasks.validateReference(taskId, assignee)
      },
    })
    const stops = [
      messages.onEvent(input.onCoordination),
      resources.onEvent(input.onResource),
      memberStatuses.onEvent(input.onMemberStatus),
      scheduler.onEvent(input.onScheduledTask),
      tasks.onEvent(input.onProjectTask),
      calendar.onEvent(input.onCalendar),
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
      const effective = this.access.resolve(input.id, view)
      const tools = new Set(effective.toolGroups.filter(group => group !== 'git' || git !== undefined) as FleetMemberToolGroup[])
      const permissions = new Set(effective.permissions)
      const messagePermissions = new Set<FleetMessagePermission>(
        effective.permissions.filter((permission): permission is FleetMessagePermission =>
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
          })
        }
        if (group === 'schedule') {
          return installCollaborationTools(ctx, memberStatuses, scheduler, {
            status: false,
            schedule: true,
            createSchedule: permissions.has('schedule.create'),
            canCreateSchedule: agentId => hasPermission(agentId, 'schedule.create'),
          })
        }
        if (group === 'tasks') return installTaskTools(ctx, tasks)
        if (group === 'calendar') return installCalendarTools(ctx, calendar)
        if (group === 'resources' || group === 'documents') {
          return installResourceTools(ctx, resources, {
            projectRoot: input.projectRoot,
            sharedDirectory: input.sharedDirectory,
            canWrite: agentId => hasPermission(agentId, 'resource.write'),
            canWriteDocument: agentId => hasPermission(agentId, 'document.write'),
            resources: group === 'resources',
            documents: group === 'documents',
            resourceWrite: permissions.has('resource.write'),
            documentWrite: permissions.has('document.write'),
            workspacesFor: agentId => {
              const name = memberNamesById.get(agentId)
              return name === undefined ? [] : memberWorkspaces.get(name) ?? []
            },
          })
        }
        if (group === 'git') {
          if (git === undefined) throw new Error('Fleet Git capability is not installed')
          return git.installTools(ctx, {
            memberFor: agentId => memberNamesById.get(agentId),
            hasMember: candidate => memberViews.has(candidate),
            hasPermission,
            workspacesFor: agentId => {
              const name = memberNamesById.get(agentId)
              return name === undefined ? [] : memberWorkspaces.get(name) ?? []
            },
            permissions,
          })
        }
      }
      try {
        if (tools.has('messages')) {
          add(installMessageTools(ctx, messages, { messages: true, coordination: false }))
          loaded.add('messages')
        }
        if (tools.has('status')) {
          add(installCollaborationTools(ctx, memberStatuses, scheduler, { status: true, schedule: false }))
          loaded.add('status')
        }
        add(installFleetToolDiscovery(ctx, {
          allowedGroups: tools,
          loadedGroups: loaded,
          permissions,
          load,
        }))
        for (const namespace of this.access.namespaces()) {
          if (!this.access.visible(namespace, effective)) continue
          add(namespace.installTools?.(ctx, { teamId: input.id, member: view, access: effective }))
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
              ...(permissions.has('workspace.manage') || effective.op ? [] : ['fleet_workspace']),
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
      ...(git === undefined ? {} : { git }),
      memberStatuses,
      scheduler,
      tasks,
      calendar,
      memberViews,
      memberIdsByName,
      memberNamesById,
      memberWorkspaces,
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
        scheduler.retireMember(member, successor)
        tasks.retireMember(member, successor)
        calendar.retireMember(member, successor)
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
        memberWorkspaces.delete(member)
      },
      setMemberWorkspaces: (member, workspaces) => {
        if (!memberViews.has(member)) throw new Error(`unknown Fleet member view ${member}`)
        memberWorkspaces.set(member, workspaces.map(workspace => structuredClone(workspace)))
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
        scheduler.restore(state.scheduledTasks)
        tasks.restore(state.projectTasks)
        calendar.restore(state.calendarEvents)
        resources.restoreDocuments(state.documents as Parameters<FleetResources['restoreDocuments']>[0])
      },
      close: () => {
        if (closed) return
        closed = true
        for (const binding of [...toolBindings]) {
          toolBindings.delete(binding)
          binding.stop()
        }
        for (const stop of stops) stop()
        scheduler.close()
        tasks.close()
        calendar.close()
        git?.close?.()
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
  }

  close(): void {
    for (const team of this.teams.values()) team.close()
    this.teams.clear()
    this.stopAccess()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetGitIntegration: FleetGitIntegration
  }
}
