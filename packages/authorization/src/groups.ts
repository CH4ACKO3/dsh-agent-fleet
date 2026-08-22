import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { FleetRunService } from 'dsh-agent-fleet'

export const FLEET_GROUPS_STATE_NAMESPACE = 'groups'
export const FLEET_PERMISSIONS_CONFIGURATION_MODULE = '@ch4acko3/dsh-agent-fleet-authorization/permissions'
export const FLEET_LEGACY_PERMISSIONS_CONFIGURATION_MODULE = '@ch4acko3/dsh-agent-fleet-permissions'

export interface FleetAuthorizationGroup {
  readonly id: string
  readonly name: string
  readonly parents: readonly string[]
  readonly preset?: boolean
  readonly private?: boolean
}

export interface FleetGroupState {
  readonly version: 1
  readonly groups: readonly FleetAuthorizationGroup[]
  readonly members: Readonly<Record<string, readonly string[]>>
}

export interface FleetGroupChange {
  readonly teamId: string
  readonly members?: readonly string[]
  readonly removedGroups?: readonly string[]
}

export const FLEET_GROUP_PRESETS: readonly FleetAuthorizationGroup[] = [
  { id: 'observer', name: 'Observer', parents: [], preset: true },
  { id: 'member', name: 'Collaborator', parents: ['observer'], preset: true },
  { id: 'researcher', name: 'Researcher', parents: ['member'], preset: true },
  { id: 'facilitator', name: 'Facilitator', parents: ['member'], preset: true },
  { id: 'maintainer', name: 'Maintainer', parents: ['researcher', 'facilitator'], preset: true },
  { id: 'op', name: 'OP', parents: [], preset: true },
] as const

const EMPTY_STATE: FleetGroupState = { version: 1, groups: [], members: {} }
const ID = /^[a-z][a-z0-9-]*$/u

export function fleetPrivateGroupId(member: string): string {
  return `member:${member}`
}

export function isFleetPrivateGroupId(group: string): boolean {
  return group.startsWith('member:') && group.length > 'member:'.length
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function parseState(value: JsonValue | undefined): FleetGroupState {
  if (value === undefined) return structuredClone(EMPTY_STATE)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Fleet Group state must be an object')
  const input = value as Record<string, JsonValue>
  if (input.version !== 1 || !Array.isArray(input.groups)
    || typeof input.members !== 'object' || input.members === null || Array.isArray(input.members)) {
    throw new Error('Fleet Group state must contain version 1 groups and members')
  }
  const groups = input.groups.map((entry, index): FleetAuthorizationGroup => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`Fleet Group state group ${String(index)} must be an object`)
    }
    const group = entry as Record<string, JsonValue>
    if (typeof group.id !== 'string' || !ID.test(group.id) || typeof group.name !== 'string') {
      throw new Error(`Fleet Group state group ${String(index)} is invalid`)
    }
    return { id: group.id, name: group.name, parents: unique(strings(group.parents)) }
  })
  const members = Object.fromEntries(Object.entries(input.members as Record<string, JsonValue>)
    .map(([member, groupIds]) => [member, unique(strings(groupIds))]))
  return { version: 1, groups, members }
}

function legacyState(value: JsonValue | undefined): FleetGroupState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const input = value as Record<string, JsonValue>
  const groups = Array.isArray(input.groups) ? input.groups.flatMap(entry => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
    const group = entry as Record<string, JsonValue>
    if (typeof group.id !== 'string' || !ID.test(group.id) || typeof group.name !== 'string') return []
    return [{ id: group.id, name: group.name, parents: unique(strings(group.parents)) }]
  }) : []
  const members = typeof input.members === 'object' && input.members !== null && !Array.isArray(input.members)
    ? Object.fromEntries(Object.entries(input.members as Record<string, JsonValue>).flatMap(([member, entry]) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return []
        return [[member, unique(strings((entry as Record<string, JsonValue>).groups))]]
      }))
    : {}
  return groups.length === 0 && Object.values(members).every(groupIds => groupIds.length === 0)
    ? undefined
    : { version: 1, groups, members }
}

export class FleetGroupService {
  private readonly states = new Map<string, FleetGroupState>()
  private readonly listeners = new Set<(change: FleetGroupChange) => void>()

  constructor(private readonly runs: FleetRunService) {}

  state(teamId: string): FleetGroupState {
    let state = this.states.get(teamId)
    if (state === undefined) {
      const persisted = this.runs.readExtensionState(teamId, FLEET_GROUPS_STATE_NAMESPACE)
      state = persisted === undefined ? this.migrate(teamId) : parseState(persisted)
      this.validate(state)
      this.states.set(teamId, state)
      if (persisted === undefined && (state.groups.length > 0 || Object.keys(state.members).length > 0)) {
        this.runs.writeExtensionState(teamId, FLEET_GROUPS_STATE_NAMESPACE, state as unknown as JsonValue)
      }
    }
    return structuredClone(state)
  }

  groups(teamId: string): FleetAuthorizationGroup[] {
    return [...FLEET_GROUP_PRESETS, ...this.state(teamId).groups].map(group => structuredClone(group))
  }

  privateGroup(member: string): FleetAuthorizationGroup {
    return { id: fleetPrivateGroupId(member), name: member, parents: [], private: true }
  }

  membership(teamId: string, member: string): string[] {
    return [...(this.state(teamId).members[member] ?? [])]
  }

  expanded(teamId: string, member: string): string[] {
    const groups = new Map(this.groups(teamId).map(group => [group.id, group]))
    const result = new Set<string>()
    const visit = (id: string): void => {
      if (result.has(id)) return
      const group = groups.get(id)
      if (group === undefined) throw new Error(`unknown Fleet authorization group ${id}`)
      result.add(id)
      for (const parent of group.parents) visit(parent)
    }
    for (const id of this.membership(teamId, member)) visit(id)
    return [fleetPrivateGroupId(member), ...result]
  }

  setMembership(teamId: string, member: string, groups: readonly string[], notify = true): string[] {
    const normalized = unique(groups)
    const known = new Set(this.groups(teamId).map(group => group.id))
    for (const id of normalized) {
      if (isFleetPrivateGroupId(id)) throw new Error('private member groups cannot be assigned as supplementary groups')
      if (!known.has(id)) throw new Error(`unknown Fleet authorization group ${id}`)
    }
    const state = this.state(teamId)
    this.save(teamId, { ...state, members: { ...state.members, [member]: normalized } })
    if (notify) this.changed({ teamId, members: [member] })
    return [...normalized]
  }

  resetMembership(teamId: string, member: string, notify = true): void {
    const state = this.state(teamId)
    if (!(member in state.members)) return
    const members = { ...state.members }
    delete members[member]
    this.save(teamId, { ...state, members })
    if (notify) this.changed({ teamId, members: [member] })
  }

  upsertGroup(teamId: string, value: FleetAuthorizationGroup, notify = true): FleetAuthorizationGroup {
    if (!ID.test(value.id)) throw new Error('Fleet authorization group id must use lower-kebab-case')
    if (FLEET_GROUP_PRESETS.some(group => group.id === value.id)) throw new Error(`cannot replace preset group ${value.id}`)
    const normalized = { id: value.id, name: value.name.trim() || value.id, parents: unique(value.parents) }
    const state = this.state(teamId)
    const next = { ...state, groups: [...state.groups.filter(group => group.id !== normalized.id), normalized] }
    this.validate(next)
    this.save(teamId, next)
    if (notify) this.changed({ teamId })
    return structuredClone(normalized)
  }

  deleteGroup(teamId: string, groupId: string, notify = true): void {
    if (FLEET_GROUP_PRESETS.some(group => group.id === groupId)) throw new Error(`cannot delete preset group ${groupId}`)
    const state = this.state(teamId)
    if (!state.groups.some(group => group.id === groupId)) throw new Error(`unknown Fleet authorization group ${groupId}`)
    this.save(teamId, {
      ...state,
      groups: state.groups.filter(group => group.id !== groupId).map(group => ({
        ...group, parents: group.parents.filter(parent => parent !== groupId),
      })),
      members: Object.fromEntries(Object.entries(state.members).map(([member, groups]) => [
        member, groups.filter(group => group !== groupId),
      ])),
    })
    if (notify) this.changed({ teamId, removedGroups: [groupId] })
  }

  onChange(listener: (change: FleetGroupChange) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private migrate(teamId: string): FleetGroupState {
    const persisted = legacyState(this.runs.readExtensionState(teamId, 'permissions'))
    if (persisted !== undefined) return persisted
    const configuration = this.runs.exportConfiguration(teamId)
    const modules = configuration.modules
    if (typeof modules !== 'object' || modules === null || Array.isArray(modules)) return structuredClone(EMPTY_STATE)
    const values = modules as Record<string, unknown>
    return legacyState((values[FLEET_PERMISSIONS_CONFIGURATION_MODULE]
      ?? values[FLEET_LEGACY_PERMISSIONS_CONFIGURATION_MODULE]) as JsonValue | undefined)
      ?? structuredClone(EMPTY_STATE)
  }

  private validate(state: FleetGroupState): void {
    const groups = new Map([...FLEET_GROUP_PRESETS, ...state.groups].map(group => [group.id, group]))
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const visit = (id: string): void => {
      if (visited.has(id)) return
      if (visiting.has(id)) throw new Error(`cyclic Fleet authorization group inheritance at ${id}`)
      const group = groups.get(id)
      if (group === undefined) throw new Error(`unknown Fleet authorization group ${id}`)
      visiting.add(id)
      for (const parent of group.parents) visit(parent)
      visiting.delete(id)
      visited.add(id)
    }
    for (const id of groups.keys()) visit(id)
    for (const memberships of Object.values(state.members)) for (const id of memberships) visit(id)
  }

  private save(teamId: string, state: FleetGroupState): void {
    const stored = structuredClone(state)
    this.states.set(teamId, stored)
    this.runs.writeExtensionState(teamId, FLEET_GROUPS_STATE_NAMESPACE, stored as unknown as JsonValue)
  }

  private changed(change: FleetGroupChange): void {
    for (const listener of [...this.listeners]) listener(change)
  }
}

export function applyGroups(ctx: Context): void {
  ctx.inject(['fleetRuns'], scope => {
    scope.provide('fleetGroups', new FleetGroupService(scope.fleetRuns))
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetGroups: FleetGroupService
  }
}
