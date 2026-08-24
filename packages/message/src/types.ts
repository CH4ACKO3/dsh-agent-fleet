import type { UserMessage } from '@deepseek-ai/dsh-session'

export interface MessageAgent {
  readonly id: string
  /** Native pending context, when the backing runtime is a DSH Agent. */
  readonly inbox?: {
    readonly nextTurn: readonly UserMessage[]
    readonly nextStep: readonly UserMessage[]
    replace(messageId: UserMessage['id'], newMessage: UserMessage): boolean
    remove(messageId: UserMessage['id']): boolean
  }
  inject(message: UserMessage): void
  followup(message: UserMessage): void
  steer(message: UserMessage): void
  cancel(cause: { readonly kind: 'user' | 'parent' }, options?: { readonly keepInbox?: boolean }): void
}

export interface AgentDirectory {
  get(id: string): MessageAgent | undefined
  list(): MessageAgent[]
  resolve?(reference: string): string
  displayName?(id: string): string | undefined
  canContact?(senderId: string, recipientId: string): boolean
  canAccessChannel?(agentId: string, channelId: string): boolean
  hasPermission?(agentId: string, permission: FleetMessagePermission): boolean
  defaultVoter?(agentId: string): boolean
  canVote?(agentId: string): boolean
}

export type FleetMessagePermission = 'channel.manage' | 'meeting.manage' | 'vote.create'

export type FleetTarget = `@${string}` | `#${string}` | `meeting:${string}`
export type FleetDelivery = 'quiet' | 'wakeup' | 'interrupt'
export type FleetMessageKind =
  | 'text'
  | 'meeting_opened'
  | 'meeting_closed'
  | 'vote_opened'
  | 'vote_cast'
  | 'vote_closed'
  | 'task_notification'
  | 'calendar_notification'

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
  /** Internal service classification; ordinary tool calls omit this. */
  readonly kind?: FleetMessageKind
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
  readonly maxChars?: number
  readonly unreadOnly?: boolean
}

export interface FleetMessageReadRange {
  readonly start: number
  readonly end: number
  readonly total: number
}

export interface FleetReadMessage extends FleetMessage {
  /** Exact text range returned by this read operation. */
  readonly readRange: FleetMessageReadRange
}

export interface ReadMessagesResult {
  readonly messages: FleetReadMessage[]
  readonly hasMore: boolean
  readonly revision: number
}

export interface FleetMessageTextChunk {
  readonly messageId: string
  readonly offset: number
  readonly text: string
  readonly totalLength: number
  readonly hasMore: boolean
  readonly nextOffset?: number
  readonly readThrough: number
}

export interface SearchMessagesInput {
  readonly query?: string
  readonly conversation?: FleetTarget
  readonly from?: string
  readonly resource?: string
  readonly limit?: number
}

export interface FleetMessageReaction {
  readonly messageId: string
  readonly reaction: string
  readonly members: string[]
  readonly updatedAt: string
}

export interface FleetMessagePin {
  readonly messageId: string
  readonly conversation: FleetTarget
  readonly pinnedBy: string
  readonly createdAt: string
}

export interface FleetInboxItem {
  readonly message: FleetMessage
  readonly reasons: Array<'direct' | 'mention' | 'meeting'>
  readonly acknowledged: boolean
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
  readonly topic?: string
  readonly summary?: string
  readonly body?: string
  readonly addMembers?: readonly string[]
  readonly removeMembers?: readonly string[]
}

export interface FleetMeeting {
  readonly id: string
  readonly title: string
  readonly agenda: string
  readonly initiator: string
  readonly participants: string[]
  readonly attendance: Record<string, { readonly joinedAt: string; readonly leftAt?: string }>
  readonly status: 'open' | 'closed'
  readonly summary?: string
  readonly decisions: string[]
  readonly actionItems: Array<{
    readonly text: string
    readonly assignee?: string
    readonly taskId?: string
  }>
  readonly resources: string[]
  readonly createdAt: string
  readonly closedAt?: string
}

export interface OpenMeetingInput {
  readonly id: string
  readonly title: string
  readonly agenda: string
  readonly participants: readonly string[]
}

export interface CloseMeetingInput {
  readonly summary?: string
  readonly decisions?: readonly string[]
  readonly actionItems?: readonly {
    readonly text: string
    readonly assignee?: string
    readonly taskId?: string
  }[]
  readonly resources?: readonly string[]
}

export interface WaitResult {
  readonly timedOut: boolean
  readonly revision: number
  readonly reason: 'changed' | 'timeout' | 'disconnected' | 'stopped'
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
  readonly voters?: readonly string[]
}

export interface CastVoteInput {
  /** May be omitted when the caller has exactly one open Vote awaiting its response. */
  readonly id?: string
  readonly response: 'approve' | 'reject'
  readonly reason?: string
}

export type FleetCoordinationEvent =
  | { readonly type: 'message'; readonly message: FleetMessage }
  | { readonly type: 'channel'; readonly action: 'created' | 'updated' | 'archived'; readonly channel: FleetChannel }
  | { readonly type: 'meeting'; readonly action: 'opened' | 'updated' | 'joined' | 'left' | 'closed'; readonly meeting: FleetMeeting }
  | { readonly type: 'vote'; readonly action: 'opened' | 'updated' | 'cast' | 'closed'; readonly vote: FleetVote }
  | { readonly type: 'reaction'; readonly action: 'updated' | 'removed'; readonly reaction: FleetMessageReaction }
  | { readonly type: 'pin'; readonly action: 'pinned' | 'unpinned'; readonly pin: FleetMessagePin }
  | {
      readonly type: 'inbox'
      readonly action: 'delivered'
      readonly agentId: string
      readonly messageId: string
      /** Native DSH UserMessage id injected into this Agent's context. */
      readonly contextMessageId: string
    }
  | {
      readonly type: 'inbox'
      readonly action: 'read'
      readonly agentId: string
      readonly messageId: string
      /** Cumulative contiguous character offset returned by fleet_messages read/text. */
      readonly through: number
    }
  /** Legacy persisted terminal receipt. New writes use the cumulative read action. */
  | { readonly type: 'inbox'; readonly action: 'acknowledged'; readonly agentId: string; readonly messageId: string }
