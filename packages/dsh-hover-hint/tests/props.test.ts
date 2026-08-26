import { describe, expectTypeOf, it } from 'vitest'
import type { HoverHintProps } from '../src/index.js'

describe('HoverHint props', () => {
  it('accepts independent wait and loading durations before and after a hint is seen', () => {
    expectTypeOf<HoverHintProps['firstHoverDelayMs']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<HoverHintProps['firstChargeDurationMs']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<HoverHintProps['seenHoverDelayMs']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<HoverHintProps['seenChargeDurationMs']>().toEqualTypeOf<number | undefined>()
  })
})
