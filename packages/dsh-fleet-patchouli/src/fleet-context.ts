import type { Context } from '@deepseek-ai/cordis'
import type { FleetRunRecord } from 'dsh-agent-fleet'

import type {
  FleetMemoryEffort,
  MemoryRequest,
  MemoryRouteCall,
} from './patchouli.js'

export interface FleetRunsLike {
  list(): FleetRunRecord[]
  recordDataEvent(runId: string, type: 'memory.recalled', data: unknown): void
  /** Search the stable Fleet message log, newest messages first. */
  searchParticipantMessages(
    runId: string,
    participant: string,
    query: string,
    limit: number,
  ): Promise<readonly FleetMessageLike[]>
}

export interface FleetMessageLike {
  readonly id: string
  readonly sequence: number
  readonly conversation: string
  readonly conversationId?: string
  readonly from: string
  readonly text: string
  readonly createdAt: string
}

export interface FleetCaller {
  readonly team: FleetRunRecord
  readonly participant: string
  readonly kind: 'member' | 'assistant'
  readonly sessionId: string
}

export function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

export function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function service<T>(ctx: Context, name: string): T | undefined {
  return ctx.get(name, false) as T | undefined
}

export function requestQuery(request: MemoryRequest): string | undefined {
  return string(record(request.data)?.query)?.trim() || undefined
}

export function callerSessionId(call: MemoryRouteCall): string | undefined {
  if (call.operation !== 'retrieve' || call.meta.source.type !== 'agent-loop') return undefined
  return string(call.meta.attributes?.sessionId)
}

export function fleetCaller(runs: FleetRunsLike, sessionId: string): FleetCaller | undefined {
  for (const team of runs.list()) {
    const member = team.members.find(candidate => candidate.sessionId === sessionId)
    if (member !== undefined) {
      return { team, participant: member.name, kind: 'member', sessionId }
    }
    const assistant = team.assistants.find(candidate => candidate.sessionId === sessionId)
    if (assistant !== undefined) {
      return { team, participant: assistant.view.id, kind: 'assistant', sessionId }
    }
  }
  return undefined
}

export function positiveLimit(value: unknown, effort: FleetMemoryEffort): number {
  const maximum = effort === 'low' ? 10 : effort === 'medium' ? 50 : 100
  const fallback = effort === 'low' ? 10 : effort === 'medium' ? 20 : 50
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback
}
