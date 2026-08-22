import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { FleetAccessService } from 'dsh-agent-fleet'

import { FLEET_GIT_WEB_REMOTE } from '../src/contract.js'
import { FLEET_GIT_PERMISSIONS, FleetGitIntegration, FleetGitWebRemote, apply } from '../src/index.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'fleet-git-web-'))
  roots.push(root)
  execFileSync('git', ['init', '-q', root])
  writeFileSync(join(root, 'README.md'), '# Fleet\n')
  execFileSync('git', ['-C', root, '-c', 'user.name=Fleet', '-c', 'user.email=fleet@example.com', 'add', 'README.md'])
  execFileSync('git', ['-C', root, '-c', 'user.name=Fleet', '-c', 'user.email=fleet@example.com', 'commit', '-qm', 'Initial commit'])
  return root
}

describe('FleetGitWebRemote', () => {
  it('publishes the Git capability namespace used by dynamic permission groups', () => {
    expect(FLEET_GIT_PERMISSIONS.map(permission => permission.id)).toEqual([
      'inspect', 'scope-check', 'worktree-create', 'worktree-manage',
    ])
  })

  it('registers that namespace with native Fleet access alone', async () => {
    const ctx = new Context()
    const access = new FleetAccessService()
    apply(ctx)
    ctx.provide('fleetAccess', access)
    await Promise.resolve()
    expect(access.permissionIds()).toEqual([
      'git.inspect', 'git.scope-check', 'git.worktree-create', 'git.worktree-manage',
    ])
  })

  it('supplies fleet_git only through the optional integration provider', () => {
    const root = repository()
    const registered: Array<{ readonly name: string }> = []
    const runtime = new FleetGitIntegration().open({
      teamId: 'team-1',
      projectRoot: root,
      onEvent: () => {},
    })
    runtime.installTools({
      tools: { register: (tool: { readonly name: string }) => { registered.push(tool) } },
    } as unknown as Context, {
      memberFor: () => 'developer',
      hasMember: () => true,
      hasPermission: () => true,
      workspacesFor: () => [{ path: root, access: 'write' }],
      permissions: new Set([
        'git.inspect', 'git.scope-check', 'git.worktree-create', 'git.worktree-manage',
      ]),
    })

    expect(registered.map(tool => tool.name)).toEqual(['fleet_git'])
  })

  it('exposes strict snapshot and diff invocations', () => {
    const root = repository()
    writeFileSync(join(root, 'README.md'), '# Fleet\n\nChanged\n')
    const remote = new FleetGitWebRemote(new Context())
    const signal = new AbortController().signal

    expect(remote.snapshot({ root, limit: 20 }, signal)).toMatchObject({
      status: { root: realpathSync(root), changes: [expect.objectContaining({ path: 'README.md', worktree: 'M' })] },
      commits: [expect.objectContaining({ subject: 'Initial commit' })],
    })
    const hash = remote.snapshot({ root, limit: 20 }, signal).commits[0]?.hash ?? ''
    expect(remote.commit({ root, hash }, signal)).toMatchObject({
      hash,
      files: [{ path: 'README.md', additions: 1, deletions: 0 }],
    })
    expect(remote.diff({ root, path: 'README.md' }, signal)).toMatchObject({ staged: false, truncated: false })
    expect(FLEET_GIT_WEB_REMOTE.descriptors.every(descriptor =>
      descriptor.result.mode === 'strict'
      && descriptor.parameters.every(parameter => parameter.codec.mode === 'strict'),
    )).toBe(true)
  })

  it('rejects unbounded history requests', () => {
    const root = repository()
    const remote = new FleetGitWebRemote(new Context())
    expect(() => remote.snapshot({ root, limit: 501 }, new AbortController().signal))
      .toThrow('limit must be from 1 through 500')
  })
})
