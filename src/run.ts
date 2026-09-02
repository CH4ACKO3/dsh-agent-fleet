import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  cpSync,
  createReadStream,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readlinkSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  renameSync,
  statSync,
  realpathSync,
  unlinkSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs'
import { readFile as readFileAsync } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, JsonValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { FleetCore, RuntimeRequestConfig } from '@dsh-agent-fleet/core'
import type {
  FleetMemberStatusBoard,
  FleetMemberStatusEvent,
} from '@dsh-agent-fleet/core'
import {
  generateFleetMemberColor,
  generateMemberDisplayName,
  normalizeFleetMemberColor,
} from '@dsh-agent-fleet/core/names'
import type {
  FleetCoordinationEvent,
  FleetMessage,
  FleetTarget,
  MessageHub,
  SendMessageResult,
} from '@dsh-agent-fleet/message'
import type { FleetResources } from '@dsh-agent-fleet/resources'
import type { FleetResourceEvent } from '@dsh-agent-fleet/resources'
import type { FleetResource } from '@dsh-agent-fleet/resources'
import { create as createTar, extract as extractTar } from 'tar'
import { FleetArchiveRegistry } from './archive.js'
import type { FleetArchiveRestoreReport, FleetArchiveTeam } from './archive.js'
import type { FleetAuthorizationActor, FleetAuthorizationBaseline, FleetAuthorizationService } from './authorization.js'
import type { FleetAssistantRuntime, FleetAssistantView } from './assistant.js'
import { FLEET_COLLABORATION_CONTRACT } from './collaboration-contract.js'
import type { FleetCollaborationService, FleetCollaborationTeam } from './collaboration.js'
import {
  FLEET_MESSAGE_MODULE,
  FLEET_RESOURCES_MODULE,
  FLEET_UI_MODULE,
  FleetConfigurationRegistry,
  type FleetConfigurationValue,
  parseFleetMessageConfiguration,
  parseFleetResourcesConfiguration,
  parseFleetUiConfiguration,
} from './configuration.js'
import {
  FLEET_MEMBER_PERMISSIONS,
  FLEET_MEMBER_TOOL_GROUPS,
  fleetMemberCanAccessChannel,
  fleetMemberCanContact,
} from './member-view.js'
import {
  FLEET_TASK_STATE_NAMESPACE,
  fleetTaskToolDetail,
  fleetTaskToolSummary,
  parseFleetTaskState,
  type FleetProjectTask,
  type FleetTaskBoard,
} from './productivity/task.js'
import {
  FLEET_SCHEDULE_STATE_NAMESPACE,
  parseFleetScheduleState,
} from './productivity/schedule.js'
import {
  FLEET_CALENDAR_STATE_NAMESPACE,
  parseFleetCalendarState,
} from './productivity/calendar.js'
import type {
  FleetMemberContacts,
  FleetMemberPermission,
  FleetMemberToolGroup,
  FleetMemberView,
} from './member-view.js'
import {
  DEFAULT_FLEET_TURN_REMINDERS,
  fleetTurnReminderText,
  inferFleetReminderLocales,
  selectFleetTurnReminder,
  type FleetTurnReminderLists,
  type FleetTurnReminderSlot,
} from './turn-reminders.js'

export type FleetRunStatus = 'starting' | 'idle' | 'running' | 'paused' | 'finishing' | 'closed' | 'failed'
export type FleetWorkStatus = 'running' | 'finished' | 'blocked' | 'failed' | 'cancelled'

export interface FleetWorkRecord {
  readonly id: string
  readonly rootTaskId?: string
  readonly taskPath: string
  /** Immutable accepted work text used for restart, without changing the caller's source file. */
  readonly acceptedTaskPath?: string
  readonly status: FleetWorkStatus
  readonly startedAt: string
  readonly endedAt?: string
  readonly summary?: string
}

export interface FleetRunMember {
  readonly name: string
  readonly displayName?: string
  readonly color?: string
  readonly role: string
  readonly sessionId: string
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly maxTokens?: number
  readonly status?: 'idle' | 'running' | 'waiting' | 'error' | 'offline' | 'paused' | 'unknown'
}

export interface FleetRunAssistant {
  readonly sessionId: string
  readonly view: FleetAssistantView
  readonly status?: 'idle' | 'running' | 'error' | 'offline' | 'paused'
}

export type FleetBudgetMode = 'tokens' | 'cost'

export interface FleetBudgetModelRate {
  readonly provider: string
  readonly model: string
  /** Token mode only. An omitted multiplier is exactly 1x. */
  readonly multiplier?: number
  /** Cost mode prices in USD per one million tokens. */
  readonly inputUsdPerMillion?: number
  readonly outputUsdPerMillion?: number
  readonly cacheReadUsdPerMillion?: number
  readonly cacheWriteUsdPerMillion?: number
}

export interface FleetBudgetModelUsage {
  readonly provider: string
  readonly model: string
  /** Weighted tokens in token mode, micro-USD in cost mode. */
  readonly charged: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly calls: number
  readonly unmeteredCalls: number
}

export interface FleetBudgetAccount {
  /** Weighted tokens in token mode, micro-USD in cost mode. */
  readonly limit?: number
  readonly startedAt: string
  /** Weighted tokens in token mode, micro-USD in cost mode. */
  readonly used: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly calls: number
  readonly unmeteredCalls: number
  readonly models: FleetBudgetModelUsage[]
}

export interface FleetTeamBudgetState {
  readonly mode: FleetBudgetMode
  readonly rates: FleetBudgetModelRate[]
  readonly team: FleetBudgetAccount
  readonly members: FleetBudgetMemberAccount[]
}

export interface FleetBudgetMemberAccount extends FleetBudgetAccount {
  readonly memberId: string
  readonly name?: string
  readonly role?: string
  readonly color?: string
  readonly assistant?: boolean
}

export type FleetBudgetAccountState = 'unlimited' | 'normal' | 'warning' | 'danger' | 'exhausted'

export interface FleetBudgetAccountSnapshot extends FleetBudgetAccount {
  readonly remaining?: number
  readonly state: FleetBudgetAccountState
}

export interface FleetParticipantBudgetSnapshot extends FleetBudgetAccountSnapshot {
  readonly memberId: string
  readonly name: string
  readonly role: string
  readonly color?: string
  readonly assistant: boolean
  readonly active: boolean
}

export interface FleetTeamBudgetSnapshot {
  readonly mode: FleetBudgetMode
  readonly rates: FleetBudgetModelRate[]
  readonly configuredModels: readonly { readonly provider: string; readonly model: string }[]
  readonly team: FleetBudgetAccountSnapshot
  readonly members: readonly FleetParticipantBudgetSnapshot[]
}

export interface FleetRunRecord {
  readonly id: string
  readonly sourceSetupId?: string
  readonly team: string
  readonly name: string
  readonly configPath: string
  readonly projectRoot: string
  /** @deprecated Legacy Teams may retain their former dedicated coordinator id. */
  readonly coordinator?: string
  /** @deprecated Use assistants. Kept while existing persisted Teams migrate. */
  readonly launcherSessionId: string
  readonly agentOptions?: {
    readonly provider?: string
    readonly model?: string
    readonly maxTokens?: number
  }
  readonly members: FleetRunMember[]
  readonly assistants: FleetRunAssistant[]
  /** Shared Team and participant model-token budgets. Missing means tracking starts with the next model call. */
  readonly budget?: FleetTeamBudgetState
  /** Runtime projection of historical assistant Sessions onto their current Session. */
  readonly assistantSessionAliases?: {
    readonly sessionId: string
    readonly currentSessionId: string
  }[]
  readonly status: FleetRunStatus
  /** Members stopped by the current Team-level pause. Individually paused members are not included. */
  readonly teamPausedMembers?: string[]
  /** Runtime projection only; omitted from persisted run.json records. */
  readonly runtimeState?: 'active' | 'dormant'
  readonly work?: FleetWorkRecord
  readonly settled: boolean
  readonly startedAt: string
  readonly endedAt?: string
  readonly summary?: string
  readonly error?: string
}

export interface FleetTraceEvent {
  readonly sequence: number
  readonly createdAt: string
  readonly scope: 'team' | 'member'
  readonly member?: string
  readonly sessionId?: string
  readonly sourceSequence?: number
  readonly type: string
  readonly data: string
}

export interface FleetProgressItem {
  readonly sequence: number
  readonly createdAt: string
  readonly kind: 'output' | 'tool_call' | 'tool_result' | 'error'
  readonly name?: string
  readonly text?: string
}

export interface FleetMemberProgress {
  readonly runId: string
  readonly member: string
  readonly displayName?: string
  readonly runtimeStatus: NonNullable<FleetRunMember['status']>
  readonly items: FleetProgressItem[]
  readonly cursor: number
  readonly hasMore: boolean
}

export interface FleetJournalEvent {
  readonly sequence: number
  readonly createdAt: string
  readonly scope: 'team' | 'member'
  readonly member?: string
  readonly sourceSequence?: number
  readonly type: string
  readonly data: unknown
}

export interface FleetHistorySearchInput {
  readonly query?: string
  readonly member?: string
  readonly types?: readonly string[]
  readonly typePrefixes?: readonly string[]
  readonly afterSequence?: number
  readonly beforeSequence?: number
  readonly createdAfter?: string
  readonly createdBefore?: string
  /** Read only the recent file tail. Intended for low-effort, recent-activity queries. */
  readonly recentBytes?: number
  /** Apply the Fleet participant's current event visibility before returning matches. */
  readonly visibleToSessionId?: string
  readonly limit: number
}

export interface FleetHistorySearchResult {
  readonly runId: string
  /** Newest matching event first. */
  readonly events: FleetJournalEvent[]
  readonly hasMore: boolean
  readonly truncated: boolean
}

export interface FleetTeamProjection {
  readonly run: FleetRunRecord
  readonly memberViews: FleetMemberView[]
  readonly events: FleetJournalEvent[]
  readonly hasMore: boolean
}

export interface FleetConversationProjection extends FleetTeamProjection {
  readonly previousSequence?: number
}

export interface FleetMemberTracePage {
  readonly runId: string
  readonly member: string
  readonly events: FleetTraceEvent[]
  readonly hasMore: boolean
  readonly targetSessionId?: string
  readonly targetSequence?: number
  readonly previous?: {
    readonly segment: number
    readonly beforeSeq: number
  }
}

export interface FleetMemberProjection {
  readonly run: FleetRunRecord
  readonly view: FleetMemberView
  readonly events: FleetJournalEvent[]
  readonly hasMore: boolean
}

export interface FleetResourcePreview {
  readonly id: string
  readonly kind: 'markdown' | 'text'
  readonly body: string
  /** Present only for a failed item in a batch preview request. */
  readonly error?: string
  readonly mediaType?: string
  readonly size?: number
  readonly history: readonly FleetResourceRevisionSummary[]
  readonly historyTruncated: boolean
  readonly revision?: FleetResourceRevisionDetail
}

export interface FleetResourcePreviewRequest {
  readonly id: string
  readonly revisionId?: string
}

export interface FleetResourceRevisionSummary {
  readonly id: string
  readonly updatedBy: string
  readonly updatedAt: string
  readonly operation: 'created' | 'updated'
  readonly available: boolean
  readonly size: number
}

export interface FleetResourceRevisionDetail extends FleetResourceRevisionSummary {
  readonly before: string | null
  readonly after: string
}

export interface FleetResourceRevisionSnippetRequest {
  readonly id: string
  readonly revisionId: string
  readonly query: string
  readonly maxChars?: number
}

export interface FleetResourceRevisionSnippet {
  readonly id: string
  readonly revisionId: string
  readonly matched: boolean
  readonly snippet?: string
  readonly error?: string
}

export interface FleetResourceContentSnippetRequest {
  readonly id: string
  readonly query: string
  readonly maxChars?: number
}

export interface FleetResourceContentSnippet {
  readonly id: string
  readonly matched: boolean
  readonly snippet?: string
  readonly history: readonly FleetResourceRevisionSummary[]
  readonly historyTruncated: boolean
  readonly error?: string
}

export type FleetActivityKind = 'message' | 'task' | 'calendar' | 'meeting' | 'vote' | 'document' | 'schedule' | 'member'

export interface FleetActivityItem {
  readonly id: string
  readonly sequence: number
  readonly createdAt: string
  readonly kind: FleetActivityKind
  readonly type: string
  readonly acknowledged: boolean
  readonly data: Record<string, JsonValue>
}

export interface FleetActivityInbox {
  readonly runId: string
  readonly member: string
  readonly items: FleetActivityItem[]
  readonly hasMore: boolean
}

export type FleetAssistantMessageKind = 'collaboration' | 'directive'

export interface FleetAssistantStage {
  readonly key: string
  readonly kind: 'goal' | 'vote'
  readonly title: string
  readonly description: string
  readonly owners: string[]
  readonly dependencies: string[]
  readonly timeoutAt?: string
}

export interface FleetAssistantMessage {
  readonly id: string
  readonly messageId: string
  readonly runId: string
  readonly kind: FleetAssistantMessageKind
  readonly text: string
  readonly recipients: string[]
  readonly stages: FleetAssistantStage[]
  readonly assistantSessionId: string
  readonly assistantId: string
  readonly assistantName: string
  readonly createdAt: string
}

interface TeamChannelTemplate {
  readonly id: string
  readonly name: string
  readonly initialMessage: string
  readonly summary: string
  readonly body: string
}

interface TeamTemplate {
  readonly team: string
  readonly name: string
  readonly operatingPrompt: string
  readonly channels: TeamChannelTemplate[]
  readonly assistant: FleetAssistantView
  readonly members: FleetMemberView[]
  readonly sharedResources: TeamResourceTemplate[]
}

interface TeamResourceTemplate {
  readonly path: string
  readonly label?: string
  readonly mediaType?: string
}

interface StoredFleetEvent {
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

interface FleetParticipantIdentities {
  readonly stableByReference: ReadonlyMap<string, string>
  readonly conversationKeyByParticipant: ReadonlyMap<string, string>
}

function fleetParticipantIdentities(
  record: FleetRunRecord,
  events: readonly StoredFleetEvent[],
): FleetParticipantIdentities {
  const stableByReference = new Map<string, string>()
  const conversationKeyByParticipant = new Map<string, string>()
  for (const member of record.members) {
    stableByReference.set(member.name, member.name)
    stableByReference.set(member.sessionId, member.name)
    conversationKeyByParticipant.set(member.name, `member:${member.name}`)
  }
  for (const assistant of record.assistants) {
    stableByReference.set(assistant.view.id, assistant.view.id)
    stableByReference.set(assistant.sessionId, assistant.view.id)
    conversationKeyByParticipant.set(assistant.view.id, `assistant:${assistant.view.id}`)
  }
  for (const event of events) {
    if (event.type === 'member_session_rotated') {
      const data = event.data as { readonly member?: unknown; readonly previousSessionId?: unknown; readonly sessionId?: unknown }
      if (typeof data.member !== 'string') continue
      stableByReference.set(data.member, data.member)
      conversationKeyByParticipant.set(data.member, `member:${data.member}`)
      if (typeof data.previousSessionId === 'string') stableByReference.set(data.previousSessionId, data.member)
      if (typeof data.sessionId === 'string') stableByReference.set(data.sessionId, data.member)
      continue
    }
    if (event.type !== 'assistant_attached' && event.type !== 'assistant_rebound') continue
    const data = event.data as {
      readonly previousSessionId?: unknown
      readonly sessionId?: unknown
      readonly view?: { readonly id?: unknown }
    }
    if (typeof data.view?.id !== 'string') continue
    stableByReference.set(data.view.id, data.view.id)
    conversationKeyByParticipant.set(data.view.id, `assistant:${data.view.id}`)
    if (typeof data.previousSessionId === 'string') stableByReference.set(data.previousSessionId, data.view.id)
    if (typeof data.sessionId === 'string') stableByReference.set(data.sessionId, data.view.id)
  }
  return { stableByReference, conversationKeyByParticipant }
}

function stableParticipant(identities: FleetParticipantIdentities, reference: string): string {
  return identities.stableByReference.get(reference) ?? reference
}

function stableConversationId(
  identities: FleetParticipantIdentities,
  from: string,
  conversation: FleetTarget,
): string {
  if (!conversation.startsWith('@')) return conversation
  const recipient = conversation.slice(1)
  if (from.startsWith('fleet-user:')) return `@${recipient}`
  if (recipient.startsWith('fleet-user:')) return `@${from}`
  const key = (participant: string): string =>
    identities.conversationKeyByParticipant.get(participant) ?? participant
  return `dm:${[key(from), key(recipient)].sort().join(':')}`
}

function stableCoordinationEvent(
  event: StoredFleetEvent,
  identities: FleetParticipantIdentities,
): StoredFleetEvent {
  if (!event.type.startsWith('coordination.') || typeof event.data !== 'object' || event.data === null) return event
  const coordination = structuredClone(event.data) as FleetCoordinationEvent
  const stable = (reference: string): string => stableParticipant(identities, reference)
  let data: FleetCoordinationEvent
  if (coordination.type === 'message') {
    const from = stable(coordination.message.from)
    const conversation = coordination.message.conversation.startsWith('@')
      ? `@${stable(coordination.message.conversation.slice(1))}` as FleetTarget
      : coordination.message.conversation
    data = {
      ...coordination,
      message: {
        ...coordination.message,
        from,
        conversation,
        conversationId: stableConversationId(identities, from, conversation),
        mentions: [...new Set(coordination.message.mentions.map(stable))],
        ...(coordination.message.recipientIds === undefined ? {} : {
          recipientIds: [...new Set(coordination.message.recipientIds.map(stable))],
        }),
      },
    }
  } else if (coordination.type === 'channel') {
    data = { ...coordination, channel: {
      ...coordination.channel,
      createdBy: stable(coordination.channel.createdBy),
      members: [...new Set(coordination.channel.members.map(stable))],
    } }
  } else if (coordination.type === 'meeting') {
    data = { ...coordination, meeting: {
      ...coordination.meeting,
      initiator: stable(coordination.meeting.initiator),
      participants: [...new Set(coordination.meeting.participants.map(stable))],
      attendance: Object.fromEntries(Object.entries(coordination.meeting.attendance).map(([participant, value]) => [
        stable(participant), value,
      ])),
    } }
  } else if (coordination.type === 'vote') {
    data = { ...coordination, vote: {
      ...coordination.vote,
      initiator: stable(coordination.vote.initiator),
      voters: [...new Set(coordination.vote.voters.map(stable))],
      approvals: [...new Set(coordination.vote.approvals.map(stable))],
      ...(coordination.vote.rejection === undefined ? {} : {
        rejection: { ...coordination.vote.rejection, voter: stable(coordination.vote.rejection.voter) },
      }),
    } }
  } else if (coordination.type === 'reaction') {
    data = { ...coordination, reaction: {
      ...coordination.reaction,
      members: [...new Set(coordination.reaction.members.map(stable))],
    } }
  } else if (coordination.type === 'pin') {
    data = { ...coordination, pin: { ...coordination.pin, pinnedBy: stable(coordination.pin.pinnedBy) } }
  } else if (coordination.type === 'system_notification') {
    data = { ...coordination, agentId: stable(coordination.agentId) }
  } else {
    const originalAgentId = coordination.agentId
    data = {
      ...coordination,
      agentId: stable(originalAgentId),
      ...((coordination.action === 'delivered' || coordination.action === 'superseded')
        && coordination.sessionId === undefined
        ? { sessionId: originalAgentId }
        : {}),
    }
  }
  return { ...event, data }
}

interface FleetResourcePreviewState {
  readonly actorNames: ReadonlyMap<string, string>
  readonly resources: ReadonlyMap<string, {
    readonly created: FleetResource
    readonly latest: FleetResource
  }>
  readonly revisions: ReadonlyMap<string, {
    readonly history: readonly (FleetResourceRevisionSummary & { readonly resourceId: string })[]
    readonly count: number
    readonly hasCreated: boolean
    readonly selected: ReadonlyMap<string, FleetResourceRevisionSummary & { readonly resourceId: string }>
  }>
}

function projectionEntityId(data: unknown, key: string): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const entity = (data as Record<string, unknown>)[key]
  if (typeof entity !== 'object' || entity === null) return undefined
  const id = (entity as Record<string, unknown>).id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

function workspaceEventResourceIds(event: StoredFleetEvent): string[] | undefined {
  if (!event.type.startsWith('workspace.') || typeof event.data !== 'object' || event.data === null) return undefined
  const data = event.data as Readonly<Record<string, unknown>>
  const candidates = event.type === 'workspace.assigned'
    ? data.workspaces
    : data.workspace === undefined ? data.workspaceId : [data.workspace]
  const workspaces = Array.isArray(candidates) ? candidates : [candidates]
  if (workspaces.length === 0) return undefined
  const identifiers = workspaces.map(candidate => {
    if (typeof candidate === 'string') return candidate.length > 0 ? candidate : undefined
    if (typeof candidate !== 'object' || candidate === null) return undefined
    const workspace = candidate as Readonly<Record<string, unknown>>
    const path = workspace.path
    if (typeof path === 'string' && path.length > 0) return path
    const id = workspace.id ?? workspace.workspaceId
    return typeof id === 'string' && id.length > 0 ? id : undefined
  })
  return identifiers.every((identifier): identifier is string => identifier !== undefined)
    ? [...new Set(identifiers)]
    : undefined
}

function projectionStateKey(event: StoredFleetEvent): string | undefined {
  if (event.type === 'coordination.channel') {
    const id = projectionEntityId(event.data, 'channel')
    return id === undefined ? undefined : `channel:${id}`
  }
  if (event.type === 'coordination.meeting') {
    const id = projectionEntityId(event.data, 'meeting')
    return id === undefined ? undefined : `meeting:${id}`
  }
  if (event.type === 'resource.resource_added' || event.type === 'resource.resource_removed') {
    const data = event.type === 'resource.resource_removed' && typeof event.data === 'object' && event.data !== null
      ? (event.data as { readonly removal?: unknown }).removal
      : event.data
    const id = projectionEntityId(data, 'resource')
    return id === undefined ? undefined : `resource:${id}`
  }
  if (event.type === 'workspace.assigned') {
    const member = typeof event.data === 'object' && event.data !== null
      ? (event.data as Record<string, unknown>).member
      : undefined
    return typeof member === 'string' && member.length > 0 ? `workspace:${member}` : undefined
  }
  if (event.type === 'member_status.updated') {
    const member = typeof event.data === 'object' && event.data !== null
      && 'status' in event.data && typeof event.data.status === 'object' && event.data.status !== null
      && 'member' in event.data.status
      ? event.data.status.member
      : undefined
    return typeof member === 'string' && member.length > 0 ? `member-status:${member}` : undefined
  }
  if (event.type === 'member_status.cleared') {
    const member = typeof event.data === 'object' && event.data !== null && 'member' in event.data
      ? event.data.member
      : undefined
    return typeof member === 'string' && member.length > 0 ? `member-status:${member}` : undefined
  }
  if (event.type === 'member_session_rotated') {
    const previous = typeof event.data === 'object' && event.data !== null
      ? (event.data as Record<string, unknown>).previousSessionId
      : undefined
    return typeof previous === 'string' && previous.length > 0 ? `member-session:${previous}` : undefined
  }
  return undefined
}

function isProjectionActivity(event: StoredFleetEvent): boolean {
  if (event.type === 'memory.stored' || event.type === 'memory.recalled') {
    if (typeof event.data !== 'object' || event.data === null) return false
    const count = (event.data as Record<string, unknown>)[event.type === 'memory.stored' ? 'storedCount' : 'resultCount']
    return typeof count === 'number' && Number.isSafeInteger(count) && count > 0
  }
  return event.type.startsWith('resource.')
    || event.type.startsWith('workspace.')
    || event.type.startsWith('task.')
    || event.type.startsWith('schedule.')
    || event.type.startsWith('calendar.')
    || event.type === 'coordination.vote'
    || event.type.startsWith('work_')
    || event.type.startsWith('budget_')
    || event.type === 'team_status'
    || event.type.startsWith('member_')
    || event.type.startsWith('assistant_')
}

function projectionReceiptMessageId(event: StoredFleetEvent): string | undefined {
  if (event.type !== 'coordination.inbox' || typeof event.data !== 'object' || event.data === null) return undefined
  const data = event.data as Record<string, unknown>
  return data.type === 'inbox'
    && (data.action === 'delivered' || data.action === 'blocked' || data.action === 'read'
      || data.action === 'acknowledged')
    && typeof data.messageId === 'string'
    ? data.messageId
    : undefined
}

function projectionReceiptKey(event: StoredFleetEvent): string | undefined {
  const messageId = projectionReceiptMessageId(event)
  if (messageId === undefined || typeof event.data !== 'object' || event.data === null) return undefined
  const data = event.data as Record<string, unknown>
  return typeof data.agentId === 'string' && typeof data.action === 'string'
    ? `${data.action}:${data.agentId}:${messageId}`
    : undefined
}

/** Current entity state plus bounded recent UI history; Session events have a dedicated trace endpoint. */
function compactTeamProjectionEvents(events: readonly StoredFleetEvent[]): StoredFleetEvent[] {
  const state = new Map<string, StoredFleetEvent>()
  const messages: StoredFleetEvent[] = []
  const receipts = new Map<string, StoredFleetEvent>()
  const activity: StoredFleetEvent[] = []
  for (const event of events) {
    if (event.type.startsWith('session.')) continue
    const key = projectionStateKey(event)
    if (key !== undefined) {
      state.set(key, event)
      continue
    }
    if (event.type === 'coordination.message') {
      messages.push(event)
      continue
    }
    const receiptKey = projectionReceiptKey(event)
    if (receiptKey !== undefined) {
      receipts.set(receiptKey, event)
      continue
    }
    if (isProjectionActivity(event)) activity.push(event)
  }
  const retainedMessages = messages.slice(-TEAM_PROJECTION_MESSAGE_LIMIT)
  const retainedMessageIds = new Set(retainedMessages.flatMap(event => {
    const id = projectionEntityId(event.data, 'message')
    return id === undefined ? [] : [id]
  }))
  return [
    ...state.values(),
    ...retainedMessages,
    ...[...receipts.values()].filter(event => retainedMessageIds.has(projectionReceiptMessageId(event) ?? '')),
    ...activity.slice(-TEAM_PROJECTION_ACTIVITY_LIMIT),
  ].sort((left, right) => left.sequence - right.sequence)
}

function parseStoredEvents(source: string): StoredFleetEvent[] {
  const events: StoredFleetEvent[] = []
  let start = 0
  while (start < source.length) {
    const newline = source.indexOf('\n', start)
    const end = newline < 0 ? source.length : newline
    if (end > start) {
      const typeMarker = source.indexOf('"type":"', start)
      const typeStart = typeMarker < 0 || typeMarker >= end ? -1 : typeMarker + 8
      if (typeStart < 0 || !source.startsWith('session.', typeStart)) {
        events.push(JSON.parse(source.slice(start, end)) as StoredFleetEvent)
      }
    }
    if (newline < 0) break
    start = newline + 1
  }
  return events
}

interface SessionEventLike {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: unknown
}

function clippedProgressText(value: string, maxChars: number): string {
  const text = value.trim()
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`
}

function progressMessageText(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const data = value as Readonly<Record<string, unknown>>
  const message = typeof data.message === 'object' && data.message !== null
    ? data.message as Readonly<Record<string, unknown>>
    : data
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content.flatMap(block => {
    if (typeof block === 'string') return [block]
    if (typeof block !== 'object' || block === null) return []
    const item = block as Readonly<Record<string, unknown>>
    return item.type === 'text' && typeof item.text === 'string' ? [item.text] : []
  }).join('\n')
}

function memberProgressItem(
  event: SessionEventLike,
  includeOutputs: boolean,
  maxChars: number,
): FleetProgressItem | undefined {
  const createdAt = new Date(event.time).toISOString()
  if (event.type === 'assistant/message') {
    const data = typeof event.data === 'object' && event.data !== null
      ? event.data as Readonly<Record<string, unknown>>
      : {}
    if (data.interrupted === true) return undefined
    const text = clippedProgressText(progressMessageText(data), maxChars)
    return text === '' ? undefined : { sequence: event.seq, createdAt, kind: 'output', text }
  }
  if (event.type === 'tool/call') {
    const data = typeof event.data === 'object' && event.data !== null
      ? event.data as Readonly<Record<string, unknown>>
      : {}
    const name = typeof data.name === 'string' ? data.name : 'tool'
    const text = includeOutputs && typeof data.arguments === 'string'
      ? clippedProgressText(data.arguments, maxChars)
      : ''
    return {
      sequence: event.seq,
      createdAt,
      kind: 'tool_call',
      name,
      ...(text === '' ? {} : { text }),
    }
  }
  if (event.type === 'tool/result' && includeOutputs) {
    const text = clippedProgressText(progressMessageText(event.data), maxChars)
    return text === '' ? undefined : { sequence: event.seq, createdAt, kind: 'tool_result', text }
  }
  if (event.type === 'turn/end') {
    const data = typeof event.data === 'object' && event.data !== null
      ? event.data as Readonly<Record<string, unknown>>
      : {}
    const reason = typeof data.reason === 'object' && data.reason !== null
      ? data.reason as Readonly<Record<string, unknown>>
      : {}
    if (reason.kind !== 'error') return undefined
    const error = typeof reason.error === 'object' && reason.error !== null
      ? reason.error as Readonly<Record<string, unknown>>
      : {}
    const text = typeof error.message === 'string' ? clippedProgressText(error.message, maxChars) : 'Agent turn failed'
    return { sequence: event.seq, createdAt, kind: 'error', text }
  }
  return undefined
}

interface SessionPersistenceLike {
  inspect(id: ReturnType<typeof SessionId>): Promise<{
    readonly meta?: SessionHeader
    readonly events: readonly SessionEventLike[]
  }>
  list?(): Promise<SessionHeader[]>
  create?(meta: SessionHeader): Promise<void>
  append?(id: ReturnType<typeof SessionId>, events: readonly SessionEvent[]): Promise<void>
}

interface FleetSessionArchiveLike {
  find(logicalId: string): Promise<{
    readonly activeSessionId: string
    readonly segments: readonly { readonly sessionId: string }[]
  } | undefined>
  readPage(logicalId: string, options: {
    readonly cursor?: { readonly segment: number; readonly beforeSeq: number }
    readonly limit?: number
    readonly signal?: AbortSignal
  }): Promise<{
    readonly items: readonly {
      readonly sessionId: string
      readonly event: SessionEventLike
    }[]
    readonly previous?: { readonly segment: number; readonly beforeSeq: number }
  }>
}

interface RunWaiter {
  readonly runId: string
  finish(record: FleetRunRecord): void
  fail(error: unknown): void
}

interface StoredTeamReference {
  readonly id: string
  readonly projectRoot: string
}

export interface FleetRunServiceOptions {
  readonly registryDirectory?: string
  readonly archives?: FleetArchiveRegistry
  readonly authorization?: FleetAuthorizationService
  readonly configuration?: FleetConfigurationRegistry
  readonly turnReminders?: FleetTurnReminderLists
}

export interface FleetResidentAssistantController {
  release(sessionId: string): Promise<boolean>
  restore(sessionId: string): Promise<void>
}

export interface ExportFleetArchiveInput {
  readonly runId: string
  readonly destination: string
  readonly includeWorkspace?: boolean
}

export interface FleetArchiveExportResult {
  readonly path: string
  readonly teamId: string
  readonly includesWorkspace: boolean
  readonly extensions: readonly string[]
}

export interface ImportFleetArchiveInput {
  readonly archivePath: string
  readonly projectRoot: string
  /** Restore keeps archive identities; copy creates a new Team and member Sessions. */
  readonly mode?: 'restore' | 'copy'
}

export interface FleetArchiveImportResult {
  readonly run: FleetRunRecord
  readonly extensions: FleetArchiveRestoreReport
}

export interface CreateRunInput {
  readonly configPath: string
  readonly projectRoot: string
  readonly requiredPaths: readonly string[]
  readonly sourceSetupId?: string
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
}

interface StartRunInput {
  readonly runId?: string
  readonly taskPath: string
  readonly projectRoot: string
  readonly directive?: string
  readonly stages?: readonly FleetAssistantStage[]
  readonly resultStage?: string
}

interface ResumeRunInput {
  readonly runId: string
  readonly projectRoot: string
}

export interface SendAssistantMessageInput {
  readonly runId?: string
  readonly kind: FleetAssistantMessageKind
  readonly text: string
  readonly recipients?: readonly string[]
  readonly stages?: readonly {
    readonly key: string
    readonly kind?: 'goal' | 'vote'
    readonly title: string
    readonly description?: string
    readonly owners: readonly string[]
    readonly dependencies?: readonly string[]
    readonly timeoutAt?: string
  }[]
  readonly projectRoot?: string
}

interface PendingAssistantKickoff {
  readonly messageId: string
  readonly text: string
  readonly channelId: string
  readonly staged: boolean
  readonly recipients: string[]
  readonly stages: FleetAssistantStage[]
}

export interface ContinueFleetInteractionInput {
  readonly runId?: string
  readonly reason: string
  readonly taskIds?: readonly string[]
  readonly goal?: {
    readonly title: string
    readonly description: string
    readonly owners: readonly string[]
  }
  readonly checkAfterSeconds?: number
}

export interface ReportFleetInteractionInput {
  readonly runId?: string
  readonly outcome: 'complete' | 'block'
  readonly reason: string
  readonly report: string
}

export interface UpdateFleetInteractionInput {
  readonly runId?: string
  readonly message: string
}

export interface TakeOverFleetInteractionInput {
  readonly runId?: string
  readonly reason: string
}

export interface SendFleetConversationMessageInput {
  readonly runId?: string
  readonly to: FleetTarget
  readonly text: string
  readonly replyTo?: string
  readonly resources?: readonly string[]
  readonly mentions?: readonly string[]
  readonly noReply?: boolean
  readonly delivery: 'quiet' | 'wakeup' | 'interrupt'
}

export interface UploadFleetResourceInput {
  readonly runId: string
  readonly name: string
  readonly base64: string
  readonly label?: string
  readonly mediaType?: string
}

export interface RemoveFleetResourceInput {
  readonly runId: string
  readonly resourceId: string
}

export interface AttachAssistantInput {
  readonly runId?: string
  readonly projectRoot?: string
  readonly assistantId?: string
  readonly id?: string
  readonly name?: string
  readonly color?: string
  readonly role?: string
  readonly responsibility?: string
  readonly prompt?: string
  readonly provider?: string
  readonly model?: string
  readonly toolGroups?: readonly FleetMemberToolGroup[]
  readonly permissions?: readonly FleetMemberPermission[]
  readonly contacts?: FleetMemberContacts
}

export interface AddFleetMemberInput {
  readonly runId: string
  readonly view: FleetMemberView
}

export interface UpdateFleetMemberInput {
  readonly runId: string
  readonly member: string
  readonly view: FleetMemberView
}

export interface FleetMemberRequestPatch {
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string | null
  readonly maxTokens?: number | null
}

export interface FleetTeamSettings {
  readonly name: string
  readonly positioning: string
  readonly rules: string
  readonly collaborationMethod: string
  readonly visibilityReminderContextGrowthTokens: number
  readonly updateDensity: 'concise' | 'balanced' | 'detailed'
  readonly notificationPolicy: 'decisions' | 'milestones' | 'continuous'
  readonly contentPreference: string
}

export interface FleetTeamSettingsSnapshot extends FleetTeamSettings {
  readonly projectRoot: string
  readonly budget: FleetTeamBudgetSnapshot
  readonly request: {
    readonly provider?: string
    readonly model?: string
    readonly reasoningEffort?: string
    readonly maxTokens?: number
    readonly mixed: {
      readonly model: boolean
      readonly reasoningEffort: boolean
      readonly maxTokens: boolean
    }
  }
}

export interface ConfigureFleetTeamSettingsInput {
  readonly runId: string
  readonly settings: FleetTeamSettings
}

export interface ConfigureFleetBudgetInput {
  readonly runId: string
  readonly scope: 'team' | 'member'
  readonly member?: string
  /** Active accounting unit: weighted tokens in token mode, micro-USD in cost mode. */
  readonly limit?: number | null
  /** Reset this scope's usage cycle while preserving its current limit. */
  readonly reset?: true
  /** Team-wide accounting mode and provider+model rates. */
  readonly accounting?: {
    readonly mode: FleetBudgetMode
    readonly rates: readonly FleetBudgetModelRate[]
  }
}

export interface ConfigureFleetMemberInput {
  readonly runId: string
  readonly member: string
  readonly request: FleetMemberRequestPatch
}

export interface FleetMemberRequestConfiguration {
  readonly member: FleetRunMember
  readonly request: RuntimeRequestConfig
  readonly effectiveFrom: 'next-model-step'
}

export interface ConfigureFleetAssistantInput {
  readonly runId: string
  readonly assistant?: string
  readonly request: FleetMemberRequestPatch
}

export interface FleetAssistantRequestConfiguration {
  readonly assistant: FleetRunAssistant
  readonly request: RuntimeRequestConfig
  readonly effectiveFrom: 'next-model-step'
}

export interface ConfigureFleetTeamInput {
  readonly runId: string
  readonly request: FleetMemberRequestPatch
}

export interface FleetTeamRequestConfiguration {
  readonly memberConfigurations: FleetMemberRequestConfiguration[]
  readonly assistantConfigurations: FleetAssistantRequestConfiguration[]
  readonly effectiveFrom: 'next-model-step'
}

interface AssistantRequestConfigRef extends ModelSelectionRef {
  current: RuntimeRequestConfig | undefined
  assembled: RuntimeRequestConfig | undefined
}

const TERMINAL = new Set<FleetRunStatus>(['closed', 'failed'])
const MAX_ASSISTANT_MESSAGE_LENGTH = 16_000
const TEAM_PROJECTION_MESSAGE_LIMIT = 100
const TEAM_PROJECTION_ACTIVITY_LIMIT = 250
const TEAM_PROJECTION_CACHE_LIMIT = 16
const FLEET_ARCHIVE_FORMAT = 'dsh-agent-fleet-archive'
const FLEET_ARCHIVE_VERSION = 1

function emptyBudgetAccount(startedAt: string, limit?: number): FleetBudgetAccount {
  return {
    ...(limit === undefined ? {} : { limit }),
    startedAt,
    used: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    calls: 0,
    unmeteredCalls: 0,
    models: [],
  }
}

function budgetAccountSnapshot(account: FleetBudgetAccount): FleetBudgetAccountSnapshot {
  if (account.limit === undefined) return { ...account, state: 'unlimited' }
  const remaining = Math.max(0, account.limit - account.used)
  return {
    ...account,
    remaining,
    state: remaining === 0
      ? 'exhausted'
      : account.used >= account.limit * 0.9
        ? 'danger'
        : account.used >= account.limit * 0.7
          ? 'warning'
          : 'normal',
  }
}

function budgetMemberAccount(state: FleetTeamBudgetState | undefined, memberId: string): FleetBudgetMemberAccount | undefined {
  return state?.members.find(account => account.memberId === memberId)
}

function replaceBudgetMember(
  members: readonly FleetBudgetMemberAccount[],
  memberId: string,
  account: FleetBudgetAccount,
  identity?: Pick<FleetBudgetMemberAccount, 'name' | 'role' | 'color' | 'assistant'>,
): FleetBudgetMemberAccount[] {
  const current = members.find(candidate => candidate.memberId === memberId)
  const previousIdentity = current === undefined ? {} : {
    ...(current.name === undefined ? {} : { name: current.name }),
    ...(current.role === undefined ? {} : { role: current.role }),
    ...(current.color === undefined ? {} : { color: current.color }),
    ...(current.assistant === undefined ? {} : { assistant: current.assistant }),
  }
  const next = { ...account, memberId, ...previousIdentity, ...identity }
  return current !== undefined
    ? members.map(candidate => candidate.memberId === memberId ? next : candidate)
    : [...members, next]
}

function budgetMemberIdentity(
  record: FleetRunRecord,
  memberId: string,
): Pick<FleetBudgetMemberAccount, 'name' | 'role' | 'color' | 'assistant'> | undefined {
  const member = record.members.find(candidate => candidate.name === memberId)
  if (member !== undefined) return {
    name: member.displayName ?? member.name,
    role: member.role,
    ...(member.color === undefined ? {} : { color: member.color }),
    assistant: false,
  }
  const assistant = record.assistants.find(candidate => candidate.view.id === memberId)?.view
  return assistant === undefined ? undefined : {
    name: assistant.name,
    role: assistant.role,
    ...(assistant.color === undefined ? {} : { color: assistant.color }),
    assistant: true,
  }
}

function resetBudgetMemberAccount(
  account: FleetBudgetMemberAccount,
  startedAt: string,
  preserveLimit: boolean,
): FleetBudgetMemberAccount {
  return {
    ...emptyBudgetAccount(startedAt, preserveLimit ? account.limit : undefined),
    memberId: account.memberId,
    ...(account.name === undefined ? {} : { name: account.name }),
    ...(account.role === undefined ? {} : { role: account.role }),
    ...(account.color === undefined ? {} : { color: account.color }),
    ...(account.assistant === undefined ? {} : { assistant: account.assistant }),
  }
}

interface FleetBudgetCharge {
  readonly provider: string
  readonly model: string
  readonly usage: TokenUsage | null
}

function budgetUsage(event: SessionEvent): FleetBudgetCharge | undefined {
  if (event.type === 'assistant/message') {
    const source = event.data.message.source
    if (source === undefined) return undefined
    return {
      provider: source.provider,
      model: source.model,
      usage: event.data.usage ?? null,
    }
  }
  if (event.type === 'compaction/summary') {
    return { provider: event.data.provider, model: event.data.model, usage: event.data.usage ?? null }
  }
  return undefined
}

function budgetRate(
  rates: readonly FleetBudgetModelRate[],
  provider: string,
  model: string,
): FleetBudgetModelRate | undefined {
  return rates.find(rate => rate.provider === provider && rate.model === model)
}

function rawBudgetTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

function chargedBudgetUsage(state: FleetTeamBudgetState, charge: FleetBudgetCharge): number {
  if (charge.usage === null) return 0
  const rate = budgetRate(state.rates, charge.provider, charge.model)
  if (state.mode === 'tokens') return Math.ceil(rawBudgetTokens(charge.usage) * (rate?.multiplier ?? 1))
  if (rate?.inputUsdPerMillion === undefined || rate.outputUsdPerMillion === undefined
    || rate.cacheReadUsdPerMillion === undefined || rate.cacheWriteUsdPerMillion === undefined) {
    throw new Error(`Fleet cost budget requires prices for ${charge.provider} / ${charge.model}`)
  }
  return Math.round(
    charge.usage.inputTokens * rate.inputUsdPerMillion
    + charge.usage.outputTokens * rate.outputUsdPerMillion
    + (charge.usage.cacheReadTokens ?? 0) * rate.cacheReadUsdPerMillion
    + (charge.usage.cacheWriteTokens ?? 0) * rate.cacheWriteUsdPerMillion,
  )
}

function addModelBudgetUsage(
  models: readonly FleetBudgetModelUsage[],
  charge: FleetBudgetCharge,
  charged: number,
): FleetBudgetModelUsage[] {
  const current = models.find(item => item.provider === charge.provider && item.model === charge.model)
  const usage = charge.usage
  const next: FleetBudgetModelUsage = {
    provider: charge.provider,
    model: charge.model,
    charged: (current?.charged ?? 0) + charged,
    inputTokens: (current?.inputTokens ?? 0) + (usage?.inputTokens ?? 0),
    outputTokens: (current?.outputTokens ?? 0) + (usage?.outputTokens ?? 0),
    cacheReadTokens: (current?.cacheReadTokens ?? 0) + (usage?.cacheReadTokens ?? 0),
    cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + (usage?.cacheWriteTokens ?? 0),
    reasoningTokens: (current?.reasoningTokens ?? 0) + (usage?.reasoningTokens ?? 0),
    calls: (current?.calls ?? 0) + 1,
    unmeteredCalls: (current?.unmeteredCalls ?? 0) + (usage === null ? 1 : 0),
  }
  return current === undefined
    ? [...models, next]
    : models.map(item => item.provider === charge.provider && item.model === charge.model ? next : item)
}

function addBudgetUsage(
  state: FleetTeamBudgetState,
  account: FleetBudgetAccount,
  charge: FleetBudgetCharge,
): FleetBudgetAccount {
  const charged = chargedBudgetUsage(state, charge)
  if (charge.usage === null) {
    return {
      ...account,
      calls: account.calls + 1,
      unmeteredCalls: account.unmeteredCalls + 1,
      models: addModelBudgetUsage(account.models, charge, charged),
    }
  }
  const usage = charge.usage
  const inputTokens = usage.inputTokens
  const outputTokens = usage.outputTokens
  const cacheReadTokens = usage.cacheReadTokens ?? 0
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0
  const reasoningTokens = usage.reasoningTokens ?? 0
  return {
    ...account,
    used: account.used + charged,
    inputTokens: account.inputTokens + inputTokens,
    outputTokens: account.outputTokens + outputTokens,
    cacheReadTokens: account.cacheReadTokens + cacheReadTokens,
    cacheWriteTokens: account.cacheWriteTokens + cacheWriteTokens,
    reasoningTokens: account.reasoningTokens + reasoningTokens,
    calls: account.calls + 1,
    models: addModelBudgetUsage(account.models, charge, charged),
  }
}

interface FleetArchiveManifest {
  readonly format: typeof FLEET_ARCHIVE_FORMAT
  readonly version: typeof FLEET_ARCHIVE_VERSION
  readonly exportedAt: string
  readonly includesWorkspace: boolean
  readonly team: FleetArchiveTeam & { readonly status: 'paused' }
  readonly sessions: readonly string[]
  readonly extensions: readonly string[]
}

interface FleetArchiveSession {
  readonly meta: SessionHeader
  readonly events: readonly SessionEvent[]
}

function parseStoredRecord(value: unknown): FleetRunRecord {
  const record = object(value, 'Fleet run record') as unknown as FleetRunRecord & {
    readonly budget?: FleetTeamBudgetState & {
      readonly team: FleetBudgetAccount & { readonly limitTokens?: number; readonly usedTokens?: number }
      readonly members: readonly (FleetBudgetMemberAccount & { readonly limitTokens?: number; readonly usedTokens?: number })[]
    }
  }
  if (record.budget === undefined || record.budget.mode !== undefined) return record
  const migrate = (account: FleetBudgetAccount & { readonly limitTokens?: number; readonly usedTokens?: number }): FleetBudgetAccount => ({
    ...(account.limitTokens === undefined ? {} : { limit: account.limitTokens }),
    startedAt: account.startedAt,
    used: account.usedTokens ?? 0,
    inputTokens: account.inputTokens,
    outputTokens: account.outputTokens,
    cacheReadTokens: account.cacheReadTokens,
    cacheWriteTokens: account.cacheWriteTokens,
    reasoningTokens: account.reasoningTokens,
    calls: account.calls,
    unmeteredCalls: account.unmeteredCalls,
    models: [],
  })
  return {
    ...record,
    budget: {
      mode: 'tokens',
      rates: [],
      team: migrate(record.budget.team),
      members: record.budget.members.map(account => ({ ...migrate(account), memberId: account.memberId })),
    },
  }
}

function recordSnapshot(record: FleetRunRecord): FleetRunRecord {
  return structuredClone(record)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function archiveManifest(value: unknown): FleetArchiveManifest {
  const manifest = object(value, 'Fleet archive manifest')
  if (manifest.format !== FLEET_ARCHIVE_FORMAT || manifest.version !== FLEET_ARCHIVE_VERSION) {
    throw new Error('unsupported Fleet archive format or version')
  }
  if (typeof manifest.includesWorkspace !== 'boolean') {
    throw new Error('Fleet archive includesWorkspace must be a boolean')
  }
  const team = object(manifest.team, 'Fleet archive Team')
  const id = text(team.id, 'Fleet archive Team id')
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`invalid Fleet archive Team id ${id}`)
  const projectRoot = text(team.projectRoot, 'Fleet archive Team projectRoot')
  if (!isAbsolute(projectRoot)) throw new Error('Fleet archive Team projectRoot must be absolute')
  if (team.status !== 'paused') throw new Error('Fleet archive Team must be paused')
  const sessions = array(manifest.sessions, 'Fleet archive sessions').map((value, index) => {
    const id = text(value, `Fleet archive sessions[${index}]`)
    if (basename(id) !== id) throw new Error(`invalid Fleet archive Session id ${id}`)
    return id
  })
  const extensions = array(manifest.extensions, 'Fleet archive extensions').map((value, index) =>
    text(value, `Fleet archive extensions[${index}]`))
  return {
    format: FLEET_ARCHIVE_FORMAT,
    version: FLEET_ARCHIVE_VERSION,
    exportedAt: text(manifest.exportedAt, 'Fleet archive exportedAt'),
    includesWorkspace: manifest.includesWorkspace,
    team: {
      id,
      name: text(team.name, 'Fleet archive Team name'),
      projectRoot,
      status: 'paused',
    },
    sessions,
    extensions,
  }
}

function pathInside(root: string, target: string): boolean {
  const boundary = relative(root, target)
  return boundary === '' || (boundary !== '..' && !boundary.startsWith(`..${sep}`) && !isAbsolute(boundary))
}

function relocateArchivePath(
  path: string,
  sourceRoot: string,
  targetRoot: string,
  sourceTeamId: string,
  targetTeamId: string,
): string {
  if (!isAbsolute(path) || !pathInside(sourceRoot, path)) return path
  const sourceRun = join(sourceRoot, '.fleet', 'runs', sourceTeamId)
  if (pathInside(sourceRun, path)) {
    return resolve(targetRoot, '.fleet', targetTeamId, relative(sourceRun, path))
  }
  const sourceShared = join(sourceRoot, '.fleet', sourceTeamId)
  if (pathInside(sourceShared, path)) {
    return resolve(targetRoot, '.fleet', targetTeamId, relative(sourceShared, path))
  }
  return resolve(targetRoot, relative(sourceRoot, path))
}

function remapArchiveIdentity(
  value: unknown,
  sourceTeamId: string,
  targetTeamId: string,
  sessionIdMap: Readonly<Record<string, string>>,
): unknown {
  if (typeof value === 'string') {
    if (value === sourceTeamId) return targetTeamId
    const direct = sessionIdMap[value]
    if (direct !== undefined) return direct
    if (value.startsWith('@')) {
      const recipient = sessionIdMap[value.slice(1)]
      if (recipient !== undefined) return `@${recipient}`
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => remapArchiveIdentity(item, sourceTeamId, targetTeamId, sessionIdMap))
  }
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    sessionIdMap[key] ?? (key === sourceTeamId ? targetTeamId : key),
    remapArchiveIdentity(item, sourceTeamId, targetTeamId, sessionIdMap),
  ]))
}

function relocateArchiveEvents(
  source: string,
  sourceRoot: string,
  targetRoot: string,
  sourceTeamId: string,
  targetTeamId: string,
  sessionIdMap: Readonly<Record<string, string>>,
  targetRunDirectory: string,
  currentWorkId?: string,
): string {
  return source.split('\n').flatMap(line => {
    if (line.length === 0) return []
    const stored = JSON.parse(line) as StoredFleetEvent
    const event = {
      ...stored,
      data: remapArchiveIdentity(stored.data, sourceTeamId, targetTeamId, sessionIdMap),
    } as StoredFleetEvent
    if (event.type === 'team_created') {
      const data = event.data as { readonly configPath: string; readonly sourceConfigPath?: string }
      return [JSON.stringify({
        ...event,
        data: {
          ...data,
          configPath: join(targetRunDirectory, 'team.json'),
          ...(data.sourceConfigPath === undefined ? {} : {
            sourceConfigPath: relocateArchivePath(
              data.sourceConfigPath, sourceRoot, targetRoot, sourceTeamId, targetTeamId,
            ),
          }),
        },
      })]
    }
    if (event.type === 'work_started') {
      const data = event.data as {
        readonly workId: string
        readonly taskPath: string
        readonly acceptedTaskPath?: string
      }
      const currentTaskPath = join(targetRunDirectory, 'current-work.md')
      return [JSON.stringify({
        ...event,
        data: {
          ...data,
          taskPath: data.workId === currentWorkId
            ? currentTaskPath
            : relocateArchivePath(data.taskPath, sourceRoot, targetRoot, sourceTeamId, targetTeamId),
          ...(data.acceptedTaskPath === undefined ? {} : {
            acceptedTaskPath: data.workId === currentWorkId
              ? currentTaskPath
              : relocateArchivePath(
                data.acceptedTaskPath, sourceRoot, targetRoot, sourceTeamId, targetTeamId,
              ),
          }),
        },
      })]
    }
    if (event.type === 'resource.resource_added') {
      const data = event.data as Extract<FleetResourceEvent, { type: 'resource_added' }>
      return [JSON.stringify({
        ...event,
        data: {
          ...data,
          resource: {
            ...data.resource,
            path: relocateArchivePath(
              data.resource.path, sourceRoot, targetRoot, sourceTeamId, targetTeamId,
            ),
          },
        },
      })]
    }
    if (event.type === 'resource.resource_removed') {
      const data = event.data as Extract<FleetResourceEvent, { type: 'resource_removed' }>
      return [JSON.stringify({
        ...event,
        data: {
          ...data,
          removal: {
            ...data.removal,
            resource: {
              ...data.removal.resource,
              path: relocateArchivePath(
                data.removal.resource.path, sourceRoot, targetRoot, sourceTeamId, targetTeamId,
              ),
            },
          },
        },
      })]
    }
    return [JSON.stringify(event)]
  }).join('\n') + '\n'
}

function migrateLegacyRunEvents(source: string, legacyRun: string, runDirectory: string, sharedDirectory: string): string {
  return source.split('\n').flatMap(line => {
    if (line.length === 0) return []
    const event = JSON.parse(line) as StoredFleetEvent
    if (event.type === 'team_created') {
      const data = event.data as { readonly configPath: string }
      return [JSON.stringify({
        ...event,
        data: { ...data, configPath: pathInside(legacyRun, data.configPath)
          ? resolve(runDirectory, relative(legacyRun, data.configPath))
          : data.configPath },
      })]
    }
    if (event.type === 'work_started') {
      const data = event.data as { readonly taskPath: string; readonly acceptedTaskPath?: string }
      return [JSON.stringify({
        ...event,
        data: {
          ...data,
          taskPath: pathInside(legacyRun, data.taskPath)
            ? resolve(runDirectory, relative(legacyRun, data.taskPath))
            : data.taskPath,
          ...(data.acceptedTaskPath === undefined ? {} : {
            acceptedTaskPath: pathInside(legacyRun, data.acceptedTaskPath)
              ? resolve(runDirectory, relative(legacyRun, data.acceptedTaskPath))
              : data.acceptedTaskPath,
          }),
        },
      })]
    }
    if (event.type === 'resource.resource_added') {
      const data = event.data as Extract<FleetResourceEvent, { type: 'resource_added' }>
      return [JSON.stringify({
        ...event,
        data: {
          ...data,
          resource: {
            ...data.resource,
            path: pathInside(legacyRun, data.resource.path)
              ? resolve(sharedDirectory, relative(legacyRun, data.resource.path))
              : data.resource.path,
          },
        },
      })]
    }
    if (event.type === 'resource.resource_removed') {
      const data = event.data as Extract<FleetResourceEvent, { type: 'resource_removed' }>
      return [JSON.stringify({
        ...event,
        data: {
          ...data,
          removal: {
            ...data.removal,
            resource: {
              ...data.removal.resource,
              path: pathInside(legacyRun, data.removal.resource.path)
                ? resolve(sharedDirectory, relative(legacyRun, data.removal.resource.path))
                : data.removal.resource.path,
            },
          },
        },
      })]
    }
    return [line]
  }).join('\n') + '\n'
}

function assertSafeArchiveLinks(root: string, directory = root): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const info = lstatSync(path)
    if (info.isSymbolicLink()) {
      const link = readlinkSync(path)
      if (isAbsolute(link) || !pathInside(root, resolve(dirname(path), link))) {
        throw new Error(`Fleet archive contains an unsafe symbolic link: ${relative(root, path)}`)
      }
    } else if (info.isDirectory()) {
      assertSafeArchiveLinks(root, path)
    }
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function optionalText(value: unknown, label: string): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value.trim()
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

const FLEET_COORDINATOR_ID = 'fleet-coordinator'

function choice<const T extends string>(value: unknown, label: string, options: readonly T[]): T {
  const selected = text(value, label)
  if (!options.includes(selected as T)) throw new Error(`${label} must be one of ${options.join(', ')}`)
  return selected as T
}

function memberColor(member: Record<string, unknown>, label: string): string | undefined {
  const color = optionalText(member.color, `${label}.color`)
  return color.length === 0 ? undefined : normalizeFleetMemberColor(color)
}

function memberToolGroups(value: unknown, label: string): FleetMemberToolGroup[] {
  if (value === undefined) return [...FLEET_MEMBER_TOOL_GROUPS]
  return array(value, label).map((item, index) => extensionName(item, `${label}[${index}]`))
}

function memberPermissions(value: unknown, label: string): FleetMemberPermission[] {
  if (value === undefined) return [...FLEET_MEMBER_PERMISSIONS]
  return array(value, label).map((item, index) => actionName(item, `${label}[${index}]`))
}

function extensionName(value: unknown, label: string): string {
  const result = text(value, label)
  if (!/^[a-z][a-z0-9-]*$/u.test(result)) throw new Error(`${label} must use lower-kebab-case`)
  return result
}

function actionName(value: unknown, label: string): string {
  const result = text(value, label)
  if (!/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u.test(result)) {
    throw new Error(`${label} must be a namespaced lower-kebab-case action`)
  }
  return result
}

function contactScope(value: unknown, label: string): '*' | string[] {
  if (value === undefined || value === '*') return '*'
  return array(value, label).map((item, index) => text(item, `${label}[${index}]`))
}

function memberContacts(value: unknown, label: string): FleetMemberContacts {
  if (value === undefined) return { members: '*', channels: '*' }
  const contacts = object(value, label)
  return {
    members: contactScope(contacts.members, `${label}.members`),
    channels: contactScope(contacts.channels, `${label}.channels`),
  }
}

function normalizedMemberView(value: FleetMemberView, label = 'member'): FleetMemberView {
  const raw = value as unknown as Record<string, unknown>
  const color = memberColor(raw, label)
  const provider = optionalText(raw.provider, `${label}.provider`)
  const model = optionalText(raw.model, `${label}.model`)
  const reasoningEffort = optionalText(raw.reasoningEffort, `${label}.reasoningEffort`)
  const maxTokens = raw.maxTokens
  const id = text(raw.id, `${label}.id`)
  if (raw.canVote !== undefined && typeof raw.canVote !== 'boolean') {
    throw new Error(`${label}.canVote must be a boolean`)
  }
  if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || Number(maxTokens) <= 0)) {
    throw new Error(`${label}.maxTokens must be a positive integer`)
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`${label}.id must use lower-kebab-case`)
  return {
    id,
    name: text(raw.name, `${label}.name`),
    ...(color === undefined ? {} : { color }),
    role: text(raw.role, `${label}.role`),
    ...(raw.responsibility === undefined ? {} : { responsibility: optionalText(raw.responsibility, `${label}.responsibility`) }),
    prompt: optionalText(raw.prompt, `${label}.prompt`),
    ...(provider.length === 0 ? {} : { provider }),
    ...(model.length === 0 ? {} : { model }),
    ...(reasoningEffort.length === 0 ? {} : { reasoningEffort }),
    ...(maxTokens === undefined ? {} : { maxTokens: Number(maxTokens) }),
    ...(raw.canVote === undefined ? {} : { canVote: raw.canVote }),
    toolGroups: memberToolGroups(raw.toolGroups, `${label}.toolGroups`),
    permissions: memberPermissions(raw.permissions, `${label}.permissions`),
    contacts: memberContacts(raw.contacts, `${label}.contacts`),
  }
}

function validateMemberContacts(
  members: readonly FleetMemberView[],
  channelIds: ReadonlySet<string>,
  additionalMemberIds: readonly string[] = [],
): void {
  const memberIds = new Set([...members.map(member => member.id), ...additionalMemberIds])
  for (const member of members) {
    if (member.contacts.members !== '*') {
      for (const contact of member.contacts.members) {
        if (!memberIds.has(contact)) throw new Error(`Fleet member ${member.id} has unknown contact ${contact}`)
      }
    }
    if (member.contacts.channels !== '*') {
      for (const channel of member.contacts.channels) {
        if (!channelIds.has(channel)) throw new Error(`Fleet member ${member.id} has unknown Channel #${channel}`)
      }
    }
  }
}

function templateMember(value: unknown, label: string): FleetMemberView {
  const member = object(value, label)
  return normalizedMemberView({
    ...member,
    responsibility: text(member.responsibilities, `${label}.responsibilities`),
  } as unknown as FleetMemberView, label)
}

function parseInitializationTemplate(
  root: Record<string, unknown>,
  configuration: FleetConfigurationRegistry,
): TeamTemplate {
  const core = object(root.core, 'core')
  const modules = configuration.parse(root.modules)
  const message = parseFleetMessageConfiguration(modules[FLEET_MESSAGE_MODULE])
  const resources = parseFleetResourcesConfiguration(modules[FLEET_RESOURCES_MODULE])
  const ui = parseFleetUiConfiguration(modules[FLEET_UI_MODULE])
  const name = text(core.name, 'core.name')
  const positioning = optionalText(core.positioning, 'core.positioning')
  const rules = message.rules
  const collaborationMethod = message.collaborationMethod
  const resourcePolicy = resources.policy
  const updateDensity = ui.userAccess.updateDensity
  const notificationPolicy = ui.userAccess.notificationPolicy
  const contentPreference = ui.userAccess.contentPreference
  const updateInstruction = {
    concise: 'Keep user-facing updates concise.',
    balanced: 'Use balanced user-facing updates with decisions, progress, and enough supporting context.',
    detailed: 'Provide detailed user-facing updates with relevant reasoning and evidence.',
  }[updateDensity]
  const notificationInstruction = {
    decisions: 'Notify the user only when a user decision or external intervention is needed.',
    milestones: 'Notify the user for important milestones, decisions, and external blockers.',
    continuous: 'Keep the user continuously informed of meaningful progress, decisions, and blockers.',
  }[notificationPolicy]
  const members = array(core.members, 'core.members').map((rawMember, index) => (
    templateMember(rawMember, `core.members[${index}]`)
  ))
  const assistant = templateMember(core.assistant, 'core.assistant')
  const participants = [assistant, ...members]
  const ids = new Set(participants.map(member => member.id))
  if (ids.size !== participants.length) throw new Error('Team member ids must be unique')

  const channelId = message.defaultChannel.id
  const channelName = message.defaultChannel.name
  validateMemberContacts(participants, new Set([channelId]))
  const sharedResources = resources.items.map(resource => ({ ...resource }))
  const profile = [
    positioning.length === 0 ? '' : `## Team positioning\n${positioning}`,
    rules.length === 0 ? '' : `## Rules and preferences\n${rules}`,
    collaborationMethod.length === 0 ? '' : `## Collaboration method\n${collaborationMethod}`,
    resourcePolicy.length === 0 ? '' : `## Shared resource preferences\n${resourcePolicy}`,
    [
      '## External user access',
      'The user is an external controller and observer, not a Fleet member. The Team continues to operate when the user is absent.',
      updateInstruction,
      notificationInstruction,
      ...(contentPreference.length === 0 ? [] : [`Content preference: ${contentPreference}`]),
    ].join('\n'),
  ].filter(Boolean).join('\n\n')
  const channelBody = [
    `Team: ${name}`,
    positioning.length === 0 ? '' : `Positioning: ${positioning}`,
    rules.length === 0 ? '' : `Rules and preferences: ${rules}`,
    collaborationMethod.length === 0 ? '' : `Collaboration method: ${collaborationMethod}`,
    resourcePolicy.length === 0 ? '' : `Shared resource preferences: ${resourcePolicy}`,
  ].filter(Boolean).join('\n\n')
  return {
    team: name,
    name,
    operatingPrompt: profile,
    channels: [{
      id: channelId,
      name: channelName,
      initialMessage: '',
      summary: `${name} initialized.`,
      body: channelBody,
    }],
    assistant,
    members,
    sharedResources,
  }
}

function parseTeamTemplate(value: unknown, configuration: FleetConfigurationRegistry): TeamTemplate {
  const root = object(value, 'Team template')
  return parseInitializationTemplate(root, configuration)
}

function materializeTeamConfiguration(value: unknown): Record<string, unknown> {
  const root = object(value, 'Team template')
  const core = object(root.core, 'core')
  const names: string[] = []
  const colors: string[] = []
  const members = array(core.members, 'core.members').map((rawMember, index) => {
    const member = object(rawMember, `core.members[${index}]`)
    const configuredName = optionalText(member.name, `core.members[${index}].name`)
    const configuredColor = optionalText(member.color, `core.members[${index}].color`)
    const name = configuredName || generateMemberDisplayName(names)
    const color = configuredColor.length === 0
      ? generateFleetMemberColor(colors)
      : normalizeFleetMemberColor(configuredColor)
    names.push(name)
    colors.push(color)
    return { ...member, name, color }
  })
  const configuredAssistant = object(core.assistant, 'core.assistant')
  const assistantName = optionalText(configuredAssistant.name, 'core.assistant.name')
    || generateMemberDisplayName(names)
  const assistantColor = optionalText(configuredAssistant.color, 'core.assistant.color')
  const assistant = {
    ...configuredAssistant,
    id: optionalText(configuredAssistant.id, 'core.assistant.id') || 'team-assistant',
    name: assistantName,
    color: assistantColor.length === 0
      ? generateFleetMemberColor(colors)
      : normalizeFleetMemberColor(assistantColor),
    role: optionalText(configuredAssistant.role, 'core.assistant.role') || 'Team Assistant',
    responsibilities: optionalText(configuredAssistant.responsibilities, 'core.assistant.responsibilities')
      || 'Maintain the user-facing Team conversation and help the user observe, control, and collaborate with the Team.',
    prompt: optionalText(configuredAssistant.prompt, 'core.assistant.prompt'),
  }
  return {
    core: { ...core, assistant, members },
    modules: object(root.modules, 'modules'),
  }
}

function reachableRoster(participants: readonly FleetMemberView[], member: FleetMemberView): string {
  const reachableIds = member.contacts.members === '*' ? undefined : new Set(member.contacts.members)
  return participants
    .filter(candidate => candidate.id !== member.id
      && (reachableIds === undefined || reachableIds.has(candidate.id)))
    .map(candidate => `@${candidate.name} [id=${candidate.id}; role=${candidate.role}]`)
    .join('; ')
}

function persona(template: TeamTemplate, member: FleetMemberView): string {
  const members = reachableRoster([...template.members, template.assistant], member)
  const channels = member.contacts.channels === '*' ? 'all Team channels' : member.contacts.channels.map(id => `#${id}`).join(', ')
  return [
    template.operatingPrompt,
    '## Fleet identity',
    `You are @${member.name}, one peer in Fleet Team ${template.team}.`,
    `Use display names such as @${member.name} when addressing teammates; member ids are internal stable identifiers.`,
    'No member is your parent. Use Fleet Channels, direct messages, Meetings, Votes, shared files, and resource references to coordinate.',
    'No Fleet member is a default coordinator. Claim work, negotiate ownership, and ask the relevant peers for review directly.',
    'When another member is clearly doing work that belongs to your responsibility and is clearly outside theirs, send that member one private reminder about the responsibility boundary. Do not police ambiguous overlap.',
    '## Member view',
    `Configured Fleet tool groups: ${member.toolGroups.join(', ') || 'none'}. Optional groups are available only when their sub-plugin is installed.`,
    'Configured groups cover Fleet capabilities only; host tools such as bash, read, and edit come from the Agent preset.',
    'Native subagent spawning is unavailable inside a formal Fleet member. Keep execution in your assigned Fleet Task; route any necessary handoff through durable Fleet Tasks and the visible Team roster.',
    'Every granted Fleet capability with at least one authorized action stays directly available.',
    `Granted Fleet permissions: ${member.permissions.join(', ') || 'none'}.`,
    `Current reachable roster (use these exact identities only): ${members || 'none'}.`,
    `Reachable Channels: ${channels || 'none'}.`,
    FLEET_COLLABORATION_CONTRACT,
    '## Role',
    member.role,
    ...(member.responsibility === undefined ? [] : ['## Responsibility', member.responsibility]),
    ...(member.prompt.length === 0 ? [] : ['## Member instructions', member.prompt]),
  ].join('\n\n')
}

async function installMemberTools(
  childCtx: Context,
  runtime: FleetCollaborationTeam,
  member: string,
  exposeHostFleetTools = false,
  source?: 'create' | 'resume',
): Promise<void> {
  await childCtx.inject(['fs', 'tools'], (scope) => {
    // Formal Fleet members are already the durable parallelism boundary. A
    // native subagent would create an untracked execution branch whose work,
    // lifecycle, and model cost are absent from the Team Task graph. Keep the
    // host tool statically unavailable for the entire member Session instead
    // of allowing it and rejecting individual calls after the model has chosen
    // the route.
    const removeNativeSubagent = scope.tools.restrict({ deny: ['subagent'] })
    const removeFleetTools = runtime.installTools(scope, member, { exposeHostFleetTools })
    return () => {
      removeFleetTools()
      removeNativeSubagent()
    }
  })
  if (source !== undefined) {
    if (childCtx.agent === undefined) throw new Error('Fleet member setup requires ctx.agent')
    await runtime.events.serial('fleet/member/setup', {
      member,
      source,
      agent: childCtx.agent,
      ctx: childCtx,
    })
  }
}

/**
 * An omitted channel member list means "open to every participant whose Fleet
 * view grants the channel". Keep an explicit list only for genuinely restricted
 * channels so assistants attached after Team creation are not frozen out of
 * otherwise public Team conversations.
 */
function initialChannelMembers(
  members: readonly FleetMemberView[],
  channelId: string,
): readonly string[] | undefined {
  const readable = members.filter(member => fleetMemberCanAccessChannel(member, channelId))
  if (readable.length === members.length) return undefined
  return readable.map(member => `@${member.id}`)
}

function isTerminal(status: FleetRunStatus): boolean {
  return TERMINAL.has(status)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const TRACE_EVENT_DATA_LIMIT = 2_000

function traceEventData(value: unknown): string {
  const data = JSON.stringify(value)
  return data.length <= TRACE_EVENT_DATA_LIMIT
    ? data
    : `${data.slice(0, TRACE_EVENT_DATA_LIMIT)}… [${String(data.length - TRACE_EVENT_DATA_LIMIT)} chars omitted]`
}

const EXPLICIT_WAIT_DELAY_MS = 2_000
const QUIET_TOOL_WAIT_DELAY_MS = 90_000
const TEAM_QUIESCENCE_GRACE_MS = 3_000
const DEFAULT_INTERACTION_CHECK_SECONDS = 300
const FLEET_FOREGROUND_PROTOCOL_SECTION = 'fleet:foreground-task-request'
const ASSISTANT_DELEGATION_ONLY_NATIVE_TOOLS = ['bash', 'write', 'edit', 'todo_write'] as const
const ASSISTANT_PROJECT_WRITE_TOOLS = new Set(['write', 'edit'])
const ASSISTANT_READ_ONLY_SHELL_TOOLS = new Set([
  'pwd', 'ls', 'rg', 'grep', 'cat', 'head', 'tail', 'wc', 'stat', 'file', 'du', 'df',
  'sort', 'uniq', 'cut', 'tr', 'jq', 'realpath', 'readlink', 'which', 'type', 'date', 'uname',
])
const ASSISTANT_READ_ONLY_GIT_COMMANDS = new Set([
  'status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree',
])

function assistantShellIsReadOnly(argumentsValue: unknown): boolean {
  if (argumentsValue === null || typeof argumentsValue !== 'object') return false
  const command = (argumentsValue as { readonly command?: unknown }).command
  if (typeof command !== 'string' || command.trim().length === 0) return false
  const scrubbed = command.replaceAll(/\b\d*>\s*\/dev\/null\b/g, '').trim()
  if (/(?:^|[^<])>{1,2}|<{1,2}/.test(scrubbed)) return false
  const segments = scrubbed.split(/\s*(?:&&|\|\||[;\n|])\s*/).filter(Boolean)
  return segments.length > 0 && segments.every(segment => {
    const words = segment.trim().split(/\s+/)
    const executable = words[0]
    if (executable === undefined) return false
    if (executable === 'sed') return !words.some(word => /^-.*i/.test(word))
    if (executable === 'find') return !words.some(word => word === '-delete' || word === '-exec' || word === '-execdir')
    if (executable === 'git') {
      const subcommand = words[1]
      return subcommand === 'branch'
        ? words.includes('--show-current')
        : subcommand !== undefined && ASSISTANT_READ_ONLY_GIT_COMMANDS.has(subcommand)
    }
    return ASSISTANT_READ_ONLY_SHELL_TOOLS.has(executable)
  })
}

function assistantToolCrossesExecutionBoundary(name: string, argumentsValue: unknown): boolean {
  return ASSISTANT_PROJECT_WRITE_TOOLS.has(name)
    || (name === 'bash' && !assistantShellIsReadOnly(argumentsValue))
}
const EXPLICIT_WAIT_TOOLS = new Set(['sleep', 'wait', 'wait_agent', 'wait_threads'])
const COMMAND_ARGUMENT_KEYS = new Set(['cmd', 'command', 'script', 'shell'])

function commandStrings(value: unknown, key?: string): string[] {
  if (typeof value === 'string') return key !== undefined && COMMAND_ARGUMENT_KEYS.has(key.toLowerCase()) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(item => commandStrings(item, key))
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([childKey, child]) => commandStrings(child, childKey))
}

function isPassiveWaitCommand(command: string): boolean {
  const segments = command
    .split(/(?:&&|\|\||;|\n)/u)
    .map(segment => segment.trim())
    .filter(Boolean)
  const passiveCommand = /^(?:(?:builtin|command|exec|timeout)\s+(?:\S+\s+)?)?(?:sleep|wait|tail\s+-f|watch)(?:\s|$)/iu
  return segments.length > 0 && segments.every(segment => passiveCommand.test(segment))
}

function isExplicitWaitCall(name: string, rawArguments: string): boolean {
  const normalizedName = name.trim().toLowerCase().replaceAll('-', '_')
  if (EXPLICIT_WAIT_TOOLS.has(normalizedName)) return true
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments) as unknown
  } catch {
    return false
  }
  if (normalizedName === 'fleet_run' && typeof parsed === 'object' && parsed !== null) {
    if ((parsed as Record<string, unknown>).action === 'wait') return true
  }
  return commandStrings(parsed).some(isPassiveWaitCommand)
}

const NETWORK_RECOVERY_INITIAL_DELAY_MS = 30_000
const NETWORK_RECOVERY_MAX_DELAY_MS = 5 * 60_000
const NETWORK_FAILURE_CODES = new Set(['TRANSPORT', 'TIMEOUT'])
const PROTOCOL_RECOVERY_MAX_ATTEMPTS = 2
const RETRIABLE_PROTOCOL_FAILURE = /\bmalformed_tool_protocol\b/iu
const RESOURCE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024
const RESOURCE_REVISION_MAX_BYTES = 2 * 1024 * 1024
const RESOURCE_HISTORY_LIMIT = 500
const SHARED_FILE_WATCH_DEBOUNCE_MS = 150

function resourcePreviewKind(resource: FleetResource): FleetResourcePreview['kind'] | undefined {
  const mediaType = resource.mediaType?.split(';', 1)[0]?.trim().toLowerCase()
  const name = (resource.label ?? basename(resource.path)).toLowerCase()
  const path = resource.path.toLowerCase()
  if (mediaType === 'text/markdown' || mediaType === 'text/x-markdown'
    || /\.(?:md|markdown)$/u.test(name) || /\.(?:md|markdown)$/u.test(path)) {
    return 'markdown'
  }
  if (mediaType?.startsWith('text/') === true
    || ['application/json', 'application/ld+json', 'application/xml', 'application/yaml', 'application/x-yaml'].includes(mediaType ?? '')
    || /\.(?:txt|json|jsonl|ya?ml|toml|csv|tsv|xml)$/u.test(name)
    || /\.(?:txt|json|jsonl|ya?ml|toml|csv|tsv|xml)$/u.test(path)) return 'text'
  return undefined
}

function boundedTextSnippet(text: string, query: string, maximum: number): string | undefined {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (index < 0) return undefined
  const start = Math.max(0, index - Math.floor(maximum / 3))
  const value = text.slice(start, start + maximum)
  return `${start > 0 ? '…' : ''}${value}${start + value.length < text.length ? '…' : ''}`
}

interface MemberToolActivity {
  readonly calls: Map<string, { readonly explicitWait: boolean }>
  lastInteractionAt: number
  timer: ReturnType<typeof setTimeout> | undefined
}

interface VisibilityReminderState {
  /** Largest model input context observed in the current compaction epoch. */
  latestContextTokens: number
  /** Context size at the epoch start, last reminder, or Team-visible share. */
  baselineContextTokens: number | undefined
  /** True until the first post-compaction context observation establishes a baseline. */
  awaitingPostCompactionBaseline: boolean
  /** Number of reminders already retained in the current compaction epoch. */
  reminderCount: number
  /** The first reminder in each compaction epoch carries the full explanation. */
  detailedReminderSent: boolean
}

type AssistantUserFacingTurn = 'direct' | 'delivery' | 'explicit'

function inputContextTokens(usage: TokenUsage | undefined): number | undefined {
  if (usage === undefined) return undefined
  return usage.inputTokens + (usage.cacheReadTokens ?? 0)
}

interface NetworkRecovery {
  readonly runId: string
  readonly member: string
  readonly route: string
  readonly attempt: number
  timer: ReturnType<typeof setTimeout> | undefined
}

interface ProtocolRecovery {
  readonly runId: string
  readonly member: string
  readonly attempt: number
  pending: boolean
}

function isRetriableProtocolFailure(error: { readonly code: string; readonly message: string }): boolean {
  return error.code === 'PI_AI_ERROR' && RETRIABLE_PROTOCOL_FAILURE.test(error.message)
}

export class FleetRunService {
  private readonly records = new Map<string, FleetRunRecord>()
  private readonly dormantRunIds = new Set<string>()
  private readonly manualWakeRequiredRunIds = new Set<string>()
  private readonly eventSequences = new Map<string, number>()
  private readonly teamProjectionEvents = new Map<string, StoredFleetEvent[]>()
  private readonly teamProjectionIdentities = new Map<string, FleetParticipantIdentities>()
  private readonly memberViewSnapshots = new Map<string, FleetMemberView[]>()
  private readonly assistantSessionsByView = new Map<string, Map<string, Set<string>>>()
  private readonly waiters = new Set<RunWaiter>()
  private readonly finalizations = new Map<string, Promise<void>>()
  private readonly resumingRunIds = new Set<string>()
  private readonly networkRecoveries = new Map<string, NetworkRecovery>()
  private readonly protocolRecoveries = new Map<string, ProtocolRecovery>()
  private readonly memberToolActivity = new Map<string, MemberToolActivity>()
  private readonly waitingSessionIds = new Set<string>()
  private readonly abnormalSessionIds = new Set<string>()
  private readonly sharedFileVersions = new Map<string, Map<string, string>>()
  private readonly sharedFileScanErrors = new Map<string, string>()
  private readonly sharedFileWatchers = new Map<string, FSWatcher>()
  private readonly sharedFileSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly assistantRequestConfigs = new WeakMap<Agent, AssistantRequestConfigRef>()
  private readonly assistantInputBindingAgents = new WeakSet<Agent>()
  private readonly assistantInputTeamLoads = new Map<string, Promise<void>>()
  private readonly assistantTurnOutputs = new Map<string, string>()
  private readonly assistantCurrentTurns = new Map<string, number>()
  private readonly assistantUserFacingTurns = new Map<string, { readonly turn: number; readonly source: AssistantUserFacingTurn }>()
  private readonly memberLastSharedTurns = new Map<string, number>()
  private readonly memberVisibilityReviewedTurns = new Map<string, number>()
  private readonly visibilityReminderStates = new Map<string, VisibilityReminderState>()
  private readonly turnReminderLastShown = new Map<string, Map<FleetTurnReminderSlot, Map<string, number>>>()
  private readonly turnStartReminderTurns = new Map<string, number>()
  private readonly toolResultReminderSequences = new Map<string, number>()
  private readonly assistantToolAgents = new WeakSet<Agent>()
  private readonly assistantNativeToolRestrictions = new WeakMap<Agent, {
    tighten(): void
    release(): void
  }>()
  private readonly receiptBoundAgents = new WeakSet<Agent>()
  private readonly budgetGuardAgents = new WeakSet<Agent>()
  private readonly pausingTeams = new Map<string, Promise<FleetRunRecord>>()
  private readonly pausingMembers = new Map<string, Promise<FleetRunMember>>()
  private readonly ownerMemberResumes = new Map<string, Promise<void>>()
  private readonly pendingAssistantKickoffs = new Map<string, PendingAssistantKickoff>()
  private readonly assistantQuiescenceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly assistantQuiescenceArmed = new Set<string>()
  private residentAssistants: FleetResidentAssistantController | undefined
  private readonly changeListeners = new Set<() => void>()
  private readonly traceChangeListeners = new Set<(teamId: string, memberId: string) => void>()
  private readonly registryDirectory: string
  private readonly archives: FleetArchiveRegistry
  private readonly authorization: FleetAuthorizationService | undefined
  private readonly configuration: FleetConfigurationRegistry
  private readonly turnReminders: FleetTurnReminderLists
  private userLocale: 'zh-CN' | 'en' | undefined

  constructor(
    private readonly ctx: Context,
    private readonly core: FleetCore,
    private readonly collaboration: FleetCollaborationService,
    options: FleetRunServiceOptions = {},
  ) {
    const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    this.registryDirectory = options.registryDirectory ?? join(dshHome, 'dsh-agent-fleet', 'teams')
    this.archives = options.archives ?? new FleetArchiveRegistry()
    this.authorization = options.authorization
    this.configuration = options.configuration ?? new FleetConfigurationRegistry()
    this.turnReminders = options.turnReminders ?? DEFAULT_FLEET_TURN_REMINDERS
    const liveAgents = (this.ctx.agents as typeof this.ctx.agents & { list?: () => Agent[] }).list?.() ?? []
    for (const agent of liveAgents) {
      this.bindParticipantInbox(agent)
      this.bindBudgetGuard(agent)
    }
    this.ctx.on('agent/created', ({ agent }) => {
      this.bindParticipantInbox(agent)
      this.bindBudgetGuard(agent)
    })
    this.loadPersistedTeams()
  }

  private async setupFormalMember(
    childCtx: Context,
    runtime: FleetCollaborationTeam,
    member: string,
    source: 'create' | 'resume',
  ): Promise<void> {
    if (childCtx.agent === undefined) throw new Error('Fleet member setup requires ctx.agent')
    childCtx.on('agent/turn-stopping', ({ agent, turn }) => {
      this.memberTurnStopping(agent, turn)
    })
    childCtx.on('agent/pre-step', async (_payload, next: () => Promise<PreStepDecision>) => {
      return this.preStepReminderDecision(childCtx.agent!, await next())
    })
    await installMemberTools(childCtx, runtime, member, false, source)
  }

  subscribeChanges(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  subscribeTraceChanges(listener: (teamId: string, memberId: string) => void): () => void {
    this.traceChangeListeners.add(listener)
    return () => { this.traceChangeListeners.delete(listener) }
  }

  setResidentAssistantController(controller: FleetResidentAssistantController | undefined): void {
    this.residentAssistants = controller
  }

  setUserLocale(locale: string): 'zh-CN' | 'en' {
    this.userLocale = locale.trim().toLocaleLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
    return this.userLocale
  }

  /** Complete assistant tool binding once the native Agent scope is composed. */
  agentSessionStarted(agent: Agent, recoverRequiredTask = false): void {
    const sessionId = String(agent.id)
    const entry = this.collaboration.entries().find(([runId, runtime]) =>
      runtime.memberNamesById.has(sessionId)
      && this.records.get(runId)?.assistants.some(assistant => assistant.sessionId === sessionId) === true,
    )
    if (entry === undefined) return
    const [runId, runtime] = entry
    const assistantId = runtime.memberNamesById.get(sessionId)
    if (assistantId === undefined) return
    this.bindAssistantInput(agent)
    void this.installAssistantTools(agent, runtime, assistantId)
      .then(() => {
        const record = this.records.get(runId)
        if (
          recoverRequiredTask
          && agent.status !== 'running'
          && record !== undefined
          && (this.continueAssignedTask(runId, runtime, record, agent)
            || this.continueOwnedTasks(runId, runtime, record, agent))
        ) return
        if (agent.status === 'idle') this.agentIdle(agent)
      })
      .catch((error: unknown) => {
        this.ctx.logger('dsh-agent-fleet').warn(
          `Could not install Fleet assistant tools for ${assistantId} in Team ${runId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }

  authorizationBaseline(): FleetAuthorizationBaseline {
    return {
      resolveSubject: (teamId, subject) => {
        const record = this.records.get(teamId)
        if (record === undefined || (subject.kind !== 'member' && subject.kind !== 'assistant')) return undefined
        return this.memberViews(teamId).find(view => view.id === subject.id)
          ?? this.memberViewForAgent(teamId, subject.id)
      },
      actorForAgent: agentId => {
        const actors: FleetAuthorizationActor[] = []
        for (const record of this.records.values()) {
          if (isTerminal(record.status)) continue
          const member = record.members.find(candidate => candidate.sessionId === agentId)
          if (member !== undefined) {
            actors.push({ teamId: record.id, subject: { kind: 'member', id: member.name } })
            continue
          }
          const assistant = record.assistants.find(candidate => candidate.sessionId === agentId)
          if (assistant !== undefined) {
            actors.push({ teamId: record.id, subject: { kind: 'assistant', id: assistant.view.id } })
          }
        }
        if (actors.length > 1) throw new Error(`Agent ${agentId} belongs to more than one active Fleet Team`)
        return actors[0]
      },
      authorizeAction: input => input.subject.kind === 'external'
        && input.subject.id === `fleet-user:${input.teamId}`
        && ['message.post', 'message.wakeup', 'message.interrupt', 'team.manage'].includes(input.action),
      authorizeResource: input => {
        const record = this.records.get(input.teamId)
        const resource = input.resource
        if (record === undefined || resource === undefined) return false
        if (resource.kind === 'team') return resource.id === record.id
        if (resource.kind === 'conversation') {
          if (input.subject.kind === 'external') return input.subject.id === `fleet-user:${record.id}`
          const view = this.memberViews(record.id).find(member => member.id === input.subject.id)
            ?? this.memberViewForAgent(record.id, input.subject.id)
          if (view === undefined) return false
          if (resource.id.startsWith('#')) return fleetMemberCanAccessChannel(view, resource.id.slice(1))
          if (resource.id.startsWith('@')) return view.contacts.members === '*'
            || view.contacts.members.includes(resource.id.slice(1))
          return resource.id.startsWith('meeting:')
        }
        if (resource.kind === 'workspace') return pathInside(record.projectRoot, resource.id)
        if (resource.kind === 'file') {
          return pathInside(record.projectRoot, resource.id)
            || pathInside(join(record.projectRoot, '.fleet', record.id), resource.id)
        }
        if (resource.kind === 'resource') {
          try {
            this.requireRuntime(record.id).resources.getResource(resource.id)
            return true
          } catch {
            return false
          }
        }
        return false
      },
    }
  }

  async create(launcher: Agent, input: CreateRunInput): Promise<FleetRunRecord> {
    if (input.sourceSetupId !== undefined) {
      const existing = this.findBySetupId(input.sourceSetupId, input.projectRoot)
      if (existing !== undefined) {
        return this.dormantRunIds.has(existing.id)
          ? this.resume(launcher, { runId: existing.id, projectRoot: input.projectRoot })
          : existing
      }
    }
    const assistantTeam = this.assistantTeamForSession(String(launcher.id))
    if (assistantTeam !== undefined) {
      throw new Error(`Session ${String(launcher.id)} is already the foreground assistant for Fleet team ${assistantTeam.id}; create or connect the new Team from a separate native Session`)
    }
    if (this.persistence() === undefined) throw new Error('fleet_run requires a DSH session persistence provider')

    const sourceConfigPath = isAbsolute(input.configPath) ? input.configPath : resolve(input.projectRoot, input.configPath)
    const configuration = materializeTeamConfiguration(
      JSON.parse(readFileSync(sourceConfigPath, 'utf8')) as unknown,
    )
    const template = parseTeamTemplate(configuration, this.configuration)
    const provider = input.provider ?? launcher.options.provider
    const model = input.model ?? launcher.options.model
    const maxTokens = input.maxTokens ?? launcher.options.maxTokens
    const runId = `team_${randomUUID()}`
    const configPath = join(this.registryDirectory, runId, 'team.json')

    const record: FleetRunRecord = {
      id: runId,
      ...(input.sourceSetupId === undefined ? {} : { sourceSetupId: input.sourceSetupId }),
      team: template.team,
      name: template.name,
      configPath,
      projectRoot: input.projectRoot,
      launcherSessionId: String(launcher.id),
      agentOptions: {
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
      },
      members: [],
      assistants: [],
      status: 'starting',
      settled: false,
      startedAt: new Date().toISOString(),
    }
    this.records.set(record.id, record)
    this.eventSequences.set(record.id, 0)
    try {
      mkdirSync(this.runDirectory(record), { recursive: true })
      mkdirSync(join(input.projectRoot, '.fleet', runId), { recursive: true })
      writeFileSync(configPath, `${JSON.stringify(configuration, null, 2)}\n`, 'utf8')
      this.writeRecord(record)
      this.rememberTeam(record)
    } catch (error) {
      this.records.delete(record.id)
      this.eventSequences.delete(record.id)
      throw error
    }
    const runtime = this.openCollaboration(record, template.members)
    this.appendEvent(record.id, 'team_created', {
      team: template.team,
      configPath,
      sourceConfigPath,
      ...(input.sourceSetupId === undefined ? {} : { sourceSetupId: input.sourceSetupId }),
      launcherSessionId: String(launcher.id),
    })

    const resourceFiles = template.sharedResources.map(resource => ({
      ...resource,
      path: isAbsolute(resource.path) ? resource.path : resolve(input.projectRoot, resource.path),
    }))
    const missing = [...input.requiredPaths, ...resourceFiles.map(resource => resource.path)]
      .map(path => isAbsolute(path) ? path : resolve(input.projectRoot, path))
      .filter(path => !existsSync(path))
    if (missing.length > 0) {
      const summary = `Missing required paths: ${missing.join(', ')}`
      const failed = this.replaceRecord(record.id, {
        assistants: [],
        status: 'failed',
        settled: true,
        endedAt: new Date().toISOString(),
        summary,
        error: summary,
      })
      this.appendEvent(record.id, 'team_status', { status: 'failed', summary })
      this.notify(failed)
      this.collaboration.closeTeam(record.id)
      this.teamProjectionEvents.delete(record.id)
      this.teamProjectionIdentities.delete(record.id)
      this.eventSequences.delete(record.id)
      this.forgetTeam(record.id)
      return this.describeRecord(failed)
    }
    const invalidResources = resourceFiles.filter(resource => !statSync(resource.path).isFile())
    if (invalidResources.length > 0) {
      const summary = `Shared resources must be regular files: ${invalidResources.map(resource => resource.path).join(', ')}`
      const failed = this.replaceRecord(record.id, {
        status: 'failed',
        settled: true,
        endedAt: new Date().toISOString(),
        summary,
        error: summary,
      })
      this.appendEvent(record.id, 'team_status', { status: 'failed', summary })
      this.notify(failed)
      this.collaboration.closeTeam(record.id)
      this.teamProjectionEvents.delete(record.id)
      this.teamProjectionIdentities.delete(record.id)
      this.eventSequences.delete(record.id)
      this.forgetTeam(record.id)
      return this.describeRecord(failed)
    }

    const created: string[] = []
    try {
      const members: FleetRunMember[] = []
      for (const member of template.members) {
        const memberProvider = member.provider ?? input.provider
        const memberModel = member.model ?? input.model
        const memberMaxTokens = member.maxTokens ?? input.maxTokens
        const agent = await this.core.create(launcher, {
          name: this.runtimeMemberName(record.id, member.id),
          archiveId: this.memberArchiveId(record.id, member.id),
          displayName: member.name,
          ...(member.color === undefined ? {} : { color: member.color }),
          role: member.role,
          cwd: input.projectRoot,
          persona: persona(template, member),
          ...(memberProvider === undefined ? {} : { provider: memberProvider }),
          ...(memberModel === undefined ? {} : { model: memberModel }),
          ...(member.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(member.reasoningEffort) }),
          ...(memberMaxTokens === undefined ? {} : { maxTokens: memberMaxTokens }),
          setup: childCtx => this.setupFormalMember(childCtx, runtime, member.id, 'create'),
        })
        created.push(member.id)
        runtime.memberIdsByName.set(member.id, agent.id)
        runtime.memberNamesById.set(agent.id, member.id)
        members.push({
          name: member.id,
          displayName: agent.displayName,
          color: agent.color,
          role: member.role,
          sessionId: agent.id,
        })
        this.replaceRecord(record.id, { members: [...members] })
        this.appendEvent(record.id, 'member_attached', members.at(-1))
      }

      for (const channel of template.channels) {
        const channelMembers = initialChannelMembers([template.assistant, ...template.members], channel.id)
        runtime.messages.initializeChannel({
          id: channel.id,
          name: channel.name,
          ...(channelMembers === undefined ? {} : { members: channelMembers }),
          summary: channel.summary,
          body: channel.body,
          ...(channel.initialMessage.length === 0 ? {} : { initialMessage: channel.initialMessage }),
        })
      }

      const attached = await this.attachAssistant(launcher, {
        runId: record.id,
        id: template.assistant.id,
        name: template.assistant.name,
        ...(template.assistant.color === undefined ? {} : { color: template.assistant.color }),
        role: template.assistant.role,
        ...(template.assistant.responsibility === undefined
          ? {}
          : { responsibility: template.assistant.responsibility }),
        prompt: template.assistant.prompt,
        ...(template.assistant.provider === undefined ? {} : { provider: template.assistant.provider }),
        ...(template.assistant.model === undefined ? {} : { model: template.assistant.model }),
        toolGroups: template.assistant.toolGroups,
        permissions: template.assistant.permissions,
        contacts: template.assistant.contacts,
      })
      const resourceOwnerSessionId = members[0]?.sessionId ?? attached.assistant.sessionId
      for (const resource of resourceFiles) {
        const info = statSync(resource.path)
        runtime.resources.addResource(resourceOwnerSessionId, {
          path: resource.path,
          label: resource.label ?? basename(resource.path),
          ...(resource.mediaType === undefined ? {} : { mediaType: resource.mediaType }),
          size: info.size,
        })
      }

      const idle = this.replaceRecord(record.id, { status: 'idle' })
      this.appendEvent(record.id, 'team_status', { status: 'idle' })
      runtime.activateProductivity()
      runtime.events.emit('fleet/team/session-start', { source: 'create' })
      return this.describeRecord(idle)
    } catch (error) {
      for (const name of created.reverse()) {
        try {
          await this.core.stopManaged(this.runtimeMemberName(record.id, name))
        } catch {}
      }
      this.collaboration.closeTeam(record.id)
      this.forgetTeam(record.id)
      const failed = this.replaceRecord(record.id, {
        assistants: [],
        status: 'failed',
        settled: true,
        endedAt: new Date().toISOString(),
        error: errorMessage(error),
      })
      this.appendEvent(record.id, 'team_status', { status: 'failed', error: failed.error })
      this.teamProjectionEvents.delete(record.id)
      this.teamProjectionIdentities.delete(record.id)
      this.eventSequences.delete(record.id)
      this.notify(failed)
      throw error
    }
  }

  start(launcher: Agent, input: StartRunInput): FleetRunRecord {
    if (input.runId !== undefined && this.resumingRunIds.has(input.runId)) {
      throw new Error(`Fleet run ${input.runId} is resuming`)
    }
    const record = this.requireRecord(input.runId, input.projectRoot)
    this.requireRuntime(record.id)
    if (record.status !== 'idle') throw new Error(`Fleet team ${record.id} cannot start work while ${record.status}`)
    this.requireLifecycleControl(record, launcher)

    const taskPath = isAbsolute(input.taskPath) ? input.taskPath : resolve(input.projectRoot, input.taskPath)
    const task = readFileSync(taskPath, 'utf8').trim()
    if (task.length === 0) throw new Error('Fleet work cannot be empty')
    // Starting work must be possible while every formal member is unloaded.
    // The first ready owner Task is the deterministic propulsion source that
    // resumes exactly the required member. Explicitly paused members remain
    // unavailable for assignment.
    const available = record.members.filter(member => member.status !== 'paused')
    if (available.length === 0) throw new Error(`Fleet team ${record.id} has no available members`)
    const decision = this.requireRuntime(record.id).events.waterfall(
      'fleet/work/pre-start',
      { proposal: { taskPath, task } },
      () => ({ kind: 'start', task }),
    )
    if (decision.kind === 'reject') throw new Error(decision.reason.trim() || 'Fleet work was rejected')
    const acceptedTask = decision.task.trim()
    if (acceptedTask.length === 0) throw new Error('Fleet work hook produced an empty work description')
    const workId = `work_${randomUUID()}`
    const workDirectory = join(this.runDirectory(record), 'work')
    const acceptedTaskPath = join(workDirectory, `${workId}.md`)
    mkdirSync(workDirectory, { recursive: true })
    const temporaryTaskPath = join(workDirectory, `.${workId}.${process.pid}.tmp`)
    writeFileSync(temporaryTaskPath, `${acceptedTask}\n`, 'utf8')
    renameSync(temporaryTaskPath, acceptedTaskPath)
    const runtime = this.requireRuntime(record.id)
    const kickoffKey = `${record.id}:${String(launcher.id)}`
    const kickoff = input.stages === undefined ? this.pendingAssistantKickoffs.get(kickoffKey) : undefined
    this.pendingAssistantKickoffs.delete(kickoffKey)
    const kickoffReplyTaskIds = kickoff === undefined || kickoff.staged
      ? []
      : runtime.tasks.state().tasks
          .filter(candidate => candidate.domain.kind === 'reply'
            && candidate.domain.messageId === kickoff.messageId)
          .map(candidate => candidate.id)
    const requestedStages: readonly FleetAssistantStage[] | undefined = input.stages?.length
      ? input.stages.map(stage => ({
          ...stage,
          owners: stage.owners.map(reference => {
            const member = available.find(candidate => candidate.name === reference || candidate.displayName === reference)
            if (member === undefined) throw new Error(`Fleet stage owner ${reference} is not available`)
            return member.name
          }),
        }))
      : kickoff?.stages.length
      ? kickoff.stages
      : undefined
    const plannedRootOwner = requestedStages?.find(stage => stage.dependencies.length === 0)?.owners[0]
      ?? kickoff?.recipients[0]
    const rootOwner = available.find(member => member.name === plannedRootOwner || member.displayName === plannedRootOwner)
      ?? available[0]!
    const plannedStages: readonly FleetAssistantStage[] = requestedStages ?? [{
          key: 'delivery', kind: 'goal', title: 'Deliver the Fleet work item',
          description: acceptedTask, owners: [rootOwner.name], dependencies: [],
        }]
    const plan = runtime.tasks.createCompositePlan(rootOwner.sessionId, {
      title: `Fleet work ${workId}`,
      description: acceptedTask,
      coordinator: rootOwner.name,
      stages: plannedStages.map(stage => ({
        key: stage.key,
        kind: stage.kind,
        title: stage.title,
        ...(stage.description.length === 0 ? {} : { description: stage.description }),
        owners: stage.owners,
        dependencies: stage.dependencies,
        ...(stage.timeoutAt === undefined ? {} : { timeoutAt: stage.timeoutAt }),
      })),
      dependencies: kickoffReplyTaskIds,
      rootWorkId: workId,
      ...(input.resultStage === undefined ? {} : { resultStage: input.resultStage }),
    })
    const rootTask = plan.task
    const stageTasks = plan.stages
    if (kickoff?.staged) {
      runtime.messages.send(launcher, {
        to: `#${kickoff.channelId}`,
        text: kickoff.text,
        delivery: 'quiet',
        mentions: kickoff.recipients,
        kind: 'work_directive',
      })
    }
    const work: FleetWorkRecord = {
      id: workId,
      rootTaskId: rootTask.id,
      taskPath,
      acceptedTaskPath,
      status: 'running',
      startedAt: new Date().toISOString(),
    }
    const running = this.replaceRecord(record.id, { status: 'running', work })
    this.manualWakeRequiredRunIds.delete(record.id)
    this.appendEvent(record.id, 'work_started', {
      workId: work.id,
      rootTaskId: rootTask.id,
      childTaskIds: [...stageTasks.values()].map(task => task.id),
      taskPath,
      acceptedTaskPath,
      directive: input.directive?.trim() || kickoff?.text || acceptedTask,
    })
    const launchingAssistant = running.assistants.find(assistant => assistant.sessionId === String(launcher.id))
    if (launchingAssistant !== undefined && runtime.tasks.interactionTask(launchingAssistant.view.id)?.stableState.kind === 'running') {
      runtime.tasks.deferInteraction(String(launcher.id), {
        reason: `Waiting for Fleet work ${work.id} to settle, reach a Team quiescence point, or reach its progress deadline.`,
        taskIds: [rootTask.id],
        checkAfterSeconds: DEFAULT_INTERACTION_CHECK_SECONDS,
      })
    }

    return this.describeRecord(running)
  }

  async resume(launcher: Agent, input: ResumeRunInput): Promise<FleetRunRecord> {
    if (this.resumingRunIds.has(input.runId)) throw new Error(`Fleet run ${input.runId} is already resuming`)
    const assistantTeam = this.assistantTeamForSession(String(launcher.id), input.runId)
    if (assistantTeam !== undefined) {
      throw new Error(`Session ${String(launcher.id)} is already the foreground assistant for Fleet team ${assistantTeam.id}; resume team ${input.runId} from a separate native Session`)
    }
    const wasDormant = this.dormantRunIds.has(input.runId)
    if (!wasDormant && this.collaboration.has(input.runId)) {
      throw new Error(`Fleet run ${input.runId} is already active in this process`)
    }

    let record = this.requireRecord(input.runId, input.projectRoot)
    if (isTerminal(record.status)) {
      if (record.settled) throw new Error(`Fleet run ${record.id} is already ${record.status} and settled`)
      return this.settleInterruptedTerminal(record)
    }
    if (record.status !== 'starting' && record.status !== 'idle' && record.status !== 'running'
      && record.status !== 'paused' && record.status !== 'finishing') {
      throw new Error(`Fleet run ${record.id} cannot resume from ${record.status}`)
    }
    if (this.persistence() === undefined) throw new Error('fleet_run requires a DSH session persistence provider')

    const template = parseTeamTemplate(
      JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown,
      this.configuration,
    )
    if (template.team !== record.team) throw new Error(`Fleet run ${record.id} Team config no longer matches ${record.team}`)
    const events = this.storedEvents(record)
    const effectiveViews = this.effectiveMemberViews(record, events)
    const effectiveTemplate: TeamTemplate = { ...template, members: effectiveViews }
    const templates = new Map(effectiveViews.map(member => [member.id, member]))
    const attached = new Map(record.members.map(member => [member.name, member]))
    for (const event of events) {
      if (event.type !== 'member_attached') continue
      const member = event.data as FleetRunMember
      if (!attached.has(member.name)) attached.set(member.name, member)
    }
    const restoredColors: string[] = []
    const members: FleetRunMember[] = effectiveViews.flatMap(member => {
      const attachedMember = attached.get(member.id)
      if (attachedMember === undefined) return []
      const color = normalizeFleetMemberColor(member.color ?? attachedMember.color ?? generateFleetMemberColor(restoredColors))
      restoredColors.push(color)
      return [{
        ...attachedMember,
        displayName: member.name,
        color,
        role: member.role,
      }]
    })
    if (
      members.length !== record.members.length
      || record.members.some(member => member.displayName === undefined || member.color === undefined)
    ) {
      record = this.replaceRecord(record.id, { members })
    }

    const collaborationState = this.collaborationState(record, events)
    const provider = record.agentOptions?.provider ?? launcher.options.provider
    const model = record.agentOptions?.model ?? launcher.options.model
    const maxTokens = record.agentOptions?.maxTokens ?? launcher.options.maxTokens
    const agentOptions = {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    }
    if (wasDormant) {
      this.collaboration.closeTeam(input.runId)
      this.dormantRunIds.delete(input.runId)
    }
    const runtime = this.openCollaboration(record, effectiveViews)
    const managed: string[] = []
    const memberRebinds: Array<{
      readonly previousSessionId: string
      readonly sessionId: string
      readonly view: FleetMemberView
    }> = []
    const shouldResumeMember = (member: FleetRunMember): boolean => record.status !== 'paused'
      && member.status !== 'paused'
    this.resumingRunIds.add(record.id)
    try {
      for (const member of members.filter(shouldResumeMember)) {
        const memberTemplate = templates.get(member.name)
        if (memberTemplate === undefined) throw new Error(`missing Team member ${member.name}`)
        const memberAgentOptions = {
          ...agentOptions,
          ...(memberTemplate.provider === undefined ? {} : { provider: memberTemplate.provider }),
          ...(memberTemplate.model === undefined ? {} : { model: memberTemplate.model }),
          ...(memberTemplate.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: ReasoningEffortId(memberTemplate.reasoningEffort) }),
          ...(memberTemplate.maxTokens === undefined ? {} : { maxTokens: memberTemplate.maxTokens }),
        }
        const resumed = await this.core.resume(launcher, {
          id: member.sessionId,
          name: this.runtimeMemberName(record.id, member.name),
          archiveId: this.memberArchiveId(record.id, member.name),
          displayName: member.displayName ?? memberTemplate.name,
          color: member.color ?? memberTemplate.color ?? generateFleetMemberColor(),
          role: memberTemplate.role,
          persona: persona(effectiveTemplate, {
            ...memberTemplate,
            name: member.displayName ?? memberTemplate.name,
          }),
          setup: childCtx => this.setupFormalMember(childCtx, runtime, member.name, 'resume'),
          ...memberAgentOptions,
        })
        runtime.memberIdsByName.set(member.name, resumed.id)
        runtime.memberNamesById.set(resumed.id, member.name)
        if (resumed.id !== member.sessionId) {
          memberRebinds.push({ previousSessionId: member.sessionId, sessionId: resumed.id, view: memberTemplate })
        }
        const index = members.findIndex(candidate => candidate.name === member.name)
        if (index >= 0) members[index] = {
          ...member,
          sessionId: resumed.id,
          displayName: resumed.displayName,
          color: resumed.color,
          status: 'idle',
        }
        managed.push(member.name)
      }
      {
        for (const memberTemplate of effectiveViews) {
          if (members.some(member => member.name === memberTemplate.id)) continue
          const memberAgentOptions = {
            ...agentOptions,
            ...(memberTemplate.provider === undefined ? {} : { provider: memberTemplate.provider }),
            ...(memberTemplate.model === undefined ? {} : { model: memberTemplate.model }),
            ...(memberTemplate.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: ReasoningEffortId(memberTemplate.reasoningEffort) }),
            ...(memberTemplate.maxTokens === undefined ? {} : { maxTokens: memberTemplate.maxTokens }),
          }
          const agent = await this.core.create(launcher, {
            name: this.runtimeMemberName(record.id, memberTemplate.id),
            archiveId: this.memberArchiveId(record.id, memberTemplate.id),
            displayName: memberTemplate.name,
            ...(memberTemplate.color === undefined ? {} : { color: memberTemplate.color }),
            role: memberTemplate.role,
            cwd: record.projectRoot,
            persona: persona(effectiveTemplate, memberTemplate),
            setup: childCtx => this.setupFormalMember(childCtx, runtime, memberTemplate.id, 'create'),
            ...memberAgentOptions,
          })
          const member: FleetRunMember = {
            name: memberTemplate.id,
            displayName: agent.displayName,
            color: agent.color,
            role: memberTemplate.role,
            sessionId: agent.id,
          }
          members.push(member)
          runtime.memberIdsByName.set(member.name, member.sessionId)
          runtime.memberNamesById.set(member.sessionId, member.name)
          managed.push(member.name)
          record = this.replaceRecord(record.id, { members: [...members] })
          this.appendEvent(record.id, 'member_attached', member)
        }
      }

      runtime.restore(collaborationState)
      for (const rebind of memberRebinds) {
        runtime.rebindMember(rebind.previousSessionId, rebind.sessionId, rebind.view)
      }
      const previousLauncherSessionId = record.launcherSessionId
      this.eventSequences.set(record.id, this.lastStoredSequence(record))
      const previousAssistant = record.assistants.find(candidate =>
        candidate.sessionId === previousLauncherSessionId,
      ) ?? (record.assistants.length === 1 ? record.assistants[0] : undefined)
      const attached = await this.attachAssistant(launcher, {
        runId: record.id,
        ...(previousAssistant === undefined ? {} : { assistantId: previousAssistant.view.id }),
      })
      record = this.requireRecord(attached.run.id)

      const restoredChannels = new Set(runtime.messages.listChannels(launcher).map(channel => channel.id))
      for (const channel of template.channels) {
        if (restoredChannels.has(channel.id)) continue
        const channelMembers = initialChannelMembers(effectiveViews, channel.id)
        runtime.messages.initializeChannel({
          id: channel.id,
          name: channel.name,
          ...(channelMembers === undefined ? {} : { members: channelMembers }),
          summary: channel.summary,
          body: channel.body,
          ...(channel.initialMessage.length === 0 ? {} : { initialMessage: channel.initialMessage }),
        })
      }
      runtime.messages.connectAgent(String(launcher.id), template.channels.map(channel => channel.id))

      this.appendEvent(record.id, wasDormant ? 'team_loaded' : 'team_resumed', {
        launcherSessionId: String(launcher.id),
        previousLauncherSessionId,
        members: members.map(member => member.name),
      })
      const restoredStatus: FleetRunStatus = record.status === 'starting'
        ? (record.work?.status === 'running' ? 'running' : 'idle')
        : record.status === 'finishing' ? 'idle'
          : record.status
      if (record.status === 'starting' || record.status === 'finishing') {
        this.appendEvent(record.id, 'team_status', { status: restoredStatus })
      }
      const restored = this.replaceRecord(record.id, {
        launcherSessionId: String(launcher.id),
        agentOptions,
        members: [...members],
        status: restoredStatus,
        teamPausedMembers: record.teamPausedMembers ?? [],
      })
      if (restored.status === 'paused') runtime.pauseProductivity()
      else runtime.activateProductivity()
      if (restored.work?.status === 'running') this.manualWakeRequiredRunIds.add(record.id)
      runtime.events.emit('fleet/team/session-start', { source: 'resume' })
      return this.describeRecord(restored)
    } catch (error) {
      runtime.detachMember(String(launcher.id))
      for (const name of managed.reverse()) {
        try {
          await this.core.stopManaged(this.runtimeMemberName(record.id, name))
        } catch {}
      }
      this.collaboration.closeTeam(record.id)
      const current = this.requireRecord(record.id)
      if (!isTerminal(current.status)) {
        try {
          this.openDormantTeam(current)
        } catch (restoreError) {
          this.ctx.logger('dsh-agent-fleet').warn(
            `Could not restore background services for Fleet Team ${record.id}: ${errorMessage(restoreError)}`,
          )
        }
      }
      throw error
    } finally {
      this.resumingRunIds.delete(record.id)
    }
  }

  list(projectRoot?: string): FleetRunRecord[] {
    return [...this.records.values()]
      .filter(record => projectRoot === undefined || record.projectRoot === projectRoot)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map(record => this.describeRecord(record))
  }

  findBySetupId(setupId: string, projectRoot: string): FleetRunRecord | undefined {
    return this.list(projectRoot).find(record =>
      record.sourceSetupId === setupId && record.projectRoot === projectRoot,
    )
  }

  status(runId?: string, projectRoot?: string): FleetRunRecord {
    return this.describeRecord(this.requireRecord(runId, projectRoot))
  }

  messageHub(runId: string): MessageHub {
    return this.requireRuntime(runId).messages
  }

  taskBoard(runId: string): FleetTaskBoard {
    return this.requireRuntime(runId).tasks
  }

  assistantInteraction(caller: Agent, runId?: string) {
    const record = this.requireCallerRecord(caller, runId)
    const assistant = this.requireAssistantConnection(caller, record.id)
    const task = this.requireRuntime(record.id).tasks.interactionTask(assistant.view.id)
    if (task === undefined) throw new Error(`Fleet assistant ${assistant.view.id} has no foreground Interaction Task`)
    return task
  }

  continueAssistantInteraction(caller: Agent, input: ContinueFleetInteractionInput) {
    const record = this.requireCallerRecord(caller, input.runId)
    const assistant = this.requireAssistantConnection(caller, record.id)
    const runtime = this.requireRuntime(record.id)
    const formalMembers = new Set(record.members.map(member => member.name))
    if (input.goal !== undefined) {
      for (const owner of input.goal.owners) {
        const resolved = this.memberViews(record.id).find(member =>
          member.id === owner || member.name === owner)?.id
        if (resolved === undefined || !formalMembers.has(resolved)) {
          throw new Error(`Interaction continuation owner ${owner} must be a formal Team member`)
        }
      }
    }
    const liveTaskIds: string[] = []
    if (input.taskIds !== undefined) {
      for (const taskId of input.taskIds) {
        const task = runtime.tasks.get(String(caller.id), taskId)
        if (task.domain.kind === 'interaction'
          || !task.owners.some(owner => formalMembers.has(owner.member))) {
          throw new Error(`Interaction continuation Task ${taskId} must be owned by a formal Team member`)
        }
        if (task.stableState.kind !== 'completed' && task.stableState.kind !== 'cancelled') {
          liveTaskIds.push(task.id)
        }
      }
    }
    if (input.taskIds !== undefined && liveTaskIds.length === 0 && input.goal === undefined) {
      const task = runtime.tasks.interactionTask(assistant.view.id)
      if (task === undefined) throw new Error(`Fleet assistant ${assistant.view.id} has no foreground Interaction Task`)
      return { task, goals: [] }
    }
    const current = runtime.tasks.interactionTask(assistant.view.id)
    if (current?.stableState.kind === 'dormant'
      && input.taskIds === undefined
      && input.goal === undefined) {
      return { task: current, goals: [] }
    }
    return runtime.tasks.deferInteraction(String(caller.id), {
      reason: input.reason,
      ...(input.taskIds === undefined ? {} : { taskIds: liveTaskIds }),
      ...(input.goal === undefined ? {} : { goal: input.goal }),
      checkAfterSeconds: input.checkAfterSeconds ?? DEFAULT_INTERACTION_CHECK_SECONDS,
    })
  }

  takeOverAssistantInteraction(caller: Agent, input: TakeOverFleetInteractionInput) {
    const record = this.requireCallerRecord(caller, input.runId)
    const assistant = this.requireAssistantConnection(caller, record.id)
    const task = this.requireRuntime(record.id).tasks.takeOverInteraction(String(caller.id), input.reason)
    this.assistantNativeToolRestrictions.get(caller)?.release()
    return task
  }

  private markAssistantUserFacingTurn(caller: Agent, source: AssistantUserFacingTurn): void {
    const sessionId = String(caller.id)
    const turn = this.assistantCurrentTurns.get(sessionId) ?? this.currentOpenTurn(caller)
    if (turn === undefined) return
    const current = this.assistantUserFacingTurns.get(sessionId)
    if (current?.turn === turn && (current.source === 'direct' || source === 'explicit')) return
    this.assistantUserFacingTurns.set(sessionId, { turn, source })
  }

  updateAssistantInteraction(caller: Agent, input: UpdateFleetInteractionInput) {
    const record = this.requireCallerRecord(caller, input.runId)
    const assistant = this.requireAssistantConnection(caller, record.id)
    const updated = this.requireRuntime(record.id).tasks.recordInteractionUpdate(assistant.view.id, input.message)
    this.markAssistantUserFacingTurn(caller, 'explicit')
    return updated
  }

  reportAssistantInteraction(caller: Agent, input: ReportFleetInteractionInput) {
    const record = this.requireCallerRecord(caller, input.runId)
    this.requireAssistantConnection(caller, record.id)
    const reported = this.requireRuntime(record.id).tasks.submitInteractionReport(String(caller.id), {
      outcome: input.outcome,
      reason: input.reason,
      report: input.report,
    })
    this.markAssistantUserFacingTurn(caller, 'delivery')
    return reported
  }

  private assistantExecutionBoundaryReason(
    caller: Agent,
    execution: { readonly name: string; readonly arguments: unknown },
  ): string | undefined {
    if (!assistantToolCrossesExecutionBoundary(execution.name, execution.arguments)) return undefined
    const record = this.assistantTeamForSession(String(caller.id))
    if (record === undefined) return undefined
    const assistant = record.assistants.find(candidate => candidate.sessionId === String(caller.id))
    const interaction = assistant === undefined
      ? undefined
      : this.collaboration.get(record.id)?.tasks.interactionTask(assistant.view.id)
    if (interaction?.domain.kind !== 'interaction') return undefined
    const lease = interaction.domain.executionLease
    if (lease?.revision === interaction.domain.inputRevision) return undefined
    return [
      `[Fleet non-retryable tool route] ${execution.name} is not routed for Interaction Task ${interaction.id} in this turn.`,
      'Normal conversation, status checks, coordination, and read-only inspection remain available.',
      'For Team work, create/link formal-member Tasks and call fleet_user_task action="continue".',
      'Only when the user explicitly asked the assistant to execute personally, no formal member is available, or Team execution has failed, call fleet_user_task action="take_over" with a concrete reason, then retry.',
      'Do not retry this tool or a substitute project-execution tool before one of those routing states changes.',
    ].join(' ')
  }

  requireAssistantConnection(caller: Agent, runId: string, allowDormant = false): FleetRunAssistant {
    const record = this.requireRecord(runId)
    if (allowDormant && this.dormantRunIds.has(record.id)) {
      const assistant = record.assistants[0]
      if (assistant === undefined) throw new Error(`Fleet team ${record.id} has no assistant identity to resume`)
      return structuredClone(assistant)
    }
    const assistant = record.assistants.find(candidate => candidate.sessionId === String(caller.id))
    if (assistant === undefined) {
      throw new Error(`Agent ${String(caller.id)} is not a Fleet assistant for team ${record.id}`)
    }
    const connected = this.requireRuntime(record.id).memberNamesById.get(String(caller.id))
    if (connected !== assistant.view.id) {
      throw new Error(`Fleet assistant ${assistant.view.id} is not connected to team ${record.id}`)
    }
    return structuredClone(assistant)
  }

  resourceStore(runId: string): FleetResources {
    return this.requireRuntime(runId).resources
  }

  memberStatusBoard(runId: string): FleetMemberStatusBoard {
    return this.requireRuntime(runId).memberStatuses
  }

  memberViews(runId: string): FleetMemberView[] {
    const record = this.requireRecord(runId)
    let memberViews = this.memberViewSnapshots.get(record.id)
    if (memberViews === undefined) {
      memberViews = this.effectiveMemberViews(record)
      this.memberViewSnapshots.set(record.id, memberViews)
    }
    return [
      ...memberViews,
      ...record.assistants.map(assistant => assistant.view),
    ].map(view => structuredClone(view))
  }

  memberViewForAgent(runId: string, agentId: string): FleetMemberView | undefined {
    const member = this.collaboration.get(runId)?.memberNamesById.get(agentId)
    if (member === undefined) return undefined
    return this.memberViews(runId).find(view => view.id === member)
  }

  readExtensionState(runId: string, namespace: string): JsonValue | undefined {
    const record = this.requireRecord(runId)
    const path = this.extensionStatePath(record, namespace)
    if (!existsSync(path)) return undefined
    return JSON.parse(readFileSync(path, 'utf8')) as JsonValue
  }

  writeExtensionState(runId: string, namespace: string, value: JsonValue): void {
    const record = this.requireRecord(runId)
    const target = this.extensionStatePath(record, namespace)
    mkdirSync(dirname(target), { recursive: true })
    const temporary = join(dirname(target), `.${namespace}.${process.pid}.${randomUUID()}.tmp`)
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temporary, target)
  }

  moduleConfiguration(runId: string, moduleId: string): FleetConfigurationValue | undefined {
    const record = this.requireRecord(runId)
    const configured = object(JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown, 'Team template')
    return this.configuration.parse(configured.modules)[moduleId]
  }

  teamSettings(runId: string): FleetTeamSettingsSnapshot {
    const record = this.requireRecord(runId)
    const configured = object(JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown, 'Team template')
    const core = object(configured.core, 'core')
    const modules = this.configuration.parse(configured.modules)
    const message = parseFleetMessageConfiguration(modules[FLEET_MESSAGE_MODULE])
    const ui = parseFleetUiConfiguration(modules[FLEET_UI_MODULE])
    const projected = this.describeRecord(record)
    const actors = [...projected.members, ...projected.assistants.map(assistant => assistant.view)]
    const common = <T,>(values: readonly (T | undefined)[]): { readonly value?: T; readonly mixed: boolean } => {
      const first = values[0]
      const mixed = values.some(value => value !== first)
      return { ...(first === undefined ? {} : { value: first }), mixed }
    }
    const providers = common(actors.map(actor => actor.provider))
    const models = common(actors.map(actor => actor.model))
    const efforts = common(actors.map(actor => actor.reasoningEffort))
    const tokenLimits = common(actors.map(actor => actor.maxTokens))
    return {
      name: record.name,
      positioning: optionalText(core.positioning, 'core.positioning'),
      rules: message.rules,
      collaborationMethod: message.collaborationMethod,
      visibilityReminderContextGrowthTokens: message.visibilityReminderContextGrowthTokens,
      updateDensity: ui.userAccess.updateDensity,
      notificationPolicy: ui.userAccess.notificationPolicy,
      contentPreference: ui.userAccess.contentPreference,
      projectRoot: record.projectRoot,
      request: {
        ...(providers.mixed || providers.value === undefined ? {} : { provider: providers.value }),
        ...(models.mixed || models.value === undefined ? {} : { model: models.value }),
        ...(efforts.mixed || efforts.value === undefined ? {} : { reasoningEffort: efforts.value }),
        ...(tokenLimits.mixed || tokenLimits.value === undefined ? {} : { maxTokens: tokenLimits.value }),
        mixed: {
          model: providers.mixed || models.mixed,
          reasoningEffort: efforts.mixed,
          maxTokens: tokenLimits.mixed,
        },
      },
      budget: this.teamBudget(record.id),
    }
  }

  teamBudget(runId: string): FleetTeamBudgetSnapshot {
    const record = this.requireRecord(runId)
    const state = record.budget
    const mode = state?.mode ?? 'tokens'
    const rates = state?.rates ?? []
    const team = budgetAccountSnapshot(state?.team ?? emptyBudgetAccount(record.startedAt))
    const memberViews = new Map(this.memberViews(record.id).map(view => [view.id, view]))
    const participants = [
      ...record.members.map(member => {
        const view = memberViews.get(member.name)
        const memberColor = member.color ?? view?.color
        return {
          memberId: member.name,
          name: member.displayName ?? view?.name ?? member.name,
          role: view?.role ?? member.role,
          ...(memberColor === undefined ? {} : { color: memberColor }),
          assistant: false,
          active: true,
        }
      }),
      ...record.assistants.map(assistant => ({
        memberId: assistant.view.id,
        name: assistant.view.name,
        role: assistant.view.role,
        ...(assistant.view.color === undefined ? {} : { color: assistant.view.color }),
        assistant: true,
        active: true,
      })),
    ]
    const participantIds = new Set(participants.map(participant => participant.memberId))
    const historicalParticipants = (state?.members ?? [])
      .filter(account => !participantIds.has(account.memberId) && (account.used > 0 || account.calls > 0))
      .map(account => ({
        memberId: account.memberId,
        name: account.name ?? account.memberId,
        role: account.role ?? '',
        ...(account.color === undefined ? {} : { color: account.color }),
        assistant: account.assistant ?? false,
        active: false,
      }))
    const configuredModels = [...new Map(
      [...this.describeRecord(record).members, ...this.describeRecord(record).assistants.map(assistant => assistant.view)]
        .flatMap(actor => actor.provider === undefined || actor.model === undefined
          ? []
          : [[`${actor.provider}\u0000${actor.model}`, { provider: actor.provider, model: actor.model }] as const]),
    ).values()]
    return {
      mode,
      rates,
      configuredModels,
      team,
      members: [...participants, ...historicalParticipants].map(participant => ({
        ...budgetAccountSnapshot(
          budgetMemberAccount(state, participant.memberId) ?? emptyBudgetAccount(team.startedAt),
        ),
        ...participant,
      })),
    }
  }

  configureBudget(caller: Agent, input: ConfigureFleetBudgetInput): FleetTeamBudgetSnapshot {
    let record = this.requireMutableRecord(input.runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    const changingLimit = input.limit !== undefined
    const resetting = input.reset === true
    const changingAccounting = input.accounting !== undefined
    if (Number(changingLimit) + Number(resetting) + Number(changingAccounting) !== 1) {
      throw new Error('Fleet budget update must change exactly one of its limit, cycle, or accounting mode')
    }
    if (input.limit !== undefined && input.limit !== null
      && (!Number.isSafeInteger(input.limit) || input.limit <= 0)) {
      throw new Error('Fleet budget limit must be a positive safe integer or null')
    }
    const now = new Date().toISOString()
    const current = record.budget ?? { mode: 'tokens', rates: [], team: emptyBudgetAccount(now), members: [] }
    if (input.accounting !== undefined) {
      if (input.scope !== 'team' || input.member !== undefined) {
        throw new Error('Fleet budget accounting is configured for the whole Team')
      }
      const rates: FleetBudgetModelRate[] = input.accounting.rates.map((rate, index): FleetBudgetModelRate => {
        const provider = rate.provider.trim()
        const model = rate.model.trim()
        if (provider === '' || model === '') throw new Error(`Fleet budget rate ${String(index + 1)} requires provider and model`)
        if (input.accounting?.mode === 'tokens') {
          if (rate.multiplier !== undefined && (!Number.isFinite(rate.multiplier) || rate.multiplier <= 0)) {
            throw new Error(`Fleet token multiplier for ${provider} / ${model} must be positive`)
          }
          return { provider, model, ...(rate.multiplier === undefined || rate.multiplier === 1 ? {} : { multiplier: rate.multiplier }) }
        }
        const prices = [rate.inputUsdPerMillion, rate.outputUsdPerMillion, rate.cacheReadUsdPerMillion, rate.cacheWriteUsdPerMillion]
        if (prices.some(price => price === undefined || !Number.isFinite(price) || price < 0)) {
          throw new Error(`Fleet cost budget requires four non-negative prices for ${provider} / ${model}`)
        }
        return {
          provider,
          model,
          inputUsdPerMillion: rate.inputUsdPerMillion!,
          outputUsdPerMillion: rate.outputUsdPerMillion!,
          cacheReadUsdPerMillion: rate.cacheReadUsdPerMillion!,
          cacheWriteUsdPerMillion: rate.cacheWriteUsdPerMillion!,
        }
      })
      const keys = rates.map(rate => `${rate.provider}\u0000${rate.model}`)
      if (new Set(keys).size !== keys.length) throw new Error('Fleet budget rates must use unique provider and model pairs')
      if (input.accounting.mode === 'cost') {
        const configured = this.describeRecord(record)
        const missing = [...configured.members, ...configured.assistants.map(assistant => assistant.view)]
          .filter(actor => actor.provider !== undefined && actor.model !== undefined)
          .filter(actor => !keys.includes(`${actor.provider}\u0000${actor.model}`))
          .map(actor => `${actor.provider} / ${actor.model}`)
        if (missing.length > 0) throw new Error(`Fleet cost budget is missing prices for ${[...new Set(missing)].join(', ')}`)
      }
      const modeChanged = current.mode !== input.accounting.mode
      const budget: FleetTeamBudgetState = modeChanged
        ? {
            mode: input.accounting.mode,
            rates,
            team: emptyBudgetAccount(now),
            members: current.members.map(account => resetBudgetMemberAccount(account, now, false)),
          }
        : { ...current, rates }
      record = this.replaceRecord(record.id, { budget })
      this.appendEvent(record.id, 'budget_accounting_configured', {
        mode: budget.mode,
        models: rates.map(rate => ({ provider: rate.provider, model: rate.model })),
        ...(modeChanged ? { reset: true } : {}),
      })
      return this.teamBudget(record.id)
    }
    let budget: FleetTeamBudgetState
    let member: string | undefined
    if (input.scope === 'team') {
      if (input.member !== undefined) throw new Error('Team budget update cannot name a member')
      if (resetting) {
        budget = {
          ...current,
          team: emptyBudgetAccount(now, current.team.limit),
          members: current.members.map(account => resetBudgetMemberAccount(account, now, true)),
        }
      } else {
        const { limit: _currentLimit, ...account } = current.team
        budget = {
          ...current,
          team: {
            ...account,
            ...(input.limit === null ? {} : { limit: input.limit }),
          },
        }
      }
    } else {
      member = input.member?.trim()
      if (member === undefined || member === '') throw new Error('Member budget update requires a member')
      if (!this.participants(record).some(participant => participant.name === member)) {
        throw new Error(`unknown Fleet member ${member}`)
      }
      const currentAccount = budgetMemberAccount(current, member) ?? emptyBudgetAccount(now)
      let account: FleetBudgetAccount
      if (resetting) account = emptyBudgetAccount(now, currentAccount.limit)
      else {
        const { limit: _currentLimit, ...withoutLimit } = currentAccount
        account = {
          ...withoutLimit,
          ...(input.limit === null ? {} : { limit: input.limit }),
        }
      }
      budget = { ...current, members: replaceBudgetMember(current.members, member, account, budgetMemberIdentity(record, member)) }
    }
    record = this.replaceRecord(record.id, { budget })
    this.appendEvent(record.id, resetting ? 'budget_reset' : 'budget_configured', {
      scope: input.scope,
      ...(member === undefined ? {} : { member }),
      ...(resetting || input.limit === null ? {} : { limit: input.limit }),
      ...(input.limit === null ? { unlimited: true } : {}),
    })
    return this.teamBudget(record.id)
  }

  configureTeamSettings(caller: Agent, input: ConfigureFleetTeamSettingsInput): FleetTeamSettingsSnapshot {
    let record = this.requireMutableRecord(input.runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    const name = text(input.settings.name, 'Fleet Team name')
    const positioning = optionalText(input.settings.positioning, 'Fleet Team positioning')
    const rules = optionalText(input.settings.rules, 'Fleet Team rules')
    const collaborationMethod = optionalText(input.settings.collaborationMethod, 'Fleet Team collaboration method')
    const visibilityReminderContextGrowthTokens = input.settings.visibilityReminderContextGrowthTokens
    if (!Number.isSafeInteger(visibilityReminderContextGrowthTokens) || visibilityReminderContextGrowthTokens < 0) {
      throw new Error('Fleet visibility reminder context growth must be a non-negative integer')
    }
    const contentPreference = optionalText(input.settings.contentPreference, 'Fleet Team content preference')
    const updateDensity = choice(input.settings.updateDensity, 'Fleet Team update density', ['concise', 'balanced', 'detailed'] as const)
    const notificationPolicy = choice(input.settings.notificationPolicy, 'Fleet Team notification policy', ['decisions', 'milestones', 'continuous'] as const)
    const configured = object(JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown, 'Team template')
    const core = object(configured.core, 'core')
    const modules = object(configured.modules, 'modules')
    const message = object(modules[FLEET_MESSAGE_MODULE], FLEET_MESSAGE_MODULE)
    const ui = object(modules[FLEET_UI_MODULE], FLEET_UI_MODULE)
    const userAccess = object(ui.userAccess, `${FLEET_UI_MODULE}.userAccess`)
    const next = {
      ...configured,
      core: { ...core, name, positioning },
      modules: {
        ...modules,
        [FLEET_MESSAGE_MODULE]: {
          ...message,
          rules,
          collaborationMethod,
          visibilityReminderContextGrowthTokens,
        },
        [FLEET_UI_MODULE]: {
          ...ui,
          userAccess: { ...userAccess, updateDensity, notificationPolicy, contentPreference },
        },
      },
    }
    const template = parseTeamTemplate(next, this.configuration)
    const temporary = join(dirname(record.configPath), `.team.${process.pid}.${randomUUID()}.tmp`)
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    try {
      record = this.replaceRecord(record.id, { team: template.team, name: template.name })
      renameSync(temporary, record.configPath)
    } catch (error) {
      if (existsSync(temporary)) rmSync(temporary, { force: true })
      throw error
    }
    this.appendEvent(record.id, 'team_settings_configured', { settings: input.settings })
    const runtime = this.collaboration.get(record.id)
    if (runtime !== undefined) {
      const notice = [
        '[Fleet Team settings updated]',
        'Replace earlier Team-wide guidance with the following current settings:',
        template.operatingPrompt,
      ].join('\n\n')
      for (const participant of this.participants(record)) {
        if (runtime.memberNamesById.get(participant.sessionId) !== participant.name) continue
        runtime.messages.sendSystemNotification(participant.sessionId, {
          kind: 'team_settings',
          text: notice,
          delivery: 'quiet',
          coalesceKey: `team-settings:${record.id}`,
        })
      }
    }
    return this.teamSettings(record.id)
  }

  exportConfiguration(runId: string): Record<string, unknown> {
    const record = this.requireRecord(runId)
    const configured = object(JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown, 'Team template')
    const members = this.effectiveMemberViews(record).map(view => ({
      id: view.id,
      name: view.name,
      ...(view.color === undefined ? {} : { color: view.color }),
      role: view.role,
      responsibilities: view.responsibility ?? '',
      prompt: view.prompt,
      ...(view.provider === undefined ? {} : { provider: view.provider }),
      ...(view.model === undefined ? {} : { model: view.model }),
      ...(view.reasoningEffort === undefined ? {} : { reasoningEffort: view.reasoningEffort }),
      ...(view.maxTokens === undefined ? {} : { maxTokens: view.maxTokens }),
      toolGroups: [...view.toolGroups],
      permissions: [...view.permissions],
      contacts: structuredClone(view.contacts),
    }))
    const core = object(configured.core, 'core')
    const modules = this.configuration.parse(configured.modules)
    const resources = parseFleetResourcesConfiguration(modules[FLEET_RESOURCES_MODULE])
    return {
      core: {
        ...structuredClone(core),
        name: record.name,
        members,
      },
      modules: {
        ...modules,
        [FLEET_RESOURCES_MODULE]: { ...resources, items: [] },
      },
      fleetExport: {
        format: 'team-configuration',
        sourceTeamId: record.id,
        exportedAt: new Date().toISOString(),
      },
    }
  }

  async exportArchive(caller: Agent, input: ExportFleetArchiveInput): Promise<FleetArchiveExportResult> {
    const record = this.requireRecord(input.runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    if (record.status !== 'paused') throw new Error('pause the Fleet Team before exporting a complete archive')
    if (record.members.some(member => this.memberCanReply(member))) {
      throw new Error('Fleet archive export requires every Team member runtime to be paused')
    }
    const cwd = caller.session.header.cwd ?? record.projectRoot
    const destination = isAbsolute(input.destination) ? input.destination : resolve(cwd, input.destination)
    if (existsSync(destination)) throw new Error(`Fleet archive destination already exists: ${destination}`)

    const persistence = this.requirePersistence()
    const staging = mkdtempSync(join(tmpdir(), 'dsh-agent-fleet-export-'))
    const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`)
    try {
      const fleetDirectory = join(staging, 'fleet')
      const stagedRun = join(fleetDirectory, 'run')
      mkdirSync(fleetDirectory, { recursive: true })
      cpSync(this.runDirectory(record), stagedRun, {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      })
      const stagedShared = join(fleetDirectory, 'shared')
      const sharedDirectory = join(record.projectRoot, '.fleet', record.id)
      if (existsSync(sharedDirectory)) {
        cpSync(sharedDirectory, stagedShared, {
          recursive: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        })
      } else {
        mkdirSync(stagedShared, { recursive: true })
      }
      cpSync(record.configPath, join(fleetDirectory, 'team.json'))
      const currentWorkPath = record.work?.acceptedTaskPath ?? record.work?.taskPath
      if (currentWorkPath !== undefined && existsSync(currentWorkPath)) {
        cpSync(currentWorkPath, join(fleetDirectory, 'current-work.md'))
      }

      const sessionsDirectory = join(staging, 'sessions')
      mkdirSync(sessionsDirectory, { recursive: true })
      for (const member of record.members) {
        const inspected = await persistence.inspect(SessionId(member.sessionId))
        if (inspected.meta === undefined) {
          throw new Error(`DSH persistence did not return metadata for Fleet member Session ${member.sessionId}`)
        }
        const session: FleetArchiveSession = {
          meta: inspected.meta,
          events: inspected.events as readonly SessionEvent[],
        }
        writeFileSync(join(sessionsDirectory, `${member.sessionId}.json`), `${JSON.stringify(session)}\n`, 'utf8')
      }

      if (input.includeWorkspace === true) {
        const excluded = join(realpathSync(record.projectRoot), '.fleet')
        cpSync(record.projectRoot, join(staging, 'workspace'), {
          recursive: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
          filter: source => !pathInside(excluded, resolve(source)),
        })
      }

      const team: FleetArchiveTeam = {
        id: record.id,
        name: record.name,
        projectRoot: record.projectRoot,
        status: record.status,
      }
      const extensionsRoot = join(stagedRun, 'extensions')
      mkdirSync(extensionsRoot, { recursive: true })
      const extensions = await this.archives.save(team, extensionsRoot)
      const manifest: FleetArchiveManifest = {
        format: FLEET_ARCHIVE_FORMAT,
        version: FLEET_ARCHIVE_VERSION,
        exportedAt: new Date().toISOString(),
        includesWorkspace: input.includeWorkspace === true,
        team: { ...team, status: 'paused' },
        sessions: record.members.map(member => member.sessionId),
        extensions,
      }
      writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      assertSafeArchiveLinks(staging)
      mkdirSync(dirname(destination), { recursive: true })
      await createTar({ cwd: staging, file: temporary, gzip: true, portable: true }, ['.'])
      renameSync(temporary, destination)
      return {
        path: destination,
        teamId: record.id,
        includesWorkspace: input.includeWorkspace === true,
        extensions,
      }
    } finally {
      rmSync(staging, { recursive: true, force: true })
      if (existsSync(temporary)) unlinkSync(temporary)
    }
  }

  async importArchive(caller: Agent, input: ImportFleetArchiveInput): Promise<FleetArchiveImportResult> {
    const callerRoot = caller.session.header.cwd ?? process.cwd()
    const archivePath = isAbsolute(input.archivePath) ? input.archivePath : resolve(callerRoot, input.archivePath)
    const projectRoot = isAbsolute(input.projectRoot) ? input.projectRoot : resolve(callerRoot, input.projectRoot)
    if (!existsSync(archivePath) || !statSync(archivePath).isFile()) {
      throw new Error(`Fleet archive does not exist: ${archivePath}`)
    }

    const persistence = this.requirePersistence()
    if (persistence.list === undefined || persistence.create === undefined || persistence.append === undefined) {
      throw new Error('DSH session persistence does not support Fleet archive import')
    }
    const staging = mkdtempSync(join(tmpdir(), 'dsh-agent-fleet-import-'))
    const cleanupPaths = new Set<string>()
    try {
      await extractTar({ cwd: staging, file: archivePath, strict: true, preservePaths: false })
      assertSafeArchiveLinks(staging)
      const manifest = archiveManifest(JSON.parse(readFileSync(join(staging, 'manifest.json'), 'utf8')) as unknown)
      const archivedSharedDirectory = join(staging, 'fleet', 'shared')
      if (!existsSync(archivedSharedDirectory)) {
        mkdirSync(archivedSharedDirectory, { recursive: true })
        const legacyRunDirectory = join(staging, 'fleet', 'run')
        for (const name of ['plan.md', 'checklist.md', 'uploads']) {
          const source = join(legacyRunDirectory, name)
          if (existsSync(source)) cpSync(source, join(archivedSharedDirectory, name), { recursive: true })
        }
      }
      const mode = input.mode ?? 'restore'
      if (mode !== 'restore' && mode !== 'copy') throw new Error(`unknown Fleet archive import mode ${String(mode)}`)
      const archivedRecord = parseStoredRecord(
        JSON.parse(readFileSync(join(staging, 'fleet', 'run', 'run.json'), 'utf8')) as unknown,
      )
      if (archivedRecord.id !== manifest.team.id) throw new Error('Fleet archive run record does not match its manifest')
      const existingSessions = new Set((await persistence.list()).map(header => String(header.id)))
      let targetTeamId = manifest.team.id
      if (mode === 'copy') {
        do targetTeamId = `team_${randomUUID()}`
        while (this.records.has(targetTeamId) || existsSync(this.teamReferencePath(targetTeamId)))
      } else if (this.records.has(targetTeamId) || existsSync(this.teamReferencePath(targetTeamId))) {
        throw new Error(`Fleet Team ${targetTeamId} already exists on this DSH installation`)
      }
      const sessionIdMap: Record<string, string> = {}
      const allocatedSessionIds = new Set<string>()
      for (const sourceId of manifest.sessions) {
        if (mode === 'restore') {
          sessionIdMap[sourceId] = sourceId
          continue
        }
        let targetId = randomUUID()
        while (existingSessions.has(targetId) || allocatedSessionIds.has(targetId)) targetId = randomUUID()
        sessionIdMap[sourceId] = targetId
        allocatedSessionIds.add(targetId)
      }
      const participantIdMap: Record<string, string> = { ...sessionIdMap }
      for (const sourceId of new Set([
        ...archivedRecord.assistants.map(assistant => assistant.sessionId),
        archivedRecord.launcherSessionId,
      ])) {
        if (participantIdMap[sourceId] !== undefined) continue
        if (mode === 'restore') {
          participantIdMap[sourceId] = sourceId
          continue
        }
        let targetId = randomUUID()
        while (existingSessions.has(targetId) || allocatedSessionIds.has(targetId)) targetId = randomUUID()
        participantIdMap[sourceId] = targetId
        allocatedSessionIds.add(targetId)
      }
      const finalRunDirectory = join(this.registryDirectory, targetTeamId)
      const finalSharedDirectory = join(projectRoot, '.fleet', targetTeamId)
      if (existsSync(finalRunDirectory)) throw new Error(`Fleet Team directory already exists: ${finalRunDirectory}`)
      if (existsSync(finalSharedDirectory)) throw new Error(`Fleet shared directory already exists: ${finalSharedDirectory}`)
      if (manifest.includesWorkspace) {
        if (existsSync(projectRoot)) throw new Error('workspace archive import requires a new projectRoot path')
      } else if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
        throw new Error('archive without workspace content requires an existing projectRoot directory')
      }

      for (const sessionId of manifest.sessions) {
        const targetSessionId = sessionIdMap[sessionId]
        if (targetSessionId === undefined) throw new Error(`Fleet archive Session ${sessionId} has no import identity`)
        if (existingSessions.has(targetSessionId)) {
          throw new Error(`DSH Session ${targetSessionId} already exists; use copy mode or a clean DSH data store`)
        }
      }

      const preparedProjectRoot = manifest.includesWorkspace
        ? `${projectRoot}.fleet-import-${randomUUID()}`
        : projectRoot
      if (manifest.includesWorkspace) {
        mkdirSync(dirname(preparedProjectRoot), { recursive: true })
        cpSync(join(staging, 'workspace'), preparedProjectRoot, {
          recursive: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        })
        cleanupPaths.add(preparedProjectRoot)
      }
      const preparedRunDirectory = join(this.registryDirectory, `.import-${targetTeamId}-${randomUUID()}`)
      cleanupPaths.add(preparedRunDirectory)
      mkdirSync(dirname(preparedRunDirectory), { recursive: true })
      cpSync(join(staging, 'fleet', 'run'), preparedRunDirectory, {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      })
      const preparedSharedDirectory = manifest.includesWorkspace
        ? join(preparedProjectRoot, '.fleet', targetTeamId)
        : join(projectRoot, '.fleet', `.import-${targetTeamId}-${randomUUID()}`)
      cleanupPaths.add(preparedSharedDirectory)
      mkdirSync(dirname(preparedSharedDirectory), { recursive: true })
      cpSync(archivedSharedDirectory, preparedSharedDirectory, {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
      })

      const finalConfigPath = join(finalRunDirectory, 'team.json')
      cpSync(join(staging, 'fleet', 'team.json'), join(preparedRunDirectory, 'team.json'))
      const finalTaskPath = join(finalRunDirectory, 'current-work.md')
      const archivedTask = join(staging, 'fleet', 'current-work.md')
      if (archivedRecord.work !== undefined && !existsSync(archivedTask)) {
        throw new Error('Fleet archive is missing the current work description')
      }
      if (existsSync(archivedTask)) cpSync(archivedTask, join(preparedRunDirectory, 'current-work.md'))
      const { sourceSetupId: archivedSourceSetupId, ...archivedRecordWithoutSetup } = archivedRecord
      const record: FleetRunRecord = {
        ...archivedRecordWithoutSetup,
        id: targetTeamId,
        ...(mode === 'restore' && archivedSourceSetupId !== undefined
          ? { sourceSetupId: archivedSourceSetupId }
          : {}),
        projectRoot,
        configPath: finalConfigPath,
        launcherSessionId: participantIdMap[archivedRecord.launcherSessionId] ?? archivedRecord.launcherSessionId,
        members: archivedRecord.members.map(member => ({
          ...member,
          sessionId: participantIdMap[member.sessionId] ?? member.sessionId,
        })),
        assistants: archivedRecord.assistants.map(assistant => ({
          ...assistant,
          sessionId: participantIdMap[assistant.sessionId] ?? assistant.sessionId,
        })),
        status: 'paused',
        ...(archivedRecord.work === undefined ? {} : {
          work: { ...archivedRecord.work, taskPath: finalTaskPath, acceptedTaskPath: finalTaskPath },
        }),
      }
      const eventsPath = join(preparedRunDirectory, 'events.jsonl')
      if (existsSync(eventsPath)) {
        writeFileSync(
          eventsPath,
          relocateArchiveEvents(
            readFileSync(eventsPath, 'utf8'),
            manifest.team.projectRoot,
            projectRoot,
            manifest.team.id,
            targetTeamId,
            participantIdMap,
            finalRunDirectory,
            archivedRecord.work?.id,
          ),
          'utf8',
        )
      }
      writeFileSync(join(preparedRunDirectory, 'run.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')

      for (const sessionId of manifest.sessions) {
        const session = object(
          JSON.parse(readFileSync(join(staging, 'sessions', `${sessionId}.json`), 'utf8')) as unknown,
          `Fleet archive Session ${sessionId}`,
        ) as unknown as FleetArchiveSession
        if (String(session.meta.id) !== sessionId) throw new Error(`Fleet archive Session ${sessionId} metadata does not match`)
        const targetSessionId = sessionIdMap[sessionId]
        if (targetSessionId === undefined) throw new Error(`Fleet archive Session ${sessionId} has no import identity`)
        const { parentSession: sourceParentSession, ...sessionMeta } = session.meta
        const parentSession = sourceParentSession === undefined
          ? undefined
          : mode === 'restore'
            ? sourceParentSession
            : sessionIdMap[String(sourceParentSession)]
        const meta: SessionHeader = {
          ...sessionMeta,
          id: SessionId(targetSessionId),
          ...(parentSession === undefined ? {} : { parentSession: SessionId(parentSession) }),
          ...(session.meta.cwd === undefined ? {} : {
            cwd: relocateArchivePath(
              session.meta.cwd,
              manifest.team.projectRoot,
              projectRoot,
              manifest.team.id,
              targetTeamId,
            ),
          }),
        }
        await persistence.create(meta)
        if (session.events.length > 0) await persistence.append(SessionId(targetSessionId), session.events)
      }

      if (manifest.includesWorkspace) {
        renameSync(preparedProjectRoot, projectRoot)
        cleanupPaths.delete(preparedProjectRoot)
      } else {
        renameSync(preparedSharedDirectory, finalSharedDirectory)
      }
      cleanupPaths.delete(preparedSharedDirectory)
      renameSync(preparedRunDirectory, finalRunDirectory)
      cleanupPaths.delete(preparedRunDirectory)
      this.rememberTeam(record)
      this.openDormantTeam(record)
      const extensionsRoot = join(finalRunDirectory, 'extensions')
      mkdirSync(extensionsRoot, { recursive: true })
      const targetTeam: FleetArchiveTeam = {
        id: record.id,
        name: record.name,
        projectRoot: record.projectRoot,
        status: record.status,
      }
      const extensions = await this.archives.restore(targetTeam, extensionsRoot, {
        sourceTeam: manifest.team,
        sessionIdMap,
      })
      return { run: this.describeRecord(record), extensions }
    } finally {
      rmSync(staging, { recursive: true, force: true })
      for (const path of cleanupPaths) if (existsSync(path)) rmSync(path, { recursive: true, force: true })
    }
  }

  private effectiveMemberViews(
    record: FleetRunRecord,
    events: readonly StoredFleetEvent[] = this.storedEvents(record),
  ): FleetMemberView[] {
    const configured = parseTeamTemplate(
      JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown,
      this.configuration,
    ).members
    const views = new Map(configured.map(view => [view.id, structuredClone(view)]))
    const order = configured.map(view => view.id)
    const legacyCoordinator = record.coordinator === undefined
      ? undefined
      : record.members.find(member => member.name === record.coordinator)
    if (legacyCoordinator !== undefined && !views.has(legacyCoordinator.name)) {
      const legacyView: FleetMemberView = {
        id: legacyCoordinator.name,
        name: legacyCoordinator.displayName ?? 'Fleet Coordinator',
        ...(legacyCoordinator.color === undefined ? {} : { color: legacyCoordinator.color }),
        role: legacyCoordinator.role,
        responsibility: 'Legacy coordinator retained only so an existing persisted Team can resume safely.',
        prompt: 'Preserve the existing Team state while moving coordination and ownership to the configured peers.',
        toolGroups: [...FLEET_MEMBER_TOOL_GROUPS],
        permissions: [...FLEET_MEMBER_PERMISSIONS],
        contacts: { members: '*', channels: '*' },
      }
      views.set(legacyView.id, legacyView)
      order.unshift(legacyView.id)
    }
    for (const event of events) {
      if (event.type === 'member_view_added' || event.type === 'member_view_updated') {
        const view = structuredClone((event.data as { readonly view: FleetMemberView }).view)
        if (!order.includes(view.id)) order.push(view.id)
        views.set(view.id, view)
      } else if (event.type === 'team_requests_configured') {
        for (const configured of (event.data as { readonly memberViews: readonly FleetMemberView[] }).memberViews) {
          const view = structuredClone(configured)
          if (!order.includes(view.id)) order.push(view.id)
          views.set(view.id, view)
        }
      } else if (event.type === 'member_view_removed') {
        views.delete((event.data as { readonly member: string }).member)
      }
    }
    return order.flatMap(id => {
      const view = views.get(id)
      return view === undefined ? [] : [view]
    })
  }

  async addMember(caller: Agent, input: AddFleetMemberInput): Promise<FleetRunMember> {
    let record = this.requireMutableRecord(input.runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    const runtime = this.requireRuntime(record.id)
    const view = normalizedMemberView(input.view)
    const existing = this.memberViews(record.id)
    if (existing.some(member => member.id === view.id)) throw new Error(`Fleet member ${view.id} already exists`)
    const template = parseTeamTemplate(
      JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown,
      this.configuration,
    )
    validateMemberContacts([...this.effectiveMemberViews(record), view], new Set(template.channels.map(channel => channel.id)),
      record.assistants.map(assistant => assistant.view.id))
    const effectiveTemplate: TeamTemplate = { ...template, members: [...this.effectiveMemberViews(record), view] }
    runtime.updateMemberView(view)
    this.appendEvent(record.id, 'member_view_added', { view })
    let created = false
    try {
      const agent = await this.core.create(caller, {
        name: this.runtimeMemberName(record.id, view.id),
        archiveId: this.memberArchiveId(record.id, view.id),
        displayName: view.name,
        ...(view.color === undefined ? {} : { color: view.color }),
        role: view.role,
        cwd: record.projectRoot,
        persona: persona(effectiveTemplate, view),
        ...this.memberRuntimeOptions(record, view),
        setup: childCtx => this.setupFormalMember(childCtx, runtime, view.id, 'create'),
      })
      created = true
      runtime.attachMember(agent.id, view)
      runtime.messages.connectAgent(agent.id, template.channels.map(channel => channel.id))
      const member: FleetRunMember = {
        name: view.id,
        displayName: agent.displayName,
        color: agent.color,
        role: view.role,
        sessionId: agent.id,
      }
      record = this.replaceRecord(record.id, { members: [...record.members, member] })
      this.appendEvent(record.id, 'member_attached', member)
      if (record.status === 'running' && record.work?.status === 'running') {
        const work = this.readWorkTask(record)
        runtime.messages.sendSystemNotification(agent.id, {
          kind: 'member_joined',
          text: `[Fleet member joined active work ${record.work.id}.]\n\n${work}`,
          delivery: 'wakeup',
          coalesceKey: `member-joined:${record.work.id}`,
        })
      }
      return structuredClone(member)
    } catch (error) {
      if (created) {
        try { await this.core.stopManaged(this.runtimeMemberName(record.id, view.id)) } catch {}
      }
      runtime.removeMemberView(view.id)
      this.appendEvent(record.id, 'member_view_removed', { member: view.id, reason: 'add_failed' })
      throw error
    }
  }

  async updateMember(caller: Agent, input: UpdateFleetMemberInput): Promise<FleetRunMember> {
    const record = this.requireMutableRecord(input.runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    const member = record.members.find(candidate => candidate.name === input.member)
    if (member === undefined) throw new Error(`unknown Fleet member ${input.member}`)
    if (member.sessionId === String(caller.id)) throw new Error('a Fleet member cannot restart its own runtime view')
    const currentView = this.effectiveMemberViews(record).find(view => view.id === member.name)
    if (currentView === undefined) throw new Error(`missing Fleet member view ${member.name}`)
    const view = normalizedMemberView(input.view)
    if (view.id !== member.name) throw new Error('Fleet member id cannot be changed')
    const template = parseTeamTemplate(
      JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown,
      this.configuration,
    )
    const views = this.effectiveMemberViews(record).map(candidate => candidate.id === view.id ? view : candidate)
    validateMemberContacts(views, new Set(template.channels.map(channel => channel.id)),
      record.assistants.map(assistant => assistant.view.id))
    const effectiveTemplate: TeamTemplate = { ...template, members: views }
    const runtimeName = this.runtimeMemberName(record.id, member.name)
    if (member.status === 'paused') {
      const runtime = this.requireRuntime(record.id)
      this.appendEvent(record.id, 'member_view_updated', { view })
      runtime.updateMemberView(view)
      const color = view.color ?? member.color
      const updated: FleetRunMember = {
        ...member,
        displayName: view.name,
        ...(color === undefined ? {} : { color }),
        role: view.role,
        status: 'paused',
      }
      this.replaceRecord(record.id, {
        members: record.members.map(candidate => candidate.name === member.name ? updated : candidate),
      })
      this.appendEvent(record.id, 'member_updated', updated)
      return structuredClone(updated)
    }
    if (this.core.get(runtimeName).status === 'running') throw new Error(`Fleet member ${member.name} must be idle before updating`)
    const runtime = this.requireRuntime(record.id)
    this.appendEvent(record.id, 'member_view_updated', { view })
    runtime.updateMemberView(view)
    const live = this.ctx.agents.get(SessionId(member.sessionId))
    if (live !== undefined) await this.ctx.sessions.flush(live.session)
    await this.core.stopManaged(runtimeName)
    runtime.detachMember(member.sessionId)
    try {
      const resumed = await this.core.resume(caller, {
        id: member.sessionId,
        name: runtimeName,
        archiveId: this.memberArchiveId(record.id, member.name),
        displayName: view.name,
        color: view.color ?? member.color ?? generateFleetMemberColor(),
        role: view.role,
        persona: persona(effectiveTemplate, view),
        ...this.memberRuntimeOptions(record, view),
        setup: childCtx => this.setupFormalMember(childCtx, runtime, view.id, 'resume'),
      })
      if (resumed.id === member.sessionId) runtime.attachMember(resumed.id, view)
      else runtime.rebindMember(member.sessionId, resumed.id, view)
      const updated: FleetRunMember = {
        ...member,
        sessionId: resumed.id,
        displayName: resumed.displayName,
        color: resumed.color,
        role: view.role,
      }
      this.replaceRecord(record.id, {
        members: record.members.map(candidate => candidate.name === member.name ? updated : candidate),
      })
      this.appendEvent(record.id, 'member_updated', updated)
      return structuredClone(updated)
    } catch (error) {
      this.appendEvent(record.id, 'member_view_updated', { view: currentView, reason: 'update_rolled_back' })
      runtime.updateMemberView(currentView)
      try {
        const restored = await this.core.resume(caller, {
          id: member.sessionId,
          name: runtimeName,
          archiveId: this.memberArchiveId(record.id, member.name),
          displayName: member.displayName ?? currentView.name,
          color: member.color ?? currentView.color ?? generateFleetMemberColor(),
          role: currentView.role,
          persona: persona({ ...template, members: this.effectiveMemberViews(record) }, currentView),
          ...this.memberRuntimeOptions(record, currentView),
          setup: childCtx => this.setupFormalMember(childCtx, runtime, currentView.id, 'resume'),
        })
        if (restored.id === member.sessionId) runtime.attachMember(restored.id, currentView)
        else runtime.rebindMember(member.sessionId, restored.id, currentView)
        if (restored.id !== member.sessionId) {
          this.replaceRecord(record.id, {
            members: record.members.map(candidate => candidate.name === member.name
              ? { ...candidate, sessionId: restored.id }
              : candidate),
          })
        }
      } catch (rollbackError) {
        this.replaceRecord(record.id, {
          members: record.members.map(candidate => candidate.name === member.name
            ? { ...candidate, status: 'offline' }
            : candidate),
        })
        this.appendEvent(record.id, 'member_update_failed', {
          member: member.name,
          error: errorMessage(error),
          rollbackError: errorMessage(rollbackError),
        })
        throw new Error(`Could not update Fleet member ${member.name}; restoring its previous runtime also failed: ${errorMessage(rollbackError)}`)
      }
      throw error
    }
  }

  async configureMember(
    caller: Agent,
    input: ConfigureFleetMemberInput,
  ): Promise<FleetMemberRequestConfiguration> {
    const record = this.requireMutableRecord(input.runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    return this.configureMemberRequest(record, input)
  }

  async configureMemberAsExternal(
    input: ConfigureFleetMemberInput,
  ): Promise<FleetMemberRequestConfiguration> {
    const record = this.requireMutableRecord(input.runId)
    this.requireExternalFleetPermission(record, 'team.manage')
    return this.configureMemberRequest(record, input)
  }

  private async configureMemberRequest(
    record: FleetRunRecord,
    input: ConfigureFleetMemberInput,
  ): Promise<FleetMemberRequestConfiguration> {
    const member = record.members.find(candidate => candidate.name === input.member)
    if (member === undefined) throw new Error(`unknown Fleet member ${input.member}`)
    const currentView = this.effectiveMemberViews(record).find(view => view.id === member.name)
    if (currentView === undefined) throw new Error(`missing Fleet member view ${member.name}`)
    const current = this.memberRequestConfig(record, member, currentView)
    const request = await this.resolveRequestConfiguration(current, input.request, 'Fleet member')
    const view = this.requestConfiguredView(currentView, request)
    const runtime = this.collaboration.get(record.id)
    const runtimeName = this.runtimeMemberName(record.id, member.name)
    const managed = this.core.list().some(candidate => candidate.name === runtimeName && candidate.managed)
    if (managed) this.core.configureManaged(runtimeName, request)
    try {
      runtime?.updateMemberView(view, false)
      this.appendEvent(record.id, 'member_view_updated', { view, reason: 'request_configured' })
    } catch (error) {
      runtime?.updateMemberView(currentView, false)
      if (managed) this.core.configureManaged(runtimeName, current)
      throw error
    }
    const updated = this.status(record.id).members.find(candidate => candidate.name === member.name)
    if (updated === undefined) throw new Error(`Fleet member ${member.name} disappeared while configuring its request`)
    return { member: updated, request, effectiveFrom: 'next-model-step' }
  }

  async configureAssistant(
    caller: Agent,
    input: ConfigureFleetAssistantInput,
  ): Promise<FleetAssistantRequestConfiguration> {
    const record = this.requireMutableRecord(input.runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    const assistant = input.assistant === undefined
      ? this.requireAssistantConnection(caller, record.id)
      : record.assistants.find(candidate => candidate.view.id === input.assistant)
    if (assistant === undefined) throw new Error(`unknown Fleet assistant ${String(input.assistant)}`)
    return this.configureAssistantRequest(record, input, assistant)
  }

  async configureAssistantAsExternal(
    input: ConfigureFleetAssistantInput,
  ): Promise<FleetAssistantRequestConfiguration> {
    const record = this.requireMutableRecord(input.runId)
    this.requireExternalFleetPermission(record, 'team.manage')
    const assistant = input.assistant === undefined
      ? record.assistants[0]
      : record.assistants.find(candidate => candidate.view.id === input.assistant)
    if (assistant === undefined) throw new Error(`unknown Fleet assistant ${String(input.assistant)}`)
    return this.configureAssistantRequest(record, input, assistant)
  }

  private async configureAssistantRequest(
    record: FleetRunRecord,
    input: ConfigureFleetAssistantInput,
    assistant: FleetRunAssistant,
  ): Promise<FleetAssistantRequestConfiguration> {
    const runtime = this.collaboration.get(record.id)
    const connected = runtime?.memberNamesById.get(assistant.sessionId) === assistant.view.id
    const live = connected ? this.ctx.agents.get(SessionId(assistant.sessionId)) : undefined
    const current = live === undefined
      ? this.requestConfigFromView(assistant.view)
      : this.assistantRequestConfig(assistant, live)
    const request = await this.resolveRequestConfiguration(current, input.request, 'Fleet assistant')
    const view = this.requestConfiguredView(assistant.view, request)
    const ref = live === undefined ? undefined : this.bindAssistantRequestConfig(live, current, true)
    if (live !== undefined && ref === undefined) {
      throw new Error(`Fleet assistant ${assistant.view.id} does not support live request configuration`)
    }
    const previousAssistants = record.assistants
    if (ref !== undefined) ref.current = structuredClone(request)
    try {
      runtime?.updateMemberView(view, false)
      this.replaceRecord(record.id, {
        assistants: record.assistants.map(candidate => candidate.view.id === assistant.view.id
          ? { ...candidate, view }
          : candidate),
      })
      this.appendEvent(record.id, 'assistant_view_updated', { view, reason: 'request_configured' })
    } catch (error) {
      if (ref !== undefined) ref.current = current === undefined ? undefined : structuredClone(current)
      runtime?.updateMemberView(assistant.view, false)
      this.replaceRecord(record.id, { assistants: previousAssistants })
      throw error
    }
    const updated = this.status(record.id).assistants.find(candidate => candidate.view.id === assistant.view.id)
    if (updated === undefined) throw new Error(`Fleet assistant ${assistant.view.id} disappeared while configuring its request`)
    return { assistant: updated, request, effectiveFrom: 'next-model-step' }
  }

  async configureTeam(
    caller: Agent,
    input: ConfigureFleetTeamInput,
  ): Promise<FleetTeamRequestConfiguration> {
    const record = this.requireMutableRecord(input.runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    return this.configureTeamRequest(record, input)
  }

  async configureTeamAsExternal(
    input: ConfigureFleetTeamInput,
  ): Promise<FleetTeamRequestConfiguration> {
    const record = this.requireMutableRecord(input.runId)
    this.requireExternalFleetPermission(record, 'team.manage')
    return this.configureTeamRequest(record, input)
  }

  private async configureTeamRequest(
    record: FleetRunRecord,
    input: ConfigureFleetTeamInput,
  ): Promise<FleetTeamRequestConfiguration> {
    const runtime = this.requireRuntime(record.id)
    const views = new Map(this.effectiveMemberViews(record).map(view => [view.id, view]))
    const managedNames = new Set(this.core.list()
      .filter(candidate => candidate.managed)
      .map(candidate => candidate.name))
    const memberPlans = await Promise.all(record.members.map(async member => {
      const currentView = views.get(member.name)
      if (currentView === undefined) throw new Error(`missing Fleet member view ${member.name}`)
      const current = this.memberRequestConfig(record, member, currentView)
      const request = await this.resolveRequestConfiguration(current, input.request, `Fleet member ${member.name}`)
      return {
        member,
        current,
        currentView,
        request,
        view: this.requestConfiguredView(currentView, request),
        runtimeName: this.runtimeMemberName(record.id, member.name),
        managed: managedNames.has(this.runtimeMemberName(record.id, member.name)),
      }
    }))
    const assistantPlans = await Promise.all(record.assistants.map(async assistant => {
      const live = this.ctx.agents.get(SessionId(assistant.sessionId))
      const connected = runtime.memberNamesById.get(assistant.sessionId) === assistant.view.id
      const current = live === undefined
        ? this.requestConfigFromView(assistant.view)
        : this.assistantRequestConfig(assistant, live)
      const request = await this.resolveRequestConfiguration(current, input.request, `Fleet assistant ${assistant.view.id}`)
      return {
        assistant,
        live: connected ? live : undefined,
        current,
        request,
        view: this.requestConfiguredView(assistant.view, request),
      }
    }))

    const appliedMembers: typeof memberPlans = []
    const appliedAssistants: Array<(typeof assistantPlans)[number] & { readonly ref: AssistantRequestConfigRef }> = []
    const previousAssistants = record.assistants
    try {
      for (const plan of memberPlans) {
        if (plan.managed) this.core.configureManaged(plan.runtimeName, plan.request)
        appliedMembers.push(plan)
      }
      for (const plan of assistantPlans) {
        if (plan.live === undefined) continue
        const ref = this.bindAssistantRequestConfig(plan.live, plan.current, true)
        if (ref === undefined) throw new Error(`Fleet assistant ${plan.assistant.view.id} does not support live request configuration`)
        ref.current = structuredClone(plan.request)
        appliedAssistants.push({ ...plan, ref })
      }
      for (const plan of memberPlans) runtime.updateMemberView(plan.view, false)
      for (const plan of assistantPlans) runtime.updateMemberView(plan.view, false)
      this.replaceRecord(record.id, {
        assistants: assistantPlans.map(plan => ({ ...plan.assistant, view: plan.view })),
      })
      this.appendEvent(record.id, 'team_requests_configured', {
        memberViews: memberPlans.map(plan => plan.view),
        assistantViews: assistantPlans.map(plan => plan.view),
      })
    } catch (error) {
      for (const plan of appliedMembers.reverse()) {
        if (plan.managed) this.core.configureManaged(plan.runtimeName, plan.current)
      }
      for (const plan of appliedAssistants) {
        plan.ref.current = plan.current === undefined ? undefined : structuredClone(plan.current)
      }
      for (const plan of memberPlans) runtime.updateMemberView(plan.currentView, false)
      for (const plan of assistantPlans) runtime.updateMemberView(plan.assistant.view, false)
      this.replaceRecord(record.id, { assistants: previousAssistants })
      throw error
    }

    const updated = this.status(record.id)
    return {
      memberConfigurations: memberPlans.map(plan => {
        const member = updated.members.find(candidate => candidate.name === plan.member.name)
        if (member === undefined) throw new Error(`Fleet member ${plan.member.name} disappeared while configuring Team requests`)
        return { member, request: plan.request, effectiveFrom: 'next-model-step' }
      }),
      assistantConfigurations: assistantPlans.map(plan => {
        const assistant = updated.assistants.find(candidate => candidate.view.id === plan.assistant.view.id)
        if (assistant === undefined) throw new Error(`Fleet assistant ${plan.assistant.view.id} disappeared while configuring Team requests`)
        return { assistant, request: plan.request, effectiveFrom: 'next-model-step' }
      }),
      effectiveFrom: 'next-model-step',
    }
  }

  async removeMember(caller: Agent, runId: string, memberName: string): Promise<FleetRunMember> {
    const record = this.requireMutableRecord(runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    const member = record.members.find(candidate => candidate.name === memberName)
    if (member === undefined) throw new Error(`unknown Fleet member ${memberName}`)
    this.clearNetworkRecovery(member.sessionId)
    if (member.sessionId === String(caller.id)) throw new Error('a Fleet member cannot remove itself')
    const successor = this.participants(record).find(candidate => candidate.sessionId === String(caller.id))
    if (successor === undefined) throw new Error(`Agent ${String(caller.id)} is not a Fleet participant`)
    const runtime = this.requireRuntime(record.id)
    const runtimeName = this.runtimeMemberName(record.id, member.name)
    const live = this.ctx.agents.get(SessionId(member.sessionId))
    if (live !== undefined) await this.ctx.sessions.flush(live.session)
    if (member.status !== 'paused') await this.core.stopManaged(runtimeName)
    runtime.retireMember({
      agentId: member.sessionId,
      member: member.name,
      successorAgentId: successor.sessionId,
      successor: successor.name,
    })
    runtime.removeMemberView(member.name)
    const budgetAccount = budgetMemberAccount(record.budget, member.name)
    const budget = record.budget === undefined || budgetAccount === undefined
      ? record.budget
      : {
          ...record.budget,
          members: replaceBudgetMember(
            record.budget.members,
            member.name,
            budgetAccount,
            budgetMemberIdentity(record, member.name),
          ),
        }
    this.replaceRecord(record.id, {
      members: record.members.filter(candidate => candidate.name !== member.name),
      ...(budget === undefined ? {} : { budget }),
    })
    this.appendEvent(record.id, 'member_view_removed', { member: member.name })
    this.appendEvent(record.id, 'member_detached', member)
    return { ...structuredClone(member), status: 'offline' }
  }

  async loadTeamMembersAsExternal(caller: Agent, runId: string): Promise<FleetRunRecord> {
    const record = this.requireMutableRecord(runId)
    this.requireExternalFleetPermission(record, 'team.manage')
    return this.loadTeamMembersNow(caller, record)
  }

  /** Restore idle formal-member Sessions after the resident assistant is ready. */
  async loadTeamMembersAtStartup(caller: Agent, runId: string): Promise<FleetRunRecord> {
    const record = this.requireMutableRecord(runId)
    if (record.status === 'paused') return this.describeRecord(record)
    const unloaded = record.members
      .filter(member => member.status !== 'paused' && !this.memberCanReply(member))
      .map(member => member.name)
    if (unloaded.length === 0) return this.describeRecord(record)
    const loaded = await this.loadTeamMembersNow(caller, record)
    this.appendEvent(runId, 'team_loaded_at_startup', {
      assistantSessionId: String(caller.id),
      members: unloaded,
    })
    return loaded
  }

  private async loadTeamMembersNow(caller: Agent, initial: FleetRunRecord): Promise<FleetRunRecord> {
    let record = initial
    const unloaded = record.members
      .filter(member => member.status !== 'paused' && !this.memberCanReply(member))
      .map(member => member.name)
    for (const memberName of unloaded) {
      await this.resumeMemberNow(caller, record, memberName)
      record = this.requireRecord(record.id)
    }
    return this.describeRecord(record)
  }

  private async loadTeamMembersForAssistantInput(caller: Agent, runId: string): Promise<void> {
    const pending = this.assistantInputTeamLoads.get(runId)
    if (pending !== undefined) return pending
    const operation = (async () => {
      const before = this.requireMutableRecord(runId)
      const unloaded = before.members
        .filter(member => member.status !== 'paused' && !this.memberCanReply(member))
        .map(member => member.name)
      if (unloaded.length === 0) return
      await this.loadTeamMembersNow(caller, before)
      this.appendEvent(runId, 'team_loaded_for_user_input', {
        assistantSessionId: String(caller.id),
        members: unloaded,
      })
    })().catch((error: unknown) => {
      this.ctx.logger('dsh-agent-fleet').warn(
        `Could not load every Fleet member for direct assistant input in Team ${runId}: ${errorMessage(error)}`,
      )
    }).finally(() => {
      if (this.assistantInputTeamLoads.get(runId) === operation) this.assistantInputTeamLoads.delete(runId)
    })
    this.assistantInputTeamLoads.set(runId, operation)
    return operation
  }

  async pauseTeam(caller: Agent, runId?: string): Promise<FleetRunRecord> {
    const record = this.requireMutableRecord(runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    return this.pauseTeamOperation(caller, record.id)
  }

  async pauseTeamAsExternal(caller: Agent, runId: string): Promise<FleetRunRecord> {
    const record = this.requireMutableRecord(runId)
    this.requireExternalFleetPermission(record, 'team.manage')
    return this.pauseTeamOperation(caller, record.id)
  }

  private async pauseTeamOperation(caller: Agent, runId: string): Promise<FleetRunRecord> {
    const record = this.requireRecord(runId)
    const pending = this.pausingTeams.get(record.id)
    if (pending !== undefined) return pending
    const operation = Promise.resolve().then(() => this.pauseTeamNow(caller, record.id))
    this.pausingTeams.set(record.id, operation)
    try {
      return await operation
    } finally {
      if (this.pausingTeams.get(record.id) === operation) this.pausingTeams.delete(record.id)
    }
  }

  private async pauseTeamNow(caller: Agent, runId: string): Promise<FleetRunRecord> {
    let record = this.requireMutableRecord(runId)
    if (record.status !== 'paused' && record.status !== 'idle' && record.status !== 'running') {
      throw new Error(`Fleet team ${record.id} cannot pause from ${record.status}`)
    }
    if (record.members.some(member => member.sessionId === String(caller.id))) {
      throw new Error('a Fleet member cannot pause its own Team; use the external Fleet assistant')
    }
    const alreadyPaused = new Set(record.teamPausedMembers ?? [])
    const newlyPausedMembers = record.members
      .filter(member => member.status !== 'paused' && this.memberCanReply(member))
      .map(member => member.name)
    if (newlyPausedMembers.length === 0) {
      throw new Error(`Fleet team ${record.id} has no loaded, unpaused members to pause`)
    }
    const teamPausedMembers = [...alreadyPaused, ...newlyPausedMembers.filter(name => !alreadyPaused.has(name))]
    if (record.status !== 'paused' || teamPausedMembers.length !== alreadyPaused.size) {
      record = this.replaceRecord(record.id, { status: 'paused', teamPausedMembers })
      this.appendEvent(record.id, 'team_status', { status: 'paused', members: teamPausedMembers, phase: 'pausing' })
      this.notify(record)
    }
    this.collaboration.get(record.id)?.pauseProductivity()
    for (const assistant of record.assistants) this.interruptAssistant(record, assistant)
    for (const memberName of newlyPausedMembers) {
      const member = this.requireRecord(record.id).members.find(candidate => candidate.name === memberName)
      if (member !== undefined) await this.pauseMemberNow(caller, record.id, memberName)
    }
    const paused = this.requireRecord(record.id)
    this.appendEvent(record.id, 'team_status', { status: 'paused', members: teamPausedMembers, phase: 'paused' })
    this.notify(paused)
    return this.describeRecord(paused)
  }

  async resumeTeam(caller: Agent, runId?: string): Promise<FleetRunRecord> {
    const record = this.requireMutableRecord(runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    return this.resumeTeamNow(caller, record)
  }

  async resumeTeamAsExternal(caller: Agent, runId: string): Promise<FleetRunRecord> {
    const record = this.requireMutableRecord(runId)
    this.requireExternalFleetPermission(record, 'team.manage')
    return this.resumeTeamNow(caller, record)
  }

  private async resumeTeamNow(caller: Agent, record: FleetRunRecord): Promise<FleetRunRecord> {
    if (record.status !== 'paused') throw new Error(`Fleet team ${record.id} is not paused`)
    for (const memberName of record.teamPausedMembers ?? []) {
      const current = this.requireRecord(record.id)
      const member = current.members.find(candidate => candidate.name === memberName)
      if (member !== undefined && !this.memberCanReply(member)) {
        await this.resumeMemberNow(caller, current, memberName)
      }
    }
    const status: FleetRunStatus = record.work?.status === 'running' ? 'running' : 'idle'
    const resumed = this.replaceRecord(record.id, { status, teamPausedMembers: [] })
    this.requireRuntime(record.id).activateProductivity()
    if (status === 'running') this.manualWakeRequiredRunIds.add(record.id)
    this.appendEvent(record.id, 'team_status', { status, resumedFrom: 'paused' })
    this.notify(resumed)
    return this.describeRecord(resumed)
  }

  async wakeTeam(caller: Agent, runId?: string): Promise<FleetRunRecord> {
    const record = this.requireMutableRecord(runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    return this.wakeTeamNow(caller, record)
  }

  async wakeTeamAsExternal(caller: Agent, runId: string): Promise<FleetRunRecord> {
    const record = this.requireMutableRecord(runId)
    this.requireExternalFleetPermission(record, 'team.manage')
    return this.wakeTeamNow(caller, record)
  }

  private async wakeTeamNow(caller: Agent, initial: FleetRunRecord): Promise<FleetRunRecord> {
    let record = initial
    const participants = this.participants(record)
    const available = participants.filter(participant =>
      this.budgetRemaining(record, participant.name).exhaustedScope === undefined)
    if (available.length === 0 && participants.length > 0) {
      const budget = this.budgetRemaining(record, participants[0]?.name ?? '')
      if (budget.exhaustedScope === 'team') throw this.budgetError(record, '', 'team')
      throw new Error(`Every member budget in Fleet Team ${record.name} is exhausted; increase or reset a member budget before waking the Team`)
    }
    for (const memberName of record.members
      .filter(member => !this.memberCanReply(member))
      .map(member => member.name)) {
      await this.resumeMemberNow(caller, record, memberName)
      record = this.requireRecord(record.id)
    }
    for (const assistant of record.assistants) {
      const runtime = this.collaboration.require(record.id)
      const online = assistant.status !== 'paused'
        && runtime.memberNamesById.get(assistant.sessionId) === assistant.view.id
        && this.ctx.agents.get(SessionId(assistant.sessionId)) !== undefined
      if (!online) await this.resumeAssistant(record, assistant)
      record = this.requireRecord(record.id)
    }
    if (record.status === 'paused') {
      const status: FleetRunStatus = record.work?.status === 'running' ? 'running' : 'idle'
      record = this.replaceRecord(record.id, { status, teamPausedMembers: [] })
      this.collaboration.require(record.id).activateProductivity()
      this.appendEvent(record.id, 'team_status', { status, resumedFrom: 'wake' })
      this.notify(record)
    }
    this.manualWakeRequiredRunIds.delete(record.id)
    this.wakeTeamMembers(record)
    return this.describeRecord(record)
  }

  async wakeMember(caller: Agent, runId: string, memberName: string): Promise<FleetRunMember> {
    let record = this.requireMutableRecord(runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    return this.wakeMemberNow(caller, record, memberName)
  }

  async wakeMemberAsExternal(caller: Agent, runId: string, memberName: string): Promise<FleetRunMember> {
    let record = this.requireMutableRecord(runId)
    this.requireExternalFleetPermission(record, 'team.manage')
    return this.wakeMemberNow(caller, record, memberName)
  }

  private async wakeMemberNow(caller: Agent, initial: FleetRunRecord, memberName: string): Promise<FleetRunMember> {
    let record = initial
    const budget = this.budgetRemaining(record, memberName)
    if (budget.exhaustedScope !== undefined) throw this.budgetError(record, memberName, budget.exhaustedScope)
    const member = record.members.find(candidate => candidate.name === memberName)
    if (member !== undefined) {
      if (!this.memberCanReply(member)) {
        await this.resumeMemberNow(caller, record, memberName)
        record = this.requireRecord(record.id)
      }
      const active = record.members.find(candidate => candidate.name === memberName)
      if (active === undefined || !this.memberCanReply(active)) throw new Error(`Could not wake Fleet member ${memberName}`)
      const runtime = this.collaboration.require(record.id)
      this.clearNetworkRecovery(active.sessionId)
      runtime.messages.sendSystemNotification(active.sessionId, {
        kind: 'team_wake',
        text: this.memberWakeInstruction(record, false),
        delivery: 'wakeup',
        coalesceKey: `member-wake:${record.work?.id ?? record.id}:${active.name}`,
      })
      this.manualWakeRequiredRunIds.delete(record.id)
      this.appendEvent(record.id, 'member_woken', { member: active.name })
      return structuredClone(active)
    }
    let assistant = record.assistants.find(candidate => candidate.view.id === memberName)
    if (assistant === undefined) throw new Error(`unknown Fleet member ${memberName}`)
    let runtime = this.collaboration.require(record.id)
    const online = assistant.status !== 'paused'
      && runtime.memberNamesById.get(assistant.sessionId) === assistant.view.id
      && this.ctx.agents.get(SessionId(assistant.sessionId)) !== undefined
    if (!online) {
      await this.resumeAssistant(record, assistant)
      record = this.requireRecord(record.id)
      assistant = record.assistants.find(candidate => candidate.view.id === memberName)
      if (assistant === undefined) throw new Error(`Could not wake Fleet assistant ${memberName}`)
      runtime = this.collaboration.require(record.id)
    }
    runtime.messages.sendSystemNotification(assistant.sessionId, {
      kind: 'team_wake',
      text: this.memberWakeInstruction(record, true),
      delivery: 'wakeup',
      coalesceKey: `member-wake:${record.work?.id ?? record.id}:${assistant.view.id}`,
    })
    this.manualWakeRequiredRunIds.delete(record.id)
    this.appendEvent(record.id, 'member_woken', { member: assistant.view.id })
    return this.assistantAsMember(this.status(record.id).assistants.find(candidate =>
      candidate.view.id === assistant.view.id) ?? assistant)
  }

  private wakeTeamMembers(record: FleetRunRecord): void {
    const runtime = this.requireRuntime(record.id)
    const members: string[] = []
    for (const member of record.members.filter(candidate => this.memberCanReply(candidate)
      && this.budgetRemaining(record, candidate.name).exhaustedScope === undefined)) {
      this.clearNetworkRecovery(member.sessionId)
      runtime.messages.sendSystemNotification(member.sessionId, {
        kind: 'team_wake',
        text: this.teamWakeInstruction(record, false),
        delivery: 'wakeup',
        coalesceKey: `team-wake:${record.work?.id ?? record.id}`,
      })
      members.push(member.name)
    }
    for (const assistant of record.assistants) {
      if (this.budgetRemaining(record, assistant.view.id).exhaustedScope !== undefined) continue
      if (assistant.status === 'paused') continue
      if (runtime.memberNamesById.get(assistant.sessionId) !== assistant.view.id) continue
      if (this.ctx.agents.get(SessionId(assistant.sessionId)) === undefined) continue
      runtime.messages.sendSystemNotification(assistant.sessionId, {
        kind: 'team_wake',
        text: this.teamWakeInstruction(record, true),
        delivery: 'wakeup',
        coalesceKey: `team-wake:${record.work?.id ?? record.id}`,
      })
      members.push(assistant.view.id)
    }
    this.appendEvent(record.id, 'team_woken', { reason: 'manual', members })
  }

  private memberWakeInstruction(record: FleetRunRecord, assistant: boolean): string {
    const activeWork = record.work?.status === 'running' ? record.work : undefined
    return [
      activeWork === undefined
        ? `[Fleet Team ${record.name} member wake-up]`
        : `[Fleet work ${activeWork.id} member wake-up]`,
      assistant
        ? 'You were explicitly woken. Continue assisting from the latest Team state and current instructions.'
        : 'You were explicitly woken. Continue from the latest Team state and current instructions.',
      assistant
        ? 'Inspect relevant Channels, Meetings, Votes, shared files, and member status before acting.'
        : 'Inspect relevant Channels, Meetings, Votes, shared files, and member status before acting. Verify external side effects before retrying interrupted work.',
    ].join('\n\n')
  }

  private teamWakeInstruction(record: FleetRunRecord, assistant: boolean): string {
    const activeWork = record.work?.status === 'running' ? record.work : undefined
    return [
      activeWork === undefined
        ? `[Fleet Team ${record.name} wake-up]`
        : `[Fleet work ${activeWork.id} team wake-up]`,
      assistant
        ? 'The Team was explicitly woken. Continue assisting from the latest Team state and current instructions.'
        : 'The Team was explicitly woken. Continue from the latest Team state and current instructions.',
      assistant
        ? 'Inspect relevant Channels, Meetings, Votes, shared files, and member status before acting.'
        : 'Inspect relevant Channels, Meetings, Votes, shared files, and member status before acting. Verify external side effects before retrying interrupted work.',
    ].join('\n\n')
  }

  async pauseMember(caller: Agent, runId: string, memberName: string): Promise<FleetRunMember> {
    const record = this.requireMutableRecord(runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    return this.pauseMemberOperation(caller, record.id, memberName)
  }

  async pauseMemberAsExternal(caller: Agent, runId: string, memberName: string): Promise<FleetRunMember> {
    const record = this.requireMutableRecord(runId)
    this.requireExternalFleetPermission(record, 'team.manage')
    return this.pauseMemberOperation(caller, record.id, memberName)
  }

  private async pauseMemberOperation(caller: Agent, runId: string, memberName: string): Promise<FleetRunMember> {
    const record = this.requireRecord(runId)
    const key = `${record.id}:${memberName}`
    const pending = this.pausingMembers.get(key)
    if (pending !== undefined) return pending
    const operation = Promise.resolve().then(() => this.pauseMemberNow(caller, record.id, memberName))
    this.pausingMembers.set(key, operation)
    try {
      return await operation
    } finally {
      if (this.pausingMembers.get(key) === operation) this.pausingMembers.delete(key)
    }
  }

  private async pauseMemberNow(caller: Agent, runId: string, memberName: string): Promise<FleetRunMember> {
    const record = this.requireMutableRecord(runId)
    const member = record.members.find(candidate => candidate.name === memberName)
    if (member === undefined) {
      const assistant = record.assistants.find(candidate => candidate.view.id === memberName)
      if (assistant === undefined) throw new Error(`unknown Fleet member ${memberName}`)
      return this.interruptAssistant(record, assistant)
    }
    this.clearNetworkRecovery(member.sessionId)
    if (member.status === 'paused' && !this.memberCanReply(member)) return structuredClone(member)
    if (member.sessionId === String(caller.id)) throw new Error('a Fleet member cannot pause itself')
    const runtimeName = this.runtimeMemberName(record.id, member.name)
    const managed = this.core.list().some(candidate => candidate.name === runtimeName)
    const live = this.liveMember(member)
    if (live === undefined) throw new Error(`Fleet member ${memberName} is not loaded`)
    if (live?.status === 'running' && managed) {
      // A running Session may hold persistence work until its turn ends. Cancel first so
      // pause cannot deadlock while waiting for a flush that only the same turn can release.
      this.core.cancelManaged(runtimeName)
      await this.core.whenIdle(runtimeName)
    }
    if (live !== undefined) await this.ctx.sessions.flush(live.session)
    const runtime = this.requireRuntime(record.id)
    let activeMember = member
    if (live?.status === 'idle' && managed) {
      const rotated = await this.core.rotateManaged(runtimeName)
      if (rotated !== undefined && rotated.id !== member.sessionId) {
        const view = this.effectiveMemberViews(record).find(candidate => candidate.id === member.name)
        if (view === undefined) throw new Error(`missing Fleet member view ${member.name}`)
        runtime.rebindMember(member.sessionId, rotated.id, view)
        runtime.resources.release(member.sessionId)
        activeMember = { ...member, sessionId: rotated.id }
        this.replaceRecord(record.id, {
          members: record.members.map(candidate => candidate.name === member.name ? activeMember : candidate),
        })
        this.appendEvent(record.id, 'member_session_rotated', {
          member: member.name,
          previousSessionId: member.sessionId,
          sessionId: rotated.id,
        })
      }
    }
    runtime.messages.disconnectAgent(activeMember.sessionId)
    if (this.core.list().some(candidate => candidate.name === runtimeName)) {
      await this.core.stopManaged(runtimeName)
    }
    runtime.detachMember(activeMember.sessionId)
    const paused: FleetRunMember = { ...activeMember, status: 'paused' }
    this.replaceRecord(record.id, {
      members: record.members.map(candidate => candidate.name === member.name ? paused : candidate),
    })
    this.appendEvent(record.id, 'member_paused', paused)
    return structuredClone(paused)
  }

  async resumeMember(caller: Agent, runId: string, memberName: string): Promise<FleetRunMember> {
    const record = this.requireMutableRecord(runId, caller.session.header.cwd)
    this.requireFleetPermission(record, caller, 'team.manage')
    return this.resumeMemberNow(caller, record, memberName)
  }

  async resumeMemberAsExternal(caller: Agent, runId: string, memberName: string): Promise<FleetRunMember> {
    const record = this.requireMutableRecord(runId)
    this.requireExternalFleetPermission(record, 'team.manage')
    return this.resumeMemberNow(caller, record, memberName)
  }

  private async resumeMemberNow(caller: Agent, record: FleetRunRecord, memberName: string): Promise<FleetRunMember> {
    const member = record.members.find(candidate => candidate.name === memberName)
    if (member === undefined) {
      const assistant = record.assistants.find(candidate => candidate.view.id === memberName)
      if (assistant === undefined) throw new Error(`unknown Fleet member ${memberName}`)
      return this.resumeAssistant(record, assistant)
    }
    if (this.memberCanReply(member)) throw new Error(`Fleet member ${memberName} is already online and can reply`)
    const view = this.effectiveMemberViews(record).find(candidate => candidate.id === member.name)
    if (view === undefined) throw new Error(`missing Fleet member view ${member.name}`)
    const template = parseTeamTemplate(
      JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown,
      this.configuration,
    )
    const wasDormant = this.dormantRunIds.delete(record.id)
    const runtimeName = this.runtimeMemberName(record.id, member.name)
    try {
      const runtime = this.collaboration.require(record.id)
      runtime.updateMemberView(view)
      if (this.core.list().some(candidate => candidate.name === runtimeName)) {
        await this.core.stopManaged(runtimeName)
        runtime.detachMember(member.sessionId)
      }
      const resumed = await this.core.resume(caller, {
        id: member.sessionId,
        name: runtimeName,
        archiveId: this.memberArchiveId(record.id, member.name),
        displayName: view.name,
        color: view.color ?? member.color ?? generateFleetMemberColor(),
        role: view.role,
        persona: persona({ ...template, members: this.effectiveMemberViews(record) }, view),
        ...this.memberRuntimeOptions(record, view),
        setup: childCtx => this.setupFormalMember(childCtx, runtime, view.id, 'resume'),
      })
      const resumedAgent = this.ctx.agents.get(SessionId(resumed.id))
      if (member.status === 'paused' && resumedAgent !== undefined) {
        // Put the resume signal in the Session before attachMember refreshes queued
        // Fleet messages. Otherwise a member can receive "continue after resume"
        // work while its latest conversational state still says it is paused.
        resumedAgent.inject(createUserMessage({
          content: [{
            type: 'text',
            text: [
              '[Fleet pause lifted]',
              'Your Fleet runtime is active again. This is the explicit resume signal.',
              'Process queued messages and required tasks now; do not keep waiting because an earlier message said to wait until resume.',
            ].join('\n\n'),
          }],
          source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'instructions' },
        }))
      }
      if (resumed.id === member.sessionId) runtime.attachMember(resumed.id, view)
      else runtime.rebindMember(member.sessionId, resumed.id, view)
      const active: FleetRunMember = {
        ...member,
        sessionId: resumed.id,
        displayName: resumed.displayName,
        color: resumed.color,
        role: view.role,
        status: 'idle',
      }
      if (wasDormant) {
        runtime.activateProductivity()
        runtime.events.emit('fleet/team/session-start', { source: 'resume' })
        this.appendEvent(record.id, 'team_loaded', {
          launcherSessionId: String(caller.id),
          previousLauncherSessionId: record.launcherSessionId,
          members: [member.name],
          scope: 'member',
        })
      }
      const teamWasPaused = record.status === 'paused'
      const remainingTeamPausedMembers = (record.teamPausedMembers ?? []).filter(name => name !== member.name)
      const resumedRecord = this.replaceRecord(record.id, {
        members: record.members.map(candidate => candidate.name === member.name ? active : candidate),
        teamPausedMembers: remainingTeamPausedMembers,
        ...(teamWasPaused ? {
          status: record.work?.status === 'running' ? 'running' : 'idle',
        } : {}),
      })
      if (teamWasPaused) {
        runtime.activateProductivity()
        this.appendEvent(record.id, 'team_status', {
          status: resumedRecord.status,
          resumedFrom: 'member',
          member: member.name,
        })
        this.notify(resumedRecord)
      }
      this.appendEvent(record.id, 'member_resumed', active)
      runtime.calendar.retryPendingStarts()
      return structuredClone(active)
    } catch (error) {
      if (wasDormant) this.dormantRunIds.add(record.id)
      throw error
    }
  }

  private interruptAssistant(record: FleetRunRecord, assistant: FleetRunAssistant): FleetRunMember {
    const live = this.ctx.agents.get(SessionId(assistant.sessionId))
    if (live?.status === 'running') live.cancel({ kind: 'parent' })
    this.appendEvent(record.id, 'assistant_interrupted', {
      assistantId: assistant.view.id,
      sessionId: assistant.sessionId,
    })
    return this.assistantAsMember(this.status(record.id).assistants.find(candidate =>
      candidate.view.id === assistant.view.id) ?? assistant)
  }

  private async resumeAssistant(record: FleetRunRecord, assistant: FleetRunAssistant): Promise<FleetRunMember> {
    const runtime = this.collaboration.require(record.id)
    const connected = runtime.memberNamesById.get(assistant.sessionId) === assistant.view.id
    const live = this.ctx.agents.get(SessionId(assistant.sessionId))
    if (assistant.status !== 'paused' && connected && live !== undefined) {
      throw new Error(`Fleet member ${assistant.view.id} is already online and can reply`)
    }
    const active: FleetRunAssistant = { sessionId: assistant.sessionId, view: assistant.view }
    this.replaceRecord(record.id, {
      assistants: record.assistants.map(candidate => candidate.view.id === assistant.view.id ? active : candidate),
    })
    try {
      if (this.residentAssistants !== undefined) await this.residentAssistants.restore(assistant.sessionId)
      else {
        if (live !== undefined) await this.attachAssistant(live, { runId: record.id, assistantId: assistant.view.id })
      }
    } catch (error) {
      this.replaceRecord(record.id, {
        assistants: this.requireRecord(record.id).assistants.map(candidate =>
          candidate.view.id === assistant.view.id ? { ...candidate, status: 'paused' } : candidate),
      })
      throw error
    }
    const resumed = this.status(record.id).assistants.find(candidate => candidate.view.id === assistant.view.id)
    if (resumed === undefined || resumed.status === 'offline' || resumed.status === 'paused') {
      this.replaceRecord(record.id, {
        assistants: this.requireRecord(record.id).assistants.map(candidate =>
          candidate.view.id === assistant.view.id ? { ...candidate, status: 'paused' } : candidate),
      })
      throw new Error(`Could not resume Fleet assistant ${assistant.view.id}`)
    }
    this.appendEvent(record.id, 'assistant_resumed', {
      assistantId: assistant.view.id,
      sessionId: assistant.sessionId,
    })
    return this.assistantAsMember(resumed)
  }

  private assistantAsMember(assistant: FleetRunAssistant): FleetRunMember {
    return {
      name: assistant.view.id,
      displayName: assistant.view.name,
      ...(assistant.view.color === undefined ? {} : { color: assistant.view.color }),
      role: assistant.view.role,
      sessionId: assistant.sessionId,
      ...(assistant.view.provider === undefined ? {} : { provider: assistant.view.provider }),
      ...(assistant.view.model === undefined ? {} : { model: assistant.view.model }),
      ...(assistant.view.reasoningEffort === undefined ? {} : { reasoningEffort: assistant.view.reasoningEffort }),
      ...(assistant.view.maxTokens === undefined ? {} : { maxTokens: assistant.view.maxTokens }),
      status: assistant.status ?? 'offline',
    }
  }

  private requireExternalFleetPermission(record: FleetRunRecord, permission: FleetMemberPermission): void {
    this.authorization?.require({
      teamId: record.id,
      subject: { kind: 'external', id: `fleet-user:${record.id}` },
      action: permission,
      resource: { kind: 'team', id: record.id },
    })
  }

  private requireFleetPermission(record: FleetRunRecord, caller: Agent, permission: FleetMemberPermission): FleetMemberView {
    const participant = this.participants(record).find(member => member.sessionId === String(caller.id))
    if (participant === undefined) throw new Error(`Agent ${String(caller.id)} is not a Fleet participant`)
    const assistant = record.assistants.find(candidate => candidate.sessionId === String(caller.id))
    if (assistant !== undefined) this.requireAssistantConnection(caller, record.id)
    const view = this.memberViews(record.id).find(candidate => candidate.id === participant.name)
    if (view === undefined) throw new Error(`Fleet member ${participant.name} is not configured`)
    if (this.authorization === undefined) {
      if (!view.permissions.includes(permission)) throw new Error(`Fleet member ${participant.name} lacks ${permission}`)
    } else {
      this.authorization.require({
        teamId: record.id,
        subject: { kind: assistant === undefined ? 'member' : 'assistant', id: participant.name },
        action: permission,
        resource: { kind: 'team', id: record.id },
      })
    }
    return view
  }

  private requireLifecycleControl(record: FleetRunRecord, caller: Agent): void {
    this.requireParticipant(record, caller)
    if (record.assistants.some(assistant => assistant.sessionId === String(caller.id))) {
      this.requireFleetPermission(record, caller, 'team.manage')
    }
  }

  async attachAssistant(caller: Agent, input: AttachAssistantInput = {}): Promise<{
    readonly run: FleetRunRecord
    readonly assistant: FleetRunAssistant
  }> {
    const record = this.requireRecord(input.runId, input.projectRoot ?? caller.session.header.cwd)
    // Persisted Teams restore their collaboration state before any managed member
    // Agent resumes. A user-facing assistant may reconnect to that restored runtime
    // independently; this must not wake or recreate the formal member roster.
    const runtime = this.dormantRunIds.has(record.id)
      ? this.collaboration.require(record.id)
      : this.requireRuntime(record.id)
    if (isTerminal(record.status)) throw new Error(`Fleet team ${record.id} is ${record.status}`)
    this.bindBudgetGuard(caller)

    const callerId = String(caller.id)
    const autoJoinChannels = parseTeamTemplate(
      JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown,
      this.configuration,
    )
      .channels.map(channel => channel.id)
    const otherTeam = this.assistantTeamForSession(callerId, record.id)
    if (otherTeam !== undefined) {
      throw new Error(`Session ${callerId} is already the foreground assistant for Fleet team ${otherTeam.id}; use a separate native Session for team ${record.id}`)
    }
    const current = record.assistants.find(assistant => assistant.sessionId === callerId)
    if (current?.status === 'paused') {
      throw new Error(`Fleet assistant ${current.view.id} is paused; resume it before reconnecting`)
    }
    if (current !== undefined && runtime.memberNamesById.get(callerId) === current.view.id) {
      runtime.attachMember(callerId, current.view, 'assistant')
      await this.installAssistantTools(caller, runtime, current.view.id)
      runtime.messages.connectAgent(callerId, autoJoinChannels)
      this.bindAssistantRequestConfig(caller, this.assistantRequestConfig(current, caller))
      this.bindAssistantInput(caller)
      await this.captureLatestAssistantUserInput(record, current, caller)
      queueMicrotask(() => { this.signalAssistantInteractionDeliveries(record.id) })
      return { run: this.describeRecord(record), assistant: structuredClone(current) }
    }
    if (current !== undefined) {
      runtime.attachMember(callerId, current.view, 'assistant')
      await this.installAssistantTools(caller, runtime, current.view.id)
      runtime.messages.connectAgent(callerId, autoJoinChannels)
      this.bindAssistantRequestConfig(caller, this.assistantRequestConfig(current, caller))
      this.bindAssistantInput(caller)
      await this.captureLatestAssistantUserInput(record, current, caller)
      queueMicrotask(() => { this.signalAssistantInteractionDeliveries(record.id) })
      return { run: this.describeRecord(record), assistant: structuredClone(current) }
    }
    const rebound = input.assistantId === undefined
      ? undefined
      : record.assistants.find(assistant => assistant.view.id === input.assistantId)
    if (input.assistantId !== undefined && rebound === undefined) {
      throw new Error(`unknown Fleet assistant ${input.assistantId}`)
    }
    if (rebound?.status === 'paused') {
      throw new Error(`Fleet assistant ${rebound.view.id} is paused; resume it before reconnecting`)
    }
    let releasedResidentSessionId: string | undefined
    if (rebound !== undefined
      && rebound.sessionId !== callerId
      && runtime.memberNamesById.get(rebound.sessionId) === rebound.view.id
      && this.ctx.agents.get(SessionId(rebound.sessionId)) !== undefined) {
      const released = await this.residentAssistants?.release(rebound.sessionId) ?? false
      if (!released) throw new Error(`Fleet assistant ${rebound.view.id} is already attached to a live session`)
      releasedResidentSessionId = rebound.sessionId
    }

    const configured = this.effectiveMemberViews(record)
    const existingViews = [...configured, ...record.assistants.map(assistant => assistant.view)]
    const view: FleetAssistantView = rebound?.view ?? {
      id: input.id?.trim() || `assistant-${randomUUID().slice(0, 8)}`,
      name: input.name?.trim() || generateMemberDisplayName(existingViews.map(member => member.name)),
      color: input.color === undefined
        ? generateFleetMemberColor(existingViews.flatMap(member => member.color === undefined ? [] : [member.color]))
        : normalizeFleetMemberColor(input.color),
      role: input.role?.trim() || 'Team Assistant',
      responsibility: input.responsibility?.trim()
        || 'Maintain the user-facing Team conversation and help the user collaborate with the Team.',
      prompt: input.prompt?.trim() ?? '',
      ...((input.provider ?? caller.options.provider) === undefined
        ? {}
        : { provider: input.provider ?? caller.options.provider }),
      ...((input.model ?? caller.options.model) === undefined
        ? {}
        : { model: input.model ?? caller.options.model }),
      toolGroups: input.toolGroups === undefined ? ['messages', 'status', 'resources'] : [...input.toolGroups],
      permissions: input.permissions === undefined ? [] : [...input.permissions],
      contacts: input.contacts === undefined
        ? { members: '*', channels: '*' }
        : structuredClone(input.contacts),
    }
    normalizedMemberView(view, 'assistant')
    if (existingViews.some(member => member.id === view.id) && rebound === undefined) {
      throw new Error(`Fleet member id ${view.id} already exists`)
    }

    try {
      if (rebound !== undefined && rebound.sessionId !== callerId) {
        runtime.rebindMember(rebound.sessionId, callerId, view, 'assistant')
      } else {
        runtime.attachMember(callerId, view, 'assistant')
      }
      await this.installAssistantTools(caller, runtime, view.id)
      runtime.messages.connectAgent(callerId, autoJoinChannels)
      this.bindAssistantRequestConfig(caller, this.requestConfigForAssistantView(view, caller))
    } catch (error) {
      runtime.detachMember(callerId)
      if (rebound !== undefined && rebound.sessionId !== callerId) {
        runtime.memberIdsByName.set(rebound.view.id, rebound.sessionId)
        runtime.memberNamesById.set(rebound.sessionId, rebound.view.id)
      }
      if (releasedResidentSessionId !== undefined) {
        await this.residentAssistants?.restore(releasedResidentSessionId)
      }
      throw error
    }
    const assistant: FleetRunAssistant = { sessionId: callerId, view: structuredClone(view) }
    const assistants = rebound === undefined
      ? [...record.assistants, assistant]
      : record.assistants.map(candidate => candidate.view.id === rebound.view.id ? assistant : candidate)
    const updated = this.replaceRecord(record.id, { assistants })
    this.appendEvent(record.id, rebound === undefined ? 'assistant_attached' : 'assistant_rebound', {
      ...(rebound === undefined ? {} : { previousSessionId: rebound.sessionId }),
      sessionId: callerId,
      view,
    })
    this.bindAssistantInput(caller)
    await this.captureLatestAssistantUserInput(updated, assistant, caller)
    queueMicrotask(() => { this.signalAssistantInteractionDeliveries(updated.id) })
    return { run: this.describeRecord(updated), assistant: structuredClone(assistant) }
  }

  private async captureLatestAssistantUserInput(
    record: FleetRunRecord,
    assistant: FleetRunAssistant,
    agent: Agent,
  ): Promise<void> {
    const input = agent.session.events.findLast(event =>
      event.type === 'user/message' && event.data.source?.kind === 'user')
    if (input?.type !== 'user/message') return
    const tasks = this.collaboration.get(record.id)?.tasks
    if (tasks === undefined) return
    const previous = tasks.interactionTask(assistant.view.id)
    const interaction = tasks.recordInteractionInput(assistant.view.id, {
      messageId: String(input.data.id),
      text: progressMessageText(input.data),
    })
    const inputIsNew = previous?.domain.kind !== 'interaction'
      || previous.domain.latestMessageId !== String(input.data.id)
    const inputIsUnsettled = interaction.domain.kind === 'interaction'
      && interaction.domain.settledRevision < interaction.domain.inputRevision
    if (inputIsNew || (inputIsUnsettled && interaction.stableState.kind === 'dormant')) {
      this.armAssistantQuiescence(record.id, assistant.view.id)
    }
    if (inputIsNew || inputIsUnsettled) {
      await this.loadTeamMembersForAssistantInput(agent, record.id)
    }
  }

  private bindAssistantInput(agent: Agent): void {
    if (this.assistantInputBindingAgents.has(agent)) return
    const context = (agent as Agent & { readonly ctx?: Context }).ctx
    if (context === undefined) return
    this.assistantInputBindingAgents.add(agent)
    context.on('agent/turn-stopping', ({ agent: stoppingAgent, turn }) => {
      this.memberTurnStopping(stoppingAgent, turn)
    })
    context.on('agent/pre-step', async (_payload, next: () => Promise<PreStepDecision>) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const record = this.assistantTeamForSession(String(agent.id))
      if (record === undefined) return decision
      const assistant = record.assistants.find(candidate => candidate.sessionId === String(agent.id))
      const tasks = this.collaboration.get(record.id)?.tasks
      if (assistant === undefined || tasks === undefined) return decision

      let hasDirectUserInput = false
      for (const message of decision.messages) {
        if (message.source.kind !== 'user') continue
        hasDirectUserInput = true
        const originalText = progressMessageText(message)
        const previous = tasks.interactionTask(assistant.view.id)
        tasks.recordInteractionInput(assistant.view.id, {
          messageId: String(message.id),
          text: originalText,
        })
        if (previous?.domain.kind !== 'interaction'
          || previous.domain.latestMessageId !== String(message.id)) {
          this.assistantNativeToolRestrictions.get(agent)?.tighten()
          this.armAssistantQuiescence(record.id, assistant.view.id)
        }
      }
      if (hasDirectUserInput) await this.loadTeamMembersForAssistantInput(agent, record.id)
      return this.preStepReminderDecision(agent, decision)
    })
    context.on('system-prompt/assemble', async (_assembly, _assembleContext, next) => {
      const assembly = await next()
      const record = this.assistantTeamForSession(String(agent.id))
      if (record === undefined) return assembly
      const assistant = record.assistants.find(candidate => candidate.sessionId === String(agent.id))
      if (assistant === undefined) return assembly
      const roster = reachableRoster([
        ...this.effectiveMemberViews(record),
        ...record.assistants.map(candidate => candidate.view),
      ], assistant.view)
      const request = [
        '[Fleet Foreground Protocol]',
        `Current Team: ${record.id}`,
        `Current reachable roster (use these exact identities only): ${roster || 'none'}.`,
        '',
        `Every direct foreground user input is already tracked in this Team's persistent Interaction Task. The foreground message is the current revision; do not call fleet_user_task status merely because direct input arrived. Use action="status" with run_id="${record.id}" after a Task Delivery, recovery wake, or when the current Interaction state is otherwise unclear.`,
        'Conversation, clarification, status checks, coordination, and read-only inspection remain direct and natural.',
        'A normal project imperative remains Team work: delegate before project execution, and take over only when explicitly requested, no formal member is available, or Team execution has failed.',
        'A successful fleet_run start already links the new root Task and makes this Interaction dormant. Its result says to end the turn; do not follow it with fleet_user_task continue or status.',
        'When fleet_send returns replyTaskIds for delegated work, do not poll members. After all needed requests have been sent, call fleet_user_task action="continue" once with those task_ids and end the turn. Fleet wakes this assistant from durable Task settlement or its bounded progress deadline.',
        'Intermediate native output is retained in the Session trace but is not delivered to the user by default. Use fleet_user_task action="update" only for an intentional mid-turn user update; do not use it to duplicate the final answer.',
        'For ordinary conversation, clarification, status, or read-only answers with no linked Team work, pending Delivery, or take-over lease, do not call fleet_user_task report: the last non-empty native output completes the direct Interaction and is delivered to the user when the turn ends normally.',
        `Before emitting a native response that settles delegated Team work or a Delivery, or blocks the request, call fleet_user_task with action="report" or action="block" and run_id="${record.id}".`,
        'Do not emit the final answer before that tool call. After it succeeds, emit the answer exactly once and end the turn. Fleet commits and delivers that last native output at turn end; a delegated result or block is not complete without both the tool intent and non-empty native output.',
      ].join('\n')
      return {
        ...assembly,
        sections: [...assembly.sections, { name: FLEET_FOREGROUND_PROTOCOL_SECTION, text: request }],
      }
    })
  }

  private async installAssistantTools(
    caller: Agent,
    runtime: FleetCollaborationTeam,
    assistantId: string,
  ): Promise<void> {
    // Agent factory setup runs before publication. A registration made through
    // that temporary setup fiber is not a durable Agent-scoped contribution.
    // The resident controller calls us again after `agents.resume()` returns.
    if (this.ctx.agents.get(SessionId(String(caller.id))) !== caller) return
    const callerCtx = (caller as Agent & { readonly ctx?: Context }).ctx
    if (callerCtx === undefined) return
    const ready = callerCtx as Context & {
      readonly fs?: unknown
      readonly tools?: {
        readonly register?: unknown
        get?(name: string, agent?: Agent): unknown
        restrict?(filter: { readonly deny: readonly string[] }): () => void
        guard?(guard: (execution: { readonly name: string; readonly arguments: unknown }) => string | undefined): () => void
      }
      readonly inject?: unknown
    }
    const registeredHere = this.assistantToolAgents.has(caller)
    if (registeredHere) return
    const configured = runtime.memberViews.get(assistantId)?.toolGroups ?? []
    // Lightweight Agent test/runtime adapters sometimes expose services as
    // ordinary own properties. That path is safe to inspect synchronously.
    // Real Cordis contexts expose services through a proxy, where even an
    // optional `ctx.fs` probe without inject is intentionally an error.
    const directTools = Object.hasOwn(ready, 'tools') ? ready.tools : undefined
    const directFs = Object.hasOwn(ready, 'fs')
    if (typeof directTools?.register === 'function') {
      const nativeRestriction = this.installAssistantNativeToolRestriction(caller, directTools)
      const stopBoundary = directTools.guard?.(execution =>
        this.assistantExecutionBoundaryReason(caller, execution))
      const hostHasProgress = typeof directTools.get === 'function'
        && directTools.get('fleet_progress') !== undefined
      const stop = runtime.installTools(callerCtx, assistantId, {
        exposeHostFleetTools: true,
        toolGroups: configured.filter(group =>
          (directFs || group !== 'resources')
          && (!hostHasProgress || group !== 'status'),
        ),
      })
      if (typeof directTools.get === 'function'
        && (directTools.get('fleet_inbox', caller) === undefined
          || directTools.get('fleet_reply', caller) === undefined)) {
        stop()
        stopBoundary?.()
        nativeRestriction.release()
        throw new Error('Fleet assistant Inbox/Reply tools were not visible in the Agent scope after installation')
      }
      this.assistantToolAgents.add(caller)
      return
    }
    if (typeof ready.inject !== 'function') return
    // Agent contexts can expose one service (for example tools) without granting
    // direct access to another one. Probing `callerCtx.fs` outside an injected
    // fiber is therefore not an availability check: Cordis correctly throws
    // "cannot get property ... without inject". Always create the durable tool
    // binding from a scope that explicitly injects both services.
    await callerCtx.inject(['fs', 'tools'], (scope) => {
      const nativeRestriction = this.installAssistantNativeToolRestriction(caller, scope.tools)
      const stopBoundary = scope.tools.guard(execution =>
        this.assistantExecutionBoundaryReason(caller, execution))
      const hostHasProgress = scope.tools.get('fleet_progress') !== undefined
      const stop = runtime.installTools(scope, assistantId, {
        exposeHostFleetTools: true,
        toolGroups: configured.filter(group =>
          !hostHasProgress || group !== 'status',
        ),
      })
      if (scope.tools.get('fleet_inbox', caller) === undefined
          || scope.tools.get('fleet_reply', caller) === undefined) {
        stop()
        stopBoundary()
        nativeRestriction.release()
        throw new Error('Fleet assistant Inbox/Reply tools were not visible in the Agent scope after installation')
      }
      this.assistantToolAgents.add(caller)
      return () => { nativeRestriction.release(); stopBoundary(); stop() }
    })
  }

  private installAssistantNativeToolRestriction(
    caller: Agent,
    tools: {
      get?(name: string, agent?: Agent): unknown
      restrict?(filter: { readonly deny: readonly string[] }): () => void
    },
  ): { tighten(): void; release(): void } {
    let stop: (() => void) | undefined
    const controller = {
      tighten: () => {
        if (stop !== undefined || tools.restrict === undefined || tools.get === undefined) return
        const get = tools.get.bind(tools)
        const deny = ASSISTANT_DELEGATION_ONLY_NATIVE_TOOLS.filter(name =>
          get(name, caller) !== undefined)
        if (deny.length > 0) stop = tools.restrict({ deny })
      },
      release: () => {
        stop?.()
        stop = undefined
      },
    }
    this.assistantNativeToolRestrictions.set(caller, controller)
    controller.tighten()
    return controller
  }

  detachAssistant(caller: Agent, runId?: string): FleetRunRecord {
    const record = this.requireCallerRecord(caller, runId)
    const assistant = this.requireAssistantConnection(caller, record.id)
    const runtime = this.requireRuntime(record.id)
    runtime.messages.disconnectAgent(String(caller.id))
    runtime.detachMember(String(caller.id))
    const requestConfig = this.assistantRequestConfigs.get(caller)
    if (requestConfig !== undefined) requestConfig.current = undefined
    this.appendEvent(record.id, 'assistant_detached', {
      assistantId: assistant.view.id,
      sessionId: assistant.sessionId,
    })
    return this.describeRecord(record)
  }

  sendAssistantMessage(caller: Agent, input: SendAssistantMessageInput): FleetAssistantMessage {
    const record = this.requireMutableRecord(input.runId, input.projectRoot)
    const assistant = this.requireAssistantConnection(caller, record.id)
    if (record.status !== 'idle' && record.status !== 'running') {
      throw new Error(`Fleet team ${record.id} cannot receive assistant messages while ${record.status}`)
    }
    const content = input.text.trim()
    if (content.length === 0) throw new Error('Fleet assistant message cannot be empty')
    if (content.length > MAX_ASSISTANT_MESSAGE_LENGTH) {
      throw new Error(`Fleet assistant message cannot exceed ${MAX_ASSISTANT_MESSAGE_LENGTH} characters`)
    }
    // Assignment is a durable Team decision, not a snapshot of which Agent is
    // currently loaded. Once an unloaded member owns a ready Task, the owner
    // reconciler resumes only that member. Explicit pauses still opt out.
    const available = record.members.filter(member => member.status !== 'paused')
    const views = new Map(this.effectiveMemberViews(record).map(view => [view.id, view]))
    const resolveMember = (reference: string): string => {
      const normalized = reference.startsWith('@') ? reference.slice(1) : reference
      const matches = available.filter(member =>
        member.name === normalized || views.get(member.name)?.name === normalized,
      )
      if (matches.length === 0) throw new Error(`unknown or unavailable Fleet member ${reference}`)
      if (matches.length > 1) throw new Error(`ambiguous Fleet member ${reference}`)
      return matches[0]?.name as string
    }
    if (input.kind !== 'directive' && input.stages !== undefined && input.stages.length > 0) {
      throw new Error('Fleet assistant stages require a directive message')
    }
    const stages: FleetAssistantStage[] = []
    const stageKeys = new Set<string>()
    for (const candidate of input.stages ?? []) {
      const key = candidate.key.trim()
      const title = candidate.title.trim()
      const kind = candidate.kind ?? 'goal'
      if (key.length === 0) throw new Error('Fleet assistant stage key cannot be empty')
      if (title.length === 0) throw new Error(`Fleet assistant stage ${key} title cannot be empty`)
      if (stageKeys.has(key)) throw new Error(`duplicate Fleet assistant stage key ${key}`)
      const dependencies = [...new Set((candidate.dependencies ?? []).map(dependency => dependency.trim()))]
      for (const dependency of dependencies) {
        if (!stageKeys.has(dependency)) {
          throw new Error(`Fleet assistant stage ${key} dependency ${dependency} must reference an earlier stage`)
        }
      }
      const owners = [...new Set(candidate.owners.map(resolveMember))]
      if (owners.length === 0) throw new Error(`Fleet assistant stage ${key} requires at least one owner`)
      if (kind === 'vote' && (candidate.description?.trim().length ?? 0) === 0) {
        throw new Error(`Fleet assistant Vote stage ${key} requires a decision statement in description`)
      }
      stageKeys.add(key)
      stages.push({
        key, kind, title, description: candidate.description?.trim() ?? '', owners, dependencies,
        ...(candidate.timeoutAt === undefined ? {} : { timeoutAt: candidate.timeoutAt }),
      })
    }
    const readyOwners = stages.flatMap(stage => stage.dependencies.length === 0 ? stage.owners : [])
    const recipients = stages.length > 0
      ? [...new Set(readyOwners)]
      : input.recipients === undefined
      ? available.map(member => member.name)
      : [...new Set(input.recipients.map(resolveMember))]
    if (recipients.length === 0) throw new Error(`Fleet team ${record.id} has no available members`)
    const channel = parseTeamTemplate(
      JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown,
      this.configuration,
    ).channels[0]
    if (channel === undefined) throw new Error(`Fleet team ${record.id} has no Team Channel`)
    this.authorization?.require({
      teamId: record.id,
      subject: { kind: 'assistant', id: assistant.view.id },
      action: 'message.post',
      resource: { kind: 'conversation', id: `#${channel.id}` },
    })
    if (input.kind === 'directive') this.authorization?.require({
      teamId: record.id,
      subject: { kind: 'assistant', id: assistant.view.id },
      action: 'message.wakeup',
      resource: { kind: 'conversation', id: `#${channel.id}` },
    })
    const messages = this.requireRuntime(record.id).messages
    // Hold staged directives until fleet_run start can atomically create the
    // composite root and first ready cohort. Publishing here would make Inbox
    // Tasks non-empty and resume members before their formal work exists.
    const stagedDirective = input.kind === 'directive' && stages.length > 0
    const sent = stagedDirective
      ? { messageId: `staged_assistant_${randomUUID()}` }
      : messages.send(caller, {
          to: `#${channel.id}`,
          text: content,
          delivery: input.kind === 'directive' ? 'wakeup' : 'quiet',
          ...(input.kind === 'directive' || input.recipients !== undefined
            ? { mentions: recipients.map(member => `@${member}`) }
            : {}),
        })
    const kickoffKey = `${record.id}:${String(caller.id)}`
    if (input.kind === 'directive') this.pendingAssistantKickoffs.set(kickoffKey, {
      messageId: sent.messageId,
      text: content,
      channelId: channel.id,
      staged: stagedDirective,
      recipients,
      stages,
    })
    else this.pendingAssistantKickoffs.delete(kickoffKey)
    const message: FleetAssistantMessage = {
      id: `assistant_message_${randomUUID()}`,
      messageId: sent.messageId,
      runId: record.id,
      kind: input.kind,
      text: stagedDirective ? content : messages.getMessage(caller, sent.messageId).text,
      recipients,
      stages,
      assistantSessionId: String(caller.id),
      assistantId: assistant.view.id,
      assistantName: assistant.view.name,
      createdAt: new Date().toISOString(),
    }
    this.appendEvent(record.id, 'assistant_message', message)
    return structuredClone(message)
  }

  sendConversationMessage(caller: Agent, input: SendFleetConversationMessageInput): SendMessageResult {
    const record = this.requireCallerRecord(caller, input.runId)
    if (isTerminal(record.status)) throw new Error(`Fleet team ${record.id} is ${record.status}`)
    this.requireAssistantConnection(caller, record.id)
    const participant = this.participants(record).find(member => member.sessionId === String(caller.id))
    if (participant === undefined) throw new Error(`Agent ${String(caller.id)} is not a Fleet participant`)
    const subject = {
      kind: record.assistants.some(assistant => assistant.sessionId === String(caller.id)) ? 'assistant' as const : 'member' as const,
      id: participant.name,
    }
    this.authorization?.require({
      teamId: record.id,
      subject,
      action: 'message.post',
      resource: { kind: 'conversation', id: input.to },
    })
    if (input.delivery !== 'quiet') this.authorization?.require({
      teamId: record.id,
      subject,
      action: input.delivery === 'interrupt' ? 'message.interrupt' : 'message.wakeup',
      resource: { kind: 'conversation', id: input.to },
    })
    const runtime = this.requireRuntime(record.id)
    // This service route is the foreground-assistant transport. Formal members
    // use the Message package tool bound inside their Team context.
    const result = runtime.messages.send(caller, {
      to: input.to,
      text: input.text,
      delivery: input.delivery,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      ...(input.resources === undefined ? {} : { resources: input.resources }),
      ...(input.mentions === undefined ? {} : { mentions: input.mentions }),
    })
    this.pendingAssistantKickoffs.delete(`${record.id}:${String(caller.id)}`)
    // Message events may be persisted before their listeners have reconciled
    // Reply Tasks in every host runtime. Re-run the idempotent reconciliation
    // here so the tool result can immediately provide stable task ids.
    const replyTaskIds = runtime.ensureMessageTasks(runtime.messages.getMessage(caller, result.messageId))
    return {
      ...result,
      ...(replyTaskIds.length === 0 ? {} : { replyTaskIds }),
    }
  }

  sendUserConversationMessage(input: SendFleetConversationMessageInput, caller?: Agent): SendMessageResult {
    const record = this.requireMutableRecord(input.runId)
    const subject = { kind: 'external' as const, id: `fleet-user:${record.id}` }
    this.authorization?.require({
      teamId: record.id,
      subject,
      action: 'message.post',
      resource: { kind: 'conversation', id: input.to },
    })
    if (input.delivery !== 'quiet') this.authorization?.require({
      teamId: record.id,
      subject,
      action: input.delivery === 'interrupt' ? 'message.interrupt' : 'message.wakeup',
      resource: { kind: 'conversation', id: input.to },
    })
    const result = this.collaboration.require(record.id).sendUserMessage({
      to: input.to,
      text: input.text,
      delivery: input.delivery,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      ...(input.resources === undefined ? {} : { resources: input.resources }),
      ...(input.mentions === undefined ? {} : { mentions: input.mentions }),
    })
    this.reconcileOwnerTasks(record.id, caller)
    return result
  }

  uploadResource(caller: Agent, input: UploadFleetResourceInput): FleetResource {
    const record = this.requireMutableRecord(input.runId)
    this.requireFleetPermission(record, caller, 'resource.write')
    const resources = this.requireRuntime(record.id).resources
    const name = input.name.trim()
    if (name.length === 0 || name.length > 255 || basename(name) !== name || name === '.' || name === '..') {
      throw new Error('Fleet upload name must be a plain file name up to 255 characters')
    }
    if (input.base64.length > 35_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) {
      throw new Error('Fleet upload content must be valid base64')
    }
    const content = Buffer.from(input.base64, 'base64')
    if (content.byteLength > 25 * 1024 * 1024) throw new Error('Fleet upload cannot exceed 25 MiB')
    const directory = join(record.projectRoot, '.fleet', record.id)
    mkdirSync(directory, { recursive: true })
    const path = join(directory, name)
    if (existsSync(path)) throw new Error(`Fleet shared file already exists: ${name}`)
    writeFileSync(path, content)
    return resources.addResource(String(caller.id), {
      path,
      label: input.label?.trim() || name,
      ...(input.mediaType === undefined || input.mediaType.trim().length === 0
        ? {}
        : { mediaType: input.mediaType.trim() }),
      size: content.byteLength,
    })
  }

  removeResource(caller: Agent, input: RemoveFleetResourceInput): FleetResource {
    const record = this.requireMutableRecord(input.runId)
    this.requireFleetPermission(record, caller, 'resource.write')
    const resources = this.requireRuntime(record.id).resources
    const resource = resources.getResource(input.resourceId)
    const sharedDirectory = join(record.projectRoot, '.fleet', record.id)
    const resourcePath = resolve(resource.path)
    if (pathInside(sharedDirectory, resourcePath)) {
      if (existsSync(resourcePath)) unlinkSync(resourcePath)
      this.sharedFileVersions.get(record.id)?.delete(relative(sharedDirectory, resourcePath).split(sep).join('/'))
    }
    return resources.removeResource(String(caller.id), resource.id) ?? resource
  }

  async wait(
    runId: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
    projectRoot?: string,
  ): Promise<FleetRunRecord> {
    const record = this.requireRecord(runId, projectRoot)
    if (record.status === 'idle') return this.describeRecord(record)
    if (isTerminal(record.status)) {
      const finalization = this.finalizations.get(record.id)
      if (finalization !== undefined) await finalization
      const current = this.requireRecord(record.id, projectRoot)
      return current.settled
        ? this.describeRecord(current)
        : this.settleInterruptedTerminal(current)
    }
    if (signal?.aborted === true) throw signal.reason ?? new Error('fleet_run wait aborted')
    return new Promise<FleetRunRecord>((resolvePromise, rejectPromise) => {
      let settled = false
      const settle = (operation: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.waiters.delete(waiter)
        operation()
      }
      const waiter: RunWaiter = {
        runId: record.id,
        finish: value => { settle(() => { resolvePromise(this.describeRecord(value)) }) },
        fail: error => { settle(() => { rejectPromise(error) }) },
      }
      const onAbort = (): void => { waiter.fail(signal?.reason ?? new Error('fleet_run wait aborted')) }
      const timer = setTimeout(() => { waiter.finish(this.requireRecord(record.id, projectRoot)) }, timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.add(waiter)
    })
  }

  finish(
    caller: Agent,
    status: Exclude<FleetWorkStatus, 'running'>,
    summary: string,
    runId?: string,
  ): FleetRunRecord {
    const record = this.requireCallerRecord(caller, runId)
    this.requireLifecycleControl(record, caller)
    return this.finishWork(record, status, summary, String(caller.id))
  }

  private finishWork(
    record: FleetRunRecord,
    status: Exclude<FleetWorkStatus, 'running'>,
    summary: string,
    callerId: string,
  ): FleetRunRecord {
    const runtime = this.requireRuntime(record.id)
    if (record.status !== 'running' || record.work === undefined) {
      throw new Error(`Fleet team ${record.id} has no active work to finish`)
    }
    const terminalSummary = summary.trim()
    if (terminalSummary.length === 0) throw new Error('Fleet work terminal summary cannot be empty')
    this.clearRunNetworkRecoveries(record.id)
    for (const member of record.members) {
      try {
        this.core.cancelManaged(this.runtimeMemberName(record.id, member.name), callerId)
      } catch (error) {
        if (!errorMessage(error).includes('unknown Fleet Agent')) throw error
      }
      try {
        this.core.clearManagedInbox(this.runtimeMemberName(record.id, member.name))
      } catch (error) {
        if (!errorMessage(error).includes('unknown Fleet Agent')) throw error
      }
      runtime.resources.release(member.sessionId)
    }
    const finishing = this.replaceRecord(record.id, {
      status: 'finishing',
      work: {
        ...record.work,
        status,
        endedAt: new Date().toISOString(),
        summary: terminalSummary,
      },
    })
    this.appendEvent(record.id, 'work_status', {
      workId: record.work.id,
      status,
      summary: terminalSummary,
      callerId,
    })
    void this.settleFinishedWork(finishing)
    return this.describeRecord(finishing)
  }

  end(caller: Agent, summary: string, runId?: string): FleetRunRecord {
    const record = this.requireCallerRecord(caller, runId)
    this.requireLifecycleControl(record, caller)
    return this.setTerminal(record.id, summary, String(caller.id))
  }

  recordCoordination(runId: string, event: FleetCoordinationEvent): void {
    const record = this.records.get(runId)
    const runtime = this.collaboration.get(runId)
    if (record === undefined || runtime === undefined) return
    this.appendEvent(record.id, `coordination.${event.type}`, event)
    if (event.type === 'message') {
      const sender = this.participants(record).find(participant =>
        participant.name === event.message.from || participant.sessionId === event.message.from)
      const agent = sender === undefined ? undefined : this.ctx.agents.get(SessionId(sender.sessionId))
      const turn = agent === undefined ? undefined : this.currentOpenTurn(agent)
      if (sender !== undefined && turn !== undefined) {
        this.memberLastSharedTurns.set(sender.sessionId, turn)
      }
      const recipientIds = event.message.recipientIds ?? []
      queueMicrotask(() => {
        const current = this.records.get(runId)
        if (current === undefined) return
        for (const participant of this.participants(current)) {
          if (!recipientIds.includes(participant.name)) continue
          const agent = this.ctx.agents.get(SessionId(participant.sessionId))
          if (agent?.status === 'idle') this.agentIdle(agent)
        }
      })
    }
  }

  recordResource(runId: string, event: FleetResourceEvent): void {
    if (!this.collaboration.has(runId)) return
    const record = this.requireRecord(runId)
    const actorName = (actorId: string): string => this.participants(record)
      .find(participant => participant.sessionId === actorId)?.name ?? actorId
    if (event.type === 'resource_added') {
      this.appendEvent(runId, 'resource.resource_added', event)
      return
    }
    if (event.type === 'resource_removed') {
      this.appendEvent(runId, 'resource.resource_removed', {
        ...event,
        removal: { ...event.removal, removedBy: actorName(event.removal.removedBy) },
      })
      return
    }
    if (event.type === 'resource_revised') {
      const revision = { ...event.revision, updatedBy: actorName(event.revision.updatedBy) }
      const beforeBytes = revision.before === null ? 0 : Buffer.byteLength(revision.before, 'utf8')
      const afterBytes = Buffer.byteLength(revision.after, 'utf8')
      const size = beforeBytes + afterBytes
      const available = size <= RESOURCE_REVISION_MAX_BYTES
      if (available) {
        const directory = join(this.runDirectory(record), 'resource-revisions')
        mkdirSync(directory, { recursive: true })
        const target = join(directory, `${revision.id}.json`)
        const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`
        writeFileSync(temporary, JSON.stringify(revision), 'utf8')
        renameSync(temporary, target)
      }
      appendFileSync(
        join(this.runDirectory(record), 'resource-history.jsonl'),
        `${JSON.stringify({
          id: revision.id,
          resourceId: revision.resourceId,
          updatedBy: revision.updatedBy,
          updatedAt: revision.updatedAt,
          operation: revision.before === null ? 'created' : 'updated',
          available,
          size,
        })}\n`,
        'utf8',
      )
      this.appendEvent(runId, 'resource.resource_revised', {
        type: event.type,
        revision: {
          id: revision.id,
          resourceId: revision.resourceId,
          updatedBy: revision.updatedBy,
          updatedAt: revision.updatedAt,
          available,
          size,
        },
      })
      return
    }
    this.appendEvent(runId, `resource.${event.type}`, event)
  }

  recordDataEvent(
    runId: string,
    type:
      | `resource.document_${'created' | 'updated' | 'commented' | 'resolved' | 'reverted'}`
      | `workspace.${'attached' | 'detached' | 'assigned'}`
      | `memory.${'stored' | 'recalled'}`,
    data: unknown,
  ): void {
    this.appendEvent(runId, type, data)
  }

  participantSessionIds(runId: string, participant: string): string[] {
    const record = this.requireRecord(runId)
    return this.participantSessionIdsForRecord(record, participant)
  }

  async searchParticipantMessages(
    runId: string,
    participant: string,
    query: string,
    limit: number,
  ): Promise<FleetMessage[]> {
    const record = this.requireRecord(runId)
    const binding = this.participants(record).find(candidate => candidate.name === participant)
    if (binding === undefined) throw new Error(`unknown Fleet participant ${participant}`)
    const result = await this.searchTeamHistory(record.id, {
      query,
      types: ['coordination.message'],
      visibleToSessionId: binding.sessionId,
      limit,
    })
    return result.events.flatMap(event => {
      if (event.type !== 'coordination.message') return []
      const coordination = event.data as Extract<FleetCoordinationEvent, { type: 'message' }>
      return coordination.message.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())
        ? [coordination.message]
        : []
    })
  }

  private clearMemberActivity(sessionId: string): void {
    const activity = this.memberToolActivity.get(sessionId)
    if (activity?.timer !== undefined) clearTimeout(activity.timer)
    this.memberToolActivity.delete(sessionId)
    this.waitingSessionIds.delete(sessionId)
  }

  private refreshMemberActivity(sessionId: string): void {
    const activity = this.memberToolActivity.get(sessionId)
    if (activity === undefined) return
    if (activity.timer !== undefined) clearTimeout(activity.timer)
    activity.timer = undefined
    if (activity.calls.size === 0) {
      this.clearMemberActivity(sessionId)
      return
    }
    const explicitWait = [...activity.calls.values()].every(call => call.explicitWait)
    const delay = explicitWait ? EXPLICIT_WAIT_DELAY_MS : QUIET_TOOL_WAIT_DELAY_MS
    const remaining = activity.lastInteractionAt + delay - Date.now()
    if (remaining <= 0) {
      this.waitingSessionIds.add(sessionId)
      return
    }
    this.waitingSessionIds.delete(sessionId)
    activity.timer = setTimeout(() => { this.refreshMemberActivity(sessionId) }, remaining)
  }

  private recordMemberActivity(sessionId: string, event: SessionEvent): void {
    let activity = this.memberToolActivity.get(sessionId)
    if (event.type === 'tool/call') {
      activity ??= { calls: new Map(), lastInteractionAt: Date.now(), timer: undefined }
      activity.calls.set(String(event.data.callId), {
        explicitWait: isExplicitWaitCall(event.data.name, event.data.arguments),
      })
      this.memberToolActivity.set(sessionId, activity)
    }
    if (activity === undefined) return
    activity.lastInteractionAt = Date.now()
    if (event.type === 'tool/result') activity.calls.delete(String(event.data.message.source.callId))
    if (event.type === 'step/end' || event.type === 'turn/end') activity.calls.clear()
    this.refreshMemberActivity(sessionId)
  }

  private recordMemberHealth(sessionId: string, event: SessionEvent): void {
    if (event.type === 'turn/start') this.abnormalSessionIds.delete(sessionId)
    if (event.type !== 'turn/end') return
    if (event.data.reason.kind === 'error') this.abnormalSessionIds.add(sessionId)
    else this.abnormalSessionIds.delete(sessionId)
  }

  private currentOpenTurn(agent: Agent): number | undefined {
    for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
      const event = agent.session.events[index]
      if (event?.type === 'turn/end') return undefined
      if (event?.type === 'turn/start') return event.data.turn
    }
    return undefined
  }

  private reminderHistory(sessionId: string, slot: FleetTurnReminderSlot): Map<string, number> {
    let session = this.turnReminderLastShown.get(sessionId)
    if (session === undefined) {
      session = new Map()
      this.turnReminderLastShown.set(sessionId, session)
    }
    let history = session.get(slot)
    if (history === undefined) {
      history = new Map()
      session.set(slot, history)
    }
    return history
  }

  private selectTurnReminderText(
    agent: Agent,
    slot: FleetTurnReminderSlot,
    turn: number,
    text: string,
    tools: readonly string[],
    tags: readonly string[],
  ): string | undefined {
    const rules = this.turnReminders[slot]
    if (rules.length === 0) return undefined
    const sessionId = String(agent.id)
    const entry = this.collaboration.entries().find(([runId, runtime]) =>
      this.records.has(runId) && !this.dormantRunIds.has(runId) && runtime.memberNamesById.has(sessionId))
    if (entry === undefined) return undefined
    const [teamId, runtime] = entry
    const member = runtime.memberNamesById.get(sessionId)
    const view = this.memberViewForAgent(teamId, sessionId)
    if (member === undefined || view === undefined) return undefined
    const inferredLocales = inferFleetReminderLocales(text)
    const locales = this.userLocale === undefined
      ? inferredLocales
      : [this.userLocale, ...inferredLocales.filter(locale => locale !== this.userLocale)]
    const history = this.reminderHistory(sessionId, slot)
    const selection = selectFleetTurnReminder(rules, {
      slot,
      teamId,
      memberId: view.id,
      displayName: view.name,
      role: view.role,
      ...(view.responsibility === undefined ? {} : { responsibility: view.responsibility }),
      turn,
      text,
      tools,
      taskKinds: [...new Set(runtime.tasks.ownerTasks(member).map(task => task.domain.kind))],
      tags,
      locales,
    }, history)
    if (selection === undefined) return undefined
    history.set(selection.rule.id, turn)
    const selectedLocale = locales[0] ?? 'en'
    const language = selectedLocale.toLocaleLowerCase().startsWith('zh') ? '中文' : 'English'
    return fleetTurnReminderText(selection.rule, locales, {
      name: view.name,
      role: view.role,
      responsibility: view.responsibility ?? view.role,
      language,
    })
  }

  private recentTurnReminderTools(agent: Agent, turn: number): string[] {
    const tools: string[] = []
    for (let index = agent.session.events.length - 1; index >= 0 && tools.length < 8; index -= 1) {
      const event = agent.session.events[index]
      if (event?.type === 'turn/start' && event.data.turn < turn - 2) break
      if (event?.type === 'tool/call' && !tools.includes(event.data.name)) tools.push(event.data.name)
    }
    return tools
  }

  private appendTurnReminder(
    decision: Exclude<PreStepDecision, { readonly kind: 'reject' }>,
    slot: FleetTurnReminderSlot,
    text: string,
  ): PreStepDecision {
    return {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text }],
        source: {
          kind: 'plugin',
          plugin: 'dsh-agent-fleet',
          form: 'snapshot',
          sections: [{ name: `system-reminder:${slot}`, text }],
        },
      })],
    }
  }

  private turnStartReminderDecision(
    agent: Agent,
    decision: Exclude<PreStepDecision, { readonly kind: 'reject' }>,
  ): PreStepDecision {
    if (this.turnReminders['turn-start'].length === 0) return decision
    const sessionId = String(agent.id)
    const turn = this.currentOpenTurn(agent)
    if (turn === undefined || this.turnStartReminderTurns.get(sessionId) === turn) return decision
    this.turnStartReminderTurns.set(sessionId, turn)
    for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
      const event = agent.session.events[index]
      if (event?.type === 'turn/start') break
      if (event?.type === 'tool/call' || event?.type === 'tool/result' || event?.type === 'assistant/message') {
        return decision
      }
    }
    const contextText = decision.messages.map(progressMessageText).join('\n')
    const reminder = this.selectTurnReminderText(
      agent, 'turn-start', turn, contextText, this.recentTurnReminderTools(agent, turn), [],
    )
    return reminder === undefined ? decision : this.appendTurnReminder(decision, 'turn-start', reminder)
  }

  private toolResultReminderDecision(
    agent: Agent,
    decision: Exclude<PreStepDecision, { readonly kind: 'reject' }>,
  ): PreStepDecision {
    if (this.turnReminders['tool-result'].length === 0) return decision
    const sessionId = String(agent.id)
    const turn = this.currentOpenTurn(agent)
    if (turn === undefined) return decision
    const previousSequence = this.toolResultReminderSequences.get(sessionId) ?? -1
    const callNames = new Map<string, string>()
    const results: Array<{ readonly sequence: number; readonly callId: string; readonly text: string }> = []
    for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
      const event = agent.session.events[index]
      if (event?.type === 'turn/start') break
      if (event?.type === 'tool/call') callNames.set(String(event.data.callId), event.data.name)
      if (event?.type !== 'tool/result' || event.seq <= previousSequence) continue
      results.push({
        sequence: event.seq,
        callId: String(event.data.message.source.callId),
        text: progressMessageText(event.data.message),
      })
    }
    if (results.length === 0) return decision
    this.toolResultReminderSequences.set(sessionId, Math.max(...results.map(result => result.sequence)))
    const tools = [...new Set([
      ...results.map(result => callNames.get(result.callId)).filter((name): name is string => name !== undefined),
      ...this.recentTurnReminderTools(agent, turn),
    ])]
    const contextText = [
      ...results.sort((left, right) => left.sequence - right.sequence).map(result => result.text),
      ...decision.messages.map(progressMessageText),
    ].join('\n')
    const reminder = this.selectTurnReminderText(agent, 'tool-result', turn, contextText, tools, [])
    return reminder === undefined ? decision : this.appendTurnReminder(decision, 'tool-result', reminder)
  }

  private preStepReminderDecision(agent: Agent, decision: PreStepDecision): PreStepDecision {
    if (decision.kind === 'reject') return decision
    const withTurnStart = this.turnStartReminderDecision(agent, decision)
    if (withTurnStart.kind === 'reject') return withTurnStart
    return this.toolResultReminderDecision(agent, withTurnStart)
  }

  private turnHasDirectOutput(agent: Agent, turn: number): boolean {
    for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
      const event = agent.session.events[index]
      if (event?.type === 'turn/start' && event.data.turn < turn) break
      if (event?.type !== 'assistant/message'
        || event.data.turn !== turn
        || event.data.interrupted === true) continue
      if (progressMessageText(event.data).trim().length > 0) return true
    }
    return false
  }

  private turnDirectOutputText(agent: Agent, turn: number): string {
    const output: string[] = []
    for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
      const event = agent.session.events[index]
      if (event?.type === 'turn/start' && event.data.turn < turn) break
      if (event?.type !== 'assistant/message'
        || event.data.turn !== turn
        || event.data.interrupted === true) continue
      const text = progressMessageText(event.data).trim()
      if (text.length > 0) output.unshift(text)
    }
    return output.join('\n')
  }

  private visibilityReminderState(sessionId: string): VisibilityReminderState {
    const existing = this.visibilityReminderStates.get(sessionId)
    if (existing !== undefined) return existing
    const created: VisibilityReminderState = {
      latestContextTokens: 0,
      baselineContextTokens: undefined,
      awaitingPostCompactionBaseline: false,
      reminderCount: 0,
      detailedReminderSent: false,
    }
    this.visibilityReminderStates.set(sessionId, created)
    return created
  }

  private memberTurnStopping(agent: Agent, turn: number): void {
    const sessionId = String(agent.id)
    if (this.memberVisibilityReviewedTurns.get(sessionId) === turn) return
    const entry = this.collaboration.entries().find(([runId, runtime]) =>
      runtime.memberNamesById.has(sessionId) && !this.dormantRunIds.has(runId))
    if (entry === undefined) return
    const [runId, runtime] = entry
    const record = this.records.get(runId)
    const member = runtime.memberNamesById.get(sessionId)
    if (record === undefined || member === undefined) return
    const formalMember = record.members.some(candidate => candidate.name === member)
    const foregroundAssistant = record.assistants.some(candidate => candidate.view.id === member)
    if (!formalMember && !foregroundAssistant) return
    this.memberVisibilityReviewedTurns.set(sessionId, turn)
    if (!this.turnHasDirectOutput(agent, turn)) return
    const reminder = this.visibilityReminderState(sessionId)
    if (this.memberLastSharedTurns.get(sessionId) === turn) {
      reminder.baselineContextTokens = reminder.latestContextTokens
      reminder.awaitingPostCompactionBaseline = false
      return
    }
    const message = parseFleetMessageConfiguration(this.moduleConfiguration(record.id, FLEET_MESSAGE_MODULE))
    const threshold = message.visibilityReminderContextGrowthTokens
    if (threshold === 0) return
    if (reminder.baselineContextTokens === undefined || reminder.awaitingPostCompactionBaseline) {
      reminder.baselineContextTokens = reminder.latestContextTokens
      reminder.awaitingPostCompactionBaseline = false
      return
    }
    const multiplier = 2 ** Math.min(reminder.reminderCount, 20)
    const interval = Math.min(Number.MAX_SAFE_INTEGER, threshold * multiplier)
    const growth = reminder.latestContextTokens - reminder.baselineContextTokens
    if (growth < interval) return
    const detailed = !reminder.detailedReminderSent
    const userFacingTurn = this.assistantUserFacingTurns.get(sessionId)?.turn === turn
    const reminderText = this.selectTurnReminderText(
      agent,
      'turn-end',
      turn,
      this.turnDirectOutputText(agent, turn),
      this.recentTurnReminderTools(agent, turn),
      [
        foregroundAssistant ? 'foreground-assistant' : 'formal-member',
        detailed ? 'detailed' : 'brief',
        ...(foregroundAssistant ? [userFacingTurn ? 'user-facing' : 'background'] : []),
      ],
    )
    if (reminderText === undefined) return
    runtime.messages.sendSystemNotification(sessionId, {
      kind: 'visibility_reminder',
      text: reminderText,
      // A visibility reminder must never create another model turn merely to
      // acknowledge the reminder. It becomes context for the next organic turn.
      delivery: 'quiet',
      coalesceKey: `visibility-reminder:${sessionId}`,
    })
    reminder.baselineContextTokens = reminder.latestContextTokens
    reminder.awaitingPostCompactionBaseline = false
    reminder.reminderCount += 1
    reminder.detailedReminderSent = true
  }

  recordMemberSessionEvent(sessionId: string, event: SessionEvent): void {
    if (event.type === 'session/end-seed') return
    const entry = this.collaboration.entries().find(([runId, runtime]) =>
      runtime.memberNamesById.has(sessionId)
      && (!this.dormantRunIds.has(runId)
        || this.records.get(runId)?.assistants.some(assistant => assistant.sessionId === sessionId) === true),
    )
    if (entry === undefined) return
    const [runId, runtime] = entry
    const member = runtime.memberNamesById.get(sessionId)
    const record = this.records.get(runId)
    if (member === undefined || record === undefined) return
    if (event.type === 'turn/start' && record.members.some(candidate => candidate.name === member)) {
      this.manualWakeRequiredRunIds.delete(runId)
    }
    const agent = this.ctx.agents.get(SessionId(sessionId))
    this.recordMemberActivity(sessionId, event)
    this.recordMemberHealth(sessionId, event)
    this.recordBudgetUsage(record, member, event)
    const validProtocolOutput = (event.type === 'assistant/message'
      && event.data.interrupted !== true
      && progressMessageText(event.data).trim().length > 0)
      || event.type === 'tool/call'
    if (validProtocolOutput) {
      const recovery = this.protocolRecoveries.get(sessionId)
      if (recovery !== undefined) {
        this.protocolRecoveries.delete(sessionId)
        this.appendEvent(runId, 'member_protocol_recovery_reset', {
          member,
          sessionId,
          previousAttempts: recovery.attempt,
          reason: event.type === 'tool/call' ? 'valid_tool_call' : 'valid_assistant_output',
        })
      }
    }
    if (event.type === 'assistant/message') {
      const tokens = inputContextTokens(event.data.usage)
      if (tokens !== undefined) {
        const reminder = this.visibilityReminderState(sessionId)
        reminder.latestContextTokens = Math.max(reminder.latestContextTokens, tokens)
        if (reminder.baselineContextTokens === undefined) {
          reminder.baselineContextTokens = reminder.latestContextTokens
          reminder.awaitingPostCompactionBaseline = false
        }
      }
    }
    if (event.type === 'compaction/summary' || event.type === 'compaction/prune') {
      const reminder = this.visibilityReminderState(sessionId)
      reminder.latestContextTokens = 0
      reminder.baselineContextTokens = undefined
      reminder.awaitingPostCompactionBaseline = true
      reminder.reminderCount = 0
      reminder.detailedReminderSent = false
    }
    const foregroundAssistant = record.assistants.some(assistant => assistant.view.id === member)
    if (foregroundAssistant && event.type === 'turn/start') {
      this.assistantCurrentTurns.set(sessionId, event.data.turn)
      this.assistantUserFacingTurns.delete(sessionId)
      this.assistantTurnOutputs.delete(sessionId)
      const interaction = runtime.tasks.interactionTask(member)
      if (interaction?.domain.kind === 'interaction' && interaction.domain.pendingDelivery !== undefined) {
        this.assistantUserFacingTurns.set(sessionId, { turn: event.data.turn, source: 'delivery' })
      }
    }
    if (event.type === 'user/message' && event.data.source?.kind === 'user') {
      this.protocolRecoveries.delete(sessionId)
      if (foregroundAssistant) {
        if (agent !== undefined) this.assistantNativeToolRestrictions.get(agent)?.tighten()
        this.assistantTurnOutputs.delete(sessionId)
        const turn = this.assistantCurrentTurns.get(sessionId)
        if (turn !== undefined) this.assistantUserFacingTurns.set(sessionId, { turn, source: 'direct' })
        const previous = runtime.tasks.interactionTask(member)
        runtime.tasks.recordInteractionInput(member, {
          messageId: String(event.data.id),
          text: progressMessageText(event.data),
        })
        if (previous?.domain.kind !== 'interaction'
          || previous.domain.latestMessageId !== String(event.data.id)) {
          this.armAssistantQuiescence(runId, member)
        }
      }
    }
    if (foregroundAssistant && event.type === 'assistant/message' && event.data.interrupted !== true) {
      const output = progressMessageText(event.data)
      if (output.trim().length > 0) this.assistantTurnOutputs.set(sessionId, output)
    }
    if (event.type === 'assistant/chunk') return
    for (const listener of [...this.traceChangeListeners]) listener(runId, member)
    if (event.type !== 'turn/end') return
    const reason = event.data.reason
    if (foregroundAssistant
      && reason.kind === 'completed'
      && this.assistantUserFacingTurns.get(sessionId)?.turn === event.data.turn) {
      const output = this.assistantTurnOutputs.get(sessionId)
      const source = this.assistantUserFacingTurns.get(sessionId)?.source
      if (output !== undefined) {
        const committed = runtime.tasks.commitInteractionOutput(member, output)
        if (committed === undefined && source === 'direct') {
          runtime.tasks.settleDirectInteractionOutput(member, output)
        }
      }
    }
    this.assistantTurnOutputs.delete(sessionId)
    this.assistantCurrentTurns.delete(sessionId)
    this.assistantUserFacingTurns.delete(sessionId)
    if (reason.kind === 'error' && NETWORK_FAILURE_CODES.has(reason.error.code)) {
      if (agent !== undefined) this.scheduleNetworkRecovery(runId, member, agent, reason.error.code)
      return
    }
    runtime.tasks.releaseRunning(member, reason.kind === 'error'
      ? `turn failed with ${reason.error.code}`
      : `turn ended with ${reason.kind} before fleet_reconcile resolve`)
    if (reason.kind === 'error' && isRetriableProtocolFailure(reason.error) && agent !== undefined) {
      if (this.scheduleProtocolRecovery(runId, member, agent, reason.error.message)) return
    } else if (reason.kind === 'error') {
      this.protocolRecoveries.delete(sessionId)
    }
    if (reason.kind === 'error') {
      this.appendEvent(runId, 'member_auto_continuation_paused', {
        member,
        sessionId,
        code: reason.error.code,
        reason: clippedProgressText(reason.error.message, 1_000),
      })
    } else {
      this.protocolRecoveries.delete(sessionId)
    }
    const route = agent === undefined ? undefined : this.networkRoute(agent)
    this.clearNetworkRecovery(sessionId)
    if (route !== undefined && (reason.kind === 'completed' || reason.kind === 'max-tokens')) {
      this.wakeNetworkRecoveriesForRoute(runId, route, sessionId)
    }
    const continued = agent !== undefined && (
      this.continueAssignedTask(runId, runtime, record, agent)
      || this.continueOwnedTasks(runId, runtime, record, agent)
    )
    if (!continued) queueMicrotask(() => { this.signalAssistantInteractionDeliveries(runId) })
  }

  private autoContinuationPaused(record: FleetRunRecord, participant: string): boolean {
    if (record.status === 'paused' || this.pausingTeams.has(record.id)) return true
    if (this.pausingMembers.has(`${record.id}:${participant}`)) return true
    const member = record.members.find(candidate => candidate.name === participant)
    if (member !== undefined) return member.status === 'paused' || member.status === 'offline'
    return record.assistants.find(candidate => candidate.view.id === participant)?.status === 'paused'
  }

  private continueAssignedTask(
    runId: string,
    runtime: FleetCollaborationTeam,
    record: FleetRunRecord,
    agent: Agent,
  ): boolean {
    if (record.status === 'paused' || record.status === 'starting' || record.status === 'finishing'
      || record.status === 'closed' || record.status === 'failed') return false
    const participant = this.participants(record)
      .find(candidate => candidate.sessionId === String(agent.id))
    if (participant === undefined
      || this.autoContinuationPaused(record, participant.name)
      || this.abnormalSessionIds.has(participant.sessionId)
      || this.budgetRemaining(record, participant.name).exhaustedScope !== undefined) return false
    if (runtime.tasks.runningFor(participant.name).length > 0) return false
    const pending = runtime.tasks.readyTasks(participant.name)[0]
    if (pending === undefined) return false
    const readyReason = pending.activeReconcile?.reason ?? 'Task is ready for reconciliation.'
    const task = runtime.tasks.claim(participant.sessionId, pending.id)
    const reconcile = task.activeReconcile
    if (reconcile?.status !== 'running' || reconcile.attemptId === undefined) return false
    runtime.messages.sendSystemNotification(participant.sessionId, {
      kind: 'task_notice',
      text: [
        `[Fleet task attempt] ${task.title} (${task.id})`,
        `Current ReconcileAttempt: ${reconcile.attemptId}${reconcile.timeoutAt === undefined ? '' : ` (timeout ${reconcile.timeoutAt})`}.`,
        'Fleet already claimed this ReconcileAttempt for the current turn. Do not call fleet_reconcile claim.',
        task.description,
        readyReason,
        `Work only this ReconcileAttempt. Inspect every current cohort result before deciding. Before the turn ends, call fleet_reconcile action="resolve", id="${task.id}", attempt_id="${reconcile.attemptId}", progress="...", and outcome="continue|complete|block|pause|cancel". The id is the Task id, not the attempt or reconciler id. Use continue only with atomic child_ops; Goal/Vote operations may use keys and later operations may depend on earlier keys. Fleet derives the cohort and next trigger. A terminal acceptance Vote is already final; do not invent remediation unless explicitly requested as new work.`,
      ].filter(Boolean).join('\n\n'),
      delivery: 'wakeup',
      coalesceKey: `assigned-task:${task.id}`,
    })
    this.appendEvent(runId, 'member_continued', {
      member: participant.name,
      reason: 'assigned_task',
      tasks: [task.id],
      attempt: reconcile.attemptId,
    })
    return true
  }

  private continueOwnedTasks(
    runId: string,
    runtime: FleetCollaborationTeam,
    record: FleetRunRecord,
    agent: Agent,
  ): boolean {
    if (record.status === 'paused' || record.status === 'starting' || record.status === 'finishing'
      || record.status === 'closed' || record.status === 'failed') return false
    const participant = this.participants(record)
      .find(candidate => candidate.sessionId === String(agent.id))
    if (participant === undefined
      || this.autoContinuationPaused(record, participant.name)
      || this.abnormalSessionIds.has(participant.sessionId)
      || this.budgetRemaining(record, participant.name).exhaustedScope !== undefined) return false
    const tasks = runtime.tasks.ownerTasks(participant.name)
    if (tasks.length === 0) return false
    const taskInstruction = (task: (typeof tasks)[number]): string => {
      if (task.domain.kind === 'inbox') return `- ${task.title} (${task.id}): call fleet_inbox action="read" to consume unread messages.`
      if (task.domain.kind === 'reply') return `- ${task.title} (${task.id}): respond exactly once with fleet_reply and the actual answer. That reply is the visible conversation message; do not send the same answer first with fleet_send. Read the source with fleet_inbox only if needed.`
      if (task.domain.kind === 'goal') return `- ${task.title} (${task.id}): call fleet_goal action="complete" with the assignment result (including a reject recommendation), or "block" only for an external impediment.`
      if (task.domain.kind === 'interaction') {
        const delivery = task.domain.pendingDelivery
        const deliveryText = delivery === undefined
          ? ''
          : ` Persistent completion Delivery ${delivery.id} (${delivery.cause}) for revision ${String(delivery.revision)}: ${delivery.summary} Linked results: ${delivery.tasks.map(item => `${item.title} (${item.id})=${item.state}: ${item.result ?? item.reason}`).join('; ') || 'none'}.`
        const quiescentExit = delivery?.cause === 'team_quiescent'
          ? ' If the Team cannot resume the live work, call action="block" now; this recovery path cancels only Goals created by this Interaction and detaches external linked Tasks. Do not call fleet_reconcile unless a ready ReconcileAttempt is explicitly present.'
          : ''
        return `- ${task.title} (${task.id}): inspect the latest user intent with fleet_user_task action="status".${deliveryText}${quiescentExit} If already-linked Team work remains live and can resume, call action="continue" with only a reason to reinstall that wait; add a live formal-member task id or concrete Goal handoff only for new work. If the foreground response settles the request, call action="report" or "block" before emitting that native response; the Delivery is consumed only after non-empty native output.`
      }
      if (task.domain.kind === 'vote') return `- ${task.title} (${task.id}): call fleet_vote action="cast" with this id, a decision, and a reason.`
      return `- ${task.title} (${task.id}): inspect it with fleet_task action="get".`
    }
    try {
      runtime.messages.sendSystemNotification(participant.sessionId, {
        kind: 'task_notice',
        text: [
          '[Fleet owner task list]',
          'Your running owner Tasks:',
          ...tasks.map(taskInstruction),
          'Use fleet_task action="owner_list" to inspect the complete Task records. Domain tools record your intent or receipt and atomically derive the next Task state.',
          'While this Session remains healthy, the non-empty list wakes you again until every owned item is consumed or leaves running.',
        ].join('\n'),
        delivery: 'wakeup',
        coalesceKey: `owner-task-list:${participant.name}`,
      })
    } catch (error) {
      if (errorMessage(error).includes('is not available to Fleet')) return false
      throw error
    }
    this.appendEvent(runId, 'member_continued', {
      member: participant.name,
      reason: 'owner_task_list',
      tasks: tasks.map(task => task.id),
    })
    return true
  }

  private reconcileReadyTasks(runId: string): void {
    const record = this.records.get(runId)
    if (record === undefined || record.status === 'paused' || record.status === 'starting'
      || record.status === 'finishing' || record.status === 'closed' || record.status === 'failed'
      || this.dormantRunIds.has(runId)) return
    const runtime = this.collaboration.get(runId)
    if (runtime === undefined) return
    for (const participant of this.participants(record)) {
      if (this.autoContinuationPaused(record, participant.name)
        || this.budgetRemaining(record, participant.name).exhaustedScope !== undefined
        || this.abnormalSessionIds.has(participant.sessionId)
        || this.networkRecoveries.has(participant.sessionId)
        || runtime.tasks.runningFor(participant.name).length > 0
        || runtime.tasks.readyTasks(participant.name).length === 0) continue
      const agent = this.ctx.agents.get(SessionId(participant.sessionId))
      if (agent?.status !== 'idle') continue
      this.continueAssignedTask(runId, runtime, record, agent)
    }
  }

  private reconcileOwnerTasks(runId: string, preferredCaller?: Agent): void {
    const record = this.records.get(runId)
    if (record === undefined || record.status === 'paused' || record.status === 'starting'
      || record.status === 'finishing' || record.status === 'closed' || record.status === 'failed') return
    const runtime = this.collaboration.get(runId)
    if (runtime === undefined) return
    for (const participant of this.participants(record)) {
      if (this.autoContinuationPaused(record, participant.name)
        || this.budgetRemaining(record, participant.name).exhaustedScope !== undefined
        || this.abnormalSessionIds.has(participant.sessionId)
        || this.networkRecoveries.has(participant.sessionId)
        || runtime.tasks.runningFor(participant.name).length > 0
        || runtime.tasks.readyTasks(participant.name).length > 0
        || runtime.tasks.ownerTasks(participant.name).length === 0) continue
      const agent = this.ctx.agents.get(SessionId(participant.sessionId))
      if (agent?.status === 'idle') {
        this.continueOwnedTasks(runId, runtime, record, agent)
        continue
      }
      if (agent === undefined && record.members.some(member => member.name === participant.name)) {
        this.resumeOwnerMember(record, runtime, participant.name, preferredCaller)
      }
    }
  }

  private resumeOwnerMember(
    record: FleetRunRecord,
    runtime: FleetCollaborationTeam,
    memberName: string,
    preferredCaller?: Agent,
  ): void {
    const key = `${record.id}:${memberName}`
    if (this.ownerMemberResumes.has(key)) return
    const caller = preferredCaller ?? [
      ...record.assistants.map(assistant => assistant.sessionId),
      ...record.members.map(member => member.sessionId),
    ].map(sessionId => this.ctx.agents.get(SessionId(sessionId))).find((agent): agent is Agent => agent !== undefined)
    if (caller === undefined) return
    const operation = this.resumeMemberNow(caller, record, memberName)
      .then(member => {
        const agent = this.ctx.agents.get(SessionId(member.sessionId))
        const current = this.records.get(record.id)
        if (agent?.status === 'idle' && current !== undefined) {
          this.continueOwnedTasks(record.id, runtime, current, agent)
        }
      })
      .catch((error: unknown) => {
        this.ctx.logger('dsh-agent-fleet').warn(
          `Could not resume Fleet owner ${memberName} in Team ${record.id}: ${errorMessage(error)}`,
        )
      })
      .finally(() => { this.ownerMemberResumes.delete(key) })
    this.ownerMemberResumes.set(key, operation)
  }

  private teamIsQuiescent(record: FleetRunRecord): boolean {
    if (record.status !== 'idle' && record.status !== 'running') return false
    return record.members.length > 0 && record.members.every(member =>
      member.status !== 'paused'
      && member.status !== 'offline'
      && !this.networkRecoveries.has(member.sessionId)
      && this.ctx.agents.get(SessionId(member.sessionId))?.status === 'idle',
    )
  }

  private workRelatedTasks(runtime: FleetCollaborationTeam, rootTaskId: string): FleetProjectTask[] {
    const tasks = runtime.tasks.state().tasks
    const related = new Set([rootTaskId])
    let changed = true
    while (changed) {
      changed = false
      for (const task of tasks) {
        if (task.parentId !== undefined && related.has(task.parentId) && !related.has(task.id)) {
          related.add(task.id)
          changed = true
        }
        if (!related.has(task.id)) continue
        for (const dependency of task.dependencies) {
          if (related.has(dependency)) continue
          related.add(dependency)
          changed = true
        }
      }
    }
    return tasks.filter(task => related.has(task.id))
  }

  private workTasksAreSettled(tasks: readonly FleetProjectTask[], rootTaskId: string): boolean {
    return tasks.every(task => task.id === rootTaskId
      || task.stableState.kind === 'completed'
      || task.stableState.kind === 'blocked'
      || task.stableState.kind === 'cancelled')
  }

  private workMembersAreIdle(record: FleetRunRecord, tasks: readonly FleetProjectTask[]): boolean {
    const formalMembers = new Set(record.members.map(member => member.name))
    const owners = new Set(tasks.flatMap(task => [
      ...task.owners.map(owner => owner.member),
      ...task.assignees,
    ]).filter(member => formalMembers.has(member)))
    return [...owners].every(owner => {
      const member = record.members.find(candidate => candidate.name === owner)
      return member !== undefined && this.ctx.agents.get(SessionId(member.sessionId))?.status !== 'running'
    })
  }

  private finishReadyWork(runId: string): void {
    const record = this.records.get(runId)
    const runtime = this.collaboration.get(runId)
    if (record?.status !== 'running' || record.work?.status !== 'running' || runtime === undefined) return
    const root = runtime.tasks.state().tasks.find(task => task.id === record.work?.rootTaskId)
    if (root === undefined) return
    const related = this.workRelatedTasks(runtime, root.id)
    const rootWorkId = root.domain.kind === 'composite' || root.domain.kind === 'goal'
      ? root.domain.rootWorkId
      : undefined
    if (rootWorkId !== record.work.id
      || (root.stableState.kind !== 'completed' && root.stableState.kind !== 'blocked')
      || !this.workTasksAreSettled(related, root.id)
      || !this.workMembersAreIdle(record, related)) return
    const coordinator = root.assignees[0] ?? root.owners[0]?.member
    const callerId = record.members.find(member => member.name === coordinator)?.sessionId ?? record.launcherSessionId
    this.finishWork(
      record,
      root.stableState.kind === 'completed' ? 'finished' : 'blocked',
      root.stableState.kind === 'completed'
        ? root.stableState.result ?? root.stableState.reason
        : root.stableState.reason,
      callerId,
    )
  }

  private clearAssistantQuiescenceTimer(runId: string): void {
    const timer = this.assistantQuiescenceTimers.get(runId)
    if (timer !== undefined) clearTimeout(timer)
    this.assistantQuiescenceTimers.delete(runId)
  }

  private assistantQuiescenceKey(runId: string, assistantId: string): string {
    return `${runId}\u0000${assistantId}`
  }

  private armAssistantQuiescence(runId: string, assistantId: string): void {
    this.assistantQuiescenceArmed.add(this.assistantQuiescenceKey(runId, assistantId))
    this.clearAssistantQuiescenceTimer(runId)
  }

  private disarmAssistantQuiescence(runId: string, assistantId: string): void {
    this.assistantQuiescenceArmed.delete(this.assistantQuiescenceKey(runId, assistantId))
  }

  private clearAssistantQuiescenceArms(runId: string): void {
    const prefix = `${runId}\u0000`
    for (const key of [...this.assistantQuiescenceArmed]) {
      if (key.startsWith(prefix)) this.assistantQuiescenceArmed.delete(key)
    }
  }

  private armAssistantQuiescenceFromTask(
    record: FleetRunRecord,
    task: FleetProjectTask,
    actor: string | undefined,
    state: { readonly tasks: readonly FleetProjectTask[] },
  ): void {
    if (actor === undefined || !record.members.some(member => member.name === actor)) return
    const byId = new Map(state.tasks.map(candidate => [candidate.id, candidate]))
    for (const assistant of record.assistants) {
      const interaction = this.collaboration.get(record.id)?.tasks.interactionTask(assistant.view.id)
      if (interaction?.domain.kind !== 'interaction' || interaction.stableState.kind !== 'dormant') continue
      const waiting = new Set(interaction.domain.waitingTaskIds)
      let current: FleetProjectTask | undefined = task
      const visited = new Set<string>()
      while (current !== undefined && !visited.has(current.id)) {
        if (waiting.has(current.id)) {
          this.armAssistantQuiescence(record.id, assistant.view.id)
          break
        }
        visited.add(current.id)
        current = current.parentId === undefined ? undefined : byId.get(current.parentId)
      }
    }
  }

  private signalAssistantInteractionDeliveries(runId: string, quiescenceGraceElapsed = false): void {
    const record = this.records.get(runId)
    const runtime = this.collaboration.get(runId)
    if (record === undefined || runtime === undefined) {
      this.clearAssistantQuiescenceTimer(runId)
      return
    }
    const teamQuiescent = this.teamIsQuiescent(record)
    let quiescentInteraction = false
    const tasks = record.assistants.flatMap(assistant => {
      const interaction = runtime.tasks.interactionTask(assistant.view.id)
      if (interaction?.domain.kind !== 'interaction' || interaction.stableState.kind !== 'dormant') return []
      const linked = interaction.domain.waitingTaskIds.map(id => runtime.tasks.get(assistant.sessionId, id))
      const linkedSettled = linked.length > 0 && linked.every(task => task.stableState.kind === 'completed'
        || task.stableState.kind === 'blocked' || task.stableState.kind === 'cancelled')
      if (!linkedSettled) {
        const assistantIdle = this.ctx.agents.get(SessionId(assistant.sessionId))?.status === 'idle'
        if (!teamQuiescent || !assistantIdle) return []
        if (!this.assistantQuiescenceArmed.has(this.assistantQuiescenceKey(runId, assistant.view.id))) return []
        quiescentInteraction = true
        if (!quiescenceGraceElapsed) return []
        this.disarmAssistantQuiescence(runId, assistant.view.id)
      }
      const task = runtime.tasks.signalInteractionDelivery(
        assistant.view.id,
        linkedSettled
          ? `Every linked Team Task reached a terminal state for Fleet Interaction ${interaction.id}.`
          : `Every formal member in Fleet Team ${record.name} is idle and has no actionable owner or Reconcile Task.`,
      )
      return task === undefined ? [] : [task.id]
    })
    if (tasks.length > 0) this.appendEvent(record.id, 'interaction_delivery_ready', { tasks })
    if (!quiescentInteraction || quiescenceGraceElapsed) {
      this.clearAssistantQuiescenceTimer(runId)
      return
    }
    if (this.assistantQuiescenceTimers.has(runId)) return
    const timer = setTimeout(() => {
      this.assistantQuiescenceTimers.delete(runId)
      this.signalAssistantInteractionDeliveries(runId, true)
    }, TEAM_QUIESCENCE_GRACE_MS)
    this.assistantQuiescenceTimers.set(runId, timer)
  }

  agentIdle(agent: Agent): void {
    if (agent.status !== 'idle') return
    const agentId = String(agent.id)
    this.clearMemberActivity(agentId)
    const entry = this.collaboration.entries().find(([runId, runtime]) =>
      runtime.memberNamesById.has(agentId)
      && (!this.dormantRunIds.has(runId)
        || this.records.get(runId)?.assistants.some(assistant => assistant.sessionId === agentId) === true),
    )
    if (entry === undefined) return
    const [runId, runtime] = entry
    const record = this.records.get(runId)
    const participant = runtime.memberNamesById.get(agentId)
    if (record === undefined || participant === undefined) return
    if (this.autoContinuationPaused(record, participant)) return
    if (this.protocolRecoveries.get(agentId)?.pending === true) {
      this.wakeProtocolRecovery(agentId)
      return
    }
    if (this.abnormalSessionIds.has(agentId)
      || this.networkRecoveries.has(agentId)) return

    if (this.continueAssignedTask(runId, runtime, record, agent)) return
    if (this.continueOwnedTasks(runId, runtime, record, agent)) return
    this.reconcileReadyTasks(runId)
    this.reconcileOwnerTasks(runId)
  }

  agentStatusChanged(agent: Agent): void {
    const agentId = String(agent.id)
    const records = [...this.records.values()].filter(record =>
      this.participants(record).some(member => member.sessionId === agentId))
    if (records.length > 0) {
      this.emitChange()
    }
    if (agent.status === 'idle') {
      this.agentIdle(agent)
      for (const record of records) {
        queueMicrotask(() => {
          this.finishReadyWork(record.id)
          this.signalAssistantInteractionDeliveries(record.id)
        })
      }
    } else {
      for (const record of records) {
        const participant = record.members.find(member => member.sessionId === agentId)
        if (participant !== undefined) {
          for (const assistant of record.assistants) this.armAssistantQuiescence(record.id, assistant.view.id)
        }
        this.signalAssistantInteractionDeliveries(record.id)
      }
    }
  }

  agentDisconnected(agentId: string): void {
    this.clearNetworkRecovery(agentId)
    this.protocolRecoveries.delete(agentId)
    this.clearMemberActivity(agentId)
    this.assistantTurnOutputs.delete(agentId)
    this.assistantCurrentTurns.delete(agentId)
    this.assistantUserFacingTurns.delete(agentId)
    this.memberLastSharedTurns.delete(agentId)
    this.memberVisibilityReviewedTurns.delete(agentId)
    this.visibilityReminderStates.delete(agentId)
    this.turnReminderLastShown.delete(agentId)
    this.turnStartReminderTurns.delete(agentId)
    this.toolResultReminderSequences.delete(agentId)
    this.abnormalSessionIds.delete(agentId)
    for (const [runId, runtime] of this.collaboration.entries()) {
      if (this.dormantRunIds.has(runId) || !runtime.memberNamesById.has(agentId)) continue
      runtime.messages.disconnectAgent(agentId)
    }
  }

  private networkRoute(agent: Agent): string {
    return `${agent.options.provider ?? ''}\u0000${agent.options.model ?? ''}`
  }

  private scheduleProtocolRecovery(runId: string, member: string, agent: Agent, message: string): boolean {
    const record = this.records.get(runId)
    if (record?.status !== 'running' || record.work?.status !== 'running') return false
    const sessionId = String(agent.id)
    const attempt = (this.protocolRecoveries.get(sessionId)?.attempt ?? 0) + 1
    if (attempt > PROTOCOL_RECOVERY_MAX_ATTEMPTS) {
      this.protocolRecoveries.set(sessionId, {
        runId,
        member,
        attempt: PROTOCOL_RECOVERY_MAX_ATTEMPTS,
        pending: false,
      })
      this.appendEvent(runId, 'member_protocol_recovery_exhausted', {
        member,
        sessionId,
        attempts: PROTOCOL_RECOVERY_MAX_ATTEMPTS,
        reason: clippedProgressText(message, 1_000),
      })
      return this.escalateProtocolRecovery(record, member, sessionId, message)
    }
    this.protocolRecoveries.set(sessionId, { runId, member, attempt, pending: true })
    this.appendEvent(runId, 'member_protocol_recovery_scheduled', {
      member,
      sessionId,
      attempt,
      reason: clippedProgressText(message, 1_000),
    })
    queueMicrotask(() => { this.wakeProtocolRecovery(sessionId) })
    return true
  }

  private wakeProtocolRecovery(sessionId: string): void {
    const recovery = this.protocolRecoveries.get(sessionId)
    if (recovery?.pending !== true) return
    const record = this.records.get(recovery.runId)
    if (record?.status !== 'running' || record.work?.status !== 'running') {
      this.protocolRecoveries.delete(sessionId)
      return
    }
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) {
      this.protocolRecoveries.delete(sessionId)
      return
    }
    const participant = this.participants(record).find(candidate => candidate.sessionId === sessionId)
    if (participant === undefined) {
      this.protocolRecoveries.delete(sessionId)
      return
    }
    if (this.autoContinuationPaused(record, participant.name)) return
    if (this.budgetRemaining(record, participant.name).exhaustedScope !== undefined) {
      this.protocolRecoveries.delete(sessionId)
      return
    }
    if (agent.status !== 'idle') return
    recovery.pending = false
    const retryGuidance = recovery.attempt === 1
      ? 'Re-check durable Task state and artifacts, assume an earlier external action may already have completed, and continue from the smallest safe next step without blindly replaying irreversible actions.'
      : `Retry ${recovery.attempt}/${PROTOCOL_RECOVERY_MAX_ATTEMPTS}: continue from durable state and do not replay irreversible actions.`
    this.requireRuntime(record.id).messages.sendSystemNotification(sessionId, {
      kind: 'task_notice',
      text: [
        `[Fleet work ${record.work.id} protocol recovery]`,
        'The previous turn ended because the inference backend returned malformed tool-call protocol.',
        retryGuidance,
      ].join('\n\n'),
      delivery: 'wakeup',
      coalesceKey: `protocol-recovery:${record.work.id}:${recovery.member}:${recovery.attempt}`,
    })
    this.appendEvent(record.id, 'member_protocol_recovery_woken', {
      member: recovery.member,
      sessionId,
      attempt: recovery.attempt,
    })
  }

  private escalateProtocolRecovery(
    record: FleetRunRecord,
    member: string,
    failedSessionId: string,
    message: string,
  ): boolean {
    const assistant = record.assistants.find(candidate =>
      candidate.sessionId !== failedSessionId
      && candidate.status !== 'paused')
    if (assistant === undefined) return false
    this.requireRuntime(record.id).messages.sendSystemNotification(assistant.sessionId, {
      kind: 'task_notice',
      text: [
        `[Fleet work ${record.work?.id ?? 'unknown'} protocol recovery required]`,
        `Member ${member} exhausted ${PROTOCOL_RECOVERY_MAX_ATTEMPTS} automatic retries after malformed inference tool protocol. Its durable Tasks remain unsettled.`,
        'Inspect only the affected Task and its latest artifacts, then resume the member with a narrow next step or reassign the remaining work. Do not replay irreversible actions without verifying their durable result.',
      ].join('\n\n'),
      delivery: 'wakeup',
      coalesceKey: `protocol-recovery-escalation:${record.work?.id ?? record.id}:${member}`,
    })
    this.appendEvent(record.id, 'member_protocol_recovery_escalated', {
      member,
      sessionId: failedSessionId,
      assistant: assistant.view.id,
      assistantSessionId: assistant.sessionId,
      attempts: PROTOCOL_RECOVERY_MAX_ATTEMPTS,
      reason: clippedProgressText(message, 1_000),
    })
    return true
  }

  private scheduleNetworkRecovery(runId: string, member: string, agent: Agent, code: string): void {
    const record = this.records.get(runId)
    if (record?.status !== 'running' || record.work?.status !== 'running') return
    const sessionId = String(agent.id)
    const route = this.networkRoute(agent)
    const current = this.networkRecoveries.get(sessionId)
    if (current?.timer !== undefined) return
    const attempt = current?.route === route ? current.attempt + 1 : 1
    const delayMs = Math.min(
      NETWORK_RECOVERY_MAX_DELAY_MS,
      NETWORK_RECOVERY_INITIAL_DELAY_MS * 2 ** Math.min(attempt - 1, 4),
    )
    const dueAt = new Date(Date.now() + delayMs).toISOString()
    const recovery: NetworkRecovery = { runId, member, route, attempt, timer: undefined }
    recovery.timer = setTimeout(() => {
      recovery.timer = undefined
      this.wakeNetworkRecovery(sessionId, 'backoff_elapsed')
    }, delayMs)
    this.networkRecoveries.set(sessionId, recovery)
    this.appendEvent(runId, 'member_network_recovery_scheduled', {
      member,
      sessionId,
      code,
      attempt,
      delayMs,
      dueAt,
    })
  }

  private wakeNetworkRecoveriesForRoute(runId: string, route: string, sourceSessionId: string): void {
    for (const [sessionId, recovery] of [...this.networkRecoveries]) {
      if (sessionId === sourceSessionId || recovery.runId !== runId || recovery.route !== route) continue
      this.wakeNetworkRecovery(sessionId, 'route_recovered')
    }
  }

  private wakeNetworkRecovery(sessionId: string, reason: 'backoff_elapsed' | 'route_recovered'): void {
    const recovery = this.networkRecoveries.get(sessionId)
    if (recovery === undefined) return
    if (recovery.timer !== undefined) clearTimeout(recovery.timer)
    recovery.timer = undefined
    const record = this.records.get(recovery.runId)
    if (record?.status !== 'running' || record.work?.status !== 'running') {
      this.clearNetworkRecovery(sessionId)
      return
    }
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) {
      this.clearNetworkRecovery(sessionId)
      return
    }
    if (agent.status !== 'idle') return
    this.requireRuntime(record.id).messages.sendSystemNotification(sessionId, {
      kind: 'network_recovery',
      text: [
        `[Fleet work ${record.work.id} network recovery]`,
        'Your previous model request ended after its transient network retries were exhausted.',
        'Connectivity may now be available. Re-check the Team state, verify whether any external action already completed, then continue the interrupted work without duplicating irreversible actions.',
      ].join('\n\n'),
      delivery: 'wakeup',
      coalesceKey: `network-recovery:${record.work.id}`,
    })
    this.appendEvent(record.id, 'member_network_recovery_woken', {
      member: recovery.member,
      sessionId,
      attempt: recovery.attempt,
      reason,
    })
  }

  private clearNetworkRecovery(sessionId: string): void {
    const recovery = this.networkRecoveries.get(sessionId)
    if (recovery?.timer !== undefined) clearTimeout(recovery.timer)
    this.networkRecoveries.delete(sessionId)
  }

  private clearRunNetworkRecoveries(runId: string): void {
    for (const [sessionId, recovery] of [...this.networkRecoveries]) {
      if (recovery.runId === runId) this.clearNetworkRecovery(sessionId)
    }
  }

  readTrace(runId: string | undefined, afterSequence: number, limit: number, projectRoot?: string): {
    readonly runId: string
    readonly events: FleetTraceEvent[]
    readonly hasMore: boolean
  } {
    const record = this.requireRecord(runId, projectRoot)
    const stored = this.storedEvents(record)
    const matching = stored.filter(event => event.sequence > afterSequence)
    return {
      runId: record.id,
      events: matching.slice(0, limit).map(event => ({
        sequence: event.sequence,
        createdAt: event.createdAt,
        scope: event.member === undefined ? 'team' : 'member',
        ...(event.member === undefined ? {} : {
          member: event.member.name,
          sourceSequence: event.member.sequence,
        }),
        type: event.type,
        data: traceEventData(event.data),
      })),
      hasMore: matching.length > limit,
    }
  }

  async searchTeamHistory(
    runId: string,
    input: FleetHistorySearchInput,
    signal?: AbortSignal,
  ): Promise<FleetHistorySearchResult> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
      throw new Error('Fleet history search limit must be an integer from 1 through 1000')
    }
    if (input.recentBytes !== undefined
      && (!Number.isSafeInteger(input.recentBytes) || input.recentBytes < 65_536 || input.recentBytes > 8 * 1_024 * 1_024)) {
      throw new Error('Fleet history search recentBytes must be an integer from 65536 through 8388608')
    }
    const afterSequence = input.afterSequence ?? 0
    const beforeSequence = input.beforeSequence ?? Number.MAX_SAFE_INTEGER
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error('Fleet history search afterSequence must be a non-negative integer')
    }
    if (!Number.isSafeInteger(beforeSequence) || beforeSequence < 1) {
      throw new Error('Fleet history search beforeSequence must be a positive integer')
    }
    const createdAfter = input.createdAfter === undefined ? undefined : Date.parse(input.createdAfter)
    const createdBefore = input.createdBefore === undefined ? undefined : Date.parse(input.createdBefore)
    if (createdAfter !== undefined && !Number.isFinite(createdAfter)) {
      throw new Error('Fleet history search createdAfter must be a valid timestamp')
    }
    if (createdBefore !== undefined && !Number.isFinite(createdBefore)) {
      throw new Error('Fleet history search createdBefore must be a valid timestamp')
    }

    const record = this.requireRecord(runId)
    const path = join(this.runDirectory(record), 'events.jsonl')
    if (!existsSync(path)) return { runId: record.id, events: [], hasMore: false, truncated: false }
    let identities = this.teamProjectionIdentities.get(record.id)
    if (identities === undefined) {
      identities = fleetParticipantIdentities(record, this.storedEvents(record))
      this.teamProjectionIdentities.set(record.id, identities)
    }
    const query = input.query?.trim().toLocaleLowerCase() || undefined
    const member = input.member?.trim() || undefined
    const types = new Set(input.types?.filter(type => type.length > 0) ?? [])
    const prefixes = input.typePrefixes?.filter(prefix => prefix.length > 0) ?? []
    const matches: StoredFleetEvent[] = []
    let hasMore = false
    const visibility = (() => {
      if (input.visibleToSessionId === undefined) return undefined
      const runtime = this.collaboration.get(record.id)
      const agent = this.ctx.agents.get(SessionId(input.visibleToSessionId))
      const member = runtime?.memberNamesById.get(input.visibleToSessionId)
      const view = member === undefined ? undefined : runtime?.memberViews.get(member)
      if (runtime === undefined || agent === undefined || view === undefined) {
        throw new Error(`Fleet participant ${input.visibleToSessionId} is unavailable for history search`)
      }
      return {
        view,
        channels: new Set(runtime.messages.listChannels(agent).map(channel => channel.id)),
        meetings: new Set(runtime.messages.listMeetings(agent).map(meeting => meeting.id)),
      }
    })()

    const consider = (line: string): void => {
      if (line.length === 0 || (query !== undefined && !line.toLocaleLowerCase().includes(query))) return
      const event = stableCoordinationEvent(JSON.parse(line) as StoredFleetEvent, identities)
      if (event.sequence <= afterSequence || event.sequence >= beforeSequence) return
      if (types.size > 0 || prefixes.length > 0) {
        if (!types.has(event.type) && !prefixes.some(prefix => event.type.startsWith(prefix))) return
      }
      if (member !== undefined) {
        const data = typeof event.data === 'object' && event.data !== null
          ? event.data as Record<string, unknown>
          : undefined
        if (event.member?.name !== member && data?.member !== member && data?.actor !== member) return
      }
      if (createdAfter !== undefined || createdBefore !== undefined) {
        const createdAt = Date.parse(event.createdAt)
        if (!Number.isFinite(createdAt)
          || (createdAfter !== undefined && createdAt <= createdAfter)
          || (createdBefore !== undefined && createdAt >= createdBefore)) return
      }
      if (visibility !== undefined
        && !this.visibleToMember(record, visibility.view, visibility.channels, visibility.meetings, event)) return
      if (matches.length === input.limit) {
        matches.shift()
        hasMore = true
      }
      matches.push(event)
    }

    const start = input.recentBytes === undefined
      ? 0
      : Math.max(0, statSync(path).size - input.recentBytes)
    const stream = createReadStream(path, { encoding: 'utf8', start })
    let pending = ''
    let discardPartialLine = start > 0
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      pending += chunk
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        if (discardPartialLine) discardPartialLine = false
        else consider(pending.slice(0, newline).replace(/\r$/u, ''))
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
      }
    }
    signal?.throwIfAborted()
    if (!discardPartialLine) consider(pending.replace(/\r$/u, ''))
    return {
      runId: record.id,
      events: matches.reverse().map(event => this.journalEvent(event, identities)),
      hasMore,
      truncated: start > 0,
    }
  }

  readTeamProjection(runId: string, afterSequence: number, limit: number): FleetTeamProjection {
    const record = this.requireRecord(runId)
    const stored = this.storedEvents(record)
    const identities = fleetParticipantIdentities(record, stored)
    const matching = stored.filter(event => event.sequence > afterSequence)
    return {
      run: this.describeRecord(record),
      memberViews: this.memberViews(runId),
      events: matching.slice(0, limit).map(event => this.journalEvent(event, identities)),
      hasMore: matching.length > limit,
    }
  }

  readWebTeamProjection(runId: string, afterSequence: number, limit: number): FleetTeamProjection {
    const record = this.requireRecord(runId)
    let projection = this.teamProjectionEvents.get(record.id)
    let identities = this.teamProjectionIdentities.get(record.id)
    if (projection === undefined) {
      const stored = this.storedEvents(record)
      projection = compactTeamProjectionEvents(stored)
      identities = fleetParticipantIdentities(record, stored)
      this.teamProjectionIdentities.set(record.id, identities)
      this.cacheTeamProjection(record.id, projection)
      if (!this.memberViewSnapshots.has(record.id)) {
        this.memberViewSnapshots.set(record.id, this.effectiveMemberViews(record, stored))
      }
    }
    identities ??= fleetParticipantIdentities(record, projection)
    const matching = projection.filter(event => event.sequence > afterSequence)
    return {
      run: this.describeRecord(record),
      memberViews: this.memberViews(runId),
      events: matching.slice(0, limit).map(event => this.journalEvent(event, identities)),
      hasMore: matching.length > limit,
    }
  }

  readConversationProjection(
    runId: string,
    conversationId: string,
    beforeSequence: number,
    limit: number,
  ): FleetConversationProjection {
    const record = this.requireRecord(runId)
    const stored = this.storedEvents(record)
    const identities = fleetParticipantIdentities(record, stored)
    const projectedConversation = (event: StoredFleetEvent): string | undefined => {
      const stableEvent = stableCoordinationEvent(event, identities)
      if (stableEvent.type !== 'coordination.message') return undefined
      const coordination = stableEvent.data as Extract<FleetCoordinationEvent, { type: 'message' }>
      return coordination.message.conversationId ?? coordination.message.conversation
    }
    const messages = stored.filter(event => event.sequence < beforeSequence
      && projectedConversation(event) === conversationId)
    const selectedMessages = messages.slice(-limit)
    const selectedIds = new Set(selectedMessages.flatMap(event => {
      if (typeof event.data !== 'object' || event.data === null) return []
      const message = (event.data as { readonly message?: { readonly id?: unknown } }).message
      return typeof message?.id === 'string' ? [message.id] : []
    }))
    const receipts = stored.filter(event => {
      if (event.type !== 'coordination.inbox' || typeof event.data !== 'object' || event.data === null) return false
      const messageId = (event.data as { readonly messageId?: unknown }).messageId
      return typeof messageId === 'string' && selectedIds.has(messageId)
    })
    const events = [...selectedMessages, ...receipts].sort((left, right) => left.sequence - right.sequence)
    return {
      run: this.describeRecord(record),
      memberViews: this.memberViews(runId),
      events: events.map(event => this.journalEvent(event, identities)),
      hasMore: messages.length > selectedMessages.length,
      ...(selectedMessages[0] === undefined ? {} : { previousSequence: selectedMessages[0].sequence }),
    }
  }

  async readResourcePreview(
    runId: string,
    resourceId: string,
    signal?: AbortSignal,
    revisionId?: string,
  ): Promise<FleetResourcePreview> {
    const previews = await this.readResourcePreviews(runId, [{
      id: resourceId,
      ...(revisionId === undefined ? {} : { revisionId }),
    }], signal)
    const preview = previews[0]!
    if (preview.error !== undefined) throw new Error(preview.error)
    return preview
  }

  async readResourcePreviews(
    runId: string,
    requests: readonly FleetResourcePreviewRequest[],
    signal?: AbortSignal,
  ): Promise<FleetResourcePreview[]> {
    const record = this.requireRecord(runId)
    if (requests.length === 0) return []
    const state = await this.resourcePreviewState(record, requests, signal)
    const previews = new Array<FleetResourcePreview>(requests.length)
    let next = 0
    const workers = Array.from({ length: Math.min(4, requests.length) }, async () => {
      while (next < requests.length) {
        const index = next
        next += 1
        const request = requests[index]!
        try {
          previews[index] = await this.readResourcePreviewFromState(
            record,
            request.id,
            state,
            signal,
            request.revisionId,
          )
        } catch (error) {
          signal?.throwIfAborted()
          previews[index] = {
            id: request.id,
            kind: 'text',
            body: '',
            error: errorMessage(error),
            history: [],
            historyTruncated: false,
          }
        }
      }
    })
    await Promise.all(workers)
    return previews
  }

  async readResourceContentSnippets(
    runId: string,
    requests: readonly FleetResourceContentSnippetRequest[],
    signal?: AbortSignal,
  ): Promise<FleetResourceContentSnippet[]> {
    const record = this.requireRecord(runId)
    if (requests.length === 0) return []
    const normalized = requests.map(request => ({
      ...request,
      maxChars: Math.min(2_000, Math.max(64, request.maxChars ?? 360)),
    }))
    const state = await this.resourcePreviewState(record, normalized, signal)
    const results = new Array<FleetResourceContentSnippet>(normalized.length)
    let next = 0
    const workers = Array.from({ length: Math.min(4, normalized.length) }, async () => {
      while (next < normalized.length) {
        signal?.throwIfAborted()
        const index = next
        next += 1
        const request = normalized[index]!
        try {
          const indexedResource = state.resources.get(request.id)
          if (indexedResource === undefined) throw new Error(`Unknown Fleet resource: ${request.id}`)
          const resource = indexedResource.latest
          if (resourcePreviewKind(resource) === undefined) throw new Error('This file type does not support inline preview')
          const target = await this.ctx.fs.resolve(resource.path, signal === undefined ? {} : { signal })
          const info = await this.ctx.fs.stat(target, signal)
          if (info === undefined) throw new Error(`Fleet resource file does not exist: ${resource.path}`)
          if (info.type !== 'file') throw new Error(`Fleet resource is not a regular file: ${resource.path}`)
          if (info.size !== undefined && info.size > RESOURCE_PREVIEW_MAX_BYTES) {
            throw new Error('Fleet resource preview is limited to 2 MiB')
          }
          const bytes = await this.ctx.fs.readBytes(target, signal, RESOURCE_PREVIEW_MAX_BYTES)
          const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          const selected = boundedTextSnippet(body, request.query, request.maxChars)
          const actorName = (actorId: string): string => state.actorNames.get(actorId) ?? actorId
          const revisionIndex = state.revisions.get(request.id)
          const revisions = revisionIndex?.history ?? []
          const history = revisionIndex?.hasCreated === true
            ? revisions
            : [{
                id: `resource-added:${request.id}`,
                resourceId: request.id,
                updatedBy: actorName(indexedResource.created.createdBy),
                updatedAt: indexedResource.created.createdAt,
                operation: 'created' as const,
                available: false,
                size: indexedResource.created.size ?? info.size ?? 0,
              }, ...revisions]
          results[index] = {
            id: request.id,
            matched: selected !== undefined,
            ...(selected === undefined ? {} : { snippet: selected }),
            history: history.slice(-RESOURCE_HISTORY_LIMIT).map((revision): FleetResourceRevisionSummary => ({
              id: revision.id,
              updatedBy: actorName(revision.updatedBy),
              updatedAt: revision.updatedAt,
              operation: revision.operation,
              available: revision.available,
              size: revision.size,
            })).reverse(),
            historyTruncated: (revisionIndex?.count ?? 0)
              + (revisionIndex?.hasCreated === true ? 0 : 1) > RESOURCE_HISTORY_LIMIT,
          }
        } catch (error) {
          signal?.throwIfAborted()
          results[index] = {
            id: request.id,
            matched: false,
            history: [],
            historyTruncated: false,
            error: errorMessage(error),
          }
        }
      }
    })
    await Promise.all(workers)
    return results
  }

  async readResourceRevisionSnippets(
    runId: string,
    requests: readonly FleetResourceRevisionSnippetRequest[],
    signal?: AbortSignal,
  ): Promise<FleetResourceRevisionSnippet[]> {
    const record = this.requireRecord(runId)
    if (requests.length === 0) return []
    const normalized = requests.map(request => ({
      ...request,
      maxChars: Math.min(2_000, Math.max(64, request.maxChars ?? 360)),
    }))
    const state = await this.resourcePreviewState(record, normalized, signal)
    const results = new Array<FleetResourceRevisionSnippet>(normalized.length)
    let next = 0
    const workers = Array.from({ length: Math.min(4, normalized.length) }, async () => {
      while (next < normalized.length) {
        signal?.throwIfAborted()
        const index = next
        next += 1
        const request = normalized[index]!
        try {
          if (state.resources.get(request.id) === undefined) {
            throw new Error(`Unknown Fleet resource: ${request.id}`)
          }
          const revision = state.revisions.get(request.id)?.selected.get(request.revisionId)
          if (revision === undefined) throw new Error(`Unknown Fleet resource revision: ${request.revisionId}`)
          if (!revision.available) throw new Error(`Fleet resource revision ${request.revisionId} is unavailable`)
          const detail = await this.readStoredResourceRevision(record, request.revisionId, signal)
          const selected = boundedTextSnippet(detail.after, request.query, request.maxChars)
          results[index] = {
            id: request.id,
            revisionId: request.revisionId,
            matched: selected !== undefined,
            ...(selected === undefined ? {} : { snippet: selected }),
          }
        } catch (error) {
          signal?.throwIfAborted()
          results[index] = {
            id: request.id,
            revisionId: request.revisionId,
            matched: false,
            error: errorMessage(error),
          }
        }
      }
    })
    await Promise.all(workers)
    return results
  }

  private async resourcePreviewState(
    record: FleetRunRecord,
    requests: readonly FleetResourcePreviewRequest[],
    signal?: AbortSignal,
  ): Promise<FleetResourcePreviewState> {
    const requestedIds = new Set(requests.map(request => request.id))
    const requestedRevisions = new Map<string, Set<string>>()
    for (const request of requests) {
      if (request.revisionId === undefined) continue
      const revisions = requestedRevisions.get(request.id) ?? new Set<string>()
      revisions.add(request.revisionId)
      requestedRevisions.set(request.id, revisions)
    }
    const actorNames = new Map(this.participants(record).map(participant => [participant.sessionId, participant.name]))
    const resources = new Map<string, { created: FleetResource; latest: FleetResource }>()
    const eventsPath = join(this.runDirectory(record), 'events.jsonl')
    await this.scanJsonLines(eventsPath, signal, line => {
      if (!line.includes('member_session_rotated') && !line.includes('assistant_rebound')
        && !line.includes('resource.resource_added') && !line.includes('resource.resource_removed')) return
      const event = JSON.parse(line) as StoredFleetEvent
      if (event.type === 'member_session_rotated') {
        const data = event.data as { readonly member?: unknown; readonly previousSessionId?: unknown; readonly sessionId?: unknown }
        if (typeof data.member === 'string') {
          if (typeof data.previousSessionId === 'string') actorNames.set(data.previousSessionId, data.member)
          if (typeof data.sessionId === 'string') actorNames.set(data.sessionId, data.member)
        }
      }
      if (event.type === 'assistant_rebound') {
        const data = event.data as { readonly previousSessionId?: unknown; readonly sessionId?: unknown; readonly view?: { readonly id?: unknown } }
        if (typeof data.view?.id === 'string') {
          if (typeof data.previousSessionId === 'string') actorNames.set(data.previousSessionId, data.view.id)
          if (typeof data.sessionId === 'string') actorNames.set(data.sessionId, data.view.id)
        }
      }
      if (event.type === 'resource.resource_added') {
        const candidate = (event.data as Extract<FleetResourceEvent, { type: 'resource_added' }>).resource
        if (!requestedIds.has(candidate.id)) return
        const current = resources.get(candidate.id)
        resources.set(candidate.id, {
          created: current?.created ?? candidate,
          latest: candidate,
        })
      }
      if (event.type === 'resource.resource_removed') {
        const removal = (event.data as Extract<FleetResourceEvent, { type: 'resource_removed' }>).removal
        if (!requestedIds.has(removal.resource.id)) return
        resources.delete(removal.resource.id)
      }
    })
    const revisionIndexes = new Map<string, {
      readonly recent: Array<FleetResourceRevisionSummary & { readonly resourceId: string }>
      readonly selected: Map<string, FleetResourceRevisionSummary & { readonly resourceId: string }>
      count: number
      hasCreated: boolean
      cursor: number
    }>()
    await this.scanJsonLines(join(this.runDirectory(record), 'resource-history.jsonl'), signal, line => {
      const revision = JSON.parse(line) as FleetResourceRevisionSummary & { readonly resourceId: string }
      if (!requestedIds.has(revision.resourceId)) return
      const created = resources.get(revision.resourceId)?.created.createdAt
      if (created === undefined || revision.updatedAt < created) return
      const index = revisionIndexes.get(revision.resourceId) ?? {
        recent: [] as Array<FleetResourceRevisionSummary & { readonly resourceId: string }>,
        selected: new Map<string, FleetResourceRevisionSummary & { readonly resourceId: string }>(),
        count: 0,
        hasCreated: false,
        cursor: 0,
      }
      index.count += 1
      index.hasCreated ||= revision.operation === 'created'
      if (index.recent.length < RESOURCE_HISTORY_LIMIT) index.recent.push(revision)
      else {
        index.recent[index.cursor] = revision
        index.cursor = (index.cursor + 1) % RESOURCE_HISTORY_LIMIT
      }
      if (requestedRevisions.get(revision.resourceId)?.has(revision.id) === true) {
        index.selected.set(revision.id, revision)
      }
      revisionIndexes.set(revision.resourceId, index)
    })
    const revisions = new Map<string, {
      readonly history: readonly (FleetResourceRevisionSummary & { readonly resourceId: string })[]
      readonly count: number
      readonly hasCreated: boolean
      readonly selected: ReadonlyMap<string, FleetResourceRevisionSummary & { readonly resourceId: string }>
    }>()
    for (const [resourceId, index] of revisionIndexes) {
      const history = index.count <= RESOURCE_HISTORY_LIMIT
        ? index.recent
        : [...index.recent.slice(index.cursor), ...index.recent.slice(0, index.cursor)]
      revisions.set(resourceId, {
        history,
        count: index.count,
        hasCreated: index.hasCreated,
        selected: index.selected,
      })
    }
    return { actorNames, resources, revisions }
  }

  private async readResourcePreviewFromState(
    record: FleetRunRecord,
    resourceId: string,
    state: FleetResourcePreviewState,
    signal?: AbortSignal,
    revisionId?: string,
  ): Promise<FleetResourcePreview> {
    const actorName = (actorId: string): string => state.actorNames.get(actorId) ?? actorId
    const indexedResource = state.resources.get(resourceId)
    if (indexedResource === undefined) throw new Error(`Unknown Fleet resource: ${resourceId}`)
    const resource = indexedResource.latest
    const createdResource = indexedResource.created
    const kind = resourcePreviewKind(resource)
    if (kind === undefined) throw new Error('This file type does not support inline preview')

    const target = await this.ctx.fs.resolve(resource.path, signal === undefined ? {} : { signal })
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) throw new Error(`Fleet resource file does not exist: ${resource.path}`)
    if (info.type !== 'file') throw new Error(`Fleet resource is not a regular file: ${resource.path}`)
    if (info.size !== undefined && info.size > RESOURCE_PREVIEW_MAX_BYTES) {
      throw new Error('Fleet resource preview is limited to 2 MiB')
    }
    const bytes = await this.ctx.fs.readBytes(target, signal, RESOURCE_PREVIEW_MAX_BYTES)
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const revisionIndex = state.revisions.get(resourceId)
    const revisions = revisionIndex?.history ?? []
    const history = revisionIndex?.hasCreated === true
      ? revisions
      : [{
          id: `resource-added:${resourceId}`,
          resourceId,
          updatedBy: actorName(createdResource.createdBy),
          updatedAt: createdResource.createdAt,
          operation: 'created' as const,
          available: false,
          size: createdResource.size ?? info.size ?? 0,
        }, ...revisions]
    const selected = revisionId === undefined
      ? undefined
      : revisionIndex?.selected.get(revisionId)
    if (revisionId !== undefined && selected === undefined) {
      throw new Error(`Unknown Fleet resource revision: ${revisionId}`)
    }
    return {
      id: resource.id,
      kind,
      body,
      ...(resource.mediaType === undefined ? {} : { mediaType: resource.mediaType }),
      ...(info.size === undefined ? {} : { size: info.size }),
      history: history.slice(-RESOURCE_HISTORY_LIMIT).map((revision): FleetResourceRevisionSummary => ({
        id: revision.id,
        updatedBy: actorName(revision.updatedBy),
        updatedAt: revision.updatedAt,
        operation: revision.operation,
        available: revision.available,
        size: revision.size,
      })).reverse(),
      historyTruncated: (revisionIndex?.count ?? 0) + (revisionIndex?.hasCreated === true ? 0 : 1) > RESOURCE_HISTORY_LIMIT,
      ...(selected === undefined || !selected.available ? {} : {
        revision: {
          id: selected.id,
          updatedBy: actorName(selected.updatedBy),
          updatedAt: selected.updatedAt,
          operation: selected.operation,
          available: true,
          size: selected.size,
          ...this.storedResourceRevision(record, selected.id),
        },
      }),
    }
  }

  async readMemberTrace(
    runId: string | undefined,
    memberName: string,
    afterSequence: number,
    limit: number,
    projectRoot?: string,
  ): Promise<{
    readonly runId: string
    readonly member: string
    readonly events: FleetTraceEvent[]
    readonly hasMore: boolean
  }> {
    const record = this.requireRecord(runId, projectRoot)
    const member = this.participants(record).find(candidate => candidate.name === memberName)
    if (member === undefined) throw new Error(`unknown Fleet run member ${memberName}`)
    const live = this.ctx.agents.get(SessionId(member.sessionId))
    const events: readonly SessionEventLike[] = live === undefined
      ? (await this.requirePersistence().inspect(SessionId(member.sessionId))).events
      : live.session.events
    const matching = events.filter(event => event.seq > afterSequence)
    return {
      runId: record.id,
      member: member.name,
      events: matching.slice(0, limit).map(event => ({
        sequence: event.seq,
        createdAt: new Date(event.time).toISOString(),
        scope: 'member' as const,
        member: member.name,
        sessionId: member.sessionId,
        sourceSequence: event.seq,
        type: `session.${event.type}`,
        data: traceEventData(event.data),
      })),
      hasMore: matching.length > limit,
    }
  }

  async readMemberProgress(
    caller: Agent,
    runId: string | undefined,
    memberReference: string,
    options: {
      readonly afterSequence?: number
      readonly limit?: number
      readonly includeOutputs?: boolean
      readonly maxCharsPerItem?: number
    } = {},
  ): Promise<FleetMemberProgress> {
    const record = this.requireCallerRecord(caller, runId)
    this.requireParticipant(record, caller)
    const callerId = String(caller.id)
    const callerParticipant = this.participants(record).find(candidate => candidate.sessionId === callerId)
    const callerView = callerParticipant === undefined
      ? undefined
      : this.memberViews(record.id).find(view => view.id === callerParticipant.name)
    if (callerParticipant === undefined || callerView === undefined) {
      throw new Error(`Agent ${callerId} is not a Fleet participant`)
    }
    const reference = memberReference.startsWith('@') ? memberReference.slice(1) : memberReference
    const views = this.memberViews(record.id)
    const matches = this.participants(record).flatMap(candidate => {
      const view = views.find(value => value.id === candidate.name)
      return candidate.name === reference || view?.name === reference ? [{ participant: candidate, view }] : []
    })
    if (matches.length === 0) throw new Error(`unknown Fleet member ${memberReference}`)
    if (matches.length > 1) throw new Error(`ambiguous Fleet member ${memberReference}`)
    const { participant: member, view: memberView } = matches[0] as typeof matches[number]
    if (member.name !== callerParticipant.name && !fleetMemberCanContact(callerView, member.name)) {
      throw new Error(`Fleet member @${callerView.id} cannot inspect @${member.name}`)
    }

    const afterSequence = options.afterSequence
    const limit = options.limit ?? 5
    const maxChars = options.maxCharsPerItem ?? 800
    if (afterSequence !== undefined && (!Number.isSafeInteger(afterSequence) || afterSequence < 0)) {
      throw new Error('afterSequence must be a non-negative integer')
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) {
      throw new Error('limit must be an integer from 1 through 10')
    }
    if (!Number.isSafeInteger(maxChars) || maxChars < 100 || maxChars > 2_000) {
      throw new Error('maxCharsPerItem must be an integer from 100 through 2000')
    }

    const live = this.ctx.agents.get(SessionId(member.sessionId))
    const events: readonly SessionEventLike[] = live === undefined
      ? (await this.requirePersistence().inspect(SessionId(member.sessionId))).events
      : live.session.events
    const projected = events.flatMap(event => {
      const item = memberProgressItem(event, options.includeOutputs ?? false, maxChars)
      return item === undefined ? [] : [item]
    })
    const eligible = afterSequence === undefined
      ? projected
      : projected.filter(item => item.sequence > afterSequence)
    const items = afterSequence === undefined ? eligible.slice(-limit) : eligible.slice(0, limit)
    const hasMore = eligible.length > items.length
    const sourceCursor = events.at(-1)?.seq ?? 0
    const cursor = hasMore ? items.at(-1)?.sequence ?? afterSequence ?? sourceCursor : sourceCursor
    const current = this.describeRecord(record)
    const runtimeStatus = current.members.find(candidate => candidate.name === member.name)?.status
      ?? current.assistants.find(candidate => candidate.view.id === member.name)?.status
      ?? 'unknown'
    return {
      runId: record.id,
      member: member.name,
      ...(memberView === undefined ? {} : { displayName: memberView.name }),
      runtimeStatus,
      items,
      cursor,
      hasMore,
    }
  }

  async waitMemberProgress(
    caller: Agent,
    runId: string | undefined,
    memberReference: string,
    options: {
      readonly afterSequence: number
      readonly limit?: number
      readonly includeOutputs?: boolean
      readonly maxCharsPerItem?: number
      readonly waitMs: number
    },
  ): Promise<FleetMemberProgress> {
    if (!Number.isSafeInteger(options.waitMs) || options.waitMs < 1 || options.waitMs > 60_000) {
      throw new Error('waitMs must be an integer from 1 through 60000')
    }
    const read = (): Promise<FleetMemberProgress> => this.readMemberProgress(
      caller,
      runId,
      memberReference,
      options,
    )
    const initial = await read()
    if (initial.items.length > 0 || !['running', 'waiting'].includes(initial.runtimeStatus)) return initial
    return new Promise<FleetMemberProgress>((resolve, reject) => {
      let settled = false
      const finish = (value: FleetMemberProgress): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stop()
        resolve(value)
      }
      const fail = (error: unknown): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stop()
        reject(error)
      }
      const refresh = (): void => {
        void read().then(value => {
          if (value.items.length > 0 || !['running', 'waiting'].includes(value.runtimeStatus)) finish(value)
        }, fail)
      }
      const stop = this.subscribeTraceChanges((changedRunId, changedMember) => {
        if (changedRunId === initial.runId && changedMember === initial.member) refresh()
      })
      const timer = setTimeout(() => { void read().then(finish, fail) }, options.waitMs)
      // Close the race between the initial snapshot and listener registration.
      refresh()
    })
  }

  async readMemberTraceTail(
    runId: string | undefined,
    memberName: string,
    limit: number,
    projectRoot?: string,
  ): Promise<{
    readonly runId: string
    readonly member: string
    readonly events: FleetTraceEvent[]
    readonly hasMore: boolean
  }> {
    const record = this.requireRecord(runId, projectRoot)
    const member = this.participants(record).find(candidate => candidate.name === memberName)
    if (member === undefined) throw new Error(`unknown Fleet run member ${memberName}`)
    const tail: Array<{ readonly sessionId: string; readonly event: SessionEventLike }> = []
    let hasMore = false
    const sessionIds = this.participantSessionIdsForRecord(record, member.name)
    outer: for (let sessionIndex = sessionIds.length - 1; sessionIndex >= 0; sessionIndex -= 1) {
      const sessionId = sessionIds[sessionIndex]
      if (sessionId === undefined) continue
      const live = this.ctx.agents.get(SessionId(sessionId))
      const events: readonly SessionEventLike[] = live === undefined
        ? (await this.requirePersistence().inspect(SessionId(sessionId))).events
        : live.session.events
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event === undefined || event.type === 'assistant/chunk' || event.type === 'session/end-seed') continue
        if (tail.length === limit) {
          hasMore = true
          break outer
        }
        tail.push({ sessionId, event })
      }
    }
    tail.reverse()
    return {
      runId: record.id,
      member: member.name,
      events: tail.map(item => ({
        sequence: item.event.seq,
        createdAt: new Date(item.event.time).toISOString(),
        scope: 'member' as const,
        member: member.name,
        sessionId: item.sessionId,
        sourceSequence: item.event.seq,
        type: `session.${item.event.type}`,
        data: traceEventData(item.event.data),
      })),
      hasMore,
    }
  }

  async readMemberTracePage(
    runId: string,
    memberName: string,
    limit: number,
    cursor?: { readonly segment: number; readonly beforeSeq: number },
    signal?: AbortSignal,
  ): Promise<FleetMemberTracePage> {
    const record = this.requireRecord(runId)
    const member = this.participants(record).find(candidate => candidate.name === memberName)
    if (member === undefined) throw new Error(`unknown Fleet run member ${memberName}`)
    const archive = this.ctx.get('sessionArchive', false) as FleetSessionArchiveLike | undefined
    const logicalId = this.memberArchiveId(record.id, member.name)
    const timeline = archive === undefined ? undefined : await archive.find(logicalId)
    if (archive === undefined || timeline === undefined) {
      return this.readMemberTraceTail(record.id, member.name, limit)
    }
    const page = await archive.readPage(logicalId, {
      limit,
      ...(cursor === undefined ? {} : { cursor }),
      ...(signal === undefined ? {} : { signal }),
    })
    const items = page.items.filter(item => item.event.type !== 'assistant/chunk'
      && item.event.type !== 'session/end-seed')
    return {
      runId: record.id,
      member: member.name,
      events: items.map(item => ({
        sequence: item.event.seq,
        createdAt: new Date(item.event.time).toISOString(),
        scope: 'member',
        member: member.name,
        sessionId: item.sessionId,
        sourceSequence: item.event.seq,
        type: `session.${item.event.type}`,
        data: traceEventData(item.event.data),
      })),
      hasMore: page.previous !== undefined,
      ...(page.previous === undefined ? {} : { previous: page.previous }),
    }
  }

  async readMemberSourceTrace(
    runId: string,
    memberName: string,
    sourceSessionId: string,
    contextMessageId: string,
    limit: number,
  ): Promise<FleetMemberTracePage> {
    const record = this.requireRecord(runId)
    const member = this.participants(record).find(candidate => candidate.name === memberName)
    if (member === undefined) throw new Error(`unknown Fleet run member ${memberName}`)
    const memberSessions = new Set(this.participantSessionIdsForRecord(record, member.name))
    if (!memberSessions.has(sourceSessionId)) {
      throw new Error(`Session ${sourceSessionId} does not belong to Fleet member ${memberName}`)
    }
    const live = this.ctx.agents.get(SessionId(sourceSessionId))
    const events: readonly SessionEventLike[] = live === undefined
      ? (await this.requirePersistence().inspect(SessionId(sourceSessionId))).events
      : live.session.events
    const targetIndex = events.findIndex(event => {
      if (typeof event.data !== 'object' || event.data === null) return false
      const data = event.data as { readonly id?: unknown; readonly message?: { readonly id?: unknown } }
      return data.id === contextMessageId || data.message?.id === contextMessageId
    })
    if (targetIndex < 0) throw new Error(`Context message ${contextMessageId} was not found in Session ${sourceSessionId}`)
    const before = Math.floor((limit - 1) / 2)
    const start = Math.max(0, targetIndex - before)
    const selected = events.slice(start, Math.min(events.length, start + limit))
      .filter(event => event.type !== 'assistant/chunk' && event.type !== 'session/end-seed')
    const target = events[targetIndex]
    return {
      runId: record.id,
      member: member.name,
      events: selected.map(event => ({
        sequence: event.seq,
        createdAt: new Date(event.time).toISOString(),
        scope: 'member',
        member: member.name,
        sessionId: sourceSessionId,
        sourceSequence: event.seq,
        type: `session.${event.type}`,
        data: traceEventData(event.data),
      })),
      hasMore: start > 0 || start + limit < events.length,
      targetSessionId: sourceSessionId,
      ...(target === undefined ? {} : { targetSequence: target.seq }),
    }
  }

  readMemberProjection(
    runId: string,
    memberName: string,
    afterSequence: number,
    limit: number,
  ): FleetMemberProjection {
    const record = this.requireRecord(runId)
    return this.projectMember(record, memberName, afterSequence, limit, this.storedEvents(record))
  }

  private projectMember(
    record: FleetRunRecord,
    memberName: string,
    afterSequence: number,
    limit: number,
    stored: readonly StoredFleetEvent[],
  ): FleetMemberProjection {
    const participants = this.participants(record)
    if (!participants.some(member => member.name === memberName)) {
      throw new Error(`unknown Fleet run member ${memberName}`)
    }
    const view = [
      ...this.effectiveMemberViews(record, stored),
      ...record.assistants.map(assistant => assistant.view),
    ].find(member => member.id === memberName)
    if (view === undefined) throw new Error(`missing Fleet member view ${memberName}`)
    const memberSessionId = participants.find(member => member.name === memberName)?.sessionId ?? ''
    const identities = fleetParticipantIdentities(record, stored)
    const channels = new Map<string, Extract<FleetCoordinationEvent, { type: 'channel' }>['channel']>()
    for (const event of stored) {
      if (event.type !== 'coordination.channel') continue
      const coordination = event.data as Extract<FleetCoordinationEvent, { type: 'channel' }>
      channels.set(coordination.channel.id, coordination.channel)
    }
    const visibleChannels = new Set([
      ...(fleetMemberCanAccessChannel(view, 'general') ? ['general'] : []),
      ...[...channels.values()].flatMap(channel =>
        fleetMemberCanAccessChannel(view, channel.id)
        && (channel.open || channel.members.includes(memberName) || channel.members.includes(memberSessionId))
          ? [channel.id]
          : [],
      ),
    ])
    const meetings = new Set(stored.flatMap(event => {
      if (event.type !== 'coordination.meeting') return []
      const coordination = event.data as Extract<FleetCoordinationEvent, { type: 'meeting' }>
      return coordination.meeting.participants.includes(memberName)
        || coordination.meeting.participants.includes(memberSessionId)
        ? [coordination.meeting.id]
        : []
    }))
    const matching = stored.filter(event =>
      event.sequence > afterSequence && this.visibleToMember(record, view, visibleChannels, meetings, event),
    )
    return {
      run: this.describeRecord(record),
      view: structuredClone(view),
      events: matching.slice(0, limit).map(event => this.journalEvent(event, identities)),
      hasMore: matching.length > limit,
    }
  }

  activityInbox(caller: Agent, input: {
    readonly runId?: string
    readonly afterSequence?: number
    readonly limit?: number
    readonly unreadOnly?: boolean
  } = {}): FleetActivityInbox {
    const record = this.requireCallerRecord(caller, input.runId)
    const participant = this.participants(record).find(member => member.sessionId === String(caller.id))
    if (participant === undefined) throw new Error(`Agent ${String(caller.id)} is not a Fleet participant`)
    const afterSequence = input.afterSequence ?? 0
    const limit = input.limit ?? 20
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error('afterSequence must be a non-negative integer')
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer from 1 through 100')
    }
    const stored = this.storedEvents(record)
    const acknowledged = new Set(stored.flatMap(event => {
      if (event.type !== 'activity.acknowledged') return []
      const data = event.data as { readonly member: string; readonly sequence: number }
      return data.member === participant.name ? [data.sequence] : []
    }))
    const visible = this.projectMember(record, participant.name, afterSequence, stored.length || 1, stored).events
    const matching = visible.flatMap((event): FleetActivityItem[] => {
      const kind = this.activityKind(participant, event)
      if (kind === undefined) return []
      const isAcknowledged = acknowledged.has(event.sequence)
      if (input.unreadOnly === true && isAcknowledged) return []
      const data = kind === 'task'
        && typeof event.data === 'object' && event.data !== null
        && 'task' in event.data
        && typeof event.data.task === 'object' && event.data.task !== null
        ? {
            ...event.data,
            task: fleetTaskToolSummary(event.data.task as unknown as FleetProjectTask),
          }
        : event.data
      return [{
        id: `${record.id}:${event.sequence}`,
        sequence: event.sequence,
        createdAt: event.createdAt,
        kind,
        type: event.type,
        acknowledged: isAcknowledged,
        data: structuredClone(data) as Record<string, JsonValue>,
      }]
    })
    return {
      runId: record.id,
      member: participant.name,
      items: matching.slice(0, limit),
      hasMore: matching.length > limit,
    }
  }

  acknowledgeActivity(caller: Agent, sequence: number, runId?: string): FleetActivityItem {
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('activity sequence must be a positive integer')
    const current = this.activityInbox(caller, {
      ...(runId === undefined ? {} : { runId }),
      afterSequence: Math.max(0, sequence - 1),
      limit: 1,
    }).items
      .find(item => item.sequence === sequence)
    if (current === undefined) throw new Error(`activity ${sequence} is not visible to the calling Fleet member`)
    if (!current.acknowledged) {
      const record = this.requireCallerRecord(caller, runId)
      const member = this.participants(record).find(participant => participant.sessionId === String(caller.id))?.name
      if (member === undefined) throw new Error(`Agent ${String(caller.id)} is not a Fleet participant`)
      this.appendEvent(record.id, 'activity.acknowledged', { member, sequence })
    }
    return { ...current, acknowledged: true }
  }

  private activityKind(
    participant: { readonly name: string; readonly sessionId: string },
    event: FleetJournalEvent,
  ): FleetActivityKind | undefined {
    if (event.type === 'coordination.message') {
      const coordination = event.data as Extract<FleetCoordinationEvent, { type: 'message' }>
      if (coordination.message.from === participant.name || coordination.message.from === participant.sessionId) return undefined
      // Preserve replay behavior for journals written before productivity updates moved to system notifications.
      if (coordination.message.kind === 'task_notification' || coordination.message.kind === 'calendar_notification') {
        return undefined
      }
      const conversation = coordination.message.conversation
      const direct = conversation === `@${participant.name}` || conversation === `@${participant.sessionId}`
      const mentioned = coordination.message.mentions.includes(participant.name)
        || coordination.message.mentions.includes(participant.sessionId)
      return direct || mentioned || conversation.startsWith('meeting:') ? 'message' : undefined
    }
    if (event.type === 'coordination.meeting') return 'meeting'
    if (event.type === 'coordination.vote') {
      const coordination = event.data as Extract<FleetCoordinationEvent, { type: 'vote' }>
      return coordination.action === 'opened' || coordination.action === 'closed' ? 'vote' : undefined
    }
    if (/^task\.(created|updated|commented|progressed|domain_updated|reconcile_ready|reconcile_started|reconciled|retrying|timed_out|signaled|completed|cancelled|due)$/.test(event.type)) return 'task'
    if (/^calendar\.(created|updated|rsvp|started|closed|cancelled)$/.test(event.type)) return 'calendar'
    if (event.type === 'resource.document_commented' || event.type === 'resource.document_resolved') return 'document'
    if (event.type === 'schedule.triggered') return 'schedule'
    if (event.type === 'member_view_added' || event.type === 'member_view_updated' || event.type === 'member_view_removed'
      || event.type === 'assistant_view_updated' || event.type === 'team_requests_configured'
      || event.type.startsWith('budget_')
      || event.type === 'member_paused' || event.type === 'member_resumed') {
      return 'member'
    }
    return undefined
  }

  private journalEvent(event: StoredFleetEvent, identities?: FleetParticipantIdentities): FleetJournalEvent {
    if (identities !== undefined) event = stableCoordinationEvent(event, identities)
    return {
      sequence: event.sequence,
      createdAt: event.createdAt,
      scope: event.member === undefined ? 'team' : 'member',
      ...(event.member === undefined ? {} : {
        member: event.member.name,
        sourceSequence: event.member.sequence,
      }),
      type: event.type,
        data: structuredClone(event.data) as Record<string, JsonValue>,
    }
  }

  private visibleToMember(
    record: FleetRunRecord,
    view: FleetMemberView,
    channels: ReadonlySet<string>,
    meetings: ReadonlySet<string>,
    event: StoredFleetEvent,
  ): boolean {
    if (event.member !== undefined) return event.member.name === view.id
    if (event.type === 'activity.acknowledged') {
      return (event.data as { readonly member: string }).member === view.id
    }
    const subject = {
      kind: record.assistants.some(assistant => assistant.view.id === view.id) ? 'assistant' as const : 'member' as const,
      id: view.id,
    }
    if (event.type.startsWith('resource.document_')) {
      const documentId = (event.data as { readonly document?: { readonly id?: string } }).document?.id
      return this.authorization?.authorize({
        teamId: record.id,
        subject,
        action: 'document.read',
        ...(documentId === undefined ? {} : { resource: { kind: 'document', id: documentId } }),
      }) ?? view.toolGroups.includes('documents')
    }
    if (event.type.startsWith('resource.work_')) {
      return this.authorization?.has(record.id, view, 'work.read') ?? view.toolGroups.includes('resources')
    }
    if (event.type.startsWith('resource.resource_')) {
      const data = event.data as {
        readonly resource?: { readonly id?: string }
        readonly revision?: { readonly resourceId?: string }
      }
      const resourceId = data.resource?.id ?? data.revision?.resourceId
      return this.authorization?.authorize({
        teamId: record.id,
        subject,
        action: 'resource.read',
        ...(resourceId === undefined ? {} : { resource: { kind: 'resource', id: resourceId } }),
      }) ?? view.toolGroups.includes('resources')
    }
    if (event.type.startsWith('workspace.')) {
      const resources = workspaceEventResourceIds(event)
      if (this.authorization === undefined || resources === undefined) return false
      return resources.every(id => this.authorization!.authorize({
        teamId: record.id,
        subject,
        action: 'workspace.read',
        resource: { kind: 'workspace', id },
      }))
    }
    if (event.type.startsWith('member_status.')) {
      return this.authorization?.has(record.id, view, 'member-status.read') ?? view.toolGroups.includes('status')
    }
    if (event.type.startsWith('task.')) return this.authorization?.has(record.id, view, 'task.read') ?? view.toolGroups.includes('tasks')
    if (event.type.startsWith('calendar.')) return this.authorization?.has(record.id, view, 'calendar.read') ?? view.toolGroups.includes('calendar')
    if (event.type.startsWith('schedule.')) return this.authorization?.has(record.id, view, 'schedule.read') ?? view.toolGroups.includes('schedule')
    if (event.type === 'assistant_message') {
      const message = event.data as FleetAssistantMessage
      return message.recipients?.includes(view.id) === true
        || (message as FleetAssistantMessage & { readonly coordinator?: string }).coordinator === view.id
        || message.assistantId === view.id
    }
    if (!event.type.startsWith('coordination.')) return true

    const coordination = event.data as FleetCoordinationEvent
    if (coordination.type === 'channel') {
      return channels.has(coordination.channel.id)
    }
    if (coordination.type === 'vote') {
      return channels.has(coordination.vote.channel.slice(1))
    }
    if (coordination.type === 'meeting') {
      return coordination.meeting.participants.includes(view.id)
        || coordination.meeting.participants.some(sessionId =>
          this.participants(record).some(member => member.name === view.id && member.sessionId === sessionId),
        )
    }
    if (coordination.type === 'system_notification') {
      return coordination.agentId === view.id
        || this.participants(record).some(member => member.name === view.id && member.sessionId === coordination.agentId)
    }
    if (coordination.type === 'inbox') {
      return coordination.agentId === view.id
        || this.participants(record).some(member => member.name === view.id && member.sessionId === coordination.agentId)
    }
    if (coordination.type === 'reaction' || coordination.type === 'pin') return true

    const conversation = coordination.message.conversation
    if (conversation.startsWith('#')) return channels.has(conversation.slice(1))
    if (conversation.startsWith('meeting:')) return meetings.has(conversation.slice('meeting:'.length))
    if (!conversation.startsWith('@')) return false
    const targetSessionId = conversation.slice(1)
    const target = this.participants(record).find(member => member.sessionId === targetSessionId)?.name ?? targetSessionId
    const sender = this.participants(record).find(member => member.sessionId === coordination.message.from)?.name
      ?? coordination.message.from
    return sender === view.id || target === view.id
  }

  close(): void {
    for (const teamId of [...this.sharedFileWatchers.keys()]) this.stopSharedFileWatcher(teamId)
    for (const timer of this.sharedFileSyncTimers.values()) clearTimeout(timer)
    this.sharedFileSyncTimers.clear()
    for (const waiter of [...this.waiters]) waiter.fail(new Error('Fleet Run service stopped'))
    for (const recovery of this.networkRecoveries.values()) {
      if (recovery.timer !== undefined) clearTimeout(recovery.timer)
    }
    this.networkRecoveries.clear()
    this.protocolRecoveries.clear()
    for (const timer of this.assistantQuiescenceTimers.values()) clearTimeout(timer)
    this.assistantQuiescenceTimers.clear()
    this.assistantQuiescenceArmed.clear()
    for (const sessionId of [...this.memberToolActivity.keys()]) this.clearMemberActivity(sessionId)
    this.waitingSessionIds.clear()
    this.abnormalSessionIds.clear()
    this.assistantTurnOutputs.clear()
    this.assistantCurrentTurns.clear()
    this.assistantUserFacingTurns.clear()
    this.memberLastSharedTurns.clear()
    this.memberVisibilityReviewedTurns.clear()
    this.visibilityReminderStates.clear()
    this.turnReminderLastShown.clear()
    this.turnStartReminderTurns.clear()
    this.toolResultReminderSequences.clear()
    this.collaboration.close()
    this.dormantRunIds.clear()
    this.manualWakeRequiredRunIds.clear()
    this.teamProjectionEvents.clear()
    this.teamProjectionIdentities.clear()
    this.memberViewSnapshots.clear()
    this.sharedFileVersions.clear()
    this.sharedFileScanErrors.clear()
    this.changeListeners.clear()
    this.traceChangeListeners.clear()
  }

  private watchSharedFiles(record: FleetRunRecord): void {
    if (this.sharedFileWatchers.has(record.id) || isTerminal(record.status)) return
    const directory = join(record.projectRoot, '.fleet', record.id)
    try {
      mkdirSync(directory, { recursive: true })
      const watcher = watch(directory, { recursive: true }, () => {
        this.scheduleSharedFileSync(record.id)
      })
      watcher.on('error', error => {
        this.stopSharedFileWatcher(record.id)
        this.reportSharedFileSyncError(record.id, error)
      })
      watcher.unref()
      this.sharedFileWatchers.set(record.id, watcher)
      this.syncSharedFiles(record)
    } catch (error) {
      this.reportSharedFileSyncError(record.id, error)
    }
  }

  private scheduleSharedFileSync(teamId: string): void {
    const pending = this.sharedFileSyncTimers.get(teamId)
    if (pending !== undefined) clearTimeout(pending)
    const timer = setTimeout(() => {
      this.sharedFileSyncTimers.delete(teamId)
      const record = this.records.get(teamId)
      if (record === undefined || isTerminal(record.status) || !this.collaboration.has(teamId)) return
      this.syncSharedFiles(record)
    }, SHARED_FILE_WATCH_DEBOUNCE_MS)
    timer.unref?.()
    this.sharedFileSyncTimers.set(teamId, timer)
  }

  private syncSharedFiles(record: FleetRunRecord): void {
    try {
      this.synchronizeSharedFiles(record)
      this.sharedFileScanErrors.delete(record.id)
    } catch (error) {
      this.reportSharedFileSyncError(record.id, error)
    }
  }

  private reportSharedFileSyncError(teamId: string, error: unknown): void {
    const message = errorMessage(error)
    if (this.sharedFileScanErrors.get(teamId) === message) return
    this.sharedFileScanErrors.set(teamId, message)
    this.appendEvent(teamId, 'resource.shared_scan_failed', { error: message })
  }

  private stopSharedFileWatcher(teamId: string): void {
    const timer = this.sharedFileSyncTimers.get(teamId)
    if (timer !== undefined) clearTimeout(timer)
    this.sharedFileSyncTimers.delete(teamId)
    this.sharedFileWatchers.get(teamId)?.close()
    this.sharedFileWatchers.delete(teamId)
  }

  private synchronizeSharedFiles(record: FleetRunRecord): void {
    const directory = join(record.projectRoot, '.fleet', record.id)
    const runtime = this.collaboration.get(record.id)
    if (runtime === undefined) return
    const registered = runtime.resources.listResources()
    const byPath = new Map(registered.map(resource => [resolve(resource.path), resource]))
    const versions = this.sharedFileVersions.get(record.id) ?? new Map<string, string>()
    this.sharedFileVersions.set(record.id, versions)
    const seen = new Set<string>()

    const visit = (parent: string): void => {
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        const path = join(parent, entry.name)
        if (entry.isDirectory()) {
          visit(path)
          continue
        }
        if (!entry.isFile()) continue
        let info: ReturnType<typeof statSync>
        try {
          info = statSync(path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        const absolutePath = resolve(path)
        seen.add(absolutePath)
        const name = relative(directory, path).split(sep).join('/')
        const version = `${String(info.mtimeMs)}:${String(info.size)}`
        const previous = versions.get(name)
        const existing = byPath.get(absolutePath)
        versions.set(name, version)
        if (previous === version || (previous === undefined && existing !== undefined
          && (existing.size === undefined || existing.size === info.size))) continue

        runtime.resources.addResource('fleet-filesystem', {
          id: existing?.id ?? `shared:${name}`,
          path,
          label: name,
          ...(existing?.mediaType === undefined ? {} : { mediaType: existing.mediaType }),
          size: info.size,
        })
      }
    }
    if (existsSync(directory)) visit(directory)
    for (const resource of registered) {
      const path = resolve(resource.path)
      if (!pathInside(directory, path) || seen.has(path)) continue
      versions.delete(relative(directory, path).split(sep).join('/'))
      runtime.resources.removeResource('fleet-filesystem', resource.id)
    }
  }

  private async settleFinishedWork(record: FleetRunRecord): Promise<void> {
    let error: string | undefined
    await Promise.all(record.members.map(async member => {
      try {
        await this.core.whenIdle(this.runtimeMemberName(record.id, member.name))
      } catch (idleError) {
        if (!errorMessage(idleError).includes('unknown Fleet Agent')) error ??= errorMessage(idleError)
      }
    }))
    const current = this.requireRecord(record.id)
    if (current.status !== 'finishing' || current.work?.id !== record.work?.id) return
    const idle = this.replaceRecord(record.id, {
      status: 'idle',
      ...(error === undefined ? {} : { error }),
    })
    this.appendEvent(record.id, 'team_status', {
      status: 'idle',
      workId: record.work?.id,
      ...(error === undefined ? {} : { error }),
    })
    this.signalAssistantInteractionDeliveries(idle.id)
    const runtime = this.collaboration.get(idle.id)
    if (runtime !== undefined) {
      for (const assistant of idle.assistants) {
        const agent = this.ctx.agents.get(SessionId(assistant.sessionId))
        if (agent?.status === 'idle') this.continueOwnedTasks(idle.id, runtime, idle, agent)
      }
    }
    this.notify(idle)
  }

  private setTerminal(runId: string, summary: string, callerId: string): FleetRunRecord {
    const current = this.requireRecord(runId)
    if (isTerminal(current.status)) return this.describeRecord(current)
    const terminalSummary = summary.trim()
    if (terminalSummary.length === 0) throw new Error('Fleet team close summary cannot be empty')
    this.clearRunNetworkRecoveries(runId)
    for (const [sessionId, recovery] of [...this.protocolRecoveries]) {
      if (recovery.runId === runId) this.protocolRecoveries.delete(sessionId)
    }
    this.collaboration.get(runId)?.pauseProductivity()
    const endedAt = new Date().toISOString()
    const record = this.replaceRecord(runId, {
      status: 'closed',
      settled: current.members.length === 0,
      endedAt,
      summary: terminalSummary,
      ...(current.work?.status === 'running'
        ? { work: { ...current.work, status: 'cancelled' as const, endedAt, summary: terminalSummary } }
        : {}),
    })
    if (current.work?.status === 'running') {
      this.appendEvent(runId, 'work_status', {
        workId: current.work.id,
        status: 'cancelled',
        summary: terminalSummary,
        callerId,
      })
    }
    this.appendEvent(runId, 'team_status', { status: 'closed', summary: record.summary, callerId })
    this.stopSharedFileWatcher(runId)
    this.forgetTeam(runId)
    if (record.members.length === 0) {
      this.teamProjectionEvents.delete(record.id)
      this.teamProjectionIdentities.delete(record.id)
      this.eventSequences.delete(record.id)
      this.notify(record)
      return this.describeRecord(record)
    }
    for (const member of record.members) {
      try {
        this.core.cancelManaged(this.runtimeMemberName(record.id, member.name), callerId)
      } catch (error) {
        if (!errorMessage(error).includes('unknown Fleet Agent')) throw error
      }
    }
    const finalization = this.finalize(record, callerId)
    this.finalizations.set(record.id, finalization)
    void finalization.then(
      () => { this.finalizations.delete(record.id) },
      () => { this.finalizations.delete(record.id) },
    )
    return this.describeRecord(record)
  }

  private settleInterruptedTerminal(record: FleetRunRecord): FleetRunRecord {
    if (!isTerminal(record.status)) throw new Error(`Fleet run ${record.id} is not terminal`)
    if (record.settled) return this.describeRecord(record)
    this.forgetTeam(record.id)
    const settled = this.replaceRecord(record.id, { settled: true })
    this.appendEvent(record.id, 'team_settled', { recoveredAfterRestart: true })
    this.teamProjectionEvents.delete(record.id)
    this.teamProjectionIdentities.delete(record.id)
    this.eventSequences.delete(record.id)
    this.notify(settled)
    return this.describeRecord(settled)
  }

  private async finalize(record: FleetRunRecord, _callerId: string): Promise<void> {
    let error: string | undefined
    const remember = (failure: unknown): void => { error ??= errorMessage(failure) }
    await Promise.all(record.members.map(async member => {
      try {
        await this.core.whenIdle(this.runtimeMemberName(record.id, member.name))
      } catch (idleError) {
        if (!errorMessage(idleError).includes('unknown Fleet Agent')) remember(idleError)
      }
    }))
    for (const member of record.members) {
      try {
        const agent = this.ctx.agents.get(SessionId(member.sessionId))
        if (agent !== undefined) await this.ctx.sessions.flush(agent.session)
      } catch (flushError) {
        remember(flushError)
      }
    }
    for (const member of record.members) {
      try {
        await this.core.stopManaged(this.runtimeMemberName(record.id, member.name))
      } catch (stopError) {
        if (!errorMessage(stopError).includes('unknown Fleet Agent')) remember(stopError)
      }
    }
    const runtime = this.collaboration.get(record.id)
    for (const assistant of record.assistants) {
      runtime?.detachMember(assistant.sessionId)
      const agent = this.ctx.agents.get(SessionId(assistant.sessionId))
      const requestConfig = agent === undefined ? undefined : this.assistantRequestConfigs.get(agent)
      if (requestConfig !== undefined) requestConfig.current = undefined
    }
    const settled = this.replaceRecord(record.id, {
      settled: true,
      ...(error === undefined ? {} : { error }),
    })
    this.appendEvent(record.id, 'team_settled', error === undefined ? {} : { error })
    this.collaboration.closeTeam(record.id)
    this.teamProjectionEvents.delete(record.id)
    this.teamProjectionIdentities.delete(record.id)
    this.eventSequences.delete(record.id)
    this.notify(settled)
  }

  private requireParticipant(record: FleetRunRecord, caller: Agent): void {
    const callerId = String(caller.id)
    if (record.members.some(member => member.sessionId === callerId)) return
    if (record.assistants.some(assistant => assistant.sessionId === callerId)) {
      this.requireAssistantConnection(caller, record.id)
      return
    }
    throw new Error(`Agent ${callerId} does not belong to Fleet team ${record.id}`)
  }

  private describeRecord(record: FleetRunRecord): FleetRunRecord {
    const live = new Map(this.core.list().map(member => [member.name, member.status]))
    const activeViews = this.collaboration.get(record.id)?.memberViews
    const cachedViews = this.memberViewSnapshots.get(record.id)
    const views = new Map(
      activeViews === undefined
        ? (cachedViews ?? []).map(view => [view.id, view])
        : [...activeViews.entries()],
    )
    const knownAssistantSessions = this.assistantSessionsByView.get(record.id)
    const assistantSessionAliases = record.assistants.flatMap(assistant =>
      [...(knownAssistantSessions?.get(assistant.view.id) ?? new Set([assistant.sessionId]))]
        .map(sessionId => ({ sessionId, currentSessionId: assistant.sessionId })))
    return recordSnapshot({
      ...record,
      runtimeState: this.dormantRunIds.has(record.id) ? 'dormant' : 'active',
      ...(assistantSessionAliases.length === 0 ? {} : { assistantSessionAliases }),
      members: record.members.map(member => {
        const nativeStatus = live.get(this.runtimeMemberName(record.id, member.name))
        const view = views.get(member.name)
        const liveAgent = this.liveMember(member)
        const request = view === undefined
          ? {
              ...((member.provider ?? liveAgent?.options.provider) === undefined
                ? {}
                : { provider: member.provider ?? liveAgent?.options.provider }),
              ...((member.model ?? liveAgent?.options.model) === undefined
                ? {}
                : { model: member.model ?? liveAgent?.options.model }),
              ...(member.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(member.reasoningEffort) }),
              ...((member.maxTokens ?? liveAgent?.options.maxTokens) === undefined
                ? {}
                : { maxTokens: member.maxTokens ?? liveAgent?.options.maxTokens }),
            }
          : this.memberRequestConfig(record, member, view)
        const pausedByTeam = record.status === 'paused' && (record.teamPausedMembers ?? []).includes(member.name)
        const status = pausedByTeam
          ? 'paused'
          : member.status === 'paused' || member.status === 'offline'
          ? member.status
          : this.abnormalSessionIds.has(member.sessionId)
            ? 'error'
            : nativeStatus === 'running' && this.waitingSessionIds.has(member.sessionId)
              ? 'waiting'
              : nativeStatus ?? (isTerminal(record.status) ? 'offline' : 'unknown')
        return {
          ...member,
          ...(request?.provider === undefined ? {} : { provider: request.provider }),
          ...(request?.model === undefined ? {} : { model: request.model }),
          ...(request?.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
          ...(request?.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
          status,
        }
      }),
      assistants: record.assistants.map(assistant => ({
        ...assistant,
        status: assistant.status === 'paused'
          ? 'paused'
          : this.abnormalSessionIds.has(assistant.sessionId)
            ? 'error'
            : this.collaboration.get(record.id)?.memberNamesById.get(assistant.sessionId) === assistant.view.id
              ? this.ctx.agents.get(SessionId(assistant.sessionId))?.status ?? 'offline'
              : 'offline',
      })),
    })
  }

  private requireRecord(runId?: string, projectRoot?: string): FleetRunRecord {
    let id = runId
    if (id === undefined) {
      const candidates = this.activeTeamIds()
        .map(candidate => this.records.get(candidate))
        .filter((record): record is FleetRunRecord => record !== undefined && (
          projectRoot === undefined || record.projectRoot === projectRoot
        ))
      if (candidates.length > 1) throw new Error('run_id is required when more than one Fleet team is active')
      id = candidates[0]?.id
    }
    if (id === undefined && projectRoot !== undefined) {
      const stored = this.list(projectRoot)
      if (stored.length > 1) throw new Error('run_id is required when more than one Fleet team exists')
      id = stored[0]?.id
    }
    if (id === undefined) throw new Error('no Fleet run is available')
    const record = this.records.get(id)
    if (record === undefined) throw new Error(`unknown Fleet run ${id}`)
    return record
  }

  private requireCallerRecord(caller: Agent, runId?: string): FleetRunRecord {
    if (runId !== undefined) return this.requireRecord(runId, caller.session.header.cwd)
    const callerId = String(caller.id)
    const candidates = this.activeTeamIds()
      .map(id => this.records.get(id))
      .filter((record): record is FleetRunRecord => record !== undefined && (
        record.assistants.some(assistant => assistant.sessionId === callerId)
        || record.members.some(member => member.sessionId === callerId)
      ))
    if (candidates.length === 1) return candidates[0] as FleetRunRecord
    if (candidates.length > 1) throw new Error('run_id is required when the caller participates in more than one Fleet team')
    return this.requireRecord(undefined, caller.session.header.cwd)
  }

  private requireMutableRecord(runId?: string, projectRoot?: string): FleetRunRecord {
    const record = this.requireRecord(runId, projectRoot)
    if (isTerminal(record.status)) throw new Error(`Fleet team ${record.id} is ${record.status}`)
    return record
  }

  private requireRuntime(runId: string): FleetCollaborationTeam {
    if (this.dormantRunIds.has(runId)) {
      const record = this.records.get(runId)
      const runtime = this.collaboration.require(runId)
      const connectedAssistant = record?.assistants.some(assistant =>
        this.ctx.agents.get(SessionId(assistant.sessionId)) !== undefined
        && runtime.memberNamesById.get(assistant.sessionId) === assistant.view.id) === true
      if (!connectedAssistant) {
        throw new Error(`Fleet team ${runId} is loaded but its member Agents have not resumed`)
      }
      return runtime
    }
    return this.collaboration.require(runId)
  }

  private activeTeamIds(): string[] {
    return this.collaboration.ids().filter(id => !this.dormantRunIds.has(id))
  }

  private openCollaboration(
    record: FleetRunRecord,
    memberViews: readonly FleetMemberView[],
  ): FleetCollaborationTeam {
    const team = this.collaboration.open({
      id: record.id,
      memberViews: [
        ...memberViews,
        ...record.assistants.map(assistant => assistant.view),
      ],
      assistantIds: record.assistants.map(assistant => assistant.view.id),
      defaultVoters: memberViews.filter(view => view.canVote !== false).map(view => view.id),
      projectRoot: record.projectRoot,
      sharedDirectory: `.fleet/${record.id}`,
      onCoordination: event => { this.recordCoordination(record.id, event) },
      onResource: event => { this.recordResource(record.id, event) },
      onMemberStatus: event => {
        this.appendEvent(record.id, `member_status.${event.action}`, event)
      },
      onTask: (event, state) => {
        this.writeExtensionState(record.id, FLEET_TASK_STATE_NAMESPACE, state as unknown as JsonValue)
        if (event.action !== 'notification') this.appendEvent(record.id, `task.${event.action}`, event)
        this.armAssistantQuiescenceFromTask(record, event.task, event.actor, state)
        if (event.action === 'created'
          || event.action === 'domain_updated'
          || event.action === 'reconcile_ready'
          || event.action === 'reconciled'
          || event.action === 'retrying'
          || event.action === 'signaled'
          || event.action === 'updated'
          || event.action === 'completed'
          || event.action === 'cancelled') {
          queueMicrotask(() => {
            this.reconcileReadyTasks(record.id)
            this.reconcileOwnerTasks(record.id)
            this.finishReadyWork(record.id)
            this.signalAssistantInteractionDeliveries(record.id)
          })
        }
      },
      onSchedule: (event, state) => {
        this.writeExtensionState(record.id, FLEET_SCHEDULE_STATE_NAMESPACE, state as unknown as JsonValue)
        if (event.action !== 'notification') this.appendEvent(record.id, `schedule.${event.action}`, event)
      },
      onCalendar: (event, state) => {
        this.writeExtensionState(record.id, FLEET_CALENDAR_STATE_NAMESPACE, state as unknown as JsonValue)
        this.appendEvent(record.id, `calendar.${event.action}`, event)
      },
    })
    team.restoreProductivity({
      tasks: parseFleetTaskState(this.readExtensionState(record.id, FLEET_TASK_STATE_NAMESPACE)),
      schedules: parseFleetScheduleState(this.readExtensionState(record.id, FLEET_SCHEDULE_STATE_NAMESPACE)),
      calendar: parseFleetCalendarState(this.readExtensionState(record.id, FLEET_CALENDAR_STATE_NAMESPACE)),
    })
    this.watchSharedFiles(record)
    return team
  }

  private runtimeMemberName(runId: string, memberName: string): string {
    return `${runId.replace(/[^a-z0-9]+/g, '-')}-${memberName}`
  }

  private memberArchiveId(runId: string, memberName: string): string {
    return `fleet/${runId}/members/${memberName}`
  }

  private participantSessionIdsForRecord(record: FleetRunRecord, memberName: string): string[] {
    const current = this.participants(record).find(participant => participant.name === memberName)
    if (current === undefined) return []
    const sessionIds: string[] = []
    const add = (sessionId: unknown): void => {
      if (typeof sessionId === 'string' && !sessionIds.includes(sessionId)) sessionIds.push(sessionId)
    }
    for (const event of this.storedEvents(record)) {
      if (event.type === 'member_session_rotated') {
        const data = event.data as { readonly member?: unknown; readonly previousSessionId?: unknown; readonly sessionId?: unknown }
        if (data.member !== memberName) continue
        add(data.previousSessionId)
        add(data.sessionId)
      } else if (event.type === 'assistant_attached' || event.type === 'assistant_rebound') {
        const data = event.data as {
          readonly previousSessionId?: unknown
          readonly sessionId?: unknown
          readonly view?: { readonly id?: unknown }
        }
        if (data.view?.id !== memberName) continue
        add(data.previousSessionId)
        add(data.sessionId)
      }
    }
    add(current.sessionId)
    return sessionIds
  }

  private participants(record: FleetRunRecord): Array<{ readonly name: string; readonly sessionId: string }> {
    return [
      ...record.members.map(member => ({ name: member.name, sessionId: member.sessionId })),
      ...record.assistants.map(assistant => ({ name: assistant.view.id, sessionId: assistant.sessionId })),
    ]
  }

  private assistantTeamForSession(sessionId: string, exceptRunId?: string): FleetRunRecord | undefined {
    return [...this.records.values()].find(record =>
      record.id !== exceptRunId
      && !isTerminal(record.status)
      && record.assistants.some(assistant => assistant.sessionId === sessionId),
    )
  }

  private liveMember(member: FleetRunMember): Agent | undefined {
    if (member.status === 'paused') return undefined
    return this.ctx.agents.get(SessionId(member.sessionId))
  }

  private memberRuntimeOptions(record: FleetRunRecord, view: FleetMemberView) {
    const provider = view.provider ?? record.agentOptions?.provider
    const model = view.model ?? record.agentOptions?.model
    const maxTokens = view.maxTokens ?? record.agentOptions?.maxTokens
    return {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      ...(view.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(view.reasoningEffort) }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    }
  }

  private memberRequestConfig(
    record: FleetRunRecord,
    member: FleetRunMember,
    view: FleetMemberView,
  ): RuntimeRequestConfig | undefined {
    const configured = this.memberRuntimeOptions(record, view)
    const live = this.liveMember(member)
    const provider = configured.provider ?? live?.options.provider
    const model = configured.model ?? live?.options.model
    if (provider === undefined || model === undefined) return undefined
    return {
      provider,
      model,
      ...(configured.reasoningEffort === undefined ? {} : { reasoningEffort: configured.reasoningEffort }),
      ...(configured.maxTokens === undefined
        ? live?.options.maxTokens === undefined ? {} : { maxTokens: live.options.maxTokens }
        : { maxTokens: configured.maxTokens }),
    }
  }

  private assistantRequestConfig(
    assistant: FleetRunAssistant,
    agent: Agent,
  ): RuntimeRequestConfig | undefined {
    const selected = this.assistantRequestConfigs.get(agent)?.current
    if (selected !== undefined) return structuredClone(selected)
    return this.requestConfigForAssistantView(assistant.view, agent)
  }

  private budgetTargetForSession(sessionId: string): {
    readonly record: FleetRunRecord
    readonly member: string
  } | undefined {
    for (const record of this.records.values()) {
      const participant = this.participants(record).find(candidate => candidate.sessionId === sessionId)
      if (participant !== undefined) return { record, member: participant.name }
    }
    return undefined
  }

  private budgetRemaining(record: FleetRunRecord, member: string): {
    readonly remaining?: number
    readonly exhaustedScope?: 'team' | 'member'
  } {
    const team = record.budget?.team
    const participant = budgetMemberAccount(record.budget, member)
    const teamRemaining = team?.limit === undefined
      ? undefined
      : Math.max(0, team.limit - team.used)
    const memberRemaining = participant?.limit === undefined
      ? undefined
      : Math.max(0, participant.limit - participant.used)
    if (teamRemaining === 0) return { remaining: 0, exhaustedScope: 'team' }
    if (memberRemaining === 0) return { remaining: 0, exhaustedScope: 'member' }
    if (teamRemaining === undefined) return memberRemaining === undefined ? {} : { remaining: memberRemaining }
    if (memberRemaining === undefined) return { remaining: teamRemaining }
    return { remaining: Math.min(teamRemaining, memberRemaining) }
  }

  private budgetError(record: FleetRunRecord, member: string, scope: 'team' | 'member'): Error {
    return new Error(scope === 'team'
      ? `Fleet Team ${record.name} budget is exhausted; increase its limit or start a new budget cycle before another model call`
      : `Fleet member ${member} budget is exhausted; increase its limit or reset that member budget before another model call`)
  }

  private budgetOutputUnit(state: FleetTeamBudgetState, provider: string, model: string): number {
    const rate = budgetRate(state.rates, provider, model)
    if (state.mode === 'tokens') return rate?.multiplier ?? 1
    if (rate?.inputUsdPerMillion === undefined || rate.outputUsdPerMillion === undefined
      || rate.cacheReadUsdPerMillion === undefined || rate.cacheWriteUsdPerMillion === undefined) {
      throw new Error(`Fleet cost budget requires prices for ${provider} / ${model}`)
    }
    return rate.outputUsdPerMillion
  }

  private bindBudgetGuard(agent: Agent): void {
    if (this.budgetGuardAgents.has(agent)) return
    const agentCtx = (agent as Agent & { readonly ctx?: Context }).ctx
    if (agentCtx === undefined) return
    this.budgetGuardAgents.add(agent)
    agentCtx.on('agent/request', async (_payload, next) => {
      const target = this.budgetTargetForSession(String(agent.id))
      if (target === undefined) return next()
      const before = this.budgetRemaining(target.record, target.member)
      if (before.exhaustedScope !== undefined) {
        throw this.budgetError(target.record, target.member, before.exhaustedScope)
      }
      const resolved = await next()
      const latest = this.budgetTargetForSession(String(agent.id))
      if (latest === undefined) return resolved
      const budget = this.budgetRemaining(latest.record, latest.member)
      if (budget.exhaustedScope !== undefined) {
        throw this.budgetError(latest.record, latest.member, budget.exhaustedScope)
      }
      const state = latest.record.budget
      if (state === undefined) return resolved
      const outputUnit = this.budgetOutputUnit(state, resolved.provider, resolved.model)
      if (budget.remaining === undefined) return resolved
      if (outputUnit === 0) return resolved
      const affordableOutputTokens = Math.max(1, Math.floor(budget.remaining / outputUnit))
      return {
        ...resolved,
        maxTokens: Math.min(resolved.maxTokens ?? affordableOutputTokens, affordableOutputTokens),
      }
    })
  }

  private recordBudgetUsage(record: FleetRunRecord, member: string, event: SessionEvent): void {
    const charge = budgetUsage(event)
    if (charge === undefined) return
    const startedAt = new Date(event.time).toISOString()
    const current = record.budget ?? { mode: 'tokens', rates: [], team: emptyBudgetAccount(startedAt), members: [] }
    const currentMember = budgetMemberAccount(current, member) ?? emptyBudgetAccount(startedAt)
    const team = addBudgetUsage(current, current.team, charge)
    const participant = addBudgetUsage(current, currentMember, charge)
    this.replaceRecord(record.id, {
      budget: {
        ...current,
        team,
        members: replaceBudgetMember(current.members, member, participant, budgetMemberIdentity(record, member)),
      },
    })
    const transitions = [
      { scope: 'team' as const, before: budgetAccountSnapshot(current.team), after: budgetAccountSnapshot(team) },
      { scope: 'member' as const, before: budgetAccountSnapshot(currentMember), after: budgetAccountSnapshot(participant) },
    ]
    for (const transition of transitions) {
      const crossedWarning = (transition.after.state === 'warning' || transition.after.state === 'danger')
        && transition.before.state !== 'warning' && transition.before.state !== 'danger'
        && transition.before.state !== 'exhausted'
      const crossedExhaustion = transition.after.state === 'exhausted' && transition.before.state !== 'exhausted'
      if (!crossedWarning && !crossedExhaustion) continue
      this.appendEvent(record.id, crossedExhaustion ? 'budget_exhausted' : 'budget_warning', {
        scope: transition.scope,
        ...(transition.scope === 'member' ? { member } : {}),
        used: transition.after.used,
        limit: transition.after.limit,
      })
    }
  }

  private bindParticipantInbox(agent: Agent): void {
    if (this.receiptBoundAgents.has(agent)) return
    this.receiptBoundAgents.add(agent)
    agent.ctx.on('agent/inbox/claimed', ({ message }) => {
      const participantId = String(agent.id)
      const contextMessageId = String(message.id)
      for (const [, team] of this.collaboration.entries()) {
        if (team.messages.markDeliveredContextRead(participantId, contextMessageId)) break
      }
    })
  }

  private requestConfigForAssistantView(
    view: FleetMemberView,
    agent: Agent,
  ): RuntimeRequestConfig | undefined {
    const provider = view.provider ?? agent.options.provider
    const model = view.model ?? agent.options.model
    if (provider === undefined || model === undefined) return undefined
    return {
      provider,
      model,
      ...(view.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(view.reasoningEffort) }),
      ...((view.maxTokens ?? agent.options.maxTokens) === undefined
        ? {}
        : { maxTokens: view.maxTokens ?? agent.options.maxTokens }),
    }
  }

  private requestConfigFromView(view: FleetMemberView): RuntimeRequestConfig | undefined {
    if (view.provider === undefined || view.model === undefined) return undefined
    return {
      provider: view.provider,
      model: view.model,
      ...(view.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(view.reasoningEffort) }),
      ...(view.maxTokens === undefined ? {} : { maxTokens: view.maxTokens }),
    }
  }

  private bindAssistantRequestConfig(
    agent: Agent,
    request: RuntimeRequestConfig | undefined,
    required = false,
  ): AssistantRequestConfigRef | undefined {
    let ref = this.assistantRequestConfigs.get(agent)
    if (ref === undefined) {
      const agentCtx = (agent as Agent & { readonly ctx?: Context }).ctx
      if (agentCtx === undefined) {
        if (required) throw new Error(`Fleet assistant ${String(agent.id)} does not support live request configuration`)
        return undefined
      }
      ref = { current: undefined, assembled: undefined }
      installModelSelection(agentCtx, ref)
      agentCtx.on('agent/request', async (_payload, next) => {
        const resolved = await next()
        const selected = ref?.assembled
        if (selected === undefined) return resolved
        const { maxTokens: _inheritedMaxTokens, ...base } = resolved
        return {
          ...base,
          ...(selected.maxTokens === undefined ? {} : { maxTokens: selected.maxTokens }),
        }
      })
      this.assistantRequestConfigs.set(agent, ref)
    }
    ref.current = request === undefined ? undefined : structuredClone(request)
    return ref
  }

  private async resolveRequestConfiguration(
    current: RuntimeRequestConfig | undefined,
    patch: FleetMemberRequestPatch,
    label: string,
  ): Promise<RuntimeRequestConfig> {
    if (patch.provider === undefined
      && patch.model === undefined
      && patch.reasoningEffort === undefined
      && patch.maxTokens === undefined) {
      throw new Error(`${label} request configuration cannot be empty`)
    }
    const provider = patch.provider === undefined ? current?.provider : patch.provider.trim()
    const model = patch.model === undefined ? current?.model : patch.model.trim()
    if (provider === undefined || provider.length === 0) throw new Error(`${label} request provider is required`)
    if (model === undefined || model.length === 0) throw new Error(`${label} request model is required`)
    let reasoningEffort = current?.reasoningEffort
    if (patch.reasoningEffort === null) reasoningEffort = undefined
    else if (patch.reasoningEffort !== undefined) {
      const effort = patch.reasoningEffort.trim()
      if (effort.length === 0) throw new Error(`${label} request reasoningEffort cannot be empty`)
      reasoningEffort = ReasoningEffortId(effort)
    }
    const maxTokens = patch.maxTokens === undefined
      ? current?.maxTokens
      : patch.maxTokens === null
        ? undefined
        : patch.maxTokens
    if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
      throw new Error(`${label} request maxTokens must be a positive integer`)
    }
    const request: RuntimeRequestConfig = {
      provider,
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    }
    await this.ctx.llm.resolveCallConfig(request)
    return request
  }

  private requestConfiguredView(
    current: FleetMemberView,
    request: RuntimeRequestConfig,
  ): FleetMemberView {
    const {
      provider: _currentProvider,
      model: _currentModel,
      reasoningEffort: _currentReasoningEffort,
      maxTokens: _currentMaxTokens,
      ...base
    } = current
    return normalizedMemberView({
      ...base,
      provider: request.provider,
      model: request.model,
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
      ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    })
  }

  private memberCanReply(member: FleetRunMember): boolean {
    return this.liveMember(member) !== undefined
  }

  private replaceRecord(runId: string, change: Partial<FleetRunRecord>): FleetRunRecord {
    const record = { ...this.requireRecord(runId), ...change }
    this.records.set(runId, record)
    this.writeRecord(record)
    return record
  }

  private writeRecord(record: FleetRunRecord): void {
    const directory = this.runDirectory(record)
    mkdirSync(directory, { recursive: true })
    const target = join(directory, 'run.json')
    const temporary = join(directory, `.run.${process.pid}.tmp`)
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    renameSync(temporary, target)
  }

  private appendEvent(
    runId: string,
    type: string,
    data: unknown,
    options: {
      readonly createdAt?: string
      readonly member?: StoredFleetEvent['member']
    } = {},
  ): void {
    const record = this.requireRecord(runId)
    const sequence = (this.eventSequences.get(runId) ?? this.lastStoredSequence(record)) + 1
    this.eventSequences.set(runId, sequence)
    const event: StoredFleetEvent = {
      sequence,
      createdAt: options.createdAt ?? new Date().toISOString(),
      type,
      data,
      ...(options.member === undefined ? {} : { member: options.member }),
    }
    this.rememberAssistantSessionEvent(runId, event)
    appendFileSync(join(this.runDirectory(record), 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8')
    if (!event.type.startsWith('session.')) {
      this.collaboration.get(runId)?.events.emit('fleet/team/event', { event: structuredClone(event) })
    }
    if (event.type === 'member_view_added' || event.type === 'member_view_updated' || event.type === 'member_view_removed'
      || event.type === 'team_requests_configured') {
      this.memberViewSnapshots.delete(runId)
    }
    const currentIdentities = this.teamProjectionIdentities.get(runId)
    if (currentIdentities !== undefined && !event.type.startsWith('session.')) {
      const update = fleetParticipantIdentities(record, [event])
      this.teamProjectionIdentities.set(runId, {
        stableByReference: new Map([
          ...currentIdentities.stableByReference,
          ...update.stableByReference,
        ]),
        conversationKeyByParticipant: new Map([
          ...currentIdentities.conversationKeyByParticipant,
          ...update.conversationKeyByParticipant,
        ]),
      })
    }
    const projection = this.teamProjectionEvents.get(runId)
    if (projection !== undefined && !event.type.startsWith('session.')) {
      this.cacheTeamProjection(runId, compactTeamProjectionEvents([...projection, event]))
    }
    this.emitChange()
  }

  private emitChange(): void {
    for (const listener of [...this.changeListeners]) listener()
  }

  private cacheTeamProjection(runId: string, projection: StoredFleetEvent[]): void {
    this.teamProjectionEvents.delete(runId)
    this.teamProjectionEvents.set(runId, projection)
    while (this.teamProjectionEvents.size > TEAM_PROJECTION_CACHE_LIMIT) {
      const oldest = this.teamProjectionEvents.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.teamProjectionEvents.delete(oldest)
      this.teamProjectionIdentities.delete(oldest)
      this.memberViewSnapshots.delete(oldest)
    }
  }

  private readWorkTask(record: FleetRunRecord): string {
    if (record.work === undefined) throw new Error(`Fleet team ${record.id} has no work description`)
    return readFileSync(record.work.acceptedTaskPath ?? record.work.taskPath, 'utf8').trim()
  }

  private lastStoredSequence(record: FleetRunRecord): number {
    const path = join(this.runDirectory(record), 'events.jsonl')
    if (!existsSync(path)) return 0
    const descriptor = openSync(path, 'r')
    try {
      let cursor = fstatSync(descriptor).size
      if (cursor === 0) return 0
      const chunks: Buffer[] = []
      while (cursor > 0) {
        const length = Math.min(64 * 1024, cursor)
        cursor -= length
        const chunk = Buffer.allocUnsafe(length)
        let offset = 0
        while (offset < length) {
          const count = readSync(descriptor, chunk, offset, length - offset, cursor + offset)
          if (count === 0) break
          offset += count
        }
        chunks.unshift(offset === length ? chunk : chunk.subarray(0, offset))
        const tail = Buffer.concat(chunks)
        let end = tail.length
        while (end > 0 && (tail[end - 1] === 0x0a || tail[end - 1] === 0x0d)) end -= 1
        const newline = tail.lastIndexOf(0x0a, end - 1)
        if (newline >= 0 || cursor === 0) {
          const line = tail.subarray(newline + 1, end).toString('utf8')
          return line.length === 0 ? 0 : (JSON.parse(line) as StoredFleetEvent).sequence
        }
      }
      return 0
    } finally {
      closeSync(descriptor)
    }
  }

  private storedEvents(record: FleetRunRecord): StoredFleetEvent[] {
    const path = join(this.runDirectory(record), 'events.jsonl')
    return existsSync(path)
      ? parseStoredEvents(readFileSync(path, 'utf8'))
      : []
  }

  private async scanJsonLines(
    path: string,
    signal: AbortSignal | undefined,
    visit: (line: string) => void,
  ): Promise<void> {
    if (!existsSync(path)) return
    const stream = createReadStream(path, { encoding: 'utf8' })
    let pending = ''
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      pending += chunk
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/u, '')
        if (line.length > 0) visit(line)
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
      }
    }
    signal?.throwIfAborted()
    const tail = pending.replace(/\r$/u, '')
    if (tail.length > 0) visit(tail)
  }

  private storedResourceRevision(
    record: FleetRunRecord,
    revisionId: string,
  ): Pick<FleetResourceRevisionDetail, 'before' | 'after'> {
    const path = join(this.runDirectory(record), 'resource-revisions', `${revisionId}.json`)
    if (!existsSync(path) || statSync(path).size > RESOURCE_REVISION_MAX_BYTES + 4_096) {
      throw new Error(`Fleet resource revision ${revisionId} is unavailable`)
    }
    const revision = JSON.parse(readFileSync(path, 'utf8')) as Extract<FleetResourceEvent, { type: 'resource_revised' }>['revision']
    return { before: revision.before, after: revision.after }
  }

  private async readStoredResourceRevision(
    record: FleetRunRecord,
    revisionId: string,
    signal?: AbortSignal,
  ): Promise<Pick<FleetResourceRevisionDetail, 'before' | 'after'>> {
    const path = join(this.runDirectory(record), 'resource-revisions', `${revisionId}.json`)
    if (!existsSync(path) || statSync(path).size > RESOURCE_REVISION_MAX_BYTES + 4_096) {
      throw new Error(`Fleet resource revision ${revisionId} is unavailable`)
    }
    const source = await readFileAsync(path, { encoding: 'utf8', signal })
    signal?.throwIfAborted()
    const revision = JSON.parse(source) as Extract<FleetResourceEvent, { type: 'resource_revised' }>['revision']
    return { before: revision.before, after: revision.after }
  }

  private collaborationState(record: FleetRunRecord, events: readonly StoredFleetEvent[]): {
    readonly coordination: FleetCoordinationEvent[]
    readonly resources: Array<Extract<FleetResourceEvent, { type: 'resource_added' }>['resource']>
    readonly memberStatuses: FleetMemberStatusEvent[]
  } {
    const resources = new Map<string, Extract<FleetResourceEvent, { type: 'resource_added' }>['resource']>()
    for (const event of events) {
      if (event.type === 'resource.resource_added') {
        const resource = (event.data as Extract<FleetResourceEvent, { type: 'resource_added' }>).resource
        resources.set(resource.id, resource)
      } else if (event.type === 'resource.resource_removed') {
        const removal = (event.data as Extract<FleetResourceEvent, { type: 'resource_removed' }>).removal
        resources.delete(removal.resource.id)
      }
    }
    const identities = fleetParticipantIdentities(record, events)
    return {
      coordination: events
        .filter(event => event.type.startsWith('coordination.'))
        .map(event => stableCoordinationEvent(event, identities).data as FleetCoordinationEvent),
      resources: [...resources.values()],
      memberStatuses: events
        .filter(event => event.type === 'member_status.updated' || event.type === 'member_status.cleared')
        .map(event => event.data as FleetMemberStatusEvent),
    }
  }

  private restoredSessionId(events: readonly StoredFleetEvent[], sessionId: string): string {
    let restored = sessionId
    for (const event of events) {
      if (event.type !== 'assistant_rebound') continue
      const data = event.data as { readonly previousSessionId?: string; readonly sessionId: string }
      if (data.previousSessionId === restored) restored = data.sessionId
    }
    return restored
  }

  private loadPersistedTeams(): void {
    if (!existsSync(this.registryDirectory)) return
    for (const entry of readdirSync(this.registryDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      let reference: StoredTeamReference | undefined
      try {
        reference = this.readTeamReference(join(this.registryDirectory, entry.name))
        const directory = join(this.registryDirectory, reference.id)
        const runPath = join(directory, 'run.json')
        const legacyDirectory = join(reference.projectRoot, '.fleet', 'runs', reference.id)
        if (!existsSync(runPath) && existsSync(join(legacyDirectory, 'run.json'))) {
          cpSync(legacyDirectory, directory, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
          const sharedDirectory = join(reference.projectRoot, '.fleet', reference.id)
          mkdirSync(sharedDirectory, { recursive: true })
          for (const name of ['plan.md', 'checklist.md', 'uploads']) {
            const source = join(legacyDirectory, name)
            const target = join(sharedDirectory, name)
            if (existsSync(source) && !existsSync(target)) cpSync(source, target, { recursive: true })
          }
          const legacyRecord = parseStoredRecord(JSON.parse(readFileSync(runPath, 'utf8')) as unknown)
          const migratedRecord: FleetRunRecord = {
            ...legacyRecord,
            configPath: pathInside(legacyDirectory, legacyRecord.configPath)
              ? resolve(directory, relative(legacyDirectory, legacyRecord.configPath))
              : legacyRecord.configPath,
            ...(legacyRecord.work === undefined ? {} : {
              work: {
                ...legacyRecord.work,
                taskPath: pathInside(legacyDirectory, legacyRecord.work.taskPath)
                  ? resolve(directory, relative(legacyDirectory, legacyRecord.work.taskPath))
                  : legacyRecord.work.taskPath,
                ...(legacyRecord.work.acceptedTaskPath === undefined ? {} : {
                  acceptedTaskPath: pathInside(legacyDirectory, legacyRecord.work.acceptedTaskPath)
                    ? resolve(directory, relative(legacyDirectory, legacyRecord.work.acceptedTaskPath))
                    : legacyRecord.work.acceptedTaskPath,
                }),
              },
            }),
          }
          writeFileSync(runPath, `${JSON.stringify(migratedRecord, null, 2)}\n`, 'utf8')
          const eventsPath = join(directory, 'events.jsonl')
          if (existsSync(eventsPath)) {
            writeFileSync(eventsPath, migrateLegacyRunEvents(
              readFileSync(eventsPath, 'utf8'), legacyDirectory, directory, sharedDirectory,
            ), 'utf8')
          }
        }
        if (!existsSync(runPath)) throw new Error(`run record does not exist at ${runPath}`)
        const record = parseStoredRecord(JSON.parse(readFileSync(runPath, 'utf8')) as unknown)
        if (record.id !== reference.id || record.projectRoot !== reference.projectRoot) {
          throw new Error(`Team reference ${reference.id} does not match its run record`)
        }
        if (isTerminal(record.status)) {
          if (!record.settled) {
            this.records.set(record.id, record)
            this.eventSequences.set(record.id, this.lastStoredSequence(record))
            this.settleInterruptedTerminal(record)
            continue
          }
          this.forgetTeam(record.id)
          continue
        }
        this.openDormantTeam(record)
      } catch (error) {
        if (reference !== undefined) {
          this.collaboration.closeTeam(reference.id)
          this.dormantRunIds.delete(reference.id)
          this.records.delete(reference.id)
        }
        this.ctx.logger('dsh-agent-fleet').warn(
          `Could not load persisted Fleet Team reference ${entry.name}: ${errorMessage(error)}`,
        )
      }
    }
  }

  private openDormantTeam(record: FleetRunRecord): void {
    this.records.set(record.id, record)
    const events = this.storedEvents(record)
    this.indexAssistantSessions(record, events)
    this.eventSequences.set(record.id, this.lastStoredSequence(record))
    this.dormantRunIds.add(record.id)
    const runtime = this.openCollaboration(record, this.effectiveMemberViews(record, events))
    for (const member of record.members) {
      runtime.memberIdsByName.set(member.name, member.sessionId)
      runtime.memberNamesById.set(member.sessionId, member.name)
    }
    // Coordination replay can recreate durable Reply Tasks before a
    // resident assistant Session is resumed. Seed its persisted identity now
    // so task assignees resolve during replay; live attachment follows later.
    for (const assistant of record.assistants) {
      runtime.memberIdsByName.set(assistant.view.id, assistant.sessionId)
      runtime.memberNamesById.set(assistant.sessionId, assistant.view.id)
    }
    runtime.restore(this.collaborationState(record, events))
  }

  private indexAssistantSessions(record: FleetRunRecord, events: readonly StoredFleetEvent[]): void {
    const byView = new Map(record.assistants.map(assistant => [
      assistant.view.id,
      new Set([assistant.sessionId]),
    ] as const))
    this.assistantSessionsByView.set(record.id, byView)
    for (const event of events) this.rememberAssistantSessionEvent(record.id, event)
  }

  private rememberAssistantSessionEvent(runId: string, event: StoredFleetEvent): void {
    if (event.type !== 'assistant_attached' && event.type !== 'assistant_rebound') return
    if (typeof event.data !== 'object' || event.data === null) return
    const data = event.data as {
      readonly previousSessionId?: unknown
      readonly sessionId?: unknown
      readonly view?: { readonly id?: unknown }
    }
    if (typeof data.view?.id !== 'string') return
    let byView = this.assistantSessionsByView.get(runId)
    if (byView === undefined) {
      byView = new Map()
      this.assistantSessionsByView.set(runId, byView)
    }
    let sessions = byView.get(data.view.id)
    if (sessions === undefined) {
      sessions = new Set()
      byView.set(data.view.id, sessions)
    }
    if (typeof data.previousSessionId === 'string') sessions.add(data.previousSessionId)
    if (typeof data.sessionId === 'string') sessions.add(data.sessionId)
  }

  private readTeamReference(path: string): StoredTeamReference {
    const value = object(JSON.parse(readFileSync(path, 'utf8')) as unknown, 'Fleet Team reference')
    const id = text(value.id, 'Fleet Team reference id')
    const projectRoot = text(value.projectRoot, 'Fleet Team reference projectRoot')
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`invalid Fleet Team reference id ${id}`)
    if (!isAbsolute(projectRoot)) throw new Error('Fleet Team reference projectRoot must be absolute')
    return { id, projectRoot }
  }

  private rememberTeam(record: FleetRunRecord): void {
    mkdirSync(this.registryDirectory, { recursive: true })
    const target = this.teamReferencePath(record.id)
    const temporary = join(this.registryDirectory, `.${record.id}.${process.pid}.tmp`)
    const reference: StoredTeamReference = { id: record.id, projectRoot: record.projectRoot }
    writeFileSync(temporary, `${JSON.stringify(reference, null, 2)}\n`, 'utf8')
    renameSync(temporary, target)
  }

  private forgetTeam(runId: string): void {
    this.manualWakeRequiredRunIds.delete(runId)
    this.clearAssistantQuiescenceTimer(runId)
    this.clearAssistantQuiescenceArms(runId)
    const path = this.teamReferencePath(runId)
    if (existsSync(path)) unlinkSync(path)
  }

  private teamReferencePath(runId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error(`invalid Fleet run id ${runId}`)
    return join(this.registryDirectory, `${runId}.json`)
  }

  private runDirectory(record: FleetRunRecord): string {
    return join(this.registryDirectory, record.id)
  }

  private extensionStatePath(record: FleetRunRecord, namespace: string): string {
    if (!/^[a-z][a-z0-9-]*$/u.test(namespace)) {
      throw new Error('Fleet extension namespace must use lower-kebab-case')
    }
    return join(this.runDirectory(record), 'extensions', `${namespace}.json`)
  }

  private persistence(): SessionPersistenceLike | undefined {
    return (this.ctx as unknown as { get(name: string): unknown }).get('sessionPersistence') as
      | SessionPersistenceLike
      | undefined
  }

  private requirePersistence(): SessionPersistenceLike {
    const persistence = this.persistence()
    if (persistence === undefined) throw new Error('DSH session persistence is unavailable')
    return persistence
  }

  private notify(record: FleetRunRecord): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.runId === record.id) waiter.finish(record)
    }
  }
}

const RUN_MEMBER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    displayName: { type: 'string' },
    color: { type: 'string' },
    role: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    provider: { type: 'string' },
    model: { type: 'string' },
    reasoningEffort: { type: 'string' },
    maxTokens: { type: 'integer' },
    status: { type: 'string', enum: ['idle', 'running', 'waiting', 'error', 'offline', 'paused', 'unknown'] },
  },
} as const

const MEMBER_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    color: { type: 'string' },
    role: { type: 'string', required: true },
    responsibility: { type: 'string' },
    prompt: { type: 'string', required: true },
    provider: { type: 'string' },
    model: { type: 'string' },
    reasoningEffort: { type: 'string' },
    maxTokens: { type: 'integer' },
    canVote: { type: 'boolean' },
    toolGroups: { type: 'array', required: true, items: { type: 'string' } },
    permissions: { type: 'array', required: true, items: { type: 'string' } },
    contacts: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        members: {
          required: true,
          oneOf: [
            { type: 'string', const: '*' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
        channels: {
          required: true,
          oneOf: [
            { type: 'string', const: '*' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
      },
    },
  },
} as const

const RUN_ASSISTANT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sessionId: { type: 'string', required: true },
    view: { ...MEMBER_VIEW_SCHEMA, required: true },
    status: { type: 'string', enum: ['idle', 'running', 'error', 'offline', 'paused'] },
  },
} as const

const RUN_AGENT_OPTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string' },
    model: { type: 'string' },
    maxTokens: { type: 'integer' },
  },
} as const

const BUDGET_ACCOUNT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer' },
    startedAt: { type: 'string', required: true },
    used: { type: 'integer', required: true },
    inputTokens: { type: 'integer', required: true },
    outputTokens: { type: 'integer', required: true },
    cacheReadTokens: { type: 'integer', required: true },
    cacheWriteTokens: { type: 'integer', required: true },
    reasoningTokens: { type: 'integer', required: true },
    calls: { type: 'integer', required: true },
    unmeteredCalls: { type: 'integer', required: true },
    models: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          charged: { type: 'integer', required: true },
          inputTokens: { type: 'integer', required: true },
          outputTokens: { type: 'integer', required: true },
          cacheReadTokens: { type: 'integer', required: true },
          cacheWriteTokens: { type: 'integer', required: true },
          reasoningTokens: { type: 'integer', required: true },
          calls: { type: 'integer', required: true },
          unmeteredCalls: { type: 'integer', required: true },
        },
      },
    },
  },
} as const

const BUDGET_STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', required: true, enum: ['tokens', 'cost'] },
    rates: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          multiplier: { type: 'number' },
          inputUsdPerMillion: { type: 'number' },
          outputUsdPerMillion: { type: 'number' },
          cacheReadUsdPerMillion: { type: 'number' },
          cacheWriteUsdPerMillion: { type: 'number' },
        },
      },
    },
    team: { ...BUDGET_ACCOUNT_SCHEMA, required: true },
    members: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memberId: { type: 'string', required: true },
          name: { type: 'string' },
          role: { type: 'string' },
          color: { type: 'string' },
          assistant: { type: 'boolean' },
          ...BUDGET_ACCOUNT_SCHEMA.properties,
        },
      },
    },
  },
} as const

const RUN_WORK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    rootTaskId: { type: 'string' },
    taskPath: { type: 'string', required: true },
    acceptedTaskPath: { type: 'string' },
    status: { type: 'string', required: true, enum: ['running', 'finished', 'blocked', 'failed', 'cancelled'] },
    startedAt: { type: 'string', required: true },
    endedAt: { type: 'string' },
    summary: { type: 'string' },
  },
} as const

const RUN_TOOL_WORK_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    rootTaskId: { type: 'string' },
    status: { type: 'string', required: true, enum: ['running', 'finished', 'blocked', 'failed', 'cancelled'] },
    summary: { type: 'string' },
  },
} as const

const RUN_TOOL_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['starting', 'idle', 'running', 'paused', 'finishing', 'closed', 'failed'],
    },
    runtimeState: { type: 'string', enum: ['active', 'dormant'] },
    settled: { type: 'boolean', required: true },
    work: RUN_TOOL_WORK_SUMMARY_SCHEMA,
    summary: { type: 'string' },
    error: { type: 'string' },
  },
} as const

const MEMBER_TOOL_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    role: { type: 'string', required: true },
    responsibility: { type: 'string' },
    status: {
      type: 'string',
      required: true,
      enum: ['idle', 'running', 'waiting', 'error', 'offline', 'paused', 'unknown'],
    },
    provider: { type: 'string' },
    model: { type: 'string' },
    assistant: { type: 'boolean', required: true },
  },
} as const

function fleetRunToolSummary(record: FleetRunRecord) {
  return {
    id: record.id,
    name: record.name,
    status: record.status,
    ...(record.runtimeState === undefined ? {} : { runtimeState: record.runtimeState }),
    settled: record.settled,
    ...(record.work === undefined ? {} : {
      work: {
        id: record.work.id,
        ...(record.work.rootTaskId === undefined ? {} : { rootTaskId: record.work.rootTaskId }),
        status: record.work.status,
        ...(record.work.summary === undefined ? {} : { summary: record.work.summary }),
      },
    }),
    ...(record.summary === undefined ? {} : { summary: record.summary }),
    ...(record.error === undefined ? {} : { error: record.error }),
  }
}

function fleetMemberToolSummaries(
  record: FleetRunRecord,
  views: readonly FleetMemberView[],
  includeAssistants: boolean,
) {
  const viewsById = new Map(views.map(view => [view.id, view]))
  const members = record.members.map(member => {
    const view = viewsById.get(member.name)
    const provider = member.provider ?? view?.provider
    const model = member.model ?? view?.model
    return {
      id: member.name,
      name: member.displayName ?? view?.name ?? member.name,
      role: member.role,
      ...(view?.responsibility === undefined ? {} : { responsibility: view.responsibility }),
      status: member.status ?? 'unknown' as const,
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      assistant: false as const,
    }
  })
  if (!includeAssistants) return members
  return [
    ...members,
    ...record.assistants.map(assistant => ({
      id: assistant.view.id,
      name: assistant.view.name,
      role: assistant.view.role,
      ...(assistant.view.responsibility === undefined ? {} : { responsibility: assistant.view.responsibility }),
      status: assistant.status ?? 'unknown' as const,
      ...(assistant.view.provider === undefined ? {} : { provider: assistant.view.provider }),
      ...(assistant.view.model === undefined ? {} : { model: assistant.view.model }),
      assistant: true as const,
    })),
  ]
}

const RUN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    sourceSetupId: { type: 'string' },
    team: { type: 'string', required: true },
    name: { type: 'string', required: true },
    configPath: { type: 'string', required: true },
    projectRoot: { type: 'string', required: true },
    coordinator: { type: 'string' },
    launcherSessionId: { type: 'string', required: true },
    agentOptions: RUN_AGENT_OPTIONS_SCHEMA,
    members: { type: 'array', required: true, items: RUN_MEMBER_SCHEMA },
    assistants: { type: 'array', required: true, items: RUN_ASSISTANT_SCHEMA },
    budget: BUDGET_STATE_SCHEMA,
    assistantSessionAliases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', required: true },
          currentSessionId: { type: 'string', required: true },
        },
      },
    },
    teamPausedMembers: { type: 'array', items: { type: 'string' } },
    runtimeState: { type: 'string', enum: ['active', 'dormant'] },
    work: RUN_WORK_SCHEMA,
    status: {
      type: 'string',
      required: true,
      enum: ['starting', 'idle', 'running', 'paused', 'finishing', 'closed', 'failed'],
    },
    settled: { type: 'boolean', required: true },
    startedAt: { type: 'string', required: true },
    endedAt: { type: 'string' },
    summary: { type: 'string' },
    error: { type: 'string' },
  },
} as const

const RUN_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['create', 'start', 'pause', 'resume', 'list', 'status', 'close'] },
    runs: { type: 'array', items: RUN_SCHEMA },
    run: RUN_SCHEMA,
    next: { type: 'string' },
  },
} as const

const ARCHIVE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['export', 'import'] },
    path: { type: 'string' },
    teamId: { type: 'string' },
    includesWorkspace: { type: 'boolean' },
    extensions: { type: 'array', items: { type: 'string' } },
    missingExtensions: { type: 'array', items: { type: 'string' } },
    failedExtensions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          error: { type: 'string', required: true },
        },
      },
    },
    run: RUN_SCHEMA,
  },
} as const

const TRACE_EVENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sequence: { type: 'integer', required: true },
    createdAt: { type: 'string', required: true },
    scope: { type: 'string', required: true, enum: ['team', 'member'] },
    member: { type: 'string' },
    sourceSequence: { type: 'integer' },
    type: { type: 'string', required: true },
    data: { type: 'string', required: true },
  },
} as const

const TRACE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    runId: { type: 'string', required: true },
    member: { type: 'string' },
    events: { type: 'array', required: true, items: TRACE_EVENT_SCHEMA },
    hasMore: { type: 'boolean', required: true },
  },
} as const

const PROGRESS_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sequence: { type: 'integer', required: true },
    createdAt: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['output', 'tool_call', 'tool_result', 'error'] },
    name: { type: 'string' },
    text: { type: 'string' },
  },
} as const

const PROGRESS_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    runId: { type: 'string', required: true },
    member: { type: 'string', required: true },
    displayName: { type: 'string' },
    runtimeStatus: {
      type: 'string',
      required: true,
      enum: ['idle', 'running', 'waiting', 'error', 'offline', 'paused', 'unknown'],
    },
    items: { type: 'array', required: true, items: PROGRESS_ITEM_SCHEMA },
    cursor: { type: 'integer', required: true },
    hasMore: { type: 'boolean', required: true },
  },
} as const

const ACTIVITY_ITEM_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, sequence: { type: 'integer', required: true },
    createdAt: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['message', 'task', 'calendar', 'meeting', 'vote', 'document', 'schedule', 'member'] },
    type: { type: 'string', required: true }, acknowledged: { type: 'boolean', required: true },
    data: { type: 'object', required: true, additionalProperties: true },
  },
} as const

const ACTIVITY_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'ack'] },
    runId: { type: 'string', required: true }, member: { type: 'string', required: true },
    items: { type: 'array', items: ACTIVITY_ITEM_SCHEMA }, item: ACTIVITY_ITEM_SCHEMA,
    hasMore: { type: 'boolean' },
  },
} as const

const MESSAGE_SEND_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    messageId: { type: 'string', required: true },
    recipients: { type: 'integer', required: true },
    delivered: { type: 'integer', required: true },
    woken: { type: 'integer', required: true },
    replyTaskIds: { type: 'array', items: { type: 'string' } },
    audienceHint: { type: 'string' },
  },
} as const

const MESSAGE_ACTION_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {},
} as const

const MEMBER_MANAGEMENT_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', required: true, enum: ['list', 'add', 'update', 'configure', 'configure_all', 'pause', 'resume', 'remove'] },
    run: { oneOf: [RUN_SCHEMA, RUN_TOOL_SUMMARY_SCHEMA] }, member: RUN_MEMBER_SCHEMA,
    members: { type: 'array', items: { oneOf: [RUN_MEMBER_SCHEMA, MEMBER_TOOL_SUMMARY_SCHEMA] } },
    views: { type: 'array', items: MEMBER_VIEW_SCHEMA },
    request: {
      type: 'object',
      additionalProperties: false,
      properties: {
        provider: { type: 'string', required: true },
        model: { type: 'string', required: true },
        reasoningEffort: { type: 'string' },
        maxTokens: { type: 'integer' },
      },
    },
    effectiveFrom: { type: 'string', const: 'next-model-step' },
    memberConfigurations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, properties: {
          member: { ...RUN_MEMBER_SCHEMA, required: true },
          request: {
            type: 'object', required: true, additionalProperties: false, properties: {
              provider: { type: 'string', required: true }, model: { type: 'string', required: true },
              reasoningEffort: { type: 'string' }, maxTokens: { type: 'integer' },
            },
          },
          effectiveFrom: { type: 'string', required: true, const: 'next-model-step' },
        },
      },
    },
    assistantConfigurations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, properties: {
          assistant: { ...RUN_ASSISTANT_SCHEMA, required: true },
          request: {
            type: 'object', required: true, additionalProperties: false, properties: {
              provider: { type: 'string', required: true }, model: { type: 'string', required: true },
              reasoningEffort: { type: 'string' }, maxTokens: { type: 'integer' },
            },
          },
          effectiveFrom: { type: 'string', required: true, const: 'next-model-step' },
        },
      },
    },
  },
} as const

const ASSISTANT_MESSAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    messageId: { type: 'string', required: true },
    runId: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['collaboration', 'directive'] },
    text: { type: 'string', required: true },
    recipients: { type: 'array', required: true, items: { type: 'string' } },
    stages: {
      type: 'array', required: true, items: {
        type: 'object', additionalProperties: false, properties: {
          key: { type: 'string', required: true },
          kind: { type: 'string', required: true, enum: ['goal', 'vote'] },
          title: { type: 'string', required: true },
          description: { type: 'string', required: true },
          owners: { type: 'array', required: true, items: { type: 'string' } },
          dependencies: { type: 'array', required: true, items: { type: 'string' } },
          timeoutAt: { type: 'string' },
        },
      },
    },
    assistantSessionId: { type: 'string', required: true },
    assistantId: { type: 'string', required: true },
    assistantName: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
  },
} as const

const ASSISTANT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['activate', 'deactivate', 'observe', 'message', 'configure'] },
    run: { oneOf: [RUN_SCHEMA, RUN_TOOL_SUMMARY_SCHEMA] },
    members: { type: 'array', items: MEMBER_TOOL_SUMMARY_SCHEMA },
    assistant: RUN_ASSISTANT_SCHEMA,
    request: {
      type: 'object', additionalProperties: false, properties: {
        provider: { type: 'string', required: true }, model: { type: 'string', required: true },
        reasoningEffort: { type: 'string' }, maxTokens: { type: 'integer' },
      },
    },
    effectiveFrom: { type: 'string', const: 'next-model-step' },
    mode: {
      type: 'object',
      additionalProperties: false,
      properties: {
        active: { type: 'boolean', required: true },
        phase: { type: 'string', required: true, enum: ['inactive', 'meta', 'setup', 'operating'] },
        sessionId: { type: 'string', required: true },
        tools: { type: 'array', required: true, items: { type: 'string' } },
        setupId: { type: 'string' },
        runId: { type: 'string' },
        view: MEMBER_VIEW_SCHEMA,
      },
    },
    message: ASSISTANT_MESSAGE_SCHEMA,
    events: { type: 'array', items: TRACE_EVENT_SCHEMA },
    hasMore: { type: 'boolean' },
  },
} as const

const FLEXIBLE_OBJECT_SCHEMA = {
  type: 'object', additionalProperties: true, properties: {},
} as const

const USER_TASK_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['status', 'update', 'continue', 'take_over', 'report', 'block'] },
    task: { ...FLEXIBLE_OBJECT_SCHEMA, required: true },
    goals: { type: 'array', items: FLEXIBLE_OBJECT_SCHEMA },
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function callingAgent(agent: Agent | undefined, tool: string): Agent {
  if (agent === undefined) throw new Error(`${tool} requires a calling Agent`)
  return agent
}

export function installRunTools(
  ctx: Context,
  service: FleetRunService,
  assistant: FleetAssistantRuntime,
): void {
  ctx.tools.register(defineTool({
    name: 'fleet_send',
    description: 'Send one quiet Fleet message to the smallest necessary audience. Use only an exact private recipient from the current roster. The private route alone does not require a reply; repeating that exact recipient identity in the message text, or using an equivalent structural mention, creates one Reply Task. Use a Channel only when its full audience needs the exact content. Unmentioned messages create no Reply Task.',
    parameters: {
      to: { type: 'string', required: true, description: 'Use @fleet-name or @agent-id to route a private message, #channel for Team-visible history, or meeting:id. Routing alone does not require a reply.' },
      message: { type: 'string', required: true, description: 'Self-contained message text.' },
      mentions: { type: 'array', items: { type: 'string' }, description: 'Structural Reply Task targets merged with valid @mentions parsed from the message text.' },
      reply_mode: { type: 'string', enum: ['required', 'optional'], description: 'Compatibility shortcut for private messages. Optional is the default; required structurally mentions the routed recipient.' },
      reply_to: { type: 'string', description: 'Stable Fleet message id in the same conversation.' },
      resources: { type: 'array', items: { type: 'string' }, description: 'Resource ids supplied by the Resources module.' },
    },
    output: jsonOutput(MESSAGE_SEND_RESULT_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_send')
      const mentions = args.reply_mode === 'required' && String(args.to).startsWith('@')
        ? [...new Set([String(args.to), ...(args.mentions ?? [])])]
        : args.mentions
      return Promise.resolve(service.sendConversationMessage(caller, {
        to: args.to as `@${string}` | `#${string}` | `meeting:${string}`,
        text: args.message,
        delivery: 'quiet',
        ...(mentions === undefined ? {} : { mentions }),
        ...(args.reply_to === undefined ? {} : { replyTo: args.reply_to }),
        ...(args.resources === undefined ? {} : { resources: args.resources }),
      }))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_user_task',
    description: 'Operate the calling assistant persistent foreground Interaction Task. Update intentionally delivers one mid-turn progress message without settling or waking the Task. Continue retains existing live waits and may add formal Team-owned Tasks. Take_over grants this assistant a revision-fenced project-execution lease for an explicit direct-execution exception. Call report/block before the final answer, then emit it exactly once; Fleet commits and delivers the last native output at turn end.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'update', 'continue', 'take_over', 'report', 'block'] },
      run_id: { type: 'string', description: 'Persistent Team id. Defaults to the Team containing the calling assistant.' },
      reason: { type: 'string', description: 'Required for continue, take_over, report, and block.' },
      report: { type: 'string', description: 'Exact foreground result recorded for bookkeeping. Required for report and block; do not emit it before this tool call.' },
      message: { type: 'string', description: 'For update, the intentional mid-turn message delivered to the user. Do not repeat the final answer.' },
      task_ids: { type: 'array', items: { type: 'string' }, description: 'For continue, optional additional live Tasks owned by formal Team members. Omit to retain existing live waits.' },
      title: { type: 'string', description: 'For continue with instructions, title of the new Goal.' },
      instructions: { type: 'string', description: 'For continue, concrete work for a new formal-member Goal.' },
      owners: { type: 'array', items: { type: 'string' }, description: 'For continue with instructions, one or more formal Team members.' },
      check_after_seconds: { type: 'integer', description: 'For continue, deterministic progress-check deadline. Defaults to 300 seconds.' },
    },
    output: jsonOutput(USER_TASK_RESULT_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_user_task')
      if (args.action === 'status') {
        return Promise.resolve({ action: 'status' as const, task: fleetTaskToolDetail(service.assistantInteraction(caller, args.run_id)) })
      }
      if (args.action === 'update') {
        if (args.message === undefined) throw new Error('fleet_user_task update requires message')
        const task = service.updateAssistantInteraction(caller, {
          ...(args.run_id === undefined ? {} : { runId: args.run_id }),
          message: args.message,
        })
        if (task.domain.kind !== 'interaction') throw new Error('fleet_user_task update returned a non-Interaction Task')
        return Promise.resolve({
          action: 'update' as const,
          task: {
            state: task.stableState.kind,
            revision: task.domain.inputRevision,
            delivered: true,
          },
        })
      }
      if (args.reason === undefined) throw new Error(`fleet_user_task ${args.action} requires reason`)
      if (args.action === 'continue') {
        if (args.instructions !== undefined && (args.owners === undefined || args.owners.length === 0)) {
          throw new Error('fleet_user_task continue with instructions requires owners')
        }
        const continued = service.continueAssistantInteraction(caller, {
          ...(args.run_id === undefined ? {} : { runId: args.run_id }),
          reason: args.reason,
          ...(args.task_ids === undefined ? {} : { taskIds: args.task_ids }),
          ...(args.instructions === undefined ? {} : {
            goal: {
              title: args.title ?? 'Continue foreground user request',
              description: args.instructions,
              owners: args.owners ?? [],
            },
          }),
          ...(args.check_after_seconds === undefined ? {} : { checkAfterSeconds: args.check_after_seconds }),
        })
        return Promise.resolve({
          action: 'continue' as const,
          task: fleetTaskToolDetail(continued.task),
          goals: continued.goals.map(fleetTaskToolSummary),
        })
      }
      if (args.action === 'take_over') {
        return Promise.resolve({
          action: 'take_over' as const,
          task: fleetTaskToolDetail(service.takeOverAssistantInteraction(caller, {
            ...(args.run_id === undefined ? {} : { runId: args.run_id }),
            reason: args.reason,
          })),
        })
      }
      if (args.report === undefined) throw new Error(`fleet_user_task ${args.action} requires report`)
      const task = service.reportAssistantInteraction(caller, {
        ...(args.run_id === undefined ? {} : { runId: args.run_id }),
        outcome: args.action === 'report' ? 'complete' : 'block',
        reason: args.reason,
        report: args.report,
      })
      if (task.domain.kind !== 'interaction') throw new Error('fleet_user_task report returned a non-Interaction Task')
      return Promise.resolve({
        action: args.action,
        task: {
          state: task.stableState.kind,
          revision: task.domain.inputRevision,
          next: task.domain.reportIntent === undefined
            ? 'end_turn_without_more_output'
            : 'emit_native_output_once',
        },
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_run',
    description: 'Control the outer Fleet Team lifecycle. Start atomically creates a planned Goal/Vote DAG, links its root to the foreground Interaction, and makes that Interaction dormant; after a successful start, end the turn without fleet_user_task continue/status. Successful plans complete their zero-owner root automatically.',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'start', 'pause', 'resume', 'list', 'status', 'close'] },
      run_id: { type: 'string', description: 'Persistent Team workflow id. Defaults to the active Team where supported.' },
      team_config: { type: 'string', description: 'Team JSON path required for create.' },
      task: { type: 'string', description: 'Work Markdown path required for start.' },
      directive: { type: 'string', description: 'Concise kickoff summary stored with the work.' },
      result_stage: { type: 'string', description: 'Stage key whose Goal result becomes the successful root result. Defaults to the last Goal stage.' },
      stages: {
        type: 'array',
        description: 'Complete initial Goal/Vote DAG created atomically with the work root.',
        items: {
          type: 'object', additionalProperties: false, properties: {
            key: { type: 'string', required: true },
            kind: { type: 'string', enum: ['goal', 'vote'] },
            title: { type: 'string', required: true },
            description: { type: 'string' },
            owners: { type: 'array', required: true, items: { type: 'string' } },
            dependencies: { type: 'array', items: { type: 'string' } },
            timeout_at: { type: 'string' },
          },
        },
      },
      cwd: { type: 'string', description: 'Team project root. Defaults to the calling session cwd, which remains the only workspace source.' },
      required_paths: { type: 'array', items: { type: 'string' }, description: 'Optional paths that must exist before Team creation.' },
      provider: { type: 'string', description: 'Optional default provider route for every member, used only by create.' },
      model: { type: 'string', description: 'Optional default model for every member, used only by create.' },
      max_tokens: { type: 'integer', description: 'Optional positive output-token limit per member request, used only by create.' },
      summary: { type: 'string', description: 'Team shutdown summary required for close.' },
    },
    output: jsonOutput(RUN_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_run')
      const callerRoot = caller.session.header.cwd
      if (args.action === 'list') return { action: 'list' as const, runs: service.list(callerRoot) }
      if (args.action === 'status') {
        return { action: 'status' as const, run: service.status(args.run_id, callerRoot) }
      }
      if (args.action === 'close') {
        if (args.summary === undefined) throw new Error('fleet_run close requires summary')
        return { action: 'close' as const, run: service.end(caller, args.summary, args.run_id) }
      }
      if (args.action === 'pause') {
        return { action: 'pause' as const, run: await service.pauseTeam(caller, args.run_id) }
      }
      if (args.action === 'resume') {
        if (args.run_id === undefined) throw new Error('fleet_run resume requires run_id')
        const current = service.status(args.run_id, args.cwd ?? caller.session.header.cwd)
        if (current.status === 'paused' && current.runtimeState === 'active') {
          return { action: 'resume' as const, run: await service.resumeTeam(caller, args.run_id) }
        }
        const projectRoot = args.cwd ?? caller.session.header.cwd
        if (projectRoot === undefined || !isAbsolute(projectRoot)) {
          throw new Error('fleet_run resume requires an absolute cwd or a calling session cwd')
        }
        const run = await service.resume(caller, { runId: args.run_id, projectRoot })
        const view = run.assistants.find(candidate => candidate.sessionId === String(caller.id))?.view
        assistant.activate(caller, run.id, view)
        service.agentSessionStarted(caller)
        return { action: 'resume' as const, run }
      }
      const projectRoot = args.cwd ?? caller.session.header.cwd
      if (projectRoot === undefined || !isAbsolute(projectRoot)) {
        throw new Error(`fleet_run ${args.action} requires an absolute cwd or a calling session cwd`)
      }
      if (args.action === 'create') {
        if (args.team_config === undefined) throw new Error('fleet_run create requires team_config')
        const run = await service.create(caller, {
            configPath: args.team_config,
            projectRoot,
            requiredPaths: args.required_paths ?? [],
            ...(args.provider === undefined ? {} : { provider: args.provider }),
            ...(args.model === undefined ? {} : { model: args.model }),
            ...(args.max_tokens === undefined ? {} : { maxTokens: args.max_tokens }),
          })
        const view = run.assistants.find(candidate => candidate.sessionId === String(caller.id))?.view
        assistant.activate(caller, run.id, view)
        service.agentSessionStarted(caller)
        return { action: 'create' as const, run }
      }
      if (args.task === undefined) throw new Error('fleet_run start requires task')
      return {
        action: 'start' as const,
        run: service.start(caller, {
          ...(args.run_id === undefined ? {} : { runId: args.run_id }),
          taskPath: args.task,
          projectRoot,
          ...(args.directive === undefined ? {} : { directive: args.directive }),
          ...(args.result_stage === undefined ? {} : { resultStage: args.result_stage }),
          ...(args.stages === undefined ? {} : {
            stages: args.stages.map(stage => ({
              key: stage.key,
              kind: stage.kind ?? 'goal',
              title: stage.title,
              description: stage.description ?? '',
              owners: stage.owners,
              dependencies: stage.dependencies ?? [],
              ...(stage.timeout_at === undefined ? {} : { timeoutAt: stage.timeout_at }),
            })),
          }),
        }),
        next: 'end_turn_without_fleet_user_task_continue_or_status',
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_archive',
    description: 'Export or import a complete paused Fleet Team archive. Shared documents and member Sessions are always included; workspace files are optional.',
    parameters: {
      action: { type: 'string', required: true, enum: ['export', 'import'] },
      run_id: { type: 'string', description: 'Paused Team id required for export.' },
      path: { type: 'string', required: true, description: 'Archive file path to write or read.' },
      cwd: { type: 'string', description: 'Target project root required for import. Relative paths resolve from the calling Session cwd.' },
      include_workspace: { type: 'boolean', description: 'For export, include the project workspace. Defaults to false.' },
      import_mode: {
        type: 'string',
        enum: ['copy', 'restore'],
        description: 'For import, create new Team and Session ids (copy, default) or preserve archive ids (restore).',
      },
    },
    output: jsonOutput(ARCHIVE_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_archive')
      if (args.action === 'export') {
        if (args.run_id === undefined) throw new Error('fleet_archive export requires run_id')
        const exported = await service.exportArchive(caller, {
          runId: args.run_id,
          destination: args.path,
          includeWorkspace: args.include_workspace ?? false,
        })
        return {
          action: 'export' as const,
          path: exported.path,
          teamId: exported.teamId,
          includesWorkspace: exported.includesWorkspace,
          extensions: [...exported.extensions],
        }
      }
      if (args.cwd === undefined) throw new Error('fleet_archive import requires cwd')
      const imported = await service.importArchive(caller, {
        archivePath: args.path,
        projectRoot: args.cwd,
        mode: args.import_mode ?? 'copy',
      })
      return {
        action: 'import' as const,
        run: imported.run,
        missingExtensions: [...imported.extensions.missing],
        failedExtensions: [...imported.extensions.failed],
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_assistant',
    description: 'Activate or leave a user-facing Fleet member, hot-configure its next model step, observe a Team, or relay external collaboration input and explicit directions through its operator path. Activation installs the assistant persona and its configured Fleet member tools for this foreground Session.',
    parameters: {
      action: { type: 'string', required: true, enum: ['activate', 'deactivate', 'observe', 'message', 'configure'] },
      run_id: { type: 'string', description: 'Persistent Team workflow id. Defaults to the active Team.' },
      kind: { type: 'string', enum: ['collaboration', 'directive'], description: 'Message intent. Collaboration preserves normal flow; directive is an explicit controller direction.' },
      text: { type: 'string', description: 'Message to relay to the Team coordinator. Required for message.' },
      recipients: { type: 'array', items: { type: 'string' }, description: 'For message, specific member ids or names to mention. When stages are supplied, Fleet derives recipients from owners of stages without dependencies.' },
      stages: {
        type: 'array',
        description: 'For a new-work directive, the ordered first cohort of Goal work and Vote decisions. Dependencies reference earlier stage keys; Fleet creates the zero-owner composite root and this cohort atomically, then initially wakes only ready owners.',
        items: {
          type: 'object', additionalProperties: false, properties: {
            key: { type: 'string', required: true, description: 'Unique stable key for this stage.' },
            kind: { type: 'string', enum: ['goal', 'vote'], description: 'Goal work by default; Vote for an explicit approve/reject gate.' },
            title: { type: 'string', required: true, description: 'Concise child Task title.' },
            description: { type: 'string', description: 'Expected evidence, or the exact decision statement for a Vote stage.' },
            owners: { type: 'array', required: true, items: { type: 'string' }, description: 'Goal owners or Vote voters.' },
            dependencies: { type: 'array', items: { type: 'string' }, description: 'Earlier stage keys that must complete before these owners wake.' },
            timeoutAt: { type: 'string', description: 'Optional ISO deadline with a deterministic blocked fallback.' },
          },
        },
      },
      after_sequence: { type: 'integer', description: 'For observe, return durable Team events after this sequence. Defaults to 0.' },
      limit: { type: 'integer', description: 'For observe, return from 1 through 200 compact event summaries. Defaults to 5; data is clipped to 300 characters. Use fleet_trace for detailed events.' },
      assistant_id: { type: 'string', description: 'Existing assistant id to rebind after a restart; omit to add a new assistant.' },
      name: { type: 'string', description: 'Persistent assistant name used when adding a new assistant.' },
      color: { type: 'string', description: 'Persistent assistant color in #RRGGBB.' },
      role: { type: 'string', description: 'Team role for a new assistant.' },
      responsibility: { type: 'string', description: 'Long-term responsibility for a new assistant.' },
      prompt: { type: 'string', description: 'Additional role instructions for a new assistant.' },
      tool_groups: { type: 'array', items: { type: 'string' }, description: 'Core Fleet tool groups granted to a new assistant.' },
      permissions: { type: 'array', items: { type: 'string' }, description: 'Registered namespaced actions granted to a new assistant.' },
      request: {
        type: 'object',
        additionalProperties: false,
        description: 'Partial next-model-step request configuration for the attached assistant. Null clears reasoning_effort or max_tokens.',
        properties: {
          provider: { type: 'string' },
          model: { type: 'string' },
          reasoning_effort: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          max_tokens: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      },
    },
    output: jsonOutput(ASSISTANT_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_assistant')
      const projectRoot = caller.session.header.cwd
      if (args.action === 'activate') {
        const attached = await service.attachAssistant(caller, {
          ...(args.run_id === undefined ? {} : { runId: args.run_id }),
          ...(projectRoot === undefined ? {} : { projectRoot }),
          ...(args.assistant_id === undefined ? {} : { assistantId: args.assistant_id }),
          ...(args.name === undefined ? {} : { name: args.name }),
          ...(args.color === undefined ? {} : { color: args.color }),
          ...(args.role === undefined ? {} : { role: args.role }),
          ...(args.responsibility === undefined ? {} : { responsibility: args.responsibility }),
          ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
          ...(args.tool_groups === undefined ? {} : { toolGroups: args.tool_groups }),
          ...(args.permissions === undefined ? {} : { permissions: args.permissions }),
        })
        const mode = assistant.activate(caller, attached.run.id, attached.assistant.view)
        service.agentSessionStarted(caller)
        return {
          action: 'activate' as const,
          run: attached.run,
          mode,
        }
      }
      if (args.action === 'deactivate') {
        const mode = assistant.status(caller)
        const run = service.detachAssistant(caller, args.run_id ?? mode.runId)
        return Promise.resolve({ action: 'deactivate' as const, run, mode: assistant.deactivate(caller) })
      }
      if (args.action === 'message') {
        if (args.text === undefined) throw new Error('fleet_assistant message requires text')
        const message = service.sendAssistantMessage(caller, {
          ...(args.run_id === undefined ? {} : { runId: args.run_id }),
          kind: args.kind ?? 'collaboration',
          text: args.text,
          ...(args.recipients === undefined ? {} : { recipients: args.recipients }),
          ...(args.stages === undefined ? {} : { stages: args.stages }),
          ...(projectRoot === undefined ? {} : { projectRoot }),
        })
        return Promise.resolve({
          action: 'message' as const,
          run: service.status(message.runId, projectRoot),
          message,
        })
      }
      if (args.action === 'configure') {
        if (args.request === undefined) throw new Error('fleet_assistant configure requires request')
        const record = service.status(args.run_id, projectRoot)
        const configured = await service.configureAssistant(caller, {
          runId: record.id,
          request: {
            ...(args.request.provider === undefined ? {} : { provider: args.request.provider }),
            ...(args.request.model === undefined ? {} : { model: args.request.model }),
            ...(args.request.reasoning_effort === undefined
              ? {}
              : { reasoningEffort: args.request.reasoning_effort }),
            ...(args.request.max_tokens === undefined ? {} : { maxTokens: args.request.max_tokens }),
          },
        })
        return { action: 'configure' as const, run: service.status(record.id), ...configured }
      }
      const afterSequence = args.after_sequence ?? 0
      const limit = args.limit ?? 5
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new Error('after_sequence must be a non-negative integer')
      }
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw new Error('limit must be an integer from 1 through 200')
      }
      const trace = service.readTrace(args.run_id, afterSequence, limit, projectRoot)
      const record = service.status(trace.runId, projectRoot)
      return Promise.resolve({
        action: 'observe' as const,
        run: fleetRunToolSummary(record),
        members: fleetMemberToolSummaries(record, service.memberViews(record.id), true),
        events: trace.events.map(event => ({
          ...event,
          data: clippedProgressText(event.data, 300),
        })),
        hasMore: trace.hasMore,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_trace',
    description: 'Read the durable Fleet collaboration timeline, or one member\'s native DSH Session events, in sequence order.',
    parameters: {
      run_id: { type: 'string', description: 'Run id. Defaults to the active run.' },
      member: { type: 'string', description: 'Optional Fleet member name; omit for Team collaboration events.' },
      after_sequence: { type: 'integer', description: 'Return events after this sequence. Defaults to -1 for member Session events and 0 for Team events.' },
      limit: { type: 'integer', description: 'Maximum events from 1 through 200. Defaults to 10; event data is clipped to 2000 characters.' },
    },
    output: jsonOutput(TRACE_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_trace')
      const projectRoot = caller.session.header.cwd
      const limit = args.limit ?? 10
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('limit must be an integer from 1 through 200')
      if (args.after_sequence !== undefined && (!Number.isSafeInteger(args.after_sequence) || args.after_sequence < -1)) {
        throw new Error('after_sequence must be an integer greater than or equal to -1')
      }
      return args.member === undefined
        ? service.readTrace(args.run_id, args.after_sequence ?? 0, limit, projectRoot)
        : service.readMemberTrace(args.run_id, args.member, args.after_sequence ?? -1, limit, projectRoot)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_progress',
    description: 'Read one reachable Team member\'s current runtime state and bounded recent output without exposing full private context. When waiting for new progress, pass the previous cursor as after_sequence and wait_ms instead of repeating snapshots.',
    parameters: {
      run_id: { type: 'string', description: 'Team id; inferred when the caller belongs to exactly one active Team.' },
      member: { type: 'string', required: true, description: 'Member id, display name, or @member to inspect.' },
      after_sequence: { type: 'integer', description: 'Return progress after this cursor. Omit to read the latest items.' },
      limit: { type: 'integer', description: 'Maximum progress items from 1 through 10. Defaults to 5.' },
      include_outputs: { type: 'boolean', description: 'Include clipped tool arguments and results. Defaults to false.' },
      max_output_chars_per_item: { type: 'integer', description: 'Maximum text per item from 100 through 2000 characters. Defaults to 800.' },
      wait_ms: { type: 'integer', description: 'Wait up to 60000 ms for progress after after_sequence. Use this instead of polling unchanged state.' },
    },
    output: jsonOutput(PROGRESS_RESULT_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_progress')
      const options = {
        ...(args.after_sequence === undefined ? {} : { afterSequence: args.after_sequence }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.include_outputs === undefined ? {} : { includeOutputs: args.include_outputs }),
        ...(args.max_output_chars_per_item === undefined
          ? {}
          : { maxCharsPerItem: args.max_output_chars_per_item }),
      }
      if (args.wait_ms === undefined) return service.readMemberProgress(caller, args.run_id, args.member, options)
      if (args.after_sequence === undefined) throw new Error('fleet_progress wait_ms requires after_sequence')
      return service.waitMemberProgress(caller, args.run_id, args.member, {
        ...options,
        afterSequence: args.after_sequence,
        waitMs: args.wait_ms,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_activity',
    description: 'Read the calling member\'s unified Team activity inbox derived from the durable Fleet journal, or acknowledge one activity item.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'ack'] },
      run_id: { type: 'string', description: 'Team id; inferred when the caller belongs to exactly one active Team.' },
      sequence: { type: 'integer', description: 'Activity sequence required for ack.' },
      after_sequence: { type: 'integer', description: 'List activity after this Team sequence.' },
      limit: { type: 'integer', description: 'Maximum 1 through 100 items. Defaults to 20; Task activity uses bounded Task summaries.' },
      unread_only: { type: 'boolean', description: 'Return only unacknowledged activity.' },
    },
    output: jsonOutput(ACTIVITY_RESULT_SCHEMA),
    execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_activity')
      if (args.action === 'ack') {
        if (args.sequence === undefined) throw new Error('fleet_activity ack requires sequence')
        const item = service.acknowledgeActivity(caller, args.sequence, args.run_id)
        const record = service.status(args.run_id, caller.session.header.cwd)
        const member = service.memberViews(record.id).find(view =>
          record.members.some(runMember => runMember.name === view.id && runMember.sessionId === String(caller.id))
          || record.assistants.some(assistant => assistant.view.id === view.id && assistant.sessionId === String(caller.id)),
        )?.id
        if (member === undefined) throw new Error('calling Agent is not attached to this Fleet Team')
        return Promise.resolve({ action: 'ack' as const, runId: record.id, member, item })
      }
      const inbox = service.activityInbox(caller, {
        ...(args.run_id === undefined ? {} : { runId: args.run_id }),
        ...(args.after_sequence === undefined ? {} : { afterSequence: args.after_sequence }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
        ...(args.unread_only === undefined ? {} : { unreadOnly: args.unread_only }),
      })
      return Promise.resolve({ action: 'list' as const, ...inbox })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_member',
    description: 'List or dynamically add, update, configure, pause, resume, and remove formal Fleet Team members. Configure changes only the next model step without pausing or restarting; configure_all applies one patch to every member and attached assistant in one validated operation.',
    parameters: {
      action: { type: 'string', required: true, enum: ['list', 'add', 'update', 'configure', 'configure_all', 'pause', 'resume', 'remove'] },
      run_id: { type: 'string', description: 'Team id.' },
      member: { type: 'string', description: 'Member id required for update, configure, pause, resume, or remove.' },
      include_configuration: { type: 'boolean', description: 'For list, include complete member views such as prompts, tools, permissions, and contacts. Defaults to false.' },
      view: { ...MEMBER_VIEW_SCHEMA, description: 'Complete member view required for add or update.' },
      request: {
        type: 'object',
        additionalProperties: false,
        description: 'Partial next-model-step request configuration. Null clears reasoning_effort or max_tokens.',
        properties: {
          provider: { type: 'string' },
          model: { type: 'string' },
          reasoning_effort: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          max_tokens: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      },
    },
    output: jsonOutput(MEMBER_MANAGEMENT_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_member')
      const record = service.status(args.run_id, caller.session.header.cwd)
      if (args.action === 'list') {
        const ids = new Set(record.members.map(member => member.name))
        const views = service.memberViews(record.id).filter(view => ids.has(view.id))
        return {
          action: 'list' as const,
          run: fleetRunToolSummary(record),
          members: fleetMemberToolSummaries(record, views, false),
          ...(args.include_configuration === true ? { views } : {}),
        }
      }
      if (args.action === 'add') {
        if (args.view === undefined) throw new Error('fleet_member add requires view')
        const member = await service.addMember(caller, { runId: record.id, view: args.view as FleetMemberView })
        return { action: 'add' as const, run: service.status(record.id), member }
      }
      if (args.action === 'configure_all') {
        if (args.request === undefined) throw new Error('fleet_member configure_all requires request')
        const configured = await service.configureTeam(caller, {
          runId: record.id,
          request: {
            ...(args.request.provider === undefined ? {} : { provider: args.request.provider }),
            ...(args.request.model === undefined ? {} : { model: args.request.model }),
            ...(args.request.reasoning_effort === undefined
              ? {}
              : { reasoningEffort: args.request.reasoning_effort }),
            ...(args.request.max_tokens === undefined ? {} : { maxTokens: args.request.max_tokens }),
          },
        })
        return { action: 'configure_all' as const, run: service.status(record.id), ...configured }
      }
      if (args.member === undefined) throw new Error(`fleet_member ${args.action} requires member`)
      if (args.action === 'configure') {
        if (args.request === undefined) throw new Error('fleet_member configure requires request')
        const configured = await service.configureMember(caller, {
          runId: record.id,
          member: args.member,
          request: {
            ...(args.request.provider === undefined ? {} : { provider: args.request.provider }),
            ...(args.request.model === undefined ? {} : { model: args.request.model }),
            ...(args.request.reasoning_effort === undefined
              ? {}
              : { reasoningEffort: args.request.reasoning_effort }),
            ...(args.request.max_tokens === undefined ? {} : { maxTokens: args.request.max_tokens }),
          },
        })
        return { action: 'configure' as const, run: service.status(record.id), ...configured }
      }
      if (args.action === 'pause' || args.action === 'resume') {
        const member = args.action === 'pause'
          ? await service.pauseMember(caller, record.id, args.member)
          : await service.resumeMember(caller, record.id, args.member)
        return { action: args.action, run: service.status(record.id), member }
      }
      if (args.action === 'update') {
        if (args.view === undefined) throw new Error('fleet_member update requires view')
        const member = await service.updateMember(caller, {
          runId: record.id,
          member: args.member,
          view: args.view as FleetMemberView,
        })
        return { action: 'update' as const, run: service.status(record.id), member }
      }
      const member = await service.removeMember(caller, record.id, args.member)
      return { action: 'remove' as const, run: service.status(record.id), member }
    },
  }))
}
