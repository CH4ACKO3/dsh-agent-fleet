import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { HoverHintStack } from './hint-stack.js'

const STYLE_ID = 'dsh-hover-hint-style'
const HOVER_DELAY_MS = 300
const CHARGE_DURATION_MS = 500
const openHints = new HoverHintStack()

const styles = `
.dsh-hover-hint {
  min-width: 0;
  display: inline-flex;
  position: relative;
}

.dsh-hover-hint-trigger {
  box-sizing: border-box;
  min-width: 0;
  color: inherit;
  cursor: help;
  background: transparent;
  border: 0;
  border-radius: 4px;
  padding: 0 18px 0 0;
  font: inherit;
  line-height: inherit;
  text-align: left;
  display: inline-flex;
  position: relative;
}

.dsh-hover-hint-trigger:hover,
.dsh-hover-hint[data-pinned="true"] .dsh-hover-hint-trigger {
  color: var(--dsw-alias-state-business-primary);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 42%, transparent);
  text-decoration-style: dotted;
  text-underline-offset: 3px;
}

.dsh-hover-hint[data-phase="charging"] .dsh-hover-hint-trigger {
  cursor: progress;
}

.dsh-hover-hint-trigger:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}

.dsh-hover-hint-ring {
  width: 14px;
  height: 14px;
  pointer-events: none;
  position: absolute;
  inset: 0;
  overflow: visible;
}

.dsh-hover-hint-ring-track,
.dsh-hover-hint-ring-progress {
  fill: none;
  vector-effect: non-scaling-stroke;
}

.dsh-hover-hint-ring-track {
  stroke: color-mix(in srgb, var(--dsw-alias-label-secondary) 24%, transparent);
  stroke-width: 1.2;
}

.dsh-hover-hint-ring-progress {
  stroke: var(--dsw-alias-state-business-primary);
  stroke-width: 1.45;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: center;
  transition: stroke-dashoffset ${String(CHARGE_DURATION_MS)}ms linear;
}

.dsh-hover-hint[data-phase="charging"] .dsh-hover-hint-ring-progress,
.dsh-hover-hint[data-phase="holding"] .dsh-hover-hint-ring-progress {
  stroke-dashoffset: 0;
}

.dsh-hover-hint[data-phase="draining"] .dsh-hover-hint-ring-progress {
  stroke-dashoffset: 1;
  transition-duration: 220ms;
  transition-timing-function: cubic-bezier(.16, 1, .3, 1);
}

.dsh-hover-hint-trigger-ring {
  right: 1px;
  left: auto;
  top: 50%;
  opacity: 0;
  background: transparent;
  transform: translateY(-50%);
  transition: opacity 100ms ease-out;
}

.dsh-hover-hint:not([data-phase="idle"]):not([data-revealed="true"])
.dsh-hover-hint-trigger-ring {
  opacity: 1;
}

.dsh-hover-hint-bubble {
  box-sizing: border-box;
  z-index: 1500;
  width: min(368px, calc(100vw - 24px));
  height: min(286px, calc(100dvh - 24px));
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
  min-height: 48px;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  gap: 10px;
  padding: 10px 12px 10px 14px;
  display: flex;
}

.dsh-hover-hint-status {
  box-sizing: border-box;
  width: 9px;
  height: 9px;
  border: 1.4px solid var(--dsw-alias-state-business-primary);
  border-radius: 50%;
  flex: none;
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
  width: 26px;
  height: 26px;
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
  padding: 14px 16px 16px;
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
  margin: 0 0 14px;
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
  min-height: 38px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  border-top: 1px solid var(--dsw-alias-border-l3);
  align-items: center;
  padding: 8px 14px;
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
  .dsh-hover-hint-ring-progress {
    transition-duration: 100ms;
  }

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
  readonly triggerContent: ReactNode
  readonly children: ReactNode
  readonly footer?: ReactNode
  readonly closeLabel?: string
}

function HoverHintRing({ className }: { readonly className: string }): ReactElement {
  return jsxs('svg', {
    className: `dsh-hover-hint-ring ${className}`,
    viewBox: '0 0 16 16',
    'aria-hidden': 'true',
    children: [
      jsx('circle', {
        className: 'dsh-hover-hint-ring-track',
        cx: 8,
        cy: 8,
        r: 6.25,
        pathLength: 1,
      }),
      jsx('circle', {
        className: 'dsh-hover-hint-ring-progress',
        cx: 8,
        cy: 8,
        r: 6.25,
        pathLength: 1,
      }),
    ],
  })
}

export function HoverHint({
  label,
  title,
  triggerContent,
  children,
  footer,
  closeLabel = '关闭说明',
}: HoverHintProps): ReactElement {
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const delayTimer = useRef<number>()
  const phaseTimer = useRef<number>()
  const inside = useRef(false)
  const phaseValue = useRef<HoverHintPhase>('idle')
  const revealedValue = useRef(false)
  const pinnedValue = useRef(false)
  const [phase, setPhaseState] = useState<HoverHintPhase>('idle')
  const [revealed, setRevealedState] = useState(false)
  const [pinned, setPinnedState] = useState(false)
  const [position, setPosition] = useState<{ readonly side: 'top' | 'bottom'; readonly style: HoverHintPosition }>()
  const bubbleId = useId()
  const titleId = useId()
  const hintId = useId()

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
  const charge = (): void => {
    clearDelay()
    clearPhaseTimer()
    setPhase('charging')
    phaseTimer.current = window.setTimeout(() => {
      phaseTimer.current = undefined
      if (inside.current || pinnedValue.current) reveal(pinnedValue.current)
      else hide()
    }, CHARGE_DURATION_MS)
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

  useLayoutEffect(() => { installHoverHintStyles() }, [])

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
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [revealed])

  const placeBubble = (): void => {
    const anchor = trigger.current?.getBoundingClientRect()
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
    className: 'dsh-hover-hint',
    'data-phase': phase,
    'data-revealed': revealed ? 'true' : undefined,
    'data-pinned': pinned ? 'true' : undefined,
    onPointerEnter: () => {
      inside.current = true
      clearPhaseTimer()
      if (pinnedValue.current || phaseValue.current === 'holding') return
      if (revealedValue.current || phaseValue.current === 'draining') {
        if (revealedValue.current) setPhase('holding')
        else charge()
        return
      }
      if (phaseValue.current !== 'idle' || delayTimer.current !== undefined) return
      delayTimer.current = window.setTimeout(() => {
        delayTimer.current = undefined
        if (inside.current) charge()
      }, HOVER_DELAY_MS)
    },
    onPointerLeave: () => {
      inside.current = false
      if (pinnedValue.current) return
      if (phaseValue.current === 'idle') clearDelay()
      else drain()
    },
    children: [
      jsxs('button', {
        ref: trigger,
        type: 'button',
        className: 'dsh-hover-hint-trigger',
        'aria-label': label,
        'aria-haspopup': 'dialog',
        'aria-expanded': revealed ? 'true' : 'false',
        'aria-controls': bubbleId,
        onClick: () => {
          if (pinnedValue.current) {
            setPinned(false)
            if (inside.current) setPhase('holding')
            else drain()
          } else {
            reveal(true)
          }
        },
        children: [
          jsx('span', { children: triggerContent }),
          jsx(HoverHintRing, { className: 'dsh-hover-hint-trigger-ring' }),
        ],
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
        children: [
          jsxs('span', {
            className: 'dsh-hover-hint-header',
            children: [
              jsx('strong', { id: titleId, className: 'dsh-hover-hint-title', children: title }),
              jsx('span', { className: 'dsh-hover-hint-status', 'aria-hidden': 'true' }),
              jsx('button', {
                type: 'button',
                className: 'dsh-hover-hint-close',
                'aria-label': closeLabel,
                onClick: () => {
                  hide()
                  trigger.current?.focus()
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
          jsx('span', {
            className: 'dsh-hover-hint-footer',
            children: footer ?? '悬停预览；点击可以固定此窗口。',
          }),
        ],
      }),
    ],
  })
}
