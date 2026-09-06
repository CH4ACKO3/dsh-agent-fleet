import type { FleetRuntimeMember } from './runtime-chat.js'
import { fleetText } from './locale.js'

// ---------------------------------------------------------------------------
// Style installation
// ---------------------------------------------------------------------------

const PANEL_STYLE_ID = 'dsh-agent-fleet-team-panel'

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
.dsh-fleet-panel-connection-dot {
    animation: none !important;
  }

  .dsh-fleet-panel-tool,
  .dsh-fleet-panel-list-row {
    scroll-behavior: auto;
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

.dsh-fleet-budget-meter-value[data-state="warning"] {
stroke: #d4a72c;
}

.dsh-fleet-budget-meter-value[data-state="danger"],
.dsh-fleet-budget-meter-value[data-state="exhausted"] {
stroke: #d35454;
}

.dsh-fleet-budget-meter-value[data-state="unlimited"] {
stroke: var(--dsw-alias-label-tertiary);
}

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

.dsh-fleet-budget-popover::backdrop {
background: transparent;
}

.dsh-fleet-budget-popover-switch {
box-sizing: border-box;
  width: 100%;
  min-width: 0;
  margin-bottom: 12px;
  padding: 2px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover);
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
}

.dsh-fleet-budget-popover-switch button {
box-sizing: border-box;
  min-width: 0;
  min-height: 28px;
  padding-inline: 10px;
  border: 0;
  border-radius: 6px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-fleet-budget-popover-switch button:hover {
color: var(--dsw-alias-label-primary);
}

.dsh-fleet-budget-popover-switch button[data-active="true"] {
color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-menu);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);
}

.dsh-fleet-budget-popover-switch button:focus-visible {
outline: 2px solid var(--dsw-alias-border-focus, #6d8cff);
  outline-offset: -1px;
}

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

.dsh-fleet-budget-popover-progress[data-context="true"] span[data-kind="system"] {
--budget-member-color: var(--dsw-static-neutral-bluish-400);
}

.dsh-fleet-budget-popover-progress[data-context="true"] span[data-kind="tools"] {
--budget-member-color: #a78bfa;
}

.dsh-fleet-budget-popover-progress[data-context="true"] span[data-kind="messages"] {
--budget-member-color: var(--dsw-static-blue-450);
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

.dsh-fleet-budget-popover-member-dot[data-kind="system"] {
--budget-member-color: var(--dsw-static-neutral-bluish-400);
}

.dsh-fleet-budget-popover-member-dot[data-kind="tools"] {
--budget-member-color: #a78bfa;
}

.dsh-fleet-budget-popover-member-dot[data-kind="messages"] {
--budget-member-color: var(--dsw-static-blue-450);
}

.dsh-fleet-budget-popover-empty {
margin: 2px 0 0;
  padding: 10px 2px 2px;
  border-top: 1px solid var(--dsw-alias-border-l3);
  color: var(--dsw-alias-label-tertiary);
  overflow-wrap: anywhere;
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

.dsh-fleet-budget-popover-manage:hover {
background: var(--dsw-alias-interactive-bg-hover);
}

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
.dsh-fleet-panel-activity-scroll {
    padding: 18px 100px 18px 14px;
  }

  .dsh-fleet-panel-activity-timeline {
    width: 72px;
    left: calc(100% - 80px);
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

.dsh-fleet-panel-team-row-status[data-status="paused"] {
background: #d4a017;
}

.dsh-fleet-panel-team-row-status[data-status="closed"] {
background: #888;
}

.dsh-fleet-panel-team-row-status[data-status="failed"] {
background: #c0392b;
}

.dsh-fleet-panel-team-row-status[data-status="disconnected"] {
width: 6px;
  height: 6px;
  background: transparent;
  border: 1.5px dashed #999;
}

.dsh-fleet-panel-team-row-status[data-status="starting"] {
background: #5dade2;
}

.dsh-fleet-panel-team-row-status[data-status="finishing"] {
background: #8e44ad;
}

.dsh-fleet-panel-team-row-status[data-status="dormant"] {
background: #7f8c8d;
}

.dsh-fleet-panel-team-row-status[data-status="candidate"] {
background: #5b9bd5;
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
  width: 100%;
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

.dsh-fleet-panel-agent-message-row[data-self="true"] .dsh-fleet-chat-comments {
box-sizing: border-box;
  width: 100%;
  align-self: stretch;
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
grid-template-areas: "diff timeline";
}

.dsh-fleet-panel-resource-diff {
min-width: 0;
  grid-area: diff;
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 12px;
  overflow: auto;
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

.dsh-fleet-panel-resource-code {
box-sizing: border-box;
  min-width: 0;
  width: 100%;
  min-height: 100%;
  overflow: auto;
}

.dsh-fleet-panel-resource-code > .dsh-code-render {
box-sizing: border-box;
  width: 100%;
  min-width: max-content;
  min-height: 100%;
  margin: 0;
  border-radius: 10px;
  font-family: var(--dsw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 13px;
  line-height: 1.6;
  tab-size: 2;
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

.dsh-fleet-panel-settings-action-row {
display: flex;
}

.dsh-fleet-panel-agent-switch[aria-expanded="true"]
.dsh-fleet-panel-agent-switch-chevron {
transform: rotate(180deg);
}

.dsh-fleet-panel-agent-view-meta small {
color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-panel-agent-readonly:hover {
background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
}

.dsh-fleet-panel-member-model-trigger[aria-expanded="true"] {
border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.dsh-fleet-panel-member-model-trigger-effort {
color: var(--dsw-alias-label-secondary);
  flex: none;
  font-size: 11px;
  line-height: 18px;
}

.dsh-fleet-panel-member-model-trigger[aria-expanded="true"]
.dsh-fleet-panel-member-model-chevron {
transform: rotate(180deg);
}

.dsh-fleet-panel-member-model-option:hover {
background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-member-model-option[aria-checked="true"] {
background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
}

.dsh-fleet-panel-member-model-group {
padding: 4px 0 0;
}

.dsh-fleet-panel-member-model-empty {
color: var(--dsw-alias-label-secondary);
  padding: 8px;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

.dsh-fleet-panel-member-model-error {
color: var(--dsw-alias-state-error-primary);
  padding: 8px;
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-panel-member-model-retry:hover {
background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-member-model-status {
color: var(--dsw-alias-label-secondary);
  padding: 8px;
  font-size: 12px;
  line-height: 18px;
}

details[open] .dsh-fleet-panel-directory-chevron {
transform: rotate(90deg);
}

.dsh-fleet-panel-directory-group[data-empty="true"]
.dsh-fleet-panel-directory-chevron {
visibility: hidden;
}

.dsh-fleet-panel-team-row:hover {
background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-team-row[data-status="running"]
.dsh-fleet-panel-team-row-status {
background: var(--dsw-alias-state-success-primary);
}

.dsh-fleet-panel-team-row[data-status="idle"]
.dsh-fleet-panel-team-row-status {
background: var(--dsw-alias-state-warning-primary);
}

.dsh-fleet-panel-search:focus {
background: var(--dsw-alias-bg-layer-1);
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-section-action:hover {
background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent);
}

.dsh-fleet-panel-activity-row:hover {
background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-activity-row:focus-visible {
outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}

.dsh-fleet-panel-activity-group[data-open="true"]
.dsh-fleet-panel-activity-group-chevron {
transform: rotate(90deg);
}

.dsh-fleet-panel-activity-dot[data-kind="create"],
.dsh-fleet-panel-activity-dot[data-kind="promote"] {
background: var(--dsw-alias-state-success-primary);
}

.dsh-fleet-panel-activity-dot[data-kind="update"],
.dsh-fleet-panel-activity-dot[data-kind="complete"] {
background: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-activity-dot[data-kind="block"] {
background: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-panel-activity-dot[data-kind="comment"] {
background: var(--dsw-alias-state-warning-primary);
}

.dsh-fleet-panel-activity-copy > * {
font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-fleet-panel-activity-copy small {
color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
}

.dsh-fleet-panel-presence[data-status="active"] {
background: var(--dsw-alias-state-success-primary);
}

.dsh-fleet-panel-presence[data-status="busy"] {
background: var(--dsw-alias-state-warning-primary);
}

.dsh-fleet-panel-presence[data-status="waiting"] {
background: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-presence[data-status="error"] {
background: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-panel-detail {
min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  display: flex;
  overflow: hidden;
}

.dsh-fleet-panel-chat {
min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  display: flex;
  overflow: hidden;
  position: relative;
}

.dsh-fleet-panel-chat-width-handle:hover,
.dsh-fleet-panel-chat-width-handle[data-resizing="true"] {
background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
}

.dsh-fleet-panel-resize-handle:hover,
.dsh-fleet-panel-resize-handle[data-resizing="true"] {
background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
}

.dsh-fleet-panel-fact > dd {
min-width: 0;
  color: var(--dsw-alias-label-primary);
  margin: 0;
  overflow-wrap: anywhere;
}

.dsh-fleet-panel-trace-event::before {
width: 6px;
  height: 6px;
  background: var(--dsw-alias-label-quaternary);
  border-radius: 50%;
  position: absolute;
  left: 4px;
  top: 11px;
  content: '';
}

.dsh-fleet-panel-trace-event[data-state="running"]::before {
background: var(--dsw-alias-state-warning-primary);
}

.dsh-fleet-panel-trace-event[data-state="completed"]::before {
background: var(--dsw-alias-state-success-primary);
}

.dsh-fleet-panel-trace-event[data-state="failed"]::before {
background: var(--dsw-alias-state-error-primary);
}

.dsh-fleet-conversation-command-menu-item:hover,
.dsh-fleet-conversation-command-menu-item[data-active="true"] {
background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-native-context-locate:hover {
color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-fleet-panel-member-list-anchor {
min-width: 0;
  position: relative;
}

.dsh-diff-file {
border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  overflow: hidden;
}

.dsh-diff-render {
box-sizing: border-box;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 20px;
  overflow-x: auto;
}

.dsh-fleet-panel-member-permissions-value-group + .dsh-fleet-panel-member-permissions-value-group {
border-top: 1px solid var(--dsw-alias-border-l3);
}

.dsh-fleet-panel-member-permissions-value-list li {
color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-panel-member-permissions-op:hover {
background: var(--dsw-alias-interactive-bg-active);
}

.dsh-fleet-panel-member-permissions-draft:hover {
background: color-mix(in srgb, var(--dsw-alias-state-warning-primary) 22%, transparent);
}

.dsh-fleet-panel-member-permissions-error {
color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}

.dsh-fleet-panel-member-permission-value[data-checked="true"] {
color: var(--dsw-alias-label-on-color);
  background: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-member-permission-value[data-checked="true"]:hover {
opacity: .88;
}

.dsh-fleet-panel-member-access-level select {
box-sizing: border-box;
  min-height: 36px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 9px;
  font: var(--dsw-font-s-14);
}

.dsh-fleet-panel-member-access-mode:hover {
border-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-member-access-mode[data-checked="true"] {
border-color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, transparent);
}

.dsh-fleet-panel-member-access-field input {
box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 10px;
  font: var(--dsw-font-s-14);
}

.dsh-fleet-panel-member-access-label > span {
min-width: 0;
  flex: 1;
}

.dsh-fleet-panel-member-access-input {
box-sizing: border-box;
  width: auto;
  margin: 0;
  accent-color: var(--dsw-alias-state-business-primary);
}

.dsh-fleet-panel-member-access-select {
box-sizing: border-box;
  min-height: 36px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 9px;
  font: var(--dsw-font-s-14);
}

.dsh-fleet-panel-auth-simple {
gap: 8px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  display: grid;
}

.dsh-fleet-panel-auth-detailed {
gap: 10px;
  display: grid;
}

.dsh-fleet-panel-auth-mode legend {
color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}

.dsh-fleet-panel-member-request-head {
color: var(--dsw-alias-label-primary);
  margin: 0;
  font: var(--dsw-font-s-strong-14);
}

.dsh-fleet-panel-member-request-field input,
.dsh-fleet-panel-member-request-field textarea,
.dsh-fleet-panel-member-request-field select {
box-sizing: border-box;
  width: 100%;
  min-height: 36px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 10px;
  font: var(--dsw-font-s-14);
}

.dsh-fleet-panel-member-request-field textarea {
min-height: 72px;
  resize: vertical;
}

.dsh-fleet-panel-resource-compare-resize-track:hover,
.dsh-fleet-panel-resource-compare-resize-track[data-resizing="true"] {
background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
}

.dsh-fleet-panel-resource-file-remove:hover {
color: var(--dsw-alias-state-error-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent);
}

.dsh-fleet-panel-resource-revision:hover {
background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-resource-revision-detail {
color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 16px;
}

.dsh-fleet-panel-resource-view-switch button {
min-height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 2px 8px;
  font: var(--dsw-font-xs-13);
}

.dsh-fleet-panel-resource-view-switch button[data-checked="true"] {
color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-resource-view-switch button:hover {
color: var(--dsw-alias-label-primary);
}

.dsh-fleet-panel-resource-view-switch button:focus-visible {
outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-resource-view-unavailable-trigger {
appearance: none;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 5px;
  padding: 2px 5px;
  font: inherit;
  font-size: 12px;
}

.dsh-fleet-panel-resource-view-unavailable-trigger:hover {
background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 9%, transparent);
}

/* Additional missing selectors (compound selectors missed by first pass) */

.dsh-fleet-official-composer {
--dsh-composer-side-clearance: 0px;
  --dsh-composer-card-max-width: 780px;
  padding-bottom: 12px;
}

.dsh-fleet-panel-auth-levels label {
min-height: 28px;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  display: flex;
}

.dsh-fleet-panel-auth-access select:focus-visible {
outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-auth-access strong {
color: var(--dsw-alias-label-primary);
}

.dsh-fleet-panel-auth-access small {
color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
}
`

export function installPanelStyles(): void {
  if (typeof document === 'undefined') return
  let style = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${PANEL_STYLE_ID}"]`)
  if (style === null) {
    style = document.createElement('style')
    style.dataset.pluginCss = PANEL_STYLE_ID
    document.head.append(style)
  }
  style.textContent = panelStyles
}

// ---------------------------------------------------------------------------
// Locale helper
// ---------------------------------------------------------------------------

export function panelText(zh: string, en: string): string {
  return fleetText(zh, en)
}

// ---------------------------------------------------------------------------
// Member presence helper
// ---------------------------------------------------------------------------

export function fleetPanelMemberIsOnline(member: FleetRuntimeMember): boolean {
  return member.presence === 'active' || member.presence === 'busy'
    || member.presence === 'waiting' || member.presence === 'error'
}

// ---------------------------------------------------------------------------
// Team settings request
// ---------------------------------------------------------------------------

export type TeamSettingsTab = 'general' | 'model' | 'budget' | 'access' | 'collaboration' | 'data' | 'danger'

interface FleetTeamSettingsRequest {
  readonly id: number
  readonly teamId: string
  readonly tab: TeamSettingsTab
}

export let fleetTeamSettingsRequest: FleetTeamSettingsRequest | undefined
export function getFleetTeamSettingsRequest(): FleetTeamSettingsRequest | undefined {
  return fleetTeamSettingsRequest
}

export function setFleetTeamSettingsRequest(value: FleetTeamSettingsRequest): void {
  fleetTeamSettingsRequest = value
}

export function incrementFleetTeamSettingsSequence(): number {
  return ++fleetTeamSettingsRequestSequence
}

let fleetTeamSettingsRequestSequence = 0
const fleetTeamSettingsRequestListeners = new Set<() => void>()

export function subscribeFleetTeamSettingsRequest(listener: () => void): () => void {
  fleetTeamSettingsRequestListeners.add(listener)
  return () => { fleetTeamSettingsRequestListeners.delete(listener) }
}

export function publishFleetTeamSettingsRequest(): void {
  for (const listener of fleetTeamSettingsRequestListeners) listener()
}

export function completeFleetTeamSettingsRequest(id: number): void {
  if (fleetTeamSettingsRequest?.id !== id) return
  fleetTeamSettingsRequest = undefined
  publishFleetTeamSettingsRequest()
}
