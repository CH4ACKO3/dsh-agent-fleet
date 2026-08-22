import { describe, expect, it } from 'vitest'

import type { FleetRunService } from 'dsh-agent-fleet'
import { FleetGroupService, fleetPrivateGroupId } from '../src/groups.js'

function fixture() {
  const stored = new Map<string, unknown>()
  const runs = {
    readExtensionState: (teamId: string, namespace: string) => stored.get(`${teamId}:${namespace}`),
    writeExtensionState: (teamId: string, namespace: string, value: unknown) => {
      stored.set(`${teamId}:${namespace}`, structuredClone(value))
    },
    exportConfiguration: () => ({ modules: {} }),
  } as unknown as FleetRunService
  return { groups: new FleetGroupService(runs), runs, stored }
}

describe('FleetGroupService', () => {
  it('gives every member a private group and supports multiple supplementary groups', () => {
    const { groups } = fixture()
    groups.setMembership('team-1', 'alice', ['researcher', 'facilitator'])

    expect(groups.membership('team-1', 'alice')).toEqual(['researcher', 'facilitator'])
    expect(groups.expanded('team-1', 'alice')).toEqual(expect.arrayContaining([
      fleetPrivateGroupId('alice'), 'researcher', 'facilitator', 'member', 'observer',
    ]))
  })

  it('persists custom groups and memberships independently from permission rules', () => {
    const first = fixture()
    first.groups.upsertGroup('team-1', { id: 'frontend', name: 'Frontend', parents: ['member'] })
    first.groups.setMembership('team-1', 'alice', ['frontend'])

    const restored = new FleetGroupService(first.runs)
    expect(restored.groups('team-1')).toContainEqual(expect.objectContaining({ id: 'frontend' }))
    expect(restored.expanded('team-1', 'alice')).toEqual(expect.arrayContaining(['frontend', 'member', 'observer']))
    expect(first.stored.has('team-1:authorization-groups')).toBe(true)
  })
})
