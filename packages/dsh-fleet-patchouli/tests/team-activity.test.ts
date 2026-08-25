import type { FleetRunRecord } from 'dsh-agent-fleet'
import { describe, expect, it, vi } from 'vitest'

import { createFleetTeamActivityAlgorithm } from '../src/team-activity.js'

const team = {
  id: 'team-1',
  members: [{ name: 'lead', sessionId: 'session-lead' }],
  assistants: [{ sessionId: 'session-assistant', view: { id: 'assistant' } }],
} as unknown as FleetRunRecord

const request = {
  meta: {
    source: { type: 'agent-loop', id: 'patchouli-agent-loop' },
    scope: '/workspace',
    attributes: { sessionId: 'session-lead' },
  },
  data: { query: 'simulation', limit: 6 },
} as const

function fixture(events: readonly object[] = [{
  sequence: 42,
  createdAt: '2026-08-24T00:00:00.000Z',
  scope: 'team',
  type: 'task.completed',
  data: { task: { id: 'task-1', title: 'Simulation' } },
}]) {
  const searchTeamHistory = vi.fn().mockResolvedValue({
    runId: 'team-1',
    events,
    hasMore: false,
    truncated: false,
  })
  const recordDataEvent = vi.fn()
  const algorithm = createFleetTeamActivityAlgorithm({
    list: () => [team],
    searchTeamHistory,
    recordDataEvent,
  })
  return { algorithm, recordDataEvent, searchTeamHistory }
}

describe('Fleet Team activity memory', () => {
  it('uses a bounded recent journal tail at low effort', async () => {
    const { algorithm, searchTeamHistory } = fixture()
    const result = await algorithm.retrieve?.(request, { effort: 'low' }) as Record<string, unknown>
    expect(result).toMatchObject({ handled: true, kind: 'fleet-team-activity', count: 1 })
    expect(searchTeamHistory).toHaveBeenCalledWith('team-1', expect.objectContaining({
      query: 'simulation',
      limit: 6,
      recentBytes: 1_048_576,
      visibleToSessionId: 'session-lead',
      typePrefixes: expect.arrayContaining(['task.', 'resource.', 'workspace.']),
    }), undefined)
    const search = searchTeamHistory.mock.calls[0]?.[1] as {
      readonly types: readonly string[]
      readonly typePrefixes: readonly string[]
    }
    expect(search.types).not.toContain('coordination.message')
    expect(search.typePrefixes).not.toEqual(expect.arrayContaining(['member_', 'assistant_', 'memory.']))
  })

  it('marks deterministic milestones at high effort without starting an Agent', async () => {
    const { algorithm, searchTeamHistory, recordDataEvent } = fixture()
    const deferRecallAudit = vi.fn()
    const result = await algorithm.retrieve?.(request, { effort: 'high', deferRecallAudit }) as Record<string, unknown>
    expect(result.items).toEqual([expect.objectContaining({
      source: { kind: 'team-event', teamId: 'team-1', sequence: 42 },
      type: 'task.completed',
      milestone: true,
    })])
    expect(searchTeamHistory.mock.calls[0]?.[1]).not.toHaveProperty('recentBytes')
    expect(deferRecallAudit).toHaveBeenCalledWith({
      teamId: 'team-1',
      member: 'lead',
      resultCount: 1,
    })
    expect(recordDataEvent).not.toHaveBeenCalled()
  })

  it('does not publish a timeline event when the journal has no matching activity', async () => {
    const { algorithm, recordDataEvent } = fixture([])
    await expect(algorithm.retrieve?.(request, { effort: 'medium' })).resolves.toMatchObject({
      handled: false,
      items: [],
    })
    expect(recordDataEvent).not.toHaveBeenCalled()
  })

  it('routes assistant recall through the same stable participant visibility boundary', async () => {
    const { algorithm, searchTeamHistory } = fixture()
    const assistantMeta = {
      ...request.meta,
      attributes: { sessionId: 'session-assistant' },
    }
    expect(algorithm.filter({ operation: 'retrieve', meta: assistantMeta })).toBe(true)
    await expect(algorithm.retrieve?.(
      { ...request, meta: assistantMeta },
      { effort: 'medium' },
    )).resolves.toMatchObject({ handled: true, participant: 'assistant' })
    expect(searchTeamHistory).toHaveBeenCalledWith('team-1', expect.objectContaining({
      visibleToSessionId: 'session-assistant',
    }), undefined)
  })
})
