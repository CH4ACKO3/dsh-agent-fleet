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
  fleetText,
  fleetLocaleDictionaries,
  isChineseLocale,
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

const PANEL_STYLE_ID = 'dsh-agent-fleet-team-panel'
const RENDER_ENGINE_STYLE_ID = 'dsh-agent-fleet-render-engine'

const panelStyles = `
[data-conversation-scroll]:has(.dsh-fleet-panel) {
  --dsh-fleet-panel-canvas: color-mix(in srgb, var(--dsw-alias-bg-base) 84%, #7898b4 16%);
  container-type: inline-size;
  background: var(--dsh-fleet-panel-canvas);
  box-shadow: 0 -2px 0 var(--dsh-fleet-panel-canvas);
}

[data-conversation-scroll]:has(.dsh-fleet-panel) > [data-composer-seat] {
  display: none;
}

.dsh-fleet-meta-welcome-node {
  box-sizing: border-box;
  max-width: 720px;
  color: var(--dsw-alias-label-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 2px 0 10px;
  font-size: 16px;
  line-height: 28px;
}

.dsh-fleet-meta-welcome-node[data-streaming="true"]::after {
  content: '';
  width: 2px;
  height: 1em;
  background: var(--dsw-alias-label-secondary);
  border-radius: 1px;
  margin-left: 2px;
  vertical-align: -.12em;
  animation: dsh-fleet-meta-welcome-caret 900ms step-end infinite;
  display: inline-block;
}

.dsh-fleet-meta-welcome-fallback {
  display: contents;
}

@keyframes dsh-fleet-meta-welcome-caret {
  50% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-fleet-meta-welcome-node[data-streaming="true"]::after {
    animation: none;
  }
}

.dsh-fleet-panel {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 560px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsh-fleet-panel-canvas);
  grid-template-columns: 54px var(--dsh-fleet-panel-sidebar-width, 232px) 8px minmax(0, 1fr);
  gap: 0;
  padding: 8px 8px 8px 0;
  display: grid;
  overflow: hidden;
}

.dsh-fleet-rendered-message {
  min-width: 0;
  max-width: 100%;
  white-space: normal;
}

.dsh-fleet-rendered-message > .dsh-markdown-render {
  min-width: 0;
}

.dsh-fleet-panel-member-avatar-anchor {
  width: 34px;
  height: 34px;
  position: relative;
}

.dsh-fleet-panel-member-avatar-trigger {
  appearance: none;
  width: 34px;
  height: 34px;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 10px;
  padding: 0;
  display: block;
}

.dsh-fleet-panel-member-avatar-trigger:hover {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);
}

.dsh-fleet-panel-member-avatar-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-member-avatar-anchor-compact,
.dsh-fleet-panel-member-avatar-anchor-compact .dsh-fleet-panel-member-avatar-trigger {
  width: 24px;
  height: 24px;
}

.dsh-fleet-panel-member-avatar-anchor-compact .dsh-fleet-panel-member-avatar-trigger {
  border-radius: 7px;
}

.dsh-fleet-panel-receipt-member-anchor {
  min-width: 0;
  flex: 1;
}

.dsh-fleet-panel-receipt-member-trigger {
  appearance: none;
  width: 100%;
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
  font: inherit;
}

.dsh-fleet-panel-receipt-member-trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-receipt-member-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-member-mention {
  appearance: none;
  width: fit-content;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
  border: 0;
  border-radius: 5px;
  padding: 0 4px;
  font: inherit;
  line-height: inherit;
}

.dsh-fleet-panel-member-mention:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 15%, transparent);
}

.dsh-fleet-panel-member-mention:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-member-popover {
  box-sizing: border-box;
  width: min(288px, calc(100vw - 24px));
  max-height: min(360px, calc(100vh - 24px));
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgb(24 39 57 / 18%), 0 2px 8px rgb(24 39 57 / 8%);
  margin: 0;
  padding: 14px;
  position: fixed;
  inset: auto;
  overflow: auto;
}

.dsh-fleet-panel-member-popover::backdrop {
  background: transparent;
}

.dsh-fleet-panel-member-popover-head {
  min-width: 0;
  align-items: center;
  gap: 11px;
  display: flex;
}

.dsh-fleet-panel-member-popover-copy {
  min-width: 0;
  flex: 1;
}

.dsh-fleet-panel-member-popover-name,
.dsh-fleet-panel-member-popover-role {
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-panel-member-popover-name {
  font: var(--dsw-font-s-strong-14);
  font-size: 15px;
}

.dsh-fleet-panel-member-popover-role,
.dsh-fleet-panel-member-popover-responsibility,
.dsh-fleet-panel-member-popover-status {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-popover-role {
  margin-top: 1px;
}

.dsh-fleet-panel-member-popover-responsibility {
  margin: 12px 0 0;
  line-height: 19px;
}

.dsh-fleet-panel-member-popover-status {
  align-items: center;
  gap: 7px;
  margin-top: 11px;
  display: flex;
}

.dsh-fleet-panel-member-popover-status::before {
  width: 7px;
  height: 7px;
  background: var(--dsw-alias-label-caption);
  border-radius: 50%;
  content: '';
  flex: none;
}

.dsh-fleet-panel-member-popover-status[data-status="active"]::before {
  background: var(--dsw-alias-state-success-primary, #4f9a6e);
}

.dsh-fleet-panel-member-popover-status[data-status="busy"]::before {
  background: var(--dsw-alias-state-warning-primary, #c38b36);
}

.dsh-fleet-panel-member-popover-status[data-status="waiting"]::before {
  background: var(--dsw-alias-state-business-primary, #4f76c7);
}

.dsh-fleet-panel-member-popover-status[data-status="error"]::before {
  background: var(--dsw-alias-state-error-primary, #d14d4d);
}

.dsh-fleet-panel-member-popover-self-status {
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin-top: 11px;
  padding-top: 10px;
}

.dsh-fleet-panel-member-popover-self-status-head {
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  display: flex;
}

.dsh-fleet-panel-member-popover-self-status-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-panel-member-status-updated {
  color: var(--dsw-alias-label-caption);
  white-space: nowrap;
  font-size: 10px;
  line-height: 16px;
}

.dsh-fleet-panel-member-popover-self-status-text {
  margin: 3px 0 0;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 19px;
}

.dsh-fleet-panel-member-popover-self-status[data-empty="true"]
.dsh-fleet-panel-member-popover-self-status-text {
  color: var(--dsw-alias-label-secondary);
}

.dsh-fleet-panel-member-popover-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 13px;
  display: grid;
}

.dsh-fleet-panel-member-popover-detail {
  min-width: 0;
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: var(--dsw-alias-interactive-bg-hover-solid);
  border: 0;
  border-radius: 8px;
  padding: 0 12px;
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-member-popover-detail:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, var(--dsw-alias-bg-layer-1));
}

.dsh-fleet-panel-member-popover-detail:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-member-popover-editor-avatar {
  min-width: 0;
  align-items: center;
  gap: 11px;
  display: flex;
}

.dsh-fleet-panel-member-popover-editor-avatar > div {
  min-width: 0;
  align-items: flex-start;
  gap: 3px;
  display: flex;
  flex-direction: column;
}

.dsh-fleet-panel-member-popover-avatar-button {
  appearance: none;
  width: 48px;
  height: 48px;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 14px;
  padding: 0;
}

.dsh-fleet-panel-member-popover-avatar-button:hover {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);
}

.dsh-fleet-panel-member-popover-avatar-action {
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 5px;
  padding: 2px 4px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-popover-avatar-action:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-member-popover-avatar-input {
  display: none;
}

.dsh-fleet-panel-member-popover-field {
  color: var(--dsw-alias-label-secondary);
  gap: 5px;
  margin-top: 10px;
  font: var(--dsw-font-xs-13);
  display: grid;
}

.dsh-fleet-panel-member-popover-field :is(input, textarea) {
  box-sizing: border-box;
  width: 100%;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-0);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  padding: 7px 9px;
  font: inherit;
  line-height: 18px;
}

.dsh-fleet-panel-member-popover-field textarea {
  min-height: 72px;
  resize: vertical;
}

.dsh-fleet-panel-member-popover-field :is(input, textarea):focus-visible,
.dsh-fleet-panel-member-popover-avatar-button:focus-visible,
.dsh-fleet-panel-member-popover-avatar-action:focus-visible,
.dsh-fleet-panel-member-popover-edit-actions button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-member-popover-edit-error {
  color: var(--dsw-alias-state-error-primary);
  margin-top: 8px;
  font: var(--dsw-font-xs-13);
  line-height: 18px;
}

.dsh-fleet-panel-member-popover-edit-actions {
  justify-content: flex-end;
  gap: 6px;
  margin-top: 13px;
  display: flex;
}

.dsh-fleet-panel-member-popover-edit-actions button {
  min-width: 64px;
  min-height: 32px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: var(--dsw-alias-interactive-bg-hover-solid);
  border: 0;
  border-radius: 7px;
  padding: 0 12px;
  font: var(--dsw-font-xs-strong-13);
}

.dsh-fleet-panel-member-popover-edit-actions button[data-primary="true"] {
  color: var(--dsw-alias-label-on-color);
  background: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-member-popover-edit-actions button:disabled {
  cursor: default;
  opacity: .45;
}

.dsh-fleet-panel-rail {
  min-width: 0;
  background: transparent;
  border: 0;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  display: flex;
  grid-column: 1;
  grid-row: 1;
}

.dsh-fleet-panel-rail-brand {
  width: 34px;
  height: 34px;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 10px;
  place-items: center;
  margin-bottom: 7px;
  padding: 0;
  display: grid;
}

.dsh-fleet-panel-rail-brand:hover,
.dsh-fleet-panel-rail-brand[aria-current="page"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 11%, transparent);
}

.dsh-fleet-panel-rail-brand:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-harmony-icon {
  width: 24px;
  height: 24px;
  background: currentColor;
  -webkit-mask: url('/dsh-harmony/assets/harmony-icon-mono.png') center / contain no-repeat;
  mask: url('/dsh-harmony/assets/harmony-icon-mono.png') center / contain no-repeat;
  display: block;
}

.dsh-fleet-panel-harmony-icon-probe {
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  position: absolute;
}

.dsh-fleet-panel-rail-tools {
  width: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  display: flex;
}

.dsh-fleet-panel-tool {
  width: 36px;
  height: 36px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 10px;
  place-items: center;
  padding: 0;
  display: grid;
  position: relative;
}

.dsh-fleet-panel-tool:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-tool[aria-current="page"] {
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 11%, transparent);
}

.dsh-fleet-panel-tool:disabled {
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  cursor: default;
  opacity: .58;
  background: transparent;
}

.dsh-fleet-panel-tool[aria-current="page"]::before {
  width: 2px;
  height: 16px;
  background: var(--dsw-alias-state-business-primary);
  border-radius: 2px;
  content: "";
  position: absolute;
  left: -8px;
}

.dsh-fleet-panel-tool:focus-visible,
.dsh-fleet-panel-list-row:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-sidebar {
  box-sizing: border-box;
  min-width: 0;
  background: var(--dsw-alias-bg-layer-1);
  border: 0;
  border-radius: 12px;
  box-shadow: 0 1px 4px color-mix(in srgb, #24394d 12%, transparent);
  flex-direction: column;
  display: flex;
  overflow: hidden;
}

.dsh-fleet-panel-sidebar-seat {
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  display: flex;
  grid-column: 2;
  grid-row: 1;
}

.dsh-fleet-panel-sidebar-seat > * {
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
}

.dsh-fleet-panel-connection-sidebar {
  display: none;
}

.dsh-fleet-panel-sidebar-layout {
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  display: flex;
}

.dsh-fleet-panel-sidebar-layout > .dsh-fleet-panel-sidebar {
  min-height: 0;
  flex: 1;
}

.dsh-fleet-panel-sidebar-team-block {
  flex: none;
  min-width: 0;
  background: var(--dsw-alias-bg-layer-1);
  border: 0;
  border-radius: 12px;
  box-shadow: 0 1px 4px color-mix(in srgb, #24394d 12%, transparent);
  align-items: stretch;
  gap: 4px;
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 2;
}

.dsh-fleet-panel-sidebar-team-primary {
  min-width: 0;
  align-items: center;
  gap: 6px;
  display: flex;
}

.dsh-fleet-panel-team-switcher {
  min-width: 0;
  flex: 1;
  position: relative;
}

.dsh-fleet-panel-team-switch {
  width: 100%;
  min-height: 32px;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  align-items: center;
  gap: 7px;
  padding: 0 7px;
  font: var(--dsw-font-s-strong-14);
  text-align: left;
  display: flex;
}

.dsh-fleet-panel-team-switch:hover,
.dsh-fleet-panel-team-switch[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-team-switch:focus-visible,
.dsh-fleet-panel-team-settings:focus-visible,
.dsh-fleet-panel-team-option:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-team-switch-name {
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  overflow: hidden;
}

.dsh-fleet-panel-team-switch-chevron {
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-secondary);
  flex: none;
  align-items: center;
  justify-content: center;
  display: inline-flex;
  line-height: 0;
  transition: transform 120ms ease-out;
}

.dsh-fleet-panel-team-switch[aria-expanded="true"] .dsh-fleet-panel-team-switch-chevron {
  transform: rotate(180deg);
}

.dsh-fleet-panel-team-menu {
  width: 100%;
  max-height: 240px;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 9px;
  box-shadow: 0 8px 22px color-mix(in srgb, #24394d 18%, transparent);
  padding: 5px;
  overflow-y: auto;
  position: absolute;
  z-index: 8;
  top: calc(100% + 5px);
  left: 0;
}

.dsh-fleet-panel-team-option {
  width: 100%;
  min-height: 36px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  font: var(--dsw-font-xs-13);
  text-align: left;
  display: flex;
}

.dsh-fleet-panel-team-option:hover,
.dsh-fleet-panel-team-option[aria-checked="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-team-option-name {
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  overflow: hidden;
}

.dsh-fleet-panel-team-settings {
  width: 32px;
  height: 32px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 0;
  border-radius: 7px;
  place-items: center;
  padding: 0;
  display: grid;
}

.dsh-fleet-panel-team-settings:not(:disabled) {
  cursor: pointer;
}

.dsh-fleet-panel-team-settings:not(:disabled):hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-team-settings:disabled {
  opacity: .58;
}

.dsh-fleet-panel-settings-overlay {
  box-sizing: border-box;
  background: color-mix(in srgb, #172536 28%, transparent);
  backdrop-filter: var(--dsw-mask-blur);
  padding: 24px;
  place-items: center;
  display: grid;
  position: fixed;
  inset: 0;
  z-index: 80;
}

.dsh-fleet-panel-settings-dialog {
  box-sizing: border-box;
  width: min(760px, calc(100vw - 32px));
  height: min(620px, calc(100vh - 48px));
  min-height: 420px;
  max-height: calc(100vh - 48px);
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 12px;
  box-shadow: 0 18px 48px color-mix(in srgb, #172536 24%, transparent);
  flex-direction: column;
  display: flex;
  overflow: hidden;
}

.dsh-fleet-panel-settings-dialog:focus {
  outline: none;
}

.dsh-fleet-panel-settings-head {
  min-height: 54px;
  align-items: center;
  gap: 12px;
  padding: 8px 10px 8px 18px;
  display: flex;
}

.dsh-fleet-panel-settings-title {
  min-width: 0;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  font: var(--dsw-font-s-strong-14);
  overflow: hidden;
}

.dsh-fleet-panel-settings-close {
  width: 34px;
  height: 34px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
  place-items: center;
  padding: 0;
  display: grid;
}

.dsh-fleet-panel-settings-close:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-settings-close:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-settings-empty {
  color: var(--dsw-alias-label-secondary);
  border-top: 1px solid var(--dsw-alias-border-l3);
  flex: 1;
  place-items: center;
  padding: 32px;
  font: var(--dsw-font-xs-13);
  text-align: center;
  display: grid;
}

.dsh-fleet-panel-settings-body {
  border-top: 1px solid var(--dsw-alias-border-l3);
  flex: 1;
  padding: 18px;
  overflow-y: auto;
}

.dsh-fleet-panel-settings-section {
  max-width: 420px;
}

.dsh-fleet-panel-settings-section-separated {
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin-top: 20px;
  padding-top: 20px;
}

.dsh-fleet-panel-settings-section-title {
  margin: 0 0 6px;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-settings-section-copy {
  margin: 0 0 16px;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
  line-height: 1.55;
}

.dsh-fleet-panel-settings-export {
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: var(--dsw-alias-interactive-bg-hover);
  border: 0;
  border-radius: 8px;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  font: var(--dsw-font-xs-strong-13);
  display: inline-flex;
}

.dsh-fleet-panel-settings-export:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active);
}

.dsh-fleet-panel-settings-export:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-settings-export:disabled {
  cursor: default;
  opacity: .56;
}

.dsh-fleet-panel-settings-check {
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  align-items: center;
  gap: 8px;
  margin: -4px 0 10px;
  font: var(--dsw-font-xs-13);
  display: flex;
}

.dsh-fleet-panel-settings-check input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-settings-import-mode {
  border: 0;
  gap: 4px;
  margin: 18px 0 0;
  padding: 0;
  display: grid;
}

.dsh-fleet-panel-settings-import-mode legend {
  color: var(--dsw-alias-label-secondary);
  margin-bottom: 6px;
  padding: 0;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-settings-import-choice {
  min-height: 44px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  border-radius: 8px;
  align-items: flex-start;
  gap: 9px;
  padding: 7px 8px;
  display: flex;
}

.dsh-fleet-panel-settings-import-choice:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-settings-import-choice input {
  width: 15px;
  height: 15px;
  margin: 2px 0 0;
  accent-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-settings-import-choice span {
  min-width: 0;
  gap: 2px;
  display: grid;
}

.dsh-fleet-panel-settings-import-choice strong {
  font: var(--dsw-font-xs-strong-13);
}

.dsh-fleet-panel-settings-import-choice small {
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
  font: var(--dsw-font-xs-13);
  line-height: 1.45;
}

.dsh-fleet-panel-settings-import-mode:disabled .dsh-fleet-panel-settings-import-choice {
  cursor: default;
  opacity: .56;
}

.dsh-fleet-panel-settings-field {
  color: var(--dsw-alias-label-secondary);
  gap: 6px;
  margin: 16px 0 10px;
  font: var(--dsw-font-xs-13);
  display: grid;
}

.dsh-fleet-panel-settings-field input {
  box-sizing: border-box;
  width: 100%;
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 10px;
  font: var(--dsw-font-s-14);
}

.dsh-fleet-panel-settings-field input::placeholder {
  color: var(--dsw-alias-label-caption);
}

.dsh-fleet-panel-settings-field input:focus-visible {
  border-color: var(--dsw-alias-state-business-primary);
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 24%, transparent);
  outline-offset: 1px;
}

.dsh-fleet-panel-settings-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
  overflow: hidden;
}

.dsh-fleet-panel-settings-error {
  margin: 12px 0 0;
  color: var(--dsw-alias-state-danger-primary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-settings-notice {
  margin: 12px 0 0;
  color: var(--dsw-alias-state-success-primary, var(--dsw-alias-label-primary));
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-settings-workspace {
  min-height: 0;
  border-top: 1px solid var(--dsw-alias-border-l3);
  grid-template-columns: 170px minmax(0, 1fr);
  flex: 1;
  display: grid;
  overflow: hidden;
}

.dsh-fleet-panel-settings-nav {
  background: var(--dsw-alias-bg-layer-2);
  border-inline-end: 1px solid var(--dsw-alias-border-l3);
  gap: 2px;
  padding: 12px 9px;
  display: flex;
  flex-direction: column;
}

.dsh-fleet-panel-settings-nav-item {
  min-height: 34px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 0 10px;
  font: var(--dsw-font-xs-13);
  text-align: left;
}

.dsh-fleet-panel-settings-nav-item:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-settings-nav-item[aria-current="page"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active);
  font: var(--dsw-font-xs-strong-13);
}

.dsh-fleet-panel-settings-nav-item[data-danger="true"] {
  color: var(--dsw-alias-state-error-primary);
  margin-top: auto;
}

.dsh-fleet-panel-settings-nav-item:focus-visible,
.dsh-fleet-panel-settings-form-field :is(input, textarea, select):focus-visible,
.dsh-fleet-panel-budget-actions input:focus-visible,
.dsh-fleet-panel-settings-secondary:focus-visible,
.dsh-fleet-panel-settings-primary:focus-visible,
.dsh-fleet-panel-settings-inline-action:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-settings-content {
  box-sizing: border-box;
  min-width: 0;
  padding: 22px 24px 28px;
  overflow-x: hidden;
  overflow-y: auto;
}

.dsh-fleet-panel-settings-content section {
  box-sizing: border-box;
  width: min(100%, 520px);
}

.dsh-fleet-panel-settings-content h3 {
  margin: 0 0 7px;
  font: var(--dsw-font-m-strong-16);
}

.dsh-fleet-panel-settings-content h4 {
  margin: 22px 0 6px;
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-settings-content hr {
  height: 1px;
  background: var(--dsw-alias-border-l3);
  border: 0;
  margin: 24px 0 0;
}

.dsh-fleet-panel-settings-form-field {
  color: var(--dsw-alias-label-primary);
  gap: 7px;
  margin-top: 18px;
  font: var(--dsw-font-xs-strong-13);
  display: grid;
}

.dsh-fleet-panel-settings-form-field :is(input, textarea, select) {
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 7px 10px;
  font: var(--dsw-font-s-14);
}

.dsh-fleet-panel-settings-form-field textarea {
  line-height: 1.55;
  resize: vertical;
}

.dsh-fleet-panel-settings-form-field :is(input, textarea)::placeholder {
  color: var(--dsw-alias-label-caption);
}

.dsh-fleet-panel-settings-model-grid {
  grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
  gap: 12px;
  display: grid;
}

.dsh-fleet-panel-settings-field-note {
  color: var(--dsw-alias-label-secondary);
  margin: 7px 0 0;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-budget-accounting {
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin-top: 18px;
  padding-top: 16px;
}

.dsh-fleet-panel-budget-mode {
  width: fit-content;
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 9px;
  padding: 3px;
  display: flex;
}

.dsh-fleet-panel-budget-mode button {
  min-height: 30px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 5px 11px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-budget-mode button[aria-checked="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 2px 7px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
}

.dsh-fleet-panel-budget-mode button:focus-visible,
.dsh-fleet-panel-budget-rate input:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-budget-rate-list {
  border-block: 1px solid var(--dsw-alias-border-l3);
  margin-block: 14px;
}

.dsh-fleet-panel-budget-rate {
  min-width: 0;
  grid-template-columns: minmax(130px, 1fr) minmax(0, 3fr);
  align-items: end;
  gap: 12px;
  padding-block: 12px;
  display: grid;
}

.dsh-fleet-panel-budget-rate + .dsh-fleet-panel-budget-rate {
  border-top: 1px solid var(--dsw-alias-border-l3);
}

.dsh-fleet-panel-budget-rate-name {
  min-width: 0;
  display: grid;
}

.dsh-fleet-panel-budget-rate-name strong,
.dsh-fleet-panel-budget-rate-name small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-fleet-panel-budget-rate-name strong {
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-budget-rate-name small,
.dsh-fleet-panel-budget-rate label > span {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-budget-rate label {
  min-width: 0;
  gap: 4px;
  display: grid;
}

.dsh-fleet-panel-budget-rate input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 8px;
  font: var(--dsw-font-s-14);
}

.dsh-fleet-panel-budget-price-grid {
  min-width: 0;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  display: grid;
}

@media (max-width: 760px) {
  .dsh-fleet-panel-budget-rate {
    grid-template-columns: 1fr;
  }

  .dsh-fleet-panel-budget-price-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.dsh-fleet-panel-budget-team {
  border-block: 1px solid var(--dsw-alias-border-l3);
  margin-top: 20px;
  padding-block: 16px;
}

.dsh-fleet-panel-budget-title,
.dsh-fleet-panel-budget-usage-head,
.dsh-fleet-panel-budget-actions {
  min-width: 0;
  align-items: center;
  gap: 10px;
  display: flex;
}

.dsh-fleet-panel-budget-title {
  justify-content: space-between;
}

.dsh-fleet-panel-budget-title > span {
  min-width: 0;
  display: grid;
}

.dsh-fleet-panel-budget-title strong {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-strong-14);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-fleet-panel-budget-title small {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-budget-usage {
  margin-top: 10px;
}

.dsh-fleet-panel-budget-usage-head {
  color: var(--dsw-alias-label-secondary);
  justify-content: space-between;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-budget-usage-head [data-state="warning"] {
  color: var(--dsw-alias-state-warning-primary);
}

.dsh-fleet-panel-budget-usage-head [data-state="exhausted"] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-panel-budget-progress {
  height: 4px;
  background: var(--dsw-alias-bg-layer-3);
  border-radius: 2px;
  margin-top: 7px;
  overflow: hidden;
}

.dsh-fleet-panel-budget-progress span {
  height: 100%;
  background: var(--dsw-alias-state-business-primary);
  display: block;
}

.dsh-fleet-panel-budget-progress span[data-state="warning"] {
  background: var(--dsw-alias-state-warning-primary);
}

.dsh-fleet-panel-budget-progress span[data-state="exhausted"] {
  background: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-panel-budget-actions {
  margin-top: 12px;
}

.dsh-fleet-panel-budget-actions input {
  box-sizing: border-box;
  width: min(180px, 46%);
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 9px;
  font: var(--dsw-font-s-14);
}

.dsh-fleet-panel-budget-actions .dsh-fleet-panel-settings-secondary {
  min-height: 32px;
  padding-inline: 10px;
}

.dsh-fleet-panel-budget-members > h4 {
  margin-top: 22px;
}

.dsh-fleet-panel-budget-member {
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  padding-block: 15px;
}

.dsh-fleet-budget-meter {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.dsh-fleet-budget-meter-button {
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.dsh-fleet-budget-meter-button:hover,
.dsh-fleet-budget-meter-button[aria-expanded="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-budget-meter-button:focus-visible {
  outline: 2px solid var(--dsw-alias-border-focus, #6d8cff);
  outline-offset: 1px;
}

.dsh-fleet-budget-meter-ring {
  width: 16px;
  height: 16px;
  overflow: visible;
  transform: rotate(-90deg);
}

.dsh-fleet-budget-meter-track,
.dsh-fleet-budget-meter-value {
  fill: none;
  stroke-width: 2;
}

.dsh-fleet-budget-meter-track {
  stroke: color-mix(in srgb, currentColor 22%, transparent);
}

.dsh-fleet-budget-meter-value {
  stroke: var(--dsw-alias-brand-primary, #6687e8);
  stroke-linecap: round;
  transition: stroke-dashoffset 180ms ease, stroke 180ms ease;
}

.dsh-fleet-budget-meter-value[data-state="warning"] { stroke: #d4a72c; }
.dsh-fleet-budget-meter-value[data-state="danger"],
.dsh-fleet-budget-meter-value[data-state="exhausted"] { stroke: #d35454; }
.dsh-fleet-budget-meter-value[data-state="unlimited"] { stroke: var(--dsw-alias-label-tertiary); }

.dsh-fleet-budget-popover {
  z-index: 100000;
  box-sizing: border-box;
  width: min(320px, calc(100vw - 24px));
  max-height: min(420px, calc(100dvh - 24px));
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-inverted);
  border-radius: 12px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-specific-menu);
  box-shadow: var(--dsw-shadow-lv3);
  margin: 0;
  position: fixed;
  inset: auto;
  overflow-y: auto;
  font-size: 12px;
  line-height: 20px;
}

.dsh-fleet-budget-popover::backdrop { background: transparent; }

.dsh-fleet-budget-popover-header {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.dsh-fleet-budget-popover-headline {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-fleet-budget-popover-percent,
.dsh-fleet-budget-popover-figures {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.dsh-fleet-budget-popover-figures {
  margin-left: auto;
  white-space: nowrap;
}

.dsh-fleet-budget-popover-progress {
  display: flex;
  gap: 1px;
  height: 4px;
  margin: 10px 0 12px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-budget-popover-progress span {
  flex: none;
  min-width: 2px;
  height: 100%;
  border-radius: 1px;
  background: var(--budget-member-color, var(--dsw-alias-label-tertiary));
}

.dsh-fleet-budget-popover-members {
  margin: 0;
}

.dsh-fleet-budget-popover-member {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0;
}

.dsh-fleet-budget-popover-member dt,
.dsh-fleet-budget-popover-member dd {
  min-width: 0;
  margin: 0;
}

.dsh-fleet-budget-popover-member dt {
  display: flex;
  align-items: baseline;
  overflow: hidden;
}

.dsh-fleet-budget-popover-member-dot {
  flex: 0 0 auto;
  align-self: center;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 2px;
  background: var(--budget-member-color, var(--dsw-alias-label-tertiary));
}

.dsh-fleet-budget-popover-member-name {
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}

.dsh-fleet-budget-popover-member-role {
  flex: 1 1 auto;
  margin-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}

.dsh-fleet-budget-popover-member-usage {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.dsh-fleet-budget-popover-manage {
  width: 100%;
  margin-top: 13px;
  padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-normal);
  border-radius: 7px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.dsh-fleet-budget-popover-manage:hover { background: var(--dsw-alias-interactive-bg-hover); }

.dsh-fleet-panel-settings-facts {
  color: var(--dsw-alias-label-secondary);
  border-top: 1px solid var(--dsw-alias-border-l3);
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 8px 18px;
  margin: 24px 0 0;
  padding-top: 16px;
  font: var(--dsw-font-xs-13);
  display: grid;
}

.dsh-fleet-panel-settings-facts :is(dt, dd) {
  min-width: 0;
  margin: 0;
}

.dsh-fleet-panel-settings-facts dd {
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}

.dsh-fleet-panel-settings-action-row {
  display: flex;
}

.dsh-fleet-panel-settings-inline-action {
  min-height: 32px;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  padding: 0;
  font: var(--dsw-font-xs-strong-13);
}

.dsh-fleet-panel-settings-danger {
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 32%, var(--dsw-alias-border-l3));
  border-radius: 10px;
  padding: 18px;
}

.dsh-fleet-panel-settings-danger button {
  min-height: 34px;
  color: #fff;
  cursor: pointer;
  background: var(--dsw-alias-state-error-primary);
  border: 0;
  border-radius: 8px;
  padding: 0 12px;
  font: var(--dsw-font-xs-strong-13);
}

.dsh-fleet-panel-settings-danger button:disabled {
  cursor: default;
  opacity: .52;
}

.dsh-fleet-panel-settings-footer {
  min-height: 58px;
  border-top: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  display: flex;
}

.dsh-fleet-panel-settings-feedback {
  min-width: 0;
  color: var(--dsw-alias-state-success-primary, var(--dsw-alias-label-secondary));
  flex: 1;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-settings-feedback [data-error="true"] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-panel-settings-secondary,
.dsh-fleet-panel-settings-primary {
  min-height: 34px;
  cursor: pointer;
  border: 0;
  border-radius: 8px;
  padding: 0 13px;
  font: var(--dsw-font-xs-strong-13);
}

.dsh-fleet-panel-settings-secondary {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-settings-primary {
  color: var(--dsw-alias-button-primary-label, #fff);
  background: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-settings-primary:disabled,
.dsh-fleet-panel-settings-secondary:disabled {
  cursor: default;
  opacity: .52;
}

.dsh-fleet-panel-import-dialog {
  width: min(480px, calc(100vw - 32px));
  height: auto;
  min-height: 0;
}

@media (max-width: 640px) {
  .dsh-fleet-panel-settings-overlay {
    padding: 12px;
  }

  .dsh-fleet-panel-settings-dialog {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
    max-height: none;
  }

  .dsh-fleet-panel-settings-workspace {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .dsh-fleet-panel-settings-model-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }

  .dsh-fleet-panel-settings-nav {
    border-inline-end: 0;
    border-bottom: 1px solid var(--dsw-alias-border-l3);
    flex-direction: row;
    padding: 7px;
    overflow-x: auto;
  }

  .dsh-fleet-panel-settings-nav-item {
    min-width: max-content;
    min-height: 40px;
  }

  .dsh-fleet-panel-settings-nav-item[data-danger="true"] {
    margin-top: 0;
    margin-inline-start: auto;
  }

  .dsh-fleet-panel-settings-content {
    padding: 18px 16px 24px;
  }
}

.dsh-fleet-panel-control-dialog-body {
  border-top: 1px solid var(--dsw-alias-border-l3);
  padding: 18px;
}

.dsh-fleet-panel-control-dialog-copy {
  margin: 0 0 14px;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
  line-height: 20px;
}

.dsh-fleet-panel-control-dialog-label {
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-control-dialog-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 88px;
  margin-top: 7px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 9px 10px;
  font: var(--dsw-font-s-14);
  line-height: 20px;
  resize: vertical;
}

.dsh-fleet-panel-control-dialog-input:focus {
  border-color: var(--dsw-alias-state-business-primary);
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent);
  outline-offset: 1px;
}

.dsh-fleet-panel-control-dialog-actions {
  justify-content: flex-end;
  gap: 8px;
  padding: 0 18px 18px;
  display: flex;
}

.dsh-fleet-panel-agent-switcher {
  min-width: 0;
  border-top: 1px solid var(--dsw-alias-border-l3);
  padding-top: 4px;
  position: relative;
}

.dsh-fleet-panel-agent-switch {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  align-items: center;
  gap: 8px;
  padding: 4px 7px;
  font: inherit;
  text-align: left;
  display: flex;
}

.dsh-fleet-panel-agent-switch:hover,
.dsh-fleet-panel-agent-switch[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-agent-switch:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-agent-switch-copy {
  min-width: 0;
  flex: 1;
}

.dsh-fleet-panel-agent-switch-name,
.dsh-fleet-panel-agent-switch-role {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-panel-agent-switch-name {
  font-size: 12px;
  font-weight: 560;
  line-height: 16px;
}

.dsh-fleet-panel-agent-switch-role {
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 14px;
}

.dsh-fleet-panel-agent-switch-chevron {
  color: var(--dsw-alias-label-secondary);
  flex: none;
  transition: transform 120ms ease-out;
}

.dsh-fleet-panel-agent-switch[aria-expanded="true"] .dsh-fleet-panel-agent-switch-chevron {
  transform: rotate(180deg);
}

.dsh-fleet-panel-resize-handle {
  width: 8px;
  cursor: col-resize;
  touch-action: none;
  position: relative;
  z-index: 10;
  grid-column: 3;
  grid-row: 1;
}

.dsh-fleet-panel-resize-handle::before {
  width: 1px;
  height: calc(100% - 16px);
  background: transparent;
  border-radius: 1px;
  content: "";
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  transition: background 120ms ease-out;
}

.dsh-fleet-panel-resize-handle:hover::before,
.dsh-fleet-panel-resize-handle:focus-visible::before,
.dsh-fleet-panel-resize-handle:active::before,
.dsh-fleet-panel-resize-handle[data-resizing="true"]::before {
  width: 2px;
  background: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-resize-handle:focus-visible {
  outline: 0;
}

.dsh-fleet-panel-sidebar-head {
  flex: none;
  padding: 10px 14px;
}

.dsh-fleet-panel-team-row {
  min-width: 0;
  align-items: center;
  gap: 7px;
  margin-bottom: 10px;
  display: flex;
}

.dsh-fleet-panel-team-title {
  min-width: 0;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-s-strong-14);
  overflow: hidden;
}

button.dsh-fleet-panel-team-title {
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 2px 4px;
  text-align: left;
}

button.dsh-fleet-panel-team-title:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

button.dsh-fleet-panel-team-title:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-directory-group {
  margin-top: 6px;
}

.dsh-fleet-panel-directory-summary {
  width: 100%;
  min-height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  align-items: center;
  gap: 6px;
  padding: 4px 7px;
  font: inherit;
  font-size: 11px;
  font-weight: 560;
  text-align: left;
  display: flex;
}

.dsh-fleet-panel-directory-summary:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-directory-summary:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-directory-chevron {
  width: 12px;
  height: 12px;
  color: var(--dsw-alias-label-secondary);
  flex: none;
  place-items: center;
  display: grid;
  transform: rotate(-90deg);
  transform-origin: center;
  transition: transform 120ms ease-out;
}

.dsh-fleet-panel-directory-summary[aria-expanded="true"] .dsh-fleet-panel-directory-chevron {
  transform: rotate(0);
}

.dsh-fleet-panel-team-row-status {
  width: 7px;
  height: 7px;
  background: var(--dsw-alias-label-quaternary, #a7a7a7);
  border-radius: 50%;
  flex: none;
}

.dsh-fleet-panel-team-row-status[data-status="running"] {
  background: var(--dsw-alias-state-success-primary, #4f9a6e);
}

.dsh-fleet-panel-team-row-status[data-status="idle"] {
  background: var(--dsw-alias-state-warning-primary, #c38b36);
}

.dsh-fleet-panel-attention {
  width: 6px;
  height: 6px;
  background: var(--dsw-alias-state-warning-primary, #c38b36);
  border-radius: 50%;
  flex: none;
}

.dsh-fleet-panel-search-wrap {
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-base);
  border: 1px solid transparent;
  border-radius: 8px;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  display: flex;
}

.dsh-fleet-panel-search-wrap:focus-within {
  border-color: var(--dsw-alias-border-l2);
}

.dsh-fleet-panel-search {
  width: 100%;
  height: 30px;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  border: 0;
  outline: 0;
  padding: 0;
  font: inherit;
  font-size: 12px;
}

.dsh-fleet-panel-search::placeholder {
  color: var(--dsw-alias-label-secondary);
}

.dsh-fleet-panel-sidebar-scroll {
  min-height: 0;
  scrollbar-color: var(--dsw-alias-border-l2) transparent;
  flex: 1;
  overflow-y: auto;
  padding: 2px 8px 16px;
}

.dsh-fleet-panel-section-title {
  color: var(--dsw-alias-label-secondary);
  align-items: center;
  justify-content: space-between;
  margin: 13px 7px 5px;
  font-size: 11px;
  font-weight: 560;
  line-height: 16px;
  display: flex;
}

.dsh-fleet-panel-section-action {
  min-height: 26px;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0 7px;
  font: inherit;
}

.dsh-fleet-panel-section-action:not(:disabled):hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-section-action:disabled {
  cursor: default;
  opacity: .55;
}

.dsh-fleet-panel-section-action:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-section-actions {
  align-items: center;
  gap: 2px;
  display: flex;
}

.dsh-fleet-panel-section-action[data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-panel-section-action[data-tone="danger"][aria-pressed="true"],
.dsh-fleet-panel-section-action[data-tone="danger"]:not(:disabled):hover {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent);
}

.dsh-fleet-panel-resource-upload-error {
  color: var(--dsw-alias-state-error-primary);
  margin: 4px 7px 8px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-list-row {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font: inherit;
  text-align: left;
  display: flex;
}

.dsh-fleet-panel-list-row:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-list-row[aria-current="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dsh-fleet-panel-list-row + .dsh-fleet-panel-list-row {
  margin-top: 2px;
}

.dsh-fleet-panel-channel-hint {
  width: 100%;
  display: flex;
}

.dsh-fleet-panel-channel-hint + .dsh-fleet-panel-channel-hint {
  margin-top: 2px;
}

.dsh-fleet-panel-member-list-anchor + .dsh-fleet-panel-member-list-anchor {
  margin-top: 2px;
}

.dsh-fleet-panel-list-icon {
  width: 18px;
  color: var(--dsw-alias-label-secondary);
  flex: none;
  place-items: center;
  display: grid;
}

.dsh-fleet-panel-list-copy {
  min-width: 0;
  flex: 1;
}

.dsh-fleet-panel-list-title,
.dsh-fleet-panel-list-caption {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-panel-list-title {
  font-size: 12px;
  line-height: 17px;
}

.dsh-fleet-panel-list-caption {
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 14px;
}

.dsh-fleet-panel-resource-file-item {
  min-width: 0;
  position: relative;
}

.dsh-fleet-panel-resource-file-item + .dsh-fleet-panel-resource-file-item {
  margin-top: 2px;
}

.dsh-fleet-panel-resource-file-item[data-removal-mode="true"] .dsh-fleet-panel-list-row {
  padding-inline-end: 40px;
}

.dsh-fleet-panel-resource-file-title {
  min-width: 0;
  align-items: baseline;
  gap: 6px;
  display: flex;
}

.dsh-fleet-panel-resource-file-name {
  min-width: 0;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-panel-resource-file-size {
  color: var(--dsw-alias-label-caption);
  flex: none;
  white-space: nowrap;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.dsh-fleet-panel-resource-file-remove {
  width: 28px;
  height: 28px;
  color: var(--dsw-alias-state-error-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  place-items: center;
  padding: 0;
  display: grid;
  position: absolute;
  top: 50%;
  right: 5px;
  z-index: 1;
  transform: translateY(-50%);
}

.dsh-fleet-panel-resource-file-remove:not(:disabled):hover {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent);
}

.dsh-fleet-panel-resource-file-remove:focus-visible {
  outline: 2px solid var(--dsw-alias-state-error-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-resource-file-remove:disabled {
  cursor: default;
  opacity: .45;
}

.dsh-fleet-panel-unread {
  min-width: 17px;
  height: 17px;
  color: white;
  background: var(--dsw-alias-state-business-primary);
  border-radius: 9px;
  flex: none;
  padding-inline: 4px;
  font-size: 10px;
  line-height: 17px;
  text-align: center;
}

.dsh-fleet-panel-presence {
  box-sizing: border-box;
  width: 9px;
  height: 9px;
  background: var(--dsw-alias-label-quaternary, #a7a7a7);
  border-radius: 50%;
  flex: none;
}

.dsh-fleet-panel-presence[data-presence="active"] {
  background: var(--dsw-alias-state-success-primary, #4f9a6e);
}

.dsh-fleet-panel-presence[data-presence="busy"] {
  background: var(--dsw-alias-state-warning-primary, #c38b36);
}

.dsh-fleet-panel-presence[data-presence="waiting"] {
  background: var(--dsw-alias-state-business-primary, #4f76c7);
}

.dsh-fleet-panel-presence[data-presence="error"] {
  background: var(--dsw-alias-state-error-primary, #d14d4d);
}

.dsh-fleet-panel-presence[data-presence="unknown"] {
  background: transparent;
  border: 1px solid var(--dsw-alias-label-tertiary, #858b94);
}

.dsh-fleet-panel-member-state {
  color: var(--dsw-alias-label-secondary);
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 17px;
  white-space: nowrap;
  display: inline-flex;
}

.dsh-fleet-panel-member-state[data-presence="error"] {
  color: var(--dsw-alias-state-error-primary, #d14d4d);
}

.dsh-fleet-panel-main {
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  border: 0;
  border-radius: 12px;
  box-shadow: 0 1px 4px color-mix(in srgb, #24394d 12%, transparent);
  flex-direction: column;
  display: flex;
  overflow: hidden;
  grid-column: 4;
  grid-row: 1;
}

.dsh-fleet-panel-main-content {
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: flex;
  overflow: hidden;
}

.dsh-fleet-panel-connection {
  min-height: 36px;
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in srgb, var(--dsw-alias-state-warning-primary, #c38b36) 8%, var(--dsw-alias-bg-layer-1));
  border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #c38b36) 22%, transparent);
  align-items: center;
  gap: 9px;
  padding: 6px 12px;
  font-size: 12px;
  line-height: 18px;
  display: flex;
}

.dsh-fleet-panel-connection[data-status="loading"] {
  background: var(--dsw-alias-bg-layer-1);
  border-bottom-color: var(--dsw-alias-border-l3);
}

.dsh-fleet-panel-connection-dot {
  width: 7px;
  height: 7px;
  background: var(--dsw-alias-state-warning-primary, #c38b36);
  border-radius: 50%;
  flex: none;
}

.dsh-fleet-panel-connection[data-status="loading"] .dsh-fleet-panel-connection-dot {
  background: var(--dsw-alias-state-business-primary);
  animation: dsh-fleet-panel-pulse 1.2s ease-in-out infinite;
}

.dsh-fleet-panel-connection-copy {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}

.dsh-fleet-panel-connection-retry {
  min-height: 26px;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  flex: none;
  padding: 0 7px;
  font: inherit;
  font-weight: 560;
}

.dsh-fleet-panel-connection-retry:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-connection-retry:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

@keyframes dsh-fleet-panel-pulse {
  50% { opacity: .35; }
}

.dsh-fleet-panel-chat,
.dsh-fleet-panel-detail {
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  display: flex;
}

.dsh-fleet-panel-chat-log {
  min-height: 0;
  scrollbar-color: var(--dsw-alias-border-l2) transparent;
  flex: 1;
  overflow-y: auto;
}

.dsh-fleet-panel-chat-log-wrap {
  height: 100%;
  min-height: 0;
  flex: 1;
  position: relative;
  overflow: hidden;
}

.dsh-fleet-panel-chat-log-wrap > .dsh-fleet-panel-chat-log {
  height: 100%;
}

.dsh-fleet-panel-chat-log-wrap[data-column-resizing="true"] {
  cursor: col-resize;
  user-select: none;
}

.dsh-fleet-panel-chat-width-handle {
  appearance: none;
  width: 20px;
  height: 32px;
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
  left: clamp(0px, calc(50% + var(--dsh-fleet-panel-chat-column-width, 760px) / 2 - 10px), calc(100% - 20px));
  z-index: 3;
}

.dsh-fleet-panel-chat-width-handle::before {
  width: 2px;
  height: 20px;
  content: '';
  background: currentColor;
  border-radius: 2px;
  opacity: .55;
}

.dsh-fleet-panel-chat-width-handle:hover,
.dsh-fleet-panel-chat-width-handle:focus-visible,
.dsh-fleet-panel-chat-width-handle[data-dragging="true"] {
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
}

.dsh-fleet-panel-chat-width-handle:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-resource-compare-resize-track {
  width: 20px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;
  box-sizing: border-box;
  place-items: start center;
  padding-top: 8px;
  display: grid;
  position: absolute;
  top: 0;
  left: var(--dsh-fleet-panel-resource-compare-split);
  z-index: 4;
  transform: translateX(-50%);
}

.dsh-fleet-panel-resource-compare-resize-track::before {
  width: 8px;
  height: 32px;
  content: '';
  pointer-events: none;
  background: var(--dsw-alias-bg-layer-2);
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
}

.dsh-fleet-panel-resource-compare-resize-track > .dsh-fleet-panel-chat-width-handle {
  pointer-events: none;
  position: relative;
  top: auto;
  left: auto;
  z-index: 1;
}

.dsh-fleet-panel-resource-compare-resize-track:hover > .dsh-fleet-panel-chat-width-handle,
.dsh-fleet-panel-resource-compare-resize-track:focus-visible > .dsh-fleet-panel-chat-width-handle,
.dsh-fleet-panel-resource-compare-resize-track[data-dragging="true"] > .dsh-fleet-panel-chat-width-handle {
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
}

.dsh-fleet-panel-resource-compare-resize-track:focus-visible {
  outline: 0;
}

.dsh-fleet-panel-resource-compare-resize-track:focus-visible > .dsh-fleet-panel-chat-width-handle {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-chat-new-messages {
  min-height: 30px;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: var(--dsw-alias-bg-layer-1);
  border: 0;
  border-radius: 9px;
  box-shadow: var(--dsw-shadow-lv1);
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font: var(--dsw-font-xs-13);
  display: flex;
  position: absolute;
  right: 16px;
  bottom: 12px;
  z-index: 2;
}

.dsh-fleet-panel-chat-new-messages:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dsh-fleet-panel-chat-new-messages:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-chat-new-messages svg {
  transform: rotate(180deg);
}

.dsh-fleet-panel-chat-history-loading {
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent);
  border-radius: 8px;
  box-shadow: var(--dsw-shadow-lv1);
  padding: 5px 9px;
  font: var(--dsw-font-xs-13);
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 2;
  transform: translateX(-50%);
}

.dsh-fleet-panel-chat-column {
  box-sizing: border-box;
  width: min(100%, var(--dsh-fleet-panel-chat-column-width, 760px));
  min-height: 100%;
  margin: 0 auto;
  padding: 22px 24px 28px;
  flex-direction: column;
  gap: 16px;
  display: flex;
}

.dsh-fleet-panel-empty {
  min-height: 220px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  place-items: center;
  padding: 28px;
  font-size: 13px;
  display: grid;
}

.dsh-fleet-panel-composer-wrap {
  flex: none;
  padding: 0 20px 16px;
}

.dsh-fleet-official-composer {
  --dsh-composer-side-clearance: 0px;
  --dsh-composer-card-max-width: 780px;
  padding-bottom: 12px;
}

.dsh-fleet-official-composer > div {
  padding: 0;
}

.dsh-fleet-session-goal-dock {
  box-sizing: border-box;
  width: calc(100% - 32px);
  max-width: 748px;
  min-height: 36px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-tip);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  align-items: center;
  gap: 10px;
  margin: 0 auto 6px;
  padding: 7px 12px;
  display: flex;
}

.dsh-fleet-session-goal-phase {
  color: var(--dsw-alias-label-secondary);
  flex: none;
  font: var(--dsw-font-xs-strong-13);
}

.dsh-fleet-session-goal-objective {
  min-width: 0;
  color: var(--dsw-alias-label-primary-dimmed);
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  font: var(--dsw-font-xs-13);
  overflow: hidden;
}

.dsh-fleet-official-composer button[aria-haspopup="listbox"]:disabled {
  display: none;
}

.dsh-fleet-conversation-command-menu {
  z-index: 100;
  width: min(537px, 100%);
  max-height: 320px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-menu);
  border: 1px solid var(--dsw-alias-border-inverted);
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv3);
  flex-direction: column;
  padding: 4px;
  display: flex;
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  overflow-y: auto;
}

.dsh-fleet-conversation-command-menu-title {
  color: var(--dsw-alias-label-tertiary);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 16px;
}

.dsh-fleet-conversation-command-menu-back {
  width: 100%;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
}

.dsh-fleet-conversation-command-menu-back:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-conversation-command-menu-item {
  width: 100%;
  min-height: 40px;
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 10px;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 14px;
  line-height: 22px;
  display: flex;
}

.dsh-fleet-conversation-command-menu-item:hover,
.dsh-fleet-conversation-command-menu-item[aria-selected="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-conversation-command-menu-name {
  max-width: 40%;
  flex: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-conversation-command-menu-description {
  min-width: 0;
  color: var(--dsw-alias-label-tertiary);
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-official-composer-loading {
  min-height: 92px;
  color: var(--dsw-alias-label-secondary);
  place-items: center;
  font: var(--dsw-font-xs-13);
  display: grid;
}

.dsh-fleet-panel-urgent-toggle {
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 0 8px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-urgent-toggle:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-urgent-toggle[aria-pressed="true"] {
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
}

.dsh-fleet-panel-urgent-toggle:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-compose-context,
.dsh-fleet-panel-compose-error {
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-panel-compose-context {
  color: var(--dsw-alias-label-secondary);
}

.dsh-fleet-panel-compose-error {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-panel-detail-head {
  min-height: 52px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  display: flex;
}

.dsh-fleet-panel-detail-title {
  min-width: 0;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--dsw-font-s-strong-14);
  overflow: hidden;
}

.dsh-fleet-panel-detail-meta {
  color: var(--dsw-alias-label-secondary);
  flex: 1;
  font-size: 11px;
}

.dsh-fleet-panel-main-actions {
  align-items: center;
  gap: 4px;
  display: flex;
}

.dsh-fleet-panel-navigation-toggle {
  width: 28px;
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  place-items: center;
  padding: 0;
  display: none;
}

.dsh-fleet-panel-navigation-toggle:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-navigation-toggle:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-detail-scroll {
  min-height: 0;
  scrollbar-color: var(--dsw-alias-border-l2) transparent;
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.dsh-fleet-panel-overview {
  width: min(100%, 760px);
  margin: 0 auto;
}

.dsh-fleet-panel-agent-view-meta {
  min-width: 0;
  max-width: min(42vw, 420px);
  color: var(--dsw-alias-label-secondary);
  align-items: center;
  gap: 5px;
  font-size: 11px;
  white-space: nowrap;
  display: inline-flex;
}

.dsh-fleet-panel-agent-view-role {
  min-width: 0;
  text-overflow: ellipsis;
  overflow: hidden;
}

.dsh-fleet-panel-agent-view-separator {
  color: var(--dsw-alias-label-tertiary);
  flex: none;
}

.dsh-fleet-panel-agent-chat-column {
  box-sizing: border-box;
  width: min(100%, var(--dsh-fleet-panel-chat-column-width, 820px));
  min-height: 100%;
  margin: 0 auto;
  padding: 22px 24px 28px;
  flex-direction: column;
  gap: 16px;
  display: flex;
}

.dsh-fleet-panel-agent-message-row {
  width: 100%;
  display: flex;
}

.dsh-fleet-panel-agent-message-row > .dsh-fleet-chat-message {
  width: 100%;
}

.dsh-fleet-panel-agent-message-row[data-self="false"] .dsh-fleet-chat-message-body {
  box-sizing: border-box;
  width: fit-content;
  max-width: 100%;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-layer-1));
  border-radius: 11px;
  padding: 8px 10px;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] {
  justify-content: flex-end;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] > .dsh-fleet-chat-message {
  grid-template-columns: minmax(0, 1fr) 34px;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-avatar {
  grid-column: 2;
  grid-row: 1;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-panel-member-avatar-anchor {
  grid-column: 2;
  grid-row: 1;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-message-main {
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

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-message-meta {
  display: contents;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-message-sender {
  width: max-content;
  max-width: min(320px, calc(100vw - 96px));
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-message-delivery {
  flex: none;
  align-self: flex-start;
  gap: 4px;
  margin-bottom: 2px;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-message-body {
  box-sizing: border-box;
  width: fit-content;
  max-width: 100%;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, var(--dsw-alias-bg-layer-1));
  border-radius: 11px;
  padding: 8px 10px;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-message-time {
  order: 1;
  margin-left: 0;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-message-receipt {
  order: 2;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-message-actions {
  order: 3;
  margin-left: 0;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-message-role {
  order: 5;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-message-name {
  order: 4;
  margin-left: auto;
}

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-message-state {
  align-self: flex-end;
}

.dsh-fleet-panel-agent-readonly {
  min-height: 40px;
  color: var(--dsw-alias-label-secondary);
  border-top: 1px solid var(--dsw-alias-border-l3);
  place-items: center;
  padding: 0 18px;
  font-size: 11px;
  display: grid;
}

.dsh-fleet-panel-native-context {
  position: relative;
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: flex;
  overflow: hidden;
}

.dsh-fleet-panel-native-context-scroll {
  width: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.dsh-fleet-panel-native-context-scroll > * {
  min-height: 100%;
}

.dsh-fleet-panel-native-context [data-fleet-context-target="true"] {
  border-radius: 10px;
  outline: 2px solid var(--dsw-static-deepseek-500, #3370ff);
  outline-offset: 2px;
  box-shadow: 0 5px 18px color-mix(in srgb, var(--dsw-static-deepseek-500, #3370ff) 16%, transparent);
}

.dsh-fleet-panel-native-context-locate {
  position: absolute;
  z-index: 2;
  inset-block-start: 10px;
  inset-inline-end: 12px;
  max-width: min(320px, calc(100% - 24px));
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 8px;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);
  padding: 6px 9px;
  font-size: 11px;
  line-height: 17px;
}

.dsh-fleet-panel-trace {
  min-width: 0;
  min-height: 0;
  scrollbar-color: var(--dsw-alias-border-l2) transparent;
  flex: 1;
  overflow-y: auto;
  padding: 18px clamp(14px, 3vw, 30px) 26px;
}

.dsh-fleet-panel-trace-note {
  max-width: 70ch;
  color: var(--dsw-alias-label-secondary);
  margin: 0 auto 16px;
  font-size: 12px;
  line-height: 19px;
}

.dsh-fleet-panel-trace-list {
  width: min(100%, 760px);
  margin: 0 auto;
  flex-direction: column;
  gap: 10px;
  display: flex;
}

.dsh-fleet-panel-trace-event {
  width: min(78%, 620px);
  min-width: 0;
  align-self: flex-start;
}

.dsh-fleet-panel-trace-event[data-agent="true"] {
  align-self: flex-end;
}

.dsh-fleet-panel-trace-event[data-target="true"] {
  border-radius: 11px;
  outline: 2px solid var(--dsw-static-deepseek-500, #3370ff);
  outline-offset: 2px;
  box-shadow: 0 5px 18px color-mix(in srgb, var(--dsw-static-deepseek-500, #3370ff) 16%, transparent);
}

.dsh-fleet-panel-trace-event[data-target="true"] .dsh-fleet-panel-trace-event-body {
  background: color-mix(in srgb, var(--dsw-static-deepseek-500, #3370ff) 9%, var(--dsw-alias-bg-layer-1));
}

.dsh-fleet-panel-trace-event-meta {
  color: var(--dsw-alias-label-secondary);
  align-items: baseline;
  gap: 7px;
  margin: 0 4px 3px;
  font-size: 10px;
  line-height: 15px;
  display: flex;
}

.dsh-fleet-panel-trace-event-time {
  margin-inline-start: auto;
}

.dsh-fleet-panel-trace-target-label {
  color: var(--dsw-static-deepseek-500, #3370ff);
  font-weight: 600;
}

.dsh-fleet-panel-trace-event-body {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  border-radius: 11px;
  padding: 8px 10px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 20px;
}

.dsh-fleet-panel-trace-event[data-agent="true"] .dsh-fleet-panel-trace-event-body {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, var(--dsw-alias-bg-layer-1));
}

.dsh-fleet-panel-trace-state {
  min-height: 160px;
  color: var(--dsw-alias-label-secondary);
  place-items: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  font-size: 12px;
  display: grid;
}

.dsh-fleet-panel-trace-retry {
  min-height: 32px;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 0 10px;
  font: inherit;
  font-weight: 560;
}

.dsh-fleet-panel-trace-retry:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-trace-retry:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-overview-title {
  margin: 0 0 5px;
  font-size: 22px;
  font-weight: 620;
  line-height: 29px;
  letter-spacing: -.02em;
}

.dsh-fleet-panel-member-heading {
  align-items: baseline;
  column-gap: 10px;
  row-gap: 2px;
  display: flex;
  flex-wrap: wrap;
}

.dsh-fleet-panel-member-heading-role {
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  font-weight: 450;
  line-height: 21px;
  letter-spacing: 0;
}

.dsh-fleet-panel-overview-copy {
  max-width: 68ch;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 21px;
}

.dsh-fleet-panel-facts {
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin-top: 24px;
}

.dsh-fleet-panel-home-team-list {
  max-width: 560px;
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin-top: 22px;
  padding-top: 8px;
}

.dsh-fleet-panel-home-team-list .dsh-fleet-panel-list-row {
  min-height: 44px;
}

.dsh-fleet-panel-overview-actions {
  align-items: center;
  gap: 10px;
  margin-top: 18px;
  display: flex;
  flex-wrap: wrap;
}

.dsh-fleet-panel-member-request {
  max-width: 820px;
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin-top: 24px;
  padding-top: 20px;
}

.dsh-fleet-panel-member-request-head h3 {
  color: var(--dsw-alias-label-primary);
  margin: 0;
  font: var(--dsw-font-m-strong-16);
}

.dsh-fleet-panel-member-request-head p {
  max-width: 68ch;
  color: var(--dsw-alias-label-secondary);
  margin: 5px 0 0;
  font: var(--dsw-font-xs-13);
  line-height: 1.55;
}

.dsh-fleet-panel-member-request-grid {
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 1.35fr);
  gap: 14px 18px;
  margin-top: 16px;
  display: grid;
}

.dsh-fleet-panel-member-request-field {
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  gap: 6px;
  font: var(--dsw-font-xs-13);
  display: grid;
}

.dsh-fleet-panel-member-request-field[data-wide="true"] {
  grid-column: 1 / -1;
}

.dsh-fleet-panel-member-request-field :is(input, select) {
  box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 9px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-request-field :is(input, select):focus-visible,
.dsh-fleet-panel-member-request-actions button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-member-request-field :is(input, select):disabled {
  cursor: default;
  opacity: .6;
}

.dsh-fleet-panel-member-request-field input::placeholder {
  color: var(--dsw-alias-label-caption);
}

.dsh-fleet-panel-member-model-select {
  width: fit-content;
  max-width: min(360px, 100%);
  min-width: 0;
  position: relative;
}

.dsh-fleet-panel-member-model-trigger {
  max-width: 100%;
  min-width: 0;
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 24px;
  outline: 0;
  align-items: center;
  gap: 4px;
  padding: 0 4px 0 8px;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  display: flex;
}

.dsh-fleet-panel-member-model-trigger:hover:not(:disabled),
.dsh-fleet-panel-member-model-trigger[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-member-model-trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);
}

.dsh-fleet-panel-member-model-trigger:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.dsh-fleet-panel-member-model-trigger-label {
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-panel-member-model-trigger-effort,
.dsh-fleet-panel-member-model-chevron {
  color: var(--dsw-alias-label-caption);
  flex: none;
}

.dsh-fleet-panel-member-model-chevron {
  line-height: 0;
  transition: transform 120ms ease-out;
}

.dsh-fleet-panel-member-model-trigger[aria-expanded="true"] .dsh-fleet-panel-member-model-chevron {
  transform: rotate(180deg);
}

.dsh-fleet-panel-member-model-menu {
  box-sizing: border-box;
  z-index: 20;
  width: max-content;
  min-width: min(240px, calc(100vw - 32px));
  max-width: min(420px, calc(100vw - 32px));
  max-height: min(360px, calc(100vh - 96px));
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-menu);
  border: 1px solid var(--dsw-alias-border-inverted);
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv3);
  flex-direction: column;
  padding: 4px;
  display: flex;
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  overflow: hidden;
}

.dsh-fleet-panel-member-model-status,
.dsh-fleet-panel-member-model-empty {
  color: var(--dsw-alias-label-tertiary);
  padding: 10px;
  font-size: 13px;
  line-height: 20px;
}

.dsh-fleet-panel-member-model-error,
.dsh-fleet-panel-member-model-warning {
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover-danger);
  border-radius: 8px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  padding: 7px 8px;
  font-size: 12px;
  line-height: 18px;
  display: flex;
}

.dsh-fleet-panel-member-model-warning {
  color: var(--dsw-alias-state-warn-label);
  background: var(--dsw-alias-bg-module-platform);
}

.dsh-fleet-panel-member-model-retry {
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  flex: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
}

.dsh-fleet-panel-member-model-groups {
  min-height: 0;
  overflow-y: auto;
}

.dsh-fleet-panel-member-model-group + .dsh-fleet-panel-member-model-group {
  margin-top: 4px;
}

.dsh-fleet-panel-member-model-group-title {
  z-index: 1;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-specific-menu);
  padding: 5px 8px 3px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  position: sticky;
  top: 0;
}

.dsh-fleet-panel-member-model-option {
  box-sizing: border-box;
  width: auto;
  min-width: 100%;
  min-height: 38px;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 10px;
  outline: 0;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  display: flex;
}

.dsh-fleet-panel-member-model-option:hover:not(:disabled),
.dsh-fleet-panel-member-model-option:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-member-model-option:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}

.dsh-fleet-panel-member-model-option-copy {
  min-width: 0;
  flex: 1;
  flex-direction: column;
  display: flex;
}

.dsh-fleet-panel-member-model-option-name {
  color: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  overflow: hidden;
}

.dsh-fleet-panel-member-model-option-description {
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
}

.dsh-fleet-panel-member-model-option-check {
  width: 18px;
  color: var(--dsw-alias-label-primary);
  flex: 0 0 18px;
  place-items: center;
  display: grid;
}

.dsh-fleet-panel-member-request-note {
  color: var(--dsw-alias-label-secondary);
  margin: 8px 0 0;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-request-actions {
  min-height: 36px;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 14px;
  display: flex;
}

.dsh-fleet-panel-member-request-feedback {
  min-width: 0;
  color: var(--dsw-alias-state-success-primary, var(--dsw-alias-label-secondary));
  flex: 1;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-request-feedback[data-error="true"] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-panel-auth {
  max-width: 820px;
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin-top: 24px;
  padding-top: 20px;
}

.dsh-fleet-panel-auth-head {
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  display: flex;
}

.dsh-fleet-panel-auth-head h3,
.dsh-fleet-panel-auth-simple h4 {
  color: var(--dsw-alias-label-primary);
  margin: 0;
  font: var(--dsw-font-m-strong-16);
}

.dsh-fleet-panel-auth-head p {
  max-width: 68ch;
  color: var(--dsw-alias-label-secondary);
  margin: 5px 0 0;
  font: var(--dsw-font-xs-13);
  line-height: 1.55;
}

.dsh-fleet-panel-auth-mode {
  flex: none;
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 8px;
  padding: 2px;
  display: flex;
}

.dsh-fleet-panel-auth-mode button {
  min-width: 54px;
  height: 30px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0 10px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-auth-mode button[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
}

.dsh-fleet-panel-auth-mode button:focus-visible,
.dsh-fleet-panel-auth-levels button:focus-visible,
.dsh-fleet-panel-auth-exceptions button:focus-visible,
.dsh-fleet-panel-auth-access select:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-auth-simple h4 {
  margin-top: 24px;
  margin-bottom: 8px;
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-auth-levels {
  gap: 2px;
  display: grid;
}

.dsh-fleet-panel-auth-levels button {
  width: 100%;
  color: var(--dsw-alias-label-primary);
  text-align: start;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 9px 11px;
  display: grid;
}

.dsh-fleet-panel-auth-levels button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-auth-levels button[aria-pressed="true"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, transparent);
}

.dsh-fleet-panel-auth-levels button:disabled {
  cursor: default;
  opacity: .55;
}

.dsh-fleet-panel-auth-levels strong,
.dsh-fleet-panel-auth-access strong {
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-auth-levels span,
.dsh-fleet-panel-auth-access small {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
  line-height: 1.5;
}

.dsh-fleet-panel-auth-access {
  display: grid;
}

.dsh-fleet-panel-auth-access > label {
  min-height: 50px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 8px 0;
  display: flex;
}

.dsh-fleet-panel-auth-access > label > span {
  min-width: 0;
  display: grid;
}

.dsh-fleet-panel-auth-access select {
  box-sizing: border-box;
  min-width: 158px;
  height: 34px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 0 9px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-auth-exceptions {
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
  display: flex;
}

.dsh-fleet-panel-auth-exceptions button,
.dsh-fleet-panel-member-permissions-error button {
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  padding: 5px 7px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-auth-detailed > .dsh-fleet-panel-member-permissions,
.dsh-fleet-panel-auth-detailed > .dsh-fleet-panel-member-access {
  max-width: none;
}

.dsh-fleet-panel-auth-detailed > .dsh-fleet-panel-member-permissions {
  margin-top: 22px;
}

.dsh-fleet-panel-member-permissions {
  max-width: 820px;
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin-top: 24px;
  padding-top: 20px;
}

.dsh-fleet-panel-member-permissions-head {
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  display: flex;
}

.dsh-fleet-panel-member-permissions-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-m-strong-16);
}

.dsh-fleet-panel-member-permissions-copy {
  max-width: 68ch;
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
  line-height: 1.55;
}

.dsh-fleet-panel-member-permissions-source {
  color: var(--dsw-alias-label-secondary);
  flex: none;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-permissions-source::before {
  width: 6px;
  height: 6px;
  background: var(--dsw-alias-label-caption);
  border-radius: 50%;
  margin: 0 7px 1px 0;
  content: "";
  display: inline-block;
}

.dsh-fleet-panel-member-permissions-source[data-configured="true"]::before {
  background: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-member-permissions-section-head {
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
  display: flex;
}

.dsh-fleet-panel-member-permissions-section-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-member-permissions-section-meta {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-permissions-groups {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 10px;
  display: grid;
}

.dsh-fleet-panel-member-permission-group {
  min-width: 0;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 10px;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  display: flex;
  transition: background-color 140ms ease-out, border-color 140ms ease-out;
}

.dsh-fleet-panel-member-permission-group:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-member-permission-group:has(input:checked) {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-border-l3));
}

.dsh-fleet-panel-member-permission-group input {
  margin: 2px 0 0;
  accent-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-member-permission-group:focus-within {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-member-permission-group:has(input:disabled) {
  cursor: default;
  opacity: .62;
}

.dsh-fleet-panel-member-permission-group-copy {
  min-width: 0;
  flex: 1;
}

.dsh-fleet-panel-member-permission-group-name {
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-member-permission-group-detail {
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
  overflow-wrap: anywhere;
}

.dsh-fleet-panel-member-permission-group-scope {
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
}

.dsh-fleet-panel-member-permission-value {
  max-width: 100%;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 5px;
  padding: 2px 6px;
  font: var(--dsw-font-xs-13);
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-fleet-panel-member-permission-value[data-restricted="true"] {
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}

.dsh-fleet-panel-member-permission-more {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-permissions-empty {
  grid-column: 1 / -1;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 10px;
  margin: 0;
  padding: 14px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-permissions-manual {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
  row-gap: 18px;
  margin-top: 10px;
  display: grid;
}

.dsh-fleet-panel-member-permission-editor {
  min-width: 0;
  border-top: 1px solid var(--dsw-alias-border-l3);
  padding-top: 10px;
}

.dsh-fleet-panel-member-permission-editor-head {
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  display: flex;
}

.dsh-fleet-panel-member-permission-editor-title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-strong-13);
}

.dsh-fleet-panel-member-permission-editor-count {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-permission-editor-select {
  width: 100%;
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 7px;
  margin-top: 8px;
  padding: 5px 28px 5px 9px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-permission-editor-select:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-member-permission-editor-select:disabled {
  cursor: default;
  opacity: .62;
}

.dsh-fleet-panel-member-permission-editor-values {
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
}

.dsh-fleet-panel-member-permission-direct-value {
  max-width: 100%;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 6px;
  align-items: center;
  gap: 3px;
  padding: 2px 3px 2px 7px;
  font: var(--dsw-font-xs-13);
  display: inline-flex;
}

.dsh-fleet-panel-member-permission-direct-value[data-restricted="true"] {
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}

.dsh-fleet-panel-member-permission-direct-value-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-fleet-panel-member-permission-direct-value button {
  min-width: 42px;
  min-height: 26px;
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 5px;
  padding: 0 6px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-permission-direct-value button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-member-permission-direct-value button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-member-permission-direct-value button:disabled {
  cursor: default;
  opacity: .55;
}

.dsh-fleet-panel-member-permissions-effective {
  border-block: 1px solid var(--dsw-alias-border-l3);
  margin-top: 20px;
  padding-block: 12px;
}

.dsh-fleet-panel-member-permissions-effective summary {
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-member-permissions-effective-summary {
  margin-left: 6px;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
  font-weight: 400;
}

.dsh-fleet-panel-member-permissions-values {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  margin-top: 12px;
  display: grid;
}

.dsh-fleet-panel-member-permissions-value-group {
  min-width: 0;
}

.dsh-fleet-panel-member-permissions-value-title {
  margin: 0 0 7px;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-permissions-value-list {
  align-items: center;
  gap: 5px;
  display: flex;
  flex-wrap: wrap;
}

.dsh-fleet-panel-member-permissions-none {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-permissions-op {
  margin: 12px 0 0;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
  line-height: 1.55;
}

.dsh-fleet-panel-member-permissions-actions {
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
}

.dsh-fleet-panel-member-permissions-draft {
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-permissions-action-buttons {
  align-items: center;
  gap: 8px;
  display: flex;
  flex-wrap: wrap;
}

.dsh-fleet-panel-member-permissions-save-error {
  width: 100%;
  margin: 0;
  color: var(--dsw-alias-state-error-primary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-access {
  max-width: 820px;
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin-top: 24px;
  padding-top: 20px;
}

.dsh-fleet-panel-member-access-modes {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
  margin-top: 10px;
  display: grid;
}

.dsh-fleet-panel-member-access-mode {
  min-width: 0;
  border-top: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  display: flex;
}

.dsh-fleet-panel-member-access-mode-copy {
  min-width: 0;
}

.dsh-fleet-panel-member-access-mode-name {
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-strong-13);
}

.dsh-fleet-panel-member-access-mode-detail {
  margin-top: 2px;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-access-select,
.dsh-fleet-panel-member-access-input {
  box-sizing: border-box;
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 7px;
  padding: 5px 9px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-access-select:focus-visible,
.dsh-fleet-panel-member-access-input:focus-visible,
.dsh-fleet-panel-member-access-level:focus-within {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-member-access-select:disabled,
.dsh-fleet-panel-member-access-input:disabled {
  cursor: default;
  opacity: .62;
}

.dsh-fleet-panel-member-access-rules {
  margin-top: 10px;
}

.dsh-fleet-panel-member-access-rule {
  min-width: 0;
  border-top: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  gap: 10px;
  padding: 11px 0;
  display: flex;
}

.dsh-fleet-panel-member-access-rule-effect {
  min-width: 38px;
  color: var(--dsw-alias-state-success-primary, #287a4b);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #287a4b) 9%, transparent);
  border-radius: 5px;
  padding: 2px 6px;
  text-align: center;
  font: var(--dsw-font-xs-strong-13);
}

.dsh-fleet-panel-member-access-rule-effect[data-effect="deny"] {
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}

.dsh-fleet-panel-member-access-rule-copy {
  min-width: 0;
  flex: 1;
}

.dsh-fleet-panel-member-access-rule-resource {
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-strong-13);
  overflow-wrap: anywhere;
}

.dsh-fleet-panel-member-access-rule-detail {
  margin-top: 3px;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-access-remove {
  min-height: 30px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0 8px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-access-remove:hover {
  color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, transparent);
}

.dsh-fleet-panel-member-access-remove:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-member-access-remove:disabled {
  cursor: default;
  opacity: .55;
}

.dsh-fleet-panel-member-access-form {
  grid-template-columns: minmax(130px, .7fr) minmax(220px, 1.5fr);
  gap: 12px 16px;
  margin-top: 10px;
  display: grid;
}

.dsh-fleet-panel-member-access-field {
  min-width: 0;
  gap: 5px;
  display: grid;
}

.dsh-fleet-panel-member-access-field[data-wide="true"] {
  grid-column: 1 / -1;
}

.dsh-fleet-panel-member-access-label {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-access-levels {
  align-items: center;
  gap: 6px;
  display: flex;
  flex-wrap: wrap;
}

.dsh-fleet-panel-member-access-level {
  min-height: 30px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 6px;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  font: var(--dsw-font-xs-13);
  display: inline-flex;
}

.dsh-fleet-panel-member-access-level:has(input:checked) {
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
}

.dsh-fleet-panel-member-access-level input {
  margin: 0;
  accent-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-member-access-form-actions {
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  display: flex;
  flex-wrap: wrap;
}

.dsh-fleet-panel-member-access-feedback {
  min-width: 0;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-member-access-feedback[data-error="true"] {
  width: 100%;
  color: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-panel-resource-open-error {
  color: var(--dsw-alias-state-error-primary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-enter-messages {
  min-height: 34px;
  color: var(--dsw-alias-label-on-primary, #fff);
  cursor: pointer;
  background: var(--dsw-alias-state-business-primary);
  border: 0;
  border-radius: 8px;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
  font: var(--dsw-font-s-strong-14);
  display: inline-flex;
}

.dsh-fleet-panel-enter-messages:not(:disabled):hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 88%, black);
}

.dsh-fleet-panel-enter-messages:disabled {
  cursor: default;
  opacity: .55;
}

.dsh-fleet-panel-enter-messages:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-control-button {
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: var(--dsw-alias-bg-layer-2);
  border: 0;
  border-radius: 8px;
  padding: 0 13px;
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-control-button:not(:disabled):hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dsh-fleet-panel-control-button[data-danger="true"] {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-panel-control-button[data-primary="true"] {
  color: var(--dsw-alias-label-on-primary, #fff);
  background: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-control-button[data-primary="true"]:not(:disabled):hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 88%, black);
}

.dsh-fleet-panel-control-button:disabled {
  cursor: default;
  opacity: .5;
}

.dsh-fleet-panel-control-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-control-error {
  width: 100%;
  color: var(--dsw-alias-state-error-primary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-fact {
  min-height: 42px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  gap: 18px;
  padding-block: 7px;
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
}

.dsh-fleet-panel-fact-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

.dsh-fleet-panel-fact-value {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.dsh-fleet-panel-fact-value .dsh-fleet-panel-member-state {
  font-size: inherit;
  line-height: inherit;
}

.dsh-fleet-panel-member-self-status-detail {
  gap: 3px;
  display: grid;
}

.dsh-fleet-panel-member-self-status-detail .dsh-fleet-panel-member-status-updated {
  justify-self: start;
}

.dsh-fleet-panel-resource-body {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 22px;
}

.dsh-fleet-panel-resource-preview {
  width: 100%;
  margin: 0 auto;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 1.65;
}

.dsh-fleet-panel-resource-content {
  min-width: 0;
  width: min(100%, var(--dsh-fleet-panel-chat-column-width, 760px));
  max-width: 100%;
  min-height: 100%;
  margin: 0 auto;
}

.dsh-fleet-panel-resource-content[data-mode="compare"] {
  width: 100%;
}

.dsh-fleet-panel-resource-scroll {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  padding: 0;
}

.dsh-fleet-panel-resource-scroll .dsh-fleet-panel-chat-log {
  box-sizing: border-box;
  padding: 24px;
}

.dsh-fleet-panel-detail-head:has(.dsh-fleet-panel-resource-meta) {
  grid-template-columns: minmax(0, max-content) max-content minmax(12px, 1fr) max-content;
  display: grid;
}

.dsh-fleet-panel-detail-head:has(.dsh-fleet-panel-resource-meta) > .dsh-fleet-panel-detail-meta {
  min-width: 0;
  flex: none;
}

.dsh-fleet-panel-detail-head:has(.dsh-fleet-panel-resource-meta) > .dsh-fleet-panel-main-actions {
  grid-column: 4;
  justify-self: end;
}

.dsh-fleet-panel-resource-meta {
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  align-items: center;
  gap: 6px;
  flex: none;
  font-size: 11px;
  display: flex;
}

.dsh-fleet-panel-resource-meta > span:not(:last-child)::after {
  content: "·";
  margin-inline-start: 6px;
  color: var(--dsw-alias-label-caption);
}

.dsh-fleet-panel-resource-size {
  width: 8ch;
  flex: none;
  text-align: end;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.dsh-fleet-panel-resource-path-wrap {
  flex: none;
  display: flex;
  position: relative;
}

.dsh-fleet-panel-resource-path {
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 5px;
  padding: 2px 3px;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
  text-underline-offset: 3px;
  white-space: nowrap;
  font: inherit;
}

.dsh-fleet-panel-resource-path-wrap .dsh-fleet-panel-resource-open-error {
  width: max-content;
  max-width: min(320px, calc(100vw - 32px));
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 6px;
  padding: 4px 7px;
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 8;
  box-shadow: 0 4px 12px color-mix(in srgb, #24394d 16%, transparent);
}

.dsh-fleet-panel-resource-path:hover {
  color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 82%, black);
  text-decoration-color: currentColor;
}

.dsh-fleet-panel-resource-path:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-resource-view-switch {
  min-width: 168px;
  background: var(--dsw-alias-interactive-bg-hover);
  border-radius: 8px;
  grid-auto-columns: minmax(0, 1fr);
  grid-auto-flow: column;
  padding: 2px;
  display: grid;
}

.dsh-fleet-panel-resource-actions,
.dsh-fleet-panel-resource-file-actions {
  align-items: center;
  gap: 5px;
  display: flex;
}

.dsh-fleet-panel-resource-actions {
  flex: none;
}

.dsh-fleet-panel-resource-file-actions {
  width: 94px;
  flex: none;
}

.dsh-fleet-panel-resource-file-actions > button {
  width: 28px;
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  place-items: center;
  padding: 0;
  display: grid;
}

.dsh-fleet-panel-resource-file-actions > button:not(:disabled):hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-resource-file-actions > button[aria-pressed="true"] {
  color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-resource-file-actions > button[data-visible="false"] {
  visibility: hidden;
}

.dsh-fleet-panel-resource-file-actions > button:disabled {
  cursor: default;
  opacity: .42;
}

.dsh-fleet-panel-resource-file-actions > button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-resource-action-status {
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  white-space: nowrap;
  clip-path: inset(50%);
  overflow: hidden;
  position: absolute;
}

.dsh-fleet-panel-resource-view-switch > button,
.dsh-fleet-panel-resource-view-switch > .dsh-fleet-panel-resource-view-unavailable .dsh-fleet-panel-resource-view-unavailable-trigger {
  width: 100%;
  min-height: 26px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0 9px;
  white-space: nowrap;
  font-size: 11px;
}

.dsh-fleet-panel-resource-view-switch > button {
  cursor: pointer;
}

.dsh-fleet-panel-resource-view-switch > button:hover {
  color: var(--dsw-alias-label-primary);
}

.dsh-fleet-panel-resource-view-switch > button:disabled {
  color: var(--dsw-alias-label-caption);
  cursor: default;
  opacity: .55;
}

.dsh-fleet-panel-resource-view-switch > button:disabled:hover {
  color: var(--dsw-alias-label-caption);
}

.dsh-fleet-panel-resource-view-unavailable {
  min-width: 0;
  display: block;
}

.dsh-fleet-panel-resource-view-unavailable .dsh-hover-hint {
  width: 100%;
  min-width: 0;
  height: 100%;
}

.dsh-fleet-panel-resource-view-unavailable .dsh-fleet-panel-resource-view-unavailable-trigger {
  min-width: 0;
  height: 100%;
}

.dsh-fleet-panel-resource-view-switch > .dsh-fleet-panel-resource-view-unavailable .dsh-fleet-panel-resource-view-unavailable-trigger,
.dsh-fleet-panel-resource-view-switch > .dsh-fleet-panel-resource-view-unavailable .dsh-fleet-panel-resource-view-unavailable-trigger:hover,
.dsh-fleet-panel-resource-view-switch > .dsh-fleet-panel-resource-view-unavailable .dsh-fleet-panel-resource-view-unavailable-trigger:focus-visible {
  color: var(--dsw-alias-label-caption);
  cursor: default;
  opacity: .55;
  text-decoration: none;
}

.dsh-fleet-panel-resource-view-switch > button[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 1px 3px color-mix(in srgb, #24394d 13%, transparent);
}

.dsh-fleet-panel-resource-view-switch > button:focus-visible,
.dsh-fleet-panel-resource-view-switch > .dsh-fleet-panel-resource-view-unavailable .dsh-fleet-panel-resource-view-unavailable-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-resource-renderer-link {
  color: var(--dsw-alias-state-business-primary);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 42%, transparent);
  text-underline-offset: 2px;
}

.dsh-fleet-panel-resource-renderer-link:hover {
  text-decoration-color: currentColor;
}

.dsh-fleet-panel-resource-renderer-link:focus-visible {
  border-radius: 2px;
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-resource-preview[data-mode="compare"] {
  width: 100%;
  max-width: none;
}

.dsh-fleet-panel-resource-preview[data-mode="source"] {
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
}

.dsh-fleet-panel-resource-source-frame {
  min-width: 0;
  max-width: 100%;
  position: relative;
}

.dsh-fleet-panel-resource-source-viewport {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}

.dsh-fleet-panel-resource-source-frame[data-wrap="true"] .dsh-fleet-panel-resource-source-viewport {
  overflow-x: visible;
}

.dsh-fleet-panel-resource-compare {
  --dsh-fleet-panel-resource-compare-split: 50%;
  --dsh-fleet-panel-resource-compare-left: 50fr;
  --dsh-fleet-panel-resource-compare-right: 50fr;

  min-width: 0;
  min-height: 100%;
  grid-template-columns:
    minmax(0, var(--dsh-fleet-panel-resource-compare-left))
    minmax(0, var(--dsh-fleet-panel-resource-compare-right));
  display: grid;
  position: relative;
}

.dsh-fleet-panel-resource-compare::before {
  width: 1px;
  height: 100%;
  content: '';
  background: var(--dsw-alias-border-l2);
  position: absolute;
  top: 0;
  left: var(--dsh-fleet-panel-resource-compare-split);
  z-index: 3;
  transform: translateX(-50%);
}

.dsh-fleet-panel-resource-compare > section {
  min-width: 0;
  background: var(--dsw-alias-bg-layer-2);
  overflow: hidden;
}

.dsh-fleet-panel-resource-compare > section:first-child {
  border-radius: 12px 0 0 12px;
}

.dsh-fleet-panel-resource-compare > section:last-child {
  border-radius: 0 12px 12px 0;
}

.dsh-fleet-panel-resource-compare[data-resizing="true"] {
  cursor: col-resize;
  user-select: none;
}

.dsh-fleet-panel-resource-compare h3 {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
}

.dsh-fleet-panel-resource-compare-body {
  min-width: 0;
  padding: 14px;
  overflow: auto;
}

.dsh-fleet-panel-resource-compare-body .dsh-fleet-panel-resource-preview-plain[data-wrap="false"] {
  min-width: max-content;
}

.dsh-fleet-panel-resource-history {
  min-width: 0;
  min-height: 360px;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 16px;
  display: grid;
}

.dsh-fleet-panel-resource-diff {
  min-width: 0;
  grid-area: diff;
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 12px;
  overflow: auto;
}

.dsh-fleet-panel-resource-history {
  grid-template-areas: "diff timeline";
}

.dsh-fleet-panel-resource-diff .dsh-diff-render {
  min-height: 100%;
}

.dsh-fleet-panel-resource-rendered-diff {
  min-width: 0;
  min-height: 100%;
}

.dsh-fleet-panel-resource-rendered-diff .dsh-diff-file {
  min-width: max-content;
}

.dsh-fleet-panel-resource-diff-fallback {
  min-width: 0;
  min-height: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  display: grid;
}

.dsh-fleet-panel-resource-diff-fallback > section {
  min-width: 0;
  overflow: auto;
}

.dsh-fleet-panel-resource-diff-fallback > section + section {
  border-inline-start: 1px solid var(--dsw-alias-border-l3);
}

.dsh-fleet-panel-resource-diff-fallback h3 {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  padding: 9px 12px;
  font-size: 11px;
  font-weight: 560;
}

.dsh-fleet-panel-resource-diff-fallback pre {
  margin: 0;
  padding: 12px;
  white-space: pre;
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 12px;
  line-height: 19px;
}

.dsh-fleet-panel-resource-timeline {
  min-width: 0;
  grid-area: timeline;
  align-self: start;
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 10px;
  padding: 8px;
}

.dsh-fleet-panel-resource-timeline-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.dsh-fleet-panel-resource-timeline-head {
  color: var(--dsw-alias-label-secondary);
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  margin: 0 4px 4px;
  padding: 4px 2px 10px;
  font-size: 10px;
  display: flex;
}

.dsh-fleet-panel-resource-timeline-list {
  flex-direction: column;
  display: flex;
}

.dsh-fleet-panel-resource-revision {
  position: relative;
  min-width: 0;
  min-height: 52px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  grid-template-columns: 42px 12px minmax(0, 1fr);
  align-items: stretch;
  gap: 6px;
  padding: 6px 7px 6px 4px;
  text-align: start;
  display: grid;
}

.dsh-fleet-panel-resource-revision:hover,
.dsh-fleet-panel-resource-revision[aria-pressed="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-resource-revision:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-resource-revision-when {
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  align-self: center;
  text-align: end;
  white-space: nowrap;
  font-size: 10px;
  line-height: 15px;
  font-variant-numeric: tabular-nums;
}

.dsh-fleet-panel-resource-revision-when span {
  display: block;
}

.dsh-fleet-panel-resource-revision-marker {
  position: relative;
  align-self: stretch;
}

.dsh-fleet-panel-resource-revision-marker::before {
  width: 1px;
  content: "";
  background: var(--dsw-alias-border-l2);
  position: absolute;
  top: -6px;
  bottom: -6px;
  left: 5px;
}

.dsh-fleet-panel-resource-revision:first-child .dsh-fleet-panel-resource-revision-marker::before {
  top: 50%;
}

.dsh-fleet-panel-resource-revision:last-child .dsh-fleet-panel-resource-revision-marker::before {
  bottom: 50%;
}

.dsh-fleet-panel-resource-revision-marker::after {
  width: 7px;
  height: 7px;
  content: "";
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-label-caption);
  border-radius: 50%;
  position: absolute;
  top: 50%;
  left: 2px;
  transform: translateY(-50%);
}

.dsh-fleet-panel-resource-revision[aria-pressed="true"] .dsh-fleet-panel-resource-revision-marker::after {
  background: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-resource-revision[aria-pressed="true"] .dsh-fleet-panel-resource-revision-when {
  color: var(--dsw-alias-label-primary);
}

.dsh-fleet-panel-resource-revision-copy {
  min-width: 0;
  align-self: center;
  flex-direction: column;
  gap: 1px;
  display: flex;
}

.dsh-fleet-panel-resource-revision-summary {
  min-width: 0;
  align-items: baseline;
  gap: 4px;
  display: flex;
}

.dsh-fleet-panel-resource-revision-summary strong {
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
}

.dsh-fleet-panel-resource-revision-summary span,
.dsh-fleet-panel-resource-revision-detail {
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  font-size: 10px;
  line-height: 15px;
}

.dsh-fleet-panel-resource-history-empty {
  min-height: 240px;
  color: var(--dsw-alias-label-secondary);
  place-items: center;
  padding: 24px;
  text-align: center;
  font-size: 12px;
  display: grid;
}

.dsh-fleet-panel-resource-preview-plain {
  margin: 0;
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
}

.dsh-fleet-panel-resource-preview-plain[data-wrap="false"] {
  min-width: max-content;
}

.dsh-fleet-panel-resource-source-line {
  min-height: 1.6em;
  grid-template-columns: 4ch minmax(0, 1fr);
  display: grid;
}

.dsh-fleet-panel-resource-source-line::before {
  content: attr(data-line);
  color: var(--dsw-alias-label-caption);
  border-inline-end: 1px solid var(--dsw-alias-border-l3);
  padding-inline-end: 10px;
  text-align: end;
  user-select: none;
}

.dsh-fleet-panel-resource-source-line > span {
  min-width: 0;
  padding-inline-start: 12px;
  white-space: pre;
}

.dsh-fleet-panel-resource-preview-plain[data-wrap="true"] .dsh-fleet-panel-resource-source-line > span {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dsh-fleet-panel-resource-preview-status {
  min-height: 120px;
  color: var(--dsw-alias-label-secondary);
  place-items: center;
  align-content: center;
  gap: 5px;
  text-align: center;
  font: var(--dsw-font-xs-13);
  display: grid;
}

.dsh-fleet-panel-resource-preview-error {
  color: var(--dsw-alias-state-error-primary);
  align-items: center;
  gap: 12px;
  margin-top: 20px;
  font: var(--dsw-font-xs-13);
  display: flex;
  flex-wrap: wrap;
}

.dsh-fleet-panel-resource-preview-retry {
  min-height: 32px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: var(--dsw-alias-interactive-bg-hover);
  border: 0;
  border-radius: 8px;
  padding: 0 12px;
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-resource-preview-retry:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dsh-fleet-panel-resource-preview-retry:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-panel-resource-markdown {
  white-space: normal;
}

.dsh-fleet-panel-resource-markdown > :first-child {
  margin-top: 0;
}

.dsh-fleet-panel-resource-markdown > :last-child {
  margin-bottom: 0;
}

.dsh-fleet-panel-activity-row {
  grid-template-columns: 12px minmax(0, 1fr) auto;
  gap: 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  padding: 12px 2px;
  display: grid;
}

.dsh-fleet-panel-activity-layout {
  min-height: 0;
  flex: 1;
  position: relative;
  overflow: hidden;
}

.dsh-fleet-panel-activity-scroll {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  scrollbar-width: none;
  overscroll-behavior: contain;
  padding: 24px 130px 24px 24px;
  overflow-y: auto;
}

.dsh-fleet-panel-activity-scroll::-webkit-scrollbar {
  display: none;
}

.dsh-fleet-panel-activity-list {
  width: min(100%, 760px);
  margin: 0 auto;
  padding-block: var(--dsh-fleet-activity-center-padding, 24px);
}

.dsh-fleet-panel-activity-timeline {
  width: 84px;
  height: 80%;
  min-height: min(220px, 80%);
  flex-direction: column;
  display: flex;
  position: absolute;
  top: 10%;
  left: min(calc(100% - 104px), calc(50% + 350px));
  z-index: 2;
  overflow: visible;
}

.dsh-fleet-panel-activity-timeline-wheel {
  box-sizing: border-box;
  width: 38px;
  height: 18px;
  cursor: ns-resize;
  touch-action: none;
  user-select: none;
  background-color: var(--dsw-alias-bg-layer-2);
  background-image: repeating-linear-gradient(
    90deg,
    transparent 0 3px,
    var(--dsw-alias-label-secondary) 3px 4px,
    transparent 4px 7px
  );
  border: 1px solid var(--dsw-alias-label-secondary);
  border-radius: 4px;
  margin: 0;
  display: block;
  position: absolute;
  top: -24px;
  left: calc(50% + 3px);
  z-index: 2;
  overflow: hidden;
  transition: background-position 140ms cubic-bezier(.16, 1, .3, 1);
}

.dsh-fleet-panel-activity-timeline-wheel:hover {
  border-color: var(--dsw-alias-label-primary);
}

.dsh-fleet-panel-activity-timeline-wheel:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-activity-timeline-ruler {
  min-height: 0;
  cursor: ns-resize;
  overscroll-behavior: contain;
  contain: layout paint;
  flex: 1;
  position: relative;
  overflow: hidden;
}

.dsh-fleet-panel-activity-timeline-marker {
  --dsh-fleet-timeline-position: 0px;
  --dsh-fleet-timeline-strength: 0;
  --dsh-fleet-timeline-opacity: 1;
  width: 100%;
  min-height: 18px;
  color: var(--dsw-alias-label-caption);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 4px;
  grid-template-columns: 46px minmax(0, 1fr);
  align-items: center;
  gap: 2px;
  padding: 0 4px 0 0;
  font-size: 12px;
  line-height: 16px;
  text-align: end;
  display: grid;
  position: absolute;
  top: 50%;
  left: 0;
  transform: translateY(calc(-50% + var(--dsh-fleet-timeline-position)));
}

.dsh-fleet-panel-activity-timeline-marker:hover .dsh-fleet-panel-activity-timeline-tick {
  background: var(--dsw-alias-label-secondary);
  opacity: 1;
}

.dsh-fleet-panel-activity-timeline-marker:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -1px;
}

.dsh-fleet-panel-activity-timeline-label {
  min-width: 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  opacity: var(--dsh-fleet-timeline-strength);
  overflow: hidden;
  transition: opacity 140ms cubic-bezier(.16, 1, .3, 1);
}

.dsh-fleet-panel-activity-timeline-tick {
  width: 30px;
  height: 2px;
  background: var(--dsw-alias-border-l2);
  justify-self: center;
  opacity: var(--dsh-fleet-timeline-opacity);
  transform: scaleX(calc(.53 + var(--dsh-fleet-timeline-strength) * .34));
  transform-origin: center;
  transition: transform 140ms cubic-bezier(.16, 1, .3, 1), opacity 140ms cubic-bezier(.16, 1, .3, 1), background-color 120ms ease-out;
}

.dsh-fleet-panel-activity-timeline-marker[data-has-event="true"] .dsh-fleet-panel-activity-timeline-tick {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 62%, var(--dsw-alias-border-l2));
}

.dsh-fleet-panel-activity-timeline-cursor {
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  z-index: 1;
}

.dsh-fleet-panel-activity-timeline-cursor .dsh-fleet-panel-activity-timeline-label {
  opacity: 1;
}

.dsh-fleet-panel-activity-timeline-cursor .dsh-fleet-panel-activity-timeline-tick {
  background: var(--dsw-alias-label-primary);
  opacity: 1;
  transform: scaleX(1);
}

@media (prefers-reduced-motion: reduce) {
  .dsh-fleet-panel-activity-timeline-wheel {
    transition-duration: 0ms;
  }

  .dsh-fleet-panel-activity-timeline-label,
  .dsh-fleet-panel-activity-timeline-tick {
    transition-duration: 0ms;
  }
}

@media (max-width: 640px) {
  .dsh-fleet-panel-activity-scroll {
    padding: 18px 100px 18px 14px;
  }

  .dsh-fleet-panel-activity-timeline {
    width: 72px;
    left: calc(100% - 80px);
  }
}

.dsh-fleet-panel-activity-group {
  border-bottom: 1px solid var(--dsw-alias-border-l3);
}

.dsh-fleet-panel-activity-group-toggle {
  width: 100%;
  min-height: 42px;
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  grid-template-columns: 12px minmax(0, 1fr) auto 14px;
  align-items: center;
  gap: 10px;
  padding: 9px 2px;
  text-align: start;
  display: grid;
}

.dsh-fleet-panel-activity-group-toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-activity-group-toggle:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-activity-group-copy {
  min-width: 0;
  align-items: baseline;
  gap: 7px;
  display: flex;
}

.dsh-fleet-panel-activity-group-label {
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 400;
  line-height: 19px;
  overflow: hidden;
}

.dsh-fleet-panel-activity-group-count {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 19px;
}

.dsh-fleet-panel-activity-group-chevron {
  color: var(--dsw-alias-label-secondary);
  place-items: center;
  display: grid;
  transform: rotate(-90deg);
  transition: transform 120ms ease-out;
}

.dsh-fleet-panel-activity-group-toggle[aria-expanded="true"] .dsh-fleet-panel-activity-group-chevron {
  transform: rotate(0deg);
}

.dsh-fleet-panel-activity-group-items {
  padding-inline-start: 22px;
}

.dsh-fleet-panel-activity-group-items .dsh-fleet-panel-activity-row {
  border-top: 1px solid var(--dsw-alias-border-l3);
  border-bottom: 0;
  padding-block: 10px;
}

.dsh-fleet-panel-activity-dot {
  width: 7px;
  height: 7px;
  background: var(--dsw-alias-label-caption);
  border-radius: 50%;
  margin-top: 6px;
}

.dsh-fleet-panel-activity-dot[data-kind="message"] {
  background: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-activity-dot[data-kind="resource"] {
  background: var(--dsw-alias-state-success-primary, #4f9a6e);
}

.dsh-fleet-panel-activity-dot[data-kind="decision"] {
  background: var(--dsw-alias-state-warning-primary, #c38b36);
}

.dsh-fleet-panel-activity-dot[data-kind="memory"] {
  background: #8b6bbd;
}

.dsh-fleet-panel-activity-copy {
  min-width: 0;
  font-size: 13px;
  line-height: 19px;
  overflow-wrap: anywhere;
}

.dsh-fleet-panel-activity-row[data-kind="memory"] .dsh-fleet-panel-activity-copy {
  align-items: baseline;
  gap: 8px;
  display: flex;
}

.dsh-fleet-panel-activity-memory-operation {
  flex: none;
  color: color-mix(in srgb, #8060ae 72%, var(--dsw-alias-label-primary));
  background: color-mix(in srgb, #8b6bbd 13%, transparent);
  border-radius: 5px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 600;
  line-height: 18px;
}

.dsh-fleet-panel-activity-time {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 18px;
}

@container (max-width: 820px) {
  .dsh-fleet-panel {
    grid-template-columns: 50px var(--dsh-fleet-panel-sidebar-width, 212px) 8px minmax(0, 1fr);
  }

  .dsh-fleet-panel-rail {
    padding-inline: 7px;
  }

  .dsh-fleet-panel-chat-column,
  .dsh-fleet-panel-detail-scroll {
    padding-inline: 16px;
  }

  .dsh-fleet-panel-resource-scroll {
    padding: 0;
  }

  .dsh-fleet-panel-resource-history {
    grid-template-columns: minmax(0, 1fr) 232px;
    gap: 16px;
  }

  .dsh-fleet-panel-member-access-modes,
  .dsh-fleet-panel-member-access-form {
    grid-template-columns: minmax(0, 1fr);
  }

  .dsh-fleet-panel-member-access-field[data-wide="true"],
  .dsh-fleet-panel-member-access-form-actions {
    grid-column: 1;
  }
}

@container (max-width: 640px) {
  .dsh-fleet-panel {
    min-height: 520px;
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .dsh-fleet-panel-rail {
    padding-inline: 2px;
  }

  .dsh-fleet-panel > .dsh-fleet-panel-sidebar-seat,
  .dsh-fleet-panel > .dsh-fleet-panel-main {
    grid-column: 2;
    grid-row: 1;
  }

  .dsh-fleet-panel > .dsh-fleet-panel-sidebar-seat {
    display: none;
  }

  .dsh-fleet-panel[data-navigation-open="true"] > .dsh-fleet-panel-sidebar-seat {
    display: flex;
  }

  .dsh-fleet-panel[data-navigation-open="true"] .dsh-fleet-panel-connection-sidebar {
    width: 100%;
    flex: none;
    display: block;
  }

  .dsh-fleet-panel-connection-sidebar > .dsh-fleet-panel-connection {
    border: 0;
    border-radius: 12px;
    box-shadow: 0 1px 4px color-mix(in srgb, #24394d 12%, transparent);
    margin-bottom: 8px;
  }

  .dsh-fleet-panel[data-navigation-open="true"] > .dsh-fleet-panel-main {
    display: none;
  }

  .dsh-fleet-panel-resize-handle {
    display: none;
  }

  .dsh-fleet-panel-navigation-toggle {
    width: 44px;
    height: 44px;
    background-clip: content-box;
    padding: 8px;
    display: grid;
  }

  .dsh-fleet-panel-tool {
    width: 44px;
    height: 44px;
    background-clip: content-box;
    padding: 4px;
  }

  .dsh-fleet-panel-rail-brand {
    width: 44px;
    height: 44px;
    background-clip: content-box;
    padding: 5px;
  }

  .dsh-fleet-panel-enter-messages {
    min-height: 44px;
  }

  .dsh-fleet-panel-sidebar-team-block {
    padding-block: 4px;
  }

  .dsh-fleet-panel-team-switch,
  .dsh-fleet-panel-team-option,
  .dsh-fleet-panel-agent-switch {
    min-height: 44px;
  }

  .dsh-fleet-panel-directory-summary,
  .dsh-fleet-panel-list-row,
  .dsh-fleet-panel-search-wrap {
    min-height: 44px;
  }

  .dsh-fleet-panel-search {
    height: 44px;
    font-size: 16px;
  }

  .dsh-fleet-panel-team-settings {
    width: 44px;
    height: 44px;
  }

  .dsh-fleet-panel-connection-retry,
  .dsh-fleet-panel-trace-retry {
    min-height: 44px;
  }

  .dsh-fleet-panel-chat-column {
    padding: 18px 12px 22px;
  }

  .dsh-fleet-panel-chat-width-handle {
    display: none;
  }

  .dsh-fleet-panel-agent-chat-column {
    padding: 18px 12px 22px;
  }

  .dsh-fleet-panel-composer-wrap {
    padding: 0 10px 10px;
  }

  .dsh-fleet-panel-detail-scroll {
    padding: 18px 14px;
  }

  .dsh-fleet-panel-resource-scroll {
    padding: 0;
  }

  .dsh-fleet-panel-detail-head:has(.dsh-fleet-panel-resource-meta) {
    min-height: 108px;
    grid-template-areas:
      "title meta ."
      "actions actions actions";
    grid-template-columns: minmax(0, max-content) max-content minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-content: center;
    padding-block: 8px;
  }

  .dsh-fleet-panel-detail-head:has(.dsh-fleet-panel-resource-meta) .dsh-fleet-panel-detail-title {
    grid-area: title;
  }

  .dsh-fleet-panel-detail-head:has(.dsh-fleet-panel-resource-meta) .dsh-fleet-panel-detail-meta {
    grid-area: meta;
  }

  .dsh-fleet-panel-detail-head:has(.dsh-fleet-panel-resource-meta) .dsh-fleet-panel-main-actions {
    width: 100%;
    grid-area: actions;
    justify-content: space-between;
  }

  .dsh-fleet-panel-resource-view-switch {
    margin-inline-start: 0;
  }

  .dsh-fleet-panel-resource-file-actions > button {
    width: 44px;
    height: 44px;
    background-clip: content-box;
    padding: 8px;
  }

  .dsh-fleet-panel-resource-file-actions {
    width: 142px;
  }

  .dsh-fleet-panel-resource-compare {
    grid-template-columns: minmax(0, 1fr);
  }

  .dsh-fleet-panel-resource-compare > section:first-child,
  .dsh-fleet-panel-resource-compare > section:last-child {
    border-radius: 12px;
  }

  .dsh-fleet-panel-resource-compare > section + section {
    border-top: 1px solid var(--dsw-alias-border-l3);
    margin-top: 12px;
  }

  .dsh-fleet-panel-resource-compare::before,
  .dsh-fleet-panel-resource-compare-resize-track {
    display: none;
  }

  .dsh-fleet-panel-resource-scroll .dsh-fleet-panel-chat-log {
    padding: 18px 14px;
  }

  .dsh-fleet-panel-resource-history {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "timeline" "diff";
  }

  .dsh-fleet-panel-resource-timeline {
    padding: 8px;
  }

  .dsh-fleet-panel-resource-timeline-list {
    max-height: 168px;
    overflow-y: auto;
  }

  .dsh-fleet-panel-resource-diff {
    min-height: 320px;
  }

  .dsh-fleet-panel-resource-diff-fallback {
    grid-template-columns: minmax(0, 1fr);
  }

  .dsh-fleet-panel-member-permissions-head {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .dsh-fleet-panel-auth-head,
  .dsh-fleet-panel-auth-access > label {
    align-items: stretch;
    flex-direction: column;
  }

  .dsh-fleet-panel-auth-mode {
    align-self: flex-start;
  }

  .dsh-fleet-panel-auth-access select {
    width: 100%;
  }

  .dsh-fleet-panel-member-permissions-groups,
  .dsh-fleet-panel-member-permissions-manual,
  .dsh-fleet-panel-member-permissions-values,
  .dsh-fleet-panel-member-request-grid,
  .dsh-fleet-panel-member-access-modes,
  .dsh-fleet-panel-member-access-form {
    grid-template-columns: minmax(0, 1fr);
  }

  .dsh-fleet-panel-member-request-field[data-wide="true"] {
    grid-column: 1;
  }

  .dsh-fleet-panel-member-access-field[data-wide="true"],
  .dsh-fleet-panel-member-access-form-actions {
    grid-column: 1;
  }

  .dsh-fleet-panel-member-access-rule {
    align-items: flex-start;
  }

  .dsh-fleet-panel-member-permission-group {
    min-height: 44px;
  }

  .dsh-fleet-panel-member-permissions-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .dsh-fleet-panel-member-permissions-action-buttons {
    width: 100%;
  }

  .dsh-fleet-panel-member-permissions-action-buttons .dsh-fleet-panel-control-button {
    min-height: 44px;
  }

  .dsh-fleet-panel-resource-diff-fallback > section + section {
    border-inline-start: 0;
    border-top: 1px solid var(--dsw-alias-border-l3);
  }

  .dsh-fleet-panel-fact {
    gap: 5px;
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-fleet-panel-connection-dot {
    animation: none !important;
  }

  .dsh-fleet-panel-tool,
  .dsh-fleet-panel-list-row {
    scroll-behavior: auto;
  }
}
`

function installPanelStyles(): void {
  if (typeof document === 'undefined') return
  let style = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${PANEL_STYLE_ID}"]`)
  if (style === null) {
    style = document.createElement('style')
    style.dataset.pluginCss = PANEL_STYLE_ID
    document.head.append(style)
  }
  style.textContent = panelStyles
}

installPanelStyles()

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
  readonly runtimeState?: 'active' | 'dormant'
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
  readonly runtimeState?: 'active' | 'dormant'
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

function fleetPanelMemberIsUnloaded(status: FleetPanelMember['runtimeStatus']): boolean {
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

function FleetRunControlButton({ label, displayLabel, hint, primary, disabled, busy, onClick }: {
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

type PanelIconName = 'chat' | 'team' | 'agent' | 'resources' | 'activity' | 'search' | 'send' | 'channel' | 'menu' | 'settings' | 'chevron' | 'check' | 'close' | 'copy' | 'download' | 'upload' | 'wrap'

function PanelIcon({ name, size = 18 }: { readonly name: PanelIconName; readonly size?: number }): ReactElement {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.55,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': 'true',
  }
  if (name === 'close') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'm5.5 5.5 9 9m0-9-9 9' }),
  })
  if (name === 'copy') return jsxs('svg', {
    ...common,
    children: [
      jsx('rect', { x: 6.5, y: 6.5, width: 9, height: 9, rx: 1.5 }),
      jsx('path', { d: 'M4.5 12.5h-.2c-1 0-1.8-.8-1.8-1.8V4.3c0-1 .8-1.8 1.8-1.8h6.4c1 0 1.8.8 1.8 1.8v.2' }),
    ],
  })
  if (name === 'download') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M10 3.2v9.2m-3.4-3.1 3.4 3.4 3.4-3.4' }),
      jsx('path', { d: 'M4 15.2v1.3h12v-1.3' }),
    ],
  })
  if (name === 'upload') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M10 12.7V3.5M6.6 6.6 10 3.2l3.4 3.4' }),
      jsx('path', { d: 'M4 14.8v1.3h12v-1.3' }),
    ],
  })
  if (name === 'wrap') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M3 5.2h10.1a3.1 3.1 0 0 1 0 6.2H9' }),
      jsx('path', { d: 'm11.3 9.1-2.4 2.3 2.4 2.4M3 9h4M3 13.5h4' }),
    ],
  })
  if (name === 'chat') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'M4 4.5h12v8.4H9l-4.1 3v-3H4V4.5Z' }),
  })
  if (name === 'team') return jsxs('svg', {
    ...common,
    children: [
      jsx('circle', { cx: 7.2, cy: 7, r: 2.5 }),
      jsx('circle', { cx: 13.7, cy: 7.8, r: 2 }),
      jsx('path', { d: 'M2.9 15.5c.5-2.7 2-4 4.4-4 2.5 0 4 1.3 4.4 4m.2-3.8c2.8-.3 4.5 1 5 3.8' }),
    ],
  })
  if (name === 'agent') return jsxs('svg', {
    ...common,
    children: [
      jsx('circle', { cx: 10, cy: 6.7, r: 2.8 }),
      jsx('path', { d: 'M4.5 16c.6-3.2 2.4-4.8 5.5-4.8s4.9 1.6 5.5 4.8' }),
    ],
  })
  if (name === 'resources') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M4.2 3.5h7l4.6 4.6v8.4H4.2V3.5Z' }),
      jsx('path', { d: 'M11.2 3.5v4.6h4.6M7 11h6M7 14h4' }),
    ],
  })
  if (name === 'activity') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'M2.8 10h3l1.7-4.2 3.2 8.4 2.1-5.5 1.2 2.7h3.2' }),
  })
  if (name === 'search') return jsxs('svg', {
    ...common,
    children: [jsx('circle', { cx: 8.7, cy: 8.7, r: 5 }), jsx('path', { d: 'm12.4 12.4 4 4' })],
  })
  if (name === 'send') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'M4 10h11m-4-4 4 4-4 4' }),
  })
  if (name === 'menu') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M4 5.5h12M4 10h12M4 14.5h12' }),
    ],
  })
  if (name === 'settings') return jsxs('svg', {
    ...common,
    children: [
      jsx('circle', { cx: 10, cy: 10, r: 2.4 }),
      jsx('path', { d: 'M8.6 3.5h2.8l.5 1.8c.4.2.8.4 1.2.7l1.8-.5 1.4 2.4-1.3 1.3v1.6l1.3 1.3-1.4 2.4-1.8-.5c-.4.3-.8.5-1.2.7l-.5 1.8H8.6l-.5-1.8c-.4-.2-.8-.4-1.2-.7l-1.8.5-1.4-2.4L5 10.8V9.2L3.7 7.9l1.4-2.4 1.8.5c.4-.3.8-.5 1.2-.7l.5-1.8Z' }),
    ],
  })
  if (name === 'chevron') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'm6.5 8 3.5 3.5L13.5 8' }),
  })
  if (name === 'check') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'm4.5 10.2 3.3 3.3 7.7-7.7' }),
  })
  return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'M7.2 3.5 5.4 16.5m7.4-13-1.8 13M3.5 7.4h13M2.8 12.6h13' }),
  })
}

function HarmonyBrandIcon(): ReactElement {
  const [available, setAvailable] = useState(false)
  return jsxs(Fragment, {
    children: [
      available
        ? jsx('span', { className: 'dsh-fleet-panel-harmony-icon', 'aria-hidden': 'true' })
        : jsx(PanelIcon, { name: 'team', size: 21 }),
      jsx('img', {
        className: 'dsh-fleet-panel-harmony-icon-probe',
        src: '/dsh-harmony/assets/harmony-icon-mono.png?fleet-brand-probe=1',
        alt: '',
        'aria-hidden': 'true',
        onLoad: () => { setAvailable(true) },
      }),
    ],
  })
}

const operator: FleetPanelMember = {
  id: 'operator',
  get name() { return getFleetOperatorProfile().name },
  get role() { return getFleetOperatorProfile().role },
  get responsibility() { return getFleetOperatorProfile().responsibility },
  get color() { return getFleetOperatorProfile().color },
  get avatarUrl() { return getFleetOperatorProfile().avatarUrl },
  presence: 'active', operator: true,
}

function teamAgents(team: FleetPanelTeamSnapshot): readonly FleetPanelMember[] {
  return fleetPanelMentionMembers(team)
}

/** Every visible Team participant that can be named in message text. */
export function fleetPanelMentionMembers(
  team: Pick<FleetPanelTeamSnapshot, 'members' | 'assistants'>,
): readonly FleetPanelMember[] {
  return [...team.members, ...(team.assistants ?? [])]
}

function fleetPanelMemberIsOnline(member: FleetPanelMember): boolean {
  return member.presence === 'active' || member.presence === 'busy'
    || member.presence === 'waiting' || member.presence === 'error'
}

function panelText(zh: string, en: string): string {
  return fleetText(zh, en)
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

let teamDirectorySource: FleetPanelSource | undefined

interface FleetTeamSettingsRequest {
  readonly id: number
  readonly teamId: string
  readonly tab: TeamSettingsTab
}

let fleetTeamSettingsRequest: FleetTeamSettingsRequest | undefined
let fleetTeamSettingsRequestSequence = 0
const fleetTeamSettingsRequestListeners = new Set<() => void>()

function subscribeFleetTeamSettingsRequest(listener: () => void): () => void {
  fleetTeamSettingsRequestListeners.add(listener)
  return () => { fleetTeamSettingsRequestListeners.delete(listener) }
}

function publishFleetTeamSettingsRequest(): void {
  for (const listener of fleetTeamSettingsRequestListeners) listener()
}

function completeFleetTeamSettingsRequest(id: number): void {
  if (fleetTeamSettingsRequest?.id !== id) return
  fleetTeamSettingsRequest = undefined
  publishFleetTeamSettingsRequest()
}

/** Opens one Team settings tab from composer-level shortcuts, including outside the Fleet view. */
export function requestFleetTeamSettings(teamId: string, tab: TeamSettingsTab = 'general'): void {
  teamDirectorySource?.selectTeam(teamId)
  fleetTeamSettingsRequest = { id: ++fleetTeamSettingsRequestSequence, teamId, tab }
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

const EMPTY_UNSUBSCRIBE = (): void => {}
const SIDEBAR_DEFAULT_WIDTH = 232
const SIDEBAR_MIN_WIDTH = 196
const SIDEBAR_MAX_WIDTH = 360
const MAIN_MIN_WIDTH = 360

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

const MAX_REMEMBERED_PANEL_POSITIONS = 64

function rememberBounded<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX_REMEMBERED_PANEL_POSITIONS) {
    const oldest = map.keys().next().value as Key | undefined
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

interface FleetChatScrollState {
  readonly top: number
  readonly atBottom: boolean
}

const panelChatScroll = new Map<string, FleetChatScrollState>()
const panelChatMessageCounts = new Map<string, number>()

function nearChatBottom(node: HTMLDivElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= 40
}

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

type FleetSnapshotSelectorHook = <Selection>(
  selector: (snapshot: any) => Selection,
  equality?: (left: Selection, right: Selection) => boolean,
) => Selection

interface FleetNativeSessionFace {
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

interface FleetNativeContext {
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

let NativeChatView: ComponentType<any> | undefined
let nativeChatRuntime: Readonly<Record<string, any>> | undefined
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
const nativeChatScroll = new Map<string, unknown>()
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

function boundFleetNativeSessionWindow(session: FleetNativeSessionFace, snapshot: any): void {
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

function useNativeChatStore<Selection>(selector: (snapshot: typeof EMPTY_NATIVE_CHAT_STORE) => Selection): Selection {
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

function nativeContextNodeCount(snapshot: any): number {
  const order = snapshot?.chat?.order
  return Array.isArray(order) ? order.length : 0
}

async function loadFleetNativeContextTarget(
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

function operatorConversations(team: FleetPanelTeamSnapshot): readonly FleetPanelConversation[] {
  return team.conversations.filter(conversation => conversation.kind !== 'direct' || conversation.id.startsWith('@'))
}

function agentConversationPeer(
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

function parseAgentViewItem(team: FleetPanelTeamSnapshot, item: string): {
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
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const sidebarResize = useRef<{
    readonly pointerId: number
    readonly startX: number
    readonly startWidth: number
    readonly maxWidth: number
  } | null>(null)
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
  const tutorial = activeTeam?.teamId === FLEET_TUTORIAL_TEAM_ID || activeTeam?.tutorial === true
  const itemKey = activeTeam === undefined ? '' : `${activeTeam.teamId}:${activeTool}`
  const activeItem = activeTeam === undefined ? '' : resolveFleetPanelItem(activeTeam, activeTool, items[itemKey])
  const composeKey = activeTeam === undefined || activeTool !== 'chat' || activeItem === ''
    ? ''
    : `${activeTeam.teamId}:${activeItem}`
  const composeState = composeStates[composeKey] ?? EMPTY_COMPOSE_STATE
  const visibleTool = activeTeam === undefined ? 'home' : activeTool

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

  const availableSidebarWidth = (handle: HTMLDivElement): number => {
    const panelWidth = handle.parentElement?.getBoundingClientRect().width ?? 0
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(
      SIDEBAR_MAX_WIDTH,
      panelWidth - 54 - MAIN_MIN_WIDTH - 16,
    ))
  }
  const resizeSidebar = (width: number, maxWidth: number): void => {
    setSidebarWidth(Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width))))
  }
  const startSidebarResize = (event: PointerEvent<HTMLDivElement>): void => {
    const maxWidth = availableSidebarWidth(event.currentTarget)
    sidebarResize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidth,
      maxWidth,
    }
    setSidebarResizing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const moveSidebarResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = sidebarResize.current
    if (resize === null || resize.pointerId !== event.pointerId) return
    resizeSidebar(resize.startWidth + event.clientX - resize.startX, resize.maxWidth)
  }
  const stopSidebarResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (sidebarResize.current?.pointerId !== event.pointerId) return
    sidebarResize.current = null
    setSidebarResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const resizeSidebarWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 32 : 16
    if (event.key === 'ArrowLeft') resizeSidebar(sidebarWidth - step, availableSidebarWidth(event.currentTarget))
    else if (event.key === 'ArrowRight') resizeSidebar(sidebarWidth + step, availableSidebarWidth(event.currentTarget))
    else if (event.key === 'Home') resizeSidebar(SIDEBAR_MIN_WIDTH, availableSidebarWidth(event.currentTarget))
    else if (event.key === 'End') resizeSidebar(SIDEBAR_MAX_WIDTH, availableSidebarWidth(event.currentTarget))
    else return
    event.preventDefault()
  }

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
      loadMemberAccess: (memberId: string, signal?: AbortSignal) => source.loadMemberAccess?.({
        sessionId,
        teamId: activeTeam.teamId,
        memberId,
      }, signal) ?? Promise.reject(new Error(panelText('Fleet 成员资源访问接口不可用', 'Fleet member resource access API is unavailable'))),
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
      jsx('div', {
        className: 'dsh-fleet-panel-resize-handle',
        'data-resizing': sidebarResizing ? 'true' : 'false',
        role: 'separator',
        'aria-label': panelText('调整侧边栏宽度', 'Resize sidebar'),
        'aria-orientation': 'vertical',
        'aria-valuemin': SIDEBAR_MIN_WIDTH,
        'aria-valuemax': SIDEBAR_MAX_WIDTH,
        'aria-valuenow': sidebarWidth,
        tabIndex: 0,
        title: panelText('拖动调整侧边栏宽度；双击恢复默认', 'Drag to resize the sidebar; double-click to restore the default'),
        onPointerDown: startSidebarResize,
        onPointerMove: moveSidebarResize,
        onPointerUp: stopSidebarResize,
        onPointerCancel: stopSidebarResize,
        onLostPointerCapture: () => {
          sidebarResize.current = null
          setSidebarResizing(false)
        },
        onDoubleClick: () => { setSidebarWidth(SIDEBAR_DEFAULT_WIDTH) },
        onKeyDown: resizeSidebarWithKeyboard,
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

export type TeamSettingsTab = 'general' | 'model' | 'budget' | 'access' | 'collaboration' | 'data' | 'danger'

function formatBudgetTokens(value: number): string {
  return new Intl.NumberFormat(panelText('zh-CN', 'en-US'), { notation: value >= 1_000_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function formatBudgetAmount(value: number, mode: FleetPanelBudgetMode): string {
  if (mode === 'tokens') return `${formatBudgetTokens(value)} Token`
  return new Intl.NumberFormat(panelText('zh-CN', 'en-US'), {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6,
  }).format(value / 1_000_000)
}

function formatBudgetCompactTokens(value: number): string {
  const scaled = value >= 1_000_000
    ? { value: value / 1_000_000, suffix: 'M' }
    : value >= 1_000
      ? { value: value / 1_000, suffix: 'K' }
      : { value, suffix: '' }
  return `${new Intl.NumberFormat(panelText('zh-CN', 'en-US'), { maximumFractionDigits: scaled.value < 10 ? 1 : 0 }).format(scaled.value)}${scaled.suffix}`
}

function formatBudgetPopoverAmount(value: number, mode: FleetPanelBudgetMode): string {
  return mode === 'tokens' ? formatBudgetCompactTokens(value) : formatBudgetAmount(value, mode)
}

function formatApproximateBudgetAmount(value: number, mode: FleetPanelBudgetMode): string {
  const amount = formatBudgetPopoverAmount(value, mode)
  return value === 0 ? amount : `~${amount}`
}

function budgetStateText(account: FleetPanelBudgetAccount): string {
  if (account.state === 'exhausted') return panelText('已用尽', 'Exhausted')
  if (account.state === 'danger') return panelText('即将用尽', 'Nearly exhausted')
  if (account.state === 'warning') return panelText('接近上限', 'Near limit')
  if (account.state === 'unlimited') return panelText('无限制', 'Unlimited')
  return panelText('正常', 'Normal')
}

function BudgetUsage({ account, mode }: {
  readonly account: FleetPanelBudgetAccount
  readonly mode: FleetPanelBudgetMode
}): ReactElement {
  const percent = account.limit === undefined || account.limit === 0
    ? 0
    : Math.min(100, Math.round(account.used / account.limit * 100))
  return jsxs('div', { className: 'dsh-fleet-panel-budget-usage', children: [
    jsxs('div', { className: 'dsh-fleet-panel-budget-usage-head', children: [
      jsx('span', { children: account.limit === undefined
        ? panelText(`已使用 ${formatBudgetAmount(account.used, mode)}`, `${formatBudgetAmount(account.used, mode)} used`)
        : panelText(`已使用 ${formatBudgetAmount(account.used, mode)} / ${formatBudgetAmount(account.limit, mode)}`, `${formatBudgetAmount(account.used, mode)} / ${formatBudgetAmount(account.limit, mode)} used`) }),
      jsx('span', { 'data-state': account.state, children: budgetStateText(account) }),
    ] }),
    account.limit !== undefined && jsx('div', {
      className: 'dsh-fleet-panel-budget-progress', role: 'progressbar',
      'aria-valuemin': 0, 'aria-valuemax': account.limit, 'aria-valuenow': Math.min(account.used, account.limit),
      children: jsx('span', { style: { width: `${percent}%` }, 'data-state': account.state }),
    }),
  ] })
}

interface BudgetRateDraft {
  readonly multiplier: string
  readonly input: string
  readonly output: string
  readonly cacheRead: string
  readonly cacheWrite: string
}

function budgetModelKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

export function FleetBudgetMeter({ teamId, budget: suppliedBudget, memberId, Tooltip }: {
  readonly teamId: string
  readonly budget?: FleetPanelTeamBudget
  readonly memberId?: string
  readonly Tooltip?: ComponentType<{
    readonly label: string
    readonly side: 'top'
    readonly delayMs: number
    readonly disabled: boolean
    readonly children: ReactElement
  }>
}): ReactElement {
  installPanelStyles()
  const popover = useFleetAnchoredPopover('below-end')
  const subscribe = useCallback((listener: () => void) => teamDirectorySource?.subscribe(listener) ?? EMPTY_UNSUBSCRIBE, [])
  const liveBudget = useSyncExternalStore(
    subscribe,
    () => teamDirectorySource?.getSnapshot().team?.teamId === teamId
      ? teamDirectorySource.getSnapshot().team?.budget
      : undefined,
    () => undefined,
  )
  const budget = suppliedBudget ?? liveBudget
  const member = memberId === undefined ? undefined : budget?.members.find(candidate => candidate.memberId === memberId)
  const account = memberId === undefined ? budget?.team : member
  const scopeName = member === undefined
    ? panelText('团队预算', 'Team budget')
    : panelText(`${member.name} 的预算`, `${member.name} budget`)

  const percent = account?.limit === undefined || account.limit === 0
    ? 0
    : Math.min(100, account.used / account.limit * 100)
  const circumference = 2 * Math.PI * 6
  const ringOffset = account?.limit === undefined ? circumference : circumference * (1 - percent / 100)
  const state = account?.state ?? 'unlimited'
  const tooltipLabel = account === undefined
    ? panelText('正在载入预算', 'Loading budget')
    : account.limit === undefined
      ? panelText('预算未设置上限', 'No budget limit set')
      : panelText(`预算已使用 ${Math.round(percent)}%`, `${Math.round(percent)}% of budget used`)
  const displayedMembers = member === undefined ? budget?.members ?? [] : [member]
  const displayedMemberUsage = displayedMembers.reduce((total, candidate) => total + candidate.used, 0)
  const progressSegments = displayedMemberUsage === 0 || account === undefined || account.limit === undefined
    ? []
    : displayedMembers.filter(candidate => candidate.used > 0).map(candidate => ({
        member: candidate,
        width: percent * candidate.used / displayedMemberUsage,
      }))
  const figures = account === undefined || budget === undefined
    ? '—'
    : `${formatApproximateBudgetAmount(account.used, budget.mode)} / ${account.limit === undefined ? '∞' : formatBudgetPopoverAmount(account.limit, budget.mode)}`
  const trigger = jsx('button', {
    type: 'button',
    className: 'dsh-fleet-budget-meter-button',
    'aria-label': tooltipLabel,
    'aria-haspopup': 'dialog',
    'aria-expanded': popover.open,
    'aria-controls': popover.popoverId,
    ...(Tooltip === undefined ? { title: tooltipLabel } : {}),
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (account !== undefined) popover.toggleAt(event.currentTarget)
    },
    children: jsxs('svg', { className: 'dsh-fleet-budget-meter-ring', viewBox: '0 0 16 16', 'aria-hidden': 'true', children: [
      jsx('circle', { className: 'dsh-fleet-budget-meter-track', cx: 8, cy: 8, r: 6 }),
      jsx('circle', {
        className: 'dsh-fleet-budget-meter-value', cx: 8, cy: 8, r: 6,
        'data-state': state,
        strokeDasharray: circumference,
        strokeDashoffset: ringOffset,
      }),
    ] }),
  })

  return jsxs('span', { className: 'dsh-fleet-budget-meter', children: [
    Tooltip === undefined ? trigger : jsx(Tooltip, {
      label: tooltipLabel,
      side: 'top',
      delayMs: 200,
      disabled: popover.open,
      children: trigger,
    }),
    popover.mounted && account !== undefined && budget !== undefined && jsxs('section', {
      ref: popover.popover,
      id: popover.popoverId,
      popover: 'auto',
      className: 'dsh-fleet-budget-popover',
      role: 'dialog',
      'aria-label': scopeName,
      onClick: (event: ReactMouseEvent<HTMLElement>) => { event.stopPropagation() },
      children: [
        jsxs('div', { className: 'dsh-fleet-budget-popover-header', children: [
          jsx('span', { className: 'dsh-fleet-budget-popover-headline', children: account.limit === undefined
            ? panelText('预算未设置上限', 'No budget limit set')
            : panelText('预算已用', '') }),
          account.limit !== undefined && jsx('span', { className: 'dsh-fleet-budget-popover-percent', children: `${Math.round(percent)}%` }),
          account.limit !== undefined && jsx('span', { className: 'dsh-fleet-budget-popover-headline', children: panelText('', 'of budget used') }),
          jsx('span', { className: 'dsh-fleet-budget-popover-figures', children: figures }),
        ] }),
        jsx('div', { className: 'dsh-fleet-budget-popover-progress', role: 'progressbar',
          'aria-valuemin': 0, 'aria-valuemax': account.limit ?? undefined, 'aria-valuenow': account.limit === undefined ? undefined : Math.min(account.used, account.limit),
          children: progressSegments.map(segment => jsx('span', {
            title: `${segment.member.name} · ${formatBudgetPopoverAmount(segment.member.used, budget.mode)}`,
            style: { width: `${segment.width}%`, '--budget-member-color': segment.member.color ?? '#737985' } as CSSProperties,
          }, segment.member.memberId)),
        }),
        jsx('dl', { className: 'dsh-fleet-budget-popover-members', children: displayedMembers.map(candidate => jsxs('div', {
          className: 'dsh-fleet-budget-popover-member',
          children: [
            jsxs('dt', { children: [
              jsx('span', { className: 'dsh-fleet-budget-popover-member-dot', style: { '--budget-member-color': candidate.color ?? '#737985' } as CSSProperties, 'aria-hidden': 'true' }),
              jsx('span', { className: 'dsh-fleet-budget-popover-member-name', children: candidate.name }),
              jsx('span', {
                className: 'dsh-fleet-budget-popover-member-role',
                children: candidate.active
                  ? candidate.role
                  : `${candidate.role}${candidate.role === '' ? '' : ' · '}${panelText('已移除', 'Removed')}`,
              }),
            ] }),
            jsx('dd', {
              className: 'dsh-fleet-budget-popover-member-usage',
              children: formatApproximateBudgetAmount(candidate.used, budget.mode),
            }),
          ],
        }, candidate.memberId)) }),
        teamId !== FLEET_TUTORIAL_TEAM_ID && jsx('button', {
          type: 'button', className: 'dsh-fleet-budget-popover-manage',
          onClick: () => { popover.close(); requestFleetTeamSettings(teamId, 'budget') },
          children: panelText('管理预算与模型计费', 'Manage budget and model pricing'),
        }),
      ],
    }),
  ] })
}

function BudgetSettings({ budget, updateBudget, onUpdated, setError, setNotice }: {
  readonly budget: FleetPanelTeamBudget
  readonly updateBudget?: (input: Omit<FleetPanelBudgetInput, 'sessionId' | 'teamId'>) => Promise<FleetPanelTeamBudget>
  readonly onUpdated: (budget: FleetPanelTeamBudget) => void
  readonly setError: (error: string | undefined) => void
  readonly setNotice: (notice: string | undefined) => void
}): ReactElement {
  const [limits, setLimits] = useState<Readonly<Record<string, string>>>({})
  const [mode, setMode] = useState<FleetPanelBudgetMode>(budget.mode)
  const [rates, setRates] = useState<Readonly<Record<string, BudgetRateDraft>>>({})
  const [busy, setBusy] = useState<string>()

  const models = [...new Map([
    ...budget.configuredModels,
    ...budget.rates,
    ...budget.team.models,
    ...budget.members.flatMap(member => member.models),
  ].map(item => [budgetModelKey(item.provider, item.model), { provider: item.provider, model: item.model }] as const)).values()]
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model))

  useEffect(() => {
    setMode(budget.mode)
    setLimits({
      team: budget.team.limit === undefined ? '' : budget.mode === 'cost' ? String(budget.team.limit / 1_000_000) : String(budget.team.limit),
      ...Object.fromEntries(budget.members.map(member => [member.memberId, member.limit === undefined ? '' : budget.mode === 'cost' ? String(member.limit / 1_000_000) : String(member.limit)])),
    })
    setRates(Object.fromEntries(models.map(model => {
      const configured = budget.rates.find(rate => rate.provider === model.provider && rate.model === model.model)
      return [budgetModelKey(model.provider, model.model), {
        multiplier: configured?.multiplier?.toString() ?? '',
        input: configured?.inputUsdPerMillion?.toString() ?? '',
        output: configured?.outputUsdPerMillion?.toString() ?? '',
        cacheRead: configured?.cacheReadUsdPerMillion?.toString() ?? '',
        cacheWrite: configured?.cacheWriteUsdPerMillion?.toString() ?? '',
      }]
    })))
  }, [budget])

  const change = async (scope: 'team' | 'member', member: string | undefined, reset: boolean): Promise<void> => {
    if (updateBudget === undefined || busy !== undefined) return
    const key = member ?? 'team'
    const normalized = (limits[key] ?? '').trim()
    const parsed = normalized === '' ? undefined : Number(normalized)
    const limit = parsed === undefined ? undefined : budget.mode === 'cost' ? Math.round(parsed * 1_000_000) : parsed
    if (!reset && normalized !== '' && (!Number.isFinite(parsed) || parsed! <= 0
      || !Number.isSafeInteger(limit))) {
      setError(budget.mode === 'cost'
        ? panelText('成本额度必须是大于 0 的美元金额；留空表示无限制。', 'The cost limit must be a USD amount above 0. Leave blank for unlimited.')
        : panelText('Token 额度必须是正整数；留空表示无限制。', 'The token limit must be a positive integer. Leave blank for unlimited.'))
      return
    }
    setBusy(`${reset ? 'reset' : 'save'}:${key}`)
    setError(undefined)
    setNotice(undefined)
    try {
      const updated = await updateBudget({
        scope,
        ...(member === undefined ? {} : { member }),
        ...(reset ? { reset: true as const } : { limit: limit ?? null }),
      })
      onUpdated(updated)
      setNotice(reset
        ? scope === 'team'
          ? panelText('团队和全部成员已开始新的预算周期。', 'The Team and all members started a new budget cycle.')
          : panelText('成员已开始新的独立预算周期；团队累计用量不变。', 'The member started a new budget cycle. Team usage is unchanged.')
        : panelText('预算上限已更新，从下一次模型调用开始生效。', 'Budget limit updated for the next model call.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法更新预算', 'Could not update budget'))
    } finally {
      setBusy(undefined)
    }
  }

  const updateRate = (key: string, field: keyof BudgetRateDraft, value: string): void => {
    setRates(current => ({
      ...current,
      [key]: { multiplier: '', input: '', output: '', cacheRead: '', cacheWrite: '', ...current[key], [field]: value },
    }))
  }

  const saveAccounting = async (): Promise<void> => {
    if (updateBudget === undefined || busy !== undefined) return
    const configured: FleetPanelBudgetModelRate[] = []
    for (const model of models) {
      const key = budgetModelKey(model.provider, model.model)
      const draft = rates[key] ?? { multiplier: '', input: '', output: '', cacheRead: '', cacheWrite: '' }
      if (mode === 'tokens') {
        const multiplier = draft.multiplier.trim() === '' ? 1 : Number(draft.multiplier)
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
          setError(panelText(`${model.provider} · ${model.model} 的倍率必须大于 0。`, `The multiplier for ${model.provider} · ${model.model} must be above 0.`))
          return
        }
        configured.push({ provider: model.provider, model: model.model, ...(multiplier === 1 ? {} : { multiplier }) })
        continue
      }
      const values = [draft.input, draft.output, draft.cacheRead, draft.cacheWrite]
      if (values.some(value => value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0)) {
        setError(panelText(`${model.provider} · ${model.model} 需要填写四项非负价格。`, `${model.provider} · ${model.model} requires all four non-negative prices.`))
        return
      }
      configured.push({
        provider: model.provider,
        model: model.model,
        inputUsdPerMillion: Number(draft.input),
        outputUsdPerMillion: Number(draft.output),
        cacheReadUsdPerMillion: Number(draft.cacheRead),
        cacheWriteUsdPerMillion: Number(draft.cacheWrite),
      })
    }
    setBusy('accounting')
    setError(undefined)
    setNotice(undefined)
    try {
      const updated = await updateBudget({ scope: 'team', accounting: { mode, rates: configured } })
      onUpdated(updated)
      setNotice(mode !== budget.mode
        ? panelText('计量模式已切换，团队和成员已开始新预算周期；请设置新单位下的额度。', 'Accounting mode changed. The Team and members started new budget cycles; set limits in the new unit.')
        : panelText('模型计费配置已更新，从下一次模型调用开始生效。', 'Model accounting updated for the next model call.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法更新计量模式', 'Could not update accounting mode'))
    } finally {
      setBusy(undefined)
    }
  }

  const limitEditor = (scope: 'team' | 'member', member?: string): ReactElement => {
    const key = member ?? 'team'
    return jsxs('div', { className: 'dsh-fleet-panel-budget-actions', children: [
      jsx('input', {
        type: 'number', min: budget.mode === 'cost' ? 0.000001 : 1, step: budget.mode === 'cost' ? 0.01 : 1,
        inputMode: 'decimal', value: limits[key] ?? '',
        disabled: updateBudget === undefined || busy !== undefined,
        'aria-label': scope === 'team' ? panelText('团队预算上限', 'Team budget limit') : panelText('成员预算上限', 'Member budget limit'),
        placeholder: panelText('无限制', 'Unlimited'),
        onChange: (event: ChangeEvent<HTMLInputElement>) => { setLimits(current => ({ ...current, [key]: event.currentTarget.value })) },
      }),
      jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-inline-action', disabled: updateBudget === undefined || busy !== undefined, onClick: () => { void change(scope, member, false) }, children: busy === `save:${key}` ? panelText('正在保存…', 'Saving…') : panelText('应用', 'Apply') }),
      jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-secondary', disabled: updateBudget === undefined || busy !== undefined, onClick: () => { void change(scope, member, true) }, children: busy === `reset:${key}` ? panelText('正在重置…', 'Resetting…') : panelText('新周期', 'New cycle') }),
    ] })
  }

  return jsxs('section', { children: [
    jsx('h3', { children: panelText('预算', 'Budget') }),
    jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('团队共享总额度和成员独立额度同时生效。预算可以按 Token 倍率折算，也可以按模型详细价格累计实际成本。', 'The shared Team limit and each member limit apply together. Account with token multipliers or detailed model costs.') }),
    jsxs('div', { className: 'dsh-fleet-panel-budget-accounting', children: [
      jsxs('div', { className: 'dsh-fleet-panel-budget-mode', role: 'radiogroup', 'aria-label': panelText('预算计量模式', 'Budget accounting mode'), children: [
        jsx('button', { type: 'button', role: 'radio', 'aria-checked': mode === 'tokens', disabled: busy !== undefined, onClick: () => { setMode('tokens') }, children: panelText('Token × 倍率', 'Tokens × multiplier') }),
        jsx('button', { type: 'button', role: 'radio', 'aria-checked': mode === 'cost', disabled: busy !== undefined, onClick: () => { setMode('cost') }, children: panelText('成本', 'Cost') }),
      ] }),
      mode !== budget.mode && jsx('p', { className: 'dsh-fleet-panel-settings-error', role: 'status', children: panelText('切换计量模式会开始新周期，并清空当前团队与成员额度。', 'Changing accounting mode starts a new cycle and clears current Team and member limits.') }),
      models.length === 0
        ? jsx('p', { className: 'dsh-fleet-panel-settings-field-note', children: panelText('团队尚未配置可计费模型。', 'The Team has no configured models yet.') })
        : jsx('div', { className: 'dsh-fleet-panel-budget-rate-list', children: models.map(model => {
            const key = budgetModelKey(model.provider, model.model)
            const draft = rates[key] ?? { multiplier: '', input: '', output: '', cacheRead: '', cacheWrite: '' }
            return jsxs('div', { className: 'dsh-fleet-panel-budget-rate', children: [
              jsxs('div', { className: 'dsh-fleet-panel-budget-rate-name', children: [jsx('strong', { children: model.model }), jsx('small', { children: model.provider })] }),
              mode === 'tokens'
                ? jsxs('label', { children: [jsx('span', { children: panelText('倍率', 'Multiplier') }), jsx('input', { type: 'number', min: 0.000001, step: 0.1, value: draft.multiplier, placeholder: '1', disabled: busy !== undefined, onChange: (event: ChangeEvent<HTMLInputElement>) => { updateRate(key, 'multiplier', event.currentTarget.value) } })] })
                : jsx('div', { className: 'dsh-fleet-panel-budget-price-grid', children: ([['input', panelText('输入', 'Input')], ['output', panelText('输出', 'Output')], ['cacheRead', panelText('缓存读取', 'Cache read')], ['cacheWrite', panelText('缓存写入', 'Cache write')]] as const).map(([field, label]) => jsxs('label', { children: [jsx('span', { children: label }), jsx('input', { type: 'number', min: 0, step: 0.01, value: draft[field], placeholder: '$ / 1M', disabled: busy !== undefined, onChange: (event: ChangeEvent<HTMLInputElement>) => { updateRate(key, field, event.currentTarget.value) } })] }, field)) }),
            ] }, key)
          }) }),
      jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-inline-action', disabled: updateBudget === undefined || busy !== undefined, onClick: () => { void saveAccounting() }, children: busy === 'accounting' ? panelText('正在保存…', 'Saving…') : mode === budget.mode ? panelText('应用计费配置', 'Apply accounting') : panelText('切换并开始新周期', 'Switch and start new cycle') }),
    ] }),
    jsxs('div', { className: 'dsh-fleet-panel-budget-team', children: [
      jsxs('div', { className: 'dsh-fleet-panel-budget-title', children: [jsx('strong', { children: panelText('团队总额度', 'Team total') }), jsx('small', { children: panelText(`本周期 ${budget.team.calls} 次调用`, `${budget.team.calls} calls this cycle`) })] }),
      jsx(BudgetUsage, { account: budget.team, mode: budget.mode }),
      limitEditor('team'),
    ] }),
    jsxs('div', { className: 'dsh-fleet-panel-budget-members', children: [
      jsx('h4', { children: panelText('成员额度', 'Member limits') }),
      jsx('p', { className: 'dsh-fleet-panel-settings-field-note', children: panelText('成员新周期只清零该成员的独立计数，不会返还团队已用额度。团队助理也作为成员计费。', 'A member cycle clears only that member counter and does not refund Team usage. Team assistants are metered as members too.') }),
      ...budget.members.filter(member => member.active).map(member => jsxs('div', { className: 'dsh-fleet-panel-budget-member', children: [
        jsxs('div', { className: 'dsh-fleet-panel-budget-title', children: [
          jsxs('span', { children: [jsx('strong', { children: member.name }), jsx('small', { children: `${member.role}${member.assistant ? panelText(' · 助理', ' · Assistant') : ''}` })] }),
          jsx('small', { children: panelText(`${member.calls} 次调用`, `${member.calls} calls`) }),
        ] }),
        jsx(BudgetUsage, { account: member, mode: budget.mode }),
        limitEditor('member', member.memberId),
      ] }, member.memberId)),
    ] }),
    (budget.team.unmeteredCalls > 0 || budget.members.some(member => member.unmeteredCalls > 0)) && jsx('p', { className: 'dsh-fleet-panel-settings-error', role: 'status', children: panelText('部分模型调用没有返回 Token usage，已记录调用次数但无法计入 Token 总量。', 'Some model calls returned no token usage. Their call counts are recorded, but their tokens cannot be included.') }),
  ] })
}

function TeamSettingsDialog({ sessionId, team, initialTab = 'general', loadSettings, updateSettings, updateBudget, configureRequest, exportTeam, exportArchive, finishTeam, onClose }: {
  readonly sessionId: string
  readonly team: FleetPanelTeamSummary
  readonly initialTab?: TeamSettingsTab
  readonly loadSettings?: FleetPanelSource['loadTeamSettings']
  readonly updateSettings?: (settings: FleetPanelTeamSettingsInput['settings']) => Promise<FleetPanelTeamSettings>
  readonly updateBudget?: (input: Omit<FleetPanelBudgetInput, 'sessionId' | 'teamId'>) => Promise<FleetPanelTeamBudget>
  readonly configureRequest?: (request: FleetPanelTeamRequestInput['request']) => Promise<void>
  readonly exportTeam?: FleetPanelSource['exportTeam']
  readonly exportArchive?: (teamId: string, includeWorkspace: boolean) => Promise<FleetPanelArchiveFile>
  readonly finishTeam?: (summary: string) => Promise<void>
  readonly onClose: () => void
}): ReactElement {
  const dialog = useRef<HTMLElement>(null)
  const [tab, setTab] = useState<TeamSettingsTab>(initialTab)
  const [settings, setSettings] = useState<FleetPanelTeamSettings>()
  const [savedSettings, setSavedSettings] = useState<FleetPanelTeamSettings>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [configurationExporting, setConfigurationExporting] = useState(false)
  const [archiveExporting, setArchiveExporting] = useState(false)
  const [includeWorkspace, setIncludeWorkspace] = useState(false)
  const [modelKey, setModelKey] = useState('')
  const [providerName, setProviderName] = useState('')
  const [modelName, setModelName] = useState('')
  const [modelDirty, setModelDirty] = useState(false)
  const [effort, setEffort] = useState('')
  const [effortDirty, setEffortDirty] = useState(false)
  const [maxTokens, setMaxTokens] = useState('')
  const [maxTokensDirty, setMaxTokensDirty] = useState(false)
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [modelDirectory, modelDirectoryState] = useFleetPanelModelDirectory(sessionId)

  const load = useCallback(async (): Promise<void> => {
    if (loadSettings === undefined) {
      setLoading(false)
      setError(panelText('当前 Fleet 实例不支持运行期团队设置。', 'This Fleet instance does not support runtime Team settings.'))
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const value = await loadSettings(team.teamId)
      setSettings(value)
      setSavedSettings(value)
      setModelKey(value.request.mixed.model || value.request.provider === undefined || value.request.model === undefined
        ? ''
        : JSON.stringify([value.request.provider, value.request.model]))
      setProviderName(value.request.mixed.model ? '' : value.request.provider ?? '')
      setModelName(value.request.mixed.model ? '' : value.request.model ?? '')
      setEffort(value.request.mixed.reasoningEffort ? '' : value.request.reasoningEffort ?? '')
      setMaxTokens(value.request.mixed.maxTokens ? '' : value.request.maxTokens?.toString() ?? '')
      setModelDirty(false)
      setEffortDirty(false)
      setMaxTokensDirty(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法读取团队设置', 'Could not load Team settings'))
    } finally {
      setLoading(false)
    }
  }, [loadSettings, team.teamId])

  useEffect(() => { void load() }, [load])

  const downloadConfiguration = async (): Promise<void> => {
    if (exportTeam === undefined || configurationExporting) return
    setConfigurationExporting(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const configuration = await exportTeam(team.teamId)
      downloadFleetTeamConfiguration(settings?.name ?? team.teamName, configuration)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('团队导出失败', 'Team export failed'))
    } finally {
      setConfigurationExporting(false)
    }
  }

  const downloadArchive = async (): Promise<void> => {
    if (exportArchive === undefined || archiveExporting || team.status !== 'paused') return
    setArchiveExporting(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const archive = await exportArchive(team.teamId, includeWorkspace)
      downloadFleetBlob(archive.blob, archive.name)
      setNotice(panelText('团队存档已导出。', 'Team archive exported.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('团队存档导出失败', 'Team archive export failed'))
    } finally {
      setArchiveExporting(false)
    }
  }

  const profile = (value: FleetPanelTeamSettings): FleetPanelTeamSettingsInput['settings'] => ({
    name: value.name,
    positioning: value.positioning,
    rules: value.rules,
    collaborationMethod: value.collaborationMethod,
    visibilityReminderContextGrowthTokens: value.visibilityReminderContextGrowthTokens,
    updateDensity: value.updateDensity,
    notificationPolicy: value.notificationPolicy,
    contentPreference: value.contentPreference,
  })
  const profileDirty = settings !== undefined && savedSettings !== undefined
    && JSON.stringify(profile(settings)) !== JSON.stringify(profile(savedSettings))
  const manualModelEntry = modelDirectory === undefined
    || (modelDirectoryState.status === 'error' && modelDirectoryState.groups.length === 0)

  const saveProfile = async (): Promise<void> => {
    if (settings === undefined || updateSettings === undefined || saving || settings.name.trim() === '') return
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const updated = await updateSettings(profile(settings))
      setSettings(updated)
      setSavedSettings(updated)
      setNotice(panelText('团队设置已保存；已加载成员将在下一次模型调用中接收更新。', 'Team settings saved. Loaded members will receive the update on their next model call.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法保存团队设置', 'Could not save Team settings'))
    } finally {
      setSaving(false)
    }
  }

  const saveRequest = async (): Promise<void> => {
    if (configureRequest === undefined || saving || (!modelDirty && !effortDirty && !maxTokensDirty)) return
    const request: FleetPanelTeamRequestInput['request'] = {}
    if (modelDirty) {
      if (manualModelEntry) {
        if (providerName.trim() === '' || modelName.trim() === '') {
          setError(panelText('Provider 和模型名称都不能为空。', 'Provider and model name are both required.'))
          return
        }
        Object.assign(request, { provider: providerName.trim(), model: modelName.trim() })
      } else {
        const selected = modelDirectoryState.groups.flatMap(group => group.models.map(model => ({
          key: JSON.stringify([group.id, model.id]), provider: group.id, model: model.id,
        }))).find(choice => choice.key === modelKey)
        if (selected === undefined) return
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
      await configureRequest(request)
      await load()
      setNotice(panelText('整队模型配置已更新，从下一次模型调用开始生效。', 'Team model configuration updated. It takes effect on the next model call.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法更新整队模型配置', 'Could not update Team model configuration'))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus()
    }
  }, [onClose])

  return jsx('div', {
    className: 'dsh-fleet-panel-settings-overlay',
    children: jsxs('section', {
      ref: dialog,
      className: 'dsh-fleet-panel-settings-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': panelText(`${settings?.name ?? team.teamName} 团队设置`, `${settings?.name ?? team.teamName} Team settings`),
      tabIndex: -1,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Tab') return
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'))
        const first = focusable[0]
        const last = focusable.at(-1)
        if (first === undefined || last === undefined) return
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      },
      children: [
        jsxs('header', {
          className: 'dsh-fleet-panel-settings-head',
          children: [
            jsx('h2', {
              className: 'dsh-fleet-panel-settings-title',
              children: panelText(`${settings?.name ?? team.teamName} · 团队设置`, `${settings?.name ?? team.teamName} · Team settings`),
            }),
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-settings-close',
              'aria-label': panelText('关闭团队设置', 'Close Team settings'),
              title: panelText('关闭', 'Close'),
              onClick: onClose,
              children: jsx(PanelIcon, { name: 'close', size: 16 }),
            }),
          ],
        }),
        loading ? jsx('div', { className: 'dsh-fleet-panel-settings-empty', children: panelText('正在读取团队设置…', 'Loading Team settings…') }) : jsxs('div', {
          className: 'dsh-fleet-panel-settings-workspace',
          children: [
            jsx('nav', {
              className: 'dsh-fleet-panel-settings-nav',
              'aria-label': panelText('团队设置分区', 'Team settings sections'),
              children: ([
                ['general', panelText('常规', 'General')], ['model', panelText('模型与推理', 'Model & reasoning')],
                ['budget', panelText('预算', 'Budget')],
                ['access', panelText('用户接入', 'User access')], ['collaboration', panelText('协作约定', 'Collaboration')],
                ['data', panelText('数据与存档', 'Data & archives')], ['danger', panelText('危险操作', 'Danger zone')],
              ] as const).map(([id, label]) => jsx('button', {
                type: 'button', className: 'dsh-fleet-panel-settings-nav-item',
                'aria-current': tab === id ? 'page' : undefined,
                'data-danger': id === 'danger' ? 'true' : undefined,
                onClick: () => { setTab(id); setError(undefined); setNotice(undefined) }, children: label,
              }, id)),
            }),
            jsx('div', {
              className: 'dsh-fleet-panel-settings-content',
              children: settings === undefined ? jsx('p', { className: 'dsh-fleet-panel-settings-error', children: error })
                : tab === 'general' ? jsxs('section', { children: [
                  jsx('h3', { children: panelText('常规', 'General') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('修改团队在 Fleet 中的名称与长期定位；稳定的 Team ID 不会改变。', 'Change how the Team is named and positioned in Fleet. Its stable Team ID does not change.') }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('团队名称', 'Team name') }), jsx('input', { value: settings.name, onChange: (event: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, name: event.currentTarget.value }) })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('团队定位', 'Team positioning') }), jsx('textarea', { value: settings.positioning, rows: 5, placeholder: panelText('描述团队长期负责什么，以及不负责什么', 'Describe what the Team owns over time and what it does not own'), onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setSettings({ ...settings, positioning: event.currentTarget.value }) })] }),
                  jsxs('dl', { className: 'dsh-fleet-panel-settings-facts', children: [jsx('dt', { children: 'Team ID' }), jsx('dd', { children: team.teamId }), jsx('dt', { children: panelText('主要工作区', 'Primary Workspace') }), jsx('dd', { children: settings.projectRoot })] }),
                ] }) : tab === 'access' ? jsxs('section', { children: [
                  jsx('h3', { children: panelText('用户接入', 'User access') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('控制团队向你汇报的详细程度、通知时机和内容表达偏好。', 'Control how much detail the Team reports, when it notifies you, and how it presents content.') }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('更新详细度', 'Update detail') }), jsx('select', { value: settings.updateDensity, onChange: (event: ChangeEvent<HTMLSelectElement>) => setSettings({ ...settings, updateDensity: event.currentTarget.value as FleetPanelTeamSettings['updateDensity'] }), children: [jsx('option', { value: 'concise', children: panelText('简洁', 'Concise') }), jsx('option', { value: 'balanced', children: panelText('均衡', 'Balanced') }), jsx('option', { value: 'detailed', children: panelText('详细', 'Detailed') })] })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('通知时机', 'Notification timing') }), jsx('select', { value: settings.notificationPolicy, onChange: (event: ChangeEvent<HTMLSelectElement>) => setSettings({ ...settings, notificationPolicy: event.currentTarget.value as FleetPanelTeamSettings['notificationPolicy'] }), children: [jsx('option', { value: 'decisions', children: panelText('仅需决策时', 'Decisions only') }), jsx('option', { value: 'milestones', children: panelText('重要里程碑', 'Important milestones') }), jsx('option', { value: 'continuous', children: panelText('持续更新', 'Continuous updates') })] })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('内容偏好', 'Content preference') }), jsx('textarea', { value: settings.contentPreference, rows: 5, placeholder: panelText('例如：结论优先，技术细节按需展开', 'For example: lead with conclusions and expand technical detail on demand'), onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setSettings({ ...settings, contentPreference: event.currentTarget.value }) })] }),
                ] }) : tab === 'collaboration' ? jsxs('section', { children: [
                  jsx('h3', { children: panelText('协作约定', 'Collaboration') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('这些约定会作为团队长期指导，并发送给当前已加载的成员。', 'These agreements become durable Team guidance and are sent to currently loaded members.') }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('规则与偏好', 'Rules and preferences') }), jsx('textarea', { value: settings.rules, rows: 6, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setSettings({ ...settings, rules: event.currentTarget.value }) })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('协作方式', 'Collaboration method') }), jsx('textarea', { value: settings.collaborationMethod, rows: 7, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setSettings({ ...settings, collaborationMethod: event.currentTarget.value }) })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('可见性提醒首个增量（Token）', 'First visibility reminder growth (tokens)') }), jsx('input', { type: 'number', min: 0, step: 1000, value: settings.visibilityReminderContextGrowthTokens, onChange: (event: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, visibilityReminderContextGrowthTokens: Number(event.currentTarget.value) }) }), jsx('small', { children: panelText('初始及压缩后首个上下文只建立基线；之后未共享输出的提醒间隔按 1×、2×、4× 递增。0 表示关闭。', 'The initial and first post-compaction context only establish a baseline; later unshared-output reminder intervals grow by 1×, 2×, and 4×. 0 disables them.') })] }),
                ] }) : tab === 'model' ? jsxs('section', { children: [
                  jsx('h3', { children: panelText('模型与推理', 'Model & reasoning') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('统一修改普通成员和团队助理；不会暂停或重启 Agent，从下一次模型调用开始生效。', 'Apply one configuration to members and Team assistants without pausing or restarting Agents. It takes effect on the next model call.') }),
                  manualModelEntry ? jsxs('div', { className: 'dsh-fleet-panel-settings-model-grid', children: [
                    jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: 'Provider' }), jsx('input', { value: providerName, placeholder: settings.request.mixed.model && !modelDirty ? panelText('当前成员配置不一致', 'Current member settings differ') : 'provider-id', onChange: (event: ChangeEvent<HTMLInputElement>) => { setProviderName(event.currentTarget.value); setModelDirty(true) } })] }),
                    jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('模型名称', 'Model name') }), jsx('input', { value: modelName, placeholder: settings.request.mixed.model && !modelDirty ? panelText('当前成员配置不一致', 'Current member settings differ') : 'deepseek-v4-flash', onChange: (event: ChangeEvent<HTMLInputElement>) => { setModelName(event.currentTarget.value); setModelDirty(true) } })] }),
                  ] }) : jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('模型', 'Model') }), jsx('select', { value: modelKey, disabled: modelDirectoryState.status === 'loading', onChange: (event: ChangeEvent<HTMLSelectElement>) => { setModelKey(event.currentTarget.value); setModelDirty(true) }, children: [
                    settings.request.mixed.model && !modelDirty && jsx('option', { value: '', children: panelText('当前成员配置不一致', 'Current member settings differ') }),
                    !settings.request.mixed.model && modelKey !== '' && jsx('option', { value: modelKey, children: `${settings.request.provider ?? '—'} · ${settings.request.model ?? '—'}` }),
                    ...modelDirectoryState.groups.map(group => jsx('optgroup', { label: group.name, children: group.models.map(model => jsx('option', { value: JSON.stringify([group.id, model.id]), children: model.name }, model.id)) }, group.id)),
                  ] })] }),
                  manualModelEntry && jsx('p', { className: 'dsh-fleet-panel-settings-field-note', children: panelText('当前实例未提供模型目录，请填写 DSH 中已配置的 Provider 和模型标识。', 'This instance does not provide a model catalog. Enter a Provider and model identifier configured in DSH.') }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('推理强度', 'Reasoning effort') }), jsx('select', { value: effort, onChange: (event: ChangeEvent<HTMLSelectElement>) => { setEffort(event.currentTarget.value); setEffortDirty(true) }, children: [settings.request.mixed.reasoningEffort && !effortDirty && jsx('option', { value: '', children: panelText('当前成员配置不一致', 'Current member settings differ') }), !settings.request.mixed.reasoningEffort && jsx('option', { value: '', children: panelText('使用模型默认值', 'Use model default') }), ...['low', 'medium', 'high', 'xhigh', 'max'].map(value => jsx('option', { value, children: value }, value))] })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('最大 Token', 'Maximum tokens') }), jsx('input', { type: 'number', min: 1, step: 1, value: maxTokens, placeholder: settings.request.mixed.maxTokens && !maxTokensDirty ? panelText('当前成员配置不一致', 'Current member settings differ') : panelText('使用模型默认值', 'Use model default'), onChange: (event: ChangeEvent<HTMLInputElement>) => { setMaxTokens(event.currentTarget.value); setMaxTokensDirty(true) } })] }),
                  modelDirectoryState.status === 'error' && jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-inline-action', onClick: () => { void modelDirectory?.load() }, children: panelText('重新读取模型目录', 'Reload model catalog') }),
                ] }) : tab === 'budget' ? jsx(BudgetSettings, {
                  budget: settings.budget,
                  updateBudget,
                  onUpdated: (budget: FleetPanelTeamBudget) => {
                    setSettings(current => current === undefined ? current : { ...current, budget })
                    setSavedSettings(current => current === undefined ? current : { ...current, budget })
                  },
                  setError,
                  setNotice,
                }) : tab === 'data' ? jsxs('section', { children: [
                  jsx('h3', { children: panelText('数据与存档', 'Data & archives') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('配置导出用于创建同类团队；完整存档包含运行上下文和插件数据。', 'Configuration export creates similar Teams. A complete archive includes runtime context and plugin data.') }),
                  jsxs('div', { className: 'dsh-fleet-panel-settings-action-row', children: [jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-export', disabled: exportTeam === undefined || configurationExporting, onClick: () => { void downloadConfiguration() }, children: [jsx(PanelIcon, { name: 'download', size: 16 }), configurationExporting ? panelText('正在导出…', 'Exporting…') : panelText('导出团队配置', 'Export Team configuration')] })] }),
                  jsx('hr', {}),
                  jsx('h4', { children: panelText('完整团队存档', 'Complete Team archive') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: team.status === 'paused' ? panelText('团队已暂停，可以生成一致的完整存档。', 'The Team is paused and ready for a consistent archive.') : panelText('请先在团队概况中暂停团队，再导出完整存档。', 'Pause the Team from its overview before exporting a complete archive.') }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-check', children: [jsx('input', { type: 'checkbox', checked: includeWorkspace, disabled: archiveExporting, onChange: (event: ChangeEvent<HTMLInputElement>) => { setIncludeWorkspace(event.currentTarget.checked) } }), jsx('span', { children: panelText('同时打包工作区文件', 'Include Workspace files') })] }),
                  jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-export', disabled: team.status !== 'paused' || exportArchive === undefined || archiveExporting, title: team.status === 'paused' ? undefined : panelText('请先暂停团队', 'Pause the Team first'), onClick: () => { void downloadArchive() }, children: [jsx(PanelIcon, { name: 'download', size: 16 }), archiveExporting ? panelText('正在生成存档…', 'Creating archive…') : panelText('导出完整存档', 'Export complete archive')] }),
                ] }) : jsxs('section', { className: 'dsh-fleet-panel-settings-danger', children: [
                  jsx('h3', { children: panelText('危险操作', 'Danger zone') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('终结后团队进入归档，成员会话和历史记录仍会保留，但不能继续运行。', 'Finishing archives the Team. Member Sessions and history remain, but the Team can no longer run.') }),
                  jsx('button', { type: 'button', disabled: finishTeam === undefined, onClick: () => { setEnding(true) }, children: panelText('终结团队', 'Finish Team') }),
                ] }),
            }),
          ],
        }),
        !loading && jsxs('footer', { className: 'dsh-fleet-panel-settings-footer', children: [
          jsxs('div', { className: 'dsh-fleet-panel-settings-feedback', children: [error !== undefined && jsx('span', { 'data-error': 'true', role: 'alert', children: error }), notice !== undefined && jsx('span', { role: 'status', children: notice })] }),
          jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-secondary', onClick: onClose, children: panelText('关闭', 'Close') }),
          (tab === 'general' || tab === 'access' || tab === 'collaboration') && jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-primary', disabled: !profileDirty || saving || settings?.name.trim() === '' || updateSettings === undefined, onClick: () => { void saveProfile() }, children: saving ? panelText('正在保存…', 'Saving…') : panelText('保存设置', 'Save settings') }),
          tab === 'model' && jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-primary', disabled: saving || (!modelDirty && !effortDirty && !maxTokensDirty) || configureRequest === undefined, onClick: () => { void saveRequest() }, children: saving ? panelText('正在应用…', 'Applying…') : panelText('应用到整队', 'Apply to Team') }),
        ] }),
        ending && finishTeam !== undefined && jsx(EndTeamDialog, { teamName: settings?.name ?? team.teamName, onClose: () => { setEnding(false) }, onConfirm: finishTeam }),
      ],
    }),
  })
}

function TeamImportDialog({ importArchive, onClose }: {
  readonly importArchive: (file: File, projectRoot: string, mode: 'copy' | 'restore') => Promise<void>
  readonly onClose: () => void
}): ReactElement {
  const dialog = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'copy' | 'restore'>('copy')
  const [root, setRoot] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const importFile = async (file: File): Promise<void> => {
    if (busy || root.trim() === '') return
    setBusy(true); setError(undefined)
    try { await importArchive(file, root.trim(), mode); onClose() } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('团队存档导入失败', 'Team archive import failed'))
    } finally { setBusy(false); if (input.current !== null) input.current.value = '' }
  }

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus()
    }
  }, [busy, onClose])

  return jsx('div', { className: 'dsh-fleet-panel-settings-overlay', children: jsxs('section', { ref: dialog, className: 'dsh-fleet-panel-settings-dialog dsh-fleet-panel-import-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': panelText('导入团队', 'Import Team'), tabIndex: -1, onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (first === undefined || last === undefined) return
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus()
    }
  }, children: [
    jsxs('header', { className: 'dsh-fleet-panel-settings-head', children: [jsx('h2', { className: 'dsh-fleet-panel-settings-title', children: panelText('导入团队', 'Import Team') }), jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-close', 'aria-label': panelText('关闭导入', 'Close import'), onClick: onClose, children: jsx(PanelIcon, { name: 'close', size: 16 }) })] }),
    jsxs('div', { className: 'dsh-fleet-panel-settings-body', children: [
      jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('从完整团队存档创建副本，或在当前实例中恢复原团队身份。', 'Create a copy from a complete Team archive, or restore its original identity in this instance.') }),
      jsxs('fieldset', { className: 'dsh-fleet-panel-settings-import-mode', disabled: busy, children: [jsx('legend', { children: panelText('导入方式', 'Import mode') }), ...([['copy', panelText('创建为新团队', 'Create as new Team'), panelText('分配新的团队和成员身份。', 'Assign new Team and member identities.')], ['restore', panelText('恢复原团队', 'Restore original Team'), panelText('保留存档中的原始身份。', 'Keep the original archived identities.')]] as const).map(([value, title, copy]) => jsxs('label', { className: 'dsh-fleet-panel-settings-import-choice', children: [jsx('input', { type: 'radio', name: 'fleet-import-mode', checked: mode === value, onChange: () => { setMode(value) } }), jsxs('span', { children: [jsx('strong', { children: title }), jsx('small', { children: copy })] })] }, value))] }),
      jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('目标工作区路径', 'Destination Workspace path') }), jsx('input', { value: root, disabled: busy, placeholder: '/path/to/project', onChange: (event: ChangeEvent<HTMLInputElement>) => { setRoot(event.currentTarget.value) } })] }),
      jsx('input', { ref: input, className: 'dsh-fleet-panel-settings-file-input', type: 'file', accept: '.fleet.tar.gz,.tar.gz,.tgz,application/gzip', onChange: (event: ChangeEvent<HTMLInputElement>) => { const file = event.currentTarget.files?.[0]; if (file !== undefined) void importFile(file) } }),
      error !== undefined && jsx('p', { className: 'dsh-fleet-panel-settings-error', role: 'alert', children: error }),
    ] }),
    jsxs('footer', { className: 'dsh-fleet-panel-settings-footer', children: [jsx('span', { className: 'dsh-fleet-panel-settings-feedback' }), jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-secondary', disabled: busy, onClick: onClose, children: panelText('取消', 'Cancel') }), jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-primary', disabled: busy || root.trim() === '', onClick: () => { input.current?.click() }, children: busy ? panelText('正在导入…', 'Importing…') : panelText('选择存档', 'Choose archive') })] }),
  ] }) })
}

function EndTeamDialog({ teamName, onClose, onConfirm }: {
  readonly teamName: string
  readonly onClose: () => void
  readonly onConfirm: (summary: string) => Promise<void>
}): ReactElement {
  const dialog = useRef<HTMLElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [summary, setSummary] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    input.current?.focus()
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || submitting) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus()
    }
  }, [onClose, submitting])

  const confirm = (): void => {
    const reason = summary.trim()
    if (reason === '' || submitting) return
    setSubmitting(true)
    setError(undefined)
    void onConfirm(reason).then(onClose).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : panelText('无法终结团队', 'Could not finish Team'))
    }).finally(() => { setSubmitting(false) })
  }

  return jsx('div', {
    className: 'dsh-fleet-panel-settings-overlay',
    children: jsxs('section', {
      ref: dialog,
      className: 'dsh-fleet-panel-settings-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': panelText(`终结 ${teamName}`, `Finish ${teamName}`),
      tabIndex: -1,
      children: [
        jsxs('header', {
          className: 'dsh-fleet-panel-settings-head',
          children: [
            jsx('h2', { className: 'dsh-fleet-panel-settings-title', children: panelText(`终结 ${teamName}`, `Finish ${teamName}`) }),
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-settings-close',
              'aria-label': panelText('取消终结团队', 'Cancel finishing Team'),
              disabled: submitting,
              onClick: onClose,
              children: jsx(PanelIcon, { name: 'close', size: 16 }),
            }),
          ],
        }),
        jsxs('div', {
          className: 'dsh-fleet-panel-control-dialog-body',
          children: [
            jsx('p', {
              className: 'dsh-fleet-panel-control-dialog-copy',
              children: panelText('终结会结束当前工作并关闭团队成员。团队记录仍会保留在已归档列表中，但不能继续运行。', 'Finishing ends current work and closes Team members. Team records remain in the archived list but cannot resume.'),
            }),
            jsxs('label', {
              className: 'dsh-fleet-panel-control-dialog-label',
              children: [
                panelText('终结摘要', 'Finish summary'),
                jsx('textarea', {
                  ref: input,
                  className: 'dsh-fleet-panel-control-dialog-input',
                  value: summary,
                  disabled: submitting,
                  placeholder: panelText('说明终结原因和需要保留的状态', 'Explain why the Team is finishing and what state should be preserved'),
                  onChange: (event: { readonly currentTarget: { readonly value: string } }) => { setSummary(event.currentTarget.value) },
                }),
              ],
            }),
            error !== undefined && jsx('p', { className: 'dsh-fleet-panel-control-error', role: 'alert', children: error }),
          ],
        }),
        jsxs('div', {
          className: 'dsh-fleet-panel-control-dialog-actions',
          children: [
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-control-button',
              disabled: submitting,
              onClick: onClose,
              children: panelText('取消', 'Cancel'),
            }),
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-control-button',
              'data-danger': 'true',
              disabled: submitting || summary.trim() === '',
              onClick: confirm,
              children: submitting ? panelText('正在终结…', 'Finishing…') : panelText('终结团队', 'Finish Team'),
            }),
          ],
        }),
      ],
    }),
  })
}

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
    () => fleetTeamSettingsRequest,
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

function statusLabel(status: FleetPanelTeamSummary['status']): string {
  if (status === 'running') return panelText('运行中', 'Running')
  if (status === 'idle') return panelText('待命', 'Idle')
  if (status === 'paused') return panelText('已暂停', 'Paused')
  if (status === 'starting') return panelText('正在建立', 'Starting')
  if (status === 'finishing') return panelText('正在收尾', 'Finishing')
  if (status === 'closed') return panelText('已结束', 'Closed')
  if (status === 'failed') return panelText('异常', 'Error')
  return panelText('未连接', 'Disconnected')
}

function renderSidebarSection(
  panel: FleetPanelHomeOwner | FleetPanelPaneOwner,
  tool: 'home' | FleetPanelToolId,
): ReactNode {
  const owner: FleetPanelSidebarSectionOwner = { panel, tool }
  return panel.renderPanelSlot(FLEET_PANEL_SLOTS.sidebarSection, owner as unknown as Record<string, unknown>)
}

function renderMessageBlockExtension(
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

function FleetPlainMessageText({ text, members, showMemberDetails, showMemberContext }: FleetMessageTextProps): ReactElement {
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

function renderMessageText(
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

function renderMemberMention(owner: FleetPanelPaneOwner, mention: FleetChatMentionBlock): ReactNode | undefined {
  const member = teamAgents(owner.snapshot).find(candidate => candidate.id === mention.memberId)
  if (member === undefined) return undefined
  return jsx(FleetMemberMentionPopover, {
    member,
    label: `@${mention.label}`,
    showDetails: owner.showMemberDetails,
    showContext: owner.showMemberContext,
  })
}

function messageReadReceipt(
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

function useConversationHistory(
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

interface PanelColumnResizeHandleProps {
  readonly label: string
  readonly title: string
  readonly resizing: boolean
  readonly min: number
  readonly max: number
  readonly value: number
  readonly placement?: 'edge' | 'split'
  readonly handle: {
    readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
    readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
    readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
    readonly onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
    readonly onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
    readonly onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void
  }
  readonly onDoubleClick?: () => void
}

function PanelColumnResizeHandle({
  label,
  title,
  resizing,
  min,
  max,
  value,
  placement = 'edge',
  handle,
  onDoubleClick,
}: PanelColumnResizeHandleProps): ReactElement {
  const interaction = {
    'data-dragging': resizing ? 'true' : undefined,
    role: 'separator',
    'aria-label': label,
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': value,
    tabIndex: 0,
    title,
    ...handle,
    onDoubleClick,
  }
  if (placement === 'split') {
    return jsx('div', {
      className: 'dsh-fleet-panel-resource-compare-resize-track',
      ...interaction,
      children: jsx('span', {
        className: 'dsh-fleet-panel-chat-width-handle',
        'aria-hidden': 'true',
      }),
    })
  }
  return jsx('div', {
    className: 'dsh-fleet-panel-chat-width-handle',
    'data-placement': placement,
    ...interaction,
  })
}

function PanelMessageLog({
  conversationKey,
  messageCount,
  children,
  resizable = false,
  resizeLabel = panelText('调整消息区域宽度', 'Resize message area'),
  initialScroll = 'bottom',
  hasOlder = false,
  loadingOlder = false,
  loadOlder,
}: {
  readonly conversationKey: string
  readonly messageCount: number
  readonly children: ReactNode
  readonly resizable?: boolean
  readonly resizeLabel?: string
  readonly initialScroll?: 'top' | 'bottom'
  readonly hasOlder?: boolean
  readonly loadingOlder?: boolean
  readonly loadOlder?: () => Promise<void>
}): ReactElement {
  const log = useRef<HTMLDivElement>(null)
  const renderedConversation = useRef<string>()
  const atBottom = useRef(true)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const prepend = useRef<{ readonly height: number; readonly top: number }>()
  const column = useFleetChatColumnWidth(log)

  const rememberScroll = (): void => {
    const node = log.current
    if (node === null) return
    const nextAtBottom = nearChatBottom(node)
    atBottom.current = nextAtBottom
    rememberBounded(panelChatScroll, conversationKey, { top: node.scrollTop, atBottom: nextAtBottom })
    if (nextAtBottom) setHasNewMessages(false)
    if (node.scrollTop <= 72 && hasOlder && !loadingOlder && loadOlder !== undefined) {
      prepend.current = { height: node.scrollHeight, top: node.scrollTop }
      void loadOlder()
    }
  }
  const scrollToLatest = (): void => {
    const node = log.current
    if (node === null) return
    node.scrollTop = node.scrollHeight
    atBottom.current = true
    rememberBounded(panelChatScroll, conversationKey, { top: node.scrollTop, atBottom: true })
    setHasNewMessages(false)
  }

  useLayoutEffect(() => {
    const node = log.current
    if (node === null) return
    const changedConversation = renderedConversation.current !== conversationKey
    const previousCount = panelChatMessageCounts.get(conversationKey)
    if (changedConversation) {
      renderedConversation.current = conversationKey
      const saved = panelChatScroll.get(conversationKey)
      node.scrollTop = saved?.atBottom === false
        ? saved.top
        : saved === undefined && initialScroll === 'top' ? 0 : node.scrollHeight
      atBottom.current = nearChatBottom(node)
      setHasNewMessages(false)
    } else if (previousCount !== undefined && messageCount > previousCount) {
      if (prepend.current !== undefined) {
        node.scrollTop = prepend.current.top + node.scrollHeight - prepend.current.height
        prepend.current = undefined
        atBottom.current = false
      } else if (atBottom.current) scrollToLatest()
      else setHasNewMessages(true)
    } else if (!loadingOlder) {
      prepend.current = undefined
    }
    rememberBounded(panelChatMessageCounts, conversationKey, messageCount)
  }, [conversationKey, initialScroll, loadingOlder, messageCount])

  useLayoutEffect(() => {
    const node = log.current
    if (node === null || !hasOlder || loadingOlder || loadOlder === undefined) return
    if (node.scrollHeight > node.clientHeight + 1) return
    prepend.current = { height: node.scrollHeight, top: node.scrollTop }
    void loadOlder()
  }, [conversationKey, hasOlder, loadOlder, loadingOlder, messageCount])

  return jsxs('div', {
    className: 'dsh-fleet-panel-chat-log-wrap',
    'data-column-resizing': column.resizing ? 'true' : undefined,
    style: resizable
      ? { '--dsh-fleet-panel-chat-column-width': `${column.width}px` } as CSSProperties
      : undefined,
    children: [
      jsx('div', {
        ref: log,
        className: 'dsh-fleet-panel-chat-log',
        onScroll: rememberScroll,
        children,
      }),
      loadingOlder && jsx('div', {
        className: 'dsh-fleet-panel-chat-history-loading',
        role: 'status',
        children: panelText('正在加载更早消息…', 'Loading earlier messages…'),
      }),
      resizable && jsx(PanelColumnResizeHandle, {
        label: resizeLabel,
        title: panelText(`拖动${resizeLabel}`, `Drag to resize ${resizeLabel}`),
        resizing: column.resizing,
        min: CHAT_COLUMN_MIN_WIDTH,
        max: CHAT_COLUMN_MAX_WIDTH,
        value: column.width,
        handle: column.handle,
      }),
      hasNewMessages && jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-panel-chat-new-messages',
        onClick: scrollToLatest,
        children: [
          jsx(PanelIcon, { name: 'chevron', size: 12 }),
          jsx('span', { children: panelText('查看新消息', 'View new messages') }),
        ],
      }),
    ],
  })
}

function MemberState({ member, showDot = true }: {
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

function AgentPerspectiveMeta({ member }: { readonly member: FleetPanelMember }): ReactElement {
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

function FleetMemberListRow({ member, owner }: {
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

function FleetMemberAvatarPopover({ member, showDetails, showContext, size = 34 }: {
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

function FleetReceiptMemberPopover({ member, showDetails, showContext }: {
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

function FleetMemberMentionPopover({ member, label, showDetails, showContext }: {
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

function downloadFleetBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function downloadFleetTeamConfiguration(teamName: string, configuration: Record<string, unknown>): void {
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

function FleetSessionGoalDock({ session }: { readonly session: FleetNativeSessionFace | undefined }): ReactElement | null {
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

function FleetOfficialConversationComposer({ owner, conversation }: {
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
        ...(conversation.kind === 'direct' && peer !== undefined ? { memberId: peer.id } : {}),
      }),
      footer,
      }),
    ],
  })
}

function ChatMain(owner: FleetPanelPaneOwner): ReactElement {
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

function FleetPanelChatThread({ owner, conversation, thread, members, selfId }: {
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

function DetailShell({ title, meta, actions, bodyClassName, owner, children }: {
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

function NavigationToggle({ owner }: { readonly owner: { readonly openNavigation: () => void } }): ReactElement {
  return jsx('button', {
    type: 'button',
    className: 'dsh-fleet-panel-navigation-toggle',
    'aria-label': panelText('打开团队导航', 'Open Team navigation'),
    title: panelText('打开团队导航', 'Open Team navigation'),
    onClick: owner.openNavigation,
    children: jsx(PanelIcon, { name: 'menu', size: 16 }),
  })
}

function Fact({ label, value }: { readonly label: string; readonly value: ReactNode }): ReactElement {
  return jsxs('div', {
    className: 'dsh-fleet-panel-fact',
    children: [
      jsx('span', { className: 'dsh-fleet-panel-fact-label', children: label }),
      jsx('span', { className: 'dsh-fleet-panel-fact-value', children: value }),
    ],
  })
}

function HomeMain(owner: FleetPanelHomeOwner): ReactElement {
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

function MemberAuthorizationPanel({ owner, member }: {
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

function MemberRequestConfiguration({ owner, member, assistant }: {
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

function TeamMain(owner: FleetPanelPaneOwner): ReactElement {
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

function FleetNativeMemberChat({ owner, session, sessionId, source }: {
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

function centerFleetContextTarget(scrollport: HTMLElement, target: HTMLElement): void {
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

function traceMessageText(value: unknown): string {
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

function clipTraceText(value: string): string {
  return value.length <= 8_000 ? value : `${value.slice(0, 8_000)}\n…`
}

function traceEventPresentation(event: FleetPanelMemberTraceEvent): {
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

function FleetPersistedMemberTrace({ owner, member, source }: {
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

function AgentContextMain({ owner, member }: {
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

function AgentMain(owner: FleetPanelPaneOwner): ReactElement {
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

function OpenFleetPath({ owner, path, label, appearance = 'button' }: {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function resourceFileName(resource: FleetPanelResource): string {
  return resource.path.split(/[\\/]/u).at(-1) || resource.name.split(/[\\/]/u).at(-1) || resource.name
}

type FleetResourceContentMode = 'rendered' | 'source' | 'compare'

const RESOURCE_COMPARE_MIN_SPLIT = 25
const RESOURCE_COMPARE_MAX_SPLIT = 75
const RESOURCE_COMPARE_DEFAULT_SPLIT = 50

function ResourceComparison({ source, rendered }: {
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

function ResourceSourcePreview({ body, wrap }: {
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

function ResourceContentPreview({ owner, resource, content, loading, error, onRetry, mode, wrapSource }: {
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

function resourceMember(owner: FleetPanelPaneOwner, actorId: string): FleetPanelMember | undefined {
  return owner.snapshot.members.find(member => member.id === actorId || member.sessionId === actorId)
    ?? owner.snapshot.assistants?.find(member => member.id === actorId || member.sessionId === actorId)
}

function resourceActorName(owner: FleetPanelPaneOwner, actorId: string): string {
  return resourceMember(owner, actorId)?.name
    ?? (actorId === 'fleet-filesystem' ? panelText('文件系统自动发现', 'Discovered by filesystem') : actorId)
}

function ResourceDiffFallback({ revision }: { readonly revision: FleetPanelResourceRevision }): ReactElement {
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

function ResourceHistoryView({ owner, resource, history, historyTruncated, revision, loading, error, selectedId, selectRevision, retry }: {
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

function MarkdownRendererUnavailableView({ label }: {
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

function ResourceDetailMain({ owner, resource }: {
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

function ResourcesMain(owner: FleetPanelPaneOwner): ReactElement {
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
          jsx('p', { className: 'dsh-fleet-panel-overview-copy', children: panelText('普通文件按需通过 DSH 工作区浏览，不会自动加入团队共享。', 'Browse ordinary files through the DSH Workspace as needed; they are not automatically shared with the Team.') }),
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

const FLEET_ACTIVITY_WINDOW_PAGE = 40
const FLEET_ACTIVITY_WINDOW_MAX = 120
const FLEET_TIMELINE_MIN_SCALE = Math.log10(1_000)
const FLEET_TIMELINE_MAX_SCALE = Math.log10(365.25 * 24 * 60 * 60 * 1_000)
const FLEET_TIMELINE_DEFAULT_SCALE = Math.log10(60 * 60 * 1_000)
const FLEET_TIMELINE_TICK_SPACING = 20
const FLEET_TIMELINE_SCROLL_DISTANCE = 120
const FLEET_TIMELINE_WHEEL_IDLE_MS = 140
const FLEET_TIMELINE_JUMP_IDLE_MS = 280
const FLEET_TIMELINE_RENDER_RADIUS = 360
const FLEET_TIMELINE_MINOR_MIN_SPACING = 12
const FLEET_TIMELINE_MINOR_MAX_SPACING = 20
const FLEET_TIMELINE_MAJOR_MIN_SPACING = 60
const FLEET_TIMELINE_MAJOR_MAX_SPACING = 100
const FLEET_TIMELINE_SECOND = 1_000
const FLEET_TIMELINE_MINUTE = 60 * FLEET_TIMELINE_SECOND
const FLEET_TIMELINE_HOUR = 60 * FLEET_TIMELINE_MINUTE
const FLEET_TIMELINE_DAY = 24 * FLEET_TIMELINE_HOUR
const FLEET_TIMELINE_YEAR = 365.25 * FLEET_TIMELINE_DAY

interface FleetActivityWindow {
  readonly start: number
  readonly end: number
}

interface FleetTimelineTick {
  readonly timestamp: number
  readonly position: number
  readonly strength: number
  readonly opacity: number
}

type FleetTimelineIntervalUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

interface FleetTimelineInterval {
  readonly unit: FleetTimelineIntervalUnit
  readonly amount: number
  readonly approximateMs: number
}

interface FleetTimelineIntervalBlend {
  readonly fine: FleetTimelineInterval
  readonly coarse: FleetTimelineInterval
  readonly progress: number
}

interface FleetTimelineGrid {
  readonly minor: FleetTimelineIntervalBlend
  readonly major: FleetTimelineIntervalBlend
  readonly dominantMinor: FleetTimelineInterval
  readonly dominantMajor: FleetTimelineInterval
}

const FLEET_TIMELINE_INTERVALS: readonly FleetTimelineInterval[] = [
  { unit: 'second', amount: 1, approximateMs: FLEET_TIMELINE_SECOND },
  { unit: 'second', amount: 2, approximateMs: 2 * FLEET_TIMELINE_SECOND },
  { unit: 'second', amount: 5, approximateMs: 5 * FLEET_TIMELINE_SECOND },
  { unit: 'second', amount: 10, approximateMs: 10 * FLEET_TIMELINE_SECOND },
  { unit: 'second', amount: 15, approximateMs: 15 * FLEET_TIMELINE_SECOND },
  { unit: 'second', amount: 30, approximateMs: 30 * FLEET_TIMELINE_SECOND },
  { unit: 'minute', amount: 1, approximateMs: FLEET_TIMELINE_MINUTE },
  { unit: 'minute', amount: 2, approximateMs: 2 * FLEET_TIMELINE_MINUTE },
  { unit: 'minute', amount: 5, approximateMs: 5 * FLEET_TIMELINE_MINUTE },
  { unit: 'minute', amount: 10, approximateMs: 10 * FLEET_TIMELINE_MINUTE },
  { unit: 'minute', amount: 15, approximateMs: 15 * FLEET_TIMELINE_MINUTE },
  { unit: 'minute', amount: 30, approximateMs: 30 * FLEET_TIMELINE_MINUTE },
  { unit: 'hour', amount: 1, approximateMs: FLEET_TIMELINE_HOUR },
  { unit: 'hour', amount: 2, approximateMs: 2 * FLEET_TIMELINE_HOUR },
  { unit: 'hour', amount: 3, approximateMs: 3 * FLEET_TIMELINE_HOUR },
  { unit: 'hour', amount: 6, approximateMs: 6 * FLEET_TIMELINE_HOUR },
  { unit: 'hour', amount: 12, approximateMs: 12 * FLEET_TIMELINE_HOUR },
  { unit: 'day', amount: 1, approximateMs: FLEET_TIMELINE_DAY },
  { unit: 'day', amount: 2, approximateMs: 2 * FLEET_TIMELINE_DAY },
  { unit: 'week', amount: 1, approximateMs: 7 * FLEET_TIMELINE_DAY },
  { unit: 'week', amount: 2, approximateMs: 14 * FLEET_TIMELINE_DAY },
  { unit: 'month', amount: 1, approximateMs: FLEET_TIMELINE_YEAR / 12 },
  { unit: 'month', amount: 2, approximateMs: FLEET_TIMELINE_YEAR / 6 },
  { unit: 'month', amount: 3, approximateMs: FLEET_TIMELINE_YEAR / 4 },
  { unit: 'month', amount: 6, approximateMs: FLEET_TIMELINE_YEAR / 2 },
  { unit: 'year', amount: 1, approximateMs: FLEET_TIMELINE_YEAR },
  { unit: 'year', amount: 2, approximateMs: 2 * FLEET_TIMELINE_YEAR },
  { unit: 'year', amount: 5, approximateMs: 5 * FLEET_TIMELINE_YEAR },
  { unit: 'year', amount: 10, approximateMs: 10 * FLEET_TIMELINE_YEAR },
]

function fleetTimelineIntervalBlend(millisecondsPerPixel: number, minSpacing: number, maxSpacing: number): FleetTimelineIntervalBlend {
  let fineIndex = 0
  for (let index = 1; index < FLEET_TIMELINE_INTERVALS.length; index += 1) {
    if (FLEET_TIMELINE_INTERVALS[index]!.approximateMs / millisecondsPerPixel > maxSpacing) break
    fineIndex = index
  }
  const coarseIndex = Math.min(FLEET_TIMELINE_INTERVALS.length - 1, fineIndex + 1)
  const fine = FLEET_TIMELINE_INTERVALS[fineIndex]!
  const coarse = FLEET_TIMELINE_INTERVALS[coarseIndex]!
  if (fineIndex === coarseIndex) return { fine, coarse, progress: 0 }
  const linear = Math.max(0, Math.min(1, (maxSpacing - fine.approximateMs / millisecondsPerPixel) / (maxSpacing - minSpacing)))
  const progress = linear * linear * (3 - 2 * linear)
  return { fine, coarse, progress }
}

function fleetTimelineGrid(step: number): FleetTimelineGrid {
  const millisecondsPerPixel = step / FLEET_TIMELINE_TICK_SPACING
  const minor = fleetTimelineIntervalBlend(millisecondsPerPixel, FLEET_TIMELINE_MINOR_MIN_SPACING, FLEET_TIMELINE_MINOR_MAX_SPACING)
  const major = fleetTimelineIntervalBlend(millisecondsPerPixel, FLEET_TIMELINE_MAJOR_MIN_SPACING, FLEET_TIMELINE_MAJOR_MAX_SPACING)
  return {
    minor,
    major,
    dominantMinor: minor.progress < .5 ? minor.fine : minor.coarse,
    dominantMajor: major.progress < .5 ? major.fine : major.coarse,
  }
}

function floorFleetTimelineTimestamp(timestamp: number, interval: FleetTimelineInterval): number {
  const date = new Date(timestamp)
  if (interval.unit === 'second') {
    date.setMilliseconds(0)
    date.setSeconds(Math.floor(date.getSeconds() / interval.amount) * interval.amount)
    return date.getTime()
  }
  if (interval.unit === 'minute') {
    date.setSeconds(0, 0)
    date.setMinutes(Math.floor(date.getMinutes() / interval.amount) * interval.amount)
    return date.getTime()
  }
  if (interval.unit === 'hour') {
    date.setMinutes(0, 0, 0)
    date.setHours(Math.floor(date.getHours() / interval.amount) * interval.amount)
    return date.getTime()
  }
  if (interval.unit === 'day' || interval.unit === 'week') {
    const dayIndex = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / FLEET_TIMELINE_DAY)
    const span = interval.amount * (interval.unit === 'week' ? 7 : 1)
    const origin = interval.unit === 'week' ? 4 : 0
    const aligned = origin + Math.floor((dayIndex - origin) / span) * span
    const utc = new Date(aligned * FLEET_TIMELINE_DAY)
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()).getTime()
  }
  if (interval.unit === 'month') {
    const monthIndex = date.getFullYear() * 12 + date.getMonth()
    const aligned = Math.floor(monthIndex / interval.amount) * interval.amount
    return new Date(Math.floor(aligned / 12), aligned % 12, 1).getTime()
  }
  return new Date(Math.floor(date.getFullYear() / interval.amount) * interval.amount, 0, 1).getTime()
}

function offsetFleetTimelineTimestamp(timestamp: number, interval: FleetTimelineInterval, count: number): number {
  const date = new Date(timestamp)
  if (interval.unit === 'second') date.setSeconds(date.getSeconds() + interval.amount * count)
  else if (interval.unit === 'minute') date.setMinutes(date.getMinutes() + interval.amount * count)
  else if (interval.unit === 'hour') date.setHours(date.getHours() + interval.amount * count)
  else if (interval.unit === 'day') date.setDate(date.getDate() + interval.amount * count)
  else if (interval.unit === 'week') date.setDate(date.getDate() + 7 * interval.amount * count)
  else if (interval.unit === 'month') date.setMonth(date.getMonth() + interval.amount * count)
  else date.setFullYear(date.getFullYear() + interval.amount * count)
  return date.getTime()
}

function fleetTimelineIntervalTimestamps(anchor: number, interval: FleetTimelineInterval, millisecondsPerPixel: number): readonly number[] {
  const base = floorFleetTimelineTimestamp(anchor, interval)
  const timestamps: number[] = []
  for (let offset = 0; offset < 200; offset += 1) {
    const timestamp = offsetFleetTimelineTimestamp(base, interval, offset)
    if ((timestamp - anchor) / millisecondsPerPixel > FLEET_TIMELINE_RENDER_RADIUS) break
    timestamps.push(timestamp)
  }
  for (let offset = -1; offset > -200; offset -= 1) {
    const timestamp = offsetFleetTimelineTimestamp(base, interval, offset)
    if ((timestamp - anchor) / millisecondsPerPixel < -FLEET_TIMELINE_RENDER_RADIUS) break
    timestamps.push(timestamp)
  }
  return timestamps
}

export function fleetTimelineTicks(anchor: number, step: number): readonly FleetTimelineTick[] {
  const millisecondsPerPixel = step / FLEET_TIMELINE_TICK_SPACING
  const grid = fleetTimelineGrid(step)
  const ticks = new Map<number, { strength: number; opacity: number }>()
  const add = (interval: FleetTimelineInterval, weight: number, kind: 'minor' | 'major'): void => {
    if (weight <= .001) return
    for (const timestamp of fleetTimelineIntervalTimestamps(anchor, interval, millisecondsPerPixel)) {
      const current = ticks.get(timestamp) ?? { strength: 0, opacity: 0 }
      if (kind === 'major') current.strength = Math.min(1, current.strength + weight)
      else current.opacity = Math.min(1, current.opacity + weight)
      ticks.set(timestamp, current)
    }
  }
  add(grid.minor.fine, 1 - grid.minor.progress, 'minor')
  add(grid.minor.coarse, grid.minor.progress, 'minor')
  add(grid.major.fine, 1 - grid.major.progress, 'major')
  add(grid.major.coarse, grid.major.progress, 'major')
  return [...ticks.entries()]
    .map(([timestamp, tick]) => ({
      timestamp,
      position: (timestamp - anchor) / millisecondsPerPixel,
      strength: tick.strength,
      opacity: Math.max(tick.opacity, tick.strength),
    }))
    .filter(tick => tick.opacity > .001)
    .sort((left, right) => left.timestamp - right.timestamp)
}

export function clampFleetTimelineTime(value: number, first: number | undefined, last: number | undefined): number {
  if (first === undefined || last === undefined) return value
  return Math.max(first, Math.min(last, value))
}

function fleetTimelineHasNearbyEvent(timestamp: number, interval: FleetTimelineInterval, eventTimestamps: readonly number[]): boolean {
  const previous = offsetFleetTimelineTimestamp(timestamp, interval, -1)
  const next = offsetFleetTimelineTimestamp(timestamp, interval, 1)
  const start = timestamp - (timestamp - previous) / 2
  const end = timestamp + (next - timestamp) / 2
  return eventTimestamps.some(eventTimestamp => eventTimestamp >= start && eventTimestamp <= end)
}

type FleetActivityPendingPosition =
  | { readonly kind: 'jump'; readonly key: string; readonly behavior: ScrollBehavior }
  | { readonly kind: 'preserve'; readonly key: string; readonly top: number }

export function fleetActivityWindow(length: number, anchorIndex: number): FleetActivityWindow {
  if (length <= 0) return { start: 0, end: 0 }
  const anchor = Math.max(0, Math.min(length - 1, anchorIndex))
  const start = Math.max(0, Math.min(length - FLEET_ACTIVITY_WINDOW_MAX, anchor - Math.floor(FLEET_ACTIVITY_WINDOW_MAX / 2)))
  return { start, end: Math.min(length, start + FLEET_ACTIVITY_WINDOW_MAX) }
}

function shiftFleetActivityWindow(window: FleetActivityWindow, direction: 'previous' | 'next', length: number): FleetActivityWindow {
  if (direction === 'previous') {
    const start = Math.max(0, window.start - FLEET_ACTIVITY_WINDOW_PAGE)
    return { start, end: Math.min(length, start + FLEET_ACTIVITY_WINDOW_MAX) }
  }
  const end = Math.min(length, window.end + FLEET_ACTIVITY_WINDOW_PAGE)
  return { start: Math.max(0, end - FLEET_ACTIVITY_WINDOW_MAX), end }
}

function ActivityMain(owner: FleetPanelPaneOwner): ReactElement {
  const activity = owner.activeItem === 'all'
    ? owner.snapshot.activity
    : owner.snapshot.activity.filter(item => item.kind === owner.activeItem)
  const groups = fleetActivityGroups(activity, owner.activeItem === 'all')
  const groupKeys = groups.map(group => group.key).join('\u0000')
  const activityScrollRef = useRef<HTMLDivElement>(null)
  const activityNodes = useRef(new Map<string, HTMLElement>())
  const pendingPosition = useRef<FleetActivityPendingPosition | undefined>(groups.at(-1) === undefined
    ? undefined
    : { kind: 'jump', key: groups.at(-1)!.key, behavior: 'auto' })
  const previousLastTimestamp = useRef(fleetActivityGroupEnd(groups.at(-1)))
  const timelineDrivingActivity = useRef(false)
  const timelineReleaseFrame = useRef<number>()
  const timelineReleaseTimer = useRef<number>()
  const timelineDriverHoldUntil = useRef(0)
  const timelinePanFrame = useRef<number>()
  const timelinePanDelta = useRef(0)
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const [visibleWindow, setVisibleWindow] = useState<FleetActivityWindow>(() => fleetActivityWindow(groups.length, groups.length - 1))
  const [timelineScale, setTimelineScale] = useState(FLEET_TIMELINE_DEFAULT_SCALE)
  const [currentTime, setCurrentTime] = useState(() => fleetActivityGroupEnd(groups.at(-1)) ?? Date.now())
  const visibleGroups = groups.slice(visibleWindow.start, visibleWindow.end)
  const timelineStep = 10 ** timelineScale
  const timelineGridState = fleetTimelineGrid(timelineStep)
  const eventTimestamps = activity.flatMap(item => {
    const timestamp = activityTimestamp(item.createdAt)
    return timestamp === undefined ? [] : [timestamp]
  })
  const timelineKnobTravel = (timelineScale - FLEET_TIMELINE_MIN_SCALE)
    / (FLEET_TIMELINE_MAX_SCALE - FLEET_TIMELINE_MIN_SCALE) * 360
  const firstTimestamp = fleetActivityGroupStart(groups[0])
  const lastTimestamp = fleetActivityGroupEnd(groups.at(-1))

  useEffect(() => {
    if (groups.length === 0) {
      setVisibleWindow({ start: 0, end: 0 })
      return
    }
    const previousLast = previousLastTimestamp.current
    const latestTimestamp = fleetActivityGroupEnd(groups.at(-1))
    previousLastTimestamp.current = latestTimestamp
    if (previousLast !== undefined && currentTime !== previousLast) return
    const latestIndex = groups.length - 1
    const latest = groups[latestIndex]
    if (latest === undefined || latestTimestamp === undefined) return
    timelineDrivingActivity.current = true
    pendingPosition.current = { kind: 'jump', key: latest.key, behavior: 'auto' }
    setCurrentTime(latestTimestamp)
    setVisibleWindow(fleetActivityWindow(groups.length, latestIndex))
  }, [groupKeys])

  useEffect(() => {
    const visibleKeys = new Set(visibleGroups.map(group => group.key))
    setExpandedGroups(current => {
      const retained = new Set([...current].filter(key => visibleKeys.has(key)))
      return retained.size === current.size ? current : retained
    })
  }, [visibleWindow.start, visibleWindow.end])

  useLayoutEffect(() => {
    const scroller = activityScrollRef.current
    if (scroller === null) return
    const updatePadding = (): void => {
      scroller.style.setProperty('--dsh-fleet-activity-center-padding', `${Math.max(24, scroller.clientHeight / 2 - 24)}px`)
    }
    updatePadding()
    const observer = new ResizeObserver(updatePadding)
    observer.observe(scroller)
    return () => { observer.disconnect() }
  }, [])

  const releaseTimelineDriver = (): void => {
    if (timelineReleaseFrame.current !== undefined) window.cancelAnimationFrame(timelineReleaseFrame.current)
    if (timelineReleaseTimer.current !== undefined) window.clearTimeout(timelineReleaseTimer.current)
    const delay = timelineDriverHoldUntil.current - performance.now()
    if (delay > 0) {
      timelineReleaseTimer.current = window.setTimeout(() => {
        timelineReleaseTimer.current = undefined
        releaseTimelineDriver()
      }, delay)
      return
    }
    timelineReleaseFrame.current = window.requestAnimationFrame(() => {
      timelineReleaseFrame.current = window.requestAnimationFrame(() => {
        timelineDrivingActivity.current = false
        timelineReleaseFrame.current = undefined
      })
    })
  }

  useEffect(() => () => {
    if (timelineReleaseFrame.current !== undefined) window.cancelAnimationFrame(timelineReleaseFrame.current)
    if (timelineReleaseTimer.current !== undefined) window.clearTimeout(timelineReleaseTimer.current)
    if (timelinePanFrame.current !== undefined) window.cancelAnimationFrame(timelinePanFrame.current)
  }, [])

  useLayoutEffect(() => {
    const scroller = activityScrollRef.current
    const pending = pendingPosition.current
    if (scroller === null || pending === undefined) return
    pendingPosition.current = undefined
    const node = activityNodes.current.get(pending.key)
    if (node === undefined) return
    if (pending.kind === 'preserve') {
      scroller.scrollBy({ top: node.getBoundingClientRect().top - pending.top })
      return
    }
    const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      + node.getBoundingClientRect().height / 2 - scroller.clientHeight / 2
    scroller.scrollTo({ top, behavior: pending.behavior })
    if (timelineDrivingActivity.current) releaseTimelineDriver()
  }, [visibleWindow.start, visibleWindow.end])

  const setWindowAtEdge = (direction: 'previous' | 'next'): void => {
    const next = shiftFleetActivityWindow(visibleWindow, direction, groups.length)
    if (next.start === visibleWindow.start && next.end === visibleWindow.end) return
    const anchor = direction === 'previous' ? visibleGroups[0] : visibleGroups.at(-1)
    const node = anchor === undefined ? undefined : activityNodes.current.get(anchor.key)
    if (anchor !== undefined && node !== undefined) {
      pendingPosition.current = { kind: 'preserve', key: anchor.key, top: node.getBoundingClientRect().top }
    }
    setVisibleWindow(next)
  }

  const syncTimelineFromActivity = (): void => {
    const scroller = activityScrollRef.current
    if (scroller === null || visibleGroups.length === 0) return
    if (timelineDrivingActivity.current) return
    if (scroller.scrollTop <= 2) {
      setWindowAtEdge('previous')
    }
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
      setWindowAtEdge('next')
    }
    const anchor = scroller.getBoundingClientRect().top + scroller.clientHeight / 2
    let closest: FleetActivityGroup | undefined
    let closestDistance = Number.POSITIVE_INFINITY
    for (const group of visibleGroups) {
      const node = activityNodes.current.get(group.key)
      if (node === undefined) continue
      const rect = node.getBoundingClientRect()
      const distance = Math.abs(rect.top + rect.height / 2 - anchor)
      if (distance < closestDistance) {
        closestDistance = distance
        closest = group
      }
    }
    const timestamp = fleetActivityGroupCenter(closest)
    if (timestamp !== undefined) setCurrentTime(timestamp)
  }

  const centerActivityAtTime = (timestamp: number, behavior: ScrollBehavior = 'auto'): void => {
    const index = nearestFleetActivityGroupIndex(groups, timestamp)
    const group = groups[index]
    if (group === undefined) return
    const node = activityNodes.current.get(group.key)
    const scroller = activityScrollRef.current
    if (node !== undefined && scroller !== null) {
      const rect = node.getBoundingClientRect()
      const top = rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop
        + rect.height / 2 - scroller.clientHeight / 2
      scroller.scrollTo({ top, behavior })
      if (timelineDrivingActivity.current) releaseTimelineDriver()
      return
    }
    pendingPosition.current = { kind: 'jump', key: group.key, behavior }
    setVisibleWindow(fleetActivityWindow(groups.length, index))
  }

  useLayoutEffect(() => {
    if (timelineDrivingActivity.current) centerActivityAtTime(currentTime)
  }, [currentTime])

  const syncTimelineFromActivityClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!(event.target instanceof Element)) return
    const item = event.target.closest<HTMLElement>('[data-activity-key]')
    if (item === null || !event.currentTarget.contains(item)) return
    const group = groups.find(candidate => candidate.key === item.dataset.activityKey)
    const timestamp = fleetActivityGroupCenter(group)
    if (timestamp === undefined) return
    setCurrentTime(timestamp)
    centerActivityAtTime(timestamp, 'smooth')
  }

  const toggleGroup = (key: string): void => {
    setExpandedGroups(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const clampCurrentTime = (value: number): number => {
    return clampFleetTimelineTime(value, firstTimestamp, lastTimestamp)
  }

  const adjustTimelineScale = (delta: number): void => {
    setTimelineScale(current => Math.max(FLEET_TIMELINE_MIN_SCALE, Math.min(FLEET_TIMELINE_MAX_SCALE, current + delta)))
  }

  const zoomTimeline = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    adjustTimelineScale(event.deltaY * .0025)
  }

  const zoomTimelineByKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'PageUp' && event.key !== 'PageDown') return
    event.preventDefault()
    const coarse = event.key === 'PageUp' || event.key === 'PageDown'
    const direction = event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 1
    adjustTimelineScale(direction * (coarse ? .5 : .1))
  }

  const panTimeline = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    timelineDrivingActivity.current = true
    timelineDriverHoldUntil.current = performance.now() + FLEET_TIMELINE_WHEEL_IDLE_MS
    const delta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * FLEET_TIMELINE_SCROLL_DISTANCE
        : event.deltaY
    timelinePanDelta.current += delta
    if (timelinePanFrame.current === undefined) timelinePanFrame.current = window.requestAnimationFrame(() => {
      const panDelta = timelinePanDelta.current
      timelinePanDelta.current = 0
      timelinePanFrame.current = undefined
      setCurrentTime(current => clampCurrentTime(current + panDelta / FLEET_TIMELINE_SCROLL_DISTANCE * timelineStep))
    })
    releaseTimelineDriver()
  }

  const jumpToTimelineTime = (timestamp: number): void => {
    const target = clampCurrentTime(timestamp)
    timelineDrivingActivity.current = true
    timelineDriverHoldUntil.current = performance.now() + FLEET_TIMELINE_JUMP_IDLE_MS
    if (target === currentTime) centerActivityAtTime(target, 'smooth')
    else setCurrentTime(target)
  }

  const letActivityDriveTimeline = (): void => {
    timelineDriverHoldUntil.current = 0
    timelineDrivingActivity.current = false
    if (timelineReleaseTimer.current !== undefined) {
      window.clearTimeout(timelineReleaseTimer.current)
      timelineReleaseTimer.current = undefined
    }
  }

  const timelineTicks = fleetTimelineTicks(currentTime, timelineStep)

  return jsx(DetailShell, {
    title: panelText('团队动态', 'Team activity'),
    meta: panelText(`${activity.length} 条记录`, `${activity.length} records`),
    owner,
    bodyClassName: 'dsh-fleet-panel-activity-layout',
    children: [
      jsx('div', {
        ref: activityScrollRef,
        className: 'dsh-fleet-panel-activity-scroll',
        onScroll: syncTimelineFromActivity,
        onWheelCapture: letActivityDriveTimeline,
        onClickCapture: syncTimelineFromActivityClick,
        children: jsx('div', {
          className: 'dsh-fleet-panel-activity-list',
          'data-window-start': visibleWindow.start,
          'data-window-end': visibleWindow.end,
          'data-window-total': groups.length,
          children: activity.length === 0
            ? jsx('div', { className: 'dsh-fleet-panel-empty', children: panelText('当前筛选下没有动态', 'No activity matches this filter') })
            : visibleGroups.map(group => {
                const captureNode = (node: HTMLElement | null): void => {
                  if (node === null) activityNodes.current.delete(group.key)
                  else activityNodes.current.set(group.key, node)
                }
                if (group.items.length === 1) return jsx(ActivityRow, {
                  item: group.items[0],
                  activityKey: group.key,
                  containerRef: captureNode,
                }, group.key)
                const expanded = expandedGroups.has(group.key)
                return jsxs('div', {
                  className: 'dsh-fleet-panel-activity-group',
                  'data-activity-key': group.key,
                  children: [
                    jsxs('button', {
                      ref: captureNode,
                      type: 'button',
                      className: 'dsh-fleet-panel-activity-group-toggle',
                      'aria-expanded': expanded,
                      onClick: () => { toggleGroup(group.key) },
                      children: [
                        jsx('span', { className: 'dsh-fleet-panel-activity-dot', 'data-kind': group.items[0]!.kind }),
                        jsxs('span', {
                          className: 'dsh-fleet-panel-activity-group-copy',
                          children: [
                            jsx('span', { className: 'dsh-fleet-panel-activity-group-label', children: activityTypeLabel(group.items[0]!) }),
                            jsx('span', {
                              className: 'dsh-fleet-panel-activity-group-count',
                              children: panelText(`${group.items.length} 条`, `${group.items.length} events`),
                            }),
                          ],
                        }),
                        jsx('span', { className: 'dsh-fleet-panel-activity-time', children: activityTimeRange(group.items) }),
                        jsx('span', {
                          className: 'dsh-fleet-panel-activity-group-chevron',
                          'aria-hidden': 'true',
                          children: jsx(PanelIcon, { name: 'chevron', size: 12 }),
                        }),
                      ],
                    }),
                    expanded && jsx('div', {
                      className: 'dsh-fleet-panel-activity-group-items',
                      children: group.items.map(item => jsx(ActivityRow, { item }, item.id)),
                    }),
                  ],
                }, group.key)
              }),
        }),
      }),
      activity.length > 0 && jsxs('aside', {
        className: 'dsh-fleet-panel-activity-timeline',
        'aria-label': panelText('动态时间轴', 'Activity timeline'),
        children: [
          jsx('div', {
            className: 'dsh-fleet-panel-activity-timeline-wheel',
            style: { backgroundPosition: `${timelineKnobTravel}px 0` },
            role: 'slider',
            tabIndex: 0,
            'aria-label': panelText('调整时间尺度', 'Adjust time scale'),
            'aria-valuemin': 1_000,
            'aria-valuemax': Math.round(10 ** FLEET_TIMELINE_MAX_SCALE),
            'aria-valuenow': Math.round(timelineStep),
            'aria-valuetext': fleetTimelineScaleLabel(timelineGridState.dominantMajor),
            onWheel: zoomTimeline,
            onKeyDown: zoomTimelineByKeyboard,
          }),
          jsx('div', {
            className: 'dsh-fleet-panel-activity-timeline-ruler',
            onWheel: panTimeline,
            children: [
              ...timelineTicks.map(({ timestamp, position, strength, opacity }) => {
                const label = fleetTimelineTickLabel(timestamp, timelineGridState.dominantMajor.approximateMs)
                const hasNearbyEvent = fleetTimelineHasNearbyEvent(timestamp, timelineGridState.dominantMinor, eventTimestamps)
                return jsxs('button', {
                  type: 'button',
                  className: 'dsh-fleet-panel-activity-timeline-marker',
                  style: {
                    '--dsh-fleet-timeline-position': `${position}px`,
                    '--dsh-fleet-timeline-strength': strength,
                    '--dsh-fleet-timeline-opacity': opacity,
                  } as CSSProperties,
                  'data-has-event': hasNearbyEvent ? 'true' : undefined,
                  'aria-label': panelText(`跳转到 ${fleetTimelineFullLabel(timestamp)}`, `Jump to ${fleetTimelineFullLabel(timestamp)}`),
                  title: fleetTimelineFullLabel(timestamp),
                  onClick: () => { jumpToTimelineTime(timestamp) },
                  children: [
                    jsx('time', {
                      className: 'dsh-fleet-panel-activity-timeline-label',
                      dateTime: new Date(timestamp).toISOString(),
                      children: label,
                    }),
                    jsx('span', { className: 'dsh-fleet-panel-activity-timeline-tick', 'aria-hidden': 'true' }),
                  ],
                }, `${timestamp}`)
              }),
              jsxs('button', {
                type: 'button',
                className: 'dsh-fleet-panel-activity-timeline-marker dsh-fleet-panel-activity-timeline-cursor',
                'aria-current': 'true',
                'aria-label': panelText(`跳转到 ${fleetTimelineFullLabel(currentTime)}`, `Jump to ${fleetTimelineFullLabel(currentTime)}`),
                title: fleetTimelineFullLabel(currentTime),
                onClick: () => { jumpToTimelineTime(currentTime) },
                children: [
                  jsx('time', {
                    className: 'dsh-fleet-panel-activity-timeline-label',
                    dateTime: new Date(currentTime).toISOString(),
                    children: fleetTimelineTickLabel(currentTime, timelineGridState.dominantMajor.approximateMs),
                  }),
                  jsx('span', { className: 'dsh-fleet-panel-activity-timeline-tick', 'aria-hidden': 'true' }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

interface FleetActivityGroup {
  readonly key: string
  readonly type: string
  readonly items: readonly [FleetPanelActivity, ...FleetPanelActivity[]]
}

export function groupFleetActivity(activity: readonly FleetPanelActivity[]): readonly FleetActivityGroup[] {
  const groups: { key: string; type: string; items: [FleetPanelActivity, ...FleetPanelActivity[]] }[] = []
  for (const item of activity) {
    const type = item.type ?? `kind:${item.kind}`
    const current = groups.at(-1)
    if (current?.type === type) current.items.push(item)
    else groups.push({ key: `${type}:${item.id}`, type, items: [item] })
  }
  return groups
}

export function fleetActivityGroups(activity: readonly FleetPanelActivity[], collapse: boolean): readonly FleetActivityGroup[] {
  if (collapse) return groupFleetActivity(activity)
  return activity.map(item => ({
    key: `item:${item.id}`,
    type: item.type ?? `kind:${item.kind}`,
    items: [item],
  }))
}

function activityTimestamp(createdAt: string | undefined): number | undefined {
  if (createdAt === undefined) return undefined
  const timestamp = Date.parse(createdAt)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function fleetActivityGroupStart(group: FleetActivityGroup | undefined): number | undefined {
  return activityTimestamp(group?.items[0]?.createdAt)
}

function fleetActivityGroupEnd(group: FleetActivityGroup | undefined): number | undefined {
  return activityTimestamp(group?.items.at(-1)?.createdAt)
}

function fleetActivityGroupCenter(group: FleetActivityGroup | undefined): number | undefined {
  const start = fleetActivityGroupStart(group)
  const end = fleetActivityGroupEnd(group)
  if (start === undefined || end === undefined) return start ?? end
  return start + (end - start) / 2
}

export function nearestFleetActivityGroupIndex(groups: readonly FleetActivityGroup[], timestamp: number): number {
  if (groups.length === 0) return -1
  let low = 0
  let high = groups.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const middleEnd = fleetActivityGroupEnd(groups[middle]) ?? Number.NEGATIVE_INFINITY
    if (middleEnd < timestamp) low = middle + 1
    else high = middle
  }
  const start = fleetActivityGroupStart(groups[low]) ?? Number.POSITIVE_INFINITY
  const end = fleetActivityGroupEnd(groups[low]) ?? Number.NEGATIVE_INFINITY
  if (timestamp >= start && timestamp <= end) return low
  if (low === 0 || timestamp > end) return low
  const previousEnd = fleetActivityGroupEnd(groups[low - 1]) ?? Number.NEGATIVE_INFINITY
  return timestamp - previousEnd <= start - timestamp ? low - 1 : low
}

function fleetTimelineScaleLabel(interval: FleetTimelineInterval): string {
  const units: Record<FleetTimelineIntervalUnit, readonly [string, string, string]> = {
    second: ['秒', 'second', 'seconds'],
    minute: ['分钟', 'minute', 'minutes'],
    hour: ['小时', 'hour', 'hours'],
    day: ['天', 'day', 'days'],
    week: ['周', 'week', 'weeks'],
    month: ['个月', 'month', 'months'],
    year: ['年', 'year', 'years'],
  }
  const unit = units[interval.unit]
  return panelText(
    `主刻度 ${interval.amount} ${unit[0]}`,
    `Major ticks every ${interval.amount} ${interval.amount === 1 ? unit[1] : unit[2]}`,
  )
}

function fleetTimelineTickLabel(timestamp: number, step: number): string {
  const minute = 60_000
  const day = 24 * 60 * minute
  const year = 365.25 * day
  const date = new Date(timestamp)
  if (step < minute) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  if (step < day) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (step < 45 * day) return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
  if (step < year) return date.toLocaleDateString([], { year: 'numeric', month: 'numeric' })
  return date.toLocaleDateString([], { year: 'numeric' })
}

function fleetTimelineFullLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function activityTypeLabel(item: FleetPanelActivity): string {
  const type = item.type ?? ''
  if (type === 'coordination.message') return panelText('会话消息', 'Conversation messages')
  if (type === 'memory.stored') return panelText('记忆写入', 'Memory stored')
  if (type === 'memory.recalled') return panelText('记忆召回', 'Memory recalled')
  if (type === 'resource.resource_added') return panelText('添加共享资源', 'Resources added')
  if (type === 'resource.resource_removed') return panelText('删除共享资源', 'Resources removed')
  if (type === 'resource.resource_revised') return panelText('更新共享资源', 'Resources updated')
  if (type.startsWith('resource.document_')) return panelText('团队文档更新', 'Team document updates')
  if (type.startsWith('workspace.')) return panelText('工作区变更', 'Workspace changes')
  if (type.startsWith('task.')) return panelText('任务变更', 'Task changes')
  if (type.startsWith('schedule.')) return panelText('计划变更', 'Schedule changes')
  if (type.startsWith('calendar.')) return panelText('日程变更', 'Calendar changes')
  if (type === 'coordination.vote') return panelText('投票更新', 'Vote updates')
  if (type.startsWith('member_status.')) return panelText('成员自述', 'Member status updates')
  if (type.startsWith('member_') || type.startsWith('assistant_')) return panelText('成员状态', 'Member activity')
  if (type.startsWith('work_') || type === 'team_status') return panelText('团队状态', 'Team status')
  return ({
    message: panelText('消息动态', 'Message activity'),
    resource: panelText('资源动态', 'Resource activity'),
    decision: panelText('决策动态', 'Decision activity'),
    member: panelText('成员动态', 'Member activity'),
    memory: panelText('记忆动态', 'Memory activity'),
  } as const)[item.kind]
}

function activityTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function activityTimeRange(items: readonly FleetPanelActivity[]): string {
  const first = items[0]
  const last = items.at(-1)
  if (first === undefined || last === undefined) return ''
  const start = activityTime(first.createdAt)
  const end = activityTime(last.createdAt)
  return start === end ? start : `${start}–${end}`
}

function ActivityRow({ item, activityKey, containerRef }: {
  readonly item: FleetPanelActivity
  readonly activityKey?: string
  readonly containerRef?: (node: HTMLDivElement | null) => void
}): ReactElement {
  return jsxs('div', {
    ref: containerRef,
    className: 'dsh-fleet-panel-activity-row',
    'data-kind': item.kind,
    'data-activity-key': activityKey,
    children: [
      jsx('span', { className: 'dsh-fleet-panel-activity-dot', 'data-kind': item.kind }),
      jsxs('span', {
        className: 'dsh-fleet-panel-activity-copy',
        children: [
          item.type === 'memory.stored' && jsx('span', {
            className: 'dsh-fleet-panel-activity-memory-operation',
            children: panelText('记忆写入', 'Memory stored'),
          }),
          item.type === 'memory.recalled' && jsx('span', {
            className: 'dsh-fleet-panel-activity-memory-operation',
            children: panelText('记忆召回', 'Memory recalled'),
          }),
          jsx('span', { children: item.text }),
        ],
      }),
      jsx('time', {
        className: 'dsh-fleet-panel-activity-time',
        dateTime: item.createdAt,
        children: activityTime(item.createdAt),
      }),
    ],
  })
}

function PanelUnavailable({ label }: { readonly label: string }): ReactElement {
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

function useFleetPanelModelDirectory(sessionId: string | undefined): readonly [FleetModelDirectory | undefined, FleetModelDirectoryState] {
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
