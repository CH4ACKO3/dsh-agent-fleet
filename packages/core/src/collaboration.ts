import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

export const FLEET_MEMBER_STATUS_MAX_LENGTH = 240

export interface FleetMemberStatus {
  readonly member: string
  readonly message: string
  readonly updatedAt?: string
}

export type FleetMemberStatusEvent =
  | { readonly action: 'updated'; readonly status: FleetMemberStatus }
  | { readonly action: 'cleared'; readonly member: string }

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

export interface CreateFleetScheduledTaskInput {
  readonly title: string
  readonly instructions?: string
  readonly dueAt: string
  readonly assignees?: readonly string[]
  readonly repeatMinutes?: number
}

export type FleetScheduledTaskEvent = {
  readonly action: 'created' | 'updated' | 'triggered' | 'completed' | 'cancelled'
  readonly task: FleetScheduledTask
}

export interface FleetMemberDirectory {
  list(): readonly { readonly id: string; readonly name: string }[]
  nameForAgent(id: string): string | undefined
  resolve(reference: string): string | undefined
}

type StopListening = () => void

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`${label} cannot be empty`)
  return normalized
}

function snapshotStatus(status: FleetMemberStatus): FleetMemberStatus {
  return { ...status }
}

function snapshotTask(task: FleetScheduledTask): FleetScheduledTask {
  return { ...task, assignees: [...task.assignees] }
}

function member(directory: FleetMemberDirectory, agentId: string): string {
  const name = directory.nameForAgent(agentId)
  if (name === undefined) throw new Error(`Agent ${agentId} is not a member of this Fleet team`)
  return name
}

export class FleetMemberStatusBoard {
  private readonly statuses = new Map<string, FleetMemberStatus>()
  private readonly listeners = new Set<(event: FleetMemberStatusEvent) => void>()

  constructor(private readonly directory: FleetMemberDirectory) {}

  list(callerId: string): FleetMemberStatus[] {
    member(this.directory, callerId)
    return this.directory.list().map(entry => this.getByName(entry.name))
  }

  get(callerId: string, reference: string): FleetMemberStatus {
    member(this.directory, callerId)
    const name = this.directory.resolve(reference)
    if (name === undefined) throw new Error(`unknown Fleet member ${reference}`)
    return this.getByName(name)
  }

  set(
    callerId: string,
    message: string,
  ): FleetMemberStatus {
    const name = member(this.directory, callerId)
    const normalized = requiredText(message, 'member status')
    if (normalized.length > FLEET_MEMBER_STATUS_MAX_LENGTH) {
      throw new Error(`member status cannot exceed ${FLEET_MEMBER_STATUS_MAX_LENGTH} characters`)
    }
    const status: FleetMemberStatus = {
      member: name,
      message: normalized,
      updatedAt: new Date().toISOString(),
    }
    this.statuses.set(name, status)
    this.emit({ action: 'updated', status: snapshotStatus(status) })
    return snapshotStatus(status)
  }

  clear(callerId: string): FleetMemberStatus {
    const name = member(this.directory, callerId)
    this.statuses.delete(name)
    this.emit({ action: 'cleared', member: name })
    return this.getByName(name)
  }

  retireMember(name: string): void {
    if (!this.statuses.delete(name)) return
    this.emit({ action: 'cleared', member: name })
  }

  restore(events: readonly FleetMemberStatusEvent[]): void {
    this.statuses.clear()
    for (const event of events) {
      if (event.action === 'cleared') this.statuses.delete(event.member)
      else this.statuses.set(event.status.member, {
        member: event.status.member,
        message: event.status.message,
        ...(event.status.updatedAt === undefined ? {} : { updatedAt: event.status.updatedAt }),
      })
    }
  }

  onEvent(listener: (event: FleetMemberStatusEvent) => void): StopListening {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private getByName(name: string): FleetMemberStatus {
    const status = this.statuses.get(name)
    return status === undefined
      ? { member: name, message: '' }
      : snapshotStatus(status)
  }

  private emit(event: FleetMemberStatusEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}

export class FleetScheduler {
  private readonly tasks = new Map<string, FleetScheduledTask>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly listeners = new Set<(event: FleetScheduledTaskEvent) => void>()
  private closed = false

  constructor(
    private readonly directory: FleetMemberDirectory,
    private readonly onDue: (task: FleetScheduledTask) => void,
  ) {}

  list(callerId: string): FleetScheduledTask[] {
    member(this.directory, callerId)
    return [...this.tasks.values()]
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
      .map(snapshotTask)
  }

  create(callerId: string, input: CreateFleetScheduledTaskInput): FleetScheduledTask {
    this.assertOpen()
    const createdBy = member(this.directory, callerId)
    const dueAt = this.futureDate(input.dueAt)
    const assignees = this.resolveAssignees(input.assignees ?? [createdBy])
    if (input.repeatMinutes !== undefined && (!Number.isInteger(input.repeatMinutes) || input.repeatMinutes < 1)) {
      throw new Error('repeat_minutes must be a positive integer')
    }
    const now = new Date().toISOString()
    const task: FleetScheduledTask = {
      id: `task_${randomUUID()}`,
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
    this.emit({ action: 'created', task: snapshotTask(task) })
    this.arm(task)
    return snapshotTask(task)
  }

  complete(callerId: string, id: string): FleetScheduledTask {
    const task = this.requireTask(id)
    this.requireResponsible(callerId, task)
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new Error(`scheduled task ${id} is already ${task.status}`)
    }
    const now = new Date().toISOString()
    const completed: FleetScheduledTask = {
      ...task,
      status: 'completed',
      completedAt: now,
      updatedAt: now,
    }
    this.replace(completed)
    this.emit({ action: 'completed', task: snapshotTask(completed) })
    return snapshotTask(completed)
  }

  cancel(callerId: string, id: string): FleetScheduledTask {
    const task = this.requireTask(id)
    this.requireResponsible(callerId, task)
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new Error(`scheduled task ${id} is already ${task.status}`)
    }
    const now = new Date().toISOString()
    const cancelled: FleetScheduledTask = {
      ...task,
      status: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
    }
    this.replace(cancelled)
    this.emit({ action: 'cancelled', task: snapshotTask(cancelled) })
    return snapshotTask(cancelled)
  }

  retireMember(retired: string, successor: string): void {
    for (const task of [...this.tasks.values()]) {
      if (task.status === 'completed' || task.status === 'cancelled') continue
      const wasAssignee = task.assignees.includes(retired)
      if (task.createdBy !== retired && !wasAssignee) continue
      const assignees = task.assignees.filter(assignee => assignee !== retired)
      if (wasAssignee && assignees.length === 0) assignees.push(successor)
      const updated: FleetScheduledTask = {
        ...task,
        createdBy: task.createdBy === retired ? successor : task.createdBy,
        assignees,
        updatedAt: new Date().toISOString(),
      }
      this.replace(updated)
      this.emit({ action: 'updated', task: snapshotTask(updated) })
      if (updated.status === 'scheduled') this.arm(updated)
    }
  }

  restore(events: readonly FleetScheduledTaskEvent[]): void {
    this.assertOpen()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.tasks.clear()
    for (const event of events) this.tasks.set(event.task.id, snapshotTask(event.task))
    for (const task of this.tasks.values()) {
      if (task.status === 'scheduled') this.arm(task)
    }
  }

  onEvent(listener: (event: FleetScheduledTaskEvent) => void): StopListening {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.listeners.clear()
  }

  private trigger(id: string): void {
    this.timers.delete(id)
    if (this.closed) return
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
      : {
          ...task,
          dueAt: this.nextOccurrence(due, task.repeatMinutes),
          lastTriggeredAt: now,
          updatedAt: now,
        }
    this.tasks.set(id, triggered)
    this.emit({ action: 'triggered', task: snapshotTask(triggered) })
    this.onDue(snapshotTask(triggered))
    if (triggered.status === 'scheduled') this.arm(triggered)
  }

  private arm(task: FleetScheduledTask): void {
    if (this.closed || task.status !== 'scheduled') return
    const existing = this.timers.get(task.id)
    if (existing !== undefined) clearTimeout(existing)
    const delay = Math.max(0, Math.min(Date.parse(task.dueAt) - Date.now(), 2_147_483_647))
    const timer = setTimeout(() => { this.trigger(task.id) }, delay)
    timer.unref()
    this.timers.set(task.id, timer)
  }

  private replace(task: FleetScheduledTask): void {
    const timer = this.timers.get(task.id)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(task.id)
    this.tasks.set(task.id, task)
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
    const resolved: string[] = []
    for (const reference of references) {
      const name = this.directory.resolve(reference)
      if (name === undefined) throw new Error(`unknown Fleet member ${reference}`)
      if (!resolved.includes(name)) resolved.push(name)
    }
    return resolved
  }

  private requireResponsible(callerId: string, task: FleetScheduledTask): void {
    const caller = member(this.directory, callerId)
    if (caller !== task.createdBy && !task.assignees.includes(caller)) {
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
    for (const listener of [...this.listeners]) listener(event)
  }
}

const MEMBER_STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    member: { type: 'string', required: true },
    message: { type: 'string', required: true },
    updatedAt: { type: 'string' },
  },
} as const

const SCHEDULED_TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    instructions: { type: 'string', required: true },
    createdBy: { type: 'string', required: true },
    assignees: { type: 'array', required: true, items: { type: 'string' } },
    status: { type: 'string', required: true, enum: ['scheduled', 'due', 'completed', 'cancelled'] },
    dueAt: { type: 'string', required: true },
    repeatMinutes: { type: 'integer' },
    lastTriggeredAt: { type: 'string' },
    completedAt: { type: 'string' },
    cancelledAt: { type: 'string' },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

const MEMBER_STATUS_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['list', 'get', 'set', 'clear'] },
    statuses: { type: 'array', items: MEMBER_STATUS_SCHEMA },
    status: MEMBER_STATUS_SCHEMA,
  },
} as const

const SCHEDULE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['list', 'create', 'complete', 'cancel'] },
    tasks: { type: 'array', items: SCHEDULED_TASK_SCHEMA },
    task: SCHEDULED_TASK_SCHEMA,
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function callingAgent(agent: Agent | undefined, tool: string): Agent {
  if (agent === undefined) throw new Error(`${tool} requires a calling Agent`)
  return agent
}

export function installCollaborationTools(
  ctx: Context,
  statuses: FleetMemberStatusBoard,
  scheduler: FleetScheduler,
  options: {
    readonly status?: boolean
    readonly schedule?: boolean
    readonly createSchedule?: boolean
    readonly canCreateSchedule?: (agentId: string) => boolean
  } = {},
): () => void {
  const stops: Array<() => void> = []
  const register = (tool: Parameters<typeof ctx.tools.register>[0]): void => {
    stops.push(ctx.tools.register(tool))
  }
  if (options.status !== false) {
  register(defineTool({
    name: 'fleet_member_status',
    description: `Read Team members' self-declared current work, or update your own short status text. This is separate from automatic runtime state such as idle, waiting, or error. Status text is limited to ${FLEET_MEMBER_STATUS_MAX_LENGTH} characters.`,
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'set', 'clear'] },
      member: { type: 'string', description: 'Member name or @member for get.' },
      message: { type: 'string', description: `Your current work in at most ${FLEET_MEMBER_STATUS_MAX_LENGTH} characters. Required for set.` },
    },
    output: jsonOutput(MEMBER_STATUS_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_member_status')
      const callerId = String(caller.id)
      if (args.action === 'list') return { action: 'list' as const, statuses: statuses.list(callerId) }
      if (args.action === 'get') {
        if (args.member === undefined) throw new Error('fleet_member_status get requires member')
        return { action: 'get' as const, status: statuses.get(callerId, args.member) }
      }
      if (args.action === 'set') {
        if (args.message === undefined) throw new Error('fleet_member_status set requires message')
        return {
          action: 'set' as const,
          status: statuses.set(callerId, args.message),
        }
      }
      return { action: 'clear' as const, status: statuses.clear(callerId) }
    },
  }))
  }

  if (options.schedule !== false) {
  register(defineTool({
    name: 'fleet_schedule',
    description: 'List and manage persistent Team reminders. At the due time, assigned members are woken with the task instructions. Use repeat_minutes for a simple recurring cadence.',
    parameters: {
      action: { type: 'string', required: true, enum: options.createSchedule === false
        ? ['list', 'complete', 'cancel'] as const
        : ['list', 'create', 'complete', 'cancel'] as const },
      id: { type: 'string', description: 'Scheduled task id for complete or cancel.' },
      title: { type: 'string', description: 'Short task or meeting reminder title.' },
      instructions: { type: 'string', description: 'What assigned members should do when woken.' },
      due_at: { type: 'string', description: 'ISO date-time with timezone.' },
      assignees: { type: 'array', items: { type: 'string' }, description: 'Member names or @members. Defaults to yourself.' },
      repeat_minutes: { type: 'integer', description: 'Optional positive recurrence interval in minutes.' },
    },
    output: jsonOutput(SCHEDULE_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_schedule')
      const callerId = String(caller.id)
      if (args.action === 'list') return { action: 'list' as const, tasks: scheduler.list(callerId) }
      if (args.action === 'create') {
        if (options.canCreateSchedule?.(callerId) === false) {
          throw new Error(`Agent ${callerId} lacks Fleet permission schedule.create`)
        }
        if (args.title === undefined || args.due_at === undefined) {
          throw new Error('fleet_schedule create requires title and due_at')
        }
        return {
          action: 'create' as const,
          task: scheduler.create(callerId, {
            title: args.title,
            dueAt: args.due_at,
            ...(args.instructions === undefined ? {} : { instructions: args.instructions }),
            ...(args.assignees === undefined ? {} : { assignees: args.assignees }),
            ...(args.repeat_minutes === undefined ? {} : { repeatMinutes: args.repeat_minutes }),
          }),
        }
      }
      if (args.id === undefined) throw new Error(`fleet_schedule ${args.action} requires id`)
      return args.action === 'complete'
        ? { action: 'complete' as const, task: scheduler.complete(callerId, args.id) }
        : { action: 'cancel' as const, task: scheduler.cancel(callerId, args.id) }
    },
  }))
  }
  return () => {
    for (const stop of stops.reverse()) stop()
  }
}
