import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'
import type { FleetTaskReconcilerSpec } from '../../src/productivity/task.js'
import {
  FleetTaskBoard, installGoalTools, installReconcileTools, installTaskTools, installVoteTools, parseFleetTaskState,
} from '../../src/productivity/task.js'

const members = [
  { id: 'agent-lead', name: 'lead' },
  { id: 'agent-reviewer', name: 'reviewer' },
  { id: 'agent-qa', name: 'qa' },
  { id: 'agent-assistant', name: 'assistant' },
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
    next: { kind: 'completed', reason: result, result },
  })
}

afterEach(() => { vi.useRealTimers() })

describe('FleetTaskBoard v6', () => {
  it('accepts only the breaking v6 persistence format', () => {
    expect(parseFleetTaskState(undefined)).toEqual({ version: 6, tasks: [] })
    expect(() => parseFleetTaskState({ version: 5, tasks: [] } as never)).toThrow('version is incompatible')
    const board = new FleetTaskBoard(directory)
    const goal = board.createGoal('agent-lead', { title: 'Persist Goal', owners: ['reviewer', 'qa'] })
    const restored = new FleetTaskBoard(directory)
    restored.restore(parseFleetTaskState(board.state() as never))
    expect(restored.get('agent-reviewer', goal.id)).toMatchObject({
      stateVersion: 1,
      stableState: { kind: 'running', reason: expect.any(String) },
      domain: { kind: 'goal', submissions: {} },
    })
    expect(restored.ownerTasks('reviewer').map(task => task.id)).toEqual([goal.id])
  })

  it('installs the next drive atomically before fencing the current attempt', () => {
    const board = new FleetTaskBoard(directory)
    const parent = board.create('agent-lead', { title: 'Iteration', assignees: ['lead'] })
    const claimed = board.claim('agent-lead', parent.id)
    const attempt = claimed.activeReconcile?.attemptId
    if (attempt === undefined) throw new Error('expected attempt')
    const running = board.settle('agent-lead', parent.id, {
      attemptId: attempt,
      progress: 'Opened implementation and validation.',
      childOps: [
        { kind: 'create', task: { title: 'Implementation', assignees: ['reviewer'] } },
        { kind: 'create', task: { title: 'Validation', assignees: ['qa'] } },
      ],
      next: {
        kind: 'running', reason: 'Waiting for both child Tasks.',
        reconcilers: [reconciler('lead', { kind: 'child_count', states: ['completed'], op: 'eq', value: 'cohort' })],
      },
    })
    if (running.stableState.kind !== 'running') throw new Error('expected running parent')
    expect(running.stableState.cohort).toHaveLength(2)
    expect(running.activeReconcile).toBeUndefined()
    expect(() => board.settle('agent-lead', parent.id, {
      attemptId: attempt, progress: 'Stale duplicate.', next: { kind: 'completed', reason: 'Must not win.' },
    })).toThrow('is no longer current')
    settleCompleted(board, 'agent-reviewer', running.stableState.cohort[0]!)
    settleCompleted(board, 'agent-qa', running.stableState.cohort[1]!)
    expect(board.get('agent-lead', parent.id).activeReconcile).toMatchObject({ status: 'ready', target: 'lead' })
  })

  it('rejects a live settlement that leaves no next drive', () => {
    const board = new FleetTaskBoard(directory)
    const task = board.create('agent-lead', { title: 'No-gap invariant', assignees: ['lead'] })
    const claimed = board.claim('agent-lead', task.id)
    const attemptId = claimed.activeReconcile?.attemptId
    if (attemptId === undefined) throw new Error('expected attempt')

    expect(() => board.claim('agent-lead', task.id)).toThrow(
      `already claimed; call fleet_reconcile resolve with id="${task.id}", attempt_id="${attemptId}"`,
    )

    expect(() => board.settle('agent-lead', task.id, {
      attemptId,
      progress: 'The current turn is done, but no continuation was supplied.',
      next: { kind: 'running', reason: 'This would be stranded.', reconcilers: [] },
    })).toThrow('must install at least one reconciler')
    expect(board.get('agent-lead', task.id).activeReconcile).toMatchObject({ status: 'running', attemptId })
  })

  it('retries one target and applies the configured fallback', () => {
    const board = new FleetTaskBoard(directory)
    const task = board.create('agent-lead', {
      title: 'Bounded reconciliation', assignees: ['reviewer'],
      initialState: {
        kind: 'running', reason: 'Review is required.',
        reconcilers: [reconciler('reviewer', { kind: 'on_enter' }, {
          maxWakeups: 2, onTimeout: { kind: 'blocked', reason: 'Reviewer exhausted two attempts.' },
        })],
      },
    })
    board.claim('agent-reviewer', task.id)
    board.releaseRunning('reviewer', 'first turn ended')
    expect(board.get('agent-reviewer', task.id).activeReconcile).toMatchObject({ status: 'ready', wakeups: 1 })
    board.claim('agent-reviewer', task.id)
    board.releaseRunning('reviewer', 'second turn ended')
    expect(board.get('agent-reviewer', task.id)).toMatchObject({
      stableState: { kind: 'blocked', reason: 'Reviewer exhausted two attempts.' },
    })
  })

  it('models each member inbox as one persistent Task without progress-log growth', () => {
    const board = new FleetTaskBoard(directory)
    const empty = board.ensureInboxTask('reviewer')
    expect(empty).toMatchObject({ domain: { kind: 'inbox', unreadMessages: 0 }, stableState: { kind: 'dormant' } })
    const unread = board.syncInbox('reviewer', 3, 120)
    expect(unread).toMatchObject({ domain: { kind: 'inbox', unreadMessages: 3, unreadChars: 120 }, stableState: { kind: 'running' } })
    expect(board.ownerTasks('reviewer').map(task => task.id)).toEqual([empty.id])
    for (let count = 4; count <= 50; count += 1) board.syncInbox('reviewer', count, count * 40)
    expect(board.get('agent-reviewer', empty.id).entries).toEqual([])
    expect(board.syncInbox('reviewer', 0, 0).stableState).toMatchObject({ kind: 'dormant' })
    expect(board.ownerTasks('reviewer')).toEqual([])
  })

  it('keeps one revision-fenced Interaction Task across Team continuation and native reporting', () => {
    const board = new FleetTaskBoard(directory)
    const first = board.recordInteractionInput('assistant', { messageId: 'user-1', text: 'Run the Team check.' })
    const second = board.recordInteractionInput('agent-assistant', { messageId: 'user-2', text: 'Include the final status.' })
    expect(second).toMatchObject({
      id: first.id,
      stableState: { kind: 'running' },
      domain: { kind: 'interaction', inputRevision: 2, settledRevision: 0, latestMessageId: 'user-2' },
    })
    expect(board.interactionTasks()).toHaveLength(1)

    const deferred = board.deferInteraction('agent-assistant', {
      reason: 'A formal member is checking the request.',
      goal: { title: 'Check status', description: 'Inspect and summarize the current state.', owners: ['reviewer'] },
      checkAfterSeconds: 60,
    })
    expect(deferred.task).toMatchObject({
      id: first.id,
      stableState: { kind: 'dormant' },
      domain: { kind: 'interaction', waitingTaskIds: [deferred.goals[0]?.id] },
    })
    expect(board.ownerTasks('assistant')).toEqual([])
    expect(board.ownerTasks('reviewer').map(task => task.id)).toEqual([deferred.goals[0]?.id])

    const resumed = board.signalInteractionDelivery('assistant', 'Every formal Team member is idle.')
    expect(resumed).toMatchObject({
      id: first.id,
      stableState: { kind: 'running', reason: expect.stringContaining('became quiescent') },
      domain: {
        kind: 'interaction', waitingTaskIds: [deferred.goals[0]?.id],
        pendingDelivery: expect.objectContaining({ revision: 2, cause: 'team_quiescent' }),
      },
    })
    expect(board.ownerTasks('assistant').map(task => task.id)).toEqual([first.id])

    expect(() => board.submitInteractionReport('agent-assistant', {
      outcome: 'complete', reason: 'Too early.', report: 'This must not commit.',
    })).toThrow('still waits for live Tasks')
    const continued = board.deferInteraction('agent-assistant', {
      reason: 'The first Delivery shows that Team work is still live.',
      checkAfterSeconds: 60,
    })
    expect(continued.task).toMatchObject({ stableState: { kind: 'dormant' } })
    expect(continued.task.domain).toMatchObject({ waitingTaskIds: [deferred.goals[0]!.id] })
    expect(continued.goals).toEqual([])
    expect(continued.task.domain).not.toHaveProperty('pendingDelivery')
    board.submitGoal('agent-reviewer', deferred.goals[0]!.id, {
      kind: 'complete', reason: 'The formal owner finished.', result: 'Checked.',
    })
    const completion = board.signalInteractionDelivery('assistant', 'Every linked Task settled.')
    expect(completion?.domain).toMatchObject({
      pendingDelivery: expect.objectContaining({
        cause: 'linked_tasks_settled',
        tasks: [expect.objectContaining({ state: 'completed', result: 'Checked.' })],
      }),
    })

    board.submitInteractionReport('agent-assistant', {
      outcome: 'complete', reason: 'The requested status is ready.', report: 'The Team check passed.',
    })
    expect(board.interactionTask('assistant')?.stableState).toMatchObject({ kind: 'running' })
    expect(board.commitInteractionOutput('assistant', 'The Team check passed.')?.stableState).toMatchObject({
      kind: 'completed', result: 'The Team check passed.',
    })
    expect(board.interactionTask('assistant')?.domain).not.toHaveProperty('pendingDelivery')

    const reopened = board.recordInteractionInput('assistant', { messageId: 'user-3', text: 'One more check.' })
    expect(reopened).toMatchObject({
      id: first.id,
      stableState: { kind: 'running' },
      domain: { kind: 'interaction', inputRevision: 3, settledRevision: 2, latestMessageId: 'user-3' },
    })
  })

  it('retains a live composite wait when a progress turn also watches one child', () => {
    const board = new FleetTaskBoard(directory)
    const interaction = board.recordInteractionInput('assistant', {
      messageId: 'user-composite-1', text: 'Build and validate the release.',
    })
    const plan = board.createCompositePlan('agent-lead', {
      title: 'Release root', coordinator: 'lead',
      stages: [{ key: 'quality', title: 'Quality check', owners: ['qa'] }],
    })
    const quality = plan.stages.get('quality')
    if (quality === undefined) throw new Error('expected quality stage')

    board.deferInteraction('agent-assistant', {
      reason: 'The Team owns the release.', taskIds: [plan.task.id], checkAfterSeconds: 60,
    })
    board.signalInteractionDelivery('assistant', 'The Team is temporarily quiescent.')
    const continued = board.deferInteraction('agent-assistant', {
      reason: 'Quality is still running.', taskIds: [quality.id], checkAfterSeconds: 60,
    })
    expect(continued.task.domain).toMatchObject({
      kind: 'interaction', waitingTaskIds: [plan.task.id, quality.id],
    })

    board.submitGoal('agent-qa', quality.id, {
      kind: 'complete', reason: 'Quality evidence is ready.', result: 'quality-report',
    })
    board.signalInteractionDelivery('assistant', 'Quality settled while the root still needs reconciliation.')
    expect(() => board.submitInteractionReport('agent-assistant', {
      outcome: 'complete', reason: 'Too early.', report: 'Quality passed.',
    })).toThrow(plan.task.id)
    const rootWait = board.deferInteraction('agent-assistant', {
      reason: 'The composite root still needs reconciliation.', taskIds: [plan.task.id], checkAfterSeconds: 60,
    })
    expect(rootWait.task.domain).toMatchObject({
      kind: 'interaction', waitingTaskIds: [plan.task.id],
    })

    const claimed = board.claim('agent-lead', plan.task.id)
    const attemptId = claimed.activeReconcile?.attemptId
    if (attemptId === undefined) throw new Error('expected root reconciliation')
    board.settle('agent-lead', plan.task.id, {
      attemptId,
      progress: 'The root accepted the quality result.',
      next: { kind: 'completed', reason: 'The release root is complete.', result: 'release-result' },
    })
    expect(board.signalInteractionDelivery('assistant', 'Every linked Task settled.')?.domain).toMatchObject({
      pendingDelivery: expect.objectContaining({
        cause: 'linked_tasks_settled',
        tasks: [expect.objectContaining({ id: plan.task.id, state: 'completed' })],
      }),
    })
    board.submitInteractionReport('agent-assistant', {
      outcome: 'complete', reason: 'The root is terminal.', report: 'The release is complete.',
    })
    expect(board.commitInteractionOutput('assistant', 'The release is complete.')?.id).toBe(interaction.id)
  })

  it('fences an assistant execution lease to one foreground input revision', () => {
    const board = new FleetTaskBoard(directory)
    board.recordInteractionInput('assistant', { messageId: 'user-execute-1', text: 'Handle this directly.' })
    expect(board.takeOverInteraction('agent-assistant', 'The user explicitly requested direct execution.')).toMatchObject({
      stableState: { kind: 'running' },
      domain: {
        kind: 'interaction', inputRevision: 1,
        executionLease: {
          revision: 1,
          reason: 'The user explicitly requested direct execution.',
        },
      },
    })

    expect(board.recordInteractionInput('assistant', {
      messageId: 'user-execute-2', text: 'Now answer a separate question.',
    })).toMatchObject({
      stableState: { kind: 'running' },
      domain: { kind: 'interaction', inputRevision: 2 },
    })
    expect(board.interactionTask('assistant')?.domain).not.toHaveProperty('executionLease')
  })

  it('deterministically resumes a dormant Interaction when its progress check is due', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T00:00:00.000Z'))
    const board = new FleetTaskBoard(directory)
    board.activate()
    board.recordInteractionInput('assistant', { messageId: 'user-timeout', text: 'Run a bounded check.' })
    const deferred = board.deferInteraction('agent-assistant', {
      reason: 'Waiting for bounded Team progress.',
      goal: { title: 'Bounded check', description: 'Check once.', owners: ['qa'] },
      checkAfterSeconds: 10,
    })
    expect(deferred.task.stableState.kind).toBe('dormant')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(board.interactionTask('assistant')?.stableState).toMatchObject({
      kind: 'running', reason: expect.stringContaining('progress check became due'),
    })
    expect(board.interactionTask('assistant')?.domain).toMatchObject({
      pendingDelivery: expect.objectContaining({ cause: 'progress_due', revision: 1 }),
    })
    board.close()
  })

  it('separates Reply delivery receipt from Inbox consumption', () => {
    const board = new FleetTaskBoard(directory)
    const reply = board.ensureReplyTask({
      messageId: 'msg_42', conversation: '#main', replyTarget: '#main', createdBy: 'lead',
      assignee: 'reviewer', title: 'Reply to review request',
    })
    expect(reply).toMatchObject({ domain: { kind: 'reply', messageId: 'msg_42', assignee: 'reviewer' }, stableState: { kind: 'running' } })
    expect(board.pendingReply('reviewer')?.id).toBe(reply.id)
    expect(() => board.recordReply('agent-qa', reply.id, 'msg_wrong')).toThrow('belongs to reviewer')
    expect(board.recordReply('agent-reviewer', reply.id, 'msg_final')).toMatchObject({
      domain: { kind: 'reply', completionMessageId: 'msg_final' },
      stableState: { kind: 'completed', result: 'msg_final' },
    })
    expect(board.pendingReply('reviewer')).toBeUndefined()
  })

  it('derives a Goal result from every owner submission', () => {
    const board = new FleetTaskBoard(directory)
    const goal = board.createGoal('agent-lead', { title: 'Release', owners: ['reviewer', 'qa'] })
    expect(board.submitGoal('agent-reviewer', goal.id, {
      kind: 'complete', reason: 'Implementation verified.', result: 'artifact-1',
    }).stableState).toMatchObject({ kind: 'running', reason: expect.stringContaining('1 of 2') })
    expect(board.ownerTasks('reviewer')).toEqual([])
    const completed = board.submitGoal('agent-qa', goal.id, {
      kind: 'complete', reason: 'Validation passed.', result: 'report-1',
    })
    expect(completed.stableState).toMatchObject({
      kind: 'completed', reason: expect.stringContaining('Validation passed.'), result: expect.stringContaining('report-1'),
    })
  })

  it('gates ordered Goal owners on dependencies and keeps parent completion behind its children', () => {
    const board = new FleetTaskBoard(directory)
    const root = board.createGoal('agent-lead', { title: 'Release pipeline', owners: ['lead'] })
    const implementation = board.createGoal('agent-lead', {
      title: 'Implement release', owners: ['reviewer'], parentId: root.id,
    })
    const verification = board.createGoal('agent-lead', {
      title: 'Verify release', owners: ['qa'], parentId: root.id, dependencies: [implementation.id],
    })

    expect(board.ownerTasks('lead').map(task => task.id)).not.toContain(root.id)
    expect(board.ownerTasks('reviewer').map(task => task.id)).toContain(implementation.id)
    expect(board.ownerTasks('qa').map(task => task.id)).not.toContain(verification.id)
    expect(() => board.submitGoal('agent-lead', root.id, {
      kind: 'complete', reason: 'Too early.',
    })).toThrow('still has unsettled child Tasks')

    board.submitGoal('agent-reviewer', implementation.id, {
      kind: 'complete', reason: 'Implementation complete.',
    })
    expect(board.ownerTasks('lead').map(task => task.id)).not.toContain(root.id)
    expect(board.ownerTasks('qa').map(task => task.id)).toContain(verification.id)
    expect(() => board.submitGoal('agent-qa', verification.id, {
      kind: 'complete', reason: 'Verification complete.',
    })).not.toThrow()
    expect(board.ownerTasks('lead').map(task => task.id)).toContain(root.id)
    expect(board.submitGoal('agent-lead', root.id, {
      kind: 'complete', reason: 'All ordered stages settled.',
    }).stableState.kind).toBe('completed')
  })

  it('continues a rejected review through remediation and a fresh acceptance round without a liveness gap', () => {
    const board = new FleetTaskBoard(directory)
    const plan = board.createCompositePlan('agent-lead', {
      title: 'Planned release', coordinator: 'lead', rootWorkId: 'work-1',
      stages: [
        { key: 'implementation', title: 'Implementation stage', owners: ['reviewer'] },
        {
          key: 'review', kind: 'vote', title: 'Acceptance review',
          description: 'Approve the delivered implementation.', owners: ['qa'], dependencies: ['implementation'],
        },
      ],
    })
    const root = plan.task
    const implementation = plan.stages.get('implementation')
    const review = plan.stages.get('review')
    if (implementation === undefined || review === undefined) throw new Error('expected planned stages')

    expect(root).toMatchObject({
      owners: [], decision: 'vote',
      domain: { kind: 'composite', managedChildren: true, rootWorkId: 'work-1' },
      stableState: { kind: 'running', cohort: [implementation.id, review.id] },
    })
    expect(() => board.createGoal('agent-lead', {
      title: 'Duplicate top-level stage', owners: ['qa'], parentId: root.id,
    })).toThrow('accepts children only through its ReconcileAttempt')
    expect(board.ownerTasks('qa').map(task => task.id)).not.toContain(review.id)

    board.submitGoal('agent-reviewer', implementation.id, {
      kind: 'complete', reason: 'Implementation candidate delivered.', result: 'candidate-1',
    })
    expect(board.ownerTasks('qa').map(task => task.id)).toContain(review.id)
    board.castVote('agent-qa', review.id, 'reject', 'Supplier normalization is incorrect.')

    const rejected = board.claim('agent-lead', root.id)
    const rejectedAttempt = rejected.activeReconcile?.attemptId
    if (rejectedAttempt === undefined) throw new Error('expected rejected review reconciliation')
    expect(() => board.settle('agent-lead', root.id, {
      attemptId: rejectedAttempt,
      progress: 'Tried to accept a rejected review.',
      next: { kind: 'completed', reason: 'Must not complete.' },
    })).toThrow('requires an approved Vote child')
    const remediationRound = board.settle('agent-lead', root.id, {
      attemptId: rejectedAttempt,
      progress: 'Review rejected candidate-1; opened bounded remediation.',
      childOps: [{
        kind: 'goal', title: 'Repair supplier normalization', owners: ['reviewer'],
        description: 'Fix the rejected criterion and provide fresh evidence.',
      }],
      next: {
        kind: 'running', reason: 'Waiting for remediation.',
        reconcilers: [reconciler('lead', {
          kind: 'child_count', states: ['completed', 'blocked', 'cancelled'], op: 'eq', value: 'cohort',
        })],
      },
    })
    if (remediationRound.stableState.kind !== 'running') throw new Error('expected remediation round')
    expect(remediationRound.stableState.cohort).toHaveLength(1)
    const remediationId = remediationRound.stableState.cohort[0]!
    board.submitGoal('agent-reviewer', remediationId, {
      kind: 'complete', reason: 'Rejected criterion repaired.', result: 'candidate-2',
    })

    const repaired = board.claim('agent-lead', root.id)
    const repairedAttempt = repaired.activeReconcile?.attemptId
    if (repairedAttempt === undefined) throw new Error('expected repaired candidate reconciliation')
    const acceptanceRound = board.settle('agent-lead', root.id, {
      attemptId: repairedAttempt,
      progress: 'Opened a fresh independent acceptance round for candidate-2.',
      childOps: [{
        kind: 'vote', title: 'Acceptance review #2', channel: '#main',
        statement: 'Approve repaired candidate-2.', voters: ['qa'],
      }],
      next: {
        kind: 'running', reason: 'Waiting for fresh acceptance.',
        reconcilers: [reconciler('lead', {
          kind: 'child_count', states: ['completed', 'blocked', 'cancelled'], op: 'eq', value: 'cohort',
        })],
      },
    })
    if (acceptanceRound.stableState.kind !== 'running') throw new Error('expected acceptance round')
    const acceptanceId = acceptanceRound.stableState.cohort[0]!
    board.castVote('agent-qa', acceptanceId, 'approve', 'Fresh evidence passes.')

    const accepted = board.claim('agent-lead', root.id)
    const acceptedAttempt = accepted.activeReconcile?.attemptId
    if (acceptedAttempt === undefined) throw new Error('expected accepted reconciliation')
    expect(board.settle('agent-lead', root.id, {
      attemptId: acceptedAttempt,
      progress: 'The repaired candidate passed independent acceptance.',
      next: { kind: 'completed', reason: 'Current acceptance Vote approved.', result: 'candidate-2' },
    }).stableState).toMatchObject({ kind: 'completed', result: 'candidate-2' })
  })

  it('reconciles a composite when a linked kickoff obligation blocks', () => {
    const board = new FleetTaskBoard(directory)
    const kickoff = board.createGoal('agent-lead', {
      title: 'Acknowledge kickoff', owners: ['qa'],
    })
    const plan = board.createCompositePlan('agent-lead', {
      title: 'Work with linked kickoff', coordinator: 'lead', dependencies: [kickoff.id],
      stages: [{ key: 'delivery', title: 'Deliver result', owners: ['reviewer'] }],
    })
    const delivery = plan.stages.get('delivery')
    if (delivery === undefined) throw new Error('expected delivery stage')

    expect(plan.task.dependencies).toEqual([])
    board.submitGoal('agent-reviewer', delivery.id, {
      kind: 'complete', reason: 'Delivery finished.', result: 'candidate',
    })
    board.submitGoal('agent-qa', kickoff.id, {
      kind: 'block', reason: 'External acknowledgement channel is unavailable.',
    })

    const claimed = board.claim('agent-lead', plan.task.id)
    expect(claimed.activeReconcile).toMatchObject({ status: 'running', target: 'lead' })
  })

  it('blocks a multi-owner Goal on a concrete owner blocker', () => {
    const board = new FleetTaskBoard(directory)
    const goal = board.createGoal('agent-lead', { title: 'Deploy', owners: ['reviewer', 'qa'] })
    expect(board.submitGoal('agent-reviewer', goal.id, {
      kind: 'block', reason: 'Credentials unavailable.',
    }).stableState).toMatchObject({ kind: 'blocked', reason: 'reviewer: Credentials unavailable.' })
    expect(board.ownerTasks('qa')).toEqual([])
  })

  it('models collaborative decisions as reasoned Vote ballots', () => {
    const board = new FleetTaskBoard(directory)
    const vote = board.createVote('agent-lead', {
      statement: 'Ship release candidate 7.', channel: '#main', voters: ['reviewer', 'qa'],
    })
    expect(board.castVote('agent-reviewer', vote.id, 'approve', 'All checks passed.').stableState.kind).toBe('running')
    expect(board.castVote('agent-qa', vote.id, 'reject', 'Rollback path is missing.')).toMatchObject({
      domain: { kind: 'vote', outcome: 'reject' },
      stableState: { kind: 'completed', result: 'reject', reason: expect.stringContaining('Rollback path is missing.') },
    })
  })

  it('uses a deterministic system reconciler for a domain deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const board = new FleetTaskBoard(directory)
    board.activate()
    const goal = board.createGoal('agent-lead', {
      title: 'Time-bounded Goal', owners: ['reviewer'], timeoutAt: '2026-08-21T00:00:10.000Z',
    })
    expect(goal.stableState).toMatchObject({ kind: 'running', reconcilers: [expect.objectContaining({ target: '$system' })] })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(board.get('agent-lead', goal.id).stableState).toMatchObject({
      kind: 'blocked', reason: 'Goal deadline 2026-08-21T00:00:10.000Z elapsed.',
    })
    board.close()
  })

  it('applies timeout fallbacks while waiting, ready, or running', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const board = new FleetTaskBoard(directory)
    board.activate()
    const waiting = board.create('agent-lead', {
      title: 'Wait for external event',
      initialState: {
        kind: 'dormant', reason: 'Waiting for an event.',
        reconcilers: [reconciler('reviewer', { kind: 'event', eventKey: 'external-ready' }, {
          timeoutAt: '2026-08-21T00:00:10.000Z',
          onTimeout: { kind: 'blocked', reason: 'External event did not arrive.' },
        })],
      },
    })
    const ready = board.create('agent-lead', {
      title: 'Ready but unclaimed',
      initialState: {
        kind: 'running', reason: 'Ready for review.',
        reconcilers: [reconciler('reviewer', { kind: 'on_enter' }, {
          timeoutAt: '2026-08-21T00:00:20.000Z',
          onTimeout: { kind: 'blocked', reason: 'Ready attempt was never claimed.' },
        })],
      },
    })
    const running = board.create('agent-lead', {
      title: 'Claimed but unfinished',
      initialState: {
        kind: 'running', reason: 'Review is running.',
        reconcilers: [reconciler('qa', { kind: 'on_enter' }, {
          timeoutAt: '2026-08-21T00:00:30.000Z',
          onTimeout: { kind: 'blocked', reason: 'Running attempt exceeded its deadline.' },
        })],
      },
    })
    board.claim('agent-qa', running.id)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(board.get('agent-lead', waiting.id).stableState).toMatchObject({
      kind: 'blocked', reason: 'External event did not arrive.',
    })
    expect(board.get('agent-lead', ready.id).activeReconcile?.status).toBe('ready')
    expect(board.get('agent-lead', running.id).activeReconcile?.status).toBe('running')

    await vi.advanceTimersByTimeAsync(10_000)
    expect(board.get('agent-lead', ready.id).stableState).toMatchObject({
      kind: 'blocked', reason: 'Ready attempt was never claimed.',
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(board.get('agent-lead', running.id).stableState).toMatchObject({
      kind: 'blocked', reason: 'Running attempt exceeded its deadline.',
    })
    board.close()
  })

  it('keeps fleet_task read-only and exposes domain intent tools separately', () => {
    const board = new FleetTaskBoard(directory)
    const registered: Array<{ readonly name: string; readonly parameters: { readonly properties: { readonly action?: { readonly enum?: readonly string[] } } } }> = []
    const ctx = { tools: { register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} } } } as never
    const authorize = () => true
    installTaskTools(ctx, board, authorize)
    installGoalTools(ctx, board, authorize)
    installVoteTools(ctx, board, authorize)
    installReconcileTools(ctx, board, authorize)
    expect(registered.map(tool => tool.name)).toEqual(['fleet_task', 'fleet_goal', 'fleet_vote', 'fleet_reconcile'])
    expect(registered.find(tool => tool.name === 'fleet_task')?.parameters.properties.action?.enum).toEqual(['list', 'owner_list', 'get'])
  })

  it('keeps cancellation as a manager operation outside fleet_task', () => {
    const board = new FleetTaskBoard(directory, agentId => agentId === 'agent-lead')
    const task = board.createGoal('agent-lead', { title: 'Withdrawn plan', owners: ['reviewer'] })
    expect(() => board.cancel('agent-reviewer', task.id, 'Not authorized.')).toThrow('without task.manage')
    expect(board.cancel('agent-lead', task.id, 'Plan was withdrawn.')).toMatchObject({
      stableState: { kind: 'cancelled', reason: 'Plan was withdrawn.' },
    })
    expect(board.ownerTasks('reviewer')).toEqual([])
  })

  it('freezes deadline timers while paused and persists before notifying', async () => {
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
