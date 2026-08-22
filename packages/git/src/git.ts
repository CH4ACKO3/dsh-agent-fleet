import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
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
  return resolve(realpathSync(cursor), ...suffix)
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
      path: fields.get('worktree') ?? '',
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
    if (root.length === 0) throw new Error(`Fleet project is not inside a Git repository: ${this.projectRoot}`)
    return root
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
    const root = git(cwd, ['rev-parse', '--show-toplevel'])
    const branch = git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true)
    const head = git(cwd, ['rev-parse', '--verify', 'HEAD'], true)
    return {
      root,
      ...(branch.length === 0 ? {} : { branch }),
      ...(head.length === 0 ? {} : { head }),
      changes: parseChanges(gitOutput(cwd, ['status', '--porcelain=v1', '-z'])),
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

  log(cwd = this.projectRoot, limit = 200): FleetGitCommit[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Git log limit must be from 1 through 500')
    return parseCommits(gitOutput(cwd, [
      'log',
      '--all',
      '--topo-order',
      '--date-order',
      `--max-count=${String(limit)}`,
      '-z',
      '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s',
    ]))
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
    return { status: this.status(cwd), branches: this.branches(cwd), commits: this.log(cwd, limit) }
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
    action: { type: 'string', required: true, enum: ['scope', 'check', 'create_worktree'] },
    scope: SCOPE_SCHEMA,
    worktree: WORKTREE_SCHEMA,
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

export function installGitTools(ctx: Context, fleetGit: FleetGit, options: {
  readonly memberFor: (agentId: string) => string | undefined
  readonly hasMember: (member: string) => boolean
  readonly hasPermission: (agentId: string, permission: string) => boolean
  readonly workspaceFor: (agentId: string) => string | undefined
  readonly permissions: ReadonlySet<string>
}): () => void {
  const actions = [
    ...(options.permissions.has('git.inspect') ? ['scope' as const] : []),
    ...(options.permissions.has('git.scope-check') ? ['check' as const] : []),
    ...(options.permissions.has('git.worktree-create') ? ['create_worktree' as const] : []),
  ]
  if (actions.length === 0) return () => {}
  return ctx.tools.register(defineTool({
    name: 'fleet_git',
    description: 'Inspect or check the permitted Git operation scope and create an isolated member worktree. Run ordinary Git commands with the terminal after checking scope.',
    parameters: {
      action: { type: 'string', required: true, enum: actions },
      member: { type: 'string', description: 'Member id for worktree creation; defaults to the caller.' },
      intent: { type: 'string', enum: ['read', 'write'], description: 'Proposed terminal operation intent; defaults to read.' },
      cwd: { type: 'string', description: 'Proposed Git working directory; defaults to the Agent session cwd.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Paths the proposed terminal operation will read or write.' },
      branch: { type: 'string', description: 'Branch the proposed terminal operation expects to modify.' },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = exec.agent as Agent | undefined
      if (agent === undefined) throw new Error('fleet_git requires a calling Agent')
      const agentId = String(agent.id)
      const caller = options.memberFor(agentId)
      if (caller === undefined) throw new Error(`Agent ${String(agent.id)} is not a Fleet member`)
      if (args.action === 'scope' || args.action === 'check') {
        const permission = args.action === 'scope' ? 'git.inspect' : 'git.scope-check'
        const allowed = options.hasPermission(agentId, permission)
        if (!allowed) throw new Error(`Fleet member ${caller} lacks Fleet permission ${permission}`)
        const intent = args.intent ?? 'read'
        const cwd = args.cwd?.trim() || agent.session.header.cwd
        if (cwd === undefined) throw new Error('fleet_git scope checking requires a working directory')
        const workspace = options.workspaceFor(agentId) ?? agent.session.header.cwd
        if (workspace === undefined) throw new Error('fleet_git scope checking requires a Fleet workspace')
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
      if (!options.hasPermission(agentId, 'git.worktree-create')) {
        throw new Error(`Fleet member ${caller} lacks Fleet permission git.worktree-create`)
      }
      const member = args.member?.trim() || caller
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(member)) throw new Error('Fleet Git member must use lower-kebab-case')
      if (!options.hasMember(member)) throw new Error(`unknown Fleet member ${member}`)
      if (member !== caller && !options.hasPermission(agentId, 'git.worktree-manage')) {
        throw new Error(`Fleet member ${caller} lacks Fleet permission git.worktree-manage`)
      }
      return Promise.resolve({ action: 'create_worktree' as const, worktree: fleetGit.createWorktree(member) })
    },
  }))
}
