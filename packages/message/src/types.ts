import type { UserMessage } from '@deepseek-ai/dsh-session'

export interface MessageAgent {
  /** Stable Fleet participant id. */
  readonly id: string
  /** Current native Session used only as the delivery endpoint. */
  readonly sessionId?: string
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
  /** All stable Fleet participant ids, including participants without an active Session. */
  participantIds(): string[]
  list(): MessageAgent[]
  resolve?(reference: string): string
  conversationKey?(participantId: string): string
  displayName?(id: string): string | undefined
  canContact?(senderId: string, recipientId: string): boolean
  canAccessChannel?(agentId: string, channelId: string): boolean
  hasPermission?(agentId: string, permission: FleetMessagePermission): boolean
  defaultVoter?(agentId: string): boolean
  canVote?(agentId: string): boolean
}

export type FleetMessagePermission = 'channel.manage' | 'meeting.manage' | 'vote.create'

export type FleetTarget = `@${string}` | `#${string}` | `meeting:${string}`
export type FleetDelivery = 'fyi' | 'quiet' | 'wakeup' | 'interrupt'
export type FleetSystemNotificationKind =
  | 'message_notice'
  | 'work_start'
  | 'work_resume'
  | 'member_joined'
  | 'team_settings'
  | 'team_wake'
  | 'team_quiescent'
  | 'network_recovery'
  | 'task_notice'
  | 'visibility_reminder'
  | 'sole_active_fyi'
  | 'schedule_notice'
  | 'calendar_notice'
export type FleetMessageKind =
  | 'text'
  | 'reply'
  | 'work_directive'
  | 'meeting_opened'
  | 'meeting_closed'
  | 'vote_opened'
  | 'vote_cast'
  | 'vote_closed'
  /** Legacy persisted kinds from before productivity updates became system notifications. */
  | 'task_notification'
  | 'calendar_notification'

export interface FleetMessage {
  readonly id: string
  readonly sequence: number
  readonly kind: FleetMessageKind
  readonly conversation: FleetTarget
  /** Stable UI/pagination identity; never contains a native Session id. */
  readonly conversationId?: string
  readonly from: string
  readonly fromName?: string
  /** Trusted host input that should retain native direct-human semantics when delivered. */
  readonly origin?: 'user'
  /** Immutable delivery audience selected when the message was created. Absent only on legacy events. */
  readonly recipientIds?: string[]
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

export interface ReplyMessageInput {
  readonly messageId: string
  readonly text: string
  readonly resources?: readonly string[]
}

export interface SendMessageResult {
  readonly messageId: string
  readonly recipients: number
  readonly delivered: number
  readonly woken: number
  /** Reply Tasks created by this message when the host exposes Task state. */
  readonly replyTaskIds?: string[]
  /** Non-blocking guidance when the selected audience is probably broader than necessary. */
  readonly audienceHint?: string
}

export interface FleetSystemNotificationInput {
  readonly kind: FleetSystemNotificationKind
  readonly text: string
  readonly delivery: FleetDelivery
  readonly coalesceKey?: string
  readonly relatedMessageId?: string
}

export interface FleetSystemNotificationResult {
  readonly contextMessageId: string
  readonly disposition: 'injected' | 'followed-up' | 'interrupted' | 'replaced'
}

export type SendMessageDecision = {
  readonly kind: 'reject'
  readonly reason: string
} | {
  readonly kind: 'send'
  readonly input: SendMessageInput
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
  /** Number of messages in this conversation that remain unread after this read. */
  readonly remainingUnread: number
  /** Total unread text characters still waiting in this conversation. */
  readonly remainingUnreadChars: number
  readonly revision: number
}

export interface FleetUnreadInbox {
  readonly conversation: FleetTarget
  readonly latestMessageId: string
  readonly unreadMessages: number
  readonly unreadChars: number
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

export interface FleetMessageReceipt {
  readonly messageId: string
  /** The conversation inbox that owns the message. */
  readonly inbox: FleetTarget
  /** Immutable delivery audience selected when the message was created. */
  readonly recipientIds: string[]
  readonly deliveredParticipantIds: string[]
  readonly pendingParticipantIds: string[]
  readonly pendingDeliveries: FleetPendingDelivery[]
  /** @deprecated Use deliveredParticipantIds. */
  readonly participantIds: string[]
  readonly readParticipantIds: string[]
  /** @deprecated Use deliveredParticipantIds minus readParticipantIds. */
  readonly unreadParticipantIds: string[]
  readonly readThrough: Record<string, number>
}

export type FleetDeliveryBlockReason = 'no_active_session' | 'inbox_delivery_failed' | 'participant_retired'

export interface FleetPendingDelivery {
  readonly participantId: string
  readonly reason: FleetDeliveryBlockReason
  readonly detail?: string
  readonly blockedAt: string
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
  /** Optional deterministic id for an idempotent host-coordinated Vote. */
  readonly id?: string
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
  | {
      readonly type: 'system_notification'
      readonly action: FleetSystemNotificationResult['disposition']
      readonly agentId: string
      readonly contextMessageId: string
      readonly notification: FleetSystemNotificationInput
    }
  | { readonly type: 'channel'; readonly action: 'created' | 'updated' | 'archived'; readonly channel: FleetChannel }
  | { readonly type: 'meeting'; readonly action: 'opened' | 'updated' | 'joined' | 'left' | 'closed'; readonly meeting: FleetMeeting }
  | { readonly type: 'vote'; readonly action: 'opened' | 'updated' | 'cast' | 'closed'; readonly vote: FleetVote }
  | { readonly type: 'reaction'; readonly action: 'updated' | 'removed'; readonly reaction: FleetMessageReaction }
  | { readonly type: 'pin'; readonly action: 'pinned' | 'unpinned'; readonly pin: FleetMessagePin }
  | {
      readonly type: 'inbox'
      readonly action: 'delivered'
      /** Receipt participant id. Kept as agentId for persisted-event compatibility. */
      readonly agentId: string
      /** Native Session that owns this individual delivery attempt. */
      readonly sessionId?: string
      readonly messageId: string
      /** Native DSH UserMessage id injected into this Agent's context. */
      readonly contextMessageId: string
      /** Only a full delivery can advance read state when claimed. */
      readonly content?: 'full' | 'notice'
    }
  | {
      readonly type: 'inbox'
      readonly action: 'superseded'
      readonly agentId: string
      readonly sessionId?: string
      readonly messageId: string
      readonly contextMessageId: string
      readonly content?: 'full' | 'notice'
    }
  | {
      readonly type: 'inbox'
      readonly action: 'blocked'
      readonly agentId: string
      readonly messageId: string
      readonly reason: FleetDeliveryBlockReason
      readonly detail?: string
      readonly blockedAt: string
    }
  | {
      readonly type: 'inbox'
      readonly action: 'read'
      readonly agentId: string
      readonly messageId: string
      /** Cumulative contiguous character offset returned by Inbox reads. */
      readonly through: number
    }
  /** Legacy persisted terminal receipt. New writes use the cumulative read action. */
  | { readonly type: 'inbox'; readonly action: 'acknowledged'; readonly agentId: string; readonly messageId: string }
