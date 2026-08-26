import type { RefObject } from 'react'
import { useEffect, useId, useRef, useState } from 'react'

export type FleetPopoverPlacement = 'below-start' | 'below-end' | 'right'

export interface FleetAnchoredPopoverController {
  readonly popover: RefObject<HTMLElement>
  readonly popoverId: string
  readonly mounted: boolean
  readonly open: boolean
  readonly openAt: (anchor: Element, placement?: FleetPopoverPlacement) => void
  readonly close: () => void
  readonly toggleAt: (anchor: Element, placement?: FleetPopoverPlacement) => void
}

export function useFleetAnchoredPopover(
  defaultPlacement: FleetPopoverPlacement = 'below-start',
  gap = 8,
  onOpenChange?: (open: boolean) => void,
): FleetAnchoredPopoverController {
  const popover = useRef<HTMLElement>(null)
  const popoverId = useId()
  const openChange = useRef(onOpenChange)
  const activeAnchor = useRef<{
    readonly anchor: Element
    readonly placement: FleetPopoverPlacement
  }>()
  const pendingOpen = useRef<{
    readonly anchor: Element
    readonly placement: FleetPopoverPlacement
  }>()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  openChange.current = onOpenChange

  const showAt = (
    node: HTMLElement,
    anchorElement: Element,
    placement: FleetPopoverPlacement,
  ): void => {
    const anchor = anchorElement.getBoundingClientRect()
    node.style.visibility = 'hidden'
    if (!node.matches(':popover-open')) node.showPopover()
    const bounds = node.getBoundingClientRect()
    const gutter = 12
    const preferredLeft = placement === 'right'
      ? anchor.right + gap
      : placement === 'below-end' ? anchor.right - bounds.width : anchor.left
    const left = Math.max(gutter, Math.min(window.innerWidth - bounds.width - gutter, preferredLeft))
    const below = anchor.bottom + gap
    const preferredTop = placement === 'right'
      ? anchor.top
      : below + bounds.height <= window.innerHeight - gutter
        ? below
        : anchor.top - bounds.height - gap
    const top = Math.max(gutter, Math.min(window.innerHeight - bounds.height - gutter, preferredTop))
    node.style.left = `${Math.round(left)}px`
    node.style.top = `${Math.round(top)}px`
    node.style.visibility = ''
  }

  useEffect(() => {
    if (!mounted) return
    const node = popover.current
    if (node === null) return
    const syncOpen = (): void => {
      const next = node.matches(':popover-open')
      setOpen(next)
      if (!next) {
        activeAnchor.current = undefined
        setMounted(false)
      }
      openChange.current?.(next)
    }
    const closeOnViewportMove = (event: Event): void => {
      if (event.target instanceof Node && node.contains(event.target)) return
      if (node.matches(':popover-open')) node.hidePopover()
    }
    node.addEventListener('toggle', syncOpen)
    const resizeObserver = new ResizeObserver(() => {
      const active = activeAnchor.current
      if (active !== undefined && node.matches(':popover-open')) {
        showAt(node, active.anchor, active.placement)
      }
    })
    resizeObserver.observe(node)
    window.addEventListener('resize', closeOnViewportMove)
    document.addEventListener('scroll', closeOnViewportMove, true)
    const requested = pendingOpen.current
    if (requested !== undefined) {
      pendingOpen.current = undefined
      activeAnchor.current = requested
      showAt(node, requested.anchor, requested.placement)
    }
    return () => {
      node.removeEventListener('toggle', syncOpen)
      resizeObserver.disconnect()
      window.removeEventListener('resize', closeOnViewportMove)
      document.removeEventListener('scroll', closeOnViewportMove, true)
    }
  }, [mounted])

  const close = (): void => {
    pendingOpen.current = undefined
    activeAnchor.current = undefined
    const node = popover.current
    if (node?.matches(':popover-open') === true) node.hidePopover()
    else {
      setOpen(false)
      setMounted(false)
      if (open) openChange.current?.(false)
    }
  }
  const openAt = (anchorElement: Element, placement = defaultPlacement): void => {
    const requested = { anchor: anchorElement, placement }
    activeAnchor.current = requested
    const node = popover.current
    if (node !== null) {
      showAt(node, anchorElement, placement)
      return
    }
    pendingOpen.current = requested
    setMounted(true)
  }
  const toggleAt = (anchor: Element, placement = defaultPlacement): void => {
    if (open || popover.current?.matches(':popover-open') === true) close()
    else openAt(anchor, placement)
  }

  return { popover, popoverId, mounted, open, openAt, close, toggleAt }
}
