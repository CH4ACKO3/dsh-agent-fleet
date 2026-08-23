import type { ComponentType, ReactElement } from 'react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import { clearFleetActivation, stageFleetActivation } from './activation.js'
import { FleetMark } from './fleet-mark.js'
import {
  FLEET_LOCALE_NAMESPACE,
  type FleetLocaleRuntime,
  type FleetLocaleKey,
  fleetLocaleDictionaries,
  isChineseLocale,
} from './locale.js'

const STYLE_ID = 'dsh-agent-fleet-meta-assistant'
const SESSION_KEY = 'dsh-agent-fleet:meta-session:v1'
const COLLAPSED_KEY = 'dsh-agent-fleet:meta-collapsed:v1'
const WELCOME_KEY_PREFIX = 'dsh-agent-fleet:meta-welcome:v1:'

export interface FleetMetaWelcomeState {
  readonly sessionId: string
  readonly text: string
  readonly streaming: boolean
  readonly time: number
}

const styles = `
.dsh-fleet-meta-pinned {
  box-sizing: border-box;
  height: 34px;
  margin: 0 0 4px -4px;
  padding-left: 4px;
  border-radius: 8px;
  flex: none;
  align-items: center;
  display: flex;
}

.dsh-fleet-meta-pinned:hover,
.dsh-fleet-meta-pinned[data-selected="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
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

.dsh-fleet-meta-session > svg,
.dsh-fleet-meta-header-button > svg {
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-secondary);
  flex: none;
}

.dsh-fleet-meta-session > svg {
  transform: translateY(-.5px);
}

.dsh-fleet-meta-session:hover > svg,
.dsh-fleet-meta-header-button:hover > svg {
  color: var(--dsw-alias-label-primary);
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
let locale: FleetLocaleRuntime | undefined
let translateFleet: ((key: FleetLocaleKey) => string) | undefined
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

export function configureFleetMetaAssistantLocale(nextLocale: FleetLocaleRuntime | undefined): void {
  locale = nextLocale
  translateFleet = locale?.bind(FLEET_LOCALE_NAMESPACE)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): MetaAssistantSnapshot {
  return snapshot
}

function subscribeLocale(listener: () => void): () => void {
  return locale?.subscribe(listener) ?? (() => {})
}

function getLocaleRevision(): number {
  return locale?.getSnapshot().revision ?? -1
}

export function useFleetMetaText(key: FleetLocaleKey): string {
  useSyncExternalStore(subscribeLocale, getLocaleRevision, getLocaleRevision)
  return translateFleet?.(key)
    ?? fleetLocaleDictionaries[isChineseLocale() ? 'zh' : 'en'][key]
}

export function useFleetMetaWelcome(): FleetMetaWelcomeState | null {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const active = state.sessionId !== undefined && state.currentSessionId === state.sessionId
  const sessionId = active ? state.sessionId : undefined
  const copy = useFleetMetaText('welcome.message')
  const welcomeKey = sessionId === undefined ? '' : `${WELCOME_KEY_PREFIX}${sessionId}`
  const initialSeen = welcomeKey !== '' && storageGet(welcomeKey) === 'true'
  const [text, setText] = useState(initialSeen ? copy : '')
  const [streaming, setStreaming] = useState(active && !initialSeen)
  const identity = useRef({ sessionId, time: Date.now() })
  if (identity.current.sessionId !== sessionId) identity.current = { sessionId, time: Date.now() }

  useEffect(() => {
    if (!active || welcomeKey === '') {
      setText('')
      setStreaming(false)
      return
    }
    const alreadySeen = storageGet(welcomeKey) === 'true'
    const reduceMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (alreadySeen || reduceMotion) {
      setText(copy)
      setStreaming(false)
      storageSet(welcomeKey, 'true')
      return
    }

    const characters = Array.from(copy)
    let offset = 0
    let interval: ReturnType<typeof setInterval> | undefined
    setText('')
    setStreaming(true)
    const delay = setTimeout(() => {
      interval = setInterval(() => {
        offset = Math.min(characters.length, offset + 2)
        setText(characters.slice(0, offset).join(''))
        if (offset < characters.length) return
        if (interval !== undefined) clearInterval(interval)
        setStreaming(false)
        storageSet(welcomeKey, 'true')
      }, 22)
    }, 180)

    return () => {
      clearTimeout(delay)
      if (interval !== undefined) clearInterval(interval)
    }
  }, [active, copy, welcomeKey])

  if (!active || sessionId === undefined) return null
  return {
    sessionId,
    text,
    streaming,
    time: identity.current.time,
  }
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
      storageSet(SESSION_KEY, sessionId)
    }
    if (sessionId === undefined) throw new Error('Fleet Meta assistant Session could not be resolved')
    await sessions.binding(sessionId)?.session.rename('Agent Fleet')
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
    : `${chinese ? '无法打开 Agent Fleet' : 'Unable to open Agent Fleet'}: ${state.error}`
  return jsxs('div', {
    className: 'dsh-fleet-meta-pinned',
    'data-selected': selected ? 'true' : 'false',
    'data-opening': state.opening ? 'true' : 'false',
    children: [
      jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-meta-session',
        'aria-label': 'Agent Fleet',
        'aria-busy': state.opening ? 'true' : 'false',
        title: failure ?? (chinese ? '打开 Agent Fleet' : 'Open Agent Fleet'),
        onClick: () => { void openMetaAssistant() },
        children: [
          jsx(FleetMark, {}),
          jsx('span', {
            className: 'dsh-fleet-meta-title',
            children: 'Agent Fleet',
          }),
        ],
      }),
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-meta-collapse',
        'aria-label': chinese ? '收起 Agent Fleet' : 'Collapse Agent Fleet',
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
    'aria-label': chinese ? '展开 Agent Fleet' : 'Expand Agent Fleet',
    title: chinese ? '展开 Agent Fleet' : 'Expand Agent Fleet',
    onClick: () => setCollapsed(false),
    children: jsx(FleetMark, {}),
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

type NativeUseStore = <Selection>(
  selector: (snapshot: { readonly view?: string }) => Selection,
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
    const meta = state.sessionId !== undefined && state.currentSessionId === state.sessionId
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

/** Keep the native new-Session Hero, but expose its global view tabs so Fleet is reachable there. */
export function withFleetGlobalConversationHeader(
  ConversationHeader: ComponentType<Record<string, unknown>>,
): ComponentType<Record<string, unknown>> {
  function FleetGlobalConversationHeader(props: Record<string, unknown>): ReactElement {
    const useSession = props.useSession as NativeUseSession
    const decoratedUseSession: NativeUseSession = (selector, equality) => useSession(
      source => selector(establishedMetaSession(source)),
      equality,
    )
    return jsx(ConversationHeader, { ...props, useSession: decoratedUseSession })
  }

  FleetGlobalConversationHeader.displayName = `withFleetGlobalConversationHeader(${ConversationHeader.displayName ?? ConversationHeader.name ?? 'ConversationSessionHeader'})`
  return FleetGlobalConversationHeader
}

/** Mount the same global Fleet view from any Session, including an otherwise blank new Session. */
export function withFleetGlobalConversationView(
  ConversationSession: ComponentType<Record<string, unknown>>,
): ComponentType<Record<string, unknown>> {
  function FleetGlobalConversationView(props: Record<string, unknown>): ReactElement {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const meta = state.sessionId !== undefined && state.currentSessionId === state.sessionId
    const useStore = props.useStore as NativeUseStore
    const fleetSelected = useStore(source => source.view) === 'fleet'
    const useSession = props.useSession as NativeUseSession
    const decoratedUseSession: NativeUseSession = (selector, equality) => useSession(
      source => selector(meta || fleetSelected ? establishedMetaSession(source) : source),
      equality,
    )
    return jsx(ConversationSession, { ...props, useSession: decoratedUseSession })
  }

  FleetGlobalConversationView.displayName = `withFleetGlobalConversationView(${ConversationSession.displayName ?? ConversationSession.name ?? 'ConversationSession'})`
  return FleetGlobalConversationView
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
