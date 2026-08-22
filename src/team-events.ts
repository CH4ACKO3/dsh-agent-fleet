import type { Context, Events } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { Scoped } from '@deepseek-ai/dsh-scope'
import type {
  MessageAgent,
  SendMessageDecision,
  SendMessageInput,
} from '@dsh-agent-fleet/message'

import type { FleetCollaborationTeam } from './collaboration.js'

export type FleetTeamSessionStartSource = 'create' | 'resume'
export type FleetMemberSetupSource = 'create' | 'resume'

export interface FleetTeamLiveEvent {
  readonly sequence: number
  readonly createdAt: string
  readonly type: string
  readonly data: unknown
  readonly member?: {
    readonly name: string
    readonly sessionId: string
    readonly sequence: number
  }
}

export interface FleetWorkProposal {
  readonly taskPath: string
  readonly task: string
}

export type FleetWorkDecision = {
  readonly kind: 'reject'
  readonly reason: string
} | {
  readonly kind: 'start'
  readonly task: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A live Team finished creating or resuming. This notification is not replayed from history. */
    'fleet/team/session-start'(this: Scoped<FleetCollaborationTeam>, payload: {
      readonly team: FleetCollaborationTeam
      readonly source: FleetTeamSessionStartSource
    }): void

    /** Compose one unpublished member Agent after Fleet installed its built-in tools. */
    'fleet/member/setup'(this: Scoped<FleetCollaborationTeam>, payload: {
      readonly team: FleetCollaborationTeam
      readonly member: string
      readonly source: FleetMemberSetupSource
      readonly agent: Agent
      readonly ctx: Context
    }): void | Promise<void>

    /** Reject or replace authored message content before validation, persistence, and delivery. */
    'fleet/message/pre-send'(this: Scoped<FleetCollaborationTeam>, payload: {
      readonly team: FleetCollaborationTeam
      readonly sender: MessageAgent
      readonly input: SendMessageInput
    }, next: () => SendMessageDecision): SendMessageDecision

    /** Reject or replace a work description before the accepted snapshot is persisted. */
    'fleet/work/pre-start'(this: Scoped<FleetCollaborationTeam>, payload: {
      readonly team: FleetCollaborationTeam
      readonly proposal: FleetWorkProposal
    }, next: () => FleetWorkDecision): FleetWorkDecision

    /** A Team-domain event was durably appended. Session events use the native session/event hook. */
    'fleet/team/event'(this: Scoped<FleetCollaborationTeam>, payload: {
      readonly team: FleetCollaborationTeam
      readonly event: FleetTeamLiveEvent
    }): void

    /** The live Team stopped accepting work and its scoped registrations are about to unwind. */
    'fleet/team/disposed'(this: Scoped<FleetCollaborationTeam>, payload: {
      readonly team: FleetCollaborationTeam
    }): void
  }
}

type Params<F> = F extends (...args: infer P) => unknown ? P : never
type Return<F> = F extends (...args: never[]) => infer R ? R : never

export type FleetTeamSubjectEvent = {
  [K in keyof Events]: Events[K] extends (
    this: Scoped<FleetCollaborationTeam>,
    ...args: infer P
  ) => unknown
    ? P extends [infer Payload, ...unknown[]]
      ? Payload extends { team: FleetCollaborationTeam } ? K : never
      : never
    : never
}[keyof Events]

type PayloadOf<K extends FleetTeamSubjectEvent> = Params<Events[K]> extends [infer Payload, ...unknown[]]
  ? Payload
  : never
type Tail<K extends FleetTeamSubjectEvent> = Params<Events[K]> extends [unknown, ...infer Rest] ? Rest : never
type PayloadRest<K extends FleetTeamSubjectEvent> = Omit<PayloadOf<K> & object, 'team'>

export interface FleetTeamEventDispatch {
  emit<K extends FleetTeamSubjectEvent>(name: K, payload: PayloadRest<K>): void
  serial<K extends FleetTeamSubjectEvent>(name: K, payload: PayloadRest<K>): Promise<Awaited<Return<Events[K]>>>
  waterfall<K extends FleetTeamSubjectEvent>(
    name: K,
    payload: PayloadRest<K>,
    ...rest: Tail<K>
  ): Return<Events[K]>
}

/** Couple the live Team subject to its scope carrier, following the native Agent event pattern. */
export function fleetTeamEvents(ctx: Context, team: FleetCollaborationTeam): FleetTeamEventDispatch {
  const carrier = scopeTarget(team, team)
  const fused = (payload: object): object => ({ ...payload, team })
  return {
    emit(name, payload) {
      if (typeof ctx.events?.dispatch !== 'function') return
      const args = [carrier, name, fused(payload)]
      const callbacks = ctx.events.dispatch('emit', args)
      for (const callback of callbacks) {
        try {
          const returned = callback(...args)
          void Promise.resolve(returned).catch(error => {
            ctx.logger.warn(`Fleet event "${String(name)}" listener rejected: ${String(error)}`)
          })
        } catch (error) {
          ctx.logger.warn(`Fleet event "${String(name)}" listener threw: ${String(error)}`)
        }
      }
    },
    serial(name, payload) {
      if (typeof ctx.serial !== 'function') return Promise.resolve(undefined) as Promise<Awaited<Return<Events[typeof name]>>>
      const serial = ctx.serial as unknown as (...args: unknown[]) => Promise<unknown>
      return serial(carrier, name, fused(payload)) as Promise<Awaited<Return<Events[typeof name]>>>
    },
    waterfall(name, payload, ...rest) {
      if (typeof ctx.waterfall !== 'function') {
        const next = rest.at(-1)
        return (typeof next === 'function' ? next() : undefined) as Return<Events[typeof name]>
      }
      const waterfall = ctx.waterfall as unknown as (...args: unknown[]) => unknown
      return waterfall(carrier, name, fused(payload), ...rest) as Return<Events[typeof name]>
    },
  }
}
