import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'
import { FleetCalendar, parseFleetCalendarState } from '../../src/productivity/calendar.js'

const members = [{ id: 'agent-lead', name: 'lead' }, { id: 'agent-reviewer', name: 'reviewer' }]
const directory: FleetMemberDirectory = {
  list: () => members,
  nameForAgent: id => members.find(member => member.id === id)?.name,
  resolve: reference => {
    const value = reference.startsWith('@') ? reference.slice(1) : reference
    return members.find(member => member.id === value || member.name === value)?.name
  },
}

afterEach(() => { vi.useRealTimers() })

describe('FleetCalendar', () => {
  it('persists RSVP and links a Meeting only after activation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const starts: number[] = []
    const calendar = new FleetCalendar(directory, event => {
      starts.push(event.occurrence)
      return `meeting-${event.occurrence}`
    })
    const event = calendar.create('agent-lead', {
      title: 'Architecture review', agenda: 'Review boundaries.', attendees: ['reviewer'],
      startAt: '2026-08-21T00:01:00.000Z', endAt: '2026-08-21T00:31:00.000Z',
    })
    calendar.rsvp('agent-reviewer', event.id, 'accepted')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(starts).toEqual([])
    calendar.activate()
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual([1])
    expect(calendar.get('agent-reviewer', event.id)).toMatchObject({ status: 'open', meetingId: 'meeting-1' })

    const restored = new FleetCalendar(directory, () => undefined)
    restored.restore(parseFleetCalendarState(calendar.state() as never))
    expect(restored.get('agent-lead', event.id)).toMatchObject({ meetingId: 'meeting-1', rsvps: { reviewer: 'accepted' } })
    calendar.close()
    restored.close()
  })

  it('freezes timers while paused and retries an unlinked Meeting after a member returns', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    let available = false
    const calendar = new FleetCalendar(directory, event => available ? `meeting-${event.occurrence}` : undefined)
    const event = calendar.create('agent-lead', {
      title: 'Handoff', agenda: 'Transfer work.', attendees: ['reviewer'], startAt: '2026-08-21T00:01:00.000Z',
    })
    calendar.activate()
    calendar.pause()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calendar.get('agent-lead', event.id).status).toBe('scheduled')
    calendar.activate()
    await vi.advanceTimersByTimeAsync(0)
    expect(calendar.get('agent-lead', event.id).status).toBe('open')
    expect(calendar.get('agent-lead', event.id).meetingId).toBeUndefined()
    available = true
    calendar.retryPendingStarts()
    expect(calendar.get('agent-lead', event.id).meetingId).toBe('meeting-1')
    calendar.close()
  })

  it('reports free/busy and transfers or cancels events when members retire', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const calendar = new FleetCalendar(directory, () => undefined)
    const event = calendar.create('agent-reviewer', {
      title: 'Review', agenda: 'Review.', attendees: ['lead'],
      startAt: '2026-08-21T01:00:00.000Z', endAt: '2026-08-21T02:00:00.000Z',
    })
    expect(calendar.freeBusy('agent-lead', ['reviewer'], '2026-08-21T00:30:00Z', '2026-08-21T01:30:00Z')[0]?.events).toHaveLength(1)
    calendar.retireMember('reviewer', 'lead')
    expect(calendar.get('agent-lead', event.id)).toMatchObject({ organizer: 'lead', attendees: [], status: 'cancelled' })
  })
})
