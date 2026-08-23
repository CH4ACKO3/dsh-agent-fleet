import { describe, expect, it } from 'vitest'
import { hasSeenHint, markHintSeen, subscribeSeenHints } from '../src/seen-marker.js'

describe('hover hint seen markers', () => {
  it('marks a hint once and notifies mounted instances', () => {
    const marker = `hint-${crypto.randomUUID()}`
    let notifications = 0
    const unsubscribe = subscribeSeenHints(() => { notifications += 1 })

    expect(hasSeenHint(marker)).toBe(false)
    markHintSeen(marker)
    markHintSeen(marker)

    expect(hasSeenHint(marker)).toBe(true)
    expect(notifications).toBe(1)
    unsubscribe()
  })

  it('does not track hints without a marker', () => {
    expect(hasSeenHint(undefined)).toBe(false)
  })
})
