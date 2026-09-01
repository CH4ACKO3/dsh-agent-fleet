import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, JsonValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'

export const FLEET_TASK_STATE_NAMESPACE = 'productivity-tasks'

export type FleetProjectTaskPriority = 'low' | 'normal' | 'high'
export type FleetTaskDecision = 'direct' | 'vote'
export type FleetTaskStableKind = 'running' | 'dormant' | 'blocked' | 'paused' | 'completed' | 'cancelled'

export type FleetTaskTrigger =
  | { readonly kind: 'on_enter' }
  | { readonly kind: 'event'; readonly eventKey: string }
  | { readonly kind: 'at'; readonly at: string }
  | {
      readonly kind: 'child_count'
      readonly states: FleetTaskStableKind[]
      readonly op: 'eq' | 'gte' | 'lte'
      readonly value: number | 'cohort'
    }
  | { readonly kind: 'all' | 'any'; readonly items: FleetTaskTrigger[] }

export type FleetTaskTimeoutState =
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'paused'; readonly reason: string }
  | { readonly kind: 'cancelled'; readonly reason: string }

export interface FleetTaskReconcilerSpec {
  readonly id: string
  readonly when: FleetTaskTrigger
  readonly target: string
  readonly priority: number
  readonly retryAfterSeconds: number
  readonly maxWakeups: number
  readonly timeoutAt?: string
  readonly onTimeout: FleetTaskTimeoutState
}

export type FleetTaskStableState =
  | {
      readonly kind: 'running'
      readonly since: string
      readonly reason: string
      readonly cohort: string[]
      readonly reconcilers: FleetTaskReconcilerSpec[]
    }
  | {
      readonly kind: 'dormant'
      readonly since: string
      readonly reason: string
      readonly reconcilers: FleetTaskReconcilerSpec[]
    }
  | { readonly kind: 'blocked'; readonly since: string; readonly reason: string }
  | { readonly kind: 'paused'; readonly since: string; readonly reason: string }
  | { readonly kind: 'completed'; readonly completedAt: string; readonly reason: string; readonly result?: string }
  | { readonly kind: 'cancelled'; readonly cancelledAt: string; readonly reason: string }

export type FleetTaskStableStateInput =
  | { readonly kind: 'running'; readonly reason: string; readonly cohort?: readonly string[]; readonly reconcilers: readonly FleetTaskReconcilerSpec[] }
  | { readonly kind: 'dormant'; readonly reason: string; readonly reconcilers: readonly FleetTaskReconcilerSpec[] }
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'paused'; readonly reason: string }
  | { readonly kind: 'completed'; readonly reason: string; readonly result?: string }
  | { readonly kind: 'cancelled'; readonly reason: string }

export interface FleetTaskActiveReconcile {
  readonly id: string
  readonly sourceStateVersion: number
  readonly reconcilerId: string
  readonly causes: string[]
  readonly target: string
  readonly priority: number
  readonly status: 'ready' | 'running'
  readonly reason: string
  readonly readyAt: string
  readonly wakeups: number
  readonly maxWakeups: number
  readonly retryAfterSeconds: number
  readonly timeoutAt?: string
  readonly onTimeout: FleetTaskTimeoutState
  readonly attemptId?: string
  readonly startedAt?: string
}

export interface FleetTaskEntry {
  readonly id: string
  readonly kind: 'comment' | 'progress'
  readonly author: string
  readonly text: string
  readonly resources: string[]
  readonly createdAt: string
}

export interface FleetTaskSignal {
  readonly eventKey: string
  readonly result: string
  readonly signaledAt: string
}

export interface FleetTaskOwner {
  readonly member: string
  readonly since: string
}

export type FleetGoalSubmission = {
  readonly kind: 'complete'
  readonly reason: string
  readonly result?: string
  readonly submittedAt: string
} | {
  readonly kind: 'block'
  readonly reason: string
  readonly submittedAt: string
}

export type FleetVoteDecision = 'approve' | 'reject'

export interface FleetVoteBallot {
  readonly voter: string
  readonly decision: FleetVoteDecision
  readonly reason: string
  readonly submittedAt: string
}

export interface FleetInteractionReportIntent {
  readonly revision: number
  readonly outcome: 'complete' | 'block'
  readonly reason: string
  readonly report: string
  readonly submittedAt: string
}

export interface FleetInteractionExecutionLease {
  readonly revision: number
  readonly reason: string
  readonly grantedAt: string
}

export interface FleetInteractionDelivery {
  readonly id: string
  readonly revision: number
  readonly cause: 'linked_tasks_settled' | 'team_quiescent' | 'progress_due'
  readonly summary: string
  readonly tasks: readonly {
    readonly id: string
    readonly title: string
    readonly state: FleetTaskStableKind
    readonly reason: string
    readonly result?: string
  }[]
  readonly createdAt: string
}

export type FleetTaskDomain =
  | {
      readonly kind: 'composite'
      readonly rootWorkId?: string
      readonly managedChildren?: true
      readonly plan?: {
        readonly stages: Readonly<Record<string, string>>
        readonly requiredStageIds: readonly string[]
        readonly resultStageId?: string
        readonly acceptanceVoteIds: readonly string[]
      }
    }
  | {
      readonly kind: 'inbox'
      readonly owner: string
      readonly unreadMessages: number
      readonly unreadChars: number
    }
  | {
      readonly kind: 'reply'
      readonly messageId: string
      readonly conversation: string
      readonly assignee: string
      readonly replyTarget: string
      readonly completionMessageId?: string
    }
  | {
      readonly kind: 'goal'
      readonly submissions: Readonly<Record<string, FleetGoalSubmission>>
      readonly rootWorkId?: string
    }
  | {
      readonly kind: 'interaction'
      readonly owner: string
      readonly inputRevision: number
      readonly settledRevision: number
      readonly latestMessageId: string
      readonly waitingTaskIds: string[]
      readonly waitingEventKey?: string
      readonly pendingDelivery?: FleetInteractionDelivery
      readonly reportIntent?: FleetInteractionReportIntent
      readonly executionLease?: FleetInteractionExecutionLease
    }
  | {
      readonly kind: 'vote'
      readonly channel: `#${string}`
      readonly statement: string
      readonly initiator: string
      readonly voters: string[]
      readonly ballots: FleetVoteBallot[]
      readonly outcome?: FleetVoteDecision
    }

export interface FleetProjectTask {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly priority: FleetProjectTaskPriority
  readonly decision: FleetTaskDecision
  readonly domain: FleetTaskDomain
  readonly stableState: FleetTaskStableState
  readonly stateVersion: number
  readonly activeReconcile?: FleetTaskActiveReconcile
  readonly createdBy: string
  readonly owners: FleetTaskOwner[]
  readonly assignees: string[]
  readonly reviewers: string[]
  readonly followers: string[]
  readonly dependencies: string[]
  readonly parentId?: string
  readonly dueAt?: string
  readonly resources: string[]
  readonly entries: FleetTaskEntry[]
  readonly signals: FleetTaskSignal[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly dueNotifiedAt?: string
  readonly duePendingFor?: string[]
}

export interface FleetTaskState {
  readonly version: 6
  readonly tasks: readonly FleetProjectTask[]
}

export interface FleetProjectTaskEvent {
  readonly action: 'created' | 'updated' | 'commented' | 'progressed' | 'domain_updated' | 'reconcile_ready' | 'reconcile_started' | 'reconciled' | 'retrying' | 'timed_out' | 'signaled' | 'completed' | 'cancelled' | 'due' | 'notification'
  readonly task: FleetProjectTask
  readonly actor?: string
}

export interface CreateFleetProjectTaskInput {
  readonly title: string
  readonly description?: string
  readonly priority?: FleetProjectTaskPriority
  readonly decision?: FleetTaskDecision
  readonly owners?: readonly string[]
  readonly assignees?: readonly string[]
  readonly reviewers?: readonly string[]
  readonly followers?: readonly string[]
  readonly dependencies?: readonly string[]
  readonly parentId?: string
  readonly dueAt?: string
  readonly resources?: readonly string[]
  readonly initialState?: FleetTaskStableStateInput
  readonly domain?: FleetTaskDomain
}

export interface UpdateFleetProjectTaskInput {
  readonly title?: string
  readonly description?: string
  readonly priority?: FleetProjectTaskPriority
  readonly decision?: FleetTaskDecision
  readonly owners?: readonly string[]
  readonly assignees?: readonly string[]
  readonly reviewers?: readonly string[]
  readonly followers?: readonly string[]
  readonly dependencies?: readonly string[]
  readonly dueAt?: string
  readonly resources?: readonly string[]
}

export interface EnsureFleetReplyTaskInput {
  readonly messageId: string
  readonly conversation: string
  readonly createdBy: string
  readonly assignee: string
  readonly replyTarget?: string
  readonly title: string
  readonly description?: string
  readonly resources?: readonly string[]
  readonly timeoutAt?: string
}

export interface DeferFleetInteractionInput {
  readonly reason: string
  readonly taskIds?: readonly string[]
  readonly goal?: {
    readonly title: string
    readonly description: string
    readonly owners: readonly string[]
  }
  readonly checkAfterSeconds: number
}

export type FleetTaskChildOperation =
  | { readonly kind: 'create'; readonly task: Omit<CreateFleetProjectTaskInput, 'parentId'> }
  | {
      readonly kind: 'goal'
      readonly title: string
      readonly description?: string
      readonly owners: readonly string[]
      readonly dependencies?: readonly string[]
      readonly resources?: readonly string[]
      readonly timeoutAt?: string
    }
  | { readonly kind: 'link'; readonly taskId: string }
  | { readonly kind: 'cancel'; readonly taskId: string; readonly reason: string }
  | {
      readonly kind: 'vote'
      readonly title?: string
      readonly channel: `#${string}`
      readonly statement: string
      readonly voters: readonly string[]
      readonly dependencies?: readonly string[]
      readonly timeoutAt?: string
    }

export interface FleetCompositeStageInput {
  readonly key: string
  readonly kind?: 'goal' | 'vote'
  readonly title: string
  readonly description?: string
  readonly owners: readonly string[]
  readonly dependencies?: readonly string[]
  readonly resources?: readonly string[]
  readonly timeoutAt?: string
}

export interface CreateFleetCompositePlanInput {
  readonly title: string
  readonly description?: string
  readonly coordinator: string
  readonly stages: readonly FleetCompositeStageInput[]
  readonly dependencies?: readonly string[]
  readonly rootWorkId?: string
  readonly resultStage?: string
  readonly timeoutAt?: string
}

export interface FleetGoalSplitStageInput {
  readonly key: string
  readonly title: string
  readonly description?: string
  readonly owners: readonly string[]
  readonly dependencies?: readonly string[]
  readonly resources?: readonly string[]
  readonly timeoutAt?: string
}

export interface SettleFleetTaskAttemptInput {
  readonly attemptId: string
  readonly progress: string
  readonly next: FleetTaskStableStateInput
  readonly owners?: readonly string[]
  readonly childOps?: readonly FleetTaskChildOperation[]
}

const EMPTY_STATE: FleetTaskState = { version: 6, tasks: [] }
const SYSTEM_TARGET = '$system'

function requiredText(value: string, label: string): string {
  const result = value.trim()
  if (result.length === 0) throw new Error(`${label} cannot be empty`)
  return result
}

function unique(values: readonly string[]): string[] { return [...new Set(values)] }
function snapshot<T>(value: T): T { return structuredClone(value) }

export function parseFleetTaskState(value: JsonValue | undefined): FleetTaskState {
  if (value === undefined) return snapshot(EMPTY_STATE)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Fleet Task state must be an object')
  const input = value as Record<string, JsonValue>
  if (input.version !== 6 || !Array.isArray(input.tasks)) {
    throw new Error('Fleet Task state version is incompatible; remove the old productivity-tasks state and recreate Tasks')
  }
  return { version: 6, tasks: snapshot(input.tasks) as unknown as FleetProjectTask[] }
}

export class FleetTaskBoard {
  private readonly tasks = new Map<string, FleetProjectTask>()
  private readonly dueTimers = new Map<string, NodeJS.Timeout>()
  private readonly stateTimers = new Map<string, NodeJS.Timeout>()
  private readonly listeners = new Set<(event: FleetProjectTaskEvent) => void>()
  private active = false
  private closed = false

  constructor(
    private readonly directory: FleetMemberDirectory,
    private readonly canManage: (agentId: string) => boolean = () => false,
    private readonly onDue: (task: FleetProjectTask, recipients: readonly string[]) => readonly string[] | void = () => {},
  ) {}

  state(): FleetTaskState { return { version: 6, tasks: [...this.tasks.values()].map(snapshot) } }

  restore(state: FleetTaskState): void {
    this.assertOpen()
    this.pause()
    this.tasks.clear()
    for (const source of state.tasks) {
      const { activeReconcile: _storedReconcile, ...task } = source
      const activeReconcile = source.activeReconcile?.status === 'running'
        ? (() => {
            const { attemptId: _attemptId, startedAt: _startedAt, ...reconcile } = source.activeReconcile
            return {
            ...reconcile,
            status: 'ready' as const,
            readyAt: new Date().toISOString(),
            reason: `Reconcile ${source.activeReconcile.id} resumed after Fleet restart.`,
          } })()
        : source.activeReconcile
      this.tasks.set(source.id, snapshot({ ...task, ...(activeReconcile === undefined ? {} : { activeReconcile }) }))
    }
    this.evaluateDependents([...this.tasks.keys()])
    this.evaluateAll()
  }

  activate(): void {
    this.assertOpen()
    if (this.active) return
    this.active = true
    this.evaluateAll()
    for (const task of this.tasks.values()) {
      this.arm(task)
      if (task.activeReconcile?.status === 'ready' && this.available(task.activeReconcile)) {
        this.emit({ action: 'reconcile_ready', task })
      }
    }
  }

  pause(): void {
    this.active = false
    for (const timer of this.dueTimers.values()) clearTimeout(timer)
    for (const timer of this.stateTimers.values()) clearTimeout(timer)
    this.dueTimers.clear()
    this.stateTimers.clear()
  }

  replayPending(member: string): void {
    for (const task of this.tasks.values()) {
      if (!this.terminal(task) && task.duePendingFor?.includes(member) === true) this.deliverDue(task, [member])
    }
  }

  list(callerId: string, input: {
    readonly state?: FleetTaskStableKind
    readonly assignee?: string
    readonly parentId?: string
  } = {}): FleetProjectTask[] {
    this.member(callerId)
    const assignee = input.assignee === undefined ? undefined : this.resolve(input.assignee)
    return [...this.tasks.values()]
      .filter(task => input.state === undefined || task.stableState.kind === input.state)
      .filter(task => assignee === undefined || task.assignees.includes(assignee))
      .filter(task => input.parentId === undefined || task.parentId === input.parentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(snapshot)
  }

  get(callerId: string, id: string): FleetProjectTask {
    this.member(callerId)
    return snapshot(this.requireTask(id))
  }

  create(callerId: string, input: CreateFleetProjectTaskInput): FleetProjectTask {
    this.assertOpen()
    const createdBy = this.member(callerId)
    const task = this.buildTask(createdBy, input)
    this.tasks.set(task.id, task)
    const materialized = this.materialize(task, this.tasks)
    this.tasks.set(task.id, materialized)
    this.arm(materialized)
    this.emit({ action: 'created', task: materialized, actor: createdBy })
    this.evaluateDependents(materialized.dependencies)
    const current = this.requireTask(materialized.id)
    if (current.activeReconcile !== undefined) this.emit({ action: 'reconcile_ready', task: current })
    return snapshot(current)
  }

  ensureInboxTask(ownerReference: string): FleetProjectTask {
    this.assertOpen()
    const owner = this.resolve(ownerReference)
    const existing = [...this.tasks.values()].find(task => task.domain.kind === 'inbox' && task.domain.owner === owner)
    if (existing !== undefined) return snapshot(existing)
    const now = new Date().toISOString()
    const task = this.buildTask(owner, {
      title: `${owner} inbox`,
      description: 'Persistent unread collaboration inbox.',
      owners: [owner],
      assignees: [owner],
      domain: { kind: 'inbox', owner, unreadMessages: 0, unreadChars: 0 },
      initialState: { kind: 'dormant', reason: 'Inbox has no unread items.', reconcilers: [] },
    })
    this.tasks.set(task.id, task)
    this.emit({ action: 'created', task, actor: SYSTEM_TARGET })
    return snapshot(task)
  }

  syncInbox(ownerReference: string, unreadMessages: number, unreadChars: number): FleetProjectTask {
    const owner = this.resolve(ownerReference)
    if (!Number.isSafeInteger(unreadMessages) || unreadMessages < 0) throw new Error('unreadMessages must be a non-negative integer')
    if (!Number.isSafeInteger(unreadChars) || unreadChars < 0) throw new Error('unreadChars must be a non-negative integer')
    const task = this.ensureInboxTask(owner)
    const current = this.requireTask(task.id)
    if (current.domain.kind !== 'inbox') throw new Error(`Fleet task ${task.id} is not an Inbox Task`)
    if (current.domain.unreadMessages === unreadMessages && current.domain.unreadChars === unreadChars) return snapshot(current)
    const domain: FleetTaskDomain = { kind: 'inbox', owner, unreadMessages, unreadChars }
    if (unreadMessages > 0 && current.stableState.kind === 'running') {
      const now = new Date().toISOString()
      const updated: FleetProjectTask = {
        ...current,
        domain,
        stableState: {
          ...current.stableState,
          reason: `Inbox contains ${String(unreadMessages)} unread items (${String(unreadChars)} characters).`,
        },
        updatedAt: now,
      }
      this.replace(updated)
      return snapshot(updated)
    }
    return this.reconcileDomain(current, domain, unreadMessages === 0
      ? { kind: 'dormant', reason: 'Inbox has no unread items.', reconcilers: [] }
      : this.runningState(`Inbox contains ${String(unreadMessages)} unread items (${String(unreadChars)} characters).`, []))
  }

  interactionTask(ownerReference: string): FleetProjectTask | undefined {
    const owner = this.resolve(ownerReference)
    const task = [...this.tasks.values()].find(candidate =>
      candidate.domain.kind === 'interaction' && candidate.domain.owner === owner)
    return task === undefined ? undefined : snapshot(task)
  }

  interactionTasks(): FleetProjectTask[] {
    return [...this.tasks.values()]
      .filter(task => task.domain.kind === 'interaction')
      .map(snapshot)
  }

  recordInteractionInput(ownerReference: string, input: {
    readonly messageId: string
    readonly text: string
  }): FleetProjectTask {
    this.assertOpen()
    const owner = this.resolve(ownerReference)
    const messageId = requiredText(input.messageId, 'interaction message id')
    const text = input.text.trim() || 'User submitted a non-text foreground input.'
    const existing = [...this.tasks.values()].find(task =>
      task.domain.kind === 'interaction' && task.domain.owner === owner)
    if (existing?.domain.kind === 'interaction' && existing.domain.latestMessageId === messageId) return snapshot(existing)
    const now = new Date().toISOString()
    const entry: FleetTaskEntry = {
      id: `entry_${randomUUID()}`,
      kind: 'comment',
      author: 'User',
      text,
      resources: [],
      createdAt: now,
    }
    if (existing === undefined) {
      const task = this.buildTask(owner, {
        title: `${owner} user interaction`,
        description: 'Persistent foreground user intent handled by this Fleet assistant.',
        priority: 'high',
        owners: [owner],
        assignees: [owner],
        domain: {
          kind: 'interaction', owner, inputRevision: 1, settledRevision: 0,
          latestMessageId: messageId, waitingTaskIds: [],
        },
        initialState: this.runningState('Foreground user input revision 1 requires a response.', []),
      })
      const created = { ...task, entries: [entry] }
      this.tasks.set(created.id, created)
      this.emit({ action: 'created', task: created, actor: SYSTEM_TARGET })
      return snapshot(created)
    }
    if (existing.domain.kind !== 'interaction') throw new Error(`Fleet task ${existing.id} is not an Interaction Task`)
    const revision = existing.domain.inputRevision + 1
    const { activeReconcile: _activeReconcile, ...base } = existing
    const domain: FleetTaskDomain = {
      kind: 'interaction', owner, inputRevision: revision,
      settledRevision: existing.domain.settledRevision,
      latestMessageId: messageId,
      waitingTaskIds: [],
    }
    const updated: FleetProjectTask = {
      ...base,
      domain,
      stableState: this.normalizeState(
        this.runningState(`Foreground user input revision ${String(revision)} requires a response.`, []),
        now, this.tasks, [], existing.id,
      ),
      stateVersion: existing.stateVersion + 1,
      entries: [...existing.entries, entry],
      updatedAt: now,
    }
    this.replace(updated)
    this.emit({ action: 'domain_updated', task: updated, actor: SYSTEM_TARGET })
    this.evaluateDependents([updated.id])
    return snapshot(updated)
  }

  deferInteraction(callerId: string, input: DeferFleetInteractionInput): {
    readonly task: FleetProjectTask
    readonly goals: FleetProjectTask[]
  } {
    const owner = this.member(callerId)
    const current = this.interactionTask(owner)
    if (current === undefined || current.domain.kind !== 'interaction') {
      throw new Error(`Fleet assistant ${owner} has no foreground Interaction Task`)
    }
    if (current.stableState.kind !== 'running') {
      throw new Error(`Fleet Interaction ${current.id} is ${current.stableState.kind}`)
    }
    if (!Number.isSafeInteger(input.checkAfterSeconds) || input.checkAfterSeconds < 1) {
      throw new Error('interaction checkAfterSeconds must be a positive integer')
    }
    const reason = requiredText(input.reason, 'interaction continuation reason')
    const now = new Date().toISOString()
    const staged = new Map(this.tasks)
    const goals: FleetProjectTask[] = []
    if (input.goal !== undefined) {
      const owners = this.resolveMany(input.goal.owners)
      if (owners.length === 0) throw new Error('interaction continuation Goal requires at least one owner')
      const goal = this.buildTask(owner, {
        title: input.goal.title,
        description: input.goal.description,
        owners,
        assignees: owners,
        parentId: current.id,
        domain: { kind: 'goal', submissions: {} },
        initialState: this.runningState(
          `Goal is awaiting ${String(owners.length)} owner submission${owners.length === 1 ? '' : 's'}.`,
          [],
        ),
      }, staged)
      staged.set(goal.id, goal)
      goals.push(goal)
    }
    const linked = this.strings(input.taskIds ?? [], 'interaction linked task id')
      .map(id => this.requireTaskFrom(staged, id))
    for (const task of linked) {
      if (task.id === current.id) throw new Error('an Interaction Task cannot wait for itself')
      if (task.stableState.kind !== 'running' && task.stableState.kind !== 'dormant') {
        throw new Error(`Fleet Interaction cannot wait for terminal task ${task.id}`)
      }
    }
    const retained = current.domain.waitingTaskIds
      .map(id => this.requireTaskFrom(staged, id))
      .filter(task => !this.settled(task))
    const waitingTaskIds = unique([
      ...retained.map(task => task.id),
      ...linked.map(task => task.id),
      ...goals.map(goal => goal.id),
    ])
    if (waitingTaskIds.length === 0) {
      throw new Error('interaction continuation requires a live task_id or a new Goal')
    }
    const nextVersion = current.stateVersion + 1
    const waitingEventKey = `interaction-quiescent:${current.id}:${String(current.domain.inputRevision)}:${String(nextVersion)}`
    const checkAt = new Date(Date.now() + input.checkAfterSeconds * 1_000).toISOString()
    const systemFallback: FleetTaskTimeoutState = {
      kind: 'blocked', reason: `Interaction ${current.id} system reconciliation failed.`,
    }
    const reconciler = (
      id: string,
      when: FleetTaskTrigger,
      priority: number,
    ): FleetTaskReconcilerSpec => ({
      id, when, target: SYSTEM_TARGET, priority, retryAfterSeconds: 0, maxWakeups: 1,
      onTimeout: systemFallback,
    })
    const {
      pendingDelivery: _pendingDelivery,
      reportIntent: _reportIntent,
      executionLease: _executionLease,
      ...interaction
    } = current.domain
    const domain: FleetTaskDomain = {
      ...interaction,
      waitingTaskIds,
      waitingEventKey,
    }
    const { activeReconcile: _activeReconcile, ...base } = current
    const updated: FleetProjectTask = {
      ...base,
      domain,
      stableState: this.normalizeState({
        kind: 'dormant',
        reason,
        reconcilers: [
          reconciler('interaction-team-quiescent', { kind: 'event', eventKey: waitingEventKey }, 10),
          reconciler('interaction-stall-check', { kind: 'at', at: checkAt }, 0),
        ],
      }, now, staged, [], current.id),
      stateVersion: nextVersion,
      updatedAt: now,
    }
    staged.set(updated.id, updated)
    this.commit(staged, [updated, ...goals])
    for (const goal of goals) this.emit({ action: 'created', task: goal, actor: owner })
    this.emit({ action: 'domain_updated', task: updated, actor: owner })
    return { task: snapshot(updated), goals: goals.map(snapshot) }
  }

  takeOverInteraction(callerId: string, reason: string): FleetProjectTask {
    const owner = this.member(callerId)
    const current = this.interactionTask(owner)
    if (current === undefined || current.domain.kind !== 'interaction') {
      throw new Error(`Fleet assistant ${owner} has no foreground Interaction Task`)
    }
    if (current.stableState.kind !== 'running') {
      throw new Error(`Fleet Interaction ${current.id} is ${current.stableState.kind}`)
    }
    if (current.domain.waitingTaskIds.some(id => !this.settled(this.requireTask(id)))) {
      throw new Error(`Fleet Interaction ${current.id} still waits for live Team Tasks`)
    }
    const executionLease: FleetInteractionExecutionLease = {
      revision: current.domain.inputRevision,
      reason: requiredText(reason, 'interaction take-over reason'),
      grantedAt: new Date().toISOString(),
    }
    return this.reconcileDomain(current, { ...current.domain, executionLease }, this.runningState(
      `Assistant explicitly took execution ownership for input revision ${String(executionLease.revision)}.`,
      [],
    ), owner)
  }

  submitInteractionReport(callerId: string, input: {
    readonly outcome: 'complete' | 'block'
    readonly reason: string
    readonly report: string
  }): FleetProjectTask {
    const owner = this.member(callerId)
    const current = this.interactionTask(owner)
    if (current === undefined || current.domain.kind !== 'interaction') {
      throw new Error(`Fleet assistant ${owner} has no foreground Interaction Task`)
    }
    if (current.stableState.kind !== 'running') {
      throw new Error(`Fleet Interaction ${current.id} is ${current.stableState.kind}`)
    }
    const liveTasks = current.domain.waitingTaskIds.filter(id => !this.settled(this.requireTask(id)))
    if (liveTasks.length > 0) {
      throw new Error(`Fleet Interaction ${current.id} still waits for live Tasks: ${liveTasks.join(', ')}; continue the Interaction instead of reporting it`)
    }
    const reportIntent: FleetInteractionReportIntent = {
      revision: current.domain.inputRevision,
      outcome: input.outcome,
      reason: requiredText(input.reason, 'interaction report reason'),
      report: requiredText(input.report, 'interaction foreground report'),
      submittedAt: new Date().toISOString(),
    }
    return this.reconcileDomain(current, { ...current.domain, reportIntent }, this.runningState(
      `Foreground report for input revision ${String(reportIntent.revision)} is awaiting native assistant output.`,
      [],
    ), owner)
  }

  commitInteractionOutput(ownerReference: string, output: string): FleetProjectTask | undefined {
    const owner = this.resolve(ownerReference)
    const current = this.interactionTask(owner)
    if (current === undefined || current.domain.kind !== 'interaction') return undefined
    const intent = current.domain.reportIntent
    if (intent === undefined || intent.revision !== current.domain.inputRevision || output.trim().length === 0) return undefined
    const {
      waitingEventKey: _waitingEventKey,
      pendingDelivery: _pendingDelivery,
      reportIntent: _reportIntent,
      ...interaction
    } = current.domain
    const domain: FleetTaskDomain = {
      ...interaction,
      settledRevision: intent.revision,
      waitingTaskIds: [],
    }
    return this.reconcileDomain(current, domain, intent.outcome === 'complete'
      ? { kind: 'completed', reason: intent.reason, result: intent.report }
      : { kind: 'blocked', reason: intent.reason }, owner)
  }

  settleDirectInteractionOutput(ownerReference: string, output: string): FleetProjectTask | undefined {
    const owner = this.resolve(ownerReference)
    const current = this.interactionTask(owner)
    if (current === undefined || current.domain.kind !== 'interaction'
      || current.stableState.kind !== 'running'
      || current.domain.reportIntent !== undefined
      || current.domain.pendingDelivery !== undefined
      || current.domain.executionLease !== undefined
      || current.domain.waitingTaskIds.length > 0
      || output.trim().length === 0) return undefined
    const domain: FleetTaskDomain = {
      ...current.domain,
      settledRevision: current.domain.inputRevision,
      waitingTaskIds: [],
    }
    return this.reconcileDomain(current, domain, {
      kind: 'completed',
      reason: 'The native assistant response completed this direct foreground interaction.',
      result: output.trim(),
    }, owner)
  }

  signalInteractionDelivery(ownerReference: string, result: string): FleetProjectTask | undefined {
    const task = this.interactionTask(ownerReference)
    if (task === undefined || task.domain.kind !== 'interaction'
      || task.stableState.kind !== 'dormant' || task.domain.waitingEventKey === undefined) return undefined
    return this.signalEvent(task.id, task.domain.waitingEventKey, result)
  }

  ensureReplyTask(input: EnsureFleetReplyTaskInput): FleetProjectTask {
    this.assertOpen()
    const assignee = this.resolve(input.assignee)
    const existing = [...this.tasks.values()].find(task => task.domain.kind === 'reply'
      && task.domain.messageId === input.messageId && task.domain.assignee === assignee)
    if (existing !== undefined) return snapshot(existing)
    const createdBy = requiredText(input.createdBy, 'task creator')
    const task = this.buildTask(createdBy, {
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      priority: 'high',
      owners: [assignee],
      assignees: [assignee],
      domain: {
        kind: 'reply',
        messageId: requiredText(input.messageId, 'required message id'),
        conversation: requiredText(input.conversation, 'required message conversation'),
        assignee,
        replyTarget: requiredText(input.replyTarget ?? input.conversation, 'required message reply target'),
      },
      initialState: this.runningState(
        `Reply to message ${input.messageId} is required.`,
        input.timeoutAt === undefined ? [] : [
          this.timeoutReconciler('reply-timeout', input.timeoutAt, `Reply deadline ${input.timeoutAt} elapsed.`),
        ],
      ),
      ...(input.resources === undefined ? {} : { resources: input.resources }),
    })
    this.tasks.set(task.id, task)
    this.emit({ action: 'created', task, actor: createdBy })
    return snapshot(task)
  }

  pendingReply(reference: string): FleetProjectTask | undefined {
    const assignee = this.resolve(reference)
    const task = [...this.tasks.values()]
      .filter(candidate => candidate.domain.kind === 'reply' && candidate.domain.assignee === assignee)
      .filter(candidate => this.pendingForOwner(candidate, assignee))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
    return task === undefined ? undefined : snapshot(task)
  }

  readyTasks(reference?: string): FleetProjectTask[] {
    const target = reference === undefined ? undefined : this.resolve(reference)
    return [...this.tasks.values()]
      .filter(task => task.activeReconcile?.status === 'ready' && this.available(task.activeReconcile))
      .filter(task => target === undefined || task.activeReconcile?.target === target)
      .filter(task => task.dependencies.every(dependency => this.requireTask(dependency).stableState.kind === 'completed'))
      .sort((left, right) => {
        const priority = { high: 0, normal: 1, low: 2 } as const
        return priority[left.priority] - priority[right.priority]
          || (right.activeReconcile?.priority ?? 0) - (left.activeReconcile?.priority ?? 0)
          || left.createdAt.localeCompare(right.createdAt)
      })
      .map(snapshot)
  }

  ownerTasks(reference: string): FleetProjectTask[] {
    const owner = this.resolve(reference)
    return [...this.tasks.values()]
      .filter(task => task.stableState.kind === 'running')
      .filter(task => task.owners.some(candidate => candidate.member === owner) && this.pendingForOwner(task, owner))
      .sort((left, right) => {
        const priority = { high: 0, normal: 1, low: 2 } as const
        return priority[left.priority] - priority[right.priority] || left.createdAt.localeCompare(right.createdAt)
      })
      .map(snapshot)
  }

  createCompositePlan(callerId: string, input: CreateFleetCompositePlanInput): {
    readonly task: FleetProjectTask
    readonly stages: ReadonlyMap<string, FleetProjectTask>
  } {
    this.assertOpen()
    const actor = this.member(callerId)
    const coordinator = this.resolve(input.coordinator)
    if (input.stages.length === 0) throw new Error('Fleet composite plan requires at least one stage')
    const acceptanceVote = input.stages.some(stage => stage.kind === 'vote')
    const stageKeys = new Set<string>()
    const now = new Date().toISOString()
    const staged = new Map(this.tasks)
    const root = this.buildTask(actor, {
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      decision: acceptanceVote ? 'vote' : 'direct',
      owners: [],
      assignees: [coordinator],
      // Linked kickoff obligations belong to the observed cohort, not to the
      // root's claim gate. A blocked Reply/Goal must still let the coordinator
      // reconcile the composite instead of stranding a ready attempt.
      dependencies: [],
      domain: {
        kind: 'composite', managedChildren: true,
        ...(input.rootWorkId === undefined ? {} : { rootWorkId: requiredText(input.rootWorkId, 'root work id') }),
      },
      initialState: { kind: 'paused', reason: 'Composite plan is being created atomically.' },
    }, staged)
    staged.set(root.id, root)

    const stages = new Map<string, FleetProjectTask>()
    for (const inputStage of input.stages) {
      const key = requiredText(inputStage.key, 'composite stage key')
      if (stageKeys.has(key)) throw new Error(`duplicate Fleet composite stage key ${key}`)
      const dependencyKeys = inputStage.dependencies ?? []
      const dependencies = dependencyKeys.map(dependency => {
        const task = stages.get(dependency)
        if (task === undefined) throw new Error(`Fleet composite stage ${key} has unknown earlier dependency ${dependency}`)
        return task.id
      })
      const stage = inputStage.kind === 'vote'
        ? this.buildVoteTask(root, actor, {
            kind: 'vote', title: inputStage.title, channel: '#main',
            statement: inputStage.description?.trim() || inputStage.title,
            voters: inputStage.owners, dependencies,
            ...(inputStage.timeoutAt === undefined ? {} : { timeoutAt: inputStage.timeoutAt }),
          }, now, staged)
        : this.buildGoalTask(actor, {
            title: inputStage.title,
            ...(inputStage.description === undefined ? {} : { description: inputStage.description }),
            owners: inputStage.owners,
            parentId: root.id,
            dependencies,
            ...(inputStage.resources === undefined ? {} : { resources: inputStage.resources }),
            ...(input.rootWorkId === undefined ? {} : { rootWorkId: input.rootWorkId }),
            ...(inputStage.timeoutAt === undefined ? {} : { timeoutAt: inputStage.timeoutAt }),
          }, staged)
      stageKeys.add(key)
      stages.set(key, stage)
      staged.set(stage.id, stage)
    }

    const resultStage = input.resultStage === undefined
      ? [...stages.entries()].reverse().find(([, stage]) => stage.domain.kind === 'goal')
      : [input.resultStage, stages.get(input.resultStage)] as const
    const plan = {
      stages: Object.fromEntries([...stages].map(([key, stage]) => [key, stage.id])),
      requiredStageIds: unique([
        ...[...stages.values()].map(stage => stage.id),
        ...(input.dependencies ?? []),
      ]),
      ...(resultStage?.[1] === undefined ? {} : { resultStageId: resultStage[1].id }),
      acceptanceVoteIds: [...stages.values()]
        .filter(stage => stage.domain.kind === 'vote')
        .map(stage => stage.id),
    }

    const cohort = unique([
      ...[...stages.values()].map(stage => stage.id),
      ...(input.dependencies ?? []),
    ])
    const reconciler: FleetTaskReconcilerSpec = {
      id: 'advance-composite',
      when: { kind: 'child_count', states: ['completed', 'blocked', 'cancelled'], op: 'eq', value: 'cohort' },
      target: coordinator,
      priority: 0,
      retryAfterSeconds: 0,
      maxWakeups: 3,
      ...(input.timeoutAt === undefined ? {} : { timeoutAt: this.date(input.timeoutAt, 'composite timeoutAt') }),
      onTimeout: { kind: 'blocked', reason: `Composite Task ${root.id} exhausted its continuation.` },
    }
    const planned: FleetProjectTask = {
      ...root,
      domain: { ...(root.domain as Extract<FleetTaskDomain, { kind: 'composite' }>), plan },
      stableState: this.normalizeState({
        kind: 'running',
        reason: `Waiting for ${String(cohort.length)} current cohort Task${cohort.length === 1 ? '' : 's'} to settle.`,
        cohort,
        reconcilers: [reconciler],
      }, now, staged, [], root.id),
      updatedAt: now,
    }
    const materialized = this.materialize(planned, new Map(staged).set(root.id, planned))
    staged.set(root.id, materialized)
    const changed = [materialized, ...stages.values()]
    this.commit(staged, changed)
    this.emit({ action: 'created', task: materialized, actor })
    for (const stage of stages.values()) this.emit({ action: 'created', task: stage, actor })
    if (materialized.activeReconcile !== undefined) this.emit({ action: 'reconcile_ready', task: materialized })
    return {
      task: snapshot(materialized),
      stages: new Map([...stages].map(([key, task]) => [key, snapshot(task)])),
    }
  }

  createGoal(callerId: string, input: {
    readonly title: string
    readonly description?: string
    readonly owners?: readonly string[]
    readonly parentId?: string
    readonly dependencies?: readonly string[]
    readonly resources?: readonly string[]
    readonly rootWorkId?: string
    readonly timeoutAt?: string
  }): FleetProjectTask {
    const creator = this.member(callerId)
    if (input.parentId !== undefined) {
      const parent = this.requireTask(input.parentId)
      if (parent.domain.kind === 'composite' && parent.domain.managedChildren === true) {
        throw new Error(`Fleet composite Task ${parent.id} accepts children only through its ReconcileAttempt`)
      }
    }
    const task = this.buildGoalTask(creator, input)
    this.tasks.set(task.id, task)
    this.arm(task)
    this.emit({ action: 'created', task, actor: creator })
    this.evaluateDependents(task.dependencies)
    return snapshot(this.requireTask(task.id))
  }

  submitGoal(callerId: string, id: string, input: {
    readonly kind: 'complete' | 'block'
    readonly reason: string
    readonly result?: string
  }): FleetProjectTask {
    const owner = this.member(callerId)
    const current = this.requireTask(id)
    if (current.domain.kind !== 'goal') throw new Error(`Fleet task ${id} is not a Goal`)
    if (current.stableState.kind !== 'running') throw new Error(`Fleet Goal ${id} is ${current.stableState.kind}`)
    if (!current.owners.some(candidate => candidate.member === owner)) throw new Error(`Fleet member ${owner} does not own Goal ${id}`)
    if (current.domain.submissions[owner] !== undefined) throw new Error(`Fleet member ${owner} already submitted Goal ${id}`)
    if (input.kind === 'complete') {
      const incompleteDependencies = current.dependencies.filter(dependency =>
        this.requireTask(dependency).stableState.kind !== 'completed')
      if (incompleteDependencies.length > 0) {
        throw new Error(`Fleet Goal ${id} has incomplete dependencies: ${incompleteDependencies.join(', ')}`)
      }
      const unsettledChildren = this.descendants(current.id).filter(task => !this.settled(task))
      if (unsettledChildren.length > 0) {
        throw new Error(`Fleet Goal ${id} still has unsettled child Tasks: ${unsettledChildren.map(task => task.id).join(', ')}`)
      }
    }
    const reason = requiredText(input.reason, 'goal submission reason')
    const submittedAt = new Date().toISOString()
    const submission: FleetGoalSubmission = input.kind === 'block'
      ? { kind: 'block', reason, submittedAt }
      : {
          kind: 'complete', reason, submittedAt,
          ...(input.result === undefined ? {} : { result: requiredText(input.result, 'goal result') }),
        }
    const domain: FleetTaskDomain = {
      ...current.domain,
      submissions: { ...current.domain.submissions, [owner]: submission },
    }
    const pending = current.owners.filter(candidate => domain.kind === 'goal' && domain.submissions[candidate.member] === undefined)
    const blockers = Object.entries(domain.kind === 'goal' ? domain.submissions : {})
      .filter((entry): entry is [string, Extract<FleetGoalSubmission, { kind: 'block' }>] => entry[1].kind === 'block')
    if (blockers.length > 0) {
      return this.reconcileDomain(current, domain, {
        kind: 'blocked',
        reason: blockers.map(([member, value]) => `${member}: ${value.reason}`).join('; '),
      }, owner)
    }
    if (pending.length === 0) {
      const completed = Object.entries(domain.kind === 'goal' ? domain.submissions : {})
        .filter((entry): entry is [string, Extract<FleetGoalSubmission, { kind: 'complete' }>] => entry[1].kind === 'complete')
      const results = completed.filter((entry): entry is [string, Extract<FleetGoalSubmission, { kind: 'complete' }> & { result: string }] => entry[1].result !== undefined)
      const result = results.length === 1 && completed.length === 1
        ? results[0]![1].result
        : results.map(([member, value]) => `${member}: ${value.result}`).join('\n')
      return this.reconcileDomain(current, domain, {
        kind: 'completed',
        reason: completed.map(([member, value]) => `${member}: ${value.reason}`).join('; '),
        ...(result.length === 0 ? {} : { result }),
      }, owner)
    }
    return this.reconcileDomain(current, domain, this.runningState(
      `Goal received ${String(current.owners.length - pending.length)} of ${String(current.owners.length)} owner submissions.`,
      [],
    ), owner)
  }

  splitGoal(callerId: string, id: string, input: {
    readonly children: readonly FleetGoalSplitStageInput[]
  }): { readonly task: FleetProjectTask; readonly children: ReadonlyMap<string, FleetProjectTask> } {
    const owner = this.member(callerId)
    const current = this.requireTask(id)
    if (current.domain.kind !== 'goal') throw new Error(`Fleet task ${id} is not a Goal`)
    if (current.stableState.kind !== 'running') throw new Error(`Fleet Goal ${id} is ${current.stableState.kind}`)
    if (!current.owners.some(candidate => candidate.member === owner)) throw new Error(`Fleet member ${owner} does not own Goal ${id}`)
    const incompleteDependencies = current.dependencies.filter(dependency =>
      this.requireTask(dependency).stableState.kind !== 'completed')
    if (incompleteDependencies.length > 0) {
      throw new Error(`Fleet Goal ${id} has incomplete dependencies: ${incompleteDependencies.join(', ')}`)
    }
    if (input.children.length === 0) throw new Error(`Fleet Goal ${id} split requires child Goals`)

    const staged = new Map(this.tasks)
    const children = new Map<string, FleetProjectTask>()
    for (const inputChild of input.children) {
      const key = requiredText(inputChild.key, 'split child key')
      if (children.has(key)) throw new Error(`duplicate Fleet split child key ${key}`)
      const dependencies = (inputChild.dependencies ?? []).map(dependencyKey => {
        const dependency = children.get(dependencyKey)
        if (dependency === undefined) throw new Error(`Fleet split child ${key} has unknown earlier dependency ${dependencyKey}`)
        return dependency.id
      })
      const child = this.buildGoalTask(owner, {
        title: inputChild.title,
        ...(inputChild.description === undefined ? {} : { description: inputChild.description }),
        owners: inputChild.owners,
        parentId: current.id,
        dependencies,
        ...(inputChild.resources === undefined ? {} : { resources: inputChild.resources }),
        ...(current.domain.rootWorkId === undefined ? {} : { rootWorkId: current.domain.rootWorkId }),
        ...(inputChild.timeoutAt === undefined ? {} : { timeoutAt: inputChild.timeoutAt }),
      }, staged)
      children.set(key, child)
      staged.set(child.id, child)
    }

    const now = new Date().toISOString()
    const { activeReconcile: _activeReconcile, ...base } = current
    const updated: FleetProjectTask = {
      ...base,
      stableState: {
        kind: 'running', since: now,
        reason: `Waiting for ${String(children.size)} split child Goal${children.size === 1 ? '' : 's'} to settle.`,
        cohort: [...children.values()].map(child => child.id),
        reconcilers: [],
      },
      stateVersion: current.stateVersion + 1,
      updatedAt: now,
    }
    staged.set(updated.id, updated)
    this.commit(staged, [updated, ...children.values()])
    for (const child of children.values()) this.emit({ action: 'created', task: child, actor: owner })
    this.emit({ action: 'domain_updated', task: updated, actor: owner })
    return {
      task: snapshot(updated),
      children: new Map([...children].map(([key, child]) => [key, snapshot(child)])),
    }
  }

  createVote(callerId: string, input: {
    readonly title?: string
    readonly statement: string
    readonly channel: `#${string}`
    readonly voters: readonly string[]
    readonly parentId?: string
    readonly timeoutAt?: string
  }): FleetProjectTask {
    const initiator = this.member(callerId)
    const voters = this.resolveMany(input.voters).filter(voter => voter !== initiator)
    if (voters.length === 0) throw new Error('Fleet Vote requires at least one voter other than its initiator')
    if (input.parentId !== undefined) {
      const parent = this.requireTask(input.parentId)
      if (parent.domain.kind === 'composite' && parent.domain.managedChildren === true) {
        throw new Error(`Fleet composite Task ${parent.id} accepts children only through its ReconcileAttempt`)
      }
    }
    return this.create(callerId, {
      title: input.title ?? `Vote: ${input.statement}`,
      description: requiredText(input.statement, 'vote statement'),
      owners: voters,
      assignees: voters,
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      domain: {
        kind: 'vote',
        channel: input.channel,
        statement: requiredText(input.statement, 'vote statement'),
        initiator,
        voters,
        ballots: [],
      },
      initialState: this.runningState(
        `Vote is awaiting ${String(voters.length)} ballots.`,
        input.timeoutAt === undefined ? [] : [
          this.timeoutReconciler('vote-timeout', input.timeoutAt, `Vote deadline ${input.timeoutAt} elapsed.`),
        ],
      ),
    })
  }

  castVote(callerId: string, id: string, decision: FleetVoteDecision, reasonInput: string): FleetProjectTask {
    const voter = this.member(callerId)
    const current = this.requireTask(id)
    if (current.domain.kind !== 'vote') throw new Error(`Fleet task ${id} is not a Vote`)
    if (current.stableState.kind !== 'running') throw new Error(`Fleet Vote ${id} is ${current.stableState.kind}`)
    if (!current.domain.voters.includes(voter)) throw new Error(`Fleet member ${voter} is not a voter on ${id}`)
    if (current.domain.ballots.some(ballot => ballot.voter === voter)) throw new Error(`Fleet member ${voter} already voted on ${id}`)
    const reason = requiredText(reasonInput, 'vote reason')
    const ballots = [...current.domain.ballots, { voter, decision, reason, submittedAt: new Date().toISOString() }]
    const outcome = ballots.some(ballot => ballot.decision === 'reject')
      ? 'reject' as const
      : ballots.length === current.domain.voters.length ? 'approve' as const : undefined
    const domain: FleetTaskDomain = { ...current.domain, ballots, ...(outcome === undefined ? {} : { outcome }) }
    if (outcome === undefined) {
      return this.reconcileDomain(current, domain, this.runningState(
        `Vote received ${String(ballots.length)} of ${String(current.domain.voters.length)} ballots.`,
        [],
      ), voter)
    }
    const outcomeReason = outcome === 'approve'
      ? ballots.map(ballot => `${ballot.voter}: ${ballot.reason}`).join('; ')
      : ballots.filter(ballot => ballot.decision === 'reject').map(ballot => `${ballot.voter}: ${ballot.reason}`).join('; ')
    return this.reconcileDomain(current, domain, {
      kind: 'completed',
      reason: `Vote ${outcome}: ${outcomeReason}`,
      result: outcome,
    }, voter)
  }

  recordReply(callerId: string, id: string, completionMessageId: string): FleetProjectTask {
    const assignee = this.member(callerId)
    const current = this.requireTask(id)
    if (current.domain.kind !== 'reply') throw new Error(`Fleet task ${id} is not a Reply Task`)
    if (current.domain.assignee !== assignee) throw new Error(`Fleet Reply ${id} belongs to ${current.domain.assignee}`)
    if (current.domain.completionMessageId !== undefined) return snapshot(current)
    const messageId = requiredText(completionMessageId, 'reply completion message id')
    return this.reconcileDomain(current, { ...current.domain, completionMessageId: messageId }, {
      kind: 'completed',
      reason: `Reply ${messageId} was delivered to ${current.domain.replyTarget}.`,
      result: messageId,
    }, assignee)
  }

  runningFor(reference: string): FleetProjectTask[] {
    const target = this.resolve(reference)
    return [...this.tasks.values()]
      .filter(task => task.activeReconcile?.status === 'running' && task.activeReconcile.target === target)
      .map(snapshot)
  }

  reservedFor(reference: string): FleetProjectTask[] {
    const target = this.resolve(reference)
    return [...this.tasks.values()].filter(task => task.activeReconcile?.target === target).map(snapshot)
  }

  activeWorkIsCovered(): boolean {
    const active = [...this.tasks.values()].filter(task => !this.terminal(task))
    return active.length > 0 && active.every(task => {
      if (task.stableState.kind !== 'running' && task.stableState.kind !== 'dormant') return true
      return task.activeReconcile !== undefined || task.stableState.reconcilers.length > 0
        || task.owners.some(owner => this.pendingForOwner(task, owner.member))
    })
  }

  claim(callerId: string, id: string): FleetProjectTask {
    const actor = this.member(callerId)
    const current = this.requireTask(id)
    const reconcile = current.activeReconcile
    if (reconcile?.status === 'running') {
      throw new Error(
        `Fleet task ${id} ReconcileAttempt ${reconcile.attemptId ?? reconcile.id} is already claimed; `
        + `call fleet_reconcile resolve with id="${id}", attempt_id="${reconcile.attemptId ?? ''}", progress, and state`,
      )
    }
    if (reconcile?.status !== 'ready') throw new Error(`Fleet task ${id} has no ready ReconcileAttempt`)
    if (reconcile.target !== actor) {
      throw new Error(`Fleet task ${id} ReconcileAttempt is reserved for ${reconcile.target}, not ${actor}`)
    }
    if (!this.available(reconcile)) throw new Error(`Fleet task ${id} ReconcileAttempt is not ready until ${reconcile.readyAt}`)
    const incomplete = current.dependencies.filter(dependency => this.requireTask(dependency).stableState.kind !== 'completed')
    if (incomplete.length > 0) throw new Error(`Fleet task ${id} has incomplete dependencies: ${incomplete.join(', ')}`)
    if (reconcile.wakeups >= reconcile.maxWakeups) {
      this.expireReconcile(current, `Reconcile ${reconcile.id} exhausted ${reconcile.maxWakeups} wakeups.`)
      throw new Error(`Fleet task ${id} ReconcileAttempt exhausted its wakeups`)
    }
    if (reconcile.timeoutAt !== undefined && new Date(reconcile.timeoutAt).getTime() <= Date.now()) {
      this.expireReconcile(current, `Reconcile ${reconcile.id} timed out at ${reconcile.timeoutAt}.`)
      throw new Error(`Fleet task ${id} ReconcileAttempt timed out`)
    }
    const now = new Date().toISOString()
    const activeReconcile: FleetTaskActiveReconcile = {
      ...reconcile,
      status: 'running',
      attemptId: `attempt_${randomUUID()}`,
      startedAt: now,
      wakeups: reconcile.wakeups + 1,
    }
    const updated = { ...current, activeReconcile, updatedAt: now }
    this.replace(updated)
    this.emit({ action: 'reconcile_started', task: updated, actor })
    return snapshot(updated)
  }

  settle(callerId: string, id: string, input: SettleFleetTaskAttemptInput): FleetProjectTask {
    const actor = this.member(callerId)
    const current = this.requireTask(id)
    const reconcile = current.activeReconcile
    if (reconcile?.status !== 'running' || reconcile.attemptId !== input.attemptId) {
      throw new Error(`Fleet task ${id} attempt ${input.attemptId} is no longer current`)
    }
    if (reconcile.target !== actor) throw new Error(`Fleet task ${id} attempt belongs to ${reconcile.target}, not ${actor}`)
    if (reconcile.sourceStateVersion !== current.stateVersion) {
      throw new Error(
        `Fleet task ${id} attempt was created for state version ${reconcile.sourceStateVersion}, not current version ${current.stateVersion}`,
      )
    }
    const progress = requiredText(input.progress, 'task reconciliation progress')
    const now = new Date().toISOString()
    const owners = input.owners === undefined ? current.owners : this.mergeOwners(current.owners, input.owners, now)
    const staged = new Map(this.tasks)
    const changedChildren: Array<{ action: 'created' | 'reconciled'; task: FleetProjectTask }> = []
    const addedToCohort: string[] = []
    const voteChildren: FleetProjectTask[] = []

    for (const operation of input.childOps ?? []) {
      if (operation.kind === 'create') {
        const child = this.buildTask(actor, { ...operation.task, parentId: current.id }, staged)
        const materialized = this.materialize(child, new Map(staged).set(child.id, child))
        staged.set(child.id, materialized)
        changedChildren.push({ action: 'created', task: materialized })
        addedToCohort.push(child.id)
      } else if (operation.kind === 'goal') {
        const rootWorkId = current.domain.kind === 'composite' || current.domain.kind === 'goal'
          ? current.domain.rootWorkId
          : undefined
        const child = this.buildGoalTask(actor, {
          title: operation.title,
          ...(operation.description === undefined ? {} : { description: operation.description }),
          owners: operation.owners,
          parentId: current.id,
          ...(operation.dependencies === undefined ? {} : { dependencies: operation.dependencies }),
          ...(operation.resources === undefined ? {} : { resources: operation.resources }),
          ...(rootWorkId === undefined ? {} : { rootWorkId }),
          ...(operation.timeoutAt === undefined ? {} : { timeoutAt: operation.timeoutAt }),
        }, staged)
        const materialized = this.materialize(child, new Map(staged).set(child.id, child))
        staged.set(child.id, materialized)
        changedChildren.push({ action: 'created', task: materialized })
        addedToCohort.push(child.id)
      } else if (operation.kind === 'link') {
        const linked = this.requireTaskFrom(staged, operation.taskId)
        if (linked.id === current.id) throw new Error('a Fleet task cannot include itself in its cohort')
        addedToCohort.push(linked.id)
      } else if (operation.kind === 'cancel') {
        const child = this.requireTaskFrom(staged, operation.taskId)
        if (child.parentId !== current.id) throw new Error(`Fleet task ${child.id} is not owned by ${current.id}`)
        const { activeReconcile: _childReconcile, ...childWithoutReconcile } = child
        const cancelled: FleetProjectTask = {
          ...childWithoutReconcile,
          stableState: { kind: 'cancelled', cancelledAt: now, reason: requiredText(operation.reason, 'child cancellation reason') },
          stateVersion: child.stateVersion + 1,
          updatedAt: now,
        }
        staged.set(child.id, cancelled)
        changedChildren.push({ action: 'reconciled', task: cancelled })
      } else {
        const child = this.buildVoteTask(current, actor, operation, now, staged)
        staged.set(child.id, child)
        changedChildren.push({ action: 'created', task: child })
        addedToCohort.push(child.id)
        voteChildren.push(child)
      }
    }

    const entry: FleetTaskEntry = {
      id: `entry_${randomUUID()}`,
      kind: 'progress',
      author: actor,
      text: progress,
      resources: [],
      createdAt: now,
    }
    const next = this.normalizeState(input.next, now, staged, addedToCohort, current.id)
    if ((next.kind === 'running' || next.kind === 'dormant') && next.reconcilers.length === 0) {
      throw new Error(`Fleet task ${id} must install at least one reconciler before its current attempt can end`)
    }
    this.assertDecision(current, next, staged)
    if (next.kind === 'completed') {
      const incomplete = current.dependencies.filter(dependency => this.requireTaskFrom(staged, dependency).stableState.kind !== 'completed')
      if (incomplete.length > 0) throw new Error(`Fleet task ${id} has incomplete dependencies: ${incomplete.join(', ')}`)
    }
    const { activeReconcile: _currentReconcile, ...currentWithoutReconcile } = current
    const base: FleetProjectTask = {
      ...currentWithoutReconcile,
      stableState: next,
      owners,
      stateVersion: current.stateVersion + 1,
      entries: [...current.entries, entry],
      updatedAt: now,
    }
    const updated = this.materialize(base, new Map(staged).set(base.id, base))
    staged.set(updated.id, updated)
    this.commit(staged, [updated, ...changedChildren.map(child => child.task)])
    for (const child of changedChildren) this.emit({ action: child.action, task: child.task, actor })
    this.emit({ action: next.kind === 'completed' ? 'completed' : 'reconciled', task: updated, actor })
    if (updated.activeReconcile !== undefined) this.emit({ action: 'reconcile_ready', task: updated })
    for (const child of changedChildren) {
      if (child.task.activeReconcile !== undefined) this.emit({ action: 'reconcile_ready', task: child.task })
    }
    this.evaluateDependents([updated.id, ...changedChildren.map(child => child.task.id)])
    return snapshot(this.requireTask(updated.id))
  }

  signalEvent(id: string, eventKey: string, result = 'Event completed.'): FleetProjectTask {
    const current = this.requireTask(id)
    const key = requiredText(eventKey, 'task event key')
    if (current.signals.some(signal => signal.eventKey === key)) return snapshot(current)
    const now = new Date().toISOString()
    const signaled: FleetProjectTask = {
      ...current,
      signals: [...current.signals, { eventKey: key, result: requiredText(result, 'task event result'), signaledAt: now }],
      updatedAt: now,
    }
    const updated = this.materialize(signaled, new Map(this.tasks).set(id, signaled))
    this.replace(updated)
    this.emit({ action: 'signaled', task: updated })
    if (updated.activeReconcile !== undefined && current.activeReconcile === undefined) this.emit({ action: 'reconcile_ready', task: updated })
    this.runSystemReconcile(updated.id)
    return snapshot(this.requireTask(id))
  }

  releaseRunning(reference: string, reason: string): FleetProjectTask[] {
    const actor = this.resolve(reference)
    const released: FleetProjectTask[] = []
    for (const current of [...this.tasks.values()]) {
      const reconcile = current.activeReconcile
      if (reconcile?.status !== 'running' || reconcile.target !== actor) continue
      const explanation = requiredText(reason, 'reconciliation reason')
      if (reconcile.wakeups >= reconcile.maxWakeups
        || (reconcile.timeoutAt !== undefined && new Date(reconcile.timeoutAt).getTime() <= Date.now())) {
        released.push(this.expireReconcile(current, `Attempt ${reconcile.attemptId} ended without settlement: ${explanation}`))
        continue
      }
      const now = new Date().toISOString()
      const { attemptId: _attemptId, startedAt: _startedAt, ...retry } = reconcile
      const activeReconcile: FleetTaskActiveReconcile = {
        ...retry,
        status: 'ready',
        readyAt: new Date(Date.now() + reconcile.retryAfterSeconds * 1_000).toISOString(),
        reason: `Attempt ${reconcile.attemptId} ended without settlement: ${explanation}`,
      }
      const updated = { ...current, activeReconcile, updatedAt: now }
      this.replace(updated)
      this.emit({ action: 'retrying', task: updated, actor })
      if (this.available(activeReconcile)) this.emit({ action: 'reconcile_ready', task: updated })
      released.push(snapshot(updated))
    }
    return released
  }

  update(callerId: string, id: string, input: UpdateFleetProjectTaskInput): FleetProjectTask {
    const current = this.requireTask(id)
    this.requireResponsible(callerId, current)
    if (Object.values(input).every(value => value === undefined)) throw new Error('task update requires a change')
    const now = new Date().toISOString()
    const owners = input.owners === undefined ? current.owners : this.mergeOwners(current.owners, input.owners, now)
    const ownersChanged = owners.length !== current.owners.length
      || owners.some(owner => !current.owners.some(candidate => candidate.member === owner.member))
    if (ownersChanged && current.activeReconcile !== undefined) {
      throw new Error(`Fleet task ${id} owners must be changed by settling its current ReconcileAttempt`)
    }
    const dependencies = input.dependencies === undefined ? undefined : this.taskReferences(input.dependencies, id)
    let updated: FleetProjectTask = {
      ...current,
      ...(input.title === undefined ? {} : { title: requiredText(input.title, 'task title') }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.decision === undefined ? {} : { decision: input.decision }),
      ...(input.owners === undefined ? {} : { owners }),
      ...(input.assignees === undefined ? {} : { assignees: this.resolveMany(input.assignees) }),
      ...(input.reviewers === undefined ? {} : { reviewers: this.resolveMany(input.reviewers) }),
      ...(input.followers === undefined ? {} : { followers: this.resolveMany(input.followers) }),
      ...(dependencies === undefined ? {} : { dependencies }),
      ...(input.dueAt === undefined ? {} : { dueAt: this.date(input.dueAt, 'task dueAt') }),
      ...(input.resources === undefined ? {} : { resources: this.strings(input.resources, 'resource id') }),
      updatedAt: now,
    }
    if (input.dueAt !== undefined) {
      const { dueNotifiedAt: _dueNotifiedAt, duePendingFor: _duePendingFor, ...withoutNotification } = updated
      updated = withoutNotification
    }
    updated = this.materialize(updated, new Map(this.tasks).set(id, updated))
    this.replace(updated)
    this.emit({ action: 'updated', task: updated, actor: this.member(callerId) })
    if (current.activeReconcile === undefined && updated.activeReconcile !== undefined) {
      this.emit({ action: 'reconcile_ready', task: updated })
    }
    return snapshot(updated)
  }

  addEntry(callerId: string, id: string, kind: FleetTaskEntry['kind'], text: string, resources: readonly string[] = []): FleetProjectTask {
    const author = this.member(callerId)
    const current = this.requireTask(id)
    const entry: FleetTaskEntry = {
      id: `entry_${randomUUID()}`,
      kind,
      author,
      text: requiredText(text, `task ${kind}`),
      resources: this.strings(resources, 'resource id'),
      createdAt: new Date().toISOString(),
    }
    const updated = { ...current, entries: [...current.entries, entry], updatedAt: entry.createdAt }
    this.replace(updated)
    this.emit({ action: kind === 'comment' ? 'commented' : 'progressed', task: updated, actor: author })
    return snapshot(updated)
  }

  canSettleAttempt(callerId: string, id: string): boolean {
    const current = this.requireTask(id)
    const member = this.member(callerId)
    return current.activeReconcile?.status === 'running' && current.activeReconcile.target === member
  }

  cancel(callerId: string, id: string, reason: string): FleetProjectTask {
    const actor = this.member(callerId)
    if (!this.canManage(callerId)) throw new Error(`Fleet member ${actor} cannot cancel task ${id} without task.manage`)
    const current = this.requireTask(id)
    if (current.stableState.kind === 'completed' || current.stableState.kind === 'cancelled') {
      throw new Error(`Fleet task ${id} is already ${current.stableState.kind}`)
    }
    const now = new Date().toISOString()
    const { activeReconcile: _activeReconcile, ...currentWithoutReconcile } = current
    const detail = requiredText(reason, 'task cancellation reason')
    const entry: FleetTaskEntry = {
      id: `entry_${randomUUID()}`, kind: 'progress', author: actor,
      text: `Task cancelled: ${detail}`, resources: [], createdAt: now,
    }
    const updated: FleetProjectTask = {
      ...currentWithoutReconcile,
      stableState: { kind: 'cancelled', cancelledAt: now, reason: detail },
      stateVersion: current.stateVersion + 1,
      entries: [...current.entries, entry],
      updatedAt: now,
    }
    this.replace(updated)
    this.emit({ action: 'cancelled', task: updated, actor })
    this.evaluateDependents([updated.id])
    return snapshot(updated)
  }

  retireMember(member: string, successor: string): void {
    for (const task of [...this.tasks.values()]) {
      if (this.terminal(task)) continue
      const wasAssignee = task.assignees.includes(member)
      const wasReviewer = task.reviewers.includes(member)
      if (task.createdBy !== member && !wasAssignee && !wasReviewer && !task.followers.includes(member)
        && !task.owners.some(owner => owner.member === member)
        && task.activeReconcile?.target !== member
        && !(task.domain.kind === 'vote' && task.domain.initiator === member)) continue
      const assignees = task.assignees.filter(value => value !== member)
      if (wasAssignee && assignees.length === 0) assignees.push(successor)
      const reviewers = task.reviewers.filter(value => value !== member)
      if (wasReviewer && reviewers.length === 0) reviewers.push(successor)
      const stableState = task.stableState.kind === 'running' || task.stableState.kind === 'dormant'
        ? { ...task.stableState, reconcilers: task.stableState.reconcilers.map(spec => spec.target === member ? { ...spec, target: successor } : spec) }
        : task.stableState
      const activeReconcile = task.activeReconcile?.target === member
        ? (() => {
            const { attemptId: _attemptId, startedAt: _startedAt, ...reconcile } = task.activeReconcile
            return { ...reconcile, target: successor, status: 'ready' as const, readyAt: new Date().toISOString() }
          })()
        : task.activeReconcile
      const domain: FleetTaskDomain = task.domain.kind === 'inbox' && task.domain.owner === member
        ? { ...task.domain, owner: successor }
        : task.domain.kind === 'reply' && task.domain.assignee === member
          ? { ...task.domain, assignee: successor }
          : task.domain.kind === 'goal'
            ? {
                ...task.domain,
                submissions: Object.fromEntries(Object.entries(task.domain.submissions).map(([owner, submission]) => [
                  owner === member ? successor : owner,
                  submission,
                ])),
              }
            : task.domain.kind === 'interaction' && task.domain.owner === member
              ? { ...task.domain, owner: successor }
            : task.domain.kind === 'vote'
              ? {
                  ...task.domain,
                  initiator: task.domain.initiator === member ? successor : task.domain.initiator,
                  voters: unique(task.domain.voters.map(voter => voter === member ? successor : voter)),
                  ballots: task.domain.ballots.map(ballot => ballot.voter === member ? { ...ballot, voter: successor } : ballot),
                }
              : task.domain
      const { activeReconcile: _taskReconcile, ...taskBase } = task
      const updated: FleetProjectTask = {
        ...taskBase,
        stableState,
        domain,
        createdBy: task.createdBy === member ? successor : task.createdBy,
        owners: this.replaceOwnerMember(task.owners, member, successor),
        assignees: unique(assignees),
        reviewers: unique(reviewers),
        followers: task.followers.filter(value => value !== member),
        ...(task.duePendingFor === undefined ? {} : { duePendingFor: unique(task.duePendingFor.map(value => value === member ? successor : value)) }),
        ...(activeReconcile === undefined ? {} : { activeReconcile }),
        updatedAt: new Date().toISOString(),
      }
      this.replace(updated)
      this.emit({ action: 'updated', task: updated, actor: successor })
    }
  }

  onEvent(listener: (event: FleetProjectTaskEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.pause()
    this.listeners.clear()
  }

  private buildTask(createdBy: string, input: CreateFleetProjectTaskInput, source: ReadonlyMap<string, FleetProjectTask> = this.tasks): FleetProjectTask {
    if (input.parentId !== undefined && !source.has(input.parentId)) throw new Error(`unknown Fleet task ${input.parentId}`)
    const dependencies = this.taskReferencesFrom(source, input.dependencies ?? [])
    const assignees = this.resolveMany(input.assignees ?? [createdBy])
    const now = new Date().toISOString()
    const stableState = input.initialState === undefined
      ? this.defaultRunningState(now, assignees[0] ?? createdBy)
      : this.normalizeState(input.initialState, now, source, [])
    return {
      id: `task_${randomUUID()}`,
      title: requiredText(input.title, 'task title'),
      description: input.description?.trim() ?? '',
      priority: input.priority ?? 'normal',
      decision: input.decision ?? 'direct',
      domain: input.domain ?? { kind: 'composite' },
      stableState,
      stateVersion: 1,
      createdBy,
      owners: this.mergeOwners([], input.owners ?? [], now),
      assignees,
      reviewers: this.resolveMany(input.reviewers ?? []),
      followers: this.resolveMany(input.followers ?? []),
      dependencies,
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      ...(input.dueAt === undefined ? {} : { dueAt: this.date(input.dueAt, 'task dueAt') }),
      resources: this.strings(input.resources ?? [], 'resource id'),
      entries: [], signals: [], createdAt: now, updatedAt: now,
    }
  }

  private buildGoalTask(createdBy: string, input: {
    readonly title: string
    readonly description?: string
    readonly owners?: readonly string[]
    readonly parentId?: string
    readonly dependencies?: readonly string[]
    readonly resources?: readonly string[]
    readonly rootWorkId?: string
    readonly timeoutAt?: string
  }, source: ReadonlyMap<string, FleetProjectTask> = this.tasks): FleetProjectTask {
    const owners = this.resolveMany(input.owners ?? [createdBy])
    if (owners.length === 0) throw new Error('Fleet Goal requires at least one owner')
    return this.buildTask(createdBy, {
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      owners,
      assignees: owners,
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      ...(input.dependencies === undefined ? {} : { dependencies: input.dependencies }),
      ...(input.resources === undefined ? {} : { resources: input.resources }),
      domain: {
        kind: 'goal', submissions: {},
        ...(input.rootWorkId === undefined ? {} : { rootWorkId: requiredText(input.rootWorkId, 'root work id') }),
      },
      initialState: this.runningState(
        `Goal is awaiting ${String(owners.length)} owner submission${owners.length === 1 ? '' : 's'}.`,
        input.timeoutAt === undefined ? [] : [
          this.timeoutReconciler('goal-timeout', input.timeoutAt, `Goal deadline ${input.timeoutAt} elapsed.`),
        ],
      ),
    }, source)
  }

  private buildVoteTask(
    parent: FleetProjectTask,
    actor: string,
    input: Extract<FleetTaskChildOperation, { readonly kind: 'vote' }>,
    now: string,
    source: ReadonlyMap<string, FleetProjectTask> = this.tasks,
  ): FleetProjectTask {
    const id = `task_${randomUUID()}`
    const voters = this.resolveMany(input.voters).filter(member => member !== actor)
    if (voters.length === 0) throw new Error('Fleet Vote requires at least one voter other than its initiator')
    const dependencies = this.taskReferencesFrom(source, input.dependencies ?? [], id)
    return {
      id,
      title: input.title?.trim() || `Vote: ${parent.title}`,
      description: requiredText(input.statement, 'task Vote statement'),
      priority: parent.priority,
      decision: 'direct',
      domain: {
        kind: 'vote',
        channel: input.channel,
        statement: requiredText(input.statement, 'task Vote statement'),
        initiator: actor,
        voters,
        ballots: [],
      },
      stateVersion: 1,
      stableState: {
        kind: 'running', since: now, reason: `Vote is awaiting ${String(voters.length)} ballots.`, cohort: [],
        reconcilers: input.timeoutAt === undefined ? [] : [
          this.timeoutReconciler('vote-timeout', input.timeoutAt, `Vote deadline ${input.timeoutAt} elapsed.`),
        ],
      },
      createdBy: actor,
      owners: voters.map(member => ({ member, since: now })),
      assignees: voters,
      reviewers: [],
      followers: [], dependencies, parentId: parent.id, resources: [], entries: [], signals: [],
      ...(input.timeoutAt === undefined ? {} : { dueAt: this.date(input.timeoutAt, 'task Vote timeoutAt') }),
      createdAt: now, updatedAt: now,
    }
  }

  private defaultRunningState(now: string, target: string): FleetTaskStableState {
    return {
      kind: 'running', since: now, reason: `Task is ready for ${target}.`, cohort: [],
      reconcilers: [{
        id: 'work', when: { kind: 'on_enter' }, target, priority: 0, retryAfterSeconds: 0, maxWakeups: 3,
        onTimeout: { kind: 'blocked', reason: 'Task exhausted its reconciliation attempts.' },
      }],
    }
  }

  private normalizeState(
    input: FleetTaskStableStateInput,
    now: string,
    source: ReadonlyMap<string, FleetProjectTask>,
    addedToCohort: readonly string[],
    ownId?: string,
  ): FleetTaskStableState {
    if (input.kind === 'completed') {
      return {
        kind: 'completed', completedAt: now, reason: requiredText(input.reason, 'task completion reason'),
        ...(input.result === undefined ? {} : { result: requiredText(input.result, 'task completion result') }),
      }
    }
    if (input.kind === 'cancelled') return { kind: 'cancelled', cancelledAt: now, reason: requiredText(input.reason, 'task cancellation reason') }
    if (input.kind === 'blocked') return { kind: 'blocked', since: now, reason: requiredText(input.reason, 'task blocked reason') }
    if (input.kind === 'paused') return { kind: 'paused', since: now, reason: requiredText(input.reason, 'task pause reason') }
    const reconcilers = input.reconcilers.map(spec => this.normalizeReconciler(spec))
    if (input.kind === 'dormant') {
      return { kind: 'dormant', since: now, reason: requiredText(input.reason, 'task dormant reason'), reconcilers }
    }
    const cohort = unique([...(input.cohort ?? []), ...addedToCohort])
    for (const id of cohort) {
      if (id === ownId) throw new Error('a Fleet task cannot include itself in its cohort')
      if (!source.has(id)) throw new Error(`unknown Fleet task ${id}`)
    }
    return { kind: 'running', since: now, reason: requiredText(input.reason, 'task running reason'), cohort, reconcilers }
  }

  private runningState(reason: string, reconcilers: readonly FleetTaskReconcilerSpec[], cohort: readonly string[] = []): Extract<FleetTaskStableStateInput, { kind: 'running' }> {
    return { kind: 'running', reason: requiredText(reason, 'task running reason'), cohort, reconcilers }
  }

  private timeoutReconciler(id: string, timeoutAt: string, reason: string): FleetTaskReconcilerSpec {
    const at = this.date(timeoutAt, 'task timeoutAt')
    return {
      id, when: { kind: 'at', at }, target: SYSTEM_TARGET, priority: 0,
      retryAfterSeconds: 0, maxWakeups: 1, timeoutAt: at,
      onTimeout: { kind: 'blocked', reason: requiredText(reason, 'task timeout reason') },
    }
  }

  private reconcileDomain(
    current: FleetProjectTask,
    domain: FleetTaskDomain,
    nextInput: FleetTaskStableStateInput,
    actor = SYSTEM_TARGET,
  ): FleetProjectTask {
    const now = new Date().toISOString()
    const next = this.normalizeState(nextInput, now, this.tasks, [], current.id)
    const { activeReconcile: _activeReconcile, ...base } = current
    const updated: FleetProjectTask = {
      ...base,
      domain,
      stableState: next,
      stateVersion: current.stateVersion + 1,
      updatedAt: now,
    }
    this.replace(updated)
    this.emit({
      action: next.kind === 'completed' ? 'completed' : 'domain_updated',
      task: updated,
      actor,
    })
    this.evaluateDependents([updated.id])
    return snapshot(updated)
  }

  private pendingForOwner(task: FleetProjectTask, owner: string): boolean {
    if (task.stableState.kind !== 'running') return false
    if (task.dependencies.some(dependency => !this.settled(this.requireTask(dependency)))) return false
    if (task.domain.kind === 'inbox') return task.domain.owner === owner && task.domain.unreadMessages > 0
    if (task.domain.kind === 'reply') return task.domain.assignee === owner && task.domain.completionMessageId === undefined
    if (task.domain.kind === 'goal') {
      if (this.descendants(task.id).some(candidate => !this.settled(candidate))) return false
      return task.domain.submissions[owner] === undefined
    }
    if (task.domain.kind === 'interaction') {
      return task.domain.owner === owner && task.domain.settledRevision < task.domain.inputRevision
    }
    if (task.domain.kind === 'vote') return task.domain.voters.includes(owner)
      && !task.domain.ballots.some(ballot => ballot.voter === owner)
    return task.owners.some(candidate => candidate.member === owner)
  }

  private descendants(parentId: string): FleetProjectTask[] {
    const found: FleetProjectTask[] = []
    const parents = new Set([parentId])
    let added = true
    while (added) {
      added = false
      for (const task of this.tasks.values()) {
        if (task.parentId === undefined || !parents.has(task.parentId) || parents.has(task.id)) continue
        parents.add(task.id)
        found.push(task)
        added = true
      }
    }
    return found
  }

  private settled(task: FleetProjectTask): boolean {
    return task.stableState.kind === 'completed'
      || task.stableState.kind === 'blocked'
      || task.stableState.kind === 'cancelled'
  }

  private normalizeReconciler(input: FleetTaskReconcilerSpec): FleetTaskReconcilerSpec {
    const target = input.target === SYSTEM_TARGET ? SYSTEM_TARGET : this.resolve(input.target)
    if (!Number.isSafeInteger(input.priority)) throw new Error('task reconciler priority must be an integer')
    if (!Number.isSafeInteger(input.retryAfterSeconds) || input.retryAfterSeconds < 0) {
      throw new Error('task reconciler retryAfterSeconds must be a non-negative integer')
    }
    if (!Number.isSafeInteger(input.maxWakeups) || input.maxWakeups < 1) {
      throw new Error('task reconciler maxWakeups must be a positive integer')
    }
    return {
      id: requiredText(input.id, 'task reconciler id'),
      when: this.normalizeTrigger(input.when),
      target,
      priority: input.priority,
      retryAfterSeconds: input.retryAfterSeconds,
      maxWakeups: input.maxWakeups,
      ...(input.timeoutAt === undefined ? {} : { timeoutAt: this.date(input.timeoutAt, 'task reconciler timeoutAt') }),
      onTimeout: this.normalizeTimeoutState(input.onTimeout),
    }
  }

  private normalizeTrigger(input: FleetTaskTrigger): FleetTaskTrigger {
    if (input.kind === 'on_enter') return { kind: 'on_enter' }
    if (input.kind === 'event') return { kind: 'event', eventKey: requiredText(input.eventKey, 'task event key') }
    if (input.kind === 'at') return { kind: 'at', at: this.date(input.at, 'task trigger time') }
    if (input.kind === 'child_count') {
      if (!['eq', 'gte', 'lte'].includes(input.op)) throw new Error('task child_count op must be eq, gte, or lte')
      if (input.value !== 'cohort' && (!Number.isSafeInteger(input.value) || input.value < 0)) {
        throw new Error('task child_count value must be a non-negative integer or cohort')
      }
      return { kind: 'child_count', states: [...new Set(input.states)], op: input.op, value: input.value }
    }
    if (input.items.length === 0) throw new Error(`task ${input.kind} trigger requires at least one item`)
    return { kind: input.kind, items: input.items.map(item => this.normalizeTrigger(item)) }
  }

  private normalizeTimeoutState(input: FleetTaskTimeoutState): FleetTaskTimeoutState {
    const reason = requiredText(input.reason, 'task reconciler timeout reason')
    if (input.kind !== 'blocked' && input.kind !== 'paused' && input.kind !== 'cancelled') {
      throw new Error('task reconciler onTimeout must be blocked, paused, or cancelled')
    }
    return { kind: input.kind, reason }
  }

  private materialize(task: FleetProjectTask, source: ReadonlyMap<string, FleetProjectTask>): FleetProjectTask {
    if (task.activeReconcile !== undefined || (task.stableState.kind !== 'running' && task.stableState.kind !== 'dormant')) return task
    const matched = task.stableState.reconcilers
      .filter(spec => this.triggerMatches(task, spec.when, source))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0]
    if (matched === undefined) return task
    const now = new Date().toISOString()
    const reason = this.triggerReason(task, matched.when, source)
    return {
      ...task,
      activeReconcile: {
        id: `reconcile_${randomUUID()}`,
        sourceStateVersion: task.stateVersion,
        reconcilerId: matched.id,
        causes: [reason],
        target: matched.target,
        priority: matched.priority,
        status: 'ready',
        reason,
        readyAt: now,
        wakeups: 0,
        maxWakeups: matched.maxWakeups,
        retryAfterSeconds: matched.retryAfterSeconds,
        ...(matched.timeoutAt === undefined ? {} : { timeoutAt: matched.timeoutAt }),
        onTimeout: matched.onTimeout,
      },
      updatedAt: now,
    }
  }

  private triggerMatches(task: FleetProjectTask, trigger: FleetTaskTrigger, source: ReadonlyMap<string, FleetProjectTask>): boolean {
    if (trigger.kind === 'on_enter') return true
    if (trigger.kind === 'event') return task.signals.some(signal => signal.eventKey === trigger.eventKey)
    if (trigger.kind === 'at') return new Date(trigger.at).getTime() <= Date.now()
    if (trigger.kind === 'all') return trigger.items.every(item => this.triggerMatches(task, item, source))
    if (trigger.kind === 'any') return trigger.items.some(item => this.triggerMatches(task, item, source))
    if (trigger.kind !== 'child_count') return false
    if (task.stableState.kind !== 'running') return false
    const count = task.stableState.cohort
      .map(id => source.get(id))
      .filter((child): child is FleetProjectTask => child !== undefined && trigger.states.includes(child.stableState.kind)).length
    const expected = trigger.value === 'cohort' ? task.stableState.cohort.length : trigger.value
    return trigger.op === 'eq' ? count === expected : trigger.op === 'gte' ? count >= expected : count <= expected
  }

  private triggerReason(task: FleetProjectTask, trigger: FleetTaskTrigger, source: ReadonlyMap<string, FleetProjectTask>): string {
    if (trigger.kind === 'on_enter') return `Task entered ${task.stableState.kind} state version ${task.stateVersion}.`
    if (trigger.kind === 'event') return task.signals.find(signal => signal.eventKey === trigger.eventKey)?.result ?? `Event ${trigger.eventKey} occurred.`
    if (trigger.kind === 'at') return `Task trigger time ${trigger.at} arrived.`
    if (trigger.kind === 'child_count') {
      const count = task.stableState.kind === 'running'
        ? task.stableState.cohort.map(id => source.get(id)).filter(child => child !== undefined && trigger.states.includes(child.stableState.kind)).length
        : 0
      return `Child predicate matched ${count} Tasks in states ${trigger.states.join(', ')}.`
    }
    const reasons = trigger.items
      .filter(item => this.triggerMatches(task, item, source))
      .map(item => this.triggerReason(task, item, source))
    return `${trigger.kind} trigger matched: ${reasons.join(' ')}`
  }

  private runSystemReconcile(id: string): void {
    const current = this.tasks.get(id)
    const reconcile = current?.activeReconcile
    if (current === undefined || reconcile?.target !== SYSTEM_TARGET || reconcile.status !== 'ready') return
    if (current.domain.kind === 'interaction'
      && (reconcile.reconcilerId === 'interaction-team-quiescent'
        || reconcile.reconcilerId === 'interaction-stall-check')) {
      const linkedTasks = current.domain.waitingTaskIds.map(taskId => this.requireTask(taskId))
      const allLinkedTasksSettled = linkedTasks.length > 0 && linkedTasks.every(task => this.settled(task))
      const cause: FleetInteractionDelivery['cause'] = reconcile.reconcilerId === 'interaction-stall-check'
        ? 'progress_due'
        : allLinkedTasksSettled ? 'linked_tasks_settled' : 'team_quiescent'
      const summary = cause === 'progress_due'
        ? `Team progress check became due while input revision ${String(current.domain.inputRevision)} remained unsettled.`
        : cause === 'linked_tasks_settled'
          ? `Every linked Team Task for input revision ${String(current.domain.inputRevision)} reached a terminal state.`
          : `Team became quiescent while input revision ${String(current.domain.inputRevision)} remained unsettled.`
      const pendingDelivery: FleetInteractionDelivery = {
        id: `delivery_${randomUUID()}`,
        revision: current.domain.inputRevision,
        cause,
        summary,
        tasks: linkedTasks.map(task => ({
          id: task.id,
          title: task.title,
          state: task.stableState.kind,
          reason: task.stableState.reason,
          ...(task.stableState.kind === 'completed' && task.stableState.result !== undefined
            ? { result: task.stableState.result }
            : {}),
        })),
        createdAt: new Date().toISOString(),
      }
      const {
        waitingEventKey: _waitingEventKey,
        pendingDelivery: _previousDelivery,
        reportIntent: _reportIntent,
        ...interaction
      } = current.domain
      this.reconcileDomain(current, { ...interaction, pendingDelivery }, this.runningState(summary, []))
      return
    }
    this.expireReconcile(current, `System reconciler ${reconcile.id} has no deterministic domain handler.`)
  }

  private assertDecision(current: FleetProjectTask, next: FleetTaskStableState, source: ReadonlyMap<string, FleetProjectTask>): void {
    if (current.decision !== 'vote' || next.kind !== 'completed') return
    const cohort = current.stableState.kind === 'running' ? current.stableState.cohort : []
    const approved = cohort.map(id => source.get(id)).some(child => child?.domain.kind === 'vote'
      && child.domain.outcome === 'approve' && child.stableState.kind === 'completed')
    if (!approved) throw new Error(`Fleet task ${current.id} requires an approved Vote child`)
  }

  private expireReconcile(current: FleetProjectTask, reason: string): FleetProjectTask {
    const reconcile = current.activeReconcile
    if (reconcile === undefined) return snapshot(current)
    const now = new Date().toISOString()
    const fallback = reconcile.onTimeout
    const stableState: FleetTaskStableState = fallback.kind === 'cancelled'
      ? { kind: 'cancelled', cancelledAt: now, reason: fallback.reason }
      : fallback.kind === 'paused'
        ? { kind: 'paused', since: now, reason: fallback.reason }
        : { kind: 'blocked', since: now, reason: fallback.reason }
    const entry: FleetTaskEntry = {
      id: `entry_${randomUUID()}`, kind: 'progress', author: SYSTEM_TARGET,
      text: requiredText(reason, 'task reconciliation timeout reason'), resources: [], createdAt: now,
    }
    const { activeReconcile: _activeReconcile, ...currentWithoutReconcile } = current
    const updated: FleetProjectTask = {
      ...currentWithoutReconcile,
      stableState,
      stateVersion: current.stateVersion + 1,
      entries: [...current.entries, entry],
      updatedAt: now,
    }
    this.replace(updated)
    this.emit({ action: 'timed_out', task: updated, actor: SYSTEM_TARGET })
    this.evaluateDependents([updated.id])
    return snapshot(updated)
  }

  private evaluateAll(): void { for (const task of [...this.tasks.values()]) this.evaluateTask(task.id) }

  private evaluateTask(id: string): void {
    const current = this.tasks.get(id)
    if (current === undefined || current.activeReconcile !== undefined) return
    if (this.completeCompositePlan(current)) return
    if (current.stableState.kind === 'running' || current.stableState.kind === 'dormant') {
      const expired = current.stableState.reconcilers
        .filter(spec => spec.timeoutAt !== undefined && new Date(spec.timeoutAt).getTime() <= Date.now())
        .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0]
      if (expired !== undefined) {
        const now = new Date().toISOString()
        this.expireReconcile({
          ...current,
          activeReconcile: {
            id: `reconcile_${randomUUID()}`,
            sourceStateVersion: current.stateVersion,
            reconcilerId: expired.id,
            causes: [`Reconciler ${expired.id} timed out at ${expired.timeoutAt}.`],
            target: expired.target,
            priority: expired.priority,
            status: 'ready',
            reason: `Reconciler ${expired.id} timed out at ${expired.timeoutAt}.`,
            readyAt: now,
            wakeups: 0,
            maxWakeups: expired.maxWakeups,
            retryAfterSeconds: expired.retryAfterSeconds,
            ...(expired.timeoutAt === undefined ? {} : { timeoutAt: expired.timeoutAt }),
            onTimeout: expired.onTimeout,
          },
        }, `Reconciler ${expired.id} timed out at ${expired.timeoutAt}.`)
        return
      }
    }
    const updated = this.materialize(current, this.tasks)
    if (updated === current) return
    this.replace(updated)
    this.emit({ action: 'reconcile_ready', task: updated })
    this.runSystemReconcile(id)
  }

  private evaluateDependents(changedIds: readonly string[]): void {
    const pending = [...changedIds]
    const changed = new Set<string>()
    while (pending.length > 0) {
      const changedId = pending.shift()!
      if (changed.has(changedId)) continue
      changed.add(changedId)
      for (const task of [...this.tasks.values()]) {
        if (task.stableState.kind !== 'running' && task.stableState.kind !== 'dormant') continue
        if (task.dependencies.includes(changedId)) {
          const failed = task.dependencies
            .map(dependency => this.requireTask(dependency))
            .find(dependency => dependency.stableState.kind === 'blocked'
              || dependency.stableState.kind === 'cancelled'
              || (dependency.domain.kind === 'vote' && dependency.domain.outcome === 'reject'))
          if (failed !== undefined) {
            const now = new Date().toISOString()
            const { activeReconcile: _activeReconcile, ...base } = task
            const cancelled: FleetProjectTask = {
              ...base,
              stableState: {
                kind: 'cancelled', cancelledAt: now,
                reason: `dependency_not_completed:${failed.id}`,
              },
              stateVersion: task.stateVersion + 1,
              updatedAt: now,
            }
            this.replace(cancelled)
            this.emit({ action: 'cancelled', task: cancelled, actor: SYSTEM_TARGET })
            pending.push(cancelled.id)
            continue
          }
        }
        if (task.stableState.kind === 'running' && task.stableState.cohort.includes(changedId)) {
          this.evaluateTask(task.id)
        }
      }
    }
  }

  private completeCompositePlan(current: FleetProjectTask): boolean {
    if (current.domain.kind !== 'composite' || current.domain.plan === undefined
      || current.stableState.kind !== 'running') return false
    const plan = current.domain.plan
    const required = plan.requiredStageIds.map(id => this.requireTask(id))
    if (required.some(task => !this.settled(task))) return false
    if (required.some(task => task.stableState.kind !== 'completed')) return false
    const votes = plan.acceptanceVoteIds.map(id => this.requireTask(id))
    if (votes.some(task => task.domain.kind !== 'vote' || task.domain.outcome !== 'approve')) return false
    const result = plan.resultStageId === undefined ? undefined : this.requireTask(plan.resultStageId)
    if (result?.stableState.kind !== 'completed' || result.stableState.result === undefined) return false
    this.reconcileDomain(current, current.domain, {
      kind: 'completed',
      reason: 'Every required stage completed and every acceptance Vote approved.',
      result: result.stableState.result,
    })
    return true
  }

  private triggerDue(id: string): void {
    const current = this.tasks.get(id)
    if (current === undefined || current.dueAt === undefined || current.dueNotifiedAt !== undefined || this.terminal(current)) return
    const now = new Date().toISOString()
    const duePendingFor = unique([
      ...current.assignees,
      ...current.reviewers,
      ...current.owners.filter(owner => this.pendingForOwner(current, owner.member)).map(owner => owner.member),
    ])
    const updated = { ...current, dueNotifiedAt: now, duePendingFor, updatedAt: now }
    this.tasks.set(id, updated)
    this.emit({ action: 'due', task: updated })
    this.deliverDue(updated, duePendingFor)
  }

  private deliverDue(task: FleetProjectTask, recipients: readonly string[]): void {
    const delivered = new Set(this.onDue(snapshot(task), recipients) ?? [])
    if (delivered.size === 0) return
    const current = this.tasks.get(task.id)
    if (current?.duePendingFor === undefined) return
    const duePendingFor = current.duePendingFor.filter(member => !delivered.has(member))
    if (duePendingFor.length === current.duePendingFor.length) return
    const updated = { ...current, duePendingFor, updatedAt: new Date().toISOString() }
    this.tasks.set(task.id, updated)
    this.emit({ action: 'notification', task: updated })
  }

  private arm(task: FleetProjectTask): void { this.armDue(task); this.armState(task) }

  private armDue(task: FleetProjectTask): void {
    const existing = this.dueTimers.get(task.id)
    if (existing !== undefined) clearTimeout(existing)
    this.dueTimers.delete(task.id)
    if (!this.active || task.dueAt === undefined || task.dueNotifiedAt !== undefined || this.terminal(task)) return
    this.setTimer(this.dueTimers, task.id, task.dueAt, () => this.triggerDue(task.id))
  }

  private armState(task: FleetProjectTask): void {
    const existing = this.stateTimers.get(task.id)
    if (existing !== undefined) clearTimeout(existing)
    this.stateTimers.delete(task.id)
    if (!this.active || this.terminal(task)) return
    const times: string[] = []
    if (task.activeReconcile !== undefined) {
      if (!this.available(task.activeReconcile)) times.push(task.activeReconcile.readyAt)
      if (task.activeReconcile.timeoutAt !== undefined) times.push(task.activeReconcile.timeoutAt)
    } else if (task.stableState.kind === 'running' || task.stableState.kind === 'dormant') {
      for (const spec of task.stableState.reconcilers) {
        this.collectTimes(spec.when, times)
        if (spec.timeoutAt !== undefined) times.push(spec.timeoutAt)
      }
    }
    const at = times.sort()[0]
    if (at !== undefined) this.setTimer(this.stateTimers, task.id, at, () => this.triggerState(task.id))
  }

  private setTimer(store: Map<string, NodeJS.Timeout>, id: string, at: string, action: () => void): void {
    const delay = Math.max(0, new Date(at).getTime() - Date.now())
    const timer = setTimeout(() => {
      store.delete(id)
      const remaining = new Date(at).getTime() - Date.now()
      if (remaining > 0) {
        const current = this.tasks.get(id)
        if (current !== undefined) this.arm(current)
      } else action()
    }, Math.min(delay, 2_147_483_647))
    timer.unref?.()
    store.set(id, timer)
  }

  private triggerState(id: string): void {
    const current = this.tasks.get(id)
    if (current === undefined) return
    const reconcile = current.activeReconcile
    if (reconcile !== undefined) {
      if (reconcile.timeoutAt !== undefined && new Date(reconcile.timeoutAt).getTime() <= Date.now()) {
        this.expireReconcile(current, `Reconcile ${reconcile.id} timed out at ${reconcile.timeoutAt}.`)
        return
      }
      if (reconcile.status === 'ready' && this.available(reconcile)) this.emit({ action: 'reconcile_ready', task: current })
      this.armState(current)
      return
    }
    this.evaluateTask(id)
    this.armState(this.requireTask(id))
  }

  private collectTimes(trigger: FleetTaskTrigger, result: string[]): void {
    if (trigger.kind === 'at' && new Date(trigger.at).getTime() > Date.now()) result.push(trigger.at)
    else if (trigger.kind === 'all' || trigger.kind === 'any') for (const item of trigger.items) this.collectTimes(item, result)
  }

  private commit(source: ReadonlyMap<string, FleetProjectTask>, changed: readonly FleetProjectTask[]): void {
    this.tasks.clear()
    for (const [id, task] of source) this.tasks.set(id, task)
    for (const task of changed) this.arm(task)
  }

  private replace(task: FleetProjectTask): void { this.tasks.set(task.id, task); this.arm(task) }

  private emit(event: FleetProjectTaskEvent): void {
    const value = snapshot(event)
    for (const listener of [...this.listeners]) listener(value)
  }

  private available(reconcile: FleetTaskActiveReconcile): boolean { return new Date(reconcile.readyAt).getTime() <= Date.now() }
  private terminal(task: FleetProjectTask): boolean { return task.stableState.kind === 'completed' || task.stableState.kind === 'cancelled' }

  private member(agentId: string): string {
    const name = this.directory.nameForAgent(agentId)
    if (name === undefined) throw new Error(`Agent ${agentId} is not a member of this Fleet team`)
    return name
  }

  private resolve(reference: string): string {
    const name = this.directory.resolve(reference)
    if (name === undefined) throw new Error(`unknown Fleet member ${reference}`)
    return name
  }

  private resolveMany(values: readonly string[]): string[] { return unique(values.map(value => this.resolve(value))) }
  private mergeOwners(current: readonly FleetTaskOwner[], values: readonly string[], now: string): FleetTaskOwner[] {
    const byMember = new Map(current.map(owner => [owner.member, owner]))
    return this.resolveMany(values).map(member => byMember.get(member) ?? { member, since: now })
  }
  private replaceOwnerMember(owners: readonly FleetTaskOwner[], member: string, successor: string): FleetTaskOwner[] {
    const result = new Map<string, FleetTaskOwner>()
    for (const owner of owners) {
      const updated = owner.member === member ? { ...owner, member: successor } : owner
      if (!result.has(updated.member)) result.set(updated.member, updated)
    }
    return [...result.values()]
  }
  private resolveOptionalMember(reference: string, except: string): string[] {
    const member = this.directory.resolve(reference)
    return member === undefined || member === except ? [] : [member]
  }
  private agentIdFor(member: string): string | undefined { return this.directory.list().find(candidate => candidate.name === member)?.id }
  private strings(values: readonly string[], label: string): string[] { return unique(values.map(value => requiredText(value, label))) }
  private taskReferences(values: readonly string[], ownId?: string): string[] { return this.taskReferencesFrom(this.tasks, values, ownId) }

  private taskReferencesFrom(source: ReadonlyMap<string, FleetProjectTask>, values: readonly string[], ownId?: string): string[] {
    const references = this.strings(values, 'task dependency')
    for (const id of references) {
      if (id === ownId) throw new Error('a Fleet task cannot depend on itself')
      if (!source.has(id)) throw new Error(`unknown Fleet task ${id}`)
      if (ownId !== undefined && this.dependsOn(source, id, ownId, new Set())) throw new Error(`Fleet task dependency ${id} would create a cycle`)
    }
    return references
  }

  private dependsOn(source: ReadonlyMap<string, FleetProjectTask>, taskId: string, targetId: string, visited: Set<string>): boolean {
    if (taskId === targetId) return true
    if (visited.has(taskId)) return false
    visited.add(taskId)
    return this.requireTaskFrom(source, taskId).dependencies.some(dependency => this.dependsOn(source, dependency, targetId, visited))
  }

  private date(value: string, label: string): string {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be an ISO date-time`)
    return date.toISOString()
  }

  private requireTask(id: string): FleetProjectTask { return this.requireTaskFrom(this.tasks, id) }
  private requireTaskFrom(source: ReadonlyMap<string, FleetProjectTask>, id: string): FleetProjectTask {
    const task = source.get(id)
    if (task === undefined) throw new Error(`unknown Fleet task ${id}`)
    return task
  }

  private requireResponsible(agentId: string, task: FleetProjectTask): void {
    const name = this.member(agentId)
    if (name !== task.createdBy && !task.assignees.includes(name) && !this.canManage(agentId)) {
      throw new Error(`Fleet member ${name} cannot manage task ${task.id}`)
    }
  }

  private assertOpen(): void { if (this.closed) throw new Error('Fleet Task service is stopped') }
}

const FLEX_OBJECT_SCHEMA = { type: 'object', additionalProperties: true } as const
const STABLE_STATE_SCHEMA = {
  ...FLEX_OBJECT_SCHEMA,
  description: 'Explicit next stable state for the current ReconcileAttempt. Every state carries a reason. Terminal: {kind:"completed",reason,result?} or {kind:"blocked"|"paused"|"cancelled",reason}. Live: {kind:"running",reason,cohort?:taskIds,reconcilers:[...]} or {kind:"dormant",reason,reconcilers:[...]}.',
} as const
const CHILD_OPERATION_SCHEMA = {
  ...FLEX_OBJECT_SCHEMA,
  description: 'Atomic child operation: {kind:"goal",title,description?,owners,dependencies?,resources?,timeoutAt?}, {kind:"vote",title?,channel,statement,voters,dependencies?,timeoutAt?}, {kind:"create",task:{title,...}}, {kind:"link",taskId}, or {kind:"cancel",taskId,reason}. Created Goal/Vote/Task children join the next running cohort automatically.',
} as const

const TASK_SCHEMA = FLEX_OBJECT_SCHEMA

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true },
    task: TASK_SCHEMA, tasks: { type: 'array', items: TASK_SCHEMA },
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): { schema: S; render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }] } {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

function caller(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('fleet_task requires a calling Agent')
  return agent
}

const TOOL_TEXT_LIMIT = 2_000

function toolText(value: string): string {
  return value.length <= TOOL_TEXT_LIMIT
    ? value
    : `${value.slice(0, TOOL_TEXT_LIMIT)}… [${String(value.length - TOOL_TEXT_LIMIT)} chars omitted]`
}

function toolStableState(task: FleetProjectTask): Record<string, JsonValue> {
  const state = task.stableState
  return {
    ...state,
    reason: toolText(state.reason),
    ...(state.kind === 'completed' && state.result !== undefined ? { result: toolText(state.result) } : {}),
  } as unknown as Record<string, JsonValue>
}

function toolDomain(task: FleetProjectTask): Record<string, JsonValue> {
  const domain = task.domain
  if (domain.kind === 'goal') {
    return {
      ...domain,
      submissions: Object.fromEntries(Object.entries(domain.submissions).map(([owner, submission]) => [owner, {
        ...submission,
        reason: toolText(submission.reason),
        ...(submission.kind === 'complete' && submission.result !== undefined
          ? { result: toolText(submission.result) }
          : {}),
      }])),
    } as unknown as Record<string, JsonValue>
  }
  if (domain.kind === 'vote') {
    return {
      ...domain,
      statement: toolText(domain.statement),
      ballots: domain.ballots.map(ballot => ({ ...ballot, reason: toolText(ballot.reason) })),
    } as unknown as Record<string, JsonValue>
  }
  if (domain.kind === 'interaction') {
    return {
      ...domain,
      ...(domain.pendingDelivery === undefined ? {} : {
        pendingDelivery: {
          ...domain.pendingDelivery,
          summary: toolText(domain.pendingDelivery.summary),
          tasks: domain.pendingDelivery.tasks.map(delivery => ({
            ...delivery,
            reason: toolText(delivery.reason),
            ...(delivery.result === undefined ? {} : { result: toolText(delivery.result) }),
          })),
        },
      }),
      ...(domain.reportIntent === undefined ? {} : {
        reportIntent: {
          revision: domain.reportIntent.revision,
          outcome: domain.reportIntent.outcome,
          reason: toolText(domain.reportIntent.reason),
          reportChars: domain.reportIntent.report.length,
          submittedAt: domain.reportIntent.submittedAt,
        },
      }),
    } as unknown as Record<string, JsonValue>
  }
  return structuredClone(domain) as unknown as Record<string, JsonValue>
}

export function fleetTaskToolSummary(task: FleetProjectTask): Record<string, JsonValue> {
  return {
    id: task.id,
    title: task.title,
    kind: task.domain.kind,
    state: task.stableState.kind,
    reason: toolText(task.stableState.reason),
    stateVersion: task.stateVersion,
    owners: task.owners.map(owner => owner.member),
    dependencies: [...task.dependencies],
    ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
    ...(task.activeReconcile === undefined ? {} : {
      reconcile: {
        id: task.activeReconcile.id,
        attemptId: task.activeReconcile.attemptId,
        target: task.activeReconcile.target,
        status: task.activeReconcile.status,
        reason: toolText(task.activeReconcile.reason),
        readyAt: task.activeReconcile.readyAt,
        timeoutAt: task.activeReconcile.timeoutAt,
      },
    }),
    updatedAt: task.updatedAt,
  } as unknown as Record<string, JsonValue>
}

export function fleetTaskToolDetail(task: FleetProjectTask): Record<string, JsonValue> {
  const latestEntry = task.domain.kind === 'interaction' ? undefined : task.entries.at(-1)
  return {
    ...fleetTaskToolSummary(task),
    description: toolText(task.description),
    priority: task.priority,
    decision: task.decision,
    domain: toolDomain(task),
    stableState: toolStableState(task),
    createdBy: task.createdBy,
    assignees: [...task.assignees],
    reviewers: [...task.reviewers],
    resources: [...task.resources],
    entryCount: task.entries.length,
    signalCount: task.signals.length,
    ...(latestEntry === undefined ? {} : {
      latestEntry: { ...latestEntry, text: toolText(latestEntry.text) },
    }),
    createdAt: task.createdAt,
  } as unknown as Record<string, JsonValue>
}

export function installTaskTools(
  ctx: Context,
  tasks: FleetTaskBoard,
  authorize: (agentId: string, action: string) => boolean,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_task',
    description: 'Inspect recursive durable Tasks. This interface is intentionally read-only; use the domain tool for Goal, Vote, Reply, or Inbox intent, and fleet_reconcile for a reserved ReconcileAttempt.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'owner_list', 'get'] },
      id: { type: 'string' },
      stable_kind: { type: 'string', enum: ['running', 'dormant', 'blocked', 'paused', 'completed', 'cancelled'] },
      owner: { type: 'string' },
      parent_id: { type: 'string' },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = caller(exec.agent)
      const callerId = String(agent.id)
      if (!authorize(callerId, 'task.read') && !authorize(callerId, 'task.manage')) {
        throw new Error(`Agent ${callerId} is not authorized for task.read`)
      }
      if (args.action === 'list') return Promise.resolve({ action: 'list' as const, tasks: tasks.list(callerId, {
        ...(args.stable_kind === undefined ? {} : { state: args.stable_kind }),
        ...(args.owner === undefined ? {} : { assignee: args.owner }),
        ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }),
      }).map(fleetTaskToolSummary) })
      if (args.action === 'owner_list') {
        return Promise.resolve({ action: 'owner_list' as const, tasks: tasks.ownerTasks(callerId).map(fleetTaskToolSummary) })
      }
      if (args.id === undefined) throw new Error(`fleet_task ${args.action} requires id`)
      if (args.action === 'get') return Promise.resolve({ action: 'get' as const, task: fleetTaskToolDetail(tasks.get(callerId, args.id)) })
      throw new Error(`unsupported fleet_task action ${args.action}`)
    },
  }))
}

export function installReconcileTools(
  ctx: Context,
  tasks: FleetTaskBoard,
  authorize: (agentId: string, action: string) => boolean,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_reconcile',
    description: 'Inspect or atomically resolve a ReconcileAttempt reserved for the calling member. A [Fleet task attempt] notice is already claimed: resolve it directly. Use claim only for a ready Task discovered manually through list. Resolution must provide the next stable state before the current attempt can end.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'claim', 'resolve'], description: 'Use resolve for the already-claimed attempt in a [Fleet task attempt] notice.' },
      id: { type: 'string', description: 'Task id (task_...), never a ReconcileAttempt or reconciler id.' },
      attempt_id: { type: 'string', description: 'For resolve, the exact attempt_... id from the current [Fleet task attempt] notice.' },
      progress: { type: 'string' },
      state: STABLE_STATE_SCHEMA,
      owners: { type: 'array', items: { type: 'string' } },
      child_ops: { type: 'array', items: CHILD_OPERATION_SCHEMA },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = caller(exec.agent)
      const callerId = String(agent.id)
      const ownsAttempt = args.id !== undefined && tasks.canSettleAttempt(callerId, args.id)
      if (!ownsAttempt && !authorize(callerId, 'task.reconcile') && !authorize(callerId, 'task.manage')) {
        throw new Error(`Agent ${callerId} is not authorized for task.reconcile`)
      }
      if (args.action === 'list') {
        return Promise.resolve({ action: 'list', tasks: [...tasks.readyTasks(callerId), ...tasks.runningFor(callerId)].map(fleetTaskToolSummary) })
      }
      if (args.id === undefined) throw new Error(`fleet_reconcile ${args.action} requires id`)
      if (args.action === 'get') return Promise.resolve({ action: 'get', task: fleetTaskToolDetail(tasks.get(callerId, args.id)) })
      if (args.action === 'claim') return Promise.resolve({ action: 'claim', task: fleetTaskToolDetail(tasks.claim(callerId, args.id)) })
      if (args.attempt_id === undefined || args.progress === undefined || args.state === undefined) {
        throw new Error('fleet_reconcile resolve requires attempt_id, progress, and state')
      }
      return Promise.resolve({
        action: 'resolve',
        task: fleetTaskToolDetail(tasks.settle(callerId, args.id, {
          attemptId: args.attempt_id,
          progress: args.progress,
          next: args.state as unknown as FleetTaskStableStateInput,
          ...(args.owners === undefined ? {} : { owners: args.owners }),
          ...(args.child_ops === undefined ? {} : { childOps: args.child_ops as unknown as FleetTaskChildOperation[] }),
        })),
      })
    },
  }))
}

export function installGoalTools(
  ctx: Context,
  tasks: FleetTaskBoard,
  authorize: (agentId: string, action: string) => boolean,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_goal',
    description: 'Create and inspect Goals, atomically split owned work into child Goals, submit a completed result, or report an external blocker.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'split', 'complete', 'block'] },
      id: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      owners: { type: 'array', items: { type: 'string' } },
      parent_id: { type: 'string' },
      dependencies: { type: 'array', items: { type: 'string' }, description: 'Goal ids that must settle before this owner is woken; every dependency must complete before this Goal can complete.' },
      resources: { type: 'array', items: { type: 'string' } },
      timeout_at: { type: 'string', description: 'Optional ISO deadline. Its deterministic system reconciler blocks the Goal if the deadline arrives first.' },
      children: {
        type: 'array',
        description: 'Complete child Goal DAG created in one operation. Dependencies use earlier child keys.',
        items: {
          type: 'object', additionalProperties: false, properties: {
            key: { type: 'string', required: true },
            title: { type: 'string', required: true },
            description: { type: 'string' },
            owners: { type: 'array', required: true, items: { type: 'string' } },
            dependencies: { type: 'array', items: { type: 'string' } },
            resources: { type: 'array', items: { type: 'string' } },
            timeout_at: { type: 'string' },
          },
        },
      },
      reason: { type: 'string' },
      result: { type: 'string' },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = caller(exec.agent)
      const callerId = String(agent.id)
      if (args.action === 'list') {
        const goals = tasks.list(callerId).filter(task => task.domain.kind === 'goal')
        return Promise.resolve({ action: 'list', tasks: goals.map(fleetTaskToolSummary) })
      }
      if (args.action === 'create') {
        if (!authorize(callerId, 'task.create') && !authorize(callerId, 'task.manage')) {
          throw new Error(`Agent ${callerId} is not authorized for task.create`)
        }
        if (args.title === undefined) throw new Error('fleet_goal create requires title')
        return Promise.resolve({ action: 'create', task: fleetTaskToolDetail(tasks.createGoal(callerId, {
          title: args.title,
          ...(args.description === undefined ? {} : { description: args.description }),
          ...(args.owners === undefined ? {} : { owners: args.owners }),
          ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }),
          ...(args.dependencies === undefined ? {} : { dependencies: args.dependencies }),
          ...(args.resources === undefined ? {} : { resources: args.resources }),
          ...(args.timeout_at === undefined ? {} : { timeoutAt: args.timeout_at }),
        })) })
      }
      if (args.id === undefined) throw new Error(`fleet_goal ${args.action} requires id`)
      if (args.action === 'get') return Promise.resolve({ action: 'get', task: fleetTaskToolDetail(tasks.get(callerId, args.id)) })
      if (args.action === 'split') {
        const split = tasks.splitGoal(callerId, args.id, {
          children: (args.children ?? []).map(child => ({
            key: child.key,
            title: child.title,
            ...(child.description === undefined ? {} : { description: child.description }),
            owners: child.owners,
            ...(child.dependencies === undefined ? {} : { dependencies: child.dependencies }),
            ...(child.resources === undefined ? {} : { resources: child.resources }),
            ...(child.timeout_at === undefined ? {} : { timeoutAt: child.timeout_at }),
          })),
        })
        return Promise.resolve({
          action: 'split',
          task: fleetTaskToolDetail(split.task),
          tasks: [...split.children.values()].map(fleetTaskToolDetail),
        })
      }
      if (args.reason === undefined) throw new Error(`fleet_goal ${args.action} requires reason`)
      return Promise.resolve({
        action: args.action,
        task: fleetTaskToolSummary(tasks.submitGoal(callerId, args.id, {
          kind: args.action,
          reason: args.reason,
          ...(args.result === undefined ? {} : { result: args.result }),
        })),
      })
    },
  }))
}

export function installVoteTools(
  ctx: Context,
  tasks: FleetTaskBoard,
  authorize: (agentId: string, action: string) => boolean,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_vote',
    description: 'Create and inspect a durable Vote, or cast one approve/reject ballot with a required reason. The Vote Task derives its result from its ballots.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'cast'] },
      id: { type: 'string' },
      title: { type: 'string' },
      statement: { type: 'string' },
      channel: { type: 'string' },
      voters: { type: 'array', items: { type: 'string' } },
      parent_id: { type: 'string' },
      timeout_at: { type: 'string', description: 'Optional ISO deadline. Its deterministic system reconciler blocks the Vote if the deadline arrives first.' },
      decision: { type: 'string', enum: ['approve', 'reject'] },
      reason: { type: 'string' },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = caller(exec.agent)
      const callerId = String(agent.id)
      if (args.action === 'list') {
        const votes = tasks.list(callerId).filter(task => task.domain.kind === 'vote')
        return Promise.resolve({ action: 'list', tasks: votes.map(fleetTaskToolSummary) })
      }
      if (args.action === 'create') {
        if (!authorize(callerId, 'task.create') && !authorize(callerId, 'task.manage')) {
          throw new Error(`Agent ${callerId} is not authorized for task.create`)
        }
        if (args.statement === undefined || args.channel === undefined || args.voters === undefined) {
          throw new Error('fleet_vote create requires statement, channel, and voters')
        }
        if (!args.channel.startsWith('#')) throw new Error('fleet_vote channel must start with #')
        return Promise.resolve({ action: 'create', task: fleetTaskToolDetail(tasks.createVote(callerId, {
          ...(args.title === undefined ? {} : { title: args.title }),
          statement: args.statement,
          channel: args.channel as `#${string}`,
          voters: args.voters,
          ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }),
          ...(args.timeout_at === undefined ? {} : { timeoutAt: args.timeout_at }),
        })) })
      }
      if (args.id === undefined) throw new Error(`fleet_vote ${args.action} requires id`)
      if (args.action === 'get') return Promise.resolve({ action: 'get', task: fleetTaskToolDetail(tasks.get(callerId, args.id)) })
      if (args.decision === undefined || args.reason === undefined) throw new Error('fleet_vote cast requires decision and reason')
      return Promise.resolve({ action: 'cast', task: fleetTaskToolDetail(tasks.castVote(callerId, args.id, args.decision, args.reason)) })
    },
  }))
}
