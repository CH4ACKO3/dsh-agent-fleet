import type { ReactElement, ReactNode, CSSProperties, ChangeEvent, FocusEvent, KeyboardEvent, PointerEvent, MouseEvent as ReactMouseEvent } from 'react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import type { HoverHintTriggerProps } from 'dsh-hover-hint'
import {
  FleetChatAvatar,
  FleetChatComment,
  FleetChatMessage,
  FleetConversationHeader,
  FleetInfoHint,
  FleetPresenceLabel,
  fleetMemberPresence,
  fleetMemberPresenceLabel,
  fleetConversationAudienceLabel,
  FleetChatReadReceipt,
  type FleetChatContentBlock,
  type FleetChatMember,
  type FleetChatMentionBlock,
  type FleetChatResourceBlock,
  type FleetChatReceiptSource,
} from './runtime-chat.js'
import {
  FleetMemberPopover,
  FleetMemberStatusUpdatedAt,
  type FleetMemberPopoverProps,
  type FleetMemberPopoverTriggerProps,
} from './member-popover.js'
import { panelText, fleetPanelMemberIsOnline } from './panel-utils.js'
import { isChineseLocale } from './locale.js'
import { PanelMessageLog, PanelColumnResizeHandle, rememberBounded } from './panel-log.js'
import { PanelIcon } from './panel-icons.js'
import { FLEET_PANEL_SLOTS, operator, teamAgents, PanelUnavailable, groupFleetMessageThreads } from './team-panel.js'
import { updateFleetOperatorProfile } from './operator-profile.js'
import {
  operatorConversations,
  fleetPanelMemberRunControls,
  fleetPanelMentionMembers,
  fleetPanelMemberIsUnloaded,
  fleetPanelTeamRunControls,
  statusLabel,
  runtimeStateLabel,
  FleetRunControlButton,
  FleetPlainMessageText,
  EMPTY_UNSUBSCRIBE,
  NativeChatView,
  nativeChatRuntime,
  useNativeChatStore,
  nativeChatScroll,
  releaseFleetNativeSessionWindow,
  boundFleetNativeSessionWindow,
  loadFleetNativeContextTarget,
  centerFleetContextTarget,
  expandFleetTargetFold,
  nativeContextNodeCount,
  parseAgentViewItem,
  agentConversationPeer,
  FleetOfficialConversationComposer,
  EndTeamDialog,
  MemberRequestConfiguration,
  MemberAuthorizationPanel,
  SectionTitle,
  ListRow,
  type FleetSnapshotSelectorHook,
  type FleetNativeContext,
  type FleetNativeSessionFace,
  type FleetPanelPaneOwner,
  type FleetPanelHomeOwner,
  type FleetPanelMessageOwner,
  type FleetPanelMessageBlockOwner,
  type FleetPanelMessageTextOwner,
  type FleetPanelConversation,
  type FleetPanelMember,
  type FleetPanelTeamSnapshot,
  type FleetPanelResource,
  type FleetPanelResourceContent,
  type FleetPanelResourceRevision,
  type FleetPanelResourceRevisionSummary,
  type FleetPanelResourcePreviewOwner,
  type FleetPanelMessage,
  type FleetPanelMessageThread,
  type FleetPanelMemberTrace,
  type FleetPanelMemberTraceEvent,
  type FleetPanelMemberControlInput,
} from './team-panel.js'

export function renderMessageBlockExtension(
  owner: FleetPanelPaneOwner,
  blockOwner: FleetPanelMessageBlockOwner,
): ReactNode | undefined {
  if (!blockOwner.block.type.startsWith('extension:')) return undefined
  const rendered = owner.renderPanelSlot(
    FLEET_PANEL_SLOTS.messageBlock,
    blockOwner as unknown as Record<string, unknown>,
    {
      entryKey: blockOwner.block.type,
      fallback: jsx('div', {
        className: 'dsh-fleet-chat-content-resource-meta',
        children: panelText('此消息需要对应的扩展来显示', 'This message requires an extension to display'),
      }),
    },
  )
  if (rendered === null || rendered === undefined || rendered === false) return undefined
  if (Array.isArray(rendered) && rendered.length === 0) return undefined
  return rendered
}

export function renderMessageText(
  owner: FleetPanelPaneOwner,
  messageOwner: FleetPanelMessageOwner,
  text: string,
): ReactNode {
  const textOwner: FleetPanelMessageTextOwner = { ...messageOwner, text }
  return owner.renderPanelSlot(
    FLEET_PANEL_SLOTS.messageText,
    textOwner as unknown as Record<string, unknown>,
    {
      entryKey: 'markdown',
      fallback: jsx(FleetPlainMessageText, {
        text,
        members: teamAgents(owner.snapshot),
        showMemberDetails: owner.showMemberDetails,
        showMemberContext: owner.showMemberContext,
      }),
    },
  )
}

export function renderMemberMention(owner: FleetPanelPaneOwner, mention: FleetChatMentionBlock): ReactNode | undefined {
  const member = teamAgents(owner.snapshot).find(candidate => candidate.id === mention.memberId)
  if (member === undefined) return undefined
  return jsx(FleetMemberMentionPopover, {
    member,
    label: `@${mention.label}`,
    showDetails: owner.showMemberDetails,
    showContext: owner.showMemberContext,
  })
}

export function messageReadReceipt(
  snapshot: FleetPanelTeamSnapshot,
  receipt: NonNullable<FleetPanelMessage['receipt']>,
  showDetails: (memberId: string) => void,
  showContext: (memberId: string) => void,
  openSource: (source: FleetChatReceiptSource) => void,
) {
  const members = new Map(teamAgents(snapshot).map(member => [member.id, member]))
  members.set(operator.id, operator)
  return {
    readMembers: receipt.readMemberIds.flatMap(id => {
      const member = members.get(id)
      return member === undefined ? [] : [member]
    }),
    ...(receipt.deliveredMemberIds === undefined && receipt.pendingMemberIds === undefined
      ? {
          unreadMembers: receipt.unreadMemberIds.flatMap(id => {
            const member = members.get(id)
            return member === undefined ? [] : [member]
          }),
        }
      : {
          deliveredMembers: (receipt.deliveredMemberIds ?? []).flatMap(id => {
            const member = members.get(id)
            return member === undefined ? [] : [member]
          }),
          pendingDeliveries: (receipt.pendingMemberIds ?? []).flatMap(id => {
            const member = members.get(id)
            if (member === undefined) return []
            const blocker = receipt.pendingDeliveries?.find(candidate => candidate.memberId === id)
            return [{ member, ...blocker }]
          }),
        }),
    sources: receipt.sources ?? [],
    onOpenSource: openSource,
    renderMember: (member: FleetChatMember) => {
      const panelMember = members.get(member.id)
      return panelMember === undefined
        ? undefined
        : jsx(FleetReceiptMemberPopover, { member: panelMember, showDetails, showContext })
    },
  }
}

export function useConversationHistory(
  owner: FleetPanelPaneOwner,
  conversationId: string,
  recent: readonly FleetPanelMessage[],
): {
  readonly messages: readonly FleetPanelMessage[]
  readonly hasOlder: boolean
  readonly loadingOlder: boolean
  readonly loadOlder: () => Promise<void>
} {
  const key = `${owner.snapshot.teamId}:${conversationId}`
  const initialBefore = recent.flatMap(message => message.sequence === undefined ? [] : [message.sequence])
    .reduce((minimum, sequence) => Math.min(minimum, sequence), Number.MAX_SAFE_INTEGER)
  const [history, setHistory] = useState<{
    readonly key: string
    readonly messages: readonly FleetPanelMessage[]
    readonly before: number
    readonly hasMore: boolean
    readonly loading: boolean
  }>(() => ({
    key,
    messages: [],
    before: initialBefore,
    hasMore: owner.loadConversationMessages !== undefined,
    loading: false,
  }))
  const loading = useRef(false)
  const current = history.key === key ? history : {
    key,
    messages: [],
    before: initialBefore,
    hasMore: owner.loadConversationMessages !== undefined,
    loading: false,
  }

  useEffect(() => {
    loading.current = false
    setHistory({
      key,
      messages: [],
      before: initialBefore,
      hasMore: owner.loadConversationMessages !== undefined,
      loading: false,
    })
  }, [conversationId, initialBefore, key, owner.loadConversationMessages])

  const loadOlder = async (): Promise<void> => {
    const load = owner.loadConversationMessages
    if (load === undefined || !current.hasMore || loading.current) return
    loading.current = true
    setHistory(value => value.key === key ? { ...value, loading: true } : value)
    try {
      const page = await load(owner.snapshot.teamId, conversationId, current.before)
      setHistory(value => {
        if (value.key !== key) return value
        const seen = new Set<string>()
        const messages = [...page.messages, ...value.messages].filter(message => {
          if (seen.has(message.id)) return false
          seen.add(message.id)
          return true
        })
        return {
          key,
          messages,
          before: page.previousSequence ?? value.before,
          hasMore: page.hasMore && page.previousSequence !== undefined,
          loading: false,
        }
      })
    } catch {
      setHistory(value => value.key === key ? { ...value, hasMore: false, loading: false } : value)
    } finally {
      loading.current = false
      setHistory(value => value.key === key ? { ...value, loading: false } : value)
    }
  }
  const seen = new Set<string>()
  const messages = [...current.messages, ...recent].filter(message => {
    if (seen.has(message.id)) return false
    seen.add(message.id)
    return true
  }).toSorted((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER))
  return { messages, hasOlder: current.hasMore, loadingOlder: current.loading, loadOlder }
}

export function MemberState({ member, showDot = true }: {
  readonly member: FleetPanelMember
  readonly showDot?: boolean
}): ReactElement {
  const presence = fleetMemberPresence(member)
  return jsxs('span', {
    className: 'dsh-fleet-panel-member-state',
    'data-presence': presence,
    children: [
      showDot && jsx('span', { className: 'dsh-fleet-panel-presence', 'data-presence': presence }),
      jsx(FleetPresenceLabel, { presence, label: fleetMemberPresenceLabel(member) }),
    ],
  })
}

export function AgentPerspectiveMeta({ member }: { readonly member: FleetPanelMember }): ReactElement {
  return jsxs('span', {
    className: 'dsh-fleet-panel-agent-view-meta',
    children: [
      jsx('span', { className: 'dsh-fleet-panel-agent-view-role', children: member.role }),
      jsx('span', { className: 'dsh-fleet-panel-agent-view-separator', 'aria-hidden': 'true', children: '·' }),
      jsx('span', { children: panelText('内部视角', 'Internal view') }),
      jsx('span', { className: 'dsh-fleet-panel-agent-view-separator', 'aria-hidden': 'true', children: '·' }),
      jsx(MemberState, { member, showDot: false }),
    ],
  })
}

export function FleetMemberListRow({ member, owner }: {
  readonly member: FleetPanelMember
  readonly owner: FleetPanelPaneOwner
}): ReactElement {
  return jsx(FleetMemberPopover, {
    member,
    mode: 'hover',
    placement: 'right',
    className: 'dsh-fleet-panel-member-list-anchor',
    showStatusText: true,
    showDetails: owner.showMemberDetails,
    showContext: owner.showMemberContext,
    trigger: (interaction: FleetMemberPopoverTriggerProps) => jsx(ListRow, {
        selected: owner.activeItem === member.id,
        title: member.name,
        caption: member.role,
        leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx('span', {
          className: 'dsh-fleet-panel-presence',
          'data-presence': fleetMemberPresence(member),
        }) }),
        trailing: jsx(MemberState, { member, showDot: false }),
        interaction: {
          controls: interaction['aria-controls'],
          expanded: interaction['aria-expanded'],
          onMouseEnter: interaction.onMouseEnter ?? (() => undefined),
          onFocus: interaction.onFocus ?? (() => undefined),
          onBlur: interaction.onBlur ?? (() => undefined),
        },
        onClick: () => { owner.selectItem(member.id) },
      }),
  })
}

export function FleetMemberAvatarPopover({ member, showDetails, showContext, size = 34 }: {
  readonly member: FleetPanelMember
  readonly showDetails?: (memberId: string) => void
  readonly showContext?: (memberId: string) => void
  readonly size?: 24 | 34
}): ReactElement {
  return jsx(FleetMemberPopover, {
    member,
    className: size === 24
      ? 'dsh-fleet-panel-member-avatar-anchor dsh-fleet-panel-member-avatar-anchor-compact'
      : 'dsh-fleet-panel-member-avatar-anchor',
    showStatusText: member.operator !== true,
    ...(member.operator === true ? { editProfile: updateFleetOperatorProfile } : {}),
    ...(showDetails === undefined ? {} : { showDetails }),
    ...(showContext === undefined ? {} : { showContext }),
    trigger: (interaction: FleetMemberPopoverTriggerProps) => jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-member-avatar-trigger',
        'aria-label': member.operator === true
          ? panelText('查看或编辑你的资料', 'View or edit your profile')
          : panelText(`查看 ${member.name} 的成员信息`, `View member information for ${member.name}`),
        ...interaction,
        children: jsx(FleetChatAvatar, { member, size }),
      }),
  })
}

export function FleetReceiptMemberPopover({ member, showDetails, showContext }: {
  readonly member: FleetPanelMember
  readonly showDetails: (memberId: string) => void
  readonly showContext: (memberId: string) => void
}): ReactElement {
  return jsx(FleetMemberPopover, {
    member,
    className: 'dsh-fleet-panel-receipt-member-anchor',
    showStatusText: true,
    showDetails,
    showContext,
    trigger: (interaction: FleetMemberPopoverTriggerProps) => jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-message-receipt-member dsh-fleet-panel-receipt-member-trigger',
        'aria-label': panelText(`查看 ${member.name} 的成员信息`, `View member information for ${member.name}`),
        ...interaction,
        children: [
          jsx(FleetChatAvatar, { member, size: 28, showPresence: false }),
          jsxs('span', {
            className: 'dsh-fleet-message-receipt-member-copy',
            children: [
              jsx('span', { className: 'dsh-fleet-message-receipt-member-name', children: member.name }),
              jsx('span', { className: 'dsh-fleet-message-receipt-member-role', children: member.role }),
            ],
          }),
        ],
      }),
  })
}

export function FleetMemberMentionPopover({ member, label, showDetails, showContext }: {
  readonly member: FleetPanelMember
  readonly label: string
  readonly showDetails?: (memberId: string) => void
  readonly showContext?: (memberId: string) => void
}): ReactElement {
  return jsx(FleetMemberPopover, {
    member,
    as: 'span',
    showStatusText: true,
    ...(showDetails === undefined ? {} : { showDetails }),
    ...(showContext === undefined ? {} : { showContext }),
    trigger: (interaction: FleetMemberPopoverTriggerProps) => jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-member-mention',
        'aria-label': panelText(`${label}，查看 ${member.name} 的成员信息`, `${label}; view member information for ${member.name}`),
        'data-member-id': member.id,
        ...interaction,
        children: label,
      }),
  })
}

export function ChatMain(owner: FleetPanelPaneOwner): ReactElement {
  const conversation = operatorConversations(owner.snapshot).find(item => item.id === owner.activeItem)
  const recentMessages = conversation === undefined
    ? []
    : owner.snapshot.messages.filter(message => message.conversationId === conversation.id)
  const history = useConversationHistory(owner, conversation?.id ?? '', recentMessages)

  if (conversation === undefined) return jsx(PanelUnavailable, { label: panelText('请选择一个频道或成员', 'Choose a Channel or member') })
  const peer = conversation.peerId === undefined ? undefined : teamAgents(owner.snapshot).find(member => member.id === conversation.peerId)
  const teamMembers = teamAgents(owner.snapshot)
  const members = new Map(teamMembers.map(member => [member.id, member]))
  members.set(operator.id, operator)
  const channelMembers = conversation.kind !== 'channel'
    ? undefined
    : conversation.participantIds === undefined
      ? teamMembers
      : conversation.participantIds.flatMap(id => {
          const member = members.get(id)
          return member === undefined || member.operator === true ? [] : [member]
        })
  const onlineMembers = channelMembers?.filter(fleetPanelMemberIsOnline)
  const messages = history.messages
  return jsxs('section', {
    className: 'dsh-fleet-panel-chat',
    children: [
      jsx(FleetConversationHeader, {
        kind: conversation.kind,
        name: conversation.name,
        description: conversation.topic,
        memberCount: conversation.memberCount ?? owner.snapshot.members.length,
        activeCount: conversation.activeCount ?? owner.snapshot.members.filter(member =>
          fleetPanelMemberIsOnline(member),
        ).length,
        ...(channelMembers === undefined ? {} : {
          members: channelMembers,
          onlineMembers: onlineMembers ?? [],
          renderMember: (member: FleetChatMember) => {
            const panelMember = members.get(member.id)
            return panelMember === undefined
              ? undefined
              : jsx(FleetReceiptMemberPopover, {
                  member: panelMember,
                  showDetails: owner.showMemberDetails,
                  showContext: owner.showMemberContext,
                })
          },
        }),
        ...(peer === undefined ? {} : { peer }),
        actions: jsxs('div', {
          className: 'dsh-fleet-panel-main-actions',
          children: [
            jsx(NavigationToggle, { owner }),
            owner.renderPanelSlot(FLEET_PANEL_SLOTS.mainAction, owner as unknown as Record<string, unknown>),
          ],
        }),
      }),
      jsx(PanelMessageLog, {
        conversationKey: `${owner.snapshot.teamId}:chat:${conversation.id}`,
        messageCount: messages.length,
        resizable: true,
        hasOlder: history.hasOlder,
        loadingOlder: history.loadingOlder,
        loadOlder: history.loadOlder,
        children: jsx('div', {
          className: 'dsh-fleet-panel-chat-column',
          role: 'log',
          'aria-live': 'polite',
          'data-fleet-conversation-id': conversation.id,
          children: messages.length === 0
            ? jsx('div', { className: 'dsh-fleet-panel-empty', children: panelText('这里还没有消息', 'No messages here yet') })
            : groupFleetMessageThreads(messages).map(thread => jsx(FleetPanelChatThread, {
                owner,
                conversation,
                thread,
                members,
                selfId: operator.id,
              }, thread.message.id)),
        }),
      }),
      jsx(FleetOfficialConversationComposer, { owner, conversation }),
    ],
  })
}

export function FleetPanelChatThread({ owner, conversation, thread, members, selfId }: {
  readonly owner: FleetPanelPaneOwner
  readonly conversation: FleetPanelConversation
  readonly thread: FleetPanelMessageThread
  readonly members: ReadonlyMap<string, FleetPanelMember>
  readonly selfId: string
}): ReactElement | null {
  const message = thread.message
  const projectedSender = message.sender ?? members.get(message.senderId)
  const sender = projectedSender?.operator === true ? operator : projectedSender
  if (sender === undefined) return null
  const member = members.get(sender.id)
  const messageOwner: FleetPanelMessageOwner = { panel: owner, conversation, message, sender }
  const comments = thread.comments.flatMap(comment => {
    const projectedCommentSender = comment.sender ?? members.get(comment.senderId)
    const commentSender = projectedCommentSender?.operator === true ? operator : projectedCommentSender
    if (commentSender === undefined) return []
    const commentMember = members.get(commentSender.id)
    const commentOwner: FleetPanelMessageOwner = {
      panel: owner,
      conversation,
      message: comment,
      sender: commentSender,
    }
    return [jsx(FleetChatComment, {
      id: comment.id,
      sender: commentSender,
      sentAt: comment.sentAt,
      content: comment.content,
      ...(commentMember === undefined ? {} : {
        avatar: jsx(FleetMemberAvatarPopover, {
          member: commentMember,
          size: 24,
          ...(commentMember.operator === true ? {} : {
            showDetails: owner.showMemberDetails,
            showContext: owner.showMemberContext,
          }),
        }),
      }),
      ...(comment.receipt === undefined ? {} : {
        receipt: messageReadReceipt(
          owner.snapshot,
          comment.receipt,
          owner.showMemberDetails,
          owner.showMemberContext,
          owner.openMessageSource,
        ),
      }),
      actions: owner.renderPanelSlot(
        FLEET_PANEL_SLOTS.messageAction,
        commentOwner as unknown as Record<string, unknown>,
      ),
      renderText: (text: string) => renderMessageText(owner, commentOwner, text),
      renderMention: (mention: FleetChatMentionBlock) => renderMemberMention(owner, mention),
      onOpenResource: (resource: FleetChatResourceBlock) => { owner.openResource(resource.id) },
      renderBlock: (block: FleetChatContentBlock, index: number) => {
        const blockOwner: FleetPanelMessageBlockOwner = { ...commentOwner, block, index }
        return renderMessageBlockExtension(owner, blockOwner)
      },
    }, comment.id)]
  })
  return jsx('div', {
    className: 'dsh-fleet-panel-agent-message-row',
    'data-self': sender.id === selfId ? 'true' : 'false',
    'data-has-comments': comments.length > 0 ? 'true' : undefined,
    children: jsx(FleetChatMessage, {
      id: message.id,
      sender,
      sentAt: message.sentAt,
      content: message.content,
      ...(message.receipt === undefined ? {} : {
        receipt: messageReadReceipt(
          owner.snapshot,
          message.receipt,
          owner.showMemberDetails,
          owner.showMemberContext,
          owner.openMessageSource,
        ),
      }),
      ...(member === undefined ? {} : {
        avatar: jsx(FleetMemberAvatarPopover, {
          member,
          ...(member.operator === true ? {} : {
            showDetails: owner.showMemberDetails,
            showContext: owner.showMemberContext,
          }),
        }),
      }),
      actions: owner.renderPanelSlot(
        FLEET_PANEL_SLOTS.messageAction,
        messageOwner as unknown as Record<string, unknown>,
      ),
      renderText: (text: string) => renderMessageText(owner, messageOwner, text),
      renderMention: (mention: FleetChatMentionBlock) => renderMemberMention(owner, mention),
      onOpenResource: (resource: FleetChatResourceBlock) => { owner.openResource(resource.id) },
      renderBlock: (block: FleetChatContentBlock, index: number) => {
        const blockOwner: FleetPanelMessageBlockOwner = { ...messageOwner, block, index }
        return renderMessageBlockExtension(owner, blockOwner)
      },
      ...(comments.length === 0 ? {} : { comments, commentCount: comments.length }),
    }),
  })
}

export function DetailShell({ title, meta, actions, bodyClassName, owner, children }: {
  readonly title: string
  readonly meta?: ReactNode
  readonly actions?: ReactNode
  readonly bodyClassName?: string
  readonly owner: FleetPanelPaneOwner
  readonly children: ReactNode
}): ReactElement {
  return jsxs('section', {
    className: 'dsh-fleet-panel-detail',
    children: [
      jsxs('header', {
        className: 'dsh-fleet-panel-detail-head',
        children: [
          jsx('h2', { className: 'dsh-fleet-panel-detail-title', children: title }),
          meta !== undefined && jsx('span', { className: 'dsh-fleet-panel-detail-meta', children: meta }),
          jsx('div', {
            className: 'dsh-fleet-panel-main-actions',
            children: [
              actions,
              jsx(NavigationToggle, { owner }),
              owner.renderPanelSlot(FLEET_PANEL_SLOTS.mainAction, owner as unknown as Record<string, unknown>),
            ],
          }),
        ],
      }),
      jsx('div', { className: bodyClassName ?? 'dsh-fleet-panel-detail-scroll', children }),
    ],
  })
}

export function NavigationToggle({ owner }: { readonly owner: { readonly openNavigation: () => void } }): ReactElement {
  return jsx('button', {
    type: 'button',
    className: 'dsh-fleet-panel-navigation-toggle',
    'aria-label': panelText('打开团队导航', 'Open Team navigation'),
    title: panelText('打开团队导航', 'Open Team navigation'),
    onClick: owner.openNavigation,
    children: jsx(PanelIcon, { name: 'menu', size: 16 }),
  })
}

export function Fact({ label, value }: { readonly label: string; readonly value: ReactNode }): ReactElement {
  return jsxs('div', {
    className: 'dsh-fleet-panel-fact',
    children: [
      jsx('span', { className: 'dsh-fleet-panel-fact-label', children: label }),
      jsx('span', { className: 'dsh-fleet-panel-fact-value', children: value }),
    ],
  })
}

export function HomeMain(owner: FleetPanelHomeOwner): ReactElement {
  const [controlBusy, setControlBusy] = useState<{
    readonly teamId: string
    readonly action: 'load' | 'pause' | 'resume' | 'wake'
  }>()
  const [controlError, setControlError] = useState<{
    readonly teamId: string
    readonly message: string
  }>()
  const [endingTeam, setEndingTeam] = useState(false)
  const teams = owner.fleet.directory.teams
  const realTeams = teams.filter(team => team.tutorial !== true)
  const tutorialOnly = realTeams.length === 0 && teams.some(team => team.tutorial === true)
  const focusedTeam = teams.find(team => team.teamId === owner.focusedTeamId)
  if (focusedTeam !== undefined) {
    const teamRunControls = fleetPanelTeamRunControls(focusedTeam)
    const memberStatuses = focusedTeam.memberStatuses ?? []
    const unloadedMembers = memberStatuses.filter(fleetPanelMemberIsUnloaded).length
    const pausedMembers = memberStatuses.filter(status => status === 'paused').length
    const loadedMembers = memberStatuses.length - unloadedMembers - pausedMembers
    const busyAction = controlBusy?.teamId === focusedTeam.teamId ? controlBusy.action : undefined
    const runControl = (action: 'load' | 'pause' | 'resume' | 'wake'): void => {
      if (owner.controlTeamById === undefined || controlBusy !== undefined) return
      setControlBusy({ teamId: focusedTeam.teamId, action })
      setControlError(undefined)
      void owner.controlTeamById(focusedTeam.teamId, action).catch((reason: unknown) => {
        setControlError({
          teamId: focusedTeam.teamId,
          message: reason instanceof Error
            ? reason.message
            : action === 'load'
              ? panelText('无法加载团队', 'Could not load the Team')
              : action === 'pause'
              ? panelText('无法暂停团队', 'Could not pause the Team')
              : action === 'resume'
                ? panelText('无法继续团队', 'Could not resume the Team')
                : panelText('无法唤醒团队', 'Could not wake the Team'),
        })
      }).finally(() => { setControlBusy(undefined) })
    }
    return jsxs('section', {
      className: 'dsh-fleet-panel-detail',
      children: [
        jsxs('header', {
          className: 'dsh-fleet-panel-detail-head',
          children: [
            jsx('h2', { className: 'dsh-fleet-panel-detail-title', children: focusedTeam.teamName }),
            jsx('span', {
              className: 'dsh-fleet-panel-detail-meta',
              children: focusedTeam.tutorial === true ? panelText('演示', 'Demo') : statusLabel(focusedTeam.status),
            }),
            jsxs('div', {
              className: 'dsh-fleet-panel-main-actions',
              children: [
                jsx(NavigationToggle, { owner }),
                owner.renderPanelSlot(FLEET_PANEL_SLOTS.mainAction, owner as unknown as Record<string, unknown>),
              ],
            }),
          ],
        }),
        jsx('div', {
          className: 'dsh-fleet-panel-detail-scroll',
          children: jsxs('div', {
            className: 'dsh-fleet-panel-overview',
            children: [
              jsx('h3', {
                className: 'dsh-fleet-panel-overview-title',
                children: focusedTeam.tutorial === true
                  ? panelText('这是一个一次性引导团队', 'This is a one-time guided Team')
                  : panelText('团队概况', 'Team overview'),
              }),
              jsx('p', {
                className: 'dsh-fleet-panel-overview-copy',
                children: focusedTeam.tutorial === true
                  ? panelText(
                      '它使用真实团队界面展示频道、成员与资源，但不会启动 Agent、消耗 Token 或写入工作区。创建第一个真实团队后，它会自动消失。',
                      'It uses the real Team interface to show channels, members, and resources without starting Agents, using tokens, or writing to a Workspace. It disappears after you create your first real Team.',
                    )
                  : panelText('查看团队当前状态与主要工作上下文。更多概况信息将在后续补充。', 'Review the Team’s current status and primary work context. More overview information will be added later.'),
              }),
              jsxs('div', {
                className: 'dsh-fleet-panel-facts',
                children: focusedTeam.tutorial === true
                  ? [
                      jsx(Fact, { label: panelText('数据类型', 'Data type'), value: panelText('只读演示投影', 'Read-only demo projection') }),
                      jsx(Fact, { label: panelText('模型调用', 'Model calls'), value: panelText('不会启动', 'None') }),
                      jsx(Fact, { label: panelText('工作区写入', 'Workspace writes'), value: panelText('无', 'None') }),
                    ]
                  : [
                      jsx(Fact, { label: panelText('运行状态', 'Run status'), value: statusLabel(focusedTeam.status) }),
                      focusedTeam.runtimeState !== undefined && jsx(Fact, {
                        label: panelText('运行时模式', 'Runtime mode'),
                        value: runtimeStateLabel(focusedTeam.runtimeState),
                      }),
                      jsx(Fact, {
                        label: panelText('成员运行时', 'Member runtime'),
                        value: panelText(
                          `${String(loadedMembers)} 已加载 · ${String(unloadedMembers)} 未加载 · ${String(pausedMembers)} 已暂停`,
                          `${String(loadedMembers)} loaded · ${String(unloadedMembers)} unloaded · ${String(pausedMembers)} paused`,
                        ),
                      }),
                      jsx(Fact, { label: panelText('未读消息', 'Unread messages'), value: `${focusedTeam.unread ?? 0}` }),
                      jsx(Fact, { label: panelText('主要工作区', 'Primary Workspace'), value: focusedTeam.primaryWorkspace ?? panelText('未挂载', 'Not mounted') }),
                    ],
              }),
              jsx('div', {
                className: 'dsh-fleet-panel-overview-actions',
                children: [
                  jsxs('button', {
                    type: 'button',
                    className: 'dsh-fleet-panel-enter-messages',
                    onClick: () => { owner.openTeamMessages(focusedTeam.teamId) },
                    children: [
                      jsx(PanelIcon, { name: 'chat', size: 15 }),
                      jsx('span', { children: panelText('进入团队消息', 'Open Team messages') }),
                    ],
                  }),
                  focusedTeam.tutorial !== true && owner.controlTeamById !== undefined
                    && teamRunControls.map(control => jsx(FleetRunControlButton, {
                      label: control.label,
                      displayLabel: busyAction === undefined
                        ? (controlBusy === undefined ? control.label : panelText('正在处理…', 'Working…'))
                        : (busyAction === control.action ? control.busyLabel : panelText('正在处理…', 'Working…')),
                      hint: control.title,
                      primary: control.action === 'load' || control.action === 'resume',
                      disabled: controlBusy !== undefined,
                      busy: busyAction === control.action,
                      onClick: () => { runControl(control.action) },
                    }, control.action)),
                  focusedTeam.tutorial !== true && owner.controlTeamById !== undefined && focusedTeam.status !== 'closed' && jsx('button', {
                    type: 'button',
                    className: 'dsh-fleet-panel-control-button',
                    'data-danger': 'true',
                    disabled: controlBusy !== undefined,
                    onClick: () => { setEndingTeam(true) },
                    children: panelText('终结团队', 'Finish Team'),
                  }),
                  controlError?.teamId === focusedTeam.teamId && jsx('span', {
                    className: 'dsh-fleet-panel-control-error',
                    role: 'alert',
                    children: controlError.message,
                  }),
                ],
              }),
              endingTeam && owner.controlTeamById !== undefined && jsx(EndTeamDialog, {
                teamName: focusedTeam.teamName,
                onClose: () => { setEndingTeam(false) },
                onConfirm: (summary: string) => owner.controlTeamById?.(focusedTeam.teamId, 'close', summary) ?? Promise.resolve(),
              }),
            ],
          }),
        }),
      ],
    })
  }
  const active = realTeams.filter(team => team.status === 'running' || team.status === 'starting' || team.status === 'finishing').length
  const attention = realTeams.filter(team => team.needsAttention === true).length
  const mounted = realTeams.filter(team => team.primaryWorkspace !== undefined).length
  return jsxs('section', {
    className: 'dsh-fleet-panel-detail',
    children: [
      jsxs('header', {
        className: 'dsh-fleet-panel-detail-head',
        children: [
          jsx('h2', { className: 'dsh-fleet-panel-detail-title', children: panelText('团队首页', 'Team home') }),
          jsx('span', {
            className: 'dsh-fleet-panel-detail-meta',
            children: tutorialOnly ? panelText('引导模式', 'Guided mode') : panelText(`${realTeams.length} 个团队`, `${realTeams.length} Teams`),
          }),
          jsxs('div', {
            className: 'dsh-fleet-panel-main-actions',
            children: [
              jsx(NavigationToggle, { owner }),
              owner.renderPanelSlot(FLEET_PANEL_SLOTS.mainAction, owner as unknown as Record<string, unknown>),
            ],
          }),
        ],
      }),
      jsx('div', {
        className: 'dsh-fleet-panel-detail-scroll',
        children: jsxs('div', {
          className: 'dsh-fleet-panel-overview',
          children: [
            jsx('h3', {
              className: 'dsh-fleet-panel-overview-title',
              children: tutorialOnly ? panelText('先看看团队如何工作', 'See how a Team works') : panelText('Fleet 团队', 'Fleet Teams'),
            }),
            jsx('p', {
              className: 'dsh-fleet-panel-overview-copy',
              children: tutorialOnly
                ? panelText(
                    '打开下面的临时团队，可以在不启动 Agent 的情况下查看频道、成员状态与共享资源。',
                    'Open the temporary Team below to explore channels, member status, and shared resources without starting Agents.',
                  )
                : panelText('Team 是独立持久实体。工作区作为可挂载的执行资源，不决定团队的归属。', 'Teams are independent persistent entities. Workspaces are mountable execution resources and do not determine Team ownership.'),
            }),
            jsxs('div', {
              className: 'dsh-fleet-panel-facts',
              children: [
                jsx(Fact, { label: panelText('活跃团队', 'Active Teams'), value: `${active}` }),
                jsx(Fact, { label: panelText('需要关注', 'Needs attention'), value: `${attention}` }),
                jsx(Fact, { label: panelText('已挂载工作区', 'Mounted Workspaces'), value: `${mounted} / ${realTeams.length}` }),
              ],
            }),
            jsxs('div', {
              className: 'dsh-fleet-panel-home-team-list',
              children: [
                jsx(SectionTitle, { children: panelText('所有团队', 'All Teams') }),
                ...teams.map(team => jsx(ListRow, {
                  selected: owner.focusedTeamId === team.teamId,
                  title: team.teamName,
                  caption: team.tutorial === true
                    ? panelText('一次性引导 · 不会启动 Agent', 'One-time guide · No Agents started')
                    : [statusLabel(team.status), team.primaryWorkspace === undefined
                      ? panelText('未挂载工作区', 'No Workspace mounted')
                      : panelText(`主要工作区 · ${team.primaryWorkspace}`, `Primary Workspace · ${team.primaryWorkspace}`)].join(' · '),
                  leading: jsx('span', { className: 'dsh-fleet-panel-team-row-status', 'data-status': team.status }),
                  trailing: team.needsAttention === true ? jsx('span', { className: 'dsh-fleet-panel-attention', title: panelText('需要关注', 'Needs attention') }) : undefined,
                  onClick: () => { owner.selectTeam(team.teamId) },
                }, team.teamId)),
              ],
            }),
          ],
        }),
      }),
    ],
  })
}

export function TeamMain(owner: FleetPanelPaneOwner): ReactElement {
  const [controlBusy, setControlBusy] = useState<'load' | 'pause' | 'resume' | 'wake'>()
  const [controlError, setControlError] = useState<string>()
  const member = teamAgents(owner.snapshot).find(item => item.id === owner.activeItem)
  if (member === undefined) return jsx(PanelUnavailable, { label: panelText('请选择一位成员', 'Choose a member') })
  const assistant = owner.snapshot.assistants?.some(item => item.id === member.id) === true
  const memberRunControls = fleetPanelMemberRunControls(member, assistant, owner.snapshot.status)
  const controlMember = (action: FleetPanelMemberControlInput['action']): void => {
    if (owner.controlMember === undefined || controlBusy !== undefined) return
    setControlBusy(action)
    setControlError(undefined)
    void owner.controlMember(member.id, action).catch((reason: unknown) => {
      setControlError(reason instanceof Error ? reason.message : panelText(
        action === 'pause' ? (assistant ? '无法打断助理' : '无法暂停成员')
          : action === 'resume' ? '无法继续成员' : '无法唤醒成员',
        action === 'pause' ? (assistant ? 'Could not interrupt the assistant' : 'Could not pause the member')
          : action === 'resume' ? 'Could not resume the member' : 'Could not wake the member',
      ))
    }).finally(() => { setControlBusy(undefined) })
  }
  return jsx(DetailShell, {
    title: member.name,
    meta: member.role,
    owner,
    children: jsxs('div', {
      className: 'dsh-fleet-panel-overview',
      children: [
        jsxs('h3', {
          className: 'dsh-fleet-panel-overview-title dsh-fleet-panel-member-heading',
          children: [
            jsx('span', { children: member.name }),
            jsx('span', { className: 'dsh-fleet-panel-member-heading-role', children: member.role }),
          ],
        }),
        jsx('p', { className: 'dsh-fleet-panel-overview-copy', children: member.responsibility }),
        jsxs('div', {
          className: 'dsh-fleet-panel-facts',
          children: [
            jsx(Fact, { label: panelText('当前状态', 'Current status'), value: jsx(MemberState, { member }) }),
            jsx(Fact, {
              label: panelText('成员自述', 'Member update'),
              value: jsxs('span', {
                className: 'dsh-fleet-panel-member-self-status-detail',
                children: [
                  jsx('span', { children: member.statusText ?? panelText('暂未填写工作状态', 'No work update yet') }),
                  jsx(FleetMemberStatusUpdatedAt, { member }),
                ],
              }),
            }),
            jsx(Fact, { label: panelText('使用模型', 'Model'), value: member.model ?? panelText('由 Agent 配置决定', 'Determined by Agent configuration') }),
            jsx(Fact, { label: panelText('模型提供方', 'Model provider'), value: member.provider ?? panelText('由 Agent 配置决定', 'Determined by Agent configuration') }),
            jsx(Fact, { label: panelText('成员标识', 'Member id'), value: member.id }),
            jsx(Fact, { label: panelText('身份边界', 'Identity boundary'), value: assistant ? panelText('Fleet 团队助理', 'Fleet Team assistant') : panelText('Fleet 团队成员', 'Fleet Team member') }),
          ],
        }),
        owner.controlMember !== undefined && jsxs('div', {
          className: 'dsh-fleet-panel-overview-actions',
          children: [
            ...memberRunControls.map(control => jsx(FleetRunControlButton, {
              label: control.label,
              displayLabel: controlBusy === undefined
                ? control.label
                : (controlBusy === control.action ? control.busyLabel : panelText('正在处理…', 'Working…')),
              hint: control.title,
              ...(control.primary === undefined ? {} : { primary: control.primary }),
              disabled: controlBusy !== undefined,
              busy: controlBusy === control.action,
              onClick: () => { controlMember(control.action) },
            }, control.action)),
            controlError !== undefined && jsx('span', {
              className: 'dsh-fleet-panel-control-error',
              role: 'alert',
              children: controlError,
            }),
          ],
        }),
        jsx(MemberRequestConfiguration, { owner, member, assistant }),
        jsx(MemberAuthorizationPanel, { owner, member }),
      ],
    }),
  })
}

export function FleetNativeMemberChat({ owner, session, sessionId, source }: {
  readonly owner: FleetPanelPaneOwner
  readonly session: FleetNativeSessionFace
  readonly sessionId: string
  readonly source?: FleetChatReceiptSource
}): ReactElement {
  const scrollKey = `${owner.snapshot.teamId}:${sessionId}`
  const root = useRef<HTMLDivElement>(null)
  const [target, setTarget] = useState<
    | { readonly status: 'idle' | 'loading' | 'missing' }
    | { readonly status: 'found'; readonly key: string }
  >({ status: source === undefined ? 'idle' : 'loading' })
  const nativeCurrentRef = useRef(false)
  nativeCurrentRef.current = owner.useSessions(state => state.current === sessionId)
  useEffect(() => {
    // DSH lazily opens history only for the foreground Session. Fleet renders a
    // different listed Session in-place, so explicitly open its idempotent
    // history window before reusing the native ChatView.
    void session.open?.()
    return () => {
      nativeChatScroll.delete(scrollKey)
      if (!nativeCurrentRef.current) releaseFleetNativeSessionWindow(session)
    }
  }, [scrollKey, session])
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session])
  const getSnapshot = useCallback(() => session.getSnapshot(), [session])
  const useMemberSession: FleetSnapshotSelectorHook = selector => {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    useEffect(() => {
      if (source === undefined) boundFleetNativeSessionWindow(session, snapshot)
    }, [session, snapshot, source])
    return selector(snapshot)
  }
  useEffect(() => {
    if (source === undefined) {
      setTarget({ status: 'idle' })
      return
    }
    let disposed = false
    setTarget({ status: 'loading' })
    void loadFleetNativeContextTarget(session, source.contextMessageId).then(key => {
      if (!disposed) setTarget(key === undefined ? { status: 'missing' } : { status: 'found', key })
    }).catch(() => {
      if (!disposed) setTarget({ status: 'missing' })
    })
    return () => { disposed = true }
  }, [session, source?.contextMessageId])
  useLayoutEffect(() => {
    if (target.status !== 'found') return
    let row: HTMLElement | undefined
    let locationObserver: MutationObserver | undefined
    let resizeObserver: ResizeObserver | undefined
    let centerFrame: number | undefined
    const clearSelection = (): void => { setTarget({ status: 'idle' }) }
    const scheduleCenter = (scrollport: HTMLElement, targetRow: HTMLElement): void => {
      if (centerFrame !== undefined) window.cancelAnimationFrame(centerFrame)
      centerFrame = window.requestAnimationFrame(() => {
        centerFrame = undefined
        centerFleetContextTarget(scrollport, targetRow)
      })
    }
    const frame = window.requestAnimationFrame(() => {
      const container = root.current
      if (container === null) return
      const locateTarget = (): void => {
        expandFleetTargetFold(container, target.key)
        for (const candidate of container.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
          if (candidate.dataset.chatAnchorKey !== target.key) continue
          row = candidate
          row.dataset.fleetContextTarget = 'true'
          locationObserver?.disconnect()
          locationObserver = undefined
          const scrollport = container.querySelector<HTMLElement>('.dsh-fleet-panel-native-context-scroll')
          if (scrollport !== null) {
            centerFleetContextTarget(scrollport, row)
            if (typeof ResizeObserver !== 'undefined') {
              resizeObserver = new ResizeObserver(() => { scheduleCenter(scrollport, row!) })
              resizeObserver.observe(scrollport)
              resizeObserver.observe(row)
              const content = scrollport.firstElementChild
              if (content instanceof HTMLElement) resizeObserver.observe(content)
            }
          }
          document.addEventListener('pointerdown', clearSelection, { capture: true, once: true })
          return
        }
      }
      if (typeof MutationObserver !== 'undefined') {
        locationObserver = new MutationObserver(locateTarget)
        locationObserver.observe(container, {
          attributes: true,
          attributeFilter: ['aria-expanded'],
          childList: true,
          subtree: true,
        })
      }
      locateTarget()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (centerFrame !== undefined) window.cancelAnimationFrame(centerFrame)
      locationObserver?.disconnect()
      resizeObserver?.disconnect()
      document.removeEventListener('pointerdown', clearSelection, { capture: true })
      delete row?.dataset.fleetContextTarget
    }
  }, [target])
  const ChatView = NativeChatView
  const runtime = nativeChatRuntime
  if (ChatView === undefined || runtime === undefined) {
    return jsx(PanelUnavailable, { label: panelText('正在载入原生 ChatView…', 'Loading native ChatView…') })
  }
  return jsx('div', {
    ref: root,
    className: 'dsh-fleet-panel-native-context',
    children: [
      jsx('div', {
        className: 'dsh-fleet-panel-native-context-scroll',
        'data-conversation-scroll': '',
        children: jsx(ChatView, {
          useSession: useMemberSession,
          useSessions: runtime.useSessions,
          useStore: runtime.useStore ?? useNativeChatStore,
          renderSlot: runtime.renderSlot,
          sessionId,
          openFile: (path: string) => owner.nativeContext.openFile(sessionId, path),
          loadOlder: () => { void session.loadOlder() },
          loadImage: (attachment: unknown) => owner.nativeContext.loadImage(sessionId, attachment),
          inspectCall: () => {},
          chatScroll: {
            save: (position: unknown) => {
              if (position === null) nativeChatScroll.delete(scrollKey)
              else rememberBounded(nativeChatScroll, scrollKey, position)
            },
            read: () => nativeChatScroll.get(scrollKey) ?? null,
          },
          forkAt: () => {},
          fileMentions: (value: unknown) => owner.nativeContext.fileMentions(value),
          t: runtime.t ?? owner.t,
        }),
      }),
      (target.status === 'loading' || target.status === 'missing') && jsx('div', {
        className: 'dsh-fleet-panel-native-context-locate',
        role: 'status',
        children: target.status === 'loading'
          ? panelText('正在加载消息位置…', 'Loading message position…')
          : panelText('未能在已加载范围内精确定位，现已显示原生上下文', 'The exact position was not found in the loaded range; showing the native context'),
      }),
    ],
  })
}

export function traceMessageText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.flatMap(item => {
    if (typeof item === 'string') return [item]
    if (typeof item !== 'object' || item === null) return []
    const block = item as Readonly<Record<string, unknown>>
    return typeof block.text === 'string' ? [block.text] : []
  }).join('\n')
  if (typeof value !== 'object' || value === null) return ''
  const record = value as Readonly<Record<string, unknown>>
  return traceMessageText(record.content)
}

export function clipTraceText(value: string): string {
  return value.length <= 8_000 ? value : `${value.slice(0, 8_000)}\n…`
}

export function traceEventPresentation(event: FleetPanelMemberTraceEvent): {
  readonly label: string
  readonly text: string
  readonly agent: boolean
} {
  let payload: unknown = event.data
  try {
    payload = JSON.parse(event.data) as unknown
  } catch {}
  const data = typeof payload === 'object' && payload !== null
    ? payload as Readonly<Record<string, unknown>>
    : {}
  const message = typeof data.message === 'object' && data.message !== null ? data.message : data
  if (event.type === 'session.user/message') {
    return { label: panelText('进入 Agent 上下文', 'Entered Agent context'), text: clipTraceText(traceMessageText(message)) || panelText('收到一条上下文消息', 'Received a context message'), agent: false }
  }
  if (event.type === 'session.assistant/message') {
    return { label: 'Agent', text: clipTraceText(traceMessageText(message)) || panelText('完成了一次模型响应', 'Completed a model response'), agent: true }
  }
  if (event.type === 'session.tool/call') {
    const name = typeof data.name === 'string' ? data.name : panelText('工具', 'Tool')
    const args = typeof data.arguments === 'string' ? data.arguments : ''
    return { label: panelText('工具调用', 'Tool call'), text: clipTraceText(args === '' ? name : `${name}\n${args}`), agent: true }
  }
  if (event.type === 'session.tool/result') {
    return { label: panelText('工具结果', 'Tool result'), text: clipTraceText(traceMessageText(message)) || panelText('工具已返回结果', 'The tool returned a result'), agent: true }
  }
  if (event.type === 'session.turn/end') {
    const reason = typeof data.reason === 'object' && data.reason !== null
      ? JSON.stringify(data.reason)
      : panelText('回合结束', 'Turn ended')
    return { label: panelText('运行状态', 'Run status'), text: reason, agent: true }
  }
  const readable = JSON.stringify(payload, null, 2)
  return {
    label: event.type.replace(/^session\./u, '').replaceAll('/', ' · '),
    text: readable === undefined || readable === '{}' ? panelText('状态已更新', 'Status updated') : clipTraceText(readable),
    agent: event.type !== 'session.user/message',
  }
}

export function FleetPersistedMemberTrace({ owner, member, source }: {
  readonly owner: FleetPanelPaneOwner
  readonly member: FleetPanelMember
  readonly source?: FleetChatReceiptSource
}): ReactElement {
  const [attempt, setAttempt] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [targetVisible, setTargetVisible] = useState(source !== undefined)
  const traceRoot = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly trace: FleetPanelMemberTrace }
    | { readonly status: 'error'; readonly message: string }
  >({ status: 'loading' })

  useEffect(() => {
    setTargetVisible(source !== undefined)
  }, [source?.contextMessageId, source?.sessionId])

  useLayoutEffect(() => {
    if (state.status !== 'ready' || source === undefined || !targetVisible) return
    let target: HTMLElement | null = null
    let resizeObserver: ResizeObserver | undefined
    let centerFrame: number | undefined
    const clearSelection = (): void => { setTargetVisible(false) }
    const scheduleCenter = (scrollport: HTMLElement, targetRow: HTMLElement): void => {
      if (centerFrame !== undefined) window.cancelAnimationFrame(centerFrame)
      centerFrame = window.requestAnimationFrame(() => {
        centerFrame = undefined
        centerFleetContextTarget(scrollport, targetRow)
      })
    }
    const frame = window.requestAnimationFrame(() => {
      const scrollport = traceRoot.current
      if (scrollport === null) return
      target = scrollport.querySelector<HTMLElement>('[data-target="true"]')
      if (target === null) return
      centerFleetContextTarget(scrollport, target)
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => { scheduleCenter(scrollport, target!) })
        resizeObserver.observe(scrollport)
        resizeObserver.observe(target)
        const content = scrollport.firstElementChild
        if (content instanceof HTMLElement) resizeObserver.observe(content)
      }
      document.addEventListener('pointerdown', clearSelection, { capture: true, once: true })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      if (centerFrame !== undefined) window.cancelAnimationFrame(centerFrame)
      resizeObserver?.disconnect()
      document.removeEventListener('pointerdown', clearSelection, { capture: true })
    }
  }, [source, state, targetVisible])

  useEffect(() => {
    const load = owner.loadMemberTrace
    if (load === undefined) {
      setState({ status: 'error', message: panelText('持久轨迹接口尚不可用', 'Persistent trace API is unavailable') })
      return
    }
    const controller = new AbortController()
    setState(current => current.status === 'ready' ? current : { status: 'loading' })
    void load(owner.snapshot.teamId, member.id, controller.signal, source === undefined ? undefined : { source }).then(trace => {
      if (!controller.signal.aborted) setState({ status: 'ready', trace })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ status: 'error', message: error instanceof Error ? error.message : panelText('无法读取 Agent 持久轨迹', 'Agent persistent trace could not be loaded') })
      }
    })
    return () => { controller.abort(new Error('Agent trace view changed')) }
  }, [attempt, member.id, owner.loadMemberTrace, owner.snapshot.teamId, source?.contextMessageId, source?.sessionId])

  useEffect(() => {
    if (expanded || source !== undefined || owner.subscribeMemberTrace === undefined) return
    return owner.subscribeMemberTrace(owner.snapshot.teamId, member.id, () => {
      setAttempt(current => current + 1)
    })
  }, [expanded, member.id, owner.snapshot.teamId, owner.subscribeMemberTrace, source])

  const loadOlder = (): void => {
    if (state.status !== 'ready' || state.trace.previous === undefined || owner.loadMemberTrace === undefined || loadingOlder) return
    setLoadingOlder(true)
    void owner.loadMemberTrace(owner.snapshot.teamId, member.id, undefined, {
      cursor: state.trace.previous,
    }).then(previous => {
      setExpanded(true)
      setState(current => {
        if (current.status !== 'ready') return current
        const seen = new Set<string>()
        const events = [...previous.events, ...current.trace.events].filter(event => {
          const key = `${event.sessionId ?? ''}:${String(event.sequence)}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        return {
          status: 'ready',
          trace: {
            events,
            truncated: previous.truncated,
            ...(previous.previous === undefined ? {} : { previous: previous.previous }),
          },
        }
      })
    }).finally(() => { setLoadingOlder(false) })
  }
  if (state.status !== 'ready') {
    return jsxs('div', {
      className: 'dsh-fleet-panel-trace-state',
      role: state.status === 'error' ? 'alert' : 'status',
      children: [
        jsx('span', { children: state.status === 'loading' ? panelText('正在读取持久执行上下文…', 'Loading persistent execution context…') : state.message }),
        state.status === 'error' && jsx('button', {
          type: 'button',
          className: 'dsh-fleet-panel-trace-retry',
          onClick: () => { setAttempt(current => current + 1) },
          children: panelText('重试', 'Retry'),
        }),
      ],
    })
  }
  return jsxs('div', {
    ref: traceRoot,
    className: 'dsh-fleet-panel-trace',
    children: [
      jsx('p', {
        className: 'dsh-fleet-panel-trace-note',
        children: source !== undefined
          ? panelText('以下为这条团队消息进入该 Agent 上下文时的实际位置。', 'This is the actual location where the Team message entered this Agent’s context.')
          : state.trace.truncated
          ? panelText('当前成员不在线；以下为持久轨迹中最近的执行上下文。较早记录仍保存在 Fleet 中。', 'This member is offline. The latest execution context from the persistent trace is shown below; earlier records remain in Fleet.')
          : panelText('当前成员不在线；以下内容来自 Fleet 持久轨迹。', 'This member is offline. The content below comes from the Fleet persistent trace.'),
      }),
      source === undefined && state.trace.previous !== undefined && jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-trace-retry',
        disabled: loadingOlder,
        onClick: loadOlder,
        children: loadingOlder ? panelText('正在加载更早记录…', 'Loading earlier records…') : panelText('加载更早记录', 'Load earlier records'),
      }),
      jsx('div', {
        className: 'dsh-fleet-panel-trace-list',
        role: 'log',
        'aria-label': panelText(`${member.name} 的持久执行上下文`, `Persistent execution context for ${member.name}`),
        children: state.trace.events.length === 0
          ? jsx('div', { className: 'dsh-fleet-panel-empty', children: panelText('这个 Agent 还没有持久执行记录', 'This Agent has no persistent execution records yet') })
          : state.trace.events.map(event => {
              const presentation = traceEventPresentation(event)
              return jsxs('article', {
                className: 'dsh-fleet-panel-trace-event',
                'data-agent': presentation.agent ? 'true' : 'false',
                'data-target': event.target && targetVisible ? 'true' : undefined,
                children: [
                  jsxs('div', {
                    className: 'dsh-fleet-panel-trace-event-meta',
                    children: [
                      jsx('span', { children: presentation.label }),
                      event.target && targetVisible && jsx('span', {
                        className: 'dsh-fleet-panel-trace-target-label',
                        children: panelText('\u6d88\u606f\u4f4d\u7f6e', 'Message location'),
                      }),
                      jsx('time', {
                        className: 'dsh-fleet-panel-trace-event-time',
                        dateTime: event.createdAt,
                        children: new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      }),
                    ],
                  }),
                  jsx('div', { className: 'dsh-fleet-panel-trace-event-body', children: presentation.text }),
                ],
              }, `${event.sessionId ?? ''}:${String(event.sequence)}`)
            }),
      }),
    ],
  })
}

export function AgentContextMain({ owner, member }: {
  readonly owner: FleetPanelPaneOwner
  readonly member: FleetPanelMember
}): ReactElement {
  if (owner.snapshot.tutorial === true) {
    const source = owner.contextSource?.memberId === member.id ? owner.contextSource : undefined
    return jsxs('section', {
      className: 'dsh-fleet-panel-chat',
      children: [
        jsx(FleetConversationHeader, {
          kind: 'context',
          name: panelText('执行上下文', 'Execution context'),
          description: source === undefined
            ? panelText('回放一次真实团队运行中记录的 Agent 上下文', 'Replay Agent context recorded during a real Team run')
            : panelText('定位这条团队消息进入 Agent 上下文时的录制位置', 'Locate where this Team message entered the recorded Agent context'),
          peer: member,
          meta: jsx(AgentPerspectiveMeta, { member }),
          actions: jsx(NavigationToggle, { owner }),
        }),
        jsx(FleetPersistedMemberTrace, {
          owner,
          member,
          ...(source === undefined ? {} : { source }),
        }, `${owner.snapshot.teamId}:${member.id}:${source?.contextMessageId ?? ''}`),
        jsx('div', {
          className: 'dsh-fleet-panel-agent-readonly',
          role: 'status',
          children: source === undefined ? panelText(
            `以 ${member.name} 的视角回放真实记录 · 只读`,
            `Replaying a real recording from ${member.name}’s perspective · Read-only`,
          ) : panelText(
            `正在查看 ${member.name} 的录制消息来源 · 只读`,
            `Viewing the recorded message source for ${member.name} · Read-only`,
          ),
        }),
      ],
    })
  }
  const source = owner.contextSource?.memberId === member.id ? owner.contextSource : undefined
  const contextSessionId = source?.sessionId ?? member.sessionId
  const sessionListed = owner.useSessions(state => contextSessionId !== undefined && state.byId[contextSessionId] !== undefined)
  const session = contextSessionId === undefined || !sessionListed
    ? undefined
    : owner.nativeContext.session(contextSessionId)
  const subscribeSession = useCallback(
    (listener: () => void) => session?.subscribe(listener) ?? EMPTY_UNSUBSCRIBE,
    [session],
  )
  const getSessionSnapshot = useCallback(() => session?.getSnapshot() ?? null, [session])
  const sessionSnapshot = useSyncExternalStore(subscribeSession, getSessionSnapshot, getSessionSnapshot)
  useEffect(() => { void session?.open?.() }, [session])
  const assistant = owner.snapshot.assistants?.some(candidate => candidate.id === member.id) === true
  const emptyAssistantSession = assistant && session !== undefined && nativeContextNodeCount(sessionSnapshot) === 0
  const usePersistedTrace = session === undefined || contextSessionId === undefined || emptyAssistantSession
  return jsxs('section', {
    className: 'dsh-fleet-panel-chat',
    children: [
      jsx(FleetConversationHeader, {
        kind: 'context',
        name: panelText('执行上下文', 'Execution context'),
        description: source !== undefined && session === undefined
          ? panelText('原生 Session 不可用，改从 Fleet 持久轨迹定位消息', 'The native Session is unavailable; locating the message in the Fleet persistent trace')
          : source !== undefined
          ? panelText('现场加载原生 ChatView，并定位这条团队消息进入 Agent 上下文的位置', 'Loading the native ChatView and locating where this Team message entered the Agent context')
          : emptyAssistantSession
          ? panelText('当前助理 Session 尚无可见消息，显示其历次绑定的持久轨迹', 'The assistant Session has no visible messages yet; showing its persistent trace across bindings')
          : session === undefined
          ? panelText('成员离线时从 Fleet 持久轨迹恢复最近上下文', 'Restoring the latest context from the Fleet persistent trace while the member is offline')
          : panelText('复用原生 ChatView，只读呈现这个 Agent 的真实 Session', 'Showing this Agent’s actual Session in the native ChatView as read-only'),
        peer: member,
        meta: jsx(AgentPerspectiveMeta, { member }),
        actions: jsxs('div', {
          className: 'dsh-fleet-panel-main-actions',
          children: [
            jsx(NavigationToggle, { owner }),
            owner.renderPanelSlot(FLEET_PANEL_SLOTS.mainAction, owner as unknown as Record<string, unknown>),
          ],
        }),
      }),
      usePersistedTrace
        ? jsx(FleetPersistedMemberTrace, { owner, member, ...(source === undefined ? {} : { source }) }, `${owner.snapshot.teamId}:${member.id}:${source?.sessionId ?? ''}:${source?.contextMessageId ?? ''}`)
        : jsx(owner.SessionProvider, {
            sessionId: contextSessionId,
            empty: () => jsx(PanelUnavailable, { label: panelText('成员 Session 当前不在 DSH 可见范围内', 'The member Session is not currently visible in DSH') }),
            children: () => jsx(FleetNativeMemberChat, {
              owner,
              session,
              sessionId: contextSessionId,
              ...(source === undefined ? {} : { source }),
            }),
          }),
      jsx('div', {
        className: 'dsh-fleet-panel-agent-readonly',
        role: 'status',
        children: source !== undefined && session === undefined
          ? panelText(`正在查看 ${member.name} 的持久消息来源 · 只读`, `Viewing ${member.name}’s persistent message source · Read-only`)
          : source !== undefined
          ? panelText(`正在原生 ChatView 中查看 ${member.name} 的消息来源 · 只读`, `Viewing ${member.name}’s message source in the native ChatView · Read-only`)
          : usePersistedTrace
          ? panelText(`以 ${member.name} 的视角查看持久轨迹 · 只读`, `Viewing the persistent trace from ${member.name}’s perspective · Read-only`)
          : panelText(`以 ${member.name} 的视角查看原生 Session · 只读`, `Viewing the native Session from ${member.name}’s perspective · Read-only`),
      }),
    ],
  })
}

export function AgentMain(owner: FleetPanelPaneOwner): ReactElement {
  const { member, conversation, context } = parseAgentViewItem(owner.snapshot, owner.activeItem)
  const recentMessages = conversation === undefined
    ? []
    : owner.snapshot.messages.filter(message => message.conversationId === conversation.id)
  const history = useConversationHistory(owner, conversation?.id ?? '', recentMessages)
  if (member === undefined) return jsx(PanelUnavailable, { label: panelText('请选择一位 Agent', 'Select an Agent') })
  if (context) return jsx(AgentContextMain, { owner, member })
  if (conversation === undefined) return jsx(PanelUnavailable, { label: panelText('这个 Agent 当前没有可见消息', 'This Agent currently has no visible messages') })
  const peer = agentConversationPeer(owner.snapshot, member, conversation)
  const members = new Map(teamAgents(owner.snapshot).map(candidate => [candidate.id, candidate]))
  members.set(operator.id, operator)
  const messages = history.messages
  return jsxs('section', {
    className: 'dsh-fleet-panel-chat',
    children: [
      jsx(FleetConversationHeader, {
        kind: conversation.kind,
        name: peer?.name ?? conversation.name,
        description: peer?.role ?? conversation.topic,
        memberCount: conversation.memberCount ?? owner.snapshot.members.length,
        activeCount: conversation.activeCount ?? owner.snapshot.members.filter(candidate =>
          candidate.presence === 'active' || candidate.presence === 'busy'
            || candidate.presence === 'waiting' || candidate.presence === 'error',
        ).length,
        ...(peer === undefined ? {} : { peer }),
        meta: jsx(AgentPerspectiveMeta, { member }),
        actions: jsxs('div', {
          className: 'dsh-fleet-panel-main-actions',
          children: [
            jsx(NavigationToggle, { owner }),
            owner.renderPanelSlot(FLEET_PANEL_SLOTS.mainAction, owner as unknown as Record<string, unknown>),
          ],
        }),
      }),
      jsx(PanelMessageLog, {
        conversationKey: `${owner.snapshot.teamId}:agent:${member.id}:${conversation.id}`,
        messageCount: messages.length,
        resizable: true,
        hasOlder: history.hasOlder,
        loadingOlder: history.loadingOlder,
        loadOlder: history.loadOlder,
        children: jsx('div', {
          className: 'dsh-fleet-panel-agent-chat-column',
          role: 'log',
          'aria-live': 'polite',
          'data-fleet-conversation-id': conversation.id,
          children: messages.length === 0
            ? jsx('div', { className: 'dsh-fleet-panel-empty', children: panelText('这里还没有消息', 'No messages yet') })
            : groupFleetMessageThreads(messages).map(thread => jsx(FleetPanelChatThread, {
                owner,
                conversation,
                thread,
                members,
                selfId: member.id,
              }, thread.message.id)),
        }),
      }),
      jsx('div', {
        className: 'dsh-fleet-panel-agent-readonly',
        role: 'status',
        children: panelText(`以 ${member.name} 的视角查看 · 只读`, `Viewing from ${member.name}’s perspective · Read-only`),
      }),
    ],
  })
}

export function OpenFleetPath({ owner, path, label, appearance = 'button' }: {
  readonly owner: FleetPanelPaneOwner
  readonly path: string
  readonly label: string
  readonly appearance?: 'button' | 'link'
}): ReactElement {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string>()
  const open = (): void => {
    if (opening) return
    setOpening(true)
    setError(undefined)
    void owner.nativeContext.openPath(path).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : panelText('无法打开这个路径', 'Could not open this path'))
    }).finally(() => { setOpening(false) })
  }
  return jsxs('div', {
    className: appearance === 'link' ? 'dsh-fleet-panel-resource-path-wrap' : 'dsh-fleet-panel-overview-actions',
    children: [
      jsxs('button', {
        type: 'button',
        className: appearance === 'link' ? 'dsh-fleet-panel-resource-path' : 'dsh-fleet-panel-enter-messages',
        disabled: opening,
        'aria-busy': opening ? 'true' : undefined,
        onClick: open,
        children: [
          appearance === 'button' && jsx(PanelIcon, { name: 'resources', size: 15 }),
          jsx('span', { children: appearance === 'link' ? label : opening ? panelText('正在打开…', 'Opening…') : label }),
        ],
      }),
      error !== undefined && jsx('span', {
        className: 'dsh-fleet-panel-resource-open-error',
        role: 'alert',
        children: error,
      }),
    ],
  })
}

export function fleetResourcePreviewKind(resource: Pick<FleetPanelResource, 'name' | 'path' | 'mediaType'>): 'markdown' | 'text' | undefined {
  const mediaType = resource.mediaType?.split(';', 1)[0]?.trim().toLowerCase()
  const name = resource.name.toLowerCase()
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function resourceFileName(resource: FleetPanelResource): string {
  return resource.path.split(/[\\/]/u).at(-1) || resource.name.split(/[\\/]/u).at(-1) || resource.name
}

type FleetResourceContentMode = 'rendered' | 'source' | 'compare'

const RESOURCE_COMPARE_MIN_SPLIT = 25
const RESOURCE_COMPARE_MAX_SPLIT = 75
const RESOURCE_COMPARE_DEFAULT_SPLIT = 50

export function ResourceComparison({ source, rendered }: {
  readonly source: ReactNode
  readonly rendered: ReactNode
}): ReactElement {
  const root = useRef<HTMLDivElement>(null)
  const pointer = useRef<number>()
  const [split, setSplit] = useState(RESOURCE_COMPARE_DEFAULT_SPLIT)
  const [resizing, setResizing] = useState(false)
  const resize = (next: number): void => {
    setSplit(Math.min(RESOURCE_COMPARE_MAX_SPLIT, Math.max(RESOURCE_COMPARE_MIN_SPLIT, Math.round(next))))
  }
  const resizeFromPointer = (clientX: number): void => {
    const bounds = root.current?.getBoundingClientRect()
    if (bounds === undefined || bounds.width <= 0) return
    resize((clientX - bounds.left) / bounds.width * 100)
  }
  const startResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    pointer.current = event.pointerId
    setResizing(true)
    resizeFromPointer(event.clientX)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const moveResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (pointer.current !== event.pointerId) return
    resizeFromPointer(event.clientX)
  }
  const stopResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (pointer.current !== event.pointerId) return
    pointer.current = undefined
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 10 : 2
    if (event.key === 'ArrowLeft') resize(split - step)
    else if (event.key === 'ArrowRight') resize(split + step)
    else if (event.key === 'Home') resize(RESOURCE_COMPARE_MIN_SPLIT)
    else if (event.key === 'End') resize(RESOURCE_COMPARE_MAX_SPLIT)
    else return
    event.preventDefault()
  }
  return jsxs('div', {
    ref: root,
    className: 'dsh-fleet-panel-resource-compare',
    'data-resizing': resizing ? 'true' : undefined,
    style: {
      '--dsh-fleet-panel-resource-compare-split': `${String(split)}%`,
      '--dsh-fleet-panel-resource-compare-left': `${String(split)}fr`,
      '--dsh-fleet-panel-resource-compare-right': `${String(100 - split)}fr`,
    } as CSSProperties,
    children: [
      jsxs('section', {
        children: [
          jsx('h3', { children: panelText('源码', 'Source') }),
          jsx('div', { className: 'dsh-fleet-panel-resource-compare-body', children: source }),
        ],
      }),
      jsx(PanelColumnResizeHandle, {
        placement: 'split',
        label: panelText('调整源码与渲染结果宽度', 'Resize source and rendered output'),
        title: panelText('拖动调整源码与渲染结果宽度；双击恢复均分', 'Drag to resize source and rendered output; double-click to split evenly'),
        resizing,
        min: RESOURCE_COMPARE_MIN_SPLIT,
        max: RESOURCE_COMPARE_MAX_SPLIT,
        value: split,
        handle: {
          onKeyDown: resizeWithKeyboard,
          onPointerDown: startResize,
          onPointerMove: moveResize,
          onPointerUp: stopResize,
          onPointerCancel: stopResize,
          onLostPointerCapture: stopResize,
        },
        onDoubleClick: () => { resize(RESOURCE_COMPARE_DEFAULT_SPLIT) },
      }),
      jsxs('section', {
        children: [
          jsx('h3', { children: panelText('渲染效果', 'Rendered output') }),
          jsx('div', { className: 'dsh-fleet-panel-resource-compare-body', children: rendered }),
        ],
      }),
    ],
  })
}

export function ResourceSourcePreview({ body, wrap }: {
  readonly body: string
  readonly wrap: boolean
}): ReactElement {
  const source = jsx('pre', {
    className: 'dsh-fleet-panel-resource-preview-plain',
    'data-wrap': wrap ? 'true' : 'false',
    children: body.split(/\r\n|\r|\n/u).map((line, index) => jsx('span', {
      className: 'dsh-fleet-panel-resource-source-line',
      'data-line': index + 1,
      children: jsx('span', { children: line }),
    }, index)),
  })
  return jsx('div', {
    className: 'dsh-fleet-panel-resource-source-frame',
    'data-wrap': wrap ? 'true' : 'false',
    children: jsx('div', {
      className: 'dsh-fleet-panel-resource-source-viewport',
      children: source,
    }),
  })
}

export function ResourceContentPreview({ owner, resource, content, loading, error, onRetry, mode, wrapSource }: {
  readonly owner: FleetPanelPaneOwner
  readonly resource: FleetPanelResource
  readonly content?: FleetPanelResourceContent
  readonly loading: boolean
  readonly error?: string
  readonly onRetry: () => void
  readonly mode: FleetResourceContentMode
  readonly wrapSource: boolean
}): ReactElement | null {
  const previewKind = fleetResourcePreviewKind(resource)
  if (previewKind === undefined) return null
  if (loading) return jsx('div', {
    className: 'dsh-fleet-panel-resource-preview-status',
    role: 'status',
    children: panelText('正在读取文件…', 'Loading file…'),
  })
  if (error !== undefined) return jsxs('div', {
    className: 'dsh-fleet-panel-resource-preview-error',
    role: 'alert',
    children: [
      jsx('span', { children: error }),
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-resource-preview-retry',
        onClick: onRetry,
        children: panelText('重新读取', 'Reload'),
      }),
    ],
  })
  if (content === undefined) return null
  if (content.body.length === 0) return jsx('div', {
    className: 'dsh-fleet-panel-resource-preview-status',
    children: panelText('文件为空', 'File is empty'),
  })

  const mediaType = content.mediaType ?? resource.mediaType
  const previewResource: FleetPanelResource = {
    ...resource,
    body: content.body,
    ...(mediaType === undefined ? {} : { mediaType }),
  }
  const previewOwner: FleetPanelResourcePreviewOwner = { panel: owner, resource: previewResource }
  const source = jsx(ResourceSourcePreview, { body: content.body, wrap: wrapSource })
  const rendered = owner.renderPanelSlot(
    FLEET_PANEL_SLOTS.resourcePreview,
    previewOwner as unknown as Record<string, unknown>,
    { entryKey: content.kind === 'markdown' ? 'text/markdown' : content.mediaType ?? 'text/plain', fallback: source },
  )
  return jsx('div', {
    className: 'dsh-fleet-panel-resource-preview',
    'data-mode': mode,
    'data-wrap': wrapSource ? 'true' : 'false',
    children: mode === 'source'
      ? source
      : mode === 'compare'
        ? jsx(ResourceComparison, { source, rendered })
        : rendered,
  })
}

export function resourceMember(owner: FleetPanelPaneOwner, actorId: string): FleetPanelMember | undefined {
  return owner.snapshot.members.find(member => member.id === actorId || member.sessionId === actorId)
    ?? owner.snapshot.assistants?.find(member => member.id === actorId || member.sessionId === actorId)
}

export function resourceActorName(owner: FleetPanelPaneOwner, actorId: string): string {
  return resourceMember(owner, actorId)?.name
    ?? (actorId === 'fleet-filesystem' ? panelText('文件系统自动发现', 'Discovered by filesystem') : actorId)
}

export function ResourceDiffFallback({ revision }: { readonly revision: FleetPanelResourceRevision }): ReactElement {
  return jsxs('div', {
    className: 'dsh-fleet-panel-resource-diff-fallback',
    children: [
      jsxs('section', {
        children: [
          jsx('h3', { children: revision.before === null ? panelText('创建前', 'Before creation') : panelText('修改前', 'Before change') }),
          jsx('pre', { children: revision.before ?? panelText('文件不存在', 'File did not exist') }),
        ],
      }),
      jsxs('section', {
        children: [
          jsx('h3', { children: panelText('修改后', 'After change') }),
          jsx('pre', { children: revision.after }),
        ],
      }),
    ],
  })
}

export function ResourceHistoryView({ owner, resource, history, historyTruncated, revision, loading, error, selectedId, selectRevision, retry }: {
  readonly owner: FleetPanelPaneOwner
  readonly resource: FleetPanelResource
  readonly history: readonly FleetPanelResourceRevisionSummary[]
  readonly historyTruncated: boolean
  readonly revision?: FleetPanelResourceRevision
  readonly loading: boolean
  readonly error?: string
  readonly selectedId?: string
  readonly selectRevision: (id: string) => void
  readonly retry: () => void
}): ReactElement {
  if (history.length === 0 && loading) return jsx('div', {
    className: 'dsh-fleet-panel-resource-preview-status',
    role: 'status',
    children: panelText('正在读取变更历史…', 'Loading change history…'),
  })
  if (history.length === 0 && error !== undefined) return jsxs('div', {
    className: 'dsh-fleet-panel-resource-preview-error',
    role: 'alert',
    children: [
      jsx('span', { children: error }),
      jsx('button', { type: 'button', className: 'dsh-fleet-panel-resource-preview-retry', onClick: retry, children: panelText('重新读取', 'Reload') }),
    ],
  })
  if (history.length === 0) return jsx('div', {
    className: 'dsh-fleet-panel-resource-history-empty',
    children: panelText('暂时没有可归属到团队成员的文件变更', 'No file changes can currently be attributed to Team members'),
  })
  const selectedSummary = history.find(item => item.id === selectedId)
  const diffOwner = revision === undefined ? undefined : { panel: owner, resource, revision }
  return jsxs('div', {
    className: 'dsh-fleet-panel-resource-history',
    children: [
      jsx('div', {
        className: 'dsh-fleet-panel-resource-diff',
        children: selectedSummary?.available === false
          ? jsxs('div', {
              className: 'dsh-fleet-panel-resource-preview-status',
              role: 'status',
              children: [
                jsx('strong', { children: panelText('这次变更未载入正文', 'Content was not loaded for this change') }),
                jsx('span', { children: panelText(`前后版本合计 ${formatBytes(selectedSummary.size)}，超过 2 MiB 的变更只保留时间与来源。`, `Before and after versions total ${formatBytes(selectedSummary.size)}. Changes over 2 MiB retain only time and source.`) }),
              ],
            })
          : loading
          ? jsx('div', { className: 'dsh-fleet-panel-resource-preview-status', role: 'status', children: panelText('正在读取变更…', 'Loading change…') })
          : error !== undefined
            ? jsxs('div', {
                className: 'dsh-fleet-panel-resource-preview-error',
                role: 'alert',
                children: [
                  jsx('span', { children: error }),
                  jsx('button', { type: 'button', className: 'dsh-fleet-panel-resource-preview-retry', onClick: retry, children: panelText('重新读取', 'Reload') }),
                ],
              })
            : revision === undefined || diffOwner === undefined
              ? jsx('div', { className: 'dsh-fleet-panel-resource-preview-status', children: panelText('请选择一条变更', 'Choose a change') })
              : owner.renderPanelSlot(
                  FLEET_PANEL_SLOTS.resourceDiff,
                  diffOwner as unknown as Record<string, unknown>,
                  { entryKey: 'text', fallback: jsx(ResourceDiffFallback, { revision }) },
                ),
      }),
      jsxs('aside', {
        className: 'dsh-fleet-panel-resource-timeline',
        'aria-label': panelText('文件变更时间轴', 'File change timeline'),
        children: [
          jsxs('div', {
            className: 'dsh-fleet-panel-resource-timeline-head',
            children: [
              jsx('h3', { className: 'dsh-fleet-panel-resource-timeline-title', children: panelText('变更时间轴', 'Change timeline') }),
              historyTruncated && jsx('span', { children: panelText('最近 500 条', 'Latest 500') }),
            ],
          }),
          jsx('div', {
            className: 'dsh-fleet-panel-resource-timeline-list',
            children: history.map(item => {
              const updatedAt = new Date(item.updatedAt)
              return jsxs('button', {
                type: 'button',
                className: 'dsh-fleet-panel-resource-revision',
                'aria-pressed': selectedId === item.id,
                onClick: () => { selectRevision(item.id) },
                children: [
                  jsxs('time', {
                    className: 'dsh-fleet-panel-resource-revision-when',
                    dateTime: item.updatedAt,
                    children: [
                      jsx('span', {
                        children: updatedAt.toLocaleDateString([], { month: 'short', day: 'numeric' }),
                      }),
                      jsx('span', {
                        children: updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      }),
                    ],
                  }),
                  jsx('span', { className: 'dsh-fleet-panel-resource-revision-marker', 'aria-hidden': 'true' }),
                  jsxs('span', {
                    className: 'dsh-fleet-panel-resource-revision-copy',
                    children: [
                      jsxs('span', {
                        className: 'dsh-fleet-panel-resource-revision-summary',
                        children: [
                          jsx('strong', { children: resourceActorName(owner, item.updatedBy) }),
                          jsx('span', { children: item.operation === 'created' ? panelText('创建了文件', 'Created file') : panelText('修改了文件', 'Modified file') }),
                        ],
                      }),
                      !item.available && jsx('span', {
                        className: 'dsh-fleet-panel-resource-revision-detail',
                        children: panelText(`${formatBytes(item.size)} · 正文未载入`, `${formatBytes(item.size)} · Content not loaded`),
                      }),
                    ],
                  }),
                ],
              }, item.id)
            }),
          }),
        ],
      }),
    ],
  })
}

export function MarkdownRendererUnavailableView({ label }: {
  readonly label: string
}): ReactElement {
  const rendererLink = jsx('a', {
    className: 'dsh-fleet-panel-resource-renderer-link',
    href: 'https://github.com/CH4ACKO3/dsh-render-engine',
    target: '_blank',
    rel: 'noreferrer',
    children: panelText('渲染器', 'renderer'),
  })
  return jsx('span', {
    className: 'dsh-fleet-panel-resource-view-unavailable',
    children: jsx(FleetInfoHint, {
      label: panelText(`${label}视图不可用，需要安装 Markdown 渲染器`, `${label} view is unavailable; install the Markdown renderer`),
      title: panelText(`${label}视图不可用`, `${label} view unavailable`),
      trigger: (triggerProps: HoverHintTriggerProps) => jsx('button', {
        ...triggerProps,
        type: 'button',
        className: 'dsh-fleet-panel-resource-view-unavailable-trigger',
        'aria-disabled': 'true',
        children: label,
      }),
      children: isChineseLocale()
        ? jsxs(Fragment, { children: ['需要安装 ', rendererLink, ' 插件依赖，才能使用此视图。'] })
        : jsxs(Fragment, { children: ['Install the ', rendererLink, ' plugin dependency to use this view.'] }),
      footer: null,
    }),
  })
}

export function ResourceDetailMain({ owner, resource }: {
  readonly owner: FleetPanelPaneOwner
  readonly resource: FleetPanelResource
}): ReactElement {
  const [view, setView] = useState<'content' | 'history'>('content')
  const [contentMode, setContentMode] = useState<FleetResourceContentMode>(() => owner.markdownRendererAvailable ? 'rendered' : 'source')
  const [wrapSource, setWrapSource] = useState(true)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [attempt, setAttempt] = useState(0)
  const [content, setContent] = useState<FleetPanelResourceContent>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>()
  const [revision, setRevision] = useState<FleetPanelResourceRevision>()
  const [revisionLoading, setRevisionLoading] = useState(false)
  const [revisionError, setRevisionError] = useState<string>()
  const [revisionAttempt, setRevisionAttempt] = useState(0)
  const previewKind = fleetResourcePreviewKind(resource)

  useEffect(() => {
    setSelectedRevisionId(undefined)
    setRevision(undefined)
    if (resource.body !== undefined) {
      setContent({
        id: resource.id,
        kind: previewKind ?? 'text',
        body: resource.body,
        ...(resource.mediaType === undefined ? {} : { mediaType: resource.mediaType }),
        history: [],
        historyTruncated: false,
      })
      setLoading(false)
      setError(undefined)
      return
    }
    if (previewKind === undefined || owner.loadResource === undefined) {
      setContent(undefined)
      setLoading(false)
      setError(undefined)
      return
    }
    const controller = new AbortController()
    setContent(undefined)
    setLoading(true)
    setError(undefined)
    void owner.loadResource(owner.snapshot.teamId, resource.id, controller.signal).then(
      next => { if (!controller.signal.aborted) setContent(next) },
      reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : panelText('无法读取团队文件', 'Could not read Team file')) },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [attempt, owner.loadResource, owner.snapshot.teamId, previewKind, resource.body, resource.id, resource.mediaType])

  useEffect(() => {
    if (view !== 'history' || content === undefined || content.history.length === 0) return
    setSelectedRevisionId(current => current !== undefined && content.history.some(item => item.id === current)
      ? current
      : content.history[0]?.id)
  }, [content, view])

  useEffect(() => {
    const selectedSummary = content?.history.find(item => item.id === selectedRevisionId)
    if (selectedRevisionId === undefined || selectedSummary?.available === false || owner.loadResource === undefined) {
      setRevision(undefined)
      setRevisionLoading(false)
      setRevisionError(undefined)
      return
    }
    const controller = new AbortController()
    setRevision(undefined)
    setRevisionLoading(true)
    setRevisionError(undefined)
    void owner.loadResource(owner.snapshot.teamId, resource.id, controller.signal, selectedRevisionId).then(
      next => {
        if (!controller.signal.aborted) setRevision(next.revision)
      },
      reason => {
        if (!controller.signal.aborted) setRevisionError(reason instanceof Error ? reason.message : panelText('无法读取这次变更', 'Could not read this change'))
      },
    ).finally(() => { if (!controller.signal.aborted) setRevisionLoading(false) })
    return () => { controller.abort() }
  }, [content?.history, owner.loadResource, owner.snapshot.teamId, resource.id, revisionAttempt, selectedRevisionId])

  useEffect(() => {
    if (copyState !== 'copied') return
    const timer = window.setTimeout(() => { setCopyState('idle') }, 1_600)
    return () => { window.clearTimeout(timer) }
  }, [copyState])

  const copyContent = (): void => {
    if (content === undefined) return
    setCopyState('idle')
    if (navigator.clipboard === undefined) {
      setCopyState('error')
      return
    }
    void navigator.clipboard.writeText(content.body).then(
      () => { setCopyState('copied') },
      () => { setCopyState('error') },
    )
  }
  const fileName = resourceFileName(resource)
  const exportContent = (): void => {
    if (content === undefined) return
    const url = URL.createObjectURL(new Blob([content.body], { type: content.mediaType ?? resource.mediaType ?? 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  const size = resource.size ?? content?.size
  const meta = jsxs('div', {
    className: 'dsh-fleet-panel-resource-meta',
    children: [
      jsx('span', { className: 'dsh-fleet-panel-resource-size', children: size === undefined ? '—' : formatBytes(size) }),
      jsx(OpenFleetPath, { owner, path: resource.path, label: panelText('本地文件', 'Local file'), appearance: 'link' }),
    ],
  })
  const isMarkdown = previewKind === 'markdown'
  const sourceControlsVisible = view === 'content' && (!isMarkdown || contentMode !== 'rendered')
  const selectContentMode = (mode: FleetResourceContentMode): void => {
    setContentMode(mode)
    setView('content')
  }
  const viewSwitch = jsxs('div', {
    className: 'dsh-fleet-panel-resource-view-switch',
    role: 'group',
    'aria-label': isMarkdown ? panelText('Markdown 文件视图', 'Markdown file view') : panelText('文件视图', 'File view'),
    children: [
      isMarkdown && !owner.markdownRendererAvailable
        ? jsx(MarkdownRendererUnavailableView, { label: panelText('渲染', 'Rendered') })
        : jsx('button', {
            type: 'button',
            'aria-pressed': view === 'content' && (!isMarkdown || contentMode === 'rendered'),
            onClick: () => { selectContentMode(isMarkdown ? 'rendered' : 'source') },
            children: isMarkdown ? panelText('渲染', 'Rendered') : panelText('内容', 'Content'),
          }),
      isMarkdown && jsx('button', {
        type: 'button',
        'aria-pressed': view === 'content' && contentMode === 'source',
        onClick: () => { selectContentMode('source') },
        children: panelText('源码', 'Source'),
      }),
      isMarkdown && (owner.markdownRendererAvailable
        ? jsx('button', {
            type: 'button',
            'aria-pressed': view === 'content' && contentMode === 'compare',
            onClick: () => { selectContentMode('compare') },
            children: panelText('对照', 'Compare'),
          })
        : jsx(MarkdownRendererUnavailableView, { label: panelText('对照', 'Compare') })),
      jsx('button', {
        type: 'button',
        'aria-pressed': view === 'history',
        onClick: () => { setView('history') },
        children: panelText('历史', 'History'),
      }),
    ],
  })
  const actions = jsxs('div', {
    className: 'dsh-fleet-panel-resource-actions',
    children: [
      viewSwitch,
      jsxs('div', {
        className: 'dsh-fleet-panel-resource-file-actions',
        children: [
          jsx('button', {
            type: 'button',
            disabled: content === undefined || !sourceControlsVisible,
            'data-visible': sourceControlsVisible ? 'true' : 'false',
            'aria-hidden': sourceControlsVisible ? undefined : 'true',
            'aria-label': wrapSource ? panelText('关闭源码折行', 'Disable source wrapping') : panelText('开启源码折行', 'Enable source wrapping'),
            'aria-pressed': wrapSource,
            tabIndex: sourceControlsVisible ? undefined : -1,
            title: wrapSource ? panelText('关闭源码折行', 'Disable source wrapping') : panelText('开启源码折行', 'Enable source wrapping'),
            onClick: () => { setWrapSource(current => !current) },
            children: jsx(PanelIcon, { name: 'wrap', size: 15 }),
          }),
          jsx('button', {
            type: 'button',
            disabled: content === undefined,
            'aria-label': copyState === 'copied' ? panelText('已复制文件内容', 'File content copied') : panelText('复制文件内容', 'Copy file content'),
            title: copyState === 'copied' ? panelText('已复制', 'Copied') : copyState === 'error' ? panelText('复制失败', 'Copy failed') : panelText('复制源码', 'Copy source'),
            onClick: copyContent,
            children: jsx(PanelIcon, { name: 'copy', size: 15 }),
          }),
          jsx('button', {
            type: 'button',
            disabled: content === undefined,
            'aria-label': panelText('导出文件', 'Export file'),
            title: panelText('导出文件', 'Export file'),
            onClick: exportContent,
            children: jsx(PanelIcon, { name: 'download', size: 15 }),
          }),
          jsx('span', {
            className: 'dsh-fleet-panel-resource-action-status',
            role: 'status',
            'aria-live': 'polite',
            children: copyState === 'copied' ? panelText('已复制', 'Copied') : copyState === 'error' ? panelText('复制失败', 'Copy failed') : '',
          }),
        ],
      }),
    ],
  })
  const preview = jsx(ResourceContentPreview, {
    owner, resource, content, loading, error,
    mode: isMarkdown ? contentMode : 'source',
    wrapSource,
    onRetry: () => { setAttempt(current => current + 1) },
  })
  return jsx(DetailShell, {
    title: fileName,
    meta,
    actions,
    owner,
    bodyClassName: view === 'content' && isMarkdown
      ? 'dsh-fleet-panel-detail-scroll dsh-fleet-panel-resource-scroll'
      : undefined,
    children: view === 'content'
      ? isMarkdown
        ? jsx(PanelMessageLog, {
            conversationKey: `${owner.snapshot.teamId}:resource:${resource.id}`,
            messageCount: 0,
            resizable: contentMode !== 'compare',
            resizeLabel: panelText('调整 Markdown 阅读宽度', 'Resize Markdown reading width'),
            initialScroll: 'top',
            children: jsx('div', {
              className: 'dsh-fleet-panel-resource-content',
              'data-mode': contentMode,
              children: preview,
            }),
          })
        : jsx('div', { className: 'dsh-fleet-panel-resource-content', children: preview })
      : jsx(ResourceHistoryView, {
          owner,
          resource,
          history: content?.history ?? [],
          historyTruncated: content?.historyTruncated ?? false,
          revision,
          loading: loading || revisionLoading,
          error: error ?? revisionError,
          selectedId: selectedRevisionId,
          selectRevision: setSelectedRevisionId,
          retry: () => {
            if (error !== undefined) setAttempt(current => current + 1)
            else setRevisionAttempt(current => current + 1)
          },
        }),
  })
}

export function ResourcesMain(owner: FleetPanelPaneOwner): ReactElement {
  const resource = owner.snapshot.resources.find(item => item.id === owner.activeItem)
  if (resource === undefined) {
    const workspace = owner.snapshot.workspaces?.find(item => item.id === owner.activeItem)
    if (workspace === undefined) return jsx(PanelUnavailable, { label: panelText('请选择一个团队文件或工作区', 'Choose a Team file or Workspace') })
    return jsx(DetailShell, {
      title: workspace.name,
      meta: workspace.access === 'write' ? panelText('可写工作区', 'Writable Workspace') : panelText('只读工作区', 'Read-only Workspace'),
      owner,
      children: jsxs('div', {
        className: 'dsh-fleet-panel-overview',
        children: [
          jsx('h3', { className: 'dsh-fleet-panel-overview-title', children: panelText('工作区文件', 'Workspace files') }),
          jsx('p', { className: 'dsh-fleet-panel-overview-copy', children: panelText('团队运行期间新建或修改的工作区文件会自动出现在“团队文件”中；隐藏目录与依赖缓存不会收录。', 'Workspace files created or changed while the Team runs appear automatically in Team files; hidden directories and dependency caches are excluded.') }),
          jsxs('div', {
            className: 'dsh-fleet-panel-facts',
            children: [
              jsx(Fact, { label: panelText('路径', 'Path'), value: workspace.path }),
              jsx(Fact, { label: panelText('团队成员', 'Team members'), value: `${workspace.members.length}` }),
            ],
          }),
          jsx(OpenFleetPath, { owner, path: workspace.path, label: panelText('打开工作区', 'Open Workspace') }),
        ],
      }),
    })
  }
  return jsx(ResourceDetailMain, { owner, resource })
}
