import { describe, expect, it } from 'vitest'
import { HoverHintStack } from '../src/hint-stack.js'

describe('HoverHintStack', () => {
  it('dismisses nested hints one level at a time', () => {
    const stack = new HoverHintStack()
    const dismissal = {}

    stack.activate('parent')
    stack.activate('child')

    expect(stack.claimDismissal('parent', dismissal)).toBe(false)
    expect(stack.claimDismissal('child', dismissal)).toBe(true)

    stack.deactivate('child')
    expect(stack.claimDismissal('parent', dismissal)).toBe(false)
    expect(stack.claimDismissal('parent', {})).toBe(true)
  })

  it('restores the parent as the top hint when a child closes', () => {
    const stack = new HoverHintStack()

    stack.activate('parent')
    stack.activate('child')
    stack.deactivate('child')

    expect(stack.isTop('parent')).toBe(true)
  })

  it('moves a reactivated hint to the top without duplicating it', () => {
    const stack = new HoverHintStack()

    stack.activate('parent')
    stack.activate('child')
    stack.activate('parent')
    stack.deactivate('parent')

    expect(stack.isTop('child')).toBe(true)
  })
})
