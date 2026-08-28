import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

export interface FleetGitChange {
  readonly path: string
  readonly index: string
  readonly worktree: string
}

export interface FleetGitWorktree {
  readonly path: string
  readonly head: string
  readonly branch?: string
  readonly detached: boolean
}

export interface FleetGitBranch {
  readonly name: string
  readonly fullName: string
  readonly head: string
  readonly current: boolean
  readonly remote: boolean
  readonly upstream?: string
}

export interface FleetGitCommit {
  readonly hash: string
  readonly parents: readonly string[]
  readonly authorName: string
  readonly authorEmail: string
  readonly authoredAt: string
  readonly subject: string
  readonly decorations: readonly string[]
}

export interface FleetGitCommitFile {
  readonly path: string
  readonly oldPath?: string
  readonly status: string
  readonly additions?: number
  readonly deletions?: number
  readonly binary: boolean
}

export interface FleetGitCommitDetails extends FleetGitCommit {
  readonly committerName: string
  readonly committerEmail: string
  readonly committedAt: string
  readonly body: string
  readonly files: readonly FleetGitCommitFile[]
}

export interface FleetGitStash {
  readonly ref: string
  readonly hash: string
  readonly subject: string
}

export interface FleetGitDiff {
  readonly path?: string
  readonly staged: boolean
  readonly text: string
  readonly truncated: boolean
}

export interface FleetGitSnapshot {
  readonly status: FleetGitStatus
  readonly branches: readonly FleetGitBranch[]
  readonly commits: readonly FleetGitCommit[]
  readonly stashes?: readonly FleetGitStash[]
  readonly attributions?: Readonly<Record<string, string>>
}

export interface FleetGitFileDelta {
  readonly path: string
  readonly additions: number
  readonly deletions: number
  readonly binary: boolean
}

export interface FleetGitPeerLocation {
  readonly member: string
  readonly path: string
  readonly head: string
  readonly branch?: string
}

export interface FleetGitContext {
  readonly member: string
  readonly root: string
  readonly branch?: string
  readonly head?: string
  readonly upstream?: string
  readonly ahead: number
  readonly behind: number
  readonly changes: readonly FleetGitChange[]
  readonly peers: readonly FleetGitPeerLocation[]
  readonly recentCommits: readonly FleetGitCommit[]
}

export interface FleetGitComparison {
  readonly member: string
  readonly target: string
  readonly currentHead: string
  readonly targetHead: string
  readonly mergeBase: string
  /** Commits present on the caller's side but not the target's side. */
  readonly ahead: number
  /** Commits present on the target's side but not the caller's side. */
  readonly behind: number
  readonly currentCommits: readonly FleetGitCommit[]
  readonly targetCommits: readonly FleetGitCommit[]
  readonly currentFiles: readonly FleetGitFileDelta[]
  readonly targetFiles: readonly FleetGitFileDelta[]
}

export interface FleetGitConflictReport {
  readonly member: string
  readonly target: string
  readonly mergeBase: string
  readonly mergeable: boolean
  readonly overlappingPaths: readonly string[]
  readonly conflictingPaths: readonly string[]
}

export interface FleetGitHandoff {
  readonly from: string
  readonly to: string
  readonly branch?: string
  readonly head: string
  readonly base: string
  readonly dirty: boolean
  readonly uncommitted: readonly FleetGitChange[]
  readonly commits: readonly FleetGitCommit[]
  readonly files: readonly FleetGitFileDelta[]
  readonly notes?: string
  readonly tests?: string
}

export interface FleetGitStatus {
  readonly root: string
  readonly branch?: string
  readonly head?: string
  readonly changes: FleetGitChange[]
  readonly worktrees: FleetGitWorktree[]
}

export interface FleetGitWorkspace {
  readonly path: string
  readonly access: 'read' | 'write'
}

export interface FleetGitScope {
  readonly member: string
  readonly intent: 'read' | 'write'
  readonly projectRoot: string
  readonly repositoryRoot: string
  readonly workspaceRoot: string
  readonly cwd: string
  readonly branch?: string
  readonly boundBranch?: string
  readonly worktree?: string
  readonly paths: readonly string[]
}

export interface FleetGitEvent {
  readonly action: 'worktree_created'
  readonly member: string
  readonly path: string
  readonly branch: string
}

export class FleetGitNotRepositoryError extends Error {
  constructor(readonly path: string) {
    super(`Fleet workspace is not a Git repository: ${path}`)
    this.name = 'FleetGitNotRepositoryError'
  }
}

export interface FleetGitAuthorization {
  require(input: {
    readonly teamId: string
    readonly subject: { readonly kind: 'member'; readonly id: string }
    readonly action: string
    readonly resource: { readonly kind: 'git-repository'; readonly id: string }
  }): void
}

export interface FleetGitToolOptions {
  readonly teamId: string
  readonly member: string
  readonly hasMember: (member: string) => boolean
  readonly authorization: FleetGitAuthorization
  readonly permissions: ReadonlySet<string>
}

function git(cwd: string, args: readonly string[], allowFailure = false): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    if (allowFailure) return ''
    const failure = error as { readonly stderr?: string | Buffer; readonly message?: string }
    const detail = String(failure.stderr ?? failure.message ?? error).trim()
    throw new Error(detail.length === 0 ? `git ${args[0] ?? ''} failed` : detail)
  }
}

function gitOutput(cwd: string, args: readonly string[], maxBuffer = 8 * 1024 * 1024): string {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer,
    })
  } catch (error) {
    const failure = error as { readonly stderr?: string | Buffer; readonly message?: string }
    const detail = String(failure.stderr ?? failure.message ?? error).trim()
    throw new Error(detail.length === 0 ? `git ${args[0] ?? ''} failed` : detail)
  }
}

function gitBoundedOutput(cwd: string, args: readonly string[], maxBytes: number): { readonly output: string; readonly truncated: boolean } {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: maxBytes + 64 * 1024,
  })
  const output = typeof result.stdout === 'string' ? result.stdout : ''
  const encoded = Buffer.from(output)
  const overflow = result.error?.message.includes('ENOBUFS') === true || encoded.byteLength > maxBytes
  if (result.status !== 0 && !overflow) {
    const detail = String(result.stderr || result.error?.message || `git ${args[0] ?? ''} failed`).trim()
    throw new Error(detail)
  }
  return {
    output: overflow ? encoded.subarray(0, maxBytes).toString('utf8') : output,
    truncated: overflow,
  }
}

function gitSucceeds(cwd: string, args: readonly string[]): boolean {
  return spawnSync('git', ['-C', cwd, ...args], { stdio: 'ignore' }).status === 0
}

function reflogCreatesCommit(subject: string): boolean {
  if (/^commit(?: \([^)]*\))?:/u.test(subject)) return true
  if (/^(?:am|cherry-pick|revert):/u.test(subject)) return true
  if (/^rebase \((?:edit|fixup|pick|reword|squash)\):/u.test(subject)) return true
  return /^(?:merge|pull)(?: .*?)?:/u.test(subject) && !/Fast-forward/iu.test(subject)
}

function inside(root: string, path: string): boolean {
  const boundary = relative(root, path)
  return boundary === '' || (boundary !== '..' && !boundary.startsWith(`..${sep}`) && !isAbsolute(boundary))
}

function canonical(path: string): string {
  let cursor = resolve(path)
  const suffix: string[] = []
  while (!existsSync(cursor)) {
    const parent = dirname(cursor)
    if (parent === cursor) return resolve(path)
    suffix.unshift(basename(cursor))
    cursor = parent
  }
  return resolve(realpathSync.native(cursor), ...suffix)
}

function parseChanges(output: string): FleetGitChange[] {
  const records = output.split('\0').filter(Boolean)
  const changes: FleetGitChange[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] as string
    const status = record.slice(0, 2)
    changes.push({ path: record.slice(3), index: status[0] ?? ' ', worktree: status[1] ?? ' ' })
    if (status.includes('R') || status.includes('C')) index += 1
  }
  return changes
}

function parseWorktrees(output: string): FleetGitWorktree[] {
  return output.split('\n\n').filter(Boolean).map(block => {
    const fields = new Map(block.split('\n').map(line => {
      const boundary = line.indexOf(' ')
      return boundary < 0 ? [line, ''] : [line.slice(0, boundary), line.slice(boundary + 1)]
    }))
    const branch = fields.get('branch')?.replace(/^refs\/heads\//, '')
    return {
      path: canonical(fields.get('worktree') ?? ''),
      head: fields.get('HEAD') ?? '',
      ...(branch === undefined ? {} : { branch }),
      detached: fields.has('detached'),
    }
  })
}

function parseBranches(output: string, currentBranch: string | undefined): FleetGitBranch[] {
  return output.split('\n').filter(Boolean).map(record => {
    const [fullName = '', shortName = '', head = '', upstream = ''] = record.split('\0')
    return {
      name: shortName,
      fullName,
      head,
      current: shortName === currentBranch,
      remote: fullName.startsWith('refs/remotes/'),
      ...(upstream.length === 0 ? {} : { upstream }),
    }
  })
}

function parseCommits(output: string): FleetGitCommit[] {
  return output.split('\0').filter(Boolean).map(record => {
    const [hash = '', parents = '', authorName = '', authorEmail = '', authoredAt = '', decorations = '', subject = ''] = record.split('\x1f')
    return {
      hash,
      parents: parents.length === 0 ? [] : parents.split(' '),
      authorName,
      authorEmail,
      authoredAt,
      subject,
      decorations: decorations.length === 0
        ? []
        : decorations.split(', ').map(value => value.replace(/^HEAD -> /, '')).filter(Boolean),
    }
  })
}

function parseCountPair(output: string): { readonly ahead: number; readonly behind: number } {
  const [ahead = '0', behind = '0'] = output.trim().split(/\s+/u)
  return { ahead: Number(ahead), behind: Number(behind) }
}

function parseNumstat(output: string): FleetGitFileDelta[] {
  return output.split('\0').filter(Boolean).map(record => {
    const [added = '0', deleted = '0', ...pathParts] = record.split('\t')
    const binary = added === '-' || deleted === '-'
    return {
      path: pathParts.join('\t'),
      additions: binary ? 0 : Number(added),
      deletions: binary ? 0 : Number(deleted),
      binary,
    }
  })
}

function parseStashes(output: string): FleetGitStash[] {
  const fields = output.split('\0')
  const stashes: FleetGitStash[] = []
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const ref = fields[index] ?? ''
    const hash = fields[index + 1] ?? ''
    const subject = fields[index + 2] ?? ''
    if (ref.length > 0 && hash.length > 0) stashes.push({ ref, hash, subject })
  }
  return stashes
}

function parseCommitFiles(nameStatusOutput: string, numstatOutput: string): FleetGitCommitFile[] {
  const stats = new Map<string, { readonly additions?: number; readonly deletions?: number; readonly binary: boolean }>()
  const numstatRecords = numstatOutput.split('\0')
  for (let index = 0; index < numstatRecords.length; index += 1) {
    const record = numstatRecords[index] ?? ''
    if (record.length === 0) continue
    const [additionsValue = '', deletionsValue = '', recordPath = ''] = record.split('\t')
    let path = recordPath
    if (path.length === 0) {
      path = numstatRecords[index + 2] ?? ''
      index += 2
    }
    if (path.length === 0) continue
    const binary = additionsValue === '-' || deletionsValue === '-'
    stats.set(path, {
      ...(binary ? {} : { additions: Number(additionsValue), deletions: Number(deletionsValue) }),
      binary,
    })
  }

  const records = nameStatusOutput.split('\0')
  const files: FleetGitCommitFile[] = []
  for (let index = 0; index < records.length;) {
    const statusValue = records[index++] ?? ''
    if (statusValue.length === 0) continue
    const firstPath = records[index++] ?? ''
    const renamed = statusValue.startsWith('R') || statusValue.startsWith('C')
    const path = renamed ? records[index++] ?? '' : firstPath
    if (path.length === 0) continue
    const stat = stats.get(path)
    files.push({
      path,
      ...(renamed ? { oldPath: firstPath } : {}),
      status: statusValue[0] ?? statusValue,
      ...(stat?.additions === undefined ? {} : { additions: stat.additions }),
      ...(stat?.deletions === undefined ? {} : { deletions: stat.deletions }),
      binary: stat?.binary ?? false,
    })
  }
  return files
}

export class FleetGit {
  constructor(
    readonly projectRoot: string,
    private readonly onEvent: (event: FleetGitEvent) => void = () => {},
    private readonly namespace = 'team',
  ) {
    if (!/^[a-zA-Z0-9_-]+$/.test(namespace)) throw new Error(`invalid Fleet Git namespace ${namespace}`)
  }

  get root(): string {
    const root = git(this.projectRoot, ['rev-parse', '--show-toplevel'], true)
    if (root.length === 0) throw new FleetGitNotRepositoryError(this.projectRoot)
    return canonical(root)
  }

  private commonDirectory(cwd: string): string {
    const value = git(cwd, ['rev-parse', '--git-common-dir'])
    return canonical(isAbsolute(value) ? value : resolve(cwd, value))
  }

  scope(
    member: string,
    cwd: string,
    workspaces: readonly FleetGitWorkspace[],
    intent: 'read' | 'write' = 'read',
    paths: readonly string[] = [],
    requestedBranch?: string,
  ): FleetGitScope {
    const current = canonical(cwd)
    const repositoryRoot = canonical(git(current, ['rev-parse', '--show-toplevel']))
    if (this.commonDirectory(current) !== this.commonDirectory(this.root)) {
      throw new Error(`Git repository ${repositoryRoot} is outside Fleet project ${this.root}`)
    }

    const binding = this.worktree(member)
    const candidates: FleetGitWorkspace[] = [
      ...workspaces,
      ...(binding === undefined ? [] : [{ path: binding.path, access: 'write' as const }]),
    ]
      .filter(workspace => intent === 'read' || workspace.access === 'write')
      .map(workspace => ({ ...workspace, path: canonical(workspace.path) }))
    const workspace = candidates.find(candidate => inside(candidate.path, current))
    if (workspace === undefined) {
      throw new Error(`Git cwd ${current} is outside ${member}'s ${intent === 'write' ? 'writable ' : ''}Fleet workspaces`)
    }

    const branch = git(current, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true) || undefined
    if (intent === 'write' && requestedBranch !== undefined && branch !== requestedBranch) {
      throw new Error(`Git cwd is on branch ${branch ?? 'detached HEAD'}, not requested branch ${requestedBranch}`)
    }
    if (intent === 'write' && binding !== undefined) {
      const worktree = canonical(binding.path)
      if (!inside(worktree, current)) {
        throw new Error(`Fleet member ${member} is bound to worktree ${worktree}`)
      }
      if (binding.branch !== undefined && branch !== binding.branch) {
        throw new Error(`Fleet member ${member} is bound to branch ${binding.branch}, not ${branch ?? 'detached HEAD'}`)
      }
    }

    const checkedPaths = paths.map(path => {
      const target = canonical(isAbsolute(path) ? path : resolve(current, path))
      if (!inside(workspace.path, target) || !inside(repositoryRoot, target)) {
        throw new Error(`Git path is outside the checked Fleet scope: ${path}`)
      }
      return target
    })
    return {
      member,
      intent,
      projectRoot: canonical(this.projectRoot),
      repositoryRoot,
      workspaceRoot: workspace.path,
      cwd: current,
      ...(branch === undefined ? {} : { branch }),
      ...(binding?.branch === undefined ? {} : { boundBranch: binding.branch }),
      ...(binding === undefined ? {} : { worktree: canonical(binding.path) }),
      paths: checkedPaths,
    }
  }

  status(cwd = this.projectRoot): FleetGitStatus {
    const root = canonical(git(cwd, ['rev-parse', '--show-toplevel']))
    const branch = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true)
    const head = git(cwd, ['rev-parse', '--verify', 'HEAD'], true)
    return {
      root,
      ...(branch.length === 0 ? {} : { branch }),
      ...(head.length === 0 ? {} : { head }),
      changes: parseChanges(gitOutput(cwd, [
        'status', '--porcelain=v1', '-z', '--', `:(top,exclude).fleet/worktrees/${this.namespace}/**`,
      ])),
      worktrees: parseWorktrees(git(cwd, ['worktree', 'list', '--porcelain'])),
    }
  }

  branches(cwd = this.projectRoot): FleetGitBranch[] {
    const current = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true) || undefined
    return parseBranches(gitOutput(cwd, [
      'for-each-ref',
      '--sort=-committerdate',
      '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)',
      'refs/heads',
      'refs/remotes',
    ]), current)
  }

  log(cwd = this.projectRoot, limit = 200, additionalHeads: readonly string[] = []): FleetGitCommit[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Git log limit must be from 1 through 500')
    return parseCommits(gitOutput(cwd, [
      'log',
      '--all',
      ...additionalHeads,
      '--topo-order',
      '--date-order',
      `--max-count=${String(limit)}`,
      '-z',
      '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s',
    ]))
  }

  private logRange(cwd: string, range: string, limit = 20): FleetGitCommit[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Git comparison limit must be from 1 through 100')
    return parseCommits(gitOutput(cwd, [
      'log',
      '--topo-order',
      '--date-order',
      `--max-count=${String(limit)}`,
      '-z',
      '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s',
      range,
    ]))
  }

  private memberRef(member: string): string {
    const worktree = this.worktree(member)
    if (worktree !== undefined) return worktree.head
    const branch = `refs/heads/fleet/${this.namespace}/${member}`
    if (gitSucceeds(this.root, ['show-ref', '--verify', '--quiet', branch])) return branch
    throw new Error(`Fleet member ${member} has no Git worktree or branch`)
  }

  private fileDelta(base: string, head: string, cwd = this.projectRoot): FleetGitFileDelta[] {
    return parseNumstat(gitOutput(cwd, ['diff', '--numstat', '-z', '--no-renames', `${base}..${head}`]))
  }

  private memberWorktrees(): FleetGitPeerLocation[] {
    const parent = canonical(join(this.projectRoot, '.fleet', 'worktrees', this.namespace))
    return this.status().worktrees.flatMap(worktree => {
      const path = canonical(worktree.path)
      if (canonical(dirname(path)) !== parent) return []
      return [{
        member: basename(path),
        path,
        head: worktree.head,
        ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
      }]
    })
  }

  context(member: string, cwd = this.projectRoot, limit = 10): FleetGitContext {
    const status = this.status(cwd)
    const upstream = git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], true) || undefined
    const counts = upstream === undefined || status.head === undefined
      ? { ahead: 0, behind: 0 }
      : parseCountPair(git(cwd, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]))
    return {
      member,
      root: status.root,
      ...(status.branch === undefined ? {} : { branch: status.branch }),
      ...(status.head === undefined ? {} : { head: status.head }),
      ...(upstream === undefined ? {} : { upstream }),
      ...counts,
      changes: status.changes,
      peers: this.memberWorktrees().filter(peer => peer.member !== member),
      recentCommits: status.head === undefined ? [] : this.logRange(cwd, status.head, limit),
    }
  }

  compare(member: string, target: string, cwd = this.projectRoot, limit = 20): FleetGitComparison {
    const currentHead = git(cwd, ['rev-parse', '--verify', 'HEAD'])
    const targetHead = git(cwd, ['rev-parse', '--verify', this.memberRef(target)])
    const mergeBase = git(cwd, ['merge-base', currentHead, targetHead])
    const counts = parseCountPair(git(cwd, ['rev-list', '--left-right', '--count', `${currentHead}...${targetHead}`]))
    return {
      member,
      target,
      currentHead,
      targetHead,
      mergeBase,
      ...counts,
      currentCommits: this.logRange(cwd, `${mergeBase}..${currentHead}`, limit),
      targetCommits: this.logRange(cwd, `${mergeBase}..${targetHead}`, limit),
      currentFiles: this.fileDelta(mergeBase, currentHead, cwd),
      targetFiles: this.fileDelta(mergeBase, targetHead, cwd),
    }
  }

  conflicts(member: string, target: string, cwd = this.projectRoot): FleetGitConflictReport {
    const comparison = this.compare(member, target, cwd, 20)
    const currentPaths = new Set([
      ...comparison.currentFiles.map(file => file.path),
      ...this.status(cwd).changes.map(change => change.path),
    ])
    const targetPaths = new Set(comparison.targetFiles.map(file => file.path))
    const overlappingPaths = [...currentPaths].filter(path => targetPaths.has(path)).sort()
    const merged = spawnSync('git', ['-C', cwd, 'merge-tree', '--write-tree', comparison.currentHead, comparison.targetHead], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (merged.status !== 0 && merged.status !== 1) {
      throw new Error(String(merged.stderr || merged.error?.message || 'git merge-tree failed').trim())
    }
    const conflictingPaths = [...new Set(String(merged.stdout).split('\n').flatMap(line => {
      const match = /^\d{6} [0-9a-f]+ [123]\t(.+)$/u.exec(line)
      return match?.[1] === undefined ? [] : [match[1]]
    }))].sort()
    return {
      member,
      target,
      mergeBase: comparison.mergeBase,
      mergeable: merged.status === 0,
      overlappingPaths,
      conflictingPaths,
    }
  }

  handoff(
    member: string,
    target: string,
    cwd = this.projectRoot,
    input: { readonly notes?: string; readonly tests?: string; readonly limit?: number } = {},
  ): FleetGitHandoff {
    const comparison = this.compare(member, target, cwd, input.limit ?? 20)
    const status = this.status(cwd)
    return {
      from: member,
      to: target,
      ...(status.branch === undefined ? {} : { branch: status.branch }),
      head: comparison.currentHead,
      base: comparison.mergeBase,
      dirty: status.changes.length > 0,
      uncommitted: status.changes,
      commits: comparison.currentCommits,
      files: comparison.currentFiles,
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      ...(input.tests?.trim() ? { tests: input.tests.trim() } : {}),
    }
  }

  stashes(cwd = this.projectRoot): FleetGitStash[] {
    return parseStashes(gitOutput(cwd, ['stash', 'list', '--format=%gd%x00%H%x00%gs', '-z']))
  }

  commit(cwd = this.projectRoot, hash: string): FleetGitCommitDetails {
    if (!/^[0-9a-f]{7,64}$/iu.test(hash)) throw new Error('Git commit hash is invalid')
    const metadata = gitOutput(cwd, [
      'show', '-s', '--no-show-signature',
      '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%D%x1f%s%x1f%b',
      hash,
    ]).trimEnd()
    const [fullHash = '', parents = '', authorName = '', authorEmail = '', authoredAt = '', committerName = '', committerEmail = '', committedAt = '', decorations = '', subject = '', body = ''] = metadata.split('\x1f')
    const nameStatus = gitOutput(cwd, ['diff-tree', '--root', '--no-commit-id', '--name-status', '-z', '-r', '--find-renames', fullHash])
    const numstat = gitOutput(cwd, ['diff-tree', '--root', '--no-commit-id', '--numstat', '-z', '-r', '--find-renames', fullHash])
    return {
      hash: fullHash,
      parents: parents.length === 0 ? [] : parents.split(' '),
      authorName,
      authorEmail,
      authoredAt,
      committerName,
      committerEmail,
      committedAt,
      subject,
      body: body.trim(),
      decorations: decorations.length === 0
        ? []
        : decorations.split(', ').map(value => value.replace(/^HEAD -> /, '')).filter(Boolean),
      files: parseCommitFiles(nameStatus, numstat),
    }
  }

  diff(cwd = this.projectRoot, path?: string, staged = false, maxBytes = 512 * 1024): FleetGitDiff {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) {
      throw new Error('Git diff maxBytes must be from 1 through 8388608')
    }
    const args = ['diff', '--no-ext-diff', '--no-color']
    if (staged) args.push('--cached')
    if (path !== undefined && path.trim().length > 0) args.push('--', path)
    const output = gitBoundedOutput(cwd, args, maxBytes)
    return {
      ...(path === undefined ? {} : { path }),
      staged,
      text: output.output,
      truncated: output.truncated,
    }
  }

  snapshot(cwd = this.projectRoot, limit = 200): FleetGitSnapshot {
    void this.root
    const stashes = this.stashes(cwd)
    const commits = this.log(cwd, limit, stashes.map(stash => stash.hash)).map(commit => {
      const stashRefs = stashes.filter(stash => stash.hash === commit.hash).map(stash => stash.ref)
      if (stashRefs.length === 0) return commit
      return {
        ...commit,
        decorations: [...commit.decorations.filter(decoration => decoration !== 'refs/stash'), ...stashRefs],
      }
    })
    return { status: this.status(cwd), branches: this.branches(cwd), commits, stashes }
  }

  fetch(cwd = this.projectRoot): void {
    void this.root
    git(cwd, ['fetch', '--all', '--prune'])
  }

  reflogMarker(cwd: string): string | undefined {
    return git(cwd, ['reflog', 'show', '-n', '1', '--format=%H%x00%gs%x00%ct'], true) || undefined
  }

  attributedCommitsSinceReflog(cwd: string, marker: string | undefined): string[] {
    const commits: string[] = []
    const seen = new Set<string>()
    for (const record of git(cwd, ['reflog', 'show', '-n', '4096', '--format=%H%x00%gs%x00%ct'], true).split('\n')) {
      if (record.length === 0 || record === marker) break
      const [hash = '', subject = ''] = record.split('\0')
      if (hash.length === 0 || seen.has(hash) || !reflogCreatesCommit(subject)) continue
      seen.add(hash)
      commits.push(hash)
    }
    return commits.reverse()
  }

  worktree(member: string): FleetGitWorktree | undefined {
    const path = join(this.projectRoot, '.fleet', 'worktrees', this.namespace, member)
    return this.status().worktrees.find(worktree => canonical(worktree.path) === canonical(path))
  }

  createWorktree(member: string): FleetGitWorktree {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(member)) throw new Error('Fleet Git member must use lower-kebab-case')
    const branch = `fleet/${this.namespace}/${member}`
    const path = join(this.projectRoot, '.fleet', 'worktrees', this.namespace, member)
    const current = this.worktree(member)
    if (current !== undefined) return current
    const worktreeParent = canonical(dirname(path))
    if (!inside(canonical(this.projectRoot), worktreeParent)) {
      throw new Error(`Fleet Git worktree directory escapes the project root: ${worktreeParent}`)
    }
    mkdirSync(dirname(path), { recursive: true })
    const branchExists = gitSucceeds(this.root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    git(this.root, branchExists
      ? ['worktree', 'add', path, branch]
      : ['worktree', 'add', '-b', branch, path])
    const worktree = this.worktree(member)
      ?? { path, head: git(path, ['rev-parse', 'HEAD']), branch, detached: false }
    this.onEvent({ action: 'worktree_created', member, path: worktree.path, branch })
    return worktree
  }

}

const WORKTREE_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    path: { type: 'string', required: true }, head: { type: 'string', required: true }, branch: { type: 'string' }, detached: { type: 'boolean', required: true },
  },
} as const

const SCOPE_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    member: { type: 'string', required: true },
    intent: { type: 'string', required: true, enum: ['read', 'write'] },
    projectRoot: { type: 'string', required: true },
    repositoryRoot: { type: 'string', required: true },
    workspaceRoot: { type: 'string', required: true },
    cwd: { type: 'string', required: true },
    branch: { type: 'string' },
    boundBranch: { type: 'string' },
    worktree: { type: 'string' },
    paths: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['scope', 'check', 'context', 'compare', 'conflicts', 'handoff', 'create_worktree'] },
    scope: SCOPE_SCHEMA,
    data: { type: 'object', additionalProperties: true },
    worktree: WORKTREE_SCHEMA,
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

function commitOutput(commit: FleetGitCommit) {
  return { ...commit, parents: [...commit.parents], decorations: [...commit.decorations] }
}

function contextOutput(context: FleetGitContext) {
  return {
    ...context,
    changes: context.changes.map(change => ({ ...change })),
    peers: context.peers.map(peer => ({ ...peer })),
    recentCommits: context.recentCommits.map(commitOutput),
  }
}

function comparisonOutput(comparison: FleetGitComparison) {
  return {
    ...comparison,
    currentCommits: comparison.currentCommits.map(commitOutput),
    targetCommits: comparison.targetCommits.map(commitOutput),
    currentFiles: comparison.currentFiles.map(file => ({ ...file })),
    targetFiles: comparison.targetFiles.map(file => ({ ...file })),
  }
}

function handoffOutput(handoff: FleetGitHandoff) {
  return {
    ...handoff,
    uncommitted: handoff.uncommitted.map(change => ({ ...change })),
    commits: handoff.commits.map(commitOutput),
    files: handoff.files.map(file => ({ ...file })),
  }
}

export function installGitTools(ctx: Context, fleetGit: FleetGit, options: FleetGitToolOptions): () => void {
  const actions = [
    ...(options.permissions.has('git.inspect') ? ['scope' as const, 'context' as const, 'compare' as const, 'conflicts' as const, 'handoff' as const] : []),
    ...(options.permissions.has('git.scope-check') ? ['check' as const] : []),
    ...(options.permissions.has('git.worktree-create') ? ['create_worktree' as const] : []),
  ]
  if (actions.length === 0) return () => {}
  return ctx.tools.register(defineTool({
    name: 'fleet_git',
    description: 'Read team-aware Git context, compare with a peer, detect overlap or merge conflicts, prepare a handoff, check terminal Git scope, or create a member worktree. Ordinary Git commands still run in the terminal.',
    parameters: {
      action: { type: 'string', required: true, enum: actions },
      member: { type: 'string', description: 'Member id for worktree creation; defaults to the caller.' },
      target: { type: 'string', description: 'Peer member id required by compare, conflicts, and handoff.' },
      intent: { type: 'string', enum: ['read', 'write'], description: 'Proposed terminal operation intent; defaults to read.' },
      cwd: { type: 'string', description: 'Proposed Git working directory; defaults to the Agent session cwd.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Paths the proposed terminal operation will read or write.' },
      branch: { type: 'string', description: 'Branch the proposed terminal operation expects to modify.' },
      limit: { type: 'number', description: 'Maximum commits returned by context, compare, or handoff; defaults to 10 or 20 and cannot exceed 100.' },
      notes: { type: 'string', description: 'Optional concise handoff notes supplied by the caller.' },
      tests: { type: 'string', description: 'Optional test evidence supplied by the caller for a handoff.' },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = exec.agent as Agent | undefined
      if (agent === undefined) throw new Error('fleet_git requires a calling Agent')
      const caller = options.member
      const workspace = agent.session.header.cwd ?? fleetGit.projectRoot
      const repository = fleetGit.root
      const requireAction = (action: string): void => {
        options.authorization.require({
          teamId: options.teamId,
          subject: { kind: 'member', id: caller },
          action,
          resource: { kind: 'git-repository', id: repository },
        })
      }
      if (args.action === 'scope' || args.action === 'check') {
        requireAction(args.action === 'scope' ? 'git.inspect' : 'git.scope-check')
        const intent = args.intent ?? 'read'
        const cwd = args.cwd?.trim() || workspace
        const scope = fleetGit.scope(
          caller,
          cwd,
          [{ path: workspace, access: 'write' }],
          intent,
          args.paths ?? [],
          args.branch,
        )
        return Promise.resolve({ action: args.action, scope: { ...scope, paths: [...scope.paths] } })
      }
      if (args.action === 'context' || args.action === 'compare' || args.action === 'conflicts' || args.action === 'handoff') {
        requireAction('git.inspect')
        const cwd = args.cwd?.trim() || workspace
        fleetGit.scope(caller, cwd, [{ path: workspace, access: 'write' }], 'read')
        if (args.action === 'context') {
          return Promise.resolve({ action: 'context' as const, data: contextOutput(fleetGit.context(caller, cwd, args.limit ?? 10)) })
        }
        const target = args.target?.trim() ?? ''
        if (target.length === 0) throw new Error(`fleet_git ${args.action} requires target`)
        if (target === caller) throw new Error(`fleet_git ${args.action} target must be another member`)
        if (!options.hasMember(target)) throw new Error(`unknown Fleet member ${target}`)
        if (args.action === 'compare') {
          return Promise.resolve({ action: 'compare' as const, data: comparisonOutput(fleetGit.compare(caller, target, cwd, args.limit ?? 20)) })
        }
        if (args.action === 'conflicts') {
          const conflicts = fleetGit.conflicts(caller, target, cwd)
          return Promise.resolve({
            action: 'conflicts' as const,
            data: {
              ...conflicts,
              overlappingPaths: [...conflicts.overlappingPaths],
              conflictingPaths: [...conflicts.conflictingPaths],
            },
          })
        }
        const handoffInput = {
          ...(args.notes === undefined ? {} : { notes: args.notes }),
          ...(args.tests === undefined ? {} : { tests: args.tests }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
        }
        return Promise.resolve({
          action: 'handoff' as const,
          data: handoffOutput(fleetGit.handoff(caller, target, cwd, handoffInput)),
        })
      }
      requireAction('git.worktree-create')
      const member = args.member?.trim() || caller
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(member)) throw new Error('Fleet Git member must use lower-kebab-case')
      if (!options.hasMember(member)) throw new Error(`unknown Fleet member ${member}`)
      if (member !== caller) requireAction('git.worktree-manage')
      const sandbox = ctx.get('sandboxPolicy', false)
      const policy = sandbox?.resolve({ session: agent.session })
      if (policy?.mode === 'read-only') throw new Error('fleet_git create_worktree is unavailable in read-only sandbox mode')
      if (policy?.mode === 'workspace-write' && !inside(canonical(policy.workspaceRoot), canonical(workspace))) {
        throw new Error(`DSH Session workspace ${workspace} is outside the sandbox write root ${policy.workspaceRoot}`)
      }
      return Promise.resolve({ action: 'create_worktree' as const, worktree: fleetGit.createWorktree(member) })
    },
  }))
}
