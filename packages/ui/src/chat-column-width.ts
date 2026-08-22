import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { useRef, useState } from 'react'

export const FLEET_PANEL_PREFERENCES_KEY = 'dsh-agent-fleet.panel-preferences.v1'
export const FLEET_CHAT_COLUMN_DEFAULT_WIDTH = 760
export const FLEET_CHAT_COLUMN_MIN_WIDTH = 360
export const FLEET_CHAT_COLUMN_MAX_WIDTH = 1600

function boundedWidth(width: number): number {
  return Math.min(FLEET_CHAT_COLUMN_MAX_WIDTH, Math.max(FLEET_CHAT_COLUMN_MIN_WIDTH, Math.round(width)))
}

function storedPreferences(): Record<string, unknown> {
  if (typeof window === 'undefined') return {}
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(FLEET_PANEL_PREFERENCES_KEY) ?? '{}')
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function readFleetChatColumnWidth(): number {
  const value = storedPreferences().chatColumnWidth
  return typeof value === 'number' && Number.isFinite(value)
    ? boundedWidth(value)
    : FLEET_CHAT_COLUMN_DEFAULT_WIDTH
}

export function writeFleetChatColumnWidth(width: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FLEET_PANEL_PREFERENCES_KEY, JSON.stringify({
      ...storedPreferences(),
      chatColumnWidth: boundedWidth(width),
    }))
  } catch {}
}

export function useFleetChatColumnWidth(
  container: RefObject<HTMLElement>,
  initialWidth = readFleetChatColumnWidth,
  commit = writeFleetChatColumnWidth,
): {
  readonly width: number
  readonly resizing: boolean
  readonly handle: {
    readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
    readonly onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
    readonly onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void
    readonly onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void
    readonly onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void
    readonly onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void
  }
} {
  const [width, setWidth] = useState(initialWidth)
  const [resizing, setResizing] = useState(false)
  const drag = useRef<{
    readonly pointerId: number
    readonly startX: number
    readonly startWidth: number
    width: number
    readonly minWidth: number
    readonly maxWidth: number
  } | null>(null)

  const limits = (): { readonly minWidth: number; readonly maxWidth: number } => {
    const available = container.current?.clientWidth ?? FLEET_CHAT_COLUMN_MAX_WIDTH
    const maxWidth = Math.min(FLEET_CHAT_COLUMN_MAX_WIDTH, Math.max(0, available))
    return { minWidth: Math.min(FLEET_CHAT_COLUMN_MIN_WIDTH, maxWidth), maxWidth }
  }
  const update = (next: number, minWidth: number, maxWidth: number): number => {
    const bounded = Math.min(maxWidth, Math.max(minWidth, Math.round(next)))
    setWidth(bounded)
    return bounded
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const { minWidth, maxWidth } = limits()
    let next: number | undefined
    if (event.key === 'ArrowLeft') next = width - 32
    else if (event.key === 'ArrowRight') next = width + 32
    else if (event.key === 'Home') next = minWidth
    else if (event.key === 'End') next = maxWidth
    if (next === undefined) return
    event.preventDefault()
    commit(update(next, minWidth, maxWidth))
  }
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const { minWidth, maxWidth } = limits()
    const startWidth = Math.min(maxWidth, Math.max(minWidth, width))
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      width: startWidth,
      minWidth,
      maxWidth,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizing(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>): void => {
    const current = drag.current
    if (current === null || current.pointerId !== event.pointerId) return
    current.width = update(
      current.startWidth + (event.clientX - current.startX) * 2,
      current.minWidth,
      current.maxWidth,
    )
  }
  const finish = (event: PointerEvent<HTMLButtonElement>): void => {
    const current = drag.current
    if (current === null || current.pointerId !== event.pointerId) return
    drag.current = null
    setResizing(false)
    commit(current.width)
  }

  return {
    width,
    resizing,
    handle: {
      onKeyDown,
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
    },
  }
}
