/**
 * Pre-call context ceiling for Fleet member sessions.
 *
 * The runtime rejects a model call *after* the step is decided, so only a pre-step decision can
 * bound the charge of a call. In a budget state with no remaining-token signal every step is
 * admitted and the session re-reads its whole prompt on each call, which makes the total charge
 * grow like `calls × prompt` instead of like the work actually performed.
 *
 * This module holds the ceiling decision as a pure state machine so it can be exercised without a
 * running Agent:
 *
 * - the ceiling is **baseline-relative** growth since the epoch baseline (first observed context
 *   after session start or compaction), never an absolute prompt size, because an absolute cap
 *   below the irreducible prompt floor would fire on the first call of every session;
 * - the intervals double after each rung, mirroring `visibilityReminderContextGrowthTokens`;
 * - rung 1 is a soft pre-call wrap-up directive, rung 2 admits no further model call in the
 *   compaction epoch (optionally re-admitting one rung-crossing after a cooldown);
 * - the decision never reads the token budget, so it is invariant to a budget state that exposes
 *   no remaining-token signal.
 *
 * No imports on purpose: the same file is installed in both role trees and is exercised directly
 * by the integration checks.
 */

/** Growth interval, rung count and optional re-admission cooldown. */
export interface FleetContextCeilingPolicy {
  /** First growth interval in tokens; `0` disables the ceiling entirely. */
  readonly growthTokens: number
  /** Soft wrap-up rungs admitted before the hard stop; `0` stops at the first crossing. */
  readonly softRungs: number
  /** Re-admission cooldown after a hard stop; `0` latches the stop to the compaction epoch. */
  readonly cooldownMs: number
}

/** Per-session ceiling state; reset on compaction, exactly like the visibility reminder epoch. */
export interface FleetContextCeilingState {
  /** Largest model input context observed in the current compaction epoch. */
  latestContextTokens: number
  /** Epoch baseline; `undefined` until the first post-start/post-compaction observation. */
  baselineContextTokens: number | undefined
  /** True until the first post-compaction context observation establishes a baseline. */
  awaitingBaseline: boolean
  /** Rungs already fired in this epoch; doubles the next interval. */
  rungCount: number
  /** Set while the hard rung is latched in this epoch. */
  hardRungAt: number | undefined
  /** Hard rungs fired in this epoch; used to emit the stop notice once. */
  hardRungCount: number
}

export type FleetContextCeilingRung =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'soft'; readonly growthTokens: number; readonly intervalTokens: number }
  | {
    readonly kind: 'hard'
    readonly growthTokens: number
    readonly intervalTokens: number
    /** True only on the transition into the latched hard rung. */
    readonly first: boolean
  }

const MAX_RUNG_MULTIPLIER = 20

export function createFleetContextCeilingState(): FleetContextCeilingState {
  return {
    latestContextTokens: 0,
    baselineContextTokens: undefined,
    awaitingBaseline: false,
    rungCount: 0,
    hardRungAt: undefined,
    hardRungCount: 0,
  }
}

/** Feed one already-observed model input context into the epoch. */
export function observeFleetContextTokens(state: FleetContextCeilingState, tokens: number): void {
  if (!Number.isFinite(tokens) || tokens < 0) return
  state.latestContextTokens = Math.max(state.latestContextTokens, tokens)
  if (state.baselineContextTokens === undefined) {
    state.baselineContextTokens = state.latestContextTokens
    state.awaitingBaseline = false
  }
}

/** Start a new compaction epoch. */
export function resetFleetContextEpoch(state: FleetContextCeilingState): void {
  state.latestContextTokens = 0
  state.baselineContextTokens = undefined
  state.awaitingBaseline = true
  state.rungCount = 0
  state.hardRungAt = undefined
  state.hardRungCount = 0
}

/**
 * Decide the rung for the step that is about to run, advancing the epoch bookkeeping.
 *
 * `now` is a wall-clock reading in milliseconds used only for the re-admission cooldown.
 */
export function evaluateFleetContextCeiling(
  state: FleetContextCeilingState,
  policy: FleetContextCeilingPolicy,
  now: number,
): FleetContextCeilingRung {
  if (!Number.isSafeInteger(policy.growthTokens) || policy.growthTokens <= 0) return { kind: 'proceed' }
  if (state.hardRungAt !== undefined) {
    const reopens = policy.cooldownMs > 0 && now - state.hardRungAt >= policy.cooldownMs
    if (!reopens) {
      return { kind: 'hard', growthTokens: 0, intervalTokens: 0, first: false }
    }
    state.rungCount += 1
    state.hardRungAt = undefined
    state.baselineContextTokens = state.latestContextTokens
    state.awaitingBaseline = false
    return { kind: 'proceed' }
  }
  const baseline = state.baselineContextTokens
  if (baseline === undefined || state.awaitingBaseline) return { kind: 'proceed' }
  const growth = state.latestContextTokens - baseline
  const multiplier = 2 ** Math.min(state.rungCount, MAX_RUNG_MULTIPLIER)
  const interval = Math.min(Number.MAX_SAFE_INTEGER, policy.growthTokens * multiplier)
  if (growth < interval) return { kind: 'proceed' }
  if (state.rungCount < policy.softRungs) {
    state.rungCount += 1
    state.baselineContextTokens = state.latestContextTokens
    return { kind: 'soft', growthTokens: growth, intervalTokens: interval }
  }
  state.rungCount += 1
  state.hardRungAt = now
  state.hardRungCount += 1
  return { kind: 'hard', growthTokens: growth, intervalTokens: interval, first: true }
}
