import { describe, expect, it } from 'vitest'

import {
  buildCommitFileTree,
  filterGitBranchesByQuery,
  filterGitGraphCommits,
  gitRefKind,
  layoutGitGraph,
  locateGitGraphMembers,
  worktreeForMember,
} from '../src/client/index.js'

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
    expect(gitRefKind('stash@{0}', branches)).toBe('stash')
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

  it('keeps stashed history visible while filtering branches', () => {
    const snapshot = {
      status: { root: '/workspace', branch: 'main', head: 'local', changes: [], worktrees: [] },
      branches: [{ name: 'main', fullName: 'refs/heads/main', head: 'local', current: true, remote: false }],
      stashes: [{ ref: 'stash@{0}', hash: 'stash', subject: 'On main: work' }],
      commits: [commit('stash', ['local']), commit('local', [])],
    }

    expect(filterGitGraphCommits(snapshot, new Set(['main']), false).map(item => item.hash)).toEqual(['stash', 'local'])
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

  it('reuses the leftmost lane after a disconnected lineage ends', () => {
    const rows = layoutGitGraph([
      commit('first-leaf', []),
      commit('second-leaf', []),
    ])

    expect(rows.map(row => row.lane)).toEqual([0, 0])
    expect(rows.map(row => row.color)).toEqual([0, 1])
    expect(rows.every(row => row.before[0] !== undefined)).toBe(true)
  })

  it('keeps the newest visible commit in the leftmost lane', () => {
    const rows = layoutGitGraph([
      commit('newer-remote', []),
      commit('current-local', []),
    ])

    expect(rows.map(row => ({ hash: row.commit.hash, lane: row.lane }))).toEqual([
      { hash: 'newer-remote', lane: 0 },
      { hash: 'current-local', lane: 0 },
    ])
  })

  it('keeps the leftmost column occupied while branches rejoin', () => {
    const rows = layoutGitGraph([
      commit('merge-2', ['main-2', 'topic-2']),
      commit('topic-2', ['join-2']),
      commit('main-2', ['join-2']),
      commit('join-2', ['spacer']),
      commit('spacer', ['merge-1']),
      commit('merge-1', ['main-1', 'topic-1']),
      commit('topic-1', ['base']),
      commit('main-1', ['base']),
      commit('base', []),
    ])

    const topic2 = rows.find(row => row.commit.hash === 'topic-2')
    const topic1 = rows.find(row => row.commit.hash === 'topic-1')
    expect(topic2?.lane).toBe(1)
    expect(topic1?.lane).toBe(1)
    expect(topic2?.color).not.toBe(topic1?.color)
    expect(rows.every(row => row.before[0] !== undefined && row.before[0] !== '')).toBe(true)
    expect(Math.max(...rows.map(row => Math.max(row.before.length, row.after.length)))).toBe(2)
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

  it('resolves a member worktree by branch identity before its directory name', () => {
    const member = { id: 'reviewer', name: 'Avery', role: 'Reviewer', color: '#318b78' }
    const worktrees = [
      { path: '/workspace/reviewer', head: 'unrelated', branch: 'feature/unrelated', detached: false },
      { path: '/workspace/custom', head: 'review-head', branch: 'fleet/team/reviewer', detached: false },
    ]

    expect(worktreeForMember(member, worktrees)?.path).toBe('/workspace/custom')
  })

  it('searches branch names and detailed branch metadata', () => {
    const snapshot = {
      status: {
        root: '/workspace', branch: 'main', head: 'main-head', changes: [],
        worktrees: [{ path: '/workspace/review', head: 'review-head', branch: 'fleet/reviewer', detached: false }],
      },
      branches: [
        { name: 'main', fullName: 'refs/heads/main', head: 'main-head', current: true, remote: false },
        { name: 'fleet/reviewer', fullName: 'refs/heads/fleet/reviewer', head: 'review-head', current: false, remote: false },
        { name: 'origin/release', fullName: 'refs/remotes/origin/release', head: 'release-head', current: false, remote: true },
      ],
      commits: [
        commit('main-head', []),
        { ...commit('review-head', []), subject: 'Security audit', authorName: 'Avery', authorEmail: 'avery@example.com' },
        commit('release-head', []),
      ],
    }
    const members = [{ id: 'reviewer', name: 'Morgan', role: 'Security reviewer', color: '#318b78' }]

    expect(filterGitBranchesByQuery(snapshot, 'morgan security', members).map(branch => branch.name)).toEqual(['fleet/reviewer'])
    expect(filterGitBranchesByQuery(snapshot, 'avery@example.com audit', members).map(branch => branch.name)).toEqual(['fleet/reviewer'])
    expect(filterGitBranchesByQuery(snapshot, 'remote release', members).map(branch => branch.name)).toEqual(['origin/release'])
    expect(filterGitBranchesByQuery(snapshot, '/workspace/review', members).map(branch => branch.name)).toEqual(['fleet/reviewer'])
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
