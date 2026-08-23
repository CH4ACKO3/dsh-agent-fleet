import { describe, expect, it } from 'vitest'

import { layoutGitGraph, renderFleetGitDiff } from '../src/client/index.js'

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

describe('renderFleetGitDiff', () => {
  it('uses the optional render-engine services when both are available', () => {
    const patch = 'diff --git a/a.ts b/a.ts\n+const answer = 42\n'
    const inputs: unknown[] = []
    const rendered = renderFleetGitDiff(patch, {
      diffEngine: { diff: input => { inputs.push(input); return { document: true } } },
      diffRenderer: { render: document => ({ html: `<div>${JSON.stringify(document)}</div>` }) },
    })

    expect(inputs).toEqual([{ kind: 'patch', patch }])
    expect(rendered).toBe('<div>{"document":true}</div>')
  })

  it('falls back to the plain patch when render-engine is absent or rejects the input', () => {
    expect(renderFleetGitDiff('patch', undefined)).toBeUndefined()
    expect(renderFleetGitDiff('patch', {
      diffEngine: { diff: () => { throw new Error('invalid patch') } },
      diffRenderer: { render: () => ({ html: 'unreachable' }) },
    })).toBeUndefined()
  })
})
