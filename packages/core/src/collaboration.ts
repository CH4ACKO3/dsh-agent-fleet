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

export interface FleetMemberDirectory {
  list(): readonly { readonly id: string; readonly name: string }[]
  nameForAgent(id: string): string | undefined
  resolve(reference: string): string | undefined
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`${label} cannot be empty`)
  return normalized
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

  set(callerId: string, message: string): FleetMemberStatus {
    const name = member(this.directory, callerId)
    const normalized = requiredText(message, 'member status')
    if (normalized.length > FLEET_MEMBER_STATUS_MAX_LENGTH) {
      throw new Error(`member status cannot exceed ${FLEET_MEMBER_STATUS_MAX_LENGTH} characters`)
    }
    const status: FleetMemberStatus = { member: name, message: normalized, updatedAt: new Date().toISOString() }
    this.statuses.set(name, status)
    this.emit({ action: 'updated', status: { ...status } })
    return { ...status }
  }

  clear(callerId: string): FleetMemberStatus {
    const name = member(this.directory, callerId)
    this.statuses.delete(name)
    this.emit({ action: 'cleared', member: name })
    return this.getByName(name)
  }

  retireMember(name: string): void {
    if (this.statuses.delete(name)) this.emit({ action: 'cleared', member: name })
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

  onEvent(listener: (event: FleetMemberStatusEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private getByName(name: string): FleetMemberStatus {
    const status = this.statuses.get(name)
    return status === undefined ? { member: name, message: '' } : { ...status }
  }

  private emit(event: FleetMemberStatusEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
}

const MEMBER_STATUS_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    member: { type: 'string', required: true }, message: { type: 'string', required: true }, updatedAt: { type: 'string' },
  },
} as const

const MEMBER_STATUS_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'get', 'set', 'clear'] },
    statuses: { type: 'array', items: MEMBER_STATUS_SCHEMA }, status: MEMBER_STATUS_SCHEMA,
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return { schema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

function callingAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('fleet_member_status requires a calling Agent')
  return agent
}

export function installCollaborationTools(ctx: Context, statuses: FleetMemberStatusBoard): () => void {
  const stop = ctx.tools.register(defineTool({
    name: 'fleet_member_status',
    description: `Read Team members' current work, or update your own short status text. Status text is limited to ${FLEET_MEMBER_STATUS_MAX_LENGTH} characters.`,
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'get', 'set', 'clear'] },
      member: { type: 'string', description: 'Member name or @member for get.' },
      message: { type: 'string', description: `Your current work in at most ${FLEET_MEMBER_STATUS_MAX_LENGTH} characters. Required for set.` },
    },
    output: jsonOutput(MEMBER_STATUS_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent)
      const callerId = String(caller.id)
      if (args.action === 'list') return { action: 'list' as const, statuses: statuses.list(callerId) }
      if (args.action === 'get') {
        if (args.member === undefined) throw new Error('fleet_member_status get requires member')
        return { action: 'get' as const, status: statuses.get(callerId, args.member) }
      }
      if (args.action === 'set') {
        if (args.message === undefined) throw new Error('fleet_member_status set requires message')
        return { action: 'set' as const, status: statuses.set(callerId, args.message) }
      }
      return { action: 'clear' as const, status: statuses.clear(callerId) }
    },
  }))
  return stop
}
