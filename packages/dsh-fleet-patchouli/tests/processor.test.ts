import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import type { MemoryPlugin } from '../src/patchouli.js'
import { apply } from '../src/processor.js'

describe('Fleet Patchouli processor', () => {
  it('registers directly with Patchouli Core and accepts only Fleet sources', async () => {
    let plugin: MemoryPlugin | undefined
    const unregister = vi.fn()
    apply({
      inject: (_services: readonly string[], callback: (scope: unknown) => void) => callback({
        patchouli: {
          register: (candidate: MemoryPlugin) => { plugin = candidate; return unregister },
        },
      }),
    } as unknown as Context)

    if (plugin === undefined) throw new Error('expected Fleet Patchouli processor')
    const meta = { source: { type: 'fleet', id: 'adapter' }, scope: 'fleet:team-1:shared' }
    expect(plugin.filter?.({ operation: 'update', meta })).toBe(true)
    expect(plugin.filter?.({
      operation: 'update',
      meta: { ...meta, source: { type: 'session', id: 'session-1' } },
    })).toBe(false)
    await expect(plugin.update({ meta, data: { event: 'example' } }, {})).resolves.toMatchObject({
      handled: false,
      sourceType: 'fleet',
    })
    await expect(plugin.retrieve({ meta, data: { query: 'example' } }, {})).resolves.toMatchObject({
      handled: false,
      items: [],
    })
  })
})
