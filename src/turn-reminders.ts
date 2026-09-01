export const FLEET_TURN_REMINDER_SLOTS = ['turn-start', 'turn-end', 'tool-result'] as const

export type FleetTurnReminderSlot = typeof FLEET_TURN_REMINDER_SLOTS[number]

export interface FleetLocalizedReminderText {
  /** Locale-independent fallback, normally English. */
  readonly default: string
  /** BCP 47 locale keys. Language-only fallbacks such as `zh` are also accepted. */
  readonly locales?: Readonly<Record<string, string>>
}

export interface FleetTurnReminderRule {
  readonly id: string
  readonly text: FleetLocalizedReminderText
  readonly priority?: number
  readonly cooldownTurns?: number
  readonly members?: readonly string[]
  readonly roles?: readonly string[]
  readonly tools?: readonly string[]
  readonly taskKinds?: readonly string[]
  readonly keywords?: readonly string[]
  /** Every listed tag must be present in the runtime context. */
  readonly tags?: readonly string[]
}

export type FleetTurnReminderLists = Readonly<Record<FleetTurnReminderSlot, readonly FleetTurnReminderRule[]>>

export interface FleetTurnReminderContext {
  readonly slot: FleetTurnReminderSlot
  readonly teamId: string
  readonly memberId: string
  readonly displayName: string
  readonly role: string
  readonly responsibility?: string
  readonly turn: number
  readonly text: string
  readonly tools: readonly string[]
  readonly taskKinds: readonly string[]
  readonly tags: readonly string[]
  readonly locales: readonly string[]
}

export interface FleetTurnReminderSelection {
  readonly rule: FleetTurnReminderRule
  readonly relevant: boolean
}

const localized = (english: string, chinese: string): FleetLocalizedReminderText => ({
  default: english,
  locales: { 'zh-CN': chinese, zh: chinese },
})

/**
 * Existing output-visibility reminders live in the turn-end slot. Turn-start
 * and tool-result copy are intentionally left empty until their catalog is reviewed.
 */
export const DEFAULT_FLEET_TURN_REMINDERS: FleetTurnReminderLists = {
  'turn-start': [],
  'tool-result': [],
  'turn-end': [
    {
      id: 'visibility-member-detailed',
      tags: ['formal-member', 'detailed'],
      cooldownTurns: 0,
      text: localized(
        [
          'Your ordinary model output from the previous turn is visible only in this private Session; other Team members do not automatically see it.',
          'If it contains a result, decision, question, or handoff another member needs, send only that relevant content with fleet_send or fleet_reply, or record it in the owning Fleet Task. Choose the smallest audience and do not resend user-only or already-shared text.',
          'If nothing needs sharing, end without commentary.',
        ].join(' '),
        '你上一轮的普通模型输出仅在当前私有 Session 中可见，其他团队成员不会自动看到。若其中包含他人需要的结果、决策、问题或交接，只用 fleet_send、fleet_reply 或对应 Fleet Task 发送相关内容，并选择最小必要受众；不要重复发送仅面向用户或已经共享的内容。若无需共享，直接结束即可。',
      ),
    },
    {
      id: 'visibility-member-brief',
      tags: ['formal-member', 'brief'],
      cooldownTurns: 0,
      text: localized(
        'Direct output remains private to this Session. Share only newly relevant content with the smallest necessary audience; otherwise end silently.',
        '直接输出仍仅在当前 Session 中可见。只向最小必要受众共享新的相关内容；否则直接结束。',
      ),
    },
    {
      id: 'visibility-assistant-user-detailed',
      tags: ['foreground-assistant', 'user-facing', 'detailed'],
      cooldownTurns: 0,
      text: localized(
        'This is a user-facing turn: its last non-empty native output is delivered to the user automatically at normal turn end, but Team members do not see it. Use fleet_user_task update only for an intentional mid-turn update; do not repeat the automatic final delivery. Share only newly relevant Team content with the smallest necessary audience.',
        '这是面向用户的 turn：正常结束时，最后一条非空原生输出会自动发送给用户，但团队成员看不到。仅在有意发送中途进展时使用 fleet_user_task update，不要重复自动发送的最终回复；团队内容只发送给最小必要受众。',
      ),
    },
    {
      id: 'visibility-assistant-user-brief',
      tags: ['foreground-assistant', 'user-facing', 'brief'],
      cooldownTurns: 0,
      text: localized(
        'The last native output will reach the user, not the Team. Do not duplicate it; share only newly relevant Team content with the smallest audience.',
        '最后一条原生输出会发送给用户，而不会发送给团队。不要重复发送；只向最小受众共享新的相关团队内容。',
      ),
    },
    {
      id: 'visibility-assistant-background-detailed',
      tags: ['foreground-assistant', 'background', 'detailed'],
      cooldownTurns: 0,
      text: localized(
        'This is a background turn: ordinary native output remains only in the Session trace and reaches neither the user nor Team members. Send only an intentional user update or newly relevant Team content with the smallest necessary audience; otherwise end silently.',
        '这是后台 turn：普通原生输出只保留在 Session trace 中，用户和团队成员都不会收到。只发送有意的用户进展或新的相关团队内容，并选择最小必要受众；否则直接结束。',
      ),
    },
    {
      id: 'visibility-assistant-background-brief',
      tags: ['foreground-assistant', 'background', 'brief'],
      cooldownTurns: 0,
      text: localized(
        'Background native output reaches neither user nor Team. Send only an intentional user update or newly relevant Team content; otherwise end silently.',
        '后台原生输出不会发送给用户或团队。只发送有意的用户进展或新的相关团队内容；否则直接结束。',
      ),
    },
  ],
}

const normalized = (value: string): string => value.trim().toLocaleLowerCase().replaceAll('_', '-')

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

export function inferFleetReminderLocales(text: string): readonly string[] {
  if (/\p{Script=Han}/u.test(text)) return ['zh-CN', 'zh', 'en']
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return ['ja', 'en']
  if (/\p{Script=Hangul}/u.test(text)) return ['ko', 'en']
  return ['en']
}

export function resolveFleetReminderText(
  text: FleetLocalizedReminderText,
  locales: readonly string[],
): string {
  const translations = new Map(Object.entries(text.locales ?? {}).map(([locale, value]) => [normalized(locale), value]))
  for (const requested of locales) {
    const locale = normalized(requested)
    const exact = translations.get(locale)
    if (exact?.trim()) return exact.trim()
    const language = locale.split('-')[0]
    if (language !== undefined) {
      const fallback = translations.get(language)
      if (fallback?.trim()) return fallback.trim()
    }
  }
  return text.default.trim()
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
  if (rule.id.trim().length === 0 || resolveFleetReminderText(rule.text, context.locales).length === 0) return undefined
  if (!includesIdentity(rule.members, [context.memberId, context.displayName])) return undefined
  if (!includesIdentity(rule.roles, [context.role])) return undefined
  const contextTags = new Set(context.tags.map(normalized))
  if (rule.tags?.some(tag => !contextTags.has(normalized(tag))) === true) return undefined

  const text = normalized([context.text, context.role, context.responsibility ?? ''].join('\n'))
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
      + stableUnit(`${context.slot}\0${context.teamId}\0${context.memberId}\0${context.turn}\0${rule.id}`),
    cooling: lastShown !== undefined && context.turn - lastShown <= cooldownTurns,
  }
}

function pick(candidates: readonly Candidate[], context: FleetTurnReminderContext): Candidate | undefined {
  if (candidates.length === 0) return undefined
  const available = candidates.filter(item => !item.cooling)
  if (available.length === 0) return undefined
  const relevant = available.filter(item => item.relevant)
  if (relevant.length > 0) return relevant.reduce((best, item) => item.score > best.score ? item : best)

  const weighted = available.map(item => ({ item, weight: Math.max(1, 1 + (item.rule.priority ?? 0)) }))
  const total = weighted.reduce((sum, item) => sum + item.weight, 0)
  let cursor = stableUnit(`${context.slot}\0${context.teamId}\0${context.memberId}\0${context.turn}`) * total
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
  const selected = pick(rules.flatMap(rule => {
    const item = candidate(rule, context, lastShownTurns)
    return item === undefined ? [] : [item]
  }), context)
  return selected === undefined ? undefined : { rule: selected.rule, relevant: selected.relevant }
}

export function fleetTurnReminderText(rule: FleetTurnReminderRule, locales: readonly string[]): string {
  return `System reminder, no reply: ${resolveFleetReminderText(rule.text, locales)}`
}
