import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoverFleetContext } from '../src/context-recovery.js'

describe('bounded context recovery', () => {
  afterEach(() => { vi.useRealTimers() })

  it('never starts a second compaction while a slow first call still owns the session', async () => {
    vi.useFakeTimers()
    let complete: (value: boolean) => void = () => {}
    const compact = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve }))
    const pending = recoverFleetContext({ compact })
    await vi.advanceTimersByTimeAsync(540_000)
    expect(compact).toHaveBeenCalledOnce()
    complete(true)
    expect(await pending).toEqual({ status: 'recovered' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows slow compaction beyond two minutes but stops at ten minutes by default', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const pending = recoverFleetContext({ compact: abort => {
      signal = abort
      return new Promise<boolean>(() => {})
    } })
    await vi.advanceTimersByTimeAsync(599_999)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ status: 'failed', error: expect.stringContaining('deadline') })
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('requires a useful compaction rather than treating a no-op as recovery', async () => {
    expect(await recoverFleetContext({ compact: async () => true })).toEqual({ status: 'recovered' })
    expect(await recoverFleetContext({ compact: async () => false })).toMatchObject({ status: 'failed', error: expect.stringContaining('no useful') })
    expect(await recoverFleetContext({})).toMatchObject({ status: 'failed', error: expect.stringContaining('unavailable') })
    expect(await recoverFleetContext({ compact: async () => { throw new Error('provider failed') } })).toEqual({ status: 'failed', error: 'provider failed' })
  })

  it('cancels the provider and bounds a stalled compactor even if it ignores cancellation', async () => {
    vi.useFakeTimers()
    let resolve: (value: boolean) => void = () => {}
    let signal: AbortSignal | undefined
    const pending = recoverFleetContext({ timeoutMs: 1000, compact: abort => {
      signal = abort
      return new Promise<boolean>(done => { resolve = done })
    } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toMatchObject({ status: 'failed', error: expect.stringContaining('deadline') })
    expect(signal?.aborted).toBe(true)
    resolve(true)
    expect(await pending).toMatchObject({ status: 'failed' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves host cancellation without classifying it as a recovery failure', async () => {
    const host = new AbortController()
    let signal: AbortSignal | undefined
    const pending = recoverFleetContext({ signal: host.signal, compact: abort => {
      signal = abort
      return new Promise<boolean>(() => {})
    } })
    host.abort('operator cancellation')
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(signal?.reason).toBe('operator cancellation')
    const compact = vi.fn(async () => true)
    expect(await recoverFleetContext({ signal: host.signal, compact })).toEqual({ status: 'cancelled' })
    expect(compact).not.toHaveBeenCalled()
  })

  it('retries a transient provider failure in the same recovery operation', async () => {
    vi.useFakeTimers()
    const compact = vi.fn().mockRejectedValueOnce(new Error('DeepSeek API request to https://api.deepseek.com failed')).mockResolvedValue(true)
    const onRetry = vi.fn()
    const pending = recoverFleetContext({ compact, onRetry })
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual({ status: 'recovered' })
    expect(compact).toHaveBeenCalledTimes(2)
    expect(compact.mock.calls[0]![0]).toBe(compact.mock.calls[1]![0])
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, nextAttempt: 2, delayMs: 1000 }))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('caps transient retries and preserves the final failure', async () => {
    vi.useFakeTimers()
    const compact = vi.fn(async () => { throw new Error('fetch failed') })
    const pending = recoverFleetContext({ compact })
    await vi.advanceTimersByTimeAsync(15000)
    expect(await pending).toEqual({ status: 'failed', error: 'fetch failed' })
    expect(compact).toHaveBeenCalledTimes(5)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds retries by the original deadline, including their backoff', async () => {
    vi.useFakeTimers()
    const compact = vi.fn(async () => { throw Object.assign(new Error('rate limited'), { status: 429 }) })
    const pending = recoverFleetContext({ compact, timeoutMs: 1500 })
    await vi.advanceTimersByTimeAsync(1500)
    expect(await pending).toMatchObject({ status: 'failed', error: expect.stringContaining('deadline') })
    expect(compact).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels during backoff without launching another provider call', async () => {
    vi.useFakeTimers()
    const host = new AbortController()
    const compact = vi.fn(async () => { throw new Error('ECONNRESET') })
    const pending = recoverFleetContext({ compact, signal: host.signal })
    await vi.advanceTimersByTimeAsync(500)
    host.abort('operator cancellation')
    expect(await pending).toEqual({ status: 'cancelled' })
    expect(compact).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not retry a permanent cause hidden by the provider wrapper', async () => {
    const compact = vi.fn(async () => { throw new Error('DeepSeek API request to https://api.deepseek.com failed', {
      cause: Object.assign(new Error('bad credentials'), { status: 401 }),
    }) })
    expect(await recoverFleetContext({ compact })).toMatchObject({ status: 'failed' })
    expect(compact).toHaveBeenCalledOnce()
  })
})
