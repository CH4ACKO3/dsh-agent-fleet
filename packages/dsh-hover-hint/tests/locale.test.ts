import { describe, expect, it } from 'vitest'
import { resolveHoverHintLocaleCopy } from '../src/locale.js'

describe('hover hint locale copy', () => {
  it('selects Chinese explicitly and otherwise falls back to English', () => {
    const chinese = resolveHoverHintLocaleCopy('zh-CN')
    const english = resolveHoverHintLocaleCopy('en-US')
    expect(Object.keys(chinese)).toEqual(Object.keys(english))
    expect(Object.values(chinese).every(value => value.length > 0)).toBe(true)
    expect(chinese).not.toEqual(english)
    expect(resolveHoverHintLocaleCopy('de-DE')).toBe(english)
  })
})
