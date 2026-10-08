function transientRecoveryError(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current = error
  let transient = false
  for (let depth = 0; current !== null && typeof current === 'object' && !seen.has(current) && depth < 5; depth += 1) {
    seen.add(current)
    const detail = current as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; cause?: unknown }
    const status = Number(detail.status ?? detail.statusCode)
    if (status >= 400 && status < 500 && ![408, 425, 429].includes(status)) return false
    if ([408, 425, 429].includes(status) || status >= 500 && status <= 599) transient = true
    const message = `${String(detail.code ?? '')} ${String(detail.message ?? '')}`
    if (/\b(?:401|403)\b|invalid.{0,12}api.?key|authentication|unauthorized|forbidden/i.test(message)) return false
    if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_|fetch failed|socket hang up|STREAM_CLOSED|\b(?:408|425|429|5\d\d)\b|API request to \S+ failed/i.test(message)) transient = true
    current = detail.cause
  }
  return transient
}

export const FLEET_RECOVERY_MAX_ATTEMPTS = 5
export const FLEET_RECOVERY_DEFAULT_TIMEOUT_MS = 600_000

/** A context growth limit must lead to a bounded recovery, never an idle latch. */
export async function recoverFleetContext(input: {
  readonly compact?: (signal: AbortSignal) => Promise<boolean>
  readonly signal?: AbortSignal | undefined
  readonly timeoutMs?: number
  readonly onRetry?: (event: { attempt: number; nextAttempt: number; delayMs: number; error: string }) => void
}): Promise<{ readonly status: 'recovered' } | { readonly status: 'cancelled' } | { readonly status: 'failed'; readonly error: string }> {
  if (input.signal?.aborted) return { status: 'cancelled' }
  if (input.compact === undefined) return { status: 'failed', error: 'Native compaction service is unavailable.' }
  const controller = new AbortController()
  const cancel = (): void => { controller.abort(input.signal?.reason) }
  input.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { controller.abort(new Error('Fleet context recovery deadline expired.')) }, input.timeoutMs ?? FLEET_RECOVERY_DEFAULT_TIMEOUT_MS)
  let detachAbort = (): void => {}
  try {
    const aborted = new Promise<never>((_resolve, reject) => {
      const abort = (): void => { reject(controller.signal.reason) }
      detachAbort = () => { controller.signal.removeEventListener('abort', abort) }
      controller.signal.addEventListener('abort', abort, { once: true })
      if (controller.signal.aborted) abort()
    })
    // All attempts share one deadline. Never overlap a timed-out compaction
    // with another operation on the same mutable session history.
    for (let attempt = 1; ; attempt += 1) {
      try {
        if (controller.signal.aborted) throw controller.signal.reason
        const recovered = await Promise.race([input.compact(controller.signal), aborted])
        if (input.signal?.aborted) return { status: 'cancelled' }
        return recovered ? { status: 'recovered' } : { status: 'failed', error: 'Native compaction found no useful reducible history.' }
      } catch (error) {
        if (controller.signal.aborted || attempt >= FLEET_RECOVERY_MAX_ATTEMPTS || !transientRecoveryError(error)) throw error
        const delayMs = 1000 * 2 ** (attempt - 1)
        input.onRetry?.({ attempt, nextAttempt: attempt + 1, delayMs, error: error instanceof Error ? error.message : String(error) })
        let delay: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([new Promise<void>(resolve => { delay = setTimeout(resolve, delayMs) }), aborted])
        } finally {
          clearTimeout(delay)
        }
      }
    }
  } catch (error) {
    if (input.signal?.aborted) return { status: 'cancelled' }
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
    detachAbort()
    input.signal?.removeEventListener('abort', cancel)
  }
}
