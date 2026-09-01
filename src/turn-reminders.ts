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

export interface FleetReminderVariables {
  readonly name?: string
  readonly role?: string
  readonly responsibility?: string
  readonly language?: string
}

const localized = (english: string, chinese: string): FleetLocalizedReminderText => ({
  default: english,
  locales: { 'zh-CN': chinese, zh: chinese },
})

export const DEFAULT_FLEET_TURN_REMINDERS: FleetTurnReminderLists = {
  'turn-start': [
    {
      id: 'identity-formal', tags: ['formal-member'], cooldownTurns: 10,
      text: localized(
        'You are {name}, serving as {role}, responsible for {responsibility}. Advance work in your scope first and share only necessary information with the smallest audience.',
        '你是 {name}，担任 {role}，职责是 {responsibility}。优先推进职责内工作，只向最小必要受众共享协作所需信息。',
      ),
    },
    {
      id: 'identity-assistant', tags: ['foreground-assistant'], cooldownTurns: 10,
      text: localized(
        'You are {name}, serving as {role}, responsible for {responsibility}. As Team assistant, synthesize conclusions for the user, delegate execution, and omit irrelevant internal process.',
        '你是 {name}，担任 {role}，职责是 {responsibility}。作为团队助理，面向用户收敛结论、交派执行，并省略无关内部过程。',
      ),
    },
    {
      id: 'user-locale', cooldownTurns: 8,
      text: localized(
        "The user's selected language is {language}; use {language} for work and collaboration unless the content requires another language.",
        '用户选择的语言是 {language}；除非内容本身要求其他语言，工作和协作也应使用 {language}。',
      ),
    },
    {
      id: 'audience-scope', cooldownTurns: 5,
      tools: ['fleet_send', 'fleet_reply'], keywords: ['channel', 'private', '频道', '私聊'],
      text: localized(
        'Use private messages for one or a few members; post to a Channel only when its whole audience needs the content.',
        '只需一人或少数成员处理时使用私聊；仅当整个频道都需要时才发到频道。',
      ),
    },
    {
      id: 'explicit-response', cooldownTurns: 4,
      taskKinds: ['reply', 'inbox'], keywords: ['reply', 'respond', '回复', '答复'],
      text: localized(
        'A private message does not require a reply; mention the recipient with @ when an explicit response is required.',
        '私聊本身不要求答复；需要明确回复时，请在私聊中 @ 对方。',
      ),
    },
    {
      id: 'mention-meaning', cooldownTurns: 5,
      keywords: ['@', 'mention', '提及'],
      text: localized(
        '@ means that member must handle or answer the message; do not use it as a casual salutation.',
        '@ 表示要求该成员处理或答复，不要把它当作普通称呼。',
      ),
    },
    {
      id: 'work-intent', cooldownTurns: 6,
      keywords: ['channel', 'task', 'goal', '频道', '任务'],
      text: localized(
        'A Channel message is not automatically a new Task; create or claim work only when it carries clear work intent.',
        '频道消息不天然等于新任务；只有存在明确工作意图时才创建或认领工作。',
      ),
    },
    {
      id: 'owned-task', cooldownTurns: 3,
      taskKinds: ['reply', 'vote', 'composite', 'inbox', 'goal', 'interaction'],
      text: localized(
        'Advance or update your existing Fleet Task before creating another Task for the same work.',
        '若已有你负责的 Fleet Task，先推进或更新它，不要为相同工作另建任务。',
      ),
    },
  ],
  'tool-result': [
    {
      id: 'use-result', cooldownTurns: 4,
      text: localized(
        'Use the tool result directly; do not report that it was read, received, or successful.',
        '直接使用工具结果，不要额外报告“已读取”“已收到”或“调用成功”。',
      ),
    },
    {
      id: 'retry-with-change', cooldownTurns: 2,
      keywords: ['error', 'failed', 'unavailable', '错误', '失败', '不可用'],
      text: localized(
        'After a tool error, change the parameters or strategy before retrying; do not repeat an unchanged call.',
        '工具失败后先调整参数或策略；不要原样重复调用。',
      ),
    },
    {
      id: 'aborted-result', cooldownTurns: 2,
      keywords: ['aborted', 'cancelled', '中止', '取消'],
      text: localized(
        'An aborted tool call may come from turn end, steering, or cancellation; confirm the current state before treating it as work failure.',
        '工具调用中止可能来自 turn 结束、转向或取消；先确认当前状态，不要直接视为业务失败。',
      ),
    },
    {
      id: 'inbox-read', cooldownTurns: 4, tools: ['fleet_inbox'],
      text: localized(
        'Reading inbox only updates your context; do not send a read receipt unless the message requires a reply.',
        '读取 inbox 只更新你的上下文；除非消息要求答复，否则不要发送阅读回执。',
      ),
    },
    {
      id: 'send-complete', cooldownTurns: 4, tools: ['fleet_send'],
      text: localized(
        'A successful fleet_send already delivered the message; do not send a receipt or duplicate its text.',
        'fleet_send 成功即表示消息已送达；不要再发送回执或重复原文。',
      ),
    },
    {
      id: 'reply-once', cooldownTurns: 4, tools: ['fleet_reply'],
      text: localized(
        'fleet_reply is the actual answer; send it once and do not duplicate it with fleet_send or native output.',
        'fleet_reply 就是实际答复；只发送一次，不要再用 fleet_send 或原生输出重复。',
      ),
    },
    {
      id: 'task-result', cooldownTurns: 3,
      tools: ['fleet_goal', 'fleet_reconcile', 'fleet_vote', 'fleet_task'],
      text: localized(
        'Record completed work in its Fleet Task; do not leave the result only in private model output.',
        '完成工作后把结果写入对应 Fleet Task，不要只留在私有模型输出中。',
      ),
    },
    {
      id: 'result-audience', cooldownTurns: 5,
      text: localized(
        'Share a tool result only when someone needs it to continue, and use the smallest necessary audience.',
        '只有他人继续工作确实需要时才共享工具结果，并选择最小必要受众。',
      ),
    },
  ],
  'turn-end': [
    {
      id: 'visibility-member', tags: ['formal-member'],
      cooldownTurns: 0,
      text: localized(
        'Direct output remains private to this Session. Share only newly relevant content with the smallest necessary audience; otherwise end silently.',
        '直接输出仍仅在当前 Session 中可见。只向最小必要受众共享新的相关内容；否则直接结束。',
      ),
    },
    {
      id: 'visibility-assistant-user', tags: ['foreground-assistant', 'user-facing'],
      cooldownTurns: 0,
      text: localized(
        'The last native output will reach the user, not the Team. Do not duplicate it; share only newly relevant Team content with the smallest audience.',
        '最后一条原生输出会发送给用户，而不会发送给团队。不要重复发送；只向最小受众共享新的相关团队内容。',
      ),
    },
    {
      id: 'visibility-assistant-background', tags: ['foreground-assistant', 'background'],
      cooldownTurns: 0,
      text: localized(
        'Background native output reaches neither user nor Team. Send only an intentional user update or newly relevant Team content; otherwise end silently.',
        '后台原生输出不会发送给用户或团队。只发送有意的用户进展或新的相关团队内容；否则直接结束。',
      ),
    },
    {
      id: 'task-continuity', tags: ['formal-member'], cooldownTurns: 1,
      taskKinds: ['reply', 'vote', 'composite', 'inbox', 'goal', 'interaction'],
      text: localized(
        'Before ending, settle or persist your Fleet Task state; do not leave progress only in private output.',
        '结束前完成或持久化 Fleet Task 状态，不要只把进展留在私有输出中。',
      ),
    },
    {
      id: 'required-reply', tags: ['formal-member'], cooldownTurns: 1, taskKinds: ['reply'],
      text: localized(
        'If this turn requires a reply, answer once with fleet_reply and do not duplicate it elsewhere.',
        '若本轮要求答复，请只用 fleet_reply 回复一次，不要在其他位置重复。',
      ),
    },
    {
      id: 'unshared-result', tags: ['formal-member'], cooldownTurns: 2,
      text: localized(
        'Share a new result only if another member needs it to continue; otherwise end silently.',
        '只有其他成员继续工作需要时才共享新结果；否则直接结束。',
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

export function renderFleetReminderText(text: string, variables: FleetReminderVariables): string {
  const values: Readonly<Record<string, string>> = {
    name: variables.name?.trim() ?? '',
    role: variables.role?.trim() ?? '',
    responsibility: variables.responsibility?.trim() ?? '',
    language: variables.language?.trim() ?? '',
  }
  return text.replace(/\{(name|role|responsibility|language)\}/g, (_match, key: string) => values[key] ?? '')
}

export function fleetTurnReminderText(
  rule: FleetTurnReminderRule,
  locales: readonly string[],
  variables: FleetReminderVariables = {},
): string {
  return `System reminder, no reply: ${renderFleetReminderText(resolveFleetReminderText(rule.text, locales), variables)}`
}
