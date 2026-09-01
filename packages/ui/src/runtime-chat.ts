import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { HoverHint, type HoverHintProps, type HoverHintTriggerProps } from 'dsh-hover-hint'
import { useFleetAnchoredPopover } from './anchored-popover.js'
import { fleetText } from './locale.js'

export function FleetInfoHint(props: HoverHintProps): ReactElement {
  return jsx(HoverHint, props)
}

const RUNTIME_CHAT_STYLE_ID = 'dsh-agent-fleet-runtime-chat'

const runtimeChatStyles = `
.dsh-fleet-conversation-header {
  box-sizing: border-box;
  min-width: 0;
  min-height: 52px;
  color: var(--dsw-alias-label-primary);
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  display: flex;
}

.dsh-fleet-conversation-header-mark {
  width: 30px;
  height: 30px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-interactive-bg-hover);
  border-radius: 9px;
  flex: none;
  place-items: center;
  font-size: 17px;
  font-weight: 560;
  line-height: 1;
  display: grid;
}

.dsh-fleet-conversation-header-copy {
  min-width: 0;
  flex: 1;
}

.dsh-fleet-conversation-header-title-row {
  min-width: 0;
  align-items: baseline;
  gap: 7px;
  display: flex;
}

.dsh-fleet-conversation-header-title {
  min-width: 0;
  margin: 0;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-s-strong-14);
  overflow: hidden;
}

.dsh-fleet-conversation-header-kind,
.dsh-fleet-conversation-header-description,
.dsh-fleet-conversation-header-meta {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-conversation-header-kind {
  flex: none;
  font-size: 11px;
}

.dsh-fleet-conversation-header-description {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-conversation-header-meta {
  flex: none;
}

.dsh-fleet-conversation-header-members {
  display: inline-flex;
  position: relative;
}

.dsh-fleet-conversation-header-members-trigger {
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  font: inherit;
  line-height: inherit;
  white-space: nowrap;
  display: inline-flex;
}

.dsh-fleet-conversation-header-members-metric {
  align-items: baseline;
  gap: 3px;
  display: inline-flex;
}

.dsh-fleet-conversation-header-members-count {
  min-width: 2ch;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.dsh-fleet-conversation-header-members-trigger:hover,
.dsh-fleet-conversation-header-members-trigger[aria-expanded="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-conversation-header-members-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-presence-label {
  min-width: 0;
  align-items: center;
  gap: 3px;
  display: inline-flex;
}

.dsh-fleet-presence-hint-trigger {
  min-width: 0;
  color: inherit;
  cursor: default;
  background: transparent;
  border: 0;
  border-radius: 4px;
  padding: 0;
  font: inherit;
  line-height: inherit;
  text-align: inherit;
}

.dsh-fleet-presence-hint-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-chat-avatar {
  box-sizing: border-box;
  width: var(--dsh-fleet-avatar-size, 34px);
  height: var(--dsh-fleet-avatar-size, 34px);
  color: var(--dsh-fleet-avatar-foreground, #fff);
  background: var(--dsh-fleet-avatar-color, #527fca);
  border-radius: calc(var(--dsh-fleet-avatar-size, 34px) * .29);
  flex: none;
  place-items: center;
  font-size: calc(var(--dsh-fleet-avatar-size, 34px) * .34);
  font-weight: 650;
  line-height: 1;
  letter-spacing: -.01em;
  display: inline-grid;
  position: relative;
  user-select: none;
}

.dsh-fleet-chat-avatar-image {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
  display: block;
}

.dsh-fleet-chat-avatar-status {
  box-sizing: border-box;
  width: 9px;
  height: 9px;
  background: var(--dsw-alias-label-caption);
  border: 2px solid var(--dsw-alias-bg-layer-1);
  border-radius: 50%;
  position: absolute;
  right: -2px;
  bottom: -2px;
}

.dsh-fleet-chat-avatar-status[data-status="active"] {
  background: var(--dsw-alias-state-success-primary, #4f9a6e);
}

.dsh-fleet-chat-avatar-status[data-status="busy"] {
  background: var(--dsw-alias-state-warning-primary, #c38b36);
}

.dsh-fleet-chat-avatar-status[data-status="waiting"] {
  background: var(--dsw-alias-state-business-primary, #4f76c7);
}

.dsh-fleet-chat-avatar-status[data-status="error"] {
  background: var(--dsw-alias-state-error-primary, #d14d4d);
}

.dsh-fleet-chat-avatar-status[data-status="offline"] {
  background: var(--dsw-alias-label-quaternary, #a7a7a7);
}

.dsh-fleet-chat-message {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  grid-template-columns: 34px minmax(0, 1fr);
  column-gap: 10px;
  display: grid;
}

.dsh-fleet-chat-message-main {
  min-width: 0;
}

.dsh-fleet-chat-message-meta {
  min-width: 0;
  align-items: baseline;
  gap: 7px;
  margin-bottom: 2px;
  display: flex;
}

.dsh-fleet-chat-message-sender,
.dsh-fleet-chat-message-delivery {
  min-width: 0;
  align-items: baseline;
  gap: 7px;
  display: flex;
}

.dsh-fleet-chat-message-sender {
  flex: 0 1 auto;
}

.dsh-fleet-chat-message-sender .dsh-fleet-chat-message-name {
  max-width: min(220px, 40vw);
}

.dsh-fleet-chat-message-delivery {
  flex: 1;
}

.dsh-fleet-chat-message-name {
  min-width: 0;
  max-width: 45%;
  color: var(--dsw-alias-label-primary);
  flex: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-s-strong-14);
  overflow: hidden;
}

.dsh-fleet-chat-message-role,
.dsh-fleet-chat-message-time,
.dsh-fleet-chat-message-state {
  color: var(--dsw-alias-label-secondary);
  flex: none;
  font: var(--dsw-font-xs-13);
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-chat-message-role {
  min-width: 0;
  flex: 0 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-chat-message-time {
  margin-left: 2px;
}

.dsh-fleet-chat-message-actions {
  align-items: center;
  gap: 4px;
  margin-left: auto;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease-out;
  display: flex;
}

.dsh-fleet-chat-message-actions:empty {
  display: none;
}

.dsh-fleet-message-receipt {
  flex: none;
  align-self: center;
  align-items: center;
  display: inline-flex;
  position: relative;
  transform: translateY(1px);
}

.dsh-fleet-message-receipt-trigger {
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 50%;
  place-items: center;
  padding: 2px;
  display: grid;
  position: relative;
}

.dsh-fleet-message-receipt-trigger:hover,
.dsh-fleet-message-receipt-trigger[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-message-receipt-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-message-receipt-trigger::after {
  content: attr(data-summary);
  z-index: 5;
  width: max-content;
  max-width: min(220px, calc(100vw - 24px));
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  box-shadow: var(--dsw-shadow-lv1);
  opacity: 0;
  padding: 5px 8px;
  pointer-events: none;
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  transition: opacity 100ms ease-out;
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
}

.dsh-fleet-message-receipt-trigger:hover:not([aria-expanded="true"])::after,
.dsh-fleet-message-receipt-trigger:focus-visible:not([aria-expanded="true"])::after {
  opacity: 1;
  transition-delay: 320ms;
}

.dsh-hover-hint[data-revealed="true"] .dsh-fleet-message-receipt-trigger::after {
  opacity: 0;
  transition-delay: 0ms;
}

.dsh-fleet-message-receipt-indicator {
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  color: color-mix(in srgb, var(--dsw-alias-label-secondary) 84%, transparent);
  border: 1.25px solid currentColor;
  border-radius: 50%;
  place-items: center;
  display: grid;
}

.dsh-fleet-message-receipt-pie {
  width: 8px;
  height: 8px;
  background: conic-gradient(
    currentColor var(--dsh-fleet-read-angle, 0deg),
    transparent 0
  );
  border-radius: 50%;
  display: block;
}

.dsh-fleet-message-receipt-popover {
  box-sizing: border-box;
  width: min(600px, calc(100vw - 24px));
  max-height: min(360px, calc(100vh - 24px));
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgb(24 39 57 / 18%), 0 2px 8px rgb(24 39 57 / 8%);
  margin: 0;
  padding: 12px;
  position: fixed;
  inset: auto;
  overflow: auto;
}

.dsh-fleet-message-receipt-popover::backdrop {
  background: transparent;
}

.dsh-fleet-message-receipt-columns {
  min-width: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  display: grid;
}

.dsh-fleet-channel-members-popover {
  width: min(430px, calc(100vw - 24px));
}

.dsh-fleet-channel-members-popover .dsh-fleet-message-receipt-columns {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.dsh-fleet-message-receipt-column {
  min-width: 0;
}

.dsh-fleet-message-receipt-column + .dsh-fleet-message-receipt-column {
  border-left: 1px solid var(--dsw-alias-border-l3);
  padding-inline: 8px 0;
}

.dsh-fleet-message-receipt-heading {
  margin: 0 0 7px;
  padding-inline: 4px;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-strong-13, var(--dsw-font-xs-13));
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-message-receipt-members {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-fleet-message-receipt-member-seat + .dsh-fleet-message-receipt-member-seat {
  margin-top: 3px;
}

.dsh-fleet-message-receipt-member-seat {
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 4px;
  padding-inline-end: 4px;
  display: flex;
  position: relative;
}

.dsh-fleet-message-receipt-blocker {
  flex-basis: 100%;
  margin: -1px 4px 6px 40px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 15px;
  overflow-wrap: anywhere;
}

.dsh-fleet-message-receipt-member {
  box-sizing: border-box;
  width: auto;
  min-width: 0;
  min-height: 38px;
  align-items: center;
  flex: 1;
  gap: 8px;
  padding: 4px;
  display: flex;
}

.dsh-fleet-message-receipt-member-copy {
  min-width: 0;
  flex: 1;
  text-align: left;
}

.dsh-fleet-message-receipt-member-name,
.dsh-fleet-message-receipt-member-role {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  display: block;
}

.dsh-fleet-message-receipt-member-name {
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-strong-13, var(--dsw-font-xs-13));
  font-size: 12px;
  line-height: 17px;
}

.dsh-fleet-message-receipt-member-seat:has(.dsh-fleet-message-receipt-source)
  .dsh-fleet-message-receipt-member-name {
  padding-inline-end: 58px;
}

.dsh-fleet-message-receipt-member-role,
.dsh-fleet-message-receipt-empty {
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 14px;
}

.dsh-fleet-message-receipt-empty {
  padding: 5px 4px 7px;
}

.dsh-fleet-message-receipt-source {
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 5px;
  z-index: 1;
  padding: 0 5px;
  font: var(--dsw-font-xs-13, inherit);
  font-size: 12px;
  line-height: 17px;
  white-space: nowrap;
  position: absolute;
  inset-block-start: 4px;
  inset-inline-end: 4px;
}

.dsh-fleet-message-receipt-source:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-message-receipt-check {
  width: 8px;
  height: 8px;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
  display: block;
}

.dsh-fleet-chat-message:hover .dsh-fleet-chat-message-actions,
.dsh-fleet-chat-message:focus-within .dsh-fleet-chat-message-actions {
  opacity: 1;
  pointer-events: auto;
}

.dsh-fleet-chat-message-body {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
  font-size: 14px;
  line-height: 1.55;
}

.dsh-fleet-chat-content {
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  display: flex;
}

.dsh-fleet-chat-content-text {
  white-space: pre-wrap;
}

.dsh-fleet-chat-content-image {
  min-width: 0;
}

.dsh-fleet-chat-content-mention {
  width: fit-content;
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
  border-radius: 5px;
  padding-inline: 4px;
  font: inherit;
}

.dsh-fleet-chat-content-resource,
.dsh-fleet-chat-content-image-fallback {
  box-sizing: border-box;
  width: fit-content;
  max-width: min(100%, 360px);
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  font: inherit;
  text-align: left;
  display: inline-flex;
}

button.dsh-fleet-chat-content-resource {
  cursor: pointer;
}

button.dsh-fleet-chat-content-resource:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

button.dsh-fleet-chat-content-resource:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-chat-content-resource-mark {
  width: 22px;
  height: 22px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 5px;
  flex: none;
  place-items: center;
  font-size: 10px;
  font-weight: 650;
  display: grid;
}

.dsh-fleet-chat-content-resource-copy {
  min-width: 0;
  flex: 1;
  flex-direction: column;
  display: flex;
}

.dsh-fleet-chat-content-resource-name,
.dsh-fleet-chat-content-resource-meta {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-chat-content-resource-name {
  font-size: 12px;
  line-height: 16px;
}

.dsh-fleet-chat-content-resource-meta {
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 14px;
}

.dsh-fleet-chat-message[data-operator="true"] .dsh-fleet-chat-message-name::after {
  color: var(--dsw-alias-state-business-primary);
  content: attr(data-operator-label);
  margin-left: 6px;
  font-size: 10px;
  font-weight: 560;
}

.dsh-fleet-chat-message-state {
  margin-top: 3px;
}

.dsh-fleet-chat-message-state[data-state="failed"] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-chat-comments {
  min-width: 0;
  margin-top: 10px;
  padding-top: 8px;
  position: relative;
}

.dsh-fleet-chat-comments::before {
  width: 100%;
  height: 1px;
  background: var(--dsw-alias-border-l3);
  content: "";
  position: absolute;
  inset: 0 0 auto;
}

.dsh-fleet-chat-comments-heading {
  margin-bottom: 7px;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-strong-13, var(--dsw-font-xs-13));
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-chat-comments-list {
  min-width: 0;
  flex-direction: column;
  gap: 9px;
  display: flex;
}

.dsh-fleet-chat-comment {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  grid-template-columns: 24px minmax(0, 1fr);
  column-gap: 8px;
  display: grid;
}

.dsh-fleet-chat-comment-main {
  min-width: 0;
}

.dsh-fleet-chat-comment-meta {
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 1px;
  font-size: 11px;
  line-height: 16px;
  display: flex;
}

.dsh-fleet-chat-comment-name {
  min-width: 0;
  max-width: min(220px, 42vw);
  color: var(--dsw-alias-label-primary);
  flex: 0 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  overflow: hidden;
}

.dsh-fleet-chat-comment[data-operator="true"] .dsh-fleet-chat-comment-name::after {
  color: var(--dsw-alias-state-business-primary);
  content: attr(data-operator-label);
  margin-left: 5px;
  font-size: 10px;
  font-weight: 560;
}

.dsh-fleet-chat-comment-role {
  min-width: 0;
  flex: 0 1 auto;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-chat-comment-time {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.dsh-fleet-chat-comment-actions {
  align-items: center;
  gap: 4px;
  margin-left: auto;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease-out;
  display: flex;
}

.dsh-fleet-chat-comment-actions:empty {
  display: none;
}

.dsh-fleet-chat-comment:hover .dsh-fleet-chat-comment-actions,
.dsh-fleet-chat-comment:focus-within .dsh-fleet-chat-comment-actions {
  opacity: 1;
  pointer-events: auto;
}

.dsh-fleet-chat-comment-body {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.5;
}

.dsh-fleet-chat-divider {
  color: var(--dsw-alias-label-secondary);
  align-items: center;
  gap: 10px;
  margin-block: 2px;
  font: var(--dsw-font-xs-13);
  font-size: 11px;
  display: flex;
}

.dsh-fleet-chat-divider::before,
.dsh-fleet-chat-divider::after {
  height: 1px;
  background: var(--dsw-alias-border-l3);
  content: "";
  flex: 1;
}

.dsh-fleet-chat-divider[data-kind="unread"] {
  color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-chat-divider[data-kind="unread"]::before,
.dsh-fleet-chat-divider[data-kind="unread"]::after {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, transparent);
}

.dsh-fleet-chat-notice {
  color: var(--dsw-alias-label-secondary);
  align-items: center;
  gap: 8px;
  padding-left: 44px;
  font: var(--dsw-font-xs-13);
  font-size: 12px;
  display: flex;
}

.dsh-fleet-chat-notice-dot {
  width: 4px;
  height: 4px;
  background: currentColor;
  border-radius: 50%;
  flex: none;
  opacity: .7;
}

@media (max-width: 640px) {
  .dsh-fleet-conversation-header-description,
  .dsh-fleet-conversation-header-kind {
    display: none;
  }

  .dsh-fleet-conversation-header {
    padding-inline: 12px;
  }

  .dsh-fleet-message-receipt-columns {
    grid-template-columns: minmax(0, 1fr);
  }

  .dsh-fleet-message-receipt-column + .dsh-fleet-message-receipt-column {
    border-top: 1px solid var(--dsw-alias-border-l3);
    border-left: 0;
    margin-top: 8px;
    padding: 8px 0 0;
  }
}

`

function installRuntimeChatStyles(): void {
  if (typeof document === 'undefined') return
  let style = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${RUNTIME_CHAT_STYLE_ID}"]`)
  if (style === null) {
    style = document.createElement('style')
    style.dataset.pluginCss = RUNTIME_CHAT_STYLE_ID
    document.head.append(style)
  }
  style.textContent = runtimeChatStyles
}

installRuntimeChatStyles()

export type FleetPresence = 'active' | 'busy' | 'waiting' | 'error' | 'offline' | 'unknown'
export type FleetConversationKind = 'channel' | 'direct' | 'cross-team' | 'context'
export type FleetMessageDeliveryState = 'sending' | 'sent' | 'failed'

export interface FleetChatMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly color: string
  readonly avatarUrl?: string | undefined
  readonly presence?: FleetPresence
  readonly operator?: boolean
}

export interface FleetRuntimeMember extends FleetChatMember {
  readonly runtimeStatus?: 'idle' | 'running' | 'waiting' | 'error' | 'offline' | 'paused' | 'unknown'
}

export interface FleetChatAvatarProps {
  readonly member: FleetChatMember
  readonly size?: number
  readonly showPresence?: boolean
}

export interface FleetConversationHeaderProps {
  readonly kind: FleetConversationKind
  readonly name: string
  readonly description?: string
  readonly memberCount?: number
  readonly activeCount?: number
  readonly members?: readonly FleetChatMember[]
  readonly onlineMembers?: readonly FleetChatMember[]
  readonly renderMember?: (member: FleetChatMember) => ReactNode
  readonly peer?: FleetChatMember
  readonly meta?: ReactNode
  readonly actions?: ReactNode
}

export interface FleetChatMessageProps {
  readonly id: string
  readonly sender: FleetChatMember
  readonly sentAt: string
  /** Serializable content that a human-facing composer or connected tool can produce. */
  readonly content: readonly FleetChatContentBlock[]
  readonly compact?: boolean
  readonly deliveryState?: FleetMessageDeliveryState
  readonly operatorLabel?: string
  /** Optional integration-owned avatar treatment, such as a member profile popover. */
  readonly avatar?: ReactNode
  /** Integration uses the official MessageText primitive here. */
  readonly renderText?: (text: string) => ReactNode
  /** Integration uses the official conversation image slot here. */
  readonly renderImage?: (image: FleetChatImageBlock) => ReactNode
  readonly renderMention?: (mention: FleetChatMentionBlock) => ReactNode | undefined
  readonly renderBlock?: (block: FleetChatContentBlock, index: number) => ReactNode | undefined
  readonly onOpenResource?: (resource: FleetChatResourceBlock) => void
  readonly receipt?: FleetChatReadReceiptData
  readonly actions?: ReactNode
  /** Replies or comments visually owned by this message. */
  readonly comments?: ReactNode
  readonly commentCount?: number
}

export interface FleetChatCommentProps {
  readonly id: string
  readonly sender: FleetChatMember
  readonly sentAt: string
  readonly content: readonly FleetChatContentBlock[]
  readonly operatorLabel?: string
  /** Optional integration-owned avatar treatment, such as a member profile popover. */
  readonly avatar?: ReactNode
  readonly renderText?: (text: string) => ReactNode
  readonly renderImage?: (image: FleetChatImageBlock) => ReactNode
  readonly renderMention?: (mention: FleetChatMentionBlock) => ReactNode | undefined
  readonly renderBlock?: (block: FleetChatContentBlock, index: number) => ReactNode | undefined
  readonly onOpenResource?: (resource: FleetChatResourceBlock) => void
  readonly receipt?: FleetChatReadReceiptData
  readonly actions?: ReactNode
}

export interface FleetChatReadReceiptData {
  readonly readMembers: readonly FleetChatMember[]
  /** Delivered but not yet fully read. */
  readonly deliveredMembers?: readonly FleetChatMember[]
  readonly pendingDeliveries?: readonly FleetChatPendingDelivery[]
  /** Legacy two-state input. New callers provide deliveredMembers and pendingDeliveries. */
  readonly unreadMembers?: readonly FleetChatMember[]
  readonly sources?: readonly FleetChatReceiptSource[]
  readonly renderMember?: (member: FleetChatMember, source?: FleetChatReceiptSource) => ReactNode
  /** Reserved for the future context-jump affordance. */
  readonly onOpenSource?: (source: FleetChatReceiptSource) => void
}

export interface FleetChatPendingDelivery {
  readonly member: FleetChatMember
  readonly reason?: 'no_active_session' | 'inbox_delivery_failed' | 'participant_retired'
  readonly detail?: string
  readonly blockedAt?: string
}

export interface FleetChatReceiptSource {
  readonly memberId: string
  readonly sessionId: string
  readonly contextMessageId: string
}

export interface FleetChatImageBlock {
  readonly type: 'image'
  readonly attachmentId: string
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  readonly name?: string
  readonly bytes?: number
  readonly width?: number
  readonly height?: number
}

export interface FleetChatResourceBlock {
  readonly type: 'resource'
  readonly id: string
  readonly label: string
  readonly mediaType?: string
  readonly size?: number
}

export interface FleetChatMentionBlock {
  readonly type: 'mention'
  readonly memberId: string
  /** Snapshot label retained with the message even if the member is renamed. */
  readonly label: string
}

export interface FleetChatExtensionBlock {
  readonly type: `extension:${string}`
  readonly data: Readonly<Record<string, unknown>>
}

export type FleetChatContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | FleetChatImageBlock
  | FleetChatResourceBlock
  | FleetChatMentionBlock
  | FleetChatExtensionBlock

export interface FleetChatDividerProps {
  readonly kind?: 'date' | 'unread'
  readonly children: ReactNode
}

export interface FleetChatNoticeProps {
  readonly children: ReactNode
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return Array.from(words[0] ?? '?').slice(0, 2).join('').toUpperCase()
  return `${Array.from(words[0] ?? '?')[0] ?? ''}${Array.from(words.at(-1) ?? '?')[0] ?? ''}`.toUpperCase()
}

function avatarForeground(color: string): '#111827' | '#ffffff' {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(color)
  if (match === null) return '#ffffff'
  const channels = match.slice(1).map(value => Number.parseInt(value ?? '0', 16) / 255)
    .map(value => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  const luminance = .2126 * (channels[0] ?? 0) + .7152 * (channels[1] ?? 0) + .0722 * (channels[2] ?? 0)
  return luminance > .48 ? '#111827' : '#ffffff'
}

function readableBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined
  if (bytes < 1_024) return `${Math.round(bytes)} B`
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`
}

function resourceMark(mediaType: string | undefined): string {
  if (mediaType?.startsWith('image/') === true) return 'IMG'
  if (mediaType?.includes('json') === true) return 'JSON'
  if (mediaType?.startsWith('text/') === true) return 'TXT'
  if (mediaType?.includes('zip') === true) return 'ZIP'
  return 'FILE'
}

function FleetChatContent({
  content,
  renderText,
  renderImage,
  renderMention,
  renderBlock,
  onOpenResource,
}: Pick<FleetChatMessageProps, 'content' | 'renderText' | 'renderImage' | 'renderMention' | 'renderBlock' | 'onOpenResource'>): ReactElement {
  return jsx('div', {
    className: 'dsh-fleet-chat-content',
    children: content.map((block, index) => {
      const key = `${block.type}:${index}`
      const extension = renderBlock?.(block, index)
      if (extension !== undefined) {
        return jsx('div', { className: 'dsh-fleet-chat-content-extension', children: extension }, key)
      }
      if (block.type === 'text') {
        return jsx('div', {
          className: 'dsh-fleet-chat-content-text',
          children: renderText?.(block.text) ?? block.text,
        }, key)
      }
      if (block.type === 'mention') {
        const rendered = renderMention?.(block)
        if (rendered !== undefined) return jsx(Fragment, { children: rendered }, key)
        return jsx('span', {
          className: 'dsh-fleet-chat-content-mention',
          'data-member-id': block.memberId,
          children: `@${block.label}`,
        }, key)
      }
      if (block.type === 'image') {
        return jsx('div', {
          className: 'dsh-fleet-chat-content-image',
          children: renderImage?.(block) ?? jsx('span', {
            className: 'dsh-fleet-chat-content-image-fallback',
            children: block.name ?? fleetText('图片', 'Image'),
          }),
        }, key)
      }
      if (block.type !== 'resource') {
        return jsx('div', {
          className: 'dsh-fleet-chat-content-resource-meta',
          children: fleetText('此消息需要对应的扩展来显示', 'This message requires an extension to display'),
        }, key)
      }
      const bytes = readableBytes(block.size)
      const metadata = [block.mediaType, bytes].filter(Boolean).join(' · ')
      const copy = jsxs('span', {
        className: 'dsh-fleet-chat-content-resource-copy',
        children: [
          jsx('span', { className: 'dsh-fleet-chat-content-resource-name', children: block.label }),
          metadata.length > 0 && jsx('span', {
            className: 'dsh-fleet-chat-content-resource-meta',
            children: metadata,
          }),
        ],
      })
      const shared = {
        className: 'dsh-fleet-chat-content-resource',
        'data-resource-id': block.id,
        children: [
          jsx('span', {
            className: 'dsh-fleet-chat-content-resource-mark',
            'aria-hidden': 'true',
            children: resourceMark(block.mediaType),
          }),
          copy,
        ],
      }
      return onOpenResource === undefined
        ? jsxs('span', shared, key)
        : jsxs('button', { ...shared, type: 'button', onClick: () => onOpenResource(block) }, key)
    }),
  })
}

export function FleetChatAvatar({ member, size = 34, showPresence = true }: FleetChatAvatarProps): ReactElement {
  const style = {
    '--dsh-fleet-avatar-size': `${size}px`,
    '--dsh-fleet-avatar-color': member.color,
    '--dsh-fleet-avatar-foreground': avatarForeground(member.color),
  } as CSSProperties
  const status = member.presence ?? 'offline'
  return jsxs('span', {
    className: 'dsh-fleet-chat-avatar',
    style,
    role: 'img',
    'aria-label': `${member.name}，${member.role}`,
    children: [
      member.avatarUrl === undefined
        ? initials(member.name)
        : jsx('img', { className: 'dsh-fleet-chat-avatar-image', src: member.avatarUrl, alt: '' }),
      showPresence && jsx('span', {
        className: 'dsh-fleet-chat-avatar-status',
        'data-status': status,
        'aria-hidden': 'true',
      }),
    ],
  })
}

export function fleetPresenceLabel(presence: FleetPresence): string {
  if (presence === 'active') return fleetText('空闲', 'Idle')
  if (presence === 'busy') return fleetText('工作中', 'Working')
  if (presence === 'waiting') return fleetText('等待中', 'Waiting')
  if (presence === 'error') return fleetText('异常', 'Error')
  if (presence === 'unknown') return fleetText('未加载', 'Not loaded')
  return fleetText('离线', 'Offline')
}

export function fleetMemberPresence(member: FleetRuntimeMember): FleetPresence {
  if (member.runtimeStatus === 'paused' || member.runtimeStatus === 'offline') return 'offline'
  if (member.runtimeStatus === 'running') return 'busy'
  if (member.runtimeStatus === 'waiting') return 'waiting'
  if (member.runtimeStatus === 'error') return 'error'
  return member.presence ?? (member.runtimeStatus === 'idle' ? 'active' : 'offline')
}

export function fleetMemberPresenceLabel(member: FleetRuntimeMember): string {
  if (member.runtimeStatus === 'paused') return fleetText('已暂停', 'Paused')
  return fleetPresenceLabel(fleetMemberPresence(member))
}

function FleetPresenceHintContent({ presence }: { readonly presence: FleetPresence }): ReactElement {
  if (presence === 'unknown') {
    return jsxs(Fragment, {
      children: [
        jsx('p', {
          className: 'dsh-hover-hint-lead',
          children: fleetText('当前 DSH 进程尚未加载这个成员。', 'This member has not been loaded by the current DSH process.'),
        }),
        jsxs('section', {
          className: 'dsh-hover-hint-section',
          children: [
            jsx('h4', { children: fleetText('这意味着什么', 'What this means') }),
            jsxs('ul', {
              children: [
                jsx('li', { children: fleetText('不等同于离线。', 'It does not mean the member is offline.') }),
                jsx('li', { children: fleetText('不表示成员工作失败或已经停止。', 'It does not mean the member failed or stopped working.') }),
                jsx('li', { children: fleetText('团队记录和成员会话仍然保留。', 'Team records and the member Session are preserved.') }),
              ],
            }),
          ],
        }),
        jsxs('section', {
          className: 'dsh-hover-hint-section',
          children: [
            jsx('h4', { children: fleetText('接下来会发生什么', 'What happens next') }),
            jsx('p', { children: fleetText('团队恢复并加载成员后，这里会自动更新为实时状态。', 'This status updates automatically after the Team resumes and loads the member.') }),
          ],
        }),
      ],
    })
  }
  const copy = presence === 'active'
    ? {
        lead: fleetText('成员会话已加载，当前没有执行中的回合。', 'The member Session is loaded and has no turn running.'),
        meaning: fleetText('成员可以接收新消息或任务；空闲不等同于离线。', 'The member can receive new messages or tasks; idle does not mean offline.'),
        next: fleetText('收到新工作或唤醒信号后，状态会自动变为“工作中”。', 'New work or a wake-up signal automatically changes the status to Working.'),
      }
    : presence === 'busy'
      ? {
          lead: fleetText('成员会话正在执行一个回合。', 'The member Session is executing a turn.'),
          meaning: fleetText('成员可能正在生成回复、调用工具或处理团队工作。', 'The member may be generating a response, calling a tool, or handling Team work.'),
          next: fleetText('回合结束、进入等待或遇到错误后，状态会自动更新。', 'The status updates automatically when the turn finishes, starts waiting, or encounters an error.'),
        }
      : presence === 'waiting'
        ? {
            lead: fleetText('成员仍在执行，但正在等待工具或外部操作返回。', 'The member is still running but is waiting for a tool or external operation.'),
            meaning: fleetText('这不是空闲或离线；当前回合仍然保留。', 'This is not idle or offline; the current turn is still active.'),
            next: fleetText('等待结束后会自动继续工作，不需要重复发送任务。', 'Work resumes automatically when the wait ends; the task does not need to be sent again.'),
          }
        : presence === 'error'
          ? {
              lead: fleetText('成员最近一次运行遇到错误，当前没有正常继续。', 'The member encountered an error in its latest run and is not continuing normally.'),
              meaning: fleetText('团队记录、会话上下文和已完成工作仍然保留。', 'Team records, Session context, and completed work are preserved.'),
              next: fleetText('查看成员上下文定位原因；处理后可恢复或重新唤醒成员。', 'Open the member context to identify the cause, then resume or wake the member.'),
            }
          : {
              lead: fleetText('成员当前没有活动的运行会话，或已被暂停。', 'The member has no active runtime Session or has been paused.'),
              meaning: fleetText('这不是“未加载”：当前进程已知这个成员的停止状态。', 'This is different from Not loaded: the current process knows that the member is stopped.'),
              next: fleetText('恢复、唤醒或重新加载成员后，状态会自动更新。', 'The status updates automatically after the member is resumed, woken, or loaded again.'),
            }
  return jsxs(Fragment, {
    children: [
      jsx('p', { className: 'dsh-hover-hint-lead', children: copy.lead }),
      jsxs('section', {
        className: 'dsh-hover-hint-section',
        children: [
          jsx('h4', { children: fleetText('这意味着什么', 'What this means') }),
          jsx('p', { children: copy.meaning }),
        ],
      }),
      jsxs('section', {
        className: 'dsh-hover-hint-section',
        children: [
          jsx('h4', { children: fleetText('接下来会发生什么', 'What happens next') }),
          jsx('p', { children: copy.next }),
        ],
      }),
    ],
  })
}

export function FleetPresenceLabel({ presence, label = fleetPresenceLabel(presence) }: {
  readonly presence: FleetPresence
  readonly label?: string
}): ReactElement {
  return jsx('span', {
    className: 'dsh-fleet-presence-label',
    children: jsx(FleetInfoHint, {
      label: fleetText(`查看“${label}”的说明`, `About “${label}”`),
      title: label,
      seenMarker: `fleet.presence.${presence}`,
      trigger: (triggerProps: HoverHintTriggerProps) => jsx('button', {
        ...triggerProps,
        type: 'button',
        className: 'dsh-fleet-presence-hint-trigger',
        children: label,
      }),
      children: jsx(FleetPresenceHintContent, { presence }),
    }),
  })
}

function pendingDeliveryDetail(delivery: FleetChatPendingDelivery): string {
  const reason = delivery.reason === 'no_active_session'
    ? fleetText('等待成员加载', 'Waiting for the member to load')
    : delivery.reason === 'inbox_delivery_failed'
      ? delivery.detail === undefined
        ? fleetText('原生收件箱投递失败', 'Native inbox delivery failed')
        : fleetText(`投递失败：${delivery.detail}`, `Delivery failed: ${delivery.detail}`)
      : delivery.reason === 'participant_retired'
        ? fleetText('成员已退出团队，无法继续投递', 'The member left the Team and can no longer receive this message')
        : fleetText('尚未获得投递回执', 'No delivery receipt yet')
  if (delivery.blockedAt === undefined) return reason
  const blockedAt = new Date(delivery.blockedAt)
  return Number.isNaN(blockedAt.getTime())
    ? reason
    : fleetText(`${reason} · 记录于 ${blockedAt.toLocaleString()}`, `${reason} · Recorded ${blockedAt.toLocaleString()}`)
}

function FleetChatMemberList({ members, details, sources, renderMember, onOpenSource }: {
  readonly members: readonly FleetChatMember[]
  readonly details?: ReadonlyMap<string, string>
  readonly sources?: readonly FleetChatReceiptSource[]
  readonly renderMember?: (member: FleetChatMember, source?: FleetChatReceiptSource) => ReactNode
  readonly onOpenSource?: (source: FleetChatReceiptSource) => void
}): ReactElement {
  return jsx('ul', {
    className: 'dsh-fleet-message-receipt-members',
    children: members.length === 0
      ? jsx('li', { className: 'dsh-fleet-message-receipt-empty', children: fleetText('暂无', 'None') })
      : members.map(member => {
        const source = sources?.find(candidate => candidate.memberId === member.id)
        const detail = details?.get(member.id)
        return jsx('li', {
          className: 'dsh-fleet-message-receipt-member-seat',
          ...(source === undefined ? {} : {
            'data-source-session-id': source.sessionId,
            'data-source-message-id': source.contextMessageId,
          }),
          children: [
            renderMember?.(member, source) ?? jsxs('div', {
              className: 'dsh-fleet-message-receipt-member',
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
            source !== undefined && onOpenSource !== undefined && jsx('button', {
              type: 'button',
              className: 'dsh-fleet-message-receipt-source',
              'aria-label': fleetText(`查看 ${member.name} 收到这条消息的位置`, `View where ${member.name} received this message`),
              onClick: () => { onOpenSource(source) },
              children: fleetText('消息位置', 'Message location'),
            }),
            detail !== undefined && jsx('p', {
              className: 'dsh-fleet-message-receipt-blocker',
              children: detail,
            }),
          ],
        }, member.id)
      }),
  })
}

export function FleetChatReadReceipt({
  readMembers,
  deliveredMembers: explicitDeliveredMembers,
  pendingDeliveries = [],
  unreadMembers,
  sources,
  renderMember,
  onOpenSource,
}: FleetChatReadReceiptData): ReactElement | null {
  const controller = useFleetAnchoredPopover('below-end', 7)
  const deliveredMembers = explicitDeliveredMembers ?? unreadMembers ?? []
  const pendingMembers = pendingDeliveries.map(delivery => delivery.member)
  const total = readMembers.length + deliveredMembers.length + pendingMembers.length

  if (total === 0) return null
  const angle = `${String(Math.round(readMembers.length / total * 360))}deg`
  const complete = readMembers.length === total
  const summary = fleetText(
    `${String(readMembers.length)}/${String(total)} 已读 · ${String(deliveredMembers.length)} 已送达 · ${String(pendingMembers.length)} 待送达`,
    `${String(readMembers.length)}/${String(total)} read · ${String(deliveredMembers.length)} delivered · ${String(pendingMembers.length)} pending`,
  )
  const pendingDetails = new Map(pendingDeliveries.map(delivery => [delivery.member.id, pendingDeliveryDetail(delivery)]))
  return jsxs('span', {
    className: 'dsh-fleet-message-receipt',
    style: { '--dsh-fleet-read-angle': angle } as CSSProperties,
    children: [
      jsx(FleetInfoHint, {
        label: fleetText('查看消息回执说明', 'About message receipts'),
        title: fleetText('消息回执', 'Message receipts'),
        seenMarker: 'fleet.message.receipt',
        pinOnClick: false,
        footer: null,
        trigger: (hintProps: HoverHintTriggerProps) => jsx('button', {
          ...hintProps,
          type: 'button',
          className: 'dsh-fleet-message-receipt-trigger',
          'data-summary': summary,
          'aria-label': fleetText(`${summary}，查看成员明细`, `${summary}; view member details`),
          'aria-haspopup': 'dialog',
          'aria-expanded': controller.open ? 'true' : 'false',
          'aria-controls': controller.popoverId,
          onClick: (event: { readonly currentTarget: HTMLElement }) => { controller.toggleAt(event.currentTarget) },
          children: jsx('span', {
            className: 'dsh-fleet-message-receipt-indicator',
            'data-complete': complete ? 'true' : 'false',
            'aria-hidden': 'true',
            children: complete
              ? jsx('svg', {
                  className: 'dsh-fleet-message-receipt-check',
                  viewBox: '0 0 12 12',
                  children: jsx('polyline', { points: '2.8 6.2 5.1 8.35 9.4 3.7' }),
                })
              : jsx('span', { className: 'dsh-fleet-message-receipt-pie' }),
          }),
        }),
        children: jsxs(Fragment, {
          children: [
            jsxs('section', {
              className: 'dsh-hover-hint-section',
              children: [
                jsx('h4', { children: fleetText('标志怎么计算', 'How the indicator is calculated') }),
                jsx('p', { children: fleetText('圆形进度只按“已读人数 / 总接收人数”计算；全部已读后显示完成勾。', 'The ring uses read recipients divided by total recipients; it becomes a check when everyone has read the message.') }),
              ],
            }),
            jsxs('section', {
              className: 'dsh-hover-hint-section',
              children: [
                jsx('h4', { children: fleetText('查看成员明细', 'View member details') }),
                jsx('p', { children: fleetText('点击标志可查看哪些成员已读、已送达或仍在等待送达。', 'Click the indicator to see who has read, received, or is still waiting for delivery.') }),
              ],
            }),
          ],
        }),
      }),
      controller.mounted && jsx('div', {
        ref: controller.popover,
        id: controller.popoverId,
        popover: 'auto',
        className: 'dsh-fleet-message-receipt-popover',
        role: 'dialog',
        'aria-label': fleetText('消息送达与已读情况', 'Message delivery and read status'),
        children: jsxs('div', {
          className: 'dsh-fleet-message-receipt-columns',
          children: [
            jsxs('section', {
              className: 'dsh-fleet-message-receipt-column',
              children: [
                jsx('h3', {
                  className: 'dsh-fleet-message-receipt-heading',
                  children: fleetText(`已读 · ${String(readMembers.length)}`, `Read · ${String(readMembers.length)}`),
                }),
                jsx(FleetChatMemberList, { members: readMembers, sources, renderMember, onOpenSource }),
              ],
            }),
            jsxs('section', {
              className: 'dsh-fleet-message-receipt-column',
              children: [
                jsx('h3', {
                  className: 'dsh-fleet-message-receipt-heading',
                  children: fleetText(`已送达 · ${String(deliveredMembers.length)}`, `Delivered · ${String(deliveredMembers.length)}`),
                }),
                jsx(FleetChatMemberList, { members: deliveredMembers, sources, renderMember, onOpenSource }),
              ],
            }),
            jsxs('section', {
              className: 'dsh-fleet-message-receipt-column',
              children: [
                jsx('h3', {
                  className: 'dsh-fleet-message-receipt-heading',
                  children: fleetText(`待送达 · ${String(pendingMembers.length)}`, `Pending · ${String(pendingMembers.length)}`),
                }),
                jsx(FleetChatMemberList, {
                  members: pendingMembers,
                  details: pendingDetails,
                  renderMember,
                }),
              ],
            }),
          ],
        }),
      }),
    ],
  })
}

function FleetConversationMembersMeta({ members, onlineMembers, renderMember }: {
  readonly members: readonly FleetChatMember[]
  readonly onlineMembers: readonly FleetChatMember[]
  readonly renderMember?: (member: FleetChatMember) => ReactNode
}): ReactElement {
  const controller = useFleetAnchoredPopover('below-end', 7)
  const onlineCount = String(onlineMembers.length)
  const memberCount = String(members.length)
  const summary = fleetText(
    `${onlineCount} 在线 · ${memberCount} 位成员`,
    `${onlineCount} online · ${memberCount} members`,
  )
  return jsxs('span', {
    className: 'dsh-fleet-conversation-header-members',
    children: [
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-conversation-header-members-trigger',
        'aria-label': fleetText(`${summary}，查看成员列表`, `${summary}; view member list`),
        'aria-haspopup': 'dialog',
        'aria-expanded': controller.open ? 'true' : 'false',
        'aria-controls': controller.popoverId,
        onClick: (event: { readonly currentTarget: HTMLElement }) => { controller.toggleAt(event.currentTarget) },
        children: [
          jsxs('span', {
            className: 'dsh-fleet-conversation-header-members-metric',
            children: [
              jsx('span', { className: 'dsh-fleet-conversation-header-members-count', children: onlineCount }),
              fleetText('在线', 'online'),
            ],
          }),
          jsx('span', { 'aria-hidden': 'true', children: '·' }),
          jsxs('span', {
            className: 'dsh-fleet-conversation-header-members-metric',
            children: [
              jsx('span', { className: 'dsh-fleet-conversation-header-members-count', children: memberCount }),
              fleetText('位成员', 'members'),
            ],
          }),
        ],
      }),
      controller.mounted && jsx('div', {
        ref: controller.popover,
        id: controller.popoverId,
        popover: 'auto',
        className: 'dsh-fleet-message-receipt-popover dsh-fleet-channel-members-popover',
        role: 'dialog',
        'aria-label': fleetText('频道成员', 'Channel members'),
        children: jsxs('div', {
          className: 'dsh-fleet-message-receipt-columns',
          children: [
            jsxs('section', {
              className: 'dsh-fleet-message-receipt-column',
              children: [
                jsx('h3', {
                  className: 'dsh-fleet-message-receipt-heading',
                  children: fleetText(`在线 · ${String(onlineMembers.length)}`, `Online · ${String(onlineMembers.length)}`),
                }),
                jsx(FleetChatMemberList, { members: onlineMembers, renderMember }),
              ],
            }),
            jsxs('section', {
              className: 'dsh-fleet-message-receipt-column',
              children: [
                jsx('h3', {
                  className: 'dsh-fleet-message-receipt-heading',
                  children: fleetText(`频道成员 · ${String(members.length)}`, `Channel members · ${String(members.length)}`),
                }),
                jsx(FleetChatMemberList, { members, renderMember }),
              ],
            }),
          ],
        }),
      }),
    ],
  })
}

export function FleetConversationHeader(props: FleetConversationHeaderProps): ReactElement {
  const direct = props.kind === 'direct'
  const crossTeam = props.kind === 'cross-team'
  const context = props.kind === 'context'
  const presence = props.peer?.presence ?? 'offline'
  const active = props.onlineMembers?.length ?? props.activeCount ?? 0
  const total = props.members?.length ?? props.memberCount ?? 0
  const directStatus = jsx(FleetPresenceLabel, { presence })
  return jsxs('header', {
    className: 'dsh-fleet-conversation-header',
    children: [
      (direct || context) && props.peer !== undefined
        ? jsx(FleetChatAvatar, { member: props.peer, size: 30 })
        : jsx('span', { className: 'dsh-fleet-conversation-header-mark', 'aria-hidden': 'true', children: '#' }),
      jsxs('div', {
        className: 'dsh-fleet-conversation-header-copy',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-conversation-header-title-row',
            children: [
              jsx('h2', { className: 'dsh-fleet-conversation-header-title', children: props.name }),
              jsx('span', {
                className: 'dsh-fleet-conversation-header-kind',
                children: direct
                  ? fleetText('私聊', 'Direct message')
                  : context
                    ? fleetText('Agent 上下文', 'Agent context')
                    : crossTeam
                      ? fleetText('跨团队', 'Cross-Team')
                      : fleetText('频道', 'Channel'),
              }),
            ],
          }),
          props.description !== undefined && jsx('div', {
            className: 'dsh-fleet-conversation-header-description',
            children: props.description,
          }),
        ],
      }),
      jsx('div', {
        className: 'dsh-fleet-conversation-header-meta',
        children: props.meta ?? (direct
          ? directStatus
          : context
            ? jsxs(Fragment, { children: [props.peer?.name ?? 'Agent', ' · ', directStatus] })
            : props.members === undefined
              ? fleetText(`${active} 在线 · ${total} 位成员`, `${active} online · ${total} members`)
              : jsx(FleetConversationMembersMeta, {
                  members: props.members,
                  onlineMembers: props.onlineMembers ?? [],
                  ...(props.renderMember === undefined ? {} : { renderMember: props.renderMember }),
                })),
      }),
      props.actions,
    ],
  })
}

export function FleetChatMessage({
  id,
  sender,
  sentAt,
  content,
  compact = false,
  deliveryState = 'sent',
  operatorLabel = fleetText(' · 外部用户', ' · External user'),
  avatar,
  renderText,
  renderImage,
  renderMention,
  renderBlock,
  onOpenResource,
  receipt,
  actions,
  comments,
  commentCount = 0,
}: FleetChatMessageProps): ReactElement {
  const time = new Date(sentAt)
  const timeLabel = Number.isNaN(time.getTime())
    ? sentAt
    : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const stateLabel = deliveryState === 'sending'
    ? fleetText('发送中…', 'Sending…')
    : deliveryState === 'failed' ? fleetText('发送失败', 'Failed to send') : null
  return jsxs('article', {
    className: 'dsh-fleet-chat-message',
    'data-message-id': id,
    'data-compact': compact ? 'true' : undefined,
    'data-operator': sender.operator ? 'true' : undefined,
    'data-operator-label': sender.operator ? operatorLabel : undefined,
    children: [
      compact ? jsx('span', { 'aria-hidden': 'true' }) : avatar ?? jsx(FleetChatAvatar, { member: sender }),
      jsxs('div', {
        className: 'dsh-fleet-chat-message-main',
        children: [
          !compact && jsxs('div', {
            className: 'dsh-fleet-chat-message-meta',
            children: [
              jsxs('span', {
                className: 'dsh-fleet-chat-message-sender',
                children: [
                  jsx('span', { className: 'dsh-fleet-chat-message-name', children: sender.name }),
                  jsx('span', { className: 'dsh-fleet-chat-message-role', children: sender.role }),
                ],
              }),
              jsxs('span', {
                className: 'dsh-fleet-chat-message-delivery',
                children: [
                  jsx('time', {
                    className: 'dsh-fleet-chat-message-time',
                    dateTime: sentAt,
                    children: timeLabel,
                  }),
                  receipt !== undefined && jsx(FleetChatReadReceipt, receipt),
                  actions !== undefined && jsx('span', {
                    className: 'dsh-fleet-chat-message-actions',
                    children: actions,
                  }),
                ],
              }),
            ],
          }),
          jsx('div', {
            className: 'dsh-fleet-chat-message-body',
            children: jsx(FleetChatContent, {
              content,
              renderText,
              renderImage,
              renderMention,
              renderBlock,
              onOpenResource,
            }),
          }),
          stateLabel !== null && jsx('div', {
            className: 'dsh-fleet-chat-message-state',
            'data-state': deliveryState,
            role: deliveryState === 'failed' ? 'alert' : 'status',
            children: stateLabel,
          }),
          comments !== undefined && commentCount > 0 && jsxs('section', {
            className: 'dsh-fleet-chat-comments',
            'aria-label': fleetText(`${String(commentCount)} 条回复`, `${String(commentCount)} replies`),
            children: [
              jsx('div', {
                className: 'dsh-fleet-chat-comments-heading',
                children: fleetText(`${String(commentCount)} 条回复`, `${String(commentCount)} replies`),
              }),
              jsx('div', { className: 'dsh-fleet-chat-comments-list', children: comments }),
            ],
          }),
        ],
      }),
    ],
  })
}

export function FleetChatComment({
  id,
  sender,
  sentAt,
  content,
  operatorLabel = fleetText(' · 外部用户', ' · External user'),
  avatar,
  renderText,
  renderImage,
  renderMention,
  renderBlock,
  onOpenResource,
  receipt,
  actions,
}: FleetChatCommentProps): ReactElement {
  const time = new Date(sentAt)
  const timeLabel = Number.isNaN(time.getTime())
    ? sentAt
    : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return jsxs('article', {
    className: 'dsh-fleet-chat-comment',
    'data-comment-id': id,
    'data-operator': sender.operator ? 'true' : undefined,
    'data-operator-label': sender.operator ? operatorLabel : undefined,
    children: [
      avatar ?? jsx(FleetChatAvatar, { member: sender, size: 24, showPresence: false }),
      jsxs('div', {
        className: 'dsh-fleet-chat-comment-main',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-chat-comment-meta',
            children: [
              jsx('span', { className: 'dsh-fleet-chat-comment-name', children: sender.name }),
              jsx('span', { className: 'dsh-fleet-chat-comment-role', children: sender.role }),
              jsx('time', { className: 'dsh-fleet-chat-comment-time', dateTime: sentAt, children: timeLabel }),
              receipt !== undefined && jsx(FleetChatReadReceipt, receipt),
              actions !== undefined && jsx('span', {
                className: 'dsh-fleet-chat-comment-actions',
                children: actions,
              }),
            ],
          }),
          jsx('div', {
            className: 'dsh-fleet-chat-comment-body',
            children: jsx(FleetChatContent, {
              content,
              renderText,
              renderImage,
              renderMention,
              renderBlock,
              onOpenResource,
            }),
          }),
        ],
      }),
    ],
  })
}

export function FleetChatDivider({ kind = 'date', children }: FleetChatDividerProps): ReactElement {
  return jsx('div', {
    className: 'dsh-fleet-chat-divider',
    'data-kind': kind,
    role: 'separator',
    children: jsx('span', { children }),
  })
}

export function FleetChatNotice({ children }: FleetChatNoticeProps): ReactElement {
  return jsxs('div', {
    className: 'dsh-fleet-chat-notice',
    role: 'status',
    children: [jsx('span', { className: 'dsh-fleet-chat-notice-dot', 'aria-hidden': 'true' }), children],
  })
}
