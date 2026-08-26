import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type {
  FleetAuthorizationInput,
  FleetAuthorizationService,
  FleetResourcePolicy,
} from '../authorization.js'
import type { FleetMemberView } from '../member-view.js'
import type { FleetRunService } from '../run.js'
import { fleetPrivateGroupId, isFleetPrivateGroupId, type FleetGroupService } from './groups.js'

export const FLEET_ACCESS_STATE_NAMESPACE = 'authorization-access'
export const FLEET_ACCESS_CONFIGURATION_MODULE = 'dsh-agent-fleet/authorization/access'

export const FLEET_ACCESS_LEVELS = ['read', 'write', 'use', 'manage'] as const
export type FleetAccessLevel = typeof FLEET_ACCESS_LEVELS[number]
export type FleetAccessScope = 'self' | 'tree'
export type FleetAccessEffect = 'allow' | 'deny'
export interface FleetAccessPrincipal { readonly kind: 'group'; readonly id: string }

export interface FleetAccessResourceAdapter {
  readonly kind: string
  levelFor(action: string): FleetAccessLevel | undefined
  normalize(teamId: string, resourceId: string): string
  contains?(teamId: string, parentId: string, childId: string): boolean
}

export interface FleetAccessMode {
  readonly principal: FleetAccessPrincipal
  readonly resourceKind: string
  readonly mode: 'restricted'
}

export interface FleetAccessRule {
  readonly id: string
  readonly principal: FleetAccessPrincipal
  readonly resource: { readonly kind: string; readonly id: string }
  readonly scope: FleetAccessScope
  readonly effect: FleetAccessEffect
  readonly levels: readonly FleetAccessLevel[]
}

export interface FleetAccessState {
  readonly version: 1
  readonly modes: readonly FleetAccessMode[]
  readonly rules: readonly FleetAccessRule[]
}

export interface PutFleetAccessRule {
  readonly id?: string
  readonly principal: FleetAccessPrincipal
  readonly resource: { readonly kind: string; readonly id: string }
  readonly scope?: FleetAccessScope
  readonly effect: FleetAccessEffect
  readonly levels: readonly FleetAccessLevel[]
}

const EMPTY_STATE: FleetAccessState = { version: 1, modes: [], rules: [] }
const KIND = /^[a-z][a-z0-9-]*$/u
const RULE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u
const LEVELS = new Set<string>(FLEET_ACCESS_LEVELS)

function cloneState(state: FleetAccessState): FleetAccessState {
  return structuredClone(state)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function principal(value: unknown, label: string): FleetAccessPrincipal {
  const input = object(value, label)
  const kind = text(input.kind, `${label}.kind`)
  const id = text(input.id, `${label}.id`)
  if (kind === 'group') return { kind, id }
  throw new Error(`${label}.kind must be group`)
}

function levels(value: unknown, label: string): FleetAccessLevel[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`)
  const result = value.map((entry, index) => text(entry, `${label}[${String(index)}]`))
  for (const level of result) if (!LEVELS.has(level)) throw new Error(`${label} contains unknown level ${level}`)
  return [...new Set(result)] as FleetAccessLevel[]
}

function parseState(value: JsonValue | undefined): FleetAccessState {
  if (value === undefined) return cloneState(EMPTY_STATE)
  const input = object(value, 'Fleet Access state')
  if (input.version !== 1) throw new Error('Fleet Access state version must be 1')
  if (!Array.isArray(input.modes) || !Array.isArray(input.rules)) {
    throw new Error('Fleet Access state modes and rules must be arrays')
  }
  const modes = input.modes.map((entry, index): FleetAccessMode => {
    const item = object(entry, `Fleet Access mode[${String(index)}]`)
    const resourceKind = text(item.resourceKind, `Fleet Access mode[${String(index)}].resourceKind`)
    if (!KIND.test(resourceKind)) throw new Error(`invalid Fleet Access resource kind ${resourceKind}`)
    if (item.mode !== 'restricted') throw new Error('persisted Fleet Access mode must be restricted')
    return {
      principal: principal(item.principal, `Fleet Access mode[${String(index)}].principal`),
      resourceKind,
      mode: 'restricted',
    }
  })
  const modeKeys = new Set(modes.map(mode => `${mode.principal.kind}:${mode.principal.id}:${mode.resourceKind}`))
  if (modeKeys.size !== modes.length) throw new Error('Fleet Access state contains duplicate modes')
  const rules = input.rules.map((entry, index): FleetAccessRule => {
    const item = object(entry, `Fleet Access rule[${String(index)}]`)
    const resource = object(item.resource, `Fleet Access rule[${String(index)}].resource`)
    const kind = text(resource.kind, `Fleet Access rule[${String(index)}].resource.kind`)
    if (!KIND.test(kind)) throw new Error(`invalid Fleet Access resource kind ${kind}`)
    if (item.scope !== 'self' && item.scope !== 'tree') throw new Error('Fleet Access rule scope must be self or tree')
    if (item.effect !== 'allow' && item.effect !== 'deny') throw new Error('Fleet Access rule effect must be allow or deny')
    const id = text(item.id, `Fleet Access rule[${String(index)}].id`)
    if (!RULE_ID.test(id)) throw new Error(`invalid Fleet Access rule id ${id}`)
    return {
      id,
      principal: principal(item.principal, `Fleet Access rule[${String(index)}].principal`),
      resource: { kind, id: text(resource.id, `Fleet Access rule[${String(index)}].resource.id`) },
      scope: item.scope,
      effect: item.effect,
      levels: levels(item.levels, `Fleet Access rule[${String(index)}].levels`),
    }
  })
  if (new Set(rules.map(rule => rule.id)).size !== rules.length) throw new Error('Fleet Access state contains duplicate rule ids')
  return { version: 1, modes, rules }
}

export function parseFleetAccessConfiguration(value: unknown): FleetAccessState {
  return parseState(value as JsonValue)
}

function asJson(state: FleetAccessState): JsonValue {
  return state as unknown as JsonValue
}

function samePrincipal(left: FleetAccessPrincipal, right: FleetAccessPrincipal): boolean {
  return left.kind === right.kind && left.id === right.id
}

function pathInside(root: string, target: string): boolean {
  const value = relative(root, target)
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))
}

function logicalPath(projectRoot: string, teamId: string, resourceId: string): string {
  if (/^(?:workspace|team|absolute):/u.test(resourceId)) return resourceId
  const root = resolve(projectRoot)
  const target = resolve(isAbsolute(resourceId) ? resourceId : resolve(root, resourceId))
  const teamRoot = resolve(root, '.fleet', teamId)
  if (pathInside(teamRoot, target)) return `team:${relative(teamRoot, target) || '.'}`
  if (pathInside(root, target)) return `workspace:${relative(root, target) || '.'}`
  return `absolute:${target}`
}

function logicalContains(parent: string, child: string): boolean {
  const parentSeparator = parent.indexOf(':')
  const childSeparator = child.indexOf(':')
  if (parentSeparator < 0 || childSeparator < 0) return parent === child
  if (parent.slice(0, parentSeparator) !== child.slice(0, childSeparator)) return false
  const parentPath = parent.slice(parentSeparator + 1)
  const childPath = child.slice(childSeparator + 1)
  if (parentPath === '.') return true
  return pathInside(resolve(sep, parentPath), resolve(sep, childPath))
}

const IMPLIED_LEVELS: Readonly<Record<FleetAccessLevel, readonly FleetAccessLevel[]>> = {
  read: ['read'],
  write: ['write', 'read'],
  use: ['use'],
  manage: ['manage', 'write', 'read'],
}

function allowCovers(granted: FleetAccessLevel, required: FleetAccessLevel): boolean {
  return IMPLIED_LEVELS[granted].includes(required)
}

function denyBlocks(denied: FleetAccessLevel, requested: FleetAccessLevel): boolean {
  return IMPLIED_LEVELS[requested].includes(denied)
}

function builtInLevel(action: string): FleetAccessLevel | undefined {
  if (action === 'message.read' || action === 'resource.read' || action === 'work.read'
    || action === 'member-status.read' || action === 'access.inspect' || action === 'workspace.read') return 'read'
  if (action === 'message.post' || action === 'message.wakeup' || action === 'message.interrupt'
    || action === 'resource.write' || action === 'work.claim'
    || action === 'member-status.write') return 'write'
  if (action === 'meeting.join') return 'use'
  if (action === 'team.manage' || action === 'channel.manage' || action === 'meeting.manage'
    || action === 'vote.create' || action === 'access.manage' || action === 'workspace.manage') return 'manage'
  return undefined
}

export class FleetAccessService implements FleetResourcePolicy {
  private readonly states = new Map<string, FleetAccessState>()
  private readonly adapters = new Map<string, FleetAccessResourceAdapter>()

  constructor(private readonly runs: FleetRunService, private readonly groups: FleetGroupService) {
    const pathAdapter = (kind: 'workspace' | 'file'): FleetAccessResourceAdapter => ({
      kind,
      levelFor: builtInLevel,
      normalize: (teamId, resourceId) => logicalPath(this.projectRoot(teamId), teamId, resourceId),
      contains: (_teamId, parentId, childId) => logicalContains(parentId, childId),
    })
    this.registerAdapter({
      kind: 'team',
      levelFor: builtInLevel,
      normalize: (teamId, resourceId) => resourceId === teamId ? '$team' : resourceId,
    })
    this.registerAdapter({ kind: 'conversation', levelFor: builtInLevel, normalize: (_teamId, id) => id })
    this.registerAdapter(pathAdapter('workspace'))
    this.registerAdapter(pathAdapter('file'))
    this.registerAdapter({ kind: 'resource', levelFor: builtInLevel, normalize: (_teamId, id) => id })
  }

  registerAdapter(adapter: FleetAccessResourceAdapter): () => void {
    const kind = adapter.kind.trim()
    if (!KIND.test(kind)) throw new Error('Fleet Access resource kind must use lower-kebab-case')
    if (this.adapters.has(kind)) throw new Error(`Fleet Access resource adapter ${kind} is already registered`)
    const registered = { ...adapter, kind }
    this.adapters.set(kind, registered)
    return () => {
      if (this.adapters.get(kind) === registered) this.adapters.delete(kind)
    }
  }

  adapterKinds(): string[] {
    return [...this.adapters.keys()].sort()
  }

  state(teamId: string): FleetAccessState {
    let state = this.states.get(teamId)
    if (state === undefined) {
      const persisted = this.runs.readExtensionState(teamId, FLEET_ACCESS_STATE_NAMESPACE)
      state = persisted === undefined ? this.configurationState(teamId) : parseState(persisted)
      this.states.set(teamId, state)
    }
    return cloneState(state)
  }

  mode(
    teamId: string,
    principalValue: FleetAccessPrincipal,
    resourceKind: string,
  ): 'inherit' | 'restricted' {
    return this.state(teamId).modes.some(mode =>
      samePrincipal(mode.principal, principalValue) && mode.resourceKind === resourceKind)
      ? 'restricted'
      : 'inherit'
  }

  setMode(
    teamId: string,
    principalValue: FleetAccessPrincipal,
    resourceKind: string,
    mode: 'inherit' | 'restricted',
  ): void {
    this.requireAdapter(resourceKind)
    this.requirePrincipal(teamId, principalValue)
    const state = this.state(teamId)
    const modes = state.modes.filter(candidate =>
      !samePrincipal(candidate.principal, principalValue) || candidate.resourceKind !== resourceKind)
    if (mode === 'restricted') modes.push({ principal: structuredClone(principalValue), resourceKind, mode })
    this.save(teamId, { ...state, modes })
  }

  rules(teamId: string, principalValue?: FleetAccessPrincipal): FleetAccessRule[] {
    return this.state(teamId).rules
      .filter(rule => principalValue === undefined || samePrincipal(rule.principal, principalValue))
      .map(rule => structuredClone(rule))
  }

  putRule(teamId: string, input: PutFleetAccessRule): FleetAccessRule {
    const adapter = this.requireAdapter(input.resource.kind)
    if (input.levels.length === 0 || input.levels.some(level => !LEVELS.has(level))) {
      throw new Error('Fleet Access rule requires known access levels')
    }
    const id = input.id?.trim() || randomUUID()
    if (!RULE_ID.test(id)) throw new Error('Fleet Access rule id contains unsupported characters')
    const principalValue = input.principal
    this.requirePrincipal(teamId, principalValue)
    const rule: FleetAccessRule = {
      id,
      principal: structuredClone(principalValue),
      resource: {
        kind: adapter.kind,
        id: adapter.normalize(teamId, text(input.resource.id, 'Fleet Access resource id')),
      },
      scope: input.scope ?? 'self',
      effect: input.effect,
      levels: [...new Set(input.levels)],
    }
    const state = this.state(teamId)
    this.save(teamId, { ...state, rules: [...state.rules.filter(candidate => candidate.id !== id), rule] })
    return structuredClone(rule)
  }

  removeRule(teamId: string, id: string): void {
    const state = this.state(teamId)
    if (!state.rules.some(rule => rule.id === id)) throw new Error(`unknown Fleet Access rule ${id}`)
    this.save(teamId, { ...state, rules: state.rules.filter(rule => rule.id !== id) })
  }

  removeGroups(teamId: string, groups: readonly string[]): void {
    const ids = new Set(groups)
    const state = this.state(teamId)
    const modes = state.modes.filter(mode => !ids.has(mode.principal.id))
    const rules = state.rules.filter(rule => !ids.has(rule.principal.id))
    if (modes.length === state.modes.length && rules.length === state.rules.length) return
    this.save(teamId, { ...state, modes, rules })
  }

  authorize(input: FleetAuthorizationInput, baseline: boolean): boolean {
    const resource = input.resource
    if (resource === undefined) return baseline
    const adapter = this.adapters.get(resource.kind)
    if (adapter === undefined) return baseline
    const level = adapter.levelFor(input.action)
    if (level === undefined) return baseline
    let id: string
    try {
      id = adapter.normalize(input.teamId, resource.id)
    } catch {
      return false
    }
    const principals: FleetAccessPrincipal[] = this.groups.expanded(input.teamId, input.subject.id)
      .map(id => ({ kind: 'group', id }))
    const applies = (principalValue: FleetAccessPrincipal): boolean => principals.some(candidate =>
      samePrincipal(candidate, principalValue))
    const rules = this.state(input.teamId).rules.filter(rule =>
      applies(rule.principal)
      && rule.resource.kind === resource.kind
      && (rule.resource.id === id
        || (rule.scope === 'tree' && adapter.contains?.(input.teamId, rule.resource.id, id) === true)),
    )
    if (rules.some(rule => rule.effect === 'deny' && rule.levels.some(denied => denyBlocks(denied, level)))) {
      return false
    }
    if (rules.some(rule => rule.effect === 'allow' && rule.levels.some(granted => allowCovers(granted, level)))) {
      return true
    }
    return this.state(input.teamId).modes.some(mode =>
      applies(mode.principal) && mode.resourceKind === resource.kind)
      ? false
      : baseline
  }

  private requireAdapter(kind: string): FleetAccessResourceAdapter {
    const adapter = this.adapters.get(kind)
    if (adapter === undefined) throw new Error(`unknown Fleet Access resource adapter ${kind}`)
    return adapter
  }

  private requirePrincipal(teamId: string, principalValue: FleetAccessPrincipal): void {
    if (isFleetPrivateGroupId(principalValue.id)) return
    if (!this.groups.groups(teamId).some(group => group.id === principalValue.id)) {
      throw new Error(`unknown Fleet authorization group ${principalValue.id}`)
    }
  }

  private projectRoot(teamId: string): string {
    return this.runs.status(teamId).projectRoot
  }

  private configurationState(teamId: string): FleetAccessState {
    const configuration = this.runs.exportConfiguration(teamId)
    const modules = configuration.modules as Readonly<Record<string, unknown>>
    const configured = modules[FLEET_ACCESS_CONFIGURATION_MODULE]
    if (configured === undefined) return cloneState(EMPTY_STATE)
    const state = parseFleetAccessConfiguration(configured)
    return {
      ...state,
      rules: state.rules.map(rule => {
        const adapter = this.adapters.get(rule.resource.kind)
        return adapter === undefined ? rule : {
          ...rule,
          resource: { ...rule.resource, id: adapter.normalize(teamId, rule.resource.id) },
        }
      }),
    }
  }

  private save(teamId: string, state: FleetAccessState): void {
    const stored = cloneState(state)
    this.states.set(teamId, stored)
    this.runs.writeExtensionState(teamId, FLEET_ACCESS_STATE_NAMESPACE, asJson(stored))
  }
}

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true },
    result: { type: 'string', required: true },
  },
} as const

function installAccessTool(
  ctx: Context,
  service: FleetAccessService,
  authorization: FleetAuthorizationService,
  teamId: string,
  installedMember: FleetMemberView,
): () => void {
  const manage = authorization.has(teamId, installedMember, 'access.manage')
    || authorization.has(teamId, installedMember, 'team.manage')
  return ctx.tools.register(defineTool({
    name: 'fleet_access',
    description: 'Inspect your Fleet resource keycard. Authorized members can restrict resource kinds and grant or deny concrete resource access.',
    parameters: {
      action: { type: 'string', required: true, enum: manage
        ? ['get', 'explain', 'set_mode', 'grant', 'deny', 'remove_rule'] as const
        : ['get', 'explain'] as const },
      group_id: { type: 'string', description: 'Authorization group; defaults to the caller private group.' },
      action_id: { type: 'string', description: 'Registered Fleet action for explain.' },
      resource_kind: { type: 'string' },
      resource_id: { type: 'string' },
      mode: { type: 'string', enum: ['inherit', 'restricted'] },
      scope: { type: 'string', enum: ['self', 'tree'] },
      levels: { type: 'array', items: { type: 'string', enum: FLEET_ACCESS_LEVELS } },
      rule_id: { type: 'string' },
    },
    output: { schema: RESULT_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.result }] },
    execute(args, exec) {
      const caller = exec.agent as Agent | undefined
      if (caller === undefined) throw new Error('fleet_access requires a calling Agent')
      const actor = authorization.actorForAgent(String(caller.id))
      if (actor === undefined || actor.teamId !== teamId || actor.subject.id !== installedMember.id) {
        throw new Error('fleet_access caller is not the installed Fleet participant')
      }
      const target: FleetAccessPrincipal = args.group_id !== undefined
        ? { kind: 'group', id: args.group_id }
        : { kind: 'group', id: fleetPrivateGroupId(actor.subject.id) }
      const requireInspect = (): void => authorization.require({
        teamId,
        subject: actor.subject,
        action: 'access.inspect',
      })
      const requireManage = (): void => {
        const action = authorization.has(teamId, installedMember, 'access.manage') ? 'access.manage' : 'team.manage'
        authorization.require({ teamId, subject: actor.subject, action })
      }
      if (target.id !== fleetPrivateGroupId(actor.subject.id)) requireManage()
      let result: unknown
      if (args.action === 'get') {
        requireInspect()
        result = {
          principal: target,
          adapters: service.adapterKinds(),
          modes: service.state(teamId).modes.filter(mode => samePrincipal(mode.principal, target)),
          rules: service.rules(teamId, target),
        }
      } else if (args.action === 'explain') {
        requireInspect()
        if (args.action_id === undefined || args.resource_kind === undefined || args.resource_id === undefined) {
          throw new Error('fleet_access explain requires action_id, resource_kind, and resource_id')
        }
        if (args.group_id !== undefined) throw new Error('fleet_access explain checks the calling member only')
        result = {
          subject: actor.subject,
          action: args.action_id,
          resource: { kind: args.resource_kind, id: args.resource_id },
          allowed: authorization.authorize({
            teamId, subject: actor.subject, action: args.action_id,
            resource: { kind: args.resource_kind, id: args.resource_id },
          }),
        }
      } else if (args.action === 'set_mode') {
        requireManage()
        if (args.resource_kind === undefined || args.mode === undefined) {
          throw new Error('fleet_access set_mode requires resource_kind and mode')
        }
        service.setMode(teamId, target, args.resource_kind, args.mode)
        result = { principal: target, resourceKind: args.resource_kind, mode: args.mode }
      } else if (args.action === 'grant' || args.action === 'deny') {
        requireManage()
        if (args.resource_kind === undefined || args.resource_id === undefined || args.levels === undefined) {
          throw new Error(`fleet_access ${args.action} requires resource_kind, resource_id, and levels`)
        }
        result = service.putRule(teamId, {
          ...(args.rule_id === undefined ? {} : { id: args.rule_id }),
          principal: target,
          resource: { kind: args.resource_kind, id: args.resource_id },
          scope: args.scope ?? 'self',
          effect: args.action === 'grant' ? 'allow' : 'deny',
          levels: args.levels,
        })
      } else {
        requireManage()
        if (args.rule_id === undefined) throw new Error('fleet_access remove_rule requires rule_id')
        service.removeRule(teamId, args.rule_id)
        result = { removed: args.rule_id }
      }
      return Promise.resolve({ action: args.action, result: JSON.stringify(result) })
    },
  }))
}

export function applyAccess(ctx: Context): void {
  ctx.inject(['fleetAuthorization', 'fleetRuns', 'fleetConfiguration', 'fleetGroups'], scope => {
    const service = new FleetAccessService(scope.fleetRuns, scope.fleetGroups)
    scope.provide('fleetAccess', service)
    const stopConfiguration = scope.fleetConfiguration.register({
      id: FLEET_ACCESS_CONFIGURATION_MODULE,
      parse: parseFleetAccessConfiguration,
    })
    const stopGroups = scope.fleetGroups.onChange(change => {
      if (change.removedGroups !== undefined) service.removeGroups(change.teamId, change.removedGroups)
    })
    const stopPolicy = scope.fleetAuthorization.installResourcePolicy(service)
    const stopNamespace = scope.fleetAuthorization.registerNamespace({
      namespace: 'access',
      alwaysVisible: true,
      actions: [
        { id: 'inspect', description: 'Inspect your Fleet resource access.' },
        { id: 'manage', description: 'Manage Fleet resource access rules.' },
      ],
      defaultActions: ({ member }) => [
        'inspect',
        ...(member.permissions.includes('team.manage') ? ['manage'] : []),
      ],
      installTools: (memberCtx, input) => installAccessTool(
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
    fleetAccess: FleetAccessService
  }
}
