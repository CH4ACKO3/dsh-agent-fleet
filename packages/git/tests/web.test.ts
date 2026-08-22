import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { FleetAuthorizationService } from 'dsh-agent-fleet'
import type { FleetRunService } from 'dsh-agent-fleet'
import { FleetAccessService, FleetGroupService } from 'dsh-agent-fleet'

import { FLEET_GIT_WEB_REMOTE } from '../src/contract.js'
import { FLEET_GIT_PERMISSIONS, FleetGitWebRemote, apply } from '../src/index.js'

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

  it('registers Fleet actions, resource defaults, and member tools', async () => {
    const ctx = new Context()
    const access = new FleetAuthorizationService()
    const runs = {
      status: () => ({ projectRoot: '/project' }),
      readExtensionState: () => undefined,
      writeExtensionState: () => {},
      exportConfiguration: () => ({ modules: {} }),
    } as unknown as FleetRunService
    const resourceAccess = new FleetAccessService(runs, new FleetGroupService(runs))
    apply(ctx)
    ctx.provide('fleetAuthorization', access)
    ctx.provide('fleetRuns', runs)
    ctx.provide('fleetAccess', resourceAccess)
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(access.actionIds()).toEqual(expect.arrayContaining([
      'git.inspect', 'git.scope-check', 'git.worktree-create', 'git.worktree-manage',
    ]))
    expect(access.resourceKindIds()).toContain('git-repository')
    expect(resourceAccess.adapterKinds()).toContain('git-repository')
    const namespace = access.namespaces().find(candidate => candidate.namespace === 'git')
    expect(namespace?.installTools).toBeTypeOf('function')
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
