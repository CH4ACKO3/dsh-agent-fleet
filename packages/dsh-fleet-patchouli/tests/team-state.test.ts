import type { Context } from '@deepseek-ai/cordis'
import type { FleetRunRecord } from 'dsh-agent-fleet'
import { describe, expect, it, vi } from 'vitest'

import { createFleetTeamStateAlgorithm } from '../src/team-state.js'

const team = {
  id: 'team-1',
  name: 'Long-running Team',
  status: 'running',
  startedAt: '2026-08-01T00:00:00.000Z',
  work: {
    id: 'work-1',
    taskPath: '/workspace/task.md',
    status: 'running',
    startedAt: '2026-08-24T00:00:00.000Z',
  },
  members: [
    { name: 'lead', displayName: 'Avery', role: 'Lead', sessionId: 'session-lead', status: 'running' },
    { name: 'reviewer', displayName: 'Blake', role: 'Reviewer', sessionId: 'session-reviewer', status: 'idle' },
  ],
  assistants: [],
} as unknown as FleetRunRecord

const request = {
  meta: {
    source: { type: 'agent-loop', id: 'patchouli-agent-loop' },
    scope: '/workspace',
    attributes: { sessionId: 'session-lead' },
  },
  data: { query: 'What is the Team state?' },
} as const

function fixture(options: {
  readonly actor?: { readonly teamId: string; readonly subject: { readonly kind: string; readonly id: string } }
  readonly denyAction?: boolean
  readonly deniedPaths?: readonly string[]
  readonly mounts?: readonly {
    readonly id: string
    readonly name: string
    readonly path: string
    readonly access: 'read' | 'write'
    readonly builtIn: boolean
  }[]
  readonly withoutAuthorization?: boolean
} = {}) {
  const recordDataEvent = vi.fn()
  const memberViews = vi.fn(() => [
    {
      id: 'lead', name: 'Avery', role: 'Lead', responsibility: 'Own delivery.',
      prompt: 'private lead prompt', toolGroups: [], permissions: [], contacts: { members: '*', channels: '*' },
    },
    {
      id: 'reviewer', name: 'Blake', role: 'Reviewer', responsibility: 'Review independently.',
      prompt: 'private reviewer prompt', toolGroups: [], permissions: [], contacts: { members: '*', channels: '*' },
    },
  ])
  const mounts = vi.fn(() => options.mounts ?? [{
    id: 'project',
    name: 'project',
    path: '/workspace',
    access: 'write' as const,
    builtIn: true,
  }])
  const deniedPaths = new Set(options.deniedPaths ?? [])
  const authorize = vi.fn((input: { readonly resource?: { readonly id: string } }) =>
    input.resource === undefined ? options.denyAction !== true : !deniedPaths.has(input.resource.id))
  const actorForAgent = vi.fn(() => options.actor ?? {
    teamId: 'team-1',
    subject: { kind: 'member', id: 'lead' },
  })
  const authorization = {
    actorForAgent,
    authorize,
  }
  const ctx = {
    get: (name: string) => {
      if (name === 'fleetWorkspaces') return { mounts }
      if (name === 'fleetAuthorization' && options.withoutAuthorization !== true) return authorization
      return undefined
    },
  } as unknown as Context
  const runs = {
    list: () => [team],
    recordDataEvent,
    memberViews,
    moduleConfiguration: () => ({
      defaultChannel: { id: 'main', name: 'Main' },
      rules: 'Record evidence.',
      collaborationMethod: 'Work as peers.',
    }),
    exportConfiguration: () => ({ core: { positioning: 'Maintain the project over time.' } }),
  }
  return { algorithm: createFleetTeamStateAlgorithm(ctx, runs), actorForAgent, authorize, memberViews, mounts, recordDataEvent }
}

describe('Fleet Team state memory', () => {
  it('returns only compact live state at low effort', async () => {
    const { algorithm, mounts } = fixture()
    const result = await algorithm.retrieve?.(request, { effort: 'low' }) as Record<string, unknown>
    expect(result).toMatchObject({ handled: true, kind: 'fleet-team-state', count: 1 })
    expect(result.items).toEqual([expect.objectContaining({
      team: expect.objectContaining({ id: 'team-1', status: 'running' }),
      members: [
        expect.objectContaining({ id: 'lead', status: 'running' }),
        expect.objectContaining({ id: 'reviewer', status: 'idle' }),
      ],
    })])
    expect(JSON.stringify(result)).not.toContain('responsibility')
    expect(JSON.stringify(result)).not.toContain('private')
    expect(mounts).not.toHaveBeenCalled()
  })

  it('adds public duties, preferences, and only the caller mounts at medium effort', async () => {
    const { algorithm, actorForAgent, mounts, recordDataEvent } = fixture()
    const deferRecallAudit = vi.fn()
    const result = await algorithm.retrieve?.(request, { effort: 'medium', deferRecallAudit }) as Record<string, unknown>
    expect(result.items).toEqual([expect.objectContaining({
      preferences: {
        positioning: 'Maintain the project over time.',
        rules: 'Record evidence.',
        collaborationMethod: 'Work as peers.',
        defaultChannel: { id: 'main', name: 'Main' },
      },
      workspaces: [expect.objectContaining({ id: 'project', path: '/workspace', access: 'write' })],
      members: [
        expect.objectContaining({ id: 'lead', responsibility: 'Own delivery.' }),
        expect.objectContaining({ id: 'reviewer', responsibility: 'Review independently.' }),
      ],
    })])
    expect(JSON.stringify(result)).not.toContain('private reviewer prompt')
    expect(mounts).toHaveBeenCalledWith('team-1', 'lead')
    expect(actorForAgent).toHaveBeenCalledWith('session-lead')
    expect(deferRecallAudit).toHaveBeenCalledWith({
      teamId: 'team-1',
      member: 'lead',
      resultCount: 1,
    })
    expect(recordDataEvent).not.toHaveBeenCalled()
  })

  it('returns no state or timeline activity for an unrelated recall query', async () => {
    const { algorithm, memberViews, recordDataEvent } = fixture()
    await expect(algorithm.retrieve?.({
      ...request,
      data: { query: 'Find the old numerical decision in our messages.' },
    }, { effort: 'medium' })).resolves.toMatchObject({ handled: false, items: [] })
    expect(memberViews).not.toHaveBeenCalled()
    expect(recordDataEvent).not.toHaveBeenCalled()
  })

  it('applies action-level and per-mount workspace.read authorization', async () => {
    const fixtureValue = fixture({
      deniedPaths: ['/workspace/private'],
      mounts: [
        { id: 'project', name: 'project', path: '/workspace', access: 'write', builtIn: true },
        { id: 'private', name: 'private', path: '/workspace/private', access: 'read', builtIn: false },
      ],
    })
    const result = await fixtureValue.algorithm.retrieve?.(request, { effort: 'medium' }) as Record<string, unknown>
    expect(result.items).toEqual([expect.objectContaining({
      workspaces: [expect.objectContaining({ id: 'project', path: '/workspace' })],
    })])
    expect(fixtureValue.authorize).toHaveBeenCalledWith({
      teamId: 'team-1',
      subject: { kind: 'member', id: 'lead' },
      action: 'workspace.read',
    })
    expect(fixtureValue.authorize).toHaveBeenCalledWith(expect.objectContaining({
      action: 'workspace.read',
      resource: { kind: 'workspace', id: '/workspace/private' },
    }))
  })

  it('returns Team state without mounts when workspace.read is denied', async () => {
    const fixtureValue = fixture({ denyAction: true })
    const result = await fixtureValue.algorithm.retrieve?.(request, { effort: 'medium' }) as Record<string, unknown>
    expect(result).toMatchObject({ handled: true, count: 1 })
    expect(result.items).toEqual([expect.objectContaining({ workspaces: [] })])
    expect(fixtureValue.mounts).not.toHaveBeenCalled()
  })

  it('does not expose mounts for mismatched Team, subject, or subject kind', async () => {
    for (const actor of [
      { teamId: 'team-1', subject: { kind: 'member', id: 'reviewer' } },
      { teamId: 'team-2', subject: { kind: 'member', id: 'lead' } },
      { teamId: 'team-1', subject: { kind: 'assistant', id: 'lead' } },
    ]) {
      const fixtureValue = fixture({ actor })
      const result = await fixtureValue.algorithm.retrieve?.(request, { effort: 'medium' }) as Record<string, unknown>
      expect(result.items).toEqual([expect.objectContaining({ workspaces: [] })])
      expect(fixtureValue.mounts).not.toHaveBeenCalled()
      expect(fixtureValue.authorize).not.toHaveBeenCalled()
    }
  })

  it('omits mounts when Fleet authorization is unavailable', async () => {
    const fixtureValue = fixture({ withoutAuthorization: true })
    const result = await fixtureValue.algorithm.retrieve?.(request, { effort: 'medium' }) as Record<string, unknown>
    expect(result.items).toEqual([expect.objectContaining({ workspaces: [] })])
    expect(fixtureValue.mounts).not.toHaveBeenCalled()
  })
})
