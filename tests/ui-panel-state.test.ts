import { describe, expect, it, vi } from 'vitest'

import {
  activeFleetMentionQuery,
  decorateFleetMetaWelcomeSnapshot,
  expandFleetTargetFold,
  fleetNativeContextNodeKey,
  fleetPanelTeamRunControl,
  fleetResourcePreviewKind,
  insertFleetMemberMention,
  releaseFleetNativeSessionWindow,
  resolveFleetPanelItem,
  splitFleetMemberMentions,
  type FleetPanelTeamSnapshot,
} from '../packages/ui/src/team-panel.js'
import { projectAgentFleetPrivateMessages } from '../packages/ui/src/assistant-private-chat.js'

describe('Agent Fleet welcome message', () => {
  it('prepends one chat row without replacing existing conversation nodes', () => {
    const existing = { key: 'message:1', kind: 'user' }
    const nodes = {
      get: (key: string) => key === existing.key ? existing : undefined,
      values: () => [existing],
    }
    const source = {
      chat: {
        order: [existing.key],
        nodes,
        timeline: { turns: new Map() },
      },
    }
    const decorated = decorateFleetMetaWelcomeSnapshot(source, {
      sessionId: 'meta-session',
      text: 'Welcome',
      streaming: true,
      time: 42,
    })

    expect(decorated.chat.order).toEqual(['fleet-meta-welcome:meta-session', existing.key])
    expect(decorated.chat.nodes.get(existing.key)).toBe(existing)
    expect(decorated.chat.nodes.values()).toHaveLength(2)
    expect(decorated.chat.nodes.get('fleet-meta-welcome:meta-session')).toMatchObject({
      kind: 'fleet-meta-welcome',
      anchorSeq: -1,
      data: {
        text: 'Welcome',
        streaming: true,
        time: 42,
      },
    })
    expect(source.chat.order).toEqual([existing.key])
  })
})

describe('Agent Fleet private-chat projection', () => {
  it('keeps human-visible text and images while excluding reasoning, tools, and context', () => {
    const nodes = new Map<string, unknown>([
      ['user:1', {
        key: 'user:1',
        kind: 'user',
        visibility: 'visible',
        data: {
          time: 100,
          content: [
            { type: 'text', text: 'Build a Team' },
            { type: 'reasoning', text: 'not user-visible' },
            { type: 'image', attachment: {
              attachmentId: 'image-1', mediaType: 'image/png', bytes: 12, width: 4, height: 3,
            } },
          ],
        },
      }],
      ['context:1', {
        key: 'context:1',
        kind: 'context',
        visibility: 'visible',
        data: { time: 150, content: [{ type: 'text', text: 'hidden system context' }] },
      }],
      ['assistant:1', {
        key: 'assistant:1',
        kind: 'assistant-step',
        visibility: 'visible',
        data: {
          time: 200,
          status: 'settled',
          blocks: [
            { kind: 'reasoning', text: 'hidden chain of thought' },
            { kind: 'tool-call', name: 'fleet_setup', callId: 'call-1', argsRaw: '{}' },
            { kind: 'text', text: 'Let us configure it.' },
          ],
        },
      }],
    ])

    const projected = projectAgentFleetPrivateMessages({
      order: ['user:1', 'context:1', 'assistant:1'],
      nodes: { get: key => nodes.get(key) },
    })

    expect(projected).toHaveLength(2)
    expect(projected[0]).toMatchObject({
      id: 'user:1',
      sender: 'operator',
      read: true,
      content: [
        { type: 'text', text: 'Build a Team' },
        { type: 'image', attachmentId: 'image-1', mediaType: 'image/png' },
      ],
    })
    expect(projected[1]).toMatchObject({
      id: 'assistant:1',
      sender: 'assistant',
      content: [{ type: 'text', text: 'Let us configure it.' }],
      streaming: false,
    })
    expect(JSON.stringify(projected)).not.toContain('chain of thought')
    expect(JSON.stringify(projected)).not.toContain('fleet_setup')
    expect(JSON.stringify(projected)).not.toContain('system context')
  })

  it('marks an operator message read only after a complete assistant output', () => {
    const user = {
      key: 'user:1',
      kind: 'user',
      visibility: 'visible',
      data: { time: 100, content: [{ type: 'text', text: 'Hello' }] },
    }
    const streamingReasoning = {
      key: 'assistant:reasoning',
      kind: 'assistant-step',
      visibility: 'visible',
      data: { time: 200, status: 'running', blocks: [{ kind: 'reasoning', text: 'working' }] },
    }
    const toolCall = {
      key: 'assistant:tool',
      kind: 'assistant-step',
      visibility: 'visible',
      data: { time: 300, status: 'running', blocks: [{ kind: 'tool-call', name: 'fleet_setup' }] },
    }
    const nodes = new Map([[user.key, user], [streamingReasoning.key, streamingReasoning], [toolCall.key, toolCall]])

    expect(projectAgentFleetPrivateMessages({
      order: [user.key, streamingReasoning.key],
      nodes: { get: key => nodes.get(key) },
    })[0]).toMatchObject({ sender: 'operator', read: false })

    expect(projectAgentFleetPrivateMessages({
      order: [user.key, streamingReasoning.key, toolCall.key],
      nodes: { get: key => nodes.get(key) },
    })[0]).toMatchObject({ sender: 'operator', read: true })
  })

  it('preserves a streaming assistant row without requiring an iterable node store', () => {
    const node = {
      key: 'assistant:stream',
      kind: 'assistant-step',
      visibility: 'visible',
      data: { time: 300, status: 'running', blocks: [{ kind: 'reasoning', text: 'working' }] },
    }
    const projected = projectAgentFleetPrivateMessages({
      order: [node.key],
      nodes: { get: key => key === node.key ? node : undefined },
    })

    expect(projected).toMatchObject([{
      id: node.key,
      sender: 'assistant',
      content: [{ type: 'text', text: '' }],
      streaming: true,
    }])
  })
})

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
  assistants: [
    {
      id: 'team-assistant',
      name: 'Halle',
      role: 'Team assistant',
      responsibility: 'Relay updates between the operator and the Team',
      color: '#4f76c7',
      sessionId: 'assistant-session',
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

  it('treats a Team assistant as a first-class profile and context navigation target', () => {
    expect(resolveFleetPanelItem(team, 'team', 'team-assistant')).toBe('team-assistant')
    expect(resolveFleetPanelItem(team, 'agent', 'team-assistant::@context'))
      .toBe('team-assistant::@context')
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
  it('maps a persisted context message id back to its native ChatView row key', () => {
    const snapshot = {
      chat: {
        nodes: {
          values: () => [
            { id: 'other-message', key: 'input-message:other-message' },
            { id: 'context-message', key: 'input-message:context-message' },
          ],
        },
      },
    }

    expect(fleetNativeContextNodeKey(snapshot, 'context-message')).toBe('input-message:context-message')
    expect(fleetNativeContextNodeKey(snapshot, 'missing-message')).toBeUndefined()
  })

  it('opens the folded turn triggered by a visible upstream message', () => {
    const click = vi.fn()
    const selectors: string[] = []
    const fold = {
      dataset: {
        dshFoldKeys: JSON.stringify(['reasoning', 'tool-call']),
        dshFoldTriggerKeys: JSON.stringify(['input-message:context-message']),
      },
      querySelector: (selector: string) => {
        selectors.push(selector)
        return { click }
      },
    }
    const container = { querySelectorAll: () => [fold] }

    expandFleetTargetFold(container as unknown as HTMLElement, 'input-message:context-message')

    expect(click).toHaveBeenCalledOnce()
    expect(selectors).toEqual([
      'button[aria-expanded="false"], [role="button"][aria-expanded="false"]',
    ])
  })

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
