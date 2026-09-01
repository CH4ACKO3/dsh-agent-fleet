import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FLEET_TURN_REMINDERS,
  fleetTurnReminderText,
  inferFleetReminderLocales,
  resolveFleetReminderText,
  selectFleetTurnReminder,
  type FleetTurnReminderContext,
  type FleetTurnReminderRule,
} from '../src/turn-reminders.js'

const copy = (text: string, chinese = `中文：${text}`) => ({
  default: text,
  locales: { 'zh-CN': chinese },
})

const context = (overrides: Partial<FleetTurnReminderContext> = {}): FleetTurnReminderContext => ({
  slot: 'turn-start',
  teamId: 'team-1',
  memberId: 'member-1',
  displayName: 'Alex',
  role: 'Engineer',
  responsibility: 'Build and test the service.',
  turn: 12,
  text: 'Please inspect the current reply task.',
  tools: ['fleet_inbox'],
  taskKinds: ['reply'],
  tags: ['formal-member'],
  locales: ['en'],
  ...overrides,
})

describe('Fleet turn reminders', () => {
  it('keeps independent catalogs for all three slots', () => {
    expect(DEFAULT_FLEET_TURN_REMINDERS['turn-start']).toEqual([])
    expect(DEFAULT_FLEET_TURN_REMINDERS['tool-result']).toEqual([])
    expect(DEFAULT_FLEET_TURN_REMINDERS['turn-end'].length).toBeGreaterThan(0)
  })

  it('does nothing when a slot catalog is empty', () => {
    expect(selectFleetTurnReminder([], context())).toBeUndefined()
  })

  it('prefers a context match over a generic reminder', () => {
    const rules: FleetTurnReminderRule[] = [
      { id: 'generic', text: copy('Generic.'), priority: 100 },
      { id: 'reply', text: copy('Reply rule.'), taskKinds: ['reply'] },
      { id: 'other-tool', text: copy('Other tool.'), tools: ['fleet_goal'] },
    ]
    expect(selectFleetTurnReminder(rules, context())?.rule.id).toBe('reply')
  })

  it('matches tools and keywords from the current slot context', () => {
    const rules: FleetTurnReminderRule[] = [
      { id: 'tool', text: copy('Tool rule.'), tools: ['fleet_inbox'] },
      { id: 'keyword', text: copy('Keyword rule.'), keywords: ['reply task'] },
    ]
    const selected = selectFleetTurnReminder(rules, context({ slot: 'tool-result' }))
    expect(selected?.relevant).toBe(true)
    expect(['tool', 'keyword']).toContain(selected?.rule.id)
  })

  it('honors member, role, and all required tags', () => {
    const rules: FleetTurnReminderRule[] = [
      { id: 'wrong-member', text: copy('No.'), members: ['member-2'] },
      { id: 'wrong-role', text: copy('No.'), roles: ['Reviewer'] },
      { id: 'missing-tag', text: copy('No.'), tags: ['formal-member', 'detailed'] },
      { id: 'right', text: copy('Yes.'), members: ['Alex'], roles: ['engineer'], tags: ['formal-member'] },
    ]
    expect(selectFleetTurnReminder(rules, context())?.rule.id).toBe('right')
  })

  it('uses cooldown to rotate reminders and returns nothing while every choice is cooling', () => {
    const rules: FleetTurnReminderRule[] = [
      { id: 'one', text: copy('One.'), cooldownTurns: 5 },
      { id: 'two', text: copy('Two.'), cooldownTurns: 5 },
    ]
    const first = selectFleetTurnReminder(rules, context())!
    const rotated = selectFleetTurnReminder(rules, context({ turn: 13 }), new Map([[first.rule.id, 12]]))!
    expect(rotated.rule.id).not.toBe(first.rule.id)
    expect(selectFleetTurnReminder(rules, context({ turn: 14 }), new Map([
      ['one', 13],
      ['two', 13],
    ]))).toBeUndefined()
  })

  it('uses the slot in deterministic random selection', () => {
    const rules: FleetTurnReminderRule[] = [
      { id: 'one', text: copy('One.') },
      { id: 'two', text: copy('Two.') },
      { id: 'three', text: copy('Three.') },
    ]
    expect(selectFleetTurnReminder(rules, context())?.rule.id)
      .toBe(selectFleetTurnReminder(rules, context())?.rule.id)
    expect(selectFleetTurnReminder(rules, context({ slot: 'turn-end' }))).toBeDefined()
  })

  it('resolves exact and language locale fallbacks before the default copy', () => {
    const text = {
      default: 'Default',
      locales: { zh: '中文', 'pt-BR': 'Português' },
    }
    expect(resolveFleetReminderText(text, ['pt-BR'])).toBe('Português')
    expect(resolveFleetReminderText(text, ['zh-CN'])).toBe('中文')
    expect(resolveFleetReminderText(text, ['fr'])).toBe('Default')
    expect(inferFleetReminderLocales('请检查结果')).toEqual(['zh-CN', 'zh', 'en'])
    expect(inferFleetReminderLocales('Check the result')).toEqual(['en'])
  })

  it('uses the localized short non-conversational wrapper', () => {
    expect(fleetTurnReminderText({ id: 'rule', text: copy('Use the narrow channel.', '使用最小范围。') }, ['zh-CN']))
      .toBe('System reminder, no reply: 使用最小范围。')
  })
})
