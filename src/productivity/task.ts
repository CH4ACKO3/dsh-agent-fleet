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
export type FleetTaskOwnerState = 'running' | 'completed' | 'blocked'

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
  | {
      readonly kind: 'owner_count'
      readonly states: FleetTaskOwnerState[]
      readonly op: 'eq' | 'gte' | 'lte'
      readonly value: number | 'owners'
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
  | { readonly kind: 'completed'; readonly completedAt: string; readonly result: string }
  | { readonly kind: 'cancelled'; readonly cancelledAt: string; readonly reason: string }

export type FleetTaskStableStateInput =
  | { readonly kind: 'running'; readonly cohort?: readonly string[]; readonly reconcilers: readonly FleetTaskReconcilerSpec[] }
  | { readonly kind: 'dormant'; readonly reason: string; readonly reconcilers: readonly FleetTaskReconcilerSpec[] }
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'paused'; readonly reason: string }
  | { readonly kind: 'completed'; readonly result: string; readonly finalReply?: string }
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

export interface FleetTaskRequirement {
  readonly kind: 'message'
  readonly messageId: string
  readonly conversation: string
  readonly assignee: string
  readonly replyTarget?: string
  readonly completionMessageId?: string
}

export interface FleetTaskVoteNode {
  readonly id: string
  readonly channel: `#${string}`
  readonly decision: 'complete' | 'blocked'
  readonly statement: string
  readonly initiator: string
  readonly voters?: string[]
  readonly status: 'open' | 'approved' | 'rejected'
  readonly rejection?: { readonly voter: string; readonly reason: string }
}

export type FleetTaskOwner =
  | { readonly member: string; readonly state: 'running'; readonly since: string }
  | { readonly member: string; readonly state: 'completed'; readonly completedAt: string; readonly result: string }
  | { readonly member: string; readonly state: 'blocked'; readonly blockedAt: string; readonly reason: string }

export interface FleetProjectTask {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly priority: FleetProjectTaskPriority
  readonly decision: FleetTaskDecision
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
  readonly vote?: FleetTaskVoteNode
  readonly createdAt: string
  readonly updatedAt: string
  readonly dueNotifiedAt?: string
  readonly duePendingFor?: string[]
  readonly requirement?: FleetTaskRequirement
}

export interface FleetTaskState {
  readonly version: 4
  readonly tasks: readonly FleetProjectTask[]
}

export interface FleetProjectTaskEvent {
  readonly action: 'created' | 'updated' | 'commented' | 'progressed' | 'owner_completed' | 'owner_blocked' | 'reconcile_ready' | 'reconcile_started' | 'reconciled' | 'retrying' | 'timed_out' | 'signaled' | 'completed' | 'reopened' | 'due' | 'notification'
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

export interface EnsureFleetMessageTaskInput {
  readonly messageId: string
  readonly conversation: string
  readonly createdBy: string
  readonly assignee: string
  readonly replyTarget?: string
  readonly title: string
  readonly description?: string
  readonly resources?: readonly string[]
}

export interface CompleteFleetProjectTaskInput {
  readonly finalReply?: string
  readonly attemptId?: string
  readonly result?: string
}

export type FleetTaskChildOperation =
  | { readonly kind: 'create'; readonly task: Omit<CreateFleetProjectTaskInput, 'parentId'> }
  | { readonly kind: 'link'; readonly taskId: string }
  | { readonly kind: 'cancel'; readonly taskId: string; readonly reason: string }
  | {
      readonly kind: 'vote'
      readonly decision: 'complete' | 'blocked'
      readonly channel: `#${string}`
      readonly statement: string
      readonly voters?: readonly string[]
      readonly timeoutAt?: string
    }

export interface SettleFleetTaskAttemptInput {
  readonly attemptId: string
  readonly progress: string
  readonly next: FleetTaskStableStateInput
  readonly owners?: readonly string[]
  readonly childOps?: readonly FleetTaskChildOperation[]
}

export interface FleetTaskVoteRequest {
  readonly id: string
  readonly channel: `#${string}`
  readonly kind: 'finish' | 'blocked'
  readonly statement: string
  readonly voters?: readonly string[]
}

export interface FleetTaskVoteResult {
  readonly id: string
  readonly status: 'open' | 'approved' | 'rejected'
  readonly rejection?: { readonly voter: string; readonly reason: string }
}

export interface FleetTaskRequirementCompletion { readonly messageId?: string }

const EMPTY_STATE: FleetTaskState = { version: 4, tasks: [] }
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
  if (input.version !== 4 || !Array.isArray(input.tasks)) {
    throw new Error('Fleet Task state version is incompatible; remove the old productivity-tasks state and recreate Tasks')
  }
  return { version: 4, tasks: snapshot(input.tasks) as unknown as FleetProjectTask[] }
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
    private readonly onRequirementComplete: (
      callerId: string,
      task: FleetProjectTask,
      finalReply: string,
    ) => FleetTaskRequirementCompletion | void = () => {},
    private readonly onVoteRequest: (
      callerId: string,
      task: FleetProjectTask,
      request: FleetTaskVoteRequest,
    ) => FleetTaskVoteResult = () => { throw new Error('Fleet task voting is unavailable') },
  ) {}

  state(): FleetTaskState { return { version: 4, tasks: [...this.tasks.values()].map(snapshot) } }

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
    this.evaluateAll()
  }

  activate(): void {
    this.assertOpen()
    if (this.active) return
    this.active = true
    this.evaluateAll()
    for (const task of this.tasks.values()) {
      this.arm(task)
      if (task.vote?.status === 'open') this.ensureVote(task)
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
    if (materialized.activeReconcile !== undefined) this.emit({ action: 'reconcile_ready', task: materialized })
    return snapshot(materialized)
  }

  ensureMessageTask(input: EnsureFleetMessageTaskInput): FleetProjectTask {
    this.assertOpen()
    const assignee = this.resolve(input.assignee)
    const existing = [...this.tasks.values()].find(task => task.requirement?.kind === 'message'
      && task.requirement.messageId === input.messageId && task.requirement.assignee === assignee)
    if (existing !== undefined) return snapshot(existing)
    const createdBy = requiredText(input.createdBy, 'task creator')
    const task = this.buildTask(createdBy, {
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      priority: 'high',
      assignees: [assignee],
      ...(input.resources === undefined ? {} : { resources: input.resources }),
    })
    const required: FleetProjectTask = {
      ...task,
      followers: this.resolveOptionalMember(createdBy, assignee),
      requirement: {
        kind: 'message',
        messageId: requiredText(input.messageId, 'required message id'),
        conversation: requiredText(input.conversation, 'required message conversation'),
        assignee,
        ...(input.replyTarget === undefined ? {} : { replyTarget: requiredText(input.replyTarget, 'required message reply target') }),
      },
    }
    this.tasks.set(required.id, required)
    const materialized = this.materialize(required, this.tasks)
    this.tasks.set(required.id, materialized)
    this.arm(materialized)
    this.emit({ action: 'created', task: materialized, actor: createdBy })
    if (materialized.activeReconcile !== undefined) this.emit({ action: 'reconcile_ready', task: materialized })
    return snapshot(materialized)
  }

  pendingRequirement(reference: string): FleetProjectTask | undefined {
    const assignee = this.resolve(reference)
    const task = [...this.tasks.values()]
      .filter(candidate => candidate.requirement?.assignee === assignee)
      .filter(candidate => candidate.stableState.kind !== 'completed' && candidate.stableState.kind !== 'cancelled')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
    return task === undefined ? undefined : snapshot(task)
  }

  readyRequirement(reference: string): FleetProjectTask | undefined {
    const assignee = this.resolve(reference)
    const task = [...this.tasks.values()]
      .filter(candidate => candidate.requirement?.assignee === assignee)
      .filter(candidate => candidate.activeReconcile?.status === 'ready'
        && candidate.activeReconcile.target === assignee && this.available(candidate.activeReconcile))
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
      .filter(task => task.owners.some(candidate => candidate.member === owner && candidate.state === 'running'))
      .sort((left, right) => {
        const priority = { high: 0, normal: 1, low: 2 } as const
        return priority[left.priority] - priority[right.priority] || left.createdAt.localeCompare(right.createdAt)
      })
      .map(snapshot)
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

  canSettleOwner(callerId: string, id: string): boolean {
    const owner = this.member(callerId)
    const task = this.requireTask(id)
    return task.stableState.kind === 'running'
      && task.owners.some(candidate => candidate.member === owner && candidate.state === 'running')
  }

  settleOwner(callerId: string, id: string, state: 'completed' | 'blocked', text: string): FleetProjectTask {
    const owner = this.member(callerId)
    const current = this.requireTask(id)
    if (current.stableState.kind !== 'running') throw new Error(`Fleet task ${id} is not running`)
    const ownership = current.owners.find(candidate => candidate.member === owner)
    if (ownership === undefined) throw new Error(`Fleet member ${owner} is not an owner of task ${id}`)
    if (ownership.state !== 'running') throw new Error(`Fleet task ${id} ownership for ${owner} is already ${ownership.state}`)
    const detail = requiredText(text, `task owner ${state} result`)
    const now = new Date().toISOString()
    const owners: FleetTaskOwner[] = current.owners.map(candidate => candidate.member !== owner
      ? candidate
      : state === 'completed'
        ? { member: owner, state: 'completed', completedAt: now, result: detail }
        : { member: owner, state: 'blocked', blockedAt: now, reason: detail })
    const entry: FleetTaskEntry = {
      id: `entry_${randomUUID()}`,
      kind: 'progress',
      author: owner,
      text: `Owner ${owner} ${state}: ${detail}`,
      resources: [],
      createdAt: now,
    }
    const base: FleetProjectTask = {
      ...current,
      owners,
      entries: [...current.entries, entry],
      updatedAt: now,
    }
    const updated = this.materialize(base, new Map(this.tasks).set(id, base))
    this.replace(updated)
    this.emit({ action: state === 'completed' ? 'owner_completed' : 'owner_blocked', task: updated, actor: owner })
    if (current.activeReconcile === undefined && updated.activeReconcile !== undefined) {
      this.emit({ action: 'reconcile_ready', task: updated })
    }
    return snapshot(updated)
  }

  activeWorkIsCovered(): boolean {
    const active = [...this.tasks.values()].filter(task => !this.terminal(task))
    return active.length > 0 && active.every(task => {
      if (task.stableState.kind !== 'running' && task.stableState.kind !== 'dormant') return true
      return task.activeReconcile !== undefined || task.stableState.reconcilers.length > 0
    })
  }

  claim(callerId: string, id: string): FleetProjectTask {
    const actor = this.member(callerId)
    const current = this.requireTask(id)
    const reconcile = current.activeReconcile
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
      } else if (operation.kind === 'link') {
        const linked = this.requireTaskFrom(staged, operation.taskId)
        if (linked.id === current.id) throw new Error('a Fleet task cannot include itself in its cohort')
        addedToCohort.push(linked.id)
      } else if (operation.kind === 'cancel') {
        const child = this.requireTaskFrom(staged, operation.taskId)
        if (child.parentId !== current.id) throw new Error(`Fleet task ${child.id} is not owned by ${current.id}`)
        if (child.requirement !== undefined) throw new Error(`required Fleet task ${child.id} cannot be cancelled`)
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
        const child = this.buildVoteTask(current, actor, operation, now)
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
    this.assertDecision(current, next, staged)
    if (next.kind === 'completed') {
      const incomplete = current.dependencies.filter(dependency => this.requireTaskFrom(staged, dependency).stableState.kind !== 'completed')
      if (incomplete.length > 0) throw new Error(`Fleet task ${id} has incomplete dependencies: ${incomplete.join(', ')}`)
    }
    if (current.requirement !== undefined && next.kind === 'cancelled') throw new Error(`required Fleet task ${id} cannot be cancelled`)

    let completionMessageId: string | undefined
    if (current.requirement?.kind === 'message' && input.next.kind === 'completed') {
      const reply = requiredText(input.next.finalReply ?? '', 'required task final reply')
      completionMessageId = this.onRequirementComplete(callerId, snapshot(current), reply)?.messageId
    }
    const { activeReconcile: _currentReconcile, ...currentWithoutReconcile } = current
    const base: FleetProjectTask = {
      ...currentWithoutReconcile,
      stableState: next,
      owners,
      stateVersion: current.stateVersion + 1,
      entries: [...current.entries, entry],
      updatedAt: now,
      ...(current.requirement === undefined || completionMessageId === undefined
        ? {}
        : { requirement: { ...current.requirement, completionMessageId } }),
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
    for (const vote of voteChildren) this.ensureVote(vote)
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

  resolveVote(result: FleetTaskVoteResult): FleetProjectTask | undefined {
    const current = [...this.tasks.values()].find(task => task.vote?.id === result.id)
    if (current?.vote === undefined || result.status === 'open') return undefined
    const updated: FleetProjectTask = {
      ...current,
      vote: {
        ...current.vote,
        status: result.status,
        ...(result.rejection === undefined ? {} : { rejection: result.rejection }),
      },
      updatedAt: new Date().toISOString(),
    }
    this.tasks.set(updated.id, updated)
    return this.signalEvent(updated.id, `vote:${result.id}:closed`, `Vote ${result.id} ${result.status}.`)
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
    if (current.requirement !== undefined && input.assignees !== undefined) {
      const assignees = this.resolveMany(input.assignees)
      if (assignees.length !== 1 || assignees[0] !== current.requirement.assignee) {
        throw new Error(`required Fleet task ${id} cannot be reassigned`)
      }
    }
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

  complete(callerId: string, id: string, input: CompleteFleetProjectTaskInput = {}): FleetProjectTask {
    const current = this.requireTask(id)
    this.requireResponsible(callerId, current)
    if (current.stableState.kind === 'completed') {
      throw new Error(`Fleet task ${id} is already completed; completing it again does not complete another task`)
    }
    const attemptId = input.attemptId
    if (current.activeReconcile?.status !== 'running' || attemptId === undefined || attemptId !== current.activeReconcile.attemptId) {
      throw new Error(`Fleet task ${id} completion requires its current ReconcileAttempt`)
    }
    const result = input.result ?? current.entries.at(-1)?.text ?? current.title
    return this.settle(callerId, id, {
      attemptId,
      progress: input.result ?? `Completed ${current.title}.`,
      next: { kind: 'completed', result, ...(input.finalReply === undefined ? {} : { finalReply: input.finalReply }) },
    })
  }

  canCompleteRequirement(callerId: string, id: string): boolean {
    const current = this.requireTask(id)
    const member = this.member(callerId)
    return current.requirement?.kind === 'message' && current.requirement.assignee === member
      && current.assignees.includes(member)
  }

  reopen(callerId: string, id: string): FleetProjectTask {
    const current = this.requireTask(id)
    this.requireResponsible(callerId, current)
    if (current.stableState.kind === 'running' || current.stableState.kind === 'dormant') {
      throw new Error(`Fleet task ${id} is already active`)
    }
    const actor = this.member(callerId)
    const now = new Date().toISOString()
    const { activeReconcile: _activeReconcile, ...currentWithoutReconcile } = current
    const base: FleetProjectTask = {
      ...currentWithoutReconcile,
      stableState: this.defaultRunningState(now, current.assignees[0] ?? actor),
      stateVersion: current.stateVersion + 1,
      updatedAt: now,
    }
    const updated = this.materialize(base, new Map(this.tasks).set(id, base))
    this.replace(updated)
    this.emit({ action: 'reopened', task: updated, actor })
    if (updated.activeReconcile !== undefined) this.emit({ action: 'reconcile_ready', task: updated })
    return snapshot(updated)
  }

  retireMember(member: string, successor: string): void {
    for (const task of [...this.tasks.values()]) {
      if (this.terminal(task)) continue
      const wasAssignee = task.assignees.includes(member)
      const wasReviewer = task.reviewers.includes(member)
      if (task.createdBy !== member && !wasAssignee && !wasReviewer && !task.followers.includes(member)
        && !task.owners.some(owner => owner.member === member)
        && task.activeReconcile?.target !== member && task.vote?.initiator !== member) continue
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
      const vote = task.vote?.initiator === member
        ? {
            ...task.vote,
            initiator: successor,
            ...(task.vote.voters === undefined ? {} : { voters: task.vote.voters.map(voter => voter === member ? successor : voter) }),
          }
        : task.vote
      const { activeReconcile: _taskReconcile, vote: _taskVote, ...taskBase } = task
      const updated: FleetProjectTask = {
        ...taskBase,
        stableState,
        createdBy: task.createdBy === member ? successor : task.createdBy,
        owners: this.replaceOwnerMember(task.owners, member, successor),
        assignees: unique(assignees),
        reviewers: unique(reviewers),
        followers: task.followers.filter(value => value !== member),
        ...(task.duePendingFor === undefined ? {} : { duePendingFor: unique(task.duePendingFor.map(value => value === member ? successor : value)) }),
        ...(task.requirement?.assignee === member ? { requirement: { ...task.requirement, assignee: successor } } : {}),
        ...(activeReconcile === undefined ? {} : { activeReconcile }),
        ...(vote === undefined ? {} : { vote }),
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

  private buildVoteTask(parent: FleetProjectTask, actor: string, input: Extract<FleetTaskChildOperation, { readonly kind: 'vote' }>, now: string): FleetProjectTask {
    const id = `task_${randomUUID()}`
    const voteId = `task_vote_${parent.id}_${id}`
    const voters = input.voters === undefined
      ? parent.reviewers.filter(member => member !== actor)
      : this.resolveMany(input.voters).filter(member => member !== actor)
    const triggers: FleetTaskTrigger[] = [{ kind: 'event', eventKey: `vote:${voteId}:closed` }]
    if (input.timeoutAt !== undefined) triggers.push({ kind: 'at', at: this.date(input.timeoutAt, 'task Vote timeoutAt') })
    return {
      id,
      title: `Vote: ${parent.title}`,
      description: requiredText(input.statement, 'task Vote statement'),
      priority: parent.priority,
      decision: 'direct',
      stateVersion: 1,
      stableState: {
        kind: 'dormant', since: now, reason: `Waiting for Vote ${voteId}.`,
        reconcilers: [{
          id: 'resolve-vote',
          when: triggers.length === 1 ? triggers[0] as FleetTaskTrigger : { kind: 'any', items: triggers },
          target: SYSTEM_TARGET,
          priority: 0,
          retryAfterSeconds: 0,
          maxWakeups: 1,
          onTimeout: { kind: 'blocked', reason: `Vote ${voteId} did not reach a result before its timeout.` },
        }],
      },
      createdBy: actor,
      owners: [],
      assignees: [actor],
      reviewers: voters,
      followers: [], dependencies: [], parentId: parent.id, resources: [], entries: [], signals: [],
      vote: {
        id: voteId,
        channel: input.channel,
        decision: input.decision,
        statement: requiredText(input.statement, 'task Vote statement'),
        initiator: actor,
        ...(voters.length === 0 ? {} : { voters }),
        status: 'open',
      },
      createdAt: now, updatedAt: now,
    }
  }

  private defaultRunningState(now: string, target: string): FleetTaskStableState {
    return {
      kind: 'running', since: now, cohort: [],
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
    if (input.kind === 'completed') return { kind: 'completed', completedAt: now, result: requiredText(input.result, 'task completion result') }
    if (input.kind === 'cancelled') return { kind: 'cancelled', cancelledAt: now, reason: requiredText(input.reason, 'task cancellation reason') }
    if (input.kind === 'blocked') return { kind: 'blocked', since: now, reason: requiredText(input.reason, 'task blocked reason') }
    if (input.kind === 'paused') return { kind: 'paused', since: now, reason: requiredText(input.reason, 'task pause reason') }
    const reconcilers = input.reconcilers.map(spec => this.normalizeReconciler(spec))
    if (reconcilers.length === 0) throw new Error(`${input.kind} task state requires at least one reconciler`)
    if (input.kind === 'dormant') {
      return { kind: 'dormant', since: now, reason: requiredText(input.reason, 'task dormant reason'), reconcilers }
    }
    const cohort = unique([...(input.cohort ?? []), ...addedToCohort])
    for (const id of cohort) {
      if (id === ownId) throw new Error('a Fleet task cannot include itself in its cohort')
      if (!source.has(id)) throw new Error(`unknown Fleet task ${id}`)
    }
    return { kind: 'running', since: now, cohort, reconcilers }
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
    if (input.kind === 'owner_count') {
      if (!['eq', 'gte', 'lte'].includes(input.op)) throw new Error('task owner_count op must be eq, gte, or lte')
      if (input.value !== 'owners' && (!Number.isSafeInteger(input.value) || input.value < 0)) {
        throw new Error('task owner_count value must be a non-negative integer or owners')
      }
      return { kind: 'owner_count', states: [...new Set(input.states)], op: input.op, value: input.value }
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
    if (trigger.kind !== 'child_count' && trigger.kind !== 'owner_count') return false
    if (task.stableState.kind !== 'running') return false
    const count = trigger.kind === 'child_count'
      ? task.stableState.cohort
          .map(id => source.get(id))
          .filter((child): child is FleetProjectTask => child !== undefined && trigger.states.includes(child.stableState.kind)).length
      : task.owners.filter(owner => trigger.states.includes(owner.state)).length
    const expected = trigger.value === 'cohort'
      ? task.stableState.cohort.length
      : trigger.value === 'owners' ? task.owners.length : trigger.value
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
    if (trigger.kind === 'owner_count') {
      const count = task.owners.filter(owner => trigger.states.includes(owner.state)).length
      return `Owner predicate matched ${count} owners in states ${trigger.states.join(', ')}.`
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
    if (current.vote === undefined) {
      this.expireReconcile(current, `System reconciler ${reconcile.id} has no deterministic handler.`)
      return
    }
    const now = new Date().toISOString()
    const next: FleetTaskStableState = current.vote.status === 'open'
      ? { kind: 'blocked', since: now, reason: `Vote ${current.vote.id} timed out without a result.` }
      : {
          kind: 'completed', completedAt: now,
          result: current.vote.status === 'approved'
            ? `Vote ${current.vote.id} approved: ${current.vote.statement}`
            : `Vote ${current.vote.id} rejected${current.vote.rejection === undefined ? '.' : ` by ${current.vote.rejection.voter}: ${current.vote.rejection.reason}`}`,
        }
    const entry: FleetTaskEntry = {
      id: `entry_${randomUUID()}`, kind: 'progress', author: SYSTEM_TARGET,
      text: next.kind === 'completed' ? next.result : next.reason, resources: [], createdAt: now,
    }
    const { activeReconcile: _activeReconcile, ...currentWithoutReconcile } = current
    const updated: FleetProjectTask = {
      ...currentWithoutReconcile,
      stableState: next,
      stateVersion: current.stateVersion + 1,
      entries: [...current.entries, entry],
      updatedAt: now,
    }
    this.replace(updated)
    this.emit({ action: next.kind === 'completed' ? 'completed' : 'timed_out', task: updated, actor: SYSTEM_TARGET })
    this.evaluateDependents([updated.id])
  }

  private assertDecision(current: FleetProjectTask, next: FleetTaskStableState, source: ReadonlyMap<string, FleetProjectTask>): void {
    if (current.decision !== 'vote' || (next.kind !== 'completed' && next.kind !== 'blocked')) return
    const cohort = current.stableState.kind === 'running' ? current.stableState.cohort : []
    const decision = next.kind === 'completed' ? 'complete' : 'blocked'
    const approved = cohort.map(id => source.get(id)).some(child => child?.vote?.decision === decision
      && child.vote.status === 'approved' && child.stableState.kind === 'completed')
    if (!approved) throw new Error(`Fleet task ${current.id} requires an approved ${decision} Vote child`)
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

  private ensureVote(task: FleetProjectTask): void {
    const vote = task.vote
    if (vote === undefined || vote.status !== 'open') return
    const callerId = this.agentIdFor(vote.initiator)
    if (callerId === undefined) return
    try {
      const result = this.onVoteRequest(callerId, snapshot(task), {
        id: vote.id,
        channel: vote.channel,
        kind: vote.decision === 'complete' ? 'finish' : 'blocked',
        statement: `[Task ${task.parentId ?? task.id}] ${vote.statement}`,
        ...(vote.voters === undefined ? {} : { voters: vote.voters }),
      })
      this.resolveVote(result)
    } catch (error) {
      const current = this.tasks.get(task.id)
      if (current?.vote?.status !== 'open') return
      const message = error instanceof Error ? error.message : String(error)
      const updated: FleetProjectTask = {
        ...current,
        vote: {
          ...current.vote,
          status: 'rejected',
          rejection: { voter: SYSTEM_TARGET, reason: `Vote could not be opened: ${message}` },
        },
        updatedAt: new Date().toISOString(),
      }
      this.tasks.set(updated.id, updated)
      this.signalEvent(updated.id, `vote:${vote.id}:closed`, `Vote ${vote.id} could not be opened: ${message}`)
    }
  }

  private evaluateAll(): void { for (const task of [...this.tasks.values()]) this.evaluateTask(task.id) }

  private evaluateTask(id: string): void {
    const current = this.tasks.get(id)
    if (current === undefined || current.activeReconcile !== undefined) return
    const updated = this.materialize(current, this.tasks)
    if (updated === current) return
    this.replace(updated)
    this.emit({ action: 'reconcile_ready', task: updated })
    this.runSystemReconcile(id)
  }

  private evaluateDependents(changedIds: readonly string[]): void {
    const changed = new Set(changedIds)
    for (const task of [...this.tasks.values()]) {
      if (task.stableState.kind === 'running' && task.stableState.cohort.some(id => changed.has(id))) this.evaluateTask(task.id)
    }
  }

  private triggerDue(id: string): void {
    const current = this.tasks.get(id)
    if (current === undefined || current.dueAt === undefined || current.dueNotifiedAt !== undefined || this.terminal(current)) return
    const now = new Date().toISOString()
    const duePendingFor = unique([
      ...current.assignees,
      ...current.reviewers,
      ...current.owners.filter(owner => owner.state === 'running').map(owner => owner.member),
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
      for (const spec of task.stableState.reconcilers) this.collectTimes(spec.when, times)
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
    return this.resolveMany(values).map(member => byMember.get(member) ?? { member, state: 'running', since: now })
  }
  private replaceOwnerMember(owners: readonly FleetTaskOwner[], member: string, successor: string): FleetTaskOwner[] {
    const result = new Map<string, FleetTaskOwner>()
    for (const owner of owners) {
      const updated = owner.member === member ? { ...owner, member: successor } : owner
      const existing = result.get(updated.member)
      if (existing === undefined || updated.state === 'running') result.set(updated.member, updated)
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
  description: 'Explicit next stable state. Terminal: {kind:"completed",result} or {kind:"blocked"|"paused"|"cancelled",reason}. Live: {kind:"running",cohort?:taskIds,reconcilers:[...]} or {kind:"dormant",reason,reconcilers:[...]}. Each reconciler is {id,when,target,priority,retryAfterSeconds,maxWakeups,timeoutAt?,onTimeout:{kind:"blocked"|"paused"|"cancelled",reason}}. Triggers are {kind:"on_enter"}, {kind:"event",eventKey}, {kind:"at",at}, {kind:"child_count",states,op:"eq"|"gte"|"lte",value:number|"cohort"}, {kind:"owner_count",states:["running"|"completed"|"blocked"],op,value:number|"owners"}, or recursive {kind:"all"|"any",items:[...]}.',
} as const
const CHILD_OPERATION_SCHEMA = {
  ...FLEX_OBJECT_SCHEMA,
  description: 'Atomic child operation: {kind:"create",task:{title,...}}, {kind:"link",taskId}, {kind:"cancel",taskId,reason}, or {kind:"vote",decision:"complete"|"blocked",channel,statement,voters?,timeoutAt?}. Created and Vote Tasks join the next running cohort automatically.',
} as const

const TASK_SCHEMA = FLEX_OBJECT_SCHEMA

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'owner_list', 'get', 'create', 'update', 'comment', 'progress', 'claim', 'settle', 'complete', 'owner_complete', 'owner_block', 'reopen', 'signal'] },
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

function jsonTask(task: FleetProjectTask): Record<string, JsonValue> {
  return snapshot(task) as unknown as Record<string, JsonValue>
}

export function installTaskTools(
  ctx: Context,
  tasks: FleetTaskBoard,
  authorize: (agentId: string, action: string) => boolean,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_task',
    description: 'Manage recursive durable Tasks. Agent work advances through a ReconcileAttempt reserved for one exact Agent. Owners are independent implicit child Tasks: owner_list returns the caller\'s running work, and owner_complete or owner_block settles that ownership. A non-empty owner list keeps waking its member.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'owner_list', 'get', 'create', 'update', 'comment', 'progress', 'claim', 'settle', 'complete', 'owner_complete', 'owner_block', 'reopen', 'signal'] },
      id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
      stable_kind: { type: 'string', enum: ['running', 'dormant', 'blocked', 'paused', 'completed', 'cancelled'] },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] }, decision: { type: 'string', enum: ['direct', 'vote'] },
      owners: { type: 'array', items: { type: 'string' }, description: 'Concrete Fleet members whose implicit owner work starts running. Omit or pass [] for no owners. With settle, the new owner set is committed atomically with the next stable state.' },
      assignees: { type: 'array', items: { type: 'string' } }, reviewers: { type: 'array', items: { type: 'string' } },
      followers: { type: 'array', items: { type: 'string' } }, dependencies: { type: 'array', items: { type: 'string' } },
      parent_id: { type: 'string' }, due_at: { type: 'string' }, resources: { type: 'array', items: { type: 'string' } },
      initial_state: STABLE_STATE_SCHEMA,
      state: STABLE_STATE_SCHEMA,
      child_ops: { type: 'array', items: CHILD_OPERATION_SCHEMA },
      text: { type: 'string' }, attempt_id: { type: 'string' }, event_key: { type: 'string' }, result: { type: 'string' },
      final_reply: { type: 'string', description: 'Required when completing a message-created Task.' },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = caller(exec.agent)
      const callerId = String(agent.id)
      const permission = args.action === 'list' || args.action === 'owner_list' || args.action === 'get' ? 'task.read'
        : args.action === 'create' ? 'task.create'
          : args.action === 'comment' ? 'task.comment'
            : args.action === 'progress' || args.action === 'claim' ? 'task.progress' : 'task.update'
      const canCompleteOwnRequirement = (args.action === 'complete' || args.action === 'settle')
        && args.id !== undefined && tasks.canCompleteRequirement(callerId, args.id)
      const canUseOwnOwnerTask = args.action === 'owner_list'
        || ((args.action === 'owner_complete' || args.action === 'owner_block')
          && args.id !== undefined && tasks.canSettleOwner(callerId, args.id))
      if (!canCompleteOwnRequirement && !canUseOwnOwnerTask
        && !authorize(callerId, permission) && !authorize(callerId, 'task.manage')) {
        throw new Error(`Agent ${callerId} is not authorized for ${permission}`)
      }
      if (args.action === 'list') return Promise.resolve({ action: 'list' as const, tasks: tasks.list(callerId, {
        ...(args.stable_kind === undefined ? {} : { state: args.stable_kind }),
        ...(args.assignees?.[0] === undefined ? {} : { assignee: args.assignees[0] }),
        ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }),
      }).map(jsonTask) })
      if (args.action === 'owner_list') {
        return Promise.resolve({ action: 'owner_list' as const, tasks: tasks.ownerTasks(callerId).map(jsonTask) })
      }
      if (args.action === 'create') {
        if (args.title === undefined) throw new Error('fleet_task create requires title')
        return Promise.resolve({ action: 'create' as const, task: jsonTask(tasks.create(callerId, {
          title: args.title,
          ...(args.description === undefined ? {} : { description: args.description }),
          ...(args.priority === undefined ? {} : { priority: args.priority }),
          ...(args.decision === undefined ? {} : { decision: args.decision }),
          ...(args.owners === undefined ? {} : { owners: args.owners }),
          ...(args.assignees === undefined ? {} : { assignees: args.assignees }),
          ...(args.reviewers === undefined ? {} : { reviewers: args.reviewers }),
          ...(args.followers === undefined ? {} : { followers: args.followers }),
          ...(args.dependencies === undefined ? {} : { dependencies: args.dependencies }),
          ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }),
          ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
          ...(args.resources === undefined ? {} : { resources: args.resources }),
          ...(args.initial_state === undefined ? {} : { initialState: args.initial_state as unknown as FleetTaskStableStateInput }),
        })) })
      }
      if (args.id === undefined) throw new Error(`fleet_task ${args.action} requires id`)
      if (args.action === 'get') return Promise.resolve({ action: 'get' as const, task: jsonTask(tasks.get(callerId, args.id)) })
      if (args.action === 'claim') return Promise.resolve({ action: 'claim' as const, task: jsonTask(tasks.claim(callerId, args.id)) })
      if (args.action === 'update') return Promise.resolve({ action: 'update' as const, task: jsonTask(tasks.update(callerId, args.id, {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.priority === undefined ? {} : { priority: args.priority }),
        ...(args.decision === undefined ? {} : { decision: args.decision }),
        ...(args.owners === undefined ? {} : { owners: args.owners }),
        ...(args.assignees === undefined ? {} : { assignees: args.assignees }),
        ...(args.reviewers === undefined ? {} : { reviewers: args.reviewers }),
        ...(args.followers === undefined ? {} : { followers: args.followers }),
        ...(args.dependencies === undefined ? {} : { dependencies: args.dependencies }),
        ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
        ...(args.resources === undefined ? {} : { resources: args.resources }),
      })) })
      if (args.action === 'comment' || args.action === 'progress') {
        if (args.text === undefined) throw new Error(`fleet_task ${args.action} requires text`)
        return Promise.resolve({ action: args.action, task: jsonTask(tasks.addEntry(callerId, args.id, args.action, args.text, args.resources)) })
      }
      if (args.action === 'signal') {
        if (args.event_key === undefined) throw new Error('fleet_task signal requires event_key')
        return Promise.resolve({ action: 'signal' as const, task: jsonTask(tasks.signalEvent(args.id, args.event_key, args.result)) })
      }
      if (args.action === 'owner_complete' || args.action === 'owner_block') {
        if (args.text === undefined) throw new Error(`fleet_task ${args.action} requires text`)
        return Promise.resolve({
          action: args.action,
          task: jsonTask(tasks.settleOwner(callerId, args.id, args.action === 'owner_complete' ? 'completed' : 'blocked', args.text)),
        })
      }
      if (args.action === 'settle') {
        if (args.attempt_id === undefined || args.text === undefined || args.state === undefined) {
          throw new Error('fleet_task settle requires attempt_id, text, and an explicit stable state')
        }
        return Promise.resolve({
          action: 'settle' as const,
          task: jsonTask(tasks.settle(callerId, args.id, {
            attemptId: args.attempt_id,
            progress: args.text,
            next: args.state as unknown as FleetTaskStableStateInput,
            ...(args.owners === undefined ? {} : { owners: args.owners }),
            ...(args.child_ops === undefined ? {} : { childOps: args.child_ops as unknown as FleetTaskChildOperation[] }),
          })),
        })
      }
      return Promise.resolve({
        action: args.action,
        task: jsonTask(args.action === 'complete'
          ? tasks.complete(callerId, args.id, {
              ...(args.attempt_id === undefined ? {} : { attemptId: args.attempt_id }),
              ...(args.result === undefined ? {} : { result: args.result }),
              ...(args.final_reply === undefined ? {} : { finalReply: args.final_reply }),
            })
          : tasks.reopen(callerId, args.id)),
      })
    },
  }))
}
