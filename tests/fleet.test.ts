import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apply } from '../src/index.js'

afterEach(() => { vi.useRealTimers() })

describe('dsh-agent-fleet', () => {
  it('coalesces Fleet changes and wakes newly connected browser peers', async () => {
    vi.useFakeTimers()
    const injections: Array<{
      dependencies: readonly string[]
      callback: (ctx: unknown) => unknown
    }> = []
    const ctx = {
      plugin: () => undefined,
      inject(dependencies: readonly string[], callback: (scope: unknown) => unknown) {
        injections.push({ dependencies, callback })
      },
    } as unknown as Context
    apply(ctx)
    const binding = injections.find(candidate => (
      candidate.dependencies.join(',') === 'fleetRuns,remote,connection'
    ))
    if (binding === undefined) throw new Error('expected Fleet browser binding injection')

    const browser = { id: 'browser-1', kind: 'browser' as const }
    const node = { id: 'node-1', kind: 'node' as const }
    let changeListener: (() => void) | undefined
    let traceChangeListener: ((teamId: string, memberId: string) => void) | undefined
    let peerListener: ((change: { type: 'added'; peer: typeof browser }) => void) | undefined
    const invalidate = vi.fn(async () => ({ ok: true, value: true }))
    const invalidateTraces = vi.fn(async () => ({ ok: true, value: true }))
    const disposeRemote = vi.fn(async () => undefined)
    const cleanup = await binding.callback({
      fleetRuns: {
        subscribeChanges(listener: () => void) {
          changeListener = listener
          return () => { changeListener = undefined }
        },
        subscribeTraceChanges(listener: (teamId: string, memberId: string) => void) {
          traceChangeListener = listener
          return () => { traceChangeListener = undefined }
        },
      },
      remote: {
        $mount: async () => disposeRemote,
        for: () => ({ fleetWebPeer: { invalidate, invalidateTraces } }),
      },
      connection: {
        peers: {
          list: () => [browser, node],
          subscribe(listener: typeof peerListener) {
            peerListener = listener
            return () => { peerListener = undefined }
          },
        },
      },
    }) as () => Promise<void>

    changeListener?.()
    changeListener?.()
    await vi.advanceTimersByTimeAsync(500)
    expect(invalidate).toHaveBeenCalledTimes(1)

    traceChangeListener?.('team-1', 'builder')
    traceChangeListener?.('team-1', 'builder')
    traceChangeListener?.('team-1', 'reviewer')
    await vi.advanceTimersByTimeAsync(250)
    expect(invalidateTraces).toHaveBeenCalledWith({
      traces: [
        { teamId: 'team-1', memberId: 'builder' },
        { teamId: 'team-1', memberId: 'reviewer' },
      ],
    })

    peerListener?.({ type: 'added', peer: browser })
    expect(invalidate).toHaveBeenCalledTimes(2)

    await cleanup()
    expect(disposeRemote).toHaveBeenCalledOnce()
  })
})
