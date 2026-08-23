import type { ReactElement } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

export function FleetMark(): ReactElement {
  return jsxs('svg', {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': 'true',
    children: [
      jsx('path', {
        d: 'M4 4.25 8 2l4 2.25v4.5L8 11 4 8.75v-4.5Z',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinejoin: 'round',
      }),
      jsx('path', {
        d: 'm4 8.75-2 1.1v2.1L5.5 14 8 12.6l2.5 1.4 3.5-2.05v-2.1l-2-1.1',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ],
  })
}
