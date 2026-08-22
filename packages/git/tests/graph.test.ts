import { describe, expect, it } from 'vitest'

import { buildCommitFileTree, filterGitGraphCommits, gitRefKind, layoutGitGraph, locateGitGraphMembers } from '../src/client/index.js'

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

  it('classifies local slash branches from ref metadata instead of their spelling', () => {
    const branches = [
      { name: 'fleet/team/reviewer', fullName: 'refs/heads/fleet/team/reviewer', head: 'local', current: false, remote: false },
      { name: 'origin/main', fullName: 'refs/remotes/origin/main', head: 'remote', current: false, remote: true },
    ]
    expect(gitRefKind('fleet/team/reviewer', branches)).toBe('branch')
    expect(gitRefKind('origin/main', branches)).toBe('remote')
  })

  it('filters history by selected heads and can omit remote-only commits', () => {
    const snapshot = {
      status: { root: '/workspace', branch: 'main', head: 'local', changes: [], worktrees: [] },
      branches: [
        { name: 'main', fullName: 'refs/heads/main', head: 'local', current: true, remote: false },
        { name: 'origin/topic', fullName: 'refs/remotes/origin/topic', head: 'remote', current: false, remote: true },
      ],
      commits: [commit('remote', ['base']), commit('local', ['base']), commit('base', [])],
    }

    expect(filterGitGraphCommits(snapshot, null, false).map(item => item.hash)).toEqual(['local', 'base'])
    expect(filterGitGraphCommits(snapshot, new Set(['origin/topic']), true).map(item => item.hash)).toEqual(['remote', 'base'])
    expect(filterGitGraphCommits(snapshot, null, true).map(item => item.hash)).toEqual(['remote', 'local', 'base'])
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

  it('places members on their worktree branch and otherwise on the shared branch', () => {
    const snapshot = {
      status: {
        root: '/workspace', branch: 'main', head: 'main-head', changes: [],
        worktrees: [
          { path: '/workspace', head: 'main-head', branch: 'main', detached: false },
          { path: '/workspace/.fleet/worktrees/team/reviewer', head: 'review-head', branch: 'fleet/team/reviewer', detached: false },
        ],
      },
      branches: [
        { name: 'main', fullName: 'refs/heads/main', head: 'main-head', current: true, remote: false },
        { name: 'fleet/team/reviewer', fullName: 'refs/heads/fleet/team/reviewer', head: 'review-head', current: false, remote: false },
      ],
      commits: [],
    }
    const positions = locateGitGraphMembers(snapshot, [
      { id: 'developer', name: 'Morgan', role: 'Developer', color: '#4f78d3' },
      { id: 'reviewer', name: 'Avery', role: 'Reviewer', color: '#318b78' },
    ])

    expect(positions.map(position => ({ id: position.member.id, branch: position.branch, head: position.head }))).toEqual([
      { id: 'developer', branch: 'main', head: 'main-head' },
      { id: 'reviewer', branch: 'fleet/team/reviewer', head: 'review-head' },
    ])
  })
})

describe('buildCommitFileTree', () => {
  it('groups changed files into sorted folders without losing their statistics', () => {
    const tree = buildCommitFileTree([
      { path: 'src/ui/view.ts', status: 'M', additions: 8, deletions: 2, binary: false },
      { path: 'README.md', status: 'M', additions: 1, deletions: 0, binary: false },
      { path: 'src/core.ts', status: 'A', additions: 4, deletions: 0, binary: false },
    ])

    expect(tree.map(node => node.name)).toEqual(['src', 'README.md'])
    expect(tree[0]?.children.map(node => node.name)).toEqual(['ui', 'core.ts'])
    expect(tree[0]?.children[0]?.children[0]?.file).toMatchObject({ path: 'src/ui/view.ts', additions: 8, deletions: 2 })
  })
})
