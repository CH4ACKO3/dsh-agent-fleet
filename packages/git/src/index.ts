import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type { FleetRunService } from 'dsh-agent-fleet'

import { FleetGit, FleetGitNotRepositoryError, installGitTools, type FleetGitScope } from './git.js'
import { terminalGitCommands, terminalGitPolicy, type FleetTerminalGitCommand } from './terminal.js'
import { FleetGitRecallService } from './recall.js'

import {
  FLEET_GIT_WEB_INVOCATIONS,
  type FleetGitCommitInput,
  type FleetGitDiffInput,
  type FleetGitFetchInput,
  type FleetGitSnapshotInput,
} from './contract.js'

export * from './contract.js'
export * from './git.js'
export * from './recall.js'
export * from './terminal.js'

export const name = '@ch4acko3/dsh-agent-fleet-git'
export const inject = ['fleetAuthorization'] as const

export const FLEET_GIT_PERMISSIONS = [
  { id: 'inspect', description: 'Inspect Git state and run read-only terminal Git commands.' },
  { id: 'scope-check', description: 'Run local Git mutations inside the member workspace and branch scope.' },
  { id: 'history-rewrite', description: 'Rewrite or remove local Git history and references.' },
  { id: 'publish', description: 'Push Git references to a remote.' },
  { id: 'repository-manage', description: 'Change repository configuration, remotes, or branch scope.' },
  { id: 'worktree-create', description: 'Create a member Git worktree.' },
  { id: 'worktree-manage', description: 'Create a Git worktree for another member.' },
] as const

const ATTRIBUTION_NAMESPACE = 'git-attribution'
const COMMIT_PRODUCING_GIT_COMMANDS = new Set([
  'am', 'cherry-pick', 'commit', 'merge', 'pull', 'rebase', 'revert',
])

export class FleetGitAttributionStore {
  private readonly teams = new Map<string, Map<string, string>>()

  constructor(private readonly runs: Pick<FleetRunService, 'readExtensionState' | 'writeExtensionState'>) {}

  private team(teamId: string): Map<string, string> {
    let commits = this.teams.get(teamId)
    if (commits !== undefined) return commits
    const stored = this.runs.readExtensionState(teamId, ATTRIBUTION_NAMESPACE)
    const values = typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>).commits
      : undefined
    commits = new Map(typeof values === 'object' && values !== null && !Array.isArray(values)
      ? Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      : [])
    this.teams.set(teamId, commits)
    return commits
  }

  record(teamId: string, hashes: readonly string[], memberId: string): void {
    if (hashes.length === 0) return
    const commits = this.team(teamId)
    let changed = false
    for (const hash of hashes) {
      if (commits.get(hash) === memberId) continue
      commits.set(hash, memberId)
      changed = true
    }
    if (changed) this.runs.writeExtensionState(teamId, ATTRIBUTION_NAMESPACE, {
      version: 1,
      commits: Object.fromEntries(commits),
    })
  }

  select(teamId: string, hashes: readonly string[]): Readonly<Record<string, string>> {
    const commits = this.team(teamId)
    return Object.fromEntries(hashes.flatMap(hash => {
      const member = commits.get(hash)
      return member === undefined ? [] : [[hash, member]]
    }))
  }
}

function inside(root: string, path: string): boolean {
  const boundary = relative(resolve(root), resolve(path))
  return boundary === '' || (boundary !== '..' && !boundary.startsWith(`..${sep}`) && !isAbsolute(boundary))
}

const OPTION_VALUE = new Set([
  '-b', '--branch', '--depth', '--filter', '-o', '--origin', '--reference', '--reference-if-able',
  '--separate-git-dir', '--upload-pack', '-u', '--upload-pack', '--config', '-c', '--repo',
])

function operands(args: readonly string[]): string[] {
  const result: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index] as string
    if (value === '--') {
      result.push(...args.slice(index + 1))
      break
    }
    if (OPTION_VALUE.has(value)) {
      index += 1
      continue
    }
    if (!value.startsWith('-')) result.push(value)
  }
  return result
}

function setupTarget(command: FleetTerminalGitCommand): string {
  const values = operands(command.args)
  if (command.verb === 'init') return resolve(command.cwd, values[0] ?? '.')
  const source = values[0]
  const destination = values[1]
  if (destination !== undefined) return resolve(command.cwd, destination)
  if (source === undefined) return command.cwd
  const name = basename(source.replace(/\/$/u, '')).replace(/\.git$/u, '')
  return resolve(command.cwd, name || '.')
}

function refBranch(value: string): string {
  return value.replace(/^\+/u, '').replace(/^refs\/heads\//u, '')
}

function requireScopedPush(command: FleetTerminalGitCommand, scope: FleetGitScope): void {
  const branch = scope.boundBranch ?? scope.branch
  if (branch === undefined) return
  if (command.args.some(value => ['--all', '--mirror'].includes(value))) {
    throw new Error(`Fleet Git push is limited to branch ${branch}`)
  }
  const values = operands(command.args)
  for (const refspec of values.slice(1)) {
    const [source = '', destination] = refspec.split(':', 2)
    if (source.length > 0 && source !== 'HEAD' && refBranch(source) !== branch) {
      throw new Error(`Fleet Git push source ${source} is outside branch ${branch}`)
    }
    if (destination !== undefined && destination.length > 0 && refBranch(destination) !== branch) {
      throw new Error(`Fleet Git push destination ${destination} is outside branch ${branch}`)
    }
  }
}

export function installGitTerminalPolicy(
  ctx: Context,
  store: FleetGitAttributionStore,
): () => void {
  return ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const commands = terminalGitCommands(exec)
    if (commands.length === 0) return next()
    const actor = exec.agent === undefined ? undefined : ctx.fleetAuthorization.actorForAgent(String(exec.agent.id))
    if (actor === undefined || (actor.subject.kind !== 'member' && actor.subject.kind !== 'assistant')) return next()
    const team = ctx.fleetRuns.status(actor.teamId)
    const workspace = exec.agent?.session.header.cwd ?? team.projectRoot
    const trackers = new Map<string, { readonly git: FleetGit; readonly cwd: string; readonly marker: string | undefined }>()
    for (const command of commands) {
      const policy = terminalGitPolicy(command)
      if (command.repositoryOverride) {
        throw new Error('Fleet Git terminal policy does not allow --git-dir or --work-tree; use git -C inside the Team workspace')
      }
      if (policy.directWorktreeMutation) {
        throw new Error('Use fleet_git create_worktree so Fleet can bind the worktree to its member')
      }
      if (command.verb === 'init' || command.verb === 'clone') {
        const target = setupTarget(command)
        if (!inside(team.projectRoot, target) || !inside(workspace, target)) {
          throw new Error(`Fleet Git ${command.verb} target is outside the member workspace: ${target}`)
        }
        ctx.fleetAuthorization.require({
          teamId: actor.teamId,
          subject: actor.subject,
          action: 'git.repository-manage',
          resource: { kind: 'git-repository', id: target },
        })
        continue
      }
      const fleetGit = new FleetGit(team.projectRoot, undefined, actor.teamId)
      const repository = fleetGit.root
      const scope = fleetGit.scope(
        actor.subject.id,
        command.cwd,
        [{ path: workspace, access: 'write' }],
        policy.intent,
      )
      for (const action of new Set(policy.actions)) ctx.fleetAuthorization.require({
        teamId: actor.teamId,
        subject: actor.subject,
        action,
        resource: { kind: 'git-repository', id: repository },
      })
      if (command.verb === 'push') requireScopedPush(command, scope)
      if (COMMIT_PRODUCING_GIT_COMMANDS.has(command.verb) && !trackers.has(command.cwd)) {
        trackers.set(command.cwd, { git: fleetGit, cwd: command.cwd, marker: fleetGit.reflogMarker(command.cwd) })
      }
    }
    const result = await next()
    if (result.isError) return result
    for (const tracker of trackers.values()) try {
      store.record(
        actor.teamId,
        tracker.git.attributedCommitsSinceReflog(tracker.cwd, tracker.marker),
        actor.subject.id,
      )
    } catch {}
    return result
  })
}

function pathInside(root: string, target: string): boolean {
  const value = relative(root, target)
  return value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))
}

function repositoryResourceId(projectRoot: string, resourceId: string): string {
  if (/^(?:workspace|absolute):/u.test(resourceId)) return resourceId
  const root = resolve(projectRoot)
  const target = resolve(isAbsolute(resourceId) ? resourceId : resolve(root, resourceId))
  return pathInside(root, target)
    ? `workspace:${relative(root, target) || '.'}`
    : `absolute:${target}`
}

const FLEET_GIT_WEB_LOCAL: TypertContribution = {
  package: '@ch4acko3/dsh-agent-fleet-git/web',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: FLEET_GIT_WEB_INVOCATIONS,
}

function required(value: string | undefined, label: string): string {
  const result = value?.trim() ?? ''
  if (result.length === 0) throw new Error(`${label} cannot be empty`)
  return result
}

export class FleetGitWebRemote extends TypertRemoteService {
  constructor(host: Context, private readonly attributions?: FleetGitAttributionStore) {
    super(host, 'fleetGitWeb', { namespace: 'fleetGit' })
  }

  snapshot(input: FleetGitSnapshotInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const root = required(input.root, 'root')
    const limit = input.limit ?? 200
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be from 1 through 500')
    try {
      const snapshot = new FleetGit(root).snapshot(root, limit)
      return input.teamId === undefined || this.attributions === undefined
        ? snapshot
        : { ...snapshot, attributions: this.attributions.select(input.teamId, snapshot.commits.map(commit => commit.hash)) }
    } catch (error) {
      if (error instanceof FleetGitNotRepositoryError) return null
      throw error
    }
  }

  diff(input: FleetGitDiffInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const root = required(input.root, 'root')
    const path = required(input.path, 'path')
    return new FleetGit(root).diff(root, path, input.staged ?? false)
  }

  commit(input: FleetGitCommitInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const root = required(input.root, 'root')
    const hash = required(input.hash, 'hash')
    return new FleetGit(root).commit(root, hash)
  }

  fetch(input: FleetGitFetchInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const root = required(input.root, 'root')
    const fleetGit = new FleetGit(root)
    fleetGit.fetch(root)
    const snapshot = fleetGit.snapshot(root)
    return input.teamId === undefined || this.attributions === undefined
      ? snapshot
      : { ...snapshot, attributions: this.attributions.select(input.teamId, snapshot.commits.map(commit => commit.hash)) }
  }
}

export function apply(ctx: Context): void {
  ctx.inject(['fleetAuthorization'], scope => {
    const stopNamespace = scope.fleetAuthorization.registerNamespace({
      namespace: 'git',
      actions: FLEET_GIT_PERMISSIONS,
      defaultActions: () => ['inspect', 'scope-check', 'worktree-create'],
      installTools(agentContext, input) {
        return installGitTools(
          agentContext,
          new FleetGit(input.projectRoot, undefined, input.teamId),
          {
            teamId: input.teamId,
            member: input.member.id,
            hasMember: input.hasMember,
            authorization: scope.fleetAuthorization,
            permissions: new Set(input.authorization.actions),
          },
        )
      },
    })
    const stopResource = scope.fleetAuthorization.registerResourceKind({
      kind: 'git-repository',
      authorizeBaseline: () => true,
    })
    return () => {
      stopResource()
      stopNamespace()
    }
  })
  ctx.inject(['fleetAccess', 'fleetRuns'], scope => scope.fleetAccess.registerAdapter({
    kind: 'git-repository',
    levelFor: action => {
      if (action === 'git.inspect') return 'read'
      if (action === 'git.scope-check' || action === 'git.history-rewrite'
        || action === 'git.publish' || action === 'git.worktree-create') return 'write'
      if (action === 'git.repository-manage' || action === 'git.worktree-manage') return 'manage'
      return undefined
    },
    normalize: (teamId, resourceId) => repositoryResourceId(
      scope.fleetRuns.status(teamId).projectRoot,
      resourceId,
    ),
  }))
  ctx.inject(['fleetRuns', 'fleetAuthorization', 'tools'], scope => {
    const attributions = new FleetGitAttributionStore(scope.fleetRuns)
    scope.provide('fleetGitAttributions', attributions)
    return installGitTerminalPolicy(scope, attributions)
  })
  ctx.inject(['fleetRuns', 'fleetAuthorization', 'agents', 'fleetGitAttributions'], scope => {
    scope.provide('fleetGitRecall', new FleetGitRecallService(scope, scope.fleetGitAttributions))
  })
  ctx.inject(['typert', 'fleetGitAttributions'], scope => {
    new FleetGitWebRemote(scope, scope.fleetGitAttributions)
    return scope.typert.register(FLEET_GIT_WEB_LOCAL)
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetGitAttributions: FleetGitAttributionStore
    fleetGitRecall: FleetGitRecallService
    fleetGitWeb: FleetGitWebRemote
  }
}
