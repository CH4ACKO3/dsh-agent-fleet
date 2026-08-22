import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

import { FleetGit, installGitTools, type FleetGitEvent } from '../src/git.js'
import { FleetGitAttributionStore, installGitTerminalPolicy } from '../src/index.js'
import { terminalGitCommands, terminalGitPolicy } from '../src/terminal.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'fleet-git-'))
  roots.push(root)
  execFileSync('git', ['init', '-q', root])
  return root
}

function commit(root: string, message: string, paths: readonly string[]): void {
  execFileSync('git', ['-C', root, 'add', '--', ...paths])
  execFileSync('git', [
    '-C', root,
    '-c', 'user.name=Fleet Test',
    '-c', 'user.email=fleet@example.com',
    'commit', '-qm', message,
  ])
}

describe('FleetGit', () => {
  it('attributes commits from successful member terminal calls and persists the local hash map', async () => {
    const root = repository()
    const states = new Map<string, unknown>()
    const runs = {
      readExtensionState: (teamId: string, namespace: string) => states.get(`${teamId}:${namespace}`),
      writeExtensionState: (teamId: string, namespace: string, value: unknown) => { states.set(`${teamId}:${namespace}`, value) },
    }
    const store = new FleetGitAttributionStore(runs as never)
    const actions: string[] = []
    let listener: ((exec: never, next: () => Promise<never>) => Promise<never>) | undefined
    const context = {
      fleetAuthorization: {
        actorForAgent: () => ({ teamId: 'team-1', subject: { kind: 'member', id: 'builder' } }),
        require: (input: { readonly action: string }) => { actions.push(input.action) },
      },
      fleetRuns: { status: () => ({ projectRoot: root }) },
      on: (_event: string, callback: typeof listener) => { listener = callback; return () => {} },
    } as unknown as Context
    installGitTerminalPolicy(context, store)
    writeFileSync(join(root, 'README.md'), '# Fleet\n')

    await listener?.({
      name: 'bash',
      arguments: { command: 'git add README.md && git commit -m "Initialize"' },
      agent: { id: 'agent-1', session: { header: { cwd: root } } },
    } as never, async () => {
      commit(root, 'Initialize', ['README.md'])
      return { isError: false, value: null, content: [] } as never
    })

    const hash = new FleetGit(root).status().head as string
    expect(actions).toEqual(['git.scope-check', 'git.scope-check'])
    expect(store.select('team-1', [hash])).toEqual({ [hash]: 'builder' })
    expect(new FleetGitAttributionStore(runs as never).select('team-1', [hash])).toEqual({ [hash]: 'builder' })
  })

  it('attributes common rewritten and merged commits without claiming fast-forwarded history', async () => {
    const root = repository()
    writeFileSync(join(root, 'README.md'), '# Fleet\n')
    commit(root, 'Initialize', ['README.md'])
    const main = execFileSync('git', ['-C', root, 'branch', '--show-current'], { encoding: 'utf8' }).trim()
    const states = new Map<string, unknown>()
    const store = new FleetGitAttributionStore({
      readExtensionState: (teamId: string, namespace: string) => states.get(`${teamId}:${namespace}`),
      writeExtensionState: (teamId: string, namespace: string, value: unknown) => { states.set(`${teamId}:${namespace}`, value) },
    } as never)
    let listener: ((exec: never, next: () => Promise<never>) => Promise<never>) | undefined
    const context = {
      fleetAuthorization: {
        actorForAgent: () => ({ teamId: 'team-1', subject: { kind: 'member', id: 'builder' } }),
        require: () => {},
      },
      fleetRuns: { status: () => ({ projectRoot: root }) },
      on: (_event: string, callback: typeof listener) => { listener = callback; return () => {} },
    } as unknown as Context
    installGitTerminalPolicy(context, store)
    const run = async (command: string, operation: () => void): Promise<void> => {
      await listener?.({
        name: 'bash', arguments: { command },
        agent: { id: 'agent-1', session: { header: { cwd: root } } },
      } as never, async () => {
        operation()
        return { isError: false, value: null, content: [] } as never
      })
    }

    execFileSync('git', ['-C', root, 'checkout', '-qb', 'fast-forward'])
    writeFileSync(join(root, 'fast-forward.txt'), 'upstream\n')
    commit(root, 'Upstream', ['fast-forward.txt'])
    const upstream = new FleetGit(root).status().head as string
    execFileSync('git', ['-C', root, 'checkout', '-q', main])
    await run('git merge --ff-only fast-forward', () => {
      execFileSync('git', ['-C', root, 'merge', '--ff-only', 'fast-forward'])
    })
    expect(store.select('team-1', [upstream])).toEqual({})

    execFileSync('git', ['-C', root, 'checkout', '-qb', 'topic'])
    writeFileSync(join(root, 'topic.txt'), 'topic\n')
    commit(root, 'Topic', ['topic.txt'])
    const topic = new FleetGit(root).status().head as string
    execFileSync('git', ['-C', root, 'checkout', '-q', main])
    writeFileSync(join(root, 'main.txt'), 'main\n')
    commit(root, 'Main', ['main.txt'])
    await run('git merge --no-ff topic -m "Merge topic"', () => {
      execFileSync('git', ['-C', root, '-c', 'user.name=Fleet Test', '-c', 'user.email=fleet@example.com', 'merge', '--no-ff', '-m', 'Merge topic', 'topic'])
    })
    const merge = new FleetGit(root).status().head as string
    expect(store.select('team-1', [topic, merge])).toEqual({ [merge]: 'builder' })

    execFileSync('git', ['-C', root, 'checkout', '-qb', 'to-pick'])
    writeFileSync(join(root, 'pick.txt'), 'pick\n')
    commit(root, 'Pick me', ['pick.txt'])
    const source = new FleetGit(root).status().head as string
    execFileSync('git', ['-C', root, 'checkout', '-q', main])
    await run(`git cherry-pick ${source}`, () => {
      execFileSync('git', ['-C', root, '-c', 'user.name=Fleet Test', '-c', 'user.email=fleet@example.com', 'cherry-pick', source])
    })
    const picked = new FleetGit(root).status().head as string
    expect(store.select('team-1', [source, picked])).toEqual({ [picked]: 'builder' })

    execFileSync('git', ['-C', root, 'checkout', '-qb', 'to-rebase'])
    writeFileSync(join(root, 'rebase.txt'), 'rebase\n')
    commit(root, 'Rebase me', ['rebase.txt'])
    const original = new FleetGit(root).status().head as string
    execFileSync('git', ['-C', root, 'checkout', '-q', main])
    writeFileSync(join(root, 'base.txt'), 'base\n')
    commit(root, 'Advance base', ['base.txt'])
    execFileSync('git', ['-C', root, 'checkout', '-q', 'to-rebase'])
    await run(`git rebase ${main}`, () => {
      execFileSync('git', ['-C', root, '-c', 'user.name=Fleet Test', '-c', 'user.email=fleet@example.com', 'rebase', main])
    })
    const rebased = new FleetGit(root).status().head as string
    expect(rebased).not.toBe(original)
    expect(store.select('team-1', [original, rebased])).toEqual({ [rebased]: 'builder' })
  })

  it('classifies ordinary terminal Git without changing the command interface', () => {
    const parse = (command: string) => terminalGitCommands({
      name: 'bash', arguments: { command },
      agent: { id: 'agent-1', session: { header: { cwd: '/workspace' } } },
    } as never).map(terminalGitPolicy)

    expect(parse('git status')[0]).toMatchObject({ actions: ['git.inspect'], intent: 'read' })
    expect(parse('git commit -m "safe; message"')[0]).toMatchObject({ actions: ['git.scope-check'], intent: 'write' })
    expect(parse('git commit --amend --no-edit')[0]?.actions).toEqual(['git.scope-check', 'git.history-rewrite'])
    expect(parse('git push origin HEAD')[0]?.actions).toEqual(['git.scope-check', 'git.publish'])
    expect(parse('git push --force origin HEAD')[0]?.actions).toEqual(['git.scope-check', 'git.publish', 'git.history-rewrite'])
    expect(parse('git remote set-url origin example.invalid/repo.git')[0]?.actions).toEqual(['git.scope-check', 'git.repository-manage'])
    expect(parse('git worktree add /tmp/review main')[0]?.directWorktreeMutation).toBe(true)
  })

  it('blocks denied terminal Git before execution and keeps pushes on the scoped branch', async () => {
    const root = repository()
    writeFileSync(join(root, 'README.md'), '# Fleet\n')
    commit(root, 'Initialize', ['README.md'])
    const branch = new FleetGit(root).status().branch as string
    let listener: ((exec: never, next: () => Promise<never>) => Promise<never>) | undefined
    let executed = false
    const denied: string[] = []
    const context = {
      fleetAuthorization: {
        actorForAgent: () => ({ teamId: 'team-1', subject: { kind: 'member', id: 'builder' } }),
        require: (input: { readonly action: string }) => {
          if (input.action === 'git.publish') {
            denied.push(input.action)
            throw new Error('publish denied')
          }
        },
      },
      fleetRuns: { status: () => ({ projectRoot: root }) },
      on: (_event: string, callback: typeof listener) => { listener = callback; return () => {} },
    } as unknown as Context
    installGitTerminalPolicy(context, new FleetGitAttributionStore({
      readExtensionState: () => undefined,
      writeExtensionState: () => {},
    } as never))
    const next = async () => {
      executed = true
      return { isError: false, value: null, content: [] } as never
    }

    await expect(listener?.({
      name: 'bash', arguments: { command: `git push origin ${branch}` },
      agent: { id: 'agent-1', session: { header: { cwd: root } } },
    } as never, next)).rejects.toThrow('publish denied')
    expect(executed).toBe(false)
    expect(denied).toEqual(['git.publish'])

    context.fleetAuthorization.require = () => {}
    await expect(listener?.({
      name: 'bash', arguments: { command: 'git push origin other:other' },
      agent: { id: 'agent-1', session: { header: { cwd: root } } },
    } as never, next)).rejects.toThrow(`outside branch ${branch}`)
    expect(executed).toBe(false)
  })

  it('does not expose fleet_git without an explicit Git action', () => {
    const root = repository()
    const registered: unknown[] = []
    installGitTools({
      tools: { register: (tool: unknown) => { registered.push(tool); return () => {} } },
    } as unknown as Context, new FleetGit(root), {
      teamId: 'team-1', member: 'reviewer', hasMember: () => true,
      authorization: { require: () => {} }, permissions: new Set(),
    })

    expect(registered).toEqual([])
  })

  it('exposes only the actions granted to that Fleet member', () => {
    const root = repository()
    const registered: Array<{ readonly parameters: { readonly properties: Record<string, { readonly enum?: readonly string[] }> } }> = []
    installGitTools({
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} } },
    } as unknown as Context, new FleetGit(root), {
      teamId: 'team-1', member: 'reviewer', hasMember: () => true,
      authorization: { require: () => {} },
      permissions: new Set(['git.inspect', 'git.scope-check']),
    })

    expect(registered[0]?.parameters.properties.action?.enum).toEqual(['scope', 'check'])
  })

  it('rechecks Fleet authorization at execution time', async () => {
    const root = repository()
    let inspect = false
    let execute: ((args: { readonly action: 'scope' }, exec: { readonly agent: unknown }) => Promise<unknown>) | undefined
    installGitTools({
      tools: { register: (tool: unknown) => {
        execute = (tool as { readonly execute: typeof execute }).execute
        return () => {}
      } },
    } as unknown as Context, new FleetGit(root), {
      teamId: 'team-1', member: 'reviewer', hasMember: () => true,
      authorization: { require: input => {
        if (!inspect || input.action !== 'git.inspect') throw new Error(`denied ${input.action}`)
      } },
      permissions: new Set(['git.inspect']),
    })
    const caller = { agent: { id: 'agent-1', session: { header: { cwd: root } } } }

    await expect(execute?.({ action: 'scope' }, caller)).rejects.toThrow('denied git.inspect')
    inspect = true
    await expect(execute?.({ action: 'scope' }, caller)).resolves.toMatchObject({ action: 'scope' })
  })

  it('keeps worktree mutation behind the native DSH sandbox policy', async () => {
    const root = repository()
    let execute: ((args: { readonly action: 'create_worktree' }, exec: { readonly agent: unknown }) => Promise<unknown>) | undefined
    installGitTools({
      get: () => ({ resolve: () => ({ mode: 'read-only', workspaceRoot: root }) }),
      tools: { register: (tool: unknown) => {
        execute = (tool as { readonly execute: typeof execute }).execute
        return () => {}
      } },
    } as unknown as Context, new FleetGit(root), {
      teamId: 'team-1', member: 'reviewer', hasMember: () => true,
      authorization: { require: () => {} }, permissions: new Set(['git.worktree-create']),
    })

    await expect(execute?.({ action: 'create_worktree' }, {
      agent: { id: 'agent-1', session: { header: { cwd: root } } },
    })).rejects.toThrow('read-only sandbox mode')
  })

  it('reports changes and creates idempotent member worktrees', () => {
    const root = repository()
    const events: FleetGitEvent[] = []
    const fleetGit = new FleetGit(root, event => { events.push(event) })
    writeFileSync(join(root, 'README.md'), '# Fleet\n')

    expect(fleetGit.status().changes).toContainEqual(expect.objectContaining({ path: 'README.md' }))
    commit(root, 'Initialize Fleet project', ['README.md'])

    const worktree = fleetGit.createWorktree('reviewer')
    expect(worktree).toMatchObject({ branch: 'fleet/team/reviewer', detached: false })
    expect(fleetGit.worktree('reviewer')).toMatchObject({ path: worktree.path })
    expect(fleetGit.createWorktree('reviewer')).toEqual(worktree)
    expect(events).toEqual([{ action: 'worktree_created', member: 'reviewer', path: worktree.path, branch: 'fleet/team/reviewer' }])
  })

  it('projects branches, bounded history, and staged or working-tree diffs', () => {
    const root = repository()
    const fleetGit = new FleetGit(root)
    writeFileSync(join(root, 'README.md'), '# Fleet\n')
    commit(root, 'Initialize Fleet project', ['README.md'])
    writeFileSync(join(root, 'README.md'), '# Fleet\n\nWorking tree\n')

    const snapshot = fleetGit.snapshot(root, 10)
    expect(snapshot.commits).toHaveLength(1)
    expect(snapshot.commits[0]).toMatchObject({ subject: 'Initialize Fleet project', parents: [] })
    expect(fleetGit.commit(root, snapshot.commits[0]?.hash ?? '')).toMatchObject({
      subject: 'Initialize Fleet project',
      files: [{ path: 'README.md', status: 'A', additions: 1, deletions: 0, binary: false }],
    })
    expect(snapshot.branches).toContainEqual(expect.objectContaining({ current: true, remote: false }))
    expect(snapshot.status.changes).toContainEqual(expect.objectContaining({ path: 'README.md', index: ' ', worktree: 'M' }))
    expect(fleetGit.diff(root, 'README.md')).toMatchObject({ path: 'README.md', staged: false, truncated: false })
    expect(fleetGit.diff(root, 'README.md').text).toContain('+Working tree')
    expect(fleetGit.diff(root, 'README.md', false, 24)).toMatchObject({ truncated: true })

    execFileSync('git', ['-C', root, 'add', 'README.md'])
    expect(fleetGit.diff(root, 'README.md', true).text).toContain('+Working tree')
    expect(fleetGit.diff(root, 'README.md').text).toBe('')
  })

  it('projects every stash as a labeled graph commit', () => {
    const root = repository()
    const fleetGit = new FleetGit(root)
    writeFileSync(join(root, 'README.md'), '# Fleet\n')
    commit(root, 'Initialize Fleet project', ['README.md'])
    writeFileSync(join(root, 'README.md'), '# Fleet\n\nFirst stash\n')
    execFileSync('git', ['-C', root, 'stash', 'push', '-qm', 'first'])
    writeFileSync(join(root, 'README.md'), '# Fleet\n\nSecond stash\n')
    execFileSync('git', ['-C', root, 'stash', 'push', '-qm', 'second'])

    const snapshot = fleetGit.snapshot(root, 20)
    expect(snapshot.stashes?.map(stash => stash.ref)).toEqual(['stash@{0}', 'stash@{1}'])
    for (const stash of snapshot.stashes ?? []) {
      expect(snapshot.commits.find(item => item.hash === stash.hash)?.decorations).toContain(stash.ref)
    }
  })

  it('checks repository, workspace, branch, and path scope before terminal Git operations', () => {
    const root = repository()
    const fleetGit = new FleetGit(root)
    const canonicalRoot = realpathSync(root)
    writeFileSync(join(root, 'README.md'), '# Fleet\n')
    commit(root, 'Initialize Fleet project', ['README.md'])
    const branch = fleetGit.status().branch as string

    expect(fleetGit.scope('reviewer', root, [{ path: root, access: 'write' }], 'write', ['README.md'], branch)).toMatchObject({
      member: 'reviewer', intent: 'write', repositoryRoot: canonicalRoot, workspaceRoot: canonicalRoot, branch,
    })
    expect(() => fleetGit.scope('reviewer', root, [{ path: root, access: 'write' }], 'write', ['../outside']))
      .toThrow('outside the checked Fleet scope')
    expect(() => fleetGit.scope('reviewer', root, [{ path: root, access: 'read' }], 'write'))
      .toThrow('outside reviewer\'s writable Fleet workspaces')
    expect(() => fleetGit.scope('reviewer', root, [{ path: root, access: 'write' }], 'write', [], 'other'))
      .toThrow('not requested branch other')
  })

  it('binds writes to a created member worktree while retaining read access to the main workspace', () => {
    const root = repository()
    const fleetGit = new FleetGit(root)
    const canonicalRoot = realpathSync(root)
    writeFileSync(join(root, 'README.md'), '# Fleet\n')
    commit(root, 'Initialize Fleet project', ['README.md'])
    const worktree = fleetGit.createWorktree('reviewer')
    const workspaces = [{ path: root, access: 'write' as const }]

    expect(() => fleetGit.scope('reviewer', root, workspaces, 'write')).toThrow('is bound to worktree')
    expect(fleetGit.scope('reviewer', root, workspaces, 'read')).toMatchObject({ cwd: canonicalRoot })
    expect(fleetGit.scope('reviewer', worktree.path, workspaces, 'write')).toMatchObject({
      cwd: realpathSync(worktree.path),
      worktree: realpathSync(worktree.path),
      boundBranch: 'fleet/team/reviewer',
      branch: 'fleet/team/reviewer',
    })
  })
})
