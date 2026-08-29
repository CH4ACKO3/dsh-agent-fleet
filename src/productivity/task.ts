import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, JsonValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'

export const FLEET_TASK_STATE_NAMESPACE = 'productivity-tasks'

export type FleetProjectTaskStatus = 'open' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'
export type FleetProjectTaskPriority = 'low' | 'normal' | 'high'

export interface FleetTaskEntry {
  readonly id: string
  readonly kind: 'comment' | 'progress'
  readonly author: string
  readonly text: string
  readonly resources: string[]
  readonly createdAt: string
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
  readonly createdBy: string
  readonly assignees: string[]
  readonly reviewers: string[]
  readonly followers: string[]
  readonly dependencies: string[]
  readonly parentId?: string
  readonly dueAt?: string
  readonly resources: string[]
  readonly entries: FleetTaskEntry[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly completedAt?: string
  readonly dueNotifiedAt?: string
  readonly duePendingFor?: string[]
  /** A durable obligation created from a must-reply message or parsed @mention. */
  readonly requirement?: FleetTaskRequirement
}

export interface FleetTaskState {
  readonly version: 1
  readonly tasks: readonly FleetProjectTask[]
}

export interface FleetProjectTaskEvent {
  readonly action: 'created' | 'updated' | 'commented' | 'progressed' | 'completed' | 'reopened' | 'due' | 'notification'
  readonly task: FleetProjectTask
  readonly actor?: string
}

export interface CreateFleetProjectTaskInput {
  readonly title: string
  readonly description?: string
  readonly priority?: FleetProjectTaskPriority
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
}

export interface FleetTaskRequirementCompletion {
  readonly messageId?: string
}

const EMPTY_STATE: FleetTaskState = { version: 1, tasks: [] }

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

export function parseFleetTaskState(value: JsonValue | undefined): FleetTaskState {
  if (value === undefined) return snapshot(EMPTY_STATE)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Fleet Task state must be an object')
  }
  const input = value as Record<string, JsonValue>
  if (input.version !== 1 || !Array.isArray(input.tasks)) {
    throw new Error('Fleet Task state must contain version 1 tasks')
  }
  return snapshot(value) as unknown as FleetTaskState
}

export class FleetTaskBoard {
  private readonly tasks = new Map<string, FleetProjectTask>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
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
  ) {}

  state(): FleetTaskState {
    return { version: 1, tasks: [...this.tasks.values()].map(snapshot) }
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
    for (const task of this.tasks.values()) this.arm(task)
  }

  pause(): void {
    this.active = false
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
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
    const task: FleetProjectTask = {
      id: `task_${randomUUID()}`,
      title: requiredText(input.title, 'task title'),
      description: input.description?.trim() ?? '',
      status: 'open',
      priority: input.priority ?? 'normal',
      createdBy,
      assignees: this.resolveMany(input.assignees ?? [createdBy]),
      reviewers: this.resolveMany(input.reviewers ?? []),
      followers: this.resolveMany(input.followers ?? []),
      dependencies,
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      ...(input.dueAt === undefined ? {} : { dueAt: this.date(input.dueAt, 'task dueAt') }),
      resources: this.strings(input.resources ?? [], 'resource id'),
      entries: [],
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
      createdBy,
      assignees: [assignee],
      reviewers: [],
      followers: this.resolveOptionalMember(createdBy, assignee),
      dependencies: [],
      resources: this.strings(input.resources ?? [], 'resource id'),
      entries: [],
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
    const dependencies = input.dependencies === undefined ? undefined : this.taskReferences(input.dependencies, id)
    let updated: FleetProjectTask = {
      ...current,
      ...(input.title === undefined ? {} : { title: requiredText(input.title, 'task title') }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.assignees === undefined ? {} : { assignees: this.resolveMany(input.assignees) }),
      ...(input.reviewers === undefined ? {} : { reviewers: this.resolveMany(input.reviewers) }),
      ...(input.followers === undefined ? {} : { followers: this.resolveMany(input.followers) }),
      ...(dependencies === undefined ? {} : { dependencies }),
      ...(input.dueAt === undefined ? {} : { dueAt: this.date(input.dueAt, 'task dueAt') }),
      ...(input.resources === undefined ? {} : { resources: this.strings(input.resources, 'resource id') }),
      updatedAt: new Date().toISOString(),
    }
    if (input.dueAt !== undefined) {
      const { dueNotifiedAt: _dueNotifiedAt, duePendingFor: _duePendingFor, ...withoutNotification } = updated
      updated = withoutNotification
    }
    if (input.status === 'cancelled') {
      const { duePendingFor: _duePendingFor, ...withoutPending } = updated
      updated = withoutPending
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
    const incomplete = current.dependencies.filter(dependency => this.requireTask(dependency).status !== 'completed')
    if (incomplete.length > 0) throw new Error(`Fleet task ${id} has incomplete dependencies: ${incomplete.join(', ')}`)
    if (current.status === 'completed') {
      throw new Error(`Fleet task ${id} is already completed; completing it again does not complete another task`)
    }
    let completionMessageId: string | undefined
    if (current.requirement?.kind === 'message') {
      const finalReply = requiredText(input.finalReply ?? '', 'required task final reply')
      completionMessageId = this.onRequirementComplete(callerId, snapshot(current), finalReply)?.messageId
    }
    const now = new Date().toISOString()
    const { duePendingFor: _duePendingFor, ...rest } = current
    const updated: FleetProjectTask = {
      ...rest,
      status: 'completed',
      completedAt: now,
      updatedAt: now,
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
    const updated: FleetProjectTask = { ...rest, status: 'open', updatedAt: new Date().toISOString() }
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
    const existing = this.timers.get(task.id)
    if (existing !== undefined) clearTimeout(existing)
    this.timers.delete(task.id)
    if (!this.active || task.dueAt === undefined || task.dueNotifiedAt !== undefined
      || task.status === 'completed' || task.status === 'cancelled') return
    const delay = Math.max(0, new Date(task.dueAt).getTime() - Date.now())
    const timer = setTimeout(() => {
      this.timers.delete(task.id)
      const remaining = new Date(task.dueAt as string).getTime() - Date.now()
      if (remaining > 0) this.arm(task)
      else this.triggerDue(task.id)
    }, Math.min(delay, 2_147_483_647))
    timer.unref?.()
    this.timers.set(task.id, timer)
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

const TASK_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, title: { type: 'string', required: true }, description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['open', 'in_progress', 'blocked', 'completed', 'cancelled'] },
    priority: { type: 'string', required: true, enum: ['low', 'normal', 'high'] }, createdBy: { type: 'string', required: true },
    assignees: { type: 'array', required: true, items: { type: 'string' } }, reviewers: { type: 'array', required: true, items: { type: 'string' } },
    followers: { type: 'array', required: true, items: { type: 'string' } }, dependencies: { type: 'array', required: true, items: { type: 'string' } },
    parentId: { type: 'string' }, dueAt: { type: 'string' }, resources: { type: 'array', required: true, items: { type: 'string' } },
    entries: { type: 'array', required: true, items: ENTRY_SCHEMA }, createdAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
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
    action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'update', 'comment', 'progress', 'complete', 'reopen'] },
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
    description: 'Manage persistent Team tasks, owners, reviewers, dependencies, subtasks, comments, progress, deadlines, and resources. Parsed message mentions and must_reply directives appear as high-priority required tasks. A reply alone does not complete one: after satisfying the request, explicitly complete its exact task id. If a reply was already sent in the source conversation, completion reuses the latest reply without sending a duplicate; otherwise Fleet sends final_reply there before completion.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'update', 'comment', 'progress', 'complete', 'reopen'] },
      id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
      status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'completed', 'cancelled'] }, priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      assignees: { type: 'array', items: { type: 'string' } }, reviewers: { type: 'array', items: { type: 'string' } },
      followers: { type: 'array', items: { type: 'string' } }, dependencies: { type: 'array', items: { type: 'string' } },
      parent_id: { type: 'string' }, due_at: { type: 'string' }, resources: { type: 'array', items: { type: 'string' } }, text: { type: 'string' },
      final_reply: { type: 'string', description: 'Required when completing a message-created task as the Agent confirmation of the result. If a reply already exists in the source conversation, Fleet reuses it without sending a duplicate; otherwise Fleet sends final_reply there.' },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = caller(exec.agent)
      const callerId = String(agent.id)
      const action = args.action === 'list' || args.action === 'get' ? 'task.read'
        : args.action === 'create' ? 'task.create'
          : args.action === 'comment' ? 'task.comment'
            : args.action === 'progress' ? 'task.progress' : 'task.update'
      const canCompleteOwnRequirement = args.action === 'complete'
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
          ...(args.assignees === undefined ? {} : { assignees: args.assignees }), ...(args.reviewers === undefined ? {} : { reviewers: args.reviewers }),
          ...(args.followers === undefined ? {} : { followers: args.followers }), ...(args.dependencies === undefined ? {} : { dependencies: args.dependencies }),
          ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }), ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
          ...(args.resources === undefined ? {} : { resources: args.resources }),
        }) })
      }
      if (args.id === undefined) throw new Error(`fleet_task ${args.action} requires id`)
      if (args.action === 'get') return Promise.resolve({ action: 'get' as const, task: tasks.get(callerId, args.id) })
      if (args.action === 'update') {
        if (args.status === 'completed') throw new Error('use fleet_task complete to complete a task')
        return Promise.resolve({ action: 'update' as const, task: tasks.update(callerId, args.id, {
        ...(args.title === undefined ? {} : { title: args.title }), ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.status === undefined ? {} : { status: args.status }), ...(args.priority === undefined ? {} : { priority: args.priority }),
        ...(args.assignees === undefined ? {} : { assignees: args.assignees }), ...(args.reviewers === undefined ? {} : { reviewers: args.reviewers }),
        ...(args.followers === undefined ? {} : { followers: args.followers }), ...(args.dependencies === undefined ? {} : { dependencies: args.dependencies }),
        ...(args.due_at === undefined ? {} : { dueAt: args.due_at }), ...(args.resources === undefined ? {} : { resources: args.resources }),
        }) })
      }
      if (args.action === 'comment' || args.action === 'progress') {
        if (args.text === undefined) throw new Error(`fleet_task ${args.action} requires text`)
        return Promise.resolve({ action: args.action, task: tasks.addEntry(callerId, args.id, args.action, args.text, args.resources) })
      }
      return Promise.resolve({
        action: args.action,
        task: args.action === 'complete'
          ? tasks.complete(callerId, args.id, { ...(args.final_reply === undefined ? {} : { finalReply: args.final_reply }) })
          : tasks.reopen(callerId, args.id),
      })
    },
  }))
}
