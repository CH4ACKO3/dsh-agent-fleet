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

    expect(() => board.complete('agent-qa', task.id)).toThrow('cannot manage task')
    expect(() => board.complete('agent-reviewer', task.id)).toThrow('incomplete dependencies')
    expect(() => board.update('agent-lead', prerequisite.id, { dependencies: [task.id] })).toThrow('create a cycle')
    board.complete('agent-lead', prerequisite.id)
    expect(board.complete('agent-reviewer', task.id)).toMatchObject({
      status: 'completed', entries: [expect.objectContaining({ kind: 'progress' }), expect.objectContaining({ kind: 'comment' })],
    })

    const restored = new FleetTaskBoard(directory)
    restored.restore(parseFleetTaskState(board.state() as never))
    expect(restored.get('agent-reviewer', task.id)).toMatchObject({ status: 'completed', reviewers: ['qa'] })
    expect(() => restored.reopen('agent-qa', task.id)).toThrow('cannot manage task')
    expect(restored.reopen('agent-reviewer', task.id).status).toBe('open')
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

  it('persists and deduplicates must-complete tasks promoted from messages', () => {
    const finalReplies: string[] = []
    const completeRequirement = (_callerId: string, _task: unknown, finalReply: string) => {
      finalReplies.push(finalReply)
      return { messageId: 'msg_final' }
    }
    const board = new FleetTaskBoard(directory, () => false, () => {}, completeRequirement)
    const task = board.ensureMessageTask({
      messageId: 'msg_42', conversation: '#main', createdBy: 'lead', assignee: 'reviewer', replyTarget: '#main',
      title: 'Required from @lead: inspect the release', description: 'Inspect the release.',
      resources: ['document:release'],
    })
    expect(board.ensureMessageTask({
      messageId: 'msg_42', conversation: '#main', createdBy: 'lead', assignee: 'reviewer',
      title: 'Duplicate delivery',
    }).id).toBe(task.id)
    expect(board.pendingRequirement('agent-reviewer')).toMatchObject({
      id: task.id, priority: 'high', assignees: ['reviewer'], followers: ['lead'],
      requirement: { kind: 'message', messageId: 'msg_42', conversation: '#main', assignee: 'reviewer', replyTarget: '#main' },
    })
    expect(() => board.update('agent-reviewer', task.id, { status: 'cancelled' }))
      .toThrow('must be completed')
    expect(() => board.update('agent-reviewer', task.id, { assignees: ['qa'] }))
      .toThrow('cannot be reassigned')
    board.retireMember('reviewer', 'qa')
    expect(board.pendingRequirement('qa')).toMatchObject({
      id: task.id, assignees: ['qa'], requirement: { assignee: 'qa' },
    })

    const restored = new FleetTaskBoard(directory, () => false, () => {}, completeRequirement)
    restored.restore(parseFleetTaskState(board.state() as never))
    expect(restored.pendingRequirement('qa')?.id).toBe(task.id)
    expect(() => restored.complete('agent-qa', task.id)).toThrow('required task final reply cannot be empty')
    expect(restored.complete('agent-qa', task.id, { finalReply: 'Inspection passed.' })).toMatchObject({
      status: 'completed', requirement: { completionMessageId: 'msg_final' },
    })
    expect(finalReplies).toEqual(['Inspection passed.'])
    expect(restored.pendingRequirement('qa')).toBeUndefined()
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

  it('persists missed deadline delivery and replays it when the assignee returns', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    let online = false
    const deliveries: string[][] = []
    const board = new FleetTaskBoard(directory, () => false, (_task, recipients) => {
      deliveries.push([...recipients])
      return online ? recipients : []
    })
    const task = board.create('agent-lead', {
      title: 'Publish report', assignees: ['reviewer'], dueAt: '2026-08-21T00:01:00.000Z',
    })
    board.activate()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(board.get('agent-lead', task.id).duePendingFor).toEqual(['reviewer'])
    online = true
    board.replayPending('reviewer')
    expect(deliveries).toEqual([['reviewer'], ['reviewer']])
    expect(board.get('agent-lead', task.id).duePendingFor).toEqual([])
    board.close()
  })
})
