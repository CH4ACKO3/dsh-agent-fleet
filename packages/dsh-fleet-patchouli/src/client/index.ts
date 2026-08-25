import type { ChangeEvent, ComponentType, ReactElement, ReactNode } from 'react'
import { useId, useMemo, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const TOOL_ID = 'memory'
const STYLE_ID = 'dsh-fleet-patchouli-panel-style'

type MemoryFilter = 'all' | 'stored' | 'recalled'

interface FleetActivity {
  readonly id: string
  readonly kind: string
  readonly type?: string
  readonly data?: unknown
  readonly text: string
  readonly createdAt: string
}

interface FleetTeamSummary {
  readonly teamId: string
  readonly teamName: string
}

interface FleetToolOwner {
  readonly activeTool: string
  readonly disabled?: boolean
  readonly selectTool: (tool: string) => void
}

interface FleetPaneOwner {
  readonly fleet: { readonly directory: { readonly teams: readonly FleetTeamSummary[] } }
  readonly snapshot: {
    readonly teamId: string
    readonly teamName: string
    readonly activity: readonly FleetActivity[]
  }
  readonly activeItem: string
  readonly selectItem: (item: string) => void
  readonly selectTeam: (teamId: string) => void
}

interface ClientContext {
  readonly slots: {
    inject(name: string, register: () => unknown): void
    register(options: {
      readonly name: string
      readonly id?: string
      readonly key?: string
      readonly order?: number
    }, component: ComponentType<any>): unknown
  }
}

interface MemoryEntry {
  readonly activity: FleetActivity
  readonly operation: Exclude<MemoryFilter, 'all'>
  readonly count?: number
  readonly member?: string
  readonly conversation?: string
  readonly effort?: string
  readonly agent?: boolean
  readonly algorithm?: string
  readonly providers: readonly string[]
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function positiveCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []
}

export function fleetMemoryEntry(activity: FleetActivity): MemoryEntry | undefined {
  if (activity.kind !== 'memory') return undefined
  const data = record(activity.data)
  if (activity.type === 'memory.stored') {
    const count = positiveCount(data?.storedCount)
    const conversation = text(data?.conversation)
    return {
      activity,
      operation: 'stored',
      ...(count === undefined ? {} : { count }),
      ...(conversation === undefined ? {} : { conversation }),
      providers: stringList(data?.providers),
    }
  }
  if (activity.type === 'memory.recalled') {
    const count = positiveCount(data?.resultCount)
    const member = text(data?.member)
    const conversation = text(data?.conversation)
    const effort = text(data?.effort)
    const agent = typeof data?.agent === 'boolean' ? data.agent : undefined
    const algorithm = text(data?.algorithm)
    return {
      activity,
      operation: 'recalled',
      ...(count === undefined ? {} : { count }),
      ...(member === undefined ? {} : { member }),
      ...(conversation === undefined ? {} : { conversation }),
      ...(effort === undefined ? {} : { effort }),
      ...(agent === undefined ? {} : { agent }),
      ...(algorithm === undefined ? {} : { algorithm }),
      providers: stringList(data?.providers),
    }
  }
  return undefined
}

function Icon({ name, size = 18 }: { readonly name: 'memory' | 'write' | 'recall' | 'chevron' | 'search'; readonly size?: number }): ReactElement {
  const maskId = useId()
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
  if (name === 'memory') return jsxs('svg', {
    ...common,
    viewBox: '0 0 20 20',
    children: [
      jsx('defs', {
        children: jsxs('mask', {
          id: maskId,
          children: [
            jsx('rect', { width: 20, height: 20, fill: 'white' }),
            jsx('path', {
              d: 'M2.2 9.1c3.7-.3 5.4-2.2 6-5.7 3.1 1.2 4.5 3.5 4 6.2-.5 2.7-2.7 4.5-5.5 4.3-2.2-.1-3.9-1.3-4.5-3.1Z',
              fill: 'black',
              stroke: 'black',
              strokeWidth: 1.8,
            }),
          ],
        }),
      }),
      jsxs('g', {
        mask: `url(#${maskId})`,
        children: [
          jsx('path', { d: 'm2.2 6.7 7.8-4.3 7.8 4.3-7.8 4.4-7.8-4.4Z' }),
          jsx('path', { d: 'M2.2 7v7.1l7.8 4.1 7.8-4.1V7M10 11.1v7.1' }),
        ],
      }),
      jsx('path', { d: 'M2.2 9.1c3.7-.3 5.4-2.2 6-5.7 3.1 1.2 4.5 3.5 4 6.2-.5 2.7-2.7 4.5-5.5 4.3-2.2-.1-3.9-1.3-4.5-3.1' }),
    ],
  })
  if (name === 'write') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M4 6.2c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5-2.7 2.5-6 2.5-6-1.1-6-2.5Z' }),
      jsx('path', { d: 'M4 6.2v7.4c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6V6.2M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5' }),
    ],
  })
  if (name === 'recall') return jsxs('svg', {
    ...common,
    children: [
      jsx('circle', { cx: 9, cy: 9, r: 5.2 }),
      jsx('path', { d: 'm13 13 3.3 3.3M6.7 9h4.6M9 6.7v4.6' }),
    ],
  })
  if (name === 'search') return jsxs('svg', {
    ...common,
    children: [jsx('circle', { cx: 8.7, cy: 8.7, r: 5 }), jsx('path', { d: 'm12.4 12.4 4 4' })],
  })
  return jsx('svg', { ...common, children: jsx('path', { d: 'm7 8 3 3 3-3' }) })
}

function MemoryTool(owner: FleetToolOwner): ReactElement {
  return jsx('button', {
    type: 'button',
    className: 'dsh-fleet-panel-tool',
    disabled: owner.disabled === true,
    'aria-label': '团队记忆',
    'aria-current': owner.activeTool === TOOL_ID ? 'page' : undefined,
    title: '团队记忆',
    onClick: () => { owner.selectTool(TOOL_ID) },
    children: jsx(Icon, { name: 'memory' }),
  })
}

function TeamSelector({ owner }: { readonly owner: FleetPaneOwner }): ReactElement {
  const [open, setOpen] = useState(false)
  return jsxs('div', {
    className: 'dsh-fleet-panel-sidebar-team-block dsh-fleet-memory-team-block',
    children: [
      jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-memory-team-trigger',
        'aria-haspopup': 'menu',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => { setOpen(value => !value) },
        children: [
          jsx('span', { children: owner.snapshot.teamName }),
          jsx(Icon, { name: 'chevron', size: 14 }),
        ],
      }),
      open && jsx('div', {
        className: 'dsh-fleet-panel-team-menu dsh-fleet-memory-team-menu',
        role: 'menu',
        children: owner.fleet.directory.teams.map(team => jsx('button', {
          type: 'button',
          className: 'dsh-fleet-panel-team-option',
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

function activeFilter(item: string): MemoryFilter {
  return item === 'stored' || item === 'recalled' ? item : 'all'
}

function filterCaption(filter: MemoryFilter, entries: readonly MemoryEntry[]): string {
  const count = filter === 'all' ? entries.length : entries.filter(entry => entry.operation === filter).length
  return `${String(count)} 条记录`
}

function MemorySidebar(owner: FleetPaneOwner): ReactElement {
  const entries = owner.snapshot.activity.flatMap(activity => {
    const entry = fleetMemoryEntry(activity)
    return entry === undefined ? [] : [entry]
  })
  const filter = activeFilter(owner.activeItem)
  const filters: readonly [MemoryFilter, string, string, 'memory' | 'write' | 'recall'][] = [
    ['all', '全部记忆', '有效写入与召回', 'memory'],
    ['stored', '记忆写入', '进入团队记忆库', 'write'],
    ['recalled', '记忆召回', '返回有效结果', 'recall'],
  ]
  return jsxs('div', {
    className: 'dsh-fleet-panel-sidebar-layout',
    children: [
      jsx(TeamSelector, { owner }),
      jsx('div', {
        className: 'dsh-fleet-panel-sidebar dsh-fleet-memory-sidebar',
        children: jsxs('div', {
          className: 'dsh-fleet-panel-sidebar-scroll dsh-fleet-memory-sidebar-scroll',
          children: [
            jsx('div', { className: 'dsh-fleet-panel-section-title', children: '团队记忆' }),
            ...filters.map(([id, title, caption, icon]) => jsxs('button', {
              type: 'button',
              className: 'dsh-fleet-panel-list-row',
              'aria-current': filter === id ? 'true' : undefined,
              onClick: () => { owner.selectItem(id) },
              children: [
                jsx('span', { className: 'dsh-fleet-panel-list-icon', children: jsx(Icon, { name: icon, size: 15 }) }),
                jsxs('span', {
                  className: 'dsh-fleet-panel-list-copy',
                  children: [
                    jsx('span', { className: 'dsh-fleet-panel-list-title', children: title }),
                    jsx('span', {
                      className: 'dsh-fleet-panel-list-caption',
                      children: `${caption} · ${filterCaption(id, entries)}`,
                    }),
                  ],
                }),
              ],
            }, id)),
          ],
        }),
      }),
    ],
  })
}

function detailTags(entry: MemoryEntry): readonly ReactNode[] {
  const tags: ReactNode[] = []
  if (entry.member !== undefined) tags.push(jsx('span', { children: entry.member }, 'member'))
  if (entry.conversation !== undefined) tags.push(jsx('span', { children: entry.conversation }, 'conversation'))
  if (entry.effort !== undefined) tags.push(jsx('span', { children: `effort · ${entry.effort}` }, 'effort'))
  if (entry.agent !== undefined) tags.push(jsx('span', { children: entry.agent ? 'Agent' : 'Local' }, 'agent'))
  if (entry.algorithm !== undefined) tags.push(jsx('span', { children: entry.algorithm }, 'algorithm'))
  for (const provider of entry.providers) tags.push(jsx('span', { children: provider }, `provider:${provider}`))
  return tags
}

function MemoryEntryRow({ entry }: { readonly entry: MemoryEntry }): ReactElement {
  const date = new Date(entry.activity.createdAt)
  const tags = detailTags(entry)
  return jsxs('article', {
    className: 'dsh-fleet-memory-entry',
    'data-operation': entry.operation,
    children: [
      jsx('span', {
        className: 'dsh-fleet-memory-entry-icon',
        children: jsx(Icon, { name: entry.operation === 'stored' ? 'write' : 'recall', size: 16 }),
      }),
      jsxs('div', {
        className: 'dsh-fleet-memory-entry-body',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-memory-entry-title',
            children: [
              jsx('strong', { children: entry.operation === 'stored' ? '写入' : '召回' }),
              entry.count !== undefined && jsx('span', { children: `${String(entry.count)} 条` }),
            ],
          }),
          jsx('p', { children: entry.activity.text }),
          tags.length > 0 && jsx('div', { className: 'dsh-fleet-memory-entry-tags', children: tags }),
        ],
      }),
      jsxs('time', {
        className: 'dsh-fleet-memory-entry-time',
        dateTime: entry.activity.createdAt,
        title: date.toLocaleString(),
        children: [
          jsx('span', { children: date.toLocaleDateString([], { month: '2-digit', day: '2-digit' }) }),
          jsx('span', { children: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
        ],
      }),
    ],
  })
}

function MemoryMain(owner: FleetPaneOwner): ReactElement {
  const [query, setQuery] = useState('')
  const filter = activeFilter(owner.activeItem)
  const entries = useMemo(() => owner.snapshot.activity.flatMap(activity => {
    const entry = fleetMemoryEntry(activity)
    return entry === undefined ? [] : [entry]
  }).reverse(), [owner.snapshot.activity])
  const normalized = query.trim().toLocaleLowerCase()
  const visible = entries.filter(entry => (
    (filter === 'all' || entry.operation === filter)
      && (normalized === '' || [entry.activity.text, entry.member, entry.conversation, entry.algorithm, ...entry.providers]
        .some(value => value?.toLocaleLowerCase().includes(normalized) === true))
  ))
  const stored = entries.filter(entry => entry.operation === 'stored').length
  const recalled = entries.length - stored
  return jsxs('section', {
    className: 'dsh-fleet-memory-main',
    children: [
      jsxs('header', {
        className: 'dsh-fleet-memory-main-head',
        children: [
          jsxs('div', {
            className: 'dsh-fleet-memory-main-title',
            children: [
              jsx('h2', { children: '团队记忆' }),
              jsx('span', { children: `写入 ${String(stored)} · 召回 ${String(recalled)}` }),
            ],
          }),
          jsxs('label', {
            className: 'dsh-fleet-memory-search',
            children: [
              jsx(Icon, { name: 'search', size: 14 }),
              jsx('input', {
                type: 'search',
                value: query,
                'aria-label': '搜索团队记忆记录',
                placeholder: '搜索记忆记录',
                onChange: (event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value) },
              }),
            ],
          }),
        ],
      }),
      jsx('div', {
        className: 'dsh-fleet-memory-list',
        children: visible.length === 0
          ? jsx('div', {
              className: 'dsh-fleet-memory-empty',
              children: entries.length === 0
                ? '尚无有效团队记忆交互。实际写入或返回有效结果后会显示在这里。'
                : '当前筛选下没有记忆记录。',
            })
          : visible.map(entry => jsx(MemoryEntryRow, { entry }, entry.activity.id)),
      }),
    ],
  })
}

const styles = `
.dsh-fleet-memory-team-block{position:relative}
.dsh-fleet-memory-team-trigger{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:100%;color:var(--dsw-alias-label-primary);background:transparent;border:0;border-radius:10px;padding:0 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;text-align:left}
.dsh-fleet-memory-team-trigger:hover,.dsh-fleet-memory-team-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-fleet-memory-team-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.dsh-fleet-memory-team-trigger>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-fleet-memory-team-trigger[aria-expanded="true"]>svg{transform:rotate(180deg)}
.dsh-fleet-memory-team-menu{top:calc(100% + 6px);right:0;left:0;width:auto}
.dsh-fleet-memory-sidebar{min-height:0;flex:1}
.dsh-fleet-memory-sidebar-scroll{padding-top:12px}
.dsh-fleet-memory-main{width:100%;height:100%;min-width:0;min-height:0;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column}
.dsh-fleet-memory-main-head{box-sizing:border-box;min-height:64px;flex:none;padding:10px 18px;border-bottom:1px solid var(--dsw-alias-border-l3);display:flex;align-items:center;justify-content:space-between;gap:16px}
.dsh-fleet-memory-main-title{min-width:0;display:flex;align-items:baseline;gap:10px}.dsh-fleet-memory-main-title h2{margin:0;font-size:15px;font-weight:600;line-height:22px}.dsh-fleet-memory-main-title>span{color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dsh-fleet-memory-search{box-sizing:border-box;width:min(240px,36cqi);height:32px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-0);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 8px;display:flex;align-items:center;gap:6px}
.dsh-fleet-memory-search:focus-within{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 20%,transparent)}
.dsh-fleet-memory-search input{appearance:none;min-width:0;height:100%;flex:1;color:var(--dsw-alias-label-primary);background:transparent;border:0;outline:0;font:inherit;font-size:12px}.dsh-fleet-memory-search input::placeholder{color:var(--dsw-alias-label-caption)}.dsh-fleet-memory-search input::-webkit-search-cancel-button{display:none}
.dsh-fleet-memory-list{min-height:0;flex:1;padding:4px 18px 18px;overflow:auto;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--dsw-alias-label-caption) 35%,transparent) transparent}
.dsh-fleet-memory-entry{box-sizing:border-box;grid-template-columns:28px minmax(0,1fr) max-content;gap:10px;padding:14px 2px;border-bottom:1px solid var(--dsw-alias-border-l3);display:grid}
.dsh-fleet-memory-entry-icon{width:28px;height:28px;margin-top:1px;color:#8060ae;background:color-mix(in srgb,#8b6bbd 11%,transparent);border-radius:8px;display:inline-flex;align-items:center;justify-content:center}.dsh-fleet-memory-entry[data-operation="stored"] .dsh-fleet-memory-entry-icon{color:var(--dsw-alias-state-success-primary,#3f8b68);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#3f8b68) 11%,transparent)}
.dsh-fleet-memory-entry-body{min-width:0}.dsh-fleet-memory-entry-title{min-width:0;margin-bottom:3px;display:flex;align-items:baseline;gap:7px}.dsh-fleet-memory-entry-title strong{font-size:12px;font-weight:600}.dsh-fleet-memory-entry-title>span{color:var(--dsw-alias-label-caption);font-size:10px;font-variant-numeric:tabular-nums}
.dsh-fleet-memory-entry-body p{max-width:75ch;margin:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;overflow-wrap:anywhere}
.dsh-fleet-memory-entry-tags{margin-top:7px;display:flex;flex-wrap:wrap;gap:5px}.dsh-fleet-memory-entry-tags>span{max-width:240px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:5px;padding:1px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:17px}
.dsh-fleet-memory-entry-time{color:var(--dsw-alias-label-caption);display:flex;flex-direction:column;align-items:flex-end;font-size:10px;line-height:15px;font-variant-numeric:tabular-nums}
.dsh-fleet-memory-empty{box-sizing:border-box;min-height:180px;color:var(--dsw-alias-label-secondary);padding:28px;display:grid;place-items:center;text-align:center;font-size:12px;line-height:18px}
@container(max-width:560px){.dsh-fleet-memory-main-head{align-items:flex-start;flex-direction:column;gap:8px}.dsh-fleet-memory-search{width:100%}.dsh-fleet-memory-entry{grid-template-columns:28px minmax(0,1fr)}.dsh-fleet-memory-entry-time{grid-column:2;align-items:flex-start;flex-direction:row;gap:5px}}
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

export const name = 'dsh-fleet-patchouli'
export const inject = ['slots'] as const

export function apply(ctx: ClientContext): void {
  installStyles()
  ctx.slots.inject('fleet.panel.tool', () => ctx.slots.register({
    name: 'fleet.panel.tool', id: TOOL_ID, order: 37,
  }, MemoryTool))
  ctx.slots.inject('fleet.panel.sidebar', () => ctx.slots.register({
    name: 'fleet.panel.sidebar', key: TOOL_ID,
  }, MemorySidebar))
  ctx.slots.inject('fleet.panel.main', () => ctx.slots.register({
    name: 'fleet.panel.main', key: TOOL_ID,
  }, MemoryMain))
}
