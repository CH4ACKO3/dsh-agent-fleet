import { describe, expect, it } from 'vitest'

import {
  fleetTurnReminderText,
  selectFleetTurnReminder,
  type FleetTurnReminderContext,
  type FleetTurnReminderRule,
} from '../src/turn-reminders.js'

const context = (overrides: Partial<FleetTurnReminderContext> = {}): FleetTurnReminderContext => ({
  teamId: 'team-1',
  memberId: 'member-1',
  displayName: 'Alex',
  role: 'Engineer',
  responsibility: 'Build and test the service.',
  turn: 12,
  text: 'Please inspect the current reply task.',
  tools: ['fleet_inbox'],
  taskKinds: ['reply'],
  ...overrides,
})

describe('Fleet turn reminders', () => {
  it('does nothing while the production reminder catalog is empty', () => {
    expect(selectFleetTurnReminder([], context())).toBeUndefined()
  })

  it('prefers a context match over a generic reminder', () => {
    const rules: FleetTurnReminderRule[] = [
      { id: 'generic', text: 'Generic.', priority: 100 },
      { id: 'reply', text: 'Reply rule.', taskKinds: ['reply'] },
      { id: 'other-tool', text: 'Other tool.', tools: ['fleet_goal'] },
    ]
    expect(selectFleetTurnReminder(rules, context())?.rule.id).toBe('reply')
  })

  it('matches tools and keywords from the current turn context', () => {
    const rules: FleetTurnReminderRule[] = [
      { id: 'tool', text: 'Tool rule.', tools: ['fleet_inbox'] },
      { id: 'keyword', text: 'Keyword rule.', keywords: ['reply task'] },
    ]
    const selected = selectFleetTurnReminder(rules, context())
    expect(selected?.relevant).toBe(true)
    expect(['tool', 'keyword']).toContain(selected?.rule.id)
  })

  it('honors member and role applicability', () => {
    const rules: FleetTurnReminderRule[] = [
      { id: 'wrong-member', text: 'No.', members: ['member-2'] },
      { id: 'wrong-role', text: 'No.', roles: ['Reviewer'] },
      { id: 'right', text: 'Yes.', members: ['Alex'], roles: ['engineer'] },
    ]
    expect(selectFleetTurnReminder(rules, context())?.rule.id).toBe('right')
  })

  it('uses cooldown to rotate reminders and relaxes it when every choice is cooling', () => {
    const rules: FleetTurnReminderRule[] = [
      { id: 'one', text: 'One.', cooldownTurns: 5 },
      { id: 'two', text: 'Two.', cooldownTurns: 5 },
    ]
    const first = selectFleetTurnReminder(rules, context())!
    const rotated = selectFleetTurnReminder(rules, context({ turn: 13 }), new Map([[first.rule.id, 12]]))!
    expect(rotated.rule.id).not.toBe(first.rule.id)

    const relaxed = selectFleetTurnReminder(rules, context({ turn: 14 }), new Map([
      ['one', 13],
      ['two', 13],
    ]))
    expect(relaxed).toBeDefined()
  })

  it('is deterministic for the same Team, member, and turn', () => {
    const rules: FleetTurnReminderRule[] = [
      { id: 'one', text: 'One.' },
      { id: 'two', text: 'Two.' },
      { id: 'three', text: 'Three.' },
    ]
    expect(selectFleetTurnReminder(rules, context())?.rule.id)
      .toBe(selectFleetTurnReminder(rules, context())?.rule.id)
  })

  it('uses the short non-conversational wrapper', () => {
    expect(fleetTurnReminderText({ id: 'rule', text: '  Use the narrow channel.  ' }))
      .toBe('Reminder, no reply: Use the narrow channel.')
  })
})
