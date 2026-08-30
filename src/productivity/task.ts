import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, JsonValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'

export const FLEET_TASK_STATE_NAMESPACE = 'productivity-tasks'

export type FleetProjectTaskStatus = 'open' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'
export type FleetProjectTaskPriority = 'low' | 'normal' | 'high'
export type FleetTaskDecision = 'direct' | 'vote'

export interface FleetTaskTimeouts {
  readonly readySeconds?: number
  readonly runningSeconds?: number
  readonly eventSeconds?: number
}

export interface FleetTaskVoteApproval {
  readonly voteId: string
  readonly decision: 'complete'
}

export type FleetTaskExecution =
  | {
      readonly kind: 'ready'
      readonly since: string
      readonly reason: string
      readonly reconcile: boolean
      readonly timeoutAt?: string
      readonly approval?: FleetTaskVoteApproval
    }
  | {
      readonly kind: 'running'
      readonly attemptId: string
      readonly actor: string
      readonly startedAt: string
      readonly timeoutAt?: string
      readonly approval?: FleetTaskVoteApproval
    }
  | {
      readonly kind: 'waiting_time'
      readonly since: string
      readonly wakeAt: string
    }
  | {
      readonly kind: 'waiting_event'
      readonly since: string
      readonly eventKey: string
      readonly timeoutAt?: string
    }
  | {
      readonly kind: 'waiting_vote'
      readonly since: string
      readonly voteId: string
      readonly initiator: string
      readonly channel: `#${string}`
      readonly decision: 'complete' | 'blocked'
      readonly statement: string
      readonly voters?: string[]
      readonly timeoutAt?: string
    }
  | {
      readonly kind: 'blocked'
      readonly since: string
      readonly reason: string
    }
  | {
      readonly kind: 'completed'
      readonly completedAt: string
      readonly result: string
    }
  | {
      readonly kind: 'cancelled'
      readonly cancelledAt: string
      readonly reason: string
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
  /** Routable source conversation for the final completion reply. */
  readonly replyTarget?: string
  /** Durable evidence that the required final reply was sent before completion. */
  readonly completionMessageId?: string
}

export interface FleetProjectTask {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: FleetProjectTaskStatus
  readonly priority: FleetProjectTaskPriority
  readonly decision: FleetTaskDecision
  readonly timeouts: FleetTaskTimeouts
  readonly execution: FleetTaskExecution
  readonly createdBy: string
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
  readonly completedAt?: string
  readonly dueNotifiedAt?: string
  readonly duePendingFor?: string[]
  /** A durable obligation created from a must-reply message or parsed @mention. */
  readonly requirement?: FleetTaskRequirement
}

export interface FleetTaskState {
  readonly version: 2
  readonly tasks: readonly FleetProjectTask[]
}

export interface FleetProjectTaskEvent {
  readonly action: 'created' | 'updated' | 'commented' | 'progressed' | 'claimed' | 'settled' | 'timed_out' | 'signaled' | 'completed' | 'reopened' | 'due' | 'notification'
  readonly task: FleetProjectTask
  readonly actor?: string
}

export interface CreateFleetProjectTaskInput {
  readonly title: string
  readonly description?: string
  readonly priority?: FleetProjectTaskPriority
  readonly decision?: FleetTaskDecision
  readonly timeouts?: FleetTaskTimeouts
  readonly assignees?: readonly string[]
  readonly reviewers?: readonly string[]
  readonly followers?: readonly string[]
  readonly dependencies?: readonly string[]
  readonly parentId?: string
  readonly dueAt?: string
  readonly resources?: readonly string[]
}

export interface UpdateFleetProjectTaskInput {
  readonly title?: string
  readonly description?: string
  readonly status?: Exclude<FleetProjectTaskStatus, 'completed'>
  readonly priority?: FleetProjectTaskPriority
  readonly decision?: FleetTaskDecision
  readonly timeouts?: FleetTaskTimeouts
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
  /** Required for message obligations; sent to the source conversation before completion. */
  readonly finalReply?: string
  readonly attemptId?: string
}

export type FleetTaskSettlement =
  | { readonly kind: 'ready'; readonly reason?: string }
  | { readonly kind: 'waiting_time'; readonly wakeAt: string }
  | { readonly kind: 'waiting_event'; readonly eventKey: string; readonly timeoutAt?: string }
  | { readonly kind: 'vote'; readonly decision: 'complete' | 'blocked'; readonly channel: `#${string}`; readonly statement: string; readonly voters?: readonly string[]; readonly timeoutAt?: string }
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'completed'; readonly result: string; readonly finalReply?: string }
  | { readonly kind: 'cancelled'; readonly reason: string }

export interface SettleFleetTaskAttemptInput {
  readonly attemptId: string
  readonly progress: string
  readonly next: FleetTaskSettlement
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

export interface FleetTaskRequirementCompletion {
  readonly messageId?: string
}

const EMPTY_STATE: FleetTaskState = { version: 2, tasks: [] }

function requiredText(value: string, label: string): string {
  const result = value.trim()
  if (result.length === 0) throw new Error(`${label} cannot be empty`)
  return result
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function snapshot<T>(value: T): T {
  return structuredClone(value)
}

function legacyExecution(task: Omit<FleetProjectTask, 'decision' | 'timeouts' | 'execution' | 'signals'>): FleetTaskExecution {
  if (task.status === 'completed') {
    const completedAt = task.completedAt ?? task.updatedAt
    return { kind: 'completed', completedAt, result: task.entries.at(-1)?.text ?? task.title }
  }
  if (task.status === 'cancelled') {
    return { kind: 'cancelled', cancelledAt: task.updatedAt, reason: 'Task was cancelled before durable execution state was introduced.' }
  }
  if (task.status === 'blocked') {
    return { kind: 'blocked', since: task.updatedAt, reason: 'Task was already blocked when durable execution state was restored.' }
  }
  return { kind: 'ready', since: task.updatedAt, reason: 'Restored runnable task.', reconcile: false }
}

export function parseFleetTaskState(value: JsonValue | undefined): FleetTaskState {
  if (value === undefined) return snapshot(EMPTY_STATE)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Fleet Task state must be an object')
  }
  const input = value as Record<string, JsonValue>
  if (!Array.isArray(input.tasks) || (input.version !== 1 && input.version !== 2)) {
    throw new Error('Fleet Task state must contain version 1 or 2 tasks')
  }
  if (input.version === 2) {
    const tasks = snapshot(input.tasks) as unknown as FleetProjectTask[]
    return { version: 2, tasks: tasks.map(task => ({ ...task, signals: task.signals ?? [] })) }
  }
  const tasks = snapshot(input.tasks) as unknown as Array<Omit<FleetProjectTask, 'decision' | 'timeouts' | 'execution' | 'signals'>>
  return {
    version: 2,
    tasks: tasks.map(task => ({
      ...task,
      decision: 'direct',
      timeouts: {},
      execution: legacyExecution(task),
      signals: [],
    })),
  }
}

export class FleetTaskBoard {
  private readonly tasks = new Map<string, FleetProjectTask>()
  private readonly dueTimers = new Map<string, NodeJS.Timeout>()
  private readonly executionTimers = new Map<string, NodeJS.Timeout>()
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

  state(): FleetTaskState {
    return { version: 2, tasks: [...this.tasks.values()].map(snapshot) }
  }

  restore(state: FleetTaskState): void {
    this.assertOpen()
    this.pause()
    this.tasks.clear()
    for (const task of state.tasks) this.tasks.set(task.id, snapshot(task))
  }

  activate(): void {
    this.assertOpen()
    if (this.active) return
    this.active = true
    for (const task of this.tasks.values()) {
      this.arm(task)
      if (task.execution.kind === 'waiting_vote') this.ensureVote(task)
    }
  }

  pause(): void {
    this.active = false
    for (const timer of this.dueTimers.values()) clearTimeout(timer)
    for (const timer of this.executionTimers.values()) clearTimeout(timer)
    this.dueTimers.clear()
    this.executionTimers.clear()
  }

  replayPending(member: string): void {
    for (const task of this.tasks.values()) {
      if (task.status !== 'completed' && task.status !== 'cancelled'
        && task.duePendingFor?.includes(member) === true) this.deliverDue(task, [member])
    }
  }

  list(callerId: string, input: {
    readonly status?: FleetProjectTaskStatus
    readonly assignee?: string
    readonly parentId?: string
  } = {}): FleetProjectTask[] {
    this.member(callerId)
    const assignee = input.assignee === undefined ? undefined : this.resolve(input.assignee)
    return [...this.tasks.values()]
      .filter(task => input.status === undefined || task.status === input.status)
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
    if (input.parentId !== undefined) this.requireTask(input.parentId)
    const dependencies = this.taskReferences(input.dependencies ?? [])
    const now = new Date().toISOString()
    const timeouts = this.timeoutPolicy(input.timeouts ?? {})
    const task: FleetProjectTask = {
      id: `task_${randomUUID()}`,
      title: requiredText(input.title, 'task title'),
      description: input.description?.trim() ?? '',
      status: 'open',
      priority: input.priority ?? 'normal',
      decision: input.decision ?? 'direct',
      timeouts,
      execution: this.readyExecution(now, 'Task created.', timeouts),
      createdBy,
      assignees: this.resolveMany(input.assignees ?? [createdBy]),
      reviewers: this.resolveMany(input.reviewers ?? []),
      followers: this.resolveMany(input.followers ?? []),
      dependencies,
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      ...(input.dueAt === undefined ? {} : { dueAt: this.date(input.dueAt, 'task dueAt') }),
      resources: this.strings(input.resources ?? [], 'resource id'),
      entries: [],
      signals: [],
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(task.id, task)
    this.emit({ action: 'created', task, actor: createdBy })
    this.arm(task)
    return snapshot(task)
  }

  ensureMessageTask(input: EnsureFleetMessageTaskInput): FleetProjectTask {
    this.assertOpen()
    const assignee = this.resolve(input.assignee)
    const existing = [...this.tasks.values()].find(task =>
      task.requirement?.kind === 'message'
      && task.requirement.messageId === input.messageId
      && task.requirement.assignee === assignee)
    if (existing !== undefined) return snapshot(existing)
    const now = new Date().toISOString()
    const createdBy = requiredText(input.createdBy, 'task creator')
    const task: FleetProjectTask = {
      id: `task_${randomUUID()}`,
      title: requiredText(input.title, 'task title'),
      description: input.description?.trim() ?? '',
      status: 'open',
      priority: 'high',
      decision: 'direct',
      timeouts: {},
      execution: this.readyExecution(now, 'Required message task created.', {}),
      createdBy,
      assignees: [assignee],
      reviewers: [],
      followers: this.resolveOptionalMember(createdBy, assignee),
      dependencies: [],
      resources: this.strings(input.resources ?? [], 'resource id'),
      entries: [],
      signals: [],
      createdAt: now,
      updatedAt: now,
      requirement: {
        kind: 'message',
        messageId: requiredText(input.messageId, 'required message id'),
        conversation: requiredText(input.conversation, 'required message conversation'),
        assignee,
        ...(input.replyTarget === undefined
          ? {}
          : { replyTarget: requiredText(input.replyTarget, 'required message reply target') }),
      },
    }
    this.tasks.set(task.id, task)
    this.emit({ action: 'created', task, actor: createdBy })
    return snapshot(task)
  }

  pendingRequirement(reference: string): FleetProjectTask | undefined {
    const assignee = this.resolve(reference)
    const task = [...this.tasks.values()]
      .filter(candidate => candidate.requirement?.assignee === assignee)
      .filter(candidate => candidate.status !== 'completed')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
    return task === undefined ? undefined : snapshot(task)
  }

  readyRequirement(reference: string): FleetProjectTask | undefined {
    const assignee = this.resolve(reference)
    const task = [...this.tasks.values()]
      .filter(candidate => candidate.requirement?.assignee === assignee)
      .filter(candidate => candidate.execution.kind === 'ready')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
    return task === undefined ? undefined : snapshot(task)
  }

  readyTasks(reference?: string): FleetProjectTask[] {
    const assignee = reference === undefined ? undefined : this.resolve(reference)
    const completed = new Set([...this.tasks.values()]
      .filter(task => task.status === 'completed')
      .map(task => task.id))
    return [...this.tasks.values()]
      .filter(task => task.execution.kind === 'ready')
      .filter(task => assignee === undefined
        || (task.execution.kind === 'ready' && task.execution.reconcile)
        || task.assignees.includes(assignee))
      .filter(task => task.dependencies.every(dependency => completed.has(dependency)))
      .sort((left, right) => {
        const priority = { high: 0, normal: 1, low: 2 } as const
        return priority[left.priority] - priority[right.priority]
          || left.createdAt.localeCompare(right.createdAt)
      })
      .map(snapshot)
  }

  runningFor(reference: string): FleetProjectTask[] {
    const actor = this.resolve(reference)
    return [...this.tasks.values()]
      .filter(task => task.execution.kind === 'running' && task.execution.actor === actor)
      .map(snapshot)
  }

  activeWorkIsCovered(): boolean {
    const active = [...this.tasks.values()]
      .filter(task => task.status !== 'completed' && task.status !== 'cancelled')
    return active.length > 0 && active.every(task => task.execution.kind !== 'ready')
  }

  claim(callerId: string, id: string): FleetProjectTask {
    const actor = this.member(callerId)
    const current = this.requireTask(id)
    if (current.execution.kind !== 'ready') throw new Error(`Fleet task ${id} is ${current.execution.kind}, not ready`)
    if (!current.assignees.includes(actor) && !current.execution.reconcile && !this.canManage(callerId)) {
      throw new Error(`Fleet member ${actor} cannot claim task ${id}`)
    }
    const incomplete = current.dependencies.filter(dependency => this.requireTask(dependency).status !== 'completed')
    if (incomplete.length > 0) throw new Error(`Fleet task ${id} has incomplete dependencies: ${incomplete.join(', ')}`)
    const now = new Date().toISOString()
    const timeoutAt = this.deadline(now, current.timeouts.runningSeconds)
    const execution: FleetTaskExecution = {
      kind: 'running',
      attemptId: `attempt_${randomUUID()}`,
      actor,
      startedAt: now,
      ...(timeoutAt === undefined ? {} : { timeoutAt }),
      ...(current.execution.approval === undefined ? {} : { approval: current.execution.approval }),
    }
    const updated: FleetProjectTask = { ...current, status: 'in_progress', execution, updatedAt: now }
    this.replace(updated)
    this.emit({ action: 'claimed', task: updated, actor })
    return snapshot(updated)
  }

  settle(callerId: string, id: string, input: SettleFleetTaskAttemptInput): FleetProjectTask {
    const actor = this.member(callerId)
    const current = this.requireTask(id)
    const running = current.execution
    if (running.kind !== 'running' || running.attemptId !== input.attemptId) {
      throw new Error(`Fleet task ${id} attempt ${input.attemptId} is no longer current`)
    }
    if (running.actor !== actor) throw new Error(`Fleet task ${id} attempt belongs to ${running.actor}, not ${actor}`)
    const progress = requiredText(input.progress, 'task settlement progress')
    const now = new Date().toISOString()
    const entry: FleetTaskEntry = {
      id: `entry_${randomUUID()}`,
      kind: 'progress',
      author: actor,
      text: progress,
      resources: [],
      createdAt: now,
    }
    const base: FleetProjectTask = { ...current, entries: [...current.entries, entry], updatedAt: now }
    const next = input.next
    if (next.kind === 'completed') {
      return this.completeCurrent(callerId, base, next.result, next.finalReply, running.approval)
    }
    if (next.kind === 'cancelled') {
      if (current.requirement !== undefined) throw new Error(`required Fleet task ${id} cannot be cancelled`)
      const updated: FleetProjectTask = {
        ...base,
        status: 'cancelled',
        execution: { kind: 'cancelled', cancelledAt: now, reason: requiredText(next.reason, 'task cancellation reason') },
      }
      this.replace(updated)
      this.emit({ action: 'settled', task: updated, actor })
      return snapshot(updated)
    }
    if (next.kind === 'blocked') {
      if (current.decision === 'vote') throw new Error(`Fleet task ${id} requires a Vote before it can be blocked`)
      const updated: FleetProjectTask = {
        ...base,
        status: 'blocked',
        execution: { kind: 'blocked', since: now, reason: requiredText(next.reason, 'task blocked reason') },
      }
      this.replace(updated)
      this.emit({ action: 'settled', task: updated, actor })
      return snapshot(updated)
    }
    if (next.kind === 'waiting_time') {
      const updated: FleetProjectTask = {
        ...base,
        status: 'in_progress',
        execution: { kind: 'waiting_time', since: now, wakeAt: this.date(next.wakeAt, 'task wakeAt') },
      }
      this.replace(updated)
      this.emit({ action: 'settled', task: updated, actor })
      return snapshot(updated)
    }
    if (next.kind === 'waiting_event') {
      const eventKey = requiredText(next.eventKey, 'task event key')
      const signal = base.signals.find(candidate => candidate.eventKey === eventKey)
      if (signal !== undefined) {
        const updated: FleetProjectTask = {
          ...base,
          status: 'in_progress',
          execution: this.readyExecution(now, signal.result, current.timeouts),
        }
        this.replace(updated)
        this.emit({ action: 'settled', task: updated, actor })
        return snapshot(updated)
      }
      const timeoutAt = next.timeoutAt === undefined
        ? this.deadline(now, current.timeouts.eventSeconds)
        : this.date(next.timeoutAt, 'task event timeoutAt')
      const updated: FleetProjectTask = {
        ...base,
        status: 'in_progress',
        execution: {
          kind: 'waiting_event',
          since: now,
          eventKey,
          ...(timeoutAt === undefined ? {} : { timeoutAt }),
        },
      }
      this.replace(updated)
      this.emit({ action: 'settled', task: updated, actor })
      return snapshot(updated)
    }
    if (next.kind === 'vote') return this.waitForVote(callerId, base, next)
    const updated: FleetProjectTask = {
      ...base,
      status: 'in_progress',
      execution: this.readyExecution(now, next.reason ?? 'Continue the next runnable step.', current.timeouts, running.approval),
    }
    this.replace(updated)
    this.emit({ action: 'settled', task: updated, actor })
    return snapshot(updated)
  }

  signalEvent(id: string, eventKey: string, result = 'Event completed.'): FleetProjectTask {
    const current = this.requireTask(id)
    const key = requiredText(eventKey, 'task event key')
    const existing = current.signals.find(signal => signal.eventKey === key)
    if (existing !== undefined) return snapshot(current)
    const now = new Date().toISOString()
    const signal: FleetTaskSignal = {
      eventKey: key,
      result: requiredText(result, 'task event result'),
      signaledAt: now,
    }
    const updated: FleetProjectTask = {
      ...current,
      ...(current.execution.kind === 'waiting_event' && current.execution.eventKey === key
        ? {
            status: 'in_progress' as const,
            execution: this.readyExecution(now, signal.result, current.timeouts),
          }
        : {}),
      signals: [...current.signals, signal],
      updatedAt: now,
    }
    this.replace(updated)
    this.emit({ action: 'signaled', task: updated })
    return snapshot(updated)
  }

  resolveVote(result: FleetTaskVoteResult): FleetProjectTask | undefined {
    const current = [...this.tasks.values()]
      .find(task => task.execution.kind === 'waiting_vote' && task.execution.voteId === result.id)
    if (current === undefined || current.execution.kind !== 'waiting_vote' || result.status === 'open') return undefined
    const waiting = current.execution
    const now = new Date().toISOString()
    if (result.status === 'rejected') {
      const reason = result.rejection === undefined
        ? `Vote ${result.id} was rejected; reconcile the requested ${waiting.decision} decision.`
        : `Vote ${result.id} was rejected by ${result.rejection.voter}: ${result.rejection.reason}`
      const updated: FleetProjectTask = {
        ...current,
        status: 'in_progress',
        execution: this.readyExecution(now, reason, current.timeouts),
        updatedAt: now,
      }
      this.replace(updated)
      this.emit({ action: 'signaled', task: updated })
      return snapshot(updated)
    }
    if (waiting.decision === 'blocked') {
      const updated: FleetProjectTask = {
        ...current,
        status: 'blocked',
        execution: { kind: 'blocked', since: now, reason: `Approved by Vote ${result.id}: ${waiting.statement}` },
        updatedAt: now,
      }
      this.replace(updated)
      this.emit({ action: 'signaled', task: updated })
      return snapshot(updated)
    }
    if (current.requirement === undefined) {
      return this.completeFromVote(current, result.id, waiting.statement)
    }
    const updated: FleetProjectTask = {
      ...current,
      status: 'in_progress',
      execution: this.readyExecution(
        now,
        `Vote ${result.id} approved completion. Send the required final reply and complete the task.`,
        current.timeouts,
        { voteId: result.id, decision: 'complete' },
      ),
      updatedAt: now,
    }
    this.replace(updated)
    this.emit({ action: 'signaled', task: updated })
    return snapshot(updated)
  }

  releaseRunning(reference: string, reason: string): FleetProjectTask[] {
    const actor = this.resolve(reference)
    const now = new Date().toISOString()
    const released: FleetProjectTask[] = []
    for (const current of [...this.tasks.values()]) {
      if (current.execution.kind !== 'running' || current.execution.actor !== actor) continue
      const updated: FleetProjectTask = {
        ...current,
        status: 'in_progress',
        execution: this.readyExecution(
          now,
          `Attempt ${current.execution.attemptId} ended without settlement: ${requiredText(reason, 'reconciliation reason')}`,
          current.timeouts,
          current.execution.approval,
          true,
        ),
        updatedAt: now,
      }
      this.replace(updated)
      this.emit({ action: 'settled', task: updated, actor })
      released.push(snapshot(updated))
    }
    return released
  }

  update(callerId: string, id: string, input: UpdateFleetProjectTaskInput): FleetProjectTask {
    const current = this.requireTask(id)
    this.requireResponsible(callerId, current)
    if (Object.values(input).every(value => value === undefined)) throw new Error('task update requires a change')
    if (current.requirement !== undefined && input.status === 'cancelled') {
      throw new Error(`required Fleet task ${id} must be completed and cannot be cancelled`)
    }
    if (current.requirement !== undefined && input.assignees !== undefined) {
      const assignees = this.resolveMany(input.assignees)
      if (assignees.length !== 1 || assignees[0] !== current.requirement.assignee) {
        throw new Error(`required Fleet task ${id} cannot be reassigned`)
      }
    }
    const decision = input.decision ?? current.decision
    if (input.status === 'blocked' && decision === 'vote') {
      throw new Error(`Fleet task ${id} requires a Vote before it can be blocked`)
    }
    const dependencies = input.dependencies === undefined ? undefined : this.taskReferences(input.dependencies, id)
    const now = new Date().toISOString()
    const timeouts = input.timeouts === undefined
      ? current.timeouts
      : this.timeoutPolicy({ ...current.timeouts, ...input.timeouts })
    let updated: FleetProjectTask = {
      ...current,
      ...(input.title === undefined ? {} : { title: requiredText(input.title, 'task title') }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      decision,
      timeouts,
      ...(input.timeouts === undefined ? {} : { execution: this.retimeExecution(current.execution, now, timeouts) }),
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
    if (input.status === 'cancelled') {
      const { duePendingFor: _duePendingFor, ...withoutPending } = updated
      updated = {
        ...withoutPending,
        execution: { kind: 'cancelled', cancelledAt: now, reason: 'Task cancelled by a responsible member.' },
      }
    } else if (input.status === 'blocked') {
      updated = {
        ...updated,
        execution: { kind: 'blocked', since: now, reason: 'Task marked blocked by a responsible member.' },
      }
    } else if (input.status !== undefined
      && (current.execution.kind === 'blocked' || current.execution.kind === 'completed' || current.execution.kind === 'cancelled')) {
      updated = { ...updated, execution: this.readyExecution(now, 'Task returned to runnable state.', timeouts) }
    }
    this.replace(updated)
    this.emit({ action: 'updated', task: updated, actor: this.member(callerId) })
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
    const member = this.member(callerId)
    if (current.execution.kind === 'running') {
      if (current.execution.actor !== member) {
        throw new Error(`Fleet task ${id} attempt belongs to ${current.execution.actor}, not ${member}`)
      }
      if (input.attemptId !== current.execution.attemptId) {
        throw new Error(`Fleet task ${id} attempt ${input.attemptId} is no longer current`)
      }
    }
    const approval = current.execution.kind === 'ready' || current.execution.kind === 'running'
      ? current.execution.approval
      : undefined
    return this.completeCurrent(
      callerId,
      current,
      current.entries.at(-1)?.text ?? current.title,
      input.finalReply,
      approval,
    )
  }

  private completeCurrent(
    callerId: string,
    current: FleetProjectTask,
    result: string,
    finalReply: string | undefined,
    approval: FleetTaskVoteApproval | undefined,
  ): FleetProjectTask {
    const incomplete = current.dependencies.filter(dependency => this.requireTask(dependency).status !== 'completed')
    if (incomplete.length > 0) throw new Error(`Fleet task ${current.id} has incomplete dependencies: ${incomplete.join(', ')}`)
    if (current.status === 'completed') {
      throw new Error(`Fleet task ${current.id} is already completed; completing it again does not complete another task`)
    }
    if (current.decision === 'vote' && approval?.decision !== 'complete') {
      throw new Error(`Fleet task ${current.id} requires an approved completion Vote`)
    }
    let completionMessageId: string | undefined
    if (current.requirement?.kind === 'message') {
      const reply = requiredText(finalReply ?? '', 'required task final reply')
      completionMessageId = this.onRequirementComplete(callerId, snapshot(current), reply)?.messageId
    }
    const now = new Date().toISOString()
    const { duePendingFor: _duePendingFor, ...rest } = current
    const updated: FleetProjectTask = {
      ...rest,
      status: 'completed',
      completedAt: now,
      updatedAt: now,
      execution: { kind: 'completed', completedAt: now, result: requiredText(result, 'task completion result') },
      ...(rest.requirement === undefined || completionMessageId === undefined
        ? {}
        : { requirement: { ...rest.requirement, completionMessageId } }),
    }
    this.replace(updated)
    this.emit({ action: 'completed', task: updated, actor: this.member(callerId) })
    return snapshot(updated)
  }

  canCompleteRequirement(callerId: string, id: string): boolean {
    const current = this.requireTask(id)
    const member = this.member(callerId)
    return current.requirement?.kind === 'message'
      && current.requirement.assignee === member
      && current.assignees.includes(member)
  }

  reopen(callerId: string, id: string): FleetProjectTask {
    const current = this.requireTask(id)
    this.requireResponsible(callerId, current)
    const { completedAt: _completedAt, ...rest } = current
    const now = new Date().toISOString()
    const updated: FleetProjectTask = {
      ...rest,
      status: 'open',
      execution: this.readyExecution(now, 'Task reopened.', current.timeouts),
      updatedAt: now,
    }
    this.replace(updated)
    this.emit({ action: 'reopened', task: updated, actor: this.member(callerId) })
    return snapshot(updated)
  }

  retireMember(member: string, successor: string): void {
    for (const task of [...this.tasks.values()]) {
      if (task.status === 'completed' || task.status === 'cancelled') continue
      const wasAssignee = task.assignees.includes(member)
      const wasReviewer = task.reviewers.includes(member)
      if (task.createdBy !== member && !wasAssignee && !wasReviewer && !task.followers.includes(member)) continue
      const assignees = task.assignees.filter(value => value !== member)
      if (wasAssignee && assignees.length === 0) assignees.push(successor)
      const reviewers = task.reviewers.filter(value => value !== member)
      if (wasReviewer && reviewers.length === 0) reviewers.push(successor)
      const updated: FleetProjectTask = {
        ...task,
        createdBy: task.createdBy === member ? successor : task.createdBy,
        assignees: unique(assignees),
        reviewers: unique(reviewers),
        followers: task.followers.filter(value => value !== member),
        ...(task.duePendingFor === undefined ? {} : {
          duePendingFor: unique(task.duePendingFor.map(value => value === member ? successor : value)),
        }),
        ...(task.requirement?.assignee === member
          ? { requirement: { ...task.requirement, assignee: successor } }
          : {}),
        ...(task.execution.kind === 'running' && task.execution.actor === member
          ? { execution: this.readyExecution(new Date().toISOString(), `Previous attempt owner ${member} retired.`, task.timeouts, task.execution.approval) }
          : task.execution.kind === 'waiting_vote' && task.execution.initiator === member
            ? { execution: { ...task.execution, initiator: successor } }
          : {}),
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

  private waitForVote(
    callerId: string,
    current: FleetProjectTask,
    next: Extract<FleetTaskSettlement, { readonly kind: 'vote' }>,
  ): FleetProjectTask {
    if (current.execution.kind !== 'running') throw new Error(`Fleet task ${current.id} is not running`)
    const now = new Date().toISOString()
    const timeoutAt = next.timeoutAt === undefined
      ? this.deadline(now, current.timeouts.eventSeconds)
      : this.date(next.timeoutAt, 'task Vote timeoutAt')
    const actor = current.execution.actor
    const voters = next.voters === undefined
      ? current.reviewers.filter(member => member !== actor)
      : this.resolveMany(next.voters).filter(member => member !== actor)
    const execution: FleetTaskExecution = {
      kind: 'waiting_vote',
      since: now,
      voteId: `task_vote_${current.id}_${current.execution.attemptId}`,
      initiator: actor,
      channel: next.channel,
      decision: next.decision,
      statement: requiredText(next.statement, 'task Vote statement'),
      ...(voters.length === 0 ? {} : { voters }),
      ...(timeoutAt === undefined ? {} : { timeoutAt }),
    }
    const updated: FleetProjectTask = { ...current, status: 'in_progress', execution, updatedAt: now }
    this.replace(updated)
    this.emit({ action: 'settled', task: updated, actor: this.member(callerId) })
    this.ensureVote(updated)
    return snapshot(this.requireTask(updated.id))
  }

  private ensureVote(task: FleetProjectTask): void {
    if (task.execution.kind !== 'waiting_vote') return
    const execution = task.execution
    const callerId = this.agentIdFor(execution.initiator)
    if (callerId === undefined) return
    try {
      const result = this.onVoteRequest(callerId, snapshot(task), {
        id: execution.voteId,
        channel: execution.channel,
        kind: execution.decision === 'complete' ? 'finish' : 'blocked',
        statement: `[Task ${task.id}] ${execution.statement}`,
        ...(execution.voters === undefined ? {} : { voters: execution.voters }),
      })
      this.resolveVote(result)
    } catch (error) {
      const current = this.tasks.get(task.id)
      if (current?.execution.kind !== 'waiting_vote' || current.execution.voteId !== execution.voteId) return
      const now = new Date().toISOString()
      const message = error instanceof Error ? error.message : String(error)
      const updated: FleetProjectTask = {
        ...current,
        status: 'in_progress',
        execution: this.readyExecution(now, `Vote ${execution.voteId} could not be opened: ${message}`, current.timeouts, undefined, true),
        updatedAt: now,
      }
      this.replace(updated)
      this.emit({ action: 'timed_out', task: updated })
    }
  }

  private completeFromVote(current: FleetProjectTask, voteId: string, result: string): FleetProjectTask {
    const now = new Date().toISOString()
    const { duePendingFor: _duePendingFor, ...rest } = current
    const updated: FleetProjectTask = {
      ...rest,
      status: 'completed',
      completedAt: now,
      updatedAt: now,
      execution: { kind: 'completed', completedAt: now, result: `Approved by Vote ${voteId}: ${result}` },
    }
    this.replace(updated)
    this.emit({ action: 'completed', task: updated })
    return snapshot(updated)
  }

  private triggerDue(id: string): void {
    const current = this.tasks.get(id)
    if (current === undefined || current.dueAt === undefined || current.dueNotifiedAt !== undefined) return
    if (current.status === 'completed' || current.status === 'cancelled') return
    const now = new Date().toISOString()
    const duePendingFor = unique([...current.assignees, ...current.reviewers])
    const updated = { ...current, dueNotifiedAt: now, duePendingFor, updatedAt: now }
    this.tasks.set(id, updated)
    this.emit({ action: 'due', task: updated })
    this.deliverDue(updated, duePendingFor)
  }

  private deliverDue(task: FleetProjectTask, recipients: readonly string[]): void {
    const delivered = new Set(this.onDue(snapshot(task), recipients) ?? [])
    if (delivered.size === 0) return
    const current = this.tasks.get(task.id)
    if (current === undefined || current.duePendingFor === undefined) return
    const duePendingFor = current.duePendingFor.filter(member => !delivered.has(member))
    if (duePendingFor.length === current.duePendingFor.length) return
    const updated = { ...current, duePendingFor, updatedAt: new Date().toISOString() }
    this.tasks.set(task.id, updated)
    this.emit({ action: 'notification', task: updated })
  }

  private arm(task: FleetProjectTask): void {
    this.armDue(task)
    this.armExecution(task)
  }

  private armDue(task: FleetProjectTask): void {
    const existing = this.dueTimers.get(task.id)
    if (existing !== undefined) clearTimeout(existing)
    this.dueTimers.delete(task.id)
    if (!this.active || task.dueAt === undefined || task.dueNotifiedAt !== undefined
      || task.status === 'completed' || task.status === 'cancelled') return
    const delay = Math.max(0, new Date(task.dueAt).getTime() - Date.now())
    const timer = setTimeout(() => {
      this.dueTimers.delete(task.id)
      const remaining = new Date(task.dueAt as string).getTime() - Date.now()
      if (remaining > 0) this.arm(task)
      else this.triggerDue(task.id)
    }, Math.min(delay, 2_147_483_647))
    timer.unref?.()
    this.dueTimers.set(task.id, timer)
  }

  private armExecution(task: FleetProjectTask): void {
    const existing = this.executionTimers.get(task.id)
    if (existing !== undefined) clearTimeout(existing)
    this.executionTimers.delete(task.id)
    if (!this.active) return
    const at = task.execution.kind === 'waiting_time'
      ? task.execution.wakeAt
      : task.execution.kind === 'ready'
        || task.execution.kind === 'running'
        || task.execution.kind === 'waiting_event'
        || task.execution.kind === 'waiting_vote'
        ? task.execution.timeoutAt
        : undefined
    if (at === undefined) return
    const delay = Math.max(0, new Date(at).getTime() - Date.now())
    const timer = setTimeout(() => {
      this.executionTimers.delete(task.id)
      const current = this.tasks.get(task.id)
      if (current === undefined) return
      const currentAt = current.execution.kind === 'waiting_time'
        ? current.execution.wakeAt
        : current.execution.kind === 'ready'
          || current.execution.kind === 'running'
          || current.execution.kind === 'waiting_event'
          || current.execution.kind === 'waiting_vote'
          ? current.execution.timeoutAt
          : undefined
      if (currentAt !== at) return
      const remaining = new Date(at).getTime() - Date.now()
      if (remaining > 0) this.armExecution(current)
      else this.triggerExecution(current)
    }, Math.min(delay, 2_147_483_647))
    timer.unref?.()
    this.executionTimers.set(task.id, timer)
  }

  private triggerExecution(current: FleetProjectTask): void {
    const execution = current.execution
    if (execution.kind === 'completed' || execution.kind === 'cancelled' || execution.kind === 'blocked') return
    const now = new Date().toISOString()
    const approval = execution.kind === 'ready' || execution.kind === 'running' ? execution.approval : undefined
    const reason = execution.kind === 'waiting_time'
      ? `Scheduled continuation became ready at ${execution.wakeAt}.`
      : `${execution.kind} timed out; reconcile the previous continuation before doing more work.`
    const updated: FleetProjectTask = {
      ...current,
      status: 'in_progress',
      execution: this.readyExecution(now, reason, current.timeouts, approval, execution.kind !== 'waiting_time'),
      updatedAt: now,
    }
    this.replace(updated)
    this.emit({ action: execution.kind === 'waiting_time' ? 'signaled' : 'timed_out', task: updated })
  }

  private replace(task: FleetProjectTask): void {
    this.tasks.set(task.id, task)
    this.arm(task)
  }

  private emit(event: FleetProjectTaskEvent): void {
    const value = snapshot(event)
    for (const listener of [...this.listeners]) listener(value)
  }

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

  private resolveMany(values: readonly string[]): string[] {
    return unique(values.map(value => this.resolve(value)))
  }

  private resolveOptionalMember(reference: string, except: string): string[] {
    const member = this.directory.resolve(reference)
    return member === undefined || member === except ? [] : [member]
  }

  private agentIdFor(member: string): string | undefined {
    return this.directory.list().find(candidate => candidate.name === member)?.id
  }

  private timeoutPolicy(input: FleetTaskTimeouts): FleetTaskTimeouts {
    const validate = (value: number | undefined, label: string): number | undefined => {
      if (value === undefined) return undefined
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`)
      return value
    }
    const readySeconds = validate(input.readySeconds, 'task ready timeout seconds')
    const runningSeconds = validate(input.runningSeconds, 'task running timeout seconds')
    const eventSeconds = validate(input.eventSeconds, 'task event timeout seconds')
    return {
      ...(readySeconds === undefined ? {} : { readySeconds }),
      ...(runningSeconds === undefined ? {} : { runningSeconds }),
      ...(eventSeconds === undefined ? {} : { eventSeconds }),
    }
  }

  private deadline(now: string, seconds: number | undefined): string | undefined {
    return seconds === undefined ? undefined : new Date(new Date(now).getTime() + seconds * 1_000).toISOString()
  }

  private readyExecution(
    now: string,
    reason: string,
    timeouts: FleetTaskTimeouts,
    approval?: FleetTaskVoteApproval,
    reconcile = false,
  ): Extract<FleetTaskExecution, { readonly kind: 'ready' }> {
    const timeoutAt = this.deadline(now, timeouts.readySeconds)
    return {
      kind: 'ready',
      since: now,
      reason: requiredText(reason, 'task ready reason'),
      reconcile,
      ...(timeoutAt === undefined ? {} : { timeoutAt }),
      ...(approval === undefined ? {} : { approval }),
    }
  }

  private retimeExecution(execution: FleetTaskExecution, now: string, timeouts: FleetTaskTimeouts): FleetTaskExecution {
    const timeoutAt = execution.kind === 'ready'
      ? this.deadline(now, timeouts.readySeconds)
      : execution.kind === 'running'
        ? this.deadline(now, timeouts.runningSeconds)
        : execution.kind === 'waiting_event' || execution.kind === 'waiting_vote'
          ? this.deadline(now, timeouts.eventSeconds)
          : undefined
    if (execution.kind !== 'ready'
      && execution.kind !== 'running'
      && execution.kind !== 'waiting_event'
      && execution.kind !== 'waiting_vote') return execution
    const { timeoutAt: _timeoutAt, ...rest } = execution
    return { ...rest, ...(timeoutAt === undefined ? {} : { timeoutAt }) } as FleetTaskExecution
  }

  private strings(values: readonly string[], label: string): string[] {
    return unique(values.map(value => requiredText(value, label)))
  }

  private taskReferences(values: readonly string[], ownId?: string): string[] {
    const references = this.strings(values, 'task dependency')
    for (const id of references) {
      if (id === ownId) throw new Error('a Fleet task cannot depend on itself')
      this.requireTask(id)
      if (ownId !== undefined && this.dependsOn(id, ownId, new Set())) {
        throw new Error(`Fleet task dependency ${id} would create a cycle`)
      }
    }
    return references
  }

  private dependsOn(taskId: string, targetId: string, visited: Set<string>): boolean {
    if (taskId === targetId) return true
    if (visited.has(taskId)) return false
    visited.add(taskId)
    return this.requireTask(taskId).dependencies.some(dependency => this.dependsOn(dependency, targetId, visited))
  }

  private date(value: string, label: string): string {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be an ISO date-time`)
    return date.toISOString()
  }

  private requireTask(id: string): FleetProjectTask {
    const task = this.tasks.get(id)
    if (task === undefined) throw new Error(`unknown Fleet task ${id}`)
    return task
  }

  private requireResponsible(agentId: string, task: FleetProjectTask): void {
    const name = this.member(agentId)
    if (name !== task.createdBy && !task.assignees.includes(name) && !this.canManage(agentId)) {
      throw new Error(`Fleet member ${name} cannot manage task ${task.id}`)
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Fleet Task service is stopped')
  }
}

const ENTRY_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, kind: { type: 'string', required: true, enum: ['comment', 'progress'] },
    author: { type: 'string', required: true }, text: { type: 'string', required: true },
    resources: { type: 'array', required: true, items: { type: 'string' } }, createdAt: { type: 'string', required: true },
  },
} as const

const TASK_SIGNAL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    eventKey: { type: 'string', required: true }, result: { type: 'string', required: true }, signaledAt: { type: 'string', required: true },
  },
} as const

const TASK_TIMEOUTS_SCHEMA = {
  type: 'object', additionalProperties: false, required: true, properties: {
    readySeconds: { type: 'integer' }, runningSeconds: { type: 'integer' }, eventSeconds: { type: 'integer' },
  },
} as const

const TASK_APPROVAL_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    voteId: { type: 'string', required: true }, decision: { type: 'string', required: true, enum: ['complete'] },
  },
} as const

const TASK_EXECUTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: true, properties: {
    kind: { type: 'string', required: true, enum: ['ready', 'running', 'waiting_time', 'waiting_event', 'waiting_vote', 'blocked', 'completed', 'cancelled'] },
    since: { type: 'string' }, reason: { type: 'string' }, reconcile: { type: 'boolean' }, timeoutAt: { type: 'string' }, approval: TASK_APPROVAL_SCHEMA,
    attemptId: { type: 'string' }, actor: { type: 'string' }, startedAt: { type: 'string' }, wakeAt: { type: 'string' },
    eventKey: { type: 'string' }, voteId: { type: 'string' }, initiator: { type: 'string' }, channel: { type: 'string' },
    decision: { type: 'string', enum: ['complete', 'blocked'] }, statement: { type: 'string' }, voters: { type: 'array', items: { type: 'string' } },
    completedAt: { type: 'string' }, result: { type: 'string' }, cancelledAt: { type: 'string' },
  },
} as const

const TASK_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, title: { type: 'string', required: true }, description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['open', 'in_progress', 'blocked', 'completed', 'cancelled'] },
    priority: { type: 'string', required: true, enum: ['low', 'normal', 'high'] }, createdBy: { type: 'string', required: true },
    decision: { type: 'string', required: true, enum: ['direct', 'vote'] }, timeouts: TASK_TIMEOUTS_SCHEMA, execution: TASK_EXECUTION_SCHEMA,
    assignees: { type: 'array', required: true, items: { type: 'string' } }, reviewers: { type: 'array', required: true, items: { type: 'string' } },
    followers: { type: 'array', required: true, items: { type: 'string' } }, dependencies: { type: 'array', required: true, items: { type: 'string' } },
    parentId: { type: 'string' }, dueAt: { type: 'string' }, resources: { type: 'array', required: true, items: { type: 'string' } },
    entries: { type: 'array', required: true, items: ENTRY_SCHEMA }, signals: { type: 'array', required: true, items: TASK_SIGNAL_SCHEMA },
    createdAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
    completedAt: { type: 'string' }, dueNotifiedAt: { type: 'string' },
    duePendingFor: { type: 'array', items: { type: 'string' } },
    requirement: {
      type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', required: true, enum: ['message'] },
        messageId: { type: 'string', required: true }, conversation: { type: 'string', required: true },
        assignee: { type: 'string', required: true }, replyTarget: { type: 'string' }, completionMessageId: { type: 'string' },
      },
    },
  },
} as const

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'update', 'comment', 'progress', 'claim', 'settle', 'complete', 'reopen'] },
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

export function installTaskTools(
  ctx: Context,
  tasks: FleetTaskBoard,
  authorize: (agentId: string, action: string) => boolean,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_task',
    description: 'Manage durable Team tasks and their continuation state. A claimed Task provides an attempt id. Before ending that turn, settle the attempt to ready, a time, an event, a Vote, blocked, completed, or cancelled; Fleet persists the successor before retiring the attempt. Parsed message mentions and must_reply directives remain required until explicitly completed.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'update', 'comment', 'progress', 'claim', 'settle', 'complete', 'reopen'] },
      id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
      status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'completed', 'cancelled'] }, priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      decision: { type: 'string', enum: ['direct', 'vote'], description: 'Whether completion/blocking may be decided directly or requires an approved Fleet Vote.' },
      ready_timeout_seconds: { type: 'integer' }, running_timeout_seconds: { type: 'integer' }, event_timeout_seconds: { type: 'integer' },
      assignees: { type: 'array', items: { type: 'string' } }, reviewers: { type: 'array', items: { type: 'string' } },
      followers: { type: 'array', items: { type: 'string' } }, dependencies: { type: 'array', items: { type: 'string' } },
      parent_id: { type: 'string' }, due_at: { type: 'string' }, resources: { type: 'array', items: { type: 'string' } }, text: { type: 'string' },
      attempt_id: { type: 'string', description: 'Current attempt id supplied by Fleet when the Task was claimed.' },
      next: { type: 'string', enum: ['ready', 'waiting_time', 'waiting_event', 'vote', 'blocked', 'completed', 'cancelled'] },
      wake_at: { type: 'string' }, event_key: { type: 'string' }, timeout_at: { type: 'string' },
      vote_decision: { type: 'string', enum: ['complete', 'blocked'] }, vote_channel: { type: 'string' }, statement: { type: 'string' }, voters: { type: 'array', items: { type: 'string' } },
      reason: { type: 'string' }, result: { type: 'string' },
      final_reply: { type: 'string', description: 'Required when completing a message-created task as the Agent confirmation of the result. If a reply already exists in the source conversation, Fleet reuses it without sending a duplicate; otherwise Fleet sends final_reply there.' },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = caller(exec.agent)
      const callerId = String(agent.id)
      const action = args.action === 'list' || args.action === 'get' ? 'task.read'
        : args.action === 'create' ? 'task.create'
          : args.action === 'comment' ? 'task.comment'
            : args.action === 'progress' || args.action === 'claim' ? 'task.progress' : 'task.update'
      const canCompleteOwnRequirement = (args.action === 'complete'
        || (args.action === 'settle' && args.next === 'completed'))
        && args.id !== undefined
        && tasks.canCompleteRequirement(callerId, args.id)
      if (!canCompleteOwnRequirement && !authorize(callerId, action) && !authorize(callerId, 'task.manage')) {
        throw new Error(`Agent ${callerId} is not authorized for ${action}`)
      }
      if (args.action === 'list') return Promise.resolve({ action: 'list' as const, tasks: tasks.list(callerId, {
        ...(args.status === undefined ? {} : { status: args.status }), ...(args.assignees?.[0] === undefined ? {} : { assignee: args.assignees[0] }),
        ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }),
      }) })
      if (args.action === 'create') {
        if (args.title === undefined) throw new Error('fleet_task create requires title')
        return Promise.resolve({ action: 'create' as const, task: tasks.create(callerId, {
          title: args.title, ...(args.description === undefined ? {} : { description: args.description }), ...(args.priority === undefined ? {} : { priority: args.priority }),
          ...(args.decision === undefined ? {} : { decision: args.decision }),
          ...((args.ready_timeout_seconds === undefined && args.running_timeout_seconds === undefined && args.event_timeout_seconds === undefined) ? {} : { timeouts: {
            ...(args.ready_timeout_seconds === undefined ? {} : { readySeconds: args.ready_timeout_seconds }),
            ...(args.running_timeout_seconds === undefined ? {} : { runningSeconds: args.running_timeout_seconds }),
            ...(args.event_timeout_seconds === undefined ? {} : { eventSeconds: args.event_timeout_seconds }),
          } }),
          ...(args.assignees === undefined ? {} : { assignees: args.assignees }), ...(args.reviewers === undefined ? {} : { reviewers: args.reviewers }),
          ...(args.followers === undefined ? {} : { followers: args.followers }), ...(args.dependencies === undefined ? {} : { dependencies: args.dependencies }),
          ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }), ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
          ...(args.resources === undefined ? {} : { resources: args.resources }),
        }) })
      }
      if (args.id === undefined) throw new Error(`fleet_task ${args.action} requires id`)
      if (args.action === 'get') return Promise.resolve({ action: 'get' as const, task: tasks.get(callerId, args.id) })
      if (args.action === 'claim') return Promise.resolve({ action: 'claim' as const, task: tasks.claim(callerId, args.id) })
      if (args.action === 'update') {
        if (args.status === 'completed') throw new Error('use fleet_task complete to complete a task')
        return Promise.resolve({ action: 'update' as const, task: tasks.update(callerId, args.id, {
        ...(args.title === undefined ? {} : { title: args.title }), ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.status === undefined ? {} : { status: args.status }), ...(args.priority === undefined ? {} : { priority: args.priority }),
        ...(args.decision === undefined ? {} : { decision: args.decision }),
        ...((args.ready_timeout_seconds === undefined && args.running_timeout_seconds === undefined && args.event_timeout_seconds === undefined) ? {} : { timeouts: {
          ...(args.ready_timeout_seconds === undefined ? {} : { readySeconds: args.ready_timeout_seconds }),
          ...(args.running_timeout_seconds === undefined ? {} : { runningSeconds: args.running_timeout_seconds }),
          ...(args.event_timeout_seconds === undefined ? {} : { eventSeconds: args.event_timeout_seconds }),
        } }),
        ...(args.assignees === undefined ? {} : { assignees: args.assignees }), ...(args.reviewers === undefined ? {} : { reviewers: args.reviewers }),
        ...(args.followers === undefined ? {} : { followers: args.followers }), ...(args.dependencies === undefined ? {} : { dependencies: args.dependencies }),
        ...(args.due_at === undefined ? {} : { dueAt: args.due_at }), ...(args.resources === undefined ? {} : { resources: args.resources }),
        }) })
      }
      if (args.action === 'comment' || args.action === 'progress') {
        if (args.text === undefined) throw new Error(`fleet_task ${args.action} requires text`)
        return Promise.resolve({ action: args.action, task: tasks.addEntry(callerId, args.id, args.action, args.text, args.resources) })
      }
      if (args.action === 'settle') {
        if (args.attempt_id === undefined || args.text === undefined || args.next === undefined) {
          throw new Error('fleet_task settle requires attempt_id, text progress, and next')
        }
        let next: FleetTaskSettlement
        if (args.next === 'ready') next = { kind: 'ready', ...(args.reason === undefined ? {} : { reason: args.reason }) }
        else if (args.next === 'waiting_time') {
          if (args.wake_at === undefined) throw new Error('fleet_task settle waiting_time requires wake_at')
          next = { kind: 'waiting_time', wakeAt: args.wake_at }
        } else if (args.next === 'waiting_event') {
          if (args.event_key === undefined) throw new Error('fleet_task settle waiting_event requires event_key')
          next = { kind: 'waiting_event', eventKey: args.event_key, ...(args.timeout_at === undefined ? {} : { timeoutAt: args.timeout_at }) }
        } else if (args.next === 'vote') {
          if (args.vote_decision === undefined || args.vote_channel === undefined || args.statement === undefined) {
            throw new Error('fleet_task settle vote requires vote_decision, vote_channel, and statement')
          }
          if (!args.vote_channel.startsWith('#')) throw new Error('fleet_task vote_channel must start with #')
          next = {
            kind: 'vote', decision: args.vote_decision, channel: args.vote_channel as `#${string}`, statement: args.statement,
            ...(args.voters === undefined ? {} : { voters: args.voters }), ...(args.timeout_at === undefined ? {} : { timeoutAt: args.timeout_at }),
          }
        } else if (args.next === 'blocked') {
          if (args.reason === undefined) throw new Error('fleet_task settle blocked requires reason')
          next = { kind: 'blocked', reason: args.reason }
        } else if (args.next === 'completed') {
          if (args.result === undefined) throw new Error('fleet_task settle completed requires result')
          next = { kind: 'completed', result: args.result, ...(args.final_reply === undefined ? {} : { finalReply: args.final_reply }) }
        } else {
          if (args.reason === undefined) throw new Error('fleet_task settle cancelled requires reason')
          next = { kind: 'cancelled', reason: args.reason }
        }
        return Promise.resolve({
          action: 'settle' as const,
          task: tasks.settle(callerId, args.id, { attemptId: args.attempt_id, progress: args.text, next }),
        })
      }
      return Promise.resolve({
        action: args.action,
        task: args.action === 'complete'
          ? tasks.complete(callerId, args.id, {
            ...(args.final_reply === undefined ? {} : { finalReply: args.final_reply }),
            ...(args.attempt_id === undefined ? {} : { attemptId: args.attempt_id }),
          })
          : tasks.reopen(callerId, args.id),
      })
    },
  }))
}
