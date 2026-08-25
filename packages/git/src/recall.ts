import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FleetAuthorizationService, FleetRunService } from 'dsh-agent-fleet'

import type { FleetGitAttributionStore } from './index.js'
import {
  FleetGit,
  type FleetGitCommitDetails,
  type FleetGitDiff,
  type FleetGitSnapshot,
} from './git.js'

export interface FleetGitRecallActorInput {
  readonly teamId: string
  readonly subject: { readonly kind: 'member' | 'assistant'; readonly id: string }
  readonly sessionId: string
}

export interface FleetGitRecallSnapshotInput extends FleetGitRecallActorInput {
  readonly limit: number
}

export interface FleetGitRecallCommitInput extends FleetGitRecallActorInput {
  readonly hash: string
}

export interface FleetGitRecallDiffInput extends FleetGitRecallActorInput {
  readonly path: string
  readonly staged?: boolean
}

export interface FleetGitRecallHost {
  readonly agents: { list(): Agent[] }
  readonly fleetRuns: Pick<FleetRunService, 'status'>
  readonly fleetAuthorization: Pick<FleetAuthorizationService, 'actorForAgent' | 'require'>
}

/** Authorized, member-workspace-scoped read seam for optional memory processors. */
export class FleetGitRecallService {
  constructor(
    private readonly host: FleetGitRecallHost,
    private readonly attributions?: Pick<FleetGitAttributionStore, 'select'>,
  ) {}

  snapshot(input: FleetGitRecallSnapshotInput, signal: AbortSignal): FleetGitSnapshot | null {
    signal.throwIfAborted()
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      throw new Error('limit must be from 1 through 500')
    }
    const scoped = this.scoped(input)
    const snapshot = scoped.git.snapshot(scoped.cwd, input.limit)
    return this.attributions === undefined
      ? snapshot
      : { ...snapshot, attributions: this.attributions.select(input.teamId, snapshot.commits.map(commit => commit.hash)) }
  }

  commit(input: FleetGitRecallCommitInput, signal: AbortSignal): FleetGitCommitDetails {
    signal.throwIfAborted()
    const hash = input.hash.trim()
    if (hash.length === 0) throw new Error('hash cannot be empty')
    const scoped = this.scoped(input)
    return scoped.git.commit(scoped.cwd, hash)
  }

  diff(input: FleetGitRecallDiffInput, signal: AbortSignal): FleetGitDiff {
    signal.throwIfAborted()
    const path = input.path.trim()
    if (path.length === 0) throw new Error('path cannot be empty')
    const scoped = this.scoped(input, [path])
    return scoped.git.diff(scoped.cwd, path, input.staged ?? false)
  }

  private scoped(input: FleetGitRecallActorInput, paths: readonly string[] = []): {
    readonly git: FleetGit
    readonly cwd: string
  } {
    const actor = this.host.fleetAuthorization.actorForAgent(input.sessionId)
    if (actor === undefined || actor.teamId !== input.teamId
      || actor.subject.kind !== input.subject.kind || actor.subject.id !== input.subject.id) {
      throw new Error('Fleet Git recall identity does not match the live Fleet participant')
    }
    const agent = this.host.agents.list().find(candidate => String(candidate.id) === input.sessionId)
    if (agent === undefined) throw new Error('Fleet Git recall requires a live member Agent')
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new Error('Fleet Git recall requires the member Session workspace')
    const team = this.host.fleetRuns.status(input.teamId)
    const git = new FleetGit(team.projectRoot, undefined, input.teamId)
    const repository = git.root
    this.host.fleetAuthorization.require({
      teamId: input.teamId,
      subject: input.subject,
      action: 'git.inspect',
      resource: { kind: 'git-repository', id: repository },
    })
    git.scope(input.subject.id, cwd, [{ path: cwd, access: 'write' }], 'read', paths)
    return { git, cwd }
  }
}
