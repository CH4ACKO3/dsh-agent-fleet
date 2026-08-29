import { unlinkSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
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
  FleetMessage,
  FleetMessagePermission,
  FleetTarget,
  FleetSystemNotificationKind,
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

const SPECIAL_TOOL_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  'joyride.control': ['joyride_catalog', 'joyride_act', 'joyride_control'],
  'livestream.host': ['live_stream', 'live_stage'],
}

import type { FleetMemberToolGroup } from './member-view.js'
import { FLEET_TOOL_CATALOG, installFleetToolDiscovery } from './tool-discovery.js'
import type { FleetAuthorizationChange, FleetAuthorizationService } from './authorization.js'
import {
  FleetTaskBoard,
  installTaskTools,
  type FleetProjectTaskEvent,
  type FleetTaskState,
} from './productivity/task.js'
import {
  FleetScheduler,
  installScheduleTools,
  type FleetScheduleState,
  type FleetScheduledTaskEvent,
} from './productivity/schedule.js'
import {
  FleetCalendar,
  installCalendarTools,
  type FleetCalendarEventChange,
  type FleetCalendarState,
} from './productivity/calendar.js'
import { fleetTeamEvents } from './team-events.js'
import type { FleetTeamEventDispatch } from './team-events.js'

export interface FleetCollaborationTeam {
  readonly id: string
  readonly ctx: Context
  readonly events: FleetTeamEventDispatch
  readonly messages: MessageHub
  readonly resources: FleetResources
  readonly memberStatuses: FleetMemberStatusBoard
  readonly tasks: FleetTaskBoard
  readonly scheduler: FleetScheduler
  readonly calendar: FleetCalendar
  readonly memberViews: ReadonlyMap<string, FleetMemberView>
  readonly memberIdsByName: Map<string, string>
  readonly memberNamesById: Map<string, string>
  attachMember(agentId: string, view: FleetMemberView, kind?: 'member' | 'assistant'): void
  rebindMember(previousAgentId: string, agentId: string, view: FleetMemberView, kind?: 'member' | 'assistant'): void
  detachMember(agentId: string): void
  updateMemberView(view: FleetMemberView, refreshTools?: boolean): void
  removeMemberView(member: string): void
  retireMember(input: {
    readonly agentId: string
    readonly member: string
    readonly successorAgentId: string
    readonly successor: string
  }): void
  sendUserMessage(input: SendMessageInput): SendMessageResult
  installTools(ctx: Context, member: string, options?: {
    readonly exposeHostFleetTools?: boolean
    readonly toolGroups?: readonly FleetMemberToolGroup[]
  }): () => void
  refreshAccess(member?: string): void
  activateProductivity(): void
  pauseProductivity(): void
  restoreProductivity(input: {
    readonly tasks: FleetTaskState
    readonly schedules: FleetScheduleState
    readonly calendar: FleetCalendarState
  }): void
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
  readonly assistantIds?: readonly string[]
  readonly defaultVoters: readonly string[]
  readonly projectRoot: string
  readonly sharedDirectory: string
  readonly onCoordination: (event: FleetCoordinationEvent) => void
  readonly onResource: (event: FleetResourceEvent) => void
  readonly onMemberStatus: (event: FleetMemberStatusEvent) => void
  readonly onTask?: (event: FleetProjectTaskEvent, state: FleetTaskState) => void
  readonly onSchedule?: (event: FleetScheduledTaskEvent, state: FleetScheduleState) => void
  readonly onCalendar?: (event: FleetCalendarEventChange, state: FleetCalendarState) => void
}

export class FleetCollaborationService {
  private readonly teams = new Map<string, FleetCollaborationTeam>()
  private readonly pendingAccessRefresh = new Map<string, Set<string>>()
  private readonly stopAccess: () => void
  private readonly stopStatus: () => void
  private readonly stopStep: () => void
  private readonly stopNamespaces: Array<() => void>

  constructor(private readonly ctx: Context, private readonly authorization: FleetAuthorizationService) {
    this.stopNamespaces = [
      authorization.registerNamespace({
        namespace: 'message',
        actions: [
          { id: 'wakeup', description: 'Wake a Fleet participant with a follow-up message.' },
          { id: 'interrupt', description: 'Interrupt a Fleet participant with an urgent message.' },
        ],
        defaultActions: ({ member }) => [
          ...(member.toolGroups.includes('coordination') ? ['wakeup'] : []),
          ...(member.permissions.includes('message.interrupt') ? ['interrupt'] : []),
        ],
      }),
      authorization.registerNamespace({
        namespace: 'task',
        actions: [
          { id: 'read', description: 'Read Team tasks.' },
          { id: 'create', description: 'Create Team tasks.' },
          { id: 'update', description: 'Update responsible Team tasks.' },
          { id: 'comment', description: 'Comment on Team tasks.' },
          { id: 'progress', description: 'Add Team task progress.' },
          { id: 'manage', description: 'Manage any Team task.' },
        ],
        defaultActions: ({ member }) => member.toolGroups.includes('tasks')
          || member.toolGroups.includes('coordination')
          ? ['read', 'create', 'update', 'comment', 'progress']
          : ['read'],
        installTools: (toolCtx, input) => installTaskTools(
          toolCtx,
          this.require(input.teamId).tasks,
          (agentId, action) => this.authorizeMember(input.teamId, agentId, action),
        ),
      }),
      authorization.registerNamespace({
        namespace: 'schedule',
        actions: [
          { id: 'read', description: 'Read Team schedules.' },
          { id: 'create', description: 'Create Team schedules.' },
          { id: 'update', description: 'Update, pause, resume, complete, or cancel responsible Team schedules.' },
          { id: 'manage', description: 'Manage any Team schedule.' },
        ],
        defaultActions: ({ member }) => member.toolGroups.includes('coordination')
          ? ['read', 'create', 'update']
          : ['read'],
        installTools: (toolCtx, input) => installScheduleTools(
          toolCtx,
          this.require(input.teamId).scheduler,
          (agentId, action) => this.authorizeMember(input.teamId, agentId, action),
        ),
      }),
      authorization.registerNamespace({
        namespace: 'calendar',
        actions: [
          { id: 'read', description: 'Read Team calendar events and free/busy.' },
          { id: 'create', description: 'Create Team calendar events.' },
          { id: 'update', description: 'Update owned Team calendar events.' },
          { id: 'rsvp', description: 'RSVP to invited Team calendar events.' },
          { id: 'manage', description: 'Manage any Team calendar event.' },
        ],
        defaultActions: ({ member }) => member.toolGroups.includes('coordination')
          ? ['read', 'create', 'update', 'rsvp']
          : ['read', 'rsvp'],
        installTools: (toolCtx, input) => installCalendarTools(
          toolCtx,
          this.require(input.teamId).calendar,
          (agentId, action) => this.authorizeMember(input.teamId, agentId, action),
        ),
      }),
    ]
    this.stopAccess = authorization.onChange(change => this.scheduleAccessRefresh(change))
    this.stopStatus = ctx.on('agent/status', ({ agent, status }) => {
      if (status !== 'idle') return
      this.flushAccessRefresh(String(agent.id))
    })
    this.stopStep = ctx.on('session/event', (session, event) => {
      if (event.type === 'step/end') this.flushAccessRefresh(String(session.id))
    })
  }

  private authorizeMember(teamId: string, agentId: string, action: string): boolean {
    const team = this.teams.get(teamId)
    const member = team?.memberNamesById.get(agentId)
    if (team === undefined || member === undefined) return false
    const actor = this.authorization.actorForAgent(agentId)
    return this.authorization.authorize({
      teamId,
      subject: actor?.teamId === teamId ? actor.subject : { kind: 'member', id: member },
      action,
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
    const assistantNames = new Set(input.assistantIds ?? [])
    const defaultVoterNames = new Set(input.defaultVoters)
    for (const member of defaultVoterNames) {
      if (!memberViews.has(member)) throw new Error(`unknown default Fleet voter ${member}`)
    }
    const user: MessageAgent = {
      id: `fleet-user:${input.id}`,
      inject: () => {},
      followup: () => {},
      steer: () => {},
      cancel: () => {},
    }
    const productivity: MessageAgent = {
      id: `fleet-productivity:${input.id}`,
      inject: () => {},
      followup: () => {},
      steer: () => {},
      cancel: () => {},
    }
    const participantName = (reference: string): string | undefined => {
      if (memberViews.has(reference)) return reference
      return memberNamesById.get(reference)
    }
    const viewForAgent = (agentId: string): FleetMemberView | undefined => {
      const name = participantName(agentId)
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
    const participantAgent = (reference: string): MessageAgent | undefined => {
      const name = participantName(reference)
      const sessionId = name === undefined ? undefined : memberIdsByName.get(name)
      const agent = sessionId === undefined ? undefined : this.ctx.agents.get(SessionId(sessionId))
      if (name === undefined || sessionId === undefined || agent === undefined) return undefined
      return {
        id: name,
        sessionId,
        inbox: agent.inbox,
        inject: message => { agent.inject(message) },
        followup: message => { agent.followup(message) },
        steer: message => { agent.steer(message) },
        cancel: (cause, options) => { agent.cancel(cause, options) },
      }
    }
    const agentDirectory: AgentDirectory = {
      get: id => {
        if (id === user.id) return user
        if (id === productivity.id) return productivity
        return participantAgent(id)
      },
      participantIds: () => [...memberViews.keys()],
      list: () => [...memberIdsByName.keys()].flatMap(id => {
        const agent = participantAgent(id)
        return agent === undefined ? [] : [agent]
      }),
      resolve: reference => {
        if (reference === 'User') return user.id
        const memberId = memberViews.has(reference)
          ? reference
          : memberNamesById.get(reference) ?? memberIdForDisplayName(reference)
        return memberId ?? reference
      },
      conversationKey: id => assistantNames.has(id) ? `assistant:${id}` : `member:${id}`,
      displayName: id => id === user.id ? 'User' : id === productivity.id ? 'Fleet' : viewForAgent(id)?.name,
      canContact: (senderId, recipientId) => {
        if (senderId === productivity.id) return memberViews.has(recipientId)
        if (recipientId === productivity.id) return memberViews.has(senderId)
        if (senderId === user.id) return memberViews.has(recipientId)
        if (recipientId === user.id) return memberViews.has(senderId)
        const sender = viewForAgent(senderId)
        const recipient = participantName(recipientId)
        return sender !== undefined && recipient !== undefined && fleetMemberCanContact(sender, recipient)
      },
      canAccessChannel: (agentId, channelId) => {
        if (agentId === user.id) return true
        const view = viewForAgent(agentId)
        return view !== undefined && fleetMemberCanAccessChannel(view, channelId)
      },
      hasPermission: (agentId, permission) => agentId === productivity.id
        ? permission === 'meeting.manage'
        : agentId !== user.id && hasPermission(agentId, permission),
      defaultVoter: agentId => {
        if (agentId === user.id || agentId === productivity.id) return false
        const name = participantName(agentId)
        return name !== undefined && defaultVoterNames.has(name)
      },
      canVote: agentId => {
        if (agentId === user.id || agentId === productivity.id) return false
        const name = participantName(agentId)
        return name !== undefined && defaultVoterNames.has(name)
      },
    }
    const memberDirectory: FleetMemberDirectory = {
      list: () => [...memberViews.keys()].map(name => ({ id: memberIdsByName.get(name) ?? name, name })),
      nameForAgent: id => memberNamesById.get(id),
      resolve: reference => {
        const value = reference.startsWith('@') ? reference.slice(1) : reference
        if (memberViews.has(value)) return value
        const memberId = memberIdForDisplayName(value)
        if (memberId !== undefined) return memberId
        return memberNamesById.get(value)
      },
    }
    const resources = new FleetResources(this.ctx.fs)
    const memberStatuses = new FleetMemberStatusBoard(memberDirectory)
    let events: FleetTeamEventDispatch
    let teamScope: Scope
    const messages = new MessageHub(agentDirectory, {
      beforeSend: (sender, message) => events.waterfall(
        'fleet/message/pre-send',
        { sender, input: message },
        () => ({ kind: 'send', input: message }),
      ),
      requiredActionInstruction: () => 'Fleet promotes this obligation to a persistent high-priority task. Call fleet_task with action="list" to find it. An acknowledgement or progress reply does not complete it. Perform the requested work, then call fleet_task with action="complete", this task id, and final_reply. Fleet sends final_reply to the source conversation before marking the task completed; ordinary native output is internal and does not count.',
    })
    const canManage = (agentId: string, namespace: string): boolean => {
      const member = memberNamesById.get(agentId)
      if (member === undefined) return false
      const subject = { kind: defaultVoterNames.has(member) ? 'member' as const : 'assistant' as const, id: member }
      return this.authorization.authorize({ teamId: input.id, subject, action: `${namespace}.manage` })
        || this.authorization.authorize({ teamId: input.id, subject, action: 'team.manage' })
    }
    const notifyMembers = (
      members: readonly string[],
      text: string,
      kind: FleetSystemNotificationKind,
      coalesceKey: string,
      delivery: 'quiet' | 'wakeup' = 'quiet',
    ): string[] => {
      const delivered: string[] = []
      for (const member of new Set(members)) {
        if (agentDirectory.get(member) === undefined) continue
        try {
          messages.sendSystemNotification(member, { kind, text, delivery, coalesceKey })
          delivered.push(member)
        } catch {}
      }
      return delivered
    }
    const replyTargetFor = (message: FleetMessage): FleetTarget =>
      message.conversation.startsWith('@') ? `@${message.from}` : message.conversation
    const tasks = new FleetTaskBoard(
      memberDirectory,
      agentId => canManage(agentId, 'task'),
      (task, recipients) => notifyMembers(
        recipients,
        `[Fleet task due] ${task.title} (${task.id})`,
        'task_notice',
        `task:${task.id}`,
        'wakeup',
      ),
      (callerId, task, finalReply) => {
        if (task.requirement?.kind !== 'message') return
        const sender = agentDirectory.get(callerId)
        if (sender === undefined) throw new Error(`Fleet task ${task.id} assignee is not an active Team participant`)
        let source: FleetMessage | undefined
        try {
          source = messages.getMessage(sender, task.requirement.messageId)
        } catch {}
        const replyTarget = task.requirement.replyTarget ?? (source === undefined ? undefined : replyTargetFor(source))
        if (replyTarget === undefined) {
          throw new Error(`Fleet task ${task.id} cannot resolve the source conversation for its final reply`)
        }
        const existingFinal = messages.search(sender, {
          conversation: replyTarget as FleetTarget,
          limit: 100,
        }).reverse().find(message =>
          message.kind === 'text'
          && message.from === sender.id
          && message.createdAt >= task.createdAt
          && message.text.trim() === finalReply)
        if (existingFinal !== undefined) return { messageId: existingFinal.id }
        const result = messages.send(sender, {
          to: replyTarget as FleetTarget,
          text: finalReply,
          delivery: 'quiet',
          ...(source === undefined ? {} : { replyTo: source.id }),
        })
        return { messageId: result.messageId }
      },
    )
    const hasPendingRequirement = (member: string): boolean => {
      const task = tasks.pendingRequirement(member)
      return task !== undefined && task.status !== 'cancelled'
    }
    const requiredRecipients = (message: FleetMessage): string[] => {
      if (message.mustReply === true) return [...new Set(message.recipientIds ?? [])]
      return [...new Set(message.mentions)]
    }
    const requiredTitle = (message: FleetMessage): string => {
      const preview = message.text.replace(/\s+/gu, ' ').trim()
      const shortened = preview.length > 120 ? `${preview.slice(0, 117)}...` : preview
      return `Required from @${message.fromName ?? message.from}: ${shortened}`
    }
    const ensureMessageTasks = (message: FleetMessage): void => {
      if (message.kind !== 'text') return
      const createdBy = participantName(message.from) ?? message.fromName ?? 'User'
      for (const assignee of requiredRecipients(message)) {
        if (!memberViews.has(assignee)) continue
        tasks.ensureMessageTask({
          messageId: message.id,
          conversation: message.conversationId ?? message.conversation,
          createdBy,
          assignee,
          replyTarget: replyTargetFor(message),
          title: requiredTitle(message),
          description: [
            `Required action created from Fleet message ${message.id} in ${message.conversation}.`,
            '',
            message.text,
          ].join('\n'),
          resources: message.resources,
        })
        revealRequiredTaskTool(assignee)
      }
    }
    const scheduler = new FleetScheduler(memberDirectory, agentId => canManage(agentId, 'schedule'), (task, recipients) =>
      notifyMembers(
        recipients,
        `[Fleet schedule due] ${task.title}\n${task.instructions}`.trim(),
        'schedule_notice',
        `schedule:${task.id}`,
        'wakeup',
      ))
    const calendar = new FleetCalendar(memberDirectory, event => {
      const participants = [event.organizer, ...event.attendees]
        .filter(member => event.rsvps[member] !== 'declined')
        .flatMap(member => {
          return agentDirectory.get(member) === undefined ? [] : [`@${member}`]
        })
      if (participants.length === 0) return undefined
      const meetingId = `calendar-${event.id.slice(-12)}-${event.occurrence}`.replace(/[^a-z0-9]+/gu, '-')
      try {
        return messages.openMeeting(productivity, {
          id: meetingId,
          title: event.title,
          agenda: event.agenda,
          participants,
        }).id
      } catch (error) {
        this.ctx.logger('dsh-agent-fleet').warn(
          `Failed to open Meeting for Fleet calendar event ${event.id}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return undefined
      }
    }, agentId => canManage(agentId, 'calendar'))
    let revealRequiredTaskTool = (_member: string): void => {}
    const stops = [
      messages.onEvent(event => {
        input.onCoordination(event)
        if (event.type === 'message') ensureMessageTasks(event.message)
        if (event.type === 'meeting' && event.action === 'closed') {
          calendar.closeLinkedMeeting(event.meeting.id, event.meeting.closedAt)
        }
      }),
      resources.onEvent(input.onResource),
      memberStatuses.onEvent(input.onMemberStatus),
      tasks.onEvent(event => {
        input.onTask?.(event, tasks.state())
        if (event.task.requirement?.kind === 'message') revealRequiredTaskTool(event.task.requirement.assignee)
        if (event.action === 'completed' && event.task.requirement?.kind === 'message') {
          messages.completeRequiredReply(event.task.requirement.assignee, event.task.requirement.messageId)
        }
        if (event.action !== 'due' && event.action !== 'notification') {
          const recipients = [...event.task.assignees, ...event.task.reviewers, ...event.task.followers]
            .filter(member => member !== event.actor)
          notifyMembers(
            recipients,
            event.task.requirement === undefined
              ? `[Fleet task ${event.action}] ${event.task.title} (${event.task.id})`
              : `[Fleet required task ${event.action}] ${event.task.title} (${event.task.id}). An acknowledgement or progress reply does not complete this obligation. After the work is done, use fleet_task action="complete" with final_reply; Fleet sends that final result to the source conversation before completion.`,
            'task_notice',
            `task:${event.task.id}`,
            event.task.requirement === undefined && (event.action === 'created' || event.action === 'completed')
              ? 'wakeup'
              : 'quiet',
          )
        }
      }),
      scheduler.onEvent(event => {
        input.onSchedule?.(event, scheduler.state())
        if (event.action !== 'triggered' && event.action !== 'notification') {
          notifyMembers(
            event.task.assignees.filter(member => member !== event.actor),
            `[Fleet schedule ${event.action}] ${event.task.title} (${event.task.id})`,
            'schedule_notice',
            `schedule:${event.task.id}`,
          )
        }
      }),
      calendar.onEvent(event => {
        input.onCalendar?.(event, calendar.state())
        const recipients = [event.event.organizer, ...event.event.attendees].filter(member => member !== event.actor)
        notifyMembers(
          recipients,
          `[Fleet calendar ${event.action}] ${event.event.title} (${event.event.id})`,
          'calendar_notice',
          `calendar:${event.event.id}`,
        )
      }),
    ]
    interface ToolBinding {
      readonly ctx: Context
      readonly member: string
      readonly exposeHostFleetTools: boolean
      readonly toolGroups?: readonly FleetMemberToolGroup[]
      loadedTools: Set<string>
      loadTool: (name: string) => void
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
    const createToolBinding = (
      ctx: Context,
      member: string,
      exposeHostFleetTools: boolean,
      selectedToolGroups?: readonly FleetMemberToolGroup[],
      previouslyLoaded: readonly string[] = [],
    ): Pick<ToolBinding, 'loadedTools' | 'loadTool' | 'stop'> => {
      const view = memberViews.get(member)
      if (view === undefined) throw new Error(`unknown Fleet member view ${member}`)
      const effective = this.authorization.resolve(input.id, view)
      const tools = new Set(selectedToolGroups ?? effective.toolGroups)
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
      const namespaceEntries = new Map(FLEET_TOOL_CATALOG
        .filter(entry => entry.source === 'namespace' && entry.namespace !== undefined)
        .map(entry => [entry.namespace!, entry]))
      const authorizationNamespaces = new Map(this.authorization.namespaces()
        .map(namespace => [namespace.namespace, namespace]))
      const visibleNamespaces = new Map([...authorizationNamespaces.values()]
        .filter(namespace => this.authorization.visible(namespace, effective))
        .map(namespace => [namespace.namespace, namespace]))
      const allowed = new Set<string>()
      for (const entry of FLEET_TOOL_CATALOG) {
        if (entry.source === 'host') {
          if (!exposeHostFleetTools) continue
          if (ctx.tools.get(entry.name) === undefined) continue
          if (entry.name === 'fleet_progress' && !permissions.has('member-status.read')) continue
          if (entry.name === 'fleet_member' && !permissions.has('team.manage') && !effective.op) continue
          allowed.add(entry.name)
          continue
        }
        if (entry.source === 'namespace') {
          if (entry.namespace !== undefined && (visibleNamespaces.has(entry.namespace)
            || (entry.name === 'fleet_task' && authorizationNamespaces.has(entry.namespace)))) allowed.add(entry.name)
          continue
        }
        if (entry.source === 'messages' && tools.has('messages')) allowed.add(entry.name)
        else if (entry.source === 'status' && tools.has('status')) allowed.add(entry.name)
        else if (entry.source === 'coordination' && tools.has('coordination')) allowed.add(entry.name)
        else if (entry.source === 'resources' && tools.has('resources')) allowed.add(entry.name)
      }
      const loadedTools = new Set<string>(previouslyLoaded.filter(name => allowed.has(name)))
      if (tools.has('messages')) {
        loadedTools.add('fleet_send')
        loadedTools.add('fleet_messages')
      }
      if (hasPendingRequirement(member) && allowed.has('fleet_task')) loadedTools.add('fleet_task')
      const localStops: Array<() => void> = []
      const add = (stop: (() => void) | void): (() => void) | void => {
        if (stop !== undefined) localStops.push(stop)
        return stop
      }
      let hostRestrictionStop: (() => void) | undefined
      const refreshHostRestriction = (): void => {
        hostRestrictionStop?.()
        const deny = [
          'fleet_agent', 'fleet_archive', 'fleet_setup',
          ...FLEET_TOOL_CATALOG.filter(entry => entry.source === 'host' && (!allowed.has(entry.name) || !loadedTools.has(entry.name))).map(entry => entry.name),
        ]
        hostRestrictionStop = ctx.tools.restrict({ deny: [...new Set(deny)] })
      }
      const loadTool = (name: string): void => {
        if (!allowed.has(name) || loadedTools.has(name)) return
        const entry = FLEET_TOOL_CATALOG.find(candidate => candidate.name === name)
        if (entry === undefined) return
        let stop: (() => void) | void = undefined
        if (entry.source === 'messages' || entry.source === 'coordination') {
          stop = installMessageTools(ctx, messages, {
            messages: entry.source === 'messages',
            coordination: entry.source === 'coordination',
            tools: new Set([name]),
            permissions: messagePermissions,
            authorize,
          })
        } else if (entry.source === 'status') {
          stop = installCollaborationTools(ctx, memberStatuses, { tools: new Set([name]), authorize })
        } else if (entry.source === 'resources') {
          stop = installResourceTools(ctx, resources, {
            tools: new Set([name]),
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
            deleteShared: path => {
              const root = resolve(input.projectRoot, input.sharedDirectory)
              const target = resolve(root, path)
              const nested = relative(root, target)
              if (nested === '' || nested === '..' || nested.startsWith(`..${sep}`) || isAbsolute(nested)) {
                throw new Error('Fleet shared delete path must stay inside the Team shared directory')
              }
              unlinkSync(target)
            },
          })
        } else if (entry.source === 'namespace' && entry.namespace !== undefined) {
          const namespace = visibleNamespaces.get(entry.namespace)
            ?? (entry.name === 'fleet_task' && hasPendingRequirement(member)
              ? authorizationNamespaces.get(entry.namespace)
              : undefined)
          stop = namespace?.installTools?.(ctx, {
            teamId: input.id,
            projectRoot: input.projectRoot,
            member: view,
            hasMember: candidate => memberViews.has(candidate),
            authorization: effective,
          })
        } else if (entry.source === 'host') {
          loadedTools.add(name)
          refreshHostRestriction()
          return
        }
        add(stop)
        loadedTools.add(name)
      }
      try {
        for (const name of [...loadedTools]) {
          loadedTools.delete(name)
          loadTool(name)
        }
        add(installFleetToolDiscovery(ctx, {
          allowedTools: allowed,
          loadedTools,
          permissions,
          load: loadTool,
        }))
        for (const namespace of this.authorization.namespaces()) {
          if (!this.authorization.visible(namespace, effective)) continue
          if (namespaceEntries.has(namespace.namespace)) continue
          add(namespace.installTools?.(ctx, {
            teamId: input.id,
            projectRoot: input.projectRoot,
            member: view,
            hasMember: candidate => memberViews.has(candidate),
            authorization: effective,
          }))
        }
        const deniedSpecialTools = Object.entries(SPECIAL_TOOL_PERMISSIONS)
          .filter(([permission]) => !permissions.has(permission))
          .flatMap(([, names]) => names)
        const installedDeniedTools = deniedSpecialTools.filter(name => ctx.tools.get(name) !== undefined)
        if (installedDeniedTools.length > 0) {
          add(ctx.tools.restrict({ deny: installedDeniedTools }))
        }
        if (deniedSpecialTools.length > 0) {
          const denied = new Set(deniedSpecialTools)
          add(ctx.tools.guard(execution => denied.has(execution.name)
            ? `Fleet member @${view.id} is not permitted to use ${execution.name}`
            : undefined))
        }
        refreshHostRestriction()
      } catch (error) {
        hostRestrictionStop?.()
        for (const stop of localStops.reverse()) stop()
        throw error
      }
      return { loadedTools, loadTool, stop: () => {
        hostRestrictionStop?.()
        for (const stop of localStops.reverse()) stop()
      } }
    }
    const refreshBinding = (binding: ToolBinding): void => {
      const previouslyLoaded = [...binding.loadedTools]
      binding.stop()
      const runtime = createToolBinding(
        binding.ctx,
        binding.member,
        binding.exposeHostFleetTools,
        binding.toolGroups,
        previouslyLoaded,
      )
      binding.loadedTools = runtime.loadedTools
      binding.loadTool = runtime.loadTool
      binding.stop = runtime.stop
    }
    revealRequiredTaskTool = () => {
      for (const binding of toolBindings) if (hasPendingRequirement(binding.member)) binding.loadTool('fleet_task')
    }
    let closed = false
    const team: FleetCollaborationTeam = {
      id: input.id,
      get ctx() { return teamScope.ctx },
      get events() { return events },
      messages,
      resources,
      memberStatuses,
      tasks,
      scheduler,
      calendar,
      memberViews,
      memberIdsByName,
      memberNamesById,
      attachMember: (agentId, view, kind = 'member') => {
        memberViews.set(view.id, structuredClone(view))
        if (kind === 'assistant') assistantNames.add(view.id)
        else assistantNames.delete(view.id)
        memberIdsByName.set(view.id, agentId)
        memberNamesById.set(agentId, view.id)
        messages.refreshAgent(view.id)
        tasks.replayPending(view.id)
        scheduler.replayPending(view.id)
      },
      rebindMember: (previousAgentId, agentId, view, kind = 'member') => {
        disposeMemberBindings(view.id)
        memberViews.set(view.id, structuredClone(view))
        if (kind === 'assistant') assistantNames.add(view.id)
        else assistantNames.delete(view.id)
        memberNamesById.delete(previousAgentId)
        memberIdsByName.set(view.id, agentId)
        memberNamesById.set(agentId, view.id)
        messages.refreshAgent(view.id)
        tasks.replayPending(view.id)
        scheduler.replayPending(view.id)
      },
      detachMember: (agentId) => {
        const name = memberNamesById.get(agentId)
        if (name === undefined) return
        disposeMemberBindings(name)
        memberNamesById.delete(agentId)
        if (memberIdsByName.get(name) === agentId) memberIdsByName.delete(name)
      },
      updateMemberView: (view, refreshTools = true) => {
        memberViews.set(view.id, structuredClone(view))
        defaultVoterNames.add(view.id)
        if (refreshTools) {
          for (const binding of [...toolBindings]) if (binding.member === view.id) refreshBinding(binding)
        }
      },
      retireMember: ({ agentId, member, successorAgentId, successor }) => {
        messages.retireAgent(member, successor)
        memberStatuses.retireMember(member)
        resources.release(agentId)
        tasks.retireMember(member, successor)
        scheduler.retireMember(member, successor)
        calendar.retireMember(member, successor)
      },
      removeMemberView: (member) => {
        disposeMemberBindings(member)
        const agentId = memberIdsByName.get(member)
        if (agentId !== undefined) {
          memberIdsByName.delete(member)
          memberNamesById.delete(agentId)
        }
        memberViews.delete(member)
        assistantNames.delete(member)
        defaultVoterNames.delete(member)
      },
      sendUserMessage: message => {
        if (message.to.startsWith('#')) messages.connectAgent(user.id, [message.to.slice(1)])
        return messages.sendHuman(user, message)
      },
      installTools: (ctx, member, options = {}) => {
        const binding: ToolBinding = {
          ctx,
          member,
          exposeHostFleetTools: options.exposeHostFleetTools ?? false,
          ...(options.toolGroups === undefined ? {} : { toolGroups: [...options.toolGroups] }),
          loadedTools: new Set(),
          loadTool: () => {},
          stop: () => {},
        }
        const runtime = createToolBinding(ctx, member, binding.exposeHostFleetTools, binding.toolGroups)
        binding.loadedTools = runtime.loadedTools
        binding.loadTool = runtime.loadTool
        binding.stop = runtime.stop
        toolBindings.add(binding)
        if (hasPendingRequirement(member)) binding.loadTool('fleet_task')
        queueMicrotask(() => {
          if (toolBindings.has(binding) && hasPendingRequirement(member)) binding.loadTool('fleet_task')
        })
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
      activateProductivity: () => {
        tasks.activate()
        scheduler.activate()
        calendar.activate()
        calendar.retryPendingStarts()
      },
      pauseProductivity: () => {
        tasks.pause()
        scheduler.pause()
        calendar.pause()
      },
      restoreProductivity: state => {
        tasks.restore(state.tasks)
        scheduler.restore(state.schedules)
        calendar.restore(state.calendar)
      },
      restore: (state) => {
        messages.restore(state.coordination)
        for (const task of tasks.state().tasks) {
          if (task.status === 'completed' && task.requirement?.kind === 'message') {
            messages.completeRequiredReply(task.requirement.assignee, task.requirement.messageId)
          }
        }
        for (const member of memberViews.keys()) {
          for (const message of messages.pendingRequiredReplies(member)) ensureMessageTasks(message)
        }
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
        tasks.close()
        scheduler.close()
        calendar.close()
        events.emit('fleet/team/disposed', {})
        void teamScope.dispose().catch(error => {
          this.ctx.logger('dsh-agent-fleet').warn(
            `Could not dispose Fleet Team ${input.id} scope: ${String(error)}`,
          )
        })
      },
    }
    teamScope = typeof (this.ctx as Context & { plugin?: unknown }).plugin === 'function'
      ? createScope(this.ctx, team)
      : {
          ctx: this.ctx,
          rawDispose: () => {},
          dispose: () => Promise.resolve(),
        }
    events = fleetTeamEvents(this.ctx, team)
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
    this.stopStep()
    this.stopStatus()
    this.stopAccess()
    for (const stop of this.stopNamespaces.reverse()) stop()
  }
}
