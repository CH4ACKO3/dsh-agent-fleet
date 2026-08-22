import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { resolve } from 'node:path'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type { FleetRunService } from 'dsh-agent-fleet'

import { FleetGit, FleetGitNotRepositoryError, installGitTools } from './git.js'

import {
  FLEET_GIT_WEB_INVOCATIONS,
  type FleetGitCommitInput,
  type FleetGitDiffInput,
  type FleetGitFetchInput,
  type FleetGitSnapshotInput,
} from './contract.js'

export * from './contract.js'
export * from './git.js'

export const name = '@ch4acko3/dsh-agent-fleet-git'
export const inject = ['fleetAuthorization'] as const

export const FLEET_GIT_PERMISSIONS = [
  { id: 'inspect', description: 'Inspect Git operation scope.' },
  { id: 'scope-check', description: 'Check a proposed terminal Git operation against its allowed scope.' },
  { id: 'worktree-create', description: 'Create a member Git worktree.' },
  { id: 'worktree-manage', description: 'Create a Git worktree for another member.' },
] as const

const ATTRIBUTION_NAMESPACE = 'git-attribution'

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

function textField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.trim().length > 0 ? field : undefined
}

function terminalCommitCwd(exec: Readonly<ToolExecution>): string | undefined {
  if (exec.agent === undefined || !['bash', 'exec_command'].includes(exec.name)) return undefined
  const command = textField(exec.arguments, 'command') ?? textField(exec.arguments, 'cmd') ?? textField(exec.arguments, 'script')
  if (command === undefined) return undefined
  let cwd = textField(exec.arguments, 'cwd') ?? textField(exec.arguments, 'workdir') ?? exec.agent.session.header.cwd
  for (const segment of command.split(/(?:&&|\|\||;|\n)/u).map(value => value.trim()).filter(Boolean)) {
    const changeDirectory = segment.match(/^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))$/u)
    if (changeDirectory !== null) {
      const path = changeDirectory[1] ?? changeDirectory[2] ?? changeDirectory[3]
      if (path !== undefined) cwd = resolve(cwd ?? process.cwd(), path)
      continue
    }
    if (!/^(?:(?:env|command)\s+[^;&|]*?\s+)?git(?:\s|$)[^;&|]*\bcommit(?:\s|$)/u.test(segment)) continue
    const gitDirectory = segment.match(/\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/u)
    const path = gitDirectory?.[1] ?? gitDirectory?.[2] ?? gitDirectory?.[3]
    if (path !== undefined) cwd = resolve(cwd ?? process.cwd(), path)
    return cwd
  }
  return undefined
}

export function installGitAttributionTracking(
  ctx: Context,
  store: FleetGitAttributionStore,
): () => void {
  return ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const cwd = terminalCommitCwd(exec)
    const actor = exec.agent === undefined ? undefined : ctx.fleetAuthorization.actorForAgent(String(exec.agent.id))
    if (cwd === undefined || actor === undefined || (actor.subject.kind !== 'member' && actor.subject.kind !== 'assistant')) return next()
    let fleetGit: FleetGit
    let before: string | undefined
    try {
      fleetGit = new FleetGit(cwd)
      before = fleetGit.status(cwd).head
    } catch {
      return next()
    }
    const result = await next()
    if (result.isError) return result
    try {
      const after = fleetGit.status(cwd).head
      if (after !== undefined && after !== before) store.record(
        actor.teamId,
        fleetGit.commitsSince(cwd, before, after),
        actor.subject.id,
      )
    } catch {}
    return result
  })
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
  ctx.inject(['fleetRuns', 'fleetAuthorization', 'tools'], scope => {
    const attributions = new FleetGitAttributionStore(scope.fleetRuns)
    scope.provide('fleetGitAttributions', attributions)
    return installGitAttributionTracking(scope, attributions)
  })
  ctx.inject(['typert', 'fleetGitAttributions'], scope => {
    new FleetGitWebRemote(scope, scope.fleetGitAttributions)
    return scope.typert.register(FLEET_GIT_WEB_LOCAL)
  })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetGitAttributions: FleetGitAttributionStore
    fleetGitWeb: FleetGitWebRemote
  }
}
