import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { FleetMemberStatusBoard } from '@dsh-agent-fleet/core'
import type { FleetMemberDirectory, FleetMemberStatusEvent } from '@dsh-agent-fleet/core'
import { FleetResources } from '@dsh-agent-fleet/resources'
import type { FleetResourceEvent } from '@dsh-agent-fleet/resources'
import { describe, expect, it } from 'vitest'

import { createEventSubscriptions } from '../../src/event-bridge.js'
import { NOOP_FLEET_TEAM_EVENT_BUS } from '../../src/team-event-bus.js'

const members = [
  { id: 'agent-lead', name: 'lead' },
  { id: 'agent-reviewer', name: 'reviewer' },
]

const directory: FleetMemberDirectory = {
  list: () => members,
  nameForAgent: id => members.find(entry => entry.id === id)?.name,
  resolve(reference) {
    const value = reference.startsWith('@') ? reference.slice(1) : reference
    return members.find(entry => entry.name === value || entry.id === value)?.name
  },
}

describe('FleetTeamEventBus integration', () => {
  it('routes member status events through the aggregate bus', () => {
    const events: FleetMemberStatusEvent[] = []
    const subscriptions = createEventSubscriptions(() => {}, {
      ...NOOP_FLEET_TEAM_EVENT_BUS,
      onMemberStatus: event => { events.push(event) },
    })
    const board = new FleetMemberStatusBoard(directory)
    const stop = board.onEvent(subscriptions.onMemberStatusEvent)

    try {
      board.set('agent-lead', 'Reviewing the change')
      board.clear('agent-lead')
      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({
        action: 'updated',
        status: { member: 'lead', message: 'Reviewing the change' },
      })
      expect(events[1]).toMatchObject({ action: 'cleared', member: 'lead' })
    } finally {
      stop()
    }
  })

  it('routes resource events through the aggregate bus', () => {
    const events: FleetResourceEvent[] = []
    const subscriptions = createEventSubscriptions(() => {}, {
      ...NOOP_FLEET_TEAM_EVENT_BUS,
      onResource: event => { events.push(event) },
    })
    const resources = new FleetResources({ contains: () => true } as Pick<FileSystem, 'contains'>)
    const stop = resources.onEvent(subscriptions.onResourceEvent)

    try {
      resources.addResource('agent-lead', {
        path: '/workspace/report.md',
        label: 'Review report',
      })
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'resource_added',
        resource: {
          path: '/workspace/report.md',
          label: 'Review report',
          createdBy: 'agent-lead',
        },
      })
    } finally {
      stop()
    }
  })
})
