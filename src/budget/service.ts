import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { FleetRunRecord } from '../run.js'
import type { FleetMemberView } from '../member-view.js'
import type {
  FleetBudgetAccount,
  FleetBudgetMemberAccount,
  FleetBudgetModelRate,
  FleetBudgetMode,
  FleetTeamBudgetState,
  FleetTeamBudgetSnapshot,
} from '../budget.js'
import {
  addBudgetUsage,
  budgetAccountSnapshot,
  budgetMemberAccount,
  budgetMemberIdentity,
  budgetOutputUnit,
  budgetRemaining,
  budgetErrorMessage,
  budgetUsage,
  emptyBudgetAccount,
  replaceBudgetMember,
  resetBudgetMemberAccount,
} from '../budget.js'

// ── Store interface ──────────────────────────────────────────────────────────

/**
 * Narrow store interface covering only the FleetRunService internals that
 * BudgetService needs. FleetRunService passes itself as the implementation.
 */
export interface BudgetStore {
  requireRecord(runId: string, projectRoot?: string): FleetRunRecord
  requireMutableRecord(runId: string, projectRoot?: string): FleetRunRecord
  replaceRecord(runId: string, change: Partial<FleetRunRecord>): FleetRunRecord
  appendEvent(
    runId: string,
    type: string,
    data: unknown,
    options?: {
      readonly createdAt?: string
      readonly member?: { readonly name: string; readonly sessionId: string; readonly sequence: number }
    },
  ): void
  memberViews(runId: string): readonly FleetMemberView[]
  participants(record: FleetRunRecord): ReadonlyArray<{ readonly name: string; readonly sessionId: string }>
  requireFleetPermission(record: FleetRunRecord, caller: Agent, permission: string): void
  describeRecord(record: FleetRunRecord): FleetRunRecord
}

// ── Input types ──────────────────────────────────────────────────────────────

export interface ConfigureFleetBudgetInput {
  readonly runId: string
  readonly scope: 'team' | 'member'
  readonly member?: string
  /** Active accounting unit: weighted tokens in token mode, micro-USD in cost mode. */
  readonly limit?: number | null
  /** Reset this scope's usage cycle while preserving its current limit. */
  readonly reset?: true
  /** Team-wide accounting mode and provider+model rates. */
  readonly accounting?: {
    readonly mode: 'tokens' | 'cost'
    readonly rates: readonly FleetBudgetModelRate[]
  }
}

// ── BudgetService class ──────────────────────────────────────────────────────

export class BudgetService {
  constructor(private readonly store: BudgetStore) {}

  // ── Public API ────────────────────────────────────────────────────────────

  teamBudget(runId: string): FleetTeamBudgetSnapshot {
    const record = this.store.requireRecord(runId)
    const state = record.budget
    const mode = state?.mode ?? 'tokens'
    const rates = state?.rates ?? []
    const team = budgetAccountSnapshot(state?.team ?? emptyBudgetAccount(record.startedAt))
    const memberViews = new Map(this.store.memberViews(runId).map(view => [view.id, view]))
    const participants = [
      ...record.members.map(member => {
        const view = memberViews.get(member.name)
        const memberColor = member.color ?? view?.color
        return {
          memberId: member.name,
          name: member.displayName ?? view?.name ?? member.name,
          role: view?.role ?? member.role,
          ...(memberColor === undefined ? {} : { color: memberColor }),
          assistant: false,
          active: true,
        }
      }),
      ...record.assistants.map(assistant => ({
        memberId: assistant.view.id,
        name: assistant.view.name,
        role: assistant.view.role,
        ...(assistant.view.color === undefined ? {} : { color: assistant.view.color }),
        assistant: true,
        active: true,
      })),
    ]
    const participantIds = new Set(participants.map(participant => participant.memberId))
    const historicalParticipants = (state?.members ?? [])
      .filter(account => !participantIds.has(account.memberId) && (account.used > 0 || account.calls > 0))
      .map(account => ({
        memberId: account.memberId,
        name: account.name ?? account.memberId,
        role: account.role ?? '',
        ...(account.color === undefined ? {} : { color: account.color }),
        assistant: account.assistant ?? false,
        active: false,
      }))
    const configuredModels = rates.map(rate => ({ provider: rate.provider, model: rate.model }))
    return {
      mode,
      rates,
      configuredModels,
      team,
      members: [...participants, ...historicalParticipants].map(participant => ({
        ...budgetAccountSnapshot(
          budgetMemberAccount(state, participant.memberId) ?? emptyBudgetAccount(team.startedAt),
        ),
        ...participant,
      })),
    }
  }

  configureBudget(caller: Agent, input: ConfigureFleetBudgetInput): FleetTeamBudgetSnapshot {
    let record = this.store.requireMutableRecord(input.runId, caller.session.header.cwd)
    this.store.requireFleetPermission(record, caller, 'team.manage')
    const changingLimit = input.limit !== undefined
    const resetting = input.reset === true
    const changingAccounting = input.accounting !== undefined
    if (Number(changingLimit) + Number(resetting) + Number(changingAccounting) !== 1) {
      throw new Error('Fleet budget update must change exactly one of its limit, cycle, or accounting mode')
    }
    if (input.limit !== undefined && input.limit !== null
      && (!Number.isSafeInteger(input.limit) || input.limit <= 0)) {
      throw new Error('Fleet budget limit must be a positive safe integer or null')
    }
    const now = new Date().toISOString()
    const current = record.budget ?? { mode: 'tokens' as FleetBudgetMode, rates: [] as FleetBudgetModelRate[], team: emptyBudgetAccount(now), members: [] as FleetBudgetMemberAccount[] }
    if (input.accounting !== undefined) {
      if (input.scope !== 'team' || input.member !== undefined) {
        throw new Error('Fleet budget accounting is configured for the whole Team')
      }
      const rates: FleetBudgetModelRate[] = input.accounting.rates.map((rate, index): FleetBudgetModelRate => {
        const provider = rate.provider.trim()
        const model = rate.model.trim()
        if (provider === '' || model === '') throw new Error(`Fleet budget rate ${String(index + 1)} requires provider and model`)
        if (input.accounting?.mode === 'tokens') {
          if (rate.multiplier !== undefined && (!Number.isFinite(rate.multiplier) || rate.multiplier <= 0)) {
            throw new Error(`Fleet token multiplier for ${provider} / ${model} must be positive`)
          }
          return { provider, model, ...(rate.multiplier === undefined || rate.multiplier === 1 ? {} : { multiplier: rate.multiplier }) }
        }
        const prices = [rate.inputUsdPerMillion, rate.outputUsdPerMillion, rate.cacheReadUsdPerMillion, rate.cacheWriteUsdPerMillion]
        if (prices.some(price => price === undefined || !Number.isFinite(price) || price < 0)) {
          throw new Error(`Fleet cost budget requires four non-negative prices for ${provider} / ${model}`)
        }
        return {
          provider,
          model,
          inputUsdPerMillion: rate.inputUsdPerMillion!,
          outputUsdPerMillion: rate.outputUsdPerMillion!,
          cacheReadUsdPerMillion: rate.cacheReadUsdPerMillion!,
          cacheWriteUsdPerMillion: rate.cacheWriteUsdPerMillion!,
        }
      })
      const keys = rates.map(rate => `${rate.provider}\u0000${rate.model}`)
      if (new Set(keys).size !== keys.length) throw new Error('Fleet budget rates must use unique provider and model pairs')
      if (input.accounting.mode === 'cost') {
        const configured = this.store.describeRecord(record)
        const missing = [...configured.members, ...configured.assistants.map(assistant => assistant.view)]
          .filter(actor => actor.provider !== undefined && actor.model !== undefined)
          .filter(actor => !keys.includes(`${actor.provider}\u0000${actor.model}`))
          .map(actor => `${actor.provider} / ${actor.model}`)
        if (missing.length > 0) throw new Error(`Fleet cost budget is missing prices for ${[...new Set(missing)].join(', ')}`)
      }
      const modeChanged = current.mode !== input.accounting.mode
      const budget: FleetTeamBudgetState = modeChanged
        ? {
            mode: input.accounting.mode,
            rates,
            team: emptyBudgetAccount(now),
            members: current.members.map(account => resetBudgetMemberAccount(account, now, false)),
          }
        : { ...current, rates }
      record = this.store.replaceRecord(record.id, { budget })
      this.store.appendEvent(record.id, 'budget_accounting_configured', {
        mode: budget.mode,
        models: rates.map(rate => ({ provider: rate.provider, model: rate.model })),
        ...(modeChanged ? { reset: true } : {}),
      })
      return this.teamBudget(record.id)
    }
    let budget: FleetTeamBudgetState
    let member: string | undefined
    if (input.scope === 'team') {
      if (input.member !== undefined) throw new Error('Team budget update cannot name a member')
      if (resetting) {
        budget = {
          ...current,
          team: emptyBudgetAccount(now, current.team.limit),
          members: current.members.map(account => resetBudgetMemberAccount(account, now, true)),
        }
      } else {
        const { limit: _currentLimit, ...account } = current.team
        budget = {
          ...current,
          team: {
            ...account,
            ...(input.limit === null ? {} : { limit: input.limit }),
          },
        }
      }
    } else {
      member = input.member?.trim()
      if (member === undefined || member === '') throw new Error('Member budget update requires a member')
      if (!this.store.participants(record).some(participant => participant.name === member)) {
        throw new Error(`unknown Fleet member ${member}`)
      }
      const currentAccount = budgetMemberAccount(current, member) ?? emptyBudgetAccount(now)
      let account: FleetBudgetAccount
      if (resetting) account = emptyBudgetAccount(now, currentAccount.limit)
      else {
        const { limit: _currentLimit, ...withoutLimit } = currentAccount
        account = {
          ...withoutLimit,
          ...(input.limit === null ? {} : { limit: input.limit }),
        }
      }
      budget = { ...current, members: replaceBudgetMember(current.members, member, account, budgetMemberIdentity(record, member)) }
    }
    record = this.store.replaceRecord(record.id, { budget })
    this.store.appendEvent(record.id, resetting ? 'budget_reset' : 'budget_configured', {
      scope: input.scope,
      ...(member === undefined ? {} : { member }),
      ...(resetting || input.limit === null ? {} : { limit: input.limit }),
      ...(input.limit === null ? { unlimited: true } : {}),
    })
    return this.teamBudget(record.id)
  }

  // ── Budget usage recording ────────────────────────────────────────────────

  recordBudgetUsage(record: FleetRunRecord, member: string, event: SessionEvent): void {
    const charge = budgetUsage(event)
    if (charge === undefined) return
    const startedAt = new Date(event.time).toISOString()
    const current = record.budget ?? { mode: 'tokens' as FleetBudgetMode, rates: [] as FleetBudgetModelRate[], team: emptyBudgetAccount(startedAt), members: [] as FleetBudgetMemberAccount[] }
    const currentMember = budgetMemberAccount(current, member) ?? emptyBudgetAccount(startedAt)
    const team = addBudgetUsage(current, current.team, charge)
    const participant = addBudgetUsage(current, currentMember, charge)
    this.store.replaceRecord(record.id, {
      budget: {
        ...current,
        team,
        members: replaceBudgetMember(current.members, member, participant, budgetMemberIdentity(record, member)),
      },
    })
    const transitions = [
      { scope: 'team' as const, before: budgetAccountSnapshot(current.team), after: budgetAccountSnapshot(team) },
      { scope: 'member' as const, before: budgetAccountSnapshot(currentMember), after: budgetAccountSnapshot(participant) },
    ]
    for (const transition of transitions) {
      const crossedWarning = (transition.after.state === 'warning' || transition.after.state === 'danger')
        && transition.before.state !== 'warning' && transition.before.state !== 'danger'
        && transition.before.state !== 'exhausted'
      const crossedExhaustion = transition.after.state === 'exhausted' && transition.before.state !== 'exhausted'
      if (!crossedWarning && !crossedExhaustion) continue
      this.store.appendEvent(record.id, crossedExhaustion ? 'budget_exhausted' : 'budget_warning', {
        scope: transition.scope,
        ...(transition.scope === 'member' ? { member } : {}),
        used: transition.after.used,
        limit: transition.after.limit,
      })
    }
  }

  // ── Budget guard helpers (used by FleetRunService bindBudgetGuard) ───────

  budgetRemaining(record: FleetRunRecord, member: string): {
    readonly remaining?: number
    readonly exhaustedScope?: 'team' | 'member'
  } {
    return budgetRemaining(record.budget, member)
  }

  budgetError(record: FleetRunRecord, member: string, scope: 'team' | 'member'): Error {
    return new Error(budgetErrorMessage(record.name, member, scope))
  }

  budgetOutputUnit(state: FleetTeamBudgetState, provider: string, model: string): number {
    return budgetOutputUnit(state, provider, model)
  }

  /** Resolve the budget target for a given session id. Iterates all records via the store. */
  budgetTargetForSession(sessionId: string): {
    readonly record: FleetRunRecord
    readonly member: string
  } | undefined {
    // The store's participants() and records iteration pattern vary by
    // implementation. This default always returns undefined; FleetRunService
    // overrides by calling this method with record/member from its own iteration.
    return undefined
  }
}