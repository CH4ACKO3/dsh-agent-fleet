import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  FleetGitBranch,
  FleetGitCommit,
  FleetGitCommitDetails,
  FleetGitCommitFile,
  FleetGitDiff,
  FleetGitSnapshot,
  FleetGitWorktree,
} from '../git.js'
import type {
  ComponentType,
  ChangeEvent,
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
} from 'react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import {
  siC,
  siCplusplus,
  siCss,
  siDocker,
  siGnubash,
  siGnu,
  siGo,
  siHtml5,
  siJavascript,
  siJson,
  siLess,
  siMarkdown,
  siNvidia,
  siPython,
  siRust,
  siSass,
  siSvelte,
  siSvg,
  siToml,
  siTypescript,
  siVuedotjs,
  siYaml,
  type SimpleIcon,
} from 'simple-icons'

import { FLEET_GIT_WEB_REMOTE, type FleetGitWebClient } from '../contract.js'

const TOOL_ID = 'git'
const STYLE_ID = 'dsh-agent-fleet-git-style'
const POLL_INTERVAL_MS = 5_000
const MAX_CACHED_REPOSITORIES = 32
const GRAPH_ROW_HEIGHT = 24
const GRAPH_ROW_MIDPOINT = GRAPH_ROW_HEIGHT / 2
const GRAPH_LANE_WIDTH = 14
const COMMIT_DETAILS_HEIGHT = 224
const COMMIT_VIRTUAL_ROW_HEIGHT = GRAPH_ROW_HEIGHT
const SHORT_COMMIT_LENGTH = 7

export interface FleetMemberFace {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly color: string
  readonly operator?: boolean
  readonly responsibility?: string
  readonly statusText?: string
  readonly presence?: 'active' | 'busy' | 'waiting' | 'offline' | 'error' | 'unknown'
  readonly runtimeStatus?: 'idle' | 'running' | 'waiting' | 'error' | 'offline' | 'paused' | 'unknown'
}

interface FleetWorkspaceFace {
  readonly path: string
  readonly access: 'read' | 'write'
}

interface FleetTeamFace {
  readonly teamId: string
  readonly teamName: string
}

interface FleetToolOwner {
  readonly activeTool: string
  readonly disabled?: boolean
  readonly selectTool: (tool: string) => void
}

interface FleetPaneOwner {
  readonly fleet: { readonly directory: { readonly teams: readonly FleetTeamFace[] } }
  readonly snapshot: {
    readonly teamId: string
    readonly teamName: string
    readonly members: readonly FleetMemberFace[]
    readonly assistants?: readonly FleetMemberFace[]
    readonly workspaces: readonly FleetWorkspaceFace[]
  }
  readonly selectTeam: (teamId: string) => void
  readonly showMemberDetails: (memberId: string) => void
}

interface SlotRegistrationOptions {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly order?: number
}

interface FleetGitClientContext {
  readonly slots: {
    inject(name: string, register: () => unknown): void
    register(options: SlotRegistrationOptions, component: ComponentType<any>): unknown
  }
  readonly remote?: { $mount(contribution: typeof FLEET_GIT_WEB_REMOTE): Promise<() => Promise<void>> }
  inject?<T>(names: readonly string[], callback: (ctx: FleetGitClientContext & T) => void | (() => void)): void
  get?(name: string): unknown
}

interface FleetDiffEngine {
  diff(input: { readonly kind: 'patch'; readonly patch: string }): unknown
}

interface FleetDiffRenderer {
  render(document: unknown): { readonly html: string }
}

interface FleetDiffServices {
  readonly diffEngine: FleetDiffEngine
  readonly diffRenderer: FleetDiffRenderer
}

interface DiffSelection {
  readonly path: string
  readonly staged: boolean
}

interface GitViewState {
  readonly snapshot?: FleetGitSnapshot
  readonly notRepository?: boolean
  readonly loading: boolean
  readonly error?: string
  readonly selection?: DiffSelection
  readonly diff?: FleetGitDiff
  readonly diffLoading: boolean
  readonly diffError?: string
}

const EMPTY_STATE: GitViewState = { loading: false, diffLoading: false }
const stateByRoot = new Map<string, GitViewState>()
const listenersByRoot = new Map<string, Set<() => void>>()
const refreshes = new Map<string, Promise<void>>()
let webClient: FleetGitWebClient | undefined
let diffServices: FleetDiffServices | undefined
let diffServicesRevision = 0
const diffServiceListeners = new Set<() => void>()
interface MemberEmphasisState {
  readonly hovered?: string
  readonly selected?: string
}
const memberEmphasisByTeam = new Map<string, MemberEmphasisState>()
const memberEmphasisListeners = new Set<() => void>()

function publishMemberEmphasis(teamId: string, kind: keyof MemberEmphasisState, memberId: string | undefined): void {
  const current = memberEmphasisByTeam.get(teamId) ?? {}
  if (current[kind] === memberId) return
  const next = { ...current, [kind]: memberId }
  if (next.hovered === undefined && next.selected === undefined) memberEmphasisByTeam.delete(teamId)
  else memberEmphasisByTeam.set(teamId, next)
  for (const listener of memberEmphasisListeners) listener()
}

function clearMemberEmphasis(teamId: string, kind: keyof MemberEmphasisState, memberId: string): void {
  if (memberEmphasisByTeam.get(teamId)?.[kind] === memberId) publishMemberEmphasis(teamId, kind, undefined)
}

function useMemberEmphasis(teamId: string): string | undefined {
  return useSyncExternalStore(
    listener => {
      memberEmphasisListeners.add(listener)
      return () => { memberEmphasisListeners.delete(listener) }
    },
    () => {
      const state = memberEmphasisByTeam.get(teamId)
      return state?.selected ?? state?.hovered
    },
    () => undefined,
  )
}

function configureDiffServices(services: FleetDiffServices | undefined): void {
  diffServices = services
  diffServicesRevision += 1
  for (const listener of diffServiceListeners) listener()
}

function useDiffServices(): FleetDiffServices | undefined {
  useSyncExternalStore(
    listener => {
      diffServiceListeners.add(listener)
      return () => { diffServiceListeners.delete(listener) }
    },
    () => diffServicesRevision,
    () => diffServicesRevision,
  )
  return diffServices
}

function repositoryStateKey(root: string, teamId: string): string {
  return `${teamId}\0${root}`
}

function publish(root: string, teamId: string, state: GitViewState): void {
  const key = repositoryStateKey(root, teamId)
  stateByRoot.delete(key)
  stateByRoot.set(key, state)
  while (stateByRoot.size > MAX_CACHED_REPOSITORIES) {
    let evictable: string | undefined
    for (const candidate of stateByRoot.keys()) {
      if ((listenersByRoot.get(candidate)?.size ?? 0) === 0) {
        evictable = candidate
        break
      }
    }
    if (evictable === undefined) break
    stateByRoot.delete(evictable)
  }
  for (const listener of listenersByRoot.get(key) ?? []) listener()
}

function stateFor(root: string | undefined, teamId: string): GitViewState {
  return root === undefined ? EMPTY_STATE : stateByRoot.get(repositoryStateKey(root, teamId)) ?? EMPTY_STATE
}

function subscribe(root: string | undefined, teamId: string, listener: () => void): () => void {
  if (root === undefined) return () => {}
  const key = repositoryStateKey(root, teamId)
  const listeners = listenersByRoot.get(key) ?? new Set()
  listeners.add(listener)
  listenersByRoot.set(key, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByRoot.delete(key)
  }
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

async function refresh(root: string, teamId: string): Promise<void> {
  const key = repositoryStateKey(root, teamId)
  const pending = refreshes.get(key)
  if (pending !== undefined) return pending
  const current = stateFor(root, teamId)
  const { error: _error, ...withoutError } = current
  publish(root, teamId, { ...withoutError, loading: true })
  const operation = (async () => {
    try {
      if (webClient === undefined) throw new Error('Git Remote 尚未连接')
      const snapshot = unwrap(await webClient.snapshot({ root, teamId, limit: 200 }))
      const { error: _error, snapshot: _snapshot, notRepository: _notRepository, ...fresh } = stateFor(root, teamId)
      publish(root, teamId, snapshot === null
        ? { ...fresh, notRepository: true, loading: false }
        : { ...fresh, snapshot, loading: false })
    } catch (error) {
      publish(root, teamId, {
        ...stateFor(root, teamId),
        loading: false,
        error: error instanceof Error ? error.message : 'Git 状态读取失败',
      })
    } finally {
      refreshes.delete(key)
    }
  })()
  refreshes.set(key, operation)
  return operation
}

async function openDiff(root: string, teamId: string, selection: DiffSelection): Promise<void> {
  const { diff: _diff, diffError: _diffError, ...current } = stateFor(root, teamId)
  publish(root, teamId, { ...current, selection, diffLoading: true })
  try {
    if (webClient === undefined) throw new Error('Git Remote 尚未连接')
    const diff = unwrap(await webClient.diff({ root, path: selection.path, staged: selection.staged }))
    const current = stateFor(root, teamId)
    if (current.selection?.path !== selection.path || current.selection.staged !== selection.staged) return
    const { diffError: _diffError, ...withoutError } = current
    publish(root, teamId, { ...withoutError, diff, diffLoading: false })
  } catch (error) {
    const current = stateFor(root, teamId)
    if (current.selection?.path !== selection.path || current.selection.staged !== selection.staged) return
    publish(root, teamId, {
      ...current,
      diffLoading: false,
      diffError: error instanceof Error ? error.message : 'Diff 读取失败',
    })
  }
}

function closeDiff(root: string, teamId: string): void {
  const { selection: _selection, diff: _diff, diffError: _diffError, ...state } = stateFor(root, teamId)
  publish(root, teamId, { ...state, diffLoading: false })
}

function useGitState(root: string | undefined, teamId: string): GitViewState {
  return useSyncExternalStore(
    listener => subscribe(root, teamId, listener),
    () => stateFor(root, teamId),
    () => stateFor(root, teamId),
  )
}

function useGitRefresh(root: string | undefined, teamId: string): void {
  useEffect(() => {
    if (root === undefined) return
    void refresh(root, teamId)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(root, teamId)
    }, POLL_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [root, teamId])
}

function repositoryRoot(owner: FleetPaneOwner): string | undefined {
  return owner.snapshot.workspaces.find(workspace => workspace.access === 'write')?.path
    ?? owner.snapshot.workspaces[0]?.path
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path
}

function localizedLabel(chinese: string, english: string): string {
  const locale = document.documentElement.lang.trim() || navigator.language.trim()
  return locale.toLowerCase().startsWith('zh') ? chinese : english
}

function parentPath(path: string): string {
  const parts = path.split(/[\\/]/u)
  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}

interface FileTypeVisual {
  readonly color: string
  readonly title: string
  readonly icon?: SimpleIcon
  readonly generic?: 'file' | 'image' | 'text'
}

function brandIcon(icon: SimpleIcon, color = `#${icon.hex}`, title = icon.title): FileTypeVisual {
  return { color, icon, title }
}

const genericFile: FileTypeVisual = { color: '#68737f', generic: 'file', title: 'File' }
const genericImage: FileTypeVisual = { color: '#7a5aa6', generic: 'image', title: 'Image' }
const genericText: FileTypeVisual = { color: '#68737f', generic: 'text', title: 'Text file' }
const specialFileTypes: Readonly<Record<string, FileTypeVisual>> = {
  dockerfile: brandIcon(siDocker, '#2787c7', 'Dockerfile'),
  makefile: brandIcon(siGnu, '#6f7782', 'Makefile'),
  license: { color: '#b07838', generic: 'text', title: 'License' },
}
const extensionFileTypes: Readonly<Record<string, FileTypeVisual>> = {
  ts: brandIcon(siTypescript),
  tsx: brandIcon(siTypescript, '#3178c6', 'TypeScript React'),
  js: brandIcon(siJavascript, '#a67f00'),
  jsx: brandIcon(siJavascript, '#a67f00', 'JavaScript React'),
  mjs: brandIcon(siJavascript, '#a67f00', 'JavaScript module'),
  cjs: brandIcon(siJavascript, '#a67f00', 'CommonJS module'),
  json: brandIcon(siJson, '#9a7416'),
  jsonc: brandIcon(siJson, '#9a7416', 'JSON with comments'),
  md: brandIcon(siMarkdown, '#4776a8'),
  mdx: brandIcon(siMarkdown, '#4776a8', 'MDX'),
  css: brandIcon(siCss, '#3977ba'),
  scss: brandIcon(siSass, '#c05a8b', 'SCSS'),
  sass: brandIcon(siSass, '#c05a8b'),
  less: brandIcon(siLess, '#315985'),
  html: brandIcon(siHtml5, '#c45d36'),
  htm: brandIcon(siHtml5, '#c45d36', 'HTML'),
  vue: brandIcon(siVuedotjs, '#348b69'),
  svelte: brandIcon(siSvelte, '#d85d35'),
  py: brandIcon(siPython, '#3b6f9e'),
  rs: brandIcon(siRust, '#9a543a'),
  go: brandIcon(siGo, '#1687a2'),
  sh: brandIcon(siGnubash, '#4d8554', 'Shell script'),
  bash: brandIcon(siGnubash, '#4d8554', 'Bash script'),
  zsh: brandIcon(siGnubash, '#4d8554', 'Z shell script'),
  yaml: brandIcon(siYaml, '#b24c5f'),
  yml: brandIcon(siYaml, '#b24c5f', 'YAML'),
  toml: brandIcon(siToml, '#8b6048'),
  svg: brandIcon(siSvg, '#9a6b35'),
  png: genericImage,
  jpg: { ...genericImage, title: 'JPEG image' },
  jpeg: { ...genericImage, title: 'JPEG image' },
  gif: { ...genericImage, title: 'GIF image' },
  webp: { ...genericImage, title: 'WebP image' },
  txt: genericText,
  log: { ...genericText, title: 'Log file' },
  c: brandIcon(siC, '#5277a3'),
  h: brandIcon(siC, '#5277a3', 'C header'),
  cc: brandIcon(siCplusplus, '#4d679d', 'C++'),
  cpp: brandIcon(siCplusplus, '#4d679d', 'C++'),
  cxx: brandIcon(siCplusplus, '#4d679d', 'C++'),
  hpp: brandIcon(siCplusplus, '#4d679d', 'C++ header'),
  cu: brandIcon(siNvidia, '#628f36', 'CUDA'),
  cuh: brandIcon(siNvidia, '#628f36', 'CUDA header'),
}

function fileTypeVisual(path: string): FileTypeVisual {
  const name = fileName(path).toLowerCase()
  const extension = name.includes('.') ? name.split('.').at(-1) ?? '' : ''
  return specialFileTypes[name]
    ?? extensionFileTypes[extension]
    ?? { ...genericFile, title: extension === '' ? 'File' : `${extension.toUpperCase()} file` }
}

export function worktreeForMember(
  member: FleetMemberFace,
  worktrees: readonly FleetGitWorktree[],
): FleetGitWorktree | undefined {
  return worktrees.find(candidate => candidate.branch?.split('/').at(-1) === member.id)
    ?? worktrees.find(candidate => fileName(candidate.path) === member.id)
}

function branchForMember(
  member: FleetMemberFace,
  worktrees: readonly FleetGitWorktree[],
  branches: readonly FleetGitBranch[],
): string | undefined {
  const worktree = worktreeForMember(member, worktrees)
  return worktree?.branch ?? branches.find(branch => !branch.remote && branch.name.split('/').at(-1) === member.id)?.name
}

function statusLabel(code: string): string {
  const labels: Record<string, string> = {
    M: '已修改', A: '已添加', D: '已删除', R: '已重命名', C: '已复制', U: '未合并', '?': '未跟踪', '!': '已忽略',
  }
  return labels[code] ?? code
}

function FileTypeIcon({ path }: { readonly path: string }): ReactElement {
  const visual = fileTypeVisual(path)
  return jsx('span', {
    className: 'dsh-fleet-git-file-type',
    style: { color: visual.color },
    title: visual.title,
    'aria-hidden': 'true',
    children: visual.icon === undefined
      ? jsxs('svg', {
          viewBox: '0 0 20 20',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          children: [
            jsx('path', { d: 'M5.5 2.75h6L15.5 6.8v10.45h-10z' }),
            jsx('path', { d: 'M11.5 2.75V6.8h4' }),
            visual.generic === 'image'
              ? jsxs('g', { children: [jsx('circle', { cx: 8.5, cy: 10, r: .85 }), jsx('path', { d: 'm7.5 14 2.2-2 1.55 1.4 1.2-1.1 1.55 1.55' })] })
              : visual.generic === 'text'
                ? jsxs('g', { children: [jsx('path', { d: 'M8 10h5M8 13h5' })] })
                : undefined,
          ],
        })
      : jsx('svg', {
          viewBox: '0 0 24 24',
          fill: 'currentColor',
          children: jsx('path', { d: visual.icon.path }),
        }),
  })
}

function Icon({ name, size = 18 }: {
  readonly name: 'git' | 'refresh' | 'back' | 'fetch' | 'chevron' | 'close' | 'branch' | 'stash' | 'check' | 'search'
  readonly size?: number
}): ReactElement {
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
  if (name === 'refresh') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'M15.6 6.5A6.2 6.2 0 1 0 16 12m-.4-5.5V3m0 3.5h-3.5' }),
  })
  if (name === 'back') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'm8.25 5-5 5 5 5M3.5 10h13' }),
  })
  if (name === 'fetch') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M6.1 14.5H5a3.3 3.3 0 0 1-.35-6.58A5.25 5.25 0 0 1 14.7 6.8a3.45 3.45 0 0 1 .25 6.85' }),
      jsx('path', { d: 'M10 9.5v7m-2.6-2.6 2.6 2.6 2.6-2.6' }),
    ],
  })
  if (name === 'chevron') return jsx('svg', { ...common, children: jsx('path', { d: 'm7 5 5 5-5 5' }) })
  if (name === 'close') return jsx('svg', { ...common, children: jsx('path', { d: 'm5.5 5.5 9 9m0-9-9 9' }) })
  if (name === 'search') return jsxs('svg', {
    ...common,
    children: [jsx('circle', { cx: 8.5, cy: 8.5, r: 4.5 }), jsx('path', { d: 'm12 12 3.5 3.5' })],
  })
  if (name === 'branch') return jsxs('svg', {
    ...common,
    children: [
      jsx('circle', { cx: 6, cy: 5, r: 1.6 }),
      jsx('circle', { cx: 6, cy: 15, r: 1.6 }),
      jsx('circle', { cx: 14, cy: 7.5, r: 1.6 }),
      jsx('path', { d: 'M6 6.6v6.8m0-3.2c4.9 0 8-1 8-2.7' }),
    ],
  })
  if (name === 'stash') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M4 7.5h12v8H4z' }),
      jsx('path', { d: 'M3.5 4.5h13v3h-13zm4 6h5' }),
    ],
  })
  if (name === 'check') return jsx('svg', { ...common, children: jsx('path', { d: 'm4.5 10 3.3 3.3 7.7-7.7' }) })
  return jsxs('svg', {
    ...common,
    children: [
      jsx('circle', { cx: 6, cy: 4.5, r: 1.7 }),
      jsx('circle', { cx: 6, cy: 15.5, r: 1.7 }),
      jsx('circle', { cx: 14, cy: 7.5, r: 1.7 }),
      jsx('path', { d: 'M6 6.2v7.6m0-3.8c4.9 0 8-1 8-2.5' }),
    ],
  })
}

function GitTool(owner: FleetToolOwner): ReactElement {
  const active = owner.activeTool === TOOL_ID
  return jsx('button', {
    type: 'button',
    className: 'dsh-fleet-panel-tool',
    disabled: owner.disabled === true,
    'aria-label': '源代码管理',
    'aria-current': active ? 'page' : undefined,
    title: '源代码管理',
    onClick: () => { owner.selectTool(TOOL_ID) },
    children: jsx(Icon, { name: 'git' }),
  })
}

function TeamSelector({ owner }: { readonly owner: FleetPaneOwner }): ReactElement {
  const [open, setOpen] = useState(false)
  return jsxs('div', {
    className: 'dsh-fleet-panel-sidebar-team-block dsh-fleet-git-team-block',
    children: [
      jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-git-team-trigger',
        'aria-haspopup': 'menu',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => { setOpen(value => !value) },
        children: [
          jsx('span', { className: 'dsh-fleet-git-team-name', children: owner.snapshot.teamName }),
          jsx(Icon, { name: 'chevron', size: 14 }),
        ],
      }),
      open && jsx('div', {
        className: 'dsh-fleet-git-team-menu',
        role: 'menu',
        children: owner.fleet.directory.teams.map(team => jsx('button', {
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': team.teamId === owner.snapshot.teamId ? 'true' : 'false',
          onClick: () => {
            owner.selectTeam(team.teamId)
            setOpen(false)
          },
          children: team.teamName,
        }, team.teamId)),
      }),
    ],
  })
}

function Section({ title, count, children, defaultOpen = true }: {
  readonly title: string
  readonly count: number
  readonly children: ReactNode
  readonly defaultOpen?: boolean
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  return jsxs('section', {
    className: 'dsh-fleet-git-section',
    children: [
      jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-git-section-head',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => { setOpen(value => !value) },
        children: [
          jsx('span', { className: 'dsh-fleet-git-section-chevron', 'data-open': open ? 'true' : 'false', children: jsx(Icon, { name: 'chevron', size: 13 }) }),
          jsx('span', { children: title }),
          jsx('span', { className: 'dsh-fleet-git-section-count', children: count }),
        ],
      }),
      open && jsx('div', { className: 'dsh-fleet-git-section-body', children }),
    ],
  })
}

function ChangeRow({ root, teamId, path, code, staged }: {
  readonly root: string
  readonly teamId: string
  readonly path: string
  readonly code: string
  readonly staged: boolean
}): ReactElement {
  const visibleCode = code === '?' ? 'U' : code.trim() || 'M'
  return jsxs('button', {
    type: 'button',
    className: 'dsh-fleet-git-change-row',
    title: `${statusLabel(code)} · ${path}`,
    onClick: () => { void openDiff(root, teamId, { path, staged }) },
    children: [
      jsx(FileTypeIcon, { path }),
      jsxs('span', {
        className: 'dsh-fleet-git-change-copy',
        children: [
          jsx('span', { className: 'dsh-fleet-git-change-name', children: fileName(path) }),
          parentPath(path) !== '' && jsx('span', { className: 'dsh-fleet-git-change-path', children: parentPath(path) }),
        ],
      }),
      jsx('span', {
        className: 'dsh-fleet-git-status-code',
        'data-code': visibleCode,
        'data-status': code,
        children: visibleCode,
      }),
    ],
  })
}

function memberPresence(member: FleetMemberFace): FleetMemberFace['presence'] {
  if (member.runtimeStatus === 'paused' || member.runtimeStatus === 'offline') return 'offline'
  if (member.runtimeStatus === 'running') return 'busy'
  if (member.runtimeStatus === 'waiting') return 'waiting'
  if (member.runtimeStatus === 'error') return 'error'
  return member.presence ?? (member.runtimeStatus === 'idle' ? 'active' : 'offline')
}

function memberPresenceLabel(member: FleetMemberFace): string {
  if (member.runtimeStatus === 'paused') return '已暂停'
  const labels = { active: '空闲', busy: '工作中', waiting: '等待中', offline: '离线', error: '异常', unknown: '状态待同步' }
  return labels[memberPresence(member) ?? 'offline']
}

function GitMemberRow({ member, location, teamId, selected, showDetails, onSelect }: {
  readonly member: FleetMemberFace
  readonly location: string
  readonly teamId: string
  readonly selected: boolean
  readonly showDetails: (memberId: string) => void
  readonly onSelect: (memberId: string) => void
}): ReactElement {
  const popover = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const node = popover.current
    if (node === null) return
    const syncOpen = (): void => {
      setOpen(node.matches(':popover-open'))
    }
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
      clearMemberEmphasis(teamId, 'hovered', member.id)
    }
  }, [member.id, teamId])

  useEffect(() => {
    if (selected) publishMemberEmphasis(teamId, 'selected', member.id)
    else clearMemberEmphasis(teamId, 'selected', member.id)
    return () => { clearMemberEmphasis(teamId, 'selected', member.id) }
  }, [member.id, selected, teamId])

  const showPopover = (anchor: Element): void => {
    const node = popover.current
    if (node === null || node.matches(':popover-open')) return
    const bounds = anchor.getBoundingClientRect()
    node.style.visibility = 'hidden'
    node.showPopover()
    const popoverBounds = node.getBoundingClientRect()
    const gutter = 12
    const gap = 8
    node.style.left = `${String(Math.round(Math.max(gutter, Math.min(window.innerWidth - popoverBounds.width - gutter, bounds.right + gap))))}px`
    node.style.top = `${String(Math.round(Math.max(gutter, Math.min(bounds.top, window.innerHeight - popoverBounds.height - gutter))))}px`
    node.style.visibility = ''
  }
  const hidePopover = (): void => {
    const node = popover.current
    if (node?.matches(':popover-open') === true) node.hidePopover()
  }
  const presence = memberPresence(member)
  return jsxs('div', {
    className: 'dsh-fleet-git-member-anchor',
    onMouseLeave: () => {
      hidePopover()
      clearMemberEmphasis(teamId, 'hovered', member.id)
    },
    children: [
      jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-git-member-row',
        'data-selected': selected ? 'true' : undefined,
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false',
        'aria-pressed': selected,
        'aria-label': selected ? `返回团队工作区；当前为 ${member.name} 的工作区` : `切换到 ${member.name} 的工作区`,
        onMouseEnter: (event: ReactMouseEvent<HTMLButtonElement>) => {
          publishMemberEmphasis(teamId, 'hovered', member.id)
          showPopover(event.currentTarget)
        },
        onFocus: (event: ReactFocusEvent<HTMLButtonElement>) => {
          publishMemberEmphasis(teamId, 'hovered', member.id)
          showPopover(event.currentTarget)
        },
        onBlur: (event: ReactFocusEvent<HTMLButtonElement>) => {
          if (event.relatedTarget instanceof Node && popover.current?.contains(event.relatedTarget) === true) return
          hidePopover()
          clearMemberEmphasis(teamId, 'hovered', member.id)
        },
        onClick: () => { onSelect(member.id) },
        children: [
          jsx('span', { className: 'dsh-fleet-git-member-dot', style: { background: member.color } }),
          jsxs('span', {
            className: 'dsh-fleet-git-member-copy',
            children: [
              jsxs('span', {
                className: 'dsh-fleet-git-member-heading',
                children: [
                  jsx('span', { className: 'dsh-fleet-git-member-name', children: member.name }),
                  jsx('small', { className: 'dsh-fleet-git-member-role', children: member.role }),
                ],
              }),
              jsx('small', { className: 'dsh-fleet-git-member-location', children: location }),
            ],
          }),
        ],
      }),
      jsxs('div', {
        ref: popover,
        popover: 'auto',
        className: 'dsh-fleet-panel-member-popover',
        role: 'dialog',
        children: [
          jsxs('header', {
            className: 'dsh-fleet-panel-member-popover-head',
            children: [
              jsx('span', {
                className: 'dsh-fleet-git-member-popover-avatar',
                style: { background: member.color },
                children: memberInitial(member.name),
              }),
              jsxs('div', {
                className: 'dsh-fleet-panel-member-popover-copy',
                children: [
                  jsx('div', { className: 'dsh-fleet-panel-member-popover-name', children: member.name }),
                  jsx('div', { className: 'dsh-fleet-panel-member-popover-role', children: member.role }),
                ],
              }),
            ],
          }),
          jsx('p', {
            className: 'dsh-fleet-panel-member-popover-responsibility',
            children: member.responsibility ?? member.role,
          }),
          jsx('div', {
            className: 'dsh-fleet-panel-member-popover-status',
            'data-status': presence,
            children: memberPresenceLabel(member),
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
              popover.current?.hidePopover()
              showDetails(member.id)
            },
            children: '详细信息',
          }),
        ],
      }),
    ],
  })
}

function GitSidebar(owner: FleetPaneOwner): ReactElement {
  const root = repositoryRoot(owner)
  const teamId = owner.snapshot.teamId
  const [selectedMemberId, setSelectedMemberId] = useState<string>()
  const teamState = useGitState(root, teamId)
  useGitRefresh(root, teamId)
  const members = [...owner.snapshot.members, ...(owner.snapshot.assistants ?? [])]
  const teamWorktrees = teamState.snapshot?.status.worktrees ?? []
  const selectedMember = members.find(member => member.id === selectedMemberId)
  const selectedWorktree = selectedMember === undefined ? undefined : worktreeForMember(selectedMember, teamWorktrees)
  const statusRoot = selectedWorktree?.path ?? root
  const state = useGitState(statusRoot, teamId)
  useGitRefresh(statusRoot === root ? undefined : statusRoot, teamId)
  useEffect(() => { setSelectedMemberId(undefined) }, [root, teamId])
  const status = state.snapshot?.status
  const staged = status?.changes.filter(change => change.index !== ' ' && change.index !== '?') ?? []
  const working = status?.changes.filter(change => change.worktree !== ' ' || change.index === '?') ?? []
  const worktrees = teamWorktrees
  const stashes = state.snapshot?.stashes ?? []
  const actorRow = (member: FleetMemberFace): ReactElement => {
    const memberWorktree = worktreeForMember(member, worktrees)
    const branch = branchForMember(member, worktrees, teamState.snapshot?.branches ?? [])
    const location = memberWorktree === undefined
      ? branch ?? (teamState.snapshot?.status.branch === undefined ? '尚无工作树' : `主工作树 · ${teamState.snapshot.status.branch}`)
      : `${memberWorktree.path === root ? '主工作树' : fileName(memberWorktree.path)} · ${branch ?? 'Detached HEAD'}`
    return jsx(GitMemberRow, {
      member,
      location,
      teamId,
      selected: selectedMemberId === member.id,
      showDetails: owner.showMemberDetails,
      onSelect: (memberId: string) => { setSelectedMemberId(current => current === memberId ? undefined : memberId) },
    }, member.id)
  }
  return jsxs('div', {
    className: 'dsh-fleet-git-sidebar-layout',
    children: [
      jsx(TeamSelector, { owner }),
      jsxs('div', {
        className: 'dsh-fleet-panel-sidebar dsh-fleet-git-sidebar',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-git-sidebar-head',
            children: [
              jsxs('div', {
                className: 'dsh-fleet-git-repository-copy',
                children: [
                  jsx('strong', {
                    title: statusRoot === undefined ? undefined : status?.root ?? statusRoot,
                    children: root === undefined
                      ? localizedLabel('未挂载工作区', 'No workspace mounted')
                      : selectedMember === undefined
                        ? localizedLabel('团队工作区', 'Team workspace')
                        : localizedLabel(`${selectedMember.name} 的工作区`, `${selectedMember.name}'s workspace`),
                  }),
                  root !== undefined && jsx('span', {
                    children: state.notRepository === true ? '当前工作区未初始化 Git' : status?.branch ?? 'Detached HEAD',
                  }),
                ],
              }),
              statusRoot !== undefined && jsx('button', {
                type: 'button',
                className: 'dsh-fleet-git-icon-button',
                'aria-label': selectedMember === undefined
                  ? localizedLabel('刷新 Git 状态', 'Refresh Git status')
                  : localizedLabel('返回团队工作区', 'Return to team workspace'),
                title: selectedMember === undefined
                  ? localizedLabel('刷新', 'Refresh')
                  : localizedLabel('返回团队工作区', 'Return to team workspace'),
                disabled: selectedMember === undefined && state.loading,
                onClick: selectedMember === undefined
                  ? () => { void refresh(statusRoot, teamId) }
                  : () => { setSelectedMemberId(undefined) },
                children: jsx(Icon, { name: selectedMember === undefined ? 'refresh' : 'back', size: 15 }),
              }),
            ],
          }),
          jsx('div', {
            className: 'dsh-fleet-git-sidebar-scroll',
            children: root === undefined
              ? jsx('div', { className: 'dsh-fleet-git-empty', children: '给团队挂载一个 Git 工作区后即可查看源码管理状态。' })
              : state.notRepository === true
                ? jsx('div', {
                    className: 'dsh-fleet-git-empty',
                    children: '这个工作区还不是 Git 仓库。Agent 可以在需要版本管理时运行 git init。',
                  })
              : state.error !== undefined && state.snapshot === undefined
                ? jsxs('div', { className: 'dsh-fleet-git-error', children: [jsx('strong', { children: '无法读取仓库' }), jsx('span', { children: state.error })] })
                : jsxs('div', {
                    children: [
                      jsx(Section, {
                        title: '成员分支', count: members.length, defaultOpen: true,
                        children: members.map(actorRow),
                      }),
                      jsx(Section, {
                        title: '暂存的更改', count: staged.length,
                        children: staged.length === 0
                          ? jsx('div', { className: 'dsh-fleet-git-section-empty', children: '没有暂存的更改' })
                          : staged.map(change => jsx(ChangeRow, { root: statusRoot, teamId, path: change.path, code: change.index, staged: true }, `i:${change.path}`)),
                      }),
                      jsx(Section, {
                        title: '更改', count: working.length,
                        children: working.length === 0
                          ? jsx('div', { className: 'dsh-fleet-git-section-empty', children: '工作树是干净的' })
                          : working.map(change => jsx(ChangeRow, {
                              root: statusRoot, teamId, path: change.path, code: change.index === '?' ? '?' : change.worktree, staged: false,
                            }, `w:${change.path}`)),
                      }),
                      stashes.length > 0 && jsx(Section, {
                        title: '储藏', count: stashes.length, defaultOpen: true,
                        children: stashes.map(stash => jsxs('div', {
                          className: 'dsh-fleet-git-stash-row',
                          title: stash.subject,
                          children: [
                            jsx(Icon, { name: 'stash', size: 14 }),
                            jsx('code', { children: stash.ref }),
                            jsx('span', { children: stash.subject }),
                          ],
                        }, stash.ref)),
                      }),
                    ],
                  }),
          }),
        ],
      }),
    ],
  })
}

export interface GitGraphRow {
  readonly commit: FleetGitCommit
  readonly lane: number
  readonly color: number
  readonly before: readonly string[]
  readonly beforeColors: readonly number[]
  readonly after: readonly string[]
  readonly afterColors: readonly number[]
}

export interface GitGraphMemberPosition {
  readonly member: FleetMemberFace
  readonly branch: string
  readonly head: string
}

export function locateGitGraphMembers(
  snapshot: FleetGitSnapshot,
  members: readonly FleetMemberFace[],
): GitGraphMemberPosition[] {
  return members.flatMap(member => {
    const worktree = snapshot.status.worktrees.find(candidate => candidate.branch?.split('/').at(-1) === member.id)
      ?? snapshot.status.worktrees.find(candidate => fileName(candidate.path) === member.id)
    if (worktree?.branch !== undefined) return [{ member, branch: worktree.branch, head: worktree.head }]

    const branch = snapshot.branches.find(candidate => !candidate.remote && candidate.name.split('/').at(-1) === member.id)
    if (branch !== undefined) return [{ member, branch: branch.name, head: branch.head }]

    return snapshot.status.branch === undefined || snapshot.status.head === undefined
      ? []
      : [{ member, branch: snapshot.status.branch, head: snapshot.status.head }]
  })
}

export function filterGitBranchesByQuery(
  snapshot: FleetGitSnapshot,
  query: string,
  members: readonly FleetMemberFace[],
): readonly FleetGitBranch[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  if (tokens.length === 0) return snapshot.branches
  const commits = new Map(snapshot.commits.map(commit => [commit.hash, commit]))
  const positions = locateGitGraphMembers(snapshot, members)
  return snapshot.branches.filter(branch => {
    const commit = commits.get(branch.head)
    const worktrees = snapshot.status.worktrees.filter(worktree => worktree.branch === branch.name)
    const branchMembers = positions.filter(position => position.branch === branch.name).map(position => position.member)
    const metadata = [
      branch.name,
      branch.fullName,
      branch.head,
      branch.upstream,
      branch.current ? 'current 当前' : undefined,
      branch.remote ? 'remote 远程' : 'local 本地',
      commit?.subject,
      commit?.authorName,
      commit?.authorEmail,
      commit?.authoredAt,
      ...(commit?.decorations ?? []),
      ...worktrees.flatMap(worktree => [worktree.path, worktree.head, worktree.detached ? 'detached 分离' : undefined]),
      ...branchMembers.flatMap(member => [member.id, member.name, member.role, member.responsibility]),
    ].filter((value): value is string => value !== undefined).join('\n').toLocaleLowerCase()
    return tokens.every(token => metadata.includes(token))
  })
}

export interface GitCommitFileTreeNode {
  readonly name: string
  readonly path: string
  readonly children: readonly GitCommitFileTreeNode[]
  readonly file?: FleetGitCommitFile
}

export function buildCommitFileTree(files: readonly FleetGitCommitFile[]): readonly GitCommitFileTreeNode[] {
  interface MutableNode {
    name: string
    path: string
    children: MutableNode[]
    file?: FleetGitCommitFile
  }
  const roots: MutableNode[] = []
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let siblings = roots
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index] as string
      const path = parts.slice(0, index + 1).join('/')
      let node = siblings.find(candidate => candidate.name === name)
      if (node === undefined) {
        node = { name, path, children: [] }
        siblings.push(node)
      }
      if (index === parts.length - 1) node.file = file
      siblings = node.children
    }
  }
  const sort = (nodes: MutableNode[]): void => {
    nodes.sort((left, right) => {
      const leftFolder = left.file === undefined
      const rightFolder = right.file === undefined
      return leftFolder === rightFolder ? left.name.localeCompare(right.name) : leftFolder ? -1 : 1
    })
    nodes.forEach(node => { sort(node.children) })
  }
  sort(roots)
  return roots
}

export function layoutGitGraph(
  commits: readonly FleetGitCommit[],
): GitGraphRow[] {
  interface LaneState { readonly hash: string; readonly color: number }
  const lanes: LaneState[] = []
  let nextColor = 0
  const snapshotLanes = (): { readonly hashes: string[]; readonly colors: number[] } => {
    return {
      hashes: lanes.map(candidate => candidate.hash),
      colors: lanes.map(candidate => candidate.color),
    }
  }
  return commits.map(commit => {
    let lane = lanes.findIndex(candidate => candidate.hash === commit.hash)
    if (lane < 0) {
      lane = lanes.length
      lanes.push({ hash: commit.hash, color: nextColor })
      nextColor += 1
    }
    const before = snapshotLanes()
    const color = lanes[lane]?.color ?? 0
    if (commit.parents.length === 0) lanes.splice(lane, 1)
    else {
      const firstParent = commit.parents[0] as string
      const existingFirstParent = lanes.findIndex((candidate, index) => index !== lane && candidate.hash === firstParent)
      if (existingFirstParent >= 0) lanes.splice(lane, 1)
      else lanes[lane] = { hash: firstParent, color }
      for (let index = 1; index < commit.parents.length; index += 1) {
        const parent = commit.parents[index] as string
        if (lanes.some(candidate => candidate.hash === parent)) continue
        lanes.splice(Math.min(lane + index, lanes.length), 0, { hash: parent, color: nextColor })
        nextColor += 1
      }
    }
    const after = snapshotLanes()
    return {
      commit,
      lane,
      color,
      before: before.hashes,
      beforeColors: before.colors,
      after: after.hashes,
      afterColors: after.colors,
    }
  })
}

const LANE_COLORS = [
  '#4f78d3', '#b45f9b', '#318b78', '#b06d33', '#7b68c8', '#3e84a8',
  '#b34f5c', '#6f873d', '#8a6547', '#5a70a9', '#a45c38', '#547c68',
] as const

function GraphCanvas({ rows, width, laneCount, expandedRow, currentHead }: {
  readonly rows: readonly GitGraphRow[]
  readonly width: number
  readonly laneCount: number
  readonly expandedRow?: number
  readonly currentHead?: string
}): ReactElement {
  const expansionHeight = expandedRow === undefined ? 0 : COMMIT_DETAILS_HEIGHT + COMMIT_VIRTUAL_ROW_HEIGHT
  const laneStart = (width - (laneCount - 1) * GRAPH_LANE_WIDTH) / 2
  const x = (lane: number): number => lane * GRAPH_LANE_WIDTH + laneStart
  const y = (row: number): number => row * GRAPH_ROW_HEIGHT + GRAPH_ROW_MIDPOINT
    + (expandedRow !== undefined && row > expandedRow ? expansionHeight : 0)
  const segmentBetween = (fromLane: number, toLane: number, y1: number, y2: number): string => {
    const x1 = x(fromLane)
    const x2 = x(toLane)
    if (x1 === x2) return `M${String(x1)} ${String(y1)} L${String(x2)} ${String(y2)}`
    const curve = GRAPH_ROW_HEIGHT * 0.8
    return `M${String(x1)} ${String(y1)} C${String(x1)} ${String(y1 + curve)} ${String(x2)} ${String(y2 - curve)} ${String(x2)} ${String(y2)}`
  }
  const segment = (fromLane: number, toLane: number, row: number): string => {
    if (row !== expandedRow) return segmentBetween(fromLane, toLane, y(row), y(row + 1))
    const virtualY = y(row + 1) - COMMIT_VIRTUAL_ROW_HEIGHT
    return `${segmentBetween(fromLane, fromLane, y(row), virtualY)} ${segmentBetween(fromLane, toLane, virtualY, y(row + 1))}`
  }
  const connections: ReactNode[] = []
  rows.slice(0, -1).forEach((row, rowIndex) => {
    row.before.forEach((hash, lane) => {
      if (hash === '' || lane === row.lane) return
      const target = row.after.indexOf(hash)
      if (target >= 0) connections.push(jsx('path', {
        d: segment(lane, target, rowIndex),
        stroke: LANE_COLORS[(row.beforeColors[lane] ?? 0) % LANE_COLORS.length],
      }, `carry:${String(rowIndex)}:${hash}`))
    })
    row.commit.parents.forEach((parent, parentIndex) => {
      const target = row.after.indexOf(parent)
      if (target >= 0) connections.push(jsx('path', {
        d: segment(row.lane, target, rowIndex),
        stroke: LANE_COLORS[(parentIndex === 0 ? row.color : (row.afterColors[target] ?? row.color)) % LANE_COLORS.length],
      }, `parent:${String(rowIndex)}:${parent}`))
    })
  })
  return jsxs('svg', {
    className: 'dsh-fleet-git-graph-canvas',
    width,
    height: rows.length * GRAPH_ROW_HEIGHT + expansionHeight,
    viewBox: `0 0 ${String(width)} ${String(rows.length * GRAPH_ROW_HEIGHT + expansionHeight)}`,
    'aria-hidden': 'true',
    children: [
      ...connections,
      ...rows.map((row, rowIndex) => {
        const color = LANE_COLORS[row.color % LANE_COLORS.length]
        const current = row.commit.hash === currentHead
        return jsx('circle', {
          cx: x(row.lane), cy: y(rowIndex), r: current ? 3.6 : 4.2,
          fill: current ? 'var(--dsw-alias-bg-layer-1)' : color,
          stroke: current ? color : 'var(--dsw-alias-bg-layer-1)',
          strokeWidth: current ? 2.2 : 1.2,
          'data-current': current ? 'true' : undefined,
        }, row.commit.hash)
      }),
    ],
  })
}

function relativeTime(value: string): string {
  const milliseconds = new Date(value).getTime()
  if (!Number.isFinite(milliseconds)) return value
  const seconds = Math.round((milliseconds - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 30) return formatter.format(days, 'day')
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(milliseconds))
}

const STANDARD_DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function standardDateTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? STANDARD_DATE_TIME.format(date) : value
}

function branchForRef(ref: string, branches: readonly FleetGitBranch[]): FleetGitBranch | undefined {
  return branches.find(branch => branch.name === ref)
}

export function gitRefKind(
  ref: string,
  branches: readonly FleetGitBranch[],
): 'head' | 'tag' | 'remote' | 'branch' | 'stash' {
  if (ref.startsWith('tag: ')) return 'tag'
  if (/^stash@\{\d+\}$/.test(ref)) return 'stash'
  if (ref === 'HEAD') return 'head'
  if (branchForRef(ref, branches)?.remote === true) return 'remote'
  return 'branch'
}

function reachableCommitHashes(
  commits: readonly FleetGitCommit[],
  heads: readonly string[],
): ReadonlySet<string> {
  const commitsByHash = new Map(commits.map(commit => [commit.hash, commit] as const))
  const reachable = new Set<string>()
  const pending = [...heads]
  while (pending.length > 0) {
    const hash = pending.pop() as string
    if (reachable.has(hash)) continue
    reachable.add(hash)
    const commit = commitsByHash.get(hash)
    if (commit !== undefined) pending.push(...commit.parents)
  }
  return reachable
}

export function filterGitGraphCommits(
  snapshot: FleetGitSnapshot,
  selectedBranches: ReadonlySet<string> | null,
  showRemoteBranches: boolean,
): readonly FleetGitCommit[] {
  if (selectedBranches === null && showRemoteBranches) return snapshot.commits
  const branches = snapshot.branches.filter(branch => (
    (showRemoteBranches || !branch.remote)
    && (selectedBranches === null || selectedBranches.has(branch.name))
  ))
  const reachable = reachableCommitHashes(snapshot.commits, [
    ...branches.map(branch => branch.head),
    ...(snapshot.stashes ?? []).map(stash => stash.hash),
  ])
  return snapshot.commits.filter(commit => reachable.has(commit.hash))
}

function visibleDecorations(
  commit: FleetGitCommit,
  branches: readonly FleetGitBranch[],
  selectedBranches: ReadonlySet<string> | null,
  showRemoteBranches: boolean,
): readonly string[] {
  const visible = commit.decorations.filter(decoration => {
    const branch = branchForRef(decoration, branches)
    if (branch === undefined) return true
    if (branch.remote && !showRemoteBranches) return false
    return selectedBranches === null || selectedBranches.has(branch.name)
  })
  return visible.filter(decoration => {
    const branch = branchForRef(decoration, branches)
    if (branch?.remote !== true) return true
    return !branches.some(local => (
      !local.remote
      && local.upstream === branch.name
      && local.head === branch.head
      && visible.includes(local.name)
    ))
  })
}

function synchronizedRemoteFor(
  branch: FleetGitBranch | undefined,
  branches: readonly FleetGitBranch[],
  selectedBranches: ReadonlySet<string> | null,
  showRemoteBranches: boolean,
): FleetGitBranch | undefined {
  if (branch === undefined || branch.remote || branch.upstream === undefined || !showRemoteBranches) return undefined
  const remote = branchForRef(branch.upstream, branches)
  if (remote?.remote !== true || remote.head !== branch.head) return undefined
  return selectedBranches === null || selectedBranches.has(remote.name) ? remote : undefined
}

function memberInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?'
}

function RefMembers({ members, emphasizedMemberId }: {
  readonly members: readonly FleetMemberFace[]
  readonly emphasizedMemberId?: string
}): ReactElement {
  const names = members.map(member => member.name).join('、')
  return jsx('span', {
    className: 'dsh-fleet-git-ref-members',
    title: names,
    'aria-label': `位于此分支：${names}`,
    children: members.map(member => jsx('span', {
      className: 'dsh-fleet-git-ref-member',
      'data-emphasized': member.id === emphasizedMemberId ? 'true' : undefined,
      style: { background: member.color },
      title: member.name,
      children: memberInitial(member.name),
    }, member.id)),
  })
}

interface CommitDetailsState {
  readonly hash: string
  readonly loading: boolean
  readonly details?: FleetGitCommitDetails
  readonly error?: string
}

function ColumnResizeHandle({ label, width, min, max, side = 'right', onChange, onResizeStart, onResizeEnd }: {
  readonly label: string
  readonly width: number
  readonly min: number
  readonly max: number
  readonly side?: 'left' | 'right'
  readonly onChange: (width: number, delta: number) => void
  readonly onResizeStart?: () => void
  readonly onResizeEnd?: () => void
}): ReactElement {
  const drag = useRef<{ readonly pointerId: number; readonly startX: number; readonly startWidth: number }>()
  const direction = side === 'left' ? -1 : 1
  const resize = (value: number, origin: number): void => {
    const next = Math.max(min, Math.min(max, value))
    onChange(next, next - origin)
  }
  const stop = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = undefined
    event.currentTarget.releasePointerCapture(event.pointerId)
    onResizeEnd?.()
  }
  return jsx('span', {
    className: 'dsh-fleet-git-column-resizer',
    'data-side': side,
    role: 'separator',
    tabIndex: 0,
    'aria-label': label,
    'aria-orientation': 'vertical',
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': width,
    onPointerDown: (event: ReactPointerEvent<HTMLSpanElement>) => {
      event.preventDefault()
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
      onResizeStart?.()
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: ReactPointerEvent<HTMLSpanElement>) => {
      const current = drag.current
      if (current?.pointerId === event.pointerId) resize(current.startWidth + direction * (event.clientX - current.startX), current.startWidth)
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onKeyDown: (event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      resize(width + direction * (event.key === 'ArrowRight' ? 8 : -8), width)
    },
  })
}

function CommitFileNodes({ nodes }: { readonly nodes: readonly GitCommitFileTreeNode[] }): ReactElement {
  return jsx('ul', {
    className: 'dsh-fleet-git-commit-file-tree',
    children: nodes.map(node => node.file === undefined
      ? jsx('li', {
          children: jsxs('details', {
            open: true,
            children: [
              jsxs('summary', {
                title: node.path,
                children: [jsx(Icon, { name: 'chevron', size: 11 }), jsx('span', { children: node.name })],
              }),
              jsx(CommitFileNodes, { nodes: node.children }),
            ],
          }),
        }, node.path)
      : jsxs('li', {
          className: 'dsh-fleet-git-commit-file',
          title: node.file.oldPath === undefined ? node.file.path : `${node.file.oldPath} → ${node.file.path}`,
          children: [
            jsx('span', { className: 'dsh-fleet-git-commit-file-status', 'data-status': node.file.status, children: node.file.status }),
            jsx('span', { className: 'dsh-fleet-git-commit-file-name', children: node.name }),
            node.file.binary
              ? jsx('span', { className: 'dsh-fleet-git-commit-file-binary', children: '二进制' })
              : jsxs('span', {
                  className: 'dsh-fleet-git-commit-file-stats',
                  children: [
                    jsx('span', { className: 'dsh-fleet-git-additions', children: `+${String(node.file.additions ?? 0)}` }),
                    jsx('span', { className: 'dsh-fleet-git-deletions', children: `−${String(node.file.deletions ?? 0)}` }),
                  ],
                }),
          ],
        }, node.path)),
  })
}

function CommitDetailsPanel({ state }: { readonly state: CommitDetailsState }): ReactElement {
  if (state.loading) return jsx('div', {
    className: 'dsh-fleet-git-commit-details-row',
    id: `dsh-fleet-git-commit-${state.hash}`,
    children: jsx('div', { className: 'dsh-fleet-git-commit-details-loading', children: '正在读取提交详情…' }),
  })
  if (state.error !== undefined || state.details === undefined) return jsx('div', {
    className: 'dsh-fleet-git-commit-details-row',
    id: `dsh-fleet-git-commit-${state.hash}`,
    children: jsx('div', { className: 'dsh-fleet-git-commit-details-loading dsh-fleet-git-commit-details-error', children: state.error ?? '提交详情不可用' }),
  })
  const details = state.details
  const additions = details.files.reduce((total, file) => total + (file.additions ?? 0), 0)
  const deletions = details.files.reduce((total, file) => total + (file.deletions ?? 0), 0)
  const author = details.authorEmail.length === 0 ? details.authorName : `${details.authorName} <${details.authorEmail}>`
  const committer = details.committerEmail.length === 0 ? details.committerName : `${details.committerName} <${details.committerEmail}>`
  return jsx('div', {
    className: 'dsh-fleet-git-commit-details-row',
    id: `dsh-fleet-git-commit-${details.hash}`,
    children: jsxs('div', {
      className: 'dsh-fleet-git-commit-details',
      children: [
        jsxs('section', {
          className: 'dsh-fleet-git-commit-summary',
          'aria-label': '提交详情',
          children: [
            jsx('h3', { children: details.subject }),
            jsxs('dl', {
              children: [
                jsx('dt', { children: '提交' }),
                jsx('dd', { children: jsx('code', { title: details.hash, children: details.hash }) }),
                jsx('dt', { children: '父提交' }),
                jsx('dd', { children: details.parents.length === 0 ? '无' : details.parents.map(parent => parent.slice(0, 10)).join(', ') }),
                jsx('dt', { children: '作者' }),
                jsx('dd', { title: author, children: author }),
                jsx('dt', { children: '作者时间' }),
                jsx('dd', { children: new Date(details.authoredAt).toLocaleString() }),
                jsx('dt', { children: '提交者' }),
                jsx('dd', { title: committer, children: committer }),
                jsx('dt', { children: '提交时间' }),
                jsx('dd', { children: new Date(details.committedAt).toLocaleString() }),
              ],
            }),
            jsxs('div', {
              className: 'dsh-fleet-git-commit-description',
              children: [
                jsx('strong', { children: '描述' }),
                jsx('p', { 'data-empty': details.body.length === 0 ? 'true' : undefined, children: details.body || '无附加描述' }),
              ],
            }),
          ],
        }),
        jsxs('section', {
          className: 'dsh-fleet-git-commit-files',
          'aria-label': '提交文件',
          children: [
            jsxs('header', {
              children: [
                jsx('strong', { children: `${String(details.files.length)} 个文件` }),
                jsxs('span', {
                  children: [
                    jsx('span', { className: 'dsh-fleet-git-additions', children: `+${String(additions)}` }),
                    jsx('span', { className: 'dsh-fleet-git-deletions', children: `−${String(deletions)}` }),
                  ],
                }),
              ],
            }),
            details.files.length === 0
              ? jsx('div', { className: 'dsh-fleet-git-commit-files-empty', children: '这个提交没有文件变更。' })
              : jsx(CommitFileNodes, { nodes: buildCommitFileTree(details.files) }),
          ],
        }),
      ],
    }),
  })
}

function GraphView({ root, snapshot, members, selectedBranches, showRemoteBranches, emphasizedMemberId, searchMatchedCommitHashes }: {
  readonly root: string
  readonly snapshot: FleetGitSnapshot
  readonly members: readonly FleetMemberFace[]
  readonly selectedBranches: ReadonlySet<string> | null
  readonly showRemoteBranches: boolean
  readonly emphasizedMemberId?: string
  readonly searchMatchedCommitHashes?: ReadonlySet<string>
}): ReactElement {
  const [detailsState, setDetailsState] = useState<CommitDetailsState>()
  const [columnWidths, setColumnWidths] = useState({ author: 150, date: 136, hash: 72 })
  const [dateMode, setDateMode] = useState<'relative' | 'standard'>('relative')
  const [authorMode, setAuthorMode] = useState<'git' | 'fleet'>('git')
  const [copiedHash, setCopiedHash] = useState<string>()
  const [tableWidth, setTableWidth] = useState<number>()
  const table = useRef<HTMLDivElement>(null)
  const resizeStartWidth = useRef<number>()
  const copyResetTimer = useRef<number>()
  const detailsRequest = useRef(0)
  const visibleCommits = useMemo(
    () => filterGitGraphCommits(snapshot, selectedBranches, showRemoteBranches),
    [snapshot, selectedBranches, showRemoteBranches],
  )
  const memberPositions = useMemo(() => locateGitGraphMembers(snapshot, members), [snapshot, members])
  const membersById = useMemo(() => new Map(members.map(member => [member.id, member])), [members])
  const rows = useMemo(() => layoutGitGraph(visibleCommits), [visibleCommits])
  const laneCount = useMemo(() => Math.max(1, ...rows.map(row => Math.max(row.before.length, row.after.length))), [rows])
  const graphWidth = Math.max(44, laneCount * GRAPH_LANE_WIDTH + 12)
  const graphStyle = {
    '--dsh-fleet-git-graph-width': `${String(graphWidth)}px`,
    '--dsh-fleet-git-author-width': `${String(columnWidths.author)}px`,
    '--dsh-fleet-git-date-width': `${String(columnWidths.date)}px`,
    '--dsh-fleet-git-hash-width': `${String(columnWidths.hash)}px`,
    minWidth: graphWidth + 280 + columnWidths.author + columnWidths.date + columnWidths.hash,
    ...(tableWidth === undefined ? {} : { width: tableWidth }),
  } as CSSProperties
  const expandedRow = detailsState === undefined ? -1 : rows.findIndex(row => row.commit.hash === detailsState.hash)
  useEffect(() => {
    detailsRequest.current += 1
    setDetailsState(undefined)
    return () => {
      detailsRequest.current += 1
      if (copyResetTimer.current !== undefined) window.clearTimeout(copyResetTimer.current)
    }
  }, [root])
  const copyCommitHash = async (hash: string): Promise<void> => {
    await navigator.clipboard.writeText(hash)
    setCopiedHash(hash)
    if (copyResetTimer.current !== undefined) window.clearTimeout(copyResetTimer.current)
    copyResetTimer.current = window.setTimeout(() => {
      setCopiedHash(current => current === hash ? undefined : current)
    }, 1_200)
  }
  const toggleDetails = (hash: string): void => {
    if (detailsState?.hash === hash) {
      detailsRequest.current += 1
      setDetailsState(undefined)
      return
    }
    const request = ++detailsRequest.current
    setDetailsState({ hash, loading: true })
    void (async () => {
      try {
        if (webClient === undefined) throw new Error('Git Remote 尚未连接')
        const details = unwrap(await webClient.commit({ root, hash }))
        if (detailsRequest.current === request) setDetailsState({ hash, loading: false, details })
      } catch (error) {
        if (detailsRequest.current === request) setDetailsState({
          hash,
          loading: false,
          error: error instanceof Error ? error.message : '提交详情读取失败',
        })
      }
    })()
  }
  return jsx('div', {
    className: 'dsh-fleet-git-graph-scroll',
    children: rows.length === 0
      ? jsx('div', { className: 'dsh-fleet-git-empty', children: '仓库还没有提交记录。' })
      : jsxs('div', {
          className: 'dsh-fleet-git-graph-table',
          ref: table,
          style: graphStyle,
          children: [
            jsxs('div', {
              className: 'dsh-fleet-git-graph-header',
              role: 'row',
              children: [
                jsx('span', { children: '图谱' }),
                jsx('span', { children: '描述' }),
                jsxs('span', {
                  className: 'dsh-fleet-git-resizable-header',
                  children: [
                    jsx(ColumnResizeHandle, {
                      label: '调整描述与日期列分界', width: columnWidths.date, min: 112, max: 240, side: 'left',
                      onResizeStart: () => { setTableWidth(table.current?.getBoundingClientRect().width) },
                      onChange: (date: number) => { setColumnWidths(current => ({ ...current, date })) },
                    }),
                    jsx('button', {
                      type: 'button',
                      className: 'dsh-fleet-git-header-toggle',
                      title: dateMode === 'relative' ? '切换为标准日期和时间' : '切换为相对时间',
                      'aria-label': dateMode === 'relative' ? '日期：当前显示相对时间，切换为标准日期和时间' : '日期：当前显示标准日期和时间，切换为相对时间',
                      'aria-pressed': dateMode === 'standard',
                      onClick: () => { setDateMode(current => current === 'relative' ? 'standard' : 'relative') },
                      children: '日期',
                    }),
                    jsx(ColumnResizeHandle, {
                      label: '调整日期列宽', width: columnWidths.date, min: 112, max: 240,
                      onResizeStart: () => { resizeStartWidth.current = table.current?.getBoundingClientRect().width },
                      onResizeEnd: () => { resizeStartWidth.current = undefined },
                      onChange: (date: number, delta: number) => {
                        setColumnWidths(current => ({ ...current, date }))
                        setTableWidth(current => (resizeStartWidth.current ?? current ?? table.current?.getBoundingClientRect().width ?? 760) + delta)
                      },
                    }),
                  ],
                }),
                jsxs('span', {
                  className: 'dsh-fleet-git-resizable-header',
                  children: [
                    jsx('button', {
                      type: 'button',
                      className: 'dsh-fleet-git-header-toggle',
                      title: authorMode === 'git' ? '显示可识别的 Fleet 成员姓名与角色' : '显示 Git 作者',
                      'aria-label': authorMode === 'git' ? '作者：当前显示 Git 作者，切换为 Fleet 成员' : '作者：当前显示 Fleet 成员，切换为 Git 作者',
                      'aria-pressed': authorMode === 'fleet',
                      onClick: () => { setAuthorMode(current => current === 'git' ? 'fleet' : 'git') },
                      children: '作者',
                    }),
                    jsx(ColumnResizeHandle, {
                      label: '调整作者列宽', width: columnWidths.author, min: 110, max: 320,
                      onResizeStart: () => { resizeStartWidth.current = table.current?.getBoundingClientRect().width },
                      onResizeEnd: () => { resizeStartWidth.current = undefined },
                      onChange: (author: number, delta: number) => {
                        setColumnWidths(current => ({ ...current, author }))
                        setTableWidth(current => (resizeStartWidth.current ?? current ?? table.current?.getBoundingClientRect().width ?? 760) + delta)
                      },
                    }),
                  ],
                }),
                jsxs('span', {
                  className: 'dsh-fleet-git-resizable-header',
                  children: [
                    jsx('span', { children: '提交' }),
                    jsx(ColumnResizeHandle, {
                      label: '调整提交列宽', width: columnWidths.hash, min: 64, max: 180,
                      onResizeStart: () => { resizeStartWidth.current = table.current?.getBoundingClientRect().width },
                      onResizeEnd: () => { resizeStartWidth.current = undefined },
                      onChange: (hash: number, delta: number) => {
                        setColumnWidths(current => ({ ...current, hash }))
                        setTableWidth(current => (resizeStartWidth.current ?? current ?? table.current?.getBoundingClientRect().width ?? 760) + delta)
                      },
                    }),
                  ],
                }),
              ],
            }),
            jsx(GraphCanvas, {
              rows,
              width: graphWidth,
              laneCount,
              expandedRow: expandedRow < 0 ? undefined : expandedRow,
              currentHead: snapshot.status.head,
            }),
            ...rows.flatMap((row, rowIndex) => {
              const expanded = rowIndex === expandedRow
              const decorations = visibleDecorations(row.commit, snapshot.branches, selectedBranches, showRemoteBranches)
              const attributedMember = membersById.get(snapshot.attributions?.[row.commit.hash] ?? '')
              const commitRow = jsxs('div', {
                className: 'dsh-fleet-git-commit-row',
                role: 'button',
                tabIndex: 0,
                'aria-expanded': expanded ? 'true' : 'false',
                'aria-controls': expanded ? `dsh-fleet-git-commit-${row.commit.hash}` : undefined,
                onClick: () => { toggleDetails(row.commit.hash) },
                onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggleDetails(row.commit.hash)
                  }
                },
                children: [
                jsx('span', { className: 'dsh-fleet-git-graph-cell', 'aria-hidden': 'true' }),
                jsxs('div', {
                  className: 'dsh-fleet-git-commit-copy',
                  title: row.commit.subject,
                  children: [
                    decorations.length > 0 && jsx('span', {
                      className: 'dsh-fleet-git-refs',
                      children: decorations.slice(0, 5).map(decoration => {
                        const branch = branchForRef(decoration, snapshot.branches)
                        const kind = gitRefKind(decoration, snapshot.branches)
                        const synchronizedRemote = synchronizedRemoteFor(branch, snapshot.branches, selectedBranches, showRemoteBranches)
                        const refMembers = memberPositions
                          .filter(position => position.branch === decoration && position.head === row.commit.hash)
                          .map(position => position.member)
                        return jsxs('span', {
                          className: 'dsh-fleet-git-ref',
                          'data-kind': kind,
                          'data-synchronized': synchronizedRemote === undefined ? undefined : 'true',
                          'data-member-emphasized': refMembers.some(member => member.id === emphasizedMemberId) ? 'true' : undefined,
                          title: branch === undefined
                            ? decoration
                            : synchronizedRemote === undefined
                              ? `${branch.remote ? '远程分支' : '本地分支'} · ${decoration}`
                              : `本地与远程同步 · ${decoration} ↔ ${synchronizedRemote.name}`,
                          children: [
                            kind === 'stash'
                              ? jsx(Icon, { name: 'stash', size: 11 })
                              : kind !== 'tag' && jsx(Icon, { name: 'branch', size: 11 }),
                            jsx('span', { className: 'dsh-fleet-git-ref-name', children: decoration.replace(/^tag: /, '') }),
                            refMembers.length > 0 && jsx(RefMembers, { members: refMembers, emphasizedMemberId }),
                          ],
                        }, decoration)
                      }),
                    }),
                    jsx('span', {
                      className: 'dsh-fleet-git-commit-subject',
                      'data-muted': (emphasizedMemberId !== undefined && attributedMember?.id !== emphasizedMemberId)
                        || (searchMatchedCommitHashes !== undefined && !searchMatchedCommitHashes.has(row.commit.hash))
                        ? 'true'
                        : undefined,
                      children: row.commit.subject,
                    }),
                  ],
                }),
                jsx('time', {
                  className: 'dsh-fleet-git-commit-time', dateTime: row.commit.authoredAt,
                  title: standardDateTime(row.commit.authoredAt),
                  children: dateMode === 'relative' ? relativeTime(row.commit.authoredAt) : standardDateTime(row.commit.authoredAt),
                }),
                authorMode === 'fleet' && attributedMember !== undefined
                  ? jsxs('span', {
                      className: 'dsh-fleet-git-commit-author',
                      'data-fleet-member': 'true',
                      title: `${attributedMember.name} · ${attributedMember.role}\nGit 作者：${row.commit.authorName}${row.commit.authorEmail.length === 0 ? '' : ` <${row.commit.authorEmail}>`}`,
                      children: [
                        jsx('strong', { children: attributedMember.name }),
                        jsx('small', { children: attributedMember.role }),
                      ],
                    })
                  : jsx('span', { className: 'dsh-fleet-git-commit-author', title: row.commit.authorEmail, children: row.commit.authorName }),
                jsxs('span', {
                  className: 'dsh-fleet-git-commit-hash-cell',
                  children: [
                    jsx('button', {
                      type: 'button',
                      className: 'dsh-fleet-git-commit-hash-button',
                      'data-copied': copiedHash === row.commit.hash ? 'true' : undefined,
                      title: `复制完整提交 ${row.commit.hash}`,
                      'aria-label': `复制完整提交 ${row.commit.hash}`,
                      onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                        event.stopPropagation()
                        void copyCommitHash(row.commit.hash)
                      },
                      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => { event.stopPropagation() },
                      children: jsx('code', {
                        className: 'dsh-fleet-git-commit-hash',
                        children: copiedHash === row.commit.hash ? '已复制' : row.commit.hash.slice(0, SHORT_COMMIT_LENGTH),
                      }),
                    }),
                  ],
                }),
              ],
              }, row.commit.hash)
              return expanded && detailsState !== undefined
                ? [
                    commitRow,
                    jsx(CommitDetailsPanel, { state: detailsState }, `details:${row.commit.hash}`),
                    jsx('div', {
                      className: 'dsh-fleet-git-virtual-row',
                      'aria-hidden': 'true',
                      children: jsx('span', { className: 'dsh-fleet-git-graph-cell' }),
                    }, `virtual:${row.commit.hash}`),
                  ]
                : [commitRow]
            }),
          ],
        }),
  })
}

function DiffContent({ text }: { readonly text: string }): ReactElement {
  const services = useDiffServices()
  const rendered = useMemo(() => {
    if (services === undefined || text.length === 0) return undefined
    try {
      return services.diffRenderer.render(services.diffEngine.diff({ kind: 'patch', patch: text })).html
    } catch {
      return undefined
    }
  }, [services, text])
  return rendered === undefined
    ? jsx('pre', { className: 'dsh-fleet-git-diff', children: text })
    : jsx('div', { className: 'dsh-fleet-git-rendered-diff', dangerouslySetInnerHTML: { __html: rendered } })
}

function DiffView({ root, teamId, state }: { readonly root: string; readonly teamId: string; readonly state: GitViewState }): ReactElement {
  const selection = state.selection as DiffSelection
  return jsxs('div', {
    className: 'dsh-fleet-git-diff-view',
    children: [
      jsxs('div', {
        className: 'dsh-fleet-git-main-head',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-git-main-title',
            children: [jsx('strong', { children: fileName(selection.path) }), jsx('span', { children: `${selection.staged ? '暂存的更改' : '工作树更改'} · ${selection.path}` })],
          }),
          jsx('button', {
            type: 'button', className: 'dsh-fleet-git-icon-button', 'aria-label': '关闭 Diff', title: '返回 Git Graph',
            onClick: () => { closeDiff(root, teamId) }, children: jsx(Icon, { name: 'close', size: 16 }),
          }),
        ],
      }),
      state.diffLoading
        ? jsx('div', { className: 'dsh-fleet-git-empty', children: '正在读取 Diff…' })
        : state.diffError !== undefined
          ? jsx('div', { className: 'dsh-fleet-git-error', children: state.diffError })
          : jsxs('div', {
              className: 'dsh-fleet-git-diff-scroll',
              children: [
                state.diff?.text.length === 0
                  ? jsx('div', { className: 'dsh-fleet-git-empty', children: '这个文件没有可显示的文本 Diff。' })
                  : jsx(DiffContent, { text: state.diff?.text ?? '' }),
                state.diff?.truncated === true && jsx('div', { className: 'dsh-fleet-git-truncated', children: 'Diff 较大，仅显示前 512 KiB。' }),
              ],
            }),
    ],
  })
}

function BranchSearch({ value, matchCount, onChange }: {
  readonly value: string
  readonly matchCount: number
  readonly onChange: (value: string) => void
}): ReactElement {
  const label = localizedLabel('搜索分支名称和元数据；不匹配的提交将被弱化', 'Search branch names and metadata; non-matching commits are dimmed')
  return jsxs('label', {
    className: 'dsh-fleet-git-branch-search',
    title: label,
    children: [
      jsx(Icon, { name: 'search', size: 14 }),
      jsx('input', {
        type: 'search',
        value,
        placeholder: localizedLabel('搜索分支', 'Search branches'),
        'aria-label': label,
        'aria-description': localizedLabel(
          '可搜索分支名、提交、作者、远端、工作树和成员等元数据；图谱结构会完整保留',
          'Search branch names, commits, authors, remotes, worktrees, members, and other metadata while preserving the full graph',
        ),
        onChange: (event: ChangeEvent<HTMLInputElement>) => { onChange(event.currentTarget.value) },
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Escape' && value !== '') {
            event.preventDefault()
            onChange('')
          }
        },
      }),
      value !== '' && jsx('button', {
        type: 'button',
        className: 'dsh-fleet-git-branch-search-clear',
        title: localizedLabel(`清除搜索（${String(matchCount)} 个匹配分支）`, `Clear search (${String(matchCount)} matching branches)`),
        'aria-label': localizedLabel('清除分支搜索', 'Clear branch search'),
        onClick: () => { onChange('') },
        children: jsx(Icon, { name: 'close', size: 12 }),
      }),
    ],
  })
}

function BranchFilter({ branches, selectedBranches, showRemoteBranches, onSelectionChange, onRemoteVisibilityChange }: {
  readonly branches: readonly FleetGitBranch[]
  readonly selectedBranches: ReadonlySet<string> | null
  readonly showRemoteBranches: boolean
  readonly onSelectionChange: (branches: ReadonlySet<string> | null) => void
  readonly onRemoteVisibilityChange: (visible: boolean) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const localBranches = branches.filter(branch => !branch.remote)
  const remoteBranches = branches.filter(branch => branch.remote)
  const visibleBranches = branches.filter(branch => showRemoteBranches || !branch.remote)
  const selectedCount = selectedBranches === null
    ? visibleBranches.length
    : visibleBranches.filter(branch => selectedBranches.has(branch.name)).length

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && container.current?.contains(event.target) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    return () => { document.removeEventListener('pointerdown', closeOnOutside) }
  }, [open])

  const toggleBranch = (name: string): void => {
    const next = new Set(selectedBranches ?? visibleBranches.map(branch => branch.name))
    if (next.has(name)) next.delete(name)
    else next.add(name)
    const allVisibleSelected = visibleBranches.every(branch => next.has(branch.name))
    onSelectionChange(allVisibleSelected ? null : next)
  }

  const branchRow = (branch: FleetGitBranch): ReactElement => {
    const checked = selectedBranches === null || selectedBranches.has(branch.name)
    return jsxs('button', {
      type: 'button',
      className: 'dsh-fleet-git-branch-option',
      role: 'menuitemcheckbox',
      'aria-checked': checked ? 'true' : 'false',
      onClick: () => { toggleBranch(branch.name) },
      children: [
        jsx('span', { className: 'dsh-fleet-git-menu-check', children: checked && jsx(Icon, { name: 'check', size: 14 }) }),
        jsx(Icon, { name: 'branch', size: 14 }),
        jsx('span', { className: 'dsh-fleet-git-branch-option-name', children: branch.name }),
        jsx('span', {
          className: 'dsh-fleet-git-branch-option-origin',
          children: branch.remote ? '远程' : branch.current ? '本地 · 当前' : '本地',
        }),
      ],
    }, branch.fullName)
  }

  const label = selectedBranches === null
    ? showRemoteBranches ? '全部分支' : '本地分支'
    : `${String(selectedCount)} 个分支`
  return jsxs('div', {
    ref: container,
    className: 'dsh-fleet-git-branch-filter',
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        setOpen(false)
        event.stopPropagation()
      }
    },
    children: [
      jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-git-branch-filter-trigger',
        'aria-haspopup': 'menu',
        'aria-expanded': open ? 'true' : 'false',
        title: '选择 Git Graph 中显示的分支',
        onClick: () => { setOpen(value => !value) },
        children: [jsx(Icon, { name: 'branch', size: 15 }), jsx('span', { children: label }), jsx(Icon, { name: 'chevron', size: 12 })],
      }),
      open && jsxs('div', {
        className: 'dsh-fleet-git-branch-menu',
        role: 'menu',
        'aria-label': '显示的分支',
        children: [
          jsxs('button', {
            type: 'button',
            className: 'dsh-fleet-git-branch-option dsh-fleet-git-branch-option-all',
            role: 'menuitemradio',
            'aria-checked': selectedBranches === null ? 'true' : 'false',
            onClick: () => { onSelectionChange(null) },
            children: [
              jsx('span', { className: 'dsh-fleet-git-menu-check', children: selectedBranches === null && jsx(Icon, { name: 'check', size: 14 }) }),
              jsx('span', { className: 'dsh-fleet-git-branch-option-name', children: '显示全部分支' }),
            ],
          }),
          jsxs('button', {
            type: 'button',
            className: 'dsh-fleet-git-remote-toggle',
            role: 'menuitemcheckbox',
            'aria-checked': showRemoteBranches ? 'true' : 'false',
            onClick: () => { onRemoteVisibilityChange(!showRemoteBranches) },
            children: [
              jsx('span', { className: 'dsh-fleet-git-menu-check', children: showRemoteBranches && jsx(Icon, { name: 'check', size: 14 }) }),
              jsx('span', { children: '显示远程分支' }),
              jsx('span', { className: 'dsh-fleet-git-remote-count', children: remoteBranches.length }),
            ],
          }),
          localBranches.length > 0 && jsx('div', { className: 'dsh-fleet-git-branch-group-label', children: '本地分支' }),
          ...localBranches.map(branchRow),
          showRemoteBranches && remoteBranches.length > 0 && jsx('div', { className: 'dsh-fleet-git-branch-group-label', children: '远程分支' }),
          ...(showRemoteBranches ? remoteBranches.map(branchRow) : []),
        ],
      }),
    ],
  })
}

function GitMain(owner: FleetPaneOwner): ReactElement {
  const root = repositoryRoot(owner)
  const teamId = owner.snapshot.teamId
  const state = useGitState(root, teamId)
  const [showRemoteBranches, setShowRemoteBranches] = useState(true)
  const [selectedBranches, setSelectedBranches] = useState<ReadonlySet<string> | null>(null)
  const [branchQuery, setBranchQuery] = useState('')
  const [fetching, setFetching] = useState(false)
  const members = useMemo(
    () => [...owner.snapshot.members, ...(owner.snapshot.assistants ?? [])],
    [owner.snapshot.assistants, owner.snapshot.members],
  )
  const emphasizedMemberId = useMemberEmphasis(teamId)
  useGitRefresh(root, teamId)
  useEffect(() => {
    setShowRemoteBranches(true)
    setSelectedBranches(null)
    setBranchQuery('')
  }, [root])
  const matchingBranches = useMemo(
    () => state.snapshot === undefined ? [] : filterGitBranchesByQuery(state.snapshot, branchQuery, members),
    [branchQuery, members, state.snapshot],
  )
  const visibleMatchingBranches = useMemo(
    () => matchingBranches.filter(branch => showRemoteBranches || !branch.remote),
    [matchingBranches, showRemoteBranches],
  )
  const searchMatchedCommitHashes = useMemo<ReadonlySet<string> | undefined>(() => {
    if (branchQuery.trim() === '' || state.snapshot === undefined) return undefined
    return reachableCommitHashes(state.snapshot.commits, visibleMatchingBranches.map(branch => branch.head))
  }, [branchQuery, state.snapshot, visibleMatchingBranches])
  const visibleCommitCount = useMemo(() => state.snapshot === undefined
    ? 0
    : filterGitGraphCommits(state.snapshot, selectedBranches, showRemoteBranches).length,
  [selectedBranches, showRemoteBranches, state.snapshot])
  const fetchFromRemote = async (): Promise<void> => {
    if (root === undefined) return
    setFetching(true)
    try {
      if (webClient === undefined) throw new Error('Git Remote 尚未连接')
      const snapshot = unwrap(await webClient.fetch({ root, teamId }))
      const { error: _error, notRepository: _notRepository, ...current } = stateFor(root, teamId)
      publish(root, teamId, { ...current, snapshot, loading: false })
    } catch (error) {
      publish(root, teamId, {
        ...stateFor(root, teamId),
        error: error instanceof Error ? error.message : '从远端获取失败',
      })
    } finally {
      setFetching(false)
    }
  }
  if (root === undefined) return jsx('div', { className: 'dsh-fleet-git-main-empty', children: '挂载 Git 工作区后，这里会显示提交图谱。' })
  if (state.selection !== undefined) return jsx(DiffView, { root, teamId, state })
  return jsxs('div', {
    className: 'dsh-fleet-git-main',
    children: [
      jsxs('div', {
        className: 'dsh-fleet-git-main-head',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-git-main-title',
            children: [
              jsx('strong', { children: 'Git Graph' }),
              jsx('span', {
                children: state.notRepository === true
                  ? '当前工作区未初始化 Git'
                  : state.snapshot === undefined
                    ? root
                    : `${state.snapshot.status.branch ?? 'Detached HEAD'} · ${String(visibleCommitCount)} 个提交`,
              }),
            ],
          }),
          state.snapshot !== undefined && jsxs('div', {
            className: 'dsh-fleet-git-main-filter-controls',
            children: [
              jsx(BranchSearch, {
                value: branchQuery,
                matchCount: visibleMatchingBranches.length,
                onChange: setBranchQuery,
              }),
              jsx(BranchFilter, {
                branches: state.snapshot.branches,
                selectedBranches,
                showRemoteBranches,
                onSelectionChange: setSelectedBranches,
                onRemoteVisibilityChange: setShowRemoteBranches,
              }),
            ],
          }),
          jsxs('div', {
            className: 'dsh-fleet-git-main-actions',
            children: [
              jsx('button', {
                type: 'button', className: 'dsh-fleet-git-icon-button', 'aria-label': '从远端获取', title: '从远端获取',
                'data-loading': fetching ? 'true' : undefined,
                disabled: state.loading || fetching || state.notRepository === true,
                onClick: () => { void fetchFromRemote() }, children: jsx(Icon, { name: 'fetch', size: 17 }),
              }),
              jsx('button', {
                type: 'button', className: 'dsh-fleet-git-icon-button', 'aria-label': '刷新 Git Graph', title: '刷新',
                'data-loading': state.loading && !fetching ? 'true' : undefined,
                disabled: state.loading || fetching, onClick: () => { void refresh(root, teamId) }, children: jsx(Icon, { name: 'refresh', size: 16 }),
              }),
            ],
          }),
        ],
      }),
      state.error !== undefined && state.notRepository !== true
        && jsx('div', { className: 'dsh-fleet-git-inline-error', role: 'alert', children: state.error }),
      state.notRepository === true
        ? jsx('div', {
            className: 'dsh-fleet-git-empty',
            children: '这个工作区还不是 Git 仓库；初始化后，提交图谱会自动出现在这里。',
          })
        : state.snapshot === undefined
          ? jsx('div', { className: 'dsh-fleet-git-empty', children: state.loading ? '正在读取提交图谱…' : '没有可显示的 Git 数据。' })
        : jsx(GraphView, {
            root,
            snapshot: state.snapshot,
            members,
            selectedBranches,
            showRemoteBranches,
            emphasizedMemberId,
            searchMatchedCommitHashes,
          }),
    ],
  })
}

const styles = `
.dsh-fleet-git-sidebar-layout{width:100%;min-width:0;min-height:0;flex:1;display:flex;flex-direction:column;gap:8px}
.dsh-fleet-git-team-block{position:relative}
.dsh-fleet-git-team-trigger{appearance:none;width:100%;min-height:32px;color:var(--dsw-alias-label-primary);background:transparent;border:0;border-radius:8px;padding:0 4px;display:flex;align-items:center;gap:6px;cursor:pointer;font:inherit;text-align:left}
.dsh-fleet-git-team-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-team-trigger:focus-visible,.dsh-fleet-git-icon-button:focus-visible,.dsh-fleet-git-section-head:focus-visible,.dsh-fleet-git-change-row:focus-visible,.dsh-fleet-git-member-row:focus-visible,.dsh-fleet-git-team-menu button:focus-visible,.dsh-fleet-git-branch-filter-trigger:focus-visible,.dsh-fleet-git-branch-menu button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}.dsh-fleet-git-commit-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-fleet-git-team-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dsh-fleet-git-team-trigger svg{transform:rotate(90deg)}
.dsh-fleet-git-team-menu{z-index:20;box-sizing:border-box;width:calc(100% - 20px);max-height:260px;position:absolute;top:47px;left:10px;overflow:auto;background:var(--dsw-specific-menu);border-radius:10px;box-shadow:var(--dsw-shadow-lv3);padding:4px;display:flex;flex-direction:column}
.dsh-fleet-git-team-menu button{appearance:none;min-height:34px;color:var(--dsw-alias-label-primary);background:transparent;border:0;border-radius:7px;padding:0 9px;font:inherit;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-git-team-menu button:hover,.dsh-fleet-git-team-menu button[aria-checked="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-sidebar{min-height:0;flex:1}
.dsh-fleet-git-sidebar-head,.dsh-fleet-git-main-head{box-sizing:border-box;min-height:48px;flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 18%,transparent)}
.dsh-fleet-git-repository-copy,.dsh-fleet-git-main-title{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.dsh-fleet-git-repository-copy strong,.dsh-fleet-git-main-title strong{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-git-repository-copy span,.dsh-fleet-git-main-title span{color:var(--dsw-alias-label-caption);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-git-icon-button{appearance:none;width:30px;height:30px;flex:none;color:var(--dsw-alias-label-secondary);background:transparent;border:0;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.dsh-fleet-git-icon-button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-icon-button:disabled{opacity:.45;cursor:default}
.dsh-fleet-git-icon-button[data-loading="true"] svg{animation:dsh-fleet-git-spin 900ms linear infinite}
@keyframes dsh-fleet-git-spin{to{transform:rotate(360deg)}}
.dsh-fleet-git-sidebar-scroll{min-height:0;flex:1;overflow:auto;padding:5px 0 10px;scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-caption) 35%,transparent) transparent;scrollbar-width:thin}
.dsh-fleet-git-section+.dsh-fleet-git-section{margin-top:3px}
.dsh-fleet-git-section-head{appearance:none;width:100%;min-height:30px;color:var(--dsw-alias-label-primary);background:transparent;border:0;padding:0 9px;display:flex;align-items:center;gap:5px;cursor:pointer;font:inherit;font-size:12px;font-weight:600;text-align:left}
.dsh-fleet-git-section-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-section-chevron{width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;transition:transform 140ms cubic-bezier(.16,1,.3,1)}
.dsh-fleet-git-section-chevron[data-open="true"]{transform:rotate(90deg)}
.dsh-fleet-git-section-count{margin-left:auto;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-fleet-git-section-empty{padding:6px 28px;color:var(--dsw-alias-label-caption);font-size:11px}
.dsh-fleet-git-change-row{appearance:none;box-sizing:border-box;width:calc(100% - 8px);min-height:27px;margin:0 4px;color:var(--dsw-alias-label-primary);background:transparent;border:0;border-radius:5px;padding:2px 7px 2px 17px;display:flex;align-items:center;gap:6px;cursor:pointer;text-align:left;font:inherit}
.dsh-fleet-git-change-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-file-type{width:14px;height:14px;flex:none;display:inline-flex;align-items:center;justify-content:center}.dsh-fleet-git-file-type svg{width:13px;height:13px;display:block}
.dsh-fleet-git-status-code{width:17px;flex:none;color:var(--dsw-alias-label-caption);font-size:11px;font-weight:700;text-align:center;font-variant-numeric:tabular-nums}
.dsh-fleet-git-status-code[data-code="M"]{color:#b36b22}.dsh-fleet-git-status-code[data-code="A"],.dsh-fleet-git-status-code[data-status="?"]{color:#2c876b}.dsh-fleet-git-status-code[data-code="D"],.dsh-fleet-git-status-code[data-status="U"]{color:#bb4d58}.dsh-fleet-git-status-code[data-code="R"],.dsh-fleet-git-status-code[data-code="C"]{color:#4776a8}
.dsh-fleet-git-change-copy{min-width:0;flex:1;overflow:hidden;display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);align-items:baseline;gap:6px}
.dsh-fleet-git-change-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.dsh-fleet-git-change-path{min-width:0;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
.dsh-fleet-git-member-anchor{position:relative}
.dsh-fleet-git-member-row{appearance:none;box-sizing:border-box;width:100%;min-height:42px;color:inherit;background:transparent;border:0;padding:5px 12px 5px 21px;display:flex;align-items:center;gap:12px;cursor:pointer;text-align:left;font:inherit}
.dsh-fleet-git-member-row:hover,.dsh-fleet-git-member-row[data-selected="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-member-dot{width:8px;height:8px;flex:none;border-radius:50%}
.dsh-fleet-git-member-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.dsh-fleet-git-member-heading{min-width:0;display:flex;align-items:baseline;gap:6px}.dsh-fleet-git-member-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.dsh-fleet-git-member-role{max-width:45%;flex:none;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px}
.dsh-fleet-git-member-location{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption);font-size:10px}
.dsh-fleet-git-member-popover-avatar{box-sizing:border-box;width:42px;height:42px;flex:none;display:inline-flex;align-items:center;justify-content:center;color:#fff;border:1.5px solid color-mix(in srgb,var(--dsw-alias-bg-layer-1) 80%,transparent);border-radius:10px;font-size:15px;font-weight:700;text-shadow:0 1px 1px rgba(18,27,39,.24)}
.dsh-fleet-git-stash-row{box-sizing:border-box;min-height:32px;padding:4px 12px 4px 27px;display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:11px}.dsh-fleet-git-stash-row svg{flex:none}.dsh-fleet-git-stash-row code{flex:none;color:var(--dsw-alias-state-business-primary);font:10px/1.3 var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}.dsh-fleet-git-stash-row span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-git-main,.dsh-fleet-git-diff-view{width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.dsh-fleet-git-main{container-type:inline-size}
.dsh-fleet-git-main-head{padding-inline:14px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)}
.dsh-fleet-git-main-actions{justify-self:end;display:flex;align-items:center;gap:5px}
.dsh-fleet-git-main-filter-controls{min-width:0;max-width:100%;justify-self:center;display:flex;align-items:center;gap:6px}
.dsh-fleet-git-branch-search{box-sizing:border-box;width:clamp(116px,20cqi,210px);height:30px;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 22%,transparent);border-radius:7px;padding:0 6px;display:flex;align-items:center;gap:5px}
.dsh-fleet-git-branch-search:focus-within{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 24%,transparent)}
.dsh-fleet-git-branch-search>svg{flex:none;color:var(--dsw-alias-label-caption)}
.dsh-fleet-git-branch-search input{appearance:none;min-width:0;height:100%;flex:1;color:var(--dsw-alias-label-primary);background:transparent;border:0;padding:0;outline:0;font:inherit;font-size:12px}
.dsh-fleet-git-branch-search input::placeholder{color:var(--dsw-alias-label-caption)}.dsh-fleet-git-branch-search input::-webkit-search-cancel-button{display:none}
.dsh-fleet-git-branch-search-clear{appearance:none;width:20px;height:20px;flex:none;color:var(--dsw-alias-label-caption);background:transparent;border:0;border-radius:5px;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.dsh-fleet-git-branch-search-clear:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.dsh-fleet-git-branch-search-clear:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:0}
.dsh-fleet-git-branch-filter{position:relative}
.dsh-fleet-git-branch-filter-trigger{appearance:none;min-width:112px;height:30px;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 22%,transparent);border-radius:7px;padding:0 7px;display:flex;align-items:center;gap:5px;cursor:pointer;font:inherit;font-size:12px;white-space:nowrap}
.dsh-fleet-git-branch-filter-trigger:hover,.dsh-fleet-git-branch-filter-trigger[aria-expanded="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-branch-filter-trigger>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis}
.dsh-fleet-git-branch-filter-trigger>svg:last-child{transform:rotate(90deg)}
.dsh-fleet-git-branch-menu{z-index:30;box-sizing:border-box;width:300px;max-height:min(440px,calc(100vh - 120px));position:absolute;top:35px;left:50%;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-menu);border:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 15%,transparent);border-radius:10px;box-shadow:var(--dsw-shadow-lv3);padding:5px;display:flex;flex-direction:column;scrollbar-width:thin;transform:translateX(-50%)}
.dsh-fleet-git-branch-option,.dsh-fleet-git-remote-toggle{appearance:none;box-sizing:border-box;width:100%;min-height:34px;color:inherit;background:transparent;border:0;border-radius:7px;padding:0 7px;display:flex;align-items:center;gap:7px;cursor:pointer;font:inherit;font-size:12px;text-align:left}
.dsh-fleet-git-branch-option:hover,.dsh-fleet-git-remote-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-branch-option-all,.dsh-fleet-git-remote-toggle{font-weight:500}
.dsh-fleet-git-menu-check{width:15px;height:15px;flex:none;color:var(--dsw-alias-state-business-primary);display:inline-flex;align-items:center;justify-content:center}
.dsh-fleet-git-branch-option-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-git-branch-option-origin{flex:none;color:var(--dsw-alias-label-caption);font-size:10px}
.dsh-fleet-git-remote-count{margin-left:auto;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-fleet-git-branch-group-label{margin:4px 7px 2px;padding-top:5px;color:var(--dsw-alias-label-caption);border-top:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 14%,transparent);font-size:10px;font-weight:600;letter-spacing:.04em}
.dsh-fleet-git-graph-scroll,.dsh-fleet-git-diff-scroll{min-width:0;min-height:0;flex:1;overflow:auto;scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-caption) 35%,transparent) transparent;scrollbar-width:thin}
.dsh-fleet-git-graph-table{min-width:760px;position:relative}
.dsh-fleet-git-graph-header,.dsh-fleet-git-commit-row{box-sizing:border-box;display:grid;grid-template-columns:var(--dsh-fleet-git-graph-width) minmax(280px,1fr) var(--dsh-fleet-git-date-width) var(--dsh-fleet-git-author-width) var(--dsh-fleet-git-hash-width);align-items:center}
.dsh-fleet-git-graph-header{z-index:2;position:sticky;top:0;height:30px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 96%,transparent);border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 16%,transparent);font-size:11px;font-weight:600;backdrop-filter:blur(8px)}
.dsh-fleet-git-graph-header>span{padding-inline:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-git-graph-header>.dsh-fleet-git-resizable-header{height:100%;position:relative;display:flex;align-items:center;overflow:visible}
.dsh-fleet-git-header-toggle{appearance:none;min-width:0;height:24px;color:inherit;background:transparent;border:0;border-radius:5px;padding:0;font:inherit;text-align:left;cursor:pointer}.dsh-fleet-git-header-toggle:hover{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-offset:2px}.dsh-fleet-git-header-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dsh-fleet-git-header-toggle[aria-pressed="true"]{color:var(--dsw-alias-state-business-primary);font-weight:700}
.dsh-fleet-git-column-resizer{z-index:3;width:7px;height:100%;position:absolute;top:0;right:-4px;cursor:col-resize;touch-action:none}.dsh-fleet-git-column-resizer[data-side="left"]{right:auto;left:-4px}.dsh-fleet-git-column-resizer::after{content:"";width:1px;height:100%;position:absolute;top:0;left:3px;background:transparent}.dsh-fleet-git-column-resizer:hover::after,.dsh-fleet-git-column-resizer:focus-visible::after,.dsh-fleet-git-column-resizer:active::after{background:var(--dsw-alias-state-business-primary)}.dsh-fleet-git-column-resizer:focus-visible{outline:none}
.dsh-fleet-git-commit-row{height:${String(GRAPH_ROW_HEIGHT)}px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 11%,transparent);cursor:pointer}
.dsh-fleet-git-commit-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-commit-row[aria-expanded="true"]{background:color-mix(in srgb,var(--dsw-alias-label-caption) 14%,transparent)}
.dsh-fleet-git-graph-canvas{z-index:1;position:absolute;top:30px;left:0;pointer-events:none;overflow:visible}.dsh-fleet-git-graph-canvas path{fill:none;stroke-width:1.7}
.dsh-fleet-git-graph-cell{display:block}
.dsh-fleet-git-commit-copy{min-width:0;padding:1px 8px;display:flex;align-items:center;gap:6px}
.dsh-fleet-git-commit-subject{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500}
.dsh-fleet-git-commit-subject[data-muted="true"]{color:var(--dsw-alias-label-caption)}
.dsh-fleet-git-refs{min-width:0;max-width:48%;flex:none;display:flex;align-items:center;gap:4px;overflow:hidden}
.dsh-fleet-git-ref{min-width:0;max-width:260px;flex:none;color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 60%,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 15%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 38%,transparent);border-radius:5px;padding:0 5px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font-size:11px;font-weight:500;line-height:19px}
.dsh-fleet-git-ref-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-git-ref[data-synchronized="true"] .dsh-fleet-git-ref-name{font-weight:700}
.dsh-fleet-git-ref-members{flex:none;display:inline-flex;align-items:center;padding-inline-start:2px}
.dsh-fleet-git-ref-member{box-sizing:border-box;width:16px;height:16px;margin-left:-3px;display:inline-flex;align-items:center;justify-content:center;border:1.5px solid var(--dsw-alias-bg-layer-1);border-radius:50%;color:#fff;font-size:8px;font-weight:700;line-height:1;text-shadow:0 1px 1px rgba(18,27,39,.26)}
.dsh-fleet-git-ref-member:first-child{margin-left:0}
@keyframes dsh-fleet-git-member-mark-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.09)}}
.dsh-fleet-git-ref[data-member-emphasized="true"]{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 58%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 58%,transparent)}
.dsh-fleet-git-ref-member[data-emphasized="true"]{z-index:1;position:relative;transform-origin:center;animation:dsh-fleet-git-member-mark-pulse 1.55s ease-in-out infinite}
.dsh-fleet-git-ref[data-kind="tag"]{color:color-mix(in srgb,#9b651f 68%,var(--dsw-alias-label-primary));background:color-mix(in srgb,#c88a37 15%,transparent);border-color:color-mix(in srgb,#c88a37 38%,transparent)}
.dsh-fleet-git-ref[data-kind="stash"]{color:color-mix(in srgb,#7b62a3 68%,var(--dsw-alias-label-primary));background:color-mix(in srgb,#7b62a3 15%,transparent);border-color:color-mix(in srgb,#7b62a3 36%,transparent)}
.dsh-fleet-git-commit-author,.dsh-fleet-git-commit-time,.dsh-fleet-git-commit-hash{min-width:0;padding-inline:8px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.dsh-fleet-git-commit-author[data-fleet-member="true"]{display:flex;align-items:baseline;gap:5px}.dsh-fleet-git-commit-author[data-fleet-member="true"] strong{min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:600}.dsh-fleet-git-commit-author[data-fleet-member="true"] small{min-width:0;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;font-size:9px}
.dsh-fleet-git-commit-time{font-variant-numeric:tabular-nums}.dsh-fleet-git-commit-hash{padding:0;font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dsh-fleet-git-commit-hash-cell{min-width:0;padding-inline:8px;display:flex;align-items:center;gap:4px;overflow:hidden}.dsh-fleet-git-commit-hash-cell code{min-width:0;flex:1}
.dsh-fleet-git-commit-hash-button{appearance:none;min-width:0;min-height:20px;flex:1;color:var(--dsw-alias-label-secondary);background:transparent;border:0;border-radius:5px;padding:0 3px;overflow:hidden;text-align:left;cursor:copy}.dsh-fleet-git-commit-hash-button:hover,.dsh-fleet-git-commit-hash-button[data-copied="true"]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 9%,transparent)}.dsh-fleet-git-commit-hash-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:0}
.dsh-fleet-git-commit-details-row{box-sizing:border-box;height:${String(COMMIT_DETAILS_HEIGHT)}px;display:grid;grid-template-columns:var(--dsh-fleet-git-graph-width) minmax(0,1fr);border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 16%,transparent)}
.dsh-fleet-git-virtual-row{box-sizing:border-box;height:${String(COMMIT_VIRTUAL_ROW_HEIGHT)}px;display:grid;grid-template-columns:var(--dsh-fleet-git-graph-width) minmax(0,1fr);background:color-mix(in srgb,var(--dsw-alias-bg-layer-0) 24%,transparent);border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 11%,transparent)}
.dsh-fleet-git-commit-details{grid-column:2;min-width:0;min-height:0;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-0) 54%,var(--dsw-alias-bg-layer-1));display:grid;grid-template-columns:minmax(320px,1.08fr) minmax(300px,.92fr)}
.dsh-fleet-git-commit-summary,.dsh-fleet-git-commit-files{box-sizing:border-box;min-width:0;min-height:0;margin:0;padding:14px 16px;overflow:auto;scrollbar-width:thin}
.dsh-fleet-git-commit-summary h3{margin:0 0 10px;font-size:13px;font-weight:600;line-height:1.35}
.dsh-fleet-git-commit-summary dl{margin:0;display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:9px;row-gap:4px;font-size:11px;line-height:1.35}
.dsh-fleet-git-commit-summary dt{color:var(--dsw-alias-label-caption)}.dsh-fleet-git-commit-summary dd{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-git-commit-summary code{font:10px/1.35 var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dsh-fleet-git-commit-description{max-width:72ch;margin-top:12px}.dsh-fleet-git-commit-description>strong{font-size:11px;font-weight:600}.dsh-fleet-git-commit-description p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5;white-space:pre-wrap}.dsh-fleet-git-commit-description p[data-empty="true"]{color:var(--dsw-alias-label-caption)}
.dsh-fleet-git-commit-files{padding:0;border-left:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 18%,transparent)}
.dsh-fleet-git-commit-files>header{position:sticky;top:0;z-index:1;min-height:38px;padding:0 12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 94%,transparent);border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 12%,transparent);display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;backdrop-filter:blur(8px)}
.dsh-fleet-git-commit-files>header>span,.dsh-fleet-git-commit-file-stats{display:inline-flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}
.dsh-fleet-git-additions{color:#2c876b}.dsh-fleet-git-deletions{color:#bb4d58}
.dsh-fleet-git-commit-file-tree{margin:0;padding:3px 0;list-style:none;font-size:11px}.dsh-fleet-git-commit-file-tree .dsh-fleet-git-commit-file-tree{padding:0 0 0 15px}
.dsh-fleet-git-commit-file-tree details>summary{box-sizing:border-box;min-height:24px;padding:0 10px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:3px;cursor:pointer;list-style:none}.dsh-fleet-git-commit-file-tree summary::-webkit-details-marker{display:none}.dsh-fleet-git-commit-file-tree details>summary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-commit-file-tree details>summary:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-fleet-git-commit-file-tree details>summary svg{flex:none;transition:transform 120ms cubic-bezier(.16,1,.3,1)}.dsh-fleet-git-commit-file-tree details[open]>summary svg{transform:rotate(90deg)}
.dsh-fleet-git-commit-file{box-sizing:border-box;min-height:24px;padding:0 11px;display:flex;align-items:center;gap:7px}.dsh-fleet-git-commit-file:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-commit-file-status{width:13px;flex:none;color:var(--dsw-alias-label-caption);font-size:10px;font-weight:700;text-align:center}.dsh-fleet-git-commit-file-status[data-status="A"]{color:#2c876b}.dsh-fleet-git-commit-file-status[data-status="D"]{color:#bb4d58}.dsh-fleet-git-commit-file-status[data-status="M"],.dsh-fleet-git-commit-file-status[data-status="R"]{color:#b36b22}
.dsh-fleet-git-commit-file-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-fleet-git-commit-file-binary{flex:none;color:var(--dsw-alias-label-caption);font-size:10px}.dsh-fleet-git-commit-file-stats{flex:none;font-size:10px}
.dsh-fleet-git-commit-files-empty{min-height:100px;color:var(--dsw-alias-label-caption);display:flex;align-items:center;justify-content:center;font-size:11px}
.dsh-fleet-git-commit-details-loading{grid-column:2;min-height:0;color:var(--dsw-alias-label-caption);background:color-mix(in srgb,var(--dsw-alias-bg-layer-0) 54%,var(--dsw-alias-bg-layer-1));display:flex;align-items:center;justify-content:center;font-size:11px}.dsh-fleet-git-commit-details-error{color:#bb4d58}
.dsh-fleet-git-diff-scroll{position:relative;background:var(--dsw-alias-bg-layer-0)}
.dsh-fleet-git-diff{box-sizing:border-box;min-width:100%;width:max-content;min-height:100%;margin:0;padding:14px 18px;color:var(--dsw-alias-label-primary);font:11px/1.55 var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);white-space:pre;tab-size:2}
.dsh-fleet-git-rendered-diff{box-sizing:border-box;min-width:100%;width:max-content;min-height:100%;padding:10px 0;background:var(--dsw-alias-bg-layer-0)}
.dsh-fleet-git-rendered-diff .dsh-diff-render{min-width:100%;margin:0;background:transparent}
.dsh-fleet-git-truncated{position:sticky;bottom:0;padding:7px 12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);box-shadow:0 -2px 8px color-mix(in srgb,#24394d 10%,transparent);font-size:11px}
.dsh-fleet-git-empty,.dsh-fleet-git-main-empty{box-sizing:border-box;min-height:120px;color:var(--dsw-alias-label-caption);padding:24px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px}
.dsh-fleet-git-main-empty{width:100%;height:100%}
.dsh-fleet-git-error{margin:10px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:5px;font-size:11px}.dsh-fleet-git-error span{color:var(--dsw-alias-label-secondary)}
.dsh-fleet-git-inline-error{padding:7px 14px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,#bb4d58 9%,var(--dsw-alias-bg-layer-1));font-size:11px}
@container(max-width:320px){.dsh-fleet-git-main-title span{display:none}.dsh-fleet-git-branch-filter-trigger{min-width:30px;width:30px;padding:0;justify-content:center}.dsh-fleet-git-branch-filter-trigger>span,.dsh-fleet-git-branch-filter-trigger>svg:last-child{display:none}}
@media(max-width:640px){.dsh-fleet-git-team-trigger,.dsh-fleet-git-section-head,.dsh-fleet-git-member-row,.dsh-fleet-git-branch-option,.dsh-fleet-git-remote-toggle{min-height:44px}.dsh-fleet-git-repository-copy strong,.dsh-fleet-git-main-title strong{font-size:14px}.dsh-fleet-git-branch-menu{width:min(300px,calc(100vw - 32px))}}
@media(prefers-reduced-motion:reduce){.dsh-fleet-git-section-chevron,.dsh-fleet-git-commit-file-tree details>summary svg{transition:none}.dsh-fleet-git-ref-member[data-emphasized="true"]{animation:none}}
`

function installStyles(): void {
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) {
    existing.textContent = styles
    return
  }
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = styles
  document.head.append(style)
}

export const name = '@ch4acko3/dsh-agent-fleet-git'
export const inject = ['slots', 'remote'] as const

export async function apply(ctx: FleetGitClientContext): Promise<() => Promise<void>> {
  installStyles()
  ctx.inject?.<FleetDiffServices>(['diffEngine', 'diffRenderer'], rendererCtx => {
    const services = { diffEngine: rendererCtx.diffEngine, diffRenderer: rendererCtx.diffRenderer }
    configureDiffServices(services)
    return () => {
      if (diffServices === services) configureDiffServices(undefined)
    }
  })
  const gateway = ctx.remote ?? ctx.get?.('remote') as FleetGitClientContext['remote']
  if (gateway === undefined) throw new Error('DSH Remote Gateway is unavailable')
  const disposeRemote = await gateway.$mount(FLEET_GIT_WEB_REMOTE)
  const mounted = ctx.get?.('remote.fleetGit') as FleetGitWebClient | undefined
  if (mounted === undefined) {
    await disposeRemote()
    throw new Error('Fleet Git Web Remote did not mount its fleetGit namespace')
  }
  webClient = mounted
  ctx.slots.inject('fleet.panel.tool', () => ctx.slots.register({ name: 'fleet.panel.tool', id: TOOL_ID, order: 35 }, GitTool))
  ctx.slots.inject('fleet.panel.sidebar', () => ctx.slots.register({ name: 'fleet.panel.sidebar', key: TOOL_ID }, GitSidebar))
  ctx.slots.inject('fleet.panel.main', () => ctx.slots.register({ name: 'fleet.panel.main', key: TOOL_ID }, GitMain))
  return async () => {
    if (webClient === mounted) webClient = undefined
    await disposeRemote()
  }
}
