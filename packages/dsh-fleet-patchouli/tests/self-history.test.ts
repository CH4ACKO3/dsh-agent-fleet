import type { Context } from '@deepseek-ai/cordis'
import type { FleetRunRecord } from 'dsh-agent-fleet'
import { describe, expect, it, vi } from 'vitest'

import {
  createFleetSelfHistoryAlgorithm,
  FLEET_SELF_HISTORY_ALGORITHM_ID,
} from '../src/self-history.js'

const team = {
  id: 'team-1',
  members: [
    { name: 'lead', sessionId: 'session-current' },
    { name: 'reviewer', sessionId: 'session-reviewer' },
  ],
  assistants: [{ sessionId: 'session-assistant', view: { id: 'assistant' } }],
} as unknown as FleetRunRecord

const request = {
  meta: {
    source: { type: 'agent-loop', id: 'dsh-patchouli-agent-loop' },
    scope: '/workspace',
    attributes: { point: 'tool/memory-retrieve', sessionId: 'session-current' },
  },
  data: { query: 'decision', limit: 50 },
} as const

const events = new Map<string, readonly {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: unknown
}[]>([
  ['session-old', [{
    seq: 1,
    time: Date.parse('2026-08-20T00:00:00.000Z'),
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: 'The archived decision used option A.' }] } },
  }]],
  ['session-current', [
    {
      seq: 2,
      time: Date.parse('2026-08-24T00:00:00.000Z'),
      type: 'user/message',
      data: { content: [{ type: 'text', text: 'Please revisit the decision.' }] },
    },
    {
      seq: 3,
      time: Date.parse('2026-08-24T00:01:00.000Z'),
      type: 'user/message',
      data: {
        message: {
          source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'relay' },
          content: [{ type: 'text', text: '[Fleet #main] decision from another member' }],
        },
      },
    },
    {
      seq: 4,
      time: Date.parse('2026-08-24T00:02:00.000Z'),
      type: 'tool/call',
      data: { callId: 'call-1', name: 'bash', arguments: '{"command":"inspect decision"}' },
    },
    {
      seq: 5,
      time: Date.parse('2026-08-24T00:03:00.000Z'),
      type: 'tool/result',
      data: {
        message: {
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'text', text: 'decision inspection passed' }],
        },
      },
    },
    {
      seq: 6,
      time: Date.parse('2026-08-24T00:04:00.000Z'),
      type: 'tool/call',
      data: { callId: 'fleet-1', name: 'fleet_send', arguments: '{"to":"#main","message":"decision"}' },
    },
    {
      seq: 7,
      time: Date.parse('2026-08-24T00:05:00.000Z'),
      type: 'tool/result',
      data: {
        message: {
          source: { kind: 'tool', callId: 'fleet-1' },
          content: [{ type: 'text', text: 'decision sent' }],
        },
      },
    },
  ]],
  ['session-reviewer', [{
    seq: 8,
    time: Date.parse('2026-08-24T00:06:00.000Z'),
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: 'reviewer private decision' }] } },
  }]],
  ['session-assistant-old', [{
    seq: 1,
    time: Date.parse('2026-08-22T00:00:00.000Z'),
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: 'assistant archived decision' }] } },
  }]],
  ['session-assistant', [{
    seq: 2,
    time: Date.parse('2026-08-24T00:07:00.000Z'),
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: 'assistant current decision' }] } },
  }]],
])

function setup(options: {
  readonly disabled?: boolean
  readonly empty?: boolean
  readonly archiveSegments?: number
  readonly delaySearch?: boolean
} = {}) {
  const recordDataEvent = vi.fn()
  let activeSearches = 0
  let peakSearches = 0
  const sessionEvents = (sessionId: string) => events.get(sessionId) ?? (sessionId.startsWith('session-segment-')
    ? [{
        seq: 1,
        time: Number(sessionId.slice('session-segment-'.length)) + 1,
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: `archived decision ${sessionId}` }] } },
      }]
    : [])
  const searchEvents = vi.fn(async ({ sessionId }: { readonly sessionId: string }) => {
    activeSearches += 1
    peakSearches = Math.max(peakSearches, activeSearches)
    if (options.delaySearch === true) await new Promise<void>(resolve => { setImmediate(resolve) })
    activeSearches -= 1
    if (options.disabled === true) {
      throw Object.assign(new Error('disabled'), { code: 'SESSION_QUERY_SEARCH_DISABLED' })
    }
    const matches = options.empty === true ? [] : sessionEvents(sessionId)
    return {
      items: matches.map(event => ({
        sessionId,
        seq: event.seq,
        type: event.type,
        time: event.time,
        snippet: 'decision',
      })),
    }
  })
  const filterEvents = vi.fn(async (sessionId: string) => {
    const matches = options.empty === true ? [] : events.get(sessionId) ?? []
    return matches.map(event => ({
      sessionId,
      seq: event.seq,
      type: event.type,
      time: event.time,
      text: 'decision',
    }))
  })
  const readSession = vi.fn(async (sessionId: string) => ({ events: events.get(sessionId) ?? [] }))
  const readEvent = vi.fn(async ({
    sessionId,
    seq,
    before = 0,
    after = 0,
  }: {
    readonly sessionId: string
    readonly seq: number
    readonly before?: number
    readonly after?: number
  }) => {
    const session = sessionEvents(sessionId)
    const index = session.findIndex(event => event.seq === seq)
    if (index < 0) throw Object.assign(new Error('missing'), { code: 'SESSION_QUERY_EVENT_NOT_FOUND' })
    return {
      target: session[index]!,
      events: session.slice(Math.max(0, index - before), index + after + 1),
    }
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
  const context = { get: (name: keyof typeof services) => services[name] } as unknown as Context
  const participantSessionIds = vi.fn((_teamId: string, participant: string) => participant === 'lead'
    ? ['session-old', 'session-current']
    : participant === 'assistant' ? ['session-assistant-old', 'session-assistant'] : [])
  return {
    algorithm: createFleetSelfHistoryAlgorithm(context, {
      list: () => [team],
      recordDataEvent,
      participantSessionIds,
      searchParticipantMessages: vi.fn(() => []),
    }),
    filterEvents,
    participantSessionIds,
    readSession,
    recordDataEvent,
    searchEvents,
    peakSearches: () => peakSearches,
  }
}

describe('Fleet self history', () => {
  it('searches only the calling member and excludes Fleet conversation relays and sends', async () => {
    const fixture = setup()
    const deferRecallAudit = vi.fn()
    expect(fixture.algorithm.id).toBe(FLEET_SELF_HISTORY_ALGORITHM_ID)
    expect(fixture.algorithm.filter({ operation: 'retrieve', meta: request.meta })).toBe(true)

    const result = await fixture.algorithm.retrieve?.(request, { effort: 'medium', deferRecallAudit }) as Record<string, unknown>

    expect(result).toMatchObject({
      handled: true,
      kind: 'fleet-self-history',
      teamId: 'team-1',
      participant: 'lead',
      effort: 'medium',
      count: 4,
      searchedSessions: 2,
    })
    expect(fixture.searchEvents).toHaveBeenCalledTimes(2)
    expect(fixture.searchEvents).not.toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-reviewer' }),
      expect.anything(),
    )
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: { kind: 'session-event', sessionId: 'session-current', sequence: 2 },
        type: 'user/message',
      }),
      expect.objectContaining({
        source: { kind: 'session-event', sessionId: 'session-old', sequence: 1 },
        type: 'assistant/message',
      }),
    ]))
    expect(result.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: expect.objectContaining({ sequence: 3 }) }),
      expect.objectContaining({ source: expect.objectContaining({ sequence: 6 }) }),
      expect.objectContaining({ source: expect.objectContaining({ sequence: 7 }) }),
    ]))
    expect(deferRecallAudit).toHaveBeenCalledWith({
      teamId: 'team-1',
      member: 'lead',
      resultCount: 4,
    })
    expect(fixture.recordDataEvent).not.toHaveBeenCalled()
  })

  it('keeps low effort on the active Session and applies its result cap', async () => {
    const fixture = setup()
    const result = await fixture.algorithm.retrieve?.(request, { effort: 'low' }) as Record<string, unknown>

    expect(result).toMatchObject({ handled: true, effort: 'low', count: 3, searchedSessions: 1 })
    expect(fixture.searchEvents).toHaveBeenCalledTimes(1)
    expect(result.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: expect.objectContaining({ sessionId: 'session-old' }) }),
    ]))
  })

  it('associates a tool call with its result only at high effort', async () => {
    const medium = await setup().algorithm.retrieve?.(request, { effort: 'medium' }) as Record<string, unknown>
    expect(medium.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool/call', callId: 'call-1' }),
    ]))
    expect(medium.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ related: expect.anything() }),
    ]))

    const high = await setup().algorithm.retrieve?.(request, { effort: 'high' }) as Record<string, unknown>
    expect(high.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool/call',
        callId: 'call-1',
        related: expect.objectContaining({
          type: 'tool/result',
          callId: 'call-1',
          source: { kind: 'session-event', sessionId: 'session-current', sequence: 5 },
        }),
      }),
    ]))
  })

  it('reports FTS degradation without using an unbounded literal scan and emits no event for no results', async () => {
    const disabled = setup({ disabled: true })
    await expect(disabled.algorithm.retrieve?.(request, { effort: 'medium' })).resolves.toMatchObject({
      handled: false,
      modes: ['full-text-unavailable'],
      degraded: ['full-text-unavailable'],
    })
    expect(disabled.filterEvents).not.toHaveBeenCalled()

    const empty = setup({ empty: true })
    await expect(empty.algorithm.retrieve?.(request, { effort: 'medium' })).resolves.toMatchObject({
      handled: false,
      items: [],
    })
    expect(empty.readSession).not.toHaveBeenCalled()
    expect(empty.recordDataEvent).not.toHaveBeenCalled()
  })

  it('accepts the stable Team assistant but rejects non-retrieve calls', () => {
    const fixture = setup()
    expect(fixture.algorithm.filter({
      operation: 'retrieve',
      meta: { ...request.meta, attributes: { sessionId: 'session-assistant' } },
    })).toBe(true)
    expect(fixture.algorithm.filter({ operation: 'update', meta: request.meta })).toBe(false)
  })

  it('searches every Session bound to the same stable assistant identity', async () => {
    const fixture = setup()
    const assistantRequest = {
      ...request,
      meta: { ...request.meta, attributes: { sessionId: 'session-assistant' } },
    } as const

    const result = await fixture.algorithm.retrieve?.(assistantRequest, {
      effort: 'medium',
    }) as Record<string, unknown>

    expect(fixture.participantSessionIds).toHaveBeenCalledWith('team-1', 'assistant')
    expect(result).toMatchObject({
      handled: true, participant: 'assistant', count: 2, searchedSessions: 2,
    })
  })

  it('searches 1000 Archive segments with four workers and bounded top-N output', async () => {
    const fixture = setup({ archiveSegments: 1_000, delaySearch: true })
    const limited = { ...request, data: { query: 'decision', limit: 3 } } as const
    const result = await fixture.algorithm.retrieve?.(limited, { effort: 'high' }) as Record<string, unknown>

    expect(result).toMatchObject({ handled: true, count: 3, searchedSessions: 1_002 })
    expect(fixture.peakSearches()).toBe(4)
    expect(fixture.searchEvents).toHaveBeenCalledTimes(1_002)
    expect(result.items).toHaveLength(3)
  })
})
