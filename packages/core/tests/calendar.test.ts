import { afterEach, describe, expect, it, vi } from 'vitest'

import { FleetCalendar } from '../src/calendar.js'
import type { FleetMemberDirectory } from '../src/collaboration.js'

const members = [
  { id: 'agent-lead', name: 'lead' },
  { id: 'agent-reviewer', name: 'reviewer' },
]

const directory: FleetMemberDirectory = {
  list: () => members,
  nameForAgent: id => members.find(member => member.id === id)?.name,
  resolve(reference) {
    const value = reference.startsWith('@') ? reference.slice(1) : reference
    return members.find(member => member.id === value || member.name === value)?.name
  },
}

afterEach(() => { vi.useRealTimers() })

describe('FleetCalendar', () => {
  it('persists invitations and starts a linked meeting at the scheduled time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const events: Parameters<FleetCalendar['restore']>[0][number][] = []
    const started: string[] = []
    const calendar = new FleetCalendar(directory, event => {
      started.push(event.id)
      return `meeting-${event.occurrence}`
    })
    calendar.onEvent(event => { events.push(event) })
    const event = calendar.create('agent-lead', {
      title: 'Architecture review',
      agenda: 'Review the service boundaries.',
      attendees: ['@reviewer'],
      startAt: '2026-08-21T00:01:00.000Z',
      endAt: '2026-08-21T00:31:00.000Z',
    })
    calendar.rsvp('agent-reviewer', event.id, 'accepted')
    vi.advanceTimersByTime(60_000)

    expect(started).toEqual([event.id])
    expect(calendar.get('agent-reviewer', event.id)).toMatchObject({
      status: 'open',
      meetingId: 'meeting-1',
      rsvps: { reviewer: 'accepted' },
    })
    const restored = new FleetCalendar(directory, () => undefined)
    restored.restore(events)
    expect(restored.get('agent-lead', event.id).meetingId).toBe('meeting-1')
    restored.close()
  })

  it('reports member free/busy and supports cancellation', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const calendar = new FleetCalendar(directory, () => undefined)
    const event = calendar.create('agent-lead', {
      title: 'Review', agenda: 'Review.', attendees: ['reviewer'],
      startAt: '2026-08-21T01:00:00.000Z', endAt: '2026-08-21T02:00:00.000Z',
    })
    expect(calendar.freeBusy('agent-lead', ['reviewer'], '2026-08-21T00:30:00Z', '2026-08-21T01:30:00Z')[0]?.events)
      .toHaveLength(1)
    expect(calendar.cancel('agent-lead', event.id).status).toBe('cancelled')
    calendar.close()
  })

  it('transfers organizers and cancels events with no remaining attendees', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const calendar = new FleetCalendar(directory, () => undefined)
    const event = calendar.create('agent-reviewer', {
      title: 'Handoff', agenda: 'Transfer the event.', attendees: ['lead'],
      startAt: '2026-08-21T01:00:00.000Z',
    })

    calendar.retireMember('reviewer', 'lead')
    expect(calendar.get('agent-lead', event.id)).toMatchObject({
      organizer: 'lead', attendees: [], status: 'cancelled',
    })
    calendar.close()
  })

  it('keeps recurring events stable over a year and cancels their timer on close', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const occurrences: number[] = []
    const calendar = new FleetCalendar(directory, event => {
      occurrences.push(event.occurrence)
      return `meeting-${event.occurrence}`
    })
    const event = calendar.create('agent-lead', {
      title: 'Weekly review',
      agenda: 'Review ongoing work.',
      attendees: ['reviewer'],
      startAt: '2026-08-28T00:00:00.000Z',
      repeatMinutes: 7 * 24 * 60,
    })

    vi.advanceTimersByTime(52 * 7 * 24 * 60 * 60_000)
    expect(occurrences).toHaveLength(52)
    expect(calendar.get('agent-lead', event.id)).toMatchObject({
      occurrence: 52,
      status: 'scheduled',
      startAt: '2027-08-27T00:00:00.000Z',
    })

    calendar.close()
    vi.advanceTimersByTime(52 * 7 * 24 * 60 * 60_000)
    expect(occurrences).toHaveLength(52)
  })
})
