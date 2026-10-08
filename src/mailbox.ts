import type { FleetCoordinationEvent, FleetMessage, FleetExternalSource } from '@dsh-agent-fleet/message'

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
    readonly external: FleetExternalSource
  }): { readonly messageId: string }
  pendingMailboxReplies(): Array<{ runId: string; message: FleetMessage }>
  acknowledgeMailboxReply(runId: string, messageId: string): void
  subscribeCoordination(listener: (runId: string, event: FleetCoordinationEvent) => void): () => void
}

const MAX_RECENT_INBOUND_MESSAGES = 4_096

export class FleetMailboxService implements FleetMailboxPort {
  private readonly listeners = new Set<(message: FleetMailboxGatewayOutbound) => Promise<void>>()
  private draining = false
  private retry: ReturnType<typeof setTimeout> | undefined
  private readonly recentInbound = new Set<string>()
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
    const messageKey = JSON.stringify([
      message.connector, payload.externalUserId, payload.conversationId, payload.messageId,
      run.id, assistant.view.id,
    ])
    if (this.recentInbound.has(messageKey)) return
    this.recentInbound.add(messageKey)
    try {
      this.runs.sendUserConversationMessage({
        runId: run.id,
        to: `@${assistant.view.id}`,
        text: payload.text,
        delivery: 'wakeup',
        external: { connector: message.connector, conversationId: payload.conversationId,
          externalUserId: payload.externalUserId, messageId: payload.messageId },
      })
    } catch (error) {
      this.recentInbound.delete(messageKey)
      throw error
    }
    if (this.recentInbound.size > MAX_RECENT_INBOUND_MESSAGES) {
      this.recentInbound.delete(this.recentInbound.values().next().value!)
    }
  }

  onOutbound(listener: (message: FleetMailboxGatewayOutbound) => Promise<void>): () => void {
    this.listeners.add(listener)
    this.scheduleDrain()
    return () => { this.listeners.delete(listener) }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.stopCoordination()
    if (this.retry !== undefined) clearTimeout(this.retry)
    this.recentInbound.clear()
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

  private coordination(_runId: string, event: FleetCoordinationEvent): void {
    if (event.type === 'message') this.scheduleDrain()
  }

  private scheduleDrain(): void {
    if (this.closed || this.draining || this.listeners.size === 0) return
    this.draining = true
    queueMicrotask(() => { void this.drain() })
  }

  private async drain(): Promise<void> {
    try {
      for (const { runId, message } of this.runs.pendingMailboxReplies()) {
        if (this.closed || this.listeners.size === 0) break
        const route = message.external
        if (route === undefined) continue
        const outbound: FleetMailboxGatewayOutbound = {
          connector: route.connector,
          payload: { kind: 'user-message', conversationId: route.conversationId, text: message.text } satisfies FleetUserMailboxOutbound,
        }
        try {
          await Promise.all([...this.listeners].map(listener => listener(outbound)))
          if (!this.closed) this.runs.acknowledgeMailboxReply(runId, message.id)
        } catch (error) {
          this.warn(`Fleet Mailbox outbound delivery failed: ${errorText(error)}`)
        }
      }
    } catch (error) {
      this.warn(`Fleet Mailbox outbound delivery failed: ${errorText(error)}`)
    } finally {
      this.draining = false
      // The journal is the outbox. Failed delivery remains pending across
      // retries/restarts; only a successful connector call writes its receipt.
      if (!this.closed && this.listeners.size > 0 && this.retry === undefined
        && this.runs.pendingMailboxReplies().length > 0) {
        this.retry = setTimeout(() => {
          this.retry = undefined
          this.scheduleDrain()
        }, 1_000)
        this.retry.unref?.()
      }
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
