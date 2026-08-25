import { describe, expect, it, vi } from 'vitest'

import type { SessionEventLike, SessionQueryLike } from '../src/fleet-context.js'
import { forEachBounded, searchSessionDocuments } from '../src/fleet-context.js'

function event(sessionId: string, seq: number): SessionEventLike & { readonly sessionId: string } {
  return {
    sessionId,
    seq,
    type: 'tool/call',
    time: seq,
    data: { name: 'fleet_send', arguments: '{"message":"decision"}' },
  }
}

function hit(sessionId: string, seq: number) {
  return { sessionId, seq, type: 'tool/call', time: seq, snippet: 'decision' }
}

describe('Fleet Session Archive query boundary', () => {
  it('hydrates only a bounded hit window through serial readEvent calls', async () => {
    let active = 0
    let peak = 0
    const readEvent = vi.fn(async ({ sessionId, seq }: { readonly sessionId: string; readonly seq: number }) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>(resolve => { setImmediate(resolve) })
      active -= 1
      const target = event(sessionId, seq)
      return { target, events: [target] }
    })
    const query: SessionQueryLike = {
      searchEvents: async ({ sessionId }) => ({
        items: Array.from({ length: 20 }, (_, index) => hit(sessionId, index + 1)),
      }),
      filterEvents: vi.fn(),
      readSession: vi.fn(async () => { throw new Error('unbounded Session read must not run') }),
      readEvent,
    }

    const results = await Promise.all([
      searchSessionDocuments(query, 'session-a', 'decision', ['tool/call'], 2, 'medium'),
      searchSessionDocuments(query, 'session-b', 'decision', ['tool/call'], 2, 'medium'),
    ])

    expect(peak).toBe(1)
    expect(readEvent).toHaveBeenCalledTimes(8)
    expect(results.map(result => result.events)).toEqual([
      expect.arrayContaining([expect.objectContaining({ seq: 1 }), expect.objectContaining({ seq: 4 })]),
      expect.arrayContaining([expect.objectContaining({ seq: 1 }), expect.objectContaining({ seq: 4 })]),
    ])
    expect(query.readSession).not.toHaveBeenCalled()
  })

  it('reports explicit degradation without invoking the unbounded literal fallback', async () => {
    const filterEvents = vi.fn(async (sessionId: string) => {
      return Array.from({ length: 2_000 }, (_, index) => ({
        ...hit(sessionId, index + 1),
        text: `decision-${String(index)}`,
      }))
    })
    const query: SessionQueryLike = {
      searchEvents: async () => {
        throw Object.assign(new Error('disabled'), { code: 'SESSION_QUERY_SEARCH_DISABLED' })
      },
      filterEvents,
      readSession: vi.fn(async () => { throw new Error('unbounded Session read must not run') }),
      readEvent: async ({ sessionId, seq }) => {
        const target = event(sessionId, seq)
        return { target, events: [target] }
      },
    }

    const results = await Promise.all([
      searchSessionDocuments(query, 'session-a', 'decision', ['tool/call'], 2, 'medium'),
      searchSessionDocuments(query, 'session-b', 'decision', ['tool/call'], 2, 'medium'),
    ])

    expect(filterEvents).not.toHaveBeenCalled()
    expect(results).toEqual([
      { sessionId: 'session-a', events: [], hits: [], mode: 'full-text-unavailable' },
      { sessionId: 'session-b', events: [], hits: [], mode: 'full-text-unavailable' },
    ])
    expect(query.readSession).not.toHaveBeenCalled()
  })

  it('reports explicit degradation instead of loading a legacy full Session', async () => {
    const readSession = vi.fn(async (sessionId: string) => {
      await new Promise<void>(resolve => { setImmediate(resolve) })
      return { events: [event(sessionId, 1)] }
    })
    const query: SessionQueryLike = {
      searchEvents: async ({ sessionId }) => ({ items: [hit(sessionId, 1)] }),
      filterEvents: vi.fn(),
      readSession,
    }

    const results = await Promise.all([
      searchSessionDocuments(query, 'session-a', 'decision', ['tool/call'], 1, 'low'),
      searchSessionDocuments(query, 'session-a', 'decision', ['tool/call'], 1, 'low'),
    ])

    expect(readSession).not.toHaveBeenCalled()
    expect(results.every(result => result.mode === 'event-read-unavailable' && result.events.length === 0)).toBe(true)
  })

  it('stops bounded workers promptly when cancelled', async () => {
    const controller = new AbortController()
    let visited = 0
    const operation = forEachBounded(
      Array.from({ length: 1_000 }, (_, index) => index),
      4,
      controller.signal,
      async value => {
        visited += 1
        if (value === 5) controller.abort()
        await new Promise<void>(resolve => { setImmediate(resolve) })
      },
    )

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(visited).toBeLessThan(12)
  })
})
