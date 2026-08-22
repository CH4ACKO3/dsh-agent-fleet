import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FleetMetaAssistantService } from '../src/meta.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('FleetMetaAssistantService', () => {
  it('persists and restores the Meta persona by Session without a Workspace or Team', () => {
    const directory = mkdtempSync(join(tmpdir(), 'fleet-meta-'))
    temporaryDirectories.push(directory)
    const mode = {
      active: true,
      phase: 'meta' as const,
      sessionId: 'meta-session',
      tools: [],
    }
    const activateMeta = vi.fn(() => mode)
    const agent = { id: 'meta-session' } as Agent

    const first = new FleetMetaAssistantService({ activateMeta } as never, { directory })
    expect(first.restore(agent)).toBeUndefined()
    expect(first.activate(agent)).toEqual(mode)

    const restoredActivateMeta = vi.fn(() => mode)
    const restored = new FleetMetaAssistantService({ activateMeta: restoredActivateMeta } as never, { directory })
    expect(restored.restore(agent)).toEqual(mode)
    expect(restoredActivateMeta).toHaveBeenCalledWith(agent)
  })
})
