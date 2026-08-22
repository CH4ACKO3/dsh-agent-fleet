import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FleetMemberStatusBoard,
  FleetScheduler,
} from '../src/collaboration.js'
import type {
  FleetMemberDirectory,
  FleetMemberStatusEvent,
  FleetScheduledTask,
  FleetScheduledTaskEvent,
} from '../src/collaboration.js'

const members = [
  { id: 'agent-lead', name: 'lead' },
  { id: 'agent-reviewer', name: 'reviewer' },
]

const directory: FleetMemberDirectory = {
  list: () => members,
  nameForAgent: id => members.find(entry => entry.id === id)?.name,
  resolve(reference) {
    const value = reference.startsWith('@') ? reference.slice(1) : reference
    return members.find(entry => entry.name === value || entry.id === value)?.name
  },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('FleetMemberStatusBoard', () => {
  it('lets members maintain their own status while peers can read it', () => {
    const board = new FleetMemberStatusBoard(directory)

    expect(board.set('agent-lead', 'Preparing the release plan')).toMatchObject({
      member: 'lead',
      message: 'Preparing the release plan',
    })
    expect(board.get('agent-reviewer', '@lead')).toMatchObject({
      member: 'lead',
      message: 'Preparing the release plan',
    })
    expect(board.list('agent-reviewer')).toEqual(expect.arrayContaining([
      expect.objectContaining({ member: 'lead', message: 'Preparing the release plan' }),
      { member: 'reviewer', message: '' },
    ]))
    expect(() => board.set('outsider', 'Working elsewhere')).toThrow('not a member')
    expect(() => board.set('agent-lead', 'x'.repeat(241))).toThrow('cannot exceed 240 characters')
  })

  it('restores updates and clears without re-emitting them', () => {
    const events: FleetMemberStatusEvent[] = []
    const board = new FleetMemberStatusBoard(directory)
    board.onEvent(event => { events.push(event) })
    board.set('agent-lead', 'Waiting for review')
    board.clear('agent-lead')

    const restoredEvents: FleetMemberStatusEvent[] = []
    const restored = new FleetMemberStatusBoard(directory)
    restored.onEvent(event => { restoredEvents.push(event) })
    restored.restore(events)

    expect(restored.get('agent-reviewer', 'lead')).toEqual({
      member: 'lead',
      message: '',
    })
    expect(restoredEvents).toEqual([])
  })

  it('restores the text from older status events without reviving availability state', () => {
    const board = new FleetMemberStatusBoard(directory)
    board.restore([{
      action: 'updated',
      status: {
        member: 'lead',
        message: 'Reviewing the solver output',
        availability: 'focused',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
    } as unknown as FleetMemberStatusEvent])

    expect(board.get('agent-reviewer', 'lead')).toEqual({
      member: 'lead',
      message: 'Reviewing the solver output',
      updatedAt: '2026-08-22T00:00:00.000Z',
    })
  })
})

describe('FleetScheduler', () => {
  it('transfers active scheduled work when a member retires', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const scheduler = new FleetScheduler(directory, () => {})
    const task = scheduler.create('agent-reviewer', {
      title: 'Review checkpoint', assignees: ['reviewer'], dueAt: '2026-08-21T01:00:00.000Z',
    })

    scheduler.retireMember('reviewer', 'lead')
    expect(scheduler.list('agent-lead').find(candidate => candidate.id === task.id)).toMatchObject({
      createdBy: 'lead', assignees: ['lead'], status: 'scheduled',
    })
    scheduler.close()
  })

  it('persists a task transition before waking assigned members', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const order: string[] = []
    const events: FleetScheduledTaskEvent[] = []
    const woken: FleetScheduledTask[] = []
    const scheduler = new FleetScheduler(directory, task => {
      order.push('wake')
      woken.push(task)
    })
    scheduler.onEvent(event => {
      events.push(event)
      order.push(event.action)
    })

    const task = scheduler.create('agent-lead', {
      title: 'Review checkpoint',
      instructions: 'Review the current changes and post findings.',
      assignees: ['@reviewer'],
      dueAt: '2026-08-21T00:01:00.000Z',
    })
    vi.advanceTimersByTime(60_000)

    expect(woken).toHaveLength(1)
    expect(woken[0]).toMatchObject({ id: task.id, status: 'due', assignees: ['reviewer'] })
    expect(order.slice(-2)).toEqual(['triggered', 'wake'])
    expect(scheduler.list('agent-lead').find(candidate => candidate.id === task.id)?.status).toBe('due')
    scheduler.close()
  })

  it('restores pending tasks and does not replay a triggered one-shot task', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const events: FleetScheduledTaskEvent[] = []
    const original = new FleetScheduler(directory, () => {})
    original.onEvent(event => { events.push(event) })
    original.create('agent-lead', {
      title: 'Stand-up',
      dueAt: '2026-08-21T00:01:00.000Z',
    })
    vi.advanceTimersByTime(60_000)
    original.close()

    let wakes = 0
    const restored = new FleetScheduler(directory, () => { wakes += 1 })
    const restoredEvents: FleetScheduledTaskEvent[] = []
    restored.onEvent(event => { restoredEvents.push(event) })
    restored.restore(events)
    vi.advanceTimersByTime(24 * 60 * 60_000)

    expect(wakes).toBe(0)
    expect(restoredEvents).toEqual([])
    expect(restored.list('agent-reviewer')[0]?.status).toBe('due')
    restored.close()
  })

  it('allows creators or assignees to finish a task and rejects unrelated members', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const scheduler = new FleetScheduler(directory, () => {})
    const task = scheduler.create('agent-lead', {
      title: 'Prepare review',
      assignees: ['lead'],
      dueAt: '2026-08-21T01:00:00.000Z',
    })

    expect(() => scheduler.complete('agent-reviewer', task.id)).toThrow('not responsible')
    expect(scheduler.complete('agent-lead', task.id).status).toBe('completed')
    scheduler.close()
  })

  it('keeps one recurring timer stable across many occurrences and stops it on close', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const woken: FleetScheduledTask[] = []
    const scheduler = new FleetScheduler(directory, task => { woken.push(task) })
    const task = scheduler.create('agent-lead', {
      title: 'Daily coordination',
      dueAt: '2026-08-22T00:00:00.000Z',
      repeatMinutes: 24 * 60,
    })

    vi.advanceTimersByTime(90 * 24 * 60 * 60_000)
    expect(woken).toHaveLength(90)
    expect(scheduler.list('agent-lead').find(candidate => candidate.id === task.id)).toMatchObject({
      status: 'scheduled',
      dueAt: '2026-11-20T00:00:00.000Z',
    })

    scheduler.close()
    vi.advanceTimersByTime(365 * 24 * 60 * 60_000)
    expect(woken).toHaveLength(90)
  })
})
