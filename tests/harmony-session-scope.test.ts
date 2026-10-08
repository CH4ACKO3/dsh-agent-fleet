import { createRequire } from 'node:module'
import { expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const patches = require('../harmony/hero-team-entry.cjs')
const patch = patches.find((item: { id: string }) => item.id === 'fleet-agent-session-scope')

// Exercise the injected provider with the modern renderer's domain adapter.
// In particular, another member's transcript must not inherit the owner binding.
function provider(current: { key?: string }, member: { key?: string }) {
  const source = 'return renderArea(useScopeBinding(), props);'
  let replacement = ''
  patch.apply({ source, edit: { overwrite(_start: number, _end: number, text: string) { replacement = text } } })
  return new Function('useScopeBinding', 'adapter', 'renderArea', 'react_jsx_runtime', 'ScopeBindingContext', 'props', replacement).bind(
    undefined,
    () => current,
    { resolve: (key: string) => { expect(key).toBe('member'); return member } },
    (binding: { key?: string }, props: { children: unknown; empty?: () => unknown }) => binding.key === undefined ? props.empty?.() : props.children,
    { jsx: (type: unknown, props: unknown, key: unknown) => ({ type, props, key }) },
    { Provider: 'ScopeBindingContext.Provider' },
  )
}

test('native children keep their existing session area behavior', () => {
  const render = provider({ key: 'owner' }, { key: 'member' })
  expect(render({ children: 'native content' })).toBe('native content')
})

test('Fleet member context uses the requested binding and child session identity', () => {
  const member = { key: 'member' }
  const render = provider({ key: 'owner' }, member)
  expect(render({ sessionId: 'member', children: (id: string) => `transcript:${id}` })).toEqual({
    type: 'ScopeBindingContext.Provider', key: 'member', props: { value: member, children: 'transcript:member' },
  })
})

test('an absent session shows the empty branch without invoking Fleet children', () => {
  const render = provider({}, {})
  expect(render({ empty: () => 'empty', children: () => { throw new Error('no session') } }).props.children).toBe('empty')
})
