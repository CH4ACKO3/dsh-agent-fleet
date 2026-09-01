export interface FleetTurnReminderRule {
  readonly id: string
  readonly text: string
  readonly priority?: number
  readonly cooldownTurns?: number
  readonly members?: readonly string[]
  readonly roles?: readonly string[]
  readonly tools?: readonly string[]
  readonly taskKinds?: readonly string[]
  readonly keywords?: readonly string[]
}

export interface FleetTurnReminderContext {
  readonly teamId: string
  readonly memberId: string
  readonly displayName: string
  readonly role: string
  readonly responsibility?: string
  readonly turn: number
  readonly text: string
  readonly tools: readonly string[]
  readonly taskKinds: readonly string[]
}

export interface FleetTurnReminderSelection {
  readonly rule: FleetTurnReminderRule
  readonly relevant: boolean
}

/** Concrete reminder copy is intentionally populated separately from the selection mechanism. */
export const DEFAULT_FLEET_TURN_REMINDERS: readonly FleetTurnReminderRule[] = []

const normalized = (value: string): string => value.trim().toLocaleLowerCase()

function includesIdentity(values: readonly string[] | undefined, identities: readonly string[]): boolean {
  if (values === undefined || values.length === 0) return true
  const expected = new Set(values.map(normalized))
  return expected.has('*') || identities.some(identity => expected.has(normalized(identity)))
}

function stableUnit(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0x1_0000_0000
}

interface Candidate {
  readonly rule: FleetTurnReminderRule
  readonly relevant: boolean
  readonly score: number
  readonly cooling: boolean
}

function candidate(
  rule: FleetTurnReminderRule,
  context: FleetTurnReminderContext,
  lastShownTurns: ReadonlyMap<string, number>,
): Candidate | undefined {
  if (rule.id.trim().length === 0 || rule.text.trim().length === 0) return undefined
  if (!includesIdentity(rule.members, [context.memberId, context.displayName])) return undefined
  if (!includesIdentity(rule.roles, [context.role])) return undefined

  const text = normalized([
    context.text,
    context.role,
    context.responsibility ?? '',
  ].join('\n'))
  const tools = new Set(context.tools.map(normalized))
  const taskKinds = new Set(context.taskKinds.map(normalized))
  let contextualSelectors = 0
  let contextualMatches = 0

  for (const tool of rule.tools ?? []) {
    contextualSelectors += 1
    const key = normalized(tool)
    if (tools.has(key) || (key.length > 0 && text.includes(key))) contextualMatches += 3
  }
  for (const taskKind of rule.taskKinds ?? []) {
    contextualSelectors += 1
    if (taskKinds.has(normalized(taskKind))) contextualMatches += 4
  }
  for (const keyword of rule.keywords ?? []) {
    contextualSelectors += 1
    const key = normalized(keyword)
    if (key.length > 0 && text.includes(key)) contextualMatches += 1
  }

  const relevant = contextualSelectors > 0 && contextualMatches > 0
  if (contextualSelectors > 0 && !relevant) return undefined
  const lastShown = lastShownTurns.get(rule.id)
  const cooldownTurns = Math.max(0, rule.cooldownTurns ?? 4)
  return {
    rule,
    relevant,
    score: contextualMatches * 100
      + (rule.priority ?? 0) * 10
      + stableUnit(`${context.teamId}\0${context.memberId}\0${context.turn}\0${rule.id}`),
    cooling: lastShown !== undefined && context.turn - lastShown <= cooldownTurns,
  }
}

function pick(candidates: readonly Candidate[], context: FleetTurnReminderContext): Candidate | undefined {
  if (candidates.length === 0) return undefined
  const available = candidates.some(item => !item.cooling)
    ? candidates.filter(item => !item.cooling)
    : candidates
  const relevant = available.filter(item => item.relevant)
  if (relevant.length > 0) {
    return relevant.reduce((best, item) => item.score > best.score ? item : best)
  }

  const weighted = available.map(item => ({
    item,
    weight: Math.max(1, 1 + (item.rule.priority ?? 0)),
  }))
  const total = weighted.reduce((sum, item) => sum + item.weight, 0)
  let cursor = stableUnit(`${context.teamId}\0${context.memberId}\0${context.turn}`) * total
  for (const entry of weighted) {
    cursor -= entry.weight
    if (cursor < 0) return entry.item
  }
  return weighted.at(-1)?.item
}

export function selectFleetTurnReminder(
  rules: readonly FleetTurnReminderRule[],
  context: FleetTurnReminderContext,
  lastShownTurns: ReadonlyMap<string, number> = new Map(),
): FleetTurnReminderSelection | undefined {
  const selected = pick(
    rules.flatMap(rule => {
      const item = candidate(rule, context, lastShownTurns)
      return item === undefined ? [] : [item]
    }),
    context,
  )
  return selected === undefined ? undefined : { rule: selected.rule, relevant: selected.relevant }
}

export function fleetTurnReminderText(rule: FleetTurnReminderRule): string {
  return `Reminder, no reply: ${rule.text.trim()}`
}
