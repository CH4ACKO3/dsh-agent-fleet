import { describe, expect, it } from 'vitest'
import { contextCeilingDirectiveText } from '../src/context-checkpoint.js'

describe('context checkpoints preserve research and review continuity', () => {
  it.each([false, true])('does not impose a new deadline before/after compaction: %s', recovered => {
    const text = contextCeilingDirectiveText(17000, 16000, recovered)
    expect(text).toContain('Keep the current Work active')
    expect(text).toContain('Continue research, new searches, new Tasks and review/rework')
    expect(text).toContain('actual configured time and token budgets')
    expect(text).not.toMatch(/Wrap up now|Do not open|Continue only if|last action before you stop/i)
  })
})
