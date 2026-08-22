import { afterEach, describe, expect, it, vi } from 'vitest'

import { FleetTaskBoard } from '../src/tasks.js'
import type { FleetMemberDirectory } from '../src/collaboration.js'

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

describe('FleetTaskBoard', () => {
  afterEach(() => { vi.useRealTimers() })

  it('manages assignments, subtasks, comments, progress, completion, and event restoration', () => {
    const events: Parameters<FleetTaskBoard['restore']>[0][number][] = []
    const board = new FleetTaskBoard(directory)
    board.onEvent(event => { events.push(event) })
    const task = board.create('agent-lead', {
      title: 'Benchmark the release',
      assignees: ['@reviewer'],
      followers: ['qa'],
      priority: 'high',
      dueAt: '2026-08-22T08:00:00+08:00',
      resources: ['res_spec'],
    })
    const child = board.create('agent-reviewer', {
      title: 'Verify benchmark inputs',
      parentId: task.id,
    })
    board.addEntry('agent-reviewer', task.id, 'progress', 'The benchmark is running.')
    board.addEntry('agent-qa', task.id, 'comment', 'Check the cold-start numbers.')
    expect(board.complete('agent-reviewer', task.id)).toMatchObject({
      status: 'completed',
      entries: [
        expect.objectContaining({ kind: 'progress' }),
        expect.objectContaining({ kind: 'comment' }),
      ],
    })
    expect(board.list('agent-lead', { parentId: task.id })).toEqual([
      expect.objectContaining({ id: child.id }),
    ])

    const restored = new FleetTaskBoard(directory)
    restored.restore(events)
    expect(restored.get('agent-qa', task.id)).toMatchObject({ status: 'completed', priority: 'high' })
    expect(restored.reopen('agent-lead', task.id).status).toBe('open')
  })

  it('limits task management to creators, assignees, or task managers', () => {
    const board = new FleetTaskBoard(directory, id => id === 'agent-qa')
    const task = board.create('agent-lead', { title: 'Prepare release notes', assignees: ['reviewer'] })

    expect(() => board.update('agent-qa', task.id, { priority: 'high' })).not.toThrow()
    expect(() => board.update('outsider', task.id, { priority: 'low' })).toThrow('not a member')
  })

  it('transfers active task ownership when a member retires', () => {
    const board = new FleetTaskBoard(directory)
    const task = board.create('agent-reviewer', {
      title: 'Complete the review', assignees: ['reviewer'], followers: ['qa'],
    })

    board.retireMember('reviewer', 'lead')
    expect(board.get('agent-lead', task.id)).toMatchObject({
      createdBy: 'lead', assignees: ['lead'], followers: ['qa'],
    })
    expect(() => board.validateReference(task.id, 'reviewer')).toThrow('not assigned')
    expect(() => board.validateReference(task.id, 'lead')).not.toThrow()
  })

  it('persists a single deadline notification and rearms restored future deadlines', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T10:00:00Z'))
    const due = vi.fn()
    const events: Parameters<FleetTaskBoard['restore']>[0][number][] = []
    const board = new FleetTaskBoard(directory, () => false, due)
    board.onEvent(event => { events.push(event) })
    const task = board.create('agent-lead', {
      title: 'Publish the report',
      assignees: ['reviewer'],
      dueAt: '2026-08-21T10:01:00Z',
    })

    await vi.advanceTimersByTimeAsync(60_000)
    expect(due).toHaveBeenCalledOnce()
    expect(board.get('agent-lead', task.id)).toMatchObject({ dueNotifiedAt: '2026-08-21T10:01:00.000Z' })

    const restoredDue = vi.fn()
    const restored = new FleetTaskBoard(directory, () => false, restoredDue)
    restored.restore(events)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(restoredDue).not.toHaveBeenCalled()
    board.close()
    restored.close()
  })

  it('keeps a deadline beyond the native timer range armed without firing early', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00Z'))
    const due = vi.fn()
    const board = new FleetTaskBoard(directory, () => false, due)
    const task = board.create('agent-lead', {
      title: 'Long-range release',
      assignees: ['reviewer'],
      dueAt: '2026-10-20T00:00:00Z',
    })

    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60_000)
    expect(due).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60_000)
    expect(due).toHaveBeenCalledOnce()
    expect(board.get('agent-lead', task.id).dueNotifiedAt).toBe('2026-10-20T00:00:00.000Z')
    board.close()
  })
})
