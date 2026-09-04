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

const AUTOMATIC_QUERY_LIMIT = 512

function messageText(value: unknown): string | undefined {
  const message = record(value)
  const source = record(message?.source)
  if (source?.kind !== 'user'
    && !(source?.kind === 'plugin' && source.plugin === 'dsh-agent-fleet')) return undefined
  const content = message?.content
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap(block => {
    const item = record(block)
    return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : []
  }).join('\n').trim()
  return text || undefined
}

function usefulAutomaticText(text: string): string | undefined {
  if (text.startsWith('System reminder, no reply:')
    || text.startsWith('Current runtime context.')
    || text.startsWith('<system-reminder>')) return undefined

  if (text.startsWith('[Fleet owner task list]')) {
    const title = /^- (.+?) \([^\r\n)]+\):/mu.exec(text)?.[1]?.trim()
    if (title !== undefined && title !== '') return title
  }

  const fleetEnvelope = /^\[Fleet [^\r\n\]]+\]\s*([^\r\n]+)/u.exec(text)?.[1]?.trim()
  const candidate = fleetEnvelope === undefined || fleetEnvelope === ''
    ? text.split(/\r?\n/u).find(line => line.trim() !== '')?.trim()
    : fleetEnvelope
  if (candidate === undefined || candidate === '') return undefined
  return candidate.slice(0, AUTOMATIC_QUERY_LIMIT)
}

export function service<T>(ctx: Context, name: string): T | undefined {
  return ctx.get(name, false) as T | undefined
}

export function requestQuery(request: MemoryRequest): string | undefined {
  const data = record(request.data)
  const explicit = string(data?.query)?.trim()
  if (explicit !== undefined && explicit !== '') return explicit
  if (request.meta.source.type !== 'agent-loop') return undefined
  if (request.meta.attributes?.point === 'agent/pre-step'
    && request.meta.attributes.step !== 1) return undefined
  const messages = data?.messages
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = messageText(messages[index])
    if (text === undefined) continue
    const query = usefulAutomaticText(text)
    if (query !== undefined) return query
  }
  return undefined
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
