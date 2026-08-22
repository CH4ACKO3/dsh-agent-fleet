import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

import type { FleetMemberDirectory } from './collaboration.js'

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

export interface FleetProjectTask {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly status: FleetProjectTaskStatus
  readonly priority: FleetProjectTaskPriority
  readonly createdBy: string
  readonly assignees: string[]
  readonly followers: string[]
  readonly parentId?: string
  readonly dueAt?: string
  readonly resources: string[]
  readonly entries: FleetTaskEntry[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly completedAt?: string
  readonly dueNotifiedAt?: string
}

export type FleetProjectTaskEvent = {
  readonly action: 'created' | 'updated' | 'commented' | 'progressed' | 'completed' | 'reopened' | 'due'
  readonly task: FleetProjectTask
  readonly actor?: string
}

export interface CreateFleetProjectTaskInput {
  readonly title: string
  readonly description?: string
  readonly priority?: FleetProjectTaskPriority
  readonly assignees?: readonly string[]
  readonly followers?: readonly string[]
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
  readonly followers?: readonly string[]
  readonly dueAt?: string
  readonly resources?: readonly string[]
}

function requiredText(value: string, label: string): string {
  const result = value.trim()
  if (result.length === 0) throw new Error(`${label} cannot be empty`)
  return result
}

function snapshot<T>(value: T): T {
  return structuredClone(value)
}

export class FleetTaskBoard {
  private readonly tasks = new Map<string, FleetProjectTask>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly listeners = new Set<(event: FleetProjectTaskEvent) => void>()
  private closed = false

  constructor(
    private readonly directory: FleetMemberDirectory,
    private readonly canManage: (agentId: string) => boolean = () => false,
    private readonly onDue: (task: FleetProjectTask) => void = () => {},
  ) {}

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

  validateReference(id: string, assignee?: string): void {
    const task = this.requireTask(id)
    if (assignee !== undefined && !task.assignees.includes(assignee)) {
      throw new Error(`Fleet task ${id} is not assigned to ${assignee}`)
    }
  }

  create(callerId: string, input: CreateFleetProjectTaskInput): FleetProjectTask {
    this.assertOpen()
    const createdBy = this.member(callerId)
    if (input.parentId !== undefined) this.requireTask(input.parentId)
    const now = new Date().toISOString()
    const task: FleetProjectTask = {
      id: `task_${randomUUID()}`,
      title: requiredText(input.title, 'task title'),
      description: input.description?.trim() ?? '',
      status: 'open',
      priority: input.priority ?? 'normal',
      createdBy,
      assignees: this.resolveMany(input.assignees ?? [createdBy]),
      followers: this.resolveMany(input.followers ?? []),
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

  update(callerId: string, id: string, input: UpdateFleetProjectTaskInput): FleetProjectTask {
    const current = this.requireTask(id)
    this.requireResponsible(callerId, current)
    if (Object.values(input).every(value => value === undefined)) throw new Error('task update requires a change')
    let updated: FleetProjectTask = {
      ...current,
      ...(input.title === undefined ? {} : { title: requiredText(input.title, 'task title') }),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.assignees === undefined ? {} : { assignees: this.resolveMany(input.assignees) }),
      ...(input.followers === undefined ? {} : { followers: this.resolveMany(input.followers) }),
      ...(input.dueAt === undefined ? {} : { dueAt: this.date(input.dueAt, 'task dueAt') }),
      ...(input.resources === undefined ? {} : { resources: this.strings(input.resources, 'resource id') }),
      updatedAt: new Date().toISOString(),
    }
    if (input.dueAt !== undefined) {
      const { dueNotifiedAt: _dueNotifiedAt, ...withoutNotification } = updated
      updated = withoutNotification
    }
    this.replace(updated)
    this.emit({ action: 'updated', task: updated, actor: this.member(callerId) })
    return snapshot(updated)
  }

  addEntry(
    callerId: string,
    id: string,
    kind: FleetTaskEntry['kind'],
    text: string,
    resources: readonly string[] = [],
  ): FleetProjectTask {
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

  complete(callerId: string, id: string): FleetProjectTask {
    const current = this.requireTask(id)
    this.requireResponsible(callerId, current)
    if (current.status === 'completed') return snapshot(current)
    const now = new Date().toISOString()
    const updated: FleetProjectTask = { ...current, status: 'completed', completedAt: now, updatedAt: now }
    this.replace(updated)
    this.emit({ action: 'completed', task: updated, actor: this.member(callerId) })
    return snapshot(updated)
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
      if (task.createdBy !== member && !wasAssignee && !task.followers.includes(member)) continue
      const assignees = task.assignees.filter(assignee => assignee !== member)
      if (wasAssignee && assignees.length === 0) assignees.push(successor)
      const updated: FleetProjectTask = {
        ...task,
        createdBy: task.createdBy === member ? successor : task.createdBy,
        assignees,
        followers: task.followers.filter(follower => follower !== member),
        updatedAt: new Date().toISOString(),
      }
      this.replace(updated)
      this.emit({ action: 'updated', task: updated, actor: successor })
    }
  }

  restore(events: readonly FleetProjectTaskEvent[]): void {
    this.assertOpen()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.tasks.clear()
    for (const event of events) this.tasks.set(event.task.id, snapshot(event.task))
    for (const task of this.tasks.values()) this.arm(task)
  }

  onEvent(listener: (event: FleetProjectTaskEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private triggerDue(id: string): void {
    const current = this.tasks.get(id)
    if (current === undefined || current.dueAt === undefined || current.dueNotifiedAt !== undefined) return
    if (current.status === 'completed' || current.status === 'cancelled') return
    const now = new Date().toISOString()
    const updated = { ...current, dueNotifiedAt: now, updatedAt: now }
    this.tasks.set(id, updated)
    this.emit({ action: 'due', task: updated })
    this.onDue(snapshot(updated))
  }

  private arm(task: FleetProjectTask): void {
    const existing = this.timers.get(task.id)
    if (existing !== undefined) clearTimeout(existing)
    this.timers.delete(task.id)
    if (
      task.dueAt === undefined
      || task.dueNotifiedAt !== undefined
      || task.status === 'completed'
      || task.status === 'cancelled'
    ) return
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
    return [...new Set(values.map(value => this.resolve(value)))]
  }

  private strings(values: readonly string[], label: string): string[] {
    return [...new Set(values.map(value => requiredText(value, label)))]
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
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['comment', 'progress'] },
    author: { type: 'string', required: true },
    text: { type: 'string', required: true },
    resources: { type: 'array', required: true, items: { type: 'string' } },
    createdAt: { type: 'string', required: true },
  },
} as const

const TASK_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, title: { type: 'string', required: true },
    description: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['open', 'in_progress', 'blocked', 'completed', 'cancelled'] },
    priority: { type: 'string', required: true, enum: ['low', 'normal', 'high'] },
    createdBy: { type: 'string', required: true },
    assignees: { type: 'array', required: true, items: { type: 'string' } },
    followers: { type: 'array', required: true, items: { type: 'string' } },
    parentId: { type: 'string' }, dueAt: { type: 'string' },
    resources: { type: 'array', required: true, items: { type: 'string' } },
    entries: { type: 'array', required: true, items: ENTRY_SCHEMA },
    createdAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
    completedAt: { type: 'string' }, dueNotifiedAt: { type: 'string' },
  },
} as const

const TASK_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'update', 'comment', 'progress', 'complete', 'reopen'] },
    task: TASK_SCHEMA, tasks: { type: 'array', items: TASK_SCHEMA },
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

function caller(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('fleet_task requires a calling Agent')
  return agent
}

export function installTaskTools(ctx: Context, tasks: FleetTaskBoard): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_task',
    description: 'Manage persistent Team project tasks, assignees, followers, subtasks, comments, progress, deadlines, and resource references.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'update', 'comment', 'progress', 'complete', 'reopen'] },
      id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
      status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'cancelled'] },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      assignees: { type: 'array', items: { type: 'string' } },
      followers: { type: 'array', items: { type: 'string' } },
      parent_id: { type: 'string' }, due_at: { type: 'string' },
      resources: { type: 'array', items: { type: 'string' } },
      text: { type: 'string' },
    },
    output: jsonOutput(TASK_RESULT_SCHEMA),
    execute(args, exec) {
      const agent = caller(exec.agent)
      const callerId = String(agent.id)
      if (args.action === 'list') return Promise.resolve({ action: 'list' as const, tasks: tasks.list(callerId, {
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.assignees?.[0] === undefined ? {} : { assignee: args.assignees[0] }),
        ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }),
      }) })
      if (args.action === 'create') {
        if (args.title === undefined) throw new Error('fleet_task create requires title')
        return Promise.resolve({ action: 'create' as const, task: tasks.create(callerId, {
          title: args.title,
          ...(args.description === undefined ? {} : { description: args.description }),
          ...(args.priority === undefined ? {} : { priority: args.priority }),
          ...(args.assignees === undefined ? {} : { assignees: args.assignees }),
          ...(args.followers === undefined ? {} : { followers: args.followers }),
          ...(args.parent_id === undefined ? {} : { parentId: args.parent_id }),
          ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
          ...(args.resources === undefined ? {} : { resources: args.resources }),
        }) })
      }
      if (args.id === undefined) throw new Error(`fleet_task ${args.action} requires id`)
      if (args.action === 'get') return Promise.resolve({ action: 'get' as const, task: tasks.get(callerId, args.id) })
      if (args.action === 'update') return Promise.resolve({ action: 'update' as const, task: tasks.update(callerId, args.id, {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.status === undefined ? {} : { status: args.status }),
        ...(args.priority === undefined ? {} : { priority: args.priority }),
        ...(args.assignees === undefined ? {} : { assignees: args.assignees }),
        ...(args.followers === undefined ? {} : { followers: args.followers }),
        ...(args.due_at === undefined ? {} : { dueAt: args.due_at }),
        ...(args.resources === undefined ? {} : { resources: args.resources }),
      }) })
      if (args.action === 'comment' || args.action === 'progress') {
        if (args.text === undefined) throw new Error(`fleet_task ${args.action} requires text`)
        return Promise.resolve({ action: args.action, task: tasks.addEntry(callerId, args.id, args.action, args.text, args.resources) })
      }
      return Promise.resolve({
        action: args.action,
        task: args.action === 'complete' ? tasks.complete(callerId, args.id) : tasks.reopen(callerId, args.id),
      })
    },
  }))
}
