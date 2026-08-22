import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  FleetGitBranch,
  FleetGitCommit,
  FleetGitDiff,
  FleetGitSnapshot,
  FleetGitWorktree,
} from '../git.js'
import type { ComponentType, CSSProperties, ReactElement, ReactNode } from 'react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import { FLEET_GIT_WEB_REMOTE, type FleetGitWebClient } from '../contract.js'

const TOOL_ID = 'git'
const STYLE_ID = 'dsh-agent-fleet-git-style'
const POLL_INTERVAL_MS = 5_000
const MAX_CACHED_REPOSITORIES = 32

interface FleetMemberFace {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly color: string
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
    readonly workspaces: readonly FleetWorkspaceFace[]
  }
  readonly selectTeam: (teamId: string) => void
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

function publish(root: string, state: GitViewState): void {
  stateByRoot.delete(root)
  stateByRoot.set(root, state)
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
  for (const listener of listenersByRoot.get(root) ?? []) listener()
}

function stateFor(root: string | undefined): GitViewState {
  return root === undefined ? EMPTY_STATE : stateByRoot.get(root) ?? EMPTY_STATE
}

function subscribe(root: string | undefined, listener: () => void): () => void {
  if (root === undefined) return () => {}
  const listeners = listenersByRoot.get(root) ?? new Set()
  listeners.add(listener)
  listenersByRoot.set(root, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByRoot.delete(root)
  }
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

async function refresh(root: string): Promise<void> {
  const pending = refreshes.get(root)
  if (pending !== undefined) return pending
  const current = stateFor(root)
  const { error: _error, ...withoutError } = current
  publish(root, { ...withoutError, loading: true })
  const operation = (async () => {
    try {
      if (webClient === undefined) throw new Error('Git Remote 尚未连接')
      const snapshot = unwrap(await webClient.snapshot({ root, limit: 200 }))
      const { error: _error, ...fresh } = stateFor(root)
      publish(root, { ...fresh, snapshot, loading: false })
    } catch (error) {
      publish(root, {
        ...stateFor(root),
        loading: false,
        error: error instanceof Error ? error.message : 'Git 状态读取失败',
      })
    } finally {
      refreshes.delete(root)
    }
  })()
  refreshes.set(root, operation)
  return operation
}

async function openDiff(root: string, selection: DiffSelection): Promise<void> {
  const { diff: _diff, diffError: _diffError, ...current } = stateFor(root)
  publish(root, { ...current, selection, diffLoading: true })
  try {
    if (webClient === undefined) throw new Error('Git Remote 尚未连接')
    const diff = unwrap(await webClient.diff({ root, path: selection.path, staged: selection.staged }))
    const current = stateFor(root)
    if (current.selection?.path !== selection.path || current.selection.staged !== selection.staged) return
    const { diffError: _diffError, ...withoutError } = current
    publish(root, { ...withoutError, diff, diffLoading: false })
  } catch (error) {
    const current = stateFor(root)
    if (current.selection?.path !== selection.path || current.selection.staged !== selection.staged) return
    publish(root, {
      ...current,
      diffLoading: false,
      diffError: error instanceof Error ? error.message : 'Diff 读取失败',
    })
  }
}

function closeDiff(root: string): void {
  const { selection: _selection, diff: _diff, diffError: _diffError, ...state } = stateFor(root)
  publish(root, { ...state, diffLoading: false })
}

function useGitState(root: string | undefined): GitViewState {
  return useSyncExternalStore(
    listener => subscribe(root, listener),
    () => stateFor(root),
    () => stateFor(root),
  )
}

function useGitRefresh(root: string | undefined): void {
  useEffect(() => {
    if (root === undefined) return
    void refresh(root)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(root)
    }, POLL_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [root])
}

function repositoryRoot(owner: FleetPaneOwner): string | undefined {
  return owner.snapshot.workspaces.find(workspace => workspace.access === 'write')?.path
    ?? owner.snapshot.workspaces[0]?.path
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path
}

function parentPath(path: string): string {
  const parts = path.split(/[\\/]/u)
  return parts.length > 1 ? parts.slice(0, -1).join('/') : ''
}

function branchForMember(
  member: FleetMemberFace,
  worktrees: readonly FleetGitWorktree[],
  branches: readonly FleetGitBranch[],
): string | undefined {
  const worktree = worktrees.find(candidate => candidate.branch?.split('/').at(-1) === member.id)
    ?? worktrees.find(candidate => fileName(candidate.path) === member.id)
  return worktree?.branch ?? branches.find(branch => !branch.remote && branch.name.split('/').at(-1) === member.id)?.name
}

function statusLabel(code: string): string {
  const labels: Record<string, string> = {
    M: '已修改', A: '已添加', D: '已删除', R: '已重命名', C: '已复制', U: '未合并', '?': '未跟踪', '!': '已忽略',
  }
  return labels[code] ?? code
}

function Icon({ name, size = 18 }: { readonly name: 'git' | 'refresh' | 'chevron' | 'close'; readonly size?: number }): ReactElement {
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
  if (name === 'chevron') return jsx('svg', { ...common, children: jsx('path', { d: 'm7 5 5 5-5 5' }) })
  if (name === 'close') return jsx('svg', { ...common, children: jsx('path', { d: 'm5.5 5.5 9 9m0-9-9 9' }) })
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

function ChangeRow({ root, path, code, staged }: {
  readonly root: string
  readonly path: string
  readonly code: string
  readonly staged: boolean
}): ReactElement {
  return jsxs('button', {
    type: 'button',
    className: 'dsh-fleet-git-change-row',
    title: `${statusLabel(code)} · ${path}`,
    onClick: () => { void openDiff(root, { path, staged }) },
    children: [
      jsx('span', { className: 'dsh-fleet-git-status-code', 'data-code': code, children: code }),
      jsxs('span', {
        className: 'dsh-fleet-git-change-copy',
        children: [
          jsx('span', { className: 'dsh-fleet-git-change-name', children: fileName(path) }),
          parentPath(path) !== '' && jsx('span', { className: 'dsh-fleet-git-change-path', children: parentPath(path) }),
        ],
      }),
    ],
  })
}

function GitSidebar(owner: FleetPaneOwner): ReactElement {
  const root = repositoryRoot(owner)
  const state = useGitState(root)
  useGitRefresh(root)
  const status = state.snapshot?.status
  const staged = status?.changes.filter(change => change.index !== ' ' && change.index !== '?') ?? []
  const working = status?.changes.filter(change => change.worktree !== ' ' || change.index === '?') ?? []
  const worktrees = status?.worktrees ?? []
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
                  jsx('strong', { children: root === undefined ? '未挂载工作区' : fileName(status?.root ?? root) }),
                  root !== undefined && jsx('span', { children: status?.branch ?? 'Detached HEAD' }),
                ],
              }),
              root !== undefined && jsx('button', {
                type: 'button',
                className: 'dsh-fleet-git-icon-button',
                'aria-label': '刷新 Git 状态',
                title: '刷新',
                disabled: state.loading,
                onClick: () => { void refresh(root) },
                children: jsx(Icon, { name: 'refresh', size: 15 }),
              }),
            ],
          }),
          jsx('div', {
            className: 'dsh-fleet-git-sidebar-scroll',
            children: root === undefined
              ? jsx('div', { className: 'dsh-fleet-git-empty', children: '给团队挂载一个 Git 工作区后即可查看源码管理状态。' })
              : state.error !== undefined && state.snapshot === undefined
                ? jsxs('div', { className: 'dsh-fleet-git-error', children: [jsx('strong', { children: '无法读取仓库' }), jsx('span', { children: state.error })] })
                : jsxs('div', {
                    children: [
                      jsx(Section, {
                        title: '暂存的更改', count: staged.length,
                        children: staged.length === 0
                          ? jsx('div', { className: 'dsh-fleet-git-section-empty', children: '没有暂存的更改' })
                          : staged.map(change => jsx(ChangeRow, { root, path: change.path, code: change.index, staged: true }, `i:${change.path}`)),
                      }),
                      jsx(Section, {
                        title: '更改', count: working.length,
                        children: working.length === 0
                          ? jsx('div', { className: 'dsh-fleet-git-section-empty', children: '工作树是干净的' })
                          : working.map(change => jsx(ChangeRow, {
                              root, path: change.path, code: change.index === '?' ? '?' : change.worktree, staged: false,
                            }, `w:${change.path}`)),
                      }),
                      jsx(Section, {
                        title: '成员分支', count: owner.snapshot.members.length, defaultOpen: true,
                        children: owner.snapshot.members.map(member => {
                          const branch = branchForMember(member, worktrees, state.snapshot?.branches ?? [])
                          return jsxs('div', {
                            className: 'dsh-fleet-git-member-row',
                            children: [
                              jsx('span', { className: 'dsh-fleet-git-member-dot', style: { background: member.color } }),
                              jsxs('span', {
                                className: 'dsh-fleet-git-member-copy',
                                children: [jsx('span', { children: member.name }), jsx('small', { children: branch ?? '尚无独立分支' })],
                              }),
                            ],
                          }, member.id)
                        }),
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
  readonly before: readonly string[]
  readonly after: readonly string[]
}

export function layoutGitGraph(commits: readonly FleetGitCommit[]): GitGraphRow[] {
  let lanes: string[] = []
  return commits.map(commit => {
    let lane = lanes.indexOf(commit.hash)
    if (lane < 0) {
      lane = lanes.length
      lanes.push(commit.hash)
    }
    const before = [...lanes]
    const next = [...lanes]
    if (commit.parents.length === 0) next.splice(lane, 1)
    else {
      next[lane] = commit.parents[0] as string
      for (let index = 1; index < commit.parents.length; index += 1) {
        const parent = commit.parents[index] as string
        if (!next.includes(parent)) next.splice(lane + index, 0, parent)
      }
    }
    lanes = next.filter((hash, index) => next.indexOf(hash) === index)
    return { commit, lane, before, after: [...lanes] }
  })
}

const LANE_COLORS = ['#4f78d3', '#b45f9b', '#318b78', '#b06d33', '#7b68c8', '#3e84a8'] as const

function GraphLines({ row, width }: { readonly row: GitGraphRow; readonly width: number }): ReactElement {
  const x = (lane: number): number => lane * 16 + 10
  const connections: ReactNode[] = []
  for (let index = 0; index < row.before.length; index += 1) {
    const hash = row.before[index] as string
    if (index === row.lane) continue
    const target = row.after.indexOf(hash)
    if (target >= 0) connections.push(jsx('path', {
      d: `M${String(x(index))} 0 L${String(x(target))} 48`,
      stroke: LANE_COLORS[index % LANE_COLORS.length],
    }, `carry:${hash}:${String(index)}`))
  }
  connections.push(jsx('path', {
    d: `M${String(x(row.lane))} 0 L${String(x(row.lane))} 24`,
    stroke: LANE_COLORS[row.lane % LANE_COLORS.length],
  }, 'incoming'))
  row.commit.parents.forEach((parent, index) => {
    const target = row.after.indexOf(parent)
    if (target < 0) return
    connections.push(jsx('path', {
      d: `M${String(x(row.lane))} 24 C${String(x(row.lane))} 34 ${String(x(target))} 36 ${String(x(target))} 48`,
      stroke: LANE_COLORS[(row.lane + index) % LANE_COLORS.length],
    }, `parent:${parent}`))
  })
  return jsxs('svg', {
    className: 'dsh-fleet-git-graph-lines',
    width,
    height: 48,
    viewBox: `0 0 ${String(width)} 48`,
    'aria-hidden': 'true',
    children: [
      ...connections,
      jsx('circle', {
        cx: x(row.lane), cy: 24, r: 4.2,
        fill: LANE_COLORS[row.lane % LANE_COLORS.length],
        stroke: 'var(--dsw-alias-bg-layer-1)', strokeWidth: 2,
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

function refKind(ref: string): 'head' | 'tag' | 'remote' | 'branch' {
  if (ref.startsWith('tag: ')) return 'tag'
  if (ref.includes('/')) return 'remote'
  if (ref === 'HEAD') return 'head'
  return 'branch'
}

function GraphView({ snapshot }: { readonly snapshot: FleetGitSnapshot }): ReactElement {
  const rows = useMemo(() => layoutGitGraph(snapshot.commits), [snapshot.commits])
  const graphWidth = useMemo(() => Math.max(44, ...rows.map(row => Math.max(row.before.length, row.after.length) * 16 + 12)), [rows])
  const graphStyle = { '--dsh-fleet-git-graph-width': `${String(graphWidth)}px` } as CSSProperties
  return jsx('div', {
    className: 'dsh-fleet-git-graph-scroll',
    children: rows.length === 0
      ? jsx('div', { className: 'dsh-fleet-git-empty', children: '仓库还没有提交记录。' })
      : jsxs('div', {
          className: 'dsh-fleet-git-graph-table',
          style: graphStyle,
          children: [
            jsxs('div', {
              className: 'dsh-fleet-git-graph-header',
              role: 'row',
              children: [
                jsx('span', { children: '图谱' }),
                jsx('span', { children: '描述' }),
                jsx('span', { children: '作者' }),
                jsx('span', { children: '日期' }),
                jsx('span', { children: '哈希' }),
              ],
            }),
            ...rows.map(row => jsxs('div', {
              className: 'dsh-fleet-git-commit-row',
              role: 'row',
              children: [
                jsx(GraphLines, { row, width: graphWidth }),
                jsxs('div', {
                  className: 'dsh-fleet-git-commit-copy',
                  title: row.commit.subject,
                  children: [
                    jsx('span', { className: 'dsh-fleet-git-commit-subject', children: row.commit.subject }),
                    row.commit.decorations.length > 0 && jsx('span', {
                      className: 'dsh-fleet-git-refs',
                      children: row.commit.decorations.slice(0, 5).map(decoration => jsx('span', {
                        className: 'dsh-fleet-git-ref',
                        'data-kind': refKind(decoration),
                        title: decoration,
                        children: decoration.replace(/^tag: /, ''),
                      }, decoration)),
                    }),
                  ],
                }),
                jsx('span', { className: 'dsh-fleet-git-commit-author', title: row.commit.authorEmail, children: row.commit.authorName }),
                jsx('time', {
                  className: 'dsh-fleet-git-commit-time', dateTime: row.commit.authoredAt,
                  title: new Date(row.commit.authoredAt).toLocaleString(), children: relativeTime(row.commit.authoredAt),
                }),
                jsx('code', { className: 'dsh-fleet-git-commit-hash', title: row.commit.hash, children: row.commit.hash.slice(0, 8) }),
              ],
            }, row.commit.hash)),
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

function DiffView({ root, state }: { readonly root: string; readonly state: GitViewState }): ReactElement {
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
            onClick: () => { closeDiff(root) }, children: jsx(Icon, { name: 'close', size: 16 }),
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

function GitMain(owner: FleetPaneOwner): ReactElement {
  const root = repositoryRoot(owner)
  const state = useGitState(root)
  useGitRefresh(root)
  if (root === undefined) return jsx('div', { className: 'dsh-fleet-git-main-empty', children: '挂载 Git 工作区后，这里会显示提交图谱。' })
  if (state.selection !== undefined) return jsx(DiffView, { root, state })
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
              jsx('span', { children: state.snapshot === undefined ? root : `${state.snapshot.status.branch ?? 'Detached HEAD'} · ${state.snapshot.commits.length} 个提交` }),
            ],
          }),
          jsx('button', {
            type: 'button', className: 'dsh-fleet-git-icon-button', 'aria-label': '刷新 Git Graph', title: '刷新',
            disabled: state.loading, onClick: () => { void refresh(root) }, children: jsx(Icon, { name: 'refresh', size: 16 }),
          }),
        ],
      }),
      state.error !== undefined && jsx('div', { className: 'dsh-fleet-git-inline-error', role: 'alert', children: state.error }),
      state.snapshot === undefined
        ? jsx('div', { className: 'dsh-fleet-git-empty', children: state.loading ? '正在读取提交图谱…' : '没有可显示的 Git 数据。' })
        : jsx(GraphView, { snapshot: state.snapshot }),
    ],
  })
}

const styles = `
.dsh-fleet-git-sidebar-layout{width:100%;min-width:0;min-height:0;flex:1;display:flex;flex-direction:column;gap:8px}
.dsh-fleet-git-team-block{position:relative}
.dsh-fleet-git-team-trigger{appearance:none;width:100%;min-height:32px;color:var(--dsw-alias-label-primary);background:transparent;border:0;border-radius:8px;padding:0 4px;display:flex;align-items:center;gap:6px;cursor:pointer;font:inherit;text-align:left}
.dsh-fleet-git-team-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-team-trigger:focus-visible,.dsh-fleet-git-icon-button:focus-visible,.dsh-fleet-git-section-head:focus-visible,.dsh-fleet-git-change-row:focus-visible,.dsh-fleet-git-team-menu button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
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
.dsh-fleet-git-icon-button:disabled svg{animation:dsh-fleet-git-spin 900ms linear infinite}
@keyframes dsh-fleet-git-spin{to{transform:rotate(360deg)}}
.dsh-fleet-git-sidebar-scroll{min-height:0;flex:1;overflow:auto;padding:5px 0 10px;scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-caption) 35%,transparent) transparent;scrollbar-width:thin}
.dsh-fleet-git-section+.dsh-fleet-git-section{margin-top:3px}
.dsh-fleet-git-section-head{appearance:none;width:100%;min-height:30px;color:var(--dsw-alias-label-primary);background:transparent;border:0;padding:0 9px;display:flex;align-items:center;gap:5px;cursor:pointer;font:inherit;font-size:12px;font-weight:600;text-align:left}
.dsh-fleet-git-section-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-section-chevron{width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;transition:transform 140ms cubic-bezier(.16,1,.3,1)}
.dsh-fleet-git-section-chevron[data-open="true"]{transform:rotate(90deg)}
.dsh-fleet-git-section-count{margin-left:auto;color:var(--dsw-alias-label-caption);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-fleet-git-section-empty{padding:6px 28px;color:var(--dsw-alias-label-caption);font-size:11px}
.dsh-fleet-git-change-row{appearance:none;box-sizing:border-box;width:calc(100% - 8px);min-height:34px;margin:1px 4px;color:var(--dsw-alias-label-primary);background:transparent;border:0;border-radius:7px;padding:4px 7px;display:flex;align-items:center;gap:8px;cursor:pointer;text-align:left;font:inherit}
.dsh-fleet-git-change-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-status-code{width:17px;flex:none;color:var(--dsw-alias-label-caption);font-size:11px;font-weight:700;text-align:center;font-variant-numeric:tabular-nums}
.dsh-fleet-git-status-code[data-code="M"]{color:#b36b22}.dsh-fleet-git-status-code[data-code="A"],.dsh-fleet-git-status-code[data-code="?"]{color:#2c876b}.dsh-fleet-git-status-code[data-code="D"]{color:#bb4d58}
.dsh-fleet-git-change-copy{min-width:0;flex:1;display:flex;align-items:baseline;gap:6px}
.dsh-fleet-git-change-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.dsh-fleet-git-change-path{min-width:0;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
.dsh-fleet-git-member-row{box-sizing:border-box;min-height:42px;padding:5px 12px 5px 27px;display:flex;align-items:center;gap:8px}
.dsh-fleet-git-member-dot{width:8px;height:8px;flex:none;border-radius:50%}
.dsh-fleet-git-member-copy{min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-fleet-git-member-copy>span,.dsh-fleet-git-member-copy>small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-git-member-copy>span{font-size:12px}.dsh-fleet-git-member-copy>small{color:var(--dsw-alias-label-caption);font-size:10px}
.dsh-fleet-git-main,.dsh-fleet-git-diff-view{width:100%;height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.dsh-fleet-git-main-head{padding-inline:14px}
.dsh-fleet-git-graph-scroll,.dsh-fleet-git-diff-scroll{min-width:0;min-height:0;flex:1;overflow:auto;scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-caption) 35%,transparent) transparent;scrollbar-width:thin}
.dsh-fleet-git-graph-table{min-width:760px}
.dsh-fleet-git-graph-header,.dsh-fleet-git-commit-row{box-sizing:border-box;display:grid;grid-template-columns:var(--dsh-fleet-git-graph-width) minmax(280px,1fr) 150px 108px 78px;align-items:center}
.dsh-fleet-git-graph-header{z-index:2;position:sticky;top:0;height:28px;color:var(--dsw-alias-label-caption);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 96%,transparent);border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 16%,transparent);font-size:10px;backdrop-filter:blur(8px)}
.dsh-fleet-git-graph-header>span{padding-inline:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-git-commit-row{height:48px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-caption) 11%,transparent)}
.dsh-fleet-git-commit-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-git-graph-lines{overflow:visible}.dsh-fleet-git-graph-lines path{fill:none;stroke-width:1.7}
.dsh-fleet-git-commit-copy{min-width:0;padding:4px 8px;display:flex;flex-direction:column;justify-content:center;gap:3px}
.dsh-fleet-git-commit-subject{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500}
.dsh-fleet-git-refs{min-width:0;display:flex;align-items:center;gap:4px;overflow:hidden}
.dsh-fleet-git-ref{max-width:140px;flex:none;color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 9%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent);border-radius:4px;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;line-height:13px}
.dsh-fleet-git-ref[data-kind="tag"]{color:#9b651f;background:color-mix(in srgb,#c88a37 10%,transparent);border-color:color-mix(in srgb,#c88a37 24%,transparent)}
.dsh-fleet-git-ref[data-kind="remote"]{color:#5470a6;background:color-mix(in srgb,#5470a6 9%,transparent);border-color:color-mix(in srgb,#5470a6 20%,transparent)}
.dsh-fleet-git-commit-author,.dsh-fleet-git-commit-time,.dsh-fleet-git-commit-hash{min-width:0;padding-inline:8px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
.dsh-fleet-git-commit-time{font-variant-numeric:tabular-nums}.dsh-fleet-git-commit-hash{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dsh-fleet-git-diff-scroll{position:relative;background:var(--dsw-alias-bg-layer-0)}
.dsh-fleet-git-diff{box-sizing:border-box;min-width:100%;width:max-content;min-height:100%;margin:0;padding:14px 18px;color:var(--dsw-alias-label-primary);font:11px/1.55 var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);white-space:pre;tab-size:2}
.dsh-fleet-git-rendered-diff{box-sizing:border-box;min-width:100%;width:max-content;min-height:100%;padding:10px 0;background:var(--dsw-alias-bg-layer-0)}
.dsh-fleet-git-rendered-diff .dsh-diff-render{min-width:100%;margin:0;background:transparent}
.dsh-fleet-git-truncated{position:sticky;bottom:0;padding:7px 12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);box-shadow:0 -2px 8px color-mix(in srgb,#24394d 10%,transparent);font-size:11px}
.dsh-fleet-git-empty,.dsh-fleet-git-main-empty{box-sizing:border-box;min-height:120px;color:var(--dsw-alias-label-caption);padding:24px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px}
.dsh-fleet-git-main-empty{width:100%;height:100%}
.dsh-fleet-git-error{margin:10px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:5px;font-size:11px}.dsh-fleet-git-error span{color:var(--dsw-alias-label-secondary)}
.dsh-fleet-git-inline-error{padding:7px 14px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,#bb4d58 9%,var(--dsw-alias-bg-layer-1));font-size:11px}
@media(max-width:640px){.dsh-fleet-git-team-trigger,.dsh-fleet-git-section-head,.dsh-fleet-git-change-row,.dsh-fleet-git-member-row{min-height:44px}.dsh-fleet-git-repository-copy strong,.dsh-fleet-git-main-title strong{font-size:14px}}
@media(prefers-reduced-motion:reduce){.dsh-fleet-git-section-chevron{transition:none}}
`

function installStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
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
