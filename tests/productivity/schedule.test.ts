import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'
import { FleetScheduler, parseFleetScheduleState } from '../../src/productivity/schedule.js'

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

describe('FleetScheduler', () => {
  it('persists a due transition before waking and does not replay one-shot schedules', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const order: string[] = []
    const scheduler = new FleetScheduler(directory, () => false, () => { order.push('wake') })
    scheduler.onEvent(event => { order.push(event.action) })
    const task = scheduler.create('agent-lead', {
      title: 'Review checkpoint', assignees: ['reviewer'], dueAt: '2026-08-21T00:01:00.000Z',
    })
    scheduler.activate()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(order.slice(-2)).toEqual(['triggered', 'wake'])
    expect(scheduler.list('agent-lead')).toContainEqual(expect.objectContaining({ id: task.id, status: 'due' }))

    const restoredWake = vi.fn()
    const restored = new FleetScheduler(directory, () => false, restoredWake)
    restored.restore(parseFleetScheduleState(scheduler.state() as never))
    restored.activate()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(restoredWake).not.toHaveBeenCalled()
    scheduler.close()
    restored.close()
  })

  it('freezes recurring schedules while paused and catches up once on activation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const wake = vi.fn()
    const scheduler = new FleetScheduler(directory, () => false, wake)
    const task = scheduler.create('agent-lead', {
      title: 'Daily coordination', dueAt: '2026-08-22T00:00:00.000Z', repeatMinutes: 24 * 60,
    })
    scheduler.activate()
    scheduler.pause()
    await vi.advanceTimersByTimeAsync(3 * 24 * 60 * 60_000)
    expect(wake).not.toHaveBeenCalled()
    scheduler.activate()
    await vi.advanceTimersByTimeAsync(0)
    expect(wake).toHaveBeenCalledOnce()
    expect(scheduler.list('agent-lead')).toContainEqual(expect.objectContaining({
      id: task.id, status: 'scheduled', dueAt: '2026-08-25T00:00:00.000Z',
    }))
    scheduler.close()
  })

  it('hands active schedules to a successor', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const scheduler = new FleetScheduler(directory, () => false, () => {})
    const task = scheduler.create('agent-reviewer', {
      title: 'Review checkpoint', assignees: ['reviewer'], dueAt: '2026-08-21T01:00:00.000Z',
    })
    scheduler.retireMember('reviewer', 'lead')
    expect(scheduler.list('agent-lead')).toContainEqual(expect.objectContaining({
      id: task.id, createdBy: 'lead', assignees: ['lead'],
    }))
  })
})
