import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'
import { FleetTaskBoard, installTaskTools, parseFleetTaskState } from '../../src/productivity/task.js'

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

  it('migrates version 1 Tasks into covered version 2 execution states', () => {
    const board = new FleetTaskBoard(directory)
    const current = board.create('agent-lead', { title: 'Legacy runnable task', assignees: ['reviewer'] })
    const { decision: _decision, timeouts: _timeouts, execution: _execution, ...legacy } = current
    const migrated = parseFleetTaskState({ version: 1, tasks: [legacy] } as never)
    expect(migrated).toMatchObject({
      version: 2,
      tasks: [{ id: current.id, decision: 'direct', timeouts: {}, execution: { kind: 'ready' } }],
    })
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
    expect(() => restored.complete('agent-qa', task.id, { finalReply: 'Inspection passed.' }))
      .toThrow('already completed; completing it again does not complete another task')
    expect(finalReplies).toEqual(['Inspection passed.'])
    expect(restored.pendingRequirement('qa')).toBeUndefined()
  })

  it('lets an assignee complete only their own message requirement without task.update', async () => {
    const board = new FleetTaskBoard(directory)
    const required = board.ensureMessageTask({
      messageId: 'msg_required', conversation: '@reviewer', createdBy: 'lead', assignee: 'reviewer',
      title: 'Required reply', description: 'Return a final answer.',
    })
    const ordinary = board.create('agent-lead', { title: 'Ordinary task', assignees: ['reviewer'] })
    const registered: Array<{
      readonly name: string
      readonly execute: (args: Record<string, unknown>, exec: unknown) => unknown
    }> = []
    installTaskTools({
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} } },
    } as never, board, (_agentId, action) => action === 'task.read')
    const tool = registered.find(candidate => candidate.name === 'fleet_task')
    if (tool === undefined) throw new Error('expected fleet_task')

    await expect(tool.execute(
      { action: 'complete', id: required.id, final_reply: 'Completed result.' },
      { agent: { id: 'agent-reviewer' } },
    )).resolves.toMatchObject({ task: { status: 'completed' } })
    await expect(async () => tool.execute(
      { action: 'complete', id: ordinary.id },
      { agent: { id: 'agent-reviewer' } },
    )).rejects.toThrow('not authorized for task.update')
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

  it('settles each claimed attempt into a durable successor before invalidating it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const board = new FleetTaskBoard(directory)
    const task = board.create('agent-lead', {
      title: 'Implement release', assignees: ['reviewer'],
      timeouts: { readySeconds: 60, runningSeconds: 120, eventSeconds: 180 },
    })
    expect(task.execution).toMatchObject({
      kind: 'ready', timeoutAt: '2026-08-21T00:01:00.000Z',
    })

    const claimed = board.claim('agent-reviewer', task.id)
    expect(claimed.execution).toMatchObject({
      kind: 'running', actor: 'reviewer', timeoutAt: '2026-08-21T00:02:00.000Z',
    })
    if (claimed.execution.kind !== 'running') throw new Error('expected running attempt')
    const settled = board.settle('agent-reviewer', task.id, {
      attemptId: claimed.execution.attemptId,
      progress: 'Implementation checkpoint saved.',
      next: { kind: 'ready', reason: 'Run the focused verification.' },
    })
    expect(settled).toMatchObject({
      status: 'in_progress',
      execution: { kind: 'ready', reason: 'Run the focused verification.', timeoutAt: '2026-08-21T00:01:00.000Z' },
      entries: [expect.objectContaining({ kind: 'progress', text: 'Implementation checkpoint saved.' })],
    })
    expect(() => board.settle('agent-reviewer', task.id, {
      attemptId: claimed.execution.attemptId,
      progress: 'Late duplicate.',
      next: { kind: 'completed', result: 'Should not win.' },
    })).toThrow('is no longer current')
  })

  it('resumes time and event waits without keeping an Agent turn active', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const board = new FleetTaskBoard(directory)
    board.activate()
    const timed = board.create('agent-lead', { title: 'Check later', assignees: ['reviewer'] })
    const first = board.claim('agent-reviewer', timed.id)
    if (first.execution.kind !== 'running') throw new Error('expected running attempt')
    board.settle('agent-reviewer', timed.id, {
      attemptId: first.execution.attemptId,
      progress: 'Remote job started.',
      next: { kind: 'waiting_time', wakeAt: '2026-08-21T00:01:00.000Z' },
    })
    expect(board.get('agent-reviewer', timed.id).execution.kind).toBe('waiting_time')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(board.get('agent-reviewer', timed.id).execution).toMatchObject({
      kind: 'ready', reason: expect.stringContaining('Scheduled continuation'),
    })

    const eventTask = board.create('agent-lead', {
      title: 'Wait for deployment', assignees: ['reviewer'], timeouts: { eventSeconds: 120 },
    })
    const second = board.claim('agent-reviewer', eventTask.id)
    if (second.execution.kind !== 'running') throw new Error('expected running attempt')
    expect(board.signalEvent(eventTask.id, 'deployment:42:completed', 'Deployment 42 completed.')).toMatchObject({
      execution: { kind: 'running' },
      signals: [{ eventKey: 'deployment:42:completed', result: 'Deployment 42 completed.' }],
    })
    const eventSettled = board.settle('agent-reviewer', eventTask.id, {
      attemptId: second.execution.attemptId,
      progress: 'Deployment operation recorded.',
      next: { kind: 'waiting_event', eventKey: 'deployment:42:completed' },
    })
    expect(eventSettled.execution).toMatchObject({
      kind: 'ready', reason: 'Deployment 42 completed.',
    })
    board.close()
  })

  it('turns ready, running, and event timeouts into reconciliation attempts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const board = new FleetTaskBoard(directory)
    board.activate()
    const task = board.create('agent-lead', {
      title: 'Recover every stalled phase', assignees: ['reviewer'],
      timeouts: { readySeconds: 10, runningSeconds: 20, eventSeconds: 30 },
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(board.get('agent-reviewer', task.id).execution).toMatchObject({
      kind: 'ready', reason: expect.stringContaining('ready timed out'),
    })

    const running = board.claim('agent-reviewer', task.id)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(board.get('agent-reviewer', task.id).execution).toMatchObject({
      kind: 'ready', reason: expect.stringContaining('running timed out'),
    })
    if (running.execution.kind !== 'running') throw new Error('expected running attempt')
    expect(() => board.settle('agent-reviewer', task.id, {
      attemptId: running.execution.attemptId,
      progress: 'Late result.', next: { kind: 'completed', result: 'Late.' },
    })).toThrow('is no longer current')

    const waiting = board.claim('agent-qa', task.id)
    if (waiting.execution.kind !== 'running') throw new Error('expected running attempt')
    expect(waiting.execution.actor).toBe('qa')
    board.settle('agent-qa', task.id, {
      attemptId: waiting.execution.attemptId,
      progress: 'Waiting for build event.', next: { kind: 'waiting_event', eventKey: 'build:9' },
    })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(board.get('agent-reviewer', task.id).execution).toMatchObject({
      kind: 'ready', reason: expect.stringContaining('waiting_event timed out'),
    })
    board.close()
  })

  it('uses a Vote as the continuation event for collaborative completion', () => {
    const requests: Array<{ id: string; voters?: readonly string[] }> = []
    const board = new FleetTaskBoard(
      directory,
      () => false,
      () => {},
      () => {},
      (_callerId, _task, request) => {
        requests.push({ id: request.id, ...(request.voters === undefined ? {} : { voters: request.voters }) })
        return { id: request.id, status: 'open' }
      },
    )
    const task = board.create('agent-lead', {
      title: 'Approve release result', assignees: ['reviewer'], reviewers: ['qa'], decision: 'vote',
    })
    expect(() => board.complete('agent-reviewer', task.id)).toThrow('requires an approved completion Vote')
    const claimed = board.claim('agent-reviewer', task.id)
    if (claimed.execution.kind !== 'running') throw new Error('expected running attempt')
    const waiting = board.settle('agent-reviewer', task.id, {
      attemptId: claimed.execution.attemptId,
      progress: 'Release evidence assembled.',
      next: { kind: 'vote', decision: 'complete', channel: '#general', statement: 'Release evidence is sufficient.' },
    })
    expect(waiting.execution).toMatchObject({ kind: 'waiting_vote', decision: 'complete' })
    expect(requests).toEqual([{ id: expect.stringContaining(`task_vote_${task.id}_`), voters: ['qa'] }])
    if (waiting.execution.kind !== 'waiting_vote') throw new Error('expected Vote wait')
    expect(board.resolveVote({ id: waiting.execution.voteId, status: 'approved' })).toMatchObject({
      status: 'completed', execution: { kind: 'completed', result: expect.stringContaining('Approved by Vote') },
    })
  })

  it('releases an un-settled turn back to one durable ready continuation', () => {
    const board = new FleetTaskBoard(directory)
    const task = board.create('agent-lead', { title: 'Do not lose this turn', assignees: ['reviewer'] })
    const claimed = board.claim('agent-reviewer', task.id)
    if (claimed.execution.kind !== 'running') throw new Error('expected running attempt')
    expect(board.releaseRunning('reviewer', 'model turn ended')).toHaveLength(1)
    expect(board.get('agent-reviewer', task.id).execution).toMatchObject({
      kind: 'ready', reason: expect.stringContaining(claimed.execution.attemptId),
    })
    expect(() => board.settle('agent-reviewer', task.id, {
      attemptId: claimed.execution.attemptId,
      progress: 'Late settlement.', next: { kind: 'completed', result: 'Late.' },
    })).toThrow('is no longer current')
  })
})
