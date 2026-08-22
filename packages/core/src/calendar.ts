import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

import type { FleetMemberDirectory } from './collaboration.js'

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

export type FleetCalendarEventChange = {
  readonly action: 'created' | 'updated' | 'rsvp' | 'started' | 'closed' | 'cancelled'
  readonly event: FleetCalendarEvent
}

export interface CreateFleetCalendarEventInput {
  readonly title: string
  readonly agenda: string
  readonly attendees: readonly string[]
  readonly startAt: string
  readonly endAt?: string
  readonly repeatMinutes?: number
}

function text(value: string, label: string): string {
  const result = value.trim()
  if (result.length === 0) throw new Error(`${label} cannot be empty`)
  return result
}

function snapshot<T>(value: T): T {
  return structuredClone(value)
}

export class FleetCalendar {
  private readonly events = new Map<string, FleetCalendarEvent>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly listeners = new Set<(event: FleetCalendarEventChange) => void>()
  private closed = false

  constructor(
    private readonly directory: FleetMemberDirectory,
    private readonly onStart: (event: FleetCalendarEvent) => string | undefined,
    private readonly canManage: (agentId: string) => boolean = () => false,
  ) {}

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
    if (event.organizer !== member && !event.attendees.includes(member)) {
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
      id: `event-${randomUUID()}`,
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
    this.emit({ action: 'created', event })
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
    this.emit({ action: 'updated', event: updated })
    return snapshot(updated)
  }

  rsvp(callerId: string, id: string, response: Exclude<FleetCalendarRsvp, 'invited'>): FleetCalendarEvent {
    const name = this.member(callerId)
    const current = this.requireEvent(id)
    if (!current.attendees.includes(name)) throw new Error(`Fleet member ${name} is not invited to ${id}`)
    const updated = {
      ...current,
      rsvps: { ...current.rsvps, [name]: response },
      updatedAt: new Date().toISOString(),
    }
    this.events.set(id, updated)
    this.emit({ action: 'rsvp', event: updated })
    return snapshot(updated)
  }

  closeEvent(callerId: string, id: string): FleetCalendarEvent {
    const current = this.requireEvent(id)
    this.requireOrganizer(callerId, current)
    const updated = { ...current, status: 'closed' as const, updatedAt: new Date().toISOString() }
    this.replace(updated)
    this.emit({ action: 'closed', event: updated })
    return snapshot(updated)
  }

  cancel(callerId: string, id: string): FleetCalendarEvent {
    const current = this.requireEvent(id)
    this.requireOrganizer(callerId, current)
    const updated = { ...current, status: 'cancelled' as const, updatedAt: new Date().toISOString() }
    this.replace(updated)
    this.emit({ action: 'cancelled', event: updated })
    return snapshot(updated)
  }

  retireMember(retired: string, successor: string): void {
    for (const event of [...this.events.values()]) {
      if (event.status === 'closed' || event.status === 'cancelled') continue
      if (event.organizer !== retired && !event.attendees.includes(retired)) continue
      const organizer = event.organizer === retired ? successor : event.organizer
      const attendees = event.attendees.filter(member => member !== retired && member !== organizer)
      const { [retired]: _retiredRsvp, [organizer]: _organizerRsvp, ...rsvps } = event.rsvps
      const updated: FleetCalendarEvent = {
        ...event,
        organizer,
        attendees,
        rsvps,
        status: attendees.length === 0 ? 'cancelled' : event.status,
        updatedAt: new Date().toISOString(),
      }
      this.replace(updated)
      this.emit({ action: updated.status === 'cancelled' ? 'cancelled' : 'updated', event: updated })
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
      const name = this.resolve(reference)
      return { member: name, events: [...this.events.values()].filter(event =>
        event.status !== 'cancelled'
        && (event.organizer === name || event.attendees.includes(name))
        && new Date(event.startAt).getTime() < end
        && new Date(event.endAt ?? event.startAt).getTime() >= start,
      ).map(snapshot) }
    })
  }

  restore(events: readonly FleetCalendarEventChange[]): void {
    this.assertOpen()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.events.clear()
    for (const event of events) this.events.set(event.event.id, snapshot(event.event))
    for (const event of this.events.values()) if (event.status === 'scheduled') this.arm(event)
  }

  pendingStarts(): FleetCalendarEvent[] {
    return [...this.events.values()]
      .filter(event => event.status === 'open' && event.meetingId === undefined)
      .map(snapshot)
  }

  linkMeeting(id: string, meetingId: string): FleetCalendarEvent {
    const current = this.requireEvent(id)
    const linkedMeetingId = text(meetingId, 'meeting id')
    const nextStart = current.status === 'open' && current.repeatMinutes !== undefined
      ? new Date(new Date(current.startAt).getTime() + current.repeatMinutes * 60_000)
      : undefined
    const duration = current.endAt === undefined
      ? undefined
      : new Date(current.endAt).getTime() - new Date(current.startAt).getTime()
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
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private trigger(id: string): void {
    const current = this.events.get(id)
    if (current === undefined || current.status !== 'scheduled') return
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
    const delay = Math.max(0, new Date(event.startAt).getTime() - Date.now())
    const timer = setTimeout(() => {
      this.timers.delete(event.id)
      const remaining = new Date(event.startAt).getTime() - Date.now()
      if (remaining > 0) this.arm(event)
      else this.trigger(event.id)
    }, Math.min(delay, 2_147_483_647))
    timer.unref?.()
    this.timers.set(event.id, timer)
  }

  private replace(event: FleetCalendarEvent): void {
    const timer = this.timers.get(event.id)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(event.id)
    this.events.set(event.id, event)
    if (event.status === 'scheduled') this.arm(event)
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
    const name = this.member(agentId)
    if (name !== event.organizer && !this.canManage(agentId)) {
      throw new Error(`Fleet member ${name} cannot manage calendar event ${event.id}`)
    }
  }

  private requireEvent(id: string): FleetCalendarEvent {
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
    startAt: { type: 'string', required: true }, endAt: { type: 'string' }, repeatMinutes: { type: 'integer' },
    occurrence: { type: 'integer', required: true },
    status: { type: 'string', required: true, enum: ['scheduled', 'open', 'closed', 'cancelled'] },
    meetingId: { type: 'string' }, lastStartedAt: { type: 'string' }, lastMeetingClosedAt: { type: 'string' },
    createdAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
  },
} as const

const CALENDAR_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'update', 'rsvp', 'cancel', 'close', 'freebusy'] },
    event: CALENDAR_SCHEMA,
    events: { type: 'array', items: CALENDAR_SCHEMA },
    freebusy: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      member: { type: 'string', required: true },
      events: { type: 'array', required: true, items: CALENDAR_SCHEMA },
    } } },
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

export function installCalendarTools(ctx: Context, calendar: FleetCalendar): () => void {
  return ctx.tools.register(defineTool({
    name: 'fleet_calendar',
    description: 'Manage persistent Team calendar events, attendees, RSVP, recurrence, free/busy, and scheduled Fleet Meetings.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'create', 'update', 'rsvp', 'cancel', 'close', 'freebusy'] },
      id: { type: 'string' }, title: { type: 'string' }, agenda: { type: 'string' },
      attendees: { type: 'array', items: { type: 'string' } },
      start_at: { type: 'string' }, end_at: { type: 'string' }, repeat_minutes: { type: 'integer' },
      response: { type: 'string', enum: ['accepted', 'declined', 'tentative'] },
      from: { type: 'string' }, to: { type: 'string' }, members: { type: 'array', items: { type: 'string' } },
    },
    output: jsonOutput(CALENDAR_RESULT_SCHEMA),
    execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('fleet_calendar requires a calling Agent')
      const callerId = String(agent.id)
      if (args.action === 'list') return Promise.resolve({ action: 'list' as const, events: calendar.list(callerId, args.from, args.to) })
      if (args.action === 'freebusy') {
        if (args.from === undefined || args.to === undefined || args.members === undefined) {
          throw new Error('fleet_calendar freebusy requires from, to, and members')
        }
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
        ...(args.attendees === undefined ? {} : { attendees: args.attendees }),
        ...(args.start_at === undefined ? {} : { startAt: args.start_at }), ...(args.end_at === undefined ? {} : { endAt: args.end_at }),
      }) })
      if (args.action === 'rsvp') {
        if (args.response === undefined) throw new Error('fleet_calendar rsvp requires response')
        return Promise.resolve({ action: 'rsvp' as const, event: calendar.rsvp(callerId, args.id, args.response) })
      }
      return Promise.resolve({ action: args.action, event: args.action === 'cancel'
        ? calendar.cancel(callerId, args.id)
        : calendar.closeEvent(callerId, args.id) })
    },
  }))
}
