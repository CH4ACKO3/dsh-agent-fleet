import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, JsonValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { FleetMemberDirectory } from '@dsh-agent-fleet/core'

export const FLEET_CALENDAR_STATE_NAMESPACE = 'productivity-calendar'

export type FleetCalendarRsvp = 'invited' | 'accepted' | 'declined' | 'tentative'
export type FleetCalendarEventStatus = 'scheduled' | 'open' | 'closed' | 'cancelled'

export interface FleetCalendarEvent {
  readonly id: string
  readonly title: string
  readonly agenda: string
  readonly organizer: string
  readonly attendees: string[]
  readonly rsvps: Record<string, FleetCalendarRsvp>
  readonly startAt: string
  readonly endAt?: string
  readonly repeatMinutes?: number
  readonly occurrence: number
  readonly status: FleetCalendarEventStatus
  readonly meetingId?: string
  readonly lastStartedAt?: string
  readonly lastMeetingClosedAt?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface FleetCalendarState {
  readonly version: 1
  readonly events: FleetCalendarEvent[]
}

export interface FleetCalendarEventChange {
  readonly action: 'created' | 'updated' | 'rsvp' | 'started' | 'closed' | 'cancelled'
  readonly event: FleetCalendarEvent
  readonly actor?: string
}

export interface CreateFleetCalendarEventInput {
  readonly title: string
  readonly agenda: string
  readonly attendees: readonly string[]
  readonly startAt: string
  readonly endAt?: string
  readonly repeatMinutes?: number
}

const EMPTY_STATE: FleetCalendarState = { version: 1, events: [] }

function text(value: string, label: string): string {
  const result = value.trim()
  if (result.length === 0) throw new Error(`${label} cannot be empty`)
  return result
}

function snapshot<T>(value: T): T {
  return structuredClone(value)
}

export function parseFleetCalendarState(value: JsonValue | undefined): FleetCalendarState {
  if (value === undefined) return snapshot(EMPTY_STATE)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Fleet Calendar state must be an object')
  const input = value as Record<string, JsonValue>
  if (input.version !== 1 || !Array.isArray(input.events)) {
    throw new Error('Fleet Calendar state must contain version 1 events')
  }
  return snapshot(value) as unknown as FleetCalendarState
}

export class FleetCalendar {
  private readonly events = new Map<string, FleetCalendarEvent>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly listeners = new Set<(event: FleetCalendarEventChange) => void>()
  private active = false
  private closed = false

  constructor(
    private readonly directory: FleetMemberDirectory,
    private readonly onStart: (event: FleetCalendarEvent) => string | undefined,
    private readonly canManage: (agentId: string) => boolean = () => false,
  ) {}

  state(): FleetCalendarState {
    return { version: 1, events: [...this.events.values()].map(snapshot) }
  }

  restore(state: FleetCalendarState): void {
    this.assertOpen()
    this.pause()
    this.events.clear()
    for (const event of state.events) this.events.set(event.id, snapshot(event))
  }

  activate(): void {
    this.assertOpen()
    if (this.active) return
    this.active = true
    for (const event of this.events.values()) if (event.status === 'scheduled') this.arm(event)
  }

  pause(): void {
    this.active = false
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  list(callerId: string, from?: string, to?: string): FleetCalendarEvent[] {
    const member = this.member(callerId)
    const start = from === undefined ? undefined : this.date(from, 'calendar from').getTime()
    const end = to === undefined ? undefined : this.date(to, 'calendar to').getTime()
    return [...this.events.values()]
      .filter(event => event.organizer === member || event.attendees.includes(member))
      .filter(event => start === undefined || new Date(event.startAt).getTime() >= start)
      .filter(event => end === undefined || new Date(event.startAt).getTime() < end)
      .sort((left, right) => left.startAt.localeCompare(right.startAt))
      .map(snapshot)
  }

  get(callerId: string, id: string): FleetCalendarEvent {
    const member = this.member(callerId)
    const event = this.requireEvent(id)
    if (event.organizer !== member && !event.attendees.includes(member) && !this.canManage(callerId)) {
      throw new Error(`Fleet member ${member} cannot access calendar event ${id}`)
    }
    return snapshot(event)
  }

  create(callerId: string, input: CreateFleetCalendarEventInput): FleetCalendarEvent {
    this.assertOpen()
    const organizer = this.member(callerId)
    const attendees = [...new Set(input.attendees.map(reference => this.resolve(reference)).filter(name => name !== organizer))]
    if (attendees.length === 0) throw new Error('calendar event requires at least one attendee')
    const start = this.date(input.startAt, 'calendar startAt')
    const end = input.endAt === undefined ? undefined : this.date(input.endAt, 'calendar endAt')
    if (end !== undefined && end <= start) throw new Error('calendar endAt must be after startAt')
    if (input.repeatMinutes !== undefined && (!Number.isInteger(input.repeatMinutes) || input.repeatMinutes < 1)) {
      throw new Error('repeatMinutes must be a positive integer')
    }
    const now = new Date().toISOString()
    const event: FleetCalendarEvent = {
      id: `event_${randomUUID()}`,
      title: text(input.title, 'calendar title'),
      agenda: text(input.agenda, 'calendar agenda'),
      organizer,
      attendees,
      rsvps: Object.fromEntries(attendees.map(name => [name, 'invited' as const])),
      startAt: start.toISOString(),
      ...(end === undefined ? {} : { endAt: end.toISOString() }),
      ...(input.repeatMinutes === undefined ? {} : { repeatMinutes: input.repeatMinutes }),
      occurrence: 0,
      status: 'scheduled',
      createdAt: now,
      updatedAt: now,
    }
    this.events.set(event.id, event)
    this.emit({ action: 'created', event, actor: organizer })
    this.arm(event)
    return snapshot(event)
  }

  update(callerId: string, id: string, input: {
    readonly title?: string
    readonly agenda?: string
    readonly attendees?: readonly string[]
    readonly startAt?: string
    readonly endAt?: string
  }): FleetCalendarEvent {
    const current = this.requireEvent(id)
    this.requireOrganizer(callerId, current)
    const start = input.startAt === undefined ? undefined : this.date(input.startAt, 'calendar startAt')
    const end = input.endAt === undefined ? undefined : this.date(input.endAt, 'calendar endAt')
    const startAt = start?.toISOString() ?? current.startAt
    const endAt = end?.toISOString() ?? current.endAt
    if (endAt !== undefined && new Date(endAt) <= new Date(startAt)) throw new Error('calendar endAt must be after startAt')
    const attendees = input.attendees === undefined
      ? current.attendees
      : [...new Set(input.attendees.map(reference => this.resolve(reference)).filter(name => name !== current.organizer))]
    if (attendees.length === 0) throw new Error('calendar event requires at least one attendee')
    const rsvps = Object.fromEntries(attendees.map(name => [name, current.rsvps[name] ?? 'invited']))
    const updated: FleetCalendarEvent = {
      ...current,
      ...(input.title === undefined ? {} : { title: text(input.title, 'calendar title') }),
      ...(input.agenda === undefined ? {} : { agenda: text(input.agenda, 'calendar agenda') }),
      attendees,
      rsvps,
      startAt,
      ...(endAt === undefined ? {} : { endAt }),
      updatedAt: new Date().toISOString(),
    }
    this.replace(updated)
    this.emit({ action: 'updated', event: updated, actor: this.member(callerId) })
    return snapshot(updated)
  }

  rsvp(callerId: string, id: string, response: Exclude<FleetCalendarRsvp, 'invited'>): FleetCalendarEvent {
    const member = this.member(callerId)
    const current = this.requireEvent(id)
    if (!current.attendees.includes(member)) throw new Error(`Fleet member ${member} is not invited to ${id}`)
    const updated = { ...current, rsvps: { ...current.rsvps, [member]: response }, updatedAt: new Date().toISOString() }
    this.events.set(id, updated)
    this.emit({ action: 'rsvp', event: updated, actor: member })
    return snapshot(updated)
  }

  closeEvent(callerId: string, id: string): FleetCalendarEvent {
    const current = this.requireEvent(id)
    this.requireOrganizer(callerId, current)
    const updated = { ...current, status: 'closed' as const, updatedAt: new Date().toISOString() }
    this.replace(updated)
    this.emit({ action: 'closed', event: updated, actor: this.member(callerId) })
    return snapshot(updated)
  }

  cancel(callerId: string, id: string): FleetCalendarEvent {
    const current = this.requireEvent(id)
    this.requireOrganizer(callerId, current)
    const updated = { ...current, status: 'cancelled' as const, updatedAt: new Date().toISOString() }
    this.replace(updated)
    this.emit({ action: 'cancelled', event: updated, actor: this.member(callerId) })
    return snapshot(updated)
  }

  retireMember(retired: string, successor: string): void {
    for (const event of [...this.events.values()]) {
      if (event.status === 'closed' || event.status === 'cancelled') continue
      if (event.organizer !== retired && !event.attendees.includes(retired)) continue
      const organizer = event.organizer === retired ? successor : event.organizer
      const attendees = event.attendees.filter(member => member !== retired && member !== organizer)
      const { [retired]: _retired, [organizer]: _organizer, ...rsvps } = event.rsvps
      const updated: FleetCalendarEvent = {
        ...event,
        organizer,
        attendees,
        rsvps,
        status: attendees.length === 0 ? 'cancelled' : event.status,
        updatedAt: new Date().toISOString(),
      }
      this.replace(updated)
      this.emit({ action: updated.status === 'cancelled' ? 'cancelled' : 'updated', event: updated, actor: successor })
    }
  }

  freeBusy(callerId: string, members: readonly string[], from: string, to: string): Array<{
    readonly member: string
    readonly events: FleetCalendarEvent[]
  }> {
    this.member(callerId)
    const start = this.date(from, 'freebusy from').getTime()
    const end = this.date(to, 'freebusy to').getTime()
    if (end <= start) throw new Error('freebusy to must be after from')
    return members.map(reference => {
      const member = this.resolve(reference)
      return {
        member,
        events: [...this.events.values()].filter(event => event.status !== 'cancelled'
          && (event.organizer === member || event.attendees.includes(member))
          && new Date(event.startAt).getTime() < end
          && new Date(event.endAt ?? event.startAt).getTime() >= start).map(snapshot),
      }
    })
  }

  pendingStarts(): FleetCalendarEvent[] {
    return [...this.events.values()].filter(event => event.status === 'open' && event.meetingId === undefined).map(snapshot)
  }

  retryPendingStarts(): void {
    if (!this.active) return
    for (const event of this.pendingStarts()) {
      const meetingId = this.onStart(event)
      if (meetingId !== undefined) this.linkMeeting(event.id, meetingId)
    }
  }

  linkMeeting(id: string, meetingId: string): FleetCalendarEvent {
    const current = this.requireEvent(id)
    const linkedMeetingId = text(meetingId, 'meeting id')
    const interval = current.repeatMinutes === undefined ? undefined : current.repeatMinutes * 60_000
    const previousStart = new Date(current.startAt).getTime()
    const skipped = interval === undefined ? undefined : Math.max(1, Math.floor((Date.now() - previousStart) / interval) + 1)
    const nextStart = current.status === 'open' && interval !== undefined && skipped !== undefined
      ? new Date(previousStart + skipped * interval)
      : undefined
    const duration = current.endAt === undefined ? undefined : new Date(current.endAt).getTime() - new Date(current.startAt).getTime()
    const updated: FleetCalendarEvent = nextStart === undefined
      ? { ...current, meetingId: linkedMeetingId, updatedAt: new Date().toISOString() }
      : {
          ...current,
          meetingId: linkedMeetingId,
          status: 'scheduled',
          startAt: nextStart.toISOString(),
          ...(duration === undefined ? {} : { endAt: new Date(nextStart.getTime() + duration).toISOString() }),
          updatedAt: new Date().toISOString(),
        }
    this.replace(updated)
    this.emit({ action: 'updated', event: updated })
    return snapshot(updated)
  }

  closeLinkedMeeting(meetingId: string, closedAt = new Date().toISOString()): FleetCalendarEvent | undefined {
    const current = [...this.events.values()].find(event => event.meetingId === meetingId)
    if (current === undefined) return undefined
    const updated: FleetCalendarEvent = {
      ...current,
      status: current.repeatMinutes === undefined ? 'closed' : current.status,
      lastMeetingClosedAt: this.date(closedAt, 'meeting closedAt').toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.replace(updated)
    this.emit({ action: current.repeatMinutes === undefined ? 'closed' : 'updated', event: updated })
    return snapshot(updated)
  }

  onEvent(listener: (event: FleetCalendarEventChange) => void): () => void {
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
    const current = this.events.get(id)
    if (current === undefined || current.status !== 'scheduled') return
    if (new Date(current.startAt).getTime() > Date.now()) {
      this.arm(current)
      return
    }
    const now = new Date().toISOString()
    const { meetingId: _meetingId, ...withoutMeeting } = current
    const started: FleetCalendarEvent = {
      ...withoutMeeting,
      occurrence: current.occurrence + 1,
      status: 'open',
      lastStartedAt: now,
      updatedAt: now,
    }
    this.events.set(id, started)
    this.emit({ action: 'started', event: started })
    const meetingId = this.onStart(snapshot(started))
    if (meetingId !== undefined) this.linkMeeting(id, meetingId)
  }

  private arm(event: FleetCalendarEvent): void {
    const existing = this.timers.get(event.id)
    if (existing !== undefined) clearTimeout(existing)
    this.timers.delete(event.id)
    if (!this.active || event.status !== 'scheduled') return
    const delay = Math.max(0, Math.min(new Date(event.startAt).getTime() - Date.now(), 2_147_483_647))
    const timer = setTimeout(() => { this.trigger(event.id) }, delay)
    timer.unref?.()
    this.timers.set(event.id, timer)
  }

  private replace(event: FleetCalendarEvent): void {
    const timer = this.timers.get(event.id)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(event.id)
    this.events.set(event.id, event)
    this.arm(event)
  }

  private emit(event: FleetCalendarEventChange): void {
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

  private requireOrganizer(agentId: string, event: FleetCalendarEvent): void {
    const member = this.member(agentId)
    if (member !== event.organizer && !this.canManage(agentId)) {
      throw new Error(`Fleet member ${member} cannot manage calendar event ${event.id}`)
    }
  }

  private requireEvent(id: string): FleetCalendarEvent {
    this.assertOpen()
    const event = this.events.get(id)
    if (event === undefined) throw new Error(`unknown Fleet calendar event ${id}`)
    return event
  }

  private date(value: string, label: string): Date {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be an ISO date-time`)
    return date
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Fleet Calendar service is stopped')
  }
}

const CALENDAR_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, title: { type: 'string', required: true }, agenda: { type: 'string', required: true },
    organizer: { type: 'string', required: true }, attendees: { type: 'array', required: true, items: { type: 'string' } },
    rsvps: { type: 'object', required: true, additionalProperties: true },
    startAt: { type: 'string', required: true }, endAt: { type: 'string' }, repeatMinutes: { type: 'integer' }, occurrence: { type: 'integer', required: true },
    status: { type: 'string', required: true, enum: ['scheduled', 'open', 'closed', 'cancelled'] }, meetingId: { type: 'string' },
    lastStartedAt: { type: 'string' }, lastMeetingClosedAt: { type: 'string' }, createdAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
  },
} as const

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'update', 'rsvp', 'cancel', 'close', 'freebusy'] },
    event: CALENDAR_SCHEMA, events: { type: 'array', items: CALENDAR_SCHEMA },
    freebusy: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      member: { type: 'string', required: true }, events: { type: 'array', required: true, items: CALENDAR_SCHEMA },
    } } },
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): { schema: S; render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }] } {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

export function installCalendarTools(
  ctx: Context,
  calendar: FleetCalendar,
  authorize: (agentId: string, action: string) => boolean,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_calendar',
    description: 'Manage persistent Team calendar events, attendees, RSVP, recurrence, free/busy, and scheduled Fleet Meetings.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'update', 'rsvp', 'cancel', 'close', 'freebusy'] },
      id: { type: 'string' }, title: { type: 'string' }, agenda: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } },
      start_at: { type: 'string' }, end_at: { type: 'string' }, repeat_minutes: { type: 'integer' },
      response: { type: 'string', enum: ['accepted', 'declined', 'tentative'] },
      from: { type: 'string' }, to: { type: 'string' }, members: { type: 'array', items: { type: 'string' } },
    },
    output: jsonOutput(RESULT_SCHEMA),
    execute(args, exec) {
      const agent = exec.agent as Agent | undefined
      if (agent === undefined) throw new Error('fleet_calendar requires a calling Agent')
      const callerId = String(agent.id)
      const action = args.action === 'list' || args.action === 'get' || args.action === 'freebusy' ? 'calendar.read'
        : args.action === 'create' ? 'calendar.create' : args.action === 'rsvp' ? 'calendar.rsvp' : 'calendar.update'
      if (!authorize(callerId, action) && !authorize(callerId, 'calendar.manage')) {
        throw new Error(`Agent ${callerId} is not authorized for ${action}`)
      }
      if (args.action === 'list') return Promise.resolve({ action: 'list' as const, events: calendar.list(callerId, args.from, args.to) })
      if (args.action === 'freebusy') {
        if (args.from === undefined || args.to === undefined || args.members === undefined) throw new Error('fleet_calendar freebusy requires from, to, and members')
        return Promise.resolve({ action: 'freebusy' as const, freebusy: calendar.freeBusy(callerId, args.members, args.from, args.to) })
      }
      if (args.action === 'create') {
        if (args.title === undefined || args.agenda === undefined || args.attendees === undefined || args.start_at === undefined) {
          throw new Error('fleet_calendar create requires title, agenda, attendees, and start_at')
        }
        return Promise.resolve({ action: 'create' as const, event: calendar.create(callerId, {
          title: args.title, agenda: args.agenda, attendees: args.attendees, startAt: args.start_at,
          ...(args.end_at === undefined ? {} : { endAt: args.end_at }),
          ...(args.repeat_minutes === undefined ? {} : { repeatMinutes: args.repeat_minutes }),
        }) })
      }
      if (args.id === undefined) throw new Error(`fleet_calendar ${args.action} requires id`)
      if (args.action === 'get') return Promise.resolve({ action: 'get' as const, event: calendar.get(callerId, args.id) })
      if (args.action === 'update') return Promise.resolve({ action: 'update' as const, event: calendar.update(callerId, args.id, {
        ...(args.title === undefined ? {} : { title: args.title }), ...(args.agenda === undefined ? {} : { agenda: args.agenda }),
        ...(args.attendees === undefined ? {} : { attendees: args.attendees }), ...(args.start_at === undefined ? {} : { startAt: args.start_at }),
        ...(args.end_at === undefined ? {} : { endAt: args.end_at }),
      }) })
      if (args.action === 'rsvp') {
        if (args.response === undefined) throw new Error('fleet_calendar rsvp requires response')
        return Promise.resolve({ action: 'rsvp' as const, event: calendar.rsvp(callerId, args.id, args.response) })
      }
      return Promise.resolve(args.action === 'cancel'
        ? { action: 'cancel' as const, event: calendar.cancel(callerId, args.id) }
        : { action: 'close' as const, event: calendar.closeEvent(callerId, args.id) })
    },
  }))
}
