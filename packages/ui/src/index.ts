import type {
  ChangeEvent,
  ComponentType,
  CSSProperties,
  DragEvent as ReactDragEvent,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from 'react'
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import {
  FLEET_MEMBER_COLOR_PRESETS,
  generateFleetMemberColor,
  generateMemberDisplayName,
  normalizeFleetMemberColor,
} from '@dsh-agent-fleet/core/names'
import {
  clearFleetActivation,
  consumeFleetActivation,
  fleetExistingAssistantRoute,
  getCurrentFleetSessionId,
  getFleetActivationSnapshot,
  openFleetSession,
  recoverFleetActivationDraft,
  stageFleetActivation,
  subscribeFleetActivation,
  subscribeCurrentFleetSession,
} from './activation.js'
import {
  type FieldContentPreset,
  type FieldPresetCollection,
  type FieldPresetTarget,
  mergeFieldPresetImport,
  parseFieldPresetImport,
} from './field-presets.js'
import { fleetText, isChineseLocale } from './locale.js'
import { FleetMark } from './fleet-mark.js'
import { FULL_TEAM_TEMPLATES } from './team-templates.generated.js'
import {
  FLEET_MESSAGE_CONFIGURATION_MODULE,
  FLEET_RESOURCES_CONFIGURATION_MODULE,
  FLEET_UI_CONFIGURATION_MODULE,
  fleetConfigurationModules,
} from './configuration-modules.js'
import {
  activeFleetCommandQuery,
  captureFleetOfficialComposer,
  configureFleetAssistantSessionModel,
  fleetPrivateConversationCommands,
  FleetBudgetMeter,
  getFleetAssistantDisplayName,
  getFleetModelDirectory,
  getFleetTeamDirectorySnapshot,
  parseFleetConversationCommand,
  subscribeFleetTeamDirectory,
  type FleetModelDirectory,
  type FleetModelDirectoryState,
  type FleetPanelTeamSummary,
} from './team-panel.js'
import { useFleetMetaAssistantSession } from './meta-assistant.js'
import { uploadFleetSetupFile } from './web-client.js'

const STYLE_ID = 'dsh-agent-fleet-team-entry'

const styles = `
.dsh-fleet-team-root {
  display: contents;
}

.dsh-fleet-meta-composer-marker {
  display: none;
}

.dsh-fleet-assistant-composer-status {
  color: var(--dsw-alias-label-tertiary);
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-assistant-composer-status[data-error="true"] {
  color: var(--dsw-alias-state-error-primary);
}

body:has(.dsh-fleet-meta-composer-marker) [class*="_heroWorkspaceRow"] {
  display: none;
}

.dsh-fleet-team-button {
  box-sizing: border-box;
  min-width: 0;
  min-height: 28px;
  max-width: min(100%, 320px);
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  overflow: hidden;
}

.dsh-fleet-team-button:hover,
.dsh-fleet-team-button[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-team-button[data-mode] {
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 11%, transparent);
}

.dsh-fleet-team-button[data-mode]:hover,
.dsh-fleet-team-button[data-mode][aria-expanded="true"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
}

.dsh-fleet-team-button:focus {
  outline: none;
}

.dsh-fleet-team-button:focus-visible {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-state-business-primary);
}

.dsh-fleet-team-button svg {
  flex: none;
}

button[data-dsh-fleet-workspace-required="true"] {
  animation: dsh-fleet-workspace-required 760ms cubic-bezier(.16, 1, .3, 1);
}

.dsh-fleet-workspace-warning {
  z-index: 1200;
  max-width: min(240px, calc(100vw - 24px));
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-menu);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  box-shadow: var(--dsw-shadow-lv2);
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  position: fixed;
  transform: translateX(-50%);
  animation: dsh-fleet-workspace-warning-in 160ms cubic-bezier(.16, 1, .3, 1) both;
}

.dsh-fleet-workspace-warning::before {
  content: "";
  width: 7px;
  height: 7px;
  background: var(--dsw-specific-menu);
  border-top: 1px solid var(--dsw-alias-border-l2);
  border-left: 1px solid var(--dsw-alias-border-l2);
  position: absolute;
  top: -5px;
  left: calc(50% - 4px);
  transform: rotate(45deg);
}

.dsh-fleet-team-label {
  min-width: 0;
  text-overflow: ellipsis;
  overflow: hidden;
}

.dsh-fleet-team-chevron {
  color: var(--dsw-alias-label-caption);
}

.dsh-fleet-team-button[data-mode] .dsh-fleet-team-chevron {
  color: currentColor;
  opacity: .68;
}

.dsh-fleet-team-active {
  cursor: default;
  animation: dsh-fleet-team-expand 260ms cubic-bezier(.16, 1, .3, 1) both;
}

.dsh-fleet-team-active[data-mode]:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 11%, transparent);
}

.dsh-fleet-team-cancel {
  width: 18px;
  height: 18px;
  color: currentColor;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 50%;
  flex: none;
  justify-content: center;
  align-items: center;
  margin-right: -2px;
  padding: 0;
  display: inline-flex;
}

.dsh-fleet-team-cancel:hover {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);
}

.dsh-fleet-team-cancel:focus-visible {
  outline: 1px solid currentColor;
  outline-offset: 1px;
}

@keyframes dsh-fleet-team-expand {
  from {
    max-width: 112px;
  }

  to {
    max-width: min(100%, 320px);
  }
}

@keyframes dsh-fleet-workspace-required {
  0%, 100% {
    box-shadow: inset 0 0 0 1px transparent;
  }

  28%, 72% {
    box-shadow: inset 0 0 0 1px var(--dsw-alias-state-business-primary);
  }
}

@keyframes dsh-fleet-workspace-warning-in {
  from {
    opacity: 0;
    transform: translate(-50%, -3px);
  }

  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-fleet-team-active,
  .dsh-fleet-assistant-notice,
  .dsh-fleet-workspace-warning,
  button[data-dsh-fleet-workspace-required="true"] {
    animation: none;
  }
}

.dsh-fleet-team-menu {
  box-sizing: border-box;
  z-index: 1100;
  width: 304px;
  max-width: calc(100vw - 16px);
  background: var(--dsw-specific-menu);
  border: 1px solid transparent;
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv3);
  flex-direction: column;
  padding: 4px;
  display: flex;
  position: fixed;
}

.dsh-fleet-team-menu-item {
  box-sizing: border-box;
  width: 100%;
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 10px;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  font: inherit;
  display: flex;
}

.dsh-fleet-team-menu-item:hover,
.dsh-fleet-team-menu-item:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}

.dsh-fleet-team-menu-copy {
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  display: flex;
}

.dsh-fleet-team-menu-name {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.dsh-fleet-team-menu-description {
  color: var(--dsw-alias-label-caption);
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
}

.dsh-fleet-team-check {
  color: var(--dsw-alias-label-primary);
  flex: none;
}

.dsh-fleet-team-submenu {
  box-sizing: border-box;
  z-index: 1101;
  width: 276px;
  max-width: calc(100vw - 16px);
  max-height: min(320px, calc(100dvh - 16px));
  scrollbar-color: var(--dsw-alias-fill-secondary) transparent;
  scrollbar-width: thin;
  background: var(--dsw-specific-menu);
  border: 1px solid transparent;
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv3);
  padding: 4px;
  position: fixed;
  overflow-y: auto;
}

.dsh-fleet-team-submenu::-webkit-scrollbar {
  width: 8px;
}

.dsh-fleet-team-submenu::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-fill-secondary);
  border: 2px solid transparent;
  border-radius: 8px;
  background-clip: padding-box;
}

.dsh-fleet-team-submenu-item,
.dsh-fleet-team-submenu-empty {
  box-sizing: border-box;
  width: 100%;
  min-height: 48px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  border: 0;
  border-radius: 9px;
  padding: 7px 10px;
  font: inherit;
  text-align: left;
}

.dsh-fleet-team-submenu-item {
  cursor: pointer;
  align-items: center;
  gap: 9px;
  display: flex;
}

.dsh-fleet-team-submenu-item:hover,
.dsh-fleet-team-submenu-item:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}

.dsh-fleet-team-submenu-item:disabled {
  cursor: default;
  opacity: .48;
}

.dsh-fleet-team-submenu-item:disabled:hover {
  background: transparent;
}

.dsh-fleet-team-submenu-dot {
  width: 7px;
  height: 7px;
  background: var(--dsh-fleet-team-color, var(--dsw-alias-label-caption));
  border-radius: 50%;
  flex: none;
}

.dsh-fleet-team-submenu-copy {
  min-width: 0;
  flex: 1;
}

.dsh-fleet-team-submenu-name,
.dsh-fleet-team-submenu-status {
  white-space: nowrap;
  text-overflow: ellipsis;
  display: block;
  overflow: hidden;
}

.dsh-fleet-team-submenu-name {
  font-size: 13px;
  font-weight: 500;
  line-height: 19px;
}

.dsh-fleet-team-submenu-status,
.dsh-fleet-team-submenu-empty {
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-team-submenu-empty {
  min-height: 0;
  cursor: default;
}

.dsh-fleet-assistant-notice {
  box-sizing: border-box;
  z-index: 1102;
  max-width: calc(100vw - 16px);
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-menu);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv3);
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  display: flex;
  position: fixed;
  overflow-y: auto;
  animation: dsh-fleet-assistant-notice-in 160ms cubic-bezier(.16, 1, .3, 1) both;
}

.dsh-fleet-assistant-notice-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.dsh-fleet-assistant-notice-copy,
.dsh-fleet-assistant-notice-error {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-assistant-notice-copy {
  color: var(--dsw-alias-label-secondary);
}

.dsh-fleet-assistant-notice-error {
  color: var(--dsw-alias-state-error-primary, #d83a3a);
}

.dsh-fleet-assistant-notice-actions {
  flex-direction: column;
  gap: 6px;
  display: flex;
}

.dsh-fleet-assistant-notice-action {
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
  padding: 6px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
}

.dsh-fleet-assistant-notice-action:hover,
.dsh-fleet-assistant-notice-action:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}

.dsh-fleet-assistant-notice-action[data-primary="true"] {
  color: var(--dsw-alias-label-on-primary, white);
  background: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-assistant-notice-action[data-primary="true"]:hover,
.dsh-fleet-assistant-notice-action[data-primary="true"]:focus-visible {
  background: var(--dsw-alias-state-business-primary-hover, var(--dsw-alias-state-business-primary));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, white 28%, transparent);
}

@keyframes dsh-fleet-assistant-notice-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dsh-fleet-config-overlay {
  z-index: 1200;
  justify-content: center;
  align-items: center;
  display: flex;
  position: fixed;
  inset: 0;
}

.dsh-fleet-config-mask {
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur);
  position: absolute;
  inset: 0;
}

.dsh-fleet-quick-panel {
  box-sizing: border-box;
  z-index: 1;
  width: min(820px, calc(100vw - 32px));
  height: min(520px, calc(100dvh - 32px));
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 16px;
  box-shadow: var(--dsw-shadow-lv3);
  flex-direction: column;
  display: flex;
  position: relative;
  overflow: hidden;
}

.dsh-fleet-quick-header {
  flex: none;
  padding: 20px 24px 14px;
}

.dsh-fleet-quick-title {
  color: var(--dsw-alias-label-primary);
  margin: 0;
  font-size: 16px;
  font-weight: 510;
  line-height: 24px;
}

.dsh-fleet-quick-intro {
  color: var(--dsw-alias-label-tertiary);
  margin: 3px 0 0;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-quick-workspace {
  flex: 1;
  min-height: 0;
  grid-template-columns: minmax(220px, 270px) minmax(0, 1fr);
  gap: 18px;
  padding: 0 24px 20px;
  display: grid;
}

.dsh-fleet-quick-list {
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  padding: 6px;
  overflow-y: auto;
}

.dsh-fleet-quick-list[data-import-active="true"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-layer-1));
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-quick-list-heading {
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
  margin-top: -3px;
  display: flex;
}

.dsh-fleet-quick-list-label {
  color: var(--dsw-alias-label-tertiary);
  margin: 0 7px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}

.dsh-fleet-quick-import {
  height: 24px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0 7px;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-quick-import:hover,
.dsh-fleet-quick-import:focus-visible {
  color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}

.dsh-fleet-quick-options {
  gap: 4px;
  display: grid;
}

.dsh-fleet-quick-option-row {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  display: grid;
}

.dsh-fleet-quick-option-row:not(:has(.dsh-fleet-quick-remove)) {
  grid-template-columns: minmax(0, 1fr);
}

.dsh-fleet-quick-option {
  box-sizing: border-box;
  width: 100%;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 9px;
  padding: 9px 10px;
  font: inherit;
  text-align: left;
  display: block;
}

.dsh-fleet-quick-option:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-quick-option[aria-selected="true"] {
  background: var(--dsw-specific-sidebar-nav-item-active);
}

.dsh-fleet-quick-option:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}

.dsh-fleet-quick-option-name,
.dsh-fleet-quick-option-summary {
  display: block;
}

.dsh-fleet-quick-option-heading {
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  display: flex;
}

.dsh-fleet-quick-option-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.dsh-fleet-quick-option-origin {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  font-weight: 400;
  line-height: 16px;
}

.dsh-fleet-quick-remove {
  width: 26px;
  height: 26px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  justify-content: center;
  align-items: center;
  padding: 0;
  display: flex;
}

.dsh-fleet-quick-remove:hover,
.dsh-fleet-quick-remove:focus-visible {
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}

.dsh-fleet-quick-drop-hint,
.dsh-fleet-quick-error {
  margin: 7px 7px 4px;
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-quick-drop-hint {
  color: var(--dsw-alias-label-tertiary);
}

.dsh-fleet-quick-list[data-import-active="true"] .dsh-fleet-quick-drop-hint {
  color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-quick-error {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-quick-option-summary {
  color: var(--dsw-alias-label-tertiary);
  margin-top: 1px;
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-quick-detail {
  min-width: 0;
  min-height: 0;
  padding: 4px 6px 0;
  overflow-y: auto;
}

.dsh-fleet-quick-detail-heading {
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  display: flex;
}

.dsh-fleet-quick-detail-title {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}

.dsh-fleet-quick-source {
  max-width: 45%;
  flex: none;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  margin: 0;
  font-size: 11px;
  line-height: 18px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-fleet-quick-description {
  width: 100%;
  max-width: 65ch;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  margin: 8px 0 18px;
  padding: 0;
  font-family: inherit;
  font-size: 12px;
  line-height: 19px;
  text-align: left;
}

.dsh-fleet-quick-description:hover,
.dsh-fleet-quick-description:focus-visible {
  color: var(--dsw-alias-label-primary);
  outline: none;
}

.dsh-fleet-quick-detail-section + .dsh-fleet-quick-detail-section {
  margin-top: 16px;
}

.dsh-fleet-quick-detail-label {
  color: var(--dsw-alias-label-tertiary);
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}

.dsh-fleet-quick-collaboration,
.dsh-fleet-quick-empty {
  color: var(--dsw-alias-label-secondary);
  margin: 0;
  font-size: 13px;
  line-height: 20px;
}

.dsh-fleet-quick-detail-action {
  width: 100%;
  color: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
  margin: -4px;
  padding: 4px;
  font-family: inherit;
  text-align: left;
}

.dsh-fleet-quick-detail-action:hover,
.dsh-fleet-quick-detail-action:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}

.dsh-fleet-quick-members {
  flex-wrap: wrap;
  gap: 6px;
  display: flex;
}

.dsh-fleet-quick-member {
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: var(--dsw-alias-bg-module-platform);
  border: 0;
  border-radius: 7px;
  padding: 5px 8px;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-quick-member:hover,
.dsh-fleet-quick-member:focus-visible {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}

.dsh-fleet-quick-member strong {
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}

.dsh-fleet-quick-preferences {
  color: var(--dsw-alias-label-tertiary);
  gap: 6px 14px;
  font-size: 12px;
  line-height: 18px;
  display: flex;
}

.dsh-fleet-quick-secondary {
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border-color: var(--dsw-alias-border-l2);
}

.dsh-fleet-quick-secondary:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-config-panel {
  box-sizing: border-box;
  z-index: 1;
  width: min(900px, calc(100vw - 32px));
  height: min(720px, calc(100dvh - 32px));
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 16px;
  box-shadow: var(--dsw-shadow-lv3);
  flex-direction: column;
  display: flex;
  position: relative;
  overflow: hidden;
  transition:
    width 300ms cubic-bezier(.16, 1, .3, 1),
    height 300ms cubic-bezier(.16, 1, .3, 1);
}

.dsh-fleet-config-panel[data-tab="members"] {
  width: min(1040px, calc(100vw - 16px));
  height: min(840px, calc(100dvh - 12px));
}

@media (prefers-reduced-motion: reduce) {
  .dsh-fleet-config-panel {
    transition: none;
  }
}

.dsh-fleet-config-header {
  flex: none;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px 24px 14px;
  display: flex;
}

.dsh-fleet-config-title {
  color: var(--dsw-alias-label-primary);
  margin: 0;
  font-size: 16px;
  font-weight: 510;
  line-height: 24px;
}

.dsh-fleet-config-title-group {
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: 10px;
  display: flex;
}

.dsh-fleet-config-intro-note {
  color: var(--dsw-alias-label-tertiary);
  margin: 0;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-config-tabs {
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  flex: none;
  gap: 20px;
  padding: 0 24px;
  display: flex;
}

.dsh-fleet-config-tab {
  height: 36px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 0 2px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
}

.dsh-fleet-config-tab:hover {
  color: var(--dsw-alias-label-primary);
}

.dsh-fleet-config-tab[aria-selected="true"] {
  color: var(--dsw-alias-label-primary);
  border-bottom-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-config-body {
  flex: 1;
  min-height: 0;
  padding: 4px 24px 24px;
  font-size: 13px;
  line-height: 20px;
  overflow-y: auto;
}

.dsh-fleet-config-module-list {
  max-width: 720px;
  gap: 24px;
  padding-top: 14px;
  display: grid;
}

.dsh-fleet-config-module {
  min-width: 0;
}

.dsh-fleet-config-module + .dsh-fleet-config-module {
  border-top: 1px solid var(--dsw-alias-border-l3);
  padding-top: 24px;
}

.dsh-fleet-config-module-title {
  color: var(--dsw-alias-label-primary);
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 510;
  line-height: 20px;
}

.dsh-fleet-config-preset-actions {
  flex: none;
  position: relative;
  align-items: center;
  gap: 6px;
  display: flex;
}

.dsh-fleet-config-local-presets {
  box-sizing: border-box;
  z-index: 20;
  width: 280px;
  max-height: 260px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  box-shadow: var(--dsw-shadow-lv2);
  padding: 6px;
  position: fixed;
  overflow-y: auto;
}

.dsh-fleet-config-local-preset,
.dsh-fleet-config-local-empty {
  box-sizing: border-box;
  width: 100%;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 8px 10px;
  font: inherit;
  text-align: left;
}

.dsh-fleet-config-local-preset {
  cursor: pointer;
}

.dsh-fleet-config-local-preset:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-config-local-preset-name,
.dsh-fleet-config-local-preset-time {
  display: block;
}

.dsh-fleet-config-local-preset-name {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 19px;
}

.dsh-fleet-config-local-preset-time,
.dsh-fleet-config-local-empty {
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-config-preset-action {
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 0 10px;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
}

.dsh-fleet-config-preset-action:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-config-preset-action:disabled,
.dsh-fleet-config-presets-action:disabled {
  cursor: default;
  opacity: .4;
}

.dsh-fleet-config-preset-error {
  color: var(--dsw-alias-state-danger-primary, #d84a4a);
  margin: -12px 0 18px;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-config-section {
  flex-direction: column;
  gap: 12px;
  display: flex;
}

.dsh-fleet-config-section + .dsh-fleet-config-section {
  border-top: 1px solid var(--dsw-alias-border-l3);
  margin-top: 20px;
  padding-top: 20px;
}

.dsh-fleet-config-section-title {
  color: var(--dsw-alias-label-primary);
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
}

.dsh-fleet-config-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  display: grid;
}

.dsh-fleet-config-runtime-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.dsh-fleet-config-field {
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  display: flex;
}

.dsh-fleet-config-field-wide {
  grid-column: 1 / -1;
}

.dsh-fleet-config-label {
  color: var(--dsw-alias-label-secondary);
  align-items: baseline;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  display: inline-flex;
}

.dsh-fleet-config-required {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  font-weight: 400;
}

.dsh-fleet-config-members-requirement,
.dsh-fleet-config-required-hint {
  color: var(--dsw-alias-label-tertiary);
  margin: 0;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-config-input,
.dsh-fleet-config-select,
.dsh-fleet-config-textarea {
  box-sizing: border-box;
  width: 100%;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  outline: none;
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
}

.dsh-fleet-config-input,
.dsh-fleet-config-select {
  height: 36px;
}

.dsh-fleet-config-textarea {
  min-height: 68px;
  resize: vertical;
}

.dsh-fleet-config-input:focus,
.dsh-fleet-config-select:focus,
.dsh-fleet-config-textarea:focus {
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-config-input::placeholder,
.dsh-fleet-config-textarea::placeholder {
  color: var(--dsw-alias-label-caption);
}

.dsh-fleet-config-model-control {
  min-width: 0;
  gap: 5px;
  display: grid;
}

.dsh-fleet-config-model-status {
  min-height: 17px;
  color: var(--dsw-alias-label-tertiary);
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  line-height: 17px;
  display: flex;
}

.dsh-fleet-config-model-status[data-error="true"] {
  color: var(--dsw-alias-state-danger-primary, #c84040);
}

.dsh-fleet-config-model-retry {
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 5px;
  padding: 0 2px;
  font: inherit;
  font-weight: 500;
}

.dsh-fleet-config-model-retry:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.dsh-fleet-config-model-retry:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-config-members {
  grid-template-columns: repeat(auto-fill, 132px);
  gap: 10px;
  display: grid;
}

.dsh-fleet-config-member,
.dsh-fleet-config-add,
.dsh-fleet-config-preset {
  box-sizing: border-box;
  width: 132px;
  min-width: 0;
  height: 172px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 5px;
  padding: 13px;
  font: inherit;
  text-align: left;
  display: flex;
}

.dsh-fleet-config-member {
  --dsh-fleet-member-accent: #527fca;
  background: color-mix(in srgb, var(--dsh-fleet-member-accent) 6%, var(--dsw-alias-bg-layer-1));
  cursor: grab;
  position: relative;
  overflow: hidden;
  touch-action: none;
  user-select: none;
}

.dsh-fleet-config-member::before {
  content: "";
  height: 3px;
  background: var(--dsh-fleet-member-accent);
  border-radius: 0 0 3px 3px;
  position: absolute;
  top: 0;
  right: 12px;
  left: 12px;
}

.dsh-fleet-config-member[data-fixed="true"] {
  cursor: pointer;
  touch-action: auto;
  user-select: auto;
}

.dsh-fleet-config-preset {
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.dsh-fleet-config-preset:active {
  cursor: grabbing;
}

.dsh-fleet-config-members[data-drop-active="true"] {
  outline: 1px dashed var(--dsw-alias-state-business-primary);
  outline-offset: 6px;
  border-radius: 8px;
}

.dsh-fleet-config-member:not([data-fixed="true"]):active {
  cursor: grabbing;
}

.dsh-fleet-config-member:hover,
.dsh-fleet-config-preset:hover,
.dsh-fleet-config-add:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l1);
}

.dsh-fleet-config-add[data-import-active="true"] {
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, transparent);
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-config-member:hover {
  background: color-mix(in srgb, var(--dsh-fleet-member-accent) 9%, var(--dsw-alias-interactive-bg-hover));
}

.dsh-fleet-config-member-name,
.dsh-fleet-config-preset-name {
  width: 100%;
  color: var(--dsw-alias-label-primary);
  font-size: 17px;
  font-weight: 600;
  line-height: 23px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-config-member-details,
.dsh-fleet-config-preset-details {
  width: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 3px;
  margin-top: auto;
  display: flex;
}

.dsh-fleet-config-member-role,
.dsh-fleet-config-preset-role {
  width: 100%;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-config-member-responsibilities,
.dsh-fleet-config-preset-responsibilities {
  width: 100%;
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  line-height: 15px;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  display: -webkit-box;
  overflow: hidden;
}

.dsh-fleet-config-resource-dropzone {
  box-sizing: border-box;
  width: 100%;
  min-height: 76px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 10px;
  justify-content: center;
  align-items: center;
  padding: 14px;
  font: inherit;
  text-align: center;
  display: flex;
}

.dsh-fleet-config-resource-dropzone:hover,
.dsh-fleet-config-resource-dropzone[data-drag-active="true"] {
  color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-layer-1));
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-config-resource-list {
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
  display: flex;
}

.dsh-fleet-config-resource-item {
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 8px;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  display: flex;
}

.dsh-fleet-config-resource-name {
  min-width: 0;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-config-resource-size {
  color: var(--dsw-alias-label-caption);
  flex: none;
  font-size: 11px;
}

.dsh-fleet-config-resource-remove {
  width: 24px;
  height: 24px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  justify-content: center;
  align-items: center;
  padding: 0;
  display: flex;
}

.dsh-fleet-config-resource-remove:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-config-field-with-presets {
  position: relative;
}

.dsh-fleet-config-field-heading {
  min-height: 24px;
  justify-content: flex-start;
  align-items: center;
  gap: 12px;
  display: flex;
  position: relative;
}

.dsh-fleet-config-field-preset-row {
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  display: flex;
  position: relative;
}

.dsh-fleet-config-field-preset-control {
  flex: none;
  position: relative;
}

.dsh-fleet-config-field-preset-chip {
  height: 24px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  align-items: center;
  gap: 4px;
  padding: 0 3px 0 7px;
  font-size: 11px;
  line-height: 16px;
  display: inline-flex;
  position: relative;
}

.dsh-fleet-config-field-preset-tooltip {
  z-index: 2;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  box-shadow: var(--dsw-shadow-lv2);
  padding: 8px 10px;
  font-size: 12px;
  line-height: 18px;
  white-space: normal;
  pointer-events: none;
  position: fixed;
  overflow-y: auto;
}

.dsh-fleet-config-field-preset-remove {
  width: 18px;
  height: 18px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 4px;
  justify-content: center;
  align-items: center;
  padding: 0;
  display: flex;
}

.dsh-fleet-config-field-preset-remove:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-config-field-preset-trigger {
  height: 24px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 0 7px;
  font: inherit;
  font-size: 11px;
}

.dsh-fleet-config-field-preset-trigger:hover,
.dsh-fleet-config-field-preset-trigger[aria-expanded="true"] {
  color: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-config-field-preset-menu {
  box-sizing: border-box;
  z-index: 25;
  width: min(310px, calc(100vw - 72px));
  max-height: 220px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  box-shadow: var(--dsw-shadow-lv2);
  padding: 6px;
  position: fixed;
  overflow-y: auto;
}

.dsh-fleet-config-field-preset-option-row {
  align-items: stretch;
  gap: 2px;
  display: flex;
}

.dsh-fleet-config-field-preset-option {
  min-width: 0;
  flex: 1;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 8px 10px;
  font: inherit;
  text-align: left;
  display: block;
}

.dsh-fleet-config-field-preset-option:disabled {
  cursor: default;
  opacity: .48;
}

.dsh-fleet-config-field-preset-option-remove {
  width: 30px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  justify-content: center;
  align-items: center;
  padding: 0;
  display: flex;
}

.dsh-fleet-config-field-preset-option-remove:hover {
  color: var(--dsw-alias-state-danger-primary, #d84a4a);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-config-field-preset-option:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-config-field-preset-option-name,
.dsh-fleet-config-field-preset-option-detail {
  display: block;
}

.dsh-fleet-config-field-preset-new {
  width: 100%;
  height: 34px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 7px;
  margin-top: 4px;
  font: inherit;
  font-size: 12px;
}

.dsh-fleet-config-field-preset-new:hover {
  color: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-config-field-preset-create {
  border-top: 1px solid var(--dsw-alias-border-l3);
  flex-direction: column;
  gap: 7px;
  margin-top: 4px;
  padding: 8px 4px 2px;
  display: flex;
}

.dsh-fleet-config-field-preset-create .dsh-fleet-config-textarea {
  min-height: 56px;
}

.dsh-fleet-config-field-preset-create-actions {
  justify-content: flex-end;
  gap: 6px;
  display: flex;
}

.dsh-fleet-config-field-preset-option-name {
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}

.dsh-fleet-config-field-preset-option-detail {
  color: var(--dsw-alias-label-tertiary);
  margin-top: 2px;
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-config-member-drop {
  box-sizing: border-box;
  width: 132px;
  height: 172px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, transparent);
  border: 1px dashed var(--dsw-alias-state-business-primary);
  border-radius: 12px;
  pointer-events: none;
}

.dsh-fleet-config-member-preview {
  z-index: 1400;
  pointer-events: none;
  filter: drop-shadow(0 10px 18px rgba(0, 0, 0, .18));
  position: fixed;
}

.dsh-fleet-config-member-preview .dsh-fleet-config-member {
  color: var(--dsw-alias-label-primary);
  cursor: grabbing;
  background: color-mix(in srgb, var(--dsh-fleet-member-accent) 8%, var(--dsw-alias-bg-layer-2));
}

.dsh-fleet-config-drag-hint {
  color: var(--dsw-alias-label-tertiary);
  margin: -3px 0 0;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-config-add {
  color: var(--dsw-alias-label-tertiary);
  background: transparent;
  border: 1px dashed var(--dsw-alias-border-l2);
  justify-content: center;
  align-items: center;
  text-align: center;
}

.dsh-fleet-config-add-mark {
  width: 22px;
  height: 22px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 50%;
  justify-content: center;
  align-items: center;
  font-size: 17px;
  font-weight: 300;
  line-height: 20px;
  display: inline-flex;
}

.dsh-fleet-config-presets {
  border-top: 1px dashed var(--dsw-alias-border-l2);
  margin-top: 6px;
  padding-top: 16px;
}

.dsh-fleet-config-presets[data-remove-active="true"] {
  outline: 1px dashed var(--dsw-alias-state-danger-primary, #d84a4a);
  outline-offset: 6px;
  border-radius: 8px;
}

.dsh-fleet-config-presets-title {
  color: var(--dsw-alias-label-secondary);
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}

.dsh-fleet-config-presets-heading {
  justify-content: flex-start;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  display: flex;
}

.dsh-fleet-config-presets-actions {
  align-items: center;
  gap: 5px;
  display: flex;
  position: relative;
}

.dsh-fleet-config-preset-import-hint {
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  line-height: 15px;
}

.dsh-fleet-config-presets-action {
  height: 24px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 0 7px;
  font: inherit;
  font-size: 11px;
}

.dsh-fleet-config-presets-action:hover,
.dsh-fleet-config-presets-action[aria-expanded="true"] {
  color: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-config-group-menu {
  box-sizing: border-box;
  z-index: 25;
  width: 240px;
  max-height: 220px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  box-shadow: var(--dsw-shadow-lv2);
  padding: 6px;
  position: fixed;
  overflow-y: auto;
}

.dsh-fleet-config-group-row {
  align-items: stretch;
  gap: 2px;
  display: flex;
}

.dsh-fleet-config-group-option {
  min-width: 0;
  height: 32px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  flex: 1;
  padding: 0 9px;
  font: inherit;
  font-size: 12px;
  text-align: left;
}

.dsh-fleet-config-group-option:hover,
.dsh-fleet-config-group-option[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-config-group-remove {
  width: 30px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  justify-content: center;
  align-items: center;
  padding: 0;
  display: flex;
}

.dsh-fleet-config-group-remove:hover {
  color: var(--dsw-alias-state-danger-primary, #d84a4a);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-config-group-create {
  border-top: 1px solid var(--dsw-alias-border-l3);
  gap: 5px;
  margin-top: 4px;
  padding-top: 7px;
  display: flex;
}

.dsh-fleet-config-group-create .dsh-fleet-config-input {
  min-width: 0;
  height: 30px;
  flex: 1;
}

.dsh-fleet-config-preset-grid {
  grid-template-columns: repeat(auto-fill, 132px);
  gap: 10px;
  display: grid;
}

.dsh-fleet-member-editor-overlay {
  z-index: 1300;
  justify-content: center;
  align-items: center;
  display: flex;
  position: fixed;
  inset: 0;
}

.dsh-fleet-member-editor-panel {
  box-sizing: border-box;
  z-index: 1;
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 16px;
  box-shadow: var(--dsw-shadow-lv3);
  flex-direction: column;
  display: flex;
  position: relative;
  overflow: hidden;
}

.dsh-fleet-member-remove-panel {
  width: min(420px, calc(100vw - 32px));
}

.dsh-fleet-member-remove-copy {
  color: var(--dsw-alias-label-secondary);
  margin: 0;
  font-size: 13px;
  line-height: 20px;
}

.dsh-fleet-member-remove-confirm {
  color: white;
  background: var(--dsw-alias-state-danger-primary, #d84a4a);
}

.dsh-fleet-member-remove-confirm:hover {
  filter: brightness(.96);
}

.dsh-fleet-member-editor-body {
  padding: 4px 24px 24px;
  overflow-y: auto;
}

.dsh-fleet-member-color-options {
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  display: flex;
}

.dsh-fleet-member-color-option {
  width: 24px;
  height: 24px;
  cursor: pointer;
  background: var(--dsh-fleet-member-accent);
  border: 2px solid var(--dsw-alias-bg-layer-2);
  border-radius: 8px;
  padding: 0;
}

.dsh-fleet-member-color-option[aria-pressed="true"] {
  outline: 2px solid var(--dsw-alias-label-primary);
  outline-offset: 2px;
}

.dsh-fleet-member-color-option:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-member-color-custom {
  align-items: center;
  gap: 8px;
  margin-left: 2px;
  display: flex;
}

.dsh-fleet-member-color-input {
  box-sizing: border-box;
  width: 34px;
  height: 28px;
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 3px;
}

.dsh-fleet-member-color-input::-webkit-color-swatch-wrapper {
  padding: 0;
}

.dsh-fleet-member-color-input::-webkit-color-swatch {
  border: 0;
  border-radius: 4px;
}

.dsh-fleet-member-color-value {
  box-sizing: border-box;
  width: 76px;
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 0 8px;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-member-color-value:focus {
  border-color: var(--dsw-alias-state-business-primary);
  outline: none;
}

.dsh-fleet-member-color-randomize {
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 0 10px;
  font: inherit;
  font-size: 12px;
}

.dsh-fleet-member-color-randomize:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-member-auth {
  border-top: 1px solid var(--dsw-alias-border-l3);
  padding-top: 20px;
}

.dsh-fleet-member-auth-head {
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  display: flex;
}

.dsh-fleet-member-auth-head h3,
.dsh-fleet-member-auth-section-title {
  color: var(--dsw-alias-label-primary);
  margin: 0;
  font-size: 14px;
  line-height: 20px;
}

.dsh-fleet-member-auth-head p,
.dsh-fleet-member-auth-note {
  max-width: 68ch;
  color: var(--dsw-alias-label-secondary);
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-member-auth-mode {
  flex: none;
  background: var(--dsw-alias-bg-layer-1);
  border-radius: 8px;
  padding: 2px;
  display: flex;
}

.dsh-fleet-member-auth-mode button {
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0 10px;
  font: inherit;
  font-size: 12px;
}

.dsh-fleet-member-auth-mode button[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
}

.dsh-fleet-member-auth-mode button:focus-visible,
.dsh-fleet-member-auth-option:focus-visible,
.dsh-fleet-member-access-rules button:focus-visible,
.dsh-fleet-member-access-rule-form > button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-fleet-member-auth-section-title {
  margin-top: 22px;
  margin-bottom: 8px;
}

.dsh-fleet-member-auth-options {
  gap: 2px;
  display: grid;
}

.dsh-fleet-member-auth-option {
  width: 100%;
  color: var(--dsw-alias-label-primary);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 9px 11px;
  display: grid;
}

.dsh-fleet-member-auth-option:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-member-auth-option[aria-pressed="true"] {
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, transparent);
}

.dsh-fleet-member-auth-option strong,
.dsh-fleet-member-access-category strong,
.dsh-fleet-member-access-kinds strong,
.dsh-fleet-member-access-rules strong {
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}

.dsh-fleet-member-auth-option span,
.dsh-fleet-member-access-category small,
.dsh-fleet-member-access-kinds small,
.dsh-fleet-member-access-rules small {
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
}

.dsh-fleet-member-access-categories,
.dsh-fleet-member-access-kinds,
.dsh-fleet-member-access-rules {
  gap: 1px;
  display: grid;
}

.dsh-fleet-member-access-category,
.dsh-fleet-member-access-kinds > label,
.dsh-fleet-member-access-rules > div {
  min-height: 48px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
  display: flex;
}

.dsh-fleet-member-access-category > span,
.dsh-fleet-member-access-kinds > label > span,
.dsh-fleet-member-access-rules > div > span {
  min-width: 0;
  display: grid;
}

.dsh-fleet-member-access-category select,
.dsh-fleet-member-access-kinds select,
.dsh-fleet-member-access-rule-form select,
.dsh-fleet-member-access-rule-form input {
  box-sizing: border-box;
  min-width: 132px;
  height: 32px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 0 9px;
  font: inherit;
  font-size: 12px;
}

.dsh-fleet-member-auth-technical {
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  display: grid;
}

.dsh-fleet-member-auth-technical > label {
  min-width: 0;
  gap: 6px;
  display: grid;
}

.dsh-fleet-member-auth-technical > label > strong {
  font-size: 12px;
}

.dsh-fleet-member-auth-technical > label > span {
  color: var(--dsw-alias-label-secondary);
  white-space: pre-line;
  font-size: 11px;
  line-height: 17px;
}

.dsh-fleet-member-access-rules button {
  color: var(--dsw-alias-state-danger-primary, #d84a4a);
  cursor: pointer;
  background: transparent;
  border: 0;
  padding: 6px 8px;
  font: inherit;
  font-size: 12px;
}

.dsh-fleet-member-access-rule-form {
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
  margin-top: 12px;
  display: grid;
}

.dsh-fleet-member-access-rule-form > label {
  gap: 5px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  display: grid;
}

.dsh-fleet-member-access-rule-form input,
.dsh-fleet-member-access-rule-form select {
  width: 100%;
}

.dsh-fleet-member-access-rule-form fieldset {
  border: 0;
  grid-column: 1 / -1;
  margin: 0;
  padding: 0;
}

.dsh-fleet-member-access-rule-form legend {
  color: var(--dsw-alias-label-secondary);
  margin-bottom: 6px;
  font-size: 12px;
}

.dsh-fleet-member-access-rule-form fieldset > div {
  flex-wrap: wrap;
  gap: 12px;
  display: flex;
}

.dsh-fleet-member-access-rule-form fieldset label {
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  display: flex;
}

.dsh-fleet-member-access-rule-form > button {
  width: fit-content;
  height: 32px;
  color: white;
  cursor: pointer;
  background: var(--dsw-alias-state-business-primary);
  border: 0;
  border-radius: 8px;
  padding: 0 12px;
  font: inherit;
  font-size: 12px;
}

.dsh-fleet-member-access-rule-form > button:disabled {
  cursor: default;
  opacity: .45;
}

.dsh-fleet-member-editor-remove {
  color: var(--dsw-alias-state-danger-primary, #d84a4a);
  cursor: pointer;
  background: transparent;
  border: 0;
  margin-right: auto;
  padding: 0 8px;
  font: inherit;
  font-size: 13px;
}

.dsh-fleet-member-editor-export {
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  margin-right: auto;
  padding: 0 8px;
  font: inherit;
  font-size: 13px;
}

.dsh-fleet-member-editor-export:hover {
  color: var(--dsw-alias-label-primary);
}

.dsh-fleet-config-action:disabled {
  cursor: default;
  opacity: .4;
}

@media (max-width: 640px) {
  .dsh-fleet-quick-panel {
    height: min(680px, calc(100dvh - 24px));
  }

  .dsh-fleet-quick-workspace {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .dsh-fleet-quick-list {
    max-height: 180px;
  }

  .dsh-fleet-config-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .dsh-fleet-config-title-group {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  .dsh-fleet-config-preset-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .dsh-fleet-config-local-presets {
    right: auto;
    left: 0;
  }

  .dsh-fleet-config-grid,
  .dsh-fleet-config-runtime-grid,
  .dsh-fleet-member-editor-body .dsh-fleet-config-grid {
    grid-template-columns: 1fr;
  }

  .dsh-fleet-config-field-wide {
    grid-column: 1;
  }

  .dsh-fleet-member-auth-head,
  .dsh-fleet-member-access-category,
  .dsh-fleet-member-access-kinds > label {
    align-items: stretch;
    flex-direction: column;
  }

  .dsh-fleet-member-auth-mode {
    align-self: flex-start;
  }

  .dsh-fleet-member-auth-technical,
  .dsh-fleet-member-access-rule-form {
    grid-template-columns: 1fr;
  }
}

.dsh-fleet-config-footer {
  border-top: 1px solid var(--dsw-alias-border-l3);
  flex: none;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 16px 24px;
  display: flex;
}

.dsh-fleet-config-required-hint {
  margin-right: auto;
}

.dsh-fleet-config-action {
  box-sizing: border-box;
  min-width: 72px;
  height: 32px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.dsh-fleet-config-cancel {
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border-color: var(--dsw-alias-border-l2);
}

.dsh-fleet-config-cancel:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-config-confirm {
  color: white;
  background: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-config-confirm:hover {
  filter: brightness(.96);
}

.dsh-fleet-config-action:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
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

type FleetMode = 'configuration' | 'interactive' | 'connection'
type ConfigurationTab = 'basics' | 'members' | 'user' | 'modules'

interface MenuPosition {
  left: number
  top: number
}

interface FloatingMenuPosition extends MenuPosition {
  width: number
  maxHeight: number
}

interface FleetAssistantConnectionNotice {
  readonly kind: 'open' | 'reconnect'
  readonly team: FleetPanelTeamSummary
  readonly assistants: NonNullable<FleetPanelTeamSummary['assistantConnections']>
  readonly position: FloatingMenuPosition
  readonly error?: string
}

function floatingMenuPosition(anchor: DOMRect, preferredWidth: number, preferredHeight: number): FloatingMenuPosition {
  const edge = 8
  const gap = 6
  const width = Math.min(preferredWidth, window.innerWidth - edge * 2)
  const below = window.innerHeight - anchor.bottom - edge - gap
  const above = anchor.top - edge - gap
  const openAbove = below < Math.min(160, preferredHeight) && above > below
  const maxHeight = Math.max(96, Math.min(preferredHeight, openAbove ? above : below))
  return {
    left: Math.max(edge, Math.min(anchor.right - width, window.innerWidth - width - edge)),
    top: openAbove ? Math.max(edge, anchor.top - maxHeight - gap) : anchor.bottom + gap,
    width,
    maxHeight,
  }
}

function ChevronDown(): ReactElement {
  return jsx('svg', {
    className: 'dsh-fleet-team-chevron',
    width: 14,
    height: 14,
    viewBox: '0 0 14 14',
    fill: 'none',
    'aria-hidden': 'true',
    children: jsx('path', {
      d: 'm3.5 5.25 3.5 3.5 3.5-3.5',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  })
}

function ChevronRight(): ReactElement {
  return jsx('svg', {
    className: 'dsh-fleet-team-chevron',
    width: 14,
    height: 14,
    viewBox: '0 0 14 14',
    fill: 'none',
    'aria-hidden': 'true',
    children: jsx('path', {
      d: 'm5.25 3.5 3.5 3.5-3.5 3.5',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  })
}

function CancelMark(): ReactElement {
  return jsx('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 14 14',
    fill: 'none',
    'aria-hidden': 'true',
    children: jsx('path', {
      d: 'm4.25 4.25 5.5 5.5m0-5.5-5.5 5.5',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinecap: 'round',
    }),
  })
}

function CheckMark(): ReactElement {
  return jsx('svg', {
    className: 'dsh-fleet-team-check',
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': 'true',
    children: jsx('path', {
      d: 'm2.25 8.25 3.5 3.25 8-8',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  })
}

interface MemberDraft {
  readonly key: number
  readonly id: string
  readonly name: string
  readonly color: string
  readonly role: string
  readonly responsibilities: string
  readonly prompt: string
  readonly provider: string
  readonly model: string
  readonly canVote?: boolean
  readonly toolGroups?: unknown
  readonly permissions?: unknown
  readonly access: MemberAccessDraft
  readonly contacts?: unknown
  readonly sourcePresetId: string | null
  readonly modified: boolean
}

type MemberAccessLevel = 'read' | 'write' | 'use' | 'manage'
type MemberAccessMode = 'inherit' | 'restricted'

interface MemberAccessRuleDraft {
  readonly id: string
  readonly resourceKind: string
  readonly resourceId: string
  readonly scope: 'self' | 'tree'
  readonly effect: 'allow' | 'deny'
  readonly levels: readonly MemberAccessLevel[]
}

interface MemberAccessDraft {
  readonly restrictedKinds: readonly string[]
  readonly rules: readonly MemberAccessRuleDraft[]
}

type FieldPresetSelections = Readonly<Record<FieldPresetTarget, readonly string[]>>

interface FleetConfigurationDraft {
  readonly name: string
  readonly positioning: string
  readonly assistant: MemberDraft
  readonly members: readonly MemberDraft[]
  readonly channelId: string
  readonly channelName: string
  readonly rules: string
  readonly collaborationMethod: string
  readonly sharedResources: readonly File[]
  readonly updateDensity: string
  readonly notificationPolicy: string
  readonly contentPreference: string
  readonly presetSelections: FieldPresetSelections
  readonly extensionModules: Readonly<Record<string, unknown>>
}

interface MemberPreset {
  readonly id: string
  readonly displayName: string
  readonly role: readonly [zh: string, en: string]
  readonly responsibilities: readonly [zh: string, en: string]
  readonly prompt: string
  readonly provider: string
  readonly model: string
  readonly toolGroups?: unknown
  readonly permissions?: unknown
  readonly contacts?: unknown
  readonly groupId: string
}

const MEMBER_PRESET_ALL_GROUP = 'all'
const MEMBER_PRESET_DEVELOPMENT_GROUP = 'development'
const MEMBER_PRESET_RESEARCH_GROUP = 'research'

const BUILT_IN_MEMBER_PRESET_GROUPS: readonly MemberPresetGroup[] = [
  { id: MEMBER_PRESET_DEVELOPMENT_GROUP, name: ['开发', 'Development'] },
  { id: MEMBER_PRESET_RESEARCH_GROUP, name: ['科研', 'Research'] },
]

const TEMPLATE_MEMBER_NAMES = [
  'Avery', 'Morgan', 'Riley', 'Quinn', 'Jordan', 'Casey', 'Taylor', 'Cameron',
  'Reese', 'Parker', 'Rowan', 'Ellis', 'Sage', 'Robin', 'Finley', 'Hayden',
] as const

interface TeamTemplateMemberPresetSource {
  readonly id: string
  readonly role: string
  readonly responsibilities: string
  readonly prompt: string
  readonly provider: string
  readonly model: string
  readonly toolGroups?: unknown
  readonly permissions?: unknown
  readonly contacts?: unknown
}

function memberPresetsFromTeamTemplates(): readonly MemberPreset[] {
  const presets = new Map<string, MemberPreset>()
  for (const template of FULL_TEAM_TEMPLATES) {
    const configuration = template.configuration as unknown as {
      readonly en: { readonly core: { readonly members: readonly TeamTemplateMemberPresetSource[] } }
      readonly zh: { readonly core: { readonly members: readonly TeamTemplateMemberPresetSource[] } }
    }
    const chineseMembers = new Map(configuration.zh.core.members.map(member => [member.id, member]))
    for (const member of configuration.en.core.members) {
      if (presets.has(member.id)) continue
      const chineseMember = chineseMembers.get(member.id)
      if (chineseMember === undefined) continue
      presets.set(member.id, {
        id: member.id,
        displayName: TEMPLATE_MEMBER_NAMES[presets.size] ?? `Agent ${presets.size + 1}`,
        role: [chineseMember.role, member.role],
        responsibilities: [chineseMember.responsibilities, member.responsibilities],
        prompt: member.prompt,
        provider: member.provider,
        model: member.model,
        ...(member.toolGroups === undefined ? {} : { toolGroups: structuredClone(member.toolGroups) }),
        ...(member.permissions === undefined ? {} : { permissions: structuredClone(member.permissions) }),
        ...(member.contacts === undefined ? {} : { contacts: structuredClone(member.contacts) }),
        groupId: template.id === 'research-full'
          ? MEMBER_PRESET_RESEARCH_GROUP
          : MEMBER_PRESET_DEVELOPMENT_GROUP,
      })
    }
  }
  return [...presets.values()]
}

const MEMBER_PRESETS = memberPresetsFromTeamTemplates()

interface MemberPresetGroup {
  readonly id: string
  readonly name: readonly [zh: string, en: string]
}

interface PresetLibrary {
  readonly groups: readonly MemberPresetGroup[]
  readonly members: readonly MemberPreset[]
  readonly fields: FieldPresetCollection
}

const FIELD_CONTENT_PRESETS: Readonly<Record<FieldPresetTarget, readonly FieldContentPreset[]>> = {
  positioning: [
    { id: 'software-delivery', name: ['软件交付', 'Software delivery'], detail: ['长期负责产品工程、质量保障与持续交付。', 'Own product engineering, quality assurance, and continuous delivery.'] },
    { id: 'research-analysis', name: ['研究分析', 'Research and analysis'], detail: ['长期负责资料检索、事实核验与形成可引用结论。', 'Own research, fact verification, and citable conclusions.'] },
    { id: 'product-discovery', name: ['产品探索', 'Product discovery'], detail: ['长期负责需求发现、方案验证与产品方向探索。', 'Own discovery, solution validation, and product direction.'] },
  ],
  rules: [
    { id: 'evidence-first', name: ['证据优先', 'Evidence first'], detail: ['重要判断需要附带可复核的证据或验证结果。', 'Important judgments include reviewable evidence or verification results.'] },
    { id: 'minimal-change', name: ['最小变更', 'Minimal change'], detail: ['优先选择能闭环需求且影响范围最小的实现。', 'Prefer the smallest implementation that closes the requested loop.'] },
    { id: 'surface-risks', name: ['主动暴露风险', 'Surface risks'], detail: ['尽早同步阻塞、冲突和不确定性，不隐藏失败。', 'Surface blockers, conflicts, and uncertainty early.'] },
  ],
  collaboration: [
    { id: 'parallel-ownership', name: ['并行分工', 'Parallel ownership'], detail: ['按可独立交付的范围分工，并明确各自当前负责内容。', 'Divide work into independently deliverable ownership areas.'] },
    { id: 'review-loop', name: ['审查闭环', 'Review loop'], detail: ['关键结果由不同成员独立审查后再合并。', 'Have a different member independently review key results before merging.'] },
    { id: 'async-first', name: ['异步优先', 'Async first'], detail: ['默认通过频道和共享资源异步同步，必要时再召开会议。', 'Synchronize through channels and shared resources before meetings.'] },
  ],
  content: [
    { id: 'decisions-first', name: ['决策优先', 'Decisions first'], detail: ['优先呈现需要用户判断的选项、依据和影响。', 'Lead with decisions, supporting rationale, and consequences.'] },
    { id: 'technical-detail', name: ['技术细节', 'Technical detail'], detail: ['保留实现路径、验证证据与关键技术取舍。', 'Retain implementation paths, verification evidence, and technical tradeoffs.'] },
    { id: 'visual-first', name: ['视觉优先', 'Visual first'], detail: ['适合时优先使用界面、图表或其他可视化结果。', 'Prefer interfaces, charts, or other visual results when useful.'] },
  ],
  resources: [
    { id: 'workspace-files', name: ['工作区文件', 'Workspace files'], detail: ['允许团队发现并引用当前工作区中的项目文件。', 'Let the Team discover and reference files in the current workspace.'] },
    { id: 'plans-checklists', name: ['计划与清单', 'Plans and checklists'], detail: ['共享由 Fleet 维护的计划、检查项和进度文件。', 'Share Fleet-maintained plans, checklists, and progress files.'] },
    { id: 'session-artifacts', name: ['会话产物', 'Session artifacts'], detail: ['允许将运行过程中生成的文件加入团队共享资源。', 'Allow files produced during runs to become shared Team resources.'] },
  ],
}

const PRESET_LIBRARY_KEY = 'dsh-agent-fleet.preset-library.v1'

function defaultPresetLibrary(): PresetLibrary {
  return {
    groups: BUILT_IN_MEMBER_PRESET_GROUPS,
    members: MEMBER_PRESETS,
    fields: FIELD_CONTENT_PRESETS,
  }
}

function normalizedPresetLibrary(library: PresetLibrary): PresetLibrary {
  const builtInIds = new Set(MEMBER_PRESETS.map(preset => preset.id))
  const legacyIds: Readonly<Record<string, string>> = {
    engineer: 'core-engineer',
    reviewer: 'quality-engineer',
    researcher: 'literature-researcher',
  }
  const existing = new Map(library.members.map(preset => [legacyIds[preset.id] ?? preset.id, preset]))
  const customGroups = library.groups.filter(group => (
    group.id !== 'default'
    && !BUILT_IN_MEMBER_PRESET_GROUPS.some(candidate => candidate.id === group.id)
  ))
  const groups = [...BUILT_IN_MEMBER_PRESET_GROUPS, ...customGroups]
  const groupIds = new Set(groups.map(group => group.id))
  return {
    groups,
    members: [
      ...MEMBER_PRESETS.map(preset => {
        const stored = existing.get(preset.id)
        return stored === undefined ? preset : { ...preset, displayName: stored.displayName }
      }),
      ...library.members.filter(preset => (
        !builtInIds.has(preset.id)
        && legacyIds[preset.id] === undefined
      )).map(preset => ({
        ...preset,
        groupId: groupIds.has(preset.groupId) ? preset.groupId : MEMBER_PRESET_DEVELOPMENT_GROUP,
      })),
    ],
    fields: library.fields,
  }
}

function readPresetLibrary(): PresetLibrary {
  if (typeof window === 'undefined') return defaultPresetLibrary()
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PRESET_LIBRARY_KEY) ?? 'null')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaultPresetLibrary()
    const library = value as Partial<PresetLibrary>
    if (!Array.isArray(library.groups) || !Array.isArray(library.members)) return defaultPresetLibrary()
    const fields = library.fields
    if (typeof fields !== 'object' || fields === null
      || !Array.isArray(fields.positioning)
      || !Array.isArray(fields.rules)
      || !Array.isArray(fields.collaboration)
      || !Array.isArray(fields.content)
      || !Array.isArray(fields.resources)) return defaultPresetLibrary()
    return normalizedPresetLibrary(library as PresetLibrary)
  } catch {
    return defaultPresetLibrary()
  }
}

function storePresetLibrary(library: PresetLibrary): void {
  window.localStorage.setItem(PRESET_LIBRARY_KEY, JSON.stringify(library))
}

type MemberDragSource =
  | { readonly kind: 'member'; readonly key: number }
  | { readonly kind: 'preset'; readonly id: string }

interface MemberDrag {
  readonly source: MemberDragSource
  readonly pointerId: number
  readonly originX: number
  readonly originY: number
  readonly offsetX: number
  readonly offsetY: number
  readonly width: number
  readonly height: number
  moved: boolean
}

interface MemberDragView {
  readonly source: MemberDragSource
  readonly x: number
  readonly y: number
  readonly offsetX: number
  readonly offsetY: number
  readonly width: number
  readonly height: number
  readonly destination: 'members' | 'remove' | null
  readonly index: number
}

function memberInsertionIndex(bounds: readonly DOMRect[], clientX: number, clientY: number): number {
  if (bounds.length === 0) return 0
  const y = Math.max(bounds[0]?.top ?? clientY, Math.min(clientY, bounds.at(-1)?.bottom ?? clientY))
  const rows: Array<{ start: number; end: number; top: number; bottom: number }> = []
  for (const [index, bound] of bounds.entries()) {
    let row = rows.at(-1)
    if (row === undefined || Math.abs(bound.top - row.top) > 4) {
      row = { start: index, end: index + 1, top: bound.top, bottom: bound.bottom }
      rows.push(row)
    } else {
      row.end = index + 1
      row.bottom = Math.max(row.bottom, bound.bottom)
    }
  }
  for (const row of rows) {
    if (y < row.top) return row.start
    if (y <= row.bottom) {
      for (let index = row.start; index < row.end; index += 1) {
        const bound = bounds[index]
        if (bound !== undefined && clientX < bound.left + bound.width / 2) return index
      }
      return row.end
    }
  }
  return bounds.length
}

let memberKey = 0

const DEFAULT_MEMBER_TOOL_GROUPS = ['messages', 'coordination', 'resources', 'status'] as const
const DEFAULT_MEMBER_PERMISSIONS = [
  'channel.manage', 'meeting.manage', 'vote.create', 'resource.write', 'team.manage',
] as const

const FLEET_ACCESS_CONFIGURATION_MODULE = 'dsh-agent-fleet/authorization/access'
const EMPTY_MEMBER_ACCESS: MemberAccessDraft = { restrictedKinds: [], rules: [] }

function newMember(seed: Partial<Omit<MemberDraft, 'key'>> = {}): MemberDraft {
  memberKey += 1
  return {
    key: memberKey,
    id: '',
    name: '',
    color: generateFleetMemberColor(),
    role: '',
    responsibilities: '',
    prompt: '',
    provider: '',
    model: '',
    toolGroups: [...DEFAULT_MEMBER_TOOL_GROUPS],
    permissions: [],
    access: structuredClone(EMPTY_MEMBER_ACCESS),
    sourcePresetId: null,
    modified: false,
    ...seed,
  }
}

function randomMemberName(existing: readonly MemberDraft[]): string {
  return generateMemberDisplayName(existing.map(member => member.name))
}

function defaultAssistant(existing: readonly MemberDraft[] = []): MemberDraft {
  const chinese = isChineseLocale()
  return newMember({
    id: 'team-assistant',
    name: randomMemberName(existing),
    color: generateFleetMemberColor(existing.map(member => member.color)),
    role: chinese ? '团队助理' : 'Team assistant',
    responsibilities: chinese
      ? '维护面向用户的团队会话，帮助用户观察、控制并与团队协作。'
      : 'Maintain the user-facing Team conversation and help the user observe, control, and collaborate with the Team.',
    permissions: [...DEFAULT_MEMBER_PERMISSIONS],
  })
}

function emptyConfiguration(): FleetConfigurationDraft {
  return {
    name: '',
    positioning: '',
    assistant: defaultAssistant(),
    members: [],
    channelId: 'main',
    channelName: 'Main',
    rules: '',
    collaborationMethod: '',
    sharedResources: [],
    updateDensity: 'concise',
    notificationPolicy: 'decisions',
    contentPreference: '',
    presetSelections: {
      positioning: [],
      rules: [],
      collaboration: [],
      content: [],
      resources: [],
    },
    extensionModules: {},
  }
}

function resolvedPresetText(
  draft: FleetConfigurationDraft,
  target: FieldPresetTarget,
  value: string,
  library: PresetLibrary,
  chinese: boolean,
): string {
  return [
    ...draft.presetSelections[target].flatMap(id => {
      const preset = library.fields[target].find(candidate => candidate.id === id)
      return preset === undefined ? [] : [preset.detail[chinese ? 0 : 1]]
    }),
    value.trim(),
  ].filter(Boolean).join('\n')
}

function configuredActor(member: MemberDraft): Record<string, unknown> {
  return {
    id: member.id.trim(),
    name: member.name.trim(),
    color: member.color,
    role: member.role.trim(),
    responsibilities: member.responsibilities.trim(),
    prompt: member.prompt.trim(),
    provider: member.provider.trim(),
    model: member.model.trim(),
    ...(member.canVote === undefined ? {} : { canVote: member.canVote }),
    ...(member.toolGroups === undefined ? {} : { toolGroups: structuredClone(member.toolGroups) }),
    ...(member.permissions === undefined ? {} : { permissions: structuredClone(member.permissions) }),
    ...(member.contacts === undefined ? {} : { contacts: structuredClone(member.contacts) }),
  }
}

interface FleetAccessConfigurationShape {
  readonly version: 1
  readonly modes: readonly {
    readonly principal: { readonly kind: 'group'; readonly id: string }
    readonly resourceKind: string
    readonly mode: 'restricted'
  }[]
  readonly rules: readonly {
    readonly id: string
    readonly principal: { readonly kind: 'group'; readonly id: string }
    readonly resource: { readonly kind: string; readonly id: string }
    readonly scope: 'self' | 'tree'
    readonly effect: 'allow' | 'deny'
    readonly levels: readonly MemberAccessLevel[]
  }[]
}

function accessConfiguration(value: unknown): FleetAccessConfigurationShape {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { version: 1, modes: [], rules: [] }
  }
  const input = value as Readonly<Record<string, unknown>>
  if (input.version !== 1 || !Array.isArray(input.modes) || !Array.isArray(input.rules)) {
    return { version: 1, modes: [], rules: [] }
  }
  return structuredClone(input) as unknown as FleetAccessConfigurationShape
}

function memberAccessFromConfiguration(value: unknown, memberId: string): MemberAccessDraft {
  const configuration = accessConfiguration(value)
  const principalId = `member:${memberId}`
  return {
    restrictedKinds: configuration.modes.flatMap(mode => (
      mode.principal?.kind === 'group' && mode.principal.id === principalId && mode.mode === 'restricted'
        ? [mode.resourceKind]
        : []
    )),
    rules: configuration.rules.flatMap(rule => (
      rule.principal?.kind === 'group' && rule.principal.id === principalId
        ? [{
          id: rule.id,
          resourceKind: rule.resource.kind,
          resourceId: rule.resource.id,
          scope: rule.scope,
          effect: rule.effect,
          levels: [...rule.levels],
        }]
        : []
    )),
  }
}

function configuredAccess(draft: FleetConfigurationDraft): FleetAccessConfigurationShape {
  const base = accessConfiguration(draft.extensionModules[FLEET_ACCESS_CONFIGURATION_MODULE])
  const actors = [draft.assistant, ...draft.members.filter(memberHasData)]
  const privatePrincipals = new Set(actors.map(actor => `member:${actor.id.trim()}`))
  return {
    version: 1,
    modes: [
      ...base.modes.filter(mode => !privatePrincipals.has(mode.principal.id)),
      ...actors.flatMap(actor => actor.access.restrictedKinds.map(resourceKind => ({
        principal: { kind: 'group' as const, id: `member:${actor.id.trim()}` },
        resourceKind,
        mode: 'restricted' as const,
      }))),
    ],
    rules: [
      ...base.rules.filter(rule => !privatePrincipals.has(rule.principal.id)),
      ...actors.flatMap(actor => actor.access.rules.map((rule, index) => ({
        id: rule.id || `setup-${actor.id.trim().replace(/[^a-zA-Z0-9._-]/gu, '-')}-${String(index + 1)}`,
        principal: { kind: 'group' as const, id: `member:${actor.id.trim()}` },
        resource: { kind: rule.resourceKind, id: rule.resourceId },
        scope: rule.scope,
        effect: rule.effect,
        levels: [...rule.levels],
      }))),
    ],
  }
}

function configurationForHost(
  draft: FleetConfigurationDraft,
  library: PresetLibrary = readPresetLibrary(),
  chinese: boolean = isChineseLocale(),
  uploadedResources?: readonly {
    readonly path: string
    readonly label: string
    readonly mediaType?: string
  }[],
): Record<string, unknown> {
  const resources = uploadedResources ?? draft.sharedResources.map(file => {
    const nativePath = (file as File & { readonly path?: string }).path?.trim()
    if (nativePath === undefined || nativePath.length === 0) {
      throw new Error(`Browser file ${file.name} must be uploaded before Team activation`)
    }
    return {
      path: nativePath,
      label: file.name,
      ...(file.type.length === 0 ? {} : { mediaType: file.type }),
    }
  })
  return {
    core: {
      name: draft.name.trim(),
      positioning: resolvedPresetText(draft, 'positioning', draft.positioning, library, chinese),
      assistant: configuredActor(draft.assistant),
      members: draft.members.filter(memberHasData).map(configuredActor),
    },
    modules: {
      ...fleetConfigurationModules.valuesWithDefaults(draft.extensionModules),
      [FLEET_ACCESS_CONFIGURATION_MODULE]: configuredAccess(draft),
      [FLEET_MESSAGE_CONFIGURATION_MODULE]: {
        defaultChannel: {
          id: draft.channelId.trim(),
          name: draft.channelName.trim(),
        },
        rules: resolvedPresetText(draft, 'rules', draft.rules, library, chinese),
        collaborationMethod: resolvedPresetText(draft, 'collaboration', draft.collaborationMethod, library, chinese),
      },
      [FLEET_RESOURCES_CONFIGURATION_MODULE]: {
        policy: resolvedPresetText(draft, 'resources', '', library, chinese),
        items: resources,
      },
      [FLEET_UI_CONFIGURATION_MODULE]: {
        userAccess: {
          updateDensity: draft.updateDensity,
          notificationPolicy: draft.notificationPolicy,
          contentPreference: resolvedPresetText(draft, 'content', draft.contentPreference, library, chinese),
        },
      },
    },
  }
}

function presetSelection(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function presetString(value: unknown, field: string, fallback = ''): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw new Error(`Invalid ${field}`)
  return value
}

function configurationFromPreset(value: unknown): FleetConfigurationDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Team preset')
  const preset = value as Record<string, unknown>
  if (typeof preset.core !== 'object' || preset.core === null || Array.isArray(preset.core)) throw new Error('Invalid Team core')
  if (typeof preset.modules !== 'object' || preset.modules === null || Array.isArray(preset.modules)) throw new Error('Invalid Team modules')
  const core = preset.core as Record<string, unknown>
  const modules = preset.modules as Record<string, unknown>
  if (!Array.isArray(core.members)) throw new Error('Invalid Team members')
  const messageValue = modules[FLEET_MESSAGE_CONFIGURATION_MODULE]
  const resourcesValue = modules[FLEET_RESOURCES_CONFIGURATION_MODULE]
  const uiValue = modules[FLEET_UI_CONFIGURATION_MODULE]
  const accessValue = modules[FLEET_ACCESS_CONFIGURATION_MODULE]
  if (typeof messageValue !== 'object' || messageValue === null || Array.isArray(messageValue)) throw new Error('Invalid Team message settings')
  if (typeof resourcesValue !== 'object' || resourcesValue === null || Array.isArray(resourcesValue)) throw new Error('Invalid Team resource settings')
  if (typeof uiValue !== 'object' || uiValue === null || Array.isArray(uiValue)) throw new Error('Invalid Team UI settings')
  const message = messageValue as Record<string, unknown>
  const ui = uiValue as Record<string, unknown>
  const memberNames: string[] = []
  const memberColors: string[] = []
  const members = core.members.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`Invalid member ${index + 1}`)
    }
    const member = value as Record<string, unknown>
    if (member.canVote !== undefined && typeof member.canVote !== 'boolean') {
      throw new Error(`Invalid member ${index + 1} voting setting`)
    }
    const configuredName = presetString(member.name, 'member name').trim()
    const configuredColor = presetString(member.color, 'member color').trim()
    const name = configuredName || generateMemberDisplayName(memberNames)
    const color = configuredColor.length === 0
      ? generateFleetMemberColor(memberColors)
      : normalizeFleetMemberColor(configuredColor)
    memberNames.push(name)
    memberColors.push(color)
    return newMember({
      id: presetString(member.id, 'member id'),
      name,
      color,
      role: presetString(member.role, 'member role'),
      responsibilities: presetString(member.responsibilities, 'member responsibilities'),
      prompt: presetString(member.prompt, 'member prompt'),
      provider: presetString(member.provider, 'member provider'),
      model: presetString(member.model, 'member model'),
      ...(member.canVote === undefined ? {} : { canVote: member.canVote }),
      ...(member.toolGroups === undefined ? {} : { toolGroups: structuredClone(member.toolGroups) }),
      ...(member.permissions === undefined ? {} : { permissions: structuredClone(member.permissions) }),
      access: memberAccessFromConfiguration(accessValue, presetString(member.id, 'member id')),
      ...(member.contacts === undefined ? {} : { contacts: structuredClone(member.contacts) }),
      sourcePresetId: typeof member.sourcePresetId === 'string' ? member.sourcePresetId : null,
      modified: typeof member.modified === 'boolean' ? member.modified : true,
    })
  })
  const assistantSeed = defaultAssistant(members)
  const assistantValue = core.assistant
  const assistant = typeof assistantValue !== 'object' || assistantValue === null || Array.isArray(assistantValue)
    ? assistantSeed
    : (() => {
        const value = assistantValue as Record<string, unknown>
        const configuredName = presetString(value.name, 'assistant name').trim()
        const configuredColor = presetString(value.color, 'assistant color').trim()
        return newMember({
          id: presetString(value.id, 'assistant id', assistantSeed.id),
          name: configuredName || assistantSeed.name,
          color: configuredColor.length === 0 ? assistantSeed.color : normalizeFleetMemberColor(configuredColor),
          role: presetString(value.role, 'assistant role', assistantSeed.role),
          responsibilities: presetString(
            value.responsibilities ?? value.responsibility,
            'assistant responsibilities',
            assistantSeed.responsibilities,
          ),
          prompt: presetString(value.prompt, 'assistant prompt'),
          provider: presetString(value.provider, 'assistant provider'),
          model: presetString(value.model, 'assistant model'),
          ...(value.toolGroups === undefined ? {} : { toolGroups: structuredClone(value.toolGroups) }),
          ...(value.permissions === undefined ? {} : { permissions: structuredClone(value.permissions) }),
          access: memberAccessFromConfiguration(accessValue, presetString(value.id, 'assistant id', assistantSeed.id)),
          ...(value.contacts === undefined ? {} : { contacts: structuredClone(value.contacts) }),
          sourcePresetId: null,
          modified: typeof value.modified === 'boolean' ? value.modified : true,
        })
      })()
  const editor = typeof ui.editor === 'object'
    && ui.editor !== null
    && !Array.isArray(ui.editor)
    ? ui.editor as Record<string, unknown>
    : {}
  const selections = typeof editor.presetSelections === 'object'
    && editor.presetSelections !== null
    && !Array.isArray(editor.presetSelections)
    ? editor.presetSelections as Record<string, unknown>
    : {}
  const defaultChannel = typeof message.defaultChannel === 'object'
    && message.defaultChannel !== null
    && !Array.isArray(message.defaultChannel)
    ? message.defaultChannel as Record<string, unknown>
    : {}
  const userAccess = typeof ui.userAccess === 'object'
    && ui.userAccess !== null
    && !Array.isArray(ui.userAccess)
    ? ui.userAccess as Record<string, unknown>
    : {}
  const extensionModules = Object.fromEntries(Object.entries(modules).filter(([id]) => (
    id !== FLEET_MESSAGE_CONFIGURATION_MODULE
      && id !== FLEET_RESOURCES_CONFIGURATION_MODULE
      && id !== FLEET_UI_CONFIGURATION_MODULE
  )).map(([id, module]) => [id, structuredClone(module)]))
  return {
    name: presetString(core.name, 'Team name'),
    positioning: presetString(editor.positioning ?? core.positioning, 'Team positioning'),
    assistant,
    members,
    channelId: presetString(defaultChannel.id, 'channel id', 'main'),
    channelName: presetString(defaultChannel.name, 'channel name', 'Main'),
    rules: presetString(editor.rules ?? message.rules, 'rules'),
    collaborationMethod: presetString(editor.collaborationMethod ?? message.collaborationMethod, 'collaboration method'),
    sharedResources: [],
    updateDensity: presetString(userAccess.updateDensity, 'update density', 'concise'),
    notificationPolicy: presetString(userAccess.notificationPolicy, 'notification policy', 'decisions'),
    contentPreference: presetString(editor.contentPreference ?? userAccess.contentPreference, 'content preference'),
    presetSelections: {
      positioning: presetSelection(selections.positioning),
      rules: presetSelection(selections.rules),
      collaboration: presetSelection(selections.collaboration),
      content: presetSelection(selections.content),
      resources: presetSelection(selections.resources),
    },
    extensionModules,
  }
}

function configurationPreset(draft: FleetConfigurationDraft, library: PresetLibrary, chinese: boolean): object {
  return {
    core: {
      name: draft.name,
      positioning: resolvedPresetText(draft, 'positioning', draft.positioning, library, chinese),
      assistant: { ...configuredActor(draft.assistant), modified: draft.assistant.modified },
      members: draft.members.map(member => ({
        ...configuredActor(member),
        sourcePresetId: member.sourcePresetId,
        modified: member.modified,
      })),
    },
    modules: {
      ...fleetConfigurationModules.valuesWithDefaults(draft.extensionModules),
      [FLEET_ACCESS_CONFIGURATION_MODULE]: configuredAccess(draft),
      [FLEET_MESSAGE_CONFIGURATION_MODULE]: {
        defaultChannel: { id: draft.channelId, name: draft.channelName },
        rules: resolvedPresetText(draft, 'rules', draft.rules, library, chinese),
        collaborationMethod: resolvedPresetText(draft, 'collaboration', draft.collaborationMethod, library, chinese),
      },
      [FLEET_RESOURCES_CONFIGURATION_MODULE]: {
        policy: resolvedPresetText(draft, 'resources', '', library, chinese),
        items: [],
      },
      [FLEET_UI_CONFIGURATION_MODULE]: {
        userAccess: {
          updateDensity: draft.updateDensity,
          notificationPolicy: draft.notificationPolicy,
          contentPreference: resolvedPresetText(draft, 'content', draft.contentPreference, library, chinese),
        },
        editor: {
          positioning: draft.positioning,
          rules: draft.rules,
          collaborationMethod: draft.collaborationMethod,
          contentPreference: draft.contentPreference,
          presetSelections: draft.presetSelections,
        },
      },
    },
  }
}

interface StoredTeamPreset {
  readonly id: string
  readonly name: string
  readonly savedAt: string
  readonly configuration: unknown
}

const LOCAL_TEAM_PRESETS_KEY = 'dsh-agent-fleet.team-presets'

function readStoredTeamPresets(): readonly StoredTeamPreset[] {
  if (typeof window === 'undefined') return []
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(LOCAL_TEAM_PRESETS_KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is StoredTeamPreset => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return false
      const preset = item as Record<string, unknown>
      return typeof preset.id === 'string'
        && typeof preset.name === 'string'
        && typeof preset.savedAt === 'string'
        && preset.configuration !== undefined
    })
  } catch {
    return []
  }
}

interface QuickTeamTemplate {
  readonly id: string
  readonly storedId?: string
  readonly builtIn?: boolean
  readonly name: string
  readonly source: string
  readonly summary: string
  readonly description: string
  readonly configuration: FleetConfigurationDraft
}

function quickLocalTemplate(
  preset: StoredTeamPreset,
  configuration: FleetConfigurationDraft,
  chinese: boolean,
): QuickTeamTemplate {
  return {
    id: `local:${preset.id}`,
    storedId: preset.id,
    name: preset.name,
    source: chinese ? '本地模板' : 'Local template',
    summary: chinese
      ? `${configuration.members.length + 1} 名成员 · 已保存`
      : `${configuration.members.length + 1} members · saved locally`,
    description: configuration.positioning.trim() || (chinese
      ? '保存在本机的自定义团队配置。'
      : 'A custom Team configuration saved on this device.'),
    configuration,
  }
}

function comparableActor(member: MemberDraft): Omit<MemberDraft, 'key' | 'modified'> {
  const { key: _key, modified: _modified, ...actor } = member
  return actor
}

function configurationDraftChanged(current: FleetConfigurationDraft, initial: FleetConfigurationDraft): boolean {
  const comparable = (draft: FleetConfigurationDraft): object => ({
    name: draft.name,
    positioning: draft.positioning,
    channelId: draft.channelId,
    channelName: draft.channelName,
    rules: draft.rules,
    collaborationMethod: draft.collaborationMethod,
    sharedResources: draft.sharedResources.map(file => [file.name, file.size, file.lastModified, file.type]),
    updateDensity: draft.updateDensity,
    notificationPolicy: draft.notificationPolicy,
    contentPreference: draft.contentPreference,
    presetSelections: draft.presetSelections,
    extensionModules: draft.extensionModules,
    assistant: comparableActor(draft.assistant),
    members: draft.members.map(comparableActor),
  })
  return JSON.stringify(comparable(current)) !== JSON.stringify(comparable(initial))
}

function quickTeamTemplates(chinese: boolean): readonly QuickTeamTemplate[] {
  const text = (zh: string, en: string): string => chinese ? zh : en
  const base = emptyConfiguration()
  const complete = FULL_TEAM_TEMPLATES.map((template): QuickTeamTemplate => {
    const configuration = configurationFromPreset(chinese
      ? template.configuration.zh
      : template.configuration.en)
    return {
      id: template.id,
      builtIn: true,
      name: text(template.nameZh, template.nameEn),
      source: text('内置完整模板', 'Complete built-in'),
      summary: text(
        `${configuration.members.length + 1} 名成员 · 完整配置`,
        `${configuration.members.length + 1} members · complete configuration`,
      ),
      description: configuration.positioning,
      configuration,
    }
  })
  const builtIn: readonly QuickTeamTemplate[] = [
    {
      id: 'blank',
      builtIn: true,
      name: text('空白团队', 'Blank Team'),
      source: text('内置模板', 'Built-in'),
      summary: text('一名助理 · 稍后组建', '1 assistant · assemble later'),
      description: text(
        '只建立一个可运行的团队空间，成员和协作偏好可以在启动后与助理 Agent 讨论添加。',
        'Create a runnable Team space now, then work with the assistant Agent to add members and collaboration preferences.',
      ),
      configuration: {
        ...base,
        name: text('新团队', 'New Team'),
      },
    },
  ]
  const local = readStoredTeamPresets().flatMap((preset): readonly QuickTeamTemplate[] => {
    try {
      const configuration = configurationFromPreset(preset.configuration)
      return [quickLocalTemplate(preset, configuration, chinese)]
    } catch {
      return []
    }
  })
  const contributed = fleetConfigurationModules.getSnapshot().flatMap(module => (
    module.templates ?? []
  ).flatMap((template): readonly QuickTeamTemplate[] => {
    try {
      const configuration = configurationFromPreset(template.configuration)
      return [{
        id: `extension:${module.id}:${template.id}`,
        name: text(template.nameZh, template.nameEn),
        source: text(template.sourceZh ?? module.labelZh, template.sourceEn ?? module.labelEn),
        summary: text(
          `${configuration.members.length + 1} 名成员 · 扩展模板`,
          `${configuration.members.length + 1} members · extension template`,
        ),
        description: configuration.positioning,
        configuration,
      }]
    } catch {
      return []
    }
  }))
  return [
    ...complete,
    ...builtIn,
    ...contributed,
    ...local,
  ]
}

function memberConfigurationChanged(member: MemberDraft, initial: MemberDraft): boolean {
  return member.id !== initial.id
    || member.name !== initial.name
    || member.color !== initial.color
    || member.role !== initial.role
    || member.responsibilities !== initial.responsibilities
    || member.prompt !== initial.prompt
    || member.provider !== initial.provider
    || member.model !== initial.model
    || JSON.stringify(member.toolGroups) !== JSON.stringify(initial.toolGroups)
    || JSON.stringify(member.permissions) !== JSON.stringify(initial.permissions)
    || JSON.stringify(member.access) !== JSON.stringify(initial.access)
}

function memberPermissionEntries(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function parseMemberPermissionEntries(value: string): readonly string[] {
  return [...new Set(value.split(/[\n,]/u).map(item => item.trim()).filter(Boolean))]
}

const SETUP_PERMISSION_PROFILES = [
  {
    id: 'observe', name: ['只查看', 'View only'],
    description: ['可以阅读消息、状态和共享内容，不能推进工作或管理团队。', 'Can read messages, status, and shared content, but cannot advance work or manage the Team.'],
    toolGroups: ['messages', 'resources', 'status'], permissions: [],
  },
  {
    id: 'collaborate', name: ['参与工作', 'Collaborate'],
    description: ['可以发消息、加入协作并领取工作，但不能修改团队设置。', 'Can message, collaborate, and claim work, but cannot change Team settings.'],
    toolGroups: [...DEFAULT_MEMBER_TOOL_GROUPS], permissions: [],
  },
  {
    id: 'lead', name: ['负责工作', 'Lead work'],
    description: ['可以写共享资源、管理频道和会议并发起投票。', 'Can write shared resources, manage channels and meetings, and create votes.'],
    toolGroups: [...DEFAULT_MEMBER_TOOL_GROUPS],
    permissions: ['channel.manage', 'meeting.manage', 'vote.create', 'resource.write'],
  },
  {
    id: 'admin', name: ['管理团队', 'Manage Team'],
    description: ['拥有内置 Fleet 能力的完整管理权限，包括调整团队。', 'Has full management access to built-in Fleet capabilities, including Team changes.'],
    toolGroups: [...DEFAULT_MEMBER_TOOL_GROUPS], permissions: [...DEFAULT_MEMBER_PERMISSIONS],
  },
] as const

const SETUP_ACCESS_CATEGORIES = [
  {
    id: 'conversations', name: ['团队会话', 'Team conversations'],
    description: ['控制频道和成员私聊的查看、发言与管理范围。', 'Controls which channels and direct conversations can be read, posted to, or managed.'],
    kinds: ['conversation'],
  },
  {
    id: 'content', name: ['文件与工作内容', 'Files and work content'],
    description: ['控制文件、文档、工作区、Git 仓库和共享资源。', 'Controls files, documents, workspaces, Git repositories, and shared resources.'],
    kinds: ['document', 'file', 'git-repository', 'lark-resource', 'resource', 'workspace'],
  },
  {
    id: 'team', name: ['团队本身', 'The Team itself'],
    description: ['控制针对团队整体的查看和管理操作。', 'Controls viewing and management actions aimed at the Team itself.'],
    kinds: ['team'],
  },
] as const

const SETUP_ACCESS_KIND_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  conversation: ['会话', 'Conversation'],
  document: ['文档', 'Document'],
  file: ['文件', 'File'],
  'git-repository': ['Git 仓库', 'Git repository'],
  'lark-resource': ['飞书资源', 'Lark resource'],
  resource: ['共享资源', 'Shared resource'],
  team: ['团队', 'Team'],
  workspace: ['工作区', 'Workspace'],
}

const SETUP_PERMISSION_DESCRIPTIONS: Readonly<Record<string, readonly [string, string]>> = {
  messages: ['读取和发送团队消息。', 'Read and send Team messages.'],
  coordination: ['加入会议和使用团队协作能力。', 'Join meetings and use Team coordination tools.'],
  resources: ['读取共享资源、查看和领取工作。', 'Read shared resources and view or claim work.'],
  status: ['读取并更新成员状态。', 'Read and update member status.'],
  'channel.manage': ['创建和调整频道。', 'Create and change channels.'],
  'meeting.manage': ['创建、更新和结束会议。', 'Create, update, and end meetings.'],
  'vote.create': ['发起团队投票。', 'Create Team votes.'],
  'resource.write': ['创建和修改共享资源。', 'Create and modify shared resources.'],
  'team.manage': ['调整团队成员和团队设置。', 'Change Team members and Team settings.'],
}

function sameMemberPermissionValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(value => right.includes(value))
}

function setupPermissionProfile(member: MemberDraft): string | undefined {
  const tools = memberPermissionEntries(member.toolGroups)
  const actions = memberPermissionEntries(member.permissions)
  return SETUP_PERMISSION_PROFILES.find(profile => (
    sameMemberPermissionValues(tools, profile.toolGroups)
      && sameMemberPermissionValues(actions, profile.permissions)
  ))?.id
}

function setupPermissionDescription(value: string, chinese: boolean): string {
  const copy = SETUP_PERMISSION_DESCRIPTIONS[value]
  return copy === undefined
    ? (chinese ? `扩展能力 ${value}，具体范围由提供它的插件定义。` : `Extension capability ${value}; its provider plugin defines the exact scope.`)
    : copy[chinese ? 0 : 1]
}

function MemberSetupAuthorization({ member, onChange }: {
  readonly member: MemberDraft
  readonly onChange: (member: MemberDraft) => void
}): ReactElement {
  const chinese = isChineseLocale()
  const text = (zh: string, en: string): string => chinese ? zh : en
  const [mode, setMode] = useState<'simple' | 'detailed'>('simple')
  const [ruleDraft, setRuleDraft] = useState<{
    resourceKind: string
    resourceId: string
    effect: 'allow' | 'deny'
    scope: 'self' | 'tree'
    levels: readonly MemberAccessLevel[]
  }>({ resourceKind: 'conversation', resourceId: '', effect: 'allow', scope: 'self', levels: ['read'] })
  const selectedProfile = setupPermissionProfile(member)
  const setCategoryMode = (kinds: readonly string[], value: MemberAccessMode): void => {
    const restricted = new Set(member.access.restrictedKinds)
    for (const kind of kinds) value === 'restricted' ? restricted.add(kind) : restricted.delete(kind)
    onChange({ ...member, access: { ...member.access, restrictedKinds: [...restricted] } })
  }
  const addRule = (): void => {
    const resourceId = ruleDraft.resourceId.trim()
    if (resourceId.length === 0 || ruleDraft.levels.length === 0) return
    onChange({
      ...member,
      access: {
        ...member.access,
        rules: [...member.access.rules, {
          id: `setup-${Date.now().toString(36)}-${member.access.rules.length + 1}`,
          resourceKind: ruleDraft.resourceKind,
          resourceId,
          effect: ruleDraft.effect,
          scope: ruleDraft.scope,
          levels: ruleDraft.levels,
        }],
      },
    })
    setRuleDraft({ ...ruleDraft, resourceId: '' })
  }
  return jsxs('section', {
    className: 'dsh-fleet-member-auth',
    children: [
      jsxs('div', {
        className: 'dsh-fleet-member-auth-head',
        children: [
          jsxs('div', { children: [
            jsx('h3', { children: text('权限与访问', 'Permissions and access') }),
            jsx('p', { children: text('权限决定能做什么；资源访问决定能对哪些内容做。', 'Permissions decide what this member can do; resource access decides which content they can do it to.') }),
          ] }),
          jsxs('div', {
            className: 'dsh-fleet-member-auth-mode',
            role: 'group',
            'aria-label': text('配置精细程度', 'Configuration detail'),
            children: [
              jsx('button', { type: 'button', 'aria-pressed': mode === 'simple', onClick: () => setMode('simple'), children: text('简单', 'Simple') }),
              jsx('button', { type: 'button', 'aria-pressed': mode === 'detailed', onClick: () => setMode('detailed'), children: text('详细', 'Detailed') }),
            ],
          }),
        ],
      }),
      mode === 'simple'
        ? jsxs(Fragment, { children: [
          jsx('h4', { className: 'dsh-fleet-member-auth-section-title', children: text('能做什么', 'What they can do') }),
          jsx('div', {
            className: 'dsh-fleet-member-auth-options',
            children: [
              ...SETUP_PERMISSION_PROFILES.map(profile => jsxs('button', {
                type: 'button',
                className: 'dsh-fleet-member-auth-option',
                'aria-pressed': selectedProfile === profile.id,
                onClick: () => onChange({ ...member, toolGroups: [...profile.toolGroups], permissions: [...profile.permissions] }),
                children: [
                  jsx('strong', { children: profile.name[chinese ? 0 : 1] }),
                  jsx('span', { children: profile.description[chinese ? 0 : 1] }),
                ],
              }, profile.id)),
              selectedProfile === undefined && jsxs('button', {
                type: 'button', className: 'dsh-fleet-member-auth-option', 'aria-pressed': 'true',
                onClick: () => setMode('detailed'),
                children: [
                  jsx('strong', { children: text('自定义设置', 'Custom setup') }),
                  jsx('span', { children: text('当前使用了单独配置；切到详细档查看或修改。', 'Individual settings are active; switch to Detailed to inspect or change them.') }),
                ],
              }),
            ],
          }),
          jsx('h4', { className: 'dsh-fleet-member-auth-section-title', children: text('能访问哪些内容', 'Which content they can access') }),
          jsx('div', {
            className: 'dsh-fleet-member-access-categories',
            children: SETUP_ACCESS_CATEGORIES.map(category => {
              const restrictedCount = category.kinds.filter(kind => member.access.restrictedKinds.includes(kind)).length
              const categoryMode = restrictedCount === 0 ? 'inherit' : restrictedCount === category.kinds.length ? 'restricted' : 'mixed'
              return jsxs('label', {
                className: 'dsh-fleet-member-access-category',
                children: [
                  jsxs('span', { children: [
                    jsx('strong', { children: category.name[chinese ? 0 : 1] }),
                    jsx('small', { children: category.description[chinese ? 0 : 1] }),
                  ] }),
                  jsxs('select', {
                    value: categoryMode,
                    onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                      if (event.currentTarget.value !== 'mixed') setCategoryMode(category.kinds, event.currentTarget.value as MemberAccessMode)
                    },
                    children: [
                      jsx('option', { value: 'inherit', children: text('按团队默认范围', 'Use Team defaults') }),
                      jsx('option', { value: 'restricted', children: text('仅限允许清单', 'Allow-list only') }),
                      categoryMode === 'mixed' && jsx('option', { value: 'mixed', children: text('混合设置', 'Mixed setup') }),
                    ],
                  }),
                ],
              }, category.id)
            }),
          }),
          jsx('p', {
            className: 'dsh-fleet-member-auth-note',
            children: member.access.rules.length === 0
              ? text('当前没有具体资源例外。需要只开放或禁止某个会话、文件或工作区时，请使用详细档。', 'There are no resource exceptions. Use Detailed to allow or deny a specific conversation, file, or workspace.')
              : text(`另有 ${member.access.rules.length} 条具体资源例外；可在详细档查看。`, `${member.access.rules.length} specific resource exceptions are also active; inspect them in Detailed.`),
          }),
        ] })
        : jsxs(Fragment, { children: [
          jsx('h4', { className: 'dsh-fleet-member-auth-section-title', children: text('工具与操作', 'Tools and actions') }),
          jsx('p', { className: 'dsh-fleet-member-auth-note', children: text('工具组决定成员能看到哪些工具；操作权限决定这些工具能执行哪些高影响动作。每行一项。', 'Tool groups decide which tools are visible; action permissions decide which high-impact actions those tools can perform. Use one item per line.') }),
          jsxs('div', { className: 'dsh-fleet-member-auth-technical', children: [
            jsxs('label', { children: [
              jsx('strong', { children: text('工具组', 'Tool groups') }),
              jsx('textarea', {
                className: 'dsh-fleet-config-textarea',
                value: memberPermissionEntries(member.toolGroups).join('\n'), spellCheck: false,
                onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange({ ...member, toolGroups: parseMemberPermissionEntries(event.target.value) }),
              }),
              jsx('span', { children: memberPermissionEntries(member.toolGroups).map(value => `${value} — ${setupPermissionDescription(value, chinese)}`).join('\n') || text('没有工具组：成员看不到 Fleet 工具。', 'No tool groups: the member sees no Fleet tools.') }),
            ] }),
            jsxs('label', { children: [
              jsx('strong', { children: text('额外操作权限', 'Additional action permissions') }),
              jsx('textarea', {
                className: 'dsh-fleet-config-textarea',
                value: memberPermissionEntries(member.permissions).join('\n'), spellCheck: false,
                onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange({ ...member, permissions: parseMemberPermissionEntries(event.target.value) }),
              }),
              jsx('span', { children: memberPermissionEntries(member.permissions).map(value => `${value} — ${setupPermissionDescription(value, chinese)}`).join('\n') || text('没有额外操作权限。', 'No additional action permissions.') }),
            ] }),
          ] }),
          jsx('h4', { className: 'dsh-fleet-member-auth-section-title', children: text('各类资源的默认方式', 'Default access by resource type') }),
          jsx('div', {
            className: 'dsh-fleet-member-access-kinds',
            children: Object.entries(SETUP_ACCESS_KIND_NAMES).map(([kind, copy]) => jsxs('label', {
              children: [
                jsxs('span', { children: [
                  jsx('strong', { children: copy[chinese ? 0 : 1] }),
                  jsx('small', { children: member.access.restrictedKinds.includes(kind)
                    ? text('没有匹配的允许规则时，拒绝访问。', 'Deny access when no allow rule matches.')
                    : text('没有匹配规则时，沿用团队和资源的默认范围。', 'Use Team and resource defaults when no rule matches.') }),
                ] }),
                jsxs('select', {
                  value: member.access.restrictedKinds.includes(kind) ? 'restricted' : 'inherit',
                  onChange: (event: ChangeEvent<HTMLSelectElement>) => setCategoryMode([kind], event.currentTarget.value as MemberAccessMode),
                  children: [
                    jsx('option', { value: 'inherit', children: text('沿用默认', 'Use defaults') }),
                    jsx('option', { value: 'restricted', children: text('仅限允许规则', 'Allow-list only') }),
                  ],
                }),
              ],
            }, kind)),
          }),
          jsx('h4', { className: 'dsh-fleet-member-auth-section-title', children: text('具体资源例外', 'Specific resource exceptions') }),
          member.access.rules.length === 0
            ? jsx('p', { className: 'dsh-fleet-member-auth-note', children: text('没有例外规则。', 'No exception rules.') })
            : jsx('div', { className: 'dsh-fleet-member-access-rules', children: member.access.rules.map(rule => jsxs('div', {
              children: [
                jsxs('span', { children: [
                  jsx('strong', { children: `${rule.effect === 'allow' ? text('允许', 'Allow') : text('禁止', 'Deny')} · ${SETUP_ACCESS_KIND_NAMES[rule.resourceKind]?.[chinese ? 0 : 1] ?? rule.resourceKind}` }),
                  jsx('small', { children: `${rule.resourceId} · ${rule.scope === 'tree' ? text('包含下级', 'includes children') : text('仅此资源', 'this resource only')} · ${rule.levels.join(', ')}` }),
                ] }),
                jsx('button', { type: 'button', onClick: () => onChange({ ...member, access: { ...member.access, rules: member.access.rules.filter(candidate => candidate.id !== rule.id) } }), children: text('删除', 'Delete') }),
              ],
            }, rule.id)) }),
          jsxs('div', { className: 'dsh-fleet-member-access-rule-form', children: [
            jsxs('label', { children: [jsx('span', { children: text('资源类型', 'Resource type') }), jsx('select', { value: ruleDraft.resourceKind, onChange: (event: ChangeEvent<HTMLSelectElement>) => setRuleDraft({ ...ruleDraft, resourceKind: event.currentTarget.value }), children: Object.entries(SETUP_ACCESS_KIND_NAMES).map(([kind, copy]) => jsx('option', { value: kind, children: copy[chinese ? 0 : 1] }, kind)) })] }),
            jsxs('label', { children: [jsx('span', { children: text('资源标识', 'Resource identifier') }), jsx('input', { value: ruleDraft.resourceId, placeholder: text('会话 ID、路径或资源 ID', 'Conversation ID, path, or resource ID'), onChange: (event: ChangeEvent<HTMLInputElement>) => setRuleDraft({ ...ruleDraft, resourceId: event.currentTarget.value }) })] }),
            jsxs('label', { children: [jsx('span', { children: text('效果', 'Effect') }), jsx('select', { value: ruleDraft.effect, onChange: (event: ChangeEvent<HTMLSelectElement>) => setRuleDraft({ ...ruleDraft, effect: event.currentTarget.value as 'allow' | 'deny' }), children: [jsx('option', { value: 'allow', children: text('允许', 'Allow') }), jsx('option', { value: 'deny', children: text('禁止', 'Deny') })] })] }),
            jsxs('label', { children: [jsx('span', { children: text('范围', 'Scope') }), jsx('select', { value: ruleDraft.scope, onChange: (event: ChangeEvent<HTMLSelectElement>) => setRuleDraft({ ...ruleDraft, scope: event.currentTarget.value as 'self' | 'tree' }), children: [jsx('option', { value: 'self', children: text('仅此资源', 'This resource only') }), jsx('option', { value: 'tree', children: text('包含下级', 'Include children') })] })] }),
            jsxs('fieldset', { children: [
              jsx('legend', { children: text('允许或禁止哪些动作', 'Actions to allow or deny') }),
              jsx('div', { children: (['read', 'write', 'use', 'manage'] as const).map(level => jsxs('label', { children: [jsx('input', { type: 'checkbox', checked: ruleDraft.levels.includes(level), onChange: () => setRuleDraft({ ...ruleDraft, levels: ruleDraft.levels.includes(level) ? ruleDraft.levels.filter(value => value !== level) : [...ruleDraft.levels, level] }) }), text(level === 'read' ? '查看' : level === 'write' ? '编辑' : level === 'use' ? '使用' : '管理', level === 'read' ? 'Read' : level === 'write' ? 'Write' : level === 'use' ? 'Use' : 'Manage')] }, level)) }),
            ] }),
            jsx('button', { type: 'button', disabled: ruleDraft.resourceId.trim().length === 0 || ruleDraft.levels.length === 0, onClick: addRule, children: text('添加例外', 'Add exception') }),
          ] }),
        ] }),
    ],
  })
}

function memberHasData(member: MemberDraft): boolean {
  return [member.id, member.role, member.responsibilities, member.prompt, member.provider, member.model]
    .some(value => value.trim().length > 0)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface ConfigurationFieldProps {
  readonly label: string
  readonly wide?: boolean
  readonly required?: boolean
  readonly className?: string
  readonly children: ReactNode
}

function ConfigurationField({ label, wide = false, required = false, className, children }: ConfigurationFieldProps): ReactElement {
  return jsxs('label', {
    className: [
      'dsh-fleet-config-field',
      wide ? 'dsh-fleet-config-field-wide' : '',
      className ?? '',
    ].filter(Boolean).join(' '),
    children: [
      jsxs('span', {
        className: 'dsh-fleet-config-label',
        children: [
          label,
          required && jsx('span', {
            className: 'dsh-fleet-config-required',
            children: isChineseLocale() ? '必填' : 'Required',
          }),
        ],
      }),
      children,
    ],
  })
}

interface ConfigurationDialogProps {
  readonly initial: FleetConfigurationDraft
  readonly initialTab?: ConfigurationTab
  readonly sessionId?: string
  onBack: (draft: FleetConfigurationDraft, modified: boolean) => void
  onConfirm: (draft: FleetConfigurationDraft) => void | Promise<void>
}

interface MemberEditorProps {
  readonly initial: MemberDraft
  readonly existing: boolean
  readonly preset?: boolean
  readonly fixed?: boolean
  readonly sessionId?: string
  onExport?: () => void
  onCancel: () => void
  onSave: (member: MemberDraft) => void
  onRemove?: () => void
}

const EMPTY_FLEET_MODEL_DIRECTORY: FleetModelDirectoryState = {
  current: null,
  routable: null,
  groups: [],
  failures: [],
  status: 'idle',
  error: null,
}

function useFleetModelDirectory(sessionId: string | undefined): readonly [
  FleetModelDirectory | undefined,
  FleetModelDirectoryState,
] {
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

interface MemberRemovalDialogProps {
  readonly member: MemberDraft
  onCancel: () => void
  onConfirm: () => void
}

interface LibraryRemovalDialogProps {
  readonly title: string
  readonly copy: string
  readonly cancelLabel?: string
  readonly confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}

type LibraryRemovalRequest =
  | { readonly kind: 'field'; readonly target: FieldPresetTarget; readonly id: string; readonly name: string }
  | { readonly kind: 'group'; readonly id: string; readonly name: string }

function FleetLibraryRemovalDialog({
  title,
  copy,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: LibraryRemovalDialogProps): ReactElement {
  const titleId = useId()
  const cancelButton = useRef<HTMLButtonElement>(null)
  const chinese = isChineseLocale()

  useEffect(() => {
    cancelButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return jsxs('div', {
    className: 'dsh-fleet-member-editor-overlay',
    role: 'presentation',
    children: [
      jsx('div', { className: 'dsh-fleet-config-mask', 'aria-hidden': 'true', onClick: onCancel }),
      jsxs('section', {
        className: 'dsh-fleet-member-editor-panel dsh-fleet-member-remove-panel',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        children: [
          jsx('header', {
            className: 'dsh-fleet-config-header',
            children: jsx('h2', { id: titleId, className: 'dsh-fleet-config-title', children: title }),
          }),
          jsx('div', {
            className: 'dsh-fleet-member-editor-body',
            children: jsx('p', { className: 'dsh-fleet-member-remove-copy', children: copy }),
          }),
          jsxs('footer', {
            className: 'dsh-fleet-config-footer',
            children: [
              jsx('button', {
                ref: cancelButton,
                type: 'button',
                className: 'dsh-fleet-config-action dsh-fleet-config-cancel',
                onClick: onCancel,
                children: cancelLabel ?? (chinese ? '取消' : 'Cancel'),
              }),
              jsx('button', {
                type: 'button',
                className: 'dsh-fleet-config-action dsh-fleet-member-remove-confirm',
                onClick: onConfirm,
                children: confirmLabel ?? (chinese ? '移除' : 'Remove'),
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

function FleetMemberRemovalDialog({ member, onCancel, onConfirm }: MemberRemovalDialogProps): ReactElement {
  const chinese = isChineseLocale()
  const text = (zh: string, en: string): string => chinese ? zh : en
  return jsx(FleetLibraryRemovalDialog, {
    title: text('解雇成员', 'Dismiss member'),
    copy: text(
      `要解雇 ${member.name} 吗？ta 将会回到人才市场（可能不会再回来了）`,
      `Dismiss ${member.name}? They will return to the talent market (and may never come back).`,
    ),
    cancelLabel: text('取消', 'Cancel'),
    confirmLabel: text('解雇', 'Dismiss'),
    onCancel,
    onConfirm,
  })
}

function FleetMemberEditor({
  initial,
  existing,
  preset = false,
  fixed = false,
  sessionId,
  onCancel,
  onSave,
  onRemove,
  onExport,
}: MemberEditorProps): ReactElement {
  const titleId = useId()
  const cancelButton = useRef<HTMLButtonElement>(null)
  const [member, setMember] = useState(initial)
  const [modelDirectory, modelDirectoryState] = useFleetModelDirectory(sessionId)
  const chinese = isChineseLocale()
  const text = (zh: string, en: string): string => chinese ? zh : en
  const modelChoices = useMemo(() => modelDirectoryState.groups.flatMap(group => group.models.map(model => ({
    key: JSON.stringify([group.id, model.id]),
    provider: group.id,
    model: model.id,
  }))), [modelDirectoryState.groups])
  const selectedModelKey = member.provider === '' && member.model === ''
    ? ''
    : JSON.stringify([member.provider, member.model])
  const selectedModelAdvertised = modelChoices.some(choice => choice.key === selectedModelKey)
  const inheritedModel = modelDirectoryState.current === null
    ? text('继承当前会话', 'Inherit current session')
    : text(
      `继承当前会话（${modelDirectoryState.current.provider} · ${modelDirectoryState.current.model}）`,
      `Inherit current session (${modelDirectoryState.current.provider} · ${modelDirectoryState.current.model})`,
    )
  const modelStatus = modelDirectory === undefined
    ? text('DSH 模型目录尚不可用；现有配置会保持不变。', 'The DSH model directory is unavailable; the existing selection is preserved.')
    : modelDirectoryState.status === 'loading'
      ? text('正在读取 DSH 模型目录…', 'Loading the DSH model directory…')
      : modelDirectoryState.status === 'error'
        ? text('模型目录读取失败。', 'The model directory could not be loaded.')
        : modelDirectoryState.failures.length > 0
          ? text('部分 Provider 未能加载，仍可选择其余模型。', 'Some providers failed to load; the remaining models are available.')
          : text(
            '使用 DSH 当前模型目录；选择“继承当前会话”时跟随创建会话的模型。',
            'Uses the current DSH catalog; choose “Inherit current session” to follow the creating session model.',
          )
  const valid = member.id.trim().length > 0
    && member.name.trim().length > 0
    && (preset || /^#[0-9a-fA-F]{6}$/.test(member.color))
    && member.role.trim().length > 0
    && member.responsibilities.trim().length > 0
    && memberPermissionEntries(member.toolGroups).every(value => /^[a-z][a-z0-9-]*$/u.test(value))
    && memberPermissionEntries(member.permissions).every(value => /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u.test(value))

  useEffect(() => {
    cancelButton.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return jsxs('div', {
    className: 'dsh-fleet-member-editor-overlay',
    role: 'presentation',
    children: [
      jsx('div', { className: 'dsh-fleet-config-mask', 'aria-hidden': 'true', onClick: onCancel }),
      jsxs('section', {
        className: 'dsh-fleet-member-editor-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        children: [
          jsx('header', {
            className: 'dsh-fleet-config-header',
            children: jsx('h2', {
              id: titleId,
              className: 'dsh-fleet-config-title',
              children: fixed
                ? text('配置团队助理', 'Configure Team assistant')
                : preset
                ? text('添加预设成员', 'Add preset member')
                : existing ? text('配置成员', 'Configure member') : text('添加成员', 'Add member'),
            }),
          }),
          jsx('div', {
            className: 'dsh-fleet-member-editor-body',
            children: jsxs('div', {
              className: 'dsh-fleet-config-grid',
              children: [
                jsx(ConfigurationField, {
                  label: text('成员标识', 'Member id'),
                  required: true,
                  children: jsx('input', {
                    className: 'dsh-fleet-config-input',
                    required: true,
                    value: member.id,
                    placeholder: 'architect',
                    onChange: (event: ChangeEvent<HTMLInputElement>) => setMember({ ...member, id: event.target.value }),
                  }),
                }),
                jsx(ConfigurationField, {
                  label: text('显示名称', 'Display name'),
                  required: true,
                  children: jsx('input', {
                    className: 'dsh-fleet-config-input',
                    required: true,
                    value: member.name,
                    placeholder: text('产品架构师', 'Product architect'),
                    onChange: (event: ChangeEvent<HTMLInputElement>) => setMember({ ...member, name: event.target.value }),
                  }),
                }),
                !preset && jsxs('div', {
                  className: 'dsh-fleet-config-field dsh-fleet-config-field-wide',
                  children: [
                    jsx('span', { className: 'dsh-fleet-config-label', children: text('姓名卡配色', 'Name card color') }),
                    jsx('div', {
                      className: 'dsh-fleet-member-color-options',
                      role: 'group',
                      'aria-label': text('姓名卡配色', 'Name card color'),
                      children: [
                        ...FLEET_MEMBER_COLOR_PRESETS.map((color, index) => {
                        const label = text(`推荐配色 ${index + 1}`, `Suggested color ${index + 1}`)
                        return jsx('button', {
                          type: 'button',
                          className: 'dsh-fleet-member-color-option',
                          'aria-label': label,
                          'aria-pressed': member.color === color,
                          title: label,
                          style: { '--dsh-fleet-member-accent': color } as CSSProperties,
                          onClick: () => setMember({ ...member, color }),
                        }, color)
                        }),
                        jsxs('div', {
                          className: 'dsh-fleet-member-color-custom',
                          children: [
                            jsx('input', {
                              type: 'color',
                              className: 'dsh-fleet-member-color-input',
                              value: /^#[0-9a-fA-F]{6}$/.test(member.color) ? member.color : '#000000',
                              'aria-label': text('自定义姓名卡颜色', 'Custom name card color'),
                              onChange: (event: ChangeEvent<HTMLInputElement>) => setMember({
                                ...member,
                                color: event.target.value,
                              }),
                            }),
                            jsx('input', {
                              type: 'text',
                              className: 'dsh-fleet-member-color-value',
                              value: member.color.toUpperCase(),
                              maxLength: 7,
                              spellCheck: false,
                              'aria-label': text('精确颜色值', 'Exact color value'),
                              onChange: (event: ChangeEvent<HTMLInputElement>) => setMember({
                                ...member,
                                color: event.target.value,
                              }),
                            }),
                            jsx('button', {
                              type: 'button',
                              className: 'dsh-fleet-member-color-randomize',
                              onClick: () => setMember({ ...member, color: generateFleetMemberColor([member.color]) }),
                              children: text('随机', 'Randomize'),
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
                jsx(ConfigurationField, {
                  label: text('角色', 'Role'),
                  wide: true,
                  required: true,
                  children: jsx('input', {
                    className: 'dsh-fleet-config-input',
                    required: true,
                    value: member.role,
                    placeholder: text('例如：产品与架构', 'For example: product and architecture'),
                    onChange: (event: ChangeEvent<HTMLInputElement>) => setMember({ ...member, role: event.target.value }),
                  }),
                }),
                jsx(ConfigurationField, {
                  label: text('职责', 'Responsibilities'),
                  wide: true,
                  required: true,
                  children: jsx('textarea', {
                    className: 'dsh-fleet-config-textarea',
                    required: true,
                    value: member.responsibilities,
                    placeholder: text('描述该成员长期负责的工作', 'Describe the work this member owns over time'),
                    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setMember({ ...member, responsibilities: event.target.value }),
                  }),
                }),
                jsx(ConfigurationField, {
                  label: text('成员提示词（可选）', 'Member prompt (optional)'),
                  wide: true,
                  children: jsx('textarea', {
                    className: 'dsh-fleet-config-textarea',
                    value: member.prompt,
                    placeholder: text('补充具体的行为指引或上下文', 'Add specific behavior guidance or context'),
                    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setMember({ ...member, prompt: event.target.value }),
                  }),
                }),
                !preset && jsx('div', {
                  className: 'dsh-fleet-config-field-wide',
                  children: jsx(MemberSetupAuthorization, { member, onChange: setMember }),
                }),
                jsx(ConfigurationField, {
                  label: text('模型', 'Model'),
                  wide: true,
                  children: jsxs('div', {
                    className: 'dsh-fleet-config-model-control',
                    children: [
                      jsxs('select', {
                        className: 'dsh-fleet-config-select',
                        value: selectedModelKey,
                        'aria-label': text('成员模型', 'Member model'),
                        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                          if (event.target.value === '') {
                            setMember({ ...member, provider: '', model: '' })
                            return
                          }
                          const choice = modelChoices.find(candidate => candidate.key === event.target.value)
                          if (choice !== undefined) setMember({ ...member, provider: choice.provider, model: choice.model })
                        },
                        children: [
                          jsx('option', { value: '', children: inheritedModel }),
                          selectedModelKey !== '' && !selectedModelAdvertised && jsx('option', {
                            value: selectedModelKey,
                            children: text(
                              `当前配置（${member.provider || '—'} · ${member.model || '—'}）`,
                              `Current selection (${member.provider || '—'} · ${member.model || '—'})`,
                            ),
                          }),
                          ...modelDirectoryState.groups.map(group => jsx('optgroup', {
                            label: group.name,
                            children: group.models.map(model => jsx('option', {
                              value: JSON.stringify([group.id, model.id]),
                              title: model.description,
                              children: model.name,
                            }, model.id)),
                          }, group.id)),
                        ],
                      }),
                      jsxs('p', {
                        className: 'dsh-fleet-config-model-status',
                        'data-error': modelDirectoryState.status === 'error' ? 'true' : undefined,
                        children: [
                          jsx('span', { children: modelStatus }),
                          modelDirectory !== undefined && modelDirectoryState.status === 'error' && jsx('button', {
                            type: 'button',
                            className: 'dsh-fleet-config-model-retry',
                            onClick: () => void modelDirectory.load().catch(() => undefined),
                            children: text('重试', 'Retry'),
                          }),
                        ],
                      }),
                    ],
                  }),
                }),
              ],
            }),
          }),
          jsxs('footer', {
            className: 'dsh-fleet-config-footer',
            children: [
              onExport !== undefined && jsx('button', {
                type: 'button',
                className: 'dsh-fleet-member-editor-export',
                onClick: onExport,
                children: text('导出预设', 'Export preset'),
              }),
              existing && onRemove !== undefined && jsx('button', {
                type: 'button',
                className: 'dsh-fleet-member-editor-remove',
                onClick: onRemove,
                children: text('解雇成员', 'Dismiss member'),
              }),
              jsx('button', {
                ref: cancelButton,
                type: 'button',
                className: 'dsh-fleet-config-action dsh-fleet-config-cancel',
                onClick: onCancel,
                children: text('取消', 'Cancel'),
              }),
              jsx('button', {
                type: 'button',
                className: 'dsh-fleet-config-action dsh-fleet-config-confirm',
                disabled: !valid,
                onClick: () => onSave({
                  ...member,
                  modified: member.modified || memberConfigurationChanged(member, initial),
                }),
                children: preset ? text('保存预设', 'Save preset') : text('保存', 'Save'),
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

function FleetConfigurationDialog({ initial, initialTab = 'basics', sessionId, onBack, onConfirm }: ConfigurationDialogProps): ReactElement {
  const titleId = useId()
  const cancelButton = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState(initial)
  const configurationModuleContributions = useSyncExternalStore(
    fleetConfigurationModules.subscribe,
    fleetConfigurationModules.getSnapshot,
    fleetConfigurationModules.getSnapshot,
  )
  const [activeTab, setActiveTab] = useState<ConfigurationTab>(initialTab)
  const [editingAssistant, setEditingAssistant] = useState<MemberDraft | null>(null)
  const [editingMember, setEditingMember] = useState<MemberDraft | null>(null)
  const [editingMemberPreset, setEditingMemberPreset] = useState<MemberDraft | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<MemberDraft | null>(null)
  const [pendingLibraryRemoval, setPendingLibraryRemoval] = useState<LibraryRemovalRequest | null>(null)
  const [dragView, setDragView] = useState<MemberDragView | null>(null)
  const [presetError, setPresetError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [storedTeamPresets, setStoredTeamPresets] = useState(readStoredTeamPresets)
  const [localPresetOpen, setLocalPresetOpen] = useState(false)
  const [localPresetPosition, setLocalPresetPosition] = useState<FloatingMenuPosition | null>(null)
  const [localPresetSaved, setLocalPresetSaved] = useState(false)
  const [activeFieldPreset, setActiveFieldPreset] = useState<FieldPresetTarget | null>(null)
  const [fieldPresetPosition, setFieldPresetPosition] = useState<FloatingMenuPosition | null>(null)
  const [fieldPresetTooltip, setFieldPresetTooltip] = useState<{
    readonly detail: string
    readonly position: FloatingMenuPosition
  } | null>(null)
  const [creatingFieldPreset, setCreatingFieldPreset] = useState<FieldPresetTarget | null>(null)
  const [newFieldPresetName, setNewFieldPresetName] = useState<readonly [string, string]>(['', ''])
  const [newFieldPresetDetail, setNewFieldPresetDetail] = useState<readonly [string, string]>(['', ''])
  const [presetLibrary, setPresetLibrary] = useState(readPresetLibrary)
  const [activePresetGroup, setActivePresetGroup] = useState(MEMBER_PRESET_ALL_GROUP)
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const [groupMenuPosition, setGroupMenuPosition] = useState<FloatingMenuPosition | null>(null)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [resourceDragActive, setResourceDragActive] = useState(false)
  const [memberPresetDragActive, setMemberPresetDragActive] = useState(false)
  const presetInputRef = useRef<HTMLInputElement>(null)
  const resourceInputRef = useRef<HTMLInputElement>(null)
  const presetActionsRef = useRef<HTMLDivElement>(null)
  const memberPresetControlsRef = useRef<HTMLDivElement>(null)
  const memberSlotRef = useRef<HTMLDivElement>(null)
  const presetsRef = useRef<HTMLDivElement>(null)
  const memberRefs = useRef(new Map<number, HTMLButtonElement>())
  const drag = useRef<MemberDrag | null>(null)
  const moveDragRef = useRef<((event: PointerEvent) => void) | null>(null)
  const finishDragRef = useRef<((event: PointerEvent) => void) | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => { cancelButton.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape'
        && editingAssistant === null
        && editingMember === null
        && editingMemberPreset === null
        && pendingRemoval === null
        && pendingLibraryRemoval === null) onBack(draft, configurationDraftChanged(draft, initial))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [draft, editingAssistant, editingMember, editingMemberPreset, onBack, pendingLibraryRemoval, pendingRemoval])

  useEffect(() => {
    const move = (event: PointerEvent): void => { moveDragRef.current?.(event) }
    const finish = (event: PointerEvent): void => { finishDragRef.current?.(event) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
    }
  }, [])

  useEffect(() => {
    const closePresetMenus = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && !presetActionsRef.current?.contains(target)) setLocalPresetOpen(false)
      if (target instanceof Node && !memberPresetControlsRef.current?.contains(target)) setGroupMenuOpen(false)
      if (!(target instanceof Element) || target.closest('.dsh-fleet-config-field-preset-control') === null) {
        setActiveFieldPreset(null)
        setCreatingFieldPreset(null)
      }
    }
    const closeFloatingMenus = (): void => {
      setLocalPresetOpen(false)
      setActiveFieldPreset(null)
      setGroupMenuOpen(false)
      setFieldPresetTooltip(null)
    }
    document.addEventListener('pointerdown', closePresetMenus)
    window.addEventListener('resize', closeFloatingMenus)
    return () => {
      document.removeEventListener('pointerdown', closePresetMenus)
      window.removeEventListener('resize', closeFloatingMenus)
    }
  }, [])

  const chinese = isChineseLocale()
  const text = (zh: string, en: string): string => chinese ? zh : en
  const editableConfigurationModules = configurationModuleContributions.filter(module => module.Editor !== undefined)
  const configurationTabs: readonly (readonly [ConfigurationTab, string])[] = [
    ['basics', text('基本信息', 'Basics')],
    ['user', text('用户接入', 'User access')],
    ['members', text('团队成员', 'Members')],
    ...(editableConfigurationModules.length === 0
      ? []
      : [['modules', text('扩展设置', 'Extensions')] as const]),
  ]
  const updatePresetLibrary = (update: (current: PresetLibrary) => PresetLibrary): void => {
    setPresetLibrary(current => {
      const next = update(current)
      try { storePresetLibrary(next) } catch { /* Local additions remain available for this dialog. */ }
      return next
    })
  }
  const rotatePresetMemberName = (presetId: string, occupied: readonly string[]): void => {
    updatePresetLibrary(current => {
      const replacement = generateMemberDisplayName([
        ...current.members.map(preset => preset.displayName),
        ...draft.members.map(member => member.name),
        ...occupied,
      ])
      return {
        ...current,
        members: current.members.map(preset => preset.id === presetId
          ? { ...preset, displayName: replacement }
          : preset),
      }
    })
  }
  const memberFromPreset = (preset: MemberPreset): MemberDraft => {
    let id = preset.id
    let suffix = 2
    while (draft.members.some(member => member.id === id)) {
      id = `${preset.id}-${suffix}`
      suffix += 1
    }
    return newMember({
      id,
      name: preset.displayName,
      color: generateFleetMemberColor(draft.members.map(member => member.color)),
      role: text(...preset.role),
      responsibilities: text(...preset.responsibilities),
      prompt: preset.prompt,
      provider: preset.provider,
      model: preset.model,
      ...(preset.toolGroups === undefined ? {} : { toolGroups: structuredClone(preset.toolGroups) }),
      ...(preset.permissions === undefined ? {} : { permissions: structuredClone(preset.permissions) }),
      ...(preset.contacts === undefined ? {} : { contacts: structuredClone(preset.contacts) }),
      sourcePresetId: preset.id,
    })
  }
  const addSharedFiles = (files: FileList | readonly File[]): void => {
    const incoming = Array.from(files)
    if (incoming.length === 0) return
    setDraft(current => {
      const known = new Set(current.sharedResources.map(file => `${file.name}:${file.size}:${file.lastModified}`))
      const added = incoming.filter(file => {
        const identity = `${file.name}:${file.size}:${file.lastModified}`
        if (known.has(identity)) return false
        known.add(identity)
        return true
      })
      return added.length === 0
        ? current
        : { ...current, sharedResources: [...current.sharedResources, ...added] }
    })
  }
  const importPreset = async (file: File): Promise<void> => {
    try {
      const value: unknown = JSON.parse(await file.text())
      const importedFields = parseFieldPresetImport(value)
      if (importedFields !== undefined) {
        updatePresetLibrary(current => ({
          ...current,
          fields: mergeFieldPresetImport(current.fields, importedFields),
        }))
        setPresetError(null)
        return
      }
      const imported = configurationFromPreset(value)
      setDraft(imported)
      setPresetError(null)
    } catch {
      setPresetError(text(
        '无法导入：文件不是有效的团队模板或字段预设库。',
        'Could not import: this is not a valid Team template or field preset library.',
      ))
    }
  }
  const loadStoredTeamPreset = (preset: StoredTeamPreset): void => {
    try {
      setDraft(configurationFromPreset(preset.configuration))
      setPresetError(null)
      setLocalPresetOpen(false)
    } catch {
      setPresetError(text('无法读取：本地团队预设已损坏。', 'Could not load: this local Team preset is invalid.'))
    }
  }
  const saveStoredTeamPreset = (): void => {
    const savedAt = new Date().toISOString()
    const name = draft.name.trim() || text('未命名团队', 'Untitled Team')
    const preset: StoredTeamPreset = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      savedAt,
      configuration: configurationPreset(draft, presetLibrary, chinese),
    }
    try {
      const stored = [preset, ...storedTeamPresets]
      window.localStorage.setItem(LOCAL_TEAM_PRESETS_KEY, JSON.stringify(stored))
      setStoredTeamPresets(stored)
      setPresetError(null)
      setLocalPresetSaved(true)
      window.setTimeout(() => setLocalPresetSaved(false), 1400)
    } catch {
      setPresetError(text('无法保存：浏览器本地存储不可用。', 'Could not save: browser local storage is unavailable.'))
    }
  }
  const exportPreset = (): void => {
    const blob = new Blob([JSON.stringify(configurationPreset(draft, presetLibrary, chinese), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stem = draft.name.trim().replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-').replace(/^-|-$/g, '')
    link.href = url
    link.download = `${stem || 'fleet-team'}-preset.json`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }
  const importMemberPresets = async (file: File): Promise<void> => {
    try {
      const value: unknown = JSON.parse(await file.text())
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid')
      const imported = value as Partial<PresetLibrary>
      if (!Array.isArray(imported.groups) || !Array.isArray(imported.members)) throw new Error('invalid')
      const tuple = (candidate: unknown): candidate is readonly [string, string] => Array.isArray(candidate)
        && candidate.length === 2
        && candidate.every(item => typeof item === 'string')
      if (!imported.groups.every(group => typeof group === 'object'
        && group !== null
        && typeof group.id === 'string'
        && tuple(group.name))) throw new Error('invalid')
      if (!imported.members.every(member => typeof member === 'object'
        && member !== null
        && typeof member.id === 'string'
        && typeof member.displayName === 'string'
        && tuple(member.role)
        && tuple(member.responsibilities)
        && typeof member.prompt === 'string'
        && typeof member.provider === 'string'
        && typeof member.model === 'string'
        && typeof member.groupId === 'string')) throw new Error('invalid')
      const normalized = normalizedPresetLibrary({
        groups: imported.groups,
        members: imported.members,
        fields: presetLibrary.fields,
      })
      updatePresetLibrary(current => ({ ...current, groups: normalized.groups, members: normalized.members }))
      setActivePresetGroup(MEMBER_PRESET_ALL_GROUP)
      setPresetError(null)
    } catch {
      setPresetError(text('无法导入：文件不是有效的成员预设库。', 'Could not import: this is not a valid member preset library.'))
    }
  }
  const exportMemberPreset = (preset: MemberPreset): void => {
    const group = presetLibrary.groups.find(candidate => candidate.id === preset.groupId)
    const blob = new Blob([JSON.stringify({
      version: 1,
      groups: group === undefined ? [] : [group],
      members: [preset],
    }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${preset.id}-preset.json`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }
  const addFieldPreset = (target: FieldPresetTarget): void => {
    const name = newFieldPresetName.map(value => value.trim()) as [string, string]
    const detail = newFieldPresetDetail.map(value => value.trim()) as [string, string]
    if ([...name, ...detail].some(value => value.length === 0)) return
    const preset: FieldContentPreset = {
      id: `custom-${Date.now().toString(36)}`,
      name,
      detail,
    }
    updatePresetLibrary(current => ({
      ...current,
      fields: { ...current.fields, [target]: [...current.fields[target], preset] },
    }))
    setNewFieldPresetName(['', ''])
    setNewFieldPresetDetail(['', ''])
    setCreatingFieldPreset(null)
  }
  const fieldPresetHeader = (target: FieldPresetTarget, label: string): ReactElement => {
    const selected = draft.presetSelections[target]
    const presets = presetLibrary.fields[target]
    return jsxs('div', {
      className: 'dsh-fleet-config-field-heading',
      children: [
        jsx('span', { className: 'dsh-fleet-config-label', children: label }),
        jsxs('div', {
          className: 'dsh-fleet-config-field-preset-control',
          children: [
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-config-field-preset-trigger',
              'aria-expanded': activeFieldPreset === target,
              onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                if (activeFieldPreset === target) {
                  setActiveFieldPreset(null)
                  return
                }
                setFieldPresetPosition(floatingMenuPosition(event.currentTarget.getBoundingClientRect(), 310, 220))
                setActiveFieldPreset(target)
              },
              children: text('预设', 'Presets'),
            }),
            activeFieldPreset === target && fieldPresetPosition !== null && jsx('div', {
              className: 'dsh-fleet-config-field-preset-menu',
              style: fieldPresetPosition,
              children: [
                ...presets.map(preset => jsxs('div', {
                  className: 'dsh-fleet-config-field-preset-option-row',
                  children: [
                    jsxs('button', {
                      type: 'button',
                      className: 'dsh-fleet-config-field-preset-option',
                      disabled: selected.includes(preset.id),
                      onClick: () => {
                        setDraft(current => ({
                          ...current,
                          presetSelections: {
                            ...current.presetSelections,
                            [target]: [...current.presetSelections[target], preset.id],
                          },
                        }))
                        setActiveFieldPreset(null)
                      },
                      children: [
                        jsx('span', { className: 'dsh-fleet-config-field-preset-option-name', children: text(...preset.name) }),
                        jsx('span', { className: 'dsh-fleet-config-field-preset-option-detail', children: text(...preset.detail) }),
                      ],
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'dsh-fleet-config-field-preset-option-remove',
                      'aria-label': text(`删除预设 ${preset.name[0]}`, `Delete preset ${preset.name[1]}`),
                      onClick: () => setPendingLibraryRemoval({
                        kind: 'field', target, id: preset.id, name: text(...preset.name),
                      }),
                      children: jsx(CancelMark, {}),
                    }),
                  ],
                }, preset.id)),
                creatingFieldPreset === target
                  ? jsxs('div', {
                    className: 'dsh-fleet-config-field-preset-create',
                    children: [
                      jsx('input', {
                        className: 'dsh-fleet-config-input',
                        value: newFieldPresetName[0],
                        'aria-label': text('预设中文名称', 'Preset name in Chinese'),
                        placeholder: text('中文名称', 'Chinese name'),
                        onChange: (event: ChangeEvent<HTMLInputElement>) => setNewFieldPresetName([
                          event.target.value,
                          newFieldPresetName[1],
                        ]),
                      }),
                      jsx('input', {
                        className: 'dsh-fleet-config-input',
                        value: newFieldPresetName[1],
                        'aria-label': text('预设英文名称', 'Preset name in English'),
                        placeholder: text('英文名称', 'English name'),
                        onChange: (event: ChangeEvent<HTMLInputElement>) => setNewFieldPresetName([
                          newFieldPresetName[0],
                          event.target.value,
                        ]),
                      }),
                      jsx('textarea', {
                        className: 'dsh-fleet-config-textarea',
                        value: newFieldPresetDetail[0],
                        'aria-label': text('预设中文内容', 'Preset details in Chinese'),
                        placeholder: text('中文详细内容', 'Details in Chinese'),
                        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setNewFieldPresetDetail([
                          event.target.value,
                          newFieldPresetDetail[1],
                        ]),
                      }),
                      jsx('textarea', {
                        className: 'dsh-fleet-config-textarea',
                        value: newFieldPresetDetail[1],
                        'aria-label': text('预设英文内容', 'Preset details in English'),
                        placeholder: text('英文详细内容', 'Details in English'),
                        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setNewFieldPresetDetail([
                          newFieldPresetDetail[0],
                          event.target.value,
                        ]),
                      }),
                      jsxs('div', {
                        className: 'dsh-fleet-config-field-preset-create-actions',
                        children: [
                          jsx('button', {
                            type: 'button',
                            className: 'dsh-fleet-config-preset-action',
                            onClick: () => setCreatingFieldPreset(null),
                            children: text('取消', 'Cancel'),
                          }),
                          jsx('button', {
                            type: 'button',
                            className: 'dsh-fleet-config-preset-action',
                            disabled: [...newFieldPresetName, ...newFieldPresetDetail]
                              .some(value => value.trim().length === 0),
                            onClick: () => addFieldPreset(target),
                            children: text('添加', 'Add'),
                          }),
                        ],
                      }),
                    ],
                  })
                  : jsx('button', {
                    type: 'button',
                    className: 'dsh-fleet-config-field-preset-new',
                    onClick: () => {
                      setNewFieldPresetName(['', ''])
                      setNewFieldPresetDetail(['', ''])
                      setCreatingFieldPreset(target)
                    },
                    children: text('+ 新建预设', '+ New preset'),
                  }),
              ],
            }),
          ],
        }),
      ],
    })
  }
  const fieldPresetChips = (target: FieldPresetTarget): ReactElement | null => {
    const presets = presetLibrary.fields[target]
    const selected = draft.presetSelections[target]
    const chips = selected.flatMap(id => {
      const preset = presets.find(candidate => candidate.id === id)
      if (preset === undefined) return []
      const detail = text(...preset.detail)
      const showTooltip = (anchor: HTMLElement): void => setFieldPresetTooltip({
        detail,
        position: floatingMenuPosition(anchor.getBoundingClientRect(), 240, 120),
      })
      return [jsxs('span', {
        className: 'dsh-fleet-config-field-preset-chip',
        onMouseEnter: (event: ReactMouseEvent<HTMLSpanElement>) => showTooltip(event.currentTarget),
        onMouseLeave: () => setFieldPresetTooltip(null),
        onFocus: (event: ReactFocusEvent<HTMLSpanElement>) => showTooltip(event.currentTarget),
        onBlur: () => setFieldPresetTooltip(null),
        children: [
          jsx('span', { children: text(...preset.name) }),
          jsx('button', {
            type: 'button',
            className: 'dsh-fleet-config-field-preset-remove',
            'aria-label': text(`移除预设 ${preset.name[0]}`, `Remove preset ${preset.name[1]}`),
            onClick: () => setDraft(current => ({
              ...current,
              presetSelections: {
                ...current.presetSelections,
                [target]: current.presetSelections[target].filter(candidate => candidate !== id),
              },
            })),
            children: jsx(CancelMark, {}),
          }),
        ],
      }, id)]
    })
    return chips.length === 0 ? null : jsx('div', { className: 'dsh-fleet-config-field-preset-row', children: chips })
  }
  const addPresetGroup = (): void => {
    const name = newGroupName.trim()
    if (name.length === 0) return
    const group: MemberPresetGroup = {
      id: `group-${Date.now().toString(36)}`,
      name: [name, name],
    }
    updatePresetLibrary(current => ({ ...current, groups: [...current.groups, group] }))
    setActivePresetGroup(group.id)
    setNewGroupName('')
    setCreatingGroup(false)
    setGroupMenuOpen(false)
  }
  const placeMemberAt = (key: number, index: number): void => {
    setDraft(current => {
      const moving = current.members.find(member => member.key === key)
      if (moving === undefined) return current
      const members = current.members.filter(member => member.key !== key)
      members.splice(Math.max(0, Math.min(index, members.length)), 0, moving)
      return { ...current, members }
    })
  }
  const projectDrag = (clientX: number, clientY: number, source: MemberDragSource): {
    readonly destination: 'members' | 'remove' | null
    readonly index: number
  } => {
    const memberSlot = memberSlotRef.current
    const presets = presetsRef.current
    if (memberSlot === null || presets === null) return { destination: null, index: 0 }
    const dividerY = (memberSlot.getBoundingClientRect().bottom + presets.getBoundingClientRect().top) / 2
    if (clientY > dividerY) {
      return { destination: source.kind === 'member' ? 'remove' : null, index: 0 }
    }
    const bounds = draft.members
      .filter(member => source.kind !== 'member' || member.key !== source.key)
      .flatMap(member => {
        const element = memberRefs.current.get(member.key)
        return element === undefined ? [] : [element.getBoundingClientRect()]
      })
    return { destination: 'members', index: memberInsertionIndex(bounds, clientX, clientY) }
  }
  const beginPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, source: MemberDragSource): void => {
    if (event.button !== 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    drag.current = {
      source,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
      moved: false,
    }
  }
  const movePointerDrag = (event: PointerEvent): void => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    if (!active.moved && Math.hypot(event.clientX - active.originX, event.clientY - active.originY) < 8) return
    active.moved = true
    event.preventDefault()
    const projection = projectDrag(event.clientX, event.clientY, active.source)
    setDragView({
      source: active.source,
      x: event.clientX,
      y: event.clientY,
      offsetX: active.offsetX,
      offsetY: active.offsetY,
      width: active.width,
      height: active.height,
      destination: projection.destination,
      index: projection.index,
    })
  }
  const finishPointerDrag = (event: PointerEvent): void => {
    const active = drag.current
    if (active === null || active.pointerId !== event.pointerId) return
    drag.current = null
    if (!active.moved) return
    event.preventDefault()
    setDragView(null)
    if (event.type === 'pointercancel') return
    const projection = projectDrag(event.clientX, event.clientY, active.source)
    if (projection.destination === 'members') {
      const source = active.source
      if (source.kind === 'member') {
        placeMemberAt(source.key, projection.index)
      } else {
        const preset = presetLibrary.members.find(candidate => candidate.id === source.id)
        if (preset !== undefined) {
          setDraft(current => {
            let id = preset.id
            let suffix = 2
            while (current.members.some(member => member.id === id)) {
              id = `${preset.id}-${suffix}`
              suffix += 1
            }
            const members = [...current.members]
            members.splice(Math.max(0, Math.min(projection.index, members.length)), 0, newMember({
              id,
              name: preset.displayName,
              color: generateFleetMemberColor(current.members.map(member => member.color)),
              role: text(...preset.role),
              responsibilities: text(...preset.responsibilities),
              prompt: preset.prompt,
              provider: preset.provider,
              model: preset.model,
              sourcePresetId: preset.id,
            }))
            return { ...current, members }
          })
          rotatePresetMemberName(preset.id, [preset.displayName])
        }
      }
    } else if (projection.destination === 'remove' && active.source.kind === 'member') {
      const sourceKey = active.source.key
      const member = draft.members.find(candidate => candidate.key === sourceKey)
      if (member !== undefined) {
        if (member.modified && memberHasData(member)) setPendingRemoval(member)
        else setDraft(current => ({ ...current, members: current.members.filter(candidate => candidate.key !== sourceKey) }))
      }
    }
    suppressClick.current = true
    window.setTimeout(() => { suppressClick.current = false }, 0)
  }
  moveDragRef.current = movePointerDrag
  finishDragRef.current = finishPointerDrag
  const valid = draft.name.trim().length > 0
    && draft.channelId.trim().length > 0
    && draft.channelName.trim().length > 0
    && draft.assistant.id.trim().length > 0
    && draft.assistant.name.trim().length > 0
    && draft.assistant.role.trim().length > 0
    && draft.assistant.responsibilities.trim().length > 0
    && draft.members.every(member =>
      member.id.trim().length > 0
      && member.name.trim().length > 0
      && member.role.trim().length > 0
      && member.responsibilities.trim().length > 0,
    )
  const editingExistingMember = editingMember !== null
    && draft.members.some(member => member.key === editingMember.key)

  const dragSource = dragView?.source
  const movingMember = dragSource?.kind === 'member'
    ? draft.members.find(member => member.key === dragSource.key)
    : undefined
  const movingPreset = dragSource?.kind === 'preset'
    ? presetLibrary.members.find(preset => preset.id === dragSource.id)
    : undefined
  const movingName = movingMember?.name ?? movingPreset?.displayName
  const movingRole = movingMember?.role ?? (movingPreset === undefined ? undefined : text(...movingPreset.role))
  const movingResponsibilities = movingMember?.responsibilities
    ?? (movingPreset === undefined ? undefined : text(...movingPreset.responsibilities))
  const movingColor = movingMember?.color
  const visibleMembers = draft.members.filter(member =>
    dragSource?.kind !== 'member' || member.key !== dragSource.key,
  )
  const activePresetGroupName = activePresetGroup === MEMBER_PRESET_ALL_GROUP
    ? text('全部', 'All')
    : presetLibrary.groups.find(group => group.id === activePresetGroup)?.name[chinese ? 0 : 1]
      ?? text('全部', 'All')
  const visibleMemberPresets = presetLibrary.members.filter(preset =>
    (activePresetGroup === MEMBER_PRESET_ALL_GROUP || preset.groupId === activePresetGroup)
      && (dragSource?.kind !== 'preset' || preset.id !== dragSource.id),
  )
  const memberCards: ReactNode[] = []
  for (let index = 0; index <= visibleMembers.length; index += 1) {
    if (dragView?.destination === 'members' && dragView.index === index) {
      memberCards.push(jsx('span', {
        className: 'dsh-fleet-config-member-drop',
        'aria-hidden': 'true',
      }, `drop-${index}`))
    }
    const member = visibleMembers[index]
    if (member === undefined) continue
    memberCards.push(jsxs('button', {
      ref: (element: HTMLButtonElement | null) => {
        if (element === null) memberRefs.current.delete(member.key)
        else memberRefs.current.set(member.key, element)
      },
      type: 'button',
      className: 'dsh-fleet-config-member',
      style: { '--dsh-fleet-member-accent': member.color } as CSSProperties,
      'aria-label': text(`配置成员 ${member.name}`, `Configure member ${member.name}`),
      'aria-keyshortcuts': 'Alt+Delete Alt+Backspace',
      onClick: () => {
        if (!suppressClick.current) setEditingMember(member)
      },
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => beginPointerDrag(event, {
        kind: 'member',
        key: member.key,
      }),
      onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.altKey && ['Backspace', 'Delete'].includes(event.key)) {
          event.preventDefault()
          setPendingRemoval(member)
          return
        }
        if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const source = draft.members.findIndex(candidate => candidate.key === member.key)
        const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
        const target = Math.max(0, Math.min(draft.members.length - 1, source + delta))
        if (source === target) return
        setDraft(current => {
          const members = [...current.members]
          const temporary = members[source]
          if (temporary === undefined || members[target] === undefined) return current
          members[source] = members[target]
          members[target] = temporary
          return { ...current, members }
        })
      },
      children: [
        jsx('span', { className: 'dsh-fleet-config-member-name', children: member.name }),
        jsxs('span', {
          className: 'dsh-fleet-config-member-details',
          children: [
            jsx('span', { className: 'dsh-fleet-config-member-role', children: member.role }),
            jsx('span', { className: 'dsh-fleet-config-member-responsibilities', children: member.responsibilities }),
          ],
        }),
      ],
    }, member.key))
  }

  return jsxs('div', {
    className: 'dsh-fleet-config-overlay',
    role: 'presentation',
    children: [
      jsx('div', {
        className: 'dsh-fleet-config-mask',
        'aria-hidden': 'true',
      }),
      jsxs('section', {
        className: 'dsh-fleet-config-panel',
        'data-tab': activeTab,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        children: [
          jsxs('header', {
            className: 'dsh-fleet-config-header',
            children: [
              jsxs('div', {
                className: 'dsh-fleet-config-title-group',
                children: [
                  jsx('h2', {
                    id: titleId,
                    className: 'dsh-fleet-config-title',
                    children: chinese ? '配置团队' : 'Configure team',
                  }),
                  jsx('p', {
                    className: 'dsh-fleet-config-intro-note',
                    children: text('以下大部分信息都可以在运行过程中更改', 'Most settings can be changed while the Team is running.'),
                  }),
                ],
              }),
              jsxs('div', {
                ref: presetActionsRef,
                className: 'dsh-fleet-config-preset-actions',
                children: [
                  jsx('button', {
                    type: 'button',
                    className: 'dsh-fleet-config-preset-action',
                    'aria-expanded': localPresetOpen,
                    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                      if (localPresetOpen) {
                        setLocalPresetOpen(false)
                        return
                      }
                      setLocalPresetPosition(floatingMenuPosition(event.currentTarget.getBoundingClientRect(), 280, 260))
                      setLocalPresetOpen(true)
                    },
                    children: text('读取模板', 'Load template'),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'dsh-fleet-config-preset-action',
                    onClick: saveStoredTeamPreset,
                    children: localPresetSaved ? text('已保存', 'Saved') : text('保存模板', 'Save template'),
                  }),
                  jsx('input', {
                    ref: presetInputRef,
                    type: 'file',
                    accept: '.json,application/json',
                    style: { display: 'none' },
                    onChange: (event: ChangeEvent<HTMLInputElement>) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file !== undefined) void importPreset(file)
                    },
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'dsh-fleet-config-preset-action',
                    onClick: () => presetInputRef.current?.click(),
                    children: text('导入模板或预设库', 'Import template or preset library'),
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'dsh-fleet-config-preset-action',
                    onClick: exportPreset,
                    children: text('导出模板', 'Export template'),
                  }),
                  localPresetOpen && localPresetPosition !== null && jsx('div', {
                    className: 'dsh-fleet-config-local-presets',
                    style: localPresetPosition,
                    children: storedTeamPresets.length === 0
                      ? jsx('div', {
                        className: 'dsh-fleet-config-local-empty',
                        children: text('还没有保存在本机的团队预设', 'No Team presets are saved locally yet'),
                      })
                      : storedTeamPresets.map(preset => jsxs('button', {
                        type: 'button',
                        className: 'dsh-fleet-config-local-preset',
                        onClick: () => loadStoredTeamPreset(preset),
                        children: [
                          jsx('span', { className: 'dsh-fleet-config-local-preset-name', children: preset.name }),
                          jsx('span', {
                            className: 'dsh-fleet-config-local-preset-time',
                            children: new Date(preset.savedAt).toLocaleString(),
                          }),
                        ],
                      }, preset.id)),
                  }),
                ],
              }),
            ],
          }),
          jsx('nav', {
            className: 'dsh-fleet-config-tabs',
            role: 'tablist',
            'aria-label': text('团队配置页面', 'Team configuration pages'),
            children: configurationTabs.map(([tab, label]) => jsx('button', {
              type: 'button',
              role: 'tab',
              className: 'dsh-fleet-config-tab',
              'aria-selected': activeTab === tab,
              onClick: () => {
                setLocalPresetOpen(false)
                setActiveFieldPreset(null)
                setGroupMenuOpen(false)
                setFieldPresetTooltip(null)
                setActiveTab(tab)
              },
              children: label,
            }, tab)),
          }),
          jsx('div', {
            className: 'dsh-fleet-config-body',
            onScroll: () => {
              setActiveFieldPreset(null)
              setGroupMenuOpen(false)
              setFieldPresetTooltip(null)
            },
            children: [
              presetError !== null && jsx('p', {
                className: 'dsh-fleet-config-preset-error',
                role: 'alert',
                children: presetError,
              }),
              activeTab === 'basics' && jsxs('section', {
                className: 'dsh-fleet-config-section',
                children: [
                  jsxs('div', {
                    className: 'dsh-fleet-config-grid',
                    children: [
                      jsx(ConfigurationField, {
                        label: text('团队名称', 'Team name'),
                        required: true,
                        children: jsx('input', {
                          className: 'dsh-fleet-config-input',
                          required: true,
                          value: draft.name,
                          placeholder: text('例如：产品工程团队', 'For example: Product engineering'),
                          onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, name: event.target.value }),
                        }),
                      }),
                      jsxs('div', {
                        className: 'dsh-fleet-config-field dsh-fleet-config-field-wide dsh-fleet-config-field-with-presets',
                        children: [
                          fieldPresetHeader('positioning', text('团队定位', 'Team remit')),
                          fieldPresetChips('positioning'),
                          jsx('textarea', {
                            className: 'dsh-fleet-config-textarea',
                            'aria-label': text('团队定位', 'Team remit'),
                            value: draft.positioning,
                            placeholder: text('描述这个团队长期负责的领域，而不是某一次任务', 'Describe the Team\'s lasting remit, not a single task'),
                            onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, positioning: event.target.value }),
                          }),
                        ],
                      }),
                      jsx(ConfigurationField, {
                        label: text('默认频道标识', 'Default channel id'),
                        required: true,
                        children: jsx('input', {
                          className: 'dsh-fleet-config-input',
                          required: true,
                          value: draft.channelId,
                          onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, channelId: event.target.value }),
                        }),
                      }),
                      jsx(ConfigurationField, {
                        label: text('默认频道名称', 'Default channel name'),
                        required: true,
                        children: jsx('input', {
                          className: 'dsh-fleet-config-input',
                          required: true,
                          value: draft.channelName,
                          onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, channelName: event.target.value }),
                        }),
                      }),
                      jsxs('div', {
                        className: 'dsh-fleet-config-field dsh-fleet-config-field-wide dsh-fleet-config-field-with-presets',
                        children: [
                          fieldPresetHeader('rules', text('规则与偏好', 'Rules and preferences')),
                          fieldPresetChips('rules'),
                          jsx('textarea', {
                            className: 'dsh-fleet-config-textarea',
                            'aria-label': text('规则与偏好', 'Rules and preferences'),
                            value: draft.rules,
                            placeholder: text('记录团队长期遵循的规则与工作偏好', 'Record lasting Team rules and working preferences'),
                            onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, rules: event.target.value }),
                          }),
                        ],
                      }),
                      jsxs('div', {
                        className: 'dsh-fleet-config-field dsh-fleet-config-field-wide dsh-fleet-config-field-with-presets',
                        children: [
                          fieldPresetHeader('collaboration', text('协作方式', 'Collaboration method')),
                          fieldPresetChips('collaboration'),
                          jsx('textarea', {
                            className: 'dsh-fleet-config-textarea',
                            'aria-label': text('协作方式', 'Collaboration method'),
                            value: draft.collaborationMethod,
                            placeholder: text('描述成员如何分工、同步与共同决策', 'Describe how members divide work, synchronize, and decide together'),
                            onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, collaborationMethod: event.target.value }),
                          }),
                        ],
                      }),
                      jsxs('div', {
                        className: 'dsh-fleet-config-field dsh-fleet-config-field-wide',
                        children: [
                          fieldPresetHeader('resources', text('共享资源', 'Shared resources')),
                          fieldPresetChips('resources'),
                          jsx('input', {
                            ref: resourceInputRef,
                            type: 'file',
                            multiple: true,
                            style: { display: 'none' },
                            onChange: (event: ChangeEvent<HTMLInputElement>) => {
                              if (event.target.files !== null) addSharedFiles(event.target.files)
                              event.target.value = ''
                            },
                          }),
                          jsx('button', {
                            type: 'button',
                            className: 'dsh-fleet-config-resource-dropzone',
                            'data-drag-active': resourceDragActive ? 'true' : 'false',
                            onClick: () => resourceInputRef.current?.click(),
                            onDragOver: (event: ReactDragEvent<HTMLButtonElement>) => {
                              if (!Array.from(event.dataTransfer.types).includes('Files')) return
                              event.preventDefault()
                              event.stopPropagation()
                              event.dataTransfer.dropEffect = 'copy'
                              setResourceDragActive(true)
                            },
                            onDragLeave: () => setResourceDragActive(false),
                            onDrop: (event: ReactDragEvent<HTMLButtonElement>) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setResourceDragActive(false)
                              addSharedFiles(event.dataTransfer.files)
                            },
                            children: text('选择本机文件，或拖到这里', 'Choose local files, or drop them here'),
                          }),
                          draft.sharedResources.length > 0 && jsx('div', {
                            className: 'dsh-fleet-config-resource-list',
                            children: draft.sharedResources.map((file, index) => jsxs('div', {
                              className: 'dsh-fleet-config-resource-item',
                              children: [
                                jsx('span', { className: 'dsh-fleet-config-resource-name', title: file.name, children: file.name }),
                                jsx('span', { className: 'dsh-fleet-config-resource-size', children: formatFileSize(file.size) }),
                                jsx('button', {
                                  type: 'button',
                                  className: 'dsh-fleet-config-resource-remove',
                                  'aria-label': text(`移除 ${file.name}`, `Remove ${file.name}`),
                                  onClick: () => setDraft({
                                    ...draft,
                                    sharedResources: draft.sharedResources.filter((_, candidate) => candidate !== index),
                                  }),
                                  children: jsx(CancelMark, {}),
                                }),
                              ],
                            }, `${file.name}:${file.size}:${file.lastModified}`)),
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
              activeTab === 'members' && jsxs('section', {
                className: 'dsh-fleet-config-section',
                children: [
                  jsx('p', {
                    className: 'dsh-fleet-config-members-requirement',
                    children: text(
                      '团队助理固定保留；其他成员可以在团队运行后继续添加。',
                      'The Team assistant stays with the Team; other members can be added after startup.',
                    ),
                  }),
                  jsx('div', {
                    ref: memberSlotRef,
                    className: 'dsh-fleet-config-members',
                    'data-drop-active': dragView?.destination === 'members' ? 'true' : 'false',
                    children: [
                      jsxs('button', {
                        type: 'button',
                        className: 'dsh-fleet-config-member',
                        'data-fixed': 'true',
                        style: { '--dsh-fleet-member-accent': draft.assistant.color } as CSSProperties,
                        'aria-label': text(`配置团队助理 ${draft.assistant.name}`, `Configure Team assistant ${draft.assistant.name}`),
                        onClick: () => setEditingAssistant(draft.assistant),
                        children: [
                          jsx('span', { className: 'dsh-fleet-config-member-name', children: draft.assistant.name }),
                          jsxs('span', {
                            className: 'dsh-fleet-config-member-details',
                            children: [
                              jsx('span', { className: 'dsh-fleet-config-member-role', children: draft.assistant.role }),
                              jsx('span', {
                                className: 'dsh-fleet-config-member-responsibilities',
                                children: draft.assistant.responsibilities,
                              }),
                            ],
                          }),
                        ],
                      }),
                      ...memberCards,
                      jsxs('button', {
                        type: 'button',
                        className: 'dsh-fleet-config-add',
                        onClick: () => setEditingMember(newMember({
                          name: randomMemberName(draft.members),
                          color: generateFleetMemberColor(draft.members.map(member => member.color)),
                        })),
                        children: [
                          jsx('span', { className: 'dsh-fleet-config-add-mark', 'aria-hidden': 'true', children: '+' }),
                          jsx('span', { children: text('添加成员', 'Add member') }),
                        ],
                      }),
                    ],
                  }),
                  jsx('p', {
                    className: 'dsh-fleet-config-drag-hint',
                    children: text(
                      '可以拖动来将成员加入或移出团队',
                      'Drag members to move them into or out of the Team.',
                    ),
                  }),
                  jsxs('div', {
                    ref: presetsRef,
                    className: 'dsh-fleet-config-presets',
                    'data-remove-active': dragView?.destination === 'remove' ? 'true' : 'false',
                    children: [
                      jsxs('div', {
                        className: 'dsh-fleet-config-presets-heading',
                        children: [
                          jsx('p', { className: 'dsh-fleet-config-presets-title', children: text('预设成员', 'Preset members') }),
                          jsxs('div', {
                            ref: memberPresetControlsRef,
                            className: 'dsh-fleet-config-presets-actions',
                            children: [
                              jsx('button', {
                                type: 'button',
                                className: 'dsh-fleet-config-presets-action',
                                'aria-expanded': groupMenuOpen,
                                onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                                  if (groupMenuOpen) {
                                    setGroupMenuOpen(false)
                                    return
                                  }
                                  setGroupMenuPosition(floatingMenuPosition(event.currentTarget.getBoundingClientRect(), 240, 220))
                                  setGroupMenuOpen(true)
                                },
                                children: text(`分组：${activePresetGroupName}`, `Group: ${activePresetGroupName}`),
                              }),
                              groupMenuOpen && groupMenuPosition !== null && jsx('div', {
                                className: 'dsh-fleet-config-group-menu',
                                style: groupMenuPosition,
                                children: [
                                  jsx('div', {
                                    className: 'dsh-fleet-config-group-row',
                                    children: jsx('button', {
                                      type: 'button',
                                      className: 'dsh-fleet-config-group-option',
                                      'aria-pressed': activePresetGroup === MEMBER_PRESET_ALL_GROUP,
                                      onClick: () => {
                                        setActivePresetGroup(MEMBER_PRESET_ALL_GROUP)
                                        setGroupMenuOpen(false)
                                      },
                                      children: text('全部', 'All'),
                                    }),
                                  }),
                                  ...presetLibrary.groups.map(group => jsxs('div', {
                                    className: 'dsh-fleet-config-group-row',
                                    children: [
                                      jsx('button', {
                                        type: 'button',
                                        className: 'dsh-fleet-config-group-option',
                                        'aria-pressed': activePresetGroup === group.id,
                                        onClick: () => {
                                          setActivePresetGroup(group.id)
                                          setGroupMenuOpen(false)
                                        },
                                        children: text(...group.name),
                                      }),
                                      !BUILT_IN_MEMBER_PRESET_GROUPS.some(candidate => candidate.id === group.id) && jsx('button', {
                                        type: 'button',
                                        className: 'dsh-fleet-config-group-remove',
                                        'aria-label': text(`删除分组 ${group.name[0]}`, `Delete group ${group.name[1]}`),
                                        onClick: () => setPendingLibraryRemoval({
                                          kind: 'group', id: group.id, name: text(...group.name),
                                        }),
                                        children: jsx(CancelMark, {}),
                                      }),
                                    ],
                                  }, group.id)),
                                  creatingGroup
                                    ? jsxs('div', {
                                      className: 'dsh-fleet-config-group-create',
                                      children: [
                                        jsx('input', {
                                          className: 'dsh-fleet-config-input',
                                          value: newGroupName,
                                          placeholder: text('分组名称', 'Group name'),
                                          onChange: (event: ChangeEvent<HTMLInputElement>) => setNewGroupName(event.target.value),
                                        }),
                                        jsx('button', {
                                          type: 'button',
                                          className: 'dsh-fleet-config-presets-action',
                                          disabled: newGroupName.trim().length === 0,
                                          onClick: addPresetGroup,
                                          children: text('添加', 'Add'),
                                        }),
                                      ],
                                    })
                                    : jsx('button', {
                                      type: 'button',
                                      className: 'dsh-fleet-config-field-preset-new',
                                      onClick: () => setCreatingGroup(true),
                                      children: text('+ 新建分组', '+ New group'),
                                    }),
                                ],
                              }),
                            ],
                          }),
                        ],
                      }),
                      jsx('div', {
                        className: 'dsh-fleet-config-preset-grid',
                        children: [
                          ...visibleMemberPresets.map(preset => jsxs('button', {
                          type: 'button',
                          className: 'dsh-fleet-config-preset',
                          onClick: () => {
                            if (!suppressClick.current) setEditingMember(memberFromPreset(preset))
                          },
                          onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => beginPointerDrag(event, {
                            kind: 'preset',
                            id: preset.id,
                          }),
                          children: [
                            jsx('span', { className: 'dsh-fleet-config-preset-name', children: preset.displayName }),
                            jsxs('span', {
                              className: 'dsh-fleet-config-preset-details',
                              children: [
                                jsx('span', { className: 'dsh-fleet-config-preset-role', children: text(...preset.role) }),
                                jsx('span', {
                                  className: 'dsh-fleet-config-preset-responsibilities',
                                  children: text(...preset.responsibilities),
                                }),
                              ],
                            }),
                          ],
                          }, preset.id)),
                          jsxs('button', {
                            type: 'button',
                            className: 'dsh-fleet-config-add',
                            'data-import-active': memberPresetDragActive ? 'true' : 'false',
                            onClick: () => setEditingMemberPreset(newMember({
                              id: `preset-${Date.now().toString(36)}`,
                              name: generateMemberDisplayName(presetLibrary.members.map(preset => preset.displayName)),
                            })),
                            onDragOver: (event: ReactDragEvent<HTMLButtonElement>) => {
                              if (!Array.from(event.dataTransfer.types).includes('Files')) return
                              event.preventDefault()
                              event.stopPropagation()
                              event.dataTransfer.dropEffect = 'copy'
                              setMemberPresetDragActive(true)
                            },
                            onDragLeave: () => setMemberPresetDragActive(false),
                            onDrop: (event: ReactDragEvent<HTMLButtonElement>) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setMemberPresetDragActive(false)
                              const file = event.dataTransfer.files[0]
                              if (file !== undefined) void importMemberPresets(file)
                            },
                            children: [
                              jsx('span', { className: 'dsh-fleet-config-add-mark', 'aria-hidden': 'true', children: '+' }),
                              jsx('span', { children: text('添加预设', 'Add preset') }),
                              jsx('span', {
                                className: 'dsh-fleet-config-preset-import-hint',
                                children: text('或拖入文件', 'or drop a file'),
                              }),
                            ],
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
              activeTab === 'user' && jsxs('section', {
                className: 'dsh-fleet-config-section',
                children: [
                  jsxs('div', {
                    className: 'dsh-fleet-config-grid',
                    children: [
                      jsx(ConfigurationField, {
                        label: text('信息密度', 'Update density'),
                        children: jsxs('select', {
                          className: 'dsh-fleet-config-select',
                          value: draft.updateDensity,
                          onChange: (event: ChangeEvent<HTMLSelectElement>) => setDraft({ ...draft, updateDensity: event.target.value }),
                          children: [
                            jsx('option', { value: 'concise', children: text('简洁', 'Concise') }),
                            jsx('option', { value: 'balanced', children: text('均衡', 'Balanced') }),
                            jsx('option', { value: 'detailed', children: text('详细', 'Detailed') }),
                          ],
                        }),
                      }),
                      jsx(ConfigurationField, {
                        label: text('通知时机', 'Notification policy'),
                        children: jsxs('select', {
                          className: 'dsh-fleet-config-select',
                          value: draft.notificationPolicy,
                          onChange: (event: ChangeEvent<HTMLSelectElement>) => setDraft({ ...draft, notificationPolicy: event.target.value }),
                          children: [
                            jsx('option', { value: 'decisions', children: text('仅需用户决策时', 'Only when a user decision is needed') }),
                            jsx('option', { value: 'milestones', children: text('重要节点', 'Important milestones') }),
                            jsx('option', { value: 'continuous', children: text('持续同步', 'Continuous updates') }),
                          ],
                        }),
                      }),
                      jsxs('div', {
                        className: 'dsh-fleet-config-field dsh-fleet-config-field-wide dsh-fleet-config-field-with-presets',
                        children: [
                          fieldPresetHeader('content', text('内容偏好', 'Content preferences')),
                          fieldPresetChips('content'),
                          jsx('textarea', {
                            className: 'dsh-fleet-config-textarea',
                            'aria-label': text('内容偏好', 'Content preferences'),
                            value: draft.contentPreference,
                            placeholder: text('例如：优先展示关键决策、实现细节或可视化结果', 'For example: prioritize key decisions, implementation details, or visual results'),
                            onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, contentPreference: event.target.value }),
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
              activeTab === 'modules' && jsx('section', {
                className: 'dsh-fleet-config-section dsh-fleet-config-module-list',
                children: editableConfigurationModules.map(module => {
                  const Editor = module.Editor!
                  return jsxs('div', {
                    className: 'dsh-fleet-config-module',
                    children: [
                      jsx('h3', {
                        className: 'dsh-fleet-config-module-title',
                        children: chinese ? module.labelZh : module.labelEn,
                      }),
                      jsx(Editor, {
                        value: draft.extensionModules[module.id] ?? module.defaultValue,
                        onChange: (value: unknown) => setDraft(current => ({
                          ...current,
                          extensionModules: { ...current.extensionModules, [module.id]: value },
                        })),
                      }),
                    ],
                  }, module.id)
                }),
              }),
            ],
          }),
          jsxs('footer', {
            className: 'dsh-fleet-config-footer',
            children: [
              !valid && jsx('span', {
                className: 'dsh-fleet-config-required-hint',
                children: text('请完成带“必填”标记的项目', 'Complete the fields marked Required'),
              }),
              jsx('button', {
                ref: cancelButton,
                type: 'button',
                className: 'dsh-fleet-config-action dsh-fleet-config-cancel',
                onClick: () => onBack(draft, configurationDraftChanged(draft, initial)),
                children: chinese ? '回到简洁界面' : 'Back to quick setup',
              }),
              jsx('button', {
                type: 'button',
                className: 'dsh-fleet-config-action dsh-fleet-config-confirm',
                disabled: !valid || submitting,
                onClick: () => {
                  if (submitting) return
                  setSubmitting(true)
                  setPresetError(null)
                  void Promise.resolve(onConfirm(draft)).catch((error: unknown) => {
                    setPresetError(error instanceof Error ? error.message : String(error))
                  }).finally(() => setSubmitting(false))
                },
                children: submitting
                  ? (chinese ? '正在准备…' : 'Preparing…')
                  : (chinese ? '确认' : 'Confirm'),
              }),
            ],
          }),
        ],
      }),
      fieldPresetTooltip !== null && jsx('div', {
        className: 'dsh-fleet-config-field-preset-tooltip',
        role: 'tooltip',
        style: fieldPresetTooltip.position,
        children: fieldPresetTooltip.detail,
      }),
      editingAssistant !== null && jsx(FleetMemberEditor, {
        initial: editingAssistant,
        existing: true,
        fixed: true,
        sessionId,
        onCancel: () => setEditingAssistant(null),
        onSave: (saved: MemberDraft) => {
          setDraft({ ...draft, assistant: saved })
          setEditingAssistant(null)
        },
      }),
      editingMember !== null && jsx(FleetMemberEditor, {
        initial: editingMember,
        existing: editingExistingMember,
        sessionId,
        onExport: !editingExistingMember && editingMember.sourcePresetId !== null
          ? () => {
            const preset = presetLibrary.members.find(candidate => candidate.id === editingMember.sourcePresetId)
            if (preset !== undefined) exportMemberPreset(preset)
          }
          : undefined,
        onCancel: () => setEditingMember(null),
        onSave: (saved: MemberDraft) => {
          const previous = draft.members.find(member => member.key === saved.key)
          setDraft({
            ...draft,
            members: previous === undefined
              ? [...draft.members, saved]
              : draft.members.map(member => member.key === saved.key ? saved : member),
          })
          if (previous === undefined && saved.sourcePresetId !== null) {
            rotatePresetMemberName(saved.sourcePresetId, [saved.name])
          }
          setEditingMember(null)
        },
        onRemove: () => {
          setDraft({
            ...draft,
            members: draft.members.filter(member => member.key !== editingMember.key),
          })
          setEditingMember(null)
        },
      }),
      editingMemberPreset !== null && jsx(FleetMemberEditor, {
        initial: editingMemberPreset,
        existing: false,
        preset: true,
        sessionId,
        onCancel: () => setEditingMemberPreset(null),
        onSave: (saved: MemberDraft) => {
          let id = saved.id
          let suffix = 2
          while (presetLibrary.members.some(preset => preset.id === id)) {
            id = `${saved.id}-${suffix}`
            suffix += 1
          }
          const preset: MemberPreset = {
            id,
            displayName: saved.name,
            role: [saved.role, saved.role],
            responsibilities: [saved.responsibilities, saved.responsibilities],
            prompt: saved.prompt,
            provider: saved.provider,
            model: saved.model,
            ...(saved.toolGroups === undefined ? {} : { toolGroups: structuredClone(saved.toolGroups) }),
            ...(saved.permissions === undefined ? {} : { permissions: structuredClone(saved.permissions) }),
            ...(saved.contacts === undefined ? {} : { contacts: structuredClone(saved.contacts) }),
            groupId: activePresetGroup === MEMBER_PRESET_ALL_GROUP
              ? MEMBER_PRESET_DEVELOPMENT_GROUP
              : activePresetGroup,
          }
          updatePresetLibrary(current => ({ ...current, members: [...current.members, preset] }))
          setEditingMemberPreset(null)
        },
        onRemove: () => setEditingMemberPreset(null),
      }),
      pendingRemoval !== null && jsx(FleetMemberRemovalDialog, {
        member: pendingRemoval,
        onCancel: () => setPendingRemoval(null),
        onConfirm: () => {
          setDraft(current => ({
            ...current,
            members: current.members.filter(member => member.key !== pendingRemoval.key),
          }))
          setPendingRemoval(null)
        },
      }),
      pendingLibraryRemoval !== null && jsx(FleetLibraryRemovalDialog, {
        title: pendingLibraryRemoval.kind === 'group'
          ? text('删除分组', 'Delete group')
          : text('删除预设', 'Delete preset'),
        copy: pendingLibraryRemoval.kind === 'group'
          ? text(
            `确定删除“${pendingLibraryRemoval.name}”分组吗？其中的预设成员会移到开发分组。`,
            `Delete the “${pendingLibraryRemoval.name}” group? Its preset members will move to Development.`,
          )
          : text(
            `确定删除“${pendingLibraryRemoval.name}”预设吗？已经引用它的字段也会移除该预设。`,
            `Delete the “${pendingLibraryRemoval.name}” preset? It will also be removed from fields that use it.`,
          ),
        onCancel: () => setPendingLibraryRemoval(null),
        onConfirm: () => {
          if (pendingLibraryRemoval.kind === 'group') {
            const groupId = pendingLibraryRemoval.id
            updatePresetLibrary(current => ({
              ...current,
              groups: current.groups.filter(group => group.id !== groupId),
              members: current.members.map(preset => preset.groupId === groupId
                ? { ...preset, groupId: MEMBER_PRESET_DEVELOPMENT_GROUP }
                : preset),
            }))
            if (activePresetGroup === groupId) setActivePresetGroup(MEMBER_PRESET_ALL_GROUP)
          } else {
            const { target, id } = pendingLibraryRemoval
            updatePresetLibrary(current => ({
              ...current,
              fields: {
                ...current.fields,
                [target]: current.fields[target].filter(preset => preset.id !== id),
              },
            }))
            setDraft(current => ({
              ...current,
              presetSelections: {
                ...current.presetSelections,
                [target]: current.presetSelections[target].filter(candidate => candidate !== id),
              },
            }))
          }
          setPendingLibraryRemoval(null)
        },
      }),
      dragView !== null
        && movingName !== undefined
        && movingRole !== undefined
        && movingResponsibilities !== undefined
        && jsx('div', {
        className: 'dsh-fleet-config-member-preview',
        style: {
          left: dragView.x - dragView.offsetX,
          top: dragView.y - dragView.offsetY,
          width: dragView.width,
          height: dragView.height,
        },
        children: jsxs('div', {
          className: dragSource?.kind === 'preset'
            ? 'dsh-fleet-config-preset'
            : 'dsh-fleet-config-member',
          style: {
            height: dragView.height,
            '--dsh-fleet-member-accent': movingColor,
          } as CSSProperties,
          children: [
            jsx('span', { className: 'dsh-fleet-config-member-name', children: movingName }),
            jsxs('span', {
              className: dragSource?.kind === 'preset'
                ? 'dsh-fleet-config-preset-details'
                : 'dsh-fleet-config-member-details',
              children: [
                jsx('span', { className: 'dsh-fleet-config-member-role', children: movingRole }),
                jsx('span', { className: 'dsh-fleet-config-member-responsibilities', children: movingResponsibilities }),
              ],
            }),
          ],
        }),
      }),
    ],
  })
}

interface QuickTeamDialogProps {
  readonly initial?: {
    readonly templateId: string
    readonly configuration: FleetConfigurationDraft
    readonly modified: boolean
  }
  readonly sessionId?: string
  onCancel: () => void
  onDetailed: (configuration: FleetConfigurationDraft, tab: ConfigurationTab, templateId: string) => void
  onUse: (configuration: FleetConfigurationDraft) => void | Promise<void>
}

function FleetQuickTeamDialog({ initial, sessionId, onCancel, onDetailed, onUse }: QuickTeamDialogProps): ReactElement {
  const titleId = useId()
  const cancelButton = useRef<HTMLButtonElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const chinese = isChineseLocale()
  const text = (zh: string, en: string): string => chinese ? zh : en
  const [templates, setTemplates] = useState<readonly QuickTeamTemplate[]>(() => {
    const available = quickTeamTemplates(chinese)
    if (initial === undefined) return available
    if (initial.modified) return available
    return available.map(template => template.id === initial.templateId
      ? { ...template, configuration: initial.configuration }
      : template)
  })
  const [selectedId, setSelectedId] = useState(() => initial?.templateId ?? templates[0]?.id ?? '')
  const [importActive, setImportActive] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<QuickTeamTemplate | null>(null)
  const [editingAssistant, setEditingAssistant] = useState<MemberDraft | null>(null)
  const [editingMember, setEditingMember] = useState<MemberDraft | null>(null)
  const initialModificationApplied = useRef(false)
  const selected = templates.find(template => template.id === selectedId) ?? templates[0]

  const updateSelectedConfiguration = (update: (draft: FleetConfigurationDraft) => FleetConfigurationDraft): void => {
    if (selected === undefined) return
    const configuration = update(selected.configuration)
    if (!configurationDraftChanged(configuration, selected.configuration)) return

    const storedId = selected.storedId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const preset: StoredTeamPreset = {
      id: storedId,
      name: selected.storedId === undefined
        ? text(`${selected.name}（副本）`, `${selected.name} copy`)
        : selected.name,
      savedAt: new Date().toISOString(),
      configuration: configurationPreset(configuration, readPresetLibrary(), chinese),
    }
    try {
      const stored = readStoredTeamPresets()
      const exists = stored.some(candidate => candidate.id === storedId)
      window.localStorage.setItem(LOCAL_TEAM_PRESETS_KEY, JSON.stringify(exists
        ? stored.map(candidate => candidate.id === storedId ? preset : candidate)
        : [...stored, preset]))
    } catch {
      setImportError(text(
        '无法保存修改后的模板：浏览器本地存储不可用。',
        'Could not save the modified template: browser local storage is unavailable.',
      ))
      return
    }

    const local = quickLocalTemplate(preset, configuration, chinese)
    setTemplates(current => selected.storedId === undefined
      ? [...current, local]
      : current.map(template => template.id === selected.id ? local : template))
    setSelectedId(local.id)
    setImportError(null)
  }

  useEffect(() => {
    cancelButton.current?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape'
        && pendingRemoval === null
        && editingAssistant === null
        && editingMember === null) onCancel()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [editingAssistant, editingMember, onCancel, pendingRemoval])

  useEffect(() => {
    if (initial?.modified !== true || initialModificationApplied.current) return
    initialModificationApplied.current = true
    updateSelectedConfiguration(() => initial.configuration)
  }, [])

  const importTemplate = async (file: File): Promise<void> => {
    try {
      const raw: unknown = JSON.parse(await file.text())
      const configuration = configurationFromPreset(raw)
      if (configuration.name.trim().length === 0) throw new Error('Team name is required')
      const stored: StoredTeamPreset = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: configuration.name.trim(),
        savedAt: new Date().toISOString(),
        configuration: raw,
      }
      window.localStorage.setItem(LOCAL_TEAM_PRESETS_KEY, JSON.stringify([stored, ...readStoredTeamPresets()]))
      const next = quickTeamTemplates(chinese)
      setTemplates(next)
      setSelectedId(`local:${stored.id}`)
      setEditingMember(null)
      setImportError(null)
    } catch {
      setImportError(text(
        '无法导入：文件不是有效的团队模板。',
        'Could not import: this is not a valid Team template.',
      ))
    }
  }

  const removeTemplate = (template: QuickTeamTemplate): void => {
    if (template.storedId === undefined) return
    try {
      const stored = readStoredTeamPresets().filter(preset => preset.id !== template.storedId)
      window.localStorage.setItem(LOCAL_TEAM_PRESETS_KEY, JSON.stringify(stored))
      const next = templates.filter(candidate => candidate.id !== template.id)
      setTemplates(next)
      if (selectedId === template.id) {
        setSelectedId(next[0]?.id ?? '')
        setEditingMember(null)
      }
      setImportError(null)
      setPendingRemoval(null)
    } catch {
      setImportError(text(
        '无法移除：浏览器本地存储不可用。',
        'Could not remove the template: browser local storage is unavailable.',
      ))
      setPendingRemoval(null)
    }
  }

  if (selected === undefined) throw new Error('Fleet quick templates are unavailable')
  const configuration = selected.configuration
  const usable = configuration.name.trim().length > 0
    && configuration.channelId.trim().length > 0
    && configuration.channelName.trim().length > 0
    && configuration.assistant.id.trim().length > 0
    && configuration.assistant.name.trim().length > 0
    && configuration.assistant.role.trim().length > 0
    && configuration.assistant.responsibilities.trim().length > 0
    && configuration.members.every(member =>
      member.id.trim().length > 0
      && member.name.trim().length > 0
      && member.role.trim().length > 0
      && member.responsibilities.trim().length > 0,
    )
  const density = {
    concise: text('简洁信息', 'Concise updates'),
    balanced: text('均衡信息', 'Balanced updates'),
    detailed: text('详细信息', 'Detailed updates'),
  }[configuration.updateDensity] ?? configuration.updateDensity
  const notification = {
    decisions: text('仅决策时通知', 'Notify for decisions'),
    milestones: text('里程碑时通知', 'Notify at milestones'),
    continuous: text('持续通知', 'Continuous notifications'),
  }[configuration.notificationPolicy] ?? configuration.notificationPolicy

  return jsxs('div', {
    className: 'dsh-fleet-config-overlay',
    role: 'presentation',
    children: [
      jsx('div', { className: 'dsh-fleet-config-mask', 'aria-hidden': 'true' }),
      jsxs('section', {
        className: 'dsh-fleet-quick-panel',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        children: [
          jsxs('header', {
            className: 'dsh-fleet-quick-header',
            children: [
              jsx('h2', {
                id: titleId,
                className: 'dsh-fleet-quick-title',
                children: text('选择团队模板', 'Choose a Team template'),
              }),
              jsx('p', {
                className: 'dsh-fleet-quick-intro',
                children: text(
                  '直接使用一个起点，或进入详细配置继续调整。',
                  'Use a starting point directly, or continue into detailed configuration.',
                ),
              }),
            ],
          }),
          jsxs('div', {
            className: 'dsh-fleet-quick-workspace',
            children: [
              jsxs('div', {
                className: 'dsh-fleet-quick-list',
                'data-import-active': importActive ? 'true' : 'false',
                onDragOver: (event: ReactDragEvent<HTMLDivElement>) => {
                  if (!Array.from(event.dataTransfer.types).includes('Files')) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                  setImportActive(true)
                },
                onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => {
                  const related = event.relatedTarget
                  if (!(related instanceof Node) || !event.currentTarget.contains(related)) setImportActive(false)
                },
                onDrop: (event: ReactDragEvent<HTMLDivElement>) => {
                  event.preventDefault()
                  setImportActive(false)
                  const file = event.dataTransfer.files[0]
                  if (file !== undefined) void importTemplate(file)
                },
                children: [
                  jsxs('div', {
                    className: 'dsh-fleet-quick-list-heading',
                    children: [
                      jsx('p', {
                        className: 'dsh-fleet-quick-list-label',
                        children: text('可用模板', 'Available templates'),
                      }),
                      jsx('input', {
                        ref: importInput,
                        type: 'file',
                        accept: '.json,application/json',
                        style: { display: 'none' },
                        onChange: (event: ChangeEvent<HTMLInputElement>) => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (file !== undefined) void importTemplate(file)
                        },
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'dsh-fleet-quick-import',
                        onClick: () => importInput.current?.click(),
                        children: text('导入团队或模板', 'Import Team or template'),
                      }),
                    ],
                  }),
                  jsx('div', {
                    role: 'listbox',
                    className: 'dsh-fleet-quick-options',
                    'aria-label': text('团队模板', 'Team templates'),
                    children: templates.map(template => jsxs('div', {
                      className: 'dsh-fleet-quick-option-row',
                      children: [
                        jsxs('button', {
                          type: 'button',
                          role: 'option',
                          className: 'dsh-fleet-quick-option',
                          'aria-selected': template.id === selected.id,
                          onClick: () => setSelectedId(template.id),
                          children: [
                            jsxs('span', {
                              className: 'dsh-fleet-quick-option-heading',
                              children: [
                                jsx('span', { className: 'dsh-fleet-quick-option-name', children: template.name }),
                                template.builtIn === true && jsx('span', {
                                  className: 'dsh-fleet-quick-option-origin',
                                  children: text('内置', 'Built-in'),
                                }),
                              ],
                            }),
                            jsx('span', { className: 'dsh-fleet-quick-option-summary', children: template.summary }),
                          ],
                        }),
                        template.storedId !== undefined && jsx('button', {
                          type: 'button',
                          className: 'dsh-fleet-quick-remove',
                          'aria-label': text(`移除模板 ${template.name}`, `Remove template ${template.name}`),
                          title: text('移除模板', 'Remove template'),
                          onClick: () => setPendingRemoval(template),
                          children: jsx(CancelMark, {}),
                        }),
                      ],
                    }, template.id)),
                  }),
                  jsx('p', {
                    className: 'dsh-fleet-quick-drop-hint',
                    children: importActive
                      ? text('松开以导入团队模板', 'Drop to import the Team template')
                      : text('也可以将模板文件拖到这里', 'You can also drop a template file here'),
                  }),
                  importError !== null && jsx('p', {
                    className: 'dsh-fleet-quick-error',
                    role: 'alert',
                    children: importError,
                  }),
                ],
              }),
              jsxs('article', {
                className: 'dsh-fleet-quick-detail',
                children: [
                  jsxs('div', {
                    className: 'dsh-fleet-quick-detail-heading',
                    children: [
                      jsx('h3', { className: 'dsh-fleet-quick-detail-title', children: selected.name }),
                      jsx('span', { className: 'dsh-fleet-quick-source', children: selected.source }),
                    ],
                  }),
                  jsx('button', {
                    type: 'button',
                    className: 'dsh-fleet-quick-description',
                    onClick: () => onDetailed(configuration, 'basics', selected.id),
                    children: configuration.positioning.trim() || selected.description,
                  }),
                  jsxs('section', {
                    className: 'dsh-fleet-quick-detail-section',
                    children: [
                      jsx('h4', {
                        className: 'dsh-fleet-quick-detail-label',
                        children: text('初始成员', 'Initial members'),
                      }),
                      jsx('div', {
                        className: 'dsh-fleet-quick-members',
                        children: [
                          jsxs('button', {
                            type: 'button',
                            className: 'dsh-fleet-quick-member',
                            'aria-label': text(
                              `配置团队助理 ${configuration.assistant.name}`,
                              `Configure Team assistant ${configuration.assistant.name}`,
                            ),
                            onClick: () => setEditingAssistant(configuration.assistant),
                            children: [
                              jsx('strong', { children: configuration.assistant.name }),
                              ` · ${configuration.assistant.role}`,
                            ],
                          }),
                          ...configuration.members.map(member => jsxs('button', {
                            type: 'button',
                            className: 'dsh-fleet-quick-member',
                            'aria-label': text(`配置成员 ${member.name}`, `Configure member ${member.name}`),
                            onClick: () => setEditingMember(member),
                            children: [jsx('strong', { children: member.name }), ` · ${member.role}`],
                          }, member.key)),
                          configuration.members.length === 0 && jsx('button', {
                          type: 'button',
                          className: 'dsh-fleet-quick-detail-action dsh-fleet-quick-empty',
                          onClick: () => onDetailed(configuration, 'members', selected.id),
                            children: text('暂无其他成员，可在启动后继续组建。', 'No other members yet. Continue assembling after startup.'),
                          }),
                        ],
                      }),
                    ],
                  }),
                  jsxs('section', {
                    className: 'dsh-fleet-quick-detail-section',
                    children: [
                      jsx('h4', {
                        className: 'dsh-fleet-quick-detail-label',
                        children: text('用户接入', 'User access'),
                      }),
                      jsxs('button', {
                        type: 'button',
                        className: 'dsh-fleet-quick-detail-action dsh-fleet-quick-preferences',
                        onClick: () => onDetailed(configuration, 'user', selected.id),
                        children: [jsx('span', { children: density }), jsx('span', { children: notification })],
                      }),
                    ],
                  }),
                  jsxs('section', {
                    className: 'dsh-fleet-quick-detail-section',
                    children: [
                      jsx('h4', {
                        className: 'dsh-fleet-quick-detail-label',
                        children: text('协作方式', 'Collaboration method'),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'dsh-fleet-quick-detail-action dsh-fleet-quick-collaboration',
                        onClick: () => onDetailed(configuration, 'basics', selected.id),
                        children: configuration.collaborationMethod.trim()
                          || text('启动后再与团队助理一起确定', 'Decide later with the Team assistant'),
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          jsxs('footer', {
            className: 'dsh-fleet-config-footer',
            children: [
              jsx('button', {
                ref: cancelButton,
                type: 'button',
                className: 'dsh-fleet-config-action dsh-fleet-config-cancel',
                onClick: onCancel,
                children: text('取消', 'Cancel'),
              }),
              jsx('button', {
                type: 'button',
                className: 'dsh-fleet-config-action dsh-fleet-quick-secondary',
                onClick: () => onDetailed(configuration, 'basics', selected.id),
                children: text('进入详细配置', 'Detailed configuration'),
              }),
              jsx('button', {
                type: 'button',
                className: 'dsh-fleet-config-action dsh-fleet-config-confirm',
                disabled: !usable || submitting,
                onClick: () => {
                  if (submitting) return
                  setSubmitting(true)
                  setImportError(null)
                  void Promise.resolve(onUse(configuration)).catch((error: unknown) => {
                    setImportError(error instanceof Error ? error.message : String(error))
                  }).finally(() => setSubmitting(false))
                },
                children: submitting
                  ? text('正在准备…', 'Preparing…')
                  : text('使用此模板', 'Use this template'),
              }),
            ],
          }),
        ],
      }),
      pendingRemoval !== null && jsx(FleetLibraryRemovalDialog, {
        title: text('移除团队模板', 'Remove Team template'),
        copy: text(
          `确定移除“${pendingRemoval.name}”吗？该模板会从本机删除。`,
          `Remove “${pendingRemoval.name}”? The template will be deleted from this device.`,
        ),
        onCancel: () => setPendingRemoval(null),
        onConfirm: () => removeTemplate(pendingRemoval),
      }),
      editingAssistant !== null && jsx(FleetMemberEditor, {
        initial: editingAssistant,
        existing: true,
        fixed: true,
        sessionId,
        onCancel: () => setEditingAssistant(null),
        onSave: (saved: MemberDraft) => {
          updateSelectedConfiguration(current => ({ ...current, assistant: saved }))
          setEditingAssistant(null)
        },
      }),
      editingMember !== null && jsx(FleetMemberEditor, {
        initial: editingMember,
        existing: true,
        sessionId,
        onCancel: () => setEditingMember(null),
        onSave: (saved: MemberDraft) => {
          updateSelectedConfiguration(current => ({
            ...current,
            members: current.members.map(member => member.key === saved.key ? saved : member),
          }))
          setEditingMember(null)
        },
        onRemove: () => {
          updateSelectedConfiguration(current => ({
            ...current,
            members: current.members.filter(member => member.key !== editingMember.key),
          }))
          setEditingMember(null)
        },
      }),
    ],
  })
}

function modeLabel(mode: FleetMode | null, chinese: boolean, teamName?: string): string {
  if (mode === 'interactive') {
    return chinese
      ? '组建团队：将会进入交互式引导程序'
      : 'Assemble team: interactive guide will start'
  }
  if (mode === 'configuration') {
    return chinese
      ? '组建团队：将会启动已配置的团队执行'
      : 'Assemble team: the configured Team will start'
  }
  if (mode === 'connection') {
    return chinese
      ? `连接团队：${teamName ?? '已有团队'}`
      : `Connect Team: ${teamName ?? 'existing Team'}`
  }
  return chinese ? '组建团队' : 'Assemble team'
}

function modeComposerPlaceholder(mode: Exclude<FleetMode, null>, chinese: boolean): string {
  if (mode === 'configuration') {
    return chinese ? '把想法发送给你的团队' : 'Send an idea to your Team'
  }
  if (mode === 'connection') {
    return chinese
      ? '向新接入的团队助理描述你的想法'
      : 'Describe your idea to the newly connected Team assistant'
  }
  return chinese ? '向团队助理描述你的想法' : 'Describe your idea to the Team assistant'
}

function teamStatusLabel(status: FleetPanelTeamSummary['status'], chinese: boolean): string {
  const labels: Record<FleetPanelTeamSummary['status'], readonly [string, string]> = {
    starting: ['正在启动', 'Starting'],
    idle: ['待命', 'Idle'],
    running: ['运行中', 'Running'],
    paused: ['已暂停', 'Paused'],
    finishing: ['正在收尾', 'Finishing'],
    closed: ['已关闭', 'Closed'],
    failed: ['启动失败', 'Failed'],
    disconnected: ['未连接', 'Disconnected'],
  }
  return labels[status][chinese ? 0 : 1]
}

export function FleetTeamButton({
  sessionId: propSessionId,
  workspaceSelected,
}: {
  readonly sessionId?: string
  /** Native new-Session workspace state, present only on the Hero surface. */
  readonly workspaceSelected?: boolean
} = {}): ReactElement {
  installStyles()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<FleetMode | null>(null)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const [connectedTeam, setConnectedTeam] = useState<FleetPanelTeamSummary | null>(null)
  const [configurationChooserOpen, setConfigurationChooserOpen] = useState(false)
  const [configurationOpen, setConfigurationOpen] = useState(false)
  const [configurationInitialTab, setConfigurationInitialTab] = useState<ConfigurationTab>('basics')
  const [quickDraft, setQuickDraft] = useState<{
    readonly templateId: string
    readonly configuration: FleetConfigurationDraft
    readonly modified: boolean
  } | null>(null)
  const [configurationDiscardOpen, setConfigurationDiscardOpen] = useState(false)
  const [configuration, setConfiguration] = useState<FleetConfigurationDraft>(emptyConfiguration)
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ left: 0, top: 0 })
  const [connectionPosition, setConnectionPosition] = useState<MenuPosition>({ left: 0, top: 0 })
  const [workspaceWarningPosition, setWorkspaceWarningPosition] = useState<MenuPosition | null>(null)
  const [assistantNotice, setAssistantNotice] = useState<FleetAssistantConnectionNotice | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const connectionAnchor = useRef<HTMLButtonElement>(null)
  const assistantNoticeAction = useRef<HTMLButtonElement>(null)
  const workspaceWarningTarget = useRef<HTMLButtonElement | null>(null)
  const workspaceWarningTimer = useRef<number | null>(null)
  const ownedNextSessionActivation = useRef<number | null>(null)
  const menuId = useId()
  const connectionMenuId = useId()
  const directory = useSyncExternalStore(
    subscribeFleetTeamDirectory,
    getFleetTeamDirectorySnapshot,
    getFleetTeamDirectorySnapshot,
  )
  const currentSessionId = useSyncExternalStore(
    subscribeCurrentFleetSession,
    getCurrentFleetSessionId,
    getCurrentFleetSessionId,
  )
  // A Hero without a materialized Session must not inherit the previously open Session.
  const sessionId = workspaceSelected === undefined ? propSessionId ?? currentSessionId : propSessionId
  const workspaceReady = workspaceSelected ?? sessionId !== undefined
  const activation = useSyncExternalStore(
    subscribeFleetActivation,
    () => getFleetActivationSnapshot(sessionId, workspaceSelected === true),
    () => getFleetActivationSnapshot(sessionId, workspaceSelected === true),
  )
  const chinese = isChineseLocale()
  const label = modeLabel(mode, chinese, connectedTeam?.teamName)
  const stageActivation = (request: Parameters<typeof stageFleetActivation>[1]): void => {
    const staged = stageFleetActivation(sessionId, request)
    ownedNextSessionActivation.current = sessionId === undefined ? staged.id : null
  }
  const clearActivation = (): void => {
    if (sessionId !== undefined) clearFleetActivation(sessionId)
    else if (ownedNextSessionActivation.current !== null) {
      clearFleetActivation(undefined, ownedNextSessionActivation.current)
    }
    ownedNextSessionActivation.current = null
  }
  const configuredActivation = async (draft: FleetConfigurationDraft): Promise<Record<string, unknown>> => {
    if (sessionId === undefined && draft.sharedResources.length > 0) {
      throw new Error(chinese
        ? '新会话建立后才能上传团队共享文件。请先发送第一条消息，或暂时移除共享文件。'
        : 'Team files can be uploaded after the new Session exists. Send its first message or remove the files for now.')
    }
    const uploaded = sessionId === undefined
      ? []
      : await Promise.all(draft.sharedResources.map(file => uploadFleetSetupFile(sessionId, file)))
    return configurationForHost(draft, readPresetLibrary(), chinese, uploaded)
  }

  useEffect(() => {
    const request = activation?.request
    if (request === undefined || request.mode === 'meta') {
      setMode(null)
      setConnectedTeam(null)
      return
    }
    setMode(request.mode)
    setConnectedTeam(request.mode === 'connection'
      ? directory.teams.find(team => team.teamId === request.teamId) ?? null
      : null)
  }, [activation, directory.teams, sessionId])

  useEffect(() => () => {
    if (workspaceWarningTimer.current !== null) window.clearTimeout(workspaceWarningTimer.current)
    workspaceWarningTarget.current?.removeAttribute('data-dsh-fleet-workspace-required')
    if (ownedNextSessionActivation.current !== null) {
      clearFleetActivation(undefined, ownedNextSessionActivation.current)
    }
  }, [])

  useEffect(() => {
    if (sessionId === undefined) return
    setAssistantNotice(null)
    setWorkspaceWarningPosition(null)
    workspaceWarningTarget.current?.removeAttribute('data-dsh-fleet-workspace-required')
    workspaceWarningTarget.current = null
    if (workspaceWarningTimer.current !== null) {
      window.clearTimeout(workspaceWarningTimer.current)
      workspaceWarningTimer.current = null
    }
  }, [sessionId])

  useEffect(() => {
    if (assistantNotice === null) return
    const frame = window.requestAnimationFrame(() => assistantNoticeAction.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [assistantNotice?.kind, assistantNotice?.team.teamId])

  useLayoutEffect(() => {
    if (mode === null) return

    const composer = root.current
      ?.closest('[data-composer-seat]')
      ?.querySelector<HTMLTextAreaElement>('textarea')
    if (composer === undefined || composer === null) return

    const previousPlaceholder = composer.placeholder
    const placeholder = modeComposerPlaceholder(mode, chinese)
    composer.placeholder = placeholder

    return () => {
      if (composer.placeholder === placeholder) composer.placeholder = previousPlaceholder
    }
  }, [mode, chinese])

  useEffect(() => {
    if (!open && assistantNotice === null) return

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setAssistantNotice(null)
        setConnectionOpen(false)
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (assistantNotice !== null) setAssistantNotice(null)
      else if (connectionOpen) setConnectionOpen(false)
      else setOpen(false)
    }
    const close = (): void => {
      setAssistantNotice(null)
      setConnectionOpen(false)
      setOpen(false)
    }
    const closeOnOuterScroll = (event: Event): void => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return
      close()
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', closeOnOuterScroll, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', closeOnOuterScroll, true)
    }
  }, [assistantNotice, connectionOpen, open])

  const toggleMenu = (): void => {
    if (!workspaceReady) {
      const workspaceButton = anchor.current
        ?.closest('[class*="_heroWorkspaceRow"]')
        ?.querySelector<HTMLButtonElement>('button')
      const warningAnchor = workspaceButton ?? anchor.current
      if (workspaceButton !== null && workspaceButton !== undefined) {
        workspaceWarningTarget.current?.removeAttribute('data-dsh-fleet-workspace-required')
        workspaceButton.removeAttribute('data-dsh-fleet-workspace-required')
        void workspaceButton.offsetWidth
        workspaceButton.setAttribute('data-dsh-fleet-workspace-required', 'true')
        workspaceWarningTarget.current = workspaceButton
      }
      if (warningAnchor !== null && warningAnchor !== undefined) {
        const rect = warningAnchor.getBoundingClientRect()
        setWorkspaceWarningPosition({
          left: Math.max(116, Math.min(rect.left + rect.width / 2, window.innerWidth - 116)),
          top: rect.bottom + 7,
        })
      }
      if (workspaceWarningTimer.current !== null) window.clearTimeout(workspaceWarningTimer.current)
      workspaceWarningTimer.current = window.setTimeout(() => {
        setWorkspaceWarningPosition(null)
        workspaceWarningTarget.current?.removeAttribute('data-dsh-fleet-workspace-required')
        workspaceWarningTarget.current = null
        workspaceWarningTimer.current = null
      }, 1800)
      return
    }
    if (!open) {
      const rect = anchor.current?.getBoundingClientRect()
      if (rect !== undefined) {
        const width = Math.min(304, window.innerWidth - 16)
        setMenuPosition({
          left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
          top: rect.bottom + 4,
        })
      }
    }
    if (open) setConnectionOpen(false)
    setOpen((current) => !current)
  }

  const toggleConnectionMenu = (): void => {
    if (!connectionOpen) {
      const rect = connectionAnchor.current?.getBoundingClientRect()
      if (rect !== undefined) {
        const width = Math.min(276, window.innerWidth - 16)
        const right = rect.right + 4
        const left = right + width <= window.innerWidth - 8
          ? right
          : Math.max(8, rect.left - width - 4)
        setConnectionPosition({
          left,
          top: Math.max(8, Math.min(rect.top, window.innerHeight - Math.min(320, window.innerHeight - 16) - 8)),
        })
      }
    }
    setConnectionOpen(current => !current)
  }

  const stageTeamConnection = (team: FleetPanelTeamSummary, assistantId?: string): void => {
    stageActivation({
      mode: 'connection',
      teamId: team.teamId,
      ...(assistantId === undefined ? {} : { assistantId }),
    })
    setConnectedTeam(team)
    setMode('connection')
    setAssistantNotice(null)
    setConnectionOpen(false)
    setOpen(false)
  }

  const chooseExistingTeam = (team: FleetPanelTeamSummary, target: HTMLButtonElement): void => {
    const route = fleetExistingAssistantRoute(team.assistantConnections ?? [])
    if (route.kind === 'create') {
      stageTeamConnection(team)
      return
    }
    setAssistantNotice({
      kind: route.kind,
      team,
      assistants: route.assistants,
      position: floatingMenuPosition(
        target.getBoundingClientRect(),
        320,
        Math.min(340, 150 + route.assistants.length * 38),
      ),
    })
    setConnectionOpen(false)
    setOpen(false)
  }

  const jumpToAssistant = (targetSessionId: string): void => {
    try {
      openFleetSession(targetSessionId)
      setAssistantNotice(null)
    } catch (error) {
      setAssistantNotice(current => current === null
        ? null
        : { ...current, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const trigger = mode !== null
    ? jsxs('div', {
        className: 'dsh-fleet-team-button dsh-fleet-team-active',
        'data-mode': mode,
        role: 'status',
        'aria-label': label,
        children: [
          jsx(FleetMark, {}),
          jsx('span', { className: 'dsh-fleet-team-label', children: label }),
          jsx('button', {
            type: 'button',
            className: 'dsh-fleet-team-cancel',
            'aria-label': mode === 'configuration'
              ? (chinese ? '取消已配置的团队' : 'Cancel configured Team')
              : mode === 'connection'
                ? (chinese ? '取消连接团队' : 'Cancel Team connection')
                : (chinese ? '取消交互模式' : 'Cancel interactive mode'),
            title: mode === 'configuration'
              ? (chinese ? '取消已配置的团队' : 'Cancel configured Team')
              : mode === 'connection'
                ? (chinese ? '取消连接团队' : 'Cancel Team connection')
                : (chinese ? '取消交互模式' : 'Cancel interactive mode'),
            onClick: () => {
              if (mode === 'configuration') setConfigurationDiscardOpen(true)
              else {
                clearActivation()
                setConnectedTeam(null)
                setMode(null)
              }
            },
            children: jsx(CancelMark, {}),
          }),
        ],
      })
    : jsxs('button', {
        ref: anchor,
        type: 'button',
        className: 'dsh-fleet-team-button',
        'data-mode': mode ?? undefined,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? menuId : undefined,
        title: label,
        onClick: toggleMenu,
        children: [
          jsx(FleetMark, {}),
          jsx('span', { className: 'dsh-fleet-team-label', children: label }),
          jsx(ChevronDown, {}),
        ],
      })

  return jsxs('div', {
    ref: root,
    className: 'dsh-fleet-team-root',
    children: [
      trigger,
      workspaceWarningPosition !== null && jsx('div', {
        className: 'dsh-fleet-workspace-warning',
        role: 'status',
        'aria-live': 'polite',
        style: workspaceWarningPosition,
        children: chinese ? '请先选择工作区' : 'Choose a workspace first',
      }),
      open && jsxs('div', {
        id: menuId,
        className: 'dsh-fleet-team-menu',
        role: 'menu',
        style: menuPosition,
        children: [
          jsxs('button', {
            type: 'button',
            className: 'dsh-fleet-team-menu-item',
            role: 'menuitem',
            onClick: () => {
              setOpen(false)
              setConnectionOpen(false)
              setConnectedTeam(null)
              setQuickDraft(null)
              setConfigurationChooserOpen(true)
            },
            children: [
              jsxs('span', {
                className: 'dsh-fleet-team-menu-copy',
                children: [
                  jsx('span', {
                    className: 'dsh-fleet-team-menu-name',
                    children: chinese ? '配置模式' : 'Configuration mode',
                  }),
                  jsx('span', {
                    className: 'dsh-fleet-team-menu-description',
                    children: chinese
                      ? '手动设置团队规模、角色与运行参数'
                      : 'Set team size, roles, and run parameters manually',
                  }),
                ],
              }),
              mode === 'configuration' && jsx(CheckMark, {}),
            ],
          }),
          jsxs('button', {
            type: 'button',
            className: 'dsh-fleet-team-menu-item',
            role: 'menuitem',
            onClick: () => {
              stageActivation({ mode: 'interactive' })
              setConnectedTeam(null)
              setMode('interactive')
              setConnectionOpen(false)
              setOpen(false)
            },
            children: [
              jsxs('span', {
                className: 'dsh-fleet-team-menu-copy',
                children: [
                  jsx('span', {
                    className: 'dsh-fleet-team-menu-name',
                    children: chinese ? '交互模式' : 'Interactive mode',
                  }),
                  jsx('span', {
                    className: 'dsh-fleet-team-menu-description',
                    children: chinese
                      ? '由引导 Agent 帮助明确长期分工并组建团队'
                      : 'Let a guide Agent shape the lasting Team structure',
                  }),
                ],
              }),
              mode === 'interactive' && jsx(CheckMark, {}),
            ],
          }),
          jsxs('button', {
            ref: connectionAnchor,
            type: 'button',
            className: 'dsh-fleet-team-menu-item',
            role: 'menuitem',
            'aria-haspopup': 'menu',
            'aria-expanded': connectionOpen,
            'aria-controls': connectionOpen ? connectionMenuId : undefined,
            onClick: toggleConnectionMenu,
            children: [
              jsxs('span', {
                className: 'dsh-fleet-team-menu-copy',
                children: [
                  jsx('span', {
                    className: 'dsh-fleet-team-menu-name',
                    children: chinese ? '连接已有团队' : 'Connect existing Team',
                  }),
                  jsx('span', {
                    className: 'dsh-fleet-team-menu-description',
                    children: chinese
                      ? '以团队助理身份继续现有工作'
                      : 'Continue existing work as the Team assistant',
                  }),
                ],
              }),
              jsx(ChevronRight, {}),
            ],
          }),
        ],
      }),
      open && connectionOpen && jsx('div', {
        id: connectionMenuId,
        className: 'dsh-fleet-team-submenu',
        role: 'menu',
        'aria-label': chinese ? '已有团队' : 'Existing Teams',
        style: connectionPosition,
        children: directory.teams.length === 0
          ? jsx('div', {
              className: 'dsh-fleet-team-submenu-empty',
              role: 'status',
              children: chinese ? '暂无可连接的团队' : 'No Teams are available',
            })
          : directory.teams.map(team => {
              const connectable = team.status === 'idle' || team.status === 'running'
              const status = teamStatusLabel(team.status, chinese)
              const detail = team.primaryWorkspace === undefined
                ? status
                : `${status} · ${team.primaryWorkspace}`
              return jsxs('button', {
                type: 'button',
                className: 'dsh-fleet-team-submenu-item',
                role: 'menuitem',
                disabled: !connectable,
                title: connectable
                  ? (chinese ? `连接 ${team.teamName}` : `Connect ${team.teamName}`)
                  : (chinese ? `${team.teamName} 当前不可连接` : `${team.teamName} is not connectable`),
                style: team.color === undefined
                  ? undefined
                  : { '--dsh-fleet-team-color': team.color } as CSSProperties,
                onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                  chooseExistingTeam(team, event.currentTarget)
                },
                children: [
                  jsx('span', { className: 'dsh-fleet-team-submenu-dot', 'aria-hidden': 'true' }),
                  jsxs('span', {
                    className: 'dsh-fleet-team-submenu-copy',
                    children: [
                      jsx('span', { className: 'dsh-fleet-team-submenu-name', children: team.teamName }),
                      jsx('span', { className: 'dsh-fleet-team-submenu-status', children: detail }),
                    ],
                  }),
                ],
              }, team.teamId)
            }),
      }),
      assistantNotice !== null && jsxs('div', {
        className: 'dsh-fleet-assistant-notice',
        role: 'dialog',
        'aria-modal': false,
        'aria-label': chinese
          ? `${assistantNotice.team.teamName} 已有团队助理`
          : `${assistantNotice.team.teamName} already has a Team assistant`,
        style: assistantNotice.position,
        children: [
          jsx('h3', {
            className: 'dsh-fleet-assistant-notice-title',
            children: chinese
              ? `“${assistantNotice.team.teamName}”已有团队助理`
              : `“${assistantNotice.team.teamName}” already has a Team assistant`,
          }),
          jsx('p', {
            className: 'dsh-fleet-assistant-notice-copy',
            children: assistantNotice.kind === 'open'
              ? (chinese
                  ? assistantNotice.assistants.length === 1
                    ? '该助理已有未归档的连接会话。请直接跳转，避免为同一个助理创建两个前台会话。'
                    : '该团队已有未归档的助理会话。请选择要打开的助理，不会重复创建前台会话。'
                  : assistantNotice.assistants.length === 1
                    ? 'This assistant already has an unarchived Session. Open it instead of creating a second foreground Session.'
                    : 'This Team has unarchived assistant Sessions. Choose an assistant to open without creating a duplicate Session.')
              : (chinese
                  ? assistantNotice.assistants.length === 1
                    ? '该团队保留了助理身份，但原连接会话已归档或不可用。是否在当前会话重新连接到这个助理？'
                    : '该团队保留了多个助理身份，但没有可用的连接会话。请选择要在当前会话重新连接的助理。'
                  : assistantNotice.assistants.length === 1
                    ? 'The Team still has this assistant identity, but its previous Session is archived or unavailable. Reconnect it in the current Session?'
                    : 'The Team retains several assistant identities but has no available Session. Choose one to reconnect in the current Session.'),
          }),
          assistantNotice.error !== undefined && jsx('p', {
            className: 'dsh-fleet-assistant-notice-error',
            role: 'alert',
            children: assistantNotice.error,
          }),
          jsxs('div', {
            className: 'dsh-fleet-assistant-notice-actions',
            children: [
              ...assistantNotice.assistants.map((assistant, index) => {
                const assistantName = assistant.assistantName?.trim() || assistant.assistantId
                return jsx('button', {
                  ref: index === 0 ? assistantNoticeAction : undefined,
                  type: 'button',
                  className: 'dsh-fleet-assistant-notice-action',
                  'data-primary': true,
                  onClick: () => {
                    if (assistantNotice.kind === 'open') jumpToAssistant(assistant.sessionId)
                    else stageTeamConnection(assistantNotice.team, assistant.assistantId)
                  },
                  children: assistantNotice.kind === 'open'
                    ? (chinese ? `跳转到 ${assistantName}` : `Open ${assistantName}`)
                    : (chinese ? `连接到 ${assistantName}` : `Reconnect ${assistantName}`),
                }, assistant.assistantId)
              }),
              jsx('button', {
                type: 'button',
                className: 'dsh-fleet-assistant-notice-action',
                onClick: () => setAssistantNotice(null),
                children: chinese ? '取消' : 'Cancel',
              }),
            ],
          }),
        ],
      }),
      configurationChooserOpen && jsx(FleetQuickTeamDialog, {
        sessionId,
        ...(quickDraft === null ? {} : { initial: quickDraft }),
        onCancel: () => {
          setConfigurationChooserOpen(false)
          setQuickDraft(null)
        },
        onDetailed: (draft: FleetConfigurationDraft, tab: ConfigurationTab, templateId: string) => {
          setConfiguration(draft)
          setConfigurationInitialTab(tab)
          setQuickDraft({ templateId, configuration: draft, modified: false })
          setConfigurationChooserOpen(false)
          setConfigurationOpen(true)
        },
        onUse: async (draft: FleetConfigurationDraft) => {
          const hostConfiguration = await configuredActivation(draft)
          setConfiguration(draft)
          stageActivation({ mode: 'configuration', configuration: hostConfiguration })
          setConnectedTeam(null)
          setMode('configuration')
          setConfigurationChooserOpen(false)
          setQuickDraft(null)
        },
      }),
      configurationOpen && jsx(FleetConfigurationDialog, {
        initial: configuration,
        initialTab: configurationInitialTab,
        sessionId,
        onBack: (draft: FleetConfigurationDraft, modified: boolean) => {
          setConfiguration(draft)
          setQuickDraft(current => current === null
            ? null
            : { ...current, configuration: draft, modified: current.modified || modified })
          setConfigurationOpen(false)
          setConfigurationChooserOpen(true)
        },
        onConfirm: async (draft: FleetConfigurationDraft) => {
          const hostConfiguration = await configuredActivation(draft)
          setConfiguration(draft)
          stageActivation({ mode: 'configuration', configuration: hostConfiguration })
          setConnectedTeam(null)
          setMode('configuration')
          setConfigurationOpen(false)
          setQuickDraft(null)
        },
      }),
      configurationDiscardOpen && jsx(FleetLibraryRemovalDialog, {
        title: chinese ? '取消组建团队？' : 'Cancel Team setup?',
        copy: chinese
          ? '当前团队配置将会丢失。'
          : 'The current Team configuration will be discarded.',
        cancelLabel: chinese ? '保留配置' : 'Keep configuration',
        confirmLabel: chinese ? '丢弃配置' : 'Discard configuration',
        onCancel: () => setConfigurationDiscardOpen(false),
        onConfirm: () => {
          setConfiguration(emptyConfiguration())
          clearActivation()
          setConnectedTeam(null)
          setMode(null)
          setConfigurationDiscardOpen(false)
        },
      }),
    ],
  })
}

type NativeComponentProps = Record<string, unknown>

interface NativeInputSnapshot {
  readonly draft: string
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  readonly imageIds?: readonly string[]
}

interface NativeInputActions {
  setDraft(text: string): void
  submit(): void
}

interface NativeComposerKeyboard {
  readonly snapshot: NativeInputSnapshot
  setDraft(text: string): void
  submit(mode?: unknown): void
  arbitrate?(key: 'up' | 'down' | 'enter' | 'escape', composing: boolean): unknown
  track?(draft: string, caret: number): void
  dismissPopup?(): void
  space?(): boolean
}

type NativeRenderSlot = (
  name: string,
  owner: Readonly<Record<string, unknown>>,
  options?: Readonly<Record<string, unknown>>,
) => ReactNode

type NativeUseInput = <Selection>(
  selector: (snapshot: NativeInputSnapshot | undefined) => Selection,
) => Selection

function submitWithFleetActivation(
  sessionId: string | undefined,
  draft: string,
  setDraft: (text: string) => void,
  submit: () => void,
): void {
  const encoded = consumeFleetActivation(sessionId, draft)
  if (encoded !== undefined) setDraft(encoded)
  submit()
}

function withSubmitOverride<T extends object>(target: T, submit: (...args: readonly unknown[]) => void): T {
  return new Proxy(target, {
    get(value, property) {
      if (property === 'submit') return submit
      const member: unknown = Reflect.get(value, property, value)
      return typeof member === 'function' ? member.bind(value) : member
    },
  })
}

function withComposerOverrides<T extends object>(target: T, overrides: Readonly<Record<string, unknown>>): T {
  return new Proxy(target, {
    get(value, property) {
      if (typeof property === 'string' && Object.hasOwn(overrides, property)) return overrides[property]
      const member: unknown = Reflect.get(value, property, value)
      return typeof member === 'function' ? member.bind(value) : member
    },
  })
}

/** Decorate the native composer without replacing its visuals or input-machine behavior. */
export function withFleetComposerActivation(
  InputBar: ComponentType<NativeComponentProps>,
): ComponentType<NativeComponentProps> {
  function FleetInputBar(props: NativeComponentProps): ReactElement {
    const useInput = props.useInput as NativeUseInput
    const input = useInput(snapshot => snapshot)
    const currentSessionId = useSyncExternalStore(
      subscribeCurrentFleetSession,
      getCurrentFleetSessionId,
      getCurrentFleetSessionId,
    )
    const sessionId = typeof props.sessionId === 'string' ? props.sessionId : currentSessionId
    if (sessionId !== undefined) captureFleetOfficialComposer(sessionId, InputBar, props)
    const fleetAssistant = useFleetMetaAssistantSession(sessionId)
    const assistantTeam = useSyncExternalStore(
      subscribeFleetTeamDirectory,
      () => getFleetTeamDirectorySnapshot().teams.find(team =>
        sessionId !== undefined && team.assistantSessionIds?.includes(sessionId) === true),
      () => undefined,
    )
    const assistantName = useSyncExternalStore(
      subscribeFleetTeamDirectory,
      () => getFleetAssistantDisplayName(sessionId),
      () => undefined,
    )
    const activation = useSyncExternalStore(
      subscribeFleetActivation,
      () => getFleetActivationSnapshot(sessionId),
      () => getFleetActivationSnapshot(sessionId),
    )
    const meta = activation?.request.mode === 'meta'
    const teamAssistant = fleetAssistant && assistantTeam !== undefined
    const teamArchived = teamAssistant && assistantTeam.status === 'closed'
    const inputActions = props.inputActions as NativeInputActions | undefined
    const keyboard = props.keyboard as NativeComposerKeyboard | undefined
    const [assistantError, setAssistantError] = useState<string>()
    const [assistantCommandOpen, setAssistantCommandOpen] = useState(false)
    const [assistantCommandQuery, setAssistantCommandQuery] = useState('')
    const [assistantCommandHighlight, setAssistantCommandHighlight] = useState(0)
    const assistantCommandMenu = useRef<HTMLDivElement>(null)
    const [, assistantModelState] = useFleetModelDirectory(teamAssistant && !teamArchived ? sessionId : undefined)
    const assistantModelSignature = assistantModelState.current === null
      ? undefined
      : JSON.stringify(assistantModelState.current)
    const previousAssistantModelSignature = useRef<string>()
    const previousAssistantModelSession = useRef<string>()
    const assistantModelSyncGeneration = useRef(0)

    useEffect(() => {
      if (!teamAssistant || teamArchived || sessionId === undefined || assistantModelSignature === undefined) {
        previousAssistantModelSignature.current = undefined
        previousAssistantModelSession.current = undefined
        return
      }
      if (previousAssistantModelSession.current !== sessionId
        || previousAssistantModelSignature.current === undefined) {
        previousAssistantModelSession.current = sessionId
        previousAssistantModelSignature.current = assistantModelSignature
        return
      }
      if (previousAssistantModelSignature.current === assistantModelSignature) return
      previousAssistantModelSignature.current = assistantModelSignature
      const current = assistantModelState.current
      if (current === null) return
      const generation = ++assistantModelSyncGeneration.current
      void configureFleetAssistantSessionModel(sessionId, {
        provider: current.provider,
        model: current.model,
        ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort }),
      }).catch((error: unknown) => {
        if (assistantModelSyncGeneration.current !== generation) return
        setAssistantError(error instanceof Error
          ? error.message
          : isChineseLocale() ? '团队助理模型配置同步失败' : 'Team assistant model configuration could not be synchronized')
      })
    }, [assistantModelSignature, assistantModelState.current, sessionId, teamArchived, teamAssistant])

    useEffect(() => {
      if (!assistantCommandOpen) return
      const close = (event: globalThis.PointerEvent): void => {
        if (!(event.target instanceof Node)) return
        const card = assistantCommandMenu.current?.closest('[data-composer-card="true"]')
        if (card?.contains(event.target) === true) return
        setAssistantCommandOpen(false)
      }
      document.addEventListener('pointerdown', close, true)
      return () => { document.removeEventListener('pointerdown', close, true) }
    }, [assistantCommandOpen])

    useEffect(() => {
      setAssistantCommandOpen(false)
      setAssistantCommandQuery('')
      setAssistantCommandHighlight(0)
    }, [sessionId])

    useEffect(() => {
      if (input?.phase !== 'plain' || inputActions === undefined) return
      if (sessionId === undefined) return
      const recovered = recoverFleetActivationDraft(sessionId, input.draft)
      if (recovered !== undefined) inputActions.setDraft(recovered)
    }, [input?.draft, input?.phase, inputActions, sessionId])

    const decoratedActions = inputActions === undefined
      ? undefined
      : withSubmitOverride(inputActions, () => submitWithFleetActivation(
          sessionId,
          input?.draft ?? '',
          text => inputActions.setDraft(text),
          () => inputActions.submit(),
        ))
    const decoratedKeyboard = keyboard === undefined
      ? undefined
      : withSubmitOverride(keyboard, (mode?: unknown) => submitWithFleetActivation(
          sessionId,
          keyboard.snapshot.draft,
          text => keyboard.setDraft(text),
          () => keyboard.submit(mode),
        ))

    if (teamAssistant && sessionId !== undefined) {
      const command = props.command as ((line: string) => Promise<boolean>) | undefined
      const renderSlot = props.renderSlot as NativeRenderSlot
      const commandEntries = fleetPrivateConversationCommands(assistantName ?? (isChineseLocale() ? '团队助理' : 'Team assistant'))
      const visibleCommandEntries = assistantCommandQuery === ''
        ? commandEntries
        : commandEntries.filter(entry => entry.name.toLocaleLowerCase()
            .startsWith(assistantCommandQuery.toLocaleLowerCase()))
      const runAssistantCommand = (name: typeof commandEntries[number]['name']): void => {
        if (teamArchived || inputActions === undefined) return
        const entry = commandEntries.find(candidate => candidate.name === name)
        if (entry === undefined) return
        if (entry.behavior === 'input') {
          inputActions.setDraft(`/${entry.name} `)
          setAssistantCommandOpen(false)
          return
        }
        if (command === undefined) {
          setAssistantError(isChineseLocale() ? 'DSH Session 命令服务不可用' : 'The DSH Session command service is unavailable')
          return
        }
        setAssistantCommandOpen(false)
        setAssistantError(undefined)
        void command(`/${entry.name}`).then(matched => {
          if (!matched) throw new Error(isChineseLocale()
            ? `命令 /${entry.name} 当前不可用`
            : `Command /${entry.name} is not currently available`)
        }).catch((error: unknown) => {
          setAssistantError(error instanceof Error
            ? error.message
            : isChineseLocale() ? 'Session 命令执行失败' : 'Session command failed')
        })
      }
      const submitAssistant = (): void => {
        if (inputActions === undefined) return
        if (teamArchived) {
          setAssistantError(isChineseLocale()
            ? '团队已归档，助理会话不能继续发送消息'
            : 'The Team is archived and this assistant Session can no longer send messages')
          return
        }
        const draft = input?.draft ?? ''
        if (draft.trim() === '' && (input?.imageIds?.length ?? 0) === 0) return
        if ((input?.imageIds?.length ?? 0) === 0 && (draft.trim() === '/goal' || draft.trim() === '/plan')) {
          inputActions.setDraft(`${draft.trim()} `)
          return
        }
        setAssistantError(undefined)
        if ((input?.imageIds?.length ?? 0) > 0
          || parseFleetConversationCommand(draft, 'direct') === undefined
          || command === undefined) {
          inputActions.submit()
          return
        }
        void command(draft.trim()).then(matched => {
          if (!matched) {
            inputActions.submit()
            return
          }
          inputActions.setDraft('')
        }).catch((error: unknown) => {
          setAssistantError(error instanceof Error
            ? error.message
            : isChineseLocale() ? 'Session 命令执行失败' : 'Session command failed')
        })
      }
      const assistantActions = inputActions === undefined
        ? undefined
        : withSubmitOverride(inputActions, submitAssistant)
      const assistantKeyboardBase = keyboard === undefined
        ? undefined
        : withSubmitOverride(keyboard, submitAssistant)
      const assistantKeyboard = assistantKeyboardBase === undefined
        ? undefined
        : withComposerOverrides(assistantKeyboardBase, {
            arbitrate: (key: 'up' | 'down' | 'enter' | 'escape', composing: boolean) => {
              if (!assistantCommandOpen) return assistantKeyboardBase.arbitrate?.(key, composing)
              if (key === 'escape') {
                setAssistantCommandOpen(false)
                return 'consumed'
              }
              if (key === 'up' || key === 'down') {
                if (visibleCommandEntries.length === 0) return 'consumed'
                setAssistantCommandHighlight(current =>
                  (current + (key === 'up' ? -1 : 1) + visibleCommandEntries.length) % visibleCommandEntries.length)
                return 'consumed'
              }
              const entry = visibleCommandEntries[assistantCommandHighlight]
              if (entry !== undefined) runAssistantCommand(entry.name)
              return 'pick-highlighted'
            },
            track: (draft: string, caret: number) => {
              const commandQuery = activeFleetCommandQuery(draft, caret)
              if (commandQuery !== undefined) {
                assistantKeyboardBase.dismissPopup?.()
                setAssistantCommandQuery(commandQuery.query)
                setAssistantCommandHighlight(0)
                setAssistantCommandOpen(true)
                return
              }
              setAssistantCommandQuery('')
              setAssistantCommandOpen(false)
              assistantKeyboardBase.track?.(draft, caret)
            },
            space: () => {
              if (!assistantCommandOpen) return assistantKeyboardBase.space?.() ?? false
              const entry = visibleCommandEntries[assistantCommandHighlight]
              if (entry !== undefined) runAssistantCommand(entry.name)
              return true
            },
          })
      const nativeUseMenuLauncher = props.useMenuLauncher as (<Selection>(
        selector: (snapshot: string | null) => Selection,
      ) => Selection) | undefined
      const assistantUseMenuLauncher = <Selection,>(selector: (snapshot: string | null) => Selection): Selection => {
        if (nativeUseMenuLauncher === undefined) return selector(assistantCommandOpen ? 'command' : null)
        return nativeUseMenuLauncher(current => selector(assistantCommandOpen ? 'command' : current))
      }
      const assistantCommandOverlay = assistantCommandOpen && jsx('div', {
        ref: assistantCommandMenu,
        className: 'dsh-fleet-conversation-command-menu',
        role: 'listbox',
        'aria-label': isChineseLocale() ? '助理会话命令' : 'Assistant conversation commands',
        'aria-activedescendant': `dsh-fleet-assistant-command-${visibleCommandEntries[assistantCommandHighlight]?.name ?? 'none'}`,
        children: [
          jsx('div', {
            className: 'dsh-fleet-conversation-command-menu-title',
            role: 'presentation',
            children: isChineseLocale() ? '命令' : 'Commands',
          }),
          ...visibleCommandEntries.map((entry, index) => jsxs('button', {
            id: `dsh-fleet-assistant-command-${entry.name}`,
            type: 'button',
            role: 'option',
            'aria-selected': assistantCommandHighlight === index,
            className: 'dsh-fleet-conversation-command-menu-item',
            onMouseEnter: () => { setAssistantCommandHighlight(index) },
            onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => {
              event.preventDefault()
              runAssistantCommand(entry.name)
            },
            children: [
              jsx('span', { className: 'dsh-fleet-conversation-command-menu-name', children: entry.name }),
              jsx('span', { className: 'dsh-fleet-conversation-command-menu-description', children: entry.description }),
            ],
          }, entry.name)),
          visibleCommandEntries.length === 0 && jsx('div', {
            className: 'dsh-fleet-conversation-command-menu-title',
            role: 'status',
            children: isChineseLocale() ? '没有匹配的命令' : 'No matching commands',
          }),
        ],
      })
      return jsx(InputBar, {
        ...props,
        disabled: teamArchived,
        blocked: undefined,
        workspacePickerOpen: false,
        onRequestWorkspace: undefined,
        placeholder: isChineseLocale()
          ? teamArchived ? '团队已归档，无法继续发送消息' : `发送消息给 ${assistantName ?? '团队助理'}`
          : teamArchived ? 'Team archived — messaging unavailable' : `Send a message to ${assistantName ?? 'Team assistant'}`,
        useMenuLauncher: assistantUseMenuLauncher,
        inputActions: assistantActions,
        keyboard: assistantKeyboard,
        command: undefined,
        toggleCommandMenu: () => {
          assistantKeyboardBase?.dismissPopup?.()
          setAssistantCommandQuery('')
          setAssistantCommandHighlight(0)
          setAssistantCommandOpen(current => !current)
        },
        overlay: jsxs(Fragment, {
          children: [
            props.overlay as ReactNode,
            assistantCommandOverlay,
          ],
        }),
        renderSlot: (name: string, owner: Readonly<Record<string, unknown>>, options?: Readonly<Record<string, unknown>>) =>
          name === 'conversation.input.model' ? null : renderSlot(name, owner, options),
        usageMeter: jsx(FleetBudgetMeter, { teamId: assistantTeam.teamId }),
        footer: !teamArchived && assistantError === undefined ? undefined : jsx('span', {
          className: 'dsh-fleet-assistant-composer-status',
          'data-error': assistantError === undefined ? undefined : 'true',
          role: assistantError === undefined ? 'status' : 'alert',
          'aria-live': 'polite',
          children: teamArchived
            ? isChineseLocale() ? '团队已归档，此助理会话为只读。' : 'The Team is archived. This assistant Session is read-only.'
            : assistantError,
        }),
      })
    }

    const inputBar = jsx(InputBar, {
      ...props,
      ...(meta ? {
        disabled: false,
        workspacePickerOpen: false,
        onRequestWorkspace: undefined,
        placeholder: isChineseLocale()
          ? '询问 Agent Fleet 关于团队插件的问题'
          : 'Ask Agent Fleet about the Team plugin',
      } : {}),
      inputActions: decoratedActions,
      keyboard: decoratedKeyboard,
    })

    return jsxs(Fragment, {
      children: [
        meta && jsx('span', {
          className: 'dsh-fleet-meta-composer-marker',
          'aria-hidden': 'true',
        }),
        inputBar,
      ],
    })
  }

  FleetInputBar.displayName = `withFleetComposerActivation(${InputBar.displayName ?? InputBar.name ?? 'InputBar'})`
  return FleetInputBar
}

export function withFleetTeamButton(
  AgentPresetSeat: ComponentType<NativeComponentProps>,
): ComponentType<NativeComponentProps> {
  function FleetAgentPresetSeat(props: NativeComponentProps): ReactElement {
    return jsxs(Fragment, {
      children: [
        jsx(AgentPresetSeat, { ...props }),
        jsx(FleetTeamButton, {
          ...(typeof props.sessionId === 'string' ? { sessionId: props.sessionId } : {}),
          ...(typeof props.workspaceSelected === 'boolean'
            ? { workspaceSelected: props.workspaceSelected }
            : {}),
        }),
      ],
    })
  }

  FleetAgentPresetSeat.displayName = `withFleetTeamButton(${AgentPresetSeat.displayName ?? AgentPresetSeat.name ?? 'AgentPresetSeat'})`
  return FleetAgentPresetSeat
}

export const name = 'dsh-agent-fleet'

export {
  FleetMetaAssistantHeaderButton,
  FleetMetaAssistantPinnedRow,
  withFleetGlobalConversationHeader,
  withFleetGlobalConversationView,
  withFleetMetaConversationRoot,
  withFleetMetaWorkspaceBrowser,
} from './meta-assistant.js'

export {
  apply,
  FLEET_PANEL_SOURCE_SERVICE,
  FLEET_PANEL_SLOTS,
  FleetPanelToolButton,
  FleetPanelTeamSwitcher,
  ListRow as FleetPanelListRow,
  SectionTitle as FleetPanelSectionTitle,
  FleetNativeChatRuntimePrimer,
  FleetTeamPanel,
  inject,
  withFleetNativeChatView,
} from './team-panel.js'
export type {
  FleetPanelActivity,
  FleetPanelConversation,
  FleetPanelConversationPage,
  FleetPanelHomeOwner,
  FleetPanelMember,
  FleetPanelMessage,
  FleetPanelMessageThread,
  FleetPanelMessageBlockOwner,
  FleetPanelMessageOwner,
  FleetPanelMemberTrace,
  FleetPanelMemberTraceEvent,
  FleetPanelMemberTraceRequest,
  FleetPanelPaneOwner,
  FleetPanelRenderSlot,
  FleetPanelResource,
  FleetPanelResourcePreviewOwner,
  FleetPanelSendInput,
  FleetPanelSidebarSectionOwner,
  FleetPanelSnapshot,
  FleetPanelSource,
  FleetPanelTeamDirectory,
  FleetPanelTeamGroup,
  FleetPanelTeamSnapshot,
  FleetPanelTeamSummary,
  FleetPanelToolId,
  FleetPanelToolOwner,
  FleetPanelToolButtonProps,
  FleetPanelTeamOption,
  FleetPanelTeamSwitcherProps,
  FleetPanelListRowProps,
  FleetPanelUi,
} from './team-panel.js'

export {
  FleetMemberPopover,
  FleetMemberPopoverCard,
  FleetMemberStatusUpdatedAt,
} from './member-popover.js'
export type {
  FleetMemberPopoverCardProps,
  FleetMemberPopoverMember,
  FleetMemberPopoverProps,
  FleetMemberPopoverTriggerProps,
} from './member-popover.js'
export { useFleetAnchoredPopover } from './anchored-popover.js'
export type { FleetAnchoredPopoverController, FleetPopoverPlacement } from './anchored-popover.js'

export {
  FleetChatAvatar,
  FleetChatComment,
  FleetChatDivider,
  FleetInfoHint,
  FleetChatMessage,
  FleetChatNotice,
  FleetChatReadReceipt,
  FleetPresenceLabel,
  FleetConversationHeader,
  fleetMemberPresence,
  fleetMemberPresenceLabel,
  fleetPresenceLabel,
} from './runtime-chat.js'
export {
  FLEET_MESSAGE_CONFIGURATION_MODULE,
  FLEET_RESOURCES_CONFIGURATION_MODULE,
  FLEET_UI_CONFIGURATION_MODULE,
  FleetConfigurationModuleRegistry,
  fleetConfigurationModules,
} from './configuration-modules.js'
export { fleetText, isChineseLocale, resolveChineseLocale } from './locale.js'
export type {
  FleetConfigurationModuleContribution,
  FleetConfigurationModuleEditorProps,
  FleetConfigurationTemplateContribution,
} from './configuration-modules.js'
export type {
  FleetChatAvatarProps,
  FleetChatCommentProps,
  FleetChatContentBlock,
  FleetChatDividerProps,
  FleetChatExtensionBlock,
  FleetChatImageBlock,
  FleetChatMember,
  FleetChatMentionBlock,
  FleetChatMessageProps,
  FleetChatNoticeProps,
  FleetChatResourceBlock,
  FleetChatReadReceiptData,
  FleetChatReceiptSource,
  FleetConversationHeaderProps,
  FleetConversationKind,
  FleetMessageDeliveryState,
  FleetPresence,
  FleetRuntimeMember,
} from './runtime-chat.js'
