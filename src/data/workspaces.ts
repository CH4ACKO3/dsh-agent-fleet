import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'

import type { FleetArchiveRegistry, FleetArchiveTeam } from '../archive.js'
import type { FleetAuthorizationService, FleetEffectiveAuthorization } from '../authorization.js'
import type { FleetRunService } from '../run.js'
import { object, text } from '../validation.js'

export const FLEET_WORKSPACE_STATE_NAMESPACE = 'workspaces'
export const FLEET_WORKSPACE_ARCHIVE_CONTRIBUTOR = 'fleet.workspaces'

export type FleetWorkspaceAccess = 'read' | 'write'

export interface FleetWorkspace {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly createdBy: string
  readonly createdAt: string
}

export interface FleetWorkspaceMount {
  readonly workspaceId: string
  readonly access: FleetWorkspaceAccess
}

export interface FleetWorkspaceState {
  readonly version: 1
  readonly workspaces: readonly FleetWorkspace[]
  /** Missing member keys inherit the Team's primary project workspace. */
  readonly members: Readonly<Record<string, readonly FleetWorkspaceMount[]>>
}

export interface FleetResolvedWorkspaceMount extends FleetWorkspace {
  readonly access: FleetWorkspaceAccess
  readonly builtIn: boolean
}

const EMPTY_STATE: FleetWorkspaceState = { version: 1, workspaces: [], members: {} }
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const ID = /^workspace_[a-f0-9-]+$/u
const PROJECT_WORKSPACE_ID = 'project'

function parseWorkspace(value: unknown, label: string): FleetWorkspace {
  const input = object(value, label)
  const id = text(input.id, `${label}.id`)
  const name = text(input.name, `${label}.name`)
  if (!ID.test(id)) throw new Error(`${label}.id is invalid`)
  if (!NAME.test(name)) throw new Error(`${label}.name must use lower-kebab-case`)
  return {
    id,
    name,
    path: text(input.path, `${label}.path`),
    createdBy: text(input.createdBy, `${label}.createdBy`),
    createdAt: text(input.createdAt, `${label}.createdAt`),
  }
}

function parseMount(value: unknown, label: string): FleetWorkspaceMount {
  const input = object(value, label)
  const workspaceId = text(input.workspaceId, `${label}.workspaceId`)
  if (workspaceId !== PROJECT_WORKSPACE_ID && !ID.test(workspaceId)) throw new Error(`${label}.workspaceId is invalid`)
  if (input.access !== 'read' && input.access !== 'write') throw new Error(`${label}.access must be read or write`)
  return { workspaceId, access: input.access }
}

export function parseFleetWorkspaceState(value: JsonValue | undefined): FleetWorkspaceState {
  if (value === undefined) return structuredClone(EMPTY_STATE)
  const input = object(value, 'Fleet Workspace state')
  if (input.version !== 1 || !Array.isArray(input.workspaces)) {
    throw new Error('Fleet Workspace state must contain version 1 workspaces')
  }
  const membersInput = object(input.members, 'Fleet Workspace state members')
  const workspaces = input.workspaces.map((entry, index) => parseWorkspace(entry, `Fleet Workspace state workspaces[${String(index)}]`))
  if (new Set(workspaces.map(workspace => workspace.id)).size !== workspaces.length
    || new Set(workspaces.map(workspace => workspace.name)).size !== workspaces.length
    || new Set(workspaces.map(workspace => workspace.path)).size !== workspaces.length) {
    throw new Error('Fleet Workspace state contains duplicate ids, names, or paths')
  }
  const known = new Set([PROJECT_WORKSPACE_ID, ...workspaces.map(workspace => workspace.id)])
  const members = Object.fromEntries(Object.entries(membersInput).map(([member, value]) => {
    if (member.trim().length === 0 || !Array.isArray(value)) throw new Error('Fleet Workspace member mounts must be arrays')
    const mounts = value.map((entry, index) => parseMount(entry, `Fleet Workspace member ${member}[${String(index)}]`))
    if (new Set(mounts.map(mount => mount.workspaceId)).size !== mounts.length) {
      throw new Error(`Fleet Workspace member ${member} contains duplicate mounts`)
    }
    for (const mount of mounts) if (!known.has(mount.workspaceId)) {
      throw new Error(`Fleet Workspace member ${member} references unknown workspace ${mount.workspaceId}`)
    }
    return [member, mounts]
  }))
  return { version: 1, workspaces, members }
}

function pathInside(root: string, target: string): boolean {
  const value = relative(root, target)
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))
}

function relocateWorkspacePath(path: string, source: FleetArchiveTeam, target: FleetArchiveTeam): string {
  const sourceRoot = existsSync(source.projectRoot) ? realpathSync(source.projectRoot) : resolve(source.projectRoot)
  const targetRoot = existsSync(target.projectRoot) ? realpathSync(target.projectRoot) : resolve(target.projectRoot)
  const resolved = resolve(path)
  return pathInside(sourceRoot, resolved)
    ? resolve(targetRoot, relative(sourceRoot, resolved))
    : path
}

export class FleetWorkspaceService {
  private readonly states = new Map<string, FleetWorkspaceState>()

  constructor(private readonly runs: FleetRunService) {}

  state(teamId: string): FleetWorkspaceState {
    let state = this.states.get(teamId)
    if (state === undefined) {
      state = parseFleetWorkspaceState(this.runs.readExtensionState(teamId, FLEET_WORKSPACE_STATE_NAMESPACE))
      this.states.set(teamId, state)
    }
    return structuredClone(state)
  }

  workspaces(teamId: string): FleetWorkspace[] {
    return [this.projectWorkspace(teamId), ...this.state(teamId).workspaces].map(workspace => structuredClone(workspace))
  }

  workspace(teamId: string, workspaceId: string): FleetWorkspace {
    const workspace = this.workspaces(teamId).find(candidate => candidate.id === workspaceId)
    if (workspace === undefined) throw new Error(`unknown Fleet workspace ${workspaceId}`)
    return workspace
  }

  resolvePath(teamId: string, path: string): string {
    const root = this.runs.status(teamId).projectRoot
    const candidate = isAbsolute(path) ? path : resolve(root, path)
    if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
      throw new Error(`Fleet workspace must be an existing directory: ${candidate}`)
    }
    return realpathSync(candidate)
  }

  mounts(teamId: string, member: string): FleetResolvedWorkspaceMount[] {
    this.requireMember(teamId, member)
    const state = this.state(teamId)
    const configured = state.members[member]
      ?? [{ workspaceId: PROJECT_WORKSPACE_ID, access: 'write' as const }]
    const workspaces = new Map(this.workspaces(teamId).map(workspace => [workspace.id, workspace]))
    return configured.map(mount => {
      const workspace = workspaces.get(mount.workspaceId)
      if (workspace === undefined) throw new Error(`unknown Fleet workspace ${mount.workspaceId}`)
      return { ...workspace, access: mount.access, builtIn: workspace.id === PROJECT_WORKSPACE_ID }
    })
  }

  attach(teamId: string, actor: string, input: { readonly name: string; readonly path: string }): FleetWorkspace {
    const name = input.name.trim()
    if (!NAME.test(name)) throw new Error('Fleet workspace name must use lower-kebab-case')
    const root = this.runs.status(teamId).projectRoot
    const path = this.resolvePath(teamId, input.path)
    const state = this.state(teamId)
    const project = realpathSync(root)
    if (name === PROJECT_WORKSPACE_ID || state.workspaces.some(workspace => workspace.name === name)) {
      throw new Error(`Fleet workspace name ${name} is already in use`)
    }
    if (path === project || state.workspaces.some(workspace => workspace.path === path)) {
      throw new Error(`Fleet workspace path ${path} is already attached`)
    }
    const workspace: FleetWorkspace = {
      id: `workspace_${randomUUID()}`,
      name,
      path,
      createdBy: actor,
      createdAt: new Date().toISOString(),
    }
    this.save(teamId, { ...state, workspaces: [...state.workspaces, workspace] })
    this.runs.recordDataEvent(teamId, 'workspace.attached', { actor, workspace })
    return structuredClone(workspace)
  }

  detach(teamId: string, actor: string, workspaceId: string): void {
    if (workspaceId === PROJECT_WORKSPACE_ID) throw new Error('the Team project workspace cannot be detached')
    const state = this.state(teamId)
    const workspace = state.workspaces.find(candidate => candidate.id === workspaceId)
    if (workspace === undefined) {
      throw new Error(`unknown Fleet workspace ${workspaceId}`)
    }
    const members = Object.fromEntries(Object.entries(state.members).map(([member, mounts]) => [
      member,
      mounts.filter(mount => mount.workspaceId !== workspaceId),
    ]))
    this.save(teamId, {
      ...state,
      workspaces: state.workspaces.filter(workspace => workspace.id !== workspaceId),
      members,
    })
    this.runs.recordDataEvent(teamId, 'workspace.detached', { actor, workspace })
    for (const member of Object.keys(members)) {
      this.runs.recordDataEvent(teamId, 'workspace.assigned', {
        actor,
        member,
        workspaces: this.mounts(teamId, member),
      })
    }
  }

  assign(
    teamId: string,
    member: string,
    mounts: readonly FleetWorkspaceMount[],
    actor = member,
  ): FleetResolvedWorkspaceMount[] {
    this.requireMember(teamId, member)
    const state = this.state(teamId)
    const known = new Set([PROJECT_WORKSPACE_ID, ...state.workspaces.map(workspace => workspace.id)])
    if (new Set(mounts.map(mount => mount.workspaceId)).size !== mounts.length) {
      throw new Error('Fleet workspace assignment contains duplicate mounts')
    }
    for (const mount of mounts) {
      if (!known.has(mount.workspaceId)) throw new Error(`unknown Fleet workspace ${mount.workspaceId}`)
      if (mount.access !== 'read' && mount.access !== 'write') throw new Error('Fleet workspace access must be read or write')
    }
    this.save(teamId, {
      ...state,
      members: { ...state.members, [member]: mounts.map(mount => ({ ...mount })) },
    })
    const resolved = this.mounts(teamId, member)
    this.runs.recordDataEvent(teamId, 'workspace.assigned', { actor, member, workspaces: resolved })
    return resolved
  }

  restore(teamId: string, state: FleetWorkspaceState): void {
    this.save(teamId, parseFleetWorkspaceState(state as unknown as JsonValue))
  }

  private projectWorkspace(teamId: string): FleetWorkspace {
    const record = this.runs.status(teamId)
    return {
      id: PROJECT_WORKSPACE_ID,
      name: PROJECT_WORKSPACE_ID,
      path: realpathSync(record.projectRoot),
      createdBy: 'system',
      createdAt: record.startedAt,
    }
  }

  private requireMember(teamId: string, member: string): void {
    if (!this.runs.memberViews(teamId).some(view => view.id === member)) {
      throw new Error(`unknown Fleet member ${member}`)
    }
  }

  private save(teamId: string, state: FleetWorkspaceState): void {
    const stored = structuredClone(state)
    this.runs.writeExtensionState(teamId, FLEET_WORKSPACE_STATE_NAMESPACE, stored as unknown as JsonValue)
    this.states.set(teamId, stored)
  }
}

const WORKSPACE_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, name: { type: 'string', required: true },
    path: { type: 'string', required: true }, access: { type: 'string', enum: ['read', 'write'] },
    builtIn: { type: 'boolean' }, createdBy: { type: 'string', required: true }, createdAt: { type: 'string', required: true },
  },
} as const

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'attach', 'detach', 'assign'] },
    member: { type: 'string' }, workspace: WORKSPACE_SCHEMA,
    workspaces: { type: 'array', required: true, items: WORKSPACE_SCHEMA },
  },
} as const

function installWorkspaceTool(
  ctx: Context,
  service: FleetWorkspaceService,
  authorization: FleetAuthorizationService,
  teamId: string,
  installed: FleetEffectiveAuthorization,
): () => void {
  const canManage = installed.op || installed.actions.includes('workspace.manage')
  return ctx.tools.register(defineTool({
    name: 'fleet_workspace',
    description: 'Inspect Team workspace mounts. Authorized members can attach directories and assign read/write mounts to members. Native DSH Session sandbox boundaries remain authoritative.',
    parameters: {
      action: { type: 'string', required: true, enum: canManage
        ? ['list', 'attach', 'detach', 'assign'] as const
        : ['list'] as const },
      member: { type: 'string', description: 'Member id. Defaults to the caller for list; required for assign.' },
      workspace_id: { type: 'string', description: 'Workspace id required for detach.' },
      name: { type: 'string', description: 'Lower-kebab-case name required for attach.' },
      path: { type: 'string', description: 'Existing directory required for attach. Relative paths resolve from the Team project root.' },
      mounts: {
        type: 'array', description: 'Complete replacement mount list required for assign.', items: {
          type: 'object', additionalProperties: false, properties: {
            workspace_id: { type: 'string', required: true },
            access: { type: 'string', required: true, enum: ['read', 'write'] },
          },
        },
      },
    },
    output: { schema: RESULT_SCHEMA, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute(args, exec) {
      const caller = exec.agent as Agent | undefined
      if (caller === undefined) throw new Error('fleet_workspace requires a calling Agent')
      const actor = authorization.actorForAgent(String(caller.id))
      if (actor === undefined || actor.teamId !== teamId) throw new Error('fleet_workspace caller is not a Fleet participant')
      const requireManage = (): void => authorization.require({ teamId, subject: actor.subject, action: 'workspace.manage' })
      const requireWorkspace = (path: string, action: 'read' | 'manage'): void => authorization.require({
        teamId,
        subject: actor.subject,
        action: `workspace.${action}`,
        resource: { kind: 'workspace', id: path },
      })
      const visible = (workspaces: readonly FleetResolvedWorkspaceMount[]): FleetResolvedWorkspaceMount[] => workspaces
        .filter(workspace => authorization.authorize({
          teamId,
          subject: actor.subject,
          action: 'workspace.read',
          resource: { kind: 'workspace', id: workspace.path },
        }))
      if (args.action === 'list') {
        const member = args.member ?? actor.subject.id
        if (member !== actor.subject.id) requireManage()
        else authorization.require({ teamId, subject: actor.subject, action: 'workspace.read' })
        const workspaces = visible(service.mounts(teamId, member))
        return Promise.resolve({ action: 'list' as const, member, workspaces })
      }
      requireManage()
      if (args.action === 'attach') {
        if (args.name === undefined || args.path === undefined) throw new Error('fleet_workspace attach requires name and path')
        requireWorkspace(service.resolvePath(teamId, args.path), 'manage')
        const workspace = service.attach(teamId, actor.subject.id, { name: args.name, path: args.path })
        return Promise.resolve({ action: 'attach' as const, workspace, workspaces: [] })
      }
      if (args.action === 'detach') {
        if (args.workspace_id === undefined) throw new Error('fleet_workspace detach requires workspace_id')
        requireWorkspace(service.workspace(teamId, args.workspace_id).path, 'manage')
        service.detach(teamId, actor.subject.id, args.workspace_id)
        return Promise.resolve({ action: 'detach' as const, workspaces: [] })
      }
      if (args.member === undefined || args.mounts === undefined) throw new Error('fleet_workspace assign requires member and mounts')
      for (const mount of args.mounts) requireWorkspace(service.workspace(teamId, mount.workspace_id).path, 'manage')
      const workspaces = service.assign(teamId, args.member, args.mounts.map(mount => ({
        workspaceId: mount.workspace_id,
        access: mount.access,
      })), actor.subject.id)
      return Promise.resolve({ action: 'assign' as const, member: args.member, workspaces })
    },
  }))
}

export function installWorkspaceArchive(service: FleetWorkspaceService, archives: FleetArchiveRegistry): () => void {
  return archives.register({
    id: FLEET_WORKSPACE_ARCHIVE_CONTRIBUTOR,
    save({ team, directory }) {
      writeFileSync(join(directory, 'state.json'), `${JSON.stringify(service.state(team.id), null, 2)}\n`, 'utf8')
    },
    restore({ team, sourceTeam, directory }) {
      const path = join(directory, 'state.json')
      if (!existsSync(path)) return
      const source = parseFleetWorkspaceState(JSON.parse(readFileSync(path, 'utf8')) as JsonValue)
      service.restore(team.id, {
        ...source,
        workspaces: source.workspaces.map(workspace => ({
          ...workspace,
          path: relocateWorkspacePath(workspace.path, sourceTeam, team),
        })),
      })
    },
  })
}

export function applyWorkspaces(ctx: Context): void {
  ctx.inject(['fleetAuthorization', 'fleetAccess', 'fleetArchives', 'fleetRuns'], scope => {
    const service = new FleetWorkspaceService(scope.fleetRuns)
    scope.provide('fleetWorkspaces', service)
    const stopArchive = installWorkspaceArchive(service, scope.fleetArchives)
    const stopNamespace = scope.fleetAuthorization.registerNamespace({
      namespace: 'workspace',
      actions: [
        { id: 'read', description: 'Inspect workspace mounts assigned to a Team member.' },
        { id: 'manage', description: 'Attach, detach, and assign Team workspaces.' },
      ],
      defaultActions: ({ member }) => [
        ...(member.toolGroups.includes('resources') || member.permissions.includes('workspace.manage')
          || member.permissions.includes('team.manage') ? ['read'] : []),
        ...(member.permissions.includes('workspace.manage') || member.permissions.includes('team.manage') ? ['manage'] : []),
      ],
      installTools: (memberCtx, input) => installWorkspaceTool(
        memberCtx, service, scope.fleetAuthorization, input.teamId, input.authorization,
      ),
    })
    return () => {
      stopNamespace()
      stopArchive()
    }
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetWorkspaces: FleetWorkspaceService
  }
}
