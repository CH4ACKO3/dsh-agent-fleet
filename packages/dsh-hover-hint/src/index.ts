import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { HoverHintStack } from './hint-stack.js'
import { currentHoverHintLocale, resolveHoverHintLocaleCopy, subscribeHoverHintLocale } from './locale.js'
import { hasSeenHint, markHintSeen, subscribeSeenHints } from './seen-marker.js'

const STYLE_ID = 'dsh-hover-hint-style'
const HOVER_DELAY_MS = 300
const CHARGE_DURATION_MS = 500
const SEEN_CHARGE_DURATION_MS = 2_200
const openHints = new HoverHintStack()

const styles = `
@property --dsh-hover-hint-progress {
  syntax: '<number>';
  inherits: false;
  initial-value: 0;
}

.dsh-hover-hint {
  min-width: 0;
  display: inline-flex;
  position: relative;
}

.dsh-hover-hint-ring {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  pointer-events: none;
  position: absolute;
  inset: 0;
  overflow: visible;
}

.dsh-hover-hint-ring-progress {
  --dsh-hover-hint-progress: 0;
  width: 100%;
  height: 100%;
  background: conic-gradient(
    from -90deg,
    var(--dsw-alias-state-business-primary) 0turn,
    var(--dsw-alias-state-business-primary) calc(var(--dsh-hover-hint-progress) * 1turn),
    transparent calc(var(--dsh-hover-hint-progress) * 1turn),
    transparent 1turn
  );
  border-radius: 50%;
  position: absolute;
  inset: 0;
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
  transition: --dsh-hover-hint-progress var(--dsh-hover-hint-charge-duration, ${String(CHARGE_DURATION_MS)}ms) linear;
}

.dsh-hover-hint[data-phase="charging"] .dsh-hover-hint-ring-progress,
.dsh-hover-hint[data-phase="holding"] .dsh-hover-hint-ring-progress {
  --dsh-hover-hint-progress: 1;
}

.dsh-hover-hint[data-phase="draining"] .dsh-hover-hint-ring-progress {
  --dsh-hover-hint-progress: 0;
  transition-duration: 220ms;
  transition-timing-function: cubic-bezier(.16, 1, .3, 1);
}

.dsh-hover-hint-trigger-ring {
  right: auto;
  bottom: auto;
  left: var(--dsh-hover-hint-pointer-x, 0);
  top: var(--dsh-hover-hint-pointer-y, 0);
  opacity: 0;
  background: transparent;
  border: 0;
  margin: 0;
  padding: 0;
  position: fixed;
  transform: translate(10px, 10px);
  transition: opacity 100ms ease-out;
}

.dsh-hover-hint:not([data-phase="idle"]):not([data-revealed="true"])
.dsh-hover-hint-trigger-ring {
  opacity: 1;
}

.dsh-hover-hint-bubble {
  box-sizing: border-box;
  z-index: 1500;
  width: min(288px, calc(100vw - 24px));
  height: auto;
  max-height: min(320px, calc(100dvh - 24px));
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 12px;
  box-shadow: 0 16px 42px rgb(24 39 57 / 18%), 0 3px 10px rgb(24 39 57 / 8%);
  padding: 0;
  margin: 0;
  font: var(--dsw-font-xs-13);
  font-size: 12px;
  line-height: 18px;
  grid-template-rows: auto minmax(0, 1fr) auto;
  display: grid;
  position: fixed;
  inset: auto;
  overflow: visible;
  opacity: 0;
  transform: translateY(-2px) scale(.985);
  transform-origin: var(--dsh-hover-hint-arrow-left, 18px) top;
  animation: dsh-hover-hint-enter 180ms cubic-bezier(.16, 1, .3, 1) forwards;
}

.dsh-hover-hint-bubble::backdrop {
  background: transparent;
}

.dsh-hover-hint-bubble[data-side="top"] {
  transform-origin: var(--dsh-hover-hint-arrow-left, 18px) bottom;
}

.dsh-hover-hint-bubble::before {
  width: 8px;
  height: 8px;
  background: var(--dsw-alias-bg-layer-2);
  border-top: 1px solid var(--dsw-alias-border-l3);
  border-left: 1px solid var(--dsw-alias-border-l3);
  content: '';
  position: absolute;
  left: calc(var(--dsh-hover-hint-arrow-left, 18px) - 4px);
  top: -5px;
  transform: rotate(45deg);
}

.dsh-hover-hint-bubble[data-side="top"]::before {
  top: auto;
  bottom: -5px;
  transform: rotate(225deg);
}

.dsh-hover-hint-header {
  min-width: 0;
  min-height: 0;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  gap: 8px;
  padding: 7px 8px 7px 12px;
  display: flex;
}

.dsh-hover-hint-title {
  min-width: 0;
  flex: 1;
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-s-strong-14);
  font-size: 13px;
  line-height: 20px;
}

.dsh-hover-hint-close {
  width: 24px;
  height: 24px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 0;
  flex: none;
  place-items: center;
  display: grid;
}

.dsh-hover-hint-close:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-hover-hint-close:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-hover-hint-body {
  min-height: 0;
  padding: 12px 14px 14px;
  overflow: auto;
  scrollbar-color: var(--dsw-alias-border-l2) transparent;
  scrollbar-width: thin;
}

.dsh-hover-hint-body > :first-child {
  margin-top: 0;
}

.dsh-hover-hint-body > :last-child {
  margin-bottom: 0;
}

.dsh-hover-hint-lead {
  margin: 0 0 12px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
}

.dsh-hover-hint-section + .dsh-hover-hint-section {
  margin-top: 14px;
}

.dsh-hover-hint-section h4 {
  margin: 0 0 5px;
  color: var(--dsw-alias-label-primary);
  font: var(--dsw-font-xs-strong-13, var(--dsw-font-xs-13));
  font-size: 12px;
  line-height: 18px;
}

.dsh-hover-hint-section p,
.dsh-hover-hint-section ul {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
}

.dsh-hover-hint-section ul {
  padding-left: 17px;
}

.dsh-hover-hint-section li + li {
  margin-top: 3px;
}

.dsh-hover-hint-footer {
  min-height: 0;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  border-top: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  padding: 7px 12px;
  font-size: 11px;
  line-height: 16px;
  display: flex;
}

@keyframes dsh-hover-hint-enter {
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-hover-hint-bubble {
    animation-duration: 100ms;
    transform: none;
  }
}
`

export function installHoverHintStyles(): void {
  if (typeof document === 'undefined') return
  let style = document.getElementById(STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.append(style)
  }
  if (style.textContent !== styles) style.textContent = styles
}

if (typeof document !== 'undefined') installHoverHintStyles()

type HoverHintPhase = 'idle' | 'charging' | 'holding' | 'draining'

interface HoverHintPosition extends CSSProperties {
  readonly '--dsh-hover-hint-arrow-left': string
}

export interface HoverHintProps {
  readonly label: string
  readonly title: string
  readonly className?: string
  /** Render the host-owned trigger. Spread every supplied prop onto its focusable root element. */
  readonly trigger: (props: HoverHintTriggerProps) => ReactElement
  readonly children: ReactNode
  readonly footer?: ReactNode
  readonly closeLabel?: string
  readonly locale?: string
  /** Persistently marks this hint as seen after the pointer enters its open panel. */
  readonly seenMarker?: string
  /** Delay before the loading ring starts when the hint has not been seen. */
  readonly firstHoverDelayMs?: number
  /** Loading-ring duration when the hint has not been seen. */
  readonly firstChargeDurationMs?: number
  /** Delay before the loading ring starts for a previously seen hint. */
  readonly seenHoverDelayMs?: number
  /** Loading-ring duration for a previously seen hint. */
  readonly seenChargeDurationMs?: number
  /** Disable click-to-pin when the host control already owns its click interaction. */
  readonly pinOnClick?: boolean
}

export interface HoverHintTriggerProps {
  readonly ref: (element: HTMLElement | null) => void
  readonly 'aria-label'?: string
  readonly 'aria-haspopup'?: 'dialog'
  readonly 'aria-expanded'?: 'true' | 'false'
  readonly 'aria-controls'?: string
  readonly onClick?: (event: MouseEvent<HTMLElement>) => void
}

export function HoverHint({
  label,
  title,
  className,
  trigger,
  children,
  footer,
  closeLabel,
  locale,
  seenMarker,
  firstHoverDelayMs = HOVER_DELAY_MS,
  firstChargeDurationMs = CHARGE_DURATION_MS,
  seenHoverDelayMs = HOVER_DELAY_MS,
  seenChargeDurationMs = SEEN_CHARGE_DURATION_MS,
  pinOnClick = true,
}: HoverHintProps): ReactElement {
  const root = useRef<HTMLSpanElement>(null)
  const triggerElement = useRef<HTMLElement | null>(null)
  const triggerRing = useRef<HTMLSpanElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const delayTimer = useRef<number>()
  const phaseTimer = useRef<number>()
  const inside = useRef(false)
  const phaseValue = useRef<HoverHintPhase>('idle')
  const revealedValue = useRef(false)
  const pinnedValue = useRef(false)
  const seenValue = useRef(hasSeenHint(seenMarker))
  const [phase, setPhaseState] = useState<HoverHintPhase>('idle')
  const [revealed, setRevealedState] = useState(false)
  const [pinned, setPinnedState] = useState(false)
  const [seen, setSeenState] = useState(seenValue.current)
  const [position, setPosition] = useState<{ readonly side: 'top' | 'bottom'; readonly style: HoverHintPosition }>()
  const bubbleId = useId()
  const titleId = useId()
  const hintId = useId()
  const detectedLocale = useSyncExternalStore(subscribeHoverHintLocale, currentHoverHintLocale, () => 'en')
  const localeCopy = resolveHoverHintLocaleCopy(locale ?? detectedLocale)

  const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const clearDelay = (): void => {
    if (delayTimer.current !== undefined) window.clearTimeout(delayTimer.current)
    delayTimer.current = undefined
  }
  const clearPhaseTimer = (): void => {
    if (phaseTimer.current !== undefined) window.clearTimeout(phaseTimer.current)
    phaseTimer.current = undefined
  }
  const setPhase = (next: HoverHintPhase): void => {
    phaseValue.current = next
    setPhaseState(next)
  }
  const setRevealed = (next: boolean): void => {
    if (next) openHints.activate(hintId)
    else openHints.deactivate(hintId)
    revealedValue.current = next
    setRevealedState(next)
  }
  const setPinned = (next: boolean): void => {
    pinnedValue.current = next
    setPinnedState(next)
  }
  const setSeen = (next: boolean): void => {
    seenValue.current = next
    setSeenState(next)
  }
  const hide = (): void => {
    clearDelay()
    clearPhaseTimer()
    setPinned(false)
    setRevealed(false)
    setPhase('idle')
    setPosition(undefined)
  }
  const reveal = (pin = false): void => {
    clearDelay()
    clearPhaseTimer()
    setRevealed(true)
    setPinned(pin)
    setPhase('holding')
  }
  const prepareTriggerRing = (): void => {
    const node = triggerRing.current
    if (node === null || node.matches(':popover-open')) return
    node.showPopover()
    // Commit the empty ring before charging. A closed popover is display:none,
    // so opening it only after the phase change would skip the 0% frame.
    void node.offsetWidth
  }
  const charge = (duration = CHARGE_DURATION_MS): void => {
    clearDelay()
    clearPhaseTimer()
    root.current?.style.setProperty('--dsh-hover-hint-charge-duration', `${String(duration)}ms`)
    prepareTriggerRing()
    setPhase('charging')
    phaseTimer.current = window.setTimeout(() => {
      phaseTimer.current = undefined
      if (inside.current || pinnedValue.current) reveal(pinnedValue.current)
      else hide()
    }, duration)
  }
  const drain = (): void => {
    clearDelay()
    clearPhaseTimer()
    if (phaseValue.current === 'idle' && !revealedValue.current) return
    setPhase('draining')
    phaseTimer.current = window.setTimeout(() => {
      phaseTimer.current = undefined
      if (!inside.current && !pinnedValue.current) hide()
    }, reducedMotion() ? 110 : 240)
  }
  const trackPointer = (event: ReactPointerEvent<HTMLSpanElement>): void => {
    root.current?.style.setProperty('--dsh-hover-hint-pointer-x', `${String(event.clientX)}px`)
    root.current?.style.setProperty('--dsh-hover-hint-pointer-y', `${String(event.clientY)}px`)
  }
  const currentHoverDelay = (): number => seenValue.current ? seenHoverDelayMs : firstHoverDelayMs
  const currentChargeDuration = (): number => seenValue.current ? seenChargeDurationMs : firstChargeDurationMs

  useLayoutEffect(() => { installHoverHintStyles() }, [])

  const triggerRingVisible = phase !== 'idle' && !revealed
  useLayoutEffect(() => {
    const node = triggerRing.current
    if (node === null) return
    if (triggerRingVisible) {
      if (!node.matches(':popover-open')) node.showPopover()
      return
    }
    if (node.matches(':popover-open')) node.hidePopover()
  }, [triggerRingVisible])

  useEffect(() => {
    const syncSeen = (): void => { setSeen(hasSeenHint(seenMarker)) }
    syncSeen()
    return subscribeSeenHints(syncSeen)
  }, [seenMarker])

  useEffect(() => () => {
    clearDelay()
    clearPhaseTimer()
    openHints.deactivate(hintId)
  }, [])

  useEffect(() => {
    if (!revealed) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && root.current?.contains(target) === true) return
      if (!openHints.claimDismissal(hintId, event)) return
      setPinned(false)
      drain()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (!openHints.claimDismissal(hintId, event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      hide()
      triggerElement.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [revealed])

  const placeBubble = (): void => {
    const anchor = triggerElement.current?.getBoundingClientRect()
    const panel = bubble.current?.getBoundingClientRect()
    if (anchor === undefined || panel === undefined) return
    const viewportGutter = 12
    const gap = 9
    const left = Math.max(viewportGutter, Math.min(
      anchor.left + anchor.width / 2 - panel.width / 2 + 10,
      window.innerWidth - panel.width - viewportGutter,
    ))
    const fitsBelow = anchor.bottom + gap + panel.height <= window.innerHeight - viewportGutter
    const side = fitsBelow ? 'bottom' : 'top'
    const top = fitsBelow
      ? anchor.bottom + gap
      : Math.max(viewportGutter, anchor.top - panel.height - gap)
    const arrowLeft = Math.max(14, Math.min(panel.width - 14, anchor.left + anchor.width / 2 - left))
    setPosition({
      side,
      style: {
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        '--dsh-hover-hint-arrow-left': `${Math.round(arrowLeft)}px`,
      },
    })
  }

  useLayoutEffect(() => {
    const node = bubble.current
    if (!revealed || node === null) return
    if (!node.matches(':popover-open')) node.showPopover()
    placeBubble()
    return () => {
      if (node.matches(':popover-open')) node.hidePopover()
    }
  }, [revealed])

  useEffect(() => {
    if (!revealed) return
    const reposition = (): void => { placeBubble() }
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', reposition, true)
    }
  }, [revealed])

  return jsxs('span', {
    ref: root,
    className: className === undefined ? 'dsh-hover-hint' : `dsh-hover-hint ${className}`,
    'data-phase': phase,
    'data-revealed': revealed ? 'true' : undefined,
    'data-pinned': pinned ? 'true' : undefined,
    'data-seen': seen ? 'true' : undefined,
    onPointerEnter: (event: ReactPointerEvent<HTMLSpanElement>) => {
      trackPointer(event)
      inside.current = true
      clearPhaseTimer()
      if (pinnedValue.current || phaseValue.current === 'holding') return
      if (revealedValue.current || phaseValue.current === 'draining') {
        if (revealedValue.current) setPhase('holding')
        else charge(currentChargeDuration())
        return
      }
      if (phaseValue.current !== 'idle' || delayTimer.current !== undefined) return
      delayTimer.current = window.setTimeout(() => {
        delayTimer.current = undefined
        if (inside.current) charge(currentChargeDuration())
      }, currentHoverDelay())
    },
    onPointerMove: trackPointer,
    onPointerLeave: () => {
      inside.current = false
      if (pinnedValue.current) return
      if (phaseValue.current === 'idle') clearDelay()
      else drain()
    },
    onClickCapture: pinOnClick ? undefined : hide,
    children: [
      trigger(pinOnClick
        ? {
            ref: element => { triggerElement.current = element },
            'aria-label': label,
            'aria-haspopup': 'dialog',
            'aria-expanded': revealed ? 'true' : 'false',
            'aria-controls': bubbleId,
            onClick: (event: MouseEvent<HTMLElement>) => {
              event.stopPropagation()
              if (pinnedValue.current) {
                setPinned(false)
                if (inside.current) setPhase('holding')
                else drain()
              } else {
                reveal(true)
              }
            },
          }
        : { ref: element => { triggerElement.current = element } }),
      jsx('span', {
        ref: triggerRing,
        popover: 'manual',
        className: 'dsh-hover-hint-ring dsh-hover-hint-trigger-ring',
        'aria-hidden': 'true',
        children: jsx('span', { className: 'dsh-hover-hint-ring-progress' }),
      }),
      revealed && jsxs('span', {
        ref: bubble,
        id: bubbleId,
        popover: 'manual',
        role: 'dialog',
        'aria-labelledby': titleId,
        className: 'dsh-hover-hint-bubble',
        'data-side': position?.side ?? 'bottom',
        style: position?.style ?? { visibility: 'hidden' },
        onPointerEnter: () => {
          inside.current = true
          if (seenMarker !== undefined && !seenValue.current) {
            markHintSeen(seenMarker)
            setSeen(true)
          }
        },
        children: [
          jsxs('span', {
            className: 'dsh-hover-hint-header',
            children: [
              jsx('strong', { id: titleId, className: 'dsh-hover-hint-title', children: title }),
              jsx('button', {
                type: 'button',
                className: 'dsh-hover-hint-close',
                'aria-label': closeLabel ?? localeCopy.closeLabel,
                onClick: () => {
                  hide()
                  triggerElement.current?.focus()
                },
                children: jsx('svg', {
                  width: 14,
                  height: 14,
                  viewBox: '0 0 14 14',
                  fill: 'none',
                  'aria-hidden': 'true',
                  children: jsx('path', {
                    d: 'M3 3l8 8m0-8-8 8',
                    stroke: 'currentColor',
                    strokeWidth: 1.35,
                    strokeLinecap: 'round',
                  }),
                }),
              }),
            ],
          }),
          jsx('span', { className: 'dsh-hover-hint-body', children }),
          footer !== null && jsx('span', {
            className: 'dsh-hover-hint-footer',
            children: footer ?? localeCopy.footer,
          }),
        ],
      }),
    ],
  })
}
