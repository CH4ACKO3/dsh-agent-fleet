import { type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FleetRunRecord, FleetTeamBudgetState } from '../run.js'

// ── Host interface ───────────────────────────────────────────────────────────

/**
 * Narrow interface covering the FleetRunService methods that the guard closure
 * references. FleetRunService passes itself as the implementation.
 */
export interface BudgetGuardHost {
  budgetTargetForSession(sessionId: string): {
    readonly record: FleetRunRecord
    readonly member: string
  } | undefined
  budgetRemaining(record: FleetRunRecord, member: string): {
    readonly remaining?: number
    readonly exhaustedScope?: 'team' | 'member'
  }
  budgetError(record: FleetRunRecord, member: string, scope: 'team' | 'member'): Error
  budgetOutputUnit(state: FleetTeamBudgetState, provider: string, model: string): number
}

// ── BudgetGuard class ────────────────────────────────────────────────────────

/**
 * Extracted agent/request guard that checks budget limits before every
 * model call and clamps maxTokens to the affordable amount.
 *
 * Moved from FleetRunService.bindBudgetGuard as Phase 4 of the
 * budget extraction plan.
 */
export class BudgetGuard {
  private readonly bound = new WeakSet<Agent>()

  constructor(private readonly host: BudgetGuardHost) {}

  /** Register budget guard on `agent` unless already registered. */
  bind(agent: Agent): void {
    if (this.bound.has(agent)) return
    const agentCtx = (agent as Agent & { readonly ctx?: Context }).ctx
    if (agentCtx === undefined) return
    this.bound.add(agent)
    agentCtx.on('agent/request', async (_payload, next) => {
      const target = this.host.budgetTargetForSession(String(agent.id))
      if (target === undefined) return next()
      const before = this.host.budgetRemaining(target.record, target.member)
      if (before.exhaustedScope !== undefined) {
        throw this.host.budgetError(target.record, target.member, before.exhaustedScope)
      }
      const resolved = await next()
      const latest = this.host.budgetTargetForSession(String(agent.id))
      if (latest === undefined) return resolved
      const budget = this.host.budgetRemaining(latest.record, latest.member)
      if (budget.exhaustedScope !== undefined) {
        throw this.host.budgetError(latest.record, latest.member, budget.exhaustedScope)
      }
      const state = latest.record.budget
      if (state === undefined) return resolved
      const outputUnit = this.host.budgetOutputUnit(state, resolved.provider, resolved.model)
      if (budget.remaining === undefined) return resolved
      if (outputUnit === 0) return resolved
      const affordableOutputTokens = Math.max(1, Math.floor(budget.remaining / outputUnit))
      return {
        ...resolved,
        maxTokens: Math.min(resolved.maxTokens ?? affordableOutputTokens, affordableOutputTokens),
      }
    })
  }
}