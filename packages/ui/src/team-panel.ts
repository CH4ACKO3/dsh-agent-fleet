import type { ChangeEvent, ComponentType, CSSProperties, FocusEvent, KeyboardEvent, PointerEvent, ReactElement, ReactNode } from 'react'
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  FLEET_WEB_PEER_LOCAL,
  FLEET_WEB_REMOTE,
  type FleetWebClient,
} from '@dsh-agent-fleet/core/web'
import {
  FleetChatAvatar,
  FleetChatMessage,
  FleetConversationHeader,
  FleetPresenceLabel,
  type FleetChatContentBlock,
  type FleetChatMember,
  type FleetChatMentionBlock,
  type FleetChatResourceBlock,
} from './runtime-chat.js'
import {
  configureFleetActivationSessions,
  type FleetActivationClientSessions,
} from './activation.js'
import {
  configureFleetMetaAssistantClient,
  type FleetMetaClientSessions,
  type FleetMetaClientWorkspaces,
} from './meta-assistant.js'
import { createFleetWebPanelSource } from './fleet-web-source.js'
import { configureFleetWebClient } from './web-client.js'
import { fleetConfigurationModules } from './configuration-modules.js'

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

.dsh-fleet-panel-member-popover-self-status-label {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
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

.dsh-fleet-panel-member-popover-detail {
  width: 100%;
  min-height: 34px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: var(--dsw-alias-bg-layer-2);
  border: 0;
  border-radius: 8px;
  margin-top: 13px;
  padding: 0 12px;
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-member-popover-detail:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid);
}

.dsh-fleet-panel-member-popover-detail:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
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
.dsh-fleet-panel-list-row:focus-visible,
.dsh-fleet-panel-send:focus-visible {
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
  color: var(--dsw-alias-label-secondary);
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
  font: inherit;
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
  width: min(480px, calc(100vw - 32px));
  min-height: 280px;
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
  width: 7px;
  height: 7px;
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
  font-size: 10px;
  line-height: 14px;
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

.dsh-fleet-panel-composer {
  box-sizing: border-box;
  width: min(100%, 780px);
  margin: 0 auto;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  padding: 9px 10px 8px;
  box-shadow: var(--dsw-shadow-lv1);
  position: relative;
}

.dsh-fleet-panel-mention-menu {
  box-sizing: border-box;
  width: min(360px, 100%);
  max-height: 264px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgb(24 39 57 / 16%), 0 2px 8px rgb(24 39 57 / 7%);
  margin: 0;
  padding: 6px;
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 5;
  overflow-y: auto;
}

.dsh-fleet-panel-mention-option {
  appearance: none;
  width: 100%;
  min-height: 44px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
  align-items: center;
  gap: 9px;
  padding: 5px 8px;
  text-align: left;
  display: flex;
}

.dsh-fleet-panel-mention-option:hover,
.dsh-fleet-panel-mention-option[aria-selected="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-mention-option:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}

.dsh-fleet-panel-mention-option-copy {
  min-width: 0;
  flex: 1;
}

.dsh-fleet-panel-mention-option-name,
.dsh-fleet-panel-mention-option-role {
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-panel-mention-option-name {
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-mention-option-role,
.dsh-fleet-panel-mention-empty {
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-mention-empty {
  min-height: 44px;
  place-items: center;
  padding: 0 10px;
  display: grid;
}

.dsh-fleet-panel-composer:focus-within {
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 55%, transparent);
}

.dsh-fleet-panel-composer-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 42px;
  max-height: 144px;
  color: var(--dsw-alias-label-primary);
  caret-color: var(--dsw-alias-state-business-primary);
  resize: none;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 1px 3px;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}

.dsh-fleet-panel-composer-input::placeholder {
  color: var(--dsw-alias-label-secondary);
}

.dsh-fleet-panel-composer-foot {
  min-height: 28px;
  align-items: center;
  gap: 7px;
  display: flex;
}

.dsh-fleet-panel-composer-actions {
  min-width: 0;
  align-items: center;
  gap: 4px;
  flex: 1;
  display: flex;
}

.dsh-fleet-panel-urgent-toggle {
  min-height: 26px;
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

.dsh-fleet-panel-send {
  width: 28px;
  height: 28px;
  color: white;
  cursor: pointer;
  background: var(--dsw-alias-state-business-primary);
  border: 0;
  border-radius: 8px;
  flex: none;
  place-items: center;
  padding: 0;
  display: grid;
}

.dsh-fleet-panel-send:disabled {
  color: var(--dsw-alias-label-caption);
  cursor: default;
  background: var(--dsw-alias-interactive-bg-hover);
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
  width: min(100%, 680px);
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
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, var(--dsw-alias-bg-layer-1));
  border-radius: 11px;
  grid-column: 1;
  grid-row: 1;
  padding: 8px 10px;
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

.dsh-fleet-panel-resource-body {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 22px;
}

.dsh-fleet-panel-resource-preview {
  width: min(100%, 74ch);
  margin: 0 auto;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 1.65;
}

.dsh-fleet-panel-resource-content {
  width: min(100%, var(--dsh-fleet-panel-chat-column-width, 760px));
  min-height: 100%;
  margin: 0 auto;
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

.dsh-fleet-panel-resource-meta {
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  align-items: center;
  gap: 6px;
  flex: 1;
  font-size: 11px;
  display: flex;
  overflow: hidden;
}

.dsh-fleet-panel-resource-meta > span:not(:last-child)::after {
  content: "·";
  margin-inline-start: 6px;
  color: var(--dsw-alias-label-caption);
}

.dsh-fleet-panel-resource-path-wrap {
  min-width: 0;
  display: flex;
}

.dsh-fleet-panel-resource-path {
  min-width: 0;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 5px;
  padding: 2px 3px;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
  text-underline-offset: 3px;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: inherit;
  overflow: hidden;
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
  background: var(--dsw-alias-interactive-bg-hover);
  border-radius: 8px;
  padding: 2px;
  display: flex;
}

.dsh-fleet-panel-resource-actions,
.dsh-fleet-panel-resource-file-actions {
  align-items: center;
  gap: 5px;
  display: flex;
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

.dsh-fleet-panel-resource-view-switch button {
  min-height: 26px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0 9px;
  white-space: nowrap;
  font-size: 11px;
}

.dsh-fleet-panel-resource-view-switch button:hover {
  color: var(--dsw-alias-label-primary);
}

.dsh-fleet-panel-resource-view-switch button[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 1px 3px color-mix(in srgb, #24394d 13%, transparent);
}

.dsh-fleet-panel-resource-view-switch button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-resource-preview[data-mode="compare"] {
  width: 100%;
  max-width: none;
}

.dsh-fleet-panel-resource-compare {
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  display: grid;
}

.dsh-fleet-panel-resource-compare > section {
  min-width: 0;
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 12px;
  overflow: hidden;
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

.dsh-fleet-panel-resource-compare-body .dsh-fleet-panel-resource-preview-plain {
  min-width: max-content;
}

.dsh-fleet-panel-resource-history {
  min-width: 0;
  min-height: 360px;
  grid-template-columns: minmax(0, 1fr) 248px;
  gap: 22px;
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
  border-inline-start: 1px solid var(--dsw-alias-border-l3);
  padding-inline-start: 18px;
}

.dsh-fleet-panel-resource-timeline-title {
  margin: 0;
  font-size: 13px;
  font-weight: 620;
}

.dsh-fleet-panel-resource-timeline-head {
  color: var(--dsw-alias-label-secondary);
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 10px;
  display: flex;
}

.dsh-fleet-panel-resource-timeline-list {
  position: relative;
  flex-direction: column;
  display: flex;
}

.dsh-fleet-panel-resource-timeline-list::before {
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 6px;
  width: 1px;
  content: "";
  background: var(--dsw-alias-border-l2);
}

.dsh-fleet-panel-resource-revision {
  position: relative;
  min-height: 58px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
  align-items: flex-start;
  gap: 10px;
  padding: 7px 8px 7px 0;
  text-align: start;
  display: flex;
}

.dsh-fleet-panel-resource-revision:hover,
.dsh-fleet-panel-resource-revision[aria-pressed="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-resource-revision:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-resource-revision-dot {
  position: relative;
  z-index: 1;
  width: 13px;
  height: 13px;
  background: var(--dsw-alias-bg-layer-1);
  border: 2px solid var(--dsw-alias-label-caption);
  border-radius: 50%;
  flex: none;
  margin-top: 3px;
}

.dsh-fleet-panel-resource-revision[aria-pressed="true"] .dsh-fleet-panel-resource-revision-dot {
  background: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-resource-revision-copy {
  min-width: 0;
  flex-direction: column;
  display: flex;
}

.dsh-fleet-panel-resource-revision-copy strong {
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
}

.dsh-fleet-panel-resource-revision-copy span,
.dsh-fleet-panel-resource-revision-copy time {
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
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
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 13px;
  tab-size: 2;
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

.dsh-fleet-panel-activity-copy {
  font-size: 13px;
  line-height: 19px;
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
    grid-template-columns: minmax(0, 1fr) 210px;
    gap: 16px;
  }

  .dsh-fleet-panel-resource-timeline {
    padding-inline-start: 14px;
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

  .dsh-fleet-panel-send {
    width: 44px;
    height: 44px;
    background-clip: content-box;
    padding: 8px;
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
    min-height: 116px;
    align-content: center;
    flex-wrap: wrap;
    padding-block: 8px;
  }

  .dsh-fleet-panel-detail-head:has(.dsh-fleet-panel-resource-meta) .dsh-fleet-panel-detail-title {
    max-width: 100%;
    flex-basis: 100%;
  }

  .dsh-fleet-panel-detail-head:has(.dsh-fleet-panel-resource-meta) .dsh-fleet-panel-main-actions {
    width: 100%;
    justify-content: space-between;
    order: 2;
  }

  .dsh-fleet-panel-resource-meta {
    flex-basis: 100%;
    order: 3;
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

  .dsh-fleet-panel-resource-compare {
    grid-template-columns: minmax(0, 1fr);
  }

  .dsh-fleet-panel-resource-scroll .dsh-fleet-panel-chat-log {
    padding: 18px 14px;
  }

  .dsh-fleet-panel-resource-history {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "timeline" "diff";
  }

  .dsh-fleet-panel-resource-timeline {
    border-inline-start: 0;
    border-bottom: 1px solid var(--dsw-alias-border-l3);
    padding: 0 0 12px;
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

export interface FleetPanelMember extends FleetChatMember {
  readonly responsibility: string
  /** Short, self-declared description of the work this member is currently doing. */
  readonly statusText?: string
  readonly provider?: string
  readonly model?: string
  /** The native DSH Session owned by this persistent Fleet member. */
  readonly sessionId?: string
  /** Conversations visible from this member's runtime perspective. Omit to expose the Team snapshot. */
  readonly visibleConversationIds?: readonly string[]
  readonly runtimeStatus?: 'idle' | 'running' | 'waiting' | 'error' | 'offline' | 'paused' | 'unknown'
}

export interface FleetPanelMessage {
  readonly id: string
  readonly conversationId: string
  readonly senderId: string
  readonly senderTeamId?: string
  readonly sender?: FleetChatMember
  readonly sentAt: string
  readonly content: readonly FleetChatContentBlock[]
  readonly receipt?: {
    readonly visibleMemberIds: readonly string[]
    readonly readMemberIds: readonly string[]
    readonly unreadMemberIds: readonly string[]
  }
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
  readonly kind: 'message' | 'resource' | 'decision' | 'member'
  readonly text: string
  readonly createdAt: string
}

export interface FleetPanelTeamSnapshot {
  readonly teamId: string
  readonly teamName: string
  readonly color?: string
  readonly unread?: number
  readonly status: 'starting' | 'idle' | 'running' | 'paused' | 'finishing' | 'closed' | 'failed' | 'disconnected'
  readonly runtimeState?: 'active' | 'dormant'
  readonly conversations: readonly FleetPanelConversation[]
  readonly members: readonly FleetPanelMember[]
  readonly messages: readonly FleetPanelMessage[]
  readonly resources: readonly FleetPanelResource[]
  readonly workspaces?: readonly FleetPanelWorkspace[]
  readonly activity: readonly FleetPanelActivity[]
}

export interface FleetPanelTeamSummary {
  readonly teamId: string
  readonly teamName: string
  readonly color?: string
  readonly unread?: number
  readonly needsAttention?: boolean
  readonly primaryWorkspace?: string
  readonly status: FleetPanelTeamSnapshot['status']
  readonly runtimeState?: 'active' | 'dormant'
}

export interface FleetPanelTeamRunControl {
  readonly action: 'pause' | 'resume'
  readonly label: '暂停运行' | '继续运行'
  readonly busyLabel: '正在暂停…' | '正在继续…'
  readonly title: string
}

export function fleetPanelTeamRunControl(
  team: Pick<FleetPanelTeamSummary, 'status' | 'runtimeState'>,
): FleetPanelTeamRunControl | undefined {
  const canRecoverDormant = team.runtimeState === 'dormant'
    && (team.status === 'starting'
      || team.status === 'idle'
      || team.status === 'running'
      || team.status === 'paused'
      || team.status === 'finishing')
  if (team.status === 'paused' || canRecoverDormant) {
    return {
      action: 'resume',
      label: '继续运行',
      busyLabel: '正在继续…',
      title: '恢复团队暂停前仍在运行的成员',
    }
  }
  if (team.runtimeState !== 'dormant' && (team.status === 'idle' || team.status === 'running')) {
    return {
      action: 'pause',
      label: '暂停运行',
      busyLabel: '正在暂停…',
      title: '暂停全体成员并保存当前状态',
    }
  }
  return undefined
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
  readonly createdAt: string
  readonly type: string
  readonly data: string
}

export interface FleetPanelMemberTrace {
  readonly events: readonly FleetPanelMemberTraceEvent[]
  readonly truncated: boolean
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

export interface FleetPanelTeamControlInput {
  readonly sessionId: string
  readonly teamId: string
  readonly action: 'pause' | 'resume' | 'close'
  readonly summary?: string
}

export interface FleetPanelMemberControlInput {
  readonly sessionId: string
  readonly teamId: string
  readonly memberId: string
  readonly action: 'pause' | 'resume'
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
  uploadResource?(input: FleetPanelUploadInput): Promise<void>
  controlTeam?(input: FleetPanelTeamControlInput): Promise<void>
  controlMember?(input: FleetPanelMemberControlInput): Promise<void>
  exportTeam?(teamId: string, signal?: AbortSignal): Promise<Record<string, unknown>>
  exportArchive?(input: FleetPanelArchiveExportInput, signal?: AbortSignal): Promise<FleetPanelArchiveFile>
  importArchive?(input: FleetPanelArchiveImportInput, signal?: AbortSignal): Promise<void>
  retry?(): Promise<void>
  loadMemberTrace?(teamId: string, memberId: string, signal?: AbortSignal): Promise<FleetPanelMemberTrace>
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

type PanelIconName = 'chat' | 'team' | 'agent' | 'resources' | 'activity' | 'search' | 'send' | 'channel' | 'menu' | 'settings' | 'chevron' | 'close' | 'copy' | 'download' | 'upload'

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
  return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'M7.2 3.5 5.4 16.5m7.4-13-1.8 13M3.5 7.4h13M2.8 12.6h13' }),
  })
}

const operator: FleetPanelMember = {
  id: 'operator', name: 'You', role: '外部观察者', responsibility: '观察并向团队提供协作输入',
  color: '#737985', presence: 'active', operator: true,
}
const emptyDirectory: FleetPanelTeamDirectory = {
  teams: [],
  groups: [
    { id: 'ungrouped', name: '未分组', kind: 'ungrouped', teamIds: [] },
    { id: 'archived', name: '已归档', kind: 'archived', teamIds: [] },
  ],
}
const emptySnapshot: FleetPanelSnapshot = {
  directory: emptyDirectory,
  connection: { status: 'disconnected', error: 'Fleet 数据源不可用' },
}

let teamDirectorySource: FleetPanelSource | undefined

/** Current Team directory shared with root-level Fleet entry surfaces. */
export function getFleetTeamDirectorySnapshot(): FleetPanelTeamDirectory {
  return teamDirectorySource?.getSnapshot().directory ?? emptyDirectory
}

export function subscribeFleetTeamDirectory(listener: () => void): () => void {
  return teamDirectorySource?.subscribe(listener) ?? EMPTY_UNSUBSCRIBE
}

const EMPTY_UNSUBSCRIBE = (): void => {}
const SIDEBAR_DEFAULT_WIDTH = 232
const SIDEBAR_MIN_WIDTH = 196
const SIDEBAR_MAX_WIDTH = 360
const CHAT_COLUMN_DEFAULT_WIDTH = 760
const CHAT_COLUMN_MIN_WIDTH = 360
const CHAT_COLUMN_MAX_WIDTH = 1600
const MAIN_MIN_WIDTH = 360
const PANEL_PREFERENCES_KEY = 'dsh-agent-fleet.panel-preferences.v1'

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

export interface FleetPanelToolOwner {
  readonly activeTool: string
  readonly disabled?: boolean
  readonly selectTool: (tool: string) => void
}

export interface FleetPanelPaneOwner {
  readonly sessionId: string
  readonly fleet: FleetPanelSnapshot
  readonly snapshot: FleetPanelTeamSnapshot
  readonly activeItem: string
  readonly selectItem: (item: string) => void
  readonly showMemberDetails: (memberId: string) => void
  readonly openResource: (resourceId: string) => void
  readonly uploadResource?: (file: File) => Promise<void>
  readonly controlTeam?: (action: FleetPanelTeamControlInput['action'], summary?: string) => Promise<void>
  readonly controlMember?: (memberId: string, action: FleetPanelMemberControlInput['action']) => Promise<void>
  readonly exportTeam?: FleetPanelSource['exportTeam']
  readonly exportArchive?: (teamId: string, includeWorkspace: boolean) => Promise<FleetPanelArchiveFile>
  readonly importArchive?: (file: File, projectRoot: string, mode: 'copy' | 'restore') => Promise<void>
  readonly draft: string
  readonly urgent: boolean
  readonly sending: boolean
  readonly sendError: string | null
  readonly setDraft: (draft: string) => void
  readonly setUrgent: (urgent: boolean) => void
  readonly sendMessage: () => void
  readonly loadMemberTrace?: FleetPanelSource['loadMemberTrace']
  readonly loadResource?: FleetPanelSource['loadResource']
  readonly openNavigation: () => void
  readonly showTeamDirectory: () => void
  readonly selectTeam: (teamId: string) => void
  readonly renderPanelSlot: FleetPanelRenderSlot
  readonly useSessions: FleetSnapshotSelectorHook
  readonly nativeContext: FleetNativeContext
  readonly t: (key: string, values?: Readonly<Record<string, unknown>>) => string
  readonly SessionProvider: ComponentType<FleetTargetSessionProviderProps>
}

export interface FleetPanelHomeOwner {
  readonly sessionId: string
  readonly fleet: FleetPanelSnapshot
  readonly focusedTeamId?: string
  readonly selectTeam: (teamId: string) => void
  readonly openTeamMessages: (teamId: string) => void
  readonly controlTeamById?: (teamId: string, action: FleetPanelTeamControlInput['action'], summary?: string) => Promise<void>
  readonly exportTeam?: FleetPanelSource['exportTeam']
  readonly exportArchive?: (teamId: string, includeWorkspace: boolean) => Promise<FleetPanelArchiveFile>
  readonly importArchive?: (file: File, projectRoot: string, mode: 'copy' | 'restore') => Promise<void>
  readonly openNavigation: () => void
  readonly renderPanelSlot: FleetPanelRenderSlot
  readonly useSessions: FleetSnapshotSelectorHook
  readonly nativeContext: FleetNativeContext
  readonly t: (key: string, values?: Readonly<Record<string, unknown>>) => string
  readonly SessionProvider: ComponentType<FleetTargetSessionProviderProps>
}

export interface FleetPanelSidebarSectionOwner {
  readonly panel: FleetPanelHomeOwner | FleetPanelPaneOwner
  readonly tool: 'home' | FleetPanelToolId
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
  open?(): Promise<void>
  resync?(): Promise<void>
  loadOlder(): Promise<void>
}

interface FleetNativeContext {
  session(sessionId: string): FleetNativeSessionFace | undefined
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

/** Harmony decorator: retain the native component and its already-authorized child-slot runtime. */
export function withFleetNativeChatView<T extends ComponentType<any>>(ChatView: T): T {
  NativeChatView = ChatView
  function FleetNativeChatRuntimeCapture(props: Readonly<Record<string, any>>): ReactElement {
    const initialized = nativeChatRuntime !== undefined
    nativeChatRuntime = props
    if (!initialized) queueMicrotask(publishNativeChatRuntime)
    return jsx(ChatView, props)
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
  return peerId === undefined ? undefined : team.members.find(candidate => candidate.id === peerId)
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
  const member = team.members.find(candidate => candidate.id === requestedMemberId) ?? team.members[0]
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
  if (tool === 'team') return team.members[0]?.id ?? ''
  if (tool === 'agent') {
    const member = team.members[0]
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
  if (tool === 'team') return team.members.some(item => item.id === requested)
    ? requested
    : initialItem(team, tool)
  if (tool === 'resources') return team.resources.some(item => item.id === requested)
      || team.workspaces?.some(item => item.id === requested) === true
    ? requested
    : initialItem(team, tool)
  if (tool === 'activity') return ['all', 'message', 'resource', 'decision'].includes(requested)
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

export function FleetTeamPanel({
  sessionId,
  source,
  renderSlot,
  useSessions,
  nativeContext,
  SessionProvider,
  t,
}: FleetTeamPanelProps): ReactElement {
  const snapshot = usePanelSnapshot(source)
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
  const [navigationOpen, setNavigationOpen] = useState(false)
  const effectiveSnapshot = snapshot
  const activeTeam = effectiveSnapshot.team
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
    setActiveTool(tool)
    setNavigationOpen(true)
  }
  const selectItem = (item: string): void => {
    if (activeTeam === undefined) return
    setItems(current => ({ ...current, [`${activeTeam.teamId}:${activeTool}`]: item }))
    setNavigationOpen(false)
  }
  const selectTeam = (teamId: string): void => {
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
    source?.selectTeam(teamId)
  }
  const showTeamDirectory = (): void => {
    setHomeTeamId(null)
    setActiveTool('home')
    setNavigationOpen(true)
  }
  const sendMessage = (): void => {
    const text = composeState.draft.trim()
    if (activeTeam === undefined || activeTool !== 'chat' || activeItem === '' || composeKey === ''
      || text === '' || composeState.sending) return
    const teamId = activeTeam.teamId
    const conversationId = activeItem
    const conversation = activeTeam.conversations.find(candidate => candidate.id === conversationId)
    const mentions = conversation?.kind === 'channel'
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
      updateCompose(current => ({ ...current, error: 'Fleet 数据源不可用' }))
      return
    }
    if (composeState.urgent && conversation?.kind === 'channel' && mentions.length === 0) {
      updateCompose(current => ({ ...current, error: '频道紧急消息需要明确 @ 至少一名成员' }))
      return
    }
    updateCompose(current => ({ ...current, sending: true, error: null }))
    const content: readonly FleetChatContentBlock[] = [{ type: 'text', text }]
    const pending = Promise.resolve().then(() => source.sendMessage({
      sessionId,
      teamId,
      conversationId,
      content,
      delivery,
      ...(mentions.length === 0 ? {} : { mentions }),
    }))
    void pending.then(() => {
      updateCompose(current => ({
        ...current,
        draft: current.draft === submittedDraft ? '' : current.draft,
        urgent: current.draft === submittedDraft ? false : current.urgent,
      }))
    }).catch((error: unknown) => {
      updateCompose(current => ({
        ...current,
        error: error instanceof Error ? error.message : '消息发送失败',
      }))
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
    if (activeTeam === undefined || !activeTeam.members.some(member => member.id === memberId)) return
    setItems(current => ({ ...current, [`${activeTeam.teamId}:team`]: memberId }))
    setActiveTool('team')
    setNavigationOpen(false)
  }

  const rail = jsxs('nav', {
    className: 'dsh-fleet-panel-rail',
    'aria-label': 'Fleet 工具',
    children: [
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-rail-brand',
        'aria-label': '团队首页',
        'aria-current': visibleTool === 'home' ? 'page' : undefined,
        title: '团队首页',
        onClick: showTeamDirectory,
        children: jsx('span', { className: 'dsh-fleet-panel-harmony-icon', 'aria-hidden': 'true' }),
      }),
      jsx('div', {
        className: 'dsh-fleet-panel-rail-tools',
        children: renderSlot(FLEET_PANEL_SLOTS.tool, {
          activeTool: visibleTool,
          disabled: activeTeam === undefined,
          selectTool,
        }),
      }),
    ],
  })

  const homeOwner: FleetPanelHomeOwner = {
    sessionId,
    fleet: effectiveSnapshot,
    ...(homeTeamId === null ? {} : { focusedTeamId: homeTeamId }),
    selectTeam,
    openTeamMessages,
    ...(source?.controlTeam === undefined ? {} : {
      controlTeamById: (teamId: string, action: FleetPanelTeamControlInput['action'], summary?: string) =>
        source.controlTeam?.({ sessionId, teamId, action, ...(summary === undefined ? {} : { summary }) }) ?? Promise.resolve(),
    }),
    ...(source?.exportTeam === undefined ? {} : { exportTeam: source.exportTeam }),
    ...(source?.exportArchive === undefined ? {} : {
      exportArchive: (teamId: string, includeWorkspace: boolean) => source.exportArchive?.({
        sessionId,
        teamId,
        includeWorkspace,
      }) ?? Promise.reject(new Error('Fleet 存档导出不可用')),
    }),
    ...(source?.importArchive === undefined ? {} : {
      importArchive: (file: File, projectRoot: string, mode: 'copy' | 'restore') => source.importArchive?.({
        sessionId,
        file,
        projectRoot,
        mode,
      }) ?? Promise.reject(new Error('Fleet 存档导入不可用')),
    }),
    openNavigation: () => { setNavigationOpen(true) },
    renderPanelSlot: renderSlot,
    useSessions,
    nativeContext,
    SessionProvider,
    t,
  }
  const paneOwner: FleetPanelPaneOwner | undefined = activeTeam === undefined ? undefined : {
    ...homeOwner,
    selectTeam: switchTeam,
    snapshot: activeTeam,
    activeItem,
    selectItem,
    showMemberDetails,
    openResource,
    ...(source?.uploadResource === undefined ? {} : {
      uploadResource: (file: File) => source.uploadResource?.({ sessionId, teamId: activeTeam.teamId, file }) ?? Promise.resolve(),
    }),
    ...(source?.controlMember === undefined ? {} : {
      controlMember: (memberId: string, action: FleetPanelMemberControlInput['action']) =>
        source.controlMember?.({ sessionId, teamId: activeTeam.teamId, memberId, action }) ?? Promise.resolve(),
    }),
    ...(source?.controlTeam === undefined ? {} : {
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
    ...(source?.loadResource === undefined ? {} : { loadResource: source.loadResource }),
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
    'aria-label': '团队面板',
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
        'aria-label': '调整侧边栏宽度',
        'aria-orientation': 'vertical',
        'aria-valuemin': SIDEBAR_MIN_WIDTH,
        'aria-valuemax': SIDEBAR_MAX_WIDTH,
        'aria-valuenow': sidebarWidth,
        tabIndex: 0,
        title: '拖动调整侧边栏宽度；双击恢复默认',
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
          ? '正在连接 Fleet…'
          : `Fleet 连接中断，正在显示上次同步的数据。${connection.error === undefined ? '' : ` ${connection.error}`}`,
      }),
      !loading && retry !== undefined && jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-connection-retry',
        onClick: () => { void retry() },
        children: '重试',
      }),
    ],
  })
}

export function FleetPanelToolButton({ owner, tool, label, children }: {
  readonly owner: FleetPanelToolOwner
  readonly tool: string
  readonly label: string
  readonly children: ReactNode
}): ReactElement {
  const active = owner.activeTool === tool
  return jsx('button', {
    type: 'button',
    className: 'dsh-fleet-panel-tool',
    disabled: owner.disabled === true,
    'aria-label': label,
    'aria-current': active ? 'page' : undefined,
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
  return jsx(ToolButton, { owner, tool: 'chat', label: '消息', icon: 'chat' })
}
function TeamTool(owner: FleetPanelToolOwner): ReactElement {
  return jsx(ToolButton, { owner, tool: 'team', label: '成员', icon: 'team' })
}
function AgentTool(owner: FleetPanelToolOwner): ReactElement {
  return jsx(ToolButton, { owner, tool: 'agent', label: '单 Agent 视图', icon: 'agent' })
}
function ResourcesTool(owner: FleetPanelToolOwner): ReactElement {
  return jsx(ToolButton, { owner, tool: 'resources', label: '共享资源', icon: 'resources' })
}
function ActivityTool(owner: FleetPanelToolOwner): ReactElement {
  return jsx(ToolButton, { owner, tool: 'activity', label: '团队动态', icon: 'activity' })
}

function TeamSettingsDialog({ teamId, teamName, teamStatus, exportTeam, exportArchive, importArchive, onClose }: {
  readonly teamId?: string
  readonly teamName?: string
  readonly teamStatus?: FleetPanelTeamSummary['status']
  readonly exportTeam?: FleetPanelSource['exportTeam']
  readonly exportArchive?: (teamId: string, includeWorkspace: boolean) => Promise<FleetPanelArchiveFile>
  readonly importArchive?: (file: File, projectRoot: string, mode: 'copy' | 'restore') => Promise<void>
  readonly onClose: () => void
}): ReactElement {
  const dialog = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const archiveInput = useRef<HTMLInputElement>(null)
  const [configurationExporting, setConfigurationExporting] = useState(false)
  const [archiveExporting, setArchiveExporting] = useState(false)
  const [archiveImporting, setArchiveImporting] = useState(false)
  const [includeWorkspace, setIncludeWorkspace] = useState(false)
  const [importMode, setImportMode] = useState<'copy' | 'restore'>('copy')
  const [importRoot, setImportRoot] = useState('')
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const downloadBlob = (blob: Blob, name: string): void => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const downloadConfiguration = async (): Promise<void> => {
    if (teamId === undefined || exportTeam === undefined || configurationExporting) return
    setConfigurationExporting(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const configuration = await exportTeam(teamId)
      const blob = new Blob([`${JSON.stringify(configuration, null, 2)}\n`], { type: 'application/json' })
      const stem = (teamName ?? 'fleet-team').trim()
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-')
        .replace(/^-|-$/g, '')
      downloadBlob(blob, `${stem || 'fleet-team'}.fleet-team.json`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '团队导出失败')
    } finally {
      setConfigurationExporting(false)
    }
  }

  const downloadArchive = async (): Promise<void> => {
    if (teamId === undefined || exportArchive === undefined || archiveExporting || teamStatus !== 'paused') return
    setArchiveExporting(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const archive = await exportArchive(teamId, includeWorkspace)
      downloadBlob(archive.blob, archive.name)
      setNotice('团队存档已导出。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '团队存档导出失败')
    } finally {
      setArchiveExporting(false)
    }
  }

  const importArchiveFile = async (file: File): Promise<void> => {
    if (importArchive === undefined || archiveImporting || importRoot.trim() === '') return
    setArchiveImporting(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await importArchive(file, importRoot.trim(), importMode)
      setNotice(importMode === 'copy'
        ? '团队副本已导入并分配新身份，当前保持暂停状态。'
        : '原团队已恢复，当前保持暂停状态。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '团队存档导入失败')
    } finally {
      setArchiveImporting(false)
      if (archiveInput.current !== null) archiveInput.current.value = ''
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
      'aria-label': teamName === undefined ? '团队设置' : `${teamName} 团队设置`,
      tabIndex: -1,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Tab') return
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
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
              children: teamName === undefined ? '团队设置' : `${teamName} · 团队设置`,
            }),
            jsx('button', {
              ref: closeButton,
              type: 'button',
              className: 'dsh-fleet-panel-settings-close',
              'aria-label': '关闭团队设置',
              title: '关闭',
              onClick: onClose,
              children: jsx(PanelIcon, { name: 'close', size: 16 }),
            }),
          ],
        }),
        jsxs('div', {
          className: 'dsh-fleet-panel-settings-body',
          children: [
            jsxs('div', {
              className: 'dsh-fleet-panel-settings-section',
              children: [
                jsx('h3', { className: 'dsh-fleet-panel-settings-section-title', children: '团队配置' }),
                jsx('p', {
                  className: 'dsh-fleet-panel-settings-section-copy',
                  children: '只导出团队结构和成员配置，用于创建新的同类团队；不会包含运行记录与文件。',
                }),
                jsx('button', {
                  type: 'button',
                  className: 'dsh-fleet-panel-settings-export',
                  disabled: teamId === undefined || exportTeam === undefined || configurationExporting,
                  onClick: () => { void downloadConfiguration() },
                  children: [
                    jsx(PanelIcon, { name: 'download', size: 16 }),
                    configurationExporting ? '正在导出…' : '导出团队配置',
                  ],
                }),
              ],
            }),
            jsxs('div', {
              className: 'dsh-fleet-panel-settings-section dsh-fleet-panel-settings-section-separated',
              children: [
                jsx('h3', { className: 'dsh-fleet-panel-settings-section-title', children: '完整团队存档' }),
                jsx('p', {
                  className: 'dsh-fleet-panel-settings-section-copy',
                  children: teamStatus === 'paused'
                    ? '包含成员上下文、消息、轨迹、共享文档和下游插件数据；导入后可直接继续运行。'
                    : '完整存档需要一致的持久化状态。请先暂停团队，再进行导出。',
                }),
                jsxs('label', {
                  className: 'dsh-fleet-panel-settings-check',
                  children: [
                    jsx('input', {
                      type: 'checkbox',
                      checked: includeWorkspace,
                      disabled: archiveExporting,
                      onChange: (event: ChangeEvent<HTMLInputElement>) => { setIncludeWorkspace(event.currentTarget.checked) },
                    }),
                    jsx('span', { children: '同时打包工作区文件' }),
                  ],
                }),
                jsx('button', {
                  type: 'button',
                  className: 'dsh-fleet-panel-settings-export',
                  disabled: teamId === undefined || teamStatus !== 'paused' || exportArchive === undefined || archiveExporting,
                  title: teamStatus === 'paused' ? '导出完整团队存档' : '请先暂停团队',
                  onClick: () => { void downloadArchive() },
                  children: [
                    jsx(PanelIcon, { name: 'download', size: 16 }),
                    archiveExporting ? '正在生成存档…' : '导出完整存档',
                  ],
                }),
                jsxs('fieldset', {
                  className: 'dsh-fleet-panel-settings-import-mode',
                  disabled: archiveImporting,
                  children: [
                    jsx('legend', { children: '导入方式' }),
                    jsxs('label', {
                      className: 'dsh-fleet-panel-settings-import-choice',
                      children: [
                        jsx('input', {
                          type: 'radio',
                          name: 'fleet-archive-import-mode',
                          value: 'copy',
                          checked: importMode === 'copy',
                          onChange: () => { setImportMode('copy') },
                        }),
                        jsxs('span', {
                          children: [
                            jsx('strong', { children: '创建为新团队' }),
                            jsx('small', { children: '分配新的团队和成员身份，可与原团队同时存在。' }),
                          ],
                        }),
                      ],
                    }),
                    jsxs('label', {
                      className: 'dsh-fleet-panel-settings-import-choice',
                      children: [
                        jsx('input', {
                          type: 'radio',
                          name: 'fleet-archive-import-mode',
                          value: 'restore',
                          checked: importMode === 'restore',
                          onChange: () => { setImportMode('restore') },
                        }),
                        jsxs('span', {
                          children: [
                            jsx('strong', { children: '恢复原团队' }),
                            jsx('small', { children: '保留原始身份；目标环境中不能已有同一团队或成员会话。' }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
                jsx('label', {
                  className: 'dsh-fleet-panel-settings-field',
                  children: [
                    jsx('span', { children: '导入到工作区路径' }),
                    jsx('input', {
                      type: 'text',
                      value: importRoot,
                      disabled: archiveImporting,
                      placeholder: '/path/to/project',
                      onChange: (event: ChangeEvent<HTMLInputElement>) => { setImportRoot(event.currentTarget.value) },
                    }),
                  ],
                }),
                jsx('input', {
                  ref: archiveInput,
                  className: 'dsh-fleet-panel-settings-file-input',
                  type: 'file',
                  accept: '.fleet.tar.gz,.tar.gz,.tgz,application/gzip',
                  disabled: archiveImporting,
                  onChange: (event: ChangeEvent<HTMLInputElement>) => {
                    const file = event.currentTarget.files?.[0]
                    if (file !== undefined) void importArchiveFile(file)
                  },
                }),
                jsx('button', {
                  type: 'button',
                  className: 'dsh-fleet-panel-settings-export',
                  disabled: importArchive === undefined || archiveImporting || importRoot.trim() === '',
                  onClick: () => { archiveInput.current?.click() },
                  children: [
                    jsx(PanelIcon, { name: 'upload', size: 16 }),
                    archiveImporting
                      ? '正在导入存档…'
                      : importMode === 'copy' ? '选择存档并创建副本' : '选择存档并恢复',
                  ],
                }),
                error !== undefined && jsx('p', {
                  className: 'dsh-fleet-panel-settings-error',
                  role: 'alert',
                  children: error,
                }),
                notice !== undefined && jsx('p', {
                  className: 'dsh-fleet-panel-settings-notice',
                  role: 'status',
                  children: notice,
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  })
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
      setError(reason instanceof Error ? reason.message : '无法终结团队')
    }).finally(() => { setSubmitting(false) })
  }

  return jsx('div', {
    className: 'dsh-fleet-panel-settings-overlay',
    children: jsxs('section', {
      ref: dialog,
      className: 'dsh-fleet-panel-settings-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': `终结 ${teamName}`,
      tabIndex: -1,
      children: [
        jsxs('header', {
          className: 'dsh-fleet-panel-settings-head',
          children: [
            jsx('h2', { className: 'dsh-fleet-panel-settings-title', children: `终结 ${teamName}` }),
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-settings-close',
              'aria-label': '取消终结团队',
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
              children: '终结会结束当前工作并关闭团队成员。团队记录仍会保留在已归档列表中，但不能继续运行。',
            }),
            jsxs('label', {
              className: 'dsh-fleet-panel-control-dialog-label',
              children: [
                '终结摘要',
                jsx('textarea', {
                  ref: input,
                  className: 'dsh-fleet-panel-control-dialog-input',
                  value: summary,
                  disabled: submitting,
                  placeholder: '说明终结原因和需要保留的状态',
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
              children: '取消',
            }),
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-control-button',
              'data-danger': 'true',
              disabled: submitting || summary.trim() === '',
              onClick: confirm,
              children: submitting ? '正在终结…' : '终结团队',
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

function SidebarHead({ teams, selectedTeamId, label, selectTeam, exportTeam, exportArchive, importArchive, secondary }: {
  readonly teams: readonly FleetPanelTeamSummary[]
  readonly selectedTeamId?: string
  readonly label: string
  readonly selectTeam: (teamId: string) => void
  readonly exportTeam?: FleetPanelSource['exportTeam']
  readonly exportArchive?: (teamId: string, includeWorkspace: boolean) => Promise<FleetPanelArchiveFile>
  readonly importArchive?: (file: File, projectRoot: string, mode: 'copy' | 'restore') => Promise<void>
  readonly secondary?: ReactNode
}): ReactElement {
  const [teamsOpen, setTeamsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const teamTrigger = useRef<HTMLButtonElement>(null)
  const teamMenu = useRef<HTMLDivElement>(null)
  const selectedTeam = teams.find(team => team.teamId === selectedTeamId)

  useEffect(() => {
    if (teamsOpen && teamMenu.current !== null) focusCurrentRadioMenuItem(teamMenu.current)
  }, [teamsOpen, selectedTeamId, teams.length])

  const closeTeams = (restoreFocus: boolean): void => {
    setTeamsOpen(false)
    if (restoreFocus) queueMicrotask(() => { teamTrigger.current?.focus() })
  }

  return jsxs('div', {
    className: 'dsh-fleet-panel-sidebar-team-block',
    children: [
      jsxs('div', {
        className: 'dsh-fleet-panel-sidebar-team-primary',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-panel-team-switcher',
            onBlur: (event: FocusEvent<HTMLDivElement>) => {
              const next = event.relatedTarget
              if (!(next instanceof Node) || !event.currentTarget.contains(next)) setTeamsOpen(false)
            },
            children: [
              jsxs('button', {
                ref: teamTrigger,
                type: 'button',
                className: 'dsh-fleet-panel-team-switch',
                'aria-haspopup': 'menu',
                'aria-expanded': teamsOpen ? 'true' : 'false',
                title: '切换团队',
                onClick: () => { setTeamsOpen(open => !open) },
                onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                  if (!teamsOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault()
                    setTeamsOpen(true)
                  }
                },
                children: [
                  jsx('span', { className: 'dsh-fleet-panel-team-switch-name', children: label }),
                  jsx('span', {
                    className: 'dsh-fleet-panel-team-switch-chevron',
                    children: jsx(PanelIcon, { name: 'chevron', size: 14 }),
                  }),
                ],
              }),
              teamsOpen && jsx('div', {
                ref: teamMenu,
                className: 'dsh-fleet-panel-team-menu',
                role: 'menu',
                'aria-label': '切换团队',
                onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                  handleRadioMenuKeyDown(event, () => { closeTeams(true) })
                },
                children: teams.map(team => jsxs('button', {
                  type: 'button',
                  tabIndex: -1,
                  className: 'dsh-fleet-panel-team-option',
                  role: 'menuitemradio',
                  'aria-checked': team.teamId === selectedTeamId ? 'true' : 'false',
                  onClick: () => {
                    selectTeam(team.teamId)
                    closeTeams(true)
                  },
                  children: [
                    jsx('span', { className: 'dsh-fleet-panel-team-row-status', 'data-status': team.status }),
                    jsx('span', { className: 'dsh-fleet-panel-team-option-name', children: team.teamName }),
                  ],
                }, team.teamId)),
              }),
            ],
          }),
          jsx('button', {
            type: 'button',
            className: 'dsh-fleet-panel-team-settings',
            'aria-label': '团队设置',
            title: '团队设置',
            onClick: () => { setSettingsOpen(true) },
            children: jsx(PanelIcon, { name: 'settings', size: 16 }),
          }),
        ],
      }),
      secondary,
      settingsOpen && jsx(TeamSettingsDialog, {
        ...(selectedTeamId === undefined ? {} : { teamId: selectedTeamId }),
        ...(selectedTeamId === undefined ? {} : { teamName: label }),
        ...(selectedTeam === undefined ? {} : { teamStatus: selectedTeam.status }),
        ...(exportTeam === undefined ? {} : { exportTeam }),
        ...(exportArchive === undefined ? {} : { exportArchive }),
        ...(importArchive === undefined ? {} : { importArchive }),
        onClose: () => { setSettingsOpen(false) },
      }),
    ],
  })
}

function AgentPicker({ members, selectedMemberId, selectMember }: {
  readonly members: readonly FleetPanelMember[]
  readonly selectedMemberId?: string
  readonly selectMember: (member: FleetPanelMember) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const selected = members.find(member => member.id === selectedMemberId) ?? members[0]

  useEffect(() => {
    if (open && menu.current !== null) focusCurrentRadioMenuItem(menu.current)
  }, [open, selected?.id, members.length])

  const close = (restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => { trigger.current?.focus() })
  }

  if (selected === undefined) {
    return jsx('button', {
      type: 'button',
      className: 'dsh-fleet-panel-agent-switch',
      disabled: true,
      children: '没有可选 Agent',
    })
  }
  return jsxs('div', {
    className: 'dsh-fleet-panel-agent-switcher',
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget
      if (!(next instanceof Node) || !event.currentTarget.contains(next)) setOpen(false)
    },
    children: [
      jsxs('button', {
        ref: trigger,
        type: 'button',
        className: 'dsh-fleet-panel-agent-switch',
        'aria-haspopup': 'menu',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': `切换 Agent，当前为 ${selected.name}`,
        onClick: () => { setOpen(current => !current) },
        onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            setOpen(true)
          }
        },
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
                      presence: selected.runtimeStatus === 'paused' ? 'offline' : selected.presence ?? 'offline',
                      label: memberPresenceLabel(selected),
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
      open && jsx('div', {
        ref: menu,
        className: 'dsh-fleet-panel-team-menu',
        role: 'menu',
        'aria-label': '选择 Agent 视角',
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          handleRadioMenuKeyDown(event, () => { close(true) })
        },
        children: members.map(member => jsxs('button', {
          type: 'button',
          tabIndex: -1,
          className: 'dsh-fleet-panel-team-option',
          role: 'menuitemradio',
          'aria-checked': member.id === selected.id ? 'true' : 'false',
          onClick: () => {
            selectMember(member)
            close(true)
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
                        presence: member.runtimeStatus === 'paused' ? 'offline' : member.presence ?? 'offline',
                        label: memberPresenceLabel(member),
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
        teams: owner.fleet.directory.teams,
        selectedTeamId: owner.snapshot.teamId,
        label: owner.snapshot.teamName,
        selectTeam: owner.selectTeam,
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

function SectionTitle({ children }: { readonly children: ReactNode }): ReactElement {
  return jsx('div', { className: 'dsh-fleet-panel-section-title', children })
}

function ListRow({ selected, title, caption, leading, trailing, onClick }: {
  readonly selected: boolean
  readonly title: string
  readonly caption?: string
  readonly leading?: ReactNode
  readonly trailing?: ReactNode
  readonly onClick: () => void
}): ReactElement {
  return jsxs('button', {
    type: 'button',
    className: 'dsh-fleet-panel-list-row',
    'aria-current': selected ? 'true' : undefined,
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

function statusLabel(status: FleetPanelTeamSummary['status']): string {
  if (status === 'running') return '运行中'
  if (status === 'idle') return '待命'
  if (status === 'paused') return '已暂停'
  if (status === 'starting') return '正在建立'
  if (status === 'finishing') return '正在收尾'
  if (status === 'closed') return '已结束'
  if (status === 'failed') return '异常'
  return '未连接'
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
        children: '此消息需要对应的扩展来显示',
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

function FleetPlainMessageText({ owner, text }: {
  readonly owner: FleetPanelPaneOwner
  readonly text: string
}): ReactElement {
  return jsx(Fragment, {
    children: splitFleetMemberMentions(text, owner.snapshot.members).map((segment, index) => segment.member === undefined
      ? jsx(Fragment, { children: segment.text }, index)
      : jsx(FleetMemberMentionPopover, {
          member: segment.member,
          label: segment.text,
          showDetails: owner.showMemberDetails,
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
    { entryKey: 'markdown', fallback: jsx(FleetPlainMessageText, { owner, text }) },
  )
}

function renderMemberMention(owner: FleetPanelPaneOwner, mention: FleetChatMentionBlock): ReactNode | undefined {
  const member = owner.snapshot.members.find(candidate => candidate.id === mention.memberId)
  if (member === undefined) return undefined
  return jsx(FleetMemberMentionPopover, {
    member,
    label: `@${mention.label}`,
    showDetails: owner.showMemberDetails,
  })
}

function messageReadReceipt(
  snapshot: FleetPanelTeamSnapshot,
  receipt: NonNullable<FleetPanelMessage['receipt']>,
) {
  const members = new Map(snapshot.members.map(member => [member.id, member]))
  return {
    readMembers: receipt.readMemberIds.flatMap(id => {
      const member = members.get(id)
      return member === undefined ? [] : [member]
    }),
    unreadMembers: receipt.unreadMemberIds.flatMap(id => {
      const member = members.get(id)
      return member === undefined ? [] : [member]
    }),
  }
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
        teams: owner.fleet.directory.teams,
        ...(focusedTeam === undefined ? {} : { selectedTeamId: focusedTeam.teamId }),
        label: focusedTeam?.teamName ?? '所有团队',
        selectTeam: owner.selectTeam,
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
                  jsx('h2', { className: 'dsh-fleet-panel-team-title', children: '团队' }),
                ],
              }),
              jsxs('label', {
                className: 'dsh-fleet-panel-search-wrap',
                children: [
                  jsx(PanelIcon, { name: 'search', size: 14 }),
                  jsx('input', {
                    className: 'dsh-fleet-panel-search',
                    type: 'search',
                    'aria-label': '搜索团队或工作区',
                    value: query,
                    placeholder: '搜索团队或工作区',
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
                ? jsx('div', { className: 'dsh-fleet-panel-empty', children: '没有匹配的团队' })
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
                        caption: [statusLabel(team.status), team.primaryWorkspace === undefined ? '未挂载工作区' : `主要工作区 · ${team.primaryWorkspace}`].join(' · '),
                        leading: jsx('span', { className: 'dsh-fleet-panel-team-row-status', 'data-status': team.status }),
                        trailing: team.unread !== undefined
                          ? jsx('span', { className: 'dsh-fleet-panel-unread', children: team.unread })
                          : team.needsAttention === true ? jsx('span', { className: 'dsh-fleet-panel-attention', title: '需要关注' }) : undefined,
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
    placeholder: '搜索频道或成员',
    query,
    setQuery,
    children: [
          jsx(SectionTitle, { children: '频道' }),
          ...channels.map(item => jsx(ListRow, {
            selected: owner.activeItem === item.id,
            title: item.name,
            caption: item.topic,
            leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'channel', size: 15 }) }),
            trailing: item.unread === undefined ? undefined : jsx('span', { className: 'dsh-fleet-panel-unread', children: item.unread }),
            onClick: () => { owner.selectItem(item.id) },
          }, item.id)),
          ...(crossTeam.length === 0 ? [] : [
            jsx(SectionTitle, { children: '跨团队' }, 'cross-team-title'),
            ...crossTeam.map(item => jsx(ListRow, {
              selected: owner.activeItem === item.id,
              title: item.name,
              caption: item.topic,
              leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'channel', size: 15 }) }),
              trailing: item.unread === undefined ? undefined : jsx('span', { className: 'dsh-fleet-panel-unread', children: item.unread }),
              onClick: () => { owner.selectItem(item.id) },
            }, item.id)),
          ]),
          jsx(SectionTitle, { children: '私聊' }),
          ...directs.map(item => {
            const peer = owner.snapshot.members.find(member => member.id === item.peerId)
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
  const members = owner.snapshot.members.filter(member => normalized === ''
    || member.name.toLocaleLowerCase().includes(normalized)
    || member.role.toLocaleLowerCase().includes(normalized))
  return jsx(PaneSidebar, {
    owner,
    placeholder: '搜索成员或角色',
    query,
    setQuery,
    children: [
          jsx(SectionTitle, { children: `${members.length} 位成员` }),
          ...members.map(member => jsx(ListRow, {
            selected: owner.activeItem === member.id,
            title: member.name,
            caption: member.role,
            leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx('span', {
              className: 'dsh-fleet-panel-presence',
              'data-presence': member.presence ?? 'offline',
            }) }),
            trailing: jsx(MemberState, { member, showDot: false }),
            onClick: () => { owner.selectItem(member.id) },
          }, member.id)),
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
        teams: owner.fleet.directory.teams,
        selectedTeamId: owner.snapshot.teamId,
        label: owner.snapshot.teamName,
        selectTeam: owner.selectTeam,
        ...(owner.exportTeam === undefined ? {} : { exportTeam: owner.exportTeam }),
        ...(owner.exportArchive === undefined ? {} : { exportArchive: owner.exportArchive }),
        ...(owner.importArchive === undefined ? {} : { importArchive: owner.importArchive }),
        secondary: jsx(AgentPicker, {
          members: owner.snapshot.members,
          selectedMemberId: perspective.member?.id,
          selectMember: (member: FleetPanelMember) => {
            owner.selectItem(agentViewItem(member.id, AGENT_CONTEXT_ITEM_ID))
          },
        }),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-sidebar',
        children: [
          jsx(SidebarSearch, { placeholder: '搜索 Agent 可见消息', query, setQuery }),
          jsxs('div', {
            className: 'dsh-fleet-panel-sidebar-scroll',
            children: [
              jsx(SectionTitle, { children: 'Agent' }),
              jsx(ListRow, {
                selected: perspective.context,
                title: '执行上下文',
                caption: perspective.member === undefined ? undefined : `${perspective.member.name} 的真实 Session 历史`,
                leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'activity', size: 15 }) }),
                onClick: () => {
                  if (perspective.member !== undefined) owner.selectItem(agentViewItem(perspective.member.id, AGENT_CONTEXT_ITEM_ID))
                },
              }),
              jsx(SectionTitle, { children: '频道' }),
              ...channels.map(item => jsx(ListRow, {
                selected: perspective.conversation?.id === item.id,
                title: item.name,
                caption: item.topic,
                leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'channel', size: 15 }) }),
                trailing: item.unread === undefined ? undefined : jsx('span', { className: 'dsh-fleet-panel-unread', children: item.unread }),
                onClick: () => { selectConversation(item) },
              }, item.id)),
              ...(crossTeam.length === 0 ? [] : [
                jsx(SectionTitle, { children: '跨团队' }, 'agent-cross-team-title'),
                ...crossTeam.map(item => jsx(ListRow, {
                  selected: perspective.conversation?.id === item.id,
                  title: item.name,
                  caption: item.topic,
                  leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'channel', size: 15 }) }),
                  trailing: item.unread === undefined ? undefined : jsx('span', { className: 'dsh-fleet-panel-unread', children: item.unread }),
                  onClick: () => { selectConversation(item) },
                }, item.id)),
              ]),
              jsx(SectionTitle, { children: '私聊' }),
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
  const [uploadError, setUploadError] = useState<string>()
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
    setUploadError(undefined)
    void owner.uploadResource(file).catch((reason: unknown) => {
      setUploadError(reason instanceof Error ? reason.message : '上传文件失败')
    }).finally(() => {
      setUploading(false)
      if (fileInput.current !== null) fileInput.current.value = ''
    })
  }
  return jsx(PaneSidebar, {
    owner,
    placeholder: '搜索共享资源',
    query,
    setQuery,
    children: [
          jsx(SectionTitle, {
            children: jsxs(Fragment, {
              children: [
                jsx('span', { children: '团队文件' }),
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
                      children: uploading ? '上传中…' : '添加文件',
                    }),
                  ],
                }),
              ],
            }),
          }),
          uploadError !== undefined && jsx('div', {
            className: 'dsh-fleet-panel-resource-upload-error',
            role: 'alert',
            children: uploadError,
          }),
          ...resources.map(resource => jsx(ListRow, {
            selected: owner.activeItem === resource.id,
            title: resource.name,
            caption: resource.detail,
            leading: jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(PanelIcon, { name: 'resources', size: 15 }) }),
            onClick: () => { owner.selectItem(resource.id) },
          }, resource.id)),
          jsx(SectionTitle, { children: '工作区' }),
          ...workspaces.map(workspace => jsx(ListRow, {
            selected: owner.activeItem === workspace.id,
            title: workspace.name,
            caption: `${workspace.access === 'write' ? '可写' : '只读'} · ${workspace.members.length} 位成员`,
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
    ['all', '全部动态', '消息、资源和决策'],
    ['message', '消息', '频道与私聊'],
    ['resource', '资源', '共享文件与引用'],
    ['decision', '决策', '投票与共识'],
  ] as const
  return jsx(PaneSidebar, {
    owner,
    placeholder: '搜索动态',
    query,
    setQuery,
    children: [
          jsx(SectionTitle, { children: '筛选' }),
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

function PanelMessageLog({ conversationKey, messageCount, children, resizable = false, resizeLabel = '调整消息区域宽度', initialScroll = 'bottom' }: {
  readonly conversationKey: string
  readonly messageCount: number
  readonly children: ReactNode
  readonly resizable?: boolean
  readonly resizeLabel?: string
  readonly initialScroll?: 'top' | 'bottom'
}): ReactElement {
  const log = useRef<HTMLDivElement>(null)
  const renderedConversation = useRef<string>()
  const atBottom = useRef(true)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const [columnWidth, setColumnWidth] = useState(() => readPanelPreferences().chatColumnWidth ?? CHAT_COLUMN_DEFAULT_WIDTH)
  const [columnResizing, setColumnResizing] = useState(false)
  const columnResize = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    width: number
    minWidth: number
    maxWidth: number
  } | null>(null)

  const columnLimits = (): { minWidth: number; maxWidth: number } => {
    const available = log.current?.clientWidth ?? CHAT_COLUMN_MAX_WIDTH
    const maxWidth = Math.min(CHAT_COLUMN_MAX_WIDTH, Math.max(0, available))
    return { minWidth: Math.min(CHAT_COLUMN_MIN_WIDTH, maxWidth), maxWidth }
  }
  const resizeColumnWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const { minWidth, maxWidth } = columnLimits()
    let next: number | undefined
    if (event.key === 'ArrowLeft') next = columnWidth - 32
    else if (event.key === 'ArrowRight') next = columnWidth + 32
    else if (event.key === 'Home') next = minWidth
    else if (event.key === 'End') next = maxWidth
    if (next === undefined) return
    event.preventDefault()
    const width = Math.min(maxWidth, Math.max(minWidth, next))
    setColumnWidth(width)
    writePanelPreferences({ chatColumnWidth: width })
  }
  const startColumnResize = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const { minWidth, maxWidth } = columnLimits()
    const startWidth = Math.min(maxWidth, Math.max(minWidth, columnWidth))
    columnResize.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      width: startWidth,
      minWidth,
      maxWidth,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setColumnResizing(true)
  }
  const moveColumnResize = (event: PointerEvent<HTMLButtonElement>): void => {
    const resize = columnResize.current
    if (resize === null || resize.pointerId !== event.pointerId) return
    const width = Math.min(
      resize.maxWidth,
      Math.max(resize.minWidth, resize.startWidth + (event.clientX - resize.startX) * 2),
    )
    resize.width = width
    setColumnWidth(width)
  }
  const finishColumnResize = (event: PointerEvent<HTMLButtonElement>): void => {
    const resize = columnResize.current
    if (resize === null || resize.pointerId !== event.pointerId) return
    columnResize.current = null
    setColumnResizing(false)
    writePanelPreferences({ chatColumnWidth: resize.width })
  }

  const rememberScroll = (): void => {
    const node = log.current
    if (node === null) return
    const nextAtBottom = nearChatBottom(node)
    atBottom.current = nextAtBottom
    rememberBounded(panelChatScroll, conversationKey, { top: node.scrollTop, atBottom: nextAtBottom })
    if (nextAtBottom) setHasNewMessages(false)
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
      if (atBottom.current) scrollToLatest()
      else setHasNewMessages(true)
    }
    rememberBounded(panelChatMessageCounts, conversationKey, messageCount)
  }, [conversationKey, initialScroll, messageCount])

  return jsxs('div', {
    className: 'dsh-fleet-panel-chat-log-wrap',
    'data-column-resizing': columnResizing ? 'true' : undefined,
    style: resizable
      ? { '--dsh-fleet-panel-chat-column-width': `${columnWidth}px` } as CSSProperties
      : undefined,
    children: [
      jsx('div', {
        ref: log,
        className: 'dsh-fleet-panel-chat-log',
        onScroll: rememberScroll,
        children,
      }),
      resizable && jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-chat-width-handle',
        'data-dragging': columnResizing ? 'true' : undefined,
        'aria-label': resizeLabel,
        title: `拖动${resizeLabel}`,
        onKeyDown: resizeColumnWithKeyboard,
        onPointerDown: startColumnResize,
        onPointerMove: moveColumnResize,
        onPointerUp: finishColumnResize,
        onPointerCancel: finishColumnResize,
        onLostPointerCapture: finishColumnResize,
      }),
      hasNewMessages && jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-panel-chat-new-messages',
        onClick: scrollToLatest,
        children: [
          jsx(PanelIcon, { name: 'chevron', size: 12 }),
          jsx('span', { children: '查看新消息' }),
        ],
      }),
    ],
  })
}

function memberPresenceLabel(member: FleetPanelMember): string {
  if (member.runtimeStatus === 'paused') return '已暂停'
  if (member.presence === 'active') return '空闲'
  if (member.presence === 'busy') return '工作中'
  if (member.presence === 'waiting') return '等待中'
  if (member.presence === 'error') return '异常'
  if (member.presence === 'unknown') return '状态待同步'
  return '离线'
}

function MemberState({ member, showDot = true }: {
  readonly member: FleetPanelMember
  readonly showDot?: boolean
}): ReactElement {
  const presence = member.runtimeStatus === 'paused' ? 'offline' : member.presence ?? 'offline'
  return jsxs('span', {
    className: 'dsh-fleet-panel-member-state',
    'data-presence': presence,
    children: [
      showDot && jsx('span', { className: 'dsh-fleet-panel-presence', 'data-presence': presence }),
      jsx(FleetPresenceLabel, { presence, label: memberPresenceLabel(member) }),
    ],
  })
}

function AgentPerspectiveMeta({ member }: { readonly member: FleetPanelMember }): ReactElement {
  return jsxs('span', {
    className: 'dsh-fleet-panel-agent-view-meta',
    children: [
      jsx('span', { className: 'dsh-fleet-panel-agent-view-role', children: member.role }),
      jsx('span', { className: 'dsh-fleet-panel-agent-view-separator', 'aria-hidden': 'true', children: '·' }),
      jsx('span', { children: '内部视角' }),
      jsx('span', { className: 'dsh-fleet-panel-agent-view-separator', 'aria-hidden': 'true', children: '·' }),
      jsx(MemberState, { member, showDot: false }),
    ],
  })
}

function useFleetMemberPopover() {
  const popover = useRef<HTMLElement>(null)
  const nameId = useId()
  const popoverId = useId()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const node = popover.current
    if (node === null) return
    const syncOpen = (): void => { setOpen(node.matches(':popover-open')) }
    const closeOnViewportMove = (event: Event): void => {
      if (event.target instanceof Node && node.contains(event.target)) return
      if (node.matches(':popover-open')) node.hidePopover()
    }
    node.addEventListener('toggle', syncOpen)
    window.addEventListener('resize', closeOnViewportMove)
    document.addEventListener('scroll', closeOnViewportMove, true)
    return () => {
      node.removeEventListener('toggle', syncOpen)
      window.removeEventListener('resize', closeOnViewportMove)
      document.removeEventListener('scroll', closeOnViewportMove, true)
    }
  }, [])

  const openAt = (anchorElement: Element): void => {
    const node = popover.current
    if (node === null) return
    const anchor = anchorElement.getBoundingClientRect()
    node.style.visibility = 'hidden'
    if (!node.matches(':popover-open')) node.showPopover()
    const bounds = node.getBoundingClientRect()
    const gutter = 12
    const gap = 8
    const left = Math.max(gutter, Math.min(anchor.left, window.innerWidth - bounds.width - gutter))
    const below = anchor.bottom + gap
    const top = below + bounds.height <= window.innerHeight - gutter
      ? below
      : Math.max(gutter, anchor.top - bounds.height - gap)
    node.style.left = `${Math.round(left)}px`
    node.style.top = `${Math.round(top)}px`
    node.style.visibility = ''
  }

  const close = (): void => {
    if (popover.current?.matches(':popover-open') === true) popover.current.hidePopover()
  }
  const toggleAt = (anchor: Element): void => {
    if (popover.current?.matches(':popover-open') === true) close()
    else openAt(anchor)
  }

  return { popover, nameId, popoverId, open, openAt, close, toggleAt }
}

function FleetMemberPopoverCard({ member, controller, showDetails }: {
  readonly member: FleetPanelMember
  readonly controller: ReturnType<typeof useFleetMemberPopover>
  readonly showDetails: (memberId: string) => void
}): ReactElement {
  return jsxs('div', {
    ref: controller.popover,
    id: controller.popoverId,
    popover: 'auto',
    className: 'dsh-fleet-panel-member-popover',
    role: 'dialog',
    'aria-labelledby': controller.nameId,
    children: [
      jsxs('header', {
        className: 'dsh-fleet-panel-member-popover-head',
        children: [
          jsx(FleetChatAvatar, { member, size: 42 }),
          jsxs('div', {
            className: 'dsh-fleet-panel-member-popover-copy',
            children: [
              jsx('div', { id: controller.nameId, className: 'dsh-fleet-panel-member-popover-name', children: member.name }),
              jsx('div', { className: 'dsh-fleet-panel-member-popover-role', children: member.role }),
            ],
          }),
        ],
      }),
      jsx('p', {
        className: 'dsh-fleet-panel-member-popover-responsibility',
        children: member.responsibility,
      }),
      jsx('div', {
        className: 'dsh-fleet-panel-member-popover-status',
        'data-status': member.presence ?? 'offline',
        children: jsx(FleetPresenceLabel, {
          presence: member.runtimeStatus === 'paused' ? 'offline' : member.presence ?? 'offline',
          label: memberPresenceLabel(member),
        }),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-member-popover-self-status',
        'data-empty': member.statusText === undefined ? 'true' : undefined,
        children: [
          jsx('div', { className: 'dsh-fleet-panel-member-popover-self-status-label', children: '成员自述' }),
          jsx('p', {
            className: 'dsh-fleet-panel-member-popover-self-status-text',
            children: member.statusText ?? '暂未填写工作状态',
          }),
        ],
      }),
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-member-popover-detail',
        onClick: () => {
          controller.close()
          showDetails(member.id)
        },
        children: '详细信息',
      }),
    ],
  })
}

function FleetMemberAvatarPopover({ member, showDetails }: {
  readonly member: FleetPanelMember
  readonly showDetails: (memberId: string) => void
}): ReactElement {
  const controller = useFleetMemberPopover()
  return jsxs('div', {
    className: 'dsh-fleet-panel-member-avatar-anchor',
    children: [
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-member-avatar-trigger',
        'aria-label': `查看 ${member.name} 的成员信息`,
        'aria-haspopup': 'dialog',
        'aria-expanded': controller.open ? 'true' : 'false',
        'aria-controls': controller.popoverId,
        onClick: (event: { readonly currentTarget: Element }) => { controller.toggleAt(event.currentTarget) },
        children: jsx(FleetChatAvatar, { member }),
      }),
      jsx(FleetMemberPopoverCard, { member, controller, showDetails }),
    ],
  })
}

function FleetMemberMentionPopover({ member, label, showDetails }: {
  readonly member: FleetPanelMember
  readonly label: string
  readonly showDetails: (memberId: string) => void
}): ReactElement {
  const controller = useFleetMemberPopover()
  return jsxs(Fragment, {
    children: [
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-panel-member-mention',
        'aria-label': `${label}，查看 ${member.name} 的成员信息`,
        'aria-haspopup': 'dialog',
        'aria-expanded': controller.open ? 'true' : 'false',
        'aria-controls': controller.popoverId,
        'data-member-id': member.id,
        onClick: (event: { readonly currentTarget: Element }) => { controller.toggleAt(event.currentTarget) },
        children: label,
      }),
      jsx(FleetMemberPopoverCard, { member, controller, showDetails }),
    ],
  })
}

function ChatMain(owner: FleetPanelPaneOwner): ReactElement {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const mentionListId = useId()
  const [caret, setCaret] = useState(0)
  const [composerFocused, setComposerFocused] = useState(false)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const [dismissedMention, setDismissedMention] = useState<string>()
  const conversation = operatorConversations(owner.snapshot).find(item => item.id === owner.activeItem)
  const mentionQuery = conversation?.kind === 'channel'
    ? activeFleetMentionQuery(owner.draft, caret)
    : undefined
  const mentionKey = mentionQuery === undefined
    ? ''
    : `${mentionQuery.start}:${mentionQuery.end}:${mentionQuery.query}`
  const normalizedMentionQuery = mentionQuery?.query.toLocaleLowerCase() ?? ''
  const mentionCandidates = mentionQuery === undefined ? [] : owner.snapshot.members.filter(member =>
    normalizedMentionQuery === ''
      || member.name.toLocaleLowerCase().includes(normalizedMentionQuery)
      || member.id.toLocaleLowerCase().includes(normalizedMentionQuery)
      || member.role.toLocaleLowerCase().includes(normalizedMentionQuery))
  const mentionOpen = composerFocused && mentionQuery !== undefined && dismissedMention !== mentionKey

  useEffect(() => { setSelectedMentionIndex(0) }, [mentionKey])

  if (conversation === undefined) return jsx(PanelUnavailable, { label: '请选择一个频道或成员' })
  const peer = conversation.peerId === undefined ? undefined : owner.snapshot.members.find(member => member.id === conversation.peerId)
  const members = new Map(owner.snapshot.members.map(member => [member.id, member]))
  members.set(operator.id, operator)
  const messages = owner.snapshot.messages.filter(message => message.conversationId === conversation.id)
  const send = (): void => { owner.sendMessage() }
  const selectMention = (member: FleetPanelMember): void => {
    if (mentionQuery === undefined) return
    const next = insertFleetMemberMention(owner.draft, mentionQuery, member.name)
    owner.setDraft(next.text)
    setCaret(next.caret)
    setDismissedMention(undefined)
    queueMicrotask(() => {
      textarea.current?.focus()
      textarea.current?.setSelectionRange(next.caret, next.caret)
    })
  }
  return jsxs('section', {
    className: 'dsh-fleet-panel-chat',
    children: [
      jsx(FleetConversationHeader, {
        kind: conversation.kind,
        name: conversation.name,
        description: conversation.topic,
        memberCount: conversation.memberCount ?? owner.snapshot.members.length,
        activeCount: conversation.activeCount ?? owner.snapshot.members.filter(member =>
          member.presence === 'active' || member.presence === 'busy'
            || member.presence === 'waiting' || member.presence === 'error',
        ).length,
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
        children: jsx('div', {
          className: 'dsh-fleet-panel-chat-column',
          role: 'log',
          'aria-live': 'polite',
          children: messages.length === 0
            ? jsx('div', { className: 'dsh-fleet-panel-empty', children: '这里还没有消息' })
            : messages.map(message => {
                const sender = message.sender ?? members.get(message.senderId)
                if (sender === undefined) return null
                const member = owner.snapshot.members.find(candidate => candidate.id === sender.id)
                const messageOwner: FleetPanelMessageOwner = { panel: owner, conversation, message, sender }
                return jsx(FleetChatMessage, {
                  id: message.id,
                  sender,
                  sentAt: message.sentAt,
                  content: message.content,
                  ...(message.receipt === undefined ? {} : {
                    receipt: messageReadReceipt(owner.snapshot, message.receipt),
                  }),
                  ...(member === undefined ? {} : {
                    avatar: jsx(FleetMemberAvatarPopover, { member, showDetails: owner.showMemberDetails }),
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
                }, message.id)
              }),
        }),
      }),
      jsxs('div', {
        className: 'dsh-fleet-panel-composer-wrap',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-panel-composer',
            'aria-busy': owner.sending ? 'true' : 'false',
            children: [
              mentionOpen && jsx('div', {
                id: mentionListId,
                className: 'dsh-fleet-panel-mention-menu',
                role: 'listbox',
                'aria-label': '选择要提及的团队成员',
                children: mentionCandidates.length === 0
                  ? jsx('div', { className: 'dsh-fleet-panel-mention-empty', children: '没有匹配的团队成员' })
                  : mentionCandidates.map((member, index) => jsxs('button', {
                      id: `${mentionListId}-${index}`,
                      type: 'button',
                      className: 'dsh-fleet-panel-mention-option',
                      role: 'option',
                      'aria-selected': index === selectedMentionIndex ? 'true' : 'false',
                      onPointerMove: () => { setSelectedMentionIndex(index) },
                      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
                        event.preventDefault()
                        selectMention(member)
                      },
                      children: [
                        jsx(FleetChatAvatar, { member, size: 28 }),
                        jsxs('span', {
                          className: 'dsh-fleet-panel-mention-option-copy',
                          children: [
                            jsx('div', { className: 'dsh-fleet-panel-mention-option-name', children: member.name }),
                            jsx('div', { className: 'dsh-fleet-panel-mention-option-role', children: member.role }),
                          ],
                        }),
                      ],
                    }, member.id)),
              }),
              jsx('textarea', {
                ref: textarea,
                className: 'dsh-fleet-panel-composer-input',
                value: owner.draft,
                rows: 2,
                placeholder: `发送消息到 ${conversation.kind === 'channel' ? '#' : ''}${conversation.name}`,
                'aria-label': `发送消息到 ${conversation.name}`,
                'aria-autocomplete': conversation.kind === 'channel' ? 'list' : undefined,
                'aria-controls': mentionOpen ? mentionListId : undefined,
                'aria-expanded': conversation.kind === 'channel' ? (mentionOpen ? 'true' : 'false') : undefined,
                'aria-activedescendant': mentionOpen && mentionCandidates.length > 0
                  ? `${mentionListId}-${Math.min(selectedMentionIndex, mentionCandidates.length - 1)}`
                  : undefined,
                onFocus: () => { setComposerFocused(true) },
                onBlur: () => { setComposerFocused(false) },
                onSelect: (event: { readonly currentTarget: HTMLTextAreaElement }) => {
                  setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
                },
                onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
                  setCaret(event.target.selectionStart ?? event.target.value.length)
                  setDismissedMention(undefined)
                  owner.setDraft(event.target.value)
                },
                onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
                  if (event.nativeEvent.isComposing) return
                  if (mentionOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    if (mentionCandidates.length === 0) return
                    event.preventDefault()
                    setSelectedMentionIndex(current => event.key === 'ArrowDown'
                      ? (current + 1) % mentionCandidates.length
                      : (current <= 0 ? mentionCandidates.length : current) - 1)
                    return
                  }
                  if (mentionOpen && (event.key === 'Enter' || event.key === 'Tab') && mentionCandidates.length > 0) {
                    event.preventDefault()
                    selectMention(mentionCandidates[Math.min(selectedMentionIndex, mentionCandidates.length - 1)]!)
                    return
                  }
                  if (mentionOpen && event.key === 'Escape') {
                    event.preventDefault()
                    setDismissedMention(mentionKey)
                    return
                  }
                  if (event.key !== 'Enter' || event.shiftKey) return
                  event.preventDefault()
                  send()
                },
              }),
              jsxs('div', {
                className: 'dsh-fleet-panel-composer-foot',
                children: [
                  jsxs('div', {
                    className: 'dsh-fleet-panel-composer-actions',
                    children: [
                      owner.renderPanelSlot(FLEET_PANEL_SLOTS.composerAction, owner as unknown as Record<string, unknown>),
                      jsx('button', {
                        type: 'button',
                        className: 'dsh-fleet-panel-urgent-toggle',
                        'aria-pressed': owner.urgent,
                        title: conversation.kind === 'channel'
                          ? '紧急消息会中断被 @ 成员的当前步骤'
                          : '紧急消息会中断该成员的当前步骤',
                        onClick: () => { owner.setUrgent(!owner.urgent) },
                        children: '紧急',
                      }),
                      jsx('span', {
                        className: owner.sendError === null ? 'dsh-fleet-panel-compose-context' : 'dsh-fleet-panel-compose-error',
                        role: owner.sendError === null ? 'status' : 'alert',
                        'aria-live': 'polite',
                        children: owner.sending
                          ? '发送中…'
                          : owner.sendError ?? (owner.urgent
                            ? (conversation.kind === 'channel' ? '将中断被 @ 的成员' : '将中断成员当前步骤')
                            : '以外部观察者身份发送'),
                      }),
                    ],
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'dsh-fleet-panel-send',
                    disabled: owner.sending || owner.draft.trim() === '',
                    'aria-label': owner.sending ? '正在发送消息' : '发送消息',
                    title: owner.sending ? '正在发送消息' : '发送消息',
                    onClick: send,
                    children: jsx(PanelIcon, { name: 'send', size: 15 }),
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
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
    'aria-label': '打开团队导航',
    title: '打开团队导航',
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
    readonly action: 'pause' | 'resume'
  }>()
  const [controlError, setControlError] = useState<{
    readonly teamId: string
    readonly message: string
  }>()
  const [endingTeam, setEndingTeam] = useState(false)
  const teams = owner.fleet.directory.teams
  const focusedTeam = teams.find(team => team.teamId === owner.focusedTeamId)
  if (focusedTeam !== undefined) {
    const teamRunControl = fleetPanelTeamRunControl(focusedTeam)
    const busyAction = controlBusy?.teamId === focusedTeam.teamId ? controlBusy.action : undefined
    const runControl = (action: 'pause' | 'resume'): void => {
      if (owner.controlTeamById === undefined || controlBusy !== undefined) return
      setControlBusy({ teamId: focusedTeam.teamId, action })
      setControlError(undefined)
      void owner.controlTeamById(focusedTeam.teamId, action).catch((reason: unknown) => {
        setControlError({
          teamId: focusedTeam.teamId,
          message: reason instanceof Error ? reason.message : `无法${action === 'pause' ? '暂停' : '继续'}团队`,
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
            jsx('span', { className: 'dsh-fleet-panel-detail-meta', children: statusLabel(focusedTeam.status) }),
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
              jsx('h3', { className: 'dsh-fleet-panel-overview-title', children: '团队概况' }),
              jsx('p', { className: 'dsh-fleet-panel-overview-copy', children: '查看团队当前状态与主要工作上下文。更多概况信息将在后续补充。' }),
              jsxs('div', {
                className: 'dsh-fleet-panel-facts',
                children: [
                  jsx(Fact, { label: '运行状态', value: statusLabel(focusedTeam.status) }),
                  jsx(Fact, { label: '成员运行时', value: focusedTeam.runtimeState === 'dormant' ? '等待恢复' : '已连接' }),
                  jsx(Fact, { label: '未读消息', value: `${focusedTeam.unread ?? 0}` }),
                  jsx(Fact, { label: '主要工作区', value: focusedTeam.primaryWorkspace ?? '未挂载' }),
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
                      jsx('span', { children: '进入团队消息' }),
                    ],
                  }),
                  owner.controlTeamById !== undefined && teamRunControl !== undefined && jsx('button', {
                    type: 'button',
                    className: 'dsh-fleet-panel-control-button',
                    'data-primary': teamRunControl.action === 'resume' ? 'true' : undefined,
                    disabled: controlBusy !== undefined,
                    'aria-busy': busyAction !== undefined ? 'true' : undefined,
                    'aria-label': `${teamRunControl.label}：${teamRunControl.title}`,
                    title: teamRunControl.title,
                    onClick: () => { runControl(teamRunControl.action) },
                    children: busyAction === undefined
                      ? (controlBusy === undefined ? teamRunControl.label : '正在处理…')
                      : (busyAction === teamRunControl.action ? teamRunControl.busyLabel : '正在处理…'),
                  }),
                  owner.controlTeamById !== undefined && focusedTeam.status !== 'closed' && jsx('button', {
                    type: 'button',
                    className: 'dsh-fleet-panel-control-button',
                    'data-danger': 'true',
                    disabled: controlBusy !== undefined,
                    onClick: () => { setEndingTeam(true) },
                    children: '终结团队',
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
  const active = teams.filter(team => team.status === 'running' || team.status === 'starting' || team.status === 'finishing').length
  const attention = teams.filter(team => team.needsAttention === true).length
  const mounted = teams.filter(team => team.primaryWorkspace !== undefined).length
  return jsxs('section', {
    className: 'dsh-fleet-panel-detail',
    children: [
      jsxs('header', {
        className: 'dsh-fleet-panel-detail-head',
        children: [
          jsx('h2', { className: 'dsh-fleet-panel-detail-title', children: '团队首页' }),
          jsx('span', { className: 'dsh-fleet-panel-detail-meta', children: `${teams.length} 个团队` }),
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
            jsx('h3', { className: 'dsh-fleet-panel-overview-title', children: 'Fleet 团队' }),
            jsx('p', { className: 'dsh-fleet-panel-overview-copy', children: 'Team 是独立持久实体。工作区作为可挂载的执行资源，不决定团队的归属。' }),
            jsxs('div', {
              className: 'dsh-fleet-panel-facts',
              children: [
                jsx(Fact, { label: '活跃团队', value: `${active}` }),
                jsx(Fact, { label: '需要关注', value: `${attention}` }),
                jsx(Fact, { label: '已挂载工作区', value: `${mounted} / ${teams.length}` }),
              ],
            }),
            jsxs('div', {
              className: 'dsh-fleet-panel-home-team-list',
              children: [
                jsx(SectionTitle, { children: '所有团队' }),
                ...teams.map(team => jsx(ListRow, {
                  selected: owner.focusedTeamId === team.teamId,
                  title: team.teamName,
                  caption: [statusLabel(team.status), team.primaryWorkspace === undefined ? '未挂载工作区' : `主要工作区 · ${team.primaryWorkspace}`].join(' · '),
                  leading: jsx('span', { className: 'dsh-fleet-panel-team-row-status', 'data-status': team.status }),
                  trailing: team.needsAttention === true ? jsx('span', { className: 'dsh-fleet-panel-attention', title: '需要关注' }) : undefined,
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

function TeamMain(owner: FleetPanelPaneOwner): ReactElement {
  const [controlBusy, setControlBusy] = useState<'pause' | 'resume'>()
  const [controlError, setControlError] = useState<string>()
  const member = owner.snapshot.members.find(item => item.id === owner.activeItem)
  if (member === undefined) return jsx(PanelUnavailable, { label: '请选择一位成员' })
  const needsResume = member.runtimeStatus === 'paused' || member.runtimeStatus === 'offline'
    || member.runtimeStatus === 'unknown' || member.presence === 'offline' || member.presence === 'unknown'
  const controlMember = (): void => {
    if (owner.controlMember === undefined || controlBusy !== undefined) return
    const action = needsResume ? 'resume' : 'pause'
    setControlBusy(action)
    setControlError(undefined)
    void owner.controlMember(member.id, action).catch((reason: unknown) => {
      setControlError(reason instanceof Error ? reason.message : `无法${action === 'pause' ? '暂停' : '继续'}成员`)
    }).finally(() => { setControlBusy(undefined) })
  }
  return jsx(DetailShell, {
    title: member.name,
    meta: member.role,
    owner,
    children: jsxs('div', {
      className: 'dsh-fleet-panel-overview',
      children: [
        jsx('h3', { className: 'dsh-fleet-panel-overview-title', children: member.role }),
        jsx('p', { className: 'dsh-fleet-panel-overview-copy', children: member.responsibility }),
        jsxs('div', {
          className: 'dsh-fleet-panel-facts',
          children: [
            jsx(Fact, { label: '当前状态', value: jsx(MemberState, { member }) }),
            jsx(Fact, { label: '成员自述', value: member.statusText ?? '暂未填写工作状态' }),
            jsx(Fact, { label: '使用模型', value: member.model ?? '由 Agent 配置决定' }),
            jsx(Fact, { label: '模型提供方', value: member.provider ?? '由 Agent 配置决定' }),
            jsx(Fact, { label: '成员标识', value: member.id }),
            jsx(Fact, { label: '身份边界', value: 'Fleet 团队成员' }),
          ],
        }),
        owner.controlMember !== undefined && jsxs('div', {
          className: 'dsh-fleet-panel-overview-actions',
          children: [
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-control-button',
              'data-primary': needsResume ? 'true' : undefined,
              disabled: controlBusy !== undefined || owner.snapshot.status === 'paused',
              title: owner.snapshot.status === 'paused' ? '请先继续运行整个团队' : undefined,
              onClick: controlMember,
              children: controlBusy !== undefined
                ? (controlBusy === 'pause' ? '正在暂停…' : '正在恢复…')
                : (needsResume ? '继续成员' : '暂停成员'),
            }),
            controlError !== undefined && jsx('span', {
              className: 'dsh-fleet-panel-control-error',
              role: 'alert',
              children: controlError,
            }),
          ],
        }),
      ],
    }),
  })
}

function FleetNativeMemberChat({ owner, member, session }: {
  readonly owner: FleetPanelPaneOwner
  readonly member: FleetPanelMember
  readonly session: FleetNativeSessionFace
}): ReactElement {
  const scrollKey = `${owner.snapshot.teamId}:${member.sessionId ?? member.id}`
  const nativeCurrentRef = useRef(false)
  nativeCurrentRef.current = owner.useSessions(state => state.current === member.sessionId)
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
    useEffect(() => { boundFleetNativeSessionWindow(session, snapshot) }, [snapshot])
    return selector(snapshot)
  }
  const ChatView = NativeChatView
  const runtime = nativeChatRuntime
  if (ChatView === undefined || runtime === undefined || member.sessionId === undefined) {
    return jsx(PanelUnavailable, { label: '正在载入原生 ChatView…' })
  }
  const memberSessionId = member.sessionId
  return jsx('div', {
    className: 'dsh-fleet-panel-native-context',
    children: jsx('div', {
      className: 'dsh-fleet-panel-native-context-scroll',
      'data-conversation-scroll': '',
      children: jsx(ChatView, {
        useSession: useMemberSession,
        useSessions: runtime.useSessions,
        useStore: runtime.useStore ?? useNativeChatStore,
        renderSlot: runtime.renderSlot,
        sessionId: memberSessionId,
        openFile: (path: string) => owner.nativeContext.openFile(memberSessionId, path),
        loadOlder: () => { void session.loadOlder() },
        loadImage: (attachment: unknown) => owner.nativeContext.loadImage(memberSessionId, attachment),
        inspectCall: () => {},
        chatScroll: {
          save: (position: unknown) => {
            if (position === null) nativeChatScroll.delete(scrollKey)
            else rememberBounded(nativeChatScroll, scrollKey, position)
          },
          read: () => nativeChatScroll.get(scrollKey) ?? null,
        },
        forkAt: () => {},
        fileMentions: (target: unknown) => owner.nativeContext.fileMentions(target),
        t: runtime.t ?? owner.t,
      }),
    }),
  })
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
    return { label: '进入 Agent 上下文', text: clipTraceText(traceMessageText(message)) || '收到一条上下文消息', agent: false }
  }
  if (event.type === 'session.assistant/message') {
    return { label: 'Agent', text: clipTraceText(traceMessageText(message)) || '完成了一次模型响应', agent: true }
  }
  if (event.type === 'session.tool/call') {
    const name = typeof data.name === 'string' ? data.name : '工具'
    const args = typeof data.arguments === 'string' ? data.arguments : ''
    return { label: '工具调用', text: clipTraceText(args === '' ? name : `${name}\n${args}`), agent: true }
  }
  if (event.type === 'session.tool/result') {
    return { label: '工具结果', text: clipTraceText(traceMessageText(message)) || '工具已返回结果', agent: true }
  }
  if (event.type === 'session.turn/end') {
    const reason = typeof data.reason === 'object' && data.reason !== null
      ? JSON.stringify(data.reason)
      : '回合结束'
    return { label: '运行状态', text: reason, agent: true }
  }
  const readable = JSON.stringify(payload, null, 2)
  return {
    label: event.type.replace(/^session\./u, '').replaceAll('/', ' · '),
    text: readable === undefined || readable === '{}' ? '状态已更新' : clipTraceText(readable),
    agent: event.type !== 'session.user/message',
  }
}

function FleetPersistedMemberTrace({ owner, member }: {
  readonly owner: FleetPanelPaneOwner
  readonly member: FleetPanelMember
}): ReactElement {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly trace: FleetPanelMemberTrace }
    | { readonly status: 'error'; readonly message: string }
  >({ status: 'loading' })

  useEffect(() => {
    const load = owner.loadMemberTrace
    if (load === undefined) {
      setState({ status: 'error', message: '持久轨迹接口尚不可用' })
      return
    }
    const controller = new AbortController()
    setState(current => current.status === 'ready' ? current : { status: 'loading' })
    void load(owner.snapshot.teamId, member.id, controller.signal).then(trace => {
      if (!controller.signal.aborted) setState({ status: 'ready', trace })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ status: 'error', message: error instanceof Error ? error.message : '无法读取 Agent 持久轨迹' })
      }
    })
    return () => { controller.abort(new Error('Agent trace view changed')) }
  }, [attempt, member.id, owner.loadMemberTrace, owner.snapshot.teamId])

  if (state.status !== 'ready') {
    return jsxs('div', {
      className: 'dsh-fleet-panel-trace-state',
      role: state.status === 'error' ? 'alert' : 'status',
      children: [
        jsx('span', { children: state.status === 'loading' ? '正在读取持久执行上下文…' : state.message }),
        state.status === 'error' && jsx('button', {
          type: 'button',
          className: 'dsh-fleet-panel-trace-retry',
          onClick: () => { setAttempt(current => current + 1) },
          children: '重试',
        }),
      ],
    })
  }
  return jsxs('div', {
    className: 'dsh-fleet-panel-trace',
    children: [
      jsx('p', {
        className: 'dsh-fleet-panel-trace-note',
        children: state.trace.truncated
          ? '当前成员不在线；以下为持久轨迹中最近的执行上下文。较早记录仍保存在 Fleet 中。'
          : '当前成员不在线；以下内容来自 Fleet 持久轨迹。',
      }),
      jsx('div', {
        className: 'dsh-fleet-panel-trace-list',
        role: 'log',
        'aria-label': `${member.name} 的持久执行上下文`,
        children: state.trace.events.length === 0
          ? jsx('div', { className: 'dsh-fleet-panel-empty', children: '这个 Agent 还没有持久执行记录' })
          : state.trace.events.map(event => {
              const presentation = traceEventPresentation(event)
              return jsxs('article', {
                className: 'dsh-fleet-panel-trace-event',
                'data-agent': presentation.agent ? 'true' : 'false',
                children: [
                  jsxs('div', {
                    className: 'dsh-fleet-panel-trace-event-meta',
                    children: [
                      jsx('span', { children: presentation.label }),
                      jsx('time', {
                        className: 'dsh-fleet-panel-trace-event-time',
                        dateTime: event.createdAt,
                        children: new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      }),
                    ],
                  }),
                  jsx('div', { className: 'dsh-fleet-panel-trace-event-body', children: presentation.text }),
                ],
              }, event.sequence)
            }),
      }),
    ],
  })
}

function AgentContextMain({ owner, member }: {
  readonly owner: FleetPanelPaneOwner
  readonly member: FleetPanelMember
}): ReactElement {
  const sessionListed = owner.useSessions(state => member.sessionId !== undefined && state.byId[member.sessionId] !== undefined)
  const session = member.sessionId === undefined || !sessionListed
    ? undefined
    : owner.nativeContext.session(member.sessionId)
  return jsxs('section', {
    className: 'dsh-fleet-panel-chat',
    children: [
      jsx(FleetConversationHeader, {
        kind: 'context',
        name: '执行上下文',
        description: session === undefined
          ? '成员离线时从 Fleet 持久轨迹恢复最近上下文'
          : '复用原生 ChatView，只读呈现这个 Agent 的真实 Session',
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
      session === undefined
        ? jsx(FleetPersistedMemberTrace, { owner, member }, `${owner.snapshot.teamId}:${member.id}`)
        : jsx(owner.SessionProvider, {
            sessionId: member.sessionId,
            empty: () => jsx(PanelUnavailable, { label: '成员 Session 当前不在 DSH 可见范围内' }),
            children: () => jsx(FleetNativeMemberChat, { owner, member, session }),
          }),
      jsx('div', {
        className: 'dsh-fleet-panel-agent-readonly',
        role: 'status',
        children: session === undefined
          ? `以 ${member.name} 的视角查看持久轨迹 · 只读`
          : `以 ${member.name} 的视角查看原生 Session · 只读`,
      }),
    ],
  })
}

function AgentMain(owner: FleetPanelPaneOwner): ReactElement {
  const { member, conversation, context } = parseAgentViewItem(owner.snapshot, owner.activeItem)
  if (member === undefined) return jsx(PanelUnavailable, { label: '请选择一位 Agent' })
  if (context) return jsx(AgentContextMain, { owner, member })
  if (conversation === undefined) return jsx(PanelUnavailable, { label: '这个 Agent 当前没有可见消息' })
  const peer = agentConversationPeer(owner.snapshot, member, conversation)
  const members = new Map(owner.snapshot.members.map(candidate => [candidate.id, candidate]))
  members.set(operator.id, operator)
  const messages = owner.snapshot.messages.filter(message => message.conversationId === conversation.id)
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
        children: jsx('div', {
          className: 'dsh-fleet-panel-agent-chat-column',
          role: 'log',
          'aria-live': 'polite',
          children: messages.length === 0
            ? jsx('div', { className: 'dsh-fleet-panel-empty', children: '这里还没有消息' })
            : messages.map(message => {
                const sender = message.sender ?? members.get(message.senderId)
                if (sender === undefined) return null
                const senderMember = owner.snapshot.members.find(candidate => candidate.id === sender.id)
                const messageOwner: FleetPanelMessageOwner = { panel: owner, conversation, message, sender }
                return jsx('div', {
                  className: 'dsh-fleet-panel-agent-message-row',
                  'data-self': sender.id === member.id ? 'true' : 'false',
                  children: jsx(FleetChatMessage, {
                    id: message.id,
                    sender,
                    sentAt: message.sentAt,
                    content: message.content,
                    ...(message.receipt === undefined ? {} : {
                      receipt: messageReadReceipt(owner.snapshot, message.receipt),
                    }),
                    ...(senderMember === undefined ? {} : {
                      avatar: jsx(FleetMemberAvatarPopover, { member: senderMember, showDetails: owner.showMemberDetails }),
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
                  }),
                }, message.id)
              }),
        }),
      }),
      jsx('div', {
        className: 'dsh-fleet-panel-agent-readonly',
        role: 'status',
        children: `以 ${member.name} 的视角查看 · 只读`,
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
      setError(reason instanceof Error ? reason.message : '无法打开这个路径')
    }).finally(() => { setOpening(false) })
  }
  return jsxs('div', {
    className: appearance === 'link' ? 'dsh-fleet-panel-resource-path-wrap' : 'dsh-fleet-panel-overview-actions',
    children: [
      jsxs('button', {
        type: 'button',
        className: appearance === 'link' ? 'dsh-fleet-panel-resource-path' : 'dsh-fleet-panel-enter-messages',
        disabled: opening,
        onClick: open,
        children: [
          appearance === 'button' && jsx(PanelIcon, { name: 'resources', size: 15 }),
          jsx('span', { children: opening ? '正在打开…' : label }),
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

type FleetResourceContentMode = 'rendered' | 'source' | 'compare'

function ResourceContentPreview({ owner, resource, content, loading, error, onRetry, mode }: {
  readonly owner: FleetPanelPaneOwner
  readonly resource: FleetPanelResource
  readonly content?: FleetPanelResourceContent
  readonly loading: boolean
  readonly error?: string
  readonly onRetry: () => void
  readonly mode: FleetResourceContentMode
}): ReactElement | null {
  const previewKind = fleetResourcePreviewKind(resource)
  if (previewKind === undefined) return null
  if (loading) return jsx('div', {
    className: 'dsh-fleet-panel-resource-preview-status',
    role: 'status',
    children: '正在读取文件…',
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
        children: '重新读取',
      }),
    ],
  })
  if (content === undefined) return null
  if (content.body.length === 0) return jsx('div', {
    className: 'dsh-fleet-panel-resource-preview-status',
    children: '文件为空',
  })

  const mediaType = content.mediaType ?? resource.mediaType
  const previewResource: FleetPanelResource = {
    ...resource,
    body: content.body,
    ...(mediaType === undefined ? {} : { mediaType }),
  }
  const previewOwner: FleetPanelResourcePreviewOwner = { panel: owner, resource: previewResource }
  const source = jsx('pre', {
    className: 'dsh-fleet-panel-resource-preview-plain',
    children: content.body,
  })
  const rendered = owner.renderPanelSlot(
    FLEET_PANEL_SLOTS.resourcePreview,
    previewOwner as unknown as Record<string, unknown>,
    { entryKey: content.kind === 'markdown' ? 'text/markdown' : content.mediaType ?? 'text/plain', fallback: source },
  )
  return jsx('div', {
    className: 'dsh-fleet-panel-resource-preview',
    'data-mode': mode,
    children: mode === 'source'
      ? source
      : mode === 'compare'
        ? jsxs('div', {
            className: 'dsh-fleet-panel-resource-compare',
            children: [
              jsxs('section', {
                children: [
                  jsx('h3', { children: '源码' }),
                  jsx('div', { className: 'dsh-fleet-panel-resource-compare-body', children: source }),
                ],
              }),
              jsxs('section', {
                children: [
                  jsx('h3', { children: '渲染效果' }),
                  jsx('div', { className: 'dsh-fleet-panel-resource-compare-body', children: rendered }),
                ],
              }),
            ],
          })
        : rendered,
  })
}

function resourceMember(owner: FleetPanelPaneOwner, actorId: string): FleetPanelMember | undefined {
  return owner.snapshot.members.find(member => member.id === actorId || member.sessionId === actorId)
}

function ResourceDiffFallback({ revision }: { readonly revision: FleetPanelResourceRevision }): ReactElement {
  return jsxs('div', {
    className: 'dsh-fleet-panel-resource-diff-fallback',
    children: [
      jsxs('section', {
        children: [
          jsx('h3', { children: revision.before === null ? '创建前' : '修改前' }),
          jsx('pre', { children: revision.before ?? '文件不存在' }),
        ],
      }),
      jsxs('section', {
        children: [
          jsx('h3', { children: '修改后' }),
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
    children: '正在读取变更历史…',
  })
  if (history.length === 0 && error !== undefined) return jsxs('div', {
    className: 'dsh-fleet-panel-resource-preview-error',
    role: 'alert',
    children: [
      jsx('span', { children: error }),
      jsx('button', { type: 'button', className: 'dsh-fleet-panel-resource-preview-retry', onClick: retry, children: '重新读取' }),
    ],
  })
  if (history.length === 0) return jsx('div', {
    className: 'dsh-fleet-panel-resource-history-empty',
    children: '暂时没有可归属到团队成员的文件变更',
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
                jsx('strong', { children: '这次变更未载入正文' }),
                jsx('span', { children: `前后版本合计 ${formatBytes(selectedSummary.size)}，超过 2 MiB 的变更只保留时间与来源。` }),
              ],
            })
          : loading
          ? jsx('div', { className: 'dsh-fleet-panel-resource-preview-status', role: 'status', children: '正在读取变更…' })
          : error !== undefined
            ? jsxs('div', {
                className: 'dsh-fleet-panel-resource-preview-error',
                role: 'alert',
                children: [
                  jsx('span', { children: error }),
                  jsx('button', { type: 'button', className: 'dsh-fleet-panel-resource-preview-retry', onClick: retry, children: '重新读取' }),
                ],
              })
            : revision === undefined || diffOwner === undefined
              ? jsx('div', { className: 'dsh-fleet-panel-resource-preview-status', children: '请选择一条变更' })
              : owner.renderPanelSlot(
                  FLEET_PANEL_SLOTS.resourceDiff,
                  diffOwner as unknown as Record<string, unknown>,
                  { entryKey: 'text', fallback: jsx(ResourceDiffFallback, { revision }) },
                ),
      }),
      jsxs('aside', {
        className: 'dsh-fleet-panel-resource-timeline',
        'aria-label': '文件变更时间轴',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-panel-resource-timeline-head',
            children: [
              jsx('h3', { className: 'dsh-fleet-panel-resource-timeline-title', children: '变更时间轴' }),
              historyTruncated && jsx('span', { children: '最近 500 条' }),
            ],
          }),
          jsx('div', {
            className: 'dsh-fleet-panel-resource-timeline-list',
            children: history.map(item => {
              const member = resourceMember(owner, item.updatedBy)
              return jsxs('button', {
                type: 'button',
                className: 'dsh-fleet-panel-resource-revision',
                'aria-pressed': selectedId === item.id,
                onClick: () => { selectRevision(item.id) },
                children: [
                  jsx('span', { className: 'dsh-fleet-panel-resource-revision-dot', 'aria-hidden': 'true' }),
                  jsxs('span', {
                    className: 'dsh-fleet-panel-resource-revision-copy',
                    children: [
                      jsx('strong', { children: member?.name ?? item.updatedBy }),
                      jsx('span', { children: item.operation === 'created' ? '创建了文件' : '修改了文件' }),
                      !item.available && jsx('span', { children: `${formatBytes(item.size)} · 正文未载入` }),
                      jsx('time', {
                        dateTime: item.updatedAt,
                        children: new Date(item.updatedAt).toLocaleString([], {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        }),
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

function ResourceDetailMain({ owner, resource }: {
  readonly owner: FleetPanelPaneOwner
  readonly resource: FleetPanelResource
}): ReactElement {
  const [view, setView] = useState<'content' | 'history'>('content')
  const [contentMode, setContentMode] = useState<FleetResourceContentMode>('rendered')
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
      reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '无法读取团队文件') },
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
        if (!controller.signal.aborted) setRevisionError(reason instanceof Error ? reason.message : '无法读取这次变更')
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
  const exportContent = (): void => {
    if (content === undefined) return
    const url = URL.createObjectURL(new Blob([content.body], { type: content.mediaType ?? resource.mediaType ?? 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = resource.name
    link.click()
    URL.revokeObjectURL(url)
  }

  const size = content?.size ?? resource.size
  const kindLabel = resource.kind === 'plan' ? '团队计划' : resource.kind === 'checklist' ? '交付检查' : '共享文件'
  const meta = jsxs('div', {
    className: 'dsh-fleet-panel-resource-meta',
    children: [
      jsx('span', { children: kindLabel }),
      size !== undefined && jsx('span', { children: formatBytes(size) }),
      jsx(OpenFleetPath, { owner, path: resource.path, label: resource.path, appearance: 'link' }),
    ],
  })
  const isMarkdown = previewKind === 'markdown'
  const selectContentMode = (mode: FleetResourceContentMode): void => {
    setContentMode(mode)
    setView('content')
  }
  const viewSwitch = jsxs('div', {
    className: 'dsh-fleet-panel-resource-view-switch',
    role: 'group',
    'aria-label': isMarkdown ? 'Markdown 文件视图' : '文件视图',
    children: [
      jsx('button', {
        type: 'button',
        'aria-pressed': view === 'content' && (!isMarkdown || contentMode === 'rendered'),
        onClick: () => { selectContentMode(isMarkdown ? 'rendered' : 'source') },
        children: isMarkdown ? '渲染' : '内容',
      }),
      isMarkdown && jsx('button', {
        type: 'button',
        'aria-pressed': view === 'content' && contentMode === 'source',
        onClick: () => { selectContentMode('source') },
        children: '源码',
      }),
      isMarkdown && jsx('button', {
        type: 'button',
        'aria-pressed': view === 'content' && contentMode === 'compare',
        onClick: () => { selectContentMode('compare') },
        children: '对照',
      }),
      jsx('button', {
        type: 'button',
        'aria-pressed': view === 'history',
        onClick: () => { setView('history') },
        children: `历史${content?.history.length === undefined ? '' : ` ${content.history.length}`}`,
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
            disabled: content === undefined,
            'aria-label': copyState === 'copied' ? '已复制文件内容' : '复制文件内容',
            title: copyState === 'copied' ? '已复制' : copyState === 'error' ? '复制失败' : '复制源码',
            onClick: copyContent,
            children: jsx(PanelIcon, { name: 'copy', size: 15 }),
          }),
          jsx('button', {
            type: 'button',
            disabled: content === undefined,
            'aria-label': '导出文件',
            title: '导出文件',
            onClick: exportContent,
            children: jsx(PanelIcon, { name: 'download', size: 15 }),
          }),
          jsx('span', {
            className: 'dsh-fleet-panel-resource-action-status',
            role: 'status',
            'aria-live': 'polite',
            children: copyState === 'copied' ? '已复制' : copyState === 'error' ? '复制失败' : '',
          }),
        ],
      }),
    ],
  })
  const preview = jsx(ResourceContentPreview, {
    owner, resource, content, loading, error,
    mode: isMarkdown ? contentMode : 'source',
    onRetry: () => { setAttempt(current => current + 1) },
  })
  return jsx(DetailShell, {
    title: resource.name,
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
            resizable: true,
            resizeLabel: '调整 Markdown 阅读宽度',
            initialScroll: 'top',
            children: jsx('div', { className: 'dsh-fleet-panel-resource-content', children: preview }),
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
    if (workspace === undefined) return jsx(PanelUnavailable, { label: '请选择一个团队文件或工作区' })
    return jsx(DetailShell, {
      title: workspace.name,
      meta: workspace.access === 'write' ? '可写工作区' : '只读工作区',
      owner,
      children: jsxs('div', {
        className: 'dsh-fleet-panel-overview',
        children: [
          jsx('h3', { className: 'dsh-fleet-panel-overview-title', children: '工作区文件' }),
          jsx('p', { className: 'dsh-fleet-panel-overview-copy', children: '普通文件按需通过 DSH 工作区浏览，不会自动加入团队共享。' }),
          jsxs('div', {
            className: 'dsh-fleet-panel-facts',
            children: [
              jsx(Fact, { label: '路径', value: workspace.path }),
              jsx(Fact, { label: '团队成员', value: `${workspace.members.length} 位` }),
            ],
          }),
          jsx(OpenFleetPath, { owner, path: workspace.path, label: '打开工作区' }),
        ],
      }),
    })
  }
  return jsx(ResourceDetailMain, { owner, resource })
}

function ActivityMain(owner: FleetPanelPaneOwner): ReactElement {
  const activity = owner.activeItem === 'all'
    ? owner.snapshot.activity
    : owner.snapshot.activity.filter(item => item.kind === owner.activeItem)
  return jsx(DetailShell, {
    title: '团队动态',
    meta: `${activity.length} 条记录`,
    owner,
    children: jsx('div', {
      className: 'dsh-fleet-panel-overview',
      children: activity.length === 0
        ? jsx('div', { className: 'dsh-fleet-panel-empty', children: '当前筛选下没有动态' })
        : activity.map(item => jsxs('div', {
            className: 'dsh-fleet-panel-activity-row',
            children: [
              jsx('span', { className: 'dsh-fleet-panel-activity-dot', 'data-kind': item.kind }),
              jsx('span', { className: 'dsh-fleet-panel-activity-copy', children: item.text }),
              jsx('time', {
                className: 'dsh-fleet-panel-activity-time',
                dateTime: item.createdAt,
                children: new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              }),
            ],
          }, item.id)),
    }),
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
        button.setAttribute('aria-label', `${segment.text}，查看 ${segment.member.name} 的成员信息`)
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

function FleetRenderEngineMessageText({ panel, text, markdownRenderer }: FleetRenderEngineMessageTextProps): ReactElement {
  const [html, setHtml] = useState<string>()
  const [memberId, setMemberId] = useState<string>()
  const controller = useFleetMemberPopover()
  const mentionSignature = panel.snapshot.members.map(candidate => `${candidate.id}\u0000${candidate.name}`).join('\u0001')
  const member = panel.snapshot.members.find(candidate => candidate.id === memberId)

  useEffect(() => {
    let active = true
    setHtml(undefined)
    void markdownRenderer.render({ markdown: text, mode: 'render-friendly' }).then(
      rendered => {
        if (!active) return
        const prepared = prepareFleetMarkdown(rendered.html, panel.snapshot.members)
        installFleetRenderEngineStyles(prepared.css)
        setHtml(prepared.html)
      },
      () => {
        if (active) setHtml(undefined)
      },
    )
    return () => { active = false }
  }, [markdownRenderer, mentionSignature, text])

  if (html === undefined) return jsx(FleetPlainMessageText, { owner: panel, text })
  return jsxs(Fragment, {
    children: [
      jsx('div', {
        className: 'dsh-fleet-rendered-message',
        onClick: (event: { readonly target: EventTarget | null }) => {
          const target = event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-member-id].dsh-fleet-panel-member-mention')
            : null
          if (target === null) return
          const selected = panel.snapshot.members.find(candidate => candidate.id === target.dataset.memberId)
          if (selected === undefined) return
          setMemberId(selected.id)
          window.requestAnimationFrame(() => { controller.openAt(target) })
        },
        dangerouslySetInnerHTML: { __html: html },
      }),
      member !== undefined && jsx(FleetMemberPopoverCard, {
        member,
        controller,
        showDetails: panel.showMemberDetails,
      }),
    ],
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
}

export interface FleetModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface FleetModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly FleetModelCatalogModel[]
}

export interface FleetModelDirectoryState {
  readonly current: { readonly provider: string; readonly model: string } | null
  readonly routable: boolean | null
  readonly groups: readonly FleetModelProviderGroup[]
  readonly failures: readonly unknown[]
  readonly status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  readonly error: string | null
}

export interface FleetModelDirectory {
  readonly store: {
    getSnapshot(): FleetModelDirectoryState
    subscribe(listener: () => void): () => void
  }
  load(): Promise<unknown>
}

interface FleetModelDirectoryResolver {
  directoryFor(sessionId: string): FleetModelDirectory
}

let fleetModelDirectoryResolver: FleetModelDirectoryResolver | undefined

export function getFleetModelDirectory(sessionId: string | undefined): FleetModelDirectory | undefined {
  if (sessionId === undefined || fleetModelDirectoryResolver === undefined) return undefined
  try {
    return fleetModelDirectoryResolver.directoryFor(sessionId)
  } catch {
    return undefined
  }
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
  } | undefined
  const workspaces = ctx.workspaces as unknown as { openPath(path: string): Promise<void> } | undefined
  return {
    session: sessionId => sessions?.binding(sessionId)?.session,
    openPath: path => workspaces?.openPath(path)
      ?? Promise.reject(new Error('DSH 工作区文件服务不可用')),
    openFile: (sessionId, path) => {
      const cwd = sessions?.list.getSnapshot().byId[sessionId]?.cwd
      return workspaces?.openPath(resolveMemberFilePath(cwd, path))
        ?? Promise.reject(new Error('DSH 工作区文件服务不可用'))
    },
    loadImage: (sessionId, attachment) => {
      const conversation = ctx.get?.('conversation') as {
        resolveImage(sessionId: string, attachment: unknown): Promise<string>
      } | undefined
      return conversation?.resolveImage(sessionId, attachment)
        ?? Promise.reject(new Error('DSH 会话图片服务不可用'))
    },
    fileMentions: owner => {
      const mentions = ctx.get?.('chatFileMentions') as { forClosing(owner: unknown): unknown } | undefined
      return mentions?.forClosing(owner)
    },
  }
}

export const inject = ['slots', 'sessions', 'workspaces', 'remote', 'typert'] as const

export async function apply(ctx: FleetPanelClientContext): Promise<() => Promise<void>> {
  const disposeConfigurationModules = ctx.provide?.('fleetConfigurationModules', fleetConfigurationModules)
  const modelDirectoryResolver = ctx.get?.('modelDirectories') as FleetModelDirectoryResolver | undefined
  fleetModelDirectoryResolver = modelDirectoryResolver
  configureFleetActivationSessions(
    (ctx.sessions ?? ctx.get?.('sessions')) as FleetActivationClientSessions | undefined,
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
  configureFleetWebClient(fleetWeb)
  const injectedSource = ctx.get?.(FLEET_PANEL_SOURCE_SERVICE) as FleetPanelSource | undefined
  const source = injectedSource ?? createFleetWebPanelSource(() => Promise.resolve(fleetWeb))
  new FleetWebPeerRemote(ctx as unknown as Context, source)
  const disposePeerLocal = ctx.typert.register(FLEET_WEB_PEER_LOCAL)
  teamDirectorySource = source
  const nativeContext = createFleetNativeContext(ctx)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'fleet',
    order: 20,
    label: () => '团队',
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
      nativeContext,
    }),
  }, FleetTeamPanel))

  ctx.inject<{ readonly markdownRenderer: FleetMarkdownRenderer }>(['markdownRenderer'], rendererCtx => {
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
    disposeConfigurationModules?.()
    if (fleetModelDirectoryResolver === modelDirectoryResolver) fleetModelDirectoryResolver = undefined
    configureFleetWebClient(undefined)
    if (teamDirectorySource === source) teamDirectorySource = undefined
    if (injectedSource === undefined && 'dispose' in source && typeof source.dispose === 'function') source.dispose()
    await disposePeerLocal()
    await disposeRemote()
  }
}
