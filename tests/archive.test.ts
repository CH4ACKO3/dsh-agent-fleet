import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FleetArchiveRegistry } from '../src/archive.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true })
})

describe('FleetArchiveRegistry', () => {
  it('isolates contributor data by namespace and preserves unavailable plugin data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fleet-archive-registry-'))
    temporaryDirectories.push(root)
    const team = { id: 'team-one', name: 'Team One', projectRoot: '/workspace', status: 'paused' }
    const saved = new FleetArchiveRegistry()
    saved.register({
      id: 'example.plugin',
      save: ({ directory }) => { writeFileSync(join(directory, 'state.json'), '{}\n') },
      restore: () => {},
    })
    expect(await saved.save(team, root)).toEqual(['example.plugin'])

    mkdirSync(join(root, 'unavailable.plugin'))
    const restored = new FleetArchiveRegistry()
    let restoredDirectory = ''
    let restoredIdentity: unknown
    restored.register({
      id: 'example.plugin',
      save: () => {},
      restore: ({ directory, sourceTeam, sessionIdMap }) => {
        restoredDirectory = directory
        restoredIdentity = { sourceTeam, sessionIdMap }
      },
    })
    const target = { ...team, id: 'team-two' }
    expect(await restored.restore(target, root, {
      sourceTeam: team,
      sessionIdMap: { 'source-session': 'target-session' },
    })).toEqual({ missing: ['unavailable.plugin'], failed: [] })
    expect(restoredDirectory).toBe(join(root, 'example.plugin'))
    expect(restoredIdentity).toEqual({
      sourceTeam: team,
      sessionIdMap: { 'source-session': 'target-session' },
    })
  })
})
