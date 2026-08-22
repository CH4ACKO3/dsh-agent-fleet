import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, JsonValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'

export const FLEET_SCHEDULE_STATE_NAMESPACE = 'productivity-schedules'

export type FleetScheduledTaskStatus = 'scheduled' | 'due' | 'completed' | 'cancelled'

export interface FleetScheduledTask {
  readonly id: string
  readonly title: string
  readonly instructions: string
  readonly createdBy: string
  readonly assignees: string[]
  readonly status: FleetScheduledTaskStatus
  readonly dueAt: string
  readonly repeatMinutes?: number
  readonly lastTriggeredAt?: string
  readonly completedAt?: string
  readonly cancelledAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface FleetScheduleState {
  readonly version: 1
  readonly schedules: readonly FleetScheduledTask[]
}

export interface CreateFleetScheduledTaskInput {
  readonly title: string
  readonly instructions?: string
  readonly dueAt: string
  readonly assignees?: readonly string[]
  readonly repeatMinutes?: number
}

export interface FleetScheduledTaskEvent {
  readonly action: 'created' | 'updated' | 'triggered' | 'completed' | 'cancelled'
  readonly task: FleetScheduledTask
  readonly actor?: string
}

const EMPTY_STATE: FleetScheduleState = { version: 1, schedules: [] }

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`${label} cannot be empty`)
  return normalized
}

function snapshot<T>(value: T): T {
  return structuredClone(value)
}

export function parseFleetScheduleState(value: JsonValue | undefined): FleetScheduleState {
  if (value === undefined) return snapshot(EMPTY_STATE)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Fleet Schedule state must be an object')
  const input = value as Record<string, JsonValue>
  if (input.version !== 1 || !Array.isArray(input.schedules)) {
    throw new Error('Fleet Schedule state must contain version 1 schedules')
  }
  return snapshot(value) as unknown as FleetScheduleState
}

export class FleetScheduler {
  private readonly tasks = new Map<string, FleetScheduledTask>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly listeners = new Set<(event: FleetScheduledTaskEvent) => void>()
  private active = false
  private closed = false

  constructor(
    private readonly directory: FleetMemberDirectory,
    private readonly canManage: (agentId: string) => boolean,
    private readonly onDue: (task: FleetScheduledTask) => void,
  ) {}

  state(): FleetScheduleState {
    return { version: 1, schedules: [...this.tasks.values()].map(snapshot) }
  }

  restore(state: FleetScheduleState): void {
    this.assertOpen()
    this.pause()
    this.tasks.clear()
    for (const task of state.schedules) this.tasks.set(task.id, snapshot(task))
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

  list(callerId: string): FleetScheduledTask[] {
    this.member(callerId)
    return [...this.tasks.values()].sort((left, right) => left.dueAt.localeCompare(right.dueAt)).map(snapshot)
  }

  create(callerId: string, input: CreateFleetScheduledTaskInput): FleetScheduledTask {
    this.assertOpen()
    const createdBy = this.member(callerId)
    const dueAt = this.futureDate(input.dueAt)
    const assignees = this.resolveAssignees(input.assignees ?? [createdBy])
    if (input.repeatMinutes !== undefined && (!Number.isInteger(input.repeatMinutes) || input.repeatMinutes < 1)) {
      throw new Error('repeat_minutes must be a positive integer')
    }
    const now = new Date().toISOString()
    const task: FleetScheduledTask = {
      id: `schedule_${randomUUID()}`,
      title: requiredText(input.title, 'scheduled task title'),
      instructions: input.instructions?.trim() ?? '',
      createdBy,
      assignees,
      status: 'scheduled',
      dueAt,
      ...(input.repeatMinutes === undefined ? {} : { repeatMinutes: input.repeatMinutes }),
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(task.id, task)
    this.emit({ action: 'created', task, actor: createdBy })
    this.arm(task)
    return snapshot(task)
  }

  complete(callerId: string, id: string): FleetScheduledTask {
    const task = this.requireTask(id)
    this.requireResponsible(callerId, task)
    if (task.status === 'completed' || task.status === 'cancelled') throw new Error(`scheduled task ${id} is already ${task.status}`)
    const now = new Date().toISOString()
    const completed = { ...task, status: 'completed' as const, completedAt: now, updatedAt: now }
    this.replace(completed)
    this.emit({ action: 'completed', task: completed, actor: this.member(callerId) })
    return snapshot(completed)
  }

  cancel(callerId: string, id: string): FleetScheduledTask {
    const task = this.requireTask(id)
    this.requireResponsible(callerId, task)
    if (task.status === 'completed' || task.status === 'cancelled') throw new Error(`scheduled task ${id} is already ${task.status}`)
    const now = new Date().toISOString()
    const cancelled = { ...task, status: 'cancelled' as const, cancelledAt: now, updatedAt: now }
    this.replace(cancelled)
    this.emit({ action: 'cancelled', task: cancelled, actor: this.member(callerId) })
    return snapshot(cancelled)
  }

  retireMember(retired: string, successor: string): void {
    for (const task of [...this.tasks.values()]) {
      if (task.status === 'completed' || task.status === 'cancelled') continue
      const wasAssignee = task.assignees.includes(retired)
      if (task.createdBy !== retired && !wasAssignee) continue
      const assignees = task.assignees.filter(value => value !== retired)
      if (wasAssignee && assignees.length === 0) assignees.push(successor)
      const updated: FleetScheduledTask = {
        ...task,
        createdBy: task.createdBy === retired ? successor : task.createdBy,
        assignees: [...new Set(assignees)],
        updatedAt: new Date().toISOString(),
      }
      this.replace(updated)
      this.emit({ action: 'updated', task: updated, actor: successor })
    }
  }

  onEvent(listener: (event: FleetScheduledTaskEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.pause()
    this.listeners.clear()
  }

  private trigger(id: string): void {
    this.timers.delete(id)
    if (!this.active || this.closed) return
    const task = this.tasks.get(id)
    if (task === undefined || task.status !== 'scheduled') return
    const due = Date.parse(task.dueAt)
    if (due > Date.now()) {
      this.arm(task)
      return
    }
    const now = new Date().toISOString()
    const triggered: FleetScheduledTask = task.repeatMinutes === undefined
      ? { ...task, status: 'due', lastTriggeredAt: now, updatedAt: now }
      : { ...task, dueAt: this.nextOccurrence(due, task.repeatMinutes), lastTriggeredAt: now, updatedAt: now }
    this.tasks.set(id, triggered)
    this.emit({ action: 'triggered', task: triggered })
    this.onDue(snapshot(triggered))
    if (triggered.status === 'scheduled') this.arm(triggered)
  }

  private arm(task: FleetScheduledTask): void {
    const existing = this.timers.get(task.id)
    if (existing !== undefined) clearTimeout(existing)
    this.timers.delete(task.id)
    if (!this.active || task.status !== 'scheduled') return
    const delay = Math.max(0, Math.min(Date.parse(task.dueAt) - Date.now(), 2_147_483_647))
    const timer = setTimeout(() => { this.trigger(task.id) }, delay)
    timer.unref?.()
    this.timers.set(task.id, timer)
  }

  private replace(task: FleetScheduledTask): void {
    const timer = this.timers.get(task.id)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(task.id)
    this.tasks.set(task.id, task)
    this.arm(task)
  }

  private futureDate(value: string): string {
    const timestamp = Date.parse(value)
    if (!Number.isFinite(timestamp)) throw new Error('due_at must be a valid ISO date-time')
    if (timestamp <= Date.now()) throw new Error('due_at must be in the future')
    return new Date(timestamp).toISOString()
  }

  private nextOccurrence(previous: number, repeatMinutes: number): string {
    const interval = repeatMinutes * 60_000
    const missed = Math.max(1, Math.floor((Date.now() - previous) / interval) + 1)
    return new Date(previous + missed * interval).toISOString()
  }

  private resolveAssignees(references: readonly string[]): string[] {
    if (references.length === 0) throw new Error('scheduled task requires at least one assignee')
    return [...new Set(references.map(reference => {
      const name = this.directory.resolve(reference)
      if (name === undefined) throw new Error(`unknown Fleet member ${reference}`)
      return name
    }))]
  }

  private member(agentId: string): string {
    const name = this.directory.nameForAgent(agentId)
    if (name === undefined) throw new Error(`Agent ${agentId} is not a member of this Fleet team`)
    return name
  }

  private requireResponsible(callerId: string, task: FleetScheduledTask): void {
    const caller = this.member(callerId)
    if (caller !== task.createdBy && !task.assignees.includes(caller) && !this.canManage(callerId)) {
      throw new Error(`Fleet member ${caller} is not responsible for scheduled task ${task.id}`)
    }
  }

  private requireTask(id: string): FleetScheduledTask {
    this.assertOpen()
    const task = this.tasks.get(id)
    if (task === undefined) throw new Error(`unknown scheduled task ${id}`)
    return task
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Fleet scheduler is stopped')
  }

  private emit(event: FleetScheduledTaskEvent): void {
    const value = snapshot(event)
    for (const listener of [...this.listeners]) listener(value)
  }
}

const TASK_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, title: { type: 'string', required: true }, instructions: { type: 'string', required: true },
    createdBy: { type: 'string', required: true }, assignees: { type: 'array', required: true, items: { type: 'string' } },
    status: { type: 'string', required: true, enum: ['scheduled', 'due', 'completed', 'cancelled'] }, dueAt: { type: 'string', required: true },
    repeatMinutes: { type: 'integer' }, lastTriggeredAt: { type: 'string' }, completedAt: { type: 'string' }, cancelledAt: { type: 'string' },
    createdAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
  },
} as const

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'create', 'complete', 'cancel'] },
    tasks: { type: 'array', items: TASK_SCHEMA }, task: TASK_SCHEMA,
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): { schema: S; render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }] } {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

export function installScheduleTools(
  ctx: Context,
  scheduler: FleetScheduler,
  authorize: (agentId: string, action: string) => boolean,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_schedule',
    description: 'Manage persistent one-shot or recurring Team reminders that wake assigned members at their due time.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'create', 'complete', 'cancel'] }, id: { type: 'string' },
      title: { type: 'string' }, instructions: { type: 'string' }, due_at: { type: 'string' },
      assignees: { type: 'array', items: { type: 'string' } }, repeat_minutes: { type: 'integer' },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = exec.agent as Agent | undefined
      if (agent === undefined) throw new Error('fleet_schedule requires a calling Agent')
      const callerId = String(agent.id)
      const action = args.action === 'list' ? 'schedule.read' : args.action === 'create' ? 'schedule.create' : 'schedule.update'
      if (!authorize(callerId, action) && !authorize(callerId, 'schedule.manage')) {
        throw new Error(`Agent ${callerId} is not authorized for ${action}`)
      }
      if (args.action === 'list') return Promise.resolve({ action: 'list' as const, tasks: scheduler.list(callerId) })
      if (args.action === 'create') {
        if (args.title === undefined || args.due_at === undefined) throw new Error('fleet_schedule create requires title and due_at')
        return Promise.resolve({ action: 'create' as const, task: scheduler.create(callerId, {
          title: args.title, dueAt: args.due_at, ...(args.instructions === undefined ? {} : { instructions: args.instructions }),
          ...(args.assignees === undefined ? {} : { assignees: args.assignees }),
          ...(args.repeat_minutes === undefined ? {} : { repeatMinutes: args.repeat_minutes }),
        }) })
      }
      if (args.id === undefined) throw new Error(`fleet_schedule ${args.action} requires id`)
      return Promise.resolve(args.action === 'complete'
        ? { action: 'complete' as const, task: scheduler.complete(callerId, args.id) }
        : { action: 'cancel' as const, task: scheduler.cancel(callerId, args.id) })
    },
  }))
}
