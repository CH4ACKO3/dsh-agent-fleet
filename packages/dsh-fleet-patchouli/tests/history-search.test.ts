import type { Context } from '@deepseek-ai/cordis'
import type { FleetRunRecord } from 'dsh-agent-fleet'
import { describe, expect, it, vi } from 'vitest'

import {
  createFleetHistorySearchAlgorithm,
  FLEET_HISTORY_SEARCH_ALGORITHM_ID,
} from '../src/history-search.js'

const team = {
  id: 'team-1',
  members: [{ name: 'lead', sessionId: 'session-current' }],
  assistants: [],
} as unknown as FleetRunRecord

const request = {
  meta: {
    source: { type: 'agent-loop', id: 'dsh-patchouli-agent-loop' },
    scope: '/workspace',
    attributes: { point: 'tool/memory-retrieve', sessionId: 'session-current' },
  },
  data: { query: 'decision', limit: 10 },
} as const

function incoming(seq: number, time: number) {
  return {
    seq,
    time,
    type: 'user/message',
    data: {
      message: {
        source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'relay' },
        content: [{
          type: 'text',
          text: '[Fleet @session-peer | message-7 | from=@reviewer] The old decision was private.',
        }],
      },
    },
  }
}

function outgoing(seq: number, time: number) {
  return {
    seq,
    time,
    type: 'tool/call',
    data: {
      name: 'fleet_send',
      arguments: JSON.stringify({ to: '#general', message: 'Published decision summary.' }),
    },
  }
}

function setup(options: {
  readonly disabled?: boolean
  readonly empty?: boolean
  readonly archiveSegments?: number
  readonly delaySearch?: boolean
} = {}) {
  const recordDataEvent = vi.fn()
  const sessionEvents = new Map([
    ['session-old', [incoming(4, Date.parse('2026-08-20T00:00:00.000Z'))]],
    ['session-current', [outgoing(8, Date.parse('2026-08-24T00:00:00.000Z'))]],
  ])
  let activeSearches = 0
  let peakSearches = 0
  const sessionEvent = (sessionId: string) => sessionEvents.get(sessionId) ?? (sessionId.startsWith('session-segment-')
    ? [outgoing(1, Number(sessionId.slice('session-segment-'.length)) + 1)]
    : [])
  const searchEvents = vi.fn(async ({ sessionId }: { readonly sessionId: string }) => {
    activeSearches += 1
    peakSearches = Math.max(peakSearches, activeSearches)
    if (options.delaySearch === true) await new Promise<void>(resolve => { setImmediate(resolve) })
    activeSearches -= 1
    if (options.disabled === true) {
      throw Object.assign(new Error('disabled'), { code: 'SESSION_QUERY_SEARCH_DISABLED' })
    }
    const events = options.empty === true ? [] : sessionEvent(sessionId)
    return {
      items: events.map(event => ({
        sessionId,
        seq: event.seq,
        type: event.type,
        time: event.time,
        snippet: 'decision',
      })),
    }
  })
  const filterEvents = vi.fn(async (sessionId: string) => {
    const events = options.empty === true ? [] : sessionEvents.get(sessionId) ?? []
    return events.map(event => ({
      sessionId,
      seq: event.seq,
      type: event.type,
      time: event.time,
      surface: 'current',
      text: event.type === 'tool/call' ? 'Published decision summary.' : 'The old decision was private.',
    }))
  })
  const readSession = vi.fn(async (sessionId: string) => ({ events: sessionEvents.get(sessionId) ?? [] }))
  const readEvent = vi.fn(async ({ sessionId, seq }: { readonly sessionId: string; readonly seq: number }) => {
    const target = sessionEvent(sessionId).find(event => event.seq === seq)
    if (target === undefined) throw Object.assign(new Error('missing'), { code: 'SESSION_QUERY_EVENT_NOT_FOUND' })
    return { target, events: [target] }
  })
  const services = {
    sessionQuery: { searchEvents, filterEvents, readSession, readEvent },
    sessionArchive: {
      find: vi.fn().mockResolvedValue({
        activeSessionId: 'session-current',
        segments: options.archiveSegments === undefined
          ? [{ sessionId: 'session-old' }, { sessionId: 'session-current' }]
          : Array.from({ length: options.archiveSegments }, (_, index) => ({ sessionId: `session-segment-${String(index)}` })),
      }),
    },
  }
  const ctx = {
    get: (name: keyof typeof services) => services[name],
  } as unknown as Context
  const algorithm = createFleetHistorySearchAlgorithm(ctx, {
    list: () => [team],
    recordDataEvent,
  })
  return {
    algorithm,
    filterEvents,
    readEvent,
    readSession,
    recordDataEvent,
    searchEvents,
    peakSearches: () => peakSearches,
  }
}

describe('Fleet conversation history search', () => {
  it('searches the calling member native Session archive through the official query seam', async () => {
    const fixture = setup()
    const deferRecallAudit = vi.fn()
    expect(fixture.algorithm.id).toBe(FLEET_HISTORY_SEARCH_ALGORITHM_ID)
    expect(fixture.algorithm.filter({ operation: 'retrieve', meta: request.meta })).toBe(true)
    const result = await fixture.algorithm.retrieve?.(request, { effort: 'medium', deferRecallAudit }) as Record<string, unknown>

    expect(result).toMatchObject({
      handled: true,
      teamId: 'team-1',
      participant: 'lead',
      count: 2,
      effort: 'medium',
      searchedSessions: 2,
      modes: ['full-text'],
    })
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ conversation: '@session-peer', direction: 'received' }),
      expect.objectContaining({ conversation: '#general', direction: 'sent' }),
    ]))
    expect(fixture.searchEvents).toHaveBeenCalledTimes(2)
    expect(fixture.readEvent).toHaveBeenCalledTimes(2)
    expect(fixture.readSession).not.toHaveBeenCalled()
    expect(deferRecallAudit).toHaveBeenCalledWith({
      teamId: 'team-1',
      member: 'lead',
      resultCount: 2,
    })
    expect(fixture.recordDataEvent).not.toHaveBeenCalled()
  })

  it('reports degradation without using an unbounded literal scan when full-text search is disabled', async () => {
    const fixture = setup({ disabled: true })
    const result = await fixture.algorithm.retrieve?.(request, { effort: 'medium' }) as Record<string, unknown>
    expect(result).toMatchObject({
      handled: false,
      modes: ['full-text-unavailable'],
      degraded: ['full-text-unavailable'],
    })
    expect(fixture.filterEvents).not.toHaveBeenCalled()
  })

  it('does not publish a Fleet timeline event when no history matched', async () => {
    const fixture = setup({ empty: true })
    await expect(fixture.algorithm.retrieve?.(request, { effort: 'medium' })).resolves.toMatchObject({
      handled: false,
      items: [],
    })
    expect(fixture.recordDataEvent).not.toHaveBeenCalled()
  })

  it('keeps low-effort recall on the current hot Session', async () => {
    const fixture = setup()
    const lowRequest = {
      ...request,
      meta: {
        ...request.meta,
        attributes: { ...request.meta.attributes, fleetEffort: 'low' },
      },
    } as const
    const result = await fixture.algorithm.retrieve?.(lowRequest, { effort: 'low' }) as Record<string, unknown>
    expect(result).toMatchObject({
      handled: true,
      effort: 'low',
      count: 1,
      searchedSessions: 1,
    })
    expect(result.items).toEqual([
      expect.objectContaining({ conversation: '#general', direction: 'sent' }),
    ])
    expect(fixture.searchEvents).toHaveBeenCalledTimes(1)
  })

  it('searches 1000 Archive segments with four workers and online top-N results', async () => {
    const fixture = setup({ archiveSegments: 1_000, delaySearch: true })
    const limited = { ...request, data: { query: 'decision', limit: 3 } } as const
    const result = await fixture.algorithm.retrieve?.(limited, { effort: 'high' }) as Record<string, unknown>

    expect(result).toMatchObject({ handled: true, count: 3, searchedSessions: 1_001 })
    expect(fixture.peakSearches()).toBe(4)
    expect(fixture.searchEvents).toHaveBeenCalledTimes(1_001)
    expect(result.items).toHaveLength(3)
  })
})
