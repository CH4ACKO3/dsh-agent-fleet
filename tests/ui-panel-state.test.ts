import { describe, expect, it } from 'vitest'

import {
  activeFleetMentionQuery,
  fleetPanelTeamRunControl,
  fleetResourcePreviewKind,
  insertFleetMemberMention,
  releaseFleetNativeSessionWindow,
  resolveFleetPanelItem,
  splitFleetMemberMentions,
  type FleetPanelTeamSnapshot,
} from '../packages/ui/src/team-panel.js'

const team: FleetPanelTeamSnapshot = {
  teamId: 'fleet-one',
  teamName: 'Fleet One',
  status: 'running',
  conversations: [
    { id: 'general', kind: 'channel', name: 'General' },
    { id: '@alex-session', kind: 'direct', name: 'Alex', peerId: 'alex' },
    { id: 'dm:alex-session:sam-session', kind: 'direct', name: 'Alex ↔ Sam', participantIds: ['alex', 'sam'] },
  ],
  members: [
    {
      id: 'alex',
      name: 'Alex',
      role: 'Engineer',
      responsibility: 'Implementation',
      color: '#4078c0',
      visibleConversationIds: ['general', '@alex-session', 'dm:alex-session:sam-session'],
    },
    {
      id: 'sam',
      name: 'Sam',
      role: 'Reviewer',
      responsibility: 'Review',
      color: '#9867c5',
    },
  ],
  messages: [],
  resources: [
    { id: 'plan', name: 'Plan', kind: 'plan', path: '/workspace/.fleet/plan.md', detail: 'Current plan' },
  ],
  workspaces: [
    { id: 'workspace:/workspace', name: 'project', path: '/workspace', access: 'write', members: ['alex', 'sam'] },
  ],
  activity: [],
}

describe('Fleet panel live selection repair', () => {
  it('falls back to the first available item after a live snapshot removes the selection', () => {
    expect(resolveFleetPanelItem(team, 'chat', 'removed-channel')).toBe('general')
    expect(resolveFleetPanelItem(team, 'team', 'removed-member')).toBe('alex')
    expect(resolveFleetPanelItem(team, 'resources', 'removed-resource')).toBe('plan')
    expect(resolveFleetPanelItem(team, 'resources', 'workspace:/workspace')).toBe('workspace:/workspace')
    expect(resolveFleetPanelItem({ ...team, resources: [] }, 'resources', undefined)).toBe('workspace:/workspace')
    expect(resolveFleetPanelItem(team, 'activity', 'removed-filter')).toBe('all')
  })

  it('keeps valid selections and extension-owned tool state unchanged', () => {
    expect(resolveFleetPanelItem(team, 'chat', '@alex-session')).toBe('@alex-session')
    expect(resolveFleetPanelItem(team, 'extension.memory', 'memory-page')).toBe('memory-page')
  })

  it('keeps member-to-member direct conversations out of the operator chat view', () => {
    expect(resolveFleetPanelItem(team, 'chat', 'dm:alex-session:sam-session')).toBe('general')
    expect(resolveFleetPanelItem(team, 'agent', 'alex::dm:alex-session:sam-session'))
      .toBe('alex::dm:alex-session:sam-session')
  })

  it('repairs an Agent perspective to content visible to the selected member', () => {
    expect(resolveFleetPanelItem(team, 'agent', 'alex::removed-private')).toBe('alex::general')
    expect(resolveFleetPanelItem(team, 'agent', 'removed-member::@context')).toBe('alex::@context')
  })
})

describe('Fleet Team run control', () => {
  it('switches between a complete pause and resume action from the projected Team state', () => {
    expect(fleetPanelTeamRunControl({ status: 'running', runtimeState: 'active' })).toMatchObject({
      action: 'pause', label: '暂停运行', busyLabel: '正在暂停…',
    })
    expect(fleetPanelTeamRunControl({ status: 'idle', runtimeState: 'active' })).toMatchObject({
      action: 'pause', label: '暂停运行',
    })
    expect(fleetPanelTeamRunControl({ status: 'paused', runtimeState: 'active' })).toMatchObject({
      action: 'resume', label: '继续运行', busyLabel: '正在继续…',
    })
    expect(fleetPanelTeamRunControl({ status: 'running', runtimeState: 'dormant' })).toMatchObject({
      action: 'resume', label: '继续运行',
    })
  })

  it('does not offer an invalid resume for terminal or disconnected Teams', () => {
    expect(fleetPanelTeamRunControl({ status: 'closed', runtimeState: 'dormant' })).toBeUndefined()
    expect(fleetPanelTeamRunControl({ status: 'failed', runtimeState: 'dormant' })).toBeUndefined()
    expect(fleetPanelTeamRunControl({ status: 'disconnected', runtimeState: 'dormant' })).toBeUndefined()
    expect(fleetPanelTeamRunControl({ status: 'finishing', runtimeState: 'active' })).toBeUndefined()
  })
})

describe('Fleet member mentions', () => {
  it('recognizes member names and stable ids without turning email addresses or prefixes into mentions', () => {
    const segments = splitFleetMemberMentions(
      '请@alex 和 @Sam 复核；mail@example.com 与 @sampler 保持普通文本。',
      team.members,
    )
    expect(segments.filter(segment => segment.member !== undefined).map(segment => [segment.text, segment.member?.id]))
      .toEqual([['@alex', 'alex'], ['@Sam', 'sam']])
  })

  it('finds the active composer query and replaces it at the current caret', () => {
    const query = activeFleetMentionQuery('请 @sa', 5)
    expect(query).toEqual({ start: 2, end: 5, query: 'sa' })
    expect(insertFleetMemberMention('请 @sa', query!, 'Sam')).toEqual({
      text: '请 @Sam ',
      caret: 7,
    })
    expect(activeFleetMentionQuery('mail@example', 12)).toBeUndefined()
  })
})

describe('Fleet resource previews', () => {
  it('recognizes Markdown and common UTF-8 text resources without treating binary files as text', () => {
    expect(fleetResourcePreviewKind({ name: 'Current plan', path: '/workspace/plan.md' })).toBe('markdown')
    expect(fleetResourcePreviewKind({ name: 'notes', path: '/workspace/notes', mediaType: 'text/markdown; charset=utf-8' })).toBe('markdown')
    expect(fleetResourcePreviewKind({ name: 'settings.json', path: '/workspace/settings.json' })).toBe('text')
    expect(fleetResourcePreviewKind({ name: 'brief.pdf', path: '/workspace/brief.pdf', mediaType: 'application/pdf' })).toBeUndefined()
  })
})

describe('Fleet native Agent context memory', () => {
  it('returns an extra opened Session to a cold, bounded window', () => {
    const replaced: unknown[][] = []
    let dirty = 0
    const session = {
      getSnapshot: () => ({}),
      subscribe: () => () => {},
      loadOlder: async () => {},
      openGeneration: 4,
      openPromise: Promise.resolve(),
      openState: 'open',
      openError: { code: 'old' },
      loadingOlder: true,
      stitching: true,
      events: [{ seq: 1 }, { seq: 2 }],
      views: [{}, {}],
      baseSeq: 1,
      hasMore: true,
      liveBuffer: [{ event: { seq: 3 } }],
      conversation: {
        replaceWindow: (entries: readonly unknown[], hasMore: boolean) => {
          replaced.push([...entries, hasMore])
        },
      },
      notifier: { markDirty: () => { dirty += 1 } },
    }

    expect(releaseFleetNativeSessionWindow(session)).toBe(true)
    expect(session).toMatchObject({
      openGeneration: 5,
      openPromise: null,
      openState: 'cold',
      openError: null,
      loadingOlder: false,
      stitching: false,
      events: [],
      views: [],
      baseSeq: 0,
      hasMore: false,
      liveBuffer: [],
    })
    expect(replaced).toEqual([[false]])
    expect(dirty).toBe(1)
  })

  it('fails closed when a future native Session shape is unknown', () => {
    expect(releaseFleetNativeSessionWindow({
      getSnapshot: () => ({}),
      subscribe: () => () => {},
      loadOlder: async () => {},
    })).toBe(false)
  })
})
