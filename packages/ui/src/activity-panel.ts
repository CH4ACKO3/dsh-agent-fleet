import type { CSSProperties, ReactElement, ReactNode, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { panelText } from './panel-utils.js'
import { PanelIcon } from './panel-icons.js'
import { DetailShell } from './pane-body.js'
import type {
  FleetPanelPaneOwner,
  FleetPanelActivity,
} from './team-panel.js'

// ──────────────────────────────────────────
// Activity window & timeline constants
// ──────────────────────────────────────────

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

// ──────────────────────────────────────────
// Timeline interval types
// ──────────────────────────────────────────

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

export interface FleetActivityWindow {
  readonly start: number
  readonly end: number
}

export interface FleetActivityGroup {
  readonly key: string
  readonly type: string
  readonly items: readonly [FleetPanelActivity, ...FleetPanelActivity[]]
}

interface FleetTimelineTick {
  readonly timestamp: number
  readonly position: number
  readonly strength: number
  readonly opacity: number
}

type FleetActivityPendingPosition =
  | { readonly kind: 'jump'; readonly key: string; readonly behavior: ScrollBehavior }
  | { readonly kind: 'preserve'; readonly key: string; readonly top: number }

// ──────────────────────────────────────────
// Timeline intervals data
// ──────────────────────────────────────────

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

// ──────────────────────────────────────────
// Timeline calculation helpers
// ──────────────────────────────────────────

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

// ──────────────────────────────────────────
// Activity window helpers
// ──────────────────────────────────────────

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

// ──────────────────────────────────────────
// Activity grouping helpers
// ──────────────────────────────────────────

export function fleetActivityViewPosition(
  groups: readonly FleetActivityGroup[],
  currentTime: number,
): FleetActivityViewPosition | undefined {
  if (groups.length === 0) return undefined
  const index = nearestFleetActivityGroupIndex(groups, currentTime)
  const group = groups[index]
  const timestamp = fleetActivityGroupCenter(group)
  if (group === undefined || timestamp === undefined) return undefined
  return { key: group.key, timestamp, window: fleetActivityWindow(groups.length, index) }
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

// ──────────────────────────────────────────
// Activity label helpers
// ──────────────────────────────────────────

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

// ──────────────────────────────────────────
// Activity components
// ──────────────────────────────────────────

export interface FleetActivityViewPosition {
  readonly key: string
  readonly timestamp: number
  readonly window: FleetActivityWindow
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

export function ActivityMain(owner: FleetPanelPaneOwner): ReactElement {
  const activity = owner.activeItem === 'all'
    ? owner.snapshot.activity
    : owner.snapshot.activity.filter(item => item.kind === owner.activeItem)
  const groups = fleetActivityGroups(activity, owner.activeItem === 'all')
  const groupKeys = groups.map(group => group.key).join('\u0000')
  const activityViewKey = `${owner.snapshot.teamId}\u0000${owner.activeItem}`
  const activityScrollRef = useRef<HTMLDivElement>(null)
  const activityNodes = useRef(new Map<string, HTMLElement>())
  const pendingPosition = useRef<FleetActivityPendingPosition | undefined>(groups.at(-1) === undefined
    ? undefined
    : { kind: 'jump', key: groups.at(-1)!.key, behavior: 'auto' })
  const previousLastTimestamp = useRef(fleetActivityGroupEnd(groups.at(-1)))
  const previousActivityView = useRef(activityViewKey)
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

  useLayoutEffect(() => {
    const viewChanged = previousActivityView.current !== activityViewKey
    previousActivityView.current = activityViewKey
    const previousLast = previousLastTimestamp.current
    const latestTimestamp = fleetActivityGroupEnd(groups.at(-1))
    previousLastTimestamp.current = latestTimestamp
    if (groups.length === 0) {
      pendingPosition.current = undefined
      timelineDrivingActivity.current = false
      setVisibleWindow({ start: 0, end: 0 })
      return
    }
    if (viewChanged) {
      const position = fleetActivityViewPosition(groups, currentTime)
      if (position === undefined) return
      timelineDrivingActivity.current = true
      pendingPosition.current = { kind: 'jump', key: position.key, behavior: 'auto' }
      setCurrentTime(position.timestamp)
      setVisibleWindow(position.window)
      return
    }
    if (previousLast !== undefined && currentTime !== previousLast) return
    const latestIndex = groups.length - 1
    const latest = groups[latestIndex]
    if (latest === undefined || latestTimestamp === undefined) return
    timelineDrivingActivity.current = true
    pendingPosition.current = { kind: 'jump', key: latest.key, behavior: 'auto' }
    setCurrentTime(latestTimestamp)
    setVisibleWindow(fleetActivityWindow(groups.length, latestIndex))
  }, [activityViewKey, groupKeys])

  useEffect(() => {
    const visibleKeys = new Set(visibleGroups.map(group => group.key))
    setExpandedGroups(current => {
      const retained = new Set([...current].filter(key => visibleKeys.has(key)))
      return retained.size === current.size ? current : retained
    })
  }, [groupKeys, visibleWindow.start, visibleWindow.end])

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
  }, [activityViewKey, groupKeys, visibleWindow.start, visibleWindow.end])

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

  const zoomTimelineByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
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
