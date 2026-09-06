import type { CSSProperties, KeyboardEvent, PointerEvent, ReactElement, ReactNode } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import {
  FLEET_CHAT_COLUMN_MAX_WIDTH as CHAT_COLUMN_MAX_WIDTH,
  FLEET_CHAT_COLUMN_MIN_WIDTH as CHAT_COLUMN_MIN_WIDTH,
  useFleetChatColumnWidth,
} from './chat-column-width.js'
import { PanelIcon } from './panel-icons.js'
import { panelText } from './panel-utils.js'

// ──────────────────────────────────────────
// Shared scroll-position helpers
// ──────────────────────────────────────────

const MAX_REMEMBERED_PANEL_POSITIONS = 64

export function rememberBounded<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX_REMEMBERED_PANEL_POSITIONS) {
    const oldest = map.keys().next().value as Key | undefined
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

interface FleetChatScrollState {
  readonly top: number
  readonly atBottom: boolean
}

const panelChatScroll = new Map<string, FleetChatScrollState>()
const panelChatMessageCounts = new Map<string, number>()

function nearChatBottom(node: HTMLDivElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= 40
}

// ──────────────────────────────────────────
// Resize handle
// ──────────────────────────────────────────

interface PanelColumnResizeHandleProps {
  readonly label: string
  readonly title: string
  readonly resizing: boolean
  readonly min: number
  readonly max: number
  readonly value: number
  readonly placement?: 'edge' | 'split'
  readonly handle: {
    readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
    readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
    readonly onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
    readonly onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
    readonly onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
    readonly onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void
  }
  readonly onDoubleClick?: () => void
}

function PanelColumnResizeHandle({
  label,
  title,
  resizing,
  min,
  max,
  value,
  placement = 'edge',
  handle,
  onDoubleClick,
}: PanelColumnResizeHandleProps): ReactElement {
  const interaction = {
    'data-dragging': resizing ? 'true' : undefined,
    role: 'separator',
    'aria-label': label,
    'aria-orientation': 'vertical' as const,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-valuenow': value,
    tabIndex: 0,
    title,
    ...handle,
    onDoubleClick,
  }
  if (placement === 'split') {
    return jsx('div', {
      className: 'dsh-fleet-panel-resource-compare-resize-track',
      ...interaction,
      children: jsx('span', {
        className: 'dsh-fleet-panel-chat-width-handle',
        'aria-hidden': 'true',
      }),
    })
  }
  return jsx('div', {
    className: 'dsh-fleet-panel-chat-width-handle',
    'data-placement': placement,
    ...interaction,
  })
}

// ──────────────────────────────────────────
// Message log component
// ──────────────────────────────────────────

function PanelMessageLog({
  conversationKey,
  messageCount,
  children,
  resizable = false,
  resizeLabel = panelText('调整消息区域宽度', 'Resize message area'),
  initialScroll = 'bottom',
  hasOlder = false,
  loadingOlder = false,
  loadOlder,
}: {
  readonly conversationKey: string
  readonly messageCount: number
  readonly children: ReactNode
  readonly resizable?: boolean
  readonly resizeLabel?: string
  readonly initialScroll?: 'top' | 'bottom'
  readonly hasOlder?: boolean
  readonly loadingOlder?: boolean
  readonly loadOlder?: () => Promise<void>
}): ReactElement {
  const log = useRef<HTMLDivElement>(null)
  const renderedConversation = useRef<string>()
  const atBottom = useRef(true)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const prepend = useRef<{ readonly height: number; readonly top: number }>()
  const column = useFleetChatColumnWidth(log)

  const rememberScroll = (): void => {
    const node = log.current
    if (node === null) return
    const nextAtBottom = nearChatBottom(node)
    atBottom.current = nextAtBottom
    rememberBounded(panelChatScroll, conversationKey, { top: node.scrollTop, atBottom: nextAtBottom })
    if (nextAtBottom) setHasNewMessages(false)
    if (node.scrollTop <= 72 && hasOlder && !loadingOlder && loadOlder !== undefined) {
      prepend.current = { height: node.scrollHeight, top: node.scrollTop }
      void loadOlder()
    }
  }
  const scrollToLatest = (): void => {
    const node = log.current
    if (node === null) return
    node.scrollTop = node.scrollHeight
    atBottom.current = true
    rememberBounded(panelChatScroll, conversationKey, { top: node.scrollTop, atBottom: true })
    setHasNewMessages(false)
  }

  useLayoutEffect(() => {
    const node = log.current
    if (node === null) return
    const changedConversation = renderedConversation.current !== conversationKey
    const previousCount = panelChatMessageCounts.get(conversationKey)
    if (changedConversation) {
      renderedConversation.current = conversationKey
      const saved = panelChatScroll.get(conversationKey)
      node.scrollTop = saved?.atBottom === false
        ? saved.top
        : saved === undefined && initialScroll === 'top' ? 0 : node.scrollHeight
      atBottom.current = nearChatBottom(node)
      setHasNewMessages(false)
    } else if (previousCount !== undefined && messageCount > previousCount) {
      if (prepend.current !== undefined) {
        node.scrollTop = prepend.current.top + node.scrollHeight - prepend.current.height
        prepend.current = undefined
        atBottom.current = false
      } else if (atBottom.current) scrollToLatest()
      else setHasNewMessages(true)
    } else if (!loadingOlder) {
      prepend.current = undefined
    }
    rememberBounded(panelChatMessageCounts, conversationKey, messageCount)
  }, [conversationKey, initialScroll, loadingOlder, messageCount])

  useLayoutEffect(() => {
    const node = log.current
    if (node === null || !hasOlder || loadingOlder || loadOlder === undefined) return
    if (node.scrollHeight > node.clientHeight + 1) return
    prepend.current = { height: node.scrollHeight, top: node.scrollTop }
    void loadOlder()
  }, [conversationKey, hasOlder, loadOlder, loadingOlder, messageCount])

  return jsxs('div', {
    className: 'dsh-fleet-panel-chat-log-wrap',
    'data-column-resizing': column.resizing ? 'true' : undefined,
    style: resizable
      ? { '--dsh-fleet-panel-chat-column-width': `${column.width}px` } as CSSProperties
      : undefined,
    children: [
      jsx('div', {
        ref: log,
        className: 'dsh-fleet-panel-chat-log',
        onScroll: rememberScroll,
        children,
      }),
      loadingOlder && jsx('div', {
        className: 'dsh-fleet-panel-chat-history-loading',
        role: 'status',
        children: panelText('正在加载更早消息…', 'Loading earlier messages…'),
      }),
      resizable && jsx(PanelColumnResizeHandle, {
        label: resizeLabel,
        title: panelText(`拖动${resizeLabel}`, `Drag to resize ${resizeLabel}`),
        resizing: column.resizing,
        min: CHAT_COLUMN_MIN_WIDTH,
        max: CHAT_COLUMN_MAX_WIDTH,
        value: column.width,
        handle: column.handle,
      }),
      hasNewMessages && jsxs('button', {
        type: 'button',
        className: 'dsh-fleet-panel-chat-new-messages',
        onClick: scrollToLatest,
        children: [
          jsx(PanelIcon, { name: 'chevron', size: 12 }),
          jsx('span', { children: panelText('查看新消息', 'View new messages') }),
        ],
      }),
    ],
  })
}

export { PanelColumnResizeHandle, PanelMessageLog }