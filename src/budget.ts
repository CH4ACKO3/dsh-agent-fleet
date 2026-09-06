import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

// ── Budget types ─────────────────────────────────────────────────────────────

export type FleetBudgetMode = 'tokens' | 'cost'

export interface FleetBudgetModelRate {
  readonly provider: string
  readonly model: string
  /** Token mode only. An omitted multiplier is exactly 1x. */
  readonly multiplier?: number
  /** Cost mode prices in USD per one million tokens. */
  readonly inputUsdPerMillion?: number
  readonly outputUsdPerMillion?: number
  readonly cacheReadUsdPerMillion?: number
  readonly cacheWriteUsdPerMillion?: number
}

export interface FleetBudgetModelUsage {
  readonly provider: string
  readonly model: string
  /** Weighted tokens in token mode, micro-USD in cost mode. */
  readonly charged: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly calls: number
  readonly unmeteredCalls: number
}

export interface FleetBudgetAccount {
  /** Weighted tokens in token mode, micro-USD in cost mode. */
  readonly limit?: number
  readonly startedAt: string
  /** Weighted tokens in token mode, micro-USD in cost mode. */
  readonly used: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly calls: number
  readonly unmeteredCalls: number
  readonly models: FleetBudgetModelUsage[]
}

export interface FleetTeamBudgetState {
  readonly mode: FleetBudgetMode
  readonly rates: FleetBudgetModelRate[]
  readonly team: FleetBudgetAccount
  readonly members: FleetBudgetMemberAccount[]
}

export interface FleetBudgetMemberAccount extends FleetBudgetAccount {
  readonly memberId: string
  readonly name?: string
  readonly role?: string
  readonly color?: string
  readonly assistant?: boolean
}

export type FleetBudgetAccountState = 'unlimited' | 'normal' | 'warning' | 'danger' | 'exhausted'

export interface FleetBudgetAccountSnapshot extends FleetBudgetAccount {
  readonly remaining?: number
  readonly state: FleetBudgetAccountState
}

export interface FleetParticipantBudgetSnapshot extends FleetBudgetAccountSnapshot {
  readonly memberId: string
  readonly name: string
  readonly role: string
  readonly color?: string
  readonly assistant: boolean
  readonly active: boolean
}

export interface FleetTeamBudgetSnapshot {
  readonly mode: FleetBudgetMode
  readonly rates: FleetBudgetModelRate[]
  readonly configuredModels: readonly { readonly provider: string; readonly model: string }[]
  readonly team: FleetBudgetAccountSnapshot
  readonly members: readonly FleetParticipantBudgetSnapshot[]
}

// ── Internal charge type ─────────────────────────────────────────────────────

export interface FleetBudgetCharge {
  readonly provider: string
  readonly model: string
  readonly usage: TokenUsage | null
}

// ── Pure functions ───────────────────────────────────────────────────────────

export function emptyBudgetAccount(startedAt: string, limit?: number): FleetBudgetAccount {
  return {
    ...(limit === undefined ? {} : { limit }),
    startedAt,
    used: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    calls: 0,
    unmeteredCalls: 0,
    models: [],
  }
}

export function budgetAccountSnapshot(account: FleetBudgetAccount): FleetBudgetAccountSnapshot {
  if (account.limit === undefined) return { ...account, state: 'unlimited' }
  const remaining = Math.max(0, account.limit - account.used)
  return {
    ...account,
    remaining,
    state: remaining === 0
      ? 'exhausted'
      : account.used >= account.limit * 0.9
        ? 'danger'
        : account.used >= account.limit * 0.7
          ? 'warning'
          : 'normal',
  }
}

export function budgetMemberAccount(
  state: FleetTeamBudgetState | undefined,
  memberId: string,
): FleetBudgetMemberAccount | undefined {
  return state?.members.find(account => account.memberId === memberId)
}

export function replaceBudgetMember(
  members: readonly FleetBudgetMemberAccount[],
  memberId: string,
  account: FleetBudgetAccount,
  identity?: Pick<FleetBudgetMemberAccount, 'name' | 'role' | 'color' | 'assistant'>,
): FleetBudgetMemberAccount[] {
  const current = members.find(candidate => candidate.memberId === memberId)
  const previousIdentity = current === undefined ? {} : {
    ...(current.name === undefined ? {} : { name: current.name }),
    ...(current.role === undefined ? {} : { role: current.role }),
    ...(current.color === undefined ? {} : { color: current.color }),
    ...(current.assistant === undefined ? {} : { assistant: current.assistant }),
  }
  const next = { ...account, memberId, ...previousIdentity, ...identity }
  return current !== undefined
    ? members.map(candidate => candidate.memberId === memberId ? next : candidate)
    : [...members, next]
}

export function budgetMemberIdentity(
  participants: {
    readonly members: readonly { readonly name: string; readonly displayName?: string; readonly role: string; readonly color?: string }[]
    readonly assistants: readonly { readonly view: { readonly id: string; readonly name: string; readonly role: string; readonly color?: string } }[]
  },
  memberId: string,
): Pick<FleetBudgetMemberAccount, 'name' | 'role' | 'color' | 'assistant'> | undefined {
  const member = participants.members.find(candidate => candidate.name === memberId)
  if (member !== undefined) return {
    name: member.displayName ?? member.name,
    role: member.role,
    ...(member.color === undefined ? {} : { color: member.color }),
    assistant: false,
  }
  const assistant = participants.assistants.find(candidate => candidate.view.id === memberId)?.view
  return assistant === undefined ? undefined : {
    name: assistant.name,
    role: assistant.role,
    ...(assistant.color === undefined ? {} : { color: assistant.color }),
    assistant: true,
  }
}

export function resetBudgetMemberAccount(
  account: FleetBudgetMemberAccount,
  startedAt: string,
  preserveLimit: boolean,
): FleetBudgetMemberAccount {
  return {
    ...emptyBudgetAccount(startedAt, preserveLimit ? account.limit : undefined),
    memberId: account.memberId,
    ...(account.name === undefined ? {} : { name: account.name }),
    ...(account.role === undefined ? {} : { role: account.role }),
    ...(account.color === undefined ? {} : { color: account.color }),
    ...(account.assistant === undefined ? {} : { assistant: account.assistant }),
  }
}

export function budgetUsage(event: SessionEvent): FleetBudgetCharge | undefined {
  if (event.type === 'assistant/message') {
    const source = event.data.message.source
    if (source === undefined) return undefined
    return {
      provider: source.provider,
      model: source.model,
      usage: event.data.usage ?? null,
    }
  }
  if (event.type === 'compaction/summary') {
    return { provider: event.data.provider, model: event.data.model, usage: event.data.usage ?? null }
  }
  return undefined
}

export function budgetRate(
  rates: readonly FleetBudgetModelRate[],
  provider: string,
  model: string,
): FleetBudgetModelRate | undefined {
  return rates.find(rate => rate.provider === provider && rate.model === model)
}

export function rawBudgetTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

export function chargedBudgetUsage(state: FleetTeamBudgetState, charge: FleetBudgetCharge): number {
  if (charge.usage === null) return 0
  const rate = budgetRate(state.rates, charge.provider, charge.model)
  if (state.mode === 'tokens') return Math.ceil(rawBudgetTokens(charge.usage) * (rate?.multiplier ?? 1))
  if (rate?.inputUsdPerMillion === undefined || rate.outputUsdPerMillion === undefined
    || rate.cacheReadUsdPerMillion === undefined || rate.cacheWriteUsdPerMillion === undefined) {
    throw new Error(`Fleet cost budget requires prices for ${charge.provider} / ${charge.model}`)
  }
  return Math.round(
    charge.usage.inputTokens * rate.inputUsdPerMillion
    + charge.usage.outputTokens * rate.outputUsdPerMillion
    + (charge.usage.cacheReadTokens ?? 0) * rate.cacheReadUsdPerMillion
    + (charge.usage.cacheWriteTokens ?? 0) * rate.cacheWriteUsdPerMillion,
  )
}

export function addModelBudgetUsage(
  models: readonly FleetBudgetModelUsage[],
  charge: FleetBudgetCharge,
  charged: number,
): FleetBudgetModelUsage[] {
  const current = models.find(item => item.provider === charge.provider && item.model === charge.model)
  const usage = charge.usage
  const next: FleetBudgetModelUsage = {
    provider: charge.provider,
    model: charge.model,
    charged: (current?.charged ?? 0) + charged,
    inputTokens: (current?.inputTokens ?? 0) + (usage?.inputTokens ?? 0),
    outputTokens: (current?.outputTokens ?? 0) + (usage?.outputTokens ?? 0),
    cacheReadTokens: (current?.cacheReadTokens ?? 0) + (usage?.cacheReadTokens ?? 0),
    cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + (usage?.cacheWriteTokens ?? 0),
    reasoningTokens: (current?.reasoningTokens ?? 0) + (usage?.reasoningTokens ?? 0),
    calls: (current?.calls ?? 0) + 1,
    unmeteredCalls: (current?.unmeteredCalls ?? 0) + (usage === null ? 1 : 0),
  }
  return current === undefined
    ? [...models, next]
    : models.map(item => item.provider === charge.provider && item.model === charge.model ? next : item)
}

// ── Budget query functions (Phase 2) ─────────────────────────────────────────

export function budgetRemaining(
  state: FleetTeamBudgetState | undefined,
  memberId: string,
): {
  readonly remaining?: number
  readonly exhaustedScope?: 'team' | 'member'
} {
  const team = state?.team
  const participant = budgetMemberAccount(state, memberId)
  const teamRemaining = team?.limit === undefined
    ? undefined
    : Math.max(0, team.limit - team.used)
  const memberRemaining = participant?.limit === undefined
    ? undefined
    : Math.max(0, participant.limit - participant.used)
  if (teamRemaining === 0) return { remaining: 0, exhaustedScope: 'team' }
  if (memberRemaining === 0) return { remaining: 0, exhaustedScope: 'member' }
  if (teamRemaining === undefined) return memberRemaining === undefined ? {} : { remaining: memberRemaining }
  if (memberRemaining === undefined) return { remaining: teamRemaining }
  return { remaining: Math.min(teamRemaining, memberRemaining) }
}

export function budgetErrorMessage(
  teamName: string,
  member: string,
  scope: 'team' | 'member',
): string {
  return scope === 'team'
    ? `Fleet Team ${teamName} budget is exhausted; increase its limit or start a new budget cycle before another model call`
    : `Fleet member ${member} budget is exhausted; increase its limit or reset that member budget before another model call`
}

export function budgetOutputUnit(
  state: FleetTeamBudgetState,
  provider: string,
  model: string,
): number {
  const rate = budgetRate(state.rates, provider, model)
  if (state.mode === 'tokens') return rate?.multiplier ?? 1
  if (rate?.inputUsdPerMillion === undefined || rate.outputUsdPerMillion === undefined
    || rate.cacheReadUsdPerMillion === undefined || rate.cacheWriteUsdPerMillion === undefined) {
    throw new Error(`Fleet cost budget requires prices for ${provider} / ${model}`)
  }
  return rate.outputUsdPerMillion
}

// ── Budget update functions ───────────────────────────────────────────────────

export function addBudgetUsage(
  state: FleetTeamBudgetState,
  account: FleetBudgetAccount,
  charge: FleetBudgetCharge,
): FleetBudgetAccount {
  const charged = chargedBudgetUsage(state, charge)
  if (charge.usage === null) {
    return {
      ...account,
      calls: account.calls + 1,
      unmeteredCalls: account.unmeteredCalls + 1,
      models: addModelBudgetUsage(account.models, charge, charged),
    }
  }
  const usage = charge.usage
  const inputTokens = usage.inputTokens
  const outputTokens = usage.outputTokens
  const cacheReadTokens = usage.cacheReadTokens ?? 0
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0
  const reasoningTokens = usage.reasoningTokens ?? 0
  return {
    ...account,
    used: account.used + charged,
    inputTokens: account.inputTokens + inputTokens,
    outputTokens: account.outputTokens + outputTokens,
    cacheReadTokens: account.cacheReadTokens + cacheReadTokens,
    cacheWriteTokens: account.cacheWriteTokens + cacheWriteTokens,
    reasoningTokens: account.reasoningTokens + reasoningTokens,
    calls: account.calls + 1,
    models: addModelBudgetUsage(account.models, charge, charged),
  }
}