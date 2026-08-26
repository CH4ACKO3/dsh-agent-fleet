import { isChineseLocale } from './locale.js'
import type {
  FleetPanelMemberTrace,
  FleetPanelMemberTraceEvent,
  FleetPanelMemberTraceRequest,
  FleetPanelSnapshot,
  FleetPanelSource,
  FleetPanelTeamSnapshot,
} from './team-panel.js'

export const FLEET_TUTORIAL_TEAM_ID = 'fleet:tutorial'

const TUTORIAL_COMPLETE_KEY = 'dsh-agent-fleet.tutorial-team.v1'

const TUTORIAL_SESSIONS = {
  nova: '20c5c2c0-a868-4606-b3de-cd197d617cb6',
  mina: '2a84e284-ac87-4fdc-9944-83c323d4753d',
  rowan: 'fd763eaa-56a1-4f2b-9ed0-14686be1d735',
} as const

function recordedEvent(
  sessionId: string,
  sequence: number,
  createdAt: string,
  type: string,
  data: Record<string, unknown>,
): FleetPanelMemberTraceEvent {
  return { sessionId, sequence, createdAt, type, data: JSON.stringify(data) }
}

const TUTORIAL_TRACES: Readonly<Record<string, readonly FleetPanelMemberTraceEvent[]>> = {
  'tutorial:nova': [
    recordedEvent(TUTORIAL_SESSIONS.nova, 3586, '2026-08-22T21:36:56.944Z', 'session.user/message', {
      id: 'f426cfdd-8f50-4e0f-83d4-2b6ae77a523d',
      content: [{ type: 'text', text: '[Fleet DM | msg_1 | from=@Mina] Ready to save the agreed onboarding checklist as project-brief.md. Could you post the proposed checklist in #main?' }],
    }),
    recordedEvent(TUTORIAL_SESSIONS.nova, 9933, '2026-08-22T21:37:52.583Z', 'session.assistant/message', {
      message: { content: [{ type: 'reasoning', text: 'Mina is ready. I should publish the agreed one-paragraph checklist in the main Channel and ask Mina to save it and Rowan to review it.' }] },
    }),
    recordedEvent(TUTORIAL_SESSIONS.nova, 9938, '2026-08-22T21:37:52.603Z', 'session.tool/call', {
      name: 'fleet_send',
      arguments: '{"to":"#main","message":"Proposed onboarding checklist… @Mina, please save it; @Rowan, please review once saved."}',
    }),
    recordedEvent(TUTORIAL_SESSIONS.nova, 12529, '2026-08-22T21:38:31.818Z', 'session.user/message', {
      id: 'd12eb68d-04a9-4561-9913-605caf034105',
      content: [{ type: 'text', text: '[Fleet #main] Unread channel activity is waiting. Latest message msg_4 is from @Rowan.' }],
    }),
    recordedEvent(TUTORIAL_SESSIONS.nova, 18023, '2026-08-22T21:40:03.345Z', 'session.user/message', {
      id: '499ef653-cb47-413d-8e86-4931392feedf',
      content: [{ type: 'text', text: '[Fleet #main] Unread channel activity is waiting. Latest message msg_6 is from @Mina.' }],
    }),
  ],
  'tutorial:mina': [
    recordedEvent(TUTORIAL_SESSIONS.mina, 6266, '2026-08-22T21:37:58.203Z', 'session.user/message', {
      id: 'b5eff5d0-ab97-44f5-81ab-1e3e8ac9742e',
      content: [{ type: 'text', text: '[Fleet #main] Unread channel activity is waiting. Latest message msg_2 is from @Nova.' }],
    }),
    recordedEvent(TUTORIAL_SESSIONS.mina, 6329, '2026-08-22T21:37:59.298Z', 'session.assistant/message', {
      message: { content: [{ type: 'reasoning', text: 'There is a message from Nova in #main. I should read the agreed checklist before saving the shared artifact.' }] },
    }),
    recordedEvent(TUTORIAL_SESSIONS.mina, 6330, '2026-08-22T21:37:59.300Z', 'session.tool/call', {
      name: 'fleet_messages', arguments: '{"action":"read","conversation":"#main"}',
    }),
    recordedEvent(TUTORIAL_SESSIONS.mina, 6331, '2026-08-22T21:37:59.316Z', 'session.tool/result', {
      message: { content: [{ type: 'text', text: 'msg_2 · Nova proposed the agreed one-paragraph onboarding checklist and assigned Mina to save it.' }] },
    }),
    recordedEvent(TUTORIAL_SESSIONS.mina, 7603, '2026-08-22T21:38:09.255Z', 'session.user/message', {
      id: '11166d52-d393-4e4f-88c5-22b9a10e35f4',
      content: [{ type: 'text', text: '[Fleet DM | msg_3 | from=@Nova] Confirmed — the text in msg_2 is the agreed checklist. Please save project-brief.md and post your update.' }],
    }),
    recordedEvent(TUTORIAL_SESSIONS.mina, 8075, '2026-08-22T21:38:12.472Z', 'session.tool/call', {
      name: 'write', arguments: '{"file_path":"…/project-brief.md","content":"New members onboard with this checklist…"}',
    }),
    recordedEvent(TUTORIAL_SESSIONS.mina, 8076, '2026-08-22T21:38:12.491Z', 'session.tool/result', {
      message: { content: [{ type: 'text', text: 'Created /workspace/demo/.fleet/…/project-brief.md' }] },
    }),
    recordedEvent(TUTORIAL_SESSIONS.mina, 10855, '2026-08-22T21:38:39.175Z', 'session.user/message', {
      id: '41e01d91-76c4-4fa4-bce5-bba97084711d',
      content: [{ type: 'text', text: '[Fleet #main] Unread channel activity is waiting. Latest message msg_4 is from @Rowan.' }],
    }),
    recordedEvent(TUTORIAL_SESSIONS.mina, 17120, '2026-08-22T21:39:34.494Z', 'session.user/message', {
      id: '5fe2a0cf-63b6-4fd1-9d50-e892fd907c93',
      content: [{ type: 'text', text: '[Fleet DM | msg_5 | from=@Aileen] The artifact is present and approved. Please post the short completion message in #main.' }],
    }),
  ],
  'tutorial:rowan': [
    recordedEvent(TUTORIAL_SESSIONS.rowan, 7379, '2026-08-22T21:37:53.399Z', 'session.user/message', {
      id: '9028238b-0971-42c0-b76d-398b5463262f',
      content: [{ type: 'text', text: '[Fleet #main] Unread channel activity is waiting. Latest message msg_2 is from @Nova.' }],
    }),
    recordedEvent(TUTORIAL_SESSIONS.rowan, 7453, '2026-08-22T21:37:54.777Z', 'session.assistant/message', {
      message: { content: [{ type: 'reasoning', text: 'Nova posted the proposed checklist. I should read the Channel, wait for Mina to save the file, then independently inspect it.' }] },
    }),
    recordedEvent(TUTORIAL_SESSIONS.rowan, 7454, '2026-08-22T21:37:54.778Z', 'session.tool/call', {
      name: 'fleet_messages', arguments: '{"action":"read","conversation":"#main"}',
    }),
    recordedEvent(TUTORIAL_SESSIONS.rowan, 8256, '2026-08-22T21:38:25.853Z', 'session.tool/call', {
      name: 'read', arguments: '{"file_path":"…/project-brief.md"}',
    }),
    recordedEvent(TUTORIAL_SESSIONS.rowan, 8257, '2026-08-22T21:38:25.862Z', 'session.tool/result', {
      message: { content: [{ type: 'text', text: 'project-brief.md · one paragraph containing the agreed onboarding checklist.' }] },
    }),
    recordedEvent(TUTORIAL_SESSIONS.rowan, 8766, '2026-08-22T21:38:31.786Z', 'session.tool/call', {
      name: 'fleet_send', arguments: '{"to":"#main","message":"Review: project-brief.md is exactly one paragraph. Verdict: approved."}',
    }),
    recordedEvent(TUTORIAL_SESSIONS.rowan, 9604, '2026-08-22T21:39:58.097Z', 'session.user/message', {
      id: '997887af-8b88-4319-a420-7b23b6d9529c',
      content: [{ type: 'text', text: '[Fleet #main] Unread channel activity is waiting. Latest message msg_6 is from @Mina.' }],
    }),
  ],
}

function tutorialMemberTrace(memberId: string, request?: FleetPanelMemberTraceRequest): FleetPanelMemberTrace {
  const events = [...(TUTORIAL_TRACES[memberId] ?? [])]
  const contextMessageId = request?.source?.contextMessageId
  if (contextMessageId === undefined) return { events, truncated: false }
  const target = events.findIndex(event => {
    try {
      return (JSON.parse(event.data) as { readonly id?: string }).id === contextMessageId
    } catch {
      return false
    }
  })
  if (target < 0) return { events: [], truncated: false }
  return {
    events: events.slice(Math.max(0, target - 1), Math.min(events.length, target + 3)).map(event => ({
      ...event,
      ...(event === events[target] ? { target: true } : {}),
    })),
    truncated: false,
  }
}

function tutorialTeam(chinese: boolean, now: number): FleetPanelTeamSnapshot {
  const text = (zh: string, en: string): string => chinese ? zh : en
  const sentAt = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString()
  const budgetStartedAt = new Date(now).toISOString()
  const emptyBudgetAccount = {
    startedAt: budgetStartedAt,
    used: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    calls: 0,
    unmeteredCalls: 0,
    models: [],
    state: 'unlimited' as const,
  }
  const brief = "New members onboard with this checklist: (1) read this project brief and the Team positioning to understand the demo's scope and boundaries; (2) join the main Channel and review recent messages for context; (3) set your member status so teammates can see what you are working on; (4) claim or accept an owned task and message the relevant peer directly rather than waiting for a coordinator; and (5) keep the work small — no votes or meetings, just a short completion update in the main Channel."
  return {
    teamId: FLEET_TUTORIAL_TEAM_ID,
    teamName: text('引导团队 · 临时', 'Guided tour · Temporary'),
    tutorial: true,
    color: '#5E7EAE',
    status: 'idle',
    runtimeState: 'active',
    conversations: [
      {
        id: 'tutorial:lobby',
        kind: 'channel',
        name: text('项目大厅', 'project-lobby'),
        topic: text('演示团队如何在频道中协作', 'See how a Team collaborates in a channel'),
        participantIds: ['tutorial:nova', 'tutorial:mina', 'tutorial:rowan'],
        memberCount: 3,
        activeCount: 3,
      },
      {
        id: '@tutorial:nova',
        kind: 'direct',
        name: 'Nova',
        topic: text('与 Nova 的演示私聊', 'Demo private chat with Nova'),
        peerId: 'tutorial:nova',
      },
      {
        id: 'tutorial:mina-rowan',
        kind: 'direct',
        name: 'Mina ↔ Rowan',
        participantIds: ['tutorial:mina', 'tutorial:rowan'],
      },
    ],
    members: [
      {
        id: 'tutorial:nova',
        name: 'Nova',
        role: text('产品负责人', 'Product lead'),
        responsibility: text('澄清长期方向并维护团队的共同工作上下文', 'Clarifies the long-term direction and maintains shared context'),
        statusText: text('正在整理团队的第一项工作', 'Shaping the Team’s first piece of work'),
        statusUpdatedAt: '2026-08-22T21:37:52.620Z',
        color: '#527FCA',
        presence: 'busy',
        runtimeStatus: 'running',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        sessionId: TUTORIAL_SESSIONS.nova,
        visibleConversationIds: ['tutorial:lobby', '@tutorial:nova'],
      },
      {
        id: 'tutorial:mina',
        name: 'Mina',
        role: text('工程师', 'Engineer'),
        responsibility: text('实现可运行的增量并记录关键产物', 'Builds working increments and records key artifacts'),
        statusText: text('等待 Rowan 复核共享计划', 'Waiting for Rowan to review the shared plan'),
        statusUpdatedAt: '2026-08-22T21:39:58.102Z',
        color: '#4C8A75',
        presence: 'waiting',
        runtimeStatus: 'waiting',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        sessionId: TUTORIAL_SESSIONS.mina,
        visibleConversationIds: ['tutorial:lobby', 'tutorial:mina-rowan'],
      },
      {
        id: 'tutorial:rowan',
        name: 'Rowan',
        role: text('评审者', 'Reviewer'),
        responsibility: text('检查证据、风险和完成质量', 'Reviews evidence, risk, and completion quality'),
        statusText: text('已完成当前检查，可响应新消息', 'Finished the current review and available'),
        statusUpdatedAt: '2026-08-22T21:38:31.811Z',
        color: '#846BB3',
        presence: 'active',
        runtimeStatus: 'idle',
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        sessionId: TUTORIAL_SESSIONS.rowan,
        visibleConversationIds: ['tutorial:lobby', 'tutorial:mina-rowan'],
      },
    ],
    messages: [
      {
        id: 'msg_2',
        sequence: 2,
        conversationId: 'tutorial:lobby',
        senderId: 'tutorial:nova',
        sentAt: sentAt(8),
        content: [{
          type: 'text',
          text: text(
            '这是一次真实运行的录制回放：Nova 提议了一段新成员入职清单，并请 Mina 保存、Rowan 复核。浏览回放不会启动 Agent 或消耗 Token。',
            'This is a recording of a real run: Nova proposed an onboarding checklist and asked Mina to save it and Rowan to review it. Replaying it starts no Agents and uses no tokens.',
          ),
        }],
        receipt: {
          visibleMemberIds: ['tutorial:mina', 'tutorial:rowan'],
          readMemberIds: ['tutorial:mina', 'tutorial:rowan'],
          unreadMemberIds: [],
          sources: [
            { memberId: 'tutorial:mina', sessionId: TUTORIAL_SESSIONS.mina, contextMessageId: 'b5eff5d0-ab97-44f5-81ab-1e3e8ac9742e' },
            { memberId: 'tutorial:rowan', sessionId: TUTORIAL_SESSIONS.rowan, contextMessageId: '9028238b-0971-42c0-b76d-398b5463262f' },
          ],
        },
      },
      {
        id: 'msg_4',
        sequence: 4,
        conversationId: 'tutorial:lobby',
        senderId: 'tutorial:rowan',
        sentAt: sentAt(4),
        content: [{
          type: 'text',
          text: text('复核：project-brief.md 恰好是一段，并包含约定的入职清单。结论：✅ 通过。', 'Review: project-brief.md is exactly one paragraph and contains the agreed checklist. Verdict: ✅ approved.'),
        }],
        receipt: {
          visibleMemberIds: ['tutorial:nova', 'tutorial:mina'],
          readMemberIds: ['tutorial:nova', 'tutorial:mina'],
          unreadMemberIds: [],
          sources: [
            { memberId: 'tutorial:nova', sessionId: TUTORIAL_SESSIONS.nova, contextMessageId: 'd12eb68d-04a9-4561-9913-605caf034105' },
            { memberId: 'tutorial:mina', sessionId: TUTORIAL_SESSIONS.mina, contextMessageId: '41e01d91-76c4-4fa4-bce5-bba97084711d' },
          ],
        },
      },
      {
        id: 'msg_6',
        sequence: 6,
        conversationId: 'tutorial:lobby',
        senderId: 'tutorial:mina',
        sentAt: sentAt(2),
        content: [
          { type: 'text', text: text('已将 Nova 确认的入职清单逐字保存为团队共享文件 project-brief.md。谢谢 ', 'Saved Nova’s agreed onboarding checklist verbatim as the Team shared file project-brief.md. Thanks ') },
          { type: 'mention', memberId: 'tutorial:rowan', label: 'Rowan' },
          { type: 'text', text: text(' 完成复核。', ' for the review.') },
          { type: 'resource', id: 'tutorial:brief', label: 'project-brief.md', mediaType: 'text/markdown', size: brief.length },
        ],
        receipt: {
          visibleMemberIds: ['tutorial:nova', 'tutorial:rowan'],
          readMemberIds: [],
          unreadMemberIds: ['tutorial:nova', 'tutorial:rowan'],
          sources: [
            { memberId: 'tutorial:nova', sessionId: TUTORIAL_SESSIONS.nova, contextMessageId: '499ef653-cb47-413d-8e86-4931392feedf' },
            { memberId: 'tutorial:rowan', sessionId: TUTORIAL_SESSIONS.rowan, contextMessageId: '997887af-8b88-4319-a420-7b23b6d9529c' },
          ],
        },
      },
      {
        id: 'tutorial:direct',
        conversationId: '@tutorial:nova',
        senderId: 'tutorial:nova',
        sentAt: sentAt(1),
        content: [{
          type: 'text',
          text: text('这里是成员私聊。真实团队中，你可以直接联系需要参与的成员。', 'This is a member DM. In a real Team, you can contact the relevant member directly.'),
        }],
      },
    ],
    resources: [{
      id: 'tutorial:brief',
      name: 'project-brief.md',
      kind: 'plan',
      path: '.fleet/recording/project-brief.md',
      detail: text('真实团队运行生成的只读回放文件', 'Read-only file captured from a real Team run'),
      mediaType: 'text/markdown',
      size: brief.length,
      body: brief,
      updatedAt: sentAt(5),
    }],
    activity: [
      { id: 'tutorial:activity:1', kind: 'member', text: text('Nova 开始整理第一项工作', 'Nova started shaping the first piece of work'), createdAt: sentAt(8) },
      { id: 'tutorial:activity:2', kind: 'resource', text: text('Mina 更新了 project-brief.md', 'Mina updated project-brief.md'), createdAt: sentAt(5) },
      { id: 'tutorial:activity:3', kind: 'message', text: text('Rowan 完成复核并回到空闲状态', 'Rowan completed the review and returned to idle'), createdAt: sentAt(2) },
    ],
    budget: {
      mode: 'tokens',
      rates: [],
      configuredModels: [],
      team: emptyBudgetAccount,
      members: [
        { ...emptyBudgetAccount, memberId: 'tutorial:nova', name: 'Nova', role: text('产品负责人', 'Product lead'), color: '#527FCA', assistant: false, active: true },
        { ...emptyBudgetAccount, memberId: 'tutorial:mina', name: 'Mina', role: text('工程师', 'Engineer'), color: '#4C8A75', assistant: false, active: true },
        { ...emptyBudgetAccount, memberId: 'tutorial:rowan', name: 'Rowan', role: text('评审者', 'Reviewer'), color: '#846BB3', assistant: false, active: true },
      ],
    },
  }
}

export function projectFleetTutorialTeam(
  snapshot: FleetPanelSnapshot,
  chinese: boolean,
  now = Date.now(),
): FleetPanelSnapshot {
  if (snapshot.connection?.status !== 'connected' || snapshot.directory.teams.length > 0) return snapshot
  const team = tutorialTeam(chinese, now)
  return {
    ...snapshot,
    directory: {
      teams: [{
        teamId: team.teamId,
        teamName: team.teamName,
        tutorial: true,
        color: team.color ?? '#5E7EAE',
        status: team.status,
        runtimeState: team.runtimeState ?? 'active',
      }],
      groups: [
        {
          id: 'tutorial',
          name: chinese ? '入门' : 'Getting started',
          kind: 'custom',
          teamIds: [team.teamId],
        },
        ...snapshot.directory.groups,
      ],
    },
    selectedTeamId: team.teamId,
    team,
  }
}

function tutorialComplete(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(TUTORIAL_COMPLETE_KEY) === 'complete'
  } catch {
    return false
  }
}

function markTutorialComplete(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TUTORIAL_COMPLETE_KEY, 'complete')
  } catch {}
}

export function createFleetTutorialPanelSource(source: FleetPanelSource): FleetPanelSource {
  let hidden = tutorialComplete()
  let previousSource: FleetPanelSnapshot | undefined
  let previousChinese: boolean | undefined
  let previousProjection: FleetPanelSnapshot | undefined

  return {
    ...source,
    getSnapshot: () => {
      const snapshot = source.getSnapshot()
      if (snapshot.directory.teams.length > 0) {
        if (!hidden) {
          hidden = true
          markTutorialComplete()
        }
        return snapshot
      }
      if (hidden) return snapshot
      const chinese = isChineseLocale()
      if (snapshot === previousSource && chinese === previousChinese && previousProjection !== undefined) {
        return previousProjection
      }
      previousSource = snapshot
      previousChinese = chinese
      previousProjection = projectFleetTutorialTeam(snapshot, chinese)
      return previousProjection
    },
    subscribe: listener => source.subscribe(listener),
    selectTeam: teamId => {
      if (teamId !== FLEET_TUTORIAL_TEAM_ID) source.selectTeam(teamId)
    },
    sendMessage: input => input.teamId === FLEET_TUTORIAL_TEAM_ID
      ? Promise.reject(new Error(isChineseLocale()
        ? '引导团队是只读演示；创建真实团队后即可发送消息'
        : 'The guided Team is read-only. Create a real Team to send messages.'))
      : source.sendMessage(input),
    loadMemberTrace: (teamId, memberId, _signal, request) => teamId === FLEET_TUTORIAL_TEAM_ID
      ? Promise.resolve(tutorialMemberTrace(memberId, request))
      : source.loadMemberTrace?.(teamId, memberId, _signal, request)
        ?? Promise.reject(new Error('Fleet member trace is unavailable')),
  }
}
