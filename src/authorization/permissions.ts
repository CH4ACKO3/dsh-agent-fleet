import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import {
  FLEET_MEMBER_PERMISSIONS,
  FLEET_MEMBER_TOOL_GROUP_ACTIONS,
  FLEET_MEMBER_TOOL_GROUPS,
  type FleetMemberView,
} from '../member-view.js'
import type {
  FleetActionPolicyInput,
  FleetActionPolicy,
  FleetAuthorizationService,
  FleetEffectiveAuthorization,
} from '../authorization.js'
import type { FleetRunService } from '../run.js'
import {
  fleetPrivateGroupId,
  type FleetAuthorizationGroup,
  type FleetGroupService,
} from './groups.js'

export const FLEET_PERMISSIONS_CONFIGURATION_MODULE = 'dsh-agent-fleet/authorization/permissions'
export const FLEET_PERMISSIONS_STATE_NAMESPACE = 'authorization-permissions'

export interface FleetPermissionAssignment {
  readonly grants: readonly string[]
  readonly denies: readonly string[]
  readonly toolGroups: readonly string[]
  readonly denyToolGroups: readonly string[]
  readonly op?: boolean
}

export interface FleetPermissionGroup extends FleetAuthorizationGroup {
  readonly toolGroups: readonly string[]
  readonly denyToolGroups?: readonly string[]
  readonly actions: readonly string[]
  readonly denies?: readonly string[]
  readonly op?: boolean
}

export interface FleetMemberAccess extends FleetPermissionAssignment {
  readonly groups: readonly string[]
}

export interface FleetPermissionState {
  readonly version: 1
  readonly groups: Readonly<Record<string, FleetPermissionAssignment>>
}

export interface FleetMemberPermissionProjection {
  readonly assignment: FleetMemberAccess
  readonly configured: boolean
  readonly effective: FleetEffectiveAuthorization
  readonly groups: readonly FleetPermissionGroup[]
  readonly availableActions: readonly string[]
  readonly availableToolGroups: readonly string[]
}

const EMPTY_STATE: FleetPermissionState = { version: 1, groups: {} }

export const FLEET_PERMISSION_PRESETS: readonly FleetPermissionGroup[] = [
  {
    id: 'observer', name: 'Observer', parents: [], preset: true,
    toolGroups: ['messages', 'status', 'resources'],
    actions: [
      'task.read', 'schedule.read', 'calendar.read', 'calendar.rsvp',
      'document.read', 'workspace.read', 'access.inspect',
    ],
  },
  {
    id: 'member', name: 'Collaborator', parents: ['observer'], preset: true,
    toolGroups: ['coordination'], actions: [
      'task.create', 'task.update', 'task.comment', 'task.progress',
      'schedule.create', 'schedule.update',
      'calendar.create', 'calendar.update',
      'document.comment', 'message.wakeup',
    ],
  },
  {
    id: 'researcher', name: 'Researcher', parents: ['member'], preset: true,
    toolGroups: [], actions: ['resource.write', 'document.write'],
  },
  {
    id: 'facilitator', name: 'Facilitator', parents: ['member'], preset: true,
    toolGroups: [], actions: [
      'channel.manage', 'meeting.manage', 'vote.create',
      'task.manage', 'schedule.manage', 'calendar.manage',
      'message.interrupt',
    ],
  },
  {
    id: 'maintainer', name: 'Maintainer', parents: ['researcher', 'facilitator'], preset: true,
    toolGroups: [], actions: ['team.manage', 'workspace.manage', 'access.manage', 'permissions.manage'],
  },
  {
    id: 'op', name: 'OP', parents: [], preset: true, toolGroups: [], actions: [], op: true,
  },
] as const

const NATIVE_PRESET_COMBINATIONS: readonly (readonly string[])[] = [
  ['observer'],
  ['member'],
  ['researcher'],
  ['facilitator'],
  ['researcher', 'facilitator'],
  ['maintainer'],
]

function presetAuthorization(groupIds: readonly string[]): { toolGroups: string[]; actions: string[] } {
  const groups = new Map(FLEET_PERMISSION_PRESETS.map(group => [group.id, group]))
  const toolGroups = new Set<string>()
  const actions = new Set<string>()
  const visited = new Set<string>()
  const add = (id: string): void => {
    if (visited.has(id)) return
    const group = groups.get(id)
    if (group === undefined) throw new Error(`unknown built-in Fleet permission group ${id}`)
    visited.add(id)
    for (const parent of group.parents) add(parent)
    for (const toolGroup of group.toolGroups) toolGroups.add(toolGroup)
    for (const action of group.actions) actions.add(action)
  }
  for (const id of groupIds) add(id)
  return { toolGroups: [...toolGroups], actions: [...actions] }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value))
}

function nativeAssignment(member: FleetMemberView): FleetMemberAccess {
  for (const groups of NATIVE_PRESET_COMBINATIONS) {
    const authorization = presetAuthorization(groups)
    const nativeActions = authorization.actions.filter(action =>
      (FLEET_MEMBER_PERMISSIONS as readonly string[]).includes(action),
    )
    if (sameValues(member.toolGroups, authorization.toolGroups)
      && sameValues(member.permissions, nativeActions)) {
      return { groups: [...groups], grants: [], denies: [], toolGroups: [], denyToolGroups: [] }
    }
  }
  return {
    groups: [],
    grants: [...member.permissions],
    denies: [],
    toolGroups: [...member.toolGroups],
    denyToolGroups: [],
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function cloneState(state: FleetPermissionState): FleetPermissionState {
  return structuredClone(state)
}

function assignment(value: JsonValue): FleetPermissionAssignment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { grants: [], denies: [], toolGroups: [], denyToolGroups: [] }
  }
  const input = value as Record<string, JsonValue>
  const strings = (key: string): string[] => Array.isArray(input[key])
    ? (input[key] as JsonValue[]).filter((entry): entry is string => typeof entry === 'string')
    : []
  return {
    grants: strings('grants'),
    denies: strings('denies'),
    toolGroups: strings('toolGroups'),
    denyToolGroups: strings('denyToolGroups'),
    ...(input.op === true ? { op: true } : {}),
  }
}

function assignments(value: JsonValue | undefined): Record<string, FleetPermissionAssignment> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).map(([id, entry]) => [id, assignment(entry)]))
}

function parseState(value: JsonValue | undefined): FleetPermissionState {
  if (value === undefined) return cloneState(EMPTY_STATE)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Fleet Permission state must be an object')
  }
  const input = value as Record<string, JsonValue>
  if (input.version !== 1 || typeof input.groups !== 'object'
    || input.groups === null || Array.isArray(input.groups)) {
    throw new Error('Fleet Permission state must contain version 1 groups')
  }
  return { version: 1, groups: assignments(input.groups) }
}

export function parseFleetPermissionConfiguration(value: unknown): FleetPermissionState {
  return parseState(value as JsonValue)
}

function asJson(state: FleetPermissionState): JsonValue {
  return state as unknown as JsonValue
}

export class FleetPermissionService implements FleetActionPolicy {
  private readonly states = new Map<string, FleetPermissionState>()

  constructor(
    private readonly runs: FleetRunService,
    private readonly authorization: FleetAuthorizationService,
    private readonly groupService: FleetGroupService,
  ) {}

  state(teamId: string): FleetPermissionState {
    let state = this.states.get(teamId)
    if (state === undefined) {
      const persisted = this.runs.readExtensionState(teamId, FLEET_PERMISSIONS_STATE_NAMESPACE)
      const configured = persisted === undefined ? this.configurationState(teamId) : undefined
      state = persisted !== undefined
        ? parseState(persisted)
        : configured === undefined
          ? cloneState(EMPTY_STATE)
          : parseFleetPermissionConfiguration(configured)
      this.states.set(teamId, state)
    }
    return cloneState(state)
  }

  groups(teamId: string): FleetPermissionGroup[] {
    const state = this.state(teamId)
    const presets = new Map(FLEET_PERMISSION_PRESETS.map(group => [group.id, group]))
    return this.groupService.groups(teamId).map(group => {
      const access = presets.get(group.id) ?? state.groups[group.id]
        ?? { grants: [], denies: [], toolGroups: [], denyToolGroups: [] }
      return {
        ...group,
        toolGroups: [...access.toolGroups],
        denyToolGroups: [...(access.denyToolGroups ?? [])],
        actions: [...('actions' in access ? access.actions : access.grants)],
        denies: [...(access.denies ?? [])],
        ...(access.op === true ? { op: true } : {}),
      }
    })
  }

  resolve(input: FleetActionPolicyInput): FleetEffectiveAuthorization | undefined {
    const state = this.state(input.teamId)
    const direct = state.groups[fleetPrivateGroupId(input.member.id)]
    const memberships = this.groupService.membership(input.teamId, input.member.id)
    if (direct === undefined && memberships.length === 0) return undefined
    const presets = new Map(FLEET_PERMISSION_PRESETS.map(group => [group.id, group]))
    const actions = new Set<string>()
    const toolGroups = new Set<string>()
    const deniedActions = new Set<string>()
    const deniedToolGroups = new Set<string>()
    let op = false
    for (const id of this.groupService.expanded(input.teamId, input.member.id)) {
      const group = presets.get(id)
      const access = group ?? state.groups[id]
      if (access === undefined) continue
      for (const toolGroup of access.toolGroups) toolGroups.add(toolGroup)
      for (const action of 'actions' in access ? access.actions : access.grants) actions.add(action)
      for (const toolGroup of access.denyToolGroups ?? []) deniedToolGroups.add(toolGroup)
      for (const action of access.denies ?? []) deniedActions.add(action)
      op ||= access.op === true
    }
    for (const toolGroup of deniedToolGroups) toolGroups.delete(toolGroup)
    for (const toolGroup of toolGroups) {
      for (const action of FLEET_MEMBER_TOOL_GROUP_ACTIONS[toolGroup as keyof typeof FLEET_MEMBER_TOOL_GROUP_ACTIONS] ?? []) {
        actions.add(action)
      }
    }
    for (const action of deniedActions) actions.delete(action)
    return { toolGroups: [...toolGroups], actions: [...actions], op }
  }

  member(teamId: string, member: string): FleetMemberAccess | undefined {
    const value = this.state(teamId).groups[fleetPrivateGroupId(member)]
    const groups = this.groupService.membership(teamId, member)
    if (value !== undefined || groups.length > 0) return {
      groups,
      grants: [...(value?.grants ?? [])],
      denies: [...(value?.denies ?? [])],
      toolGroups: [...(value?.toolGroups ?? [])],
      denyToolGroups: [...(value?.denyToolGroups ?? [])],
      ...(value?.op === true ? { op: true } : {}),
    }
    const view = this.memberView(teamId, member)
    return view === undefined ? undefined : nativeAssignment(view)
  }

  inspectMember(teamId: string, member: string): FleetMemberPermissionProjection {
    const view = this.requireMember(teamId, member)
    const state = this.state(teamId)
    const configured = state.groups[fleetPrivateGroupId(member)] !== undefined
      || this.groupService.membership(teamId, member).length > 0
    const assignment = this.member(teamId, member)
    if (assignment === undefined) throw new Error(`unknown Fleet member ${member}`)
    return {
      assignment,
      configured,
      effective: this.authorization.resolve(teamId, view),
      groups: this.groups(teamId),
      availableActions: this.authorization.actionIds(),
      availableToolGroups: [...FLEET_MEMBER_TOOL_GROUPS],
    }
  }

  setMemberGroups(teamId: string, member: string, groups: readonly string[]): FleetMemberPermissionProjection {
    const current = this.inspectMember(teamId, member)
    this.setMember(teamId, member, {
      groups,
      grants: current.configured ? current.assignment.grants : [],
      denies: current.configured ? current.assignment.denies : [],
      toolGroups: current.configured ? current.assignment.toolGroups : [],
      denyToolGroups: current.configured ? current.assignment.denyToolGroups : [],
      ...(current.configured && current.assignment.op === true ? { op: true } : {}),
    })
    return this.inspectMember(teamId, member)
  }

  memberForAgent(teamId: string, agentId: string): FleetMemberView | undefined {
    return this.runs.memberViewForAgent(teamId, agentId)
  }

  memberView(teamId: string, member: string): FleetMemberView | undefined {
    return this.runs.memberViews(teamId).find(view => view.id === member)
  }

  setMember(teamId: string, member: string, value: FleetMemberAccess): FleetMemberAccess {
    if (!this.runs.memberViews(teamId).some(view => view.id === member)) throw new Error(`unknown Fleet member ${member}`)
    const knownGroups = new Set(this.groupService.groups(teamId).map(group => group.id))
    for (const group of value.groups) if (!knownGroups.has(group)) throw new Error(`unknown Fleet permission group ${group}`)
    const knownToolGroups = new Set<string>(FLEET_MEMBER_TOOL_GROUPS)
    for (const group of [...value.toolGroups, ...value.denyToolGroups]) {
      if (!knownToolGroups.has(group)) throw new Error(`unknown Fleet tool group ${group}`)
    }
    const knownActions = new Set<string>(this.authorization.actionIds())
    for (const action of [...value.grants, ...value.denies]) {
      if (!knownActions.has(action)) throw new Error(`unknown Fleet action ${action}`)
    }
    const normalized: FleetPermissionAssignment = {
      grants: unique(value.grants), denies: unique(value.denies),
      toolGroups: unique(value.toolGroups), denyToolGroups: unique(value.denyToolGroups),
      ...(value.op === true ? { op: true } : {}),
    }
    const groups = this.groupService.setMembership(teamId, member, value.groups, false)
    const state = this.state(teamId)
    this.save(teamId, {
      ...state,
      groups: { ...state.groups, [fleetPrivateGroupId(member)]: normalized },
    })
    this.authorization.changed({ teamId, members: [member] })
    return { groups, ...structuredClone(normalized) }
  }

  resetMember(teamId: string, member: string): void {
    this.requireMember(teamId, member)
    const state = this.state(teamId)
    const groups = { ...state.groups }
    delete groups[fleetPrivateGroupId(member)]
    this.groupService.resetMembership(teamId, member, false)
    this.save(teamId, { ...state, groups })
    this.authorization.changed({ teamId, members: [member] })
  }

  setOp(teamId: string, member: string, op: boolean): FleetMemberAccess {
    const view = this.requireMember(teamId, member)
    const current = this.member(teamId, member) ?? {
      groups: [], grants: [...view.permissions], denies: [],
      toolGroups: [...view.toolGroups], denyToolGroups: [],
    }
    return this.setMember(teamId, member, { ...current, op })
  }

  upsertGroup(teamId: string, value: FleetPermissionGroup): FleetPermissionGroup {
    const knownToolGroups = new Set<string>(FLEET_MEMBER_TOOL_GROUPS)
    for (const group of [...value.toolGroups, ...(value.denyToolGroups ?? [])]) {
      if (!knownToolGroups.has(group)) throw new Error(`unknown Fleet tool group ${group}`)
    }
    const knownActions = new Set<string>(this.authorization.actionIds())
    for (const action of [...value.actions, ...(value.denies ?? [])]) if (!knownActions.has(action)) {
      throw new Error(`unknown Fleet action ${action}`)
    }
    const normalized: FleetPermissionAssignment = {
      grants: unique(value.actions), denies: unique(value.denies ?? []),
      toolGroups: unique(value.toolGroups), denyToolGroups: unique(value.denyToolGroups ?? []),
      ...(value.op === true ? { op: true } : {}),
    }
    const group = this.groupService.upsertGroup(teamId, value, false)
    const state = this.state(teamId)
    this.save(teamId, { ...state, groups: { ...state.groups, [value.id]: normalized } })
    this.authorization.changed({ teamId })
    return {
      ...group,
      toolGroups: [...normalized.toolGroups], denyToolGroups: [...normalized.denyToolGroups],
      actions: [...normalized.grants], denies: [...normalized.denies],
      ...(normalized.op === true ? { op: true } : {}),
    }
  }

  deleteGroup(teamId: string, groupId: string): void {
    const state = this.state(teamId)
    this.groupService.deleteGroup(teamId, groupId)
    const groups = { ...state.groups }
    delete groups[groupId]
    this.save(teamId, { ...state, groups })
    this.authorization.changed({ teamId })
  }

  canManage(teamId: string, member: FleetMemberView): boolean {
    return this.authorization.has(teamId, member, 'permissions.manage')
  }

  private requireMember(teamId: string, member: string): FleetMemberView {
    const result = this.runs.memberViews(teamId).find(view => view.id === member)
    if (result === undefined) throw new Error(`unknown Fleet member ${member}`)
    return result
  }

  private configurationState(teamId: string): JsonValue | undefined {
    const configuration = this.runs.exportConfiguration(teamId)
    const modules = configuration.modules
    if (typeof modules !== 'object' || modules === null || Array.isArray(modules)) return undefined
    const configured = modules as Record<string, unknown>
    return configured[FLEET_PERMISSIONS_CONFIGURATION_MODULE] as JsonValue | undefined
  }

  private save(teamId: string, state: FleetPermissionState): void {
    this.states.set(teamId, cloneState(state))
    this.runs.writeExtensionState(teamId, FLEET_PERMISSIONS_STATE_NAMESPACE, asJson(state))
  }
}

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true },
    result: { type: 'string', required: true },
  },
} as const

function callingAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('fleet_permission requires a calling Agent')
  return agent
}

function installPermissionTool(
  ctx: Context,
  service: FleetPermissionService,
  authorization: FleetAuthorizationService,
  teamId: string,
  installedMember: FleetMemberView,
): () => void {
  const manage = service.canManage(teamId, installedMember)
  return ctx.tools.register(defineTool({
    name: 'fleet_permission',
    description: 'Inspect Fleet action groups and your effective authorization. Authorized members can assign groups, grant or deny actions, define groups, and OP or DEOP members.',
    parameters: {
      action: { type: 'string', required: true, enum: manage
        ? ['list_groups', 'get_member', 'set_member', 'reset_member', 'upsert_group', 'delete_group', 'op', 'deop'] as const
        : ['list_groups', 'get_member'] as const },
      member: { type: 'string', description: 'Fleet member id; defaults to yourself for get_member.' },
      id: { type: 'string', description: 'Group id for upsert_group or delete_group.' },
      name: { type: 'string', description: 'Group display name.' },
      groups: { type: 'array', items: { type: 'string' } },
      parents: { type: 'array', items: { type: 'string' } },
      actions: { type: 'array', items: { type: 'string' } },
      denies: { type: 'array', items: { type: 'string' } },
      tool_groups: { type: 'array', items: { type: 'string' } },
      deny_tool_groups: { type: 'array', items: { type: 'string' } },
      group_op: { type: 'boolean', description: 'Make a custom group an OP group.' },
    },
    output: { schema: RESULT_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.result }] },
    execute(args, exec) {
      const caller = callingAgent(exec.agent)
      const callerView = service.memberForAgent(teamId, String(caller.id))
      if (callerView === undefined || callerView.id !== installedMember.id) {
        throw new Error('fleet_permission caller is not the installed Fleet member')
      }
      const requireManage = (): void => {
        if (!service.canManage(teamId, callerView)) throw new Error(`Fleet member ${callerView.id} cannot manage permissions`)
      }
      let result: unknown
      if (args.action === 'list_groups') {
        result = { groups: service.groups(teamId), actions: [
          ...FLEET_MEMBER_PERMISSIONS,
          ...authorization.actionIds().filter(action => !FLEET_MEMBER_PERMISSIONS.includes(action as never)),
        ], toolGroups: [...FLEET_MEMBER_TOOL_GROUPS] }
      } else if (args.action === 'get_member') {
        const member = args.member ?? callerView.id
        if (member !== callerView.id) requireManage()
        const view = service.memberView(teamId, member)
        if (view === undefined) throw new Error(`unknown Fleet member ${member}`)
        result = { member, assignment: service.member(teamId, member), effective: authorization.resolve(teamId, view) }
      } else if (args.action === 'set_member') {
        requireManage()
        if (args.member === undefined) throw new Error('fleet_permission set_member requires member')
        result = service.setMember(teamId, args.member, {
          groups: args.groups ?? [], grants: args.actions ?? [], denies: args.denies ?? [],
          toolGroups: args.tool_groups ?? [], denyToolGroups: args.deny_tool_groups ?? [],
        })
      } else if (args.action === 'reset_member') {
        requireManage()
        if (args.member === undefined) throw new Error('fleet_permission reset_member requires member')
        service.resetMember(teamId, args.member)
        result = { reset: args.member }
      } else if (args.action === 'upsert_group') {
        requireManage()
        if (args.id === undefined) throw new Error('fleet_permission upsert_group requires id')
        result = service.upsertGroup(teamId, {
          id: args.id, name: args.name ?? args.id, parents: args.parents ?? [],
          toolGroups: args.tool_groups ?? [], denyToolGroups: args.deny_tool_groups ?? [],
          actions: args.actions ?? [], denies: args.denies ?? [],
          ...(args.group_op === true ? { op: true } : {}),
        })
      } else if (args.action === 'delete_group') {
        requireManage()
        if (args.id === undefined) throw new Error('fleet_permission delete_group requires id')
        service.deleteGroup(teamId, args.id)
        result = { deleted: args.id }
      } else {
        requireManage()
        if (args.member === undefined) throw new Error(`fleet_permission ${args.action} requires member`)
        result = service.setOp(teamId, args.member, args.action === 'op')
      }
      return Promise.resolve({ action: args.action, result: JSON.stringify(result) })
    },
  }))
}

export function applyPermissions(ctx: Context): void {
  ctx.inject(['fleetAuthorization', 'fleetRuns', 'fleetConfiguration', 'fleetGroups'], scope => {
    const service = new FleetPermissionService(scope.fleetRuns, scope.fleetAuthorization, scope.fleetGroups)
    scope.provide('fleetPermissions', service)
    const stopGroups = scope.fleetGroups.onChange(change => scope.fleetAuthorization.changed(change))
    const stopConfiguration = scope.fleetConfiguration.register({
      id: FLEET_PERMISSIONS_CONFIGURATION_MODULE,
      parse: parseFleetPermissionConfiguration,
    })
    const stopPolicy = scope.fleetAuthorization.installActionPolicy(service)
    const stopNamespace = scope.fleetAuthorization.registerNamespace({
      namespace: 'permissions',
      alwaysVisible: true,
      actions: [{ id: 'manage', description: 'Manage Fleet permission groups and assignments.' }],
      installTools: (memberCtx, input) => installPermissionTool(
        memberCtx, service, scope.fleetAuthorization, input.teamId, input.member,
      ),
    })
    return () => {
      stopNamespace()
      stopPolicy()
      stopGroups()
      stopConfiguration()
    }
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetPermissions: FleetPermissionService
  }
}
