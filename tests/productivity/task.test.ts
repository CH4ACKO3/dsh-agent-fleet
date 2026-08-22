import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'
import { FleetTaskBoard, parseFleetTaskState } from '../../src/productivity/task.js'

const members = [
  { id: 'agent-lead', name: 'lead' },
  { id: 'agent-reviewer', name: 'reviewer' },
  { id: 'agent-qa', name: 'qa' },
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

describe('FleetTaskBoard', () => {
  it('supports owners, reviewers, dependencies, entries, and snapshot restoration', () => {
    const board = new FleetTaskBoard(directory)
    const prerequisite = board.create('agent-lead', { title: 'Prepare inputs', assignees: ['lead'] })
    const task = board.create('agent-lead', {
      title: 'Review release', assignees: ['reviewer'], reviewers: ['qa'], dependencies: [prerequisite.id],
    })
    board.addEntry('agent-reviewer', task.id, 'progress', 'Review started.')
    board.addEntry('agent-qa', task.id, 'comment', 'Please check the cold start.')

    expect(() => board.complete('agent-qa', task.id)).toThrow('incomplete dependencies')
    expect(() => board.update('agent-lead', prerequisite.id, { dependencies: [task.id] })).toThrow('create a cycle')
    board.complete('agent-lead', prerequisite.id)
    expect(board.complete('agent-qa', task.id)).toMatchObject({
      status: 'completed', entries: [expect.objectContaining({ kind: 'progress' }), expect.objectContaining({ kind: 'comment' })],
    })

    const restored = new FleetTaskBoard(directory)
    restored.restore(parseFleetTaskState(board.state() as never))
    expect(restored.get('agent-reviewer', task.id)).toMatchObject({ status: 'completed', reviewers: ['qa'] })
    expect(restored.reopen('agent-qa', task.id).status).toBe('open')
  })

  it('transfers active responsibilities when a member retires', () => {
    const board = new FleetTaskBoard(directory)
    const task = board.create('agent-reviewer', {
      title: 'Complete review', assignees: ['reviewer'], reviewers: ['reviewer'], followers: ['qa'],
    })
    board.retireMember('reviewer', 'lead')
    expect(board.get('agent-lead', task.id)).toMatchObject({
      createdBy: 'lead', assignees: ['lead'], reviewers: ['lead'], followers: ['qa'],
    })
  })

  it('freezes deadline timers while paused and persists before waking', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const order: string[] = []
    const board = new FleetTaskBoard(directory, () => false, () => { order.push('wake') })
    board.onEvent(event => { order.push(event.action) })
    const task = board.create('agent-lead', {
      title: 'Publish report', assignees: ['reviewer'], dueAt: '2026-08-21T00:01:00.000Z',
    })
    board.activate()
    board.pause()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(order).not.toContain('wake')

    board.activate()
    await vi.advanceTimersByTimeAsync(0)
    expect(order.slice(-2)).toEqual(['due', 'wake'])
    expect(board.get('agent-lead', task.id).dueNotifiedAt).toBe('2026-08-21T00:02:00.000Z')
    board.close()
  })
})
