import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import {
  FLEET_MEMBER_PERMISSIONS,
  FLEET_MEMBER_TOOL_GROUPS,
  type FleetAccessInput,
  type FleetAccessPolicy,
  type FleetAccessService,
  type FleetEffectiveAccess,
  type FleetMemberView,
  type FleetRunService,
} from 'dsh-agent-fleet'

export const name = '@ch4acko3/dsh-agent-fleet-permissions'
export const FLEET_PERMISSIONS_CONFIGURATION_MODULE = '@ch4acko3/dsh-agent-fleet-permissions'

export interface FleetPermissionGroup {
  readonly id: string
  readonly name: string
  readonly parents: readonly string[]
  readonly toolGroups: readonly string[]
  readonly permissions: readonly string[]
  readonly op?: boolean
  readonly preset?: boolean
}

export interface FleetMemberAccess {
  readonly groups: readonly string[]
  readonly grants: readonly string[]
  readonly denies: readonly string[]
  readonly toolGroups: readonly string[]
  readonly denyToolGroups: readonly string[]
  readonly op?: boolean
}

export interface FleetPermissionState {
  readonly groups: readonly FleetPermissionGroup[]
  readonly members: Readonly<Record<string, FleetMemberAccess>>
}

const EMPTY_STATE: FleetPermissionState = { groups: [], members: {} }
const ID = /^[a-z][a-z0-9-]*$/u

export const FLEET_PERMISSION_PRESETS: readonly FleetPermissionGroup[] = [
  {
    id: 'observer', name: 'Observer', parents: [], preset: true,
    toolGroups: ['messages', 'status', 'resources', 'documents'], permissions: [],
  },
  {
    id: 'member', name: 'Member', parents: ['observer'], preset: true,
    toolGroups: ['coordination', 'tasks', 'calendar'], permissions: [],
  },
  {
    id: 'builder', name: 'Builder', parents: ['member'], preset: true,
    toolGroups: ['git'], permissions: [
      'resource.write', 'document.write',
      'git.inspect', 'git.scope-check', 'git.worktree-create',
    ],
  },
  {
    id: 'facilitator', name: 'Facilitator', parents: ['member'], preset: true,
    toolGroups: ['schedule'], permissions: ['channel.manage', 'meeting.manage', 'vote.create', 'schedule.create'],
  },
  {
    id: 'maintainer', name: 'Maintainer', parents: ['builder', 'facilitator'], preset: true,
    toolGroups: [], permissions: [
      'task.manage', 'calendar.manage', 'team.manage', 'workspace.manage', 'git.worktree-manage',
    ],
  },
  {
    id: 'op', name: 'OP', parents: [], preset: true, toolGroups: [], permissions: [], op: true,
  },
] as const

const NATIVE_PRESET_COMBINATIONS: readonly (readonly string[])[] = [
  ['observer'],
  ['member'],
  ['builder'],
  ['facilitator'],
  ['builder', 'facilitator'],
  ['maintainer'],
]

function presetAccess(groupIds: readonly string[]): { toolGroups: string[]; permissions: string[] } {
  const groups = new Map(FLEET_PERMISSION_PRESETS.map(group => [group.id, group]))
  const toolGroups = new Set<string>()
  const permissions = new Set<string>()
  const visited = new Set<string>()
  const add = (id: string): void => {
    if (visited.has(id)) return
    const group = groups.get(id)
    if (group === undefined) throw new Error(`unknown built-in Fleet permission group ${id}`)
    visited.add(id)
    for (const parent of group.parents) add(parent)
    for (const toolGroup of group.toolGroups) toolGroups.add(toolGroup)
    for (const permission of group.permissions) permissions.add(permission)
  }
  for (const id of groupIds) add(id)
  return { toolGroups: [...toolGroups], permissions: [...permissions] }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value))
}

function nativeAssignment(member: FleetMemberView): FleetMemberAccess {
  for (const groups of NATIVE_PRESET_COMBINATIONS) {
    const access = presetAccess(groups)
    if (sameValues(member.toolGroups, access.toolGroups) && sameValues(member.permissions, access.permissions)) {
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

function parseState(value: JsonValue | undefined): FleetPermissionState {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return cloneState(EMPTY_STATE)
  const input = value as Record<string, JsonValue>
  const groups = Array.isArray(input.groups) ? input.groups.flatMap(item => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return []
    const group = item as Record<string, JsonValue>
    if (typeof group.id !== 'string' || typeof group.name !== 'string') return []
    return [{
      id: group.id,
      name: group.name,
      parents: Array.isArray(group.parents) ? group.parents.filter((entry): entry is string => typeof entry === 'string') : [],
      toolGroups: Array.isArray(group.toolGroups) ? group.toolGroups.filter((entry): entry is string => typeof entry === 'string') : [],
      permissions: Array.isArray(group.permissions) ? group.permissions.filter((entry): entry is string => typeof entry === 'string') : [],
      ...(group.op === true ? { op: true } : {}),
    }]
  }) : []
  const members: Record<string, FleetMemberAccess> = {}
  if (input.members !== null && typeof input.members === 'object' && !Array.isArray(input.members)) {
    for (const [member, item] of Object.entries(input.members)) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
      const access = item as Record<string, JsonValue>
      const strings = (key: string): string[] => Array.isArray(access[key])
        ? (access[key] as JsonValue[]).filter((entry): entry is string => typeof entry === 'string')
        : []
      members[member] = {
        groups: strings('groups'), grants: strings('grants'), denies: strings('denies'),
        toolGroups: strings('toolGroups'), denyToolGroups: strings('denyToolGroups'),
        ...(access.op === true ? { op: true } : {}),
      }
    }
  }
  return { groups, members }
}

export function parseFleetPermissionConfiguration(value: unknown): FleetPermissionState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${FLEET_PERMISSIONS_CONFIGURATION_MODULE} must be an object`)
  }
  const input = value as Record<string, unknown>
  if (input.version !== undefined && input.version !== 1) {
    throw new Error(`${FLEET_PERMISSIONS_CONFIGURATION_MODULE}.version must be 1`)
  }
  if (typeof input.members !== 'object' || input.members === null || Array.isArray(input.members)) {
    throw new Error(`${FLEET_PERMISSIONS_CONFIGURATION_MODULE}.members must be an object`)
  }
  return parseState(value as JsonValue)
}

function asJson(state: FleetPermissionState): JsonValue {
  return state as unknown as JsonValue
}

export class FleetPermissionService implements FleetAccessPolicy {
  private readonly states = new Map<string, FleetPermissionState>()

  constructor(private readonly runs: FleetRunService, private readonly access: FleetAccessService) {}

  state(teamId: string): FleetPermissionState {
    let state = this.states.get(teamId)
    if (state === undefined) {
      const persisted = this.runs.readExtensionState(teamId, 'permissions')
      const configured = persisted === undefined ? this.configurationState(teamId) : undefined
      state = persisted !== undefined
        ? parseState(persisted)
        : configured === undefined
          ? this.nativeState(teamId)
          : parseFleetPermissionConfiguration(configured)
      this.states.set(teamId, state)
    }
    return cloneState(state)
  }

  groups(teamId: string): FleetPermissionGroup[] {
    return [...FLEET_PERMISSION_PRESETS, ...this.state(teamId).groups].map(group => structuredClone(group))
  }

  resolve(input: FleetAccessInput): FleetEffectiveAccess | undefined {
    const assignment = this.state(input.teamId).members[input.member.id]
    if (assignment === undefined) return undefined
    const groups = new Map(this.groups(input.teamId).map(group => [group.id, group]))
    const permissions = new Set<string>()
    const toolGroups = new Set<string>()
    let op = assignment.op === true
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const addGroup = (id: string): void => {
      if (visited.has(id)) return
      if (visiting.has(id)) throw new Error(`cyclic Fleet permission group inheritance at ${id}`)
      const group = groups.get(id)
      if (group === undefined) throw new Error(`unknown Fleet permission group ${id}`)
      visiting.add(id)
      for (const parent of group.parents) addGroup(parent)
      visiting.delete(id)
      visited.add(id)
      for (const toolGroup of group.toolGroups) toolGroups.add(toolGroup)
      for (const permission of group.permissions) permissions.add(permission)
      op ||= group.op === true
    }
    for (const group of assignment.groups) addGroup(group)
    for (const toolGroup of assignment.toolGroups) toolGroups.add(toolGroup)
    for (const permission of assignment.grants) permissions.add(permission)
    for (const toolGroup of assignment.denyToolGroups) toolGroups.delete(toolGroup)
    for (const permission of assignment.denies) permissions.delete(permission)
    return { toolGroups: [...toolGroups], permissions: [...permissions], op }
  }

  member(teamId: string, member: string): FleetMemberAccess | undefined {
    const value = this.state(teamId).members[member]
    return value === undefined ? undefined : structuredClone(value)
  }

  memberForAgent(teamId: string, agentId: string): FleetMemberView | undefined {
    return this.runs.memberViewForAgent(teamId, agentId)
  }

  memberView(teamId: string, member: string): FleetMemberView | undefined {
    return this.runs.memberViews(teamId).find(view => view.id === member)
  }

  setMember(teamId: string, member: string, value: FleetMemberAccess): FleetMemberAccess {
    if (!this.runs.memberViews(teamId).some(view => view.id === member)) throw new Error(`unknown Fleet member ${member}`)
    for (const group of value.groups) if (!this.groups(teamId).some(candidate => candidate.id === group)) {
      throw new Error(`unknown Fleet permission group ${group}`)
    }
    const knownToolGroups = new Set<string>(FLEET_MEMBER_TOOL_GROUPS)
    for (const group of [...value.toolGroups, ...value.denyToolGroups]) {
      if (!knownToolGroups.has(group)) throw new Error(`unknown Fleet tool group ${group}`)
    }
    const knownPermissions = new Set<string>([...FLEET_MEMBER_PERMISSIONS, ...this.access.permissionIds()])
    for (const permission of [...value.grants, ...value.denies]) {
      if (!knownPermissions.has(permission)) throw new Error(`unknown Fleet permission ${permission}`)
    }
    const normalized: FleetMemberAccess = {
      groups: unique(value.groups), grants: unique(value.grants), denies: unique(value.denies),
      toolGroups: unique(value.toolGroups), denyToolGroups: unique(value.denyToolGroups),
      ...(value.op === true ? { op: true } : {}),
    }
    const state = this.state(teamId)
    this.save(teamId, { ...state, members: { ...state.members, [member]: normalized } })
    this.access.changed({ teamId, members: [member] })
    return structuredClone(normalized)
  }

  resetMember(teamId: string, member: string): void {
    this.requireMember(teamId, member)
    const state = this.state(teamId)
    const members = { ...state.members }
    delete members[member]
    this.save(teamId, { ...state, members })
    this.access.changed({ teamId, members: [member] })
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
    if (!ID.test(value.id)) throw new Error('Fleet permission group id must use lower-kebab-case')
    if (FLEET_PERMISSION_PRESETS.some(group => group.id === value.id)) throw new Error(`cannot replace preset group ${value.id}`)
    const knownToolGroups = new Set<string>(FLEET_MEMBER_TOOL_GROUPS)
    for (const group of value.toolGroups) if (!knownToolGroups.has(group)) throw new Error(`unknown Fleet tool group ${group}`)
    const knownPermissions = new Set<string>([...FLEET_MEMBER_PERMISSIONS, ...this.access.permissionIds()])
    for (const permission of value.permissions) if (!knownPermissions.has(permission)) {
      throw new Error(`unknown Fleet permission ${permission}`)
    }
    const normalized: FleetPermissionGroup = {
      id: value.id, name: value.name.trim() || value.id,
      parents: unique(value.parents), toolGroups: unique(value.toolGroups), permissions: unique(value.permissions),
      ...(value.op === true ? { op: true } : {}),
    }
    const state = this.state(teamId)
    const groups = [...state.groups.filter(group => group.id !== normalized.id), normalized]
    const allGroups = new Map([...FLEET_PERMISSION_PRESETS, ...groups].map(group => [group.id, group]))
    const resolved = new Set<string>()
    const visiting = new Set<string>()
    const visit = (id: string): void => {
      if (resolved.has(id)) return
      if (visiting.has(id)) throw new Error(`cyclic Fleet permission group inheritance at ${id}`)
      const group = allGroups.get(id)
      if (group === undefined) throw new Error(`unknown Fleet permission group ${id}`)
      visiting.add(id)
      for (const parent of group.parents) visit(parent)
      visiting.delete(id)
      resolved.add(id)
    }
    for (const group of allGroups.values()) visit(group.id)
    const probe = { ...state, groups }
    this.states.set(teamId, probe)
    try {
      for (const member of Object.keys(probe.members)) this.resolve({
        teamId, member: this.requireMember(teamId, member),
        base: { toolGroups: [], permissions: [], op: false },
      })
    } catch (error) {
      this.states.set(teamId, state)
      throw error
    }
    this.save(teamId, probe)
    this.access.changed({ teamId })
    return structuredClone(normalized)
  }

  deleteGroup(teamId: string, groupId: string): void {
    if (FLEET_PERMISSION_PRESETS.some(group => group.id === groupId)) throw new Error(`cannot delete preset group ${groupId}`)
    const state = this.state(teamId)
    if (!state.groups.some(group => group.id === groupId)) throw new Error(`unknown Fleet permission group ${groupId}`)
    const groups = state.groups.filter(group => group.id !== groupId)
    const members = Object.fromEntries(Object.entries(state.members).map(([member, access]) => [member, {
      ...access, groups: access.groups.filter(group => group !== groupId),
    }]))
    this.save(teamId, { ...state, groups, members })
    this.access.changed({ teamId })
  }

  canManage(teamId: string, member: FleetMemberView): boolean {
    return this.access.has(teamId, member, 'permissions.manage') || this.access.has(teamId, member, 'team.manage')
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
    return (modules as Record<string, unknown>)[FLEET_PERMISSIONS_CONFIGURATION_MODULE] as JsonValue | undefined
  }

  private nativeState(teamId: string): FleetPermissionState {
    return {
      groups: [],
      members: Object.fromEntries(this.runs.memberViews(teamId).map(member => [
        member.id,
        nativeAssignment(member),
      ])),
    }
  }

  private save(teamId: string, state: FleetPermissionState): void {
    this.states.set(teamId, cloneState(state))
    this.runs.writeExtensionState(teamId, 'permissions', asJson(state))
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
  access: FleetAccessService,
  teamId: string,
  installedMember: FleetMemberView,
): () => void {
  const manage = service.canManage(teamId, installedMember)
  return ctx.tools.register(defineTool({
    name: 'fleet_permission',
    description: 'Inspect Fleet permission groups and your effective access. Authorized members can assign groups, grant or deny capabilities, define groups, and OP or DEOP members.',
    parameters: {
      action: { type: 'string', required: true, enum: manage
        ? ['list_groups', 'get_member', 'set_member', 'reset_member', 'upsert_group', 'delete_group', 'op', 'deop'] as const
        : ['list_groups', 'get_member'] as const },
      member: { type: 'string', description: 'Fleet member id; defaults to yourself for get_member.' },
      id: { type: 'string', description: 'Group id for upsert_group or delete_group.' },
      name: { type: 'string', description: 'Group display name.' },
      groups: { type: 'array', items: { type: 'string' } },
      parents: { type: 'array', items: { type: 'string' } },
      permissions: { type: 'array', items: { type: 'string' } },
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
        result = { groups: service.groups(teamId), permissions: [
          ...FLEET_MEMBER_PERMISSIONS,
          ...access.permissionIds(),
        ], toolGroups: [...FLEET_MEMBER_TOOL_GROUPS] }
      } else if (args.action === 'get_member') {
        const member = args.member ?? callerView.id
        if (member !== callerView.id) requireManage()
        const view = service.memberView(teamId, member)
        if (view === undefined) throw new Error(`unknown Fleet member ${member}`)
        result = { member, assignment: service.member(teamId, member), effective: access.resolve(teamId, view) }
      } else if (args.action === 'set_member') {
        requireManage()
        if (args.member === undefined) throw new Error('fleet_permission set_member requires member')
        result = service.setMember(teamId, args.member, {
          groups: args.groups ?? [], grants: args.permissions ?? [], denies: args.denies ?? [],
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
          toolGroups: args.tool_groups ?? [], permissions: args.permissions ?? [],
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

export function apply(ctx: Context): void {
  ctx.inject(['fleetAccess', 'fleetRuns', 'fleetConfiguration'], scope => {
    const service = new FleetPermissionService(scope.fleetRuns, scope.fleetAccess)
    scope.provide('fleetPermissions', service)
    const stopConfiguration = scope.fleetConfiguration.register({
      id: FLEET_PERMISSIONS_CONFIGURATION_MODULE,
      parse: parseFleetPermissionConfiguration,
    })
    const stopPolicy = scope.fleetAccess.installPolicy(service)
    const stopNamespace = scope.fleetAccess.registerNamespace({
      namespace: 'permissions',
      alwaysVisible: true,
      permissions: [{ id: 'manage', description: 'Manage Fleet permission groups and assignments.' }],
      installTools: (memberCtx, input) => installPermissionTool(
        memberCtx, service, scope.fleetAccess, input.teamId, input.member,
      ),
    })
    return () => {
      stopNamespace()
      stopPolicy()
      stopConfiguration()
    }
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetPermissions: FleetPermissionService
  }
}
