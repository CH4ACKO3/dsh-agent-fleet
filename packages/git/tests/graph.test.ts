import { describe, expect, it } from 'vitest'

import { layoutGitGraph } from '../src/client/index.js'

const commit = (hash: string, parents: readonly string[]) => ({
  hash,
  parents,
  authorName: 'Fleet',
  authorEmail: 'fleet@example.com',
  authoredAt: '2026-08-22T00:00:00.000Z',
  subject: hash,
  decorations: [],
})

describe('layoutGitGraph', () => {
  it('keeps first-parent history in one lane', () => {
    const rows = layoutGitGraph([commit('c', ['b']), commit('b', ['a']), commit('a', [])])
    expect(rows.map(row => row.lane)).toEqual([0, 0, 0])
    expect(rows.at(-1)?.after).toEqual([])
  })

  it('opens and rejoins a merge lane without losing either parent', () => {
    const rows = layoutGitGraph([
      commit('merge', ['main', 'topic']),
      commit('topic', ['base']),
      commit('main', ['base']),
      commit('base', []),
    ])
    expect(rows[0]?.after).toEqual(['main', 'topic'])
    expect(rows[1]?.lane).toBe(1)
    expect(rows.at(-1)?.after).toEqual([])
  })
})
