import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FleetGitRecallService } from '../src/recall.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'fleet-git-recall-'))
  roots.push(root)
  execFileSync('git', ['init', '-q', root])
  writeFileSync(join(root, 'README.md'), '# Fleet\n')
  execFileSync('git', ['-C', root, '-c', 'user.name=Fleet', '-c', 'user.email=fleet@example.com', 'add', 'README.md'])
  execFileSync('git', ['-C', root, '-c', 'user.name=Fleet', '-c', 'user.email=fleet@example.com', 'commit', '-qm', 'Initial commit'])
  return root
}

function setup(options: {
  readonly cwd?: string
  readonly deny?: boolean
  readonly live?: boolean
  readonly actor?: { readonly teamId: string; readonly subject: { readonly kind: 'member' | 'assistant'; readonly id: string } }
} = {}) {
  const root = repository()
  const cwd = options.cwd ?? root
  const actor = options.actor ?? { teamId: 'team-1', subject: { kind: 'member' as const, id: 'lead' } }
  const require = options.deny === true
    ? vi.fn(() => { throw new Error('denied git.inspect') })
    : vi.fn()
  const agent = {
    id: 'session-current',
    session: { header: { cwd } },
  } as unknown as Agent
  const service = new FleetGitRecallService({
    agents: { list: () => options.live === false ? [] : [agent] },
    fleetRuns: { status: () => ({ projectRoot: root }) as never },
    fleetAuthorization: { actorForAgent: () => actor, require },
  })
  const input = {
    teamId: 'team-1',
    subject: { kind: 'member' as const, id: 'lead' },
    sessionId: 'session-current',
  }
  return { input, require, root, service }
}

describe('FleetGitRecallService', () => {
  it('authorizes git.inspect and scopes read-only operations to the live member workspace', () => {
    const fixture = setup()
    writeFileSync(join(fixture.root, 'README.md'), '# Fleet\n\nChanged\n')
    const signal = new AbortController().signal
    const snapshot = fixture.service.snapshot({ ...fixture.input, limit: 20 }, signal)
    const hash = snapshot?.commits[0]?.hash ?? ''

    expect(snapshot).toMatchObject({
      status: { root: realpathSync.native(fixture.root), changes: [expect.objectContaining({ path: 'README.md' })] },
    })
    expect(fixture.service.commit({ ...fixture.input, hash }, signal)).toMatchObject({ hash })
    expect(fixture.service.diff({ ...fixture.input, path: 'README.md' }, signal)).toMatchObject({
      path: 'README.md',
      staged: false,
    })
    expect(fixture.require).toHaveBeenCalledWith({
      teamId: 'team-1',
      subject: { kind: 'member', id: 'lead' },
      action: 'git.inspect',
      resource: { kind: 'git-repository', id: realpathSync.native(fixture.root) },
    })
    expect('fetch' in fixture.service).toBe(false)
  })

  it('rejects git.inspect deny without reading repository data', () => {
    const fixture = setup({ deny: true })
    expect(() => fixture.service.snapshot({ ...fixture.input, limit: 20 }, new AbortController().signal))
      .toThrow('denied git.inspect')
  })

  it('rejects a Session cwd outside the Team repository and member scope', () => {
    const unrelated = repository()
    const fixture = setup({ cwd: unrelated })
    expect(() => fixture.service.snapshot({ ...fixture.input, limit: 20 }, new AbortController().signal))
      .toThrow('outside Fleet project')
  })

  it('rejects mismatched Team, subject, and non-live Session identities', () => {
    const fixture = setup()
    const signal = new AbortController().signal
    expect(() => fixture.service.snapshot({ ...fixture.input, teamId: 'team-2', limit: 20 }, signal))
      .toThrow('identity does not match')
    expect(() => fixture.service.snapshot({
      ...fixture.input,
      subject: { kind: 'member', id: 'reviewer' },
      limit: 20,
    }, signal)).toThrow('identity does not match')

    const offline = setup({ live: false })
    expect(() => offline.service.snapshot({ ...offline.input, limit: 20 }, signal))
      .toThrow('requires a live member Agent')
  })
})
