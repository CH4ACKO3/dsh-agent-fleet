import type { UserMessage } from '@deepseek-ai/dsh-session'

export interface MessageAgent {
  readonly id: string
  inject(message: UserMessage): void
  followup(message: UserMessage): void
}

export interface AgentDirectory {
  get(id: string): MessageAgent | undefined
  list(): MessageAgent[]
  resolve?(reference: string): string
  displayName?(id: string): string | undefined
}

export type FleetTarget = `@${string}` | `#${string}` | `meeting:${string}`
export type FleetDelivery = 'quiet' | 'wakeup'
export type FleetMessageKind =
  | 'text'
  | 'meeting_opened'
  | 'meeting_closed'
  | 'vote_opened'
  | 'vote_cast'
  | 'vote_closed'

export interface FleetMessage {
  readonly id: string
  readonly sequence: number
  readonly kind: FleetMessageKind
  readonly conversation: FleetTarget
  readonly from: string
  readonly fromName?: string
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
  readonly summary: string
  readonly body: string
  readonly revision: number
  readonly open: boolean
  readonly members: string[]
  readonly createdBy: string
  readonly createdAt: string
  readonly archived: boolean
  readonly updatedAt: string
}

export interface CreateChannelInput {
  readonly name: string
  readonly topic?: string
  readonly members?: readonly string[]
  readonly summary?: string
  readonly body?: string
}

export interface InitializeChannelInput extends CreateChannelInput {
  readonly id: string
  readonly initialMessage?: string
}

export interface UpdateChannelInput {
  readonly summary?: string
  readonly body?: string
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

export type FleetVoteKind = 'start_work' | 'finish' | 'blocked' | 'message'
export type FleetVoteStatus = 'open' | 'approved' | 'rejected'

export interface FleetVote {
  readonly id: string
  readonly channel: `#${string}`
  readonly kind: FleetVoteKind
  readonly statement: string
  readonly initiator: string
  readonly voters: string[]
  readonly approvals: string[]
  readonly rejection?: { readonly voter: string; readonly reason: string }
  readonly status: FleetVoteStatus
  readonly createdAt: string
  readonly closedAt?: string
}

export interface CreateVoteInput {
  readonly channel: `#${string}`
  readonly kind: FleetVoteKind
  readonly statement: string
}

export interface CastVoteInput {
  readonly id: string
  readonly response: 'approve' | 'reject'
  readonly reason?: string
}

export type FleetCoordinationEvent =
  | { readonly type: 'message'; readonly message: FleetMessage }
  | { readonly type: 'channel'; readonly action: 'created' | 'updated' | 'archived'; readonly channel: FleetChannel }
  | { readonly type: 'meeting'; readonly action: 'opened' | 'closed'; readonly meeting: FleetMeeting }
  | { readonly type: 'vote'; readonly action: 'opened' | 'cast' | 'closed'; readonly vote: FleetVote }
