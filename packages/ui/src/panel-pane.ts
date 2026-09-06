import type { KeyboardEvent, PointerEvent, ReactElement } from 'react'
import { useCallback, useRef, useState } from 'react'
import { jsx } from 'react/jsx-runtime'
import { panelText } from './panel-utils.js'

// ──────────────────────────────────────────
// Layout constants
// ──────────────────────────────────────────

/** Default sidebar width in px. */
export const SIDEBAR_DEFAULT_WIDTH = 232

/** Minimum sidebar width in px. */
export const SIDEBAR_MIN_WIDTH = 196

/** Maximum sidebar width in px. */
export const SIDEBAR_MAX_WIDTH = 360

/** Minimum main content width in px. */
export const MAIN_MIN_WIDTH = 360

// ──────────────────────────────────────────
// Resize controls API
// ──────────────────────────────────────────

export interface PaneResizeControls {
  readonly resizing: boolean
  readonly availableWidth: (handle: HTMLDivElement) => number
  readonly startResize: (event: PointerEvent<HTMLDivElement>) => void
  readonly moveResize: (event: PointerEvent<HTMLDivElement>) => void
  readonly stopResize: (event: PointerEvent<HTMLDivElement>) => void
  readonly resizeWithKeyboard: (event: KeyboardEvent<HTMLDivElement>) => void
  readonly resetWidth: () => void
  readonly onLostPointerCapture: () => void
}

// ──────────────────────────────────────────
// Hook: manages sidebar resize state machine
// ──────────────────────────────────────────

export function usePaneResize(
  width: number,
  setWidth: (width: number) => void,
): PaneResizeControls {
  const widthRef = useRef(width)
  widthRef.current = width

  const resizeRef = useRef<{
    readonly pointerId: number
    readonly startX: number
    readonly startWidth: number
    readonly maxWidth: number
  } | null>(null)

  const [resizing, setResizing] = useState(false)

  const availableWidth = useCallback((handle: HTMLDivElement): number => {
    const panelWidth = handle.parentElement?.getBoundingClientRect().width ?? 0
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(
      SIDEBAR_MAX_WIDTH,
      panelWidth - 54 - MAIN_MIN_WIDTH - 16,
    ))
  }, [])

  const resizeWidth = useCallback((nextWidth: number, maxWidth: number): void => {
    setWidth(Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, Math.round(nextWidth))))
  }, [setWidth])

  const startResize = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const maxWidth = availableWidth(event.currentTarget)
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
      maxWidth,
    }
    setResizing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [availableWidth])

  const moveResize = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current
    if (resize === null || resize.pointerId !== event.pointerId) return
    resizeWidth(resize.startWidth + event.clientX - resize.startX, resize.maxWidth)
  }, [resizeWidth])

  const stopResize = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (resizeRef.current?.pointerId !== event.pointerId) return
    resizeRef.current = null
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const resizeWithKeyboard = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 32 : 16
    if (event.key === 'ArrowLeft') {
      resizeWidth(widthRef.current - step, availableWidth(event.currentTarget))
    } else if (event.key === 'ArrowRight') {
      resizeWidth(widthRef.current + step, availableWidth(event.currentTarget))
    } else if (event.key === 'Home') {
      resizeWidth(SIDEBAR_MIN_WIDTH, availableWidth(event.currentTarget))
    } else if (event.key === 'End') {
      resizeWidth(SIDEBAR_MAX_WIDTH, availableWidth(event.currentTarget))
    } else {
      return
    }
    event.preventDefault()
  }, [availableWidth, resizeWidth])

  const resetWidth = useCallback((): void => {
    setWidth(SIDEBAR_DEFAULT_WIDTH)
  }, [setWidth])

  const onLostPointerCapture = useCallback((): void => {
    resizeRef.current = null
    setResizing(false)
  }, [])

  return {
    resizing,
    availableWidth,
    startResize,
    moveResize,
    stopResize,
    resizeWithKeyboard,
    resetWidth,
    onLostPointerCapture,
  }
}

// ──────────────────────────────────────────
// Component: sidebar resize handle
// ──────────────────────────────────────────

export interface PaneResizeHandleProps {
  readonly width: number
  readonly resizing: boolean
  readonly startResize: (event: PointerEvent<HTMLDivElement>) => void
  readonly moveResize: (event: PointerEvent<HTMLDivElement>) => void
  readonly stopResize: (event: PointerEvent<HTMLDivElement>) => void
  readonly resizeWithKeyboard: (event: KeyboardEvent<HTMLDivElement>) => void
  readonly resetWidth: () => void
  readonly onLostPointerCapture: () => void
}

export function PaneResizeHandle({
  width,
  resizing,
  startResize,
  moveResize,
  stopResize,
  resizeWithKeyboard,
  resetWidth,
  onLostPointerCapture,
}: PaneResizeHandleProps): ReactElement {
  return jsx('div', {
    className: 'dsh-fleet-panel-resize-handle',
    'data-resizing': resizing ? 'true' : 'false',
    role: 'separator',
    'aria-label': panelText('调整侧边栏宽度', 'Resize sidebar'),
    'aria-orientation': 'vertical',
    'aria-valuemin': SIDEBAR_MIN_WIDTH,
    'aria-valuemax': SIDEBAR_MAX_WIDTH,
    'aria-valuenow': width,
    tabIndex: 0,
    title: panelText('拖动调整侧边栏宽度；双击恢复默认', 'Drag to resize the sidebar; double-click to restore the default'),
    onPointerDown: startResize,
    onPointerMove: moveResize,
    onPointerUp: stopResize,
    onPointerCancel: stopResize,
    onLostPointerCapture,
    onDoubleClick: resetWidth,
    onKeyDown: resizeWithKeyboard,
  })
}