import type { ReactElement } from 'react'
import { Fragment, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export type PanelIconName = 'chat' | 'team' | 'agent' | 'resources' | 'activity' | 'search' | 'send' | 'channel' | 'menu' | 'settings' | 'chevron' | 'check' | 'close' | 'copy' | 'download' | 'upload' | 'wrap'

export function PanelIcon({ name, size = 18 }: { readonly name: PanelIconName; readonly size?: number }): ReactElement {
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
  if (name === 'close') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'm5.5 5.5 9 9m0-9-9 9' }),
  })
  if (name === 'copy') return jsxs('svg', {
    ...common,
    children: [
      jsx('rect', { x: 6.5, y: 6.5, width: 9, height: 9, rx: 1.5 }),
      jsx('path', { d: 'M4.5 12.5h-.2c-1 0-1.8-.8-1.8-1.8V4.3c0-1 .8-1.8 1.8-1.8h6.4c1 0 1.8.8 1.8 1.8v.2' }),
    ],
  })
  if (name === 'download') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M10 3.2v9.2m-3.4-3.1 3.4 3.4 3.4-3.4' }),
      jsx('path', { d: 'M4 15.2v1.3h12v-1.3' }),
    ],
  })
  if (name === 'upload') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M10 12.7V3.5M6.6 6.6 10 3.2l3.4 3.4' }),
      jsx('path', { d: 'M4 14.8v1.3h12v-1.3' }),
    ],
  })
  if (name === 'wrap') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M3 5.2h10.1a3.1 3.1 0 0 1 0 6.2H9' }),
      jsx('path', { d: 'm11.3 9.1-2.4 2.3 2.4 2.4M3 9h4M3 13.5h4' }),
    ],
  })
  if (name === 'chat') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'M4 4.5h12v8.4H9l-4.1 3v-3H4V4.5Z' }),
  })
  if (name === 'team') return jsxs('svg', {
    ...common,
    children: [
      jsx('circle', { cx: 7.2, cy: 7, r: 2.5 }),
      jsx('circle', { cx: 13.7, cy: 7.8, r: 2 }),
      jsx('path', { d: 'M2.9 15.5c.5-2.7 2-4 4.4-4 2.5 0 4 1.3 4.4 4m.2-3.8c2.8-.3 4.5 1 5 3.8' }),
    ],
  })
  if (name === 'agent') return jsxs('svg', {
    ...common,
    children: [
      jsx('circle', { cx: 10, cy: 6.7, r: 2.8 }),
      jsx('path', { d: 'M4.5 16c.6-3.2 2.4-4.8 5.5-4.8s4.9 1.6 5.5 4.8' }),
    ],
  })
  if (name === 'resources') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M4.2 3.5h7l4.6 4.6v8.4H4.2V3.5Z' }),
      jsx('path', { d: 'M11.2 3.5v4.6h4.6M7 11h6M7 14h4' }),
    ],
  })
  if (name === 'activity') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'M2.8 10h3l1.7-4.2 3.2 8.4 2.1-5.5 1.2 2.7h3.2' }),
  })
  if (name === 'search') return jsxs('svg', {
    ...common,
    children: [jsx('circle', { cx: 8.7, cy: 8.7, r: 5 }), jsx('path', { d: 'm12.4 12.4 4 4' })],
  })
  if (name === 'send') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'M4 10h11m-4-4 4 4-4 4' }),
  })
  if (name === 'menu') return jsxs('svg', {
    ...common,
    children: [
      jsx('path', { d: 'M4 5.5h12M4 10h12M4 14.5h12' }),
    ],
  })
  if (name === 'settings') return jsxs('svg', {
    ...common,
    children: [
      jsx('circle', { cx: 10, cy: 10, r: 2.4 }),
      jsx('path', { d: 'M8.6 3.5h2.8l.5 1.8c.4.2.8.4 1.2.7l1.8-.5 1.4 2.4-1.3 1.3v1.6l1.3 1.3-1.4 2.4-1.8-.5c-.4.3-.8.5-1.2.7l-.5 1.8H8.6l-.5-1.8c-.4-.2-.8-.4-1.2-.7l-1.8.5-1.4-2.4L5 10.8V9.2L3.7 7.9l1.4-2.4 1.8.5c.4-.3.8-.5 1.2-.7l.5-1.8Z' }),
    ],
  })
  if (name === 'chevron') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'm6.5 8 3.5 3.5L13.5 8' }),
  })
  if (name === 'check') return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'm4.5 10.2 3.3 3.3 7.7-7.7' }),
  })
  return jsx('svg', {
    ...common,
    children: jsx('path', { d: 'M7.2 3.5 5.4 16.5m7.4-13-1.8 13M3.5 7.4h13M2.8 12.6h13' }),
  })
}

export function HarmonyBrandIcon(): ReactElement {
  const [available, setAvailable] = useState(false)
  return jsxs(Fragment, {
    children: [
      available
        ? jsx('span', { className: 'dsh-fleet-panel-harmony-icon', 'aria-hidden': 'true' })
        : jsx(PanelIcon, { name: 'team', size: 21 }),
      jsx('img', {
        className: 'dsh-fleet-panel-harmony-icon-probe',
        src: '/dsh-harmony/assets/harmony-icon-mono.png?fleet-brand-probe=1',
        alt: '',
        'aria-hidden': 'true',
        onLoad: () => { setAvailable(true) },
      }),
    ],
  })
}