import { describe, expect, it, vi } from 'vitest'

import type { FleetPanelSnapshot, FleetPanelSource } from '../packages/ui/src/team-panel.js'
import {
  createFleetTutorialPanelSource,
  FLEET_TUTORIAL_TEAM_ID,
  projectFleetTutorialTeam,
} from '../packages/ui/src/tutorial-team.js'

const emptyConnected: FleetPanelSnapshot = {
  directory: {
    teams: [],
    groups: [
      { id: 'ungrouped', name: '未分组', kind: 'ungrouped', teamIds: [] },
      { id: 'archived', name: '已归档', kind: 'archived', teamIds: [] },
    ],
  },
  connection: { status: 'connected' },
}

describe('Fleet tutorial Team projection', () => {
  it('fills an empty connected directory with a read-only demo Team', () => {
    const projected = projectFleetTutorialTeam(emptyConnected, true, Date.UTC(2026, 0, 1))

    expect(projected.selectedTeamId).toBe(FLEET_TUTORIAL_TEAM_ID)
    expect(projected.directory.teams).toMatchObject([{
      teamId: FLEET_TUTORIAL_TEAM_ID,
      tutorial: true,
    }])
    expect(projected.directory.groups[0]).toMatchObject({ id: 'tutorial', teamIds: [FLEET_TUTORIAL_TEAM_ID] })
    expect(projected.team?.tutorial).toBe(true)
    expect(projected.team?.members.map(member => member.presence).sort()).toEqual(['active', 'busy', 'waiting'])
    expect(projected.team?.members.every(member => !Number.isNaN(Date.parse(member.statusUpdatedAt ?? '')))).toBe(true)
    expect(projected.team?.messages.some(message => message.receipt !== undefined)).toBe(true)
    expect(projected.team?.resources.some(resource => resource.mediaType === 'text/markdown')).toBe(true)
  })

  it('does not cover loading, disconnected, or real Team snapshots', () => {
    const loading = { ...emptyConnected, connection: { status: 'loading' as const } }
    const real: FleetPanelSnapshot = {
      ...emptyConnected,
      directory: {
        ...emptyConnected.directory,
        teams: [{ teamId: 'real', teamName: 'Real Team', status: 'idle' }],
      },
    }

    expect(projectFleetTutorialTeam(loading, false)).toBe(loading)
    expect(projectFleetTutorialTeam(real, false)).toBe(real)
  })

  it('keeps the projection stable, blocks demo messages, and disappears after a real Team arrives', async () => {
    let snapshot = emptyConnected
    const selectTeam = vi.fn()
    const sendMessage = vi.fn(async () => {})
    const base: FleetPanelSource = {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      selectTeam,
      sendMessage,
    }
    const source = createFleetTutorialPanelSource(base)

    expect(source.getSnapshot()).toBe(source.getSnapshot())
    source.selectTeam(FLEET_TUTORIAL_TEAM_ID)
    expect(selectTeam).not.toHaveBeenCalled()
    await expect(source.sendMessage({
      sessionId: 'session',
      teamId: FLEET_TUTORIAL_TEAM_ID,
      conversationId: 'tutorial:lobby',
      content: [{ type: 'text', text: 'hello' }],
    })).rejects.toThrow(/只读演示|read-only/u)
    expect(sendMessage).not.toHaveBeenCalled()

    const trace = await source.loadMemberTrace?.(FLEET_TUTORIAL_TEAM_ID, 'tutorial:mina', undefined, {
      source: {
        memberId: 'tutorial:mina',
        sessionId: '2a84e284-ac87-4fdc-9944-83c323d4753d',
        contextMessageId: 'b5eff5d0-ab97-44f5-81ab-1e3e8ac9742e',
      },
    })
    expect(trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'session.user/message',
        target: true,
        data: expect.stringContaining('b5eff5d0-ab97-44f5-81ab-1e3e8ac9742e'),
      }),
      expect.objectContaining({ type: 'session.assistant/message' }),
    ]))

    snapshot = {
      ...emptyConnected,
      directory: {
        ...emptyConnected.directory,
        teams: [{ teamId: 'real', teamName: 'Real Team', status: 'idle' }],
      },
    }
    expect(source.getSnapshot()).toBe(snapshot)
    snapshot = emptyConnected
    expect(source.getSnapshot()).toBe(emptyConnected)
  })
})
