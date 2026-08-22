import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'

import { FleetGit, installGitTools, type FleetGitEvent } from '../src/git.js'

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
