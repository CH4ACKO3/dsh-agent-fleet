import { describe, expect, it, vi } from 'vitest'

import {
  activeFleetCommandQuery,
  activeFleetMentionQuery,
  clampFleetTimelineTime,
  decorateFleetMetaWelcomeSnapshot,
  expandFleetTargetFold,
  fleetActivityGroups,
  fleetActivityWindow,
  fleetAssistantMailboxMentions,
  fleetPanelMentionMembers,
  fleetPanelSelectedMemberId,
  fleetTimelineTicks,
  fleetPanelMemberRunControls,
  fleetNativeContextNodeKey,
  fleetPanelTeamRunControls,
  fleetPermissionGroupCapabilities,
  fleetResourcePreviewKind,
  groupFleetActivity,
  groupFleetMessageThreads,
  insertFleetMemberMention,
  nearestFleetActivityGroupIndex,
  releaseFleetNativeSessionWindow,
  resolveFleetPanelItem,
  sameFleetPermissionAssignment,
  splitFleetMemberMentions,
  updateFleetPermissionAssignmentValues,
  type FleetPanelTeamSnapshot,
  type FleetPanelMessage,
} from '../packages/ui/src/team-panel.js'
import {
  projectAgentFleetPrivateMessages,
} from '../packages/ui/src/assistant-private-chat.js'
import {
  fleetConversationAudienceLabel,
  fleetMemberPresence,
  fleetMemberPresenceLabel,
} from '../packages/ui/src/runtime-chat.js'
import {
  archiveFleetAssistantSession,
  archiveFleetAssistantTeam,
  resolveFleetAssistantArchiveTarget,
} from '../packages/ui/src/meta-assistant.js'

describe('Fleet conversation audience labels', () => {
  it('makes private and broadcast scope explicit', () => {
    expect(fleetConversationAudienceLabel('direct')).toBe('私聊 · 仅会话双方')
    expect(fleetConversationAudienceLabel('channel')).toBe('频道 · 全体成员可见')
  })
})

describe('Fleet assistant Session archive choices', () => {
  it('offers Team archive only for a live assistant Session and includes every current assistant connection', () => {
    const teams = [{
      teamId: 'team-one',
      teamName: 'Long-lived Team',
      status: 'running',
      assistantSessionIds: ['assistant-one', 'assistant-two', 'assistant-one'],
      assistantConnections: [{ sessionId: 'assistant-one' }, { sessionId: 'assistant-two' }],
    }, {
      teamId: 'team-closed',
      teamName: 'Archived Team',
      status: 'closed',
      assistantSessionIds: ['assistant-closed'],
      assistantConnections: [{ sessionId: 'assistant-closed' }],
    }]

    expect(resolveFleetAssistantArchiveTarget('assistant-one', teams, [
      'assistant-one',
      'assistant-two',
      'assistant-closed',
    ])).toEqual({
      teamId: 'team-one',
      teamName: 'Long-lived Team',
      sessionId: 'assistant-one',
      connected: true,
      assistantSessionIds: ['assistant-one', 'assistant-two'],
    })
    expect(resolveFleetAssistantArchiveTarget('ordinary-session', teams, ['ordinary-session'])).toBeUndefined()
    expect(resolveFleetAssistantArchiveTarget('assistant-closed', teams, ['assistant-closed'])).toBeUndefined()
  })

  it('offers Team archive for a historical assistant Session without counting unrelated aliases', () => {
    const teams = [{
      teamId: 'team-one',
      teamName: 'Long-lived Team',
      status: 'running',
      assistantSessionIds: [
        'assistant-current',
        'assistant-old-one',
        'assistant-old-two',
      ],
      assistantConnections: [{ sessionId: 'assistant-current' }],
    }]

    expect(resolveFleetAssistantArchiveTarget(
      'assistant-current',
      teams,
      ['assistant-current', 'assistant-old-one'],
    )).toEqual({
      teamId: 'team-one',
      teamName: 'Long-lived Team',
      sessionId: 'assistant-current',
      connected: true,
      assistantSessionIds: ['assistant-current'],
    })
    expect(resolveFleetAssistantArchiveTarget(
      'assistant-old-one',
      teams,
      ['assistant-current', 'assistant-old-one'],
    )).toEqual({
      teamId: 'team-one',
      teamName: 'Long-lived Team',
      sessionId: 'assistant-old-one',
      connected: false,
      assistantSessionIds: ['assistant-old-one', 'assistant-current'],
    })
    expect(resolveFleetAssistantArchiveTarget(
      'assistant-old-two',
      teams,
      ['assistant-current', 'assistant-old-one'],
    )).toBeUndefined()
  })

  it('closes the Team before archiving assistant Sessions sequentially', async () => {
    const calls: string[] = []
    await archiveFleetAssistantTeam({
      target: {
        teamId: 'team-one',
        teamName: 'Long-lived Team',
        sessionId: 'assistant-one',
        connected: true,
        assistantSessionIds: ['assistant-one', 'assistant-two'],
      },
      closeTeam: async () => { calls.push('close') },
      archiveSession: async sessionId => { calls.push(`archive:${sessionId}`) },
    })

    expect(calls).toEqual(['close', 'archive:assistant-one', 'archive:assistant-two'])
  })

  it('archives one assistant Session before disconnecting it from the live Team', async () => {
    const calls: string[] = []
    await archiveFleetAssistantSession({
      archiveSession: async () => { calls.push('archive') },
      detachAssistant: async () => { calls.push('detach') },
    })

    expect(calls).toEqual(['archive', 'detach'])
  })

  it('keeps the assistant connected when native Session archive fails', async () => {
    const detachAssistant = vi.fn(async () => undefined)
    await expect(archiveFleetAssistantSession({
      archiveSession: async () => { throw new Error('archive failed') },
      detachAssistant,
    })).rejects.toThrow('archive failed')

    expect(detachAssistant).not.toHaveBeenCalled()
  })

  it('tries every assistant Session and reports partial archive failures after closing the Team', async () => {
    const calls: string[] = []
    await expect(archiveFleetAssistantTeam({
      target: {
        teamId: 'team-one',
        teamName: 'Long-lived Team',
        sessionId: 'assistant-one',
        connected: true,
        assistantSessionIds: ['assistant-one', 'assistant-two'],
      },
      closeTeam: async () => { calls.push('close') },
      archiveSession: async sessionId => {
        calls.push(`archive:${sessionId}`)
        if (sessionId === 'assistant-one') throw new Error('archive failed')
      },
    })).rejects.toThrow()
    expect(calls).toEqual(['close', 'archive:assistant-one', 'archive:assistant-two'])
  })
})

describe('Fleet assistant mailbox mentions', () => {
  it('promotes only explicit stable-id or display-name mentions', () => {
    expect(fleetAssistantMailboxMentions('@Albany confirm this.', 'team-assistant', 'Albany'))
      .toEqual(['@team-assistant'])
    expect(fleetAssistantMailboxMentions('@team-assistant confirm this.', 'team-assistant', 'Albany'))
      .toEqual(['@team-assistant'])
    expect(fleetAssistantMailboxMentions('Send this to Albany.', 'team-assistant', 'Albany')).toEqual([])
    expect(fleetAssistantMailboxMentions('@AlbanySuffix is different.', 'team-assistant', 'Albany')).toEqual([])
  })
})

describe('Fleet message mention rendering', () => {
  it('recognizes a Team assistant mention at the beginning of message text', () => {
    const members = fleetPanelMentionMembers({
      members: [{
        id: 'alivia', name: 'Alivia', role: 'Engineer', responsibility: 'Implementation', color: '#406080',
      }],
      assistants: [{
        id: 'assistant-alen', name: 'Alen', role: 'Team assistant', responsibility: 'Coordination', color: '#506fa0',
      }],
    })

    const mentions = splitFleetMemberMentions(
      '@Alen 收到，已阅读对齐事项。@Alivia 你好。',
      members,
    ).flatMap(segment => segment.member?.name ?? [])

    expect(mentions).toEqual(['Alen', 'Alivia'])
  })
})

describe('Fleet message reply threads', () => {
  const message = (id: string, replyTo?: string): FleetPanelMessage => ({
    id,
    sequence: Number(id.replace(/\D/g, '')),
    conversationId: '#general',
    senderId: `sender-${id}`,
    sentAt: '2026-09-01T10:00:00.000Z',
    content: [{ type: 'text', text: id }],
    ...(replyTo === undefined ? {} : { kind: 'reply', replyTo }),
  })

  it('nests replies and reply chains under the original message without losing order', () => {
    const threads = groupFleetMessageThreads([
      message('message-1'),
      message('message-2', 'message-1'),
      message('message-3', 'message-2'),
      message('message-4'),
    ])

    expect(threads.map(thread => ({
      message: thread.message.id,
      comments: thread.comments.map(comment => comment.id),
    }))).toEqual([
      { message: 'message-1', comments: ['message-2', 'message-3'] },
      { message: 'message-4', comments: [] },
    ])
  })

  it('keeps a reply visible as a normal message when its source is outside the loaded page', () => {
    expect(groupFleetMessageThreads([message('message-5', 'older-message')]))
      .toEqual([{ message: message('message-5', 'older-message'), comments: [] }])
  })
})

describe('Fleet activity grouping', () => {
  it('groups only adjacent records with the same exact event type', () => {
    const activity = [
      { id: '1', kind: 'memory' as const, type: 'memory.recalled', text: 'first recall', createdAt: '2026-08-26T04:00:00.000Z' },
      { id: '2', kind: 'memory' as const, type: 'memory.recalled', text: 'second recall', createdAt: '2026-08-26T04:01:00.000Z' },
      { id: '3', kind: 'memory' as const, type: 'memory.stored', text: 'stored', createdAt: '2026-08-26T04:02:00.000Z' },
      { id: '4', kind: 'message' as const, type: 'coordination.message', text: 'message', createdAt: '2026-08-26T04:03:00.000Z' },
      { id: '5', kind: 'memory' as const, type: 'memory.recalled', text: 'later recall', createdAt: '2026-08-26T04:04:00.000Z' },
    ]

    expect(groupFleetActivity(activity).map(group => ({
      type: group.type,
      ids: group.items.map(item => item.id),
    }))).toEqual([
      { type: 'memory.recalled', ids: ['1', '2'] },
      { type: 'memory.stored', ids: ['3'] },
      { type: 'coordination.message', ids: ['4'] },
      { type: 'memory.recalled', ids: ['5'] },
    ])
  })

  it('keeps filtered activity views as individual rows', () => {
    const activity = [
      { id: '1', kind: 'message' as const, type: 'coordination.message', text: 'first', createdAt: '2026-08-26T04:00:00.000Z' },
      { id: '2', kind: 'message' as const, type: 'coordination.message', text: 'second', createdAt: '2026-08-26T04:01:00.000Z' },
    ]

    expect(fleetActivityGroups(activity, true)).toHaveLength(1)
    expect(fleetActivityGroups(activity, false).map(group => group.items.map(item => item.id))).toEqual([['1'], ['2']])
  })

  it('keeps only a bounded render window around the current activity', () => {
    expect(fleetActivityWindow(20, 19)).toEqual({ start: 0, end: 20 })
    expect(fleetActivityWindow(1_000, 999)).toEqual({ start: 880, end: 1_000 })
    expect(fleetActivityWindow(1_000, 500)).toEqual({ start: 440, end: 560 })
    expect(fleetActivityWindow(1_000, -1)).toEqual({ start: 0, end: 120 })
  })

  it('keeps semantic timeline anchors fixed while positions move continuously', () => {
    const step = 60 * 60 * 1_000
    const anchor = new Date(2026, 7, 26, 10).getTime()
    const initial = fleetTimelineTicks(anchor, step)
    const shifted = fleetTimelineTicks(anchor + step / 4, step)
    const initialByTimestamp = new Map(initial.map(tick => [tick.timestamp, tick]))
    const common = shifted.filter(tick => initialByTimestamp.has(tick.timestamp))
    expect(common.length).toBeGreaterThan(20)
    for (const tick of common) {
      expect(tick.position).toBeCloseTo(initialByTimestamp.get(tick.timestamp)!.position - 5)
    }
    for (const tick of initial.filter(tick => tick.strength === 1)) {
      const date = new Date(tick.timestamp)
      expect(date.getHours() % 6).toBe(0)
      expect([date.getMinutes(), date.getSeconds(), date.getMilliseconds()]).toEqual([0, 0, 0])
    }

    const year = 365.25 * 24 * 60 * 60 * 1_000
    const yearly = fleetTimelineTicks(anchor, year).filter(tick => tick.strength === 1)
    expect(yearly.length).toBeGreaterThan(2)
    for (const tick of yearly) {
      const date = new Date(tick.timestamp)
      expect(date.getFullYear() % 5).toBe(0)
      expect([date.getMonth(), date.getDate(), date.getHours()]).toEqual([0, 1, 0])
    }
  })

  it('smoothly hands long ticks to the next semantic scale', () => {
    const anchor = new Date(2026, 7, 26).getTime()
    const ticks = fleetTimelineTicks(anchor, 45 * 60 * 1_000)
    const atThreeHours = ticks.find(tick => tick.timestamp === new Date(2026, 7, 26, 3).getTime())
    const atSixHours = ticks.find(tick => tick.timestamp === new Date(2026, 7, 26, 6).getTime())
    expect(atThreeHours?.strength).toBeCloseTo(.5)
    expect(atSixHours?.strength).toBe(1)
  })

  it('clamps clicked timeline targets to the activity range', () => {
    expect(clampFleetTimelineTime(50, 100, 200)).toBe(100)
    expect(clampFleetTimelineTime(150, 100, 200)).toBe(150)
    expect(clampFleetTimelineTime(250, 100, 200)).toBe(200)
  })

  it('treats a folded activity group as its full time interval', () => {
    const groups = groupFleetActivity([
      { id: '1', kind: 'message' as const, type: 'coordination.message', text: 'start', createdAt: '2026-08-26T00:00:00.000Z' },
      { id: '2', kind: 'message' as const, type: 'coordination.message', text: 'end', createdAt: '2026-08-26T10:00:00.000Z' },
      { id: '3', kind: 'resource' as const, type: 'resource.resource_added', text: 'next', createdAt: '2026-08-26T11:00:00.000Z' },
    ])

    expect(nearestFleetActivityGroupIndex(groups, Date.parse('2026-08-26T09:00:00.000Z'))).toBe(0)
  })
})

describe('Fleet member presence', () => {
  it('uses one runtime-to-display mapping across every Fleet surface', () => {
    expect(fleetMemberPresence({ id: 'a', name: 'A', role: 'Agent', color: '#000000', runtimeStatus: 'running' })).toBe('busy')
    expect(fleetMemberPresence({ id: 'a', name: 'A', role: 'Agent', color: '#000000', runtimeStatus: 'paused', presence: 'active' })).toBe('offline')
    expect(fleetMemberPresenceLabel({ id: 'a', name: 'A', role: 'Agent', color: '#000000', runtimeStatus: 'paused' })).toBe('已暂停')
    expect(fleetMemberPresenceLabel({ id: 'a', name: 'A', role: 'Agent', color: '#000000', presence: 'unknown' })).toBe('未加载')
  })
})

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

describe('Fleet member permission groups', () => {
  it('previews inherited grants and keeps deny-only restrictions visible', () => {
    const observer = {
      id: 'observer', name: 'Observer', parents: [], preset: true,
      toolGroups: ['messages'], denyToolGroups: [], actions: ['task.read'], denies: [],
    }
    const restricted = {
      id: 'restricted', name: 'Restricted', parents: ['observer'], preset: false,
      toolGroups: [], denyToolGroups: ['messages'], actions: [], denies: ['task.read'],
    }

    expect(fleetPermissionGroupCapabilities(restricted, [observer, restricted])).toEqual({
      granted: [],
      restricted: [
        { type: 'tool', value: 'messages' },
        { type: 'action', value: 'task.read' },
      ],
    })
  })

  it('tracks direct grants and restrictions independently from group selection', () => {
    const baseline = {
      groups: ['observer'], grants: ['message.wakeup'], denies: [],
      toolGroups: ['messages'], denyToolGroups: [], op: false,
    }
    expect(sameFleetPermissionAssignment(baseline, {
      ...baseline,
      groups: ['observer'],
    })).toBe(true)
    expect(sameFleetPermissionAssignment(baseline, {
      ...baseline,
      denies: ['message.wakeup'],
    })).toBe(false)
    expect(sameFleetPermissionAssignment(baseline, {
      ...baseline,
      op: true,
    })).toBe(false)

    expect(updateFleetPermissionAssignmentValues(
      { ...baseline, grants: [], denies: ['message.wakeup'] },
      'grants',
      'denies',
      ['message.wakeup'],
    )).toMatchObject({ grants: ['message.wakeup'], denies: [] })
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

  it('marks a native operator message read as soon as the Agent loop has projected its claim', () => {
    const user = {
      key: 'user:1',
      id: 'context:1',
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
    })[0]).toMatchObject({ id: 'context:1', sender: 'operator', read: true })

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

  it('drops a settled assistant step whose only visible text block is empty', () => {
    const node = {
      key: 'assistant:empty',
      kind: 'assistant-step',
      visibility: 'visible',
      data: { time: 300, status: 'settled', blocks: [{ kind: 'text', text: '' }] },
    }

    expect(projectAgentFleetPrivateMessages({
      order: [node.key],
      nodes: { get: key => key === node.key ? node : undefined },
    })).toEqual([])
  })

  it('projects only durable direct interactions for a Team assistant', () => {
    const nodes = new Map<string, unknown>([
      ['user:direct', {
        id: 'user-message-1',
        kind: 'user',
        visibility: 'visible',
        data: { time: 100, content: [{ type: 'text', text: 'Inspect the Team.' }] },
      }],
      ['assistant:progress', {
        kind: 'assistant-step',
        visibility: 'visible',
        data: { time: 200, status: 'settled', blocks: [{ kind: 'text', text: 'Background progress noise.' }] },
      }],
      ['assistant:final', {
        kind: 'assistant-step',
        visibility: 'visible',
        data: { time: 300, status: 'settled', blocks: [{ kind: 'text', text: 'A duplicate native final.' }] },
      }],
    ])

    const projected = projectAgentFleetPrivateMessages({
      order: [...nodes.keys()],
      nodes: { get: key => nodes.get(key) },
      interactions: [{
        revision: 1,
        messageId: 'user-message-1',
        input: 'Inspect the Team.',
        inputAt: '2026-09-01T08:00:00.000Z',
        updates: [{
          id: 'update-1',
          text: 'The Team check is underway.',
          sentAt: '2026-09-01T08:00:30.000Z',
        }],
        output: 'The Team is healthy.',
        outputAt: '2026-09-01T08:01:00.000Z',
      }],
    })

    expect(projected).toMatchObject([
      { id: 'interaction:1:user', sender: 'operator', content: [{ type: 'text', text: 'Inspect the Team.' }] },
      { id: 'interaction:1:update:update-1', sender: 'assistant', content: [{ type: 'text', text: 'The Team check is underway.' }] },
      { id: 'interaction:1:assistant', sender: 'assistant', content: [{ type: 'text', text: 'The Team is healthy.' }] },
    ])
    expect(JSON.stringify(projected)).not.toContain('Background progress noise')
    expect(JSON.stringify(projected)).not.toContain('duplicate native final')
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

  it('carries a selected member from member, direct-message, and Git views into Agent navigation', () => {
    expect(fleetPanelSelectedMemberId(team, 'team', 'sam')).toBe('sam')
    expect(fleetPanelSelectedMemberId(team, 'chat', '@alex-session')).toBe('alex')
    expect(fleetPanelSelectedMemberId(team, 'git', 'team-assistant')).toBe('team-assistant')
  })

  it('does not infer a member from a channel or unrelated plugin state', () => {
    expect(fleetPanelSelectedMemberId(team, 'chat', 'general')).toBeUndefined()
    expect(fleetPanelSelectedMemberId(team, 'git', 'unknown-member')).toBeUndefined()
    expect(fleetPanelSelectedMemberId(team, 'resources', 'plan')).toBeUndefined()
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
  it('derives independent Team actions from ordinary member states', () => {
    expect(fleetPanelTeamRunControls({
      status: 'running', runtimeState: 'active', memberStatuses: ['idle', 'unknown', 'paused'],
    }).map(control => control.action)).toEqual(['load', 'pause', 'wake'])
    expect(fleetPanelTeamRunControls({
      status: 'paused', runtimeState: 'active', memberStatuses: ['paused', 'paused'],
    }).map(control => control.action)).toEqual(['resume', 'wake'])
    expect(fleetPanelTeamRunControls({
      status: 'paused', runtimeState: 'active', memberStatuses: ['paused', 'idle'],
    }).map(control => control.action)).toEqual(['resume', 'pause', 'wake'])
    expect(fleetPanelTeamRunControls({
      status: 'idle', runtimeState: 'dormant', memberStatuses: ['unknown', 'unknown'],
    }).map(control => control.action)).toEqual(['load', 'wake'])
  })

  it('keeps wake available through nonterminal transitions and hides controls after termination', () => {
    expect(fleetPanelTeamRunControls({
      status: 'finishing', runtimeState: 'active', memberStatuses: ['idle'],
    }).map(control => control.action)).toEqual(['wake'])
    expect(fleetPanelTeamRunControls({ status: 'closed', runtimeState: 'dormant', memberStatuses: ['offline'] })).toEqual([])
    expect(fleetPanelTeamRunControls({ status: 'failed', runtimeState: 'dormant', memberStatuses: ['offline'] })).toEqual([])
    expect(fleetPanelTeamRunControls({ status: 'disconnected', runtimeState: 'dormant', memberStatuses: ['offline'] })).toEqual([])
  })
})

describe('Fleet member run control', () => {
  it('offers load and wake without pause for an unloaded ordinary member', () => {
    expect(fleetPanelMemberRunControls({ runtimeStatus: 'unknown' }, false, 'idle')
      .map(control => control.action)).toEqual(['resume', 'wake'])
  })

  it('offers resume plus wake for a paused member and pause plus wake for a loaded member', () => {
    expect(fleetPanelMemberRunControls({ runtimeStatus: 'paused' }, false, 'paused')
      .map(control => control.action)).toEqual(['resume', 'wake'])
    expect(fleetPanelMemberRunControls({ runtimeStatus: 'idle' }, false, 'idle')
      .map(control => control.action)).toEqual(['pause', 'wake'])
  })

  it('keeps assistants out of pause state while retaining interrupt and wake', () => {
    expect(fleetPanelMemberRunControls({ runtimeStatus: 'running' }, true, 'running')
      .map(control => control.action)).toEqual(['pause', 'wake'])
    expect(fleetPanelMemberRunControls({ runtimeStatus: 'idle' }, true, 'idle')
      .map(control => control.action)).toEqual(['wake'])
    expect(fleetPanelMemberRunControls({ runtimeStatus: 'offline' }, true, 'idle')
      .map(control => control.action)).toEqual(['resume', 'wake'])
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

  it('recognizes only a leading slash token as an active command query', () => {
    expect(activeFleetCommandQuery('/mo', 3)).toEqual({ start: 0, end: 3, query: 'mo' })
    expect(activeFleetCommandQuery('  /plan', 7)).toEqual({ start: 2, end: 7, query: 'plan' })
    expect(activeFleetCommandQuery('look /mo', 8)).toBeUndefined()
    expect(activeFleetCommandQuery('/goal task', 10)).toBeUndefined()
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
