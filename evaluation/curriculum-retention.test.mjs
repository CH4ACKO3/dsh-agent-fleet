import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicJson, pruneCurriculum } from '../examples/self-evolving-team/scripts/curriculum.mjs'

test('retention reclaims explicitly recorded intermediate images and preserves images shared by active generations', async () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'fleet-image-retention-'))
  try {
    for (const id of ['g0001', 'g0002']) mkdirSync(join(stateDirectory, 'curriculum/snapshots', id), { recursive: true })
    atomicJson(join(stateDirectory, 'curriculum/ledger.json'), { generations: {
      g0001: { finishedAt: 'done', images: { ale: 'managed:ale-old' }, auxiliaryImages: { ale: ['managed:common-old', 'managed:shared'] } },
      g0002: { finishedAt: 'done', images: { ale: 'managed:ale-live' }, auxiliaryImages: { ale: ['managed:common-live', 'managed:shared'] } },
    } })
    const removed = []
    await pruneCurriculum({ retainGenerations: 1 }, { stateDirectory, stable: 'g0002' }, async argv => { removed.push(argv.at(-1)) })
    assert.deepEqual(removed.sort(), ['managed:ale-old', 'managed:common-old'])
  } finally { rmSync(stateDirectory, { recursive: true, force: true }) }
})
