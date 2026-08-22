import { isChineseLocale } from './locale.js'
import type {
  FleetPanelSnapshot,
  FleetPanelSource,
  FleetPanelTeamSnapshot,
} from './team-panel.js'

export const FLEET_TUTORIAL_TEAM_ID = 'fleet:tutorial'

const TUTORIAL_COMPLETE_KEY = 'dsh-agent-fleet.tutorial-team.v1'

function tutorialTeam(chinese: boolean, now: number): FleetPanelTeamSnapshot {
  const text = (zh: string, en: string): string => chinese ? zh : en
  const sentAt = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString()
  const brief = text(
    '# 引导项目\n\n目标：认识团队频道、成员状态和共享资源。\n\n本文件只存在于演示投影中，不会写入工作区。',
    '# Guided project\n\nGoal: explore Team channels, member status, and shared resources.\n\nThis file only exists in the demo projection and is never written to a Workspace.',
  )
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
        color: '#527FCA',
        presence: 'busy',
        runtimeStatus: 'running',
        provider: text('教程数据', 'Tutorial data'),
        model: text('未启动模型', 'No model running'),
        visibleConversationIds: ['tutorial:lobby', '@tutorial:nova'],
      },
      {
        id: 'tutorial:mina',
        name: 'Mina',
        role: text('工程师', 'Engineer'),
        responsibility: text('实现可运行的增量并记录关键产物', 'Builds working increments and records key artifacts'),
        statusText: text('等待 Rowan 复核共享计划', 'Waiting for Rowan to review the shared plan'),
        color: '#4C8A75',
        presence: 'waiting',
        runtimeStatus: 'waiting',
        provider: text('教程数据', 'Tutorial data'),
        model: text('未启动模型', 'No model running'),
        visibleConversationIds: ['tutorial:lobby', 'tutorial:mina-rowan'],
      },
      {
        id: 'tutorial:rowan',
        name: 'Rowan',
        role: text('评审者', 'Reviewer'),
        responsibility: text('检查证据、风险和完成质量', 'Reviews evidence, risk, and completion quality'),
        statusText: text('已完成当前检查，可响应新消息', 'Finished the current review and available'),
        color: '#846BB3',
        presence: 'active',
        runtimeStatus: 'idle',
        provider: text('教程数据', 'Tutorial data'),
        model: text('未启动模型', 'No model running'),
        visibleConversationIds: ['tutorial:lobby', 'tutorial:mina-rowan'],
      },
    ],
    messages: [
      {
        id: 'tutorial:welcome',
        conversationId: 'tutorial:lobby',
        senderId: 'tutorial:nova',
        sentAt: sentAt(8),
        content: [{
          type: 'text',
          text: text(
            '欢迎来到引导团队。这里显示的是演示数据，不会启动真实 Agent，也不会消耗 Token。',
            'Welcome to the guided Team. Everything here is demo data: no Agents are started and no tokens are used.',
          ),
        }],
        receipt: {
          visibleMemberIds: ['tutorial:mina', 'tutorial:rowan'],
          readMemberIds: ['tutorial:mina', 'tutorial:rowan'],
          unreadMemberIds: [],
          sources: [
            { memberId: 'tutorial:mina', sessionId: 'tutorial:mina', contextMessageId: 'tutorial:context:welcome:mina' },
            { memberId: 'tutorial:rowan', sessionId: 'tutorial:rowan', contextMessageId: 'tutorial:context:welcome:rowan' },
          ],
        },
      },
      {
        id: 'tutorial:plan',
        conversationId: 'tutorial:lobby',
        senderId: 'tutorial:mina',
        sentAt: sentAt(5),
        content: [
          { type: 'mention', memberId: 'tutorial:rowan', label: 'Rowan' },
          { type: 'text', text: text(' 我已经整理了共享计划，麻烦检查下一步是否足够清晰。', ' I drafted the shared plan. Please check whether the next step is clear enough.') },
          { type: 'resource', id: 'tutorial:brief', label: 'project-brief.md', mediaType: 'text/markdown', size: brief.length },
        ],
        receipt: {
          visibleMemberIds: ['tutorial:nova', 'tutorial:rowan'],
          readMemberIds: ['tutorial:nova'],
          unreadMemberIds: ['tutorial:rowan'],
          sources: [
            { memberId: 'tutorial:nova', sessionId: 'tutorial:nova', contextMessageId: 'tutorial:context:plan:nova' },
            { memberId: 'tutorial:rowan', sessionId: 'tutorial:rowan', contextMessageId: 'tutorial:context:plan:rowan' },
          ],
        },
      },
      {
        id: 'tutorial:review',
        conversationId: 'tutorial:mina-rowan',
        senderId: 'tutorial:rowan',
        sentAt: sentAt(2),
        content: [{
          type: 'text',
          text: text('方向清楚。我会在主频道里给出复核结论。', 'The direction is clear. I’ll post the review result in the main channel.'),
        }],
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
      path: '.fleet/tutorial/project-brief.md',
      detail: text('只读的演示计划，不会写入本机', 'Read-only demo plan; never written to disk'),
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
  }
}
