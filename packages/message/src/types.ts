import type { UserMessage } from '@deepseek-ai/dsh-session'

export interface MessageAgent {
  readonly id: string
  inject(message: UserMessage): void
  followup(message: UserMessage): void
}

export interface AgentDirectory {
  get(id: string): MessageAgent | undefined
  list(): MessageAgent[]
}

export type FleetTarget = `@${string}` | `#${string}` | `meeting:${string}`
export type FleetDelivery = 'quiet' | 'wakeup'
export type FleetMessageKind = 'text' | 'meeting_opened' | 'meeting_closed'

export interface FleetMessage {
  readonly id: string
  readonly sequence: number
  readonly kind: FleetMessageKind
  readonly conversation: FleetTarget
  readonly from: string
  readonly text: string
  readonly replyTo?: string
  readonly resources: string[]
  readonly mentions: string[]
  readonly delivery: FleetDelivery
  readonly createdAt: string
}

export interface SendMessageInput {
  readonly to: FleetTarget
  readonly text: string
  readonly replyTo?: string
  readonly resources?: readonly string[]
  readonly mentions?: readonly string[]
  readonly delivery: FleetDelivery
}

export interface SendMessageResult {
  readonly messageId: string
  readonly recipients: number
  readonly woken: number
}

export interface ReadMessagesInput {
  readonly conversation: FleetTarget
  readonly after?: string
  readonly limit?: number
}

export interface ReadMessagesResult {
  readonly messages: FleetMessage[]
  readonly hasMore: boolean
  readonly revision: number
}

export interface FleetChannel {
  readonly id: string
  readonly name: string
  readonly topic: string
  readonly open: boolean
  readonly members: string[]
  readonly createdBy: string
  readonly createdAt: string
  readonly archived: boolean
}

export interface CreateChannelInput {
  readonly name: string
  readonly topic?: string
  readonly members?: readonly string[]
}

export interface FleetMeeting {
  readonly id: string
  readonly title: string
  readonly agenda: string
  readonly initiator: string
  readonly participants: string[]
  readonly status: 'open' | 'closed'
  readonly createdAt: string
  readonly closedAt?: string
}

export interface OpenMeetingInput {
  readonly id: string
  readonly title: string
  readonly agenda: string
  readonly participants: readonly string[]
}

export interface WaitResult {
  readonly timedOut: boolean
  readonly revision: number
}
