import type { Context } from '@deepseek-ai/cordis'
import type { FleetRunRecord } from 'dsh-agent-fleet'
import { describe, expect, it, vi } from 'vitest'

import {
  createFleetGitContextAlgorithm,
  FLEET_GIT_CONTEXT_ALGORITHM_ID,
} from '../src/git-context.js'

const team = {
  id: 'team-1',
  projectRoot: '/workspace',
  members: [{ name: 'lead', sessionId: 'session-current' }],
  assistants: [],
} as unknown as FleetRunRecord

const request = {
  meta: {
    source: { type: 'agent-loop', id: 'dsh-patchouli-agent-loop' },
    scope: '/workspace',
    attributes: { sessionId: 'session-current' },
  },
  data: { query: 'README', limit: 20 },
} as const

function setup(options: { readonly withGit?: boolean; readonly scopeDenied?: boolean } = {}) {
  const recordDataEvent = vi.fn()
  const snapshotValue = {
    status: {
      root: '/workspace',
      branch: 'main',
      head: 'abc123',
      changes: [{ path: 'README.md', index: ' ', worktree: 'M' }],
      worktrees: [{ path: '/workspace', head: 'abc123', branch: 'main', detached: false }],
    },
    branches: [{ name: 'main', fullName: 'refs/heads/main', head: 'abc123', current: true, remote: false }],
    commits: [{
      hash: 'abc123',
      parents: [],
      authorName: 'Avery',
      authorEmail: 'avery@example.com',
      authoredAt: '2026-08-20T00:00:00.000Z',
      subject: 'Document README decision',
      decorations: ['HEAD -> main'],
    }],
  }
  const snapshot = options.scopeDenied === true
    ? vi.fn().mockRejectedValue(new Error('outside member workspace'))
    : vi.fn().mockResolvedValue(snapshotValue)
  const commit = vi.fn().mockResolvedValue({
    hash: 'abc123',
    parents: [],
    authorName: 'Avery',
    authorEmail: 'avery@example.com',
    authoredAt: '2026-08-20T00:00:00.000Z',
    committerName: 'Avery',
    committerEmail: 'avery@example.com',
    committedAt: '2026-08-20T00:00:00.000Z',
    subject: 'Document README decision',
    body: '',
    decorations: ['HEAD -> main'],
    files: [{ path: 'README.md', status: 'M', additions: 2, deletions: 1, binary: false }],
  })
  const diff = vi.fn().mockResolvedValue({
    path: 'README.md',
    staged: false,
    text: '@@ README @@\n+Document the decision.',
    truncated: false,
  })
  const git = { snapshot, commit, diff }
  const ctx = {
    get: (name: string) => options.withGit !== false && name === 'fleetGitRecall' ? git : undefined,
  } as unknown as Context
  const algorithm = createFleetGitContextAlgorithm(ctx, {
    list: () => [team],
    recordDataEvent,
  })
  return { algorithm, commit, diff, recordDataEvent, snapshot }
}

describe('Fleet Git context recall', () => {
  it('stays unavailable when the optional Fleet Git service is absent', async () => {
    const fixture = setup({ withGit: false })
    expect(fixture.algorithm.filter({ operation: 'retrieve', meta: request.meta })).toBe(false)
    await expect(fixture.algorithm.retrieve?.(request, { effort: 'medium' })).resolves.toMatchObject({
      handled: false,
      items: [],
    })
    expect(fixture.snapshot).not.toHaveBeenCalled()
  })

  it('reuses snapshot, commit, and diff read services without fetching', async () => {
    const fixture = setup()
    const deferRecallAudit = vi.fn()
    const result = await fixture.algorithm.retrieve?.(request, { effort: 'medium', deferRecallAudit }) as Record<string, unknown>

    expect(fixture.algorithm.id).toBe(FLEET_GIT_CONTEXT_ALGORITHM_ID)
    expect(result).toMatchObject({ handled: true, teamId: 'team-1', effort: 'medium' })
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'commit', source: expect.objectContaining({ commit: 'abc123' }) }),
      expect.objectContaining({ kind: 'diff', source: expect.objectContaining({ path: 'README.md' }) }),
    ]))
    expect(fixture.snapshot).toHaveBeenCalledWith({
      teamId: 'team-1',
      subject: { kind: 'member', id: 'lead' },
      sessionId: 'session-current',
      limit: 50,
    }, expect.any(AbortSignal))
    expect(fixture.commit).toHaveBeenCalledTimes(1)
    expect(fixture.diff).toHaveBeenCalledTimes(1)
    expect(fixture.commit).toHaveBeenCalledWith({
      teamId: 'team-1',
      subject: { kind: 'member', id: 'lead' },
      sessionId: 'session-current',
      hash: 'abc123',
    }, expect.any(AbortSignal))
    expect(fixture.diff).toHaveBeenCalledWith({
      teamId: 'team-1',
      subject: { kind: 'member', id: 'lead' },
      sessionId: 'session-current',
      path: 'README.md',
      staged: false,
    }, expect.any(AbortSignal))
    expect(deferRecallAudit).toHaveBeenCalledWith({
      teamId: 'team-1',
      member: 'lead',
      resultCount: 3,
    })
    expect(fixture.recordDataEvent).not.toHaveBeenCalled()
  })

  it('returns a bounded repository state for an explicit Git query', async () => {
    const fixture = setup()
    const gitRequest = { ...request, data: { query: 'git', limit: 1 } } as const
    const result = await fixture.algorithm.retrieve?.(gitRequest, { effort: 'high' }) as Record<string, unknown>
    expect(result).toMatchObject({ handled: true, count: 1 })
    expect(result.items).toEqual([expect.objectContaining({ kind: 'state', branch: 'main' })])
    expect(fixture.commit).not.toHaveBeenCalled()
    expect(fixture.diff).not.toHaveBeenCalled()
  })

  it('fails closed when the Git-owned seam rejects the caller workspace scope', async () => {
    const fixture = setup({ scopeDenied: true })
    await expect(fixture.algorithm.retrieve?.(request, { effort: 'medium' })).resolves.toMatchObject({
      handled: false,
      items: [],
    })
    expect(fixture.commit).not.toHaveBeenCalled()
    expect(fixture.diff).not.toHaveBeenCalled()
    expect(fixture.recordDataEvent).not.toHaveBeenCalled()
  })
})
