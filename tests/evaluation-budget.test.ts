import { describe, expect, it } from 'vitest'
import { bindEvaluationBudget } from '../src/evaluation-budget.js'

describe('host evaluation budget', () => {
  it.each([30, 120])('uses the actual %i-minute clock without changing task or roster', minutes => {
    const source = { core: { members: [{ id: 'auditor' }] }, modules: {
      'dsh-agent-fleet/message': { rules: 'Review independently.', defaultChannel: { id: 'main' } },
    } }
    const copy = structuredClone(source)
    const result = bindEvaluationBudget(source, minutes * 60000, '2026-09-17T09:00:00.000Z')
    expect(result.instruction).toContain(`${minutes} minutes (${minutes * 60000} ms)`)
    expect(Date.parse(result.deadlineAt) - Date.parse('2026-09-17T09:00:00.000Z')).toBe(minutes * 60000)
    expect(source).toEqual(copy)
    expect(result.team.core).toEqual(source.core)
    expect(result.team.modules).toMatchObject({ 'dsh-agent-fleet/message': { defaultChannel: { id: 'main' } } })
    expect(JSON.stringify(result.team)).toContain('Review independently.')
    expect(JSON.stringify(result.team)).toContain('[Host evaluation budget]')
  })
})
