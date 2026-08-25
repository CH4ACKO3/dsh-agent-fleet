import type { Context } from '@deepseek-ai/cordis'

import {
  callerSessionId,
  fleetCaller,
  record,
  requestQuery,
  service,
  type FleetRunsLike,
} from './fleet-context.js'
import type {
  FleetMemoryAlgorithm,
  FleetMemoryEffort,
} from './patchouli.js'

export const FLEET_GIT_CONTEXT_ALGORITHM_ID = 'fleet-git-context'

interface GitChange {
  readonly path: string
  readonly index: string
  readonly worktree: string
}

interface GitWorktree {
  readonly path: string
  readonly head: string
  readonly branch?: string
  readonly detached: boolean
}

interface GitBranch {
  readonly name: string
  readonly fullName: string
  readonly head: string
  readonly current: boolean
  readonly remote: boolean
  readonly upstream?: string
}

interface GitCommit {
  readonly hash: string
  readonly parents: readonly string[]
  readonly authorName: string
  readonly authorEmail: string
  readonly authoredAt: string
  readonly subject: string
  readonly decorations: readonly string[]
}

interface GitSnapshot {
  readonly status: {
    readonly root: string
    readonly branch?: string
    readonly head?: string
    readonly changes: readonly GitChange[]
    readonly worktrees: readonly GitWorktree[]
  }
  readonly branches: readonly GitBranch[]
  readonly commits: readonly GitCommit[]
  readonly stashes?: readonly { readonly ref: string; readonly hash: string; readonly subject: string }[]
  readonly attributions?: Readonly<Record<string, string>>
}

interface GitCommitDetails extends GitCommit {
  readonly committedAt: string
  readonly body: string
  readonly files: readonly {
    readonly path: string
    readonly oldPath?: string
    readonly status: string
    readonly additions?: number
    readonly deletions?: number
    readonly binary: boolean
  }[]
}

interface GitRecallActor {
  readonly teamId: string
  readonly subject: { readonly kind: 'member' | 'assistant'; readonly id: string }
  readonly sessionId: string
}

/** Optional Git-owned seam. Implementations must enforce git.inspect and scope to the caller Session workspace. */
interface FleetGitRecallService {
  snapshot(input: GitRecallActor & { readonly limit: number }, signal: AbortSignal): GitSnapshot | null | Promise<GitSnapshot | null>
  diff(input: GitRecallActor & { readonly path: string; readonly staged?: boolean }, signal: AbortSignal): { readonly path?: string; readonly staged: boolean; readonly text: string; readonly truncated: boolean } | Promise<{ readonly path?: string; readonly staged: boolean; readonly text: string; readonly truncated: boolean }>
  commit(input: GitRecallActor & { readonly hash: string }, signal: AbortSignal): GitCommitDetails | Promise<GitCommitDetails>
}

export type FleetGitContextItem =
  | {
    readonly kind: 'state'
    readonly source: { readonly kind: 'fleet-git'; readonly teamId: string; readonly root: string; readonly head?: string }
    readonly branch?: string
    readonly head?: string
    readonly changes: readonly GitChange[]
    readonly worktrees: readonly GitWorktree[]
  }
  | {
    readonly kind: 'branch'
    readonly source: { readonly kind: 'fleet-git'; readonly teamId: string; readonly root: string; readonly commit: string }
    readonly branch: GitBranch
  }
  | {
    readonly kind: 'commit'
    readonly source: { readonly kind: 'fleet-git'; readonly teamId: string; readonly root: string; readonly commit: string }
    readonly commit: GitCommit | GitCommitDetails
  }
  | {
    readonly kind: 'diff'
    readonly source: { readonly kind: 'fleet-git'; readonly teamId: string; readonly root: string; readonly path: string }
    readonly path: string
    readonly staged: boolean
    readonly snippet: string
    readonly truncated: boolean
  }

function resultLimit(value: unknown, effort: FleetMemoryEffort): number {
  const maximum = effort === 'medium' ? 30 : 60
  const fallback = effort === 'medium' ? 15 : 30
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback
}

function contains(value: string | undefined, query: string): boolean {
  return value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()) === true
}

const GIT_INTENT = /(?:\bgit\b|\brepo(?:sitory)?\b|\bcommit\b|\bbranch\b|\bdiff\b|\bstaged?\b|\bworktree\b|仓库|提交|分支|差异|暂存|工作树)/iu

function commitMatches(commit: GitCommit, query: string): boolean {
  return [commit.hash, commit.authorName, commit.authorEmail, commit.subject, ...commit.decorations]
    .some(value => contains(value, query))
}

function boundedSnippet(text: string, query: string, effort: FleetMemoryEffort): string {
  const maximum = effort === 'medium' ? 600 : 1_500
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  const start = Math.max(0, index < 0 ? 0 : index - Math.floor(maximum / 3))
  const value = text.slice(start, start + maximum)
  return `${start > 0 ? '…' : ''}${value}${start + value.length < text.length ? '…' : ''}`
}

export function createFleetGitContextAlgorithm(
  ctx: Context,
  runs: FleetRunsLike,
): FleetMemoryAlgorithm {
  return {
    id: FLEET_GIT_CONTEXT_ALGORITHM_ID,
    minimumEffort: 'medium',
    filter: call => {
      const sessionId = callerSessionId(call)
      return service<FleetGitRecallService>(ctx, 'fleetGitRecall') !== undefined
        && sessionId !== undefined
        && fleetCaller(runs, sessionId) !== undefined
    },
    async retrieve(request, context) {
      context.signal?.throwIfAborted()
      const sessionId = callerSessionId({ operation: 'retrieve', meta: request.meta })
      const query = requestQuery(request)
      const git = service<FleetGitRecallService>(ctx, 'fleetGitRecall')
      if (sessionId === undefined || query === undefined || git === undefined) {
        return { handled: false, items: [] }
      }
      const caller = fleetCaller(runs, sessionId)
      if (caller === undefined) return { handled: false, items: [] }

      const signal = context.signal ?? new AbortController().signal
      const limit = resultLimit(record(request.data)?.limit, context.effort)
      const actor: GitRecallActor = {
        teamId: caller.team.id,
        subject: { kind: caller.kind, id: caller.participant },
        sessionId,
      }
      let snapshot: GitSnapshot | null
      try {
        snapshot = await git.snapshot({
          ...actor,
          limit: context.effort === 'medium' ? 50 : 200,
        }, signal)
      } catch {
        signal.throwIfAborted()
        return { handled: false, items: [] }
      }
      if (snapshot === null) return { handled: false, items: [] }

      const root = snapshot.status.root
      const gitIntent = GIT_INTENT.test(query)
      const matchingChanges = snapshot.status.changes.filter(change => contains(change.path, query))
      const matchingBranches = snapshot.branches.filter(branch =>
        [branch.name, branch.fullName, branch.head, branch.upstream].some(value => contains(value, query)))
      const matchingCommits = snapshot.commits.filter(commit => commitMatches(commit, query))
      const items: FleetGitContextItem[] = []
      if (gitIntent || matchingChanges.length > 0) {
        items.push({
          kind: 'state',
          source: {
            kind: 'fleet-git',
            teamId: caller.team.id,
            root,
            ...(snapshot.status.head === undefined ? {} : { head: snapshot.status.head }),
          },
          ...(snapshot.status.branch === undefined ? {} : { branch: snapshot.status.branch }),
          ...(snapshot.status.head === undefined ? {} : { head: snapshot.status.head }),
          changes: snapshot.status.changes.slice(0, context.effort === 'medium' ? 20 : 50),
          worktrees: snapshot.status.worktrees.slice(0, context.effort === 'medium' ? 10 : 25),
        })
      }
      for (const branch of matchingBranches) {
        if (items.length >= limit) break
        items.push({
          kind: 'branch',
          source: { kind: 'fleet-git', teamId: caller.team.id, root, commit: branch.head },
          branch,
        })
      }

      const detailBudget = context.effort === 'medium' ? 5 : 15
      for (const commit of matchingCommits.slice(0, detailBudget)) {
        if (items.length >= limit) break
        let details: GitCommitDetails
        try {
          details = await git.commit({ ...actor, hash: commit.hash }, signal)
        } catch {
          signal.throwIfAborted()
          continue
        }
        items.push({
          kind: 'commit',
          source: { kind: 'fleet-git', teamId: caller.team.id, root, commit: commit.hash },
          commit: details,
        })
      }

      const diffBudget = context.effort === 'medium' ? 5 : 15
      for (const change of matchingChanges.slice(0, diffBudget)) {
        if (items.length >= limit) break
        const staged = change.index !== ' ' && change.index !== '?'
        let diff: Awaited<ReturnType<FleetGitRecallService['diff']>>
        try {
          diff = await git.diff({ ...actor, path: change.path, staged }, signal)
        } catch {
          signal.throwIfAborted()
          continue
        }
        items.push({
          kind: 'diff',
          source: { kind: 'fleet-git', teamId: caller.team.id, root, path: change.path },
          path: change.path,
          staged: diff.staged,
          snippet: boundedSnippet(diff.text, query, context.effort),
          truncated: diff.truncated || diff.text.length > (context.effort === 'medium' ? 600 : 1_500),
        })
      }

      if (items.length === 0) return { handled: false, items: [] }
      context.deferRecallAudit?.({
        teamId: caller.team.id,
        member: caller.participant,
        resultCount: items.length,
      })
      return {
        handled: true,
        teamId: caller.team.id,
        participant: caller.participant,
        effort: context.effort,
        count: items.length,
        items: items.slice(0, limit),
      }
    },
  }
}
