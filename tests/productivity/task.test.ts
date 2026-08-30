import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'
import type { FleetTaskReconcilerSpec } from '../../src/productivity/task.js'
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

function reconciler(
  target: string,
  when: FleetTaskReconcilerSpec['when'] = { kind: 'on_enter' },
  overrides: Partial<FleetTaskReconcilerSpec> = {},
): FleetTaskReconcilerSpec {
  return {
    id: 'continue', when, target, priority: 0, retryAfterSeconds: 0, maxWakeups: 3,
    onTimeout: { kind: 'blocked', reason: 'Reconciliation exhausted.' },
    ...overrides,
  }
}

function settleCompleted(board: FleetTaskBoard, actor: string, taskId: string, result = 'Done.') {
  const claimed = board.claim(actor, taskId)
  const attempt = claimed.activeReconcile?.attemptId
  if (attempt === undefined) throw new Error('expected running ReconcileAttempt')
  return board.settle(actor, taskId, {
    attemptId: attempt,
    progress: result,
    next: { kind: 'completed', result },
  })
}

afterEach(() => { vi.useRealTimers() })

describe('FleetTaskBoard v5', () => {
  it('accepts only the breaking v5 persistence format', () => {
    expect(parseFleetTaskState(undefined)).toEqual({ version: 5, tasks: [] })
    expect(() => parseFleetTaskState({ version: 4, tasks: [] } as never)).toThrow('version is incompatible')

    const board = new FleetTaskBoard(directory)
    const task = board.create('agent-lead', { title: 'Persist v5', assignees: ['reviewer'], owners: ['qa'] })
    const restored = new FleetTaskBoard(directory)
    restored.restore(parseFleetTaskState(board.state() as never))
    expect(restored.get('agent-reviewer', task.id)).toMatchObject({
      stateVersion: 1,
      stableState: { kind: 'running' },
      owners: [expect.objectContaining({ member: 'qa' })],
      activeReconcile: { status: 'ready', target: 'reviewer' },
    })
    expect(restored.get('agent-reviewer', task.id).owners[0]?.intent).toBeUndefined()
  })

  it('atomically replaces one stable state and fences stale Agent turns', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const board = new FleetTaskBoard(directory)
    const task = board.create('agent-lead', { title: 'Implement release', assignees: ['reviewer'] })
    expect(task).toMatchObject({
      stableState: { kind: 'running' },
      activeReconcile: { status: 'ready', target: 'reviewer', sourceStateVersion: 1 },
    })

    const claimed = board.claim('agent-reviewer', task.id)
    const attempt = claimed.activeReconcile?.attemptId
    if (attempt === undefined) throw new Error('expected attempt')
    const settled = board.settle('agent-reviewer', task.id, {
      attemptId: attempt,
      progress: 'Remote build started.',
      owners: ['qa'],
      next: {
        kind: 'dormant', reason: 'Waiting for the build window.',
        reconcilers: [reconciler('reviewer', { kind: 'at', at: '2026-08-21T00:01:00.000Z' })],
      },
    })
    expect(settled).toMatchObject({
      stateVersion: 2,
      stableState: { kind: 'dormant', reason: 'Waiting for the build window.' },
      owners: [expect.objectContaining({ member: 'qa' })],
      entries: [expect.objectContaining({ text: 'Remote build started.' })],
    })
    expect(settled.activeReconcile).toBeUndefined()
    expect(() => board.settle('agent-reviewer', task.id, {
      attemptId: attempt,
      progress: 'Late duplicate.',
      next: { kind: 'completed', result: 'Must not win.' },
    })).toThrow('is no longer current')
  })

  it('materializes time and latched event triggers without keeping an Agent turn open', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const board = new FleetTaskBoard(directory)
    board.activate()

    const timed = board.create('agent-lead', {
      title: 'Check later', assignees: ['reviewer'],
      initialState: {
        kind: 'dormant', reason: 'Wait one minute.',
        reconcilers: [reconciler('reviewer', { kind: 'at', at: '2026-08-21T00:01:00.000Z' })],
      },
    })
    expect(timed.activeReconcile).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(board.get('agent-reviewer', timed.id).activeReconcile).toMatchObject({ status: 'ready', target: 'reviewer' })

    const eventTask = board.create('agent-lead', { title: 'Wait for deployment', assignees: ['reviewer'] })
    const claimed = board.claim('agent-reviewer', eventTask.id)
    const attempt = claimed.activeReconcile?.attemptId
    if (attempt === undefined) throw new Error('expected attempt')
    board.signalEvent(eventTask.id, 'deploy:42', 'Deployment 42 completed.')
    const waiting = board.settle('agent-reviewer', eventTask.id, {
      attemptId: attempt,
      progress: 'Deployment operation recorded.',
      next: {
        kind: 'dormant', reason: 'Wait for deployment.',
        reconcilers: [reconciler('reviewer', { kind: 'event', eventKey: 'deploy:42' })],
      },
    })
    expect(waiting).toMatchObject({
      stableState: { kind: 'dormant' },
      activeReconcile: { status: 'ready', reason: 'Deployment 42 completed.' },
    })
    board.close()
  })

  it('opens children atomically and reconciles their parent through a composite barrier', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const board = new FleetTaskBoard(directory)
    const parent = board.create('agent-lead', { title: 'Iteration', assignees: ['lead'] })
    const claimed = board.claim('agent-lead', parent.id)
    const attempt = claimed.activeReconcile?.attemptId
    if (attempt === undefined) throw new Error('expected parent attempt')
    const running = board.settle('agent-lead', parent.id, {
      attemptId: attempt,
      progress: 'Iteration workstreams opened.',
      childOps: [
        { kind: 'create', task: { title: 'Implementation', assignees: ['reviewer'] } },
        { kind: 'create', task: { title: 'Validation', assignees: ['qa'] } },
      ],
      next: {
        kind: 'running',
        reconcilers: [reconciler('lead', {
          kind: 'any', items: [
            { kind: 'child_count', states: ['completed', 'blocked'], op: 'eq', value: 'cohort' },
            { kind: 'at', at: '2026-08-21T01:00:00.000Z' },
          ],
        })],
      },
    })
    expect(running.stableState).toMatchObject({ kind: 'running', cohort: [expect.any(String), expect.any(String)] })
    expect(running.activeReconcile).toBeUndefined()
    if (running.stableState.kind !== 'running') throw new Error('expected running parent')
    const [implementation, validation] = running.stableState.cohort
    if (implementation === undefined || validation === undefined) throw new Error('expected children')

    settleCompleted(board, 'agent-reviewer', implementation)
    expect(board.get('agent-lead', parent.id).activeReconcile).toBeUndefined()
    settleCompleted(board, 'agent-qa', validation)
    expect(board.get('agent-lead', parent.id).activeReconcile).toMatchObject({
      status: 'ready', target: 'lead', reason: expect.stringContaining('Child predicate'),
    })
  })

  it('reserves one target across retries and atomically applies the configured fallback', () => {
    const board = new FleetTaskBoard(directory)
    const task = board.create('agent-lead', {
      title: 'Reconcile carefully', assignees: ['reviewer'],
      initialState: {
        kind: 'running',
        reconcilers: [reconciler('reviewer', { kind: 'on_enter' }, {
          maxWakeups: 2,
          onTimeout: { kind: 'blocked', reason: 'Assistant did not produce a stable state.' },
        })],
      },
    })
    const reconcileId = task.activeReconcile?.id
    const first = board.claim('agent-reviewer', task.id)
    const firstAttempt = first.activeReconcile?.attemptId
    board.releaseRunning('reviewer', 'first turn ended')
    expect(board.reservedFor('reviewer')).toHaveLength(1)
    expect(board.get('agent-reviewer', task.id).activeReconcile).toMatchObject({
      id: reconcileId, status: 'ready', wakeups: 1,
    })
    const second = board.claim('agent-reviewer', task.id)
    expect(second.activeReconcile?.attemptId).not.toBe(firstAttempt)
    board.releaseRunning('reviewer', 'second turn ended')
    expect(board.get('agent-reviewer', task.id)).toMatchObject({
      stableState: { kind: 'blocked', reason: 'Assistant did not produce a stable state.' },
      stateVersion: 2,
    })
    expect(board.reservedFor('reviewer')).toEqual([])
  })

  it('expires an in-flight ReconcileAttempt at its absolute deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const board = new FleetTaskBoard(directory)
    board.activate()
    const task = board.create('agent-lead', {
      title: 'Bounded decision', assignees: ['reviewer'],
      initialState: {
        kind: 'running',
        reconcilers: [reconciler('reviewer', { kind: 'on_enter' }, {
          timeoutAt: '2026-08-21T00:00:10.000Z',
          onTimeout: { kind: 'blocked', reason: 'Decision deadline elapsed.' },
        })],
      },
    })
    const claimed = board.claim('agent-reviewer', task.id)
    const staleAttempt = claimed.activeReconcile?.attemptId
    await vi.advanceTimersByTimeAsync(10_000)
    expect(board.get('agent-reviewer', task.id).stableState).toMatchObject({ kind: 'blocked', reason: 'Decision deadline elapsed.' })
    expect(() => board.settle('agent-reviewer', task.id, {
      attemptId: staleAttempt ?? '', progress: 'Too late.', next: { kind: 'completed', result: 'Late.' },
    })).toThrow('is no longer current')
    board.close()
  })

  it('derives each member owner list from running implicit owner Tasks', () => {
    const board = new FleetTaskBoard(directory)
    const unowned = board.create('agent-lead', { title: 'Unowned coordination', assignees: ['lead'] })
    expect(unowned.owners).toEqual([])
    const task = board.create('agent-lead', {
      title: 'Parallel implementation', assignees: ['lead'], owners: ['@reviewer', 'agent-qa'],
    })
    expect(task.owners).toEqual([
      expect.objectContaining({ member: 'reviewer' }),
      expect.objectContaining({ member: 'qa' }),
    ])
    expect(task.owners.every(owner => owner.intent === undefined)).toBe(true)
    expect(board.ownerTasks('reviewer').map(candidate => candidate.id)).toEqual([task.id])
    expect(board.ownerTasks('qa').map(candidate => candidate.id)).toEqual([task.id])
    expect(() => board.update('agent-lead', task.id, { owners: ['reviewer'] }))
      .toThrow('owners must be changed by settling its current ReconcileAttempt')

    const reviewed = board.markOwnerIntent('agent-reviewer', task.id, 'complete', 'Review evidence attached.')
    expect(reviewed).toMatchObject({
      stableState: { kind: 'running' },
      owners: [
        expect.objectContaining({
          member: 'reviewer',
          intent: expect.objectContaining({ kind: 'complete', text: 'Review evidence attached.' }),
        }),
        expect.objectContaining({ member: 'qa' }),
      ],
    })
    expect(board.ownerTasks('reviewer')).toEqual([])
    expect(board.ownerTasks('qa')).toHaveLength(1)

    board.markOwnerIntent('agent-qa', task.id, 'block', 'Test environment unavailable.')
    expect(board.ownerTasks('qa')).toEqual([])
    expect(() => board.markOwnerIntent('agent-reviewer', task.id, 'complete', 'Duplicate.')).toThrow('already marked complete intent')
    expect(() => board.create('agent-lead', { title: 'Invalid owner', owners: ['outsider'] })).toThrow('unknown Fleet member')
  })

  it('reconciles owner intentions without letting them write Task state', () => {
    const board = new FleetTaskBoard(directory)
    const task = board.create('agent-lead', {
      title: 'Owner barrier', assignees: ['lead'], owners: ['reviewer', 'qa'],
      initialState: {
        kind: 'running',
        reconcilers: [reconciler('lead', {
          kind: 'owner_intent_count', intents: ['complete', 'block'], op: 'eq', value: 'owners',
        })],
      },
    })
    expect(task.activeReconcile).toBeUndefined()
    board.markOwnerIntent('agent-reviewer', task.id, 'complete', 'Implementation complete.')
    expect(board.get('agent-lead', task.id).activeReconcile).toBeUndefined()
    const ready = board.markOwnerIntent('agent-qa', task.id, 'block', 'Validation returned a blocker.')
    expect(ready.stableState.kind).toBe('running')
    expect(ready.activeReconcile).toMatchObject({
      status: 'ready', target: 'lead', reason: expect.stringContaining('Owner intent predicate matched 2 owners'),
    })
    const claimed = board.claim('agent-lead', task.id)
    const attempt = claimed.activeReconcile?.attemptId
    if (attempt === undefined) throw new Error('expected owner intent ReconcileAttempt')
    const settled = board.settle('agent-lead', task.id, {
      attemptId: attempt,
      progress: 'Reviewed both owner intentions.',
      next: { kind: 'blocked', reason: 'Validation owner reported a blocker.' },
    })
    expect(settled.stableState).toMatchObject({ kind: 'blocked', reason: 'Validation owner reported a blocker.' })
  })

  it('represents collaborative decisions as Vote child Tasks', () => {
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
    const parent = board.create('agent-lead', {
      title: 'Approve release', assignees: ['reviewer'], reviewers: ['qa'], decision: 'vote',
    })
    const claimed = board.claim('agent-reviewer', parent.id)
    const attempt = claimed.activeReconcile?.attemptId
    if (attempt === undefined) throw new Error('expected attempt')
    const waiting = board.settle('agent-reviewer', parent.id, {
      attemptId: attempt,
      progress: 'Evidence is ready for a vote.',
      childOps: [{
        kind: 'vote', decision: 'complete', channel: '#general', statement: 'Release evidence is sufficient.',
      }],
      next: {
        kind: 'running',
        reconcilers: [reconciler('reviewer', {
          kind: 'child_count', states: ['completed', 'blocked'], op: 'gte', value: 1,
        })],
      },
    })
    if (waiting.stableState.kind !== 'running') throw new Error('expected parent running state')
    const voteTaskId = waiting.stableState.cohort[0]
    if (voteTaskId === undefined) throw new Error('expected Vote child')
    const voteTask = board.get('agent-reviewer', voteTaskId)
    expect(voteTask).toMatchObject({ parentId: parent.id, stableState: { kind: 'dormant' }, vote: { status: 'open' } })
    expect(requests).toEqual([{ id: voteTask.vote?.id, voters: ['qa'] }])

    board.resolveVote({ id: voteTask.vote?.id ?? '', status: 'approved' })
    expect(board.get('agent-reviewer', voteTaskId).stableState).toMatchObject({ kind: 'completed', result: expect.stringContaining('approved') })
    const readyParent = board.get('agent-reviewer', parent.id)
    expect(readyParent.activeReconcile).toMatchObject({ status: 'ready', target: 'reviewer' })
    const final = settleCompleted(board, 'agent-reviewer', parent.id, 'Approved release.')
    expect(final.stableState).toMatchObject({ kind: 'completed', result: 'Approved release.' })
  })

  it('persists required message completion only through its current ReconcileAttempt', () => {
    const finalReplies: string[] = []
    const board = new FleetTaskBoard(directory, () => false, () => {}, (_callerId, _task, reply) => {
      finalReplies.push(reply)
      return { messageId: 'msg_final' }
    })
    const task = board.ensureMessageTask({
      messageId: 'msg_42', conversation: '#main', createdBy: 'lead', assignee: 'reviewer',
      title: 'Required reply', description: 'Return a final result.',
    })
    expect(() => board.settle('agent-reviewer', task.id, {
      attemptId: 'missing', progress: 'Done.', next: { kind: 'completed', result: 'Passed.', finalReply: 'Done.' },
    })).toThrow('is no longer current')
    const claimed = board.claim('agent-reviewer', task.id)
    const attempt = claimed.activeReconcile?.attemptId
    if (attempt === undefined) throw new Error('expected required ReconcileAttempt')
    const completed = board.settle('agent-reviewer', task.id, {
      attemptId: attempt,
      progress: 'Passed.',
      next: { kind: 'completed', result: 'Passed.', finalReply: 'Inspection passed.' },
    })
    expect(completed).toMatchObject({
      stableState: { kind: 'completed', result: 'Passed.' }, requirement: { completionMessageId: 'msg_final' },
    })
    expect(finalReplies).toEqual(['Inspection passed.'])
    expect(board.pendingRequirement('reviewer')).toBeUndefined()
  })

  it('separates required settlement from owner completion intent in the Task tool', async () => {
    const board = new FleetTaskBoard(directory)
    const required = board.ensureMessageTask({
      messageId: 'msg_required', conversation: '@reviewer', createdBy: 'lead', assignee: 'reviewer', title: 'Required reply',
    })
    const claimed = board.claim('agent-reviewer', required.id)
    const registered: Array<{ readonly name: string; readonly execute: (args: Record<string, unknown>, exec: unknown) => unknown }> = []
    installTaskTools({
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} } },
    } as never, board, (_agentId, action) => action === 'task.read')
    const tool = registered.find(candidate => candidate.name === 'fleet_task')
    if (tool === undefined) throw new Error('expected fleet_task')
    await expect(tool.execute({
      action: 'settle', id: required.id, attempt_id: claimed.activeReconcile?.attemptId,
      text: 'Completed result.',
      state: { kind: 'completed', result: 'Completed result.', finalReply: 'Completed result.' },
    }, { agent: { id: 'agent-reviewer' } })).resolves.toMatchObject({ task: { stableState: { kind: 'completed' } } })

    const owned = board.create('agent-lead', { title: 'Owned work', assignees: ['lead'], owners: ['reviewer'] })
    await expect(tool.execute({ action: 'owner_list' }, { agent: { id: 'agent-reviewer' } }))
      .resolves.toMatchObject({ tasks: [expect.objectContaining({ id: owned.id })] })
    await expect(tool.execute({
      action: 'complete', id: owned.id, text: 'Owner work complete.',
    }, { agent: { id: 'agent-reviewer' } })).resolves.toMatchObject({
      task: {
        stableState: { kind: 'running' },
        owners: [expect.objectContaining({
          member: 'reviewer', intent: expect.objectContaining({ kind: 'complete' }),
        })],
      },
    })
  })

  it('allows only task managers to perform explicit cancellation', () => {
    const board = new FleetTaskBoard(directory, agentId => agentId === 'agent-lead')
    const task = board.create('agent-lead', { title: 'Disposable Task', assignees: ['reviewer'], owners: ['qa'] })
    expect(() => board.cancel('agent-reviewer', task.id, 'Not authorized.')).toThrow('without task.manage')
    const claimed = board.claim('agent-reviewer', task.id)
    expect(() => board.settle('agent-lead', task.id, {
      attemptId: claimed.activeReconcile?.attemptId ?? '',
      progress: 'Manager tried to force completion.',
      next: { kind: 'completed', result: 'Forced result.' },
    })).toThrow('attempt belongs to reviewer, not lead')
    const cancelled = board.cancel('agent-lead', task.id, 'Plan was withdrawn.')
    expect(cancelled).toMatchObject({
      stateVersion: 2,
      stableState: { kind: 'cancelled', reason: 'Plan was withdrawn.' },
    })
    expect(cancelled.activeReconcile).toBeUndefined()
    expect(board.ownerTasks('qa')).toEqual([])
    const required = board.ensureMessageTask({
      messageId: 'required_cancel', conversation: '#main', createdBy: 'lead', assignee: 'reviewer', title: 'Required Task',
    })
    expect(() => board.cancel('agent-lead', required.id, 'Drop the obligation.')).toThrow('required Fleet task')
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
