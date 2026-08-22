import type { ComponentType, ReactElement } from 'react'
import { useEffect, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import { clearFleetActivation, stageFleetActivation } from './activation.js'
import { isChineseLocale } from './locale.js'

const STYLE_ID = 'dsh-agent-fleet-meta-assistant'
const SESSION_KEY = 'dsh-agent-fleet:meta-session:v1'
const COLLAPSED_KEY = 'dsh-agent-fleet:meta-collapsed:v1'

const styles = `
.dsh-fleet-meta-pinned {
  box-sizing: border-box;
  height: 34px;
  margin: 0 0 4px -4px;
  padding-left: 4px;
  flex: none;
  align-items: center;
  display: flex;
}

[class*="_rail"] > .dsh-fleet-meta-pinned {
  display: none;
}

.dsh-fleet-meta-session {
  box-sizing: border-box;
  min-width: 0;
  height: 32px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
  flex: 1;
  align-items: center;
  gap: 4px;
  padding: 0 4px 0 8px;
  font: inherit;
  text-align: left;
  display: flex;
}

.dsh-fleet-meta-session::before,
.dsh-fleet-meta-header-button::before {
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-secondary);
  content: "F";
  border: 1.5px solid color-mix(in srgb, currentColor 42%, transparent);
  border-radius: 5px;
  flex: none;
  place-items: center;
  font-size: 9px;
  font-weight: 650;
  line-height: 1;
  display: grid;
}

.dsh-fleet-meta-session:hover::before,
.dsh-fleet-meta-header-button:hover::before {
  color: var(--dsw-alias-label-primary);
}

.dsh-fleet-meta-session::after {
  min-width: 0;
  color: var(--dsw-alias-label-tertiary);
  content: attr(data-caption);
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 20px;
  overflow: hidden;
}

.dsh-fleet-meta-title {
  min-width: 0;
  margin-left: 1px;
  flex: 1;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 14px;
  line-height: 20px;
  overflow: hidden;
}

.dsh-fleet-meta-session:hover,
.dsh-fleet-meta-pinned[data-selected="true"] .dsh-fleet-meta-session {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-meta-session:focus-visible,
.dsh-fleet-meta-collapse:focus-visible,
.dsh-fleet-meta-header-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}

.dsh-fleet-meta-collapse,
.dsh-fleet-meta-header-button {
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 50%;
  flex: none;
  place-items: center;
  padding: 0;
  display: grid;
}

.dsh-fleet-meta-header-button {
  color: var(--dsw-alias-label-primary);
}

.dsh-fleet-meta-collapse:hover,
.dsh-fleet-meta-header-button:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-meta-pinned[data-opening="true"] {
  opacity: .58;
}

`

interface MetaSessionListSnapshot {
  readonly current?: string
  readonly byId: Readonly<Record<string, { readonly cwd?: string }>>
}

interface MetaSessionBinding {
  readonly session: {
    rename(title: string): Promise<unknown>
  }
}

export interface FleetMetaClientSessions {
  readonly list: {
    getSnapshot(): MetaSessionListSnapshot
    subscribe(listener: () => void): () => void
  }
  create(options?: { readonly cwd?: string }): Promise<string>
  open(sessionId: string): void
  binding(sessionId: string): MetaSessionBinding | undefined
}

export interface FleetMetaClientWorkspaces {
  readonly list: {
    getSnapshot(): { readonly archivedSessionIds: readonly string[] }
  }
  archiveSession(sessionId: string): Promise<void>
}

interface MetaAssistantSnapshot {
  readonly collapsed: boolean
  readonly opening: boolean
  readonly sessionId?: string
  readonly currentSessionId?: string
  readonly error?: string
}

let sessions: FleetMetaClientSessions | undefined
let workspaces: FleetMetaClientWorkspaces | undefined
let removeSessionSubscription: (() => void) | undefined
const listeners = new Set<() => void>()

function storageGet(key: string): string | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

function storageSet(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, value)
  } catch {
    // The entry remains usable for this page when persistent browser storage is unavailable.
  }
}

const storedSessionId = storageGet(SESSION_KEY)
let snapshot: MetaAssistantSnapshot = {
  collapsed: storageGet(COLLAPSED_KEY) === 'true',
  opening: false,
  ...(storedSessionId === undefined ? {} : { sessionId: storedSessionId }),
}

function publish(next: MetaAssistantSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

function syncCurrentSession(): void {
  const currentSessionId = sessions?.list.getSnapshot().current
  if (snapshot.currentSessionId === currentSessionId) return
  const { currentSessionId: _previous, ...rest } = snapshot
  publish(currentSessionId === undefined ? rest : { ...rest, currentSessionId })
}

export function configureFleetMetaAssistantClient(
  nextSessions: FleetMetaClientSessions | undefined,
  nextWorkspaces: FleetMetaClientWorkspaces | undefined,
): void {
  removeSessionSubscription?.()
  sessions = nextSessions
  workspaces = nextWorkspaces
  removeSessionSubscription = sessions?.list.subscribe(syncCurrentSession)
  syncCurrentSession()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): MetaAssistantSnapshot {
  return snapshot
}

function setCollapsed(collapsed: boolean): void {
  storageSet(COLLAPSED_KEY, String(collapsed))
  publish({ ...snapshot, collapsed })
}

async function openMetaAssistant(): Promise<void> {
  if (snapshot.opening || sessions === undefined) return
  const { error: _previousError, ...beforeOpen } = snapshot
  publish({ ...beforeOpen, opening: true })
  try {
    const list = sessions.list.getSnapshot()
    let sessionId = snapshot.sessionId
    const existing = sessionId === undefined ? undefined : list.byId[sessionId]
    const archived = sessionId !== undefined
      && workspaces?.list.getSnapshot().archivedSessionIds.includes(sessionId) === true
    if (archived || existing?.cwd === undefined || existing.cwd === '') {
      const currentCwd = list.current === undefined ? undefined : list.byId[list.current]?.cwd
      const availableCwd = currentCwd ?? Object.values(list.byId)
        .find(record => record.cwd !== undefined && record.cwd !== '')?.cwd
      sessionId = await sessions.create({ cwd: availableCwd ?? '.' })
      const title = isChineseLocale() ? 'Fleet 助理' : 'Fleet Help'
      await sessions.binding(sessionId)?.session.rename(title)
      storageSet(SESSION_KEY, sessionId)
    }
    if (sessionId === undefined) throw new Error('Fleet Meta assistant Session could not be resolved')
    sessions.open(sessionId)
    const { error: _error, ...withoutError } = snapshot
    publish({
      ...withoutError,
      opening: false,
      sessionId,
      currentSessionId: sessionId,
    })
  } catch (error) {
    publish({
      ...snapshot,
      opening: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function FleetMetaAssistantPinnedRow(): ReactElement | null {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const selected = state.sessionId !== undefined && state.sessionId === state.currentSessionId
  useEffect(() => {
    if (!selected) return
    if (state.sessionId === undefined) return
    const activation = stageFleetActivation(state.sessionId, { mode: 'meta' })
    return () => clearFleetActivation(state.sessionId!, activation.id)
  }, [selected, state.sessionId])
  if (state.collapsed) return null
  const chinese = isChineseLocale()
  const failure = state.error === undefined
    ? undefined
    : `${chinese ? '无法打开 Fleet 助理' : 'Unable to open Fleet Help'}: ${state.error}`
  return jsxs('div', {
    className: 'dsh-fleet-meta-pinned',
    'data-selected': selected ? 'true' : 'false',
    'data-opening': state.opening ? 'true' : 'false',
    children: [
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-meta-session',
        'aria-label': chinese ? 'Fleet 助理' : 'Fleet Help',
        'aria-busy': state.opening ? 'true' : 'false',
        'data-caption': chinese ? '插件帮助' : 'Plugin guide',
        title: failure ?? (chinese ? '了解和使用 Fleet 团队插件' : 'Learn and use the Fleet Team plugin'),
        onClick: () => { void openMetaAssistant() },
        children: jsx('span', {
          className: 'dsh-fleet-meta-title',
          children: chinese ? 'Fleet 助理' : 'Fleet Help',
        }),
      }),
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-meta-collapse',
        'aria-label': chinese ? '收起 Fleet 助理' : 'Collapse Fleet Help',
        onClick: () => setCollapsed(true),
        children: '⌃',
      }),
    ],
  })
}

export function FleetMetaAssistantHeaderButton(): ReactElement | null {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!state.collapsed) return null
  const chinese = isChineseLocale()
  return jsx('button', {
    type: 'button',
    className: 'dsh-fleet-meta-header-button',
    'aria-label': chinese ? '展开 Fleet 助理' : 'Expand Fleet Help',
    title: chinese ? '展开 Fleet 助理' : 'Expand Fleet Help',
    onClick: () => setCollapsed(false),
    children: null,
  })
}

interface NativeWorkspaceSnapshot {
  readonly archivedSessionIds: readonly string[]
  readonly [key: string]: unknown
}

type NativeUseWorkspaces = <Selection>(
  selector: (snapshot: NativeWorkspaceSnapshot) => Selection,
) => Selection

let cachedWorkspaceSource: NativeWorkspaceSnapshot | undefined
let cachedWorkspaceSessionId: string | undefined
let cachedWorkspaceView: NativeWorkspaceSnapshot | undefined

function hideMetaSession(
  source: NativeWorkspaceSnapshot,
  sessionId: string | undefined,
): NativeWorkspaceSnapshot {
  if (sessionId === undefined || source.archivedSessionIds.includes(sessionId)) return source
  if (cachedWorkspaceSource === source && cachedWorkspaceSessionId === sessionId && cachedWorkspaceView !== undefined) {
    return cachedWorkspaceView
  }
  cachedWorkspaceSource = source
  cachedWorkspaceSessionId = sessionId
  cachedWorkspaceView = {
    ...source,
    archivedSessionIds: [...source.archivedSessionIds, sessionId],
  }
  return cachedWorkspaceView
}

/** Keep the dedicated Meta Session out of the ordinary Session tree without archiving it. */
export function withFleetMetaWorkspaceBrowser(
  WorkspaceBrowser: ComponentType<Record<string, unknown>>,
): ComponentType<Record<string, unknown>> {
  function FleetMetaWorkspaceBrowser(props: Record<string, unknown>): ReactElement {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const useWorkspaces = props.useWorkspaces as NativeUseWorkspaces
    const decoratedUseWorkspaces: NativeUseWorkspaces = selector => useWorkspaces(
      source => selector(hideMetaSession(source, state.sessionId)),
    )
    return jsx(WorkspaceBrowser, {
      ...props,
      useWorkspaces: decoratedUseWorkspaces,
    })
  }

  FleetMetaWorkspaceBrowser.displayName = `withFleetMetaWorkspaceBrowser(${WorkspaceBrowser.displayName ?? WorkspaceBrowser.name ?? 'WorkspaceBrowser'})`
  return FleetMetaWorkspaceBrowser
}

interface NativeSessionSnapshot {
  readonly composerPhase?: unknown
  readonly [key: string]: unknown
}

type NativeUseSession = <Selection>(
  selector: (snapshot: NativeSessionSnapshot) => Selection,
  equality?: (left: Selection, right: Selection) => boolean,
) => Selection

let cachedSessionSource: NativeSessionSnapshot | undefined
let cachedEstablishedSession: NativeSessionSnapshot | undefined

function establishedMetaSession(source: NativeSessionSnapshot): NativeSessionSnapshot {
  if (source.composerPhase !== 'blank') return source
  if (cachedSessionSource === source && cachedEstablishedSession !== undefined) return cachedEstablishedSession
  cachedSessionSource = source
  cachedEstablishedSession = { ...source, composerPhase: 'active' }
  return cachedEstablishedSession
}

/** Present a blank Meta Session as an established conversation rather than the new-Session Hero. */
export function withFleetMetaConversationRoot(
  ConversationRoot: ComponentType<Record<string, unknown>>,
): ComponentType<Record<string, unknown>> {
  function FleetMetaConversationRoot(props: Record<string, unknown>): ReactElement {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const propSessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
    const meta = state.sessionId !== undefined && (
      propSessionId === undefined
        ? state.currentSessionId === state.sessionId
        : propSessionId === state.sessionId
    )
    const useSession = props.useSession as NativeUseSession
    const decoratedUseSession: NativeUseSession = (selector, equality) => useSession(
      source => selector(meta ? establishedMetaSession(source) : source),
      equality,
    )
    return jsx(ConversationRoot, {
      ...props,
      useSession: decoratedUseSession,
    })
  }

  FleetMetaConversationRoot.displayName = `withFleetMetaConversationRoot(${ConversationRoot.displayName ?? ConversationRoot.name ?? 'ConversationRoot'})`
  return FleetMetaConversationRoot
}

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
