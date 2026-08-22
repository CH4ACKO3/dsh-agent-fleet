import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { compactFleetJournal } from '../scripts/compact-fleet-journal.mjs'

describe('Fleet journal compaction', () => {
  it('archives legacy Session duplicates and preserves the last sequence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fleet-journal-compaction-'))
    const path = join(root, 'events.jsonl')
    const events = [
      { sequence: 1, createdAt: '2026-08-22T00:00:00.000Z', type: 'team_created', data: {} },
      { sequence: 2, createdAt: '2026-08-22T00:00:01.000Z', type: 'team_status', data: { status: 'idle' } },
      {
        sequence: 9,
        createdAt: '2026-08-22T00:00:02.000Z',
        type: 'session.assistant/message',
        data: { message: { content: 'legacy duplicate '.repeat(400) } },
      },
    ]
    writeFileSync(path, `${events.map(event => JSON.stringify(event)).join('\n')}\n`)

    try {
      const result = await compactFleetJournal(path)
      expect(result).toMatchObject({ removed: 1 })
      expect(result.afterBytes).toBeLessThan(result.beforeBytes)
      if (result.archive === undefined) throw new Error('expected a Session archive')
      expect(existsSync(result.archive)).toBe(true)
      expect(gunzipSync(readFileSync(result.archive)).toString('utf8')).toContain('session.assistant/message')
      const compacted = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line))
      expect(compacted.map(event => event.type)).toEqual(['team_created', 'team_status', 'journal_compacted'])
      expect(compacted.at(-1)).toMatchObject({ sequence: 9, data: { removedSessionEvents: 1 } })
      await expect(compactFleetJournal(path)).resolves.toMatchObject({ removed: 0 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
