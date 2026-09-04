import type { FleetCoordinationEvent } from '@dsh-agent-fleet/message'

import type { FleetRunRecord, FleetRunService } from './run.js'

export interface FleetMailboxGatewayInbound {
  readonly connector: string
  readonly payload: unknown
}

export interface FleetMailboxGatewayOutbound {
  readonly connector: string
  readonly payload: unknown
}

export interface FleetMailboxPort {
  receive(message: FleetMailboxGatewayInbound, signal: AbortSignal): Promise<void>
  onOutbound(listener: (message: FleetMailboxGatewayOutbound) => Promise<void>): () => void
}

export interface FleetUserMailboxInbound {
  readonly kind: 'user-message'
  readonly teamId?: string
  readonly assistantId?: string
  readonly externalUserId: string
  readonly conversationId: string
  readonly messageId: string
  readonly text: string
}

export interface FleetUserMailboxOutbound {
  readonly kind: 'user-message'
  readonly conversationId: string
  readonly text: string
}

interface FleetMailboxRuns {
  list(): FleetRunRecord[]
  status(runId: string): FleetRunRecord
  sendUserConversationMessage(input: {
    readonly runId: string
    readonly to: `@${string}`
    readonly text: string
    readonly delivery: 'wakeup'
  }): unknown
  subscribeCoordination(listener: (runId: string, event: FleetCoordinationEvent) => void): () => void
}

interface UserRoute {
  readonly connector: string
  readonly conversationId: string
}

export class FleetMailboxService implements FleetMailboxPort {
  private readonly listeners = new Set<(message: FleetMailboxGatewayOutbound) => Promise<void>>()
  private readonly routes = new Map<string, UserRoute>()
  private readonly stopCoordination: () => void
  private closed = false

  constructor(
    private readonly runs: FleetMailboxRuns,
    private readonly warn: (message: string) => void = () => {},
  ) {
    this.stopCoordination = runs.subscribeCoordination((runId, event) => this.coordination(runId, event))
  }

  async receive(message: FleetMailboxGatewayInbound, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.closed) throw new Error('Fleet Mailbox is closed')
    const payload = parseUserMessage(message.payload)
    const run = this.resolveRun(payload.teamId)
    const assistant = resolveAssistant(run, payload.assistantId)
    this.routes.set(routeKey(run.id, assistant.view.id), {
      connector: message.connector,
      conversationId: payload.conversationId,
    })
    this.runs.sendUserConversationMessage({
      runId: run.id,
      to: `@${assistant.view.id}`,
      text: payload.text,
      delivery: 'wakeup',
    })
  }

  onOutbound(listener: (message: FleetMailboxGatewayOutbound) => Promise<void>): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.stopCoordination()
    this.routes.clear()
    this.listeners.clear()
  }

  private resolveRun(teamId: string | undefined): FleetRunRecord {
    if (teamId !== undefined) return this.runs.status(teamId)
    const candidates = this.runs.list().filter(run =>
      (run.status === 'idle' || run.status === 'running')
      && run.runtimeState !== 'dormant'
      && run.assistants.length > 0)
    if (candidates.length !== 1) {
      throw new Error('Fleet user Mailbox requires a teamId when there is not exactly one active Team with an assistant')
    }
    return candidates[0]!
  }

  private coordination(runId: string, event: FleetCoordinationEvent): void {
    if (this.closed || event.type !== 'message' || event.message.conversation !== `@fleet-user:${runId}`) return
    const run = this.runs.status(runId)
    const assistant = run.assistants.find(candidate => candidate.sessionId === event.message.from)
    if (assistant === undefined) return
    const route = this.routes.get(routeKey(runId, assistant.view.id))
    if (route === undefined) return
    const outbound: FleetMailboxGatewayOutbound = {
      connector: route.connector,
      payload: {
        kind: 'user-message',
        conversationId: route.conversationId,
        text: event.message.text,
      } satisfies FleetUserMailboxOutbound,
    }
    for (const listener of this.listeners) {
      void listener(outbound).catch(error => {
        this.warn(`Fleet Mailbox outbound delivery failed: ${errorText(error)}`)
      })
    }
  }
}

export function createFleetMailbox(runs: FleetRunService, warn?: (message: string) => void): FleetMailboxService {
  return new FleetMailboxService(runs, warn)
}

function resolveAssistant(run: FleetRunRecord, assistantId: string | undefined): FleetRunRecord['assistants'][number] {
  if (run.status !== 'idle' && run.status !== 'running') {
    throw new Error(`Fleet team ${run.id} cannot receive user Mailbox messages while ${run.status}`)
  }
  const candidates = assistantId === undefined
    ? run.assistants
    : run.assistants.filter(assistant => assistant.view.id === assistantId)
  if (candidates.length !== 1) {
    const reason = assistantId === undefined ? 'does not have exactly one connected assistant' : `has no connected assistant ${assistantId}`
    throw new Error(`Fleet team ${run.id} ${reason}`)
  }
  return candidates[0]!
}

function parseUserMessage(value: unknown): FleetUserMailboxInbound {
  if (!isRecord(value) || value.kind !== 'user-message') {
    throw new TypeError('Fleet Mailbox only accepts user-message payloads')
  }
  requireString(value, 'externalUserId')
  requireString(value, 'conversationId')
  requireString(value, 'messageId')
  requireString(value, 'text')
  optionalString(value, 'teamId')
  optionalString(value, 'assistantId')
  return value as unknown as FleetUserMailboxInbound
}

function routeKey(teamId: string, assistantId: string): string {
  return `${teamId}\u0000${assistantId}`
}

function requireString(value: Record<string, unknown>, field: string): void {
  if (typeof value[field] !== 'string' || value[field].length === 0) {
    throw new TypeError(`Fleet Mailbox ${field} must be a non-empty string`)
  }
}

function optionalString(value: Record<string, unknown>, field: string): void {
  if (value[field] !== undefined) requireString(value, field)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
