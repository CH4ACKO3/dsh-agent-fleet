import type { ChangeEvent, ComponentType, CSSProperties, FocusEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent, ReactElement, ReactNode, WheelEvent as ReactWheelEvent } from 'react'
import { Component, Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import type { Context } from '@deepseek-ai/cordis'
import type { HoverHintTriggerProps } from 'dsh-hover-hint'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  FLEET_WEB_PEER_LOCAL,
  FLEET_WEB_REMOTE,
  type FleetWebClient,
} from '@dsh-agent-fleet/core/web'
import { encodeFleetActivation } from '@dsh-agent-fleet/core/activation'
import {
  FleetChatAvatar,
  FleetChatComment,
  FleetChatMessage,
  FleetConversationHeader,
  FleetInfoHint,
  FleetPresenceLabel,
  fleetMemberPresence,
  fleetMemberPresenceLabel,
  type FleetChatContentBlock,
  type FleetChatMember,
  type FleetChatMentionBlock,
  type FleetChatResourceBlock,
  type FleetChatReceiptSource,
  type FleetRuntimeMember,
} from './runtime-chat.js'
import {
  FleetMemberPopover,
  FleetMemberPopoverCard,
  FleetMemberStatusUpdatedAt,
  type FleetMemberPopoverProps,
  type FleetMemberPopoverTriggerProps,
} from './member-popover.js'
import { useFleetAnchoredPopover } from './anchored-popover.js'
import { installPanelStyles, panelText, fleetPanelMemberIsOnline, publishFleetTeamSettingsRequest, subscribeFleetTeamSettingsRequest, completeFleetTeamSettingsRequest, getFleetTeamSettingsRequest, setFleetTeamSettingsRequest, incrementFleetTeamSettingsSequence, type TeamSettingsTab } from './panel-utils.js'
import { PanelIcon, HarmonyBrandIcon, type PanelIconName } from './panel-icons.js'
import { PanelColumnResizeHandle, PanelMessageLog, rememberBounded } from './panel-log.js'
import {
  configureFleetActivationSessions,
  configureFleetActivationWorkspaces,
  getCurrentFleetSessionId,
  subscribeCurrentFleetSession,
  type FleetActivationClientSessions,
  type FleetActivationClientWorkspaces,
} from './activation.js'
import {
  configureFleetMetaAssistantClient,
  configureFleetMetaAssistantLocale,
  configureFleetMetaAssistantTeams,
  type FleetMetaClientSessions,
  type FleetMetaClientWorkspaces,
  type FleetMetaWelcomeState,
  useFleetMetaAssistantSession,
  useFleetMetaWelcome,
} from './meta-assistant.js'
import {
  FLEET_LOCALE_NAMESPACE,
  type FleetLocaleRuntime,
  fleetLocaleDictionaries,
  isChineseLocale,
  selectedFleetLocale,
} from './locale.js'
import { createFleetWebPanelSource } from './fleet-web-source.js'
import { configureFleetWebClient } from './web-client.js'
import { fleetConfigurationModules } from './configuration-modules.js'
import { createFleetTutorialPanelSource, FLEET_TUTORIAL_TEAM_ID } from './tutorial-team.js'
import {
  AgentFleetPrivateChat,
  type AgentFleetConversationIdentity,
} from './assistant-private-chat.js'
import {
  FLEET_CHAT_COLUMN_DEFAULT_WIDTH as CHAT_COLUMN_DEFAULT_WIDTH,
  FLEET_CHAT_COLUMN_MAX_WIDTH as CHAT_COLUMN_MAX_WIDTH,
  FLEET_CHAT_COLUMN_MIN_WIDTH as CHAT_COLUMN_MIN_WIDTH,
  FLEET_PANEL_PREFERENCES_KEY as PANEL_PREFERENCES_KEY,
  useFleetChatColumnWidth,
} from './chat-column-width.js'
import {
  completeFleetPanelNavigation,
  getFleetPanelNavigationRequest,
  requestFleetPanelNavigation,
  subscribeFleetPanelNavigation,
} from './panel-navigation.js'
import {
  FleetComposerAttachmentButton,
  FleetComposerAttachmentList,
  fleetComposerMessageText,
  useFleetComposerAttachments,
} from './composer-attachments.js'
import {
  getFleetOperatorProfile,
  updateFleetOperatorProfile,
  useFleetOperatorProfile,
} from './operator-profile.js'
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  MAIN_MIN_WIDTH,
  usePaneResize,
  PaneResizeHandle,
} from './panel-pane.js'

const RENDER_ENGINE_STYLE_ID = 'dsh-agent-fleet-render-engine'





export type FleetPanelToolId = 'chat' | 'team' | 'agent' | 'resources' | 'activity' | (string & {})

export interface FleetPanelConversation {
  readonly id: string
  readonly kind: 'channel' | 'direct' | 'cross-team'
  readonly name: string
  readonly topic?: string
  readonly unread?: number
  readonly peerId?: string
  /** Stable Fleet member ids participating in a member-to-member direct conversation. */
  readonly participantIds?: readonly string[]
  readonly participantTeamIds?: readonly string[]
  readonly memberCount?: number
  readonly activeCount?: number
}

export interface FleetPanelMember extends FleetRuntimeMember {
  readonly responsibility: string
  /** Short, self-declared description of the work this member is currently doing. */
  readonly statusText?: string
  /** ISO timestamp of the latest self-declared status update. */
  readonly statusUpdatedAt?: string
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly maxTokens?: number
  /** The native DSH Session owned by this persistent Fleet member. */
  readonly sessionId?: string
  /** Conversations visible from this member's runtime perspective. Omit to expose the Team snapshot. */
  readonly visibleConversationIds?: readonly string[]
}

export interface FleetPanelPermissionGroup {
  readonly id: string
  readonly name: string
  readonly parents: readonly string[]
  readonly preset: boolean
  readonly toolGroups: readonly string[]
  readonly denyToolGroups: readonly string[]
  readonly actions: readonly string[]
  readonly denies: readonly string[]
  readonly op?: boolean
}

export interface FleetPanelMemberPermissionAssignment {
  readonly groups: readonly string[]
  readonly grants: readonly string[]
  readonly denies: readonly string[]
  readonly toolGroups: readonly string[]
  readonly denyToolGroups: readonly string[]
  readonly op: boolean
}

export interface FleetPanelMemberAuthorization {
  readonly groups: readonly FleetPanelPermissionGroup[]
  readonly assignment: FleetPanelMemberPermissionAssignment
  readonly availableActions: readonly string[]
  readonly availableToolGroups: readonly string[]
  readonly effectiveActions: readonly string[]
  readonly effectiveToolGroups: readonly string[]
  readonly op: boolean
  readonly configured: boolean
}

export type FleetPanelAccessLevel = 'read' | 'write' | 'use' | 'manage'
export type FleetPanelAccessMode = 'inherit' | 'restricted'
export type FleetPanelAccessScope = 'self' | 'tree'
export type FleetPanelAccessEffect = 'allow' | 'deny'

export interface FleetPanelMemberAccessRule {
  readonly id: string
  readonly resourceKind: string
  readonly resourceId: string
  readonly scope: FleetPanelAccessScope
  readonly effect: FleetPanelAccessEffect
  readonly levels: readonly FleetPanelAccessLevel[]
}

export interface FleetPanelMemberAccess {
  readonly resourceKinds: readonly string[]
  readonly modes: readonly {
    readonly resourceKind: string
    readonly mode: FleetPanelAccessMode
  }[]
  readonly rules: readonly FleetPanelMemberAccessRule[]
}

export interface FleetPanelMessage {
  readonly id: string
  readonly sequence?: number
  readonly conversationId: string
  readonly senderId: string
  readonly senderTeamId?: string
  readonly sender?: FleetChatMember
  readonly sentAt: string
  readonly content: readonly FleetChatContentBlock[]
  readonly kind?: string
  readonly replyTo?: string
  readonly receipt?: {
    readonly visibleMemberIds: readonly string[]
    readonly readMemberIds: readonly string[]
    readonly unreadMemberIds: readonly string[]
    readonly deliveredMemberIds?: readonly string[]
    readonly pendingMemberIds?: readonly string[]
    readonly pendingDeliveries?: readonly FleetPanelPendingDelivery[]
    readonly sources?: readonly FleetChatReceiptSource[]
  }
}

export interface FleetPanelMessageThread {
  readonly message: FleetPanelMessage
  readonly comments: readonly FleetPanelMessage[]
}

export interface FleetPanelPendingDelivery {
  readonly memberId: string
  readonly reason?: 'no_active_session' | 'inbox_delivery_failed' | 'participant_retired'
  readonly detail?: string
  readonly blockedAt?: string
}

export interface FleetPanelResource {
  readonly id: string
  readonly name: string
  readonly kind: 'plan' | 'checklist' | 'file'
  readonly path: string
  readonly detail: string
  readonly size?: number
  readonly mediaType?: string
  readonly body?: string
  readonly updatedAt?: string
}

export interface FleetPanelResourceContent {
  readonly id: string
  readonly kind: 'markdown' | 'text'
  readonly body: string
  readonly mediaType?: string
  readonly size?: number
  readonly history: readonly FleetPanelResourceRevisionSummary[]
  readonly historyTruncated: boolean
  readonly revision?: FleetPanelResourceRevision
}

export interface FleetPanelResourceRevisionSummary {
  readonly id: string
  readonly updatedBy: string
  readonly updatedAt: string
  readonly operation: 'created' | 'updated'
  readonly available: boolean
  readonly size: number
}

export interface FleetPanelResourceRevision extends FleetPanelResourceRevisionSummary {
  readonly before: string | null
  readonly after: string
}

export interface FleetPanelWorkspace {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly access: 'read' | 'write'
  readonly members: readonly string[]
}

export interface FleetPanelActivity {
  readonly id: string
  readonly kind: 'message' | 'resource' | 'decision' | 'member' | 'memory'
  readonly type?: string
  readonly data?: unknown
  readonly text: string
  readonly createdAt: string
}

export interface FleetPanelAssistantInteractionTurn {
  readonly revision: number
  readonly messageId?: string
  readonly input: string
  readonly inputAt: string
  readonly updates?: readonly FleetPanelAssistantInteractionUpdate[]
  readonly output?: string
  readonly outputAt?: string
}

export interface FleetPanelAssistantInteractionUpdate {
  readonly id: string
  readonly text: string
  readonly sentAt: string
}

export interface FleetPanelAssistantInteraction {
  readonly assistantId: string
  readonly pending: boolean
  readonly turns: readonly FleetPanelAssistantInteractionTurn[]
}

export interface FleetPanelTeamSnapshot {
  readonly teamId: string
  readonly teamName: string
  readonly color?: string
  readonly unread?: number
  readonly status: 'starting' | 'idle' | 'running' | 'paused' | 'finishing' | 'closed' | 'failed' | 'disconnected'
  readonly runtimeState?: 'active' | 'dormant' | 'candidate'
  readonly tutorial?: boolean
  readonly conversations: readonly FleetPanelConversation[]
  readonly members: readonly FleetPanelMember[]
  /** User-facing assistants attached to this Team; the global Fleet Help assistant is intentionally excluded. */
  readonly assistants?: readonly FleetPanelMember[]
  /** Direct user exchanges only; background Session turns stay in the native context view. */
  readonly assistantInteractions?: readonly FleetPanelAssistantInteraction[]
  readonly messages: readonly FleetPanelMessage[]
  readonly resources: readonly FleetPanelResource[]
  readonly workspaces?: readonly FleetPanelWorkspace[]
  readonly activity: readonly FleetPanelActivity[]
  readonly budget: FleetPanelTeamBudget
}

export interface FleetPanelTeamSummary {
  readonly teamId: string
  readonly teamName: string
  readonly assistantConnections?: readonly {
    readonly assistantId: string
    readonly assistantName?: string
    readonly sessionId: string
  }[]
  readonly assistantSessionIds?: readonly string[]
  readonly assistantSessionAliases?: Readonly<Record<string, string>>
  readonly assistantParticipantIds?: Readonly<Record<string, string>>
  readonly color?: string
  readonly unread?: number
  readonly needsAttention?: boolean
  readonly primaryWorkspace?: string
  readonly status: FleetPanelTeamSnapshot['status']
  readonly runtimeState?: 'active' | 'dormant' | 'candidate'
  /** Runtime states of ordinary Team members; assistants are intentionally excluded. */
  readonly memberStatuses?: readonly NonNullable<FleetPanelMember['runtimeStatus']>[]
  readonly tutorial?: boolean
}

export interface FleetPanelTeamRunControl {
  readonly action: 'load' | 'pause' | 'resume' | 'wake'
  readonly label: string
  readonly busyLabel: string
  readonly title: string
}

export function fleetPanelMemberIsUnloaded(status: FleetPanelMember['runtimeStatus']): boolean {
  return status === undefined || status === 'unknown' || status === 'offline'
}

function fleetPanelTeamIsControllable(status: FleetPanelTeamSummary['status']): boolean {
  return status !== 'closed' && status !== 'failed' && status !== 'disconnected'
}

export function fleetPanelTeamRunControls(
  team: Pick<FleetPanelTeamSummary, 'status' | 'runtimeState' | 'memberStatuses'>,
): readonly FleetPanelTeamRunControl[] {
  if (!fleetPanelTeamIsControllable(team.status)) return []
  const statuses = team.memberStatuses ?? []
  const controls: FleetPanelTeamRunControl[] = []
  if (statuses.some(fleetPanelMemberIsUnloaded)) {
    controls.push({
      action: 'load',
      label: panelText('加载团队', 'Load Team'),
      busyLabel: panelText('正在加载…', 'Loading…'),
      title: panelText('加载所有未加载且未暂停的成员；已加载和已暂停的成员保持不变', 'Load every unloaded, unpaused member while leaving loaded and paused members unchanged'),
    })
  }
  if (team.status === 'paused') {
    controls.push({
      action: 'resume',
      label: panelText('继续团队', 'Resume Team'),
      busyLabel: panelText('正在继续…', 'Resuming…'),
      title: panelText('解除由整队暂停产生的成员暂停，但不发送接续指令', 'Resume members paused with the Team without sending a continuation instruction'),
    })
  }
  if ((team.status === 'idle' || team.status === 'running' || team.status === 'paused')
    && statuses.some(status => status !== 'paused' && !fleetPanelMemberIsUnloaded(status))) {
    controls.push({
      action: 'pause',
      label: panelText('暂停团队', 'Pause Team'),
      busyLabel: panelText('正在暂停…', 'Pausing…'),
      title: panelText('暂停所有已加载且尚未暂停的普通成员；团队助理和未加载成员不受影响', 'Pause every loaded, unpaused ordinary member; Team assistants and unloaded members are unaffected'),
    })
  }
  controls.push({
    action: 'wake',
    label: panelText('唤醒成员', 'Wake members'),
    busyLabel: panelText('正在唤醒…', 'Waking…'),
    title: panelText('加载并解除所有普通成员的暂停，然后向全体成员和助理发送接续指令', 'Load and resume every ordinary member, then send a continuation instruction to all members and assistants'),
  })
  return controls
}

export interface FleetPanelTeamGroup {
  readonly id: string
  readonly name: string
  readonly teamIds: readonly string[]
  readonly kind: 'favorites' | 'custom' | 'ungrouped' | 'archived'
}

export interface FleetPanelTeamDirectory {
  readonly teams: readonly FleetPanelTeamSummary[]
  readonly groups: readonly FleetPanelTeamGroup[]
}

export interface FleetPanelSnapshot {
  readonly directory: FleetPanelTeamDirectory
  readonly selectedTeamId?: string
  readonly team?: FleetPanelTeamSnapshot
  readonly connection?: {
    readonly status: 'loading' | 'connected' | 'disconnected'
    readonly error?: string
    readonly updatedAt?: string
  }
}

export interface FleetPanelMemberTraceEvent {
  readonly sequence: number
  readonly sessionId?: string
  readonly createdAt: string
  readonly type: string
  readonly data: string
  readonly target?: boolean
}

export interface FleetPanelMemberTrace {
  readonly events: readonly FleetPanelMemberTraceEvent[]
  readonly truncated: boolean
  readonly previous?: { readonly segment: number; readonly beforeSeq: number }
}

export interface FleetPanelConversationPage {
  readonly messages: readonly FleetPanelMessage[]
  readonly hasMore: boolean
  readonly previousSequence?: number
}

export interface FleetPanelMemberTraceRequest {
  readonly cursor?: { readonly segment: number; readonly beforeSeq: number }
  readonly source?: FleetChatReceiptSource
}

export interface FleetPanelSendInput {
  readonly sessionId: string
  readonly teamId: string
  readonly conversationId: string
  readonly content: readonly FleetChatContentBlock[]
  readonly delivery?: 'quiet' | 'wakeup' | 'interrupt'
  readonly mentions?: readonly string[]
}

export interface FleetPanelUploadInput {
  readonly sessionId: string
  readonly teamId: string
  readonly file: File
}

export interface FleetPanelRemoveResourceInput {
  readonly sessionId: string
  readonly teamId: string
  readonly resourceId: string
}

export interface FleetPanelTeamControlInput {
  readonly sessionId: string
  readonly teamId: string
  readonly action: 'load' | 'pause' | 'resume' | 'wake' | 'close' | 'detach'
  readonly summary?: string
}

export interface FleetPanelTeamSettings {
  readonly name: string
  readonly positioning: string
  readonly rules: string
  readonly collaborationMethod: string
  readonly visibilityReminderContextGrowthTokens: number
  readonly updateDensity: 'concise' | 'balanced' | 'detailed'
  readonly notificationPolicy: 'decisions' | 'milestones' | 'continuous'
  readonly contentPreference: string
  readonly projectRoot: string
  readonly budget: FleetPanelTeamBudget
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

export type FleetPanelBudgetState = 'unlimited' | 'normal' | 'warning' | 'danger' | 'exhausted'
export type FleetPanelBudgetMode = 'tokens' | 'cost'

export interface FleetContextPressure {
  readonly projectedTokens?: number
  readonly pressureTokens?: number
  readonly contextWindow?: number
}

export interface FleetContextBreakdown {
  readonly systemTokens: number
  readonly toolsTokens: number
  readonly messageTokens: number
}

export type FleetContextProjectionHook = <Selection = unknown>(
  name: string,
  selector?: (snapshot: unknown) => Selection,
) => Selection | undefined

export interface FleetContextOccupancy {
  readonly percent: number
  readonly usedTokens: number
  readonly contextWindow: number
}

export interface FleetPanelBudgetModelRate {
  readonly provider: string
  readonly model: string
  readonly multiplier?: number
  readonly inputUsdPerMillion?: number
  readonly outputUsdPerMillion?: number
  readonly cacheReadUsdPerMillion?: number
  readonly cacheWriteUsdPerMillion?: number
}

export interface FleetPanelBudgetModelUsage {
  readonly provider: string
  readonly model: string
  readonly charged: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly calls: number
  readonly unmeteredCalls: number
}

export interface FleetPanelBudgetAccount {
  readonly limit?: number
  readonly startedAt: string
  readonly used: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
  readonly calls: number
  readonly unmeteredCalls: number
  readonly models: readonly FleetPanelBudgetModelUsage[]
  readonly remaining?: number
  readonly state: FleetPanelBudgetState
}

export interface FleetPanelParticipantBudget extends FleetPanelBudgetAccount {
  readonly memberId: string
  readonly name: string
  readonly role: string
  readonly color?: string
  readonly assistant: boolean
  readonly active: boolean
}

export interface FleetPanelTeamBudget {
  readonly mode: FleetPanelBudgetMode
  readonly rates: readonly FleetPanelBudgetModelRate[]
  readonly configuredModels: readonly { readonly provider: string; readonly model: string }[]
  readonly team: FleetPanelBudgetAccount
  readonly members: readonly FleetPanelParticipantBudget[]
}

export interface FleetPanelTeamSettingsInput {
  readonly sessionId: string
  readonly teamId: string
  readonly settings: Omit<FleetPanelTeamSettings, 'projectRoot' | 'request' | 'budget'>
}

export interface FleetPanelBudgetInput {
  readonly sessionId: string
  readonly teamId: string
  readonly scope: 'team' | 'member'
  readonly member?: string
  readonly limit?: number | null
  readonly reset?: true
  readonly accounting?: {
    readonly mode: FleetPanelBudgetMode
    readonly rates: readonly FleetPanelBudgetModelRate[]
  }
}

export interface FleetPanelTeamRequestInput {
  readonly sessionId: string
  readonly teamId: string
  readonly request: {
    readonly provider?: string
    readonly model?: string
    readonly reasoningEffort?: string | null
    readonly maxTokens?: number | null
  }
}

export interface FleetPanelMemberRequestInput {
  readonly sessionId: string
  readonly teamId: string
  readonly memberId: string
  readonly assistant: boolean
  readonly request: FleetPanelTeamRequestInput['request']
}

export interface FleetPanelMemberControlInput {
  readonly sessionId: string
  readonly teamId: string
  readonly memberId: string
  readonly action: 'pause' | 'resume' | 'wake'
}

export interface FleetPanelMemberRunControl {
  readonly action: FleetPanelMemberControlInput['action']
  readonly label: string
  readonly busyLabel: string
  readonly title: string
  readonly primary?: boolean
}

export function FleetRunControlButton({ label, displayLabel, hint, primary, disabled, busy, onClick }: {
  readonly label: string
  readonly displayLabel: string
  readonly hint: string
  readonly primary?: boolean
  readonly disabled: boolean
  readonly busy: boolean
  readonly onClick: () => void
}): ReactElement {
  return jsx(FleetInfoHint, {
    label: `${label}：${hint}`,
    title: label,
    pinOnClick: false,
    footer: null,
    trigger: (hintProps: HoverHintTriggerProps) => jsx('button', {
      ref: hintProps.ref as (element: HTMLButtonElement | null) => void,
      type: 'button',
      className: 'dsh-fleet-panel-control-button',
      'data-primary': primary === true ? 'true' : undefined,
      disabled,
      'aria-busy': busy ? 'true' : undefined,
      'aria-label': `${label}：${hint}`,
      onClick,
      children: displayLabel,
    }),
    children: jsx('p', { className: 'dsh-hover-hint-lead', children: hint }),
  })
}

export function fleetPanelMemberRunControls(
  member: Pick<FleetPanelMember, 'runtimeStatus'>,
  assistant: boolean,
  teamStatus: FleetPanelTeamSnapshot['status'],
): readonly FleetPanelMemberRunControl[] {
  if (!fleetPanelTeamIsControllable(teamStatus)) return []
  const status = member.runtimeStatus
  const unloaded = fleetPanelMemberIsUnloaded(status)
  const paused = status === 'paused'
  const controls: FleetPanelMemberRunControl[] = []
  if (unloaded || paused) {
    controls.push({
      action: 'resume',
      label: paused
        ? (assistant ? panelText('继续助理', 'Resume assistant') : panelText('继续成员', 'Resume member'))
        : (assistant ? panelText('加载助理', 'Load assistant') : panelText('加载成员', 'Load member')),
      busyLabel: paused ? panelText('正在继续…', 'Resuming…') : panelText('正在加载…', 'Loading…'),
      title: paused
        ? panelText('解除这位成员的暂停，但不发送接续指令', 'Resume this member without sending a continuation instruction')
        : panelText('只加载这位成员的持久化会话，不影响其他成员', 'Load only this member’s persisted Session without changing other members'),
      primary: true,
    })
  }
  if (!assistant && !paused && !unloaded) {
    controls.push({
      action: 'pause',
      label: panelText('暂停成员', 'Pause member'),
      busyLabel: panelText('正在暂停…', 'Pausing…'),
      title: panelText('打断、保存并暂停这位成员', 'Interrupt, save, and pause this member'),
    })
  } else if (assistant && status === 'running') {
    controls.push({
      action: 'pause',
      label: panelText('打断助理', 'Interrupt assistant'),
      busyLabel: panelText('正在打断…', 'Interrupting…'),
      title: panelText('只打断助理当前回合，不会将助理设为暂停', 'Interrupt the assistant’s current turn without pausing it'),
    })
  }
  controls.push({
    action: 'wake',
    label: assistant ? panelText('唤醒助理', 'Wake assistant') : panelText('唤醒成员', 'Wake member'),
    busyLabel: panelText('正在唤醒…', 'Waking…'),
    title: panelText('必要时先加载并解除暂停，然后发送接续指令', 'Load and resume this member if needed, then send a continuation instruction'),
  })
  return controls
}

export interface FleetPanelMemberPermissionInput {
  readonly sessionId: string
  readonly teamId: string
  readonly memberId: string
  readonly assignment?: FleetPanelMemberPermissionAssignment
  readonly reset?: boolean
}

export interface FleetPanelMemberAccessTarget {
  readonly sessionId: string
  readonly teamId: string
  readonly memberId: string
}

export type FleetPanelMemberAccessChange =
  | { readonly action: 'set_mode'; readonly resourceKind: string; readonly mode: FleetPanelAccessMode }
  | {
    readonly action: 'add_rule'
    readonly resourceKind: string
    readonly resourceId: string
    readonly scope: FleetPanelAccessScope
    readonly effect: FleetPanelAccessEffect
    readonly levels: readonly FleetPanelAccessLevel[]
  }
  | { readonly action: 'remove_rule'; readonly ruleId: string }

export interface FleetPanelMemberAccessInput extends FleetPanelMemberAccessTarget {
  readonly change: FleetPanelMemberAccessChange
}

export interface FleetPanelArchiveExportInput {
  readonly sessionId: string
  readonly teamId: string
  readonly includeWorkspace: boolean
}

export interface FleetPanelArchiveImportInput {
  readonly sessionId: string
  readonly file: File
  readonly projectRoot: string
  readonly mode: 'copy' | 'restore'
}

export interface FleetPanelArchiveFile {
  readonly name: string
  readonly blob: Blob
}

export interface FleetPanelSource {
  getSnapshot(): FleetPanelSnapshot
  subscribe(listener: () => void): () => void
  selectTeam(teamId: string): void
  sendMessage(input: FleetPanelSendInput): Promise<void>
  uploadResource?(input: FleetPanelUploadInput): Promise<FleetPanelResource>
  removeResource?(input: FleetPanelRemoveResourceInput): Promise<void>
  controlTeam?(input: FleetPanelTeamControlInput): Promise<void>
  loadTeamSettings?(teamId: string, signal?: AbortSignal): Promise<FleetPanelTeamSettings>
  updateTeamSettings?(input: FleetPanelTeamSettingsInput): Promise<FleetPanelTeamSettings>
  updateBudget?(input: FleetPanelBudgetInput): Promise<FleetPanelTeamBudget>
  configureTeamRequest?(input: FleetPanelTeamRequestInput): Promise<void>
  configureMemberRequest?(input: FleetPanelMemberRequestInput): Promise<void>
  controlMember?(input: FleetPanelMemberControlInput): Promise<void>
  loadMemberAuthorization?(teamId: string, memberId: string, signal?: AbortSignal): Promise<FleetPanelMemberAuthorization>
  updateMemberPermissions?(input: FleetPanelMemberPermissionInput): Promise<FleetPanelMemberAuthorization>
  loadMemberAccess?(input: FleetPanelMemberAccessTarget, signal?: AbortSignal): Promise<FleetPanelMemberAccess>
  updateMemberAccess?(input: FleetPanelMemberAccessInput): Promise<FleetPanelMemberAccess>
  exportTeam?(teamId: string, signal?: AbortSignal): Promise<Record<string, unknown>>
  exportArchive?(input: FleetPanelArchiveExportInput, signal?: AbortSignal): Promise<FleetPanelArchiveFile>
  importArchive?(input: FleetPanelArchiveImportInput, signal?: AbortSignal): Promise<void>
  retry?(): Promise<void>
  loadMemberTrace?(
    teamId: string,
    memberId: string,
    signal?: AbortSignal,
    request?: FleetPanelMemberTraceRequest,
  ): Promise<FleetPanelMemberTrace>
  subscribeMemberTrace?(teamId: string, memberId: string, listener: () => void): () => void
  loadConversationMessages?(
    teamId: string,
    conversationId: string,
    beforeSequence: number,
    signal?: AbortSignal,
  ): Promise<FleetPanelConversationPage>
  loadResource?(teamId: string, resourceId: string, signal?: AbortSignal, revisionId?: string): Promise<FleetPanelResourceContent>
}

export const FLEET_PANEL_SOURCE_SERVICE = 'fleetPanelSource'
export const FLEET_PANEL_SLOTS = {
  tool: 'fleet.panel.tool',
  sidebar: 'fleet.panel.sidebar',
  sidebarSection: 'fleet.panel.sidebar.section',
  main: 'fleet.panel.main',
  mainAction: 'fleet.panel.main.action',
  composerAction: 'fleet.panel.composer.action',
  messageText: 'fleet.message.text',
  messageBlock: 'fleet.message.block',
  messageAction: 'fleet.message.action',
  resourcePreview: 'fleet.resource.preview',
  resourceDiff: 'fleet.resource.diff',
} as const

type FleetJoyrideValue = null | boolean | number | string | readonly FleetJoyrideValue[] | {
  readonly [key: string]: FleetJoyrideValue
}

interface FleetJoyrideAction {
  readonly id: string
  readonly label: string
  readonly scope: 'fleet'
  readonly description?: string
  readonly options?: () => FleetJoyrideValue
  readonly target?: () => HTMLElement | null
  readonly perform?: (input: FleetJoyrideValue) => FleetJoyrideValue | Promise<FleetJoyrideValue>
}

interface FleetJoyrideService {
  register(action: FleetJoyrideAction): () => void
}

let fleetJoyrideService: FleetJoyrideService | undefined
const fleetJoyrideListeners = new Set<() => void>()

function configureFleetJoyride(service: FleetJoyrideService | undefined): void {
  fleetJoyrideService = service
  for (const listener of fleetJoyrideListeners) listener()
}

function useFleetJoyride(): FleetJoyrideService | undefined {
  return useSyncExternalStore(
    listener => {
      fleetJoyrideListeners.add(listener)
      return () => { fleetJoyrideListeners.delete(listener) }
    },
    () => fleetJoyrideService,
    () => fleetJoyrideService,
  )
}

const FLEET_VIEW_ACTIONS = {
  home: 'fleet.view.home',
  chat: 'fleet.view.messages',
  team: 'fleet.view.members',
  agent: 'fleet.view.agent',
  resources: 'fleet.view.resources',
  activity: 'fleet.view.activity',
} as const

function fleetActionTarget(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-joyride-action="${id}"]`)
}

function fleetShellTabTarget(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(candidate => {
    const label = (candidate.getAttribute('aria-label') ?? candidate.textContent ?? '').trim().toLowerCase()
    return label === '团队' || label === 'team'
  }) ?? null
}

function fleetActionId(input: FleetJoyrideValue, field: string): string {
  if (typeof input === 'string' && input !== '') return input
  if (input !== null && !Array.isArray(input) && typeof input === 'object') {
    const value = (input as { readonly [key: string]: FleetJoyrideValue })[field]
    if (typeof value === 'string' && value !== '') return value
  }
  throw new Error(`Fleet action requires a non-empty ${field}`)
}

function fleetActionRecord(input: FleetJoyrideValue): Readonly<Record<string, FleetJoyrideValue>> {
  if (input !== null && !Array.isArray(input) && typeof input === 'object') {
    return input as Readonly<Record<string, FleetJoyrideValue>>
  }
  throw new Error('Fleet action requires an object input')
}

function fleetScrollTarget(area: 'sidebar' | 'main'): HTMLElement | null {
  const panel = document.querySelector<HTMLElement>('[data-fleet-team-panel]')
  if (panel === null) return null
  return area === 'sidebar'
    ? panel.querySelector<HTMLElement>('.dsh-fleet-panel-sidebar-scroll')
    : panel.querySelector<HTMLElement>([
      '.dsh-fleet-panel-chat-log',
      '.dsh-fleet-panel-detail-scroll',
      '.dsh-fleet-panel-native-context-scroll',
      '.dsh-fleet-panel-agent-chat-column',
    ].join(','))
}

async function scrollFleetView(input: FleetJoyrideValue): Promise<FleetJoyrideValue> {
  const record = fleetActionRecord(input)
  const area = record.area
  const direction = record.direction
  if (area !== 'sidebar' && area !== 'main') throw new Error('Fleet scroll area must be sidebar or main')
  if (typeof direction !== 'string' || !['up', 'down', 'left', 'right', 'top', 'bottom'].includes(direction)) {
    throw new Error('Fleet scroll direction must be up, down, left, right, top, or bottom')
  }
  const target = fleetScrollTarget(area)
  if (target === null) throw new Error(`Fleet ${area} is not currently scrollable`)
  if (direction === 'top') target.scrollTo({ top: 0, behavior: 'smooth' })
  else if (direction === 'bottom') target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' })
  else target.scrollBy({
    top: direction === 'up' ? -target.clientHeight * 0.8 : direction === 'down' ? target.clientHeight * 0.8 : 0,
    left: direction === 'left' ? -target.clientWidth * 0.8 : direction === 'right' ? target.clientWidth * 0.8 : 0,
    behavior: 'smooth',
  })
  await new Promise<void>(resolve => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      target.removeEventListener('scrollend', finish)
      window.clearTimeout(timeout)
      resolve()
    }
    const timeout = window.setTimeout(finish, 420)
    target.addEventListener('scrollend', finish, { once: true })
  })
  return { area, direction, scrollTop: target.scrollTop, scrollLeft: target.scrollLeft }
}

const JOYRIDE_MESSAGE_LIMIT = 12
const JOYRIDE_TEXT_LIMIT = 600

function joyrideText(text: string, limit = JOYRIDE_TEXT_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

function joyrideMessageBlock(block: FleetChatContentBlock): FleetJoyrideValue {
  if (block.type === 'text') return { type: 'text', text: joyrideText(block.text) }
  if (block.type === 'mention') return { type: 'mention', memberId: block.memberId, label: block.label }
  if (block.type === 'resource') return { type: 'resource', resourceId: block.id, label: block.label }
  if (block.type === 'image') return {
    type: 'image', attachmentId: block.attachmentId, name: block.name ?? '', mediaType: block.mediaType,
  }
  return { type: block.type }
}

function visibleFleetMessageIds(conversationId: string): ReadonlySet<string> | undefined {
  const logs = [...document.querySelectorAll<HTMLElement>('[data-fleet-conversation-id]')]
  const log = logs.find(candidate => candidate.dataset.fleetConversationId === conversationId)
  if (log === undefined) return undefined
  const scroller = log.closest<HTMLElement>('.dsh-fleet-panel-chat-log') ?? log
  const bounds = scroller.getBoundingClientRect()
  const viewportTop = Math.max(0, bounds.top)
  const viewportBottom = Math.min(window.innerHeight, bounds.bottom)
  const viewportLeft = Math.max(0, bounds.left)
  const viewportRight = Math.min(window.innerWidth, bounds.right)
  return new Set([...log.querySelectorAll<HTMLElement>('[data-message-id]')].flatMap(message => {
    const rect = message.getBoundingClientRect()
    const visibleHeight = Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, viewportTop)
    const visibleWidth = Math.min(rect.right, viewportRight) - Math.max(rect.left, viewportLeft)
    return visibleHeight > 1 && visibleWidth > 1 && message.dataset.messageId !== undefined
      ? [message.dataset.messageId]
      : []
  }))
}

async function waitForFleetPaint(): Promise<void> {
  await new Promise<void>(resolve => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      resolve()
    }
    const timeout = window.setTimeout(finish, 80)
    window.requestAnimationFrame(() => { window.requestAnimationFrame(finish) })
  })
}

function joyrideConversationFeedback(
  team: FleetPanelTeamSnapshot,
  conversationId: string,
  visibleOnly = false,
): FleetJoyrideValue {
  const conversation = team.conversations.find(candidate => candidate.id === conversationId)
  if (conversation === undefined) return { view: 'chat', conversationId, available: false }
  const allMessages = team.messages.filter(message => message.conversationId === conversationId)
  const visibleIds = visibleOnly ? visibleFleetMessageIds(conversationId) : undefined
  const selectedMessages = visibleOnly
    ? visibleIds === undefined ? [] : allMessages.filter(message => visibleIds.has(message.id))
    : allMessages.slice(-JOYRIDE_MESSAGE_LIMIT)
  const messages = selectedMessages.slice(-JOYRIDE_MESSAGE_LIMIT).map(message => {
    const sender = message.sender
      ?? team.members.find(member => member.id === message.senderId)
      ?? (message.senderId === operator.id ? operator : undefined)
    return {
      messageId: message.id,
      sentAt: message.sentAt,
      sender: sender === undefined
        ? { id: message.senderId, name: message.senderId, role: '' }
        : { id: sender.id, name: sender.name, role: sender.role },
      content: message.content.map(joyrideMessageBlock),
      ...(message.receipt === undefined ? {} : {
        receipt: {
          read: message.receipt.readMemberIds.length,
          unread: message.receipt.unreadMemberIds.length,
        },
      }),
    }
  })
  return {
    view: 'chat',
    conversation: {
      id: conversation.id,
      name: conversation.name,
      kind: conversation.kind,
      topic: conversation.topic ?? '',
    },
    totalMessages: allMessages.length,
    returnedMessages: messages.length,
    visibleOnly,
    pending: visibleOnly && visibleIds === undefined,
    truncated: visibleOnly
      ? selectedMessages.length > messages.length
      : allMessages.length > messages.length,
    messages,
  }
}

function joyrideMemberFeedback(team: FleetPanelTeamSnapshot, memberId: string): FleetJoyrideValue {
  const member = team.members.find(candidate => candidate.id === memberId)
  return member === undefined
    ? { view: 'team', memberId, available: false }
    : {
        view: 'team',
        member: {
          id: member.id,
          name: member.name,
          role: member.role,
          responsibility: member.responsibility,
          runtimeStatus: member.runtimeStatus ?? 'unknown',
          statusText: member.statusText ?? '',
          provider: member.provider ?? '',
          model: member.model ?? '',
        },
      }
}

function joyrideProfileMembers(team: FleetPanelTeamSnapshot): readonly FleetPanelMember[] {
  return team.members.filter(member => member.id !== 'livestream-vtuber')
}

function joyrideResourceFeedback(team: FleetPanelTeamSnapshot, resourceId: string): FleetJoyrideValue {
  const resource = team.resources.find(candidate => candidate.id === resourceId)
  if (resource !== undefined) return {
    view: 'resources',
    resource: {
      id: resource.id,
      name: resource.name,
      kind: resource.kind,
      path: resource.path,
      detail: resource.detail,
      mediaType: resource.mediaType ?? '',
      size: resource.size ?? 0,
      updatedAt: resource.updatedAt ?? '',
      excerpt: resource.body === undefined ? '' : joyrideText(resource.body, 2_000),
      truncated: (resource.body?.length ?? 0) > 2_000,
    },
  }
  const workspace = team.workspaces?.find(candidate => candidate.id === resourceId)
  return workspace === undefined
    ? { view: 'resources', resourceId, available: false }
    : {
        view: 'resources',
        workspace: {
          id: workspace.id,
          name: workspace.name,
          path: workspace.path,
          access: workspace.access,
          members: workspace.members,
        },
      }
}

function joyrideViewFeedback(
  team: FleetPanelTeamSnapshot,
  tool: string,
  item: string,
  visibleOnly = false,
): FleetJoyrideValue {
  if (tool === 'chat') return joyrideConversationFeedback(team, item, visibleOnly)
  if (tool === 'team') return joyrideMemberFeedback(team, item)
  if (tool === 'resources') return joyrideResourceFeedback(team, item)
  if (tool === 'activity') {
    const activity = (item === 'all' ? team.activity : team.activity.filter(record => record.kind === item)).slice(-20)
    return {
      view: 'activity', filter: item, returnedRecords: activity.length,
      activity: activity.map(record => ({
        id: record.id, kind: record.kind, text: joyrideText(record.text), createdAt: record.createdAt,
      })),
    }
  }
  if (tool === 'agent') {
    const perspective = parseAgentViewItem(team, item)
    return {
      view: 'agent',
      context: perspective.context,
      member: perspective.member === undefined ? null : {
        id: perspective.member.id,
        name: perspective.member.name,
        role: perspective.member.role,
        runtimeStatus: perspective.member.runtimeStatus ?? 'unknown',
        statusText: perspective.member.statusText ?? '',
      },
      conversation: perspective.conversation === undefined ? null : {
        id: perspective.conversation.id,
        name: perspective.conversation.name,
        kind: perspective.conversation.kind,
      },
      visibleConversations: perspective.conversations.map(conversation => ({
        id: conversation.id, name: conversation.name, kind: conversation.kind,
      })),
    }
  }
  return { view: tool }
}

export const operator: FleetPanelMember = {
  id: 'operator',
  get name() { return getFleetOperatorProfile().name },
  get role() { return getFleetOperatorProfile().role },
  get responsibility() { return getFleetOperatorProfile().responsibility },
  get color() { return getFleetOperatorProfile().color },
  get avatarUrl() { return getFleetOperatorProfile().avatarUrl },
  presence: 'active', operator: true,
}

export function teamAgents(team: FleetPanelTeamSnapshot): readonly FleetPanelMember[] {
  return fleetPanelMentionMembers(team)
}

/** Every visible Team participant that can be named in message text. */
export function fleetPanelMentionMembers(
  team: Pick<FleetPanelTeamSnapshot, 'members' | 'assistants'>,
): readonly FleetPanelMember[] {
  return [...team.members, ...(team.assistants ?? [])]
}

const emptyDirectory: FleetPanelTeamDirectory = {
  teams: [],
  groups: [
    { id: 'ungrouped', get name() { return panelText('未分组', 'Ungrouped') }, kind: 'ungrouped', teamIds: [] },
    { id: 'archived', get name() { return panelText('已归档', 'Archived') }, kind: 'archived', teamIds: [] },
  ],
}
const emptySnapshot: FleetPanelSnapshot = {
  directory: emptyDirectory,
  connection: { status: 'disconnected', get error() { return panelText('Fleet 数据源不可用', 'Fleet data source is unavailable') } },
}

/**
 * Shared module-level Fleet panel source. Readable by sibling panels.
 * The let binding is intentionally exported so sibling panels can set it.
 */
export let teamDirectorySource: FleetPanelSource | undefined

/** Opens one Team settings tab from composer-level shortcuts, including outside the Fleet view. */
export function requestFleetTeamSettings(teamId: string, tab: TeamSettingsTab = 'general'): void {
  teamDirectorySource?.selectTeam(teamId)
  setFleetTeamSettingsRequest({ id: incrementFleetTeamSettingsSequence(), teamId, tab })
  publishFleetTeamSettingsRequest()
  fleetShellTabTarget()?.click()
}

/** Current Team directory shared with root-level Fleet entry surfaces. */
export function getFleetTeamDirectorySnapshot(): FleetPanelTeamDirectory {
  return teamDirectorySource?.getSnapshot().directory ?? emptyDirectory
}

/** Fully projected Team currently loaded by the Fleet panel source. */
export function getFleetSelectedTeamSnapshot(): FleetPanelTeamSnapshot | undefined {
  return teamDirectorySource?.getSnapshot().team
}

/** Display name of the Team assistant connected to a foreground Session. */
export function getFleetAssistantDisplayName(sessionId: string | undefined): string | undefined {
  if (sessionId === undefined) return undefined
  const team = getFleetTeamDirectorySnapshot().teams.find(candidate =>
    candidate.assistantSessionIds?.includes(sessionId) === true)
  const currentSessionId = team?.assistantSessionAliases?.[sessionId] ?? sessionId
  return team?.assistantConnections?.find(connection => connection.sessionId === currentSessionId)?.assistantName
}

export function subscribeFleetTeamDirectory(listener: () => void): () => void {
  return teamDirectorySource?.subscribe(listener) ?? EMPTY_UNSUBSCRIBE
}

export function fleetAssistantMailboxMentions(
  text: string,
  recipient: string,
  assistantName?: string,
): readonly `@${string}`[] {
  return [recipient, assistantName].some(reference =>
    reference !== undefined && containsFleetMention(text, reference),
  ) ? [`@${recipient}`] : []
}

export async function sendFleetAssistantMailboxMessage(
  sessionId: string,
  text: string,
  files: readonly File[] = [],
  delivery: FleetPanelSendInput['delivery'] = 'wakeup',
): Promise<void> {
  const source = teamDirectorySource
  const team = source?.getSnapshot().directory.teams.find(candidate =>
    candidate.assistantSessionIds?.includes(sessionId) === true)
  if (source === undefined || team === undefined) return Promise.reject(new Error(panelText('当前 Session 未连接 Fleet Team 助理', 'The current Session is not connected to a Fleet Team assistant')))
  if (team.status === 'closed') return Promise.reject(new Error(panelText('团队已归档，助理会话不能继续发送消息', 'The Team is archived and its assistant Sessions can no longer send messages')))
  const recipient = team.assistantParticipantIds?.[sessionId]
  if (recipient === undefined) return Promise.reject(new Error(panelText('当前 Session 没有稳定的 Fleet Team 助理身份', 'The current Session does not have a stable Fleet Team assistant identity')))
  const assistantSessionId = team.assistantSessionAliases?.[sessionId] ?? sessionId
  const assistantName = team.assistantConnections?.find(connection =>
    connection.sessionId === assistantSessionId)?.assistantName
  const mentions = fleetAssistantMailboxMentions(text, recipient, assistantName)
  return source.sendMessage({
    sessionId,
    teamId: team.teamId,
    conversationId: `@${recipient}`,
    content: [{ type: 'text', text: fleetComposerMessageText(text, files) }],
    delivery,
    ...(mentions.length === 0 ? {} : { mentions }),
  })
}

/** Persist a foreground assistant Session's native model selection into its Fleet member view. */
export async function configureFleetAssistantSessionModel(
  sessionId: string,
  request: FleetPanelTeamRequestInput['request'],
): Promise<void> {
  const source = teamDirectorySource
  const team = source?.getSnapshot().directory.teams.find(candidate =>
    candidate.assistantSessionIds?.includes(sessionId) === true)
  const assistantId = team?.assistantParticipantIds?.[sessionId]
  if (source?.configureMemberRequest === undefined || team === undefined || team.status === 'closed' || assistantId === undefined) {
    throw new Error(panelText('当前 Session 的 Fleet 助理模型配置不可用', 'Fleet assistant model configuration is unavailable for the current Session'))
  }
  await source.configureMemberRequest({
    sessionId,
    teamId: team.teamId,
    memberId: assistantId,
    assistant: true,
    request,
  })
}

function fleetAssistantConversationIdentity(snapshot: FleetPanelSnapshot, sessionId: string | undefined): AgentFleetConversationIdentity | undefined {
  if (sessionId === undefined) return undefined
  const summary = snapshot.directory.teams.find(candidate =>
    candidate.assistantSessionIds?.includes(sessionId) === true)
  if (summary === undefined) return undefined
  const assistantSessionId = summary.assistantSessionAliases?.[sessionId] ?? sessionId
  const assistantId = summary.assistantParticipantIds?.[sessionId]
  const team = snapshot.team?.teamId === summary.teamId ? snapshot.team : undefined
  const assistant = team?.assistants?.find(candidate => candidate.id === assistantId)
  const fallbackAssistant: FleetChatMember = {
    id: assistantId ?? `assistant-${assistantSessionId}`,
    name: 'Agent Fleet',
    role: panelText('团队助理', 'Team assistant'),
    color: summary.color ?? '#4f76c7',
    presence: 'active',
  }
  const visibleAssistant = assistant ?? fallbackAssistant
  const interaction = team?.assistantInteractions?.find(candidate => candidate.assistantId === visibleAssistant.id)
  return {
    assistant: visibleAssistant,
    interactions: interaction?.turns ?? [],
    interactionPending: interaction?.pending === true,
  }
}

export const EMPTY_UNSUBSCRIBE = (): void => {}
interface FleetPanelPreferences {
  readonly activeTool?: string
  readonly sidebarWidth?: number
  readonly chatColumnWidth?: number
  readonly items?: Readonly<Record<string, string>>
  readonly collapsedGroups?: Readonly<Record<string, boolean>>
}

function readPanelPreferences(): FleetPanelPreferences {
  if (typeof window === 'undefined') return {}
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PANEL_PREFERENCES_KEY) ?? '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const raw = value as Record<string, unknown>
    const entries = (candidate: unknown): Record<string, string> | undefined => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined
      const pairs = Object.entries(candidate).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      return Object.fromEntries(pairs)
    }
    const collapsed = (candidate: unknown): Record<string, boolean> | undefined => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined
      const pairs = Object.entries(candidate).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
      return Object.fromEntries(pairs)
    }
    const items = entries(raw.items)
    const collapsedGroups = collapsed(raw.collapsedGroups)
    return {
      ...(typeof raw.activeTool === 'string' && raw.activeTool !== '' ? { activeTool: raw.activeTool } : {}),
      ...(typeof raw.sidebarWidth === 'number' && Number.isFinite(raw.sidebarWidth)
        ? { sidebarWidth: Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(raw.sidebarWidth))) }
        : {}),
      ...(typeof raw.chatColumnWidth === 'number' && Number.isFinite(raw.chatColumnWidth)
        ? { chatColumnWidth: Math.min(CHAT_COLUMN_MAX_WIDTH, Math.max(CHAT_COLUMN_MIN_WIDTH, Math.round(raw.chatColumnWidth))) }
        : {}),
      ...(items === undefined ? {} : { items }),
      ...(collapsedGroups === undefined ? {} : { collapsedGroups }),
    }
  } catch {
    return {}
  }
}

function writePanelPreferences(update: FleetPanelPreferences): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PANEL_PREFERENCES_KEY, JSON.stringify({ ...readPanelPreferences(), ...update }))
  } catch {}
}

interface FleetConversationComposeState {
  readonly draft: string
  readonly urgent: boolean
  readonly sending: boolean
  readonly error: string | null
}

const EMPTY_COMPOSE_STATE: FleetConversationComposeState = { draft: '', urgent: false, sending: false, error: null }

function containsFleetMention(text: string, reference: string): boolean {
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`@${escaped}(?=$|[\\s,.;:!?，。；：！？、）)])`).test(text)
}

interface PanelRenderOptions {
  readonly entryKey?: string
  readonly fallback?: ReactNode
}

export type FleetPanelRenderSlot = (
  name: string,
  owner: Record<string, unknown>,
  options?: PanelRenderOptions,
) => ReactNode

export interface FleetPanelToolButtonProps {
  readonly owner: FleetPanelToolOwner
  readonly tool: string
  readonly label: string
  readonly actionId?: string
  readonly children: ReactNode
}

export interface FleetPanelTeamOption {
  readonly teamId: string
  readonly teamName: string
  readonly status?: FleetPanelTeamSummary['status']
}

export interface FleetPanelTeamSwitcherProps {
  readonly teams: readonly FleetPanelTeamOption[]
  readonly selectedTeamId?: string
  readonly label: string
  readonly selectTeam: (teamId: string) => void
}

export interface FleetPanelListRowProps {
  readonly selected: boolean
  readonly title: ReactNode
  readonly caption?: string
  readonly leading?: ReactNode
  readonly trailing?: ReactNode
  readonly elementRef?: (element: HTMLButtonElement | null) => void
  readonly interaction?: {
    readonly controls: string
    readonly expanded: boolean
    readonly onMouseEnter: (event: ReactMouseEvent<HTMLButtonElement>) => void
    readonly onFocus: (event: FocusEvent<HTMLButtonElement>) => void
    readonly onBlur: (event: FocusEvent<HTMLButtonElement>) => void
  }
  readonly onClick: () => void
}

export interface FleetPanelUi {
  readonly ToolButton: ComponentType<FleetPanelToolButtonProps>
  readonly TeamSwitcher: ComponentType<FleetPanelTeamSwitcherProps>
  readonly ListRow: ComponentType<FleetPanelListRowProps>
  readonly SectionTitle: ComponentType<{ readonly children: ReactNode }>
  readonly MemberPopover: ComponentType<FleetMemberPopoverProps>
}

export interface FleetPanelToolOwner {
  readonly activeTool: string
  readonly disabled?: boolean
  readonly selectTool: (tool: string) => void
  readonly ui: FleetPanelUi
}

export interface FleetPanelPaneOwner {
  readonly sessionId: string
  readonly fleet: FleetPanelSnapshot
  readonly markdownRendererAvailable: boolean
  readonly snapshot: FleetPanelTeamSnapshot
  readonly activeItem: string
  readonly selectItem: (item: string) => void
  readonly showMemberDetails: (memberId: string) => void
  readonly showMemberContext: (memberId: string) => void
  readonly openResource: (resourceId: string) => void
  readonly uploadResource?: (file: File) => Promise<FleetPanelResource>
  readonly removeResource?: (resourceId: string) => Promise<void>
  readonly controlTeam?: (action: FleetPanelTeamControlInput['action'], summary?: string) => Promise<void>
  readonly loadTeamSettings?: FleetPanelSource['loadTeamSettings']
  readonly updateTeamSettings?: (teamId: string, settings: FleetPanelTeamSettingsInput['settings']) => Promise<FleetPanelTeamSettings>
  readonly updateBudget?: (teamId: string, input: Omit<FleetPanelBudgetInput, 'sessionId' | 'teamId'>) => Promise<FleetPanelTeamBudget>
  readonly configureTeamRequest?: (teamId: string, request: FleetPanelTeamRequestInput['request']) => Promise<void>
  readonly configureMemberRequest?: (memberId: string, assistant: boolean, request: FleetPanelTeamRequestInput['request']) => Promise<void>
  readonly controlMember?: (memberId: string, action: FleetPanelMemberControlInput['action']) => Promise<void>
  readonly loadMemberAuthorization?: FleetPanelSource['loadMemberAuthorization']
  readonly updateMemberPermissions?: (
    memberId: string,
    assignment?: FleetPanelMemberPermissionAssignment,
    reset?: boolean,
  ) => Promise<FleetPanelMemberAuthorization>
  readonly loadMemberAccess?: (memberId: string, signal?: AbortSignal) => Promise<FleetPanelMemberAccess>
  readonly updateMemberAccess?: (
    memberId: string,
    change: FleetPanelMemberAccessChange,
  ) => Promise<FleetPanelMemberAccess>
  readonly exportTeam?: FleetPanelSource['exportTeam']
  readonly exportArchive?: (teamId: string, includeWorkspace: boolean) => Promise<FleetPanelArchiveFile>
  readonly importArchive?: (file: File, projectRoot: string, mode: 'copy' | 'restore') => Promise<void>
  readonly draft: string
  readonly urgent: boolean
  readonly sending: boolean
  readonly sendError: string | null
  readonly setDraft: (draft: string) => void
  readonly setUrgent: (urgent: boolean) => void
  readonly sendMessage: (files?: readonly File[]) => Promise<void>
  readonly loadMemberTrace?: FleetPanelSource['loadMemberTrace']
  readonly subscribeMemberTrace?: FleetPanelSource['subscribeMemberTrace']
  readonly loadConversationMessages?: FleetPanelSource['loadConversationMessages']
  readonly loadResource?: FleetPanelSource['loadResource']
  readonly contextSource?: FleetChatReceiptSource
  readonly openMessageSource: (source: FleetChatReceiptSource) => void
  readonly openNavigation: () => void
  readonly showTeamDirectory: () => void
  readonly selectTeam: (teamId: string) => void
  readonly renderPanelSlot: FleetPanelRenderSlot
  readonly useSessions: FleetSnapshotSelectorHook
  readonly nativeContext: FleetNativeContext
  readonly t: (key: string, values?: Readonly<Record<string, unknown>>) => string
  readonly SessionProvider: ComponentType<FleetTargetSessionProviderProps>
  readonly ui: FleetPanelUi
}

export interface FleetPanelHomeOwner {
  readonly sessionId: string
  readonly fleet: FleetPanelSnapshot
  readonly markdownRendererAvailable: boolean
  readonly focusedTeamId?: string
  readonly selectTeam: (teamId: string) => void
  readonly openTeamMessages: (teamId: string) => void
  readonly controlTeamById?: (teamId: string, action: FleetPanelTeamControlInput['action'], summary?: string) => Promise<void>
  readonly loadTeamSettings?: FleetPanelSource['loadTeamSettings']
  readonly updateTeamSettings?: (teamId: string, settings: FleetPanelTeamSettingsInput['settings']) => Promise<FleetPanelTeamSettings>
  readonly updateBudget?: (teamId: string, input: Omit<FleetPanelBudgetInput, 'sessionId' | 'teamId'>) => Promise<FleetPanelTeamBudget>
  readonly configureTeamRequest?: (teamId: string, request: FleetPanelTeamRequestInput['request']) => Promise<void>
  readonly exportTeam?: FleetPanelSource['exportTeam']
  readonly exportArchive?: (teamId: string, includeWorkspace: boolean) => Promise<FleetPanelArchiveFile>
  readonly importArchive?: (file: File, projectRoot: string, mode: 'copy' | 'restore') => Promise<void>
  readonly openNavigation: () => void
  readonly renderPanelSlot: FleetPanelRenderSlot
  readonly useSessions: FleetSnapshotSelectorHook
  readonly nativeContext: FleetNativeContext
  readonly t: (key: string, values?: Readonly<Record<string, unknown>>) => string
  readonly SessionProvider: ComponentType<FleetTargetSessionProviderProps>
  readonly ui: FleetPanelUi
}

export interface FleetPanelSidebarSectionOwner {
  readonly panel: FleetPanelHomeOwner | FleetPanelPaneOwner
  readonly tool: 'home' | FleetPanelToolId
}

const FLEET_PANEL_UI: FleetPanelUi = {
  ToolButton: FleetPanelToolButton,
  TeamSwitcher: FleetPanelTeamSwitcher,
  ListRow,
  SectionTitle,
  MemberPopover: FleetMemberPopover,
}

export interface FleetPanelMessageOwner {
  readonly panel: FleetPanelPaneOwner
  readonly conversation: FleetPanelConversation
  readonly message: FleetPanelMessage
  readonly sender: FleetChatMember
}

export interface FleetPanelMessageTextOwner extends FleetPanelMessageOwner {
  readonly text: string
}

export interface FleetPanelMessageBlockOwner extends FleetPanelMessageOwner {
  readonly block: FleetChatContentBlock
  readonly index: number
}

export interface FleetPanelResourcePreviewOwner {
  readonly panel: FleetPanelPaneOwner
  readonly resource: FleetPanelResource
}

export interface FleetPanelResourceDiffOwner {
  readonly panel: FleetPanelPaneOwner
  readonly resource: FleetPanelResource
  readonly revision: FleetPanelResourceRevision
}

interface FleetTeamPanelProps {
  readonly sessionId: string
  readonly source?: FleetPanelSource
  readonly markdownRendererAvailable: boolean
  readonly renderSlot: FleetPanelRenderSlot
  readonly useSessions: FleetSnapshotSelectorHook
  readonly t: (key: string, values?: Readonly<Record<string, unknown>>) => string
  readonly nativeContext: FleetNativeContext
  readonly SessionProvider: ComponentType<FleetTargetSessionProviderProps>
}

interface FleetTargetSessionProviderProps {
  readonly sessionId?: string
  readonly empty?: () => ReactNode
  readonly children: (sessionId: string) => ReactNode
}

export type FleetSnapshotSelectorHook = <Selection>(
  selector: (snapshot: any) => Selection,
  equality?: (left: Selection, right: Selection) => boolean,
) => Selection

export interface FleetNativeSessionFace {
  getSnapshot(): any
  subscribe(listener: () => void): () => void
  readonly projections?: {
    faceOf(name: string): {
      getSnapshot(): unknown
      subscribe(listener: () => void): () => void
    } | undefined
  }
  open?(): Promise<void>
  resync?(): Promise<void>
  loadOlder(): Promise<void>
  prompt?(
    content: readonly { readonly type: 'text'; readonly text: string }[],
    mode: 'queue' | 'steer',
  ): Promise<{
    readonly ok: boolean
    readonly error?: { readonly message?: string }
  }>
}

export interface FleetNativeContext {
  session(sessionId: string): FleetNativeSessionFace | undefined
  executeSessionCommand(sessionId: string, line: string): Promise<{
    readonly kind: 'success' | 'error'
    readonly text?: string
  }>
  activateAssistant(sessionId: string, teamId: string, assistantId: string): Promise<void>
  openPath(path: string): Promise<void>
  openFile(sessionId: string, path: string): Promise<void>
  loadImage(sessionId: string, attachment: unknown): Promise<string>
  fileMentions(owner: unknown): unknown
}

export let NativeChatView: ComponentType<any> | undefined
export let nativeChatRuntime: Readonly<Record<string, any>> | undefined
let nativeChatRuntimeRevision = 0
const nativeChatRuntimeListeners = new Set<() => void>()

function publishNativeChatRuntime(): void {
  nativeChatRuntimeRevision += 1
  for (const listener of nativeChatRuntimeListeners) listener()
}

export function decorateFleetMetaWelcomeSnapshot(
  source: any,
  welcome: FleetMetaWelcomeState,
): any {
  if (source?.chat?.order === undefined || source.chat.nodes === undefined) return source
  const key = `fleet-meta-welcome:${welcome.sessionId}`
  const node = {
    key,
    kind: 'fleet-meta-welcome',
    id: key,
    target: 'chat',
    anchorSeq: -1,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: {
      text: welcome.text,
      streaming: welcome.streaming,
      time: welcome.time,
    },
  }
  const sourceNodes = source.chat.nodes
  const nodes = {
    get(candidate: string): any {
      return candidate === key ? node : sourceNodes.get(candidate)
    },
    values(): readonly any[] {
      const values = Array.from(sourceNodes.values())
        .filter((candidate: any) => candidate?.key !== key)
      return [node, ...values]
    },
  }
  return {
    ...source,
    chat: {
      ...source.chat,
      order: [key, ...source.chat.order.filter((candidate: string) => candidate !== key)],
      nodes,
    },
  }
}

interface FleetMetaWelcomeNodeProps {
  readonly node: {
    readonly data: {
      readonly text?: unknown
      readonly streaming?: unknown
    }
  }
}

function FleetMetaWelcomeNode({ node }: FleetMetaWelcomeNodeProps): ReactElement {
  const text = typeof node.data.text === 'string' ? node.data.text : ''
  const streaming = node.data.streaming === true
  return jsx('div', {
    className: 'dsh-fleet-meta-welcome-node',
    'data-streaming': streaming ? 'true' : 'false',
    children: text,
  })
}

interface FleetMetaWelcomeBoundaryProps {
  readonly children: ReactNode
  readonly fallback: ReactNode
}

interface FleetMetaWelcomeBoundaryState {
  readonly error?: string
}

class FleetMetaWelcomeBoundary extends Component<FleetMetaWelcomeBoundaryProps, FleetMetaWelcomeBoundaryState> {
  override state: FleetMetaWelcomeBoundaryState = {}

  static getDerivedStateFromError(error: unknown): FleetMetaWelcomeBoundaryState {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override render(): ReactNode {
    if (this.state.error === undefined) return this.props.children
    return jsx('div', {
      className: 'dsh-fleet-meta-welcome-fallback',
      'data-fleet-welcome-error': this.state.error,
      children: this.props.fallback,
    })
  }
}

/** Harmony decorator: retain the native component and its already-authorized child-slot runtime. */
export function withFleetNativeChatView<T extends ComponentType<any>>(ChatView: T): T {
  NativeChatView = ChatView
  function FleetNativeChatRuntimeCapture(props: Readonly<Record<string, any>>): ReactElement {
    const initialized = nativeChatRuntime !== undefined
    nativeChatRuntime = props
    if (!initialized) queueMicrotask(publishNativeChatRuntime)
    const welcome = useFleetMetaWelcome()
    const currentSessionId = useSyncExternalStore(
      subscribeCurrentFleetSession,
      getCurrentFleetSessionId,
      getCurrentFleetSessionId,
    )
    const sessionId = typeof props.sessionId === 'string' ? props.sessionId : currentSessionId
    const fleetAssistant = useFleetMetaAssistantSession(sessionId)
    const fleetSnapshot = useSyncExternalStore(
      subscribeFleetTeamDirectory,
      () => teamDirectorySource?.getSnapshot() ?? emptySnapshot,
      () => emptySnapshot,
    )
    const identity = useMemo(() => fleetAssistantConversationIdentity(fleetSnapshot, sessionId), [fleetSnapshot, sessionId])
    const conversationTeamId = fleetSnapshot.directory.teams.find(candidate =>
      candidate.assistantSessionIds?.includes(sessionId ?? '') === true)?.teamId
    useEffect(() => {
      if (identity === undefined) return
      const teamId = fleetSnapshot.directory.teams.find(candidate =>
        candidate.assistantSessionIds?.includes(sessionId ?? '') === true)?.teamId
      if (teamId !== undefined && fleetSnapshot.team?.teamId !== teamId) teamDirectorySource?.selectTeam(teamId)
    }, [fleetSnapshot.directory.teams, fleetSnapshot.team?.teamId, identity, sessionId])
    const decorateSnapshot = useMemo(() => {
      if (welcome === null) return (source: any): any => source
      let previousSource: any
      let previousView: any
      return (source: any): any => {
        if (source === previousSource) return previousView
        previousSource = source
        previousView = decorateFleetMetaWelcomeSnapshot(source, welcome)
        return previousView
      }
    }, [welcome?.sessionId, welcome?.streaming, welcome?.text, welcome?.time])
    const nativeUseSession = props.useSession as FleetSnapshotSelectorHook
    const decoratedUseSession: FleetSnapshotSelectorHook = (selector, equality) => nativeUseSession(
      source => selector(decorateSnapshot(source)),
      equality,
    )
    const mentionMembers = useMemo<readonly FleetPanelMember[]>(() => {
      const team = fleetSnapshot.team?.teamId === conversationTeamId ? fleetSnapshot.team : undefined
      return team === undefined ? [] : [operator, ...teamAgents(team)]
    }, [fleetSnapshot.team, conversationTeamId])
    const showMemberDetails = conversationTeamId === undefined || sessionId === undefined
      ? undefined
      : (memberId: string) => {
          requestFleetPanelNavigation({
            sessionId,
            teamId: conversationTeamId,
            memberId,
            target: 'details',
          })
        }
    const showMemberContext = conversationTeamId === undefined || sessionId === undefined
      ? undefined
      : (memberId: string) => {
          requestFleetPanelNavigation({
            sessionId,
            teamId: conversationTeamId,
            memberId,
            target: 'context',
          })
        }
    const content = welcome === null && !fleetAssistant
      ? jsx(ChatView, props)
      : jsx(AgentFleetPrivateChat, {
          key: welcome?.sessionId ?? `fleet-assistant:${sessionId ?? ''}`,
          useSession: decoratedUseSession,
          loadOlder: props.loadOlder as () => void,
          loadImage: props.loadImage as (attachment: unknown) => Promise<string>,
          renderText: (text: string) => jsx(FleetMessageText, {
            text,
            members: mentionMembers,
            ...(fleetMarkdownRenderer === undefined ? {} : { markdownRenderer: fleetMarkdownRenderer }),
            ...(showMemberDetails === undefined ? {} : { showMemberDetails }),
            ...(showMemberContext === undefined ? {} : { showMemberContext }),
          }),
          renderContext: () => jsx(ChatView, props),
          ...(welcome !== null || identity === undefined || sessionId === undefined ? {} : {
            identity,
            ...(conversationTeamId === undefined ? {} : {
              ...(showMemberDetails === undefined ? {} : {
                openMemberDetails: () => { showMemberDetails(identity.assistant.id) },
              }),
              ...(showMemberContext === undefined ? {} : {
                openMemberContext: () => { showMemberContext(identity.assistant.id) },
              }),
            }),
          }),
        })
    return jsx(FleetMetaWelcomeBoundary, {
      fallback: jsx(ChatView, props),
      children: content,
    })
  }
  FleetNativeChatRuntimeCapture.displayName = `withFleetNativeChatView(${ChatView.displayName ?? ChatView.name ?? 'ChatView'})`
  return FleetNativeChatRuntimeCapture as T
}

interface FleetNativeChatRuntimePrimerProps {
  readonly renderSlot: (
    name: 'conversation.view',
    owner: Readonly<Record<string, unknown>>,
    options: { readonly only: string },
  ) => ReactNode
  readonly inspect: unknown
  readonly onInspectDone: () => void
}

/** One-frame offscreen native view that captures the authorized ChatView runtime after a direct Fleet restore. */
export function FleetNativeChatRuntimePrimer({
  renderSlot,
  inspect,
  onInspectDone,
}: FleetNativeChatRuntimePrimerProps): ReactElement | null {
  const ready = useSyncExternalStore(
    listener => {
      nativeChatRuntimeListeners.add(listener)
      return () => { nativeChatRuntimeListeners.delete(listener) }
    },
    () => nativeChatRuntimeRevision,
    () => nativeChatRuntimeRevision,
  ) > 0 || nativeChatRuntime !== undefined
  if (ready) return null
  return jsx('div', {
    hidden: true,
    'aria-hidden': 'true',
    'data-conversation-scroll': '',
    children: renderSlot('conversation.view', { inspect, onInspectDone }, { only: 'chat' }),
  })
}

const EMPTY_NATIVE_CHAT_STORE = { selection: null }
export const nativeChatScroll = new Map<string, unknown>()
const MAX_NATIVE_CONTEXT_NODES = 500
const NATIVE_CONTEXT_RESYNC_COOLDOWN_MS = 5 * 60 * 1000
const nativeContextResyncAt = new WeakMap<object, number>()
const nativeContextResyncing = new WeakSet<object>()

/**
 * DSH keeps listed Session instances resident and currently exposes no public
 * close verb. Fleet opens non-foreground Sessions only for its read-only Agent
 * view, so release that extra history window when the view goes away. Every
 * field is feature-detected to keep a future native close implementation free
 * to replace this compatibility path.
 */
export function releaseFleetNativeSessionWindow(session: FleetNativeSessionFace): boolean {
  const runtime = session as FleetNativeSessionFace & {
    openGeneration?: number
    openPromise?: Promise<void> | null
    openState?: string
    openError?: unknown
    loadingOlder?: boolean
    stitching?: boolean
    events?: unknown[]
    views?: unknown[]
    baseSeq?: number
    hasMore?: boolean
    liveBuffer?: unknown[]
    conversation?: { replaceWindow(entries: readonly unknown[], hasMore: boolean): unknown }
    notifier?: { markDirty(): void }
  }
  if (
    !Array.isArray(runtime.events)
    || !Array.isArray(runtime.views)
    || runtime.conversation === undefined
    || typeof runtime.conversation.replaceWindow !== 'function'
    || typeof runtime.openGeneration !== 'number'
    || typeof runtime.openState !== 'string'
  ) return false

  runtime.openGeneration += 1
  runtime.openPromise = null
  runtime.openState = 'cold'
  runtime.openError = null
  runtime.loadingOlder = false
  runtime.stitching = false
  runtime.events = []
  runtime.views = []
  runtime.baseSeq = 0
  runtime.hasMore = false
  runtime.liveBuffer = []
  runtime.conversation.replaceWindow([], false)
  runtime.notifier?.markDirty()
  return true
}

export function boundFleetNativeSessionWindow(session: FleetNativeSessionFace, snapshot: any): void {
  const order = snapshot?.chat?.order
  const nodeCount = Array.isArray(order)
    ? order.length
    : snapshot?.nodes instanceof Map
      ? snapshot.nodes.size
      : 0
  if (nodeCount <= MAX_NATIVE_CONTEXT_NODES || session.resync === undefined) return
  const now = Date.now()
  const key = session as object
  if (
    nativeContextResyncing.has(key)
    || now - (nativeContextResyncAt.get(key) ?? 0) < NATIVE_CONTEXT_RESYNC_COOLDOWN_MS
  ) return
  nativeContextResyncAt.set(key, now)
  nativeContextResyncing.add(key)
  void session.resync().finally(() => { nativeContextResyncing.delete(key) })
}

export function useNativeChatStore<Selection>(selector: (snapshot: typeof EMPTY_NATIVE_CHAT_STORE) => Selection): Selection {
  return selector(EMPTY_NATIVE_CHAT_STORE)
}

export function fleetNativeContextNodeKey(snapshot: any, contextMessageId: string): string | undefined {
  const nodes = snapshot?.chat?.nodes
  if (nodes === undefined || typeof nodes.values !== 'function') return undefined
  for (const candidate of nodes.values() as Iterable<any>) {
    if (candidate?.id === contextMessageId && typeof candidate.key === 'string') return candidate.key
  }
  return undefined
}

export function nativeContextNodeCount(snapshot: any): number {
  const order = snapshot?.chat?.order
  return Array.isArray(order) ? order.length : 0
}

export async function loadFleetNativeContextTarget(
  session: FleetNativeSessionFace,
  contextMessageId: string,
): Promise<string | undefined> {
  await session.open?.()
  let previousWindow: string | undefined
  while (true) {
    const snapshot = session.getSnapshot()
    const target = fleetNativeContextNodeKey(snapshot, contextMessageId)
    if (target !== undefined) return target
    const count = nativeContextNodeCount(snapshot)
    if (snapshot?.hasMore !== true || count >= MAX_NATIVE_CONTEXT_NODES) return undefined
    const first = Array.isArray(snapshot?.chat?.order) ? snapshot.chat.order[0] : undefined
    const window = `${String(first)}:${String(count)}`
    if (window === previousWindow) return undefined
    previousWindow = window
    await session.loadOlder()
  }
}

function usePanelSnapshot(source: FleetPanelSource | undefined): FleetPanelSnapshot {
  const subscribe = useCallback((listener: () => void) => source?.subscribe(listener) ?? EMPTY_UNSUBSCRIBE, [source])
  const getSnapshot = useCallback(() => source?.getSnapshot() ?? emptySnapshot, [source])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const AGENT_VIEW_ITEM_SEPARATOR = '::'
const AGENT_CONTEXT_ITEM_ID = '@context'

function visibleAgentConversations(
  team: FleetPanelTeamSnapshot,
  member: FleetPanelMember | undefined,
): readonly FleetPanelConversation[] {
  if (member?.visibleConversationIds === undefined) return team.conversations
  const visible = new Set(member.visibleConversationIds)
  return team.conversations.filter(conversation => visible.has(conversation.id))
}

export function operatorConversations(team: FleetPanelTeamSnapshot): readonly FleetPanelConversation[] {
  return team.conversations.filter(conversation => conversation.kind !== 'direct' || conversation.id.startsWith('@'))
}

export function agentConversationPeer(
  team: FleetPanelTeamSnapshot,
  member: FleetPanelMember,
  conversation: FleetPanelConversation,
): FleetPanelMember | undefined {
  if (conversation.kind !== 'direct') return undefined
  if (conversation.id.startsWith('@')) return operator
  const peerId = conversation.participantIds?.find(participantId => participantId !== member.id)
  return peerId === undefined ? undefined : teamAgents(team).find(candidate => candidate.id === peerId)
}

function agentViewItem(memberId: string, conversationId: string): string {
  return `${memberId}${AGENT_VIEW_ITEM_SEPARATOR}${conversationId}`
}

export function parseAgentViewItem(team: FleetPanelTeamSnapshot, item: string): {
  readonly member?: FleetPanelMember
  readonly conversations: readonly FleetPanelConversation[]
  readonly conversation?: FleetPanelConversation
  readonly context: boolean
} {
  const separator = item.indexOf(AGENT_VIEW_ITEM_SEPARATOR)
  const requestedMemberId = separator < 0 ? item : item.slice(0, separator)
  const requestedConversationId = separator < 0 ? '' : item.slice(separator + AGENT_VIEW_ITEM_SEPARATOR.length)
  const agents = teamAgents(team)
  const member = agents.find(candidate => candidate.id === requestedMemberId) ?? agents[0]
  const conversations = visibleAgentConversations(team, member)
  const context = separator < 0 || requestedConversationId === AGENT_CONTEXT_ITEM_ID
  const conversation = context
    ? undefined
    : conversations.find(candidate => candidate.id === requestedConversationId) ?? conversations[0]
  return {
    ...(member === undefined ? {} : { member }),
    conversations,
    ...(conversation === undefined ? {} : { conversation }),
    context,
  }
}

function initialItem(team: FleetPanelTeamSnapshot, tool: string): string {
  if (tool === 'chat') return operatorConversations(team)[0]?.id ?? ''
  if (tool === 'team') return teamAgents(team)[0]?.id ?? ''
  if (tool === 'agent') {
    const member = teamAgents(team)[0]
    if (member === undefined) return ''
    return agentViewItem(member.id, AGENT_CONTEXT_ITEM_ID)
  }
  if (tool === 'resources') return team.resources[0]?.id ?? team.workspaces?.[0]?.id ?? ''
  if (tool === 'activity') return 'all'
  return ''
}

/** Keep local navigation valid when a live Team snapshot removes or replaces an item. */
export function resolveFleetPanelItem(
  team: FleetPanelTeamSnapshot,
  tool: string,
  requested: string | undefined,
): string {
  if (requested === undefined || requested === '') return initialItem(team, tool)
  if (tool === 'chat') return operatorConversations(team).some(item => item.id === requested)
    ? requested
    : initialItem(team, tool)
  if (tool === 'team') return teamAgents(team).some(item => item.id === requested)
    ? requested
    : initialItem(team, tool)
  if (tool === 'resources') return team.resources.some(item => item.id === requested)
      || team.workspaces?.some(item => item.id === requested) === true
    ? requested
    : initialItem(team, tool)
  if (tool === 'activity') return ['all', 'message', 'resource', 'decision', 'memory'].includes(requested)
    ? requested
    : 'all'
  if (tool === 'agent') {
    const perspective = parseAgentViewItem(team, requested)
    if (perspective.member === undefined) return ''
    return perspective.context || perspective.conversation === undefined
      ? agentViewItem(perspective.member.id, AGENT_CONTEXT_ITEM_ID)
      : agentViewItem(perspective.member.id, perspective.conversation.id)
  }
  return requested
}

export function fleetPanelSelectedMemberId(
  team: FleetPanelTeamSnapshot,
  tool: string,
  item: string,
): string | undefined {
  if (tool === 'team' || tool === 'git') {
    return teamAgents(team).find(member => member.id === item)?.id
  }
  if (tool === 'chat') {
    const conversation = operatorConversations(team).find(candidate => candidate.id === item)
    if (conversation?.kind !== 'direct') return undefined
    return teamAgents(team).find(member => member.id === conversation.peerId)?.id
  }
  return undefined
}

export function FleetTeamPanel({
  sessionId,
  source,
  markdownRendererAvailable,
  renderSlot,
  useSessions,
  nativeContext,
  SessionProvider,
  t,
}: FleetTeamPanelProps): ReactElement {
  installPanelStyles()
  useFleetOperatorProfile()
  const snapshot = usePanelSnapshot(source)
  const joyride = useFleetJoyride()
  const [activeTool, setActiveTool] = useState<string>(() => readPanelPreferences().activeTool ?? 'home')
  const [homeTeamId, setHomeTeamId] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => readPanelPreferences().sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH)
  const paneResize = usePaneResize(sidebarWidth, setSidebarWidth)
  const [items, setItems] = useState<Record<string, string>>(() => ({ ...readPanelPreferences().items }))
  const [composeStates, setComposeStates] = useState<Record<string, FleetConversationComposeState>>({})
  const assistantLoads = useRef(new Map<string, Promise<void>>())
  const assistantLoadAttempts = useRef(new Map<string, number>())
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [contextSource, setContextSource] = useState<FleetChatReceiptSource>()
  const panelNavigation = useSyncExternalStore(
    subscribeFleetPanelNavigation,
    getFleetPanelNavigationRequest,
    getFleetPanelNavigationRequest,
  )
  const effectiveSnapshot = snapshot
  const activeTeam = effectiveSnapshot.team
  const activeTeamId = activeTeam?.teamId
  const tutorial = activeTeam?.teamId === FLEET_TUTORIAL_TEAM_ID || activeTeam?.tutorial === true
  const itemKey = activeTeam === undefined ? '' : `${activeTeam.teamId}:${activeTool}`
  const activeItem = activeTeam === undefined ? '' : resolveFleetPanelItem(activeTeam, activeTool, items[itemKey])
  const composeKey = activeTeam === undefined || activeTool !== 'chat' || activeItem === ''
    ? ''
    : `${activeTeam.teamId}:${activeItem}`
  const composeState = composeStates[composeKey] ?? EMPTY_COMPOSE_STATE
  const visibleTool = activeTeam === undefined ? 'home' : activeTool
  const loadMemberAccess = useCallback((memberId: string, signal?: AbortSignal) => {
    if (source?.loadMemberAccess === undefined || activeTeamId === undefined) {
      return Promise.reject(new Error(panelText('Fleet 成员资源访问接口不可用', 'Fleet member resource access API is unavailable')))
    }
    return source.loadMemberAccess({ sessionId, teamId: activeTeamId, memberId }, signal)
  }, [activeTeamId, sessionId, source])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writePanelPreferences({ activeTool, sidebarWidth, items })
    }, 120)
    return () => { window.clearTimeout(timer) }
  }, [activeTool, items, sidebarWidth])

  useEffect(() => {
    if (panelNavigation === undefined || panelNavigation.sessionId !== sessionId) return
    source?.selectTeam(panelNavigation.teamId)
    setContextSource(undefined)
    if (panelNavigation.target === 'context') {
      setItems(current => ({
        ...current,
        [`${panelNavigation.teamId}:agent`]: agentViewItem(panelNavigation.memberId, AGENT_CONTEXT_ITEM_ID),
      }))
      setActiveTool('agent')
    } else {
      setItems(current => ({ ...current, [`${panelNavigation.teamId}:team`]: panelNavigation.memberId }))
      setActiveTool('team')
    }
    setNavigationOpen(false)
    completeFleetPanelNavigation(panelNavigation.revision)
  }, [panelNavigation, sessionId, source])

  useEffect(() => {
    if (itemKey === '' || items[itemKey] === undefined || items[itemKey] === activeItem) return
    setItems(current => ({ ...current, [itemKey]: activeItem }))
  }, [activeItem, itemKey, items])

  const selectTool = (tool: string): void => {
    if (tool === 'agent' && activeTeam !== undefined) {
      const memberId = fleetPanelSelectedMemberId(activeTeam, activeTool, activeItem)
      if (memberId !== undefined) {
        setContextSource(undefined)
        setItems(current => ({
          ...current,
          [`${activeTeam.teamId}:agent`]: agentViewItem(memberId, AGENT_CONTEXT_ITEM_ID),
        }))
      }
    }
    setActiveTool(tool)
    setNavigationOpen(true)
  }
  const loadConversationAssistant = (team: FleetPanelTeamSnapshot, item: string): void => {
    const conversation = operatorConversations(team).find(candidate => candidate.id === item)
    if (conversation?.kind !== 'direct' || !conversation.id.startsWith('@')) return
    const assistant = team.assistants?.find(candidate => candidate.sessionId === conversation.id.slice(1))
    if (assistant?.sessionId === undefined
      || (assistant.runtimeStatus !== 'offline' && assistant.presence !== 'offline')) return
    const key = `${team.teamId}:${assistant.id}`
    if (assistantLoads.current.has(key)
      || Date.now() - (assistantLoadAttempts.current.get(key) ?? 0) < 5_000) return
    assistantLoadAttempts.current.set(key, Date.now())
    const targetComposeKey = `${team.teamId}:${item}`
    const updateCompose = (update: (current: FleetConversationComposeState) => FleetConversationComposeState): void => {
      setComposeStates(current => ({
        ...current,
        [targetComposeKey]: update(current[targetComposeKey] ?? EMPTY_COMPOSE_STATE),
      }))
    }
    updateCompose(current => ({ ...current, sending: true, error: null }))
    const loading = nativeContext.activateAssistant(assistant.sessionId, team.teamId, assistant.id).then(async () => {
      await source?.retry?.()
    }).catch((error: unknown) => {
      updateCompose(current => ({
        ...current,
        error: error instanceof Error ? error.message : panelText('团队助理加载失败', 'Team assistant could not be loaded'),
      }))
    }).finally(() => {
      assistantLoads.current.delete(key)
      updateCompose(current => ({ ...current, sending: false }))
    })
    assistantLoads.current.set(key, loading)
  }
  const selectItem = (item: string): void => {
    if (activeTeam === undefined) return
    setContextSource(undefined)
    setItems(current => ({ ...current, [`${activeTeam.teamId}:${activeTool}`]: item }))
    setNavigationOpen(false)
    if (activeTool === 'chat') loadConversationAssistant(activeTeam, item)
  }

  useEffect(() => {
    if (activeTeam === undefined || activeTool !== 'chat' || activeItem === '') return
    loadConversationAssistant(activeTeam, activeItem)
  }, [activeItem, activeTeam, activeTool])
  const selectTeam = (teamId: string): void => {
    setContextSource(undefined)
    source?.selectTeam(teamId)
    setHomeTeamId(teamId)
    setActiveTool('home')
    setNavigationOpen(false)
  }
  const openTeamMessages = (teamId: string): void => {
    source?.selectTeam(teamId)
    setActiveTool('chat')
    setNavigationOpen(true)
  }
  const switchTeam = (teamId: string): void => {
    setContextSource(undefined)
    source?.selectTeam(teamId)
  }
  const showTeamDirectory = (): void => {
    setHomeTeamId(null)
    setActiveTool('home')
    setNavigationOpen(true)
  }
  const sendMessage = (files: readonly File[] = []): Promise<void> => {
    const text = composeState.draft.trim()
    if (activeTeam === undefined || activeTool !== 'chat' || activeItem === '' || composeKey === ''
      || (text === '' && files.length === 0) || composeState.sending) return Promise.resolve()
    const teamId = activeTeam.teamId
    const conversationId = activeItem
    const conversation = activeTeam.conversations.find(candidate => candidate.id === conversationId)
    const mentions = conversation?.kind === 'channel' || conversation?.kind === 'direct'
      ? activeTeam.members.filter(member => containsFleetMention(text, member.id) || containsFleetMention(text, member.name))
        .map(member => `@${member.id}`)
      : []
    const delivery: FleetPanelSendInput['delivery'] = composeState.urgent
      ? 'interrupt'
      : conversation?.kind === 'direct' || mentions.length > 0 ? 'wakeup' : 'quiet'
    const submittedDraft = composeState.draft
    const updateCompose = (update: (current: FleetConversationComposeState) => FleetConversationComposeState): void => {
      setComposeStates(current => ({
        ...current,
        [composeKey]: update(current[composeKey] ?? EMPTY_COMPOSE_STATE),
      }))
    }
    if (source === undefined) {
      updateCompose(current => ({ ...current, error: panelText('Fleet 数据源不可用', 'Fleet data source is unavailable') }))
      return Promise.reject(new Error(panelText('Fleet 数据源不可用', 'Fleet data source is unavailable')))
    }
    if (composeState.urgent && conversation?.kind === 'channel' && mentions.length === 0) {
      updateCompose(current => ({ ...current, error: panelText('频道紧急消息需要明确 @ 至少一名成员', 'Urgent Channel messages must explicitly @mention at least one member') }))
      return Promise.reject(new Error(panelText('频道紧急消息需要明确 @ 至少一名成员', 'Urgent Channel messages must explicitly @mention at least one member')))
    }
    updateCompose(current => ({ ...current, sending: true, error: null }))
    const pending = Promise.resolve().then(async () => {
      await source.sendMessage({
        sessionId,
        teamId,
        conversationId,
        content: [{ type: 'text', text: fleetComposerMessageText(text, files) }],
        delivery,
        ...(mentions.length === 0 ? {} : { mentions }),
      })
    })
    return pending.then(() => {
      updateCompose(current => ({
        ...current,
        draft: current.draft === submittedDraft ? '' : current.draft,
        urgent: current.draft === submittedDraft ? false : current.urgent,
      }))
    }).catch((error: unknown) => {
      updateCompose(current => ({
        ...current,
        error: error instanceof Error ? error.message : panelText('消息发送失败', 'Message could not be sent'),
      }))
      throw error
    }).finally(() => {
      updateCompose(current => ({ ...current, sending: false }))
    })
  }
  const openResource = (resourceId: string): void => {
    if (activeTeam === undefined) return
    setItems(current => ({ ...current, [`${activeTeam.teamId}:resources`]: resourceId }))
    setActiveTool('resources')
    setNavigationOpen(false)
  }
  const showMemberDetails = (memberId: string): void => {
    if (activeTeam === undefined || !teamAgents(activeTeam).some(member => member.id === memberId)) return
    setItems(current => ({ ...current, [`${activeTeam.teamId}:team`]: memberId }))
    setActiveTool('team')
    setNavigationOpen(false)
  }
  const showMemberContext = (memberId: string): void => {
    if (activeTeam === undefined || !teamAgents(activeTeam).some(member => member.id === memberId)) return
    setContextSource(undefined)
    setItems(current => ({
      ...current,
      [`${activeTeam.teamId}:agent`]: agentViewItem(memberId, AGENT_CONTEXT_ITEM_ID),
    }))
    setActiveTool('agent')
    setNavigationOpen(false)
  }
  const openMessageSource = (messageSource: FleetChatReceiptSource): void => {
    if (activeTeam === undefined || !activeTeam.members.some(member => member.id === messageSource.memberId)) return
    setContextSource(messageSource)
    setItems(current => ({
      ...current,
      [`${activeTeam.teamId}:agent`]: agentViewItem(messageSource.memberId, AGENT_CONTEXT_ITEM_ID),
    }))
    setActiveTool('agent')
    setNavigationOpen(false)
  }

  useEffect(() => {
    if (joyride === undefined) return
    const dispose: Array<() => void> = []
    const register = (action: FleetJoyrideAction): void => { dispose.push(joyride.register(action)) }
    const views: readonly [Exclude<keyof typeof FLEET_VIEW_ACTIONS, 'home'>, string][] = [
      ['chat', panelText('消息', 'Messages')],
      ['team', panelText('成员', 'Members')],
      ['agent', panelText('Agent 视角', 'Agent view')],
      ['resources', panelText('共享资源', 'Shared resources')],
      ['activity', panelText('团队动态', 'Team activity')],
    ]
    for (const [tool, label] of views) {
      const id = FLEET_VIEW_ACTIONS[tool]
      register({
        id,
        label: panelText(`打开 Fleet ${label}`, `Open Fleet ${label}`),
        scope: 'fleet',
        description: panelText(`只切换 Agent Fleet 面板内的${label}页面。`, `Switch only to the ${label} page inside Agent Fleet.`),
        target: () => fleetActionTarget(id),
        perform: async () => {
          if (activeTeam === undefined) throw new Error('No Fleet team is selected')
          selectTool(tool)
          const item = resolveFleetPanelItem(activeTeam, tool, items[`${activeTeam.teamId}:${tool}`])
          await waitForFleetPaint()
          return joyrideViewFeedback(activeTeam, tool, item, true)
        },
      })
    }
    register({
      id: 'fleet.inspect',
      label: panelText('读取 Fleet 当前视图', 'Read current Fleet view'),
      scope: 'fleet',
      description: panelText('返回当前 Fleet 页面里可见对象的有界摘要；消息页只返回与当前屏幕相交的消息，并截断长文本。', 'Return a bounded summary of visible objects on the current Fleet page. The message view returns only on-screen messages and truncates long text.'),
      target: () => fleetScrollTarget('main'),
      perform: () => {
        if (activeTeam === undefined) throw new Error('No Fleet team is selected')
        return joyrideViewFeedback(activeTeam, activeTool, activeItem, true)
      },
    })
    register({
      id: 'fleet.scroll',
      label: panelText('滚动 Fleet 当前视图', 'Scroll current Fleet view'),
      scope: 'fleet',
      description: panelText('只滚动当前 Fleet 的 sidebar 或 main。direction 可为 up、down、left、right、top、bottom。', 'Scroll only the current Fleet sidebar or main area. direction may be up, down, left, right, top, or bottom.'),
      options: () => ({ areas: ['sidebar', 'main'], directions: ['up', 'down', 'left', 'right', 'top', 'bottom'] }),
      target: () => fleetScrollTarget('main'),
      perform: async input => {
        const scroll = await scrollFleetView(input)
        return {
          scroll,
          visible: activeTeam === undefined
            ? null
            : joyrideViewFeedback(activeTeam, activeTool, activeItem, true),
        }
      },
    })
    if (activeTeam !== undefined) {
      register({
        id: 'fleet.conversation.select',
        label: panelText('打开 Fleet 会话', 'Open Fleet conversation'),
        scope: 'fleet',
        description: panelText('只允许打开当前团队中用户可见的频道或私聊。输入会话 ID 或 {"conversationId":"…"}。', 'Open only Channels or direct messages visible to the user in the current Team. Enter a conversation ID or {"conversationId":"…"}.'),
        options: () => operatorConversations(activeTeam).map(conversation => ({
          conversationId: conversation.id,
          name: conversation.name,
          kind: conversation.kind,
        })),
        perform: async input => {
          const conversationId = fleetActionId(input, 'conversationId')
          const conversation = operatorConversations(activeTeam).find(candidate => candidate.id === conversationId)
          if (conversation === undefined) throw new Error(`Unknown visible Fleet conversation ${JSON.stringify(conversationId)}`)
          setItems(current => ({ ...current, [`${activeTeam.teamId}:chat`]: conversationId }))
          setActiveTool('chat')
          setNavigationOpen(false)
          await waitForFleetPaint()
          return joyrideConversationFeedback(activeTeam, conversationId, true)
        },
      })
      register({
        id: 'fleet.member.select',
        label: panelText('打开 Fleet 成员资料', 'Open Fleet member profile'),
        scope: 'fleet',
        description: panelText('只允许打开当前团队中的其他成员；直播 VTuber 不能打开自己的成员资料。输入成员 ID 或 {"memberId":"…"}。', 'Open only other members in the current Team; a live VTuber cannot open its own member profile. Enter a member ID or {"memberId":"…"}.'),
        options: () => joyrideProfileMembers(activeTeam)
          .map(member => ({ memberId: member.id, name: member.name, role: member.role })),
        perform: async input => {
          const memberId = fleetActionId(input, 'memberId')
          const member = joyrideProfileMembers(activeTeam).find(candidate => candidate.id === memberId)
          if (member === undefined) throw new Error(`Unknown Fleet member ${JSON.stringify(memberId)}`)
          showMemberDetails(memberId)
          return joyrideMemberFeedback(activeTeam, memberId)
        },
      })
      register({
        id: 'fleet.agent.select',
        label: panelText('打开 Fleet Agent 内部视角', 'Open Fleet Agent view'),
        scope: 'fleet',
        description: panelText('只允许打开当前团队成员的内部视角。输入成员 ID 或 {"memberId":"…"}。', 'Open only the internal view of a member in the current Team. Enter a member ID or {"memberId":"…"}.'),
        options: () => activeTeam.members.map(member => ({ memberId: member.id, name: member.name, role: member.role })),
        perform: async input => {
          const memberId = fleetActionId(input, 'memberId')
          const member = activeTeam.members.find(candidate => candidate.id === memberId)
          if (member === undefined) throw new Error(`Unknown Fleet member ${JSON.stringify(memberId)}`)
          setItems(current => ({
            ...current,
            [`${activeTeam.teamId}:agent`]: agentViewItem(memberId, AGENT_CONTEXT_ITEM_ID),
          }))
          setActiveTool('agent')
          setNavigationOpen(false)
          return joyrideViewFeedback(activeTeam, 'agent', agentViewItem(memberId, AGENT_CONTEXT_ITEM_ID))
        },
      })
      register({
        id: 'fleet.agent.conversation.select',
        label: panelText('打开 Agent 视角中的会话', 'Open conversation in Agent view'),
        scope: 'fleet',
        description: panelText('只允许打开指定成员实际可见的频道或私聊。输入 {"memberId":"…","conversationId":"…"}。', 'Open only Channels or direct messages actually visible to the selected member. Enter {"memberId":"…","conversationId":"…"}.'),
        options: () => activeTeam.members.map(member => ({
          memberId: member.id,
          name: member.name,
          conversations: visibleAgentConversations(activeTeam, member).map(conversation => ({
            conversationId: conversation.id,
            name: conversation.name,
            kind: conversation.kind,
          })),
        })),
        perform: async input => {
          const record = fleetActionRecord(input)
          const memberId = fleetActionId(record, 'memberId')
          const conversationId = fleetActionId(record, 'conversationId')
          const member = activeTeam.members.find(candidate => candidate.id === memberId)
          if (member === undefined) throw new Error(`Unknown Fleet member ${JSON.stringify(memberId)}`)
          const conversation = visibleAgentConversations(activeTeam, member).find(candidate => candidate.id === conversationId)
          if (conversation === undefined) throw new Error(`Conversation ${JSON.stringify(conversationId)} is not visible to ${JSON.stringify(memberId)}`)
          setItems(current => ({
            ...current,
            [`${activeTeam.teamId}:agent`]: agentViewItem(memberId, conversationId),
          }))
          setActiveTool('agent')
          setNavigationOpen(false)
          await waitForFleetPaint()
          return {
            perspective: joyrideViewFeedback(activeTeam, 'agent', agentViewItem(memberId, conversationId)),
            conversation: joyrideConversationFeedback(activeTeam, conversationId, true),
          }
        },
      })
      register({
        id: 'fleet.resource.select',
        label: panelText('打开 Fleet 团队文件', 'Open Fleet Team file'),
        scope: 'fleet',
        description: panelText('只允许打开当前团队已经注册的文件、计划或清单。输入资源 ID 或 {"resourceId":"…"}。', 'Open only files, plans, or checklists already registered with the current Team. Enter a resource ID or {"resourceId":"…"}.'),
        options: () => activeTeam.resources.map(resource => ({
          resourceId: resource.id,
          name: resource.name,
          kind: resource.kind,
        })),
        perform: input => {
          const resourceId = fleetActionId(input, 'resourceId')
          const resource = activeTeam.resources.find(candidate => candidate.id === resourceId)
          if (resource === undefined) throw new Error(`Unknown Fleet resource ${JSON.stringify(resourceId)}`)
          setItems(current => ({ ...current, [`${activeTeam.teamId}:resources`]: resourceId }))
          setActiveTool('resources')
          setNavigationOpen(false)
          return joyrideResourceFeedback(activeTeam, resourceId)
        },
      })
      register({
        id: 'fleet.workspace.select',
        label: panelText('打开 Fleet 工作区信息', 'Open Fleet workspace information'),
        scope: 'fleet',
        description: panelText('只允许选择当前团队已经挂载的工作区。输入工作区 ID 或 {"workspaceId":"…"}。', 'Select only workspaces already mounted by the current Team. Enter a workspace ID or {"workspaceId":"…"}.'),
        options: () => (activeTeam.workspaces ?? []).map(workspace => ({
          workspaceId: workspace.id,
          name: workspace.name,
          access: workspace.access,
        })),
        perform: input => {
          const workspaceId = fleetActionId(input, 'workspaceId')
          const workspace = activeTeam.workspaces?.find(candidate => candidate.id === workspaceId)
          if (workspace === undefined) throw new Error(`Unknown Fleet workspace ${JSON.stringify(workspaceId)}`)
          setItems(current => ({ ...current, [`${activeTeam.teamId}:resources`]: workspaceId }))
          setActiveTool('resources')
          setNavigationOpen(false)
          return joyrideResourceFeedback(activeTeam, workspaceId)
        },
      })
      register({
        id: 'fleet.workspace.open',
        label: panelText('在 DSH 中浏览 Fleet 工作区', 'Browse Fleet workspace in DSH'),
        scope: 'fleet',
        description: panelText('只允许打开当前团队已经挂载的工作区根目录。输入工作区 ID 或 {"workspaceId":"…"}。', 'Open only the root of a workspace already mounted by the current Team. Enter a workspace ID or {"workspaceId":"…"}.'),
        options: () => (activeTeam.workspaces ?? []).map(workspace => ({
          workspaceId: workspace.id,
          name: workspace.name,
          access: workspace.access,
        })),
        perform: async input => {
          const workspaceId = fleetActionId(input, 'workspaceId')
          const workspace = activeTeam.workspaces?.find(candidate => candidate.id === workspaceId)
          if (workspace === undefined) throw new Error(`Unknown Fleet workspace ${JSON.stringify(workspaceId)}`)
          await nativeContext.openPath(workspace.path)
          return { workspaceId, name: workspace.name, path: workspace.path }
        },
      })
      register({
        id: 'fleet.activity.select',
        label: panelText('筛选 Fleet 团队动态', 'Filter Fleet Team activity'),
        scope: 'fleet',
        description: panelText('只允许选择 all、message、resource、decision、memory 五种现有动态视图。输入筛选名或 {"kind":"…"}。', 'Choose one of the available activity views: all, message, resource, decision, or memory. Enter a filter name or {"kind":"…"}.'),
        options: () => ['all', 'message', 'resource', 'decision', 'memory'],
        perform: input => {
          const kind = typeof input === 'string' ? input : fleetActionId(input, 'kind')
          if (!['all', 'message', 'resource', 'decision', 'memory'].includes(kind)) throw new Error(`Unknown Fleet activity filter ${JSON.stringify(kind)}`)
          setItems(current => ({ ...current, [`${activeTeam.teamId}:activity`]: kind }))
          setActiveTool('activity')
          setNavigationOpen(false)
          return joyrideViewFeedback(activeTeam, 'activity', kind)
        },
      })
    }
    return () => { for (const unregister of dispose) unregister() }
  }, [activeItem, activeTeam, activeTool, items, joyride, nativeContext])

  const rail = jsxs('nav', {
    className: 'dsh-fleet-panel-rail',
    'aria-label': panelText('Fleet 工具', 'Fleet tools'),
    children: [
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-rail-brand',
        'aria-label': panelText('团队首页', 'Team home'),
        'aria-current': visibleTool === 'home' ? 'page' : undefined,
        'data-joyride-action': FLEET_VIEW_ACTIONS.home,
        title: panelText('团队首页', 'Team home'),
        onClick: showTeamDirectory,
        children: jsx(HarmonyBrandIcon, {}),
      }),
      jsx('div', {
        className: 'dsh-fleet-panel-rail-tools',
        children: renderSlot(FLEET_PANEL_SLOTS.tool, {
          activeTool: visibleTool,
          disabled: activeTeam === undefined,
          selectTool,
          ui: FLEET_PANEL_UI,
        }),
      }),
    ],
  })

  const homeOwner: FleetPanelHomeOwner = {
    sessionId,
    fleet: effectiveSnapshot,
    markdownRendererAvailable,
    ...(homeTeamId === null ? {} : { focusedTeamId: homeTeamId }),
    selectTeam,
    openTeamMessages,
    ...(source?.controlTeam === undefined ? {} : {
      controlTeamById: (teamId: string, action: FleetPanelTeamControlInput['action'], summary?: string) =>
        source.controlTeam?.({ sessionId, teamId, action, ...(summary === undefined ? {} : { summary }) }) ?? Promise.resolve(),
    }),
    ...(source?.loadTeamSettings === undefined ? {} : { loadTeamSettings: source.loadTeamSettings }),
    ...(source?.updateTeamSettings === undefined ? {} : {
      updateTeamSettings: (teamId: string, settings: FleetPanelTeamSettingsInput['settings']) => source.updateTeamSettings?.({
        sessionId,
        teamId,
        settings,
      }) ?? Promise.reject(new Error(panelText('Fleet 团队设置接口不可用', 'Fleet Team settings API is unavailable'))),
    }),
    ...(source?.updateBudget === undefined ? {} : {
      updateBudget: (teamId: string, input: Omit<FleetPanelBudgetInput, 'sessionId' | 'teamId'>) => source.updateBudget?.({
        sessionId,
        teamId,
        ...input,
      }) ?? Promise.reject(new Error(panelText('Fleet 预算接口不可用', 'Fleet budget API is unavailable'))),
    }),
    ...(source?.configureTeamRequest === undefined ? {} : {
      configureTeamRequest: (teamId: string, request: FleetPanelTeamRequestInput['request']) => source.configureTeamRequest?.({
        sessionId,
        teamId,
        request,
      }) ?? Promise.reject(new Error(panelText('Fleet 团队模型配置不可用', 'Fleet Team model configuration is unavailable'))),
    }),
    ...(source?.exportTeam === undefined ? {} : { exportTeam: source.exportTeam }),
    ...(source?.exportArchive === undefined ? {} : {
      exportArchive: (teamId: string, includeWorkspace: boolean) => source.exportArchive?.({
        sessionId,
        teamId,
        includeWorkspace,
      }) ?? Promise.reject(new Error(panelText('Fleet 存档导出不可用', 'Fleet archive export is unavailable'))),
    }),
    ...(source?.importArchive === undefined ? {} : {
      importArchive: (file: File, projectRoot: string, mode: 'copy' | 'restore') => source.importArchive?.({
        sessionId,
        file,
        projectRoot,
        mode,
      }) ?? Promise.reject(new Error(panelText('Fleet 存档导入不可用', 'Fleet archive import is unavailable'))),
    }),
    openNavigation: () => { setNavigationOpen(true) },
    renderPanelSlot: renderSlot,
    useSessions,
    nativeContext,
    SessionProvider,
    t,
    ui: FLEET_PANEL_UI,
  }
  const paneOwner: FleetPanelPaneOwner | undefined = activeTeam === undefined ? undefined : {
    ...homeOwner,
    selectTeam: switchTeam,
    snapshot: activeTeam,
    activeItem,
    selectItem,
    showMemberDetails,
    showMemberContext,
    openResource,
    ...(tutorial || source?.uploadResource === undefined ? {} : {
      uploadResource: (file: File) => source.uploadResource?.({ sessionId, teamId: activeTeam.teamId, file })
        ?? Promise.reject(new Error(panelText('Fleet 资源上传不可用', 'Fleet resource upload is unavailable'))),
    }),
    ...(tutorial || source?.removeResource === undefined ? {} : {
      removeResource: (resourceId: string) => source.removeResource?.({
        sessionId,
        teamId: activeTeam.teamId,
        resourceId,
      }) ?? Promise.reject(new Error(panelText('Fleet 资源移除不可用', 'Fleet resource removal is unavailable'))),
    }),
    ...(tutorial || source?.controlMember === undefined ? {} : {
      controlMember: (memberId: string, action: FleetPanelMemberControlInput['action']) =>
        source.controlMember?.({ sessionId, teamId: activeTeam.teamId, memberId, action }) ?? Promise.resolve(),
    }),
    ...(tutorial || source?.configureMemberRequest === undefined ? {} : {
      configureMemberRequest: (memberId: string, assistant: boolean, request: FleetPanelTeamRequestInput['request']) =>
        source.configureMemberRequest?.({
          sessionId,
          teamId: activeTeam.teamId,
          memberId,
          assistant,
          request,
        }) ?? Promise.reject(new Error(panelText('Fleet 成员模型配置不可用', 'Fleet member model configuration is unavailable'))),
    }),
    ...(tutorial || source?.loadMemberAuthorization === undefined ? {} : {
      loadMemberAuthorization: source.loadMemberAuthorization,
    }),
    ...(tutorial || source?.updateMemberPermissions === undefined ? {} : {
      updateMemberPermissions: (
        memberId: string,
        assignment?: FleetPanelMemberPermissionAssignment,
        reset?: boolean,
      ) =>
        source.updateMemberPermissions?.({
          sessionId,
          teamId: activeTeam.teamId,
          memberId,
          ...(assignment === undefined ? {} : { assignment }),
          ...(reset === undefined ? {} : { reset }),
        }) ?? Promise.reject(new Error(panelText('Fleet 成员权限接口不可用', 'Fleet member permissions API is unavailable'))),
    }),
    ...(tutorial || source?.loadMemberAccess === undefined ? {} : {
      loadMemberAccess,
    }),
    ...(tutorial || source?.updateMemberAccess === undefined ? {} : {
      updateMemberAccess: (memberId: string, change: FleetPanelMemberAccessChange) =>
        source.updateMemberAccess?.({
          sessionId,
          teamId: activeTeam.teamId,
          memberId,
          change,
        }) ?? Promise.reject(new Error(panelText('Fleet 成员资源访问接口不可用', 'Fleet member resource access API is unavailable'))),
    }),
    ...(tutorial || source?.controlTeam === undefined ? {} : {
      controlTeam: (action: FleetPanelTeamControlInput['action'], summary?: string) =>
        source.controlTeam?.({ sessionId, teamId: activeTeam.teamId, action, ...(summary === undefined ? {} : { summary }) }) ?? Promise.resolve(),
    }),
    draft: composeState.draft,
    urgent: composeState.urgent,
    sending: composeState.sending,
    sendError: composeState.error,
    setDraft: draft => {
      if (composeKey === '') return
      setComposeStates(current => ({
        ...current,
        [composeKey]: { ...(current[composeKey] ?? EMPTY_COMPOSE_STATE), draft, error: null },
      }))
    },
    setUrgent: urgent => {
      if (composeKey === '') return
      setComposeStates(current => ({
        ...current,
        [composeKey]: { ...(current[composeKey] ?? EMPTY_COMPOSE_STATE), urgent, error: null },
      }))
    },
    sendMessage,
    ...(source?.loadMemberTrace === undefined ? {} : { loadMemberTrace: source.loadMemberTrace }),
    ...(source?.subscribeMemberTrace === undefined ? {} : { subscribeMemberTrace: source.subscribeMemberTrace }),
    ...(tutorial || source?.loadConversationMessages === undefined ? {} : {
      loadConversationMessages: source.loadConversationMessages,
    }),
    ...(tutorial || source?.loadResource === undefined ? {} : { loadResource: source.loadResource }),
    ...(contextSource === undefined ? {} : { contextSource }),
    openMessageSource,
    showTeamDirectory,
  }
  const slotOwner = activeTool === 'home' || paneOwner === undefined ? homeOwner : paneOwner
  const slotKey = activeTool === 'home' || paneOwner !== undefined ? activeTool : 'home'
  return jsxs('section', {
    className: 'dsh-fleet-panel',
    style: { '--dsh-fleet-panel-sidebar-width': `${sidebarWidth}px` } as CSSProperties,
    'data-conversation-composer-overlay': '',
    'data-fleet-team-panel': '',
    'data-navigation-open': navigationOpen ? 'true' : 'false',
    'aria-label': panelText('团队面板', 'Team panel'),
    children: [
      rail,
      jsxs('aside', {
        className: 'dsh-fleet-panel-sidebar-seat',
        children: [
          jsx('div', {
            className: 'dsh-fleet-panel-connection-sidebar',
            children: effectiveSnapshot.connection?.status !== 'connected' && jsx(PanelConnectionNotice, {
              connection: effectiveSnapshot.connection,
              retry: source?.retry,
            }),
          }),
          renderSlot(FLEET_PANEL_SLOTS.sidebar, slotOwner as unknown as Record<string, unknown>, {
            entryKey: slotKey,
            fallback: jsx(PanelUnavailable, { label: slotKey }),
          }),
        ],
      }),
      jsx(PaneResizeHandle, {
        width: sidebarWidth,
        resizing: paneResize.resizing,
        startResize: paneResize.startResize,
        moveResize: paneResize.moveResize,
        stopResize: paneResize.stopResize,
        resizeWithKeyboard: paneResize.resizeWithKeyboard,
        resetWidth: paneResize.resetWidth,
        onLostPointerCapture: paneResize.onLostPointerCapture,
      }),
      jsx('main', {
        className: 'dsh-fleet-panel-main',
        children: [
          effectiveSnapshot.connection?.status !== 'connected' && jsx(PanelConnectionNotice, {
            connection: effectiveSnapshot.connection,
            retry: source?.retry,
          }),
          jsx('div', {
            className: 'dsh-fleet-panel-main-content',
            children: renderSlot(FLEET_PANEL_SLOTS.main, slotOwner as unknown as Record<string, unknown>, {
              entryKey: slotKey,
              fallback: jsx(PanelUnavailable, { label: slotKey }),
            }),
          }),
        ],
      }),
    ],
  })
}

function PanelConnectionNotice({ connection, retry }: {
  readonly connection: FleetPanelSnapshot['connection']
  readonly retry?: FleetPanelSource['retry']
}): ReactElement | null {
  if (connection === undefined || connection.status === 'connected') return null
  const loading = connection.status === 'loading'
  return jsxs('div', {
    className: 'dsh-fleet-panel-connection',
    'data-status': connection.status,
    role: loading ? 'status' : 'alert',
    'aria-live': loading ? 'polite' : 'assertive',
    children: [
      jsx('span', { className: 'dsh-fleet-panel-connection-dot', 'aria-hidden': 'true' }),
      jsx('span', {
        className: 'dsh-fleet-panel-connection-copy',
        children: loading
          ? panelText('正在连接 Fleet…', 'Connecting to Fleet…')
          : panelText(
              `Fleet 连接中断，正在显示上次同步的数据。${connection.error === undefined ? '' : ` ${connection.error}`}`,
              `Fleet connection was interrupted. Showing the last synchronized data.${connection.error === undefined ? '' : ` ${connection.error}`}`,
            ),
      }),
      !loading && retry !== undefined && jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-connection-retry',
        onClick: () => { void retry() },
        children: panelText('重试', 'Retry'),
      }),
    ],
  })
}

export function FleetPanelToolButton({ owner, tool, label, actionId, children }: FleetPanelToolButtonProps): ReactElement {
  const active = owner.activeTool === tool
  return jsx('button', {
    type: 'button',
    className: 'dsh-fleet-panel-tool',
    disabled: owner.disabled === true,
    'aria-label': label,
    'aria-current': active ? 'page' : undefined,
    'data-joyride-action': actionId ?? FLEET_VIEW_ACTIONS[tool as keyof typeof FLEET_VIEW_ACTIONS],
    title: label,
    onClick: () => { owner.selectTool(tool) },
    children,
  })
}

function ToolButton({ owner, tool, label, icon }: {
  readonly owner: FleetPanelToolOwner
  readonly tool: string
  readonly label: string
  readonly icon: PanelIconName
}): ReactElement {
  return jsx(FleetPanelToolButton, {
    owner,
    tool,
    label,
    children: jsx(PanelIcon, { name: icon }),
  })
}

function ChatTool(owner: FleetPanelToolOwner): ReactElement {
  return jsx(ToolButton, { owner, tool: 'chat', label: panelText('消息', 'Messages'), icon: 'chat' })
}
function TeamTool(owner: FleetPanelToolOwner): ReactElement {
  return jsx(ToolButton, { owner, tool: 'team', label: panelText('成员', 'Members'), icon: 'team' })
}
function AgentTool(owner: FleetPanelToolOwner): ReactElement {
  return jsx(ToolButton, { owner, tool: 'agent', label: panelText('单 Agent 视图', 'Single-Agent view'), icon: 'agent' })
}
function ResourcesTool(owner: FleetPanelToolOwner): ReactElement {
  return jsx(ToolButton, { owner, tool: 'resources', label: panelText('共享资源', 'Shared resources'), icon: 'resources' })
}
function ActivityTool(owner: FleetPanelToolOwner): ReactElement {
  return jsx(ToolButton, { owner, tool: 'activity', label: panelText('团队动态', 'Team activity'), icon: 'activity' })
}


// Budget-domain types stay above; components extracted to budget-panel.ts.
import {
  FleetBudgetMeter,
  BudgetSettings,
  fleetContextOccupancy,
} from './budget-panel.js'
export { FleetBudgetMeter, BudgetSettings, fleetContextOccupancy }

// Dialog components extracted to settings-panel.ts.
import {
  TeamSettingsDialog,
  TeamImportDialog,
  EndTeamDialog,
} from './settings-panel.js'
export { TeamSettingsDialog, TeamImportDialog, EndTeamDialog }

function focusCurrentRadioMenuItem(menu: HTMLDivElement): void {
  const current = menu.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
  const first = menu.querySelector<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)')
  ;(current ?? first)?.focus()
}

function handleRadioMenuKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  close: () => void,
): void {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)'))
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    if (event.target instanceof HTMLButtonElement && items.includes(event.target)) {
      event.preventDefault()
      event.target.click()
    }
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || items.length === 0) return

  event.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Home') items[0]?.focus()
  else if (event.key === 'End') items.at(-1)?.focus()
  else if (event.key === 'ArrowDown') items[(current + 1) % items.length]?.focus()
  else items[(current <= 0 ? items.length : current) - 1]?.focus()
}

function useFleetRadioMenu(selectedKey: string | undefined, itemCount: number) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && menu.current !== null) focusCurrentRadioMenuItem(menu.current)
  }, [itemCount, open, selectedKey])

  const close = (restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => { trigger.current?.focus() })
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOpen(false)
  }
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      setOpen(true)
    }
  }
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    handleRadioMenuKeyDown(event, () => { close(true) })
  }
  return { open, setOpen, trigger, menu, close, onBlur, onTriggerKeyDown, onMenuKeyDown }
}

export function FleetPanelTeamSwitcher({ teams, selectedTeamId, label, selectTeam }: FleetPanelTeamSwitcherProps): ReactElement {
  const radio = useFleetRadioMenu(selectedTeamId, teams.length)

  return jsxs('div', {
    className: 'dsh-fleet-panel-team-switcher',
    onBlur: radio.onBlur,
    children: [
      jsxs('button', {
        ref: radio.trigger,
        type: 'button',
        className: 'dsh-fleet-panel-team-switch',
        'aria-haspopup': 'menu',
        'aria-expanded': radio.open ? 'true' : 'false',
        title: panelText('切换团队', 'Switch Team'),
        onClick: () => { radio.setOpen(current => !current) },
        onKeyDown: radio.onTriggerKeyDown,
        children: [
          jsx('span', { className: 'dsh-fleet-panel-team-switch-name', children: label }),
          jsx('span', {
            className: 'dsh-fleet-panel-team-switch-chevron',
            children: jsx(PanelIcon, { name: 'chevron', size: 14 }),
          }),
        ],
      }),
      radio.open && jsx('div', {
        ref: radio.menu,
        className: 'dsh-fleet-panel-team-menu',
        role: 'menu',
        'aria-label': panelText('切换团队', 'Switch Team'),
        onKeyDown: radio.onMenuKeyDown,
        children: teams.map(team => jsxs('button', {
          type: 'button',
          tabIndex: -1,
          className: 'dsh-fleet-panel-team-option',
          role: 'menuitemradio',
          'aria-checked': team.teamId === selectedTeamId ? 'true' : 'false',
          onClick: () => {
            selectTeam(team.teamId)
            radio.close(true)
          },
          children: [
            team.status !== undefined && jsx('span', { className: 'dsh-fleet-panel-team-row-status', 'data-status': team.status }),
            jsx('span', { className: 'dsh-fleet-panel-team-option-name', children: team.teamName }),
          ],
        }, team.teamId)),
      }),
    ],
  })
}

function SidebarHead({ sessionId, teams, selectedTeamId, label, selectTeam, loadTeamSettings, updateTeamSettings, updateBudget, configureTeamRequest, controlTeamById, exportTeam, exportArchive, importArchive, secondary }: {
  readonly sessionId: string
  readonly teams: readonly FleetPanelTeamSummary[]
  readonly selectedTeamId?: string
  readonly label: string
  readonly selectTeam: (teamId: string) => void
  readonly loadTeamSettings?: FleetPanelSource['loadTeamSettings']
  readonly updateTeamSettings?: (teamId: string, settings: FleetPanelTeamSettingsInput['settings']) => Promise<FleetPanelTeamSettings>
  readonly updateBudget?: (teamId: string, input: Omit<FleetPanelBudgetInput, 'sessionId' | 'teamId'>) => Promise<FleetPanelTeamBudget>
  readonly configureTeamRequest?: (teamId: string, request: FleetPanelTeamRequestInput['request']) => Promise<void>
  readonly controlTeamById?: (teamId: string, action: FleetPanelTeamControlInput['action'], summary?: string) => Promise<void>
  readonly exportTeam?: FleetPanelSource['exportTeam']
  readonly exportArchive?: (teamId: string, includeWorkspace: boolean) => Promise<FleetPanelArchiveFile>
  readonly importArchive?: (file: File, projectRoot: string, mode: 'copy' | 'restore') => Promise<void>
  readonly secondary?: ReactNode
}): ReactElement {
  const [dialogOpen, setDialogOpen] = useState<'settings' | 'import'>()
  const [settingsInitialTab, setSettingsInitialTab] = useState<TeamSettingsTab>('general')
  const selectedTeam = teams.find(team => team.teamId === selectedTeamId)
  const settingsRequest = useSyncExternalStore(
    subscribeFleetTeamSettingsRequest,
    () => getFleetTeamSettingsRequest(),
    () => undefined,
  )

  useEffect(() => {
    if (settingsRequest === undefined || settingsRequest.teamId !== selectedTeamId || selectedTeam === undefined) return
    setSettingsInitialTab(settingsRequest.tab)
    setDialogOpen('settings')
    completeFleetTeamSettingsRequest(settingsRequest.id)
  }, [selectedTeam, selectedTeamId, settingsRequest])

  return jsxs('div', {
    className: 'dsh-fleet-panel-sidebar-team-block',
    children: [
      jsxs('div', {
        className: 'dsh-fleet-panel-sidebar-team-primary',
        children: [
          jsx(FleetPanelTeamSwitcher, { teams, selectedTeamId, label, selectTeam }),
          (selectedTeam?.tutorial !== true && (selectedTeam !== undefined || importArchive !== undefined)) && jsx('button', {
            type: 'button',
            className: 'dsh-fleet-panel-team-settings',
            'aria-label': selectedTeam === undefined ? panelText('导入团队', 'Import Team') : panelText('团队设置', 'Team settings'),
            title: selectedTeam === undefined ? panelText('导入团队', 'Import Team') : panelText('团队设置', 'Team settings'),
            onClick: () => {
              setSettingsInitialTab('general')
              setDialogOpen(selectedTeam === undefined ? 'import' : 'settings')
            },
            children: jsx(PanelIcon, { name: selectedTeam === undefined ? 'upload' : 'settings', size: 16 }),
          }),
        ],
      }),
      secondary,
      dialogOpen === 'settings' && selectedTeam !== undefined && jsx(TeamSettingsDialog, {
        sessionId,
        team: selectedTeam,
        initialTab: settingsInitialTab,
        ...(loadTeamSettings === undefined ? {} : { loadSettings: loadTeamSettings }),
        ...(updateTeamSettings === undefined ? {} : { updateSettings: (settings: FleetPanelTeamSettingsInput['settings']) => updateTeamSettings(selectedTeam.teamId, settings) }),
        ...(updateBudget === undefined ? {} : { updateBudget: (input: Omit<FleetPanelBudgetInput, 'sessionId' | 'teamId'>) => updateBudget(selectedTeam.teamId, input) }),
        ...(configureTeamRequest === undefined ? {} : { configureRequest: (request: FleetPanelTeamRequestInput['request']) => configureTeamRequest(selectedTeam.teamId, request) }),
        ...(exportTeam === undefined ? {} : { exportTeam }),
        ...(exportArchive === undefined ? {} : { exportArchive }),
        ...(controlTeamById === undefined ? {} : { finishTeam: (summary: string) => controlTeamById(selectedTeam.teamId, 'close', summary).then(() => { setDialogOpen(undefined) }) }),
        onClose: () => { setDialogOpen(undefined) },
      }),
      dialogOpen === 'import' && importArchive !== undefined && jsx(TeamImportDialog, { importArchive, onClose: () => { setDialogOpen(undefined) } }),
    ],
  })
}

function AgentPicker({ members, selectedMemberId, selectMember }: {
  readonly members: readonly FleetPanelMember[]
  readonly selectedMemberId?: string
  readonly selectMember: (member: FleetPanelMember) => void
}): ReactElement {
  const selected = members.find(member => member.id === selectedMemberId) ?? members[0]
  const radio = useFleetRadioMenu(selected?.id, members.length)

  if (selected === undefined) {
    return jsx('button', {
      type: 'button',
      className: 'dsh-fleet-panel-agent-switch',
      disabled: true,
      children: panelText('没有可选 Agent', 'No Agents available'),
    })
  }
  return jsxs('div', {
    className: 'dsh-fleet-panel-agent-switcher',
    onBlur: radio.onBlur,
    children: [
      jsxs('button', {
        ref: radio.trigger,
        type: 'button',
        className: 'dsh-fleet-panel-agent-switch',
        'aria-haspopup': 'menu',
        'aria-expanded': radio.open ? 'true' : 'false',
        'aria-label': panelText(`切换 Agent，当前为 ${selected.name}`, `Switch Agent; currently ${selected.name}`),
        onClick: () => { radio.setOpen(current => !current) },
        onKeyDown: radio.onTriggerKeyDown,
        children: [
          jsx(FleetChatAvatar, { member: selected, size: 24, showPresence: true }),
          jsxs('span', {
            className: 'dsh-fleet-panel-agent-switch-copy',
            children: [
              jsx('div', { className: 'dsh-fleet-panel-agent-switch-name', children: selected.name }),
              jsx('div', {
                className: 'dsh-fleet-panel-agent-switch-role',
                children: jsxs(Fragment, {
                  children: [
                    selected.role,
                    ' · ',
                    jsx(FleetPresenceLabel, {
                      presence: fleetMemberPresence(selected),
                      label: fleetMemberPresenceLabel(selected),
                    }),
                  ],
                }),
              }),
            ],
          }),
          jsx('span', {
            className: 'dsh-fleet-panel-agent-switch-chevron',
            children: jsx(PanelIcon, { name: 'chevron', size: 14 }),
          }),
        ],
      }),
      radio.open && jsx('div', {
        ref: radio.menu,
        className: 'dsh-fleet-panel-team-menu',
        role: 'menu',
        'aria-label': panelText('选择 Agent 视角', 'Choose Agent view'),
        onKeyDown: radio.onMenuKeyDown,
        children: members.map(member => jsxs('button', {
          type: 'button',
          tabIndex: -1,
          className: 'dsh-fleet-panel-team-option',
          role: 'menuitemradio',
          'aria-checked': member.id === selected.id ? 'true' : 'false',
          onClick: () => {
            selectMember(member)
            radio.close(true)
          },
          children: [
            jsx(FleetChatAvatar, { member, size: 24, showPresence: true }),
            jsxs('span', {
              className: 'dsh-fleet-panel-agent-switch-copy',
              children: [
                jsx('div', { className: 'dsh-fleet-panel-agent-switch-name', children: member.name }),
                jsx('div', {
                  className: 'dsh-fleet-panel-agent-switch-role',
                  children: jsxs(Fragment, {
                    children: [
                      member.role,
                      ' · ',
                      jsx(FleetPresenceLabel, {
                        presence: fleetMemberPresence(member),
                        label: fleetMemberPresenceLabel(member),
                      }),
                    ],
                  }),
                }),
              ],
            }),
          ],
        }, member.id)),
      }),
    ],
  })
}

function SidebarSearch({ placeholder, query, setQuery }: {
  readonly placeholder: string
  readonly query: string
  readonly setQuery: (query: string) => void
}): ReactElement {
  return jsx('div', {
    className: 'dsh-fleet-panel-sidebar-head',
    children: jsxs('label', {
      className: 'dsh-fleet-panel-search-wrap',
      children: [
        jsx(PanelIcon, { name: 'search', size: 14 }),
        jsx('input', {
          className: 'dsh-fleet-panel-search',
          type: 'search',
          'aria-label': placeholder,
          value: query,
          placeholder,
          onChange: (event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value) },
        }),
      ],
    }),
  })
}

function PaneSidebar({ owner, placeholder, query, setQuery, children }: {
  readonly owner: FleetPanelPaneOwner
  readonly placeholder: string
  readonly query: string
  readonly setQuery: (query: string) => void
  readonly children: ReactNode
}): ReactElement {
  return jsxs('div', {
    className: 'dsh-fleet-panel-sidebar-layout',
    children: [
      jsx(SidebarHead, {
        sessionId: owner.sessionId,
        teams: owner.fleet.directory.teams,
        selectedTeamId: owner.snapshot.teamId,
        label: owner.snapshot.teamName,
        selectTeam: owner.selectTeam,
        ...(owner.loadTeamSettings === undefined ? {} : { loadTeamSettings: owner.loadTeamSettings }),
        ...(owner.updateTeamSettings === undefined ? {} : { updateTeamSettings: owner.updateTeamSettings }),
        ...(owner.updateBudget === undefined ? {} : { updateBudget: owner.updateBudget }),
        ...(owner.configureTeamRequest === undefined ? {} : { configureTeamRequest: owner.configureTeamRequest }),
        ...(owner.controlTeam === undefined ? {} : { controlTeamById: (teamId: string, action: FleetPanelTeamControlInput['action'], summary?: string) => owner.controlTeam?.(action, summary) ?? Promise.resolve() }),
        ...(owner.exportTeam === undefined ? {} : { exportTeam: owner.exportTeam }),
        ...(owner.exportArchive === undefined ? {} : { exportArchive: owner.exportArchive }),
        ...(owner.importArchive === undefined ? {} : { importArchive: owner.importArchive }),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-sidebar',
        children: [
          jsx(SidebarSearch, { placeholder, query, setQuery }),
          jsx('div', { className: 'dsh-fleet-panel-sidebar-scroll', children }),
        ],
      }),
    ],
  })
}

export function SectionTitle({ children }: { readonly children: ReactNode }): ReactElement {
  return jsx('div', { className: 'dsh-fleet-panel-section-title', children })
}

export function ListRow({ selected, title, caption, leading, trailing, elementRef, interaction, onClick }: FleetPanelListRowProps): ReactElement {
  return jsxs('button', {
    ref: elementRef,
    type: 'button',
    className: 'dsh-fleet-panel-list-row',
    'aria-current': selected ? 'true' : undefined,
    ...(interaction === undefined ? {} : {
      'aria-haspopup': 'dialog' as const,
      'aria-expanded': interaction.expanded ? 'true' : 'false',
      'aria-controls': interaction.controls,
      onMouseEnter: interaction.onMouseEnter,
      onFocus: interaction.onFocus,
      onBlur: interaction.onBlur,
    }),
    onClick,
    children: [
      leading,
      jsxs('span', {
        className: 'dsh-fleet-panel-list-copy',
        children: [
          jsx('div', { className: 'dsh-fleet-panel-list-title', children: title }),
          caption !== undefined && jsx('div', { className: 'dsh-fleet-panel-list-caption', children: caption }),
        ],
      }),
      trailing,
    ],
  })
}

function ChannelListRow({ conversation, selected, onClick }: {
  readonly conversation: FleetPanelConversation
  readonly selected: boolean
  readonly onClick: () => void
}): ReactElement {
  return jsx(FleetInfoHint, {
    className: 'dsh-fleet-panel-channel-hint',
    label: panelText(`关于频道“${conversation.name}”`, `About Channel “${conversation.name}”`),
    title: panelText(`频道 · ${conversation.name}`, `Channel · ${conversation.name}`),
    seenMarker: 'fleet.channel',
    pinOnClick: false,
    footer: null,
    trigger: (hintProps: HoverHintTriggerProps) => jsx(ListRow, {
      elementRef: hintProps.ref as (element: HTMLButtonElement | null) => void,
      selected,
      title: conversation.name,
      caption: conversation.topic,
      leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'channel', size: 15 }) }),
      trailing: conversation.unread === undefined
        ? undefined
        : jsx('span', { className: 'dsh-fleet-panel-unread', children: conversation.unread }),
      onClick,
    }),
    children: jsxs(Fragment, {
      children: [
        jsx('p', {
          className: 'dsh-hover-hint-lead',
          children: panelText('频道是团队内按主题共享的消息空间。', 'A Channel is a topic-based message space shared within a Team.'),
        }),
        jsxs('section', {
          className: 'dsh-hover-hint-section',
          children: [
            jsx('h4', { children: panelText('谁能看到', 'Who can see it') }),
            jsx('p', { children: panelText('有访问权限的成员看到同一段频道历史；它不是成员之间的私聊。', 'Members with access share the same Channel history; it is not a direct conversation between members.') }),
          ],
        }),
        jsxs('section', {
          className: 'dsh-hover-hint-section',
          children: [
            jsx('h4', { children: panelText('与 Inbox 的区别', 'How it differs from Inbox') }),
            jsx('p', { children: panelText('频道保存共享历史；每位成员自己的 Inbox 只负责把相关频道消息送入其 Agent 上下文。', 'The Channel stores shared history; each member’s Inbox only delivers relevant Channel messages into that Agent’s context.') }),
          ],
        }),
      ],
    }),
  })
}

export function statusLabel(status: FleetPanelTeamSummary['status']): string {
  if (status === 'running') return panelText('运行中', 'Running')
  if (status === 'idle') return panelText('待命', 'Idle')
  if (status === 'paused') return panelText('已暂停', 'Paused')
  if (status === 'starting') return panelText('正在建立', 'Starting')
  if (status === 'finishing') return panelText('正在收尾', 'Finishing')
  if (status === 'closed') return panelText('已结束', 'Closed')
  if (status === 'failed') return panelText('异常', 'Error')
  return panelText('未连接', 'Disconnected')
}

export function runtimeStateLabel(state: NonNullable<FleetPanelTeamSummary['runtimeState']>): string {
  if (state === 'active') return panelText('活跃', 'Active')
  if (state === 'dormant') return panelText('休眠', 'Dormant')
  if (state === 'candidate') return panelText('候选', 'Candidate')
  return state
}

function renderSidebarSection(
  panel: FleetPanelHomeOwner | FleetPanelPaneOwner,
  tool: 'home' | FleetPanelToolId,
): ReactNode {
  const owner: FleetPanelSidebarSectionOwner = { panel, tool }
  return panel.renderPanelSlot(FLEET_PANEL_SLOTS.sidebarSection, owner as unknown as Record<string, unknown>)
}

// Main pane renderers live in their own module; these re-exports preserve the
// public surface used by existing integrations and tests.
import {
  FleetMemberListRow,
  FleetMemberMentionPopover,
  DetailShell,
  resourceFileName,
  formatBytes,
  MarkdownRendererUnavailableView,
  ResourceSourcePreview,
  ResourceDiffFallback,
  HomeMain,
  ChatMain,
  TeamMain,
  AgentMain,
  ResourcesMain,
  ResourceDetailMain,
  FleetMemberAvatarPopover,
  FleetReceiptMemberPopover,
  FleetPersistedMemberTrace,
  AgentContextMain,
  fleetResourcePreviewKind,
} from './pane-body.js'
export {
  renderMessageBlockExtension,
  renderMessageText,
  renderMemberMention,
  messageReadReceipt,
  useConversationHistory,
  MemberState,
  AgentPerspectiveMeta,
  FleetMemberListRow,
  FleetMemberAvatarPopover,
  FleetReceiptMemberPopover,
  FleetMemberMentionPopover,
  ChatMain,
  FleetPanelChatThread,
  DetailShell,
  NavigationToggle,
  Fact,
  HomeMain,
  TeamMain,
  FleetNativeMemberChat,
  traceMessageText,
  clipTraceText,
  traceEventPresentation,
  FleetPersistedMemberTrace,
  AgentContextMain,
  AgentMain,
  OpenFleetPath,
  ResourceComparison,
  ResourceSourcePreview,
  ResourceContentPreview,
  resourceMember,
  resourceActorName,
  ResourceDiffFallback,
  ResourceHistoryView,
  ResourceDetailMain,
  ResourcesMain,
  MarkdownRendererUnavailableView,
  formatBytes,
  resourceFileName,
  fleetResourcePreviewKind,
} from './pane-body.js'

// Activity renderers and timeline helpers are split from the panel shell while
// remaining available from this compatibility entry point.
import {
  ActivityMain,
  clampFleetTimelineTime,
  fleetActivityWindow,
  fleetActivityViewPosition,
  groupFleetActivity,
  fleetActivityGroups,
  nearestFleetActivityGroupIndex,
  fleetTimelineTicks,
  type FleetActivityWindow,
  type FleetActivityGroup,
  type FleetActivityViewPosition,
} from './activity-panel.js'
export {
  ActivityMain,
  clampFleetTimelineTime,
  fleetActivityWindow,
  fleetActivityViewPosition,
  groupFleetActivity,
  fleetActivityGroups,
  nearestFleetActivityGroupIndex,
  fleetTimelineTicks,
}


export interface FleetMemberMentionSegment {
  readonly text: string
  readonly member?: FleetPanelMember
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function splitFleetMemberMentions(
  text: string,
  members: readonly FleetPanelMember[],
): readonly FleetMemberMentionSegment[] {
  const references = new Map<string, FleetPanelMember>()
  for (const member of members) {
    for (const reference of [member.id, member.name]) {
      const normalized = reference.trim().toLocaleLowerCase()
      if (normalized !== '' && !references.has(normalized)) references.set(normalized, member)
    }
  }
  if (references.size === 0) return [{ text }]
  const alternatives = [...references.keys()].sort((left, right) => right.length - left.length)
    .map(escapeRegularExpression)
  const matcher = new RegExp(`@(?:${alternatives.join('|')})`, 'giu')
  const segments: FleetMemberMentionSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(matcher)) {
    const start = match.index
    const matched = match[0]
    const previous = start === 0 ? '' : text[start - 1] ?? ''
    const next = text[start + matched.length] ?? ''
    if (/[A-Za-z0-9._%+-]/u.test(previous)
      || (next !== '' && !/[\s,.;:!?，。；：！？、）)\]】}]/u.test(next))) continue
    const member = references.get(matched.slice(1).toLocaleLowerCase())
    if (member === undefined) continue
    if (start > cursor) segments.push({ text: text.slice(cursor, start) })
    segments.push({ text: matched, member })
    cursor = start + matched.length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments.length === 0 ? [{ text }] : segments
}

export interface FleetActiveMentionQuery {
  readonly start: number
  readonly end: number
  readonly query: string
}

export interface FleetActiveCommandQuery {
  readonly start: number
  readonly end: number
  readonly query: string
}

/** Return the leading slash token currently being edited by the caret. */
export function activeFleetCommandQuery(text: string, caret: number): FleetActiveCommandQuery | undefined {
  const end = Math.max(0, Math.min(text.length, caret))
  const prefix = text.slice(0, end)
  const match = /^(\s*)\/([^\s/]*)$/u.exec(prefix)
  if (match === null) return undefined
  const start = match[1]?.length ?? 0
  return { start, end, query: match[2] ?? '' }
}

export function activeFleetMentionQuery(text: string, caret: number): FleetActiveMentionQuery | undefined {
  const end = Math.max(0, Math.min(text.length, caret))
  const prefix = text.slice(0, end)
  const start = prefix.lastIndexOf('@')
  if (start < 0) return undefined
  const query = prefix.slice(start + 1)
  if (/[@\s,.;:!?，。；：！？、()[\]{}【】]/u.test(query)) return undefined
  const previous = start === 0 ? '' : prefix[start - 1] ?? ''
  if (/[A-Za-z0-9._%+-]/u.test(previous)) return undefined
  return { start, end, query }
}

export function insertFleetMemberMention(
  text: string,
  mention: FleetActiveMentionQuery,
  memberName: string,
): { readonly text: string; readonly caret: number } {
  const inserted = `@${memberName} `
  return {
    text: `${text.slice(0, mention.start)}${inserted}${text.slice(mention.end)}`,
    caret: mention.start + inserted.length,
  }
}

interface FleetMessageTextProps {
  readonly text: string
  readonly members: readonly FleetPanelMember[]
  readonly markdownRenderer?: FleetMarkdownRenderer
  readonly showMemberDetails?: (memberId: string) => void
  readonly showMemberContext?: (memberId: string) => void
}

export function FleetPlainMessageText({ text, members, showMemberDetails, showMemberContext }: FleetMessageTextProps): ReactElement {
  return jsx(Fragment, {
    children: splitFleetMemberMentions(text, members).map((segment, index) => segment.member === undefined
      ? jsx(Fragment, { children: segment.text }, index)
      : jsx(FleetMemberMentionPopover, {
          member: segment.member,
          label: segment.text,
          ...(showMemberDetails === undefined ? {} : { showDetails: showMemberDetails }),
          ...(showMemberContext === undefined ? {} : { showContext: showMemberContext }),
        }, index)),
  })
}





/** Keep replies in the conversation history while presenting them under their source message. */
export function groupFleetMessageThreads(
  messages: readonly FleetPanelMessage[],
): readonly FleetPanelMessageThread[] {
  const byId = new Map(messages.map(message => [message.id, message]))
  const rootById = new Map<string, FleetPanelMessage>()
  const resolving = new Set<string>()
  const rootOf = (message: FleetPanelMessage): FleetPanelMessage => {
    const cached = rootById.get(message.id)
    if (cached !== undefined) return cached
    const parent = message.replyTo === undefined ? undefined : byId.get(message.replyTo)
    if (parent === undefined || resolving.has(message.id)) {
      rootById.set(message.id, message)
      return message
    }
    resolving.add(message.id)
    const root = rootOf(parent)
    resolving.delete(message.id)
    rootById.set(message.id, root)
    return root
  }
  const threads = new Map<string, { message: FleetPanelMessage; comments: FleetPanelMessage[] }>()
  for (const message of messages) {
    const root = rootOf(message)
    if (!threads.has(root.id)) threads.set(root.id, { message: root, comments: [] })
  }
  for (const message of messages) {
    const root = rootOf(message)
    if (root.id !== message.id) threads.get(root.id)?.comments.push(message)
  }
  return [...threads.values()]
}

function HomeSidebar(owner: FleetPanelHomeOwner): ReactElement {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>(() => ({
    archived: true,
    ...readPanelPreferences().collapsedGroups,
  }))

  useEffect(() => {
    writePanelPreferences({ collapsedGroups: collapsed })
  }, [collapsed])

  const normalized = query.trim().toLocaleLowerCase()
  const teams = new Map(owner.fleet.directory.teams.map(team => [team.teamId, team]))
  const groups = owner.fleet.directory.groups.map(group => ({
    group,
    teams: group.teamIds.flatMap(teamId => {
      const team = teams.get(teamId)
      if (team === undefined) return []
      if (normalized !== '' && !team.teamName.toLocaleLowerCase().includes(normalized)
        && !team.primaryWorkspace?.toLocaleLowerCase().includes(normalized)) return []
      return [team]
    }),
  })).filter(entry => normalized === '' || entry.teams.length > 0)
  const focusedTeam = owner.fleet.directory.teams.find(team => team.teamId === owner.focusedTeamId)

  return jsxs('div', {
    className: 'dsh-fleet-panel-sidebar-layout',
    children: [
      jsx(SidebarHead, {
        sessionId: owner.sessionId,
        teams: owner.fleet.directory.teams,
        ...(focusedTeam === undefined ? {} : { selectedTeamId: focusedTeam.teamId }),
        label: focusedTeam?.teamName ?? panelText('所有团队', 'All Teams'),
        selectTeam: owner.selectTeam,
        ...(owner.loadTeamSettings === undefined ? {} : { loadTeamSettings: owner.loadTeamSettings }),
        ...(owner.updateTeamSettings === undefined ? {} : { updateTeamSettings: owner.updateTeamSettings }),
        ...(owner.updateBudget === undefined ? {} : { updateBudget: owner.updateBudget }),
        ...(owner.configureTeamRequest === undefined ? {} : { configureTeamRequest: owner.configureTeamRequest }),
        ...(owner.controlTeamById === undefined ? {} : { controlTeamById: owner.controlTeamById }),
        ...(owner.exportTeam === undefined ? {} : { exportTeam: owner.exportTeam }),
        ...(owner.exportArchive === undefined ? {} : { exportArchive: owner.exportArchive }),
        ...(owner.importArchive === undefined ? {} : { importArchive: owner.importArchive }),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-sidebar',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-panel-sidebar-head',
            children: [
              jsxs('div', {
                className: 'dsh-fleet-panel-team-row',
                children: [
                  jsx('h2', { className: 'dsh-fleet-panel-team-title', children: panelText('团队', 'Teams') }),
                ],
              }),
              jsxs('label', {
                className: 'dsh-fleet-panel-search-wrap',
                children: [
                  jsx(PanelIcon, { name: 'search', size: 14 }),
                  jsx('input', {
                    className: 'dsh-fleet-panel-search',
                    type: 'search',
                    'aria-label': panelText('搜索团队或工作区', 'Search Teams or Workspaces'),
                    value: query,
                    placeholder: panelText('搜索团队或工作区', 'Search Teams or Workspaces'),
                    onChange: (event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value) },
                  }),
                ],
              }),
            ],
          }),
          jsxs('div', {
            className: 'dsh-fleet-panel-sidebar-scroll',
            children: [
              groups.length === 0
                ? jsx('div', { className: 'dsh-fleet-panel-empty', children: panelText('没有匹配的团队', 'No Teams match') })
                : groups.map(({ group, teams: groupTeams }) => {
                  const open = collapsed[group.id] !== true
                  return jsxs('section', {
                    className: 'dsh-fleet-panel-directory-group',
                    children: [
                      jsxs('button', {
                        type: 'button',
                        className: 'dsh-fleet-panel-directory-summary',
                        'aria-expanded': open ? 'true' : 'false',
                        onClick: () => { setCollapsed(current => ({ ...current, [group.id]: open })) },
                        children: [
                          jsx('span', {
                            className: 'dsh-fleet-panel-directory-chevron',
                            'aria-hidden': 'true',
                            children: jsx(PanelIcon, { name: 'chevron', size: 12 }),
                          }),
                          jsx('span', { children: group.name }),
                          jsx('span', { className: 'dsh-fleet-panel-list-caption', children: groupTeams.length }),
                        ],
                      }),
                      open && groupTeams.map(team => jsx(ListRow, {
                        selected: owner.focusedTeamId === team.teamId,
                        title: team.teamName,
                        caption: team.tutorial === true
                          ? panelText('一次性引导 · 不会启动 Agent', 'One-time guide · No Agents started')
                          : [statusLabel(team.status), team.primaryWorkspace === undefined
                            ? panelText('未挂载工作区', 'No Workspace mounted')
                            : panelText(`主要工作区 · ${team.primaryWorkspace}`, `Primary Workspace · ${team.primaryWorkspace}`)].join(' · '),
                        leading: jsx('span', { className: 'dsh-fleet-panel-team-row-status', 'data-status': team.status }),
                        trailing: team.unread !== undefined
                          ? jsx('span', { className: 'dsh-fleet-panel-unread', children: team.unread })
                          : team.needsAttention === true ? jsx('span', { className: 'dsh-fleet-panel-attention', title: panelText('需要关注', 'Needs attention') }) : undefined,
                        onClick: () => { owner.selectTeam(team.teamId) },
                      }, `${group.id}:${team.teamId}`)),
                    ],
                  }, group.id)
                }),
              renderSidebarSection(owner, 'home'),
            ],
          }),
        ],
      }),
    ],
  })
}

function ChatSidebar(owner: FleetPanelPaneOwner): ReactElement {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLocaleLowerCase()
  const conversations = operatorConversations(owner.snapshot).filter(item =>
    normalized === '' || item.name.toLocaleLowerCase().includes(normalized) || item.topic?.toLocaleLowerCase().includes(normalized),
  )
  const channels = conversations.filter(item => item.kind === 'channel')
  const crossTeam = conversations.filter(item => item.kind === 'cross-team')
  const directs = conversations.filter(item => item.kind === 'direct')
  return jsx(PaneSidebar, {
    owner,
    placeholder: panelText('搜索频道或成员', 'Search Channels or members'),
    query,
    setQuery,
    children: [
          jsx(SectionTitle, { children: panelText('频道', 'Channels') }),
          ...channels.map(item => jsx(ChannelListRow, {
            conversation: item,
            selected: owner.activeItem === item.id,
            onClick: () => { owner.selectItem(item.id) },
          }, item.id)),
          ...(crossTeam.length === 0 ? [] : [
            jsx(SectionTitle, { children: panelText('跨团队', 'Cross-Team') }, 'cross-team-title'),
            ...crossTeam.map(item => jsx(ListRow, {
              selected: owner.activeItem === item.id,
              title: item.name,
              caption: item.topic,
              leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'channel', size: 15 }) }),
              trailing: item.unread === undefined ? undefined : jsx('span', { className: 'dsh-fleet-panel-unread', children: item.unread }),
              onClick: () => { owner.selectItem(item.id) },
            }, item.id)),
          ]),
          jsx(SectionTitle, { children: panelText('私聊', 'Direct messages') }),
          ...directs.map(item => {
            const peer = teamAgents(owner.snapshot).find(member => member.id === item.peerId)
            return jsx(ListRow, {
              selected: owner.activeItem === item.id,
              title: item.name,
              caption: item.topic,
              leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx('span', {
                className: 'dsh-fleet-panel-presence',
                'data-presence': peer?.presence ?? 'offline',
              }) }),
              onClick: () => { owner.selectItem(item.id) },
            }, item.id)
          }),
          renderSidebarSection(owner, 'chat'),
    ],
  })
}

function TeamSidebar(owner: FleetPanelPaneOwner): ReactElement {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLocaleLowerCase()
  const members = teamAgents(owner.snapshot).filter(member => normalized === ''
    || member.name.toLocaleLowerCase().includes(normalized)
    || member.role.toLocaleLowerCase().includes(normalized))
  return jsx(PaneSidebar, {
    owner,
    placeholder: panelText('搜索成员或角色', 'Search members or roles'),
    query,
    setQuery,
    children: [
          jsx(SectionTitle, { children: panelText(`${members.length} 位成员`, `${members.length} members`) }),
          ...members.map(member => jsx(FleetMemberListRow, { member, owner }, member.id)),
          renderSidebarSection(owner, 'team'),
    ],
  })
}

function AgentSidebar(owner: FleetPanelPaneOwner): ReactElement {
  const [query, setQuery] = useState('')
  const perspective = parseAgentViewItem(owner.snapshot, owner.activeItem)
  const normalized = query.trim().toLocaleLowerCase()
  const conversations = perspective.conversations.filter(item => normalized === ''
    || item.name.toLocaleLowerCase().includes(normalized)
    || item.topic?.toLocaleLowerCase().includes(normalized))
  const channels = conversations.filter(item => item.kind === 'channel')
  const crossTeam = conversations.filter(item => item.kind === 'cross-team')
  const directs = conversations.filter(item => item.kind === 'direct')
  const selectConversation = (conversation: FleetPanelConversation): void => {
    if (perspective.member === undefined) return
    owner.selectItem(agentViewItem(perspective.member.id, conversation.id))
  }
  return jsxs('div', {
    className: 'dsh-fleet-panel-sidebar-layout',
    children: [
      jsx(SidebarHead, {
        sessionId: owner.sessionId,
        teams: owner.fleet.directory.teams,
        selectedTeamId: owner.snapshot.teamId,
        label: owner.snapshot.teamName,
        selectTeam: owner.selectTeam,
        ...(owner.loadTeamSettings === undefined ? {} : { loadTeamSettings: owner.loadTeamSettings }),
        ...(owner.updateTeamSettings === undefined ? {} : { updateTeamSettings: owner.updateTeamSettings }),
        ...(owner.updateBudget === undefined ? {} : { updateBudget: owner.updateBudget }),
        ...(owner.configureTeamRequest === undefined ? {} : { configureTeamRequest: owner.configureTeamRequest }),
        ...(owner.controlTeam === undefined ? {} : { controlTeamById: (teamId: string, action: FleetPanelTeamControlInput['action'], summary?: string) => owner.controlTeam?.(action, summary) ?? Promise.resolve() }),
        ...(owner.exportTeam === undefined ? {} : { exportTeam: owner.exportTeam }),
        ...(owner.exportArchive === undefined ? {} : { exportArchive: owner.exportArchive }),
        ...(owner.importArchive === undefined ? {} : { importArchive: owner.importArchive }),
        secondary: jsx(AgentPicker, {
          members: teamAgents(owner.snapshot),
          selectedMemberId: perspective.member?.id,
          selectMember: (member: FleetPanelMember) => {
            owner.selectItem(agentViewItem(member.id, AGENT_CONTEXT_ITEM_ID))
          },
        }),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-sidebar',
        children: [
          jsx(SidebarSearch, { placeholder: panelText('搜索 Agent 可见消息', 'Search messages visible to this Agent'), query, setQuery }),
          jsxs('div', {
            className: 'dsh-fleet-panel-sidebar-scroll',
            children: [
              jsx(SectionTitle, { children: 'Agent' }),
              jsx(ListRow, {
                selected: perspective.context,
                title: panelText('执行上下文', 'Execution context'),
                caption: perspective.member === undefined ? undefined : panelText(`${perspective.member.name} 的真实 Session 历史`, `${perspective.member.name}'s real Session history`),
                leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'activity', size: 15 }) }),
                onClick: () => {
                  if (perspective.member !== undefined) owner.selectItem(agentViewItem(perspective.member.id, AGENT_CONTEXT_ITEM_ID))
                },
              }),
              jsx(SectionTitle, { children: panelText('频道', 'Channels') }),
              ...channels.map(item => jsx(ChannelListRow, {
                conversation: item,
                selected: perspective.conversation?.id === item.id,
                onClick: () => { selectConversation(item) },
              }, item.id)),
              ...(crossTeam.length === 0 ? [] : [
                jsx(SectionTitle, { children: panelText('跨团队', 'Cross-Team') }, 'agent-cross-team-title'),
                ...crossTeam.map(item => jsx(ListRow, {
                  selected: perspective.conversation?.id === item.id,
                  title: item.name,
                  caption: item.topic,
                  leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'channel', size: 15 }) }),
                  trailing: item.unread === undefined ? undefined : jsx('span', { className: 'dsh-fleet-panel-unread', children: item.unread }),
                  onClick: () => { selectConversation(item) },
                }, item.id)),
              ]),
              jsx(SectionTitle, { children: panelText('私聊', 'Direct messages') }),
              ...directs.map(item => {
                const peer = perspective.member === undefined
                  ? undefined
                  : agentConversationPeer(owner.snapshot, perspective.member, item)
                return jsx(ListRow, {
                  selected: perspective.conversation?.id === item.id,
                  title: peer?.name ?? item.name,
                  caption: peer?.role ?? item.topic,
                  leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx('span', {
                    className: 'dsh-fleet-panel-presence',
                    'data-presence': peer?.presence ?? 'offline',
                  }) }),
                  onClick: () => { selectConversation(item) },
                }, item.id)
              }),
              renderSidebarSection(owner, 'agent'),
            ],
          }),
        ],
      }),
    ],
  })
}

function ResourcesSidebar(owner: FleetPanelPaneOwner): ReactElement {
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [removalMode, setRemovalMode] = useState(false)
  const [removingIds, setRemovingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [resourceError, setResourceError] = useState<string>()
  const fileInput = useRef<HTMLInputElement>(null)
  const normalized = query.trim().toLocaleLowerCase()
  const resources = owner.snapshot.resources.filter(resource => normalized === ''
    || resource.name.toLocaleLowerCase().includes(normalized)
    || resource.detail.toLocaleLowerCase().includes(normalized)
    || resource.path.toLocaleLowerCase().includes(normalized))
  const workspaces = (owner.snapshot.workspaces ?? []).filter(workspace => normalized === ''
    || workspace.name.toLocaleLowerCase().includes(normalized)
    || workspace.path.toLocaleLowerCase().includes(normalized))
  const upload = (file: File | undefined): void => {
    if (file === undefined || owner.uploadResource === undefined || uploading) return
    setUploading(true)
    setResourceError(undefined)
    void owner.uploadResource(file).catch((reason: unknown) => {
      setResourceError(reason instanceof Error ? reason.message : panelText('上传文件失败', 'File upload failed'))
    }).finally(() => {
      setUploading(false)
      if (fileInput.current !== null) fileInput.current.value = ''
    })
  }
  const remove = (resource: FleetPanelResource): void => {
    if (owner.removeResource === undefined || removingIds.has(resource.id)) return
    setResourceError(undefined)
    setRemovingIds(current => new Set(current).add(resource.id))
    void owner.removeResource(resource.id).catch((reason: unknown) => {
      setResourceError(reason instanceof Error ? reason.message : panelText('移除文件失败', 'File removal failed'))
    }).finally(() => {
      setRemovingIds(current => {
        const next = new Set(current)
        next.delete(resource.id)
        return next
      })
    })
  }
  return jsx(PaneSidebar, {
    owner,
    placeholder: panelText('搜索共享资源', 'Search shared resources'),
    query,
    setQuery,
    children: [
          jsx(SectionTitle, {
            children: jsxs(Fragment, {
              children: [
                jsx('span', { children: panelText('团队文件', 'Team files') }),
                (owner.uploadResource !== undefined || owner.removeResource !== undefined) && jsxs('span', {
                  className: 'dsh-fleet-panel-section-actions',
                  children: [
                    owner.uploadResource !== undefined && jsxs(Fragment, {
                      children: [
                        jsx('input', {
                          ref: fileInput,
                          type: 'file',
                          hidden: true,
                          onChange: (event: ChangeEvent<HTMLInputElement>) => { upload(event.target.files?.[0]) },
                        }),
                        jsx('button', {
                          type: 'button',
                          className: 'dsh-fleet-panel-section-action',
                          disabled: uploading,
                          onClick: () => { fileInput.current?.click() },
                          children: uploading ? panelText('上传中…', 'Uploading…') : panelText('添加文件', 'Add file'),
                        }),
                      ],
                    }),
                    owner.removeResource !== undefined && jsx('button', {
                      type: 'button',
                      className: 'dsh-fleet-panel-section-action',
                      'data-tone': 'danger',
                      'aria-pressed': removalMode,
                      onClick: () => {
                        setResourceError(undefined)
                        setRemovalMode(current => !current)
                      },
                      children: panelText('删除文件', 'Remove files'),
                    }),
                  ],
                }),
              ],
            }),
          }),
          resourceError !== undefined && jsx('div', {
            className: 'dsh-fleet-panel-resource-upload-error',
            role: 'alert',
            children: resourceError,
          }),
          ...resources.map(resource => jsxs('div', {
            className: 'dsh-fleet-panel-resource-file-item',
            'data-removal-mode': removalMode ? 'true' : 'false',
            children: [
              jsx(ListRow, {
                selected: owner.activeItem === resource.id,
                title: jsxs('span', {
                  className: 'dsh-fleet-panel-resource-file-title',
                  children: [
                    jsx('span', {
                      className: 'dsh-fleet-panel-resource-file-name',
                      title: resourceFileName(resource),
                      children: resourceFileName(resource),
                    }),
                    jsx('span', {
                      className: 'dsh-fleet-panel-resource-file-size',
                      children: resource.size === undefined ? '—' : formatBytes(resource.size),
                    }),
                  ],
                }),
                caption: resource.path,
                leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'resources', size: 15 }) }),
                onClick: () => { owner.selectItem(resource.id) },
              }),
              removalMode && jsx('button', {
                type: 'button',
                className: 'dsh-fleet-panel-resource-file-remove',
                disabled: removingIds.has(resource.id),
                'aria-label': panelText(`移除 ${resourceFileName(resource)}`, `Remove ${resourceFileName(resource)}`),
                title: panelText(`移除 ${resourceFileName(resource)}`, `Remove ${resourceFileName(resource)}`),
                onClick: () => { remove(resource) },
                children: jsx(PanelIcon, { name: 'close', size: 14 }),
              }),
            ],
          }, resource.id)),
          jsx(SectionTitle, { children: panelText('工作区', 'Workspaces') }),
          ...workspaces.map(workspace => jsx(ListRow, {
            selected: owner.activeItem === workspace.id,
            title: workspace.name,
            caption: panelText(
              `${workspace.access === 'write' ? '可写' : '只读'} · ${workspace.members.length} 位成员`,
              `${workspace.access === 'write' ? 'Writable' : 'Read-only'} · ${workspace.members.length} members`,
            ),
            leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'resources', size: 15 }) }),
            onClick: () => { owner.selectItem(workspace.id) },
          }, workspace.id)),
          renderSidebarSection(owner, 'resources'),
    ],
  })
}

function ActivitySidebar(owner: FleetPanelPaneOwner): ReactElement {
  const [query, setQuery] = useState('')
  const filters = [
    ['all', panelText('全部动态', 'All activity'), panelText('消息、资源、决策和记忆', 'Messages, resources, decisions, and memory')],
    ['message', panelText('消息', 'Messages'), panelText('频道与私聊', 'Channels and direct messages')],
    ['resource', panelText('资源', 'Resources'), panelText('共享文件与引用', 'Shared files and references')],
    ['decision', panelText('决策', 'Decisions'), panelText('投票与共识', 'Votes and consensus')],
    ['memory', panelText('记忆', 'Memory'), panelText('历史写入与召回', 'Historical stores and recalls')],
  ] as const
  return jsx(PaneSidebar, {
    owner,
    placeholder: panelText('搜索动态', 'Search activity'),
    query,
    setQuery,
    children: [
          jsx(SectionTitle, { children: panelText('筛选', 'Filters') }),
          ...filters.map(([id, title, caption]) => jsx(ListRow, {
            selected: owner.activeItem === id,
            title,
            caption,
            leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'activity', size: 15 }) }),
            onClick: () => { owner.selectItem(id) },
          }, id)),
          renderSidebarSection(owner, 'activity'),
    ],
  })
}









type FleetOfficialInputBar = ComponentType<Record<string, unknown>>

interface FleetOfficialComposerCapture {
  InputBar: FleetOfficialInputBar
  props: Record<string, unknown>
}

const fleetOfficialComposerCaptures = new Map<string, FleetOfficialComposerCapture>()
const fleetOfficialComposerListeners = new Set<() => void>()

/** Capture the official DSH InputBar so every Fleet conversation can use the same adapted component. */
export function captureFleetOfficialComposer(
  sessionId: string,
  InputBar: FleetOfficialInputBar,
  props: Record<string, unknown>,
): void {
  const current = fleetOfficialComposerCaptures.get(sessionId)
  if (current !== undefined) {
    current.InputBar = InputBar
    current.props = props
    return
  }
  fleetOfficialComposerCaptures.set(sessionId, { InputBar, props })
  queueMicrotask(() => { for (const listener of fleetOfficialComposerListeners) listener() })
}

function useFleetOfficialComposer(sessionId: string): FleetOfficialComposerCapture | undefined {
  return useSyncExternalStore(
    listener => {
      fleetOfficialComposerListeners.add(listener)
      return () => { fleetOfficialComposerListeners.delete(listener) }
    },
    () => fleetOfficialComposerCaptures.get(sessionId),
    () => undefined,
  )
}

export type FleetConversationCommand = 'compact' | 'goal' | 'plan' | 'model' | 'export'

export function parseFleetConversationCommand(
  line: string,
  kind: FleetPanelConversation['kind'] = 'direct',
): FleetConversationCommand | undefined {
  const trimmed = line.trim()
  if (kind === 'channel') return trimmed === '/export' ? 'export' : undefined
  if (trimmed === '/compact') return 'compact'
  if (trimmed === '/export') return 'export'
  if (trimmed === '/model') return 'model'
  if (/^\/goal\s+\S/u.test(trimmed)) return 'goal'
  if (/^\/plan\s+\S/u.test(trimmed)) return 'plan'
  return undefined
}

/** @internal Shared with settings-panel.ts */
export function downloadFleetBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** @internal Shared with settings-panel.ts */
export function downloadFleetTeamConfiguration(teamName: string, configuration: Record<string, unknown>): void {
  const stem = teamName.trim()
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-')
    .replace(/^-|-$/g, '')
  const blob = new Blob([`${JSON.stringify(configuration, null, 2)}\n`], { type: 'application/json' })
  downloadFleetBlob(blob, `${stem || 'fleet-team'}.fleet-team.json`)
}

export interface FleetConversationCommandEntry {
  readonly name: FleetConversationCommand
  readonly description: string
  readonly behavior: 'execute' | 'input' | 'model'
}

export function fleetPrivateConversationCommands(member: string): readonly FleetConversationCommandEntry[] {
  return [
    {
      name: 'compact',
      description: panelText(`压缩 ${member} 的较早会话上下文`, `Compact older Session context for ${member}`),
      behavior: 'execute',
    },
    {
      name: 'goal',
      description: panelText(`设定或管理 ${member} 的原生 Goal`, `Set or manage ${member}’s native Goal`),
      behavior: 'input',
    },
    {
      name: 'plan',
      description: panelText(`切换 ${member} 的原生 Plan 模式`, `Change ${member}’s native Plan mode`),
      behavior: 'input',
    },
    {
      name: 'model',
      description: panelText(`选择 ${member} 下一步使用的模型`, `Select the model for ${member}’s next step`),
      behavior: 'model',
    },
    {
      name: 'export',
      description: panelText(`导出 ${member} 的会话`, `Export ${member}’s Session`),
      behavior: 'execute',
    },
  ]
}

function fleetConversationCommands(
  conversation: FleetPanelConversation,
  peer: FleetPanelMember | undefined,
): readonly FleetConversationCommandEntry[] {
  if (conversation.kind === 'channel') return [{
    name: 'export',
    description: panelText('导出当前团队', 'Export the current Team'),
    behavior: 'execute',
  }]
  return fleetPrivateConversationCommands(peer?.name ?? conversation.name)
}

interface FleetSessionGoalProjection {
  readonly goal?: {
    readonly objective: string
    readonly phase: 'active' | 'paused' | 'blocked' | 'complete'
  } | null
}

export function FleetSessionGoalDock({ session }: { readonly session: FleetNativeSessionFace | undefined }): ReactElement | null {
  const projection = session?.projections?.faceOf('goal')
  const subscribe = useCallback(
    (listener: () => void) => projection?.subscribe(listener) ?? EMPTY_UNSUBSCRIBE,
    [projection],
  )
  const snapshot = useCallback(
    () => projection?.getSnapshot() as FleetSessionGoalProjection | undefined,
    [projection],
  )
  const goal = useSyncExternalStore(subscribe, snapshot, snapshot)?.goal
  if (goal === undefined || goal === null || goal.phase === 'complete') return null
  const phase = ({
    active: panelText('目标进行中', 'Ongoing Goal'),
    paused: panelText('目标已暂停', 'Paused Goal'),
    blocked: panelText('目标受阻', 'Blocked Goal'),
  } as const)[goal.phase]
  return jsxs('div', {
    className: 'dsh-fleet-session-goal-dock',
    'data-goal-bar': 'true',
    children: [
      jsx('span', { className: 'dsh-fleet-session-goal-phase', children: phase }),
      jsx('span', { className: 'dsh-fleet-session-goal-objective', title: goal.objective, children: goal.objective }),
    ],
  })
}

export function FleetOfficialConversationComposer({ owner, conversation }: {
  readonly owner: FleetPanelPaneOwner
  readonly conversation: FleetPanelConversation
}): ReactElement {
  const capture = useFleetOfficialComposer(owner.sessionId)
  const attachments = useFleetComposerAttachments(`${owner.snapshot.teamId}:${owner.activeItem}`)
  const peer = conversation.peerId === undefined
    ? undefined
    : teamAgents(owner.snapshot).find(member => member.id === conversation.peerId)
  const targetSessionId = conversation.kind === 'direct' ? peer?.sessionId : undefined
  const targetSession = targetSessionId === undefined ? undefined : owner.nativeContext.session(targetSessionId)
  const modelDirectorySessionId = getFleetModelDirectory(targetSessionId) === undefined
    ? owner.sessionId
    : targetSessionId
  const [modelDirectory, modelDirectoryState] = useFleetPanelModelDirectory(modelDirectorySessionId)
  const draftHistory = useRef<readonly string[]>([owner.draft])
  const draftHistoryIndex = useRef(0)
  const composerRef = useRef<HTMLDivElement>(null)
  const commandMenuRef = useRef<HTMLDivElement>(null)
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [commandMenuView, setCommandMenuView] = useState<'commands' | 'models'>('commands')
  const [commandQuery, setCommandQuery] = useState('')
  const [commandHighlight, setCommandHighlight] = useState(0)
  const [mentionQuery, setMentionQuery] = useState<FleetActiveMentionQuery>()
  const [mentionHighlight, setMentionHighlight] = useState(0)
  const [commandRunning, setCommandRunning] = useState(false)
  const [commandFeedback, setCommandFeedback] = useState<{
    readonly kind: 'success' | 'error'
    readonly text: string
  }>()
  const tutorial = owner.snapshot.tutorial === true

  useEffect(() => {
    draftHistory.current = [owner.draft]
    draftHistoryIndex.current = 0
    setCommandMenuOpen(false)
    setCommandMenuView('commands')
    setCommandQuery('')
    setMentionQuery(undefined)
    setCommandFeedback(undefined)
  }, [owner.activeItem, owner.snapshot.teamId])

  useEffect(() => { void targetSession?.open?.() }, [targetSession])

  useEffect(() => {
    if (!commandMenuOpen && mentionQuery === undefined) return
    const close = (event: globalThis.PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      const card = commandMenuRef.current?.closest('[data-composer-card="true"]')
      if (card?.contains(event.target) === true) return
      setCommandMenuOpen(false)
      setMentionQuery(undefined)
    }
    document.addEventListener('pointerdown', close, true)
    return () => { document.removeEventListener('pointerdown', close, true) }
  }, [commandMenuOpen, mentionQuery])

  if (capture === undefined) {
    return jsx('div', {
      className: 'dsh-fleet-panel-composer-wrap dsh-fleet-official-composer-loading',
      role: 'status',
      children: panelText('正在载入输入框…', 'Loading composer…'),
    })
  }

  const fileIds = attachments.items.map(item => item.id)
  const inputSnapshot = {
    draft: owner.draft,
    phase: owner.sending || commandRunning ? 'submitting' : 'plain',
    imageIds: fileIds,
    occurrences: [],
    queue: [],
  }
  const useInput = <Selection,>(selector: (snapshot: typeof inputSnapshot) => Selection): Selection => selector(inputSnapshot)
  const useSession = <Selection,>(selector: (snapshot: Record<string, unknown>) => Selection): Selection => selector({
    running: false,
    removed: false,
    promptError: null,
    subagent: null,
  })
  const useNotices = <Selection,>(selector: (snapshot: undefined) => Selection): Selection => selector(undefined)
  const useLexicon = <Selection,>(selector: (snapshot: ReadonlyMap<string, readonly string[]>) => Selection): Selection => selector(new Map([
    ['/', fleetConversationCommands(conversation, peer).map(command => command.name)],
    ['@', teamAgents(owner.snapshot).map(member => member.name)],
  ]))
  const useMenuLauncher = <Selection,>(selector: (snapshot: string | null) => Selection): Selection => selector(commandMenuOpen || mentionQuery !== undefined ? 'command' : null)
  const useProjection = <Selection,>(name: string, selector?: (snapshot: any) => Selection): Selection | undefined => {
    const projection = targetSession?.projections?.faceOf(name)
    const subscribe = (listener: () => void): (() => void) => projection?.subscribe(listener) ?? EMPTY_UNSUBSCRIBE
    const snapshot = (): Selection | undefined => {
      const value = projection?.getSnapshot()
      return selector === undefined ? value as Selection | undefined : selector(value)
    }
    return useSyncExternalStore(subscribe, snapshot, snapshot)
  }
  const setDraft = (draft: string): void => {
    setCommandFeedback(undefined)
    if (draftHistory.current[draftHistoryIndex.current] !== draft) {
      draftHistory.current = [...draftHistory.current.slice(0, draftHistoryIndex.current + 1), draft].slice(-100)
      draftHistoryIndex.current = draftHistory.current.length - 1
    }
    owner.setDraft(draft)
  }
  const moveDraftHistory = (offset: -1 | 1): void => {
    const next = Math.max(0, Math.min(draftHistory.current.length - 1, draftHistoryIndex.current + offset))
    if (next === draftHistoryIndex.current) return
    draftHistoryIndex.current = next
    owner.setDraft(draftHistory.current[next] ?? '')
  }
  const commandEntries = fleetConversationCommands(conversation, peer)
  const visibleCommandEntries = commandQuery === ''
    ? commandEntries
    : commandEntries.filter(entry => entry.name.toLocaleLowerCase().startsWith(commandQuery.toLocaleLowerCase()))
  const mentionEntries = teamAgents(owner.snapshot).filter(member => {
    const query = mentionQuery?.query.trim().toLocaleLowerCase() ?? ''
    return query === ''
      || member.name.toLocaleLowerCase().includes(query)
      || member.role.toLocaleLowerCase().includes(query)
  })
  const modelEntries = modelDirectoryState.groups.flatMap(group => group.models.map(model => ({ group, model })))
  const exportTeam = (clearDraft: boolean): void => {
    if (owner.exportTeam === undefined || commandRunning) return
    setCommandMenuOpen(false)
    setCommandRunning(true)
    setCommandFeedback(undefined)
    void owner.exportTeam(owner.snapshot.teamId).then(configuration => {
      downloadFleetTeamConfiguration(owner.snapshot.teamName, configuration)
      if (clearDraft) owner.setDraft('')
      setCommandFeedback({ kind: 'success', text: panelText('团队已导出', 'Team exported') })
    }).catch((error: unknown) => {
      setCommandFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : panelText('团队导出失败', 'Team export failed'),
      })
    }).finally(() => { setCommandRunning(false) })
  }
  const executeMemberCommand = (line: string, clearDraft: boolean): void => {
    if (targetSessionId === undefined || commandRunning) {
      setCommandFeedback({
        kind: 'error',
        text: panelText('这个成员当前没有可用的 Session', 'This member does not currently have an available Session'),
      })
      return
    }
    const command = parseFleetConversationCommand(line, 'direct')
    setCommandMenuOpen(false)
    setCommandRunning(true)
    setCommandFeedback(undefined)
    void owner.nativeContext.executeSessionCommand(targetSessionId, line).then(result => {
      if (result.kind === 'error') throw new Error(result.text ?? panelText('命令执行失败', 'Command failed'))
      if (clearDraft) owner.setDraft('')
      setCommandFeedback({
        kind: 'success',
        text: command === 'export'
          ? panelText(`${peer?.name ?? conversation.name} 的会话导出已开始`, `${peer?.name ?? conversation.name}’s Session export has started`)
          : panelText(`/${command ?? 'command'} 已交给 ${peer?.name ?? conversation.name}`, `/${command ?? 'command'} was applied to ${peer?.name ?? conversation.name}`),
      })
    }).catch((error: unknown) => {
      setCommandFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : panelText('Session 命令执行失败', 'Session command failed'),
      })
    }).finally(() => { setCommandRunning(false) })
  }
  const selectModel = (group: FleetModelProviderGroup, model: FleetModelCatalogModel): void => {
    if (peer === undefined || owner.configureMemberRequest === undefined || commandRunning) return
    setCommandRunning(true)
    setCommandFeedback(undefined)
    const request = {
      provider: group.id,
      model: model.id,
      ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
    }
    const assistant = owner.snapshot.assistants?.some(candidate => candidate.id === peer.id) === true
    void owner.configureMemberRequest(peer.id, assistant, request).then(async () => {
      await modelDirectory?.load().catch(() => undefined)
      setCommandMenuOpen(false)
      setCommandMenuView('commands')
      setCommandFeedback({
        kind: 'success',
        text: panelText(`${peer?.name ?? conversation.name} 已切换到 ${model.name}`, `${peer?.name ?? conversation.name} now uses ${model.name}`),
      })
    }).catch((error: unknown) => {
      setCommandFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : panelText('模型切换失败', 'Model selection failed'),
      })
    }).finally(() => { setCommandRunning(false) })
  }
  const pickCommand = (entry = visibleCommandEntries[commandHighlight]): void => {
    if (entry === undefined) return
    if (entry.behavior === 'input') {
      setCommandMenuOpen(false)
      setDraft(`/${entry.name} `)
      return
    }
    if (entry.behavior === 'model') {
      setCommandHighlight(0)
      setCommandMenuView('models')
      if (modelDirectory !== undefined) void modelDirectory.load().catch(() => undefined)
      return
    }
    if (conversation.kind === 'channel') exportTeam(false)
    else executeMemberCommand(`/${entry.name}`, false)
  }
  const pickMention = (member = mentionEntries[mentionHighlight]): void => {
    if (member === undefined || mentionQuery === undefined) return
    const inserted = insertFleetMemberMention(owner.draft, mentionQuery, member.name)
    setDraft(inserted.text)
    setMentionQuery(undefined)
    requestAnimationFrame(() => {
      const input = composerRef.current?.querySelector('textarea')
      input?.focus({ preventScroll: true })
      input?.setSelectionRange(inserted.caret, inserted.caret)
    })
  }
  const submit = (): void => {
    if (owner.sending || commandRunning || (owner.draft.trim() === '' && attachments.files.length === 0)) return
    const command = parseFleetConversationCommand(owner.draft, conversation.kind)
    if (command !== undefined) {
      if (attachments.files.length > 0) {
        setCommandFeedback({
          kind: 'error',
          text: conversation.kind === 'channel'
            ? panelText('导出团队时不能同时携带文件', 'Team export cannot include files')
            : panelText('Session 命令不能同时携带文件', 'Session commands cannot include files'),
        })
        return
      }
      if (conversation.kind === 'channel') exportTeam(true)
      else if (command === 'model') {
        setCommandMenuOpen(true)
        setCommandMenuView('models')
        setCommandHighlight(0)
        if (modelDirectory !== undefined) void modelDirectory.load().catch(() => undefined)
      } else executeMemberCommand(owner.draft.trim(), true)
      return
    }
    if (conversation.kind === 'direct' && (owner.draft.trim() === '/goal' || owner.draft.trim() === '/plan')) {
      setDraft(`${owner.draft.trim()} `)
      return
    }
    setCommandFeedback(undefined)
    void owner.sendMessage(attachments.files).then(attachments.clearFiles).catch(() => undefined)
  }
  const keyboard = {
    snapshot: { ...inputSnapshot, paste: undefined },
    setDraft,
    track: (draft: string, caret: number) => {
      const mention = activeFleetMentionQuery(draft, caret)
      if (mention !== undefined) {
        setCommandMenuOpen(false)
        setMentionQuery(mention)
        setMentionHighlight(0)
        return
      }
      setMentionQuery(undefined)
      const command = activeFleetCommandQuery(draft, caret)
      if (command !== undefined) {
        setCommandMenuView('commands')
        setCommandQuery(command.query)
        setCommandHighlight(0)
        setCommandMenuOpen(true)
        return
      }
      setCommandMenuOpen(false)
      setCommandQuery('')
    },
    arbitrate: (key: 'up' | 'down' | 'enter' | 'escape') => {
      if (mentionQuery !== undefined) {
        if (key === 'escape') {
          setMentionQuery(undefined)
          return 'consumed'
        }
        if (key === 'up' || key === 'down') {
          if (mentionEntries.length > 0) setMentionHighlight(current =>
            (current + (key === 'up' ? -1 : 1) + mentionEntries.length) % mentionEntries.length)
          return 'consumed'
        }
        if (mentionEntries[mentionHighlight] !== undefined) pickMention()
        return 'pick-highlighted'
      }
      if (!commandMenuOpen) return 'pass'
      if (key === 'escape') {
        if (commandMenuView === 'models') {
          setCommandMenuView('commands')
          setCommandHighlight(0)
          return 'consumed'
        }
        setCommandMenuOpen(false)
        return 'consumed'
      }
      if (key === 'up' || key === 'down') {
        const count = commandMenuView === 'models' ? modelEntries.length : visibleCommandEntries.length
        if (count > 0) setCommandHighlight(current => (current + (key === 'up' ? -1 : 1) + count) % count)
        return 'consumed'
      }
      if (commandMenuView === 'models') {
        const choice = modelEntries[commandHighlight]
        if (choice !== undefined) selectModel(choice.group, choice.model)
      } else if (visibleCommandEntries[commandHighlight] !== undefined) pickCommand()
      return 'pick-highlighted'
    },
    dismissPopup: () => {
      setCommandMenuOpen(false)
      setMentionQuery(undefined)
    },
    redo: () => { moveDraftHistory(1) },
    undo: () => { moveDraftHistory(-1) },
    space: () => false,
    submit,
    steerQueue: () => undefined,
    invalidatePaste: () => undefined,
    pasteBegin: (text: string, selection: { readonly start: number; readonly end: number }) => {
      setDraft(`${owner.draft.slice(0, selection.start)}${text}${owner.draft.slice(selection.end)}`)
    },
  }
  const inputActions = {
    setDraft,
    submit,
    pruneImages: () => undefined,
  }
  const leftItems = jsxs('span', {
    className: 'dsh-fleet-official-composer-actions',
    children: [
      !tutorial && jsx(FleetComposerAttachmentButton, {
        attachments,
        disabled: owner.sending || commandRunning,
      }),
      owner.renderPanelSlot(FLEET_PANEL_SLOTS.composerAction, owner as unknown as Record<string, unknown>),
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-urgent-toggle',
        disabled: tutorial || owner.sending || commandRunning,
        'aria-pressed': owner.urgent,
        title: conversation.kind === 'channel'
          ? panelText('紧急消息会中断被 @ 成员的当前步骤', 'An urgent message interrupts the current step of @mentioned members')
          : panelText('紧急消息会中断该成员的当前步骤', 'An urgent message interrupts this member’s current step'),
        onClick: () => { owner.setUrgent(!owner.urgent) },
        children: panelText('紧急', 'Urgent'),
      }),
    ],
  })
  const feedback = owner.sendError === null ? commandFeedback : { kind: 'error' as const, text: owner.sendError }
  const footer = !tutorial && !owner.sending && !commandRunning && feedback === undefined ? undefined : jsx('span', {
    className: feedback?.kind === 'error' ? 'dsh-fleet-panel-compose-error' : 'dsh-fleet-panel-compose-context',
    role: feedback?.kind === 'error' ? 'alert' : 'status',
    'aria-live': 'polite',
    children: tutorial
      ? panelText('演示数据不会启动 Agent 或发送消息', 'Demo data never starts Agents or sends messages')
        : owner.sending
          ? panelText('发送中…', 'Sending…')
        : commandRunning
          ? panelText('正在应用命令…', 'Applying command…')
          : feedback?.text,
  })
  const overlay = mentionQuery !== undefined ? jsx('div', {
    ref: commandMenuRef,
    className: 'dsh-fleet-conversation-command-menu',
    role: 'listbox',
    'aria-label': panelText('提及团队成员', 'Mention a Team member'),
    'aria-activedescendant': `dsh-fleet-mention-${mentionEntries[mentionHighlight]?.id ?? 'none'}`,
    children: [
      jsx('div', {
        className: 'dsh-fleet-conversation-command-menu-title',
        role: 'presentation',
        children: panelText('团队成员', 'Team members'),
      }),
      ...mentionEntries.map((member, index) => jsxs('button', {
        id: `dsh-fleet-mention-${member.id}`,
        type: 'button',
        role: 'option',
        'aria-selected': mentionHighlight === index,
        className: 'dsh-fleet-conversation-command-menu-item',
        onMouseEnter: () => { setMentionHighlight(index) },
        onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          pickMention(member)
        },
        children: [
          jsx('span', { className: 'dsh-fleet-conversation-command-menu-name', children: member.name }),
          jsx('span', { className: 'dsh-fleet-conversation-command-menu-description', children: member.role }),
        ],
      }, member.id)),
      mentionEntries.length === 0 && jsx('div', {
        className: 'dsh-fleet-conversation-command-menu-title',
        role: 'status',
        children: panelText('没有匹配的成员', 'No matching members'),
      }),
    ],
  }) : commandMenuOpen && jsx('div', {
    ref: commandMenuRef,
    className: 'dsh-fleet-conversation-command-menu',
    role: 'listbox',
    'aria-label': commandMenuView === 'models'
      ? panelText('选择成员 Session 模型', 'Select member Session model')
      : panelText('团队会话命令', 'Fleet conversation commands'),
    'aria-activedescendant': commandMenuView === 'models'
      ? `dsh-fleet-model-${modelEntries[commandHighlight]?.group.id ?? 'none'}-${modelEntries[commandHighlight]?.model.id ?? 'none'}`
      : `dsh-fleet-command-${commandEntries[commandHighlight]?.name ?? 'export'}`,
    children: commandMenuView === 'models' ? [
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-conversation-command-menu-title dsh-fleet-conversation-command-menu-back',
        onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          setCommandMenuView('commands')
          setCommandHighlight(0)
        },
        children: panelText(`‹ 选择 ${peer?.name ?? conversation.name} 的模型`, `‹ Select a model for ${peer?.name ?? conversation.name}`),
      }),
      modelDirectoryState.status === 'loading' && jsx('div', {
        className: 'dsh-fleet-conversation-command-menu-title',
        role: 'status',
        children: panelText('正在载入模型…', 'Loading models…'),
      }),
      modelDirectoryState.error !== null && jsx('div', {
        className: 'dsh-fleet-conversation-command-menu-title',
        role: 'alert',
        children: modelDirectoryState.error,
      }),
      ...modelEntries.map((choice, index) => jsxs('button', {
        id: `dsh-fleet-model-${choice.group.id}-${choice.model.id}`,
        type: 'button',
        role: 'option',
        'aria-selected': commandHighlight === index,
        className: 'dsh-fleet-conversation-command-menu-item',
        onMouseEnter: () => { setCommandHighlight(index) },
        onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          selectModel(choice.group, choice.model)
        },
        children: [
          jsx('span', { className: 'dsh-fleet-conversation-command-menu-name', children: choice.model.name }),
          jsx('span', {
            className: 'dsh-fleet-conversation-command-menu-description',
            children: choice.model.description ?? choice.group.name,
          }),
        ],
      }, `${choice.group.id}:${choice.model.id}`)),
      modelEntries.length === 0 && modelDirectoryState.status !== 'loading' && jsx('div', {
        className: 'dsh-fleet-conversation-command-menu-title',
        children: panelText('没有可用模型', 'No models available'),
      }),
    ] : [
      jsx('div', {
        className: 'dsh-fleet-conversation-command-menu-title',
        role: 'presentation',
        children: panelText('命令', 'Commands'),
      }),
      ...visibleCommandEntries.map((entry, index) => jsxs('button', {
        id: `dsh-fleet-command-${entry.name}`,
        type: 'button',
        role: 'option',
        'aria-selected': commandHighlight === index,
        className: 'dsh-fleet-conversation-command-menu-item',
        onMouseEnter: () => { setCommandHighlight(index) },
        onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => {
          event.preventDefault()
          pickCommand(entry)
        },
        children: [
          jsx('span', { className: 'dsh-fleet-conversation-command-menu-name', children: entry.name }),
          jsx('span', { className: 'dsh-fleet-conversation-command-menu-description', children: entry.description }),
        ],
      }, entry.name)),
      visibleCommandEntries.length === 0 && jsx('div', {
        className: 'dsh-fleet-conversation-command-menu-title',
        role: 'status',
        children: panelText('没有匹配的命令', 'No matching commands'),
      }),
    ],
  })
  const capturedRenderSlot = capture.props.renderSlot as ((
    name: string,
    owner: Readonly<Record<string, unknown>>,
    options?: Readonly<Record<string, unknown>>,
  ) => ReactNode) | undefined
  const renderSlot = (
    name: string,
    slotOwner: Readonly<Record<string, unknown>>,
    options?: Readonly<Record<string, unknown>>,
  ): ReactNode => {
    if (name !== 'conversation.input.attachments') return null
    return jsxs(Fragment, {
      children: [
        capturedRenderSlot?.(name, { ...slotOwner, attachments: attachments.imageItems }, options),
        jsx(FleetComposerAttachmentList, { attachments }),
      ],
    })
  }
  const InputBar = capture.InputBar
  return jsxs('div', {
    ref: composerRef,
    className: 'dsh-fleet-panel-composer-wrap dsh-fleet-official-composer',
    children: [
      jsx(FleetSessionGoalDock, { session: targetSession }),
      jsx(InputBar, {
      ...capture.props,
      sessionId: targetSessionId ?? owner.sessionId,
      disabled: tutorial || commandRunning,
      blocked: undefined,
      workspacePickerOpen: false,
      onRequestWorkspace: undefined,
      placeholder: tutorial
        ? panelText('引导团队为只读演示', 'The guided Team is a read-only demo')
        : conversation.kind === 'channel'
          ? panelText(`发送频道消息到 #${conversation.name}`, `Post to #${conversation.name}`)
          : conversation.kind === 'direct'
            ? panelText(`私聊 ${conversation.name}`, `Message ${conversation.name} privately`)
            : panelText(`发送消息到 ${conversation.name}`, `Send a message to ${conversation.name}`),
      useInput,
      useSession,
      useNotices,
      useLexicon,
      useMenuLauncher,
      useProjection,
      inputActions,
      keyboard,
      addImages: (added: readonly File[]) => {
        if (!tutorial && !owner.sending && !commandRunning) attachments.addFiles(added)
        return null
      },
      removeImage: attachments.removeFile,
      draftImages: (ids: readonly string[]) => ids.flatMap(id => attachments.items.filter(item => item.id === id)),
      resolveSubmitMode: () => 'queue',
      toggleCommandMenu: tutorial
        || (conversation.kind === 'channel' && owner.exportTeam === undefined)
        || (conversation.kind === 'direct' && peer === undefined)
        ? undefined
        : () => {
            setCommandHighlight(0)
            setCommandMenuView('commands')
            setCommandQuery('')
            setMentionQuery(undefined)
            setCommandMenuOpen(current => !current)
          },
      stop: undefined,
      command: undefined,
      renderSlot,
      accessory: undefined,
      overlay,
      leftItems,
      rightItems: null,
      usageMeter: jsx(FleetBudgetMeter, {
        teamId: owner.snapshot.teamId,
        budget: owner.snapshot.budget,
        contextUsage: conversation.kind === 'direct' && peer !== undefined,
        useProjection,
        ...(conversation.kind === 'direct' && peer !== undefined ? { memberId: peer.id } : {}),
      }),
      footer,
      }),
    ],
  })
}







function samePermissionValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value))
}

export function sameFleetPermissionAssignment(
  left: FleetPanelMemberPermissionAssignment,
  right: FleetPanelMemberPermissionAssignment,
): boolean {
  return left.op === right.op
    && samePermissionValues(left.groups, right.groups)
    && samePermissionValues(left.grants, right.grants)
    && samePermissionValues(left.denies, right.denies)
    && samePermissionValues(left.toolGroups, right.toolGroups)
    && samePermissionValues(left.denyToolGroups, right.denyToolGroups)
}

export function updateFleetPermissionAssignmentValues(
  assignment: FleetPanelMemberPermissionAssignment,
  key: 'grants' | 'denies' | 'toolGroups' | 'denyToolGroups',
  opposite: 'grants' | 'denies' | 'toolGroups' | 'denyToolGroups',
  values: readonly string[],
): FleetPanelMemberPermissionAssignment {
  const added = values.find(value => !assignment[key].includes(value))
  return {
    ...assignment,
    [key]: values,
    ...(added === undefined ? {} : {
      [opposite]: assignment[opposite].filter(value => value !== added),
    }),
  }
}

function fleetPermissionAssignment(value: FleetPanelMemberPermissionAssignment): FleetPanelMemberPermissionAssignment {
  return {
    groups: [...value.groups],
    grants: [...value.grants],
    denies: [...value.denies],
    toolGroups: [...value.toolGroups],
    denyToolGroups: [...value.denyToolGroups],
    op: value.op,
  }
}

const PERMISSION_GROUP_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  observer: ['观察者', 'Observer'],
  member: ['协作者', 'Collaborator'],
  researcher: ['研究员', 'Researcher'],
  facilitator: ['协调者', 'Facilitator'],
  maintainer: ['维护者', 'Maintainer'],
  op: ['OP', 'OP'],
}

const PERMISSION_GROUP_DESCRIPTIONS: Readonly<Record<string, readonly [string, string]>> = {
  observer: ['阅读消息、状态、任务、日程和共享内容。', 'Read messages, status, tasks, schedules, and shared content.'],
  member: ['在只读基础上发消息、推进任务、参加会议并评论。', 'View content, send messages, advance tasks, join meetings, and comment.'],
  researcher: ['参与工作，并可写共享资源和文档。', 'Collaborate and write shared resources and documents.'],
  facilitator: ['参与工作，并可管理频道、会议、任务和日程。', 'Collaborate and manage channels, meetings, tasks, and schedules.'],
  maintainer: ['创作、协调并管理团队、权限和资源访问。', 'Create, coordinate, and manage the Team, permissions, and resource access.'],
  op: ['完整控制，不受普通权限限制。', 'Full control without ordinary permission limits.'],
}

const PERMISSION_DOMAINS: Readonly<Record<string, readonly [string, string]>> = {
  access: ['访问', 'Access'], calendar: ['日历', 'Calendar'], channel: ['频道', 'Channel'],
  document: ['文档', 'Document'], meeting: ['会议', 'Meeting'], 'member-status': ['成员状态', 'Member status'],
  message: ['消息', 'Message'], permissions: ['权限', 'Permissions'], resource: ['资源', 'Resource'],
  git: ['Git', 'Git'], joyride: ['浏览器演示', 'Browser demo'], lark: ['飞书', 'Lark'],
  livestream: ['直播', 'Livestream'], schedule: ['日程', 'Schedule'], task: ['任务', 'Task'],
  team: ['团队', 'Team'], vote: ['投票', 'Vote'], work: ['工作项', 'Work item'], workspace: ['工作区', 'Workspace'],
}

const PERMISSION_OPERATIONS: Readonly<Record<string, readonly [string, string]>> = {
  'act-as-user': ['以用户身份操作', 'Act as user'], claim: ['领取', 'Claim'], comment: ['评论', 'Comment'],
  'content-write': ['写入内容', 'Write content'], control: ['控制', 'Control'], create: ['创建', 'Create'],
  host: ['主持', 'Host'], 'history-rewrite': ['改写历史', 'Rewrite history'], inspect: ['检查', 'Inspect'],
  interrupt: ['中断', 'Interrupt'], join: ['加入', 'Join'], manage: ['管理', 'Manage'],
  'message-post': ['发送消息', 'Post messages'], post: ['发送', 'Post'], progress: ['更新进度', 'Update progress'],
  publish: ['发布', 'Publish'], read: ['查看', 'Read'], 'repository-manage': ['管理仓库', 'Manage repository'],
  rsvp: ['回应邀请', 'Respond to invitation'], 'scope-check': ['检查范围', 'Check scope'], update: ['更新', 'Update'],
  use: ['使用', 'Use'], wakeup: ['唤醒', 'Wake'], write: ['写入', 'Write'],
  'worktree-create': ['创建工作树', 'Create worktree'], 'worktree-manage': ['管理工作树', 'Manage worktree'],
}

const PERMISSION_TOOL_GROUPS: Readonly<Record<string, readonly [string, string]>> = {
  calendar: ['日历工具', 'Calendar tools'], coordination: ['协作工具', 'Collaboration tools'],
  documents: ['文档工具', 'Document tools'], messages: ['消息工具', 'Message tools'],
  resources: ['资源工具', 'Resource tools'], schedule: ['日程工具', 'Schedule tools'],
  status: ['状态工具', 'Status tools'], tasks: ['任务工具', 'Task tools'],
}

function permissionGroupName(group: FleetPanelPermissionGroup): string {
  const copy = group.preset ? PERMISSION_GROUP_NAMES[group.id] : undefined
  return copy === undefined ? group.name : panelText(copy[0], copy[1])
}

function permissionGroupDescription(group: FleetPanelPermissionGroup, groupNames: ReadonlyMap<string, string>): string {
  const preset = group.preset ? PERMISSION_GROUP_DESCRIPTIONS[group.id] : undefined
  if (preset !== undefined) return panelText(preset[0], preset[1])
  if (group.op === true) return panelText('完整控制，不受普通权限限制。', 'Full control without ordinary permission limits.')
  return group.parents.length === 0
    ? panelText('这个自定义组只包含下方列出的能力。', 'This custom group contains only the capabilities listed below.')
    : panelText(`包含自身设置，并继承 ${group.parents.map(parent => groupNames.get(parent) ?? parent).join('、')}。`, `Includes its own settings and inherits ${group.parents.map(parent => groupNames.get(parent) ?? parent).join(', ')}.`)
}

function permissionValueLabel(value: string, type: 'action' | 'tool'): string {
  if (type === 'tool') {
    const copy = PERMISSION_TOOL_GROUPS[value]
    return copy === undefined ? value : panelText(copy[0], copy[1])
  }
  const [domain, operation, ...rest] = value.split('.')
  if (domain === undefined || operation === undefined || rest.length > 0) return value
  const domainLabel = PERMISSION_DOMAINS[domain]
  const operationLabel = PERMISSION_OPERATIONS[operation]
  return domainLabel === undefined || operationLabel === undefined
    ? value
    : `${panelText(domainLabel[0], domainLabel[1])} · ${panelText(operationLabel[0], operationLabel[1])}`
}

export interface FleetPanelPermissionCapability {
  readonly type: 'action' | 'tool'
  readonly value: string
}

export function fleetPermissionGroupCapabilities(
  group: FleetPanelPermissionGroup,
  groups: readonly FleetPanelPermissionGroup[],
): {
    readonly granted: readonly FleetPanelPermissionCapability[]
    readonly restricted: readonly FleetPanelPermissionCapability[]
  } {
  const byId = new Map(groups.map(candidate => [candidate.id, candidate]))
  const granted = new Map<string, FleetPanelPermissionCapability>()
  const restricted = new Map<string, FleetPanelPermissionCapability>()
  const visited = new Set<string>()
  const key = (type: 'action' | 'tool', value: string): string => `${type}:${value}`
  const add = (target: Map<string, FleetPanelPermissionCapability>, type: 'action' | 'tool', value: string): void => {
    target.set(key(type, value), { type, value })
  }
  const visit = (candidate: FleetPanelPermissionGroup): void => {
    if (visited.has(candidate.id)) return
    visited.add(candidate.id)
    for (const parent of candidate.parents) {
      const parentGroup = byId.get(parent)
      if (parentGroup !== undefined) visit(parentGroup)
    }
    for (const value of candidate.toolGroups) add(granted, 'tool', value)
    for (const value of candidate.actions) add(granted, 'action', value)
    for (const value of candidate.denyToolGroups) add(restricted, 'tool', value)
    for (const value of candidate.denies) add(restricted, 'action', value)
  }
  visit(group)
  for (const denied of restricted.keys()) granted.delete(denied)
  return { granted: [...granted.values()], restricted: [...restricted.values()] }
}

function PermissionValues({ values, type }: {
  readonly values: readonly string[]
  readonly type: 'action' | 'tool'
}): ReactElement {
  if (values.length === 0) return jsx('span', {
    className: 'dsh-fleet-panel-member-permissions-none',
    children: panelText('无', 'None'),
  })
  return jsx('div', {
    className: 'dsh-fleet-panel-member-permissions-value-list',
    children: values.map(value => jsx('span', {
      className: 'dsh-fleet-panel-member-permission-value',
      title: value,
      children: permissionValueLabel(value, type),
    }, `${type}:${value}`)),
  })
}

function PermissionValueEditor({
  title,
  emptyLabel,
  addLabel,
  values,
  options,
  type,
  restricted = false,
  disabled,
  onChange,
}: {
  readonly title: string
  readonly emptyLabel: string
  readonly addLabel: string
  readonly values: readonly string[]
  readonly options: readonly string[]
  readonly type: 'action' | 'tool'
  readonly restricted?: boolean
  readonly disabled: boolean
  readonly onChange: (values: readonly string[]) => void
}): ReactElement {
  const available = options.filter(value => !values.includes(value))
  return jsxs('div', {
    className: 'dsh-fleet-panel-member-permission-editor',
    children: [
      jsxs('div', {
        className: 'dsh-fleet-panel-member-permission-editor-head',
        children: [
          jsx('h5', { className: 'dsh-fleet-panel-member-permission-editor-title', children: title }),
          jsx('span', { className: 'dsh-fleet-panel-member-permission-editor-count', children: panelText(`${values.length} 项`, `${values.length} items`) }),
        ],
      }),
      jsx('select', {
        className: 'dsh-fleet-panel-member-permission-editor-select',
        'aria-label': addLabel,
        value: '',
        disabled: disabled || available.length === 0,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
          const value = event.currentTarget.value
          if (value.length > 0) onChange([...values, value])
        },
        children: [
          jsx('option', {
            value: '',
            children: available.length === 0 ? panelText('没有可添加项', 'No items available to add') : addLabel,
          }),
          ...available.map(value => jsx('option', {
            value,
            children: permissionValueLabel(value, type),
          }, value)),
        ],
      }),
      jsx('div', {
        className: 'dsh-fleet-panel-member-permission-editor-values',
        children: values.length === 0
          ? jsx('span', { className: 'dsh-fleet-panel-member-permissions-none', children: emptyLabel })
          : values.map(value => jsxs('span', {
              className: 'dsh-fleet-panel-member-permission-direct-value',
              'data-restricted': restricted ? 'true' : undefined,
              title: value,
              children: [
                jsx('span', {
                  className: 'dsh-fleet-panel-member-permission-direct-value-label',
                  children: permissionValueLabel(value, type),
                }),
                jsx('button', {
                  type: 'button',
                  disabled,
                  'aria-label': panelText(`删除${permissionValueLabel(value, type)}`, `Remove ${permissionValueLabel(value, type)}`),
                  onClick: () => { onChange(values.filter(candidate => candidate !== value)) },
                  children: panelText('移除', 'Remove'),
                }),
              ],
            }, value)),
      }),
    ],
  })
}

function MemberPermissions({ owner, member }: {
  readonly owner: FleetPanelPaneOwner
  readonly member: FleetPanelMember
}): ReactElement | null {
  const load = owner.loadMemberAuthorization
  const update = owner.updateMemberPermissions
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | {
      readonly status: 'ready'
      readonly value: FleetPanelMemberAuthorization
      readonly draft: FleetPanelMemberPermissionAssignment
    }
    | { readonly status: 'error'; readonly message: string }
  >({ status: 'loading' })
  const [savingMode, setSavingMode] = useState<'save' | 'reset'>()
  const [saveError, setSaveError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const viewKey = `${owner.snapshot.teamId}:${member.id}`
  const activeViewKey = useRef(viewKey)
  activeViewKey.current = viewKey

  useEffect(() => {
    if (load === undefined) return
    const controller = new AbortController()
    setSavingMode(undefined)
    setSaveError(undefined)
    setState({ status: 'loading' })
    void load(owner.snapshot.teamId, member.id, controller.signal).then(value => {
      if (!controller.signal.aborted) setState({
        status: 'ready',
        value,
        draft: fleetPermissionAssignment(value.assignment),
      })
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setState({
        status: 'error',
        message: reason instanceof Error ? reason.message : panelText('无法读取成员权限', 'Could not read member permissions'),
      })
    })
    return () => { controller.abort(new Error('Fleet member permission view changed')) }
  }, [attempt, load, member.id, owner.snapshot.teamId])

  if (load === undefined || update === undefined) return null
  if (state.status !== 'ready') return jsxs('section', {
    className: 'dsh-fleet-panel-member-permissions',
    children: [
      jsx('h3', { className: 'dsh-fleet-panel-member-permissions-title', children: panelText('成员权限', 'Member permissions') }),
      jsx('p', {
        className: state.status === 'error'
          ? 'dsh-fleet-panel-control-error'
          : 'dsh-fleet-panel-member-permissions-copy',
        role: state.status === 'error' ? 'alert' : 'status',
        children: state.status === 'error' ? state.message : panelText('正在读取权限…', 'Loading permissions…'),
      }),
      state.status === 'error' && jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-control-button',
        onClick: () => { setAttempt(current => current + 1) },
        children: panelText('重试', 'Retry'),
      }),
    ],
  })

  const dirty = !sameFleetPermissionAssignment(state.draft, state.value.assignment)
  const saving = savingMode !== undefined
  const groupNames = new Map(state.value.groups.map(group => [group.id, permissionGroupName(group)]))
  const setDraft = (draft: FleetPanelMemberPermissionAssignment): void => {
    setSaveError(undefined)
    setState({ ...state, draft })
  }
  const setDraftValues = (
    key: 'grants' | 'denies' | 'toolGroups' | 'denyToolGroups',
    opposite: 'grants' | 'denies' | 'toolGroups' | 'denyToolGroups',
    values: readonly string[],
  ): void => {
    setDraft(updateFleetPermissionAssignmentValues(state.draft, key, opposite, values))
  }
  const save = (reset = false): void => {
    if (saving || (!reset && !dirty)) return
    const savedViewKey = viewKey
    setSavingMode(reset ? 'reset' : 'save')
    setSaveError(undefined)
    void update(member.id, reset ? undefined : state.draft, reset).then(value => {
      if (activeViewKey.current !== savedViewKey) return
      setState({ status: 'ready', value, draft: fleetPermissionAssignment(value.assignment) })
      setSaveError(undefined)
    }).catch((reason: unknown) => {
      if (activeViewKey.current !== savedViewKey) return
      setSaveError(reason instanceof Error ? reason.message : panelText('无法保存成员权限，请重试', 'Could not save member permissions. Try again.'))
    }).finally(() => {
      if (activeViewKey.current === savedViewKey) setSavingMode(undefined)
    })
  }

  return jsxs('section', {
    className: 'dsh-fleet-panel-member-permissions',
    children: [
      jsxs('div', {
        className: 'dsh-fleet-panel-member-permissions-head',
        children: [
          jsx('h3', { className: 'dsh-fleet-panel-member-permissions-title', children: panelText('成员权限', 'Member permissions') }),
          jsx('span', {
            className: 'dsh-fleet-panel-member-permissions-source',
            'data-configured': state.value.configured ? 'true' : undefined,
            children: state.value.configured ? panelText('自定义配置', 'Custom configuration') : panelText('团队模板', 'Team template'),
          }),
        ],
      }),
      jsx('p', {
        className: 'dsh-fleet-panel-member-permissions-copy',
        children: state.value.configured
          ? panelText('权限组提供常用组合，也可以为这位成员单独添加或限制工具组和操作。', 'Permission groups provide common combinations. You can also grant or restrict tool groups and actions for this member.')
          : panelText('当前沿用团队模板。修改权限组或单独权限并保存后，将为这位成员建立独立配置。', 'This member currently follows the Team template. Saving changes to groups or individual permissions creates an independent configuration.'),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-member-permissions-section-head',
        children: [
          jsx('h4', {
            id: `dsh-fleet-member-permissions-${member.id}`,
            className: 'dsh-fleet-panel-member-permissions-section-title',
            children: panelText('权限组', 'Permission groups'),
          }),
          jsx('span', {
            className: 'dsh-fleet-panel-member-permissions-section-meta',
            children: panelText(`已选 ${state.draft.groups.length} / ${state.value.groups.length}`, `Selected ${state.draft.groups.length} / ${state.value.groups.length}`),
          }),
        ],
      }),
      jsx('div', {
        className: 'dsh-fleet-panel-member-permissions-groups',
        role: 'group',
        'aria-labelledby': `dsh-fleet-member-permissions-${member.id}`,
        children: state.value.groups.length === 0
          ? jsx('p', {
              className: 'dsh-fleet-panel-member-permissions-empty',
              children: panelText('团队还没有可分配的权限组。', 'This Team has no assignable permission groups.'),
            })
          : state.value.groups.map(group => {
            const capabilities = fleetPermissionGroupCapabilities(group, state.value.groups)
            return jsxs('label', {
              className: 'dsh-fleet-panel-member-permission-group',
              children: [
                jsx('input', {
                  type: 'checkbox',
                  checked: state.draft.groups.includes(group.id),
                  disabled: saving,
                  onChange: (event: ChangeEvent<HTMLInputElement>) => {
                    const selected = event.currentTarget.checked
                      ? [...state.draft.groups, group.id]
                      : state.draft.groups.filter(id => id !== group.id)
                    setDraft({ ...state.draft, groups: selected })
                  },
                }),
                jsxs('span', {
                  className: 'dsh-fleet-panel-member-permission-group-copy',
                  children: [
                    jsx('span', {
                      className: 'dsh-fleet-panel-member-permission-group-name',
                      children: permissionGroupName(group),
                    }),
                    jsx('div', {
                      className: 'dsh-fleet-panel-member-permission-group-detail',
                      children: permissionGroupDescription(group, groupNames),
                    }),
                    jsx('span', {
                      className: 'dsh-fleet-panel-member-permission-group-scope',
                      children: group.op === true
                        ? jsx('span', {
                            className: 'dsh-fleet-panel-member-permission-value',
                            children: panelText('全部工具与操作', 'All tools and actions'),
                          })
                        : capabilities.granted.length === 0 && capabilities.restricted.length === 0
                          ? jsx('span', {
                              className: 'dsh-fleet-panel-member-permission-more',
                              children: panelText('未授予能力', 'No capabilities granted'),
                            })
                          : [
                              ...capabilities.granted.slice(0, 3).map(item => jsx('span', {
                                className: 'dsh-fleet-panel-member-permission-value',
                                title: item.value,
                                children: permissionValueLabel(item.value, item.type),
                              }, `${item.type}:${item.value}`)),
                              capabilities.granted.length > 3 && jsx('span', {
                                className: 'dsh-fleet-panel-member-permission-more',
                                children: panelText(`另有 ${capabilities.granted.length - 3} 项`, `${capabilities.granted.length - 3} more`),
                              }),
                              ...capabilities.restricted.slice(0, 2).map(item => jsx('span', {
                                className: 'dsh-fleet-panel-member-permission-value',
                                'data-restricted': 'true',
                                title: item.value,
                                children: panelText(`限制 ${permissionValueLabel(item.value, item.type)}`, `Restricts ${permissionValueLabel(item.value, item.type)}`),
                              }, `restricted:${item.type}:${item.value}`)),
                              capabilities.restricted.length > 2 && jsx('span', {
                                className: 'dsh-fleet-panel-member-permission-more',
                                children: panelText(`另有限制 ${capabilities.restricted.length - 2} 项`, `${capabilities.restricted.length - 2} more restrictions`),
                              }),
                            ],
                    }),
                  ],
                }),
              ],
            }, group.id)
          }),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-member-permissions-section-head',
        children: [
          jsx('h4', {
            className: 'dsh-fleet-panel-member-permissions-section-title',
            children: panelText('单独添加与限制', 'Individual grants and restrictions'),
          }),
          jsx('span', {
            className: 'dsh-fleet-panel-member-permissions-section-meta',
            children: panelText('限制项优先', 'Restrictions take precedence'),
          }),
        ],
      }),
      jsx('p', {
        className: 'dsh-fleet-panel-member-permissions-copy',
        children: panelText('这里的设置会与所选权限组合并。添加同一项时，会自动从相反列表移除。', 'These settings are combined with the selected permission groups. Adding an item automatically removes it from the opposite list.'),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-member-permissions-manual',
        children: [
          jsx(PermissionValueEditor, {
            title: panelText('添加工具组', 'Grant tool groups'),
            emptyLabel: panelText('没有单独添加的工具组', 'No individually granted tool groups'),
            addLabel: panelText('选择要添加的工具组', 'Choose a tool group to grant'),
            values: state.draft.toolGroups,
            options: state.value.availableToolGroups,
            type: 'tool',
            disabled: saving,
            onChange: (values: readonly string[]) => { setDraftValues('toolGroups', 'denyToolGroups', values) },
          }),
          jsx(PermissionValueEditor, {
            title: panelText('限制工具组', 'Restrict tool groups'),
            emptyLabel: panelText('没有单独限制的工具组', 'No individually restricted tool groups'),
            addLabel: panelText('选择要限制的工具组', 'Choose a tool group to restrict'),
            values: state.draft.denyToolGroups,
            options: state.value.availableToolGroups,
            type: 'tool',
            restricted: true,
            disabled: saving,
            onChange: (values: readonly string[]) => { setDraftValues('denyToolGroups', 'toolGroups', values) },
          }),
          jsx(PermissionValueEditor, {
            title: panelText('添加操作权限', 'Grant actions'),
            emptyLabel: panelText('没有单独添加的操作权限', 'No individually granted actions'),
            addLabel: panelText('选择要添加的操作权限', 'Choose an action to grant'),
            values: state.draft.grants,
            options: state.value.availableActions,
            type: 'action',
            disabled: saving,
            onChange: (values: readonly string[]) => { setDraftValues('grants', 'denies', values) },
          }),
          jsx(PermissionValueEditor, {
            title: panelText('限制操作权限', 'Restrict actions'),
            emptyLabel: panelText('没有单独限制的操作权限', 'No individually restricted actions'),
            addLabel: panelText('选择要限制的操作权限', 'Choose an action to restrict'),
            values: state.draft.denies,
            options: state.value.availableActions,
            type: 'action',
            restricted: true,
            disabled: saving,
            onChange: (values: readonly string[]) => { setDraftValues('denies', 'grants', values) },
          }),
        ],
      }),
      jsxs('details', {
        className: 'dsh-fleet-panel-member-permissions-effective',
        children: [
          jsxs('summary', {
            children: [
              panelText('当前生效范围', 'Current effective scope'),
              jsx('span', {
                className: 'dsh-fleet-panel-member-permissions-effective-summary',
                children: state.value.op
                  ? panelText('OP · 完整权限', 'OP · Full permissions')
                  : panelText(`${state.value.effectiveToolGroups.length} 个工具组 · ${state.value.effectiveActions.length} 项操作`, `${state.value.effectiveToolGroups.length} tool groups · ${state.value.effectiveActions.length} actions`),
              }),
            ],
          }),
          state.value.op
            ? jsx('p', {
                className: 'dsh-fleet-panel-member-permissions-op',
                children: panelText('这位成员当前拥有完整权限；普通工具组和操作限制不适用。', 'This member currently has full permissions; ordinary tool-group and action restrictions do not apply.'),
              })
            : jsxs('div', {
                className: 'dsh-fleet-panel-member-permissions-values',
                children: [
                  jsxs('div', {
                    className: 'dsh-fleet-panel-member-permissions-value-group',
                    children: [
                      jsx('h5', {
                        className: 'dsh-fleet-panel-member-permissions-value-title',
                        children: panelText(`工具组（${state.value.effectiveToolGroups.length}）`, `Tool groups (${state.value.effectiveToolGroups.length})`),
                      }),
                      jsx(PermissionValues, { values: state.value.effectiveToolGroups, type: 'tool' }),
                    ],
                  }),
                  jsxs('div', {
                    className: 'dsh-fleet-panel-member-permissions-value-group',
                    children: [
                      jsx('h5', {
                        className: 'dsh-fleet-panel-member-permissions-value-title',
                        children: panelText(`操作（${state.value.effectiveActions.length}）`, `Actions (${state.value.effectiveActions.length})`),
                      }),
                      jsx(PermissionValues, { values: state.value.effectiveActions, type: 'action' }),
                    ],
                  }),
                ],
              }),
        ],
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-member-permissions-actions',
        children: [
          jsx('span', {
            className: 'dsh-fleet-panel-member-permissions-draft',
            role: 'status',
            children: dirty
              ? panelText(
                  `有未保存更改；保存后将使用 ${state.draft.groups.length} 个权限组和 ${state.draft.toolGroups.length + state.draft.grants.length + state.draft.denyToolGroups.length + state.draft.denies.length} 项单独配置。`,
                  `There are unsaved changes. Saving will use ${state.draft.groups.length} permission groups and ${state.draft.toolGroups.length + state.draft.grants.length + state.draft.denyToolGroups.length + state.draft.denies.length} individual settings.`,
                )
              : panelText('当前权限配置已生效。', 'The current permission configuration is active.'),
          }),
          jsxs('div', {
            className: 'dsh-fleet-panel-member-permissions-action-buttons',
            children: [
              dirty && jsx('button', {
                type: 'button',
                className: 'dsh-fleet-panel-control-button',
                disabled: saving,
                onClick: () => {
                  setSaveError(undefined)
                  setState({ ...state, draft: fleetPermissionAssignment(state.value.assignment) })
                },
                children: panelText('撤销更改', 'Discard changes'),
              }),
              state.value.configured && jsx('button', {
                type: 'button',
                className: 'dsh-fleet-panel-control-button',
                disabled: saving,
                onClick: () => { save(true) },
                children: savingMode === 'reset' ? panelText('正在恢复…', 'Restoring…') : panelText('改回团队模板', 'Restore Team template'),
              }),
              dirty && jsx('button', {
                type: 'button',
                className: 'dsh-fleet-panel-control-button',
                'data-primary': 'true',
                disabled: saving,
                onClick: () => { save() },
                children: savingMode === 'save' ? panelText('正在保存…', 'Saving…') : panelText('保存权限', 'Save permissions'),
              }),
            ],
          }),
          saveError !== undefined && jsx('p', {
            className: 'dsh-fleet-panel-member-permissions-save-error',
            role: 'alert',
            children: saveError,
          }),
        ],
      }),
    ],
  })
}

const ACCESS_RESOURCE_KIND_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  conversation: ['会话', 'Conversation'],
  document: ['文档', 'Document'],
  file: ['文件', 'File'],
  'git-repository': ['Git 仓库', 'Git repository'],
  'lark-resource': ['飞书资源', 'Lark resource'],
  resource: ['共享资源', 'Shared resource'],
  team: ['团队', 'Team'],
  workspace: ['工作区', 'Workspace'],
}

const ACCESS_LEVEL_NAMES: Readonly<Record<FleetPanelAccessLevel, readonly [string, string]>> = {
  read: ['查看', 'Read'],
  write: ['写入', 'Write'],
  use: ['使用', 'Use'],
  manage: ['管理', 'Manage'],
}

const ACCESS_LEVELS: readonly FleetPanelAccessLevel[] = ['read', 'write', 'use', 'manage']

function accessResourceKindName(kind: string): string {
  const copy = ACCESS_RESOURCE_KIND_NAMES[kind]
  return copy === undefined ? kind : panelText(...copy)
}

function accessLevelName(level: FleetPanelAccessLevel): string {
  return panelText(...ACCESS_LEVEL_NAMES[level])
}

const SIMPLE_PERMISSION_LEVELS = [
  { id: 'observer', name: ['只查看', 'View only'], description: ['读取消息、状态、任务、日程和共享内容，不能修改。', 'Read messages, status, tasks, schedules, and shared content without changing them.'] },
  { id: 'member', name: ['参与工作', 'Collaborate'], description: ['发消息、领取和推进任务、参加会议并评论文档。', 'Send messages, claim and advance tasks, join meetings, and comment on documents.'] },
  { id: 'researcher', name: ['创作内容', 'Create content'], description: ['在参与工作的基础上，还能写共享资源和文档。', 'Collaborate and also write shared resources and documents.'] },
  { id: 'facilitator', name: ['协调团队', 'Coordinate Team'], description: ['管理频道、会议、任务和日程，并可中断或唤醒成员。', 'Manage channels, meetings, tasks, and schedules, and interrupt or wake members.'] },
  { id: 'maintainer', name: ['管理团队', 'Manage Team'], description: ['同时拥有创作与协调能力，并可管理团队、权限和资源访问。', 'Create and coordinate, plus manage the Team, permissions, and resource access.'] },
  { id: 'op', name: ['完全控制', 'Full control'], description: ['不受普通权限限制。仅用于需要维护整个 Fleet 的成员。', 'Bypass ordinary permission limits. Use only for members maintaining the whole Fleet.'] },
] as const

const SIMPLE_ACCESS_CATEGORY_COPY = {
  conversations: {
    name: ['团队会话', 'Team conversations'] as const,
    description: ['频道和成员私聊。', 'Channels and member direct conversations.'] as const,
  },
  content: {
    name: ['文件与工作内容', 'Files and work content'] as const,
    description: ['文件、文档、工作区、Git 仓库和共享资源。', 'Files, documents, workspaces, Git repositories, and shared resources.'] as const,
  },
  team: {
    name: ['团队本身', 'The Team itself'] as const,
    description: ['针对团队整体的查看和管理操作。', 'Viewing and management operations aimed at the Team itself.'] as const,
  },
  other: {
    name: ['插件资源', 'Plugin resources'] as const,
    description: ['由已安装插件提供的其它资源类型。', 'Other resource types provided by installed plugins.'] as const,
  },
}

function simplePermissionSelection(authorization: FleetPanelMemberAuthorization): string | undefined {
  const assignment = authorization.assignment
  if (assignment.grants.length > 0 || assignment.denies.length > 0
    || assignment.toolGroups.length > 0 || assignment.denyToolGroups.length > 0) return undefined
  if (assignment.op) return 'op'
  return assignment.groups.length === 1 && SIMPLE_PERMISSION_LEVELS.some(level => level.id === assignment.groups[0])
    ? assignment.groups[0]
    : undefined
}

function simpleAccessCategories(resourceKinds: readonly string[]): readonly {
  readonly id: keyof typeof SIMPLE_ACCESS_CATEGORY_COPY
  readonly kinds: readonly string[]
}[] {
  const known = new Set(resourceKinds)
  const conversations = ['conversation'].filter(kind => known.has(kind))
  const content = ['document', 'file', 'git-repository', 'lark-resource', 'resource', 'workspace'].filter(kind => known.has(kind))
  const team = ['team'].filter(kind => known.has(kind))
  const claimed = new Set([...conversations, ...content, ...team])
  const other = resourceKinds.filter(kind => !claimed.has(kind))
  const categories: readonly {
    readonly id: keyof typeof SIMPLE_ACCESS_CATEGORY_COPY
    readonly kinds: readonly string[]
  }[] = [
    { id: 'conversations' as const, kinds: conversations },
    { id: 'content' as const, kinds: content },
    { id: 'team' as const, kinds: team },
    { id: 'other' as const, kinds: other },
  ].filter(category => category.kinds.length > 0)
  return categories
}

function SimpleMemberAuthorization({ owner, member, showDetailed }: {
  readonly owner: FleetPanelPaneOwner
  readonly member: FleetPanelMember
  readonly showDetailed: () => void
}): ReactElement {
  const loadPermissions = owner.loadMemberAuthorization
  const loadAccess = owner.loadMemberAccess
  const updatePermissions = owner.updateMemberPermissions
  const updateAccess = owner.updateMemberAccess
  const viewKey = `${owner.snapshot.teamId}:${member.id}`
  const activeViewKey = useRef(viewKey)
  activeViewKey.current = viewKey
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'error'; readonly message: string }
    | { readonly status: 'ready'; readonly permissions: FleetPanelMemberAuthorization; readonly access: FleetPanelMemberAccess }
  >({ status: 'loading' })
  const [busy, setBusy] = useState<string>()
  const [saveError, setSaveError] = useState<string>()

  useEffect(() => {
    if (loadPermissions === undefined || loadAccess === undefined) return
    const controller = new AbortController()
    setState({ status: 'loading' })
    setSaveError(undefined)
    void Promise.all([
      loadPermissions(owner.snapshot.teamId, member.id, controller.signal),
      loadAccess(member.id, controller.signal),
    ]).then(([permissions, access]) => {
      if (!controller.signal.aborted) setState({ status: 'ready', permissions, access })
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setState({
        status: 'error',
        message: reason instanceof Error ? reason.message : panelText('无法读取权限配置', 'Permission settings could not be loaded'),
      })
    })
    return () => controller.abort()
  }, [loadAccess, loadPermissions, member.id, owner.snapshot.teamId])

  if (loadPermissions === undefined || loadAccess === undefined) return jsx('p', {
    className: 'dsh-fleet-panel-member-permissions-empty',
    children: panelText('当前实例没有提供权限配置接口。', 'This instance does not provide permission configuration APIs.'),
  })
  if (state.status === 'loading') return jsx('p', {
    className: 'dsh-fleet-panel-member-permissions-empty',
    children: panelText('正在读取权限与访问范围…', 'Loading permissions and access…'),
  })
  if (state.status === 'error') return jsxs('div', {
    className: 'dsh-fleet-panel-member-permissions-error',
    children: [
      jsx('p', { children: state.message }),
      jsx('button', { type: 'button', onClick: () => showDetailed(), children: panelText('打开详细配置', 'Open detailed settings') }),
    ],
  })

  const selected = simplePermissionSelection(state.permissions)
  const categories = simpleAccessCategories(state.access.resourceKinds)
  const setPermission = (id: string): void => {
    if (updatePermissions === undefined || busy !== undefined) return
    const savedViewKey = viewKey
    setBusy(`permission:${id}`)
    setSaveError(undefined)
    void updatePermissions(member.id, {
      groups: id === 'op' ? [] : [id],
      grants: [], denies: [], toolGroups: [], denyToolGroups: [], op: id === 'op',
    }).then(permissions => {
      if (activeViewKey.current === savedViewKey) setState({ ...state, permissions })
    }).catch((reason: unknown) => {
      if (activeViewKey.current === savedViewKey) setSaveError(reason instanceof Error ? reason.message : panelText('无法更新权限', 'Permissions could not be updated'))
    }).finally(() => {
      if (activeViewKey.current === savedViewKey) setBusy(undefined)
    })
  }
  const setAccess = (categoryId: string, kinds: readonly string[], mode: FleetPanelAccessMode): void => {
    if (updateAccess === undefined || busy !== undefined) return
    const savedViewKey = viewKey
    setBusy(`access:${categoryId}`)
    setSaveError(undefined)
    void (async () => {
      let access = state.access
      for (const resourceKind of kinds) {
        access = await updateAccess(member.id, { action: 'set_mode', resourceKind, mode })
      }
      if (activeViewKey.current === savedViewKey) setState({ ...state, access })
    })().catch((reason: unknown) => {
      if (activeViewKey.current === savedViewKey) setSaveError(reason instanceof Error ? reason.message : panelText('无法更新资源范围', 'Resource access could not be updated'))
    }).finally(() => {
      if (activeViewKey.current === savedViewKey) setBusy(undefined)
    })
  }

  return jsxs('div', {
    className: 'dsh-fleet-panel-auth-simple',
    children: [
      jsx('h4', { children: panelText('能做什么', 'What they can do') }),
      jsx('div', {
        className: 'dsh-fleet-panel-auth-levels',
        children: [
          ...SIMPLE_PERMISSION_LEVELS.map(level => jsxs('button', {
            type: 'button',
            'aria-pressed': selected === level.id,
            disabled: busy !== undefined || updatePermissions === undefined,
            onClick: () => setPermission(level.id),
            children: [
              jsx('strong', { children: panelText(level.name[0], level.name[1]) }),
              jsx('span', { children: panelText(level.description[0], level.description[1]) }),
            ],
          }, level.id)),
          selected === undefined && jsxs('button', {
            type: 'button', 'aria-pressed': 'true', onClick: showDetailed,
            children: [
              jsx('strong', { children: panelText('自定义设置', 'Custom setup') }),
              jsx('span', { children: panelText('当前组合不能归入单一档位；点击查看具体设置。', 'The current combination does not match one level; click to inspect it.') }),
            ],
          }),
        ],
      }),
      jsx('h4', { children: panelText('能访问哪些内容', 'Which content they can access') }),
      jsx('div', {
        className: 'dsh-fleet-panel-auth-access',
        children: categories.map(category => {
          const copy = SIMPLE_ACCESS_CATEGORY_COPY[category.id]
          const restricted = category.kinds.filter(kind => state.access.modes.some(candidate => candidate.resourceKind === kind && candidate.mode === 'restricted')).length
          const value = restricted === 0 ? 'inherit' : restricted === category.kinds.length ? 'restricted' : 'mixed'
          return jsxs('label', {
            children: [
              jsxs('span', { children: [
                jsx('strong', { children: panelText(copy.name[0], copy.name[1]) }),
                jsx('small', { children: panelText(copy.description[0], copy.description[1]) }),
              ] }),
              jsxs('select', {
                value,
                disabled: busy !== undefined || updateAccess === undefined,
                onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                  if (event.currentTarget.value !== 'mixed') setAccess(category.id, category.kinds, event.currentTarget.value as FleetPanelAccessMode)
                },
                children: [
                  jsx('option', { value: 'inherit', children: panelText('按团队默认范围', 'Use Team defaults') }),
                  jsx('option', { value: 'restricted', children: panelText('仅限允许清单', 'Allow-list only') }),
                  value === 'mixed' && jsx('option', { value: 'mixed', children: panelText('混合设置', 'Mixed setup') }),
                ],
              }),
            ],
          }, category.id)
        }),
      }),
      jsxs('div', { className: 'dsh-fleet-panel-auth-exceptions', children: [
        jsx('span', { children: state.access.rules.length === 0
          ? panelText('没有具体资源例外。', 'No specific resource exceptions.')
          : panelText(`${state.access.rules.length} 条具体资源例外正在生效。`, `${state.access.rules.length} specific resource exceptions are active.`) }),
        jsx('button', { type: 'button', onClick: showDetailed, children: state.access.rules.length === 0 ? panelText('添加例外', 'Add exception') : panelText('查看例外', 'View exceptions') }),
      ] }),
      saveError !== undefined && jsx('p', { className: 'dsh-fleet-panel-member-permissions-save-error', role: 'alert', children: saveError }),
    ],
  })
}

export function MemberAuthorizationPanel({ owner, member }: {
  readonly owner: FleetPanelPaneOwner
  readonly member: FleetPanelMember
}): ReactElement {
  const [mode, setMode] = useState<'simple' | 'detailed'>('simple')
  return jsxs('section', {
    className: 'dsh-fleet-panel-auth',
    children: [
      jsxs('div', { className: 'dsh-fleet-panel-auth-head', children: [
        jsxs('div', { children: [
          jsx('h3', { children: panelText('权限与访问', 'Permissions and access') }),
          jsx('p', { children: panelText('权限决定能做什么；资源访问决定能对哪些内容做。', 'Permissions decide what this member can do; resource access decides which content they can do it to.') }),
        ] }),
        jsxs('div', { className: 'dsh-fleet-panel-auth-mode', role: 'group', 'aria-label': panelText('配置精细程度', 'Configuration detail'), children: [
          jsx('button', { type: 'button', 'aria-pressed': mode === 'simple', onClick: () => setMode('simple'), children: panelText('简单', 'Simple') }),
          jsx('button', { type: 'button', 'aria-pressed': mode === 'detailed', onClick: () => setMode('detailed'), children: panelText('详细', 'Detailed') }),
        ] }),
      ] }),
      mode === 'simple'
        ? jsx(SimpleMemberAuthorization, { owner, member, showDetailed: () => setMode('detailed') })
        : jsxs('div', { className: 'dsh-fleet-panel-auth-detailed', children: [
          jsx(MemberPermissions, { owner, member }),
          jsx(MemberAccess, { owner, member }),
        ] }),
    ],
  })
}

function MemberAccess({ owner, member }: {
  readonly owner: FleetPanelPaneOwner
  readonly member: FleetPanelMember
}): ReactElement | null {
  const load = owner.loadMemberAccess
  const update = owner.updateMemberAccess
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly value: FleetPanelMemberAccess }
    | { readonly status: 'error'; readonly message: string }
  >({ status: 'loading' })
  const [ruleDraft, setRuleDraft] = useState<{
    readonly resourceKind: string
    readonly resourceId: string
    readonly scope: FleetPanelAccessScope
    readonly effect: FleetPanelAccessEffect
    readonly levels: readonly FleetPanelAccessLevel[]
  }>({ resourceKind: 'file', resourceId: '', scope: 'self', effect: 'allow', levels: ['read'] })
  const [busy, setBusy] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const viewKey = `${owner.snapshot.teamId}:${member.id}`
  const activeViewKey = useRef(viewKey)
  activeViewKey.current = viewKey

  useEffect(() => {
    if (load === undefined) return
    const controller = new AbortController()
    setBusy(undefined)
    setSaveError(undefined)
    setState({ status: 'loading' })
    void load(member.id, controller.signal).then(value => {
      if (!controller.signal.aborted) setState({ status: 'ready', value })
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setState({
        status: 'error',
        message: reason instanceof Error ? reason.message : panelText('无法读取成员资源访问配置', 'Member resource access settings could not be loaded'),
      })
    })
    return () => { controller.abort(new Error('Fleet member Access view changed')) }
  }, [attempt, load, member.id, owner.snapshot.teamId])

  if (load === undefined || update === undefined) return null
  if (state.status !== 'ready') return jsxs('section', {
    className: 'dsh-fleet-panel-member-access',
    children: [
      jsx('h3', { className: 'dsh-fleet-panel-member-permissions-title', children: panelText('资源访问', 'Resource access') }),
      jsx('p', {
        className: state.status === 'error'
          ? 'dsh-fleet-panel-control-error'
          : 'dsh-fleet-panel-member-permissions-copy',
        role: state.status === 'error' ? 'alert' : 'status',
        children: state.status === 'error' ? state.message : panelText('正在读取资源访问配置…', 'Loading resource access settings…'),
      }),
      state.status === 'error' && jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-control-button',
        onClick: () => { setAttempt(current => current + 1) },
        children: panelText('重试', 'Retry'),
      }),
    ],
  })

  const selectedResourceKind = state.value.resourceKinds.includes(ruleDraft.resourceKind)
    ? ruleDraft.resourceKind
    : (state.value.resourceKinds[0] ?? '')
  const applyChange = (
    change: FleetPanelMemberAccessChange,
    operation: string,
    complete?: () => void,
  ): void => {
    if (busy !== undefined) return
    const savedViewKey = viewKey
    setBusy(operation)
    setSaveError(undefined)
    void update(member.id, change).then(value => {
      if (activeViewKey.current !== savedViewKey) return
      setState({ status: 'ready', value })
      complete?.()
    }).catch((reason: unknown) => {
      if (activeViewKey.current !== savedViewKey) return
      setSaveError(reason instanceof Error ? reason.message : panelText('无法更新成员资源访问，请重试', 'Member resource access could not be updated. Try again.'))
    }).finally(() => {
      if (activeViewKey.current === savedViewKey) setBusy(undefined)
    })
  }
  const toggleLevel = (level: FleetPanelAccessLevel): void => {
    const levels = ruleDraft.levels.includes(level)
      ? ruleDraft.levels.filter(candidate => candidate !== level)
      : ACCESS_LEVELS.filter(candidate => candidate === level || ruleDraft.levels.includes(candidate))
    setRuleDraft({ ...ruleDraft, levels })
  }
  const addRule = (): void => {
    const resourceId = ruleDraft.resourceId.trim()
    if (selectedResourceKind.length === 0 || resourceId.length === 0 || ruleDraft.levels.length === 0) return
    applyChange({
      action: 'add_rule',
      resourceKind: selectedResourceKind,
      resourceId,
      scope: ruleDraft.scope,
      effect: ruleDraft.effect,
      levels: ruleDraft.levels,
    }, 'add', () => { setRuleDraft(current => ({ ...current, resourceId: '' })) })
  }

  return jsxs('section', {
    className: 'dsh-fleet-panel-member-access',
    children: [
      jsxs('div', {
        className: 'dsh-fleet-panel-member-permissions-head',
        children: [
          jsx('h3', { className: 'dsh-fleet-panel-member-permissions-title', children: panelText('资源访问', 'Resource access') }),
          jsx('span', {
            className: 'dsh-fleet-panel-member-permissions-source',
            'data-configured': state.value.rules.length > 0
              || state.value.modes.some(mode => mode.mode === 'restricted') ? 'true' : undefined,
            children: panelText(`${state.value.rules.length} 条专属规则`, `${state.value.rules.length} custom ${state.value.rules.length === 1 ? 'rule' : 'rules'}`),
          }),
        ],
      }),
      jsx('p', {
        className: 'dsh-fleet-panel-member-permissions-copy',
        children: panelText('资源访问在操作权限通过后判定。这里编辑这位成员的专属规则；权限组规则仍会叠加生效，拒绝优先。更改会立即生效。', 'Resource access is evaluated after operation permissions. Edit this member’s custom rules here; permission-group rules still apply, and deny takes precedence. Changes take effect immediately.'),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-member-permissions-section-head',
        children: [
          jsx('h4', {
            id: `dsh-fleet-member-access-modes-${member.id}`,
            className: 'dsh-fleet-panel-member-permissions-section-title',
            children: panelText('资源默认方式', 'Resource defaults'),
          }),
          jsx('span', {
            className: 'dsh-fleet-panel-member-permissions-section-meta',
            children: panelText('按资源类型设置', 'Set by resource type'),
          }),
        ],
      }),
      state.value.resourceKinds.length === 0
        ? jsx('p', {
            className: 'dsh-fleet-panel-member-permissions-empty',
            children: panelText('当前没有已注册的资源类型。', 'No resource types are registered.'),
          })
        : jsx('div', {
            className: 'dsh-fleet-panel-member-access-modes',
            'aria-labelledby': `dsh-fleet-member-access-modes-${member.id}`,
            children: state.value.resourceKinds.map(resourceKind => {
              const mode = state.value.modes.find(candidate => candidate.resourceKind === resourceKind)?.mode ?? 'inherit'
              return jsxs('label', {
                className: 'dsh-fleet-panel-member-access-mode',
                children: [
                  jsxs('span', {
                    className: 'dsh-fleet-panel-member-access-mode-copy',
                    children: [
                      jsx('span', {
                        className: 'dsh-fleet-panel-member-access-mode-name',
                        children: accessResourceKindName(resourceKind),
                      }),
                      jsx('span', {
                        className: 'dsh-fleet-panel-member-access-mode-detail',
                        children: mode === 'restricted'
                          ? panelText('未匹配允许规则时拒绝', 'Deny when no allow rule matches')
                          : panelText('未匹配规则时沿用默认访问', 'Use default access when no rule matches'),
                      }),
                    ],
                  }),
                  jsx('select', {
                    className: 'dsh-fleet-panel-member-access-select',
                    'aria-label': panelText(`${accessResourceKindName(resourceKind)}默认访问方式`, `Default access mode for ${accessResourceKindName(resourceKind)}`),
                    value: mode,
                    disabled: busy !== undefined,
                    onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                      applyChange({
                        action: 'set_mode',
                        resourceKind,
                        mode: event.currentTarget.value as FleetPanelAccessMode,
                      }, `mode:${resourceKind}`)
                    },
                    children: [
                      jsx('option', { value: 'inherit', children: panelText('沿用默认', 'Use default') }),
                      jsx('option', { value: 'restricted', children: panelText('仅允许规则', 'Allow rules only') }),
                    ],
                  }),
                ],
              }, resourceKind)
            }),
          }),
      jsxs('div', {
        className: 'dsh-fleet-panel-member-permissions-section-head',
        children: [
          jsx('h4', {
            className: 'dsh-fleet-panel-member-permissions-section-title',
            children: panelText('专属访问规则', 'Custom access rules'),
          }),
          jsx('span', {
            className: 'dsh-fleet-panel-member-permissions-section-meta',
            children: panelText('拒绝规则优先', 'Deny rules take precedence'),
          }),
        ],
      }),
      state.value.rules.length === 0
        ? jsx('p', {
            className: 'dsh-fleet-panel-member-permissions-empty',
            children: panelText('还没有专属规则。沿用默认时使用资源自身的访问范围；仅允许规则时，没有匹配项就会拒绝。', 'There are no custom rules yet. Use default applies the resource’s own access scope; allow-rules-only denies access when nothing matches.'),
          })
        : jsx('div', {
            className: 'dsh-fleet-panel-member-access-rules',
            children: state.value.rules.map(rule => jsxs('div', {
              className: 'dsh-fleet-panel-member-access-rule',
              children: [
                jsx('span', {
                  className: 'dsh-fleet-panel-member-access-rule-effect',
                  'data-effect': rule.effect,
                  children: rule.effect === 'allow' ? panelText('允许', 'Allow') : panelText('拒绝', 'Deny'),
                }),
                jsxs('div', {
                  className: 'dsh-fleet-panel-member-access-rule-copy',
                  children: [
                    jsx('div', {
                      className: 'dsh-fleet-panel-member-access-rule-resource',
                      children: `${accessResourceKindName(rule.resourceKind)} · ${rule.resourceId}`,
                    }),
                    jsx('div', {
                      className: 'dsh-fleet-panel-member-access-rule-detail',
                      children: `${rule.scope === 'tree' ? panelText('包含下级', 'Includes children') : panelText('仅此资源', 'This resource only')} · ${rule.levels.map(accessLevelName).join(panelText('、', ', '))}`,
                    }),
                  ],
                }),
                jsx('button', {
                  type: 'button',
                  className: 'dsh-fleet-panel-member-access-remove',
                  disabled: busy !== undefined,
                  'aria-label': panelText(`删除 ${rule.resourceId} 的访问规则`, `Delete access rule for ${rule.resourceId}`),
                  onClick: () => { applyChange({ action: 'remove_rule', ruleId: rule.id }, `remove:${rule.id}`) },
                  children: busy === `remove:${rule.id}` ? panelText('正在删除…', 'Deleting…') : panelText('删除', 'Delete'),
                }),
              ],
            }, rule.id)),
          }),
      jsx('h4', {
        className: 'dsh-fleet-panel-member-permissions-section-title',
        style: { marginTop: 20 },
        children: panelText('添加规则', 'Add rule'),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-member-access-form',
        children: [
          jsxs('label', {
            className: 'dsh-fleet-panel-member-access-field',
            children: [
              jsx('span', { className: 'dsh-fleet-panel-member-access-label', children: panelText('资源类型', 'Resource type') }),
              jsx('select', {
                className: 'dsh-fleet-panel-member-access-select',
                value: selectedResourceKind,
                disabled: busy !== undefined || state.value.resourceKinds.length === 0,
                onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                  setRuleDraft({ ...ruleDraft, resourceKind: event.currentTarget.value })
                },
                children: state.value.resourceKinds.map(kind => jsx('option', {
                  value: kind,
                  children: accessResourceKindName(kind),
                }, kind)),
              }),
            ],
          }),
          jsxs('label', {
            className: 'dsh-fleet-panel-member-access-field',
            children: [
              jsx('span', { className: 'dsh-fleet-panel-member-access-label', children: panelText('资源标识', 'Resource identifier') }),
              jsx('input', {
                className: 'dsh-fleet-panel-member-access-input',
                value: ruleDraft.resourceId,
                disabled: busy !== undefined,
                placeholder: panelText('路径、会话 ID 或资源 ID', 'Path, conversation ID, or resource ID'),
                onChange: (event: ChangeEvent<HTMLInputElement>) => {
                  setRuleDraft({ ...ruleDraft, resourceId: event.currentTarget.value })
                },
              }),
            ],
          }),
          jsxs('label', {
            className: 'dsh-fleet-panel-member-access-field',
            children: [
              jsx('span', { className: 'dsh-fleet-panel-member-access-label', children: panelText('规则效果', 'Rule effect') }),
              jsx('select', {
                className: 'dsh-fleet-panel-member-access-select',
                value: ruleDraft.effect,
                disabled: busy !== undefined,
                onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                  setRuleDraft({ ...ruleDraft, effect: event.currentTarget.value as FleetPanelAccessEffect })
                },
                children: [
                  jsx('option', { value: 'allow', children: panelText('允许', 'Allow') }),
                  jsx('option', { value: 'deny', children: panelText('拒绝', 'Deny') }),
                ],
              }),
            ],
          }),
          jsxs('label', {
            className: 'dsh-fleet-panel-member-access-field',
            children: [
              jsx('span', { className: 'dsh-fleet-panel-member-access-label', children: panelText('作用范围', 'Scope') }),
              jsx('select', {
                className: 'dsh-fleet-panel-member-access-select',
                value: ruleDraft.scope,
                disabled: busy !== undefined,
                onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                  setRuleDraft({ ...ruleDraft, scope: event.currentTarget.value as FleetPanelAccessScope })
                },
                children: [
                  jsx('option', { value: 'self', children: panelText('仅此资源', 'This resource only') }),
                  jsx('option', { value: 'tree', children: panelText('包含下级资源', 'Include child resources') }),
                ],
              }),
            ],
          }),
          jsxs('fieldset', {
            className: 'dsh-fleet-panel-member-access-field',
            'data-wide': 'true',
            style: { border: 0, margin: 0, padding: 0 },
            children: [
              jsx('legend', { className: 'dsh-fleet-panel-member-access-label', children: panelText('访问级别', 'Access levels') }),
              jsx('div', {
                className: 'dsh-fleet-panel-member-access-levels',
                children: ACCESS_LEVELS.map(level => jsxs('label', {
                  className: 'dsh-fleet-panel-member-access-level',
                  children: [
                    jsx('input', {
                      type: 'checkbox',
                      checked: ruleDraft.levels.includes(level),
                      disabled: busy !== undefined,
                      onChange: () => { toggleLevel(level) },
                    }),
                    accessLevelName(level),
                  ],
                }, level)),
              }),
            ],
          }),
          jsxs('div', {
            className: 'dsh-fleet-panel-member-access-form-actions',
            children: [
              jsx('p', {
                className: 'dsh-fleet-panel-member-access-feedback',
                children: ruleDraft.levels.length === 0
                  ? panelText('至少选择一个访问级别。', 'Select at least one access level.')
                  : panelText('写入包含查看；管理包含写入和查看。', 'Write includes read; manage includes write and read.'),
              }),
              jsx('button', {
                type: 'button',
                className: 'dsh-fleet-panel-control-button',
                'data-primary': 'true',
                disabled: busy !== undefined || selectedResourceKind.length === 0
                  || ruleDraft.resourceId.trim().length === 0 || ruleDraft.levels.length === 0,
                onClick: addRule,
                children: busy === 'add' ? panelText('正在添加…', 'Adding…') : panelText('添加规则', 'Add rule'),
              }),
              saveError !== undefined && jsx('p', {
                className: 'dsh-fleet-panel-member-access-feedback',
                'data-error': 'true',
                role: 'alert',
                children: saveError,
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

function FleetMemberModelSelect({
  groups,
  failures,
  value,
  fallbackLabel,
  effort,
  disabled,
  status,
  error,
  reload,
  onChange,
}: {
  readonly groups: readonly FleetModelProviderGroup[]
  readonly failures: readonly FleetModelCatalogFailure[]
  readonly value: string
  readonly fallbackLabel?: string
  readonly effort: string
  readonly disabled: boolean
  readonly status: FleetModelDirectoryState['status']
  readonly error: string | null
  readonly reload: () => void
  readonly onChange: (provider: string, model: string) => void
}): ReactElement {
  const choices = groups.flatMap(group => group.models.map(model => ({
    key: JSON.stringify([group.id, model.id]),
    model,
  })))
  const selected = choices.find(choice => choice.key === value)
  const label = selected?.model.name ?? fallbackLabel ?? panelText('选择模型', 'Select model')
  const title = effort === '' ? label : `${label} · ${effort}`
  const menuId = useId()
  const radio = useFleetRadioMenu(value === '' ? undefined : value, choices.length)
  const toggle = (): void => {
    if (!radio.open) reload()
    radio.setOpen(current => !current)
  }

  return jsxs('div', {
    className: 'dsh-fleet-panel-member-model-select',
    onBlur: radio.onBlur,
    children: [
      jsxs('button', {
        ref: radio.trigger,
        type: 'button',
        className: 'dsh-fleet-panel-member-model-trigger',
        'aria-label': effort === ''
          ? panelText(`选择模型，当前 ${label}`, `Select model, current ${label}`)
          : panelText(`选择模型，当前 ${label}，推理等级 ${effort}`, `Select model, current ${label}, reasoning effort ${effort}`),
        'aria-haspopup': 'menu',
        'aria-expanded': radio.open ? 'true' : 'false',
        'aria-controls': radio.open ? menuId : undefined,
        title,
        disabled,
        onClick: toggle,
        onKeyDown: radio.onTriggerKeyDown,
        children: [
          jsx('span', { className: 'dsh-fleet-panel-member-model-trigger-label', children: label }),
          effort !== '' && jsx('span', { className: 'dsh-fleet-panel-member-model-trigger-effort', children: effort }),
          jsx('span', {
            className: 'dsh-fleet-panel-member-model-chevron',
            children: jsx(PanelIcon, { name: 'chevron', size: 14 }),
          }),
        ],
      }),
      radio.open && jsxs('div', {
        ref: radio.menu,
        id: menuId,
        className: 'dsh-fleet-panel-member-model-menu',
        role: 'menu',
        'aria-label': panelText('选择成员模型', 'Select member model'),
        'aria-busy': status === 'loading' ? 'true' : 'false',
        onKeyDown: radio.onMenuKeyDown,
        children: [
          status === 'loading' && jsx('div', {
            className: 'dsh-fleet-panel-member-model-status',
            children: panelText('正在刷新模型列表…', 'Refreshing model list…'),
          }),
          error !== null && jsxs('div', {
            className: 'dsh-fleet-panel-member-model-error',
            children: [
              jsx('span', { children: panelText(`模型目录加载失败：${error}`, `Model catalog failed to load: ${error}`) }),
              jsx('button', {
                type: 'button',
                className: 'dsh-fleet-panel-member-model-retry',
                onClick: reload,
                children: panelText('重新加载', 'Reload'),
              }),
            ],
          }),
          ...failures.map(failure => jsx('div', {
            className: 'dsh-fleet-panel-member-model-warning',
            children: panelText(`${failure.name} 加载失败：${failure.message}`, `${failure.name} failed to load: ${failure.message}`),
          }, failure.id)),
          choices.length === 0 && status !== 'loading'
            ? jsx('div', {
                className: 'dsh-fleet-panel-member-model-empty',
                children: panelText('没有可用的模型。', 'No models available.'),
              })
            : jsx('div', {
                className: 'dsh-fleet-panel-member-model-groups scrollable',
                children: groups.map(group => jsxs('section', {
                  className: 'dsh-fleet-panel-member-model-group',
                  role: 'group',
                  'aria-label': group.name,
                  children: [
                    jsx('div', { className: 'dsh-fleet-panel-member-model-group-title', children: group.name }),
                    ...group.models.map(model => {
                      const key = JSON.stringify([group.id, model.id])
                      const checked = key === value
                      return jsxs('button', {
                        type: 'button',
                        tabIndex: -1,
                        role: 'menuitemradio',
                        'aria-checked': checked ? 'true' : 'false',
                        className: 'dsh-fleet-panel-member-model-option',
                        title: model.name,
                        onClick: () => {
                          onChange(group.id, model.id)
                          radio.close(true)
                        },
                        children: [
                          jsxs('span', {
                            className: 'dsh-fleet-panel-member-model-option-copy',
                            children: [
                              jsx('span', { className: 'dsh-fleet-panel-member-model-option-name', children: model.name }),
                              model.description !== undefined && jsx('span', {
                                className: 'dsh-fleet-panel-member-model-option-description',
                                children: model.description,
                              }),
                            ],
                          }),
                          jsx('span', {
                            className: 'dsh-fleet-panel-member-model-option-check',
                            children: checked ? jsx(PanelIcon, { name: 'check', size: 16 }) : null,
                          }),
                        ],
                      }, model.id)
                    }),
                  ],
                }, group.id)),
              }),
        ],
      }),
    ],
  })
}

export function MemberRequestConfiguration({ owner, member, assistant }: {
  readonly owner: FleetPanelPaneOwner
  readonly member: FleetPanelMember
  readonly assistant: boolean
}): ReactElement {
  const configure = owner.configureMemberRequest
  const [modelDirectory, modelDirectoryState] = useFleetPanelModelDirectory(owner.sessionId)
  const [providerName, setProviderName] = useState(member.provider ?? '')
  const [modelName, setModelName] = useState(member.model ?? '')
  const [modelKey, setModelKey] = useState(member.provider === undefined || member.model === undefined
    ? ''
    : JSON.stringify([member.provider, member.model]))
  const [effort, setEffort] = useState(member.reasoningEffort ?? '')
  const [maxTokens, setMaxTokens] = useState(member.maxTokens?.toString() ?? '')
  const [modelDirty, setModelDirty] = useState(false)
  const [effortDirty, setEffortDirty] = useState(false)
  const [maxTokensDirty, setMaxTokensDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const modelChoices = useMemo(() => modelDirectoryState.groups.flatMap(group => group.models.map(model => ({
    key: JSON.stringify([group.id, model.id]),
    provider: group.id,
    model: model.id,
  }))), [modelDirectoryState.groups])
  const manualModelEntry = modelDirectory === undefined
    || (modelDirectoryState.status === 'error' && modelDirectoryState.groups.length === 0)
  const currentModelAdvertised = modelChoices.some(choice => choice.key === modelKey)
  const dirty = modelDirty || effortDirty || maxTokensDirty

  useEffect(() => {
    setProviderName(member.provider ?? '')
    setModelName(member.model ?? '')
    setModelKey(member.provider === undefined || member.model === undefined
      ? ''
      : JSON.stringify([member.provider, member.model]))
    setEffort(member.reasoningEffort ?? '')
    setMaxTokens(member.maxTokens?.toString() ?? '')
    setModelDirty(false)
    setEffortDirty(false)
    setMaxTokensDirty(false)
    setError(undefined)
    setNotice(undefined)
  }, [member.id, member.maxTokens, member.model, member.provider, member.reasoningEffort])

  const save = async (): Promise<void> => {
    if (configure === undefined || saving || !dirty) return
    const request: FleetPanelTeamRequestInput['request'] = {}
    if (modelDirty) {
      if (manualModelEntry) {
        if (providerName.trim() === '' || modelName.trim() === '') {
          setError(panelText('Provider 和模型名称都不能为空。', 'Provider and model name are both required.'))
          return
        }
        Object.assign(request, { provider: providerName.trim(), model: modelName.trim() })
      } else {
        const selected = modelChoices.find(choice => choice.key === modelKey)
        if (selected === undefined) {
          setError(panelText('请选择一个可用模型。', 'Choose an available model.'))
          return
        }
        Object.assign(request, { provider: selected.provider, model: selected.model })
      }
    }
    if (effortDirty) Object.assign(request, { reasoningEffort: effort === '' ? null : effort })
    if (maxTokensDirty) {
      const normalized = maxTokens.trim()
      if (normalized !== '' && (!Number.isSafeInteger(Number(normalized)) || Number(normalized) <= 0)) {
        setError(panelText('最大 Token 必须是正整数。', 'Maximum tokens must be a positive integer.'))
        return
      }
      Object.assign(request, { maxTokens: normalized === '' ? null : Number(normalized) })
    }
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await configure(member.id, assistant, request)
      setModelDirty(false)
      setEffortDirty(false)
      setMaxTokensDirty(false)
      setNotice(panelText('请求配置已保存，从下一次模型调用开始生效。', 'Request configuration saved. It takes effect on the next model call.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法保存成员请求配置', 'Could not save member request configuration'))
    } finally {
      setSaving(false)
    }
  }

  return jsxs('section', {
    className: 'dsh-fleet-panel-member-request',
    children: [
      jsxs('div', { className: 'dsh-fleet-panel-member-request-head', children: [
        jsx('h3', { children: panelText('模型与请求', 'Model and request') }),
        jsx('p', { children: panelText('单独配置这位成员；不会中断当前回合，从下一次模型调用开始生效。', 'Configure this member without interrupting the current turn. Changes apply on the next model call.') }),
      ] }),
      jsxs('div', { className: 'dsh-fleet-panel-member-request-grid', children: [
        manualModelEntry ? jsxs(Fragment, { children: [
          jsxs('label', { className: 'dsh-fleet-panel-member-request-field', children: [
            jsx('span', { children: 'Provider' }),
            jsx('input', { value: providerName, disabled: saving || configure === undefined, placeholder: 'provider-id', onChange: (event: ChangeEvent<HTMLInputElement>) => { setProviderName(event.currentTarget.value); setModelDirty(true); setNotice(undefined) } }),
          ] }),
          jsxs('label', { className: 'dsh-fleet-panel-member-request-field', children: [
            jsx('span', { children: panelText('模型名称', 'Model name') }),
            jsx('input', { value: modelName, disabled: saving || configure === undefined, placeholder: 'deepseek-v4-flash', onChange: (event: ChangeEvent<HTMLInputElement>) => { setModelName(event.currentTarget.value); setModelDirty(true); setNotice(undefined) } }),
          ] }),
        ] }) : jsxs('div', { className: 'dsh-fleet-panel-member-request-field', 'data-wide': 'true', children: [
          jsx('span', { children: panelText('模型', 'Model') }),
          jsx(FleetMemberModelSelect, {
            groups: modelDirectoryState.groups,
            failures: modelDirectoryState.failures,
            value: modelKey,
            ...(modelKey !== '' && !currentModelAdvertised && member.model !== undefined
              ? { fallbackLabel: member.model }
              : {}),
            effort,
            disabled: saving || configure === undefined,
            status: modelDirectoryState.status,
            error: modelDirectoryState.error,
            reload: () => { void modelDirectory?.load().catch(() => undefined) },
            onChange: (provider: string, model: string) => {
              setModelKey(JSON.stringify([provider, model]))
              setProviderName(provider)
              setModelName(model)
              setModelDirty(true)
              setNotice(undefined)
            },
          }),
        ] }),
        jsxs('label', { className: 'dsh-fleet-panel-member-request-field', children: [
          jsx('span', { children: panelText('推理强度', 'Reasoning effort') }),
          jsx('select', { value: effort, disabled: saving || configure === undefined, onChange: (event: ChangeEvent<HTMLSelectElement>) => { setEffort(event.currentTarget.value); setEffortDirty(true); setNotice(undefined) }, children: [
            jsx('option', { value: '', children: panelText('使用模型默认值', 'Use model default') }),
            ...['low', 'medium', 'high', 'xhigh', 'max'].map(value => jsx('option', { value, children: value }, value)),
          ] }),
        ] }),
        jsxs('label', { className: 'dsh-fleet-panel-member-request-field', children: [
          jsx('span', { children: panelText('最大 Token', 'Maximum tokens') }),
          jsx('input', { type: 'number', min: 1, step: 1, value: maxTokens, disabled: saving || configure === undefined, placeholder: panelText('使用模型默认值', 'Use model default'), onChange: (event: ChangeEvent<HTMLInputElement>) => { setMaxTokens(event.currentTarget.value); setMaxTokensDirty(true); setNotice(undefined) } }),
        ] }),
      ] }),
      manualModelEntry && jsx('p', { className: 'dsh-fleet-panel-member-request-note', children: panelText('当前实例未提供模型目录，请填写 DSH 中已配置的 Provider 和模型标识。', 'This instance does not provide a model catalog. Enter a Provider and model identifier configured in DSH.') }),
      jsxs('div', { className: 'dsh-fleet-panel-member-request-actions', children: [
        jsx('span', { className: 'dsh-fleet-panel-member-request-feedback', role: error === undefined ? 'status' : 'alert', 'data-error': error === undefined ? undefined : 'true', children: error ?? notice }),
        jsx('button', { type: 'button', className: 'dsh-fleet-panel-control-button', 'data-primary': 'true', disabled: !dirty || saving || configure === undefined, onClick: () => { void save() }, children: saving ? panelText('正在应用…', 'Applying…') : panelText('应用配置', 'Apply configuration') }),
      ] }),
    ],
  })
}



export function centerFleetContextTarget(scrollport: HTMLElement, target: HTMLElement): void {
  const targetBounds = target.getBoundingClientRect()
  const scrollBounds = scrollport.getBoundingClientRect()
  const targetCenter = targetBounds.top + targetBounds.height / 2
  const viewportCenter = scrollBounds.top + scrollport.clientHeight / 2
  const nextTop = scrollport.scrollTop + targetCenter - viewportCenter
  if (Math.abs(nextTop - scrollport.scrollTop) < 0.5) return
  scrollport.scrollTop = Math.max(0, nextTop)
}

export function expandFleetTargetFold(container: HTMLElement, targetKey: string): void {
  const folds = [...container.querySelectorAll<HTMLElement>('[data-dsh-fold-keys], [data-dsh-fold-trigger-keys]')]
  for (let index = folds.length - 1; index >= 0; index -= 1) {
    const fold = folds[index]
    if (fold === undefined) continue
    try {
      const keys = JSON.parse(fold.dataset.dshFoldKeys ?? '') as unknown
      const triggerKeys = JSON.parse(fold.dataset.dshFoldTriggerKeys ?? '[]') as unknown
      if (
        (!Array.isArray(keys) || !keys.includes(targetKey))
        && (!Array.isArray(triggerKeys) || !triggerKeys.includes(targetKey))
      ) continue
      fold.querySelector<HTMLElement>(
        'button[aria-expanded="false"], [role="button"][aria-expanded="false"]',
      )?.click()
      return
    } catch {}
  }
}
























export function PanelUnavailable({ label }: { readonly label: string }): ReactElement {
  return jsx('div', { className: 'dsh-fleet-panel-empty', children: label })
}

interface SlotRegistrationOptions {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly order?: number
  readonly label?: () => string
  readonly locale?: string
  readonly children?: Readonly<Record<string, { readonly kind: 'single' | 'list' | 'keyed'; readonly scope: 'session' }>>
  readonly inject?: (sessionId: string) => Record<string, unknown>
}

interface FleetPanelSlots {
  inject(name: string, register: () => unknown): void
  register(options: SlotRegistrationOptions, component: ComponentType<any>): unknown
}

interface FleetMarkdownRenderer {
  render(request: { readonly markdown: string; readonly mode?: 'gfm' | 'render-friendly' }): Promise<{ readonly html: string }>
}

let fleetMarkdownRenderer: FleetMarkdownRenderer | undefined

interface FleetRenderEngineMessageTextProps extends FleetPanelMessageTextOwner {
  readonly markdownRenderer: FleetMarkdownRenderer
}

interface FleetRenderEngineResourcePreviewProps extends FleetPanelResourcePreviewOwner {
  readonly markdownRenderer: FleetMarkdownRenderer
}

interface FleetDiffEngine {
  diff(input: {
    readonly kind: 'files'
    readonly before: { readonly path: string; readonly content: string }
    readonly after: { readonly path: string; readonly content: string }
  }): unknown
}

interface FleetDiffRenderer {
  render(document: unknown): { readonly html: string }
}

interface FleetRenderEngineResourceDiffProps extends FleetPanelResourceDiffOwner {
  readonly diffEngine: FleetDiffEngine
  readonly diffRenderer: FleetDiffRenderer
}

interface PreparedFleetMarkdown {
  readonly html: string
  readonly css: string
}

function decorateFleetMarkdownMentions(root: DocumentFragment, members: readonly FleetPanelMember[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && node.parentElement?.closest('a, button, code, pre') === null) nodes.push(node)
  }
  for (const node of nodes) {
    const segments = splitFleetMemberMentions(node.data, members)
    if (!segments.some(segment => segment.member !== undefined)) continue
    const fragment = document.createDocumentFragment()
    for (const segment of segments) {
      if (segment.member === undefined) fragment.append(document.createTextNode(segment.text))
      else {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'dsh-fleet-panel-member-mention'
        button.dataset.memberId = segment.member.id
        button.setAttribute('aria-label', panelText(`${segment.text}，查看 ${segment.member.name} 的成员信息`, `${segment.text}, view member details for ${segment.member.name}`))
        button.textContent = segment.text
        fragment.append(button)
      }
    }
    node.replaceWith(fragment)
  }
}

function prepareFleetMarkdown(
  renderedHtml: string,
  members: readonly FleetPanelMember[],
): PreparedFleetMarkdown {
  if (typeof document === 'undefined') return { html: renderedHtml, css: '' }
  const template = document.createElement('template')
  template.innerHTML = renderedHtml
  const styles: string[] = []
  for (const child of Array.from(template.content.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim() === '') continue
    if (child.nodeType !== Node.ELEMENT_NODE || child.nodeName !== 'STYLE') break
    styles.push(child.textContent ?? '')
    child.remove()
  }
  decorateFleetMarkdownMentions(template.content, members)
  return { html: template.innerHTML, css: styles.join('\n') }
}

function installFleetRenderEngineStyles(css: string): void {
  if (css === '' || typeof document === 'undefined') return
  let style = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${RENDER_ENGINE_STYLE_ID}"]`)
  if (style === null) {
    style = document.createElement('style')
    style.dataset.pluginCss = RENDER_ENGINE_STYLE_ID
    document.head.append(style)
  }
  if (style.textContent !== css) style.textContent = css
}

function FleetMessageText({
  text,
  members,
  markdownRenderer,
  showMemberDetails,
  showMemberContext,
}: FleetMessageTextProps): ReactElement {
  const [html, setHtml] = useState<string>()
  const [memberId, setMemberId] = useState<string>()
  const controller = useFleetAnchoredPopover()
  const mentionSignature = members.map(candidate => `${candidate.id}\u0000${candidate.name}`).join('\u0001')
  const member = members.find(candidate => candidate.id === memberId)

  useEffect(() => {
    let active = true
    setHtml(undefined)
    if (markdownRenderer === undefined) return () => { active = false }
    void markdownRenderer.render({ markdown: text, mode: 'render-friendly' }).then(
      rendered => {
        if (!active) return
        const prepared = prepareFleetMarkdown(rendered.html, members)
        installFleetRenderEngineStyles(prepared.css)
        setHtml(prepared.html)
      },
      () => {
        if (active) setHtml(undefined)
      },
    )
    return () => { active = false }
  }, [markdownRenderer, mentionSignature, text])

  if (html === undefined) return jsx(FleetPlainMessageText, {
    text,
    members,
    ...(showMemberDetails === undefined ? {} : { showMemberDetails }),
    ...(showMemberContext === undefined ? {} : { showMemberContext }),
  })
  return jsxs(Fragment, {
    children: [
      jsx('div', {
        className: 'dsh-fleet-rendered-message',
        onClick: (event: { readonly target: EventTarget | null }) => {
          const target = event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-member-id].dsh-fleet-panel-member-mention')
            : null
          if (target === null) return
          const selected = members.find(candidate => candidate.id === target.dataset.memberId)
          if (selected === undefined) return
          setMemberId(selected.id)
          window.requestAnimationFrame(() => { controller.openAt(target) })
        },
        dangerouslySetInnerHTML: { __html: html },
      }),
      member !== undefined && controller.mounted && jsx(FleetMemberPopoverCard, {
        member,
        controller,
        showStatusText: true,
        ...(showMemberDetails === undefined ? {} : { showDetails: showMemberDetails }),
        ...(showMemberContext === undefined ? {} : { showContext: showMemberContext }),
      }),
    ],
  })
}

function FleetRenderEngineMessageText({ panel, text, markdownRenderer }: FleetRenderEngineMessageTextProps): ReactElement {
  return jsx(FleetMessageText, {
    text,
    members: teamAgents(panel.snapshot),
    markdownRenderer,
    showMemberDetails: panel.showMemberDetails,
    showMemberContext: panel.showMemberContext,
  })
}

function FleetRenderEngineResourcePreview({ resource, markdownRenderer }: FleetRenderEngineResourcePreviewProps): ReactElement {
  const [html, setHtml] = useState<string>()

  useEffect(() => {
    let active = true
    setHtml(undefined)
    void markdownRenderer.render({ markdown: resource.body ?? '', mode: 'render-friendly' }).then(
      rendered => {
        if (!active) return
        const prepared = prepareFleetMarkdown(rendered.html, [])
        installFleetRenderEngineStyles(prepared.css)
        setHtml(prepared.html)
      },
      () => {
        if (active) setHtml(undefined)
      },
    )
    return () => { active = false }
  }, [markdownRenderer, resource.body])

  if (html === undefined) return jsx('pre', {
    className: 'dsh-fleet-panel-resource-preview-plain',
    children: resource.body ?? '',
  })
  return jsx('div', {
    className: 'dsh-fleet-rendered-message dsh-fleet-panel-resource-markdown',
    dangerouslySetInnerHTML: { __html: html },
  })
}

function FleetRenderEngineResourceDiff({ resource, revision, diffEngine, diffRenderer }: FleetRenderEngineResourceDiffProps): ReactElement {
  const html = useMemo(() => {
    try {
      const document = diffEngine.diff({
        kind: 'files',
        before: { path: resource.path, content: revision.before ?? '' },
        after: { path: resource.path, content: revision.after },
      })
      return diffRenderer.render(document).html
    } catch {
      return undefined
    }
  }, [diffEngine, diffRenderer, resource.path, revision.after, revision.before])
  if (html === undefined) return jsx(ResourceDiffFallback, { revision })
  return jsx('div', {
    className: 'dsh-fleet-panel-resource-rendered-diff',
    dangerouslySetInnerHTML: { __html: html },
  })
}

interface FleetPanelClientContext {
  readonly slots: FleetPanelSlots
  readonly locale: FleetLocaleRuntime
  readonly sessions?: FleetMetaClientSessions
  readonly workspaces?: FleetMetaClientWorkspaces
  readonly remote?: {
    $mount(contribution: typeof FLEET_WEB_REMOTE): Promise<() => Promise<void>>
  }
  readonly typert: {
    register(contribution: typeof FLEET_WEB_PEER_LOCAL): () => Promise<void>
  }
  inject<T extends object>(
    services: readonly string[],
    callback: (ctx: FleetPanelClientContext & T) => void,
  ): unknown
  get?(name: string): unknown
  provide?(name: string, value: unknown): () => void
}

class FleetWebPeerRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly source: FleetPanelSource) {
    super(ctx, 'fleetWebPeer', { namespace: 'fleetWebPeer' })
  }

  invalidate(signal: AbortSignal): boolean {
    signal.throwIfAborted()
    if ('invalidate' in this.source && typeof this.source.invalidate === 'function') void this.source.invalidate()
    return true
  }

  invalidateTraces(input: { readonly traces: readonly { readonly teamId: string; readonly memberId: string }[] }, signal: AbortSignal): boolean {
    signal.throwIfAborted()
    if ('invalidateTraces' in this.source && typeof this.source.invalidateTraces === 'function') {
      this.source.invalidateTraces(input.traces)
    }
    return true
  }
}

export interface FleetModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: {
    readonly defaultEffort?: string
    readonly efforts: readonly { readonly id: string; readonly name: string }[]
  }
}

export interface FleetModelCatalogFailure {
  readonly id: string
  readonly name: string
  readonly message: string
}

export interface FleetModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly FleetModelCatalogModel[]
}

export interface FleetModelDirectoryState {
  readonly current: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
  readonly routable: boolean | null
  readonly groups: readonly FleetModelProviderGroup[]
  readonly failures: readonly FleetModelCatalogFailure[]
  readonly status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  readonly error: string | null
}

export interface FleetModelDirectory {
  readonly store: {
    getSnapshot(): FleetModelDirectoryState
    subscribe(listener: () => void): () => void
  }
  load(): Promise<unknown>
  select(selection: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  }): Promise<void>
}

interface FleetModelDirectoryResolver {
  directoryFor(sessionId: string): FleetModelDirectory
}

let fleetModelDirectoryResolver: FleetModelDirectoryResolver | undefined

const EMPTY_FLEET_MODEL_DIRECTORY: FleetModelDirectoryState = {
  current: null,
  routable: null,
  groups: [],
  failures: [],
  status: 'idle',
  error: null,
}

export function getFleetModelDirectory(sessionId: string | undefined): FleetModelDirectory | undefined {
  if (sessionId === undefined || fleetModelDirectoryResolver === undefined) return undefined
  try {
    return fleetModelDirectoryResolver.directoryFor(sessionId)
  } catch {
    return undefined
  }
}

/** @internal Shared with settings-panel.ts */
export function useFleetPanelModelDirectory(sessionId: string | undefined): readonly [FleetModelDirectory | undefined, FleetModelDirectoryState] {
  const directory = getFleetModelDirectory(sessionId)
  const subscribe = useCallback((listener: () => void) => directory?.store.subscribe(listener) ?? (() => undefined), [directory])
  const snapshot = useCallback(() => directory?.store.getSnapshot() ?? EMPTY_FLEET_MODEL_DIRECTORY, [directory])
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (directory === undefined || state.status !== 'idle') return
    void directory.load().catch(() => undefined)
  }, [directory, state.status])
  return [directory, state]
}

function resolveMemberFilePath(cwd: string | undefined, path: string): string {
  if (cwd === undefined || cwd === '' || path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith('\\\\')) return path
  const separator = cwd.includes('\\') ? '\\' : '/'
  return `${cwd.replace(/[\\/]+$/u, '')}${separator}${path}`
}

function createFleetNativeContext(ctx: FleetPanelClientContext): FleetNativeContext {
  const sessions = ctx.sessions as unknown as {
    readonly list: { getSnapshot(): { readonly byId: Readonly<Record<string, { readonly cwd?: string }>> } }
    binding(sessionId: string): { readonly session: FleetNativeSessionFace } | undefined
    fork?(options: { readonly sessionId: string }): Promise<string>
  } | undefined
  const workspaces = ctx.workspaces as unknown as { openPath(path: string): Promise<void> } | undefined
  const commandRemote = (ctx.remote as unknown as {
    readonly commands?: {
      execute(sessionId: string, line: string, images: readonly unknown[]): Promise<{
        readonly ok: boolean
        readonly value?: {
          readonly result: { readonly kind: 'success' | 'error'; readonly text?: string }
        }
        readonly error?: { readonly code?: string; readonly message?: string }
      }>
    }
  } | undefined)?.commands
  const events = (ctx as unknown as {
    readonly events?: { dispatch(type: string, args: readonly unknown[]): ((...args: any[]) => unknown)[] }
  }).events
  return {
    session: sessionId => sessions?.binding(sessionId)?.session,
    executeSessionCommand: async (sessionId, line) => {
      if (commandRemote === undefined) {
        throw new Error(panelText('DSH Session 命令服务不可用', 'The DSH Session command service is unavailable'))
      }
      const response = await commandRemote.execute(sessionId, line, [])
      if (!response.ok) {
        throw new Error(response.error?.message ?? panelText('Session 命令请求失败', 'The Session command request failed'))
      }
      const execution = response.value
      if (execution === undefined) {
        throw new Error(panelText(`未知或格式错误的命令：${line}`, `Unknown or malformed command: ${line}`))
      }
      const trimmed = line.trim()
      const separator = trimmed.search(/\s/u)
      const commandName = (separator === -1 ? trimmed : trimmed.slice(0, separator)).slice(1)
      for (const listener of events?.dispatch('emit', [
        'command/executed',
        sessionId,
        commandName,
        execution.result,
      ]) ?? []) {
        try {
          const returned = listener(sessionId, commandName, execution.result)
          if (returned !== null && typeof returned === 'object' && 'then' in returned) {
            void Promise.resolve(returned).catch(() => undefined)
          }
        } catch {}
      }
      return execution.result
    },
    activateAssistant: async (sessionId, teamId, assistantId) => {
      const targetSessionId = sessions?.fork === undefined
        ? sessionId
        : await sessions.fork({ sessionId })
      const session = sessions?.binding(targetSessionId)?.session
      if (session?.prompt === undefined) throw new Error(panelText('团队助理 Session 当前不可加载', 'The Team assistant Session cannot be loaded right now'))
      const result = await session.prompt([{
        type: 'text',
        text: encodeFleetActivation(
          { mode: 'connection', teamId, assistantId },
          '重新连接到现有 Fleet 团队助理身份；完成连接后等待用户下一条消息，不要主动发送用户可见回复。',
        ),
      }], 'queue')
      if (!result.ok) throw new Error(result.error?.message ?? panelText('团队助理 Session 加载失败', 'The Team assistant Session could not be loaded'))
    },
    openPath: path => workspaces?.openPath(path)
      ?? Promise.reject(new Error(panelText('DSH 工作区文件服务不可用', 'DSH workspace file service is unavailable'))),
    openFile: (sessionId, path) => {
      const cwd = sessions?.list.getSnapshot().byId[sessionId]?.cwd
      return workspaces?.openPath(resolveMemberFilePath(cwd, path))
        ?? Promise.reject(new Error(panelText('DSH 工作区文件服务不可用', 'DSH workspace file service is unavailable')))
    },
    loadImage: (sessionId, attachment) => {
      const conversation = ctx.get?.('conversation') as {
        resolveImage(sessionId: string, attachment: unknown): Promise<string>
      } | undefined
      return conversation?.resolveImage(sessionId, attachment)
        ?? Promise.reject(new Error(panelText('DSH 会话图片服务不可用', 'DSH Session image service is unavailable')))
    },
    fileMentions: owner => {
      const mentions = ctx.get?.('chatFileMentions') as { forClosing(owner: unknown): unknown } | undefined
      return mentions?.forClosing(owner)
    },
  }
}

export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'remote', 'remote.commands', 'typert'] as const

export async function apply(ctx: FleetPanelClientContext): Promise<() => Promise<void>> {
  const disposeConfigurationModules = ctx.provide?.('fleetConfigurationModules', fleetConfigurationModules)
  ctx.inject<{ readonly joyride: FleetJoyrideService }>(['joyride'], joyrideCtx => {
    configureFleetJoyride(joyrideCtx.joyride)
    const disposeOpen = joyrideCtx.joyride.register({
      id: 'fleet.open',
      label: panelText('打开 Agent Fleet 团队选项卡', 'Open the Agent Fleet Team tab'),
      scope: 'fleet',
      description: panelText('从 DSH 顶层对话或轨迹页面切换到 Agent Fleet 团队面板。', 'Switch from a top-level DSH conversation or trace page to the Agent Fleet Team panel.'),
      target: fleetShellTabTarget,
      perform: async () => {
        const target = fleetShellTabTarget()
        if (target === null) throw new Error('Agent Fleet Team tab is not currently available')
        target.click()
        await waitForFleetPaint()
        return { view: 'fleet', open: true }
      },
    })
    return () => {
      disposeOpen()
      if (fleetJoyrideService === joyrideCtx.joyride) configureFleetJoyride(undefined)
    }
  })
  const modelDirectoryResolver = ctx.get?.('modelDirectories') as FleetModelDirectoryResolver | undefined
  fleetModelDirectoryResolver = modelDirectoryResolver
  configureFleetActivationSessions(
    (ctx.sessions ?? ctx.get?.('sessions')) as FleetActivationClientSessions | undefined,
  )
  configureFleetActivationWorkspaces(
    (ctx.workspaces ?? ctx.get?.('workspaces')) as FleetActivationClientWorkspaces | undefined,
  )
  configureFleetMetaAssistantClient(
    ctx.sessions ?? ctx.get?.('sessions') as FleetMetaClientSessions | undefined,
    ctx.workspaces ?? ctx.get?.('workspaces') as FleetMetaClientWorkspaces | undefined,
  )
  const remoteGateway = ctx.remote ?? ctx.get?.('remote') as FleetPanelClientContext['remote']
  if (remoteGateway === undefined) throw new Error('DSH Remote Gateway is unavailable')
  const disposeRemote = await remoteGateway.$mount(FLEET_WEB_REMOTE)
  const fleetWeb = ctx.get?.('remote.fleet') as FleetWebClient | undefined
  if (fleetWeb === undefined) {
    await disposeRemote()
    throw new Error('Fleet Web Remote did not mount its fleet namespace')
  }
  const disposeLocale = ctx.locale.register(FLEET_LOCALE_NAMESPACE, fleetLocaleDictionaries)
  configureFleetMetaAssistantLocale(ctx.locale)
  configureFleetWebClient(fleetWeb)
  let reportedLocale: string | undefined
  const reportLocale = (): void => {
    const locale = selectedFleetLocale()
    if (locale === reportedLocale) return
    reportedLocale = locale
    const request = fleetWeb.locale?.({ locale })
    void request?.catch(() => undefined)
  }
  reportLocale()
  const disposeLocaleReport = ctx.locale.subscribe(reportLocale)
  const injectedSource = ctx.get?.(FLEET_PANEL_SOURCE_SERVICE) as FleetPanelSource | undefined
  const liveSource = injectedSource ?? createFleetWebPanelSource(() => Promise.resolve(fleetWeb))
  const source = createFleetTutorialPanelSource(liveSource)
  configureFleetMetaAssistantTeams(source)
  new FleetWebPeerRemote(ctx as unknown as Context, liveSource)
  const disposePeerLocal = ctx.typert.register(FLEET_WEB_PEER_LOCAL)
  teamDirectorySource = source
  const nativeContext = createFleetNativeContext(ctx)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'fleet-meta-welcome',
    locale: FLEET_LOCALE_NAMESPACE,
  }, FleetMetaWelcomeNode))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'fleet',
    order: 20,
    label: () => panelText('团队', 'Team'),
    locale: 'conversation',
    children: {
      [FLEET_PANEL_SLOTS.tool]: { kind: 'list', scope: 'session' },
      [FLEET_PANEL_SLOTS.sidebar]: { kind: 'keyed', scope: 'session' },
      [FLEET_PANEL_SLOTS.sidebarSection]: { kind: 'list', scope: 'session' },
      [FLEET_PANEL_SLOTS.main]: { kind: 'keyed', scope: 'session' },
      [FLEET_PANEL_SLOTS.mainAction]: { kind: 'list', scope: 'session' },
      [FLEET_PANEL_SLOTS.composerAction]: { kind: 'list', scope: 'session' },
      [FLEET_PANEL_SLOTS.messageText]: { kind: 'keyed', scope: 'session' },
      [FLEET_PANEL_SLOTS.messageBlock]: { kind: 'keyed', scope: 'session' },
      [FLEET_PANEL_SLOTS.messageAction]: { kind: 'list', scope: 'session' },
      [FLEET_PANEL_SLOTS.resourcePreview]: { kind: 'keyed', scope: 'session' },
      [FLEET_PANEL_SLOTS.resourceDiff]: { kind: 'keyed', scope: 'session' },
    },
    inject: (sessionId: string) => ({
      sessionId,
      source,
      markdownRendererAvailable: ctx.get?.('markdownRenderer') !== undefined,
      nativeContext,
    }),
  }, FleetTeamPanel))

  ctx.inject<{ readonly markdownRenderer: FleetMarkdownRenderer }>(['markdownRenderer'], rendererCtx => {
    fleetMarkdownRenderer = rendererCtx.markdownRenderer
    rendererCtx.slots.inject(FLEET_PANEL_SLOTS.messageText, () => rendererCtx.slots.register({
      name: FLEET_PANEL_SLOTS.messageText,
      key: 'markdown',
      inject: () => ({ markdownRenderer: rendererCtx.markdownRenderer }),
    }, FleetRenderEngineMessageText))
    rendererCtx.slots.inject(FLEET_PANEL_SLOTS.resourcePreview, () => rendererCtx.slots.register({
      name: FLEET_PANEL_SLOTS.resourcePreview,
      key: 'text/markdown',
      inject: () => ({ markdownRenderer: rendererCtx.markdownRenderer }),
    }, FleetRenderEngineResourcePreview))
  })

  ctx.inject<{ readonly diffEngine: FleetDiffEngine; readonly diffRenderer: FleetDiffRenderer }>(
    ['diffEngine', 'diffRenderer'],
    rendererCtx => {
      rendererCtx.slots.inject(FLEET_PANEL_SLOTS.resourceDiff, () => rendererCtx.slots.register({
        name: FLEET_PANEL_SLOTS.resourceDiff,
        key: 'text',
        inject: () => ({ diffEngine: rendererCtx.diffEngine, diffRenderer: rendererCtx.diffRenderer }),
      }, FleetRenderEngineResourceDiff))
    },
  )

  const tools: readonly [string, number, ComponentType<FleetPanelToolOwner>][] = [
    ['chat', 0, ChatTool],
    ['team', 10, TeamTool],
    ['agent', 20, AgentTool],
    ['resources', 30, ResourcesTool],
    ['activity', 40, ActivityTool],
  ]
  for (const [id, order, component] of tools) {
    ctx.slots.inject(FLEET_PANEL_SLOTS.tool, () => ctx.slots.register({ name: FLEET_PANEL_SLOTS.tool, id, order }, component))
  }

  const sidebars: readonly [string, ComponentType<any>][] = [
    ['home', HomeSidebar],
    ['chat', ChatSidebar],
    ['team', TeamSidebar],
    ['agent', AgentSidebar],
    ['resources', ResourcesSidebar],
    ['activity', ActivitySidebar],
  ]
  const mainViews: readonly [string, ComponentType<any>][] = [
    ['home', HomeMain],
    ['chat', ChatMain],
    ['team', TeamMain],
    ['agent', AgentMain],
    ['resources', ResourcesMain],
    ['activity', ActivityMain],
  ]
  for (const [key, component] of sidebars) {
    ctx.slots.inject(FLEET_PANEL_SLOTS.sidebar, () => ctx.slots.register({ name: FLEET_PANEL_SLOTS.sidebar, key }, component))
  }
  for (const [key, component] of mainViews) {
    ctx.slots.inject(FLEET_PANEL_SLOTS.main, () => ctx.slots.register({ name: FLEET_PANEL_SLOTS.main, key }, component))
  }
  return async () => {
    configureFleetActivationSessions(undefined)
    configureFleetActivationWorkspaces(undefined)
    configureFleetMetaAssistantTeams(undefined)
    configureFleetMetaAssistantLocale(undefined)
    disposeLocaleReport()
    disposeLocale()
    disposeConfigurationModules?.()
    if (fleetModelDirectoryResolver === modelDirectoryResolver) fleetModelDirectoryResolver = undefined
    configureFleetWebClient(undefined)
    if (teamDirectorySource === source) teamDirectorySource = undefined
    if (injectedSource === undefined && 'dispose' in liveSource && typeof liveSource.dispose === 'function') liveSource.dispose()
    await disposePeerLocal()
    await disposeRemote()
  }
}
