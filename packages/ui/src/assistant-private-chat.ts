import type { ReactElement, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import { useFleetMetaText } from './meta-assistant.js'
import { useFleetChatColumnWidth } from './chat-column-width.js'
import {
  FleetChatAvatar,
  FleetChatMemberStatusPopover,
  FleetChatMessage,
  type FleetChatContentBlock,
  type FleetChatImageBlock,
  type FleetChatMember,
  type FleetChatMemberStatusPopoverTriggerProps,
  type FleetRuntimeMember,
} from './runtime-chat.js'
import { FleetMemberPopover, type FleetMemberPopoverTriggerProps } from './member-popover.js'
import { fleetText } from './locale.js'
import {
  updateFleetOperatorProfile,
  useFleetOperatorProfile,
  type FleetOperatorProfile,
} from './operator-profile.js'

const STYLE_ID = 'dsh-agent-fleet-assistant-private-chat'

const styles = `
.dsh-fleet-assistant-private {
  --dsh-fleet-assistant-composer-width: 760px;

  min-width: 0;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  flex: auto;
  flex-direction: column;
  display: flex;
  position: relative;
}

.dsh-fleet-assistant-private-scroll {
  min-height: 0;
  flex: auto;
  overflow-y: auto;
}

.dsh-fleet-assistant-private-column {
  box-sizing: border-box;
  width: 100%;
  max-width: min(100%, var(--dsh-fleet-assistant-chat-column-width, 760px));
  min-height: 100%;
  margin: 0 auto;
  padding: 22px 16px 28px;
  flex-direction: column;
  gap: 18px;
  display: flex;
}

.dsh-fleet-assistant-private[data-column-resizing="true"] {
  cursor: col-resize;
  user-select: none;
}

[data-conversation-scroll]:has(.dsh-fleet-assistant-private[data-surface="details"], .dsh-fleet-assistant-private[data-surface="context"])
> [data-composer-seat] {
  display: none;
}

.dsh-fleet-assistant-private-subview-head {
  box-sizing: border-box;
  min-height: 48px;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  display: flex;
}

.dsh-fleet-assistant-private-back {
  min-height: 32px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  font: var(--dsw-font-xs-13);
  display: inline-flex;
}

.dsh-fleet-assistant-private-back:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dsh-fleet-assistant-private-back:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-assistant-private-subview-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-strong-14);
  font-size: 15px;
}

.dsh-fleet-assistant-private-subview-body {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.dsh-fleet-assistant-private-profile {
  box-sizing: border-box;
  width: min(680px, 100%);
  margin: 0 auto;
  padding: 28px 24px;
}

.dsh-fleet-assistant-private-profile-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-m-strong-16, var(--dsw-font-s-strong-14));
  font-size: 18px;
}

.dsh-fleet-assistant-private-profile-copy {
  max-width: 62ch;
  margin: 8px 0 22px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
}

.dsh-fleet-assistant-private-profile-facts {
  border-top: 1px solid var(--dsw-alias-border-l3);
}

.dsh-fleet-assistant-private-profile-fact {
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  padding: 0 2px;
  display: flex;
}

.dsh-fleet-assistant-private-profile-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

.dsh-fleet-assistant-private-profile-value {
  color: var(--dsw-alias-label-primary);
  text-align: right;
  font-size: 13px;
}

.dsh-fleet-assistant-private-width-handle {
  appearance: none;
  width: 20px;
  height: 32px;
  z-index: 4;
  color: var(--dsw-alias-label-tertiary);
  cursor: col-resize;
  touch-action: none;
  background: transparent;
  border: 0;
  border-radius: 6px;
  place-items: center;
  padding: 0;
  display: grid;
  position: absolute;
  top: 8px;
  left: clamp(0px, calc(50% + var(--dsh-fleet-assistant-chat-column-width, 760px) / 2 - 10px), calc(100% - 20px));
}

.dsh-fleet-assistant-private-width-handle::before {
  width: 2px;
  height: 20px;
  content: '';
  background: currentColor;
  border-radius: 2px;
  opacity: .55;
}

.dsh-fleet-assistant-private-width-handle:hover,
.dsh-fleet-assistant-private-width-handle:focus-visible,
.dsh-fleet-assistant-private-width-handle[data-dragging="true"] {
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
}

.dsh-fleet-assistant-private-width-handle:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-assistant-private-history-state,
.dsh-fleet-assistant-private-empty {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-assistant-private-history-state {
  text-align: center;
}

.dsh-fleet-assistant-private-history-state[data-error="true"] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-assistant-private-older {
  align-self: center;
  min-height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: var(--dsw-alias-interactive-bg-hover-solid);
  border: 0;
  border-radius: 14px;
  padding: 4px 12px;
  font: inherit;
  font-size: 12px;
}

.dsh-fleet-assistant-private-older:disabled {
  cursor: default;
  opacity: .58;
}

.dsh-fleet-assistant-private-message[data-streaming="true"] .dsh-fleet-chat-content-text:last-child::after {
  content: '';
  width: 2px;
  height: 1em;
  background: var(--dsw-alias-state-business-primary);
  border-radius: 1px;
  margin-left: 2px;
  vertical-align: -.12em;
  animation: dsh-fleet-assistant-private-caret 900ms step-end infinite;
  display: inline-block;
}

.dsh-fleet-assistant-private-message {
  width: 100%;
  display: flex;
}

.dsh-fleet-assistant-private-message > .dsh-fleet-chat-message {
  width: 100%;
}

.dsh-fleet-assistant-private-message[data-self="true"] {
  justify-content: flex-end;
}

.dsh-fleet-assistant-private-message[data-self="true"] > .dsh-fleet-chat-message {
  grid-template-columns: minmax(0, 1fr) 34px;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-chat-avatar {
  grid-column: 2;
  grid-row: 1;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-chat-message-main {
  min-width: 0;
  width: fit-content;
  max-width: 100%;
  grid-column: 1;
  grid-row: 1;
  justify-self: end;
  align-items: flex-end;
  flex-direction: column;
  padding-top: 18px;
  display: flex;
  position: relative;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-chat-message-meta {
  display: contents;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-chat-message-sender {
  width: max-content;
  max-width: min(320px, calc(100vw - 96px));
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-chat-message-delivery {
  flex: none;
  align-self: flex-start;
  gap: 4px;
  margin-bottom: 2px;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-chat-message-body {
  box-sizing: border-box;
  width: fit-content;
  max-width: 100%;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, var(--dsw-alias-bg-layer-1));
  border-radius: 11px;
  padding: 8px 10px;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-chat-message-time {
  order: 1;
  margin-left: 0;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-message-receipt {
  order: 2;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-chat-message-role {
  order: 5;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-chat-message-name {
  order: 4;
  margin-left: auto;
}

.dsh-fleet-assistant-private-message[data-self="true"] .dsh-fleet-chat-message-state {
  align-self: flex-end;
}

.dsh-fleet-assistant-private-responding {
  color: var(--dsw-alias-label-secondary);
  align-items: center;
  gap: 10px;
  padding-left: 44px;
  font: var(--dsw-font-xs-13);
  font-size: 12px;
  display: flex;
}

.dsh-fleet-assistant-private-responding::before {
  content: '';
  width: 6px;
  height: 6px;
  background: var(--dsw-alias-state-business-primary);
  border-radius: 50%;
  animation: dsh-fleet-assistant-private-pulse 1.2s ease-in-out infinite alternate;
}

.dsh-fleet-assistant-private-image {
  width: auto;
  max-width: min(100%, 520px);
  max-height: 420px;
  object-fit: contain;
  background: var(--dsw-alias-interactive-bg-hover);
  border-radius: 10px;
  display: block;
}

.dsh-fleet-assistant-private-image-state {
  width: fit-content;
  max-width: 360px;
  min-height: 34px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-interactive-bg-hover);
  border-radius: 8px;
  align-items: center;
  padding: 6px 10px;
  font-size: 12px;
  display: flex;
}

.dsh-fleet-assistant-private-to-bottom {
  width: 34px;
  height: 34px;
  z-index: 5;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: var(--dsw-alias-button-floating-fill);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 50%;
  box-shadow: var(--dsw-shadow-lv2);
  place-items: center;
  padding: 0;
  display: grid;
  position: sticky;
  bottom: 16px;
  align-self: flex-end;
}

.dsh-fleet-assistant-private-to-bottom:hover {
  background: var(--dsw-alias-button-floating-hover);
}

.dsh-fleet-assistant-private-to-bottom:focus-visible,
.dsh-fleet-assistant-private-older:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

[data-conversation-scroll] .dsh-fleet-assistant-private {
  min-height: auto;
  height: auto;
  flex: none;
}

[data-conversation-scroll] .dsh-fleet-assistant-private-scroll {
  min-height: auto;
  flex: none;
  overflow: visible;
}

[data-conversation-scroll] .dsh-fleet-assistant-private[data-team-conversation="true"] {
  min-height: 0;
  height: 100%;
  flex: auto;
}

[data-conversation-scroll] .dsh-fleet-assistant-private[data-team-conversation="true"]
> .dsh-fleet-assistant-private-scroll {
  min-height: 0;
  flex: auto;
  overflow-y: auto;
}

[data-composer-seat]:has(> .dsh-fleet-assistant-work-status) {
  position: relative;
}

.dsh-fleet-assistant-work-status {
  z-index: 5;
  max-width: min(420px, calc(100% - 32px));
  position: absolute;
  top: -32px;
  left: clamp(
    12px,
    calc(50% - var(--dsh-fleet-assistant-composer-width, 760px) / 2 + 12px),
    calc(100% - 220px)
  );
}

.dsh-fleet-assistant-work-status-trigger {
  box-sizing: border-box;
  max-width: 100%;
  min-height: 28px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 4px 6px;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-xs-13, inherit);
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  display: block;
}

.dsh-fleet-assistant-work-status-trigger:hover,
.dsh-fleet-assistant-work-status-trigger[aria-expanded="true"] {
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dsh-fleet-assistant-work-status-trigger:focus-visible {
  color: var(--dsw-alias-label-secondary);
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

@keyframes dsh-fleet-assistant-private-caret {
  50% { opacity: 0; }
}

@keyframes dsh-fleet-assistant-private-pulse {
  from { opacity: .38; transform: scale(.84); }
  to { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-fleet-assistant-private-message[data-streaming="true"] .dsh-fleet-chat-content-text:last-child::after,
  .dsh-fleet-assistant-private-responding::before {
    animation: none;
  }
}

@media (max-width: 640px) {
  .dsh-fleet-assistant-private-width-handle {
    display: none;
  }

  .dsh-fleet-assistant-private-column {
    padding: 18px 12px 22px;
  }

}
`

function installStyles(): void {
  if (typeof document === 'undefined') return
  let style = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_ID}"]`)
  if (style === null) {
    style = document.createElement('style')
    style.dataset.pluginCss = STYLE_ID
    document.head.append(style)
  }
  style.textContent = styles
}

installStyles()

interface ChatNodeStoreLike {
  get(key: string): unknown
}

export interface AgentFleetPrivateChatSnapshot {
  readonly order: readonly string[]
  readonly nodes: ChatNodeStoreLike
  readonly interactions?: readonly AgentFleetInteractionTurn[]
}

export interface AgentFleetPrivateMessage {
  readonly id: string
  readonly sender: 'assistant' | 'operator'
  readonly sentAt: string
  readonly content: readonly FleetChatContentBlock[]
  readonly imageAttachments: ReadonlyMap<string, unknown>
  readonly streaming: boolean
  readonly read?: boolean
}

export interface AgentFleetConversationIdentity {
  readonly assistant: FleetChatMember
  readonly interactions: readonly AgentFleetInteractionTurn[]
  readonly interactionPending: boolean
}

export type AgentFleetWorkStatusId = 'working' | 'waiting' | 'idle' | 'paused' | 'error' | 'unloaded'

export interface AgentFleetWorkStatusGroup {
  readonly id: AgentFleetWorkStatusId
  readonly label: string
  readonly members: readonly FleetRuntimeMember[]
}

function agentFleetMemberWorkStatus(member: FleetRuntimeMember): AgentFleetWorkStatusId {
  if (member.runtimeStatus === 'running' || member.presence === 'busy') return 'working'
  if (member.runtimeStatus === 'waiting' || member.presence === 'waiting') return 'waiting'
  if (member.runtimeStatus === 'error' || member.presence === 'error') return 'error'
  if (member.runtimeStatus === 'paused') return 'paused'
  if (member.runtimeStatus === 'idle' || member.presence === 'active') return 'idle'
  return 'unloaded'
}

export function projectAgentFleetWorkStatuses(
  members: readonly FleetRuntimeMember[],
): readonly AgentFleetWorkStatusGroup[] {
  const statuses: readonly { readonly id: AgentFleetWorkStatusId; readonly label: string }[] = [
    { id: 'working', label: fleetText('工作中', 'Working') },
    { id: 'waiting', label: fleetText('等待中', 'Waiting') },
    { id: 'idle', label: fleetText('空闲', 'Idle') },
    { id: 'paused', label: fleetText('已暂停', 'Paused') },
    { id: 'error', label: fleetText('异常', 'Error') },
    { id: 'unloaded', label: fleetText('未加载', 'Not loaded') },
  ]
  return statuses.flatMap(status => {
    const grouped = members.filter(member => agentFleetMemberWorkStatus(member) === status.id)
    return grouped.length === 0 ? [] : [{ ...status, members: grouped }]
  })
}

export interface AgentFleetInteractionTurn {
  readonly revision: number
  readonly messageId?: string
  readonly input: string
  readonly inputAt: string
  readonly updates?: readonly {
    readonly id: string
    readonly text: string
    readonly sentAt: string
  }[]
  readonly output?: string
  readonly outputAt?: string
}

interface RecordLike {
  readonly [key: string]: unknown
}

function record(value: unknown): RecordLike | undefined {
  return typeof value === 'object' && value !== null ? value as RecordLike : undefined
}

function sentAt(value: unknown): string {
  const time = typeof value === 'number' && Number.isFinite(value) ? value : 0
  return new Date(time).toISOString()
}

function pushText(content: FleetChatContentBlock[], value: unknown): void {
  if (typeof value !== 'string') return
  const previous = content.at(-1)
  if (previous?.type === 'text') {
    content[content.length - 1] = { type: 'text', text: `${previous.text}${value}` }
    return
  }
  content.push({ type: 'text', text: value })
}

function pushImage(
  content: FleetChatContentBlock[],
  attachments: Map<string, unknown>,
  attachmentValue: unknown,
): void {
  const attachment = record(attachmentValue)
  if (attachment === undefined || typeof attachment.attachmentId !== 'string') return
  const mediaType = attachment.mediaType
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg'
    && mediaType !== 'image/webp' && mediaType !== 'image/gif') return
  const attachmentId = attachment.attachmentId
  const image: FleetChatImageBlock = {
    type: 'image',
    attachmentId,
    mediaType,
    ...(typeof attachment.name === 'string' ? { name: attachment.name } : {}),
    ...(typeof attachment.bytes === 'number' ? { bytes: attachment.bytes } : {}),
    ...(typeof attachment.width === 'number' ? { width: attachment.width } : {}),
    ...(typeof attachment.height === 'number' ? { height: attachment.height } : {}),
  }
  attachments.set(attachmentId, attachmentValue)
  content.push(image)
}

function visibleUserContent(value: unknown): {
  readonly content: readonly FleetChatContentBlock[]
  readonly attachments: ReadonlyMap<string, unknown>
} {
  const content: FleetChatContentBlock[] = []
  const attachments = new Map<string, unknown>()
  if (!Array.isArray(value)) return { content, attachments }
  for (const candidate of value) {
    const block = record(candidate)
    if (block?.type === 'text') pushText(content, block.text)
    else if (block?.type === 'image') pushImage(content, attachments, block.attachment)
  }
  return { content, attachments }
}

function visibleAssistantContent(value: unknown): {
  readonly content: readonly FleetChatContentBlock[]
  readonly attachments: ReadonlyMap<string, unknown>
} {
  const content: FleetChatContentBlock[] = []
  const attachments = new Map<string, unknown>()
  if (!Array.isArray(value)) return { content, attachments }
  for (const candidate of value) {
    const block = record(candidate)
    if (block?.kind === 'text') pushText(content, block.text)
    else if (block?.kind === 'image') pushImage(content, attachments, block.attachment)
  }
  return { content, attachments }
}

/** Human-facing DM projection. Internal reasoning, tools, commands and injected context never enter it. */
export function projectAgentFleetPrivateMessages(
  snapshot: AgentFleetPrivateChatSnapshot,
): readonly AgentFleetPrivateMessage[] {
  if (snapshot.interactions !== undefined) {
    const users = new Map<string, {
      readonly content: readonly FleetChatContentBlock[]
      readonly attachments: ReadonlyMap<string, unknown>
    }>()
    for (const key of snapshot.order) {
      const node = record(snapshot.nodes.get(key))
      if (node === undefined || node.visibility === 'hidden'
        || (node.kind !== 'user' && node.kind !== 'steering')) continue
      const data = record(node.data)
      if (data === undefined) continue
      const id = typeof node.id === 'string' ? node.id : key
      users.set(id, visibleUserContent(data.content))
    }
    return snapshot.interactions.flatMap(turn => {
      const native = turn.messageId === undefined ? undefined : users.get(turn.messageId)
      const inputContent = native?.content.some(block => block.type !== 'text' || block.text.trim().length > 0) === true
        ? native.content
        : [{ type: 'text' as const, text: turn.input }]
      const input: AgentFleetPrivateMessage = {
        id: `interaction:${String(turn.revision)}:user`,
        sender: 'operator',
        sentAt: turn.inputAt,
        content: inputContent,
        imageAttachments: native?.attachments ?? new Map(),
        streaming: false,
        read: true,
      }
      const updates: AgentFleetPrivateMessage[] = (turn.updates ?? []).flatMap(update => {
        const text = update.text.trim()
        if (text.length === 0) return []
        return [{
          id: `interaction:${String(turn.revision)}:update:${update.id}`,
          sender: 'assistant' as const,
          sentAt: update.sentAt,
          content: [{ type: 'text' as const, text }],
          imageAttachments: new Map(),
          streaming: false,
        }]
      })
      const output = turn.output?.trim()
      if (output === undefined || output.length === 0) return [input, ...updates]
      return [input, ...updates, {
        id: `interaction:${String(turn.revision)}:assistant`,
        sender: 'assistant' as const,
        sentAt: turn.outputAt ?? turn.inputAt,
        content: [{ type: 'text' as const, text: output }],
        imageAttachments: new Map(),
        streaming: false,
      }]
    })
  }
  const messages: AgentFleetPrivateMessage[] = []
  for (const key of snapshot.order) {
    const node = record(snapshot.nodes.get(key))
    if (node === undefined || node.visibility === 'hidden') continue
    const data = record(node.data)
    if (data === undefined) continue

    if (node.kind === 'fleet-meta-welcome') {
      const text = typeof data.text === 'string' ? data.text : ''
      if (text === '' && data.streaming !== true) continue
      messages.push({
        id: key,
        sender: 'assistant',
        sentAt: sentAt(data.time),
        content: [{ type: 'text', text }],
        imageAttachments: new Map(),
        streaming: data.streaming === true,
      })
      continue
    }

    if (node.kind === 'user' || node.kind === 'steering') {
      const visible = visibleUserContent(data.content)
      if (visible.content.length === 0) continue
      messages.push({
        // Projection keys identify rendered nodes; Fleet delivery receipts carry the
        // durable native UserMessage id exposed on the node itself.
        id: typeof node.id === 'string' ? node.id : key,
        sender: 'operator',
        sentAt: sentAt(data.time),
        content: visible.content,
        imageAttachments: visible.attachments,
        streaming: false,
        // Native user/steering nodes are durable only after the Agent loop claims
        // the inbox item. Messages still waiting for a turn remain in the queue.
        read: true,
      })
      continue
    }

    if (node.kind === 'assistant-step') {
      const visible = visibleAssistantContent(data.blocks)
      const streaming = data.status === 'running'
      const hasVisibleContent = visible.content.some(block =>
        block.type !== 'text' || block.text.trim().length > 0)
      if (!hasVisibleContent && !streaming) continue
      messages.push({
        id: key,
        sender: 'assistant',
        sentAt: sentAt(data.time),
        content: hasVisibleContent ? visible.content : [{ type: 'text', text: '' }],
        imageAttachments: visible.attachments,
        streaming,
      })
    }
  }
  return messages
}

type FleetSnapshotSelectorHook = <Selection>(
  selector: (snapshot: any) => Selection,
  equality?: (left: Selection, right: Selection) => boolean,
) => Selection

interface AgentFleetPrivateChatProps {
  readonly useSession: FleetSnapshotSelectorHook
  readonly loadOlder: () => void
  readonly loadImage: (attachment: unknown) => Promise<string>
  readonly renderText?: (text: string) => ReactNode
  readonly renderContext: () => ReactNode
  /** Team identity decorating this native user-assistant Session. It never replaces Session history with Fleet messages. */
  readonly identity?: AgentFleetConversationIdentity
  readonly openMemberDetails?: () => void
  readonly openMemberContext?: () => void
}

interface PendingPrivateMessage {
  readonly id: string
  readonly content: readonly FleetChatContentBlock[]
  readonly imageAttachments: ReadonlyMap<string, unknown>
  readonly sentAt: string
}

function FleetPrivateImage({ image, attachment, loadImage }: {
  readonly image: FleetChatImageBlock
  readonly attachment: unknown
  readonly loadImage: (attachment: unknown) => Promise<string>
}): ReactElement {
  const [state, setState] = useState<{ readonly url?: string; readonly error?: true }>({})
  useEffect(() => {
    let live = true
    setState({})
    void loadImage(attachment).then(
      url => { if (live) setState({ url }) },
      () => { if (live) setState({ error: true }) },
    )
    return () => { live = false }
  }, [attachment, loadImage])

  if (state.url !== undefined) {
    return jsx('img', {
      className: 'dsh-fleet-assistant-private-image',
      src: state.url,
      alt: image.name ?? '',
      ...(image.width === undefined ? {} : { width: image.width }),
      ...(image.height === undefined ? {} : { height: image.height }),
    })
  }
  return jsx('span', {
    className: 'dsh-fleet-assistant-private-image-state',
    role: state.error === true ? 'alert' : 'status',
    children: state.error === true
      ? (image.name ?? fleetText('图片无法载入', 'Image could not be loaded'))
      : (image.name ?? fleetText('正在载入图片…', 'Loading image…')),
  })
}

function scrollContainer(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>('[data-conversation-scroll]') ?? element
}

function DownChevron(): ReactElement {
  return jsx('svg', {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': 'true',
    children: jsx('path', {
      d: 'm4 6 4 4 4-4',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  })
}

function BackChevron(): ReactElement {
  return jsx('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': 'true',
    children: jsx('path', {
      d: 'm10 4-4 4 4 4',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  })
}

function AgentFleetAvatarPopover({ member, running, showDetails, showContext }: {
  readonly member: FleetChatMember
  readonly running: boolean
  readonly showDetails: () => void
  readonly showContext: () => void
}): ReactElement {
  const profile = {
    ...member,
    presence: running ? 'busy' as const : 'active' as const,
    runtimeStatus: running ? 'running' as const : 'idle' as const,
  }
  return jsx(FleetMemberPopover, {
    member: profile,
    className: 'dsh-fleet-panel-member-avatar-anchor',
    responsibility: fleetText(
      '帮助用户观察、了解并接入 Fleet 团队，不承担团队的中心协调。',
      'Helps the user observe, understand, and connect to Fleet Teams without becoming their central coordinator.',
    ),
    statusLabel: running ? fleetText('工作中', 'Working') : fleetText('在线', 'Online'),
    showDetails: () => { showDetails() },
    showContext: () => { showContext() },
    trigger: (interaction: FleetMemberPopoverTriggerProps) => jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-member-avatar-trigger',
        'aria-label': fleetText('查看 Agent Fleet 的资料', 'View Agent Fleet profile'),
        ...interaction,
        children: jsx(FleetChatAvatar, { member: profile }),
      }),
  })
}

export function AgentFleetWorkStatus({ members }: { readonly members: readonly FleetRuntimeMember[] }): ReactElement | null {
  const groups = projectAgentFleetWorkStatuses(members)
  if (groups.length === 0) return null
  const working = groups.find(group => group.id === 'working')?.members ?? []
  const summary = working.length === 0
    ? fleetText('团队空闲', 'Team idle')
    : working.length === 1
      ? fleetText(`${working[0]?.name ?? ''} 正在工作`, `${working[0]?.name ?? ''} is working`)
      : fleetText(
          `${working[0]?.name ?? ''} 等 ${String(working.length)} 位成员正在工作`,
          `${working[0]?.name ?? ''} and ${String(working.length - 1)} others are working`,
        )
  return jsx(FleetChatMemberStatusPopover, {
    groups: groups.map(group => ({
      id: group.id,
      label: `${group.label} · ${String(group.members.length)}`,
      members: group.members,
    })),
    ariaLabel: fleetText('团队成员运行状态', 'Team member runtime status'),
    mode: 'hover',
    placement: 'below-start',
    hideEmptyGroups: true,
    className: 'dsh-fleet-assistant-work-status',
    trigger: (interaction: FleetChatMemberStatusPopoverTriggerProps) => jsx('button', {
      ...interaction,
      type: 'button',
      className: 'dsh-fleet-assistant-work-status-trigger',
      'aria-label': fleetText(`${summary}，查看成员状态`, `${summary}; view member status`),
      children: summary,
    }),
  })
}

function OperatorAvatarPopover({ member }: { readonly member: FleetOperatorProfile }): ReactElement {
  return jsx(FleetMemberPopover, {
    member,
    className: 'dsh-fleet-panel-member-avatar-anchor',
    responsibility: member.responsibility,
    statusLabel: fleetText('在线', 'Online'),
    editProfile: updateFleetOperatorProfile,
    trigger: (interaction: FleetMemberPopoverTriggerProps) => jsx('button', {
      type: 'button',
      className: 'dsh-fleet-panel-member-avatar-trigger',
      'aria-label': fleetText('查看或编辑你的资料', 'View or edit your profile'),
      ...interaction,
      children: jsx(FleetChatAvatar, { member }),
    }),
  })
}

function AgentFleetSubviewHeader({ title, back }: {
  readonly title: string
  readonly back: () => void
}): ReactElement {
  return jsxs('header', {
    className: 'dsh-fleet-assistant-private-subview-head',
    children: [
      jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-assistant-private-back',
        onClick: back,
        children: [jsx(BackChevron, {}), jsx('span', { children: fleetText('返回私聊', 'Back to chat') })],
      }),
      jsx('h2', { className: 'dsh-fleet-assistant-private-subview-title', children: title }),
    ],
  })
}

function AgentFleetDetails({ member, running, back }: {
  readonly member: FleetChatMember
  readonly running: boolean
  readonly back: () => void
}): ReactElement {
  const facts = [
    [fleetText('当前状态', 'Current status'), running ? fleetText('工作中', 'Working') : fleetText('在线', 'Online')],
    [fleetText('身份', 'Identity'), member.role],
    [fleetText('会话', 'Session'), fleetText('持久 Agent Fleet 会话', 'Persistent Agent Fleet Session')],
    [fleetText('协作边界', 'Collaboration boundary'), fleetText('外部观察与接入，不参与团队投票', 'External observation and access; does not participate in Team votes')],
  ] as const
  return jsxs('section', {
    className: 'dsh-fleet-assistant-private',
    'data-surface': 'details',
    children: [
      jsx(AgentFleetSubviewHeader, { title: fleetText('Agent Fleet 详细信息', 'Agent Fleet details'), back }),
      jsx('div', {
        className: 'dsh-fleet-assistant-private-subview-body',
        children: jsxs('div', {
          className: 'dsh-fleet-assistant-private-profile',
          children: [
            jsx('h3', { className: 'dsh-fleet-assistant-private-profile-title', children: member.name }),
            jsx('p', {
              className: 'dsh-fleet-assistant-private-profile-copy',
              children: fleetText(
                '帮助用户观察、了解并接入 Fleet 团队。助理不会成为团队的中心协调者，团队在没有用户参与时仍可独立运行。',
                'Helps the user observe, understand, and connect to Fleet Teams. The assistant does not become the Team’s central coordinator, and the Team can continue independently without user participation.',
              ),
            }),
            jsx('div', {
              className: 'dsh-fleet-assistant-private-profile-facts',
              children: facts.map(([label, value]) => jsxs('div', {
                className: 'dsh-fleet-assistant-private-profile-fact',
                children: [
                  jsx('span', { className: 'dsh-fleet-assistant-private-profile-label', children: label }),
                  jsx('span', { className: 'dsh-fleet-assistant-private-profile-value', children: value }),
                ],
              }, label)),
            }),
          ],
        }),
      }),
    ],
  })
}

export function AgentFleetPrivateChat({
  useSession,
  loadOlder,
  loadImage,
  renderText,
  renderContext,
  identity,
  openMemberDetails,
  openMemberContext,
}: AgentFleetPrivateChatProps): ReactElement {
  const order = useSession(source => source.chat.order) as readonly string[]
  const nodes = useSession(source => source.chat.nodes) as ChatNodeStoreLike
  const queue = useSession(source => source.queue) as readonly unknown[]
  const nativeRunning = useSession(source => source.running) as boolean
  const nativeOpenState = useSession(source => source.openState) as string
  const nativeHasMore = useSession(source => source.hasMore) as boolean
  const nativeLoadingOlder = useSession(source => source.loadingOlder) as boolean
  const operatorProfile = useFleetOperatorProfile()
  const [surface, setSurface] = useState<'chat' | 'details' | 'context'>('chat')
  const messages = useMemo(() => projectAgentFleetPrivateMessages({
    order,
    nodes,
    ...(identity === undefined ? {} : { interactions: identity.interactions }),
  }), [identity?.interactions, nodes, order])
  const pendingTimes = useRef(new Map<string, string>())
  const nativePending = useMemo<readonly PendingPrivateMessage[]>(() => queue.flatMap(candidate => {
    const item = record(candidate)
    if (item?.placement !== 'steering' || typeof item.id !== 'string') return []
    const visible = visibleUserContent(item.content)
    if (visible.content.length === 0) return []
    let time = pendingTimes.current.get(item.id)
    if (time === undefined) {
      time = new Date().toISOString()
      pendingTimes.current.set(item.id, time)
    }
    return [{ id: `pending:${item.id}`, content: visible.content, imageAttachments: visible.attachments, sentAt: time }]
  }), [queue])
  const pending = nativePending

  const defaultAssistant: FleetChatMember = {
    id: 'agent-fleet',
    name: 'Agent Fleet',
    role: useFleetMetaText('assistant.direct.role'),
    color: '#4f76c7',
    presence: nativeRunning ? 'busy' : 'active',
  }
  const assistant = identity?.assistant ?? defaultAssistant
  const operator = operatorProfile
  const running = identity?.interactionPending ?? nativeRunning
  const openState = nativeOpenState
  const hasMore = identity === undefined && nativeHasMore
  const loadingOlder = identity === undefined && nativeLoadingOlder
  const globalEmpty = useFleetMetaText('assistant.empty')
  const teamEmpty = useFleetMetaText('assistant.empty.team')
  const empty = identity === undefined ? globalEmpty : teamEmpty.replace('{name}', () => assistant.name)
  const responding = useFleetMetaText('assistant.responding')
  const loading = useFleetMetaText('assistant.loading')
  const loadOlderLabel = useFleetMetaText('assistant.loadOlder')
  const loadError = useFleetMetaText('assistant.loadError')
  const resizeLabel = useFleetMetaText('assistant.resize')
  const root = useRef<HTMLDivElement>(null)
  const column = useFleetChatColumnWidth(root)
  const atBottom = useRef(true)
  const [showToBottom, setShowToBottom] = useState(false)
  const visibleRunningMessage = messages.some(message => message.sender === 'assistant' && message.streaming)
  const signature = `${messages.map(message => `${message.id}:${message.content.map(block => block.type === 'text' ? block.text.length : block.type).join(',')}:${'streaming' in message && message.streaming ? 1 : 0}`).join('|')}|${pending.map(message => message.id).join('|')}|${running ? 1 : 0}`

  const moveToBottom = (): void => {
    const local = root.current
    if (local === null) return
    const scroller = scrollContainer(local)
    scroller.scrollTop = scroller.scrollHeight
    atBottom.current = true
    setShowToBottom(false)
  }

  useLayoutEffect(() => {
    const local = root.current
    if (local === null || !atBottom.current) return
    moveToBottom()
  }, [signature])

  useEffect(() => {
    const local = root.current
    if (local === null) return
    const scroller = scrollContainer(local)
    const onScroll = (): void => {
      const next = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 28
      atBottom.current = next
      setShowToBottom(!next)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { scroller.removeEventListener('scroll', onScroll) }
  }, [])

  const renderImage = (message: AgentFleetPrivateMessage | PendingPrivateMessage) => (image: FleetChatImageBlock): ReactNode => {
    const attachment = 'imageAttachments' in message
      ? message.imageAttachments.get(image.attachmentId)
      : undefined
    if (attachment === undefined) return undefined
    return jsx(FleetPrivateImage, { image, attachment, loadImage })
  }

  if (surface === 'details') {
    return jsx(AgentFleetDetails, {
      member: assistant,
      running,
      back: () => { setSurface('chat') },
    })
  }
  if (surface === 'context') {
    return jsxs('section', {
      className: 'dsh-fleet-assistant-private',
      'data-surface': 'context',
      children: [
        jsx(AgentFleetSubviewHeader, {
          title: fleetText('Agent Fleet 上下文', 'Agent Fleet context'),
          back: () => { setSurface('chat') },
        }),
        jsx('div', {
          className: 'dsh-fleet-assistant-private-subview-body',
          'data-conversation-scroll': '',
          children: renderContext(),
        }),
      ],
    })
  }

  return jsxs('section', {
    ref: root,
    className: 'dsh-fleet-assistant-private',
    'data-surface': 'chat',
    'data-agent-fleet-private-chat': '',
    'data-team-conversation': identity === undefined ? undefined : 'true',
    'data-column-resizing': column.resizing ? 'true' : undefined,
    style: { '--dsh-fleet-assistant-chat-column-width': `${column.width}px` },
    children: [
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-assistant-private-width-handle',
        'data-dragging': column.resizing ? 'true' : undefined,
        'aria-label': resizeLabel,
        title: resizeLabel,
        ...column.handle,
      }),
      jsx('div', {
        className: 'dsh-fleet-assistant-private-scroll',
        children: jsxs('div', {
          className: 'dsh-fleet-assistant-private-column',
          role: 'log',
          'aria-live': 'polite',
          children: [
            openState === 'loading' && jsx('div', {
              className: 'dsh-fleet-assistant-private-history-state',
              children: loading,
            }),
            openState === 'error' && jsx('div', {
              className: 'dsh-fleet-assistant-private-history-state',
              'data-error': 'true',
              role: 'alert',
              children: loadError,
            }),
            hasMore && jsx('button', {
              type: 'button',
              className: 'dsh-fleet-assistant-private-older',
              disabled: loadingOlder,
              onClick: loadOlder,
              children: loadingOlder ? loading : loadOlderLabel,
            }),
            messages.length === 0 && pending.length === 0 && openState === 'open' && jsx('div', {
              className: 'dsh-fleet-assistant-private-empty',
              children: empty,
            }),
            ...messages.map(message => {
              const projectedSender = message.sender === 'assistant' ? assistant : operator
              const sender = projectedSender.operator === true ? operator : projectedSender
              const self = sender.operator === true
              const streaming = message.streaming
              const receipt = message.sender === 'operator'
                ? message.read === true
                  ? { readMembers: [assistant], unreadMembers: [] }
                  : { readMembers: [], unreadMembers: [assistant] }
                : undefined
              return jsx('div', {
              className: 'dsh-fleet-assistant-private-message',
              'data-streaming': streaming ? 'true' : 'false',
              'data-self': self ? 'true' : 'false',
              children: jsx(FleetChatMessage, {
                id: message.id,
                sender,
                sentAt: message.sentAt,
                content: message.content,
                ...(receipt === undefined ? {} : { receipt }),
                avatar: self
                  ? jsx(OperatorAvatarPopover, { member: operator })
                  : jsx(AgentFleetAvatarPopover, {
                    member: sender,
                    running,
                    showDetails: openMemberDetails ?? (() => { setSurface('details') }),
                    showContext: openMemberContext ?? (() => { setSurface('context') }),
                  }),
                renderText,
                renderImage: renderImage(message),
              }),
            }, message.id)
            }),
            ...pending.map(message => jsx('div', {
              className: 'dsh-fleet-assistant-private-message',
              'data-self': 'true',
              children: jsx(FleetChatMessage, {
                id: message.id,
                sender: operator,
                sentAt: message.sentAt,
                content: message.content,
                deliveryState: 'sending',
                avatar: jsx(OperatorAvatarPopover, { member: operator }),
                renderText,
                renderImage: renderImage(message),
              }),
            }, message.id)),
            running && !visibleRunningMessage && jsx('div', {
              className: 'dsh-fleet-assistant-private-responding',
              role: 'status',
              children: responding,
            }),
            showToBottom && jsx('button', {
              type: 'button',
              className: 'dsh-fleet-assistant-private-to-bottom',
              'aria-label': 'Scroll to latest message',
              onClick: moveToBottom,
              children: jsx(DownChevron, {}),
            }),
          ],
        }),
      }),
    ],
  })
}
