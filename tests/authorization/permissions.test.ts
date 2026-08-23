import { describe, expect, it } from 'vitest'

import {
  FLEET_MEMBER_TOOL_GROUPS,
  FleetAuthorizationService,
  type FleetMemberView,
  type FleetRunService,
} from 'dsh-agent-fleet'
import {
  FLEET_PERMISSION_PRESETS,
  FleetPermissionService,
  parseFleetPermissionConfiguration,
} from '../../src/authorization/permissions.js'
import {
  FLEET_GROUPS_CONFIGURATION_MODULE,
  FleetGroupService,
  fleetPrivateGroupId,
} from '../../src/authorization/groups.js'

const alice: FleetMemberView = {
  id: 'alice', name: 'Alice', role: 'Engineer', prompt: '',
  toolGroups: ['messages', 'resources'], permissions: ['resource.write'],
  contacts: { members: '*', channels: '*' },
}

const researcher: FleetMemberView = {
  id: 'researcher', name: 'Blake', role: 'Researcher', prompt: '',
  toolGroups: ['messages', 'status', 'resources', 'coordination'],
  permissions: ['resource.write'],
  contacts: { members: '*', channels: '*' },
}

interface PermissionStorage {
  values?: Map<string, unknown>
}

function fixture(
  configuration: Record<string, unknown> = {},
  members: FleetMemberView[] = [alice],
  storage: PermissionStorage = {},
) {
  const values = storage.values ??= new Map()
  const runs = {
    readExtensionState: (teamId: string, namespace: string) => values.get(`${teamId}:${namespace}`),
    writeExtensionState: (teamId: string, namespace: string, value: unknown) => {
      values.set(`${teamId}:${namespace}`, structuredClone(value))
    },
    memberViews: () => structuredClone(members),
    memberViewForAgent: () => structuredClone(members[0]),
    exportConfiguration: () => structuredClone(configuration),
  } as unknown as FleetRunService
  const authorization = new FleetAuthorizationService()
  const groups = new FleetGroupService(runs)
  const permissions = new FleetPermissionService(runs, authorization, groups)
  authorization.installActionPolicy(permissions)
  return {
    authorization,
    groups,
    permissions,
    runs,
    stored: () => values.get('team-1:authorization-permissions'),
  }
}

describe('FleetPermissionService', () => {
  it('provides default groups for common Agent collaboration roles', () => {
    expect(FLEET_PERMISSION_PRESETS.map(group => [group.id, group.name, group.parents])).toEqual([
      ['observer', 'Observer', []],
      ['member', 'Collaborator', ['observer']],
      ['researcher', 'Researcher', ['member']],
      ['facilitator', 'Facilitator', ['member']],
      ['maintainer', 'Maintainer', ['researcher', 'facilitator']],
      ['op', 'OP', []],
    ])
    expect(FLEET_PERMISSION_PRESETS.flatMap(group => group.actions).some(action =>
      action.startsWith('git.') || action.startsWith('lark.') || action.startsWith('memory.'),
    )).toBe(false)
    const actions = new Set(FLEET_PERMISSION_PRESETS.flatMap(group => group.actions))
    expect([...actions]).toEqual(expect.arrayContaining([
      'message.wakeup', 'message.interrupt',
      'document.read', 'document.write', 'document.comment',
      'workspace.read', 'workspace.manage',
      'access.inspect', 'access.manage', 'permissions.manage',
    ]))
  })

  it('rejects malformed Team permission modules instead of silently widening access', () => {
    expect(() => parseFleetPermissionConfiguration({})).toThrow(/version 1 groups/)
    expect(() => parseFleetPermissionConfiguration({ version: 2, groups: {} })).toThrow(/version 1 groups/)
    expect(parseFleetPermissionConfiguration({ version: 1, groups: {} })).toEqual({ version: 1, groups: {} })
  })

  it('adapts a native fixed profile without changing its effective access', () => {
    const { authorization } = fixture()
    expect(authorization.resolve('team-1', alice)).toEqual({
      toolGroups: ['messages', 'resources'],
      actions: expect.arrayContaining(['message.read', 'message.post', 'resource.read', 'work.read', 'work.claim', 'resource.write']),
      op: false,
    })
  })

  it('recognizes a native built-in profile as its optional permission group', () => {
    const { authorization, permissions } = fixture({}, [researcher])
    expect(permissions.member('team-1', 'researcher')?.groups).toEqual(['researcher'])
    expect(authorization.resolve('team-1', researcher)).toEqual({
      toolGroups: researcher.toolGroups,
      actions: expect.arrayContaining(researcher.permissions),
      op: false,
    })
  })

  it('loads initial supplementary membership from the Groups configuration module', () => {
    const { authorization } = fixture({
      modules: {
        [FLEET_GROUPS_CONFIGURATION_MODULE]: {
          version: 1, groups: [], members: { alice: ['observer'] },
        },
      },
    })
    expect(authorization.resolve('team-1', alice)).toEqual({
      toolGroups: ['messages', 'status', 'resources'],
      actions: expect.arrayContaining(['message.read', 'message.post', 'member-status.read', 'member-status.write', 'resource.read']),
      op: false,
    })
  })

  it('uses preset inheritance as a complete dynamic profile', () => {
    const { authorization, permissions, stored } = fixture()
    permissions.setMember('team-1', 'alice', {
      groups: ['maintainer'], grants: [], denies: [], toolGroups: [], denyToolGroups: [],
    })
    const effective = authorization.resolve('team-1', alice)
    expect(effective.toolGroups).toEqual(expect.arrayContaining([
      'messages', 'status', 'resources', 'coordination',
    ]))
    expect(effective.actions).toEqual(expect.arrayContaining([
      'resource.write', 'channel.manage', 'meeting.manage', 'vote.create', 'team.manage',
    ]))
    expect(stored()).toBeDefined()
  })

  it('keeps research roles below Team management authority', () => {
    const { authorization, permissions } = fixture()
    permissions.setMember('team-1', 'alice', {
      groups: ['researcher'], grants: [], denies: [], toolGroups: [], denyToolGroups: [],
    })
    expect(authorization.resolve('team-1', alice)).toMatchObject({ actions: expect.arrayContaining(['resource.write']) })
    expect(authorization.resolve('team-1', alice).actions).not.toContain('team.manage')
  })

  it('supports OP, DEOP, and reset to the fixed profile', () => {
    const { authorization, permissions } = fixture()
    authorization.registerNamespace({
      namespace: 'deploy', actions: [{ id: 'release', description: 'Release.' }],
    })
    permissions.setOp('team-1', 'alice', true)
    expect(authorization.resolve('team-1', alice)).toMatchObject({
      actions: expect.arrayContaining(['deploy.release']),
      toolGroups: expect.arrayContaining([...FLEET_MEMBER_TOOL_GROUPS]),
      op: true,
    })
    permissions.setOp('team-1', 'alice', false)
    expect(authorization.resolve('team-1', alice).actions).not.toContain('deploy.release')
    expect(authorization.resolve('team-1', alice).actions).toContain('resource.write')
    permissions.resetMember('team-1', 'alice')
    expect(authorization.resolve('team-1', alice).toolGroups).toEqual(['messages', 'resources'])
  })

  it('preserves feature defaults while unconfigured and after reset', () => {
    const { authorization, permissions } = fixture()
    authorization.registerNamespace({
      namespace: 'notebook',
      actions: [{ id: 'read', description: 'Read a notebook.' }],
      defaultActions: () => ['read'],
    })
    expect(authorization.resolve('team-1', alice).actions).toContain('notebook.read')
    permissions.setMember('team-1', 'alice', {
      groups: ['observer'], grants: [], denies: [], toolGroups: [], denyToolGroups: [],
    })
    expect(authorization.resolve('team-1', alice).actions).not.toContain('notebook.read')
    permissions.resetMember('team-1', 'alice')
    expect(authorization.resolve('team-1', alice).actions).toContain('notebook.read')
  })

  it('applies direct and inherited denies after grants and tool groups', () => {
    const { authorization, permissions } = fixture()
    permissions.setMember('team-1', 'alice', {
      groups: ['maintainer'],
      grants: ['resource.write'],
      denies: ['resource.write', 'team.manage'],
      toolGroups: ['messages'],
      denyToolGroups: ['messages'],
    })
    const effective = authorization.resolve('team-1', alice)
    expect(effective.toolGroups).not.toContain('messages')
    expect(effective.actions).not.toContain('message.read')
    expect(effective.actions).not.toContain('message.post')
    expect(effective.actions).not.toContain('resource.write')
    expect(effective.actions).not.toContain('team.manage')
    expect(effective.actions).toContain('channel.manage')
  })

  it('stores personal permissions on the private member group while combining supplementary groups', () => {
    const { authorization, permissions } = fixture()
    permissions.setMember('team-1', 'alice', {
      groups: ['researcher', 'facilitator'], grants: ['team.manage'], denies: [],
      toolGroups: [], denyToolGroups: [],
    })

    expect(permissions.state('team-1').groups[fleetPrivateGroupId('alice')]).toMatchObject({
      grants: ['team.manage'],
    })
    expect(authorization.resolve('team-1', alice).actions).toEqual(expect.arrayContaining([
      'resource.write', 'channel.manage', 'meeting.manage', 'vote.create', 'team.manage',
    ]))
  })

  it('restores dynamic assignments from the Team extension state after restart', () => {
    const storage: PermissionStorage = {}
    const first = fixture({}, [alice], storage)
    first.permissions.setMember('team-1', 'alice', {
      groups: ['observer'], grants: ['vote.create'], denies: [], toolGroups: [], denyToolGroups: [],
    })

    const second = fixture({}, [alice], storage)
    expect(second.permissions.member('team-1', 'alice')).toMatchObject({
      groups: ['observer'], grants: ['vote.create'],
    })
    expect(second.authorization.resolve('team-1', alice).actions).toContain('vote.create')
  })

  it('allows registered plugin actions and rejects them after the plugin unregisters', () => {
    const { authorization, permissions } = fixture()
    authorization.installBaseline({
      resolveSubject: (_teamId, subject) => subject.kind === 'member' && subject.id === alice.id ? alice : undefined,
      authorizeResource: () => true,
    })
    const unregister = authorization.registerNamespace({
      namespace: 'deploy', actions: [{ id: 'release', description: 'Release.' }],
    })
    permissions.setMember('team-1', 'alice', {
      groups: [], grants: ['deploy.release'], denies: [], toolGroups: [], denyToolGroups: [],
    })
    const input = {
      teamId: 'team-1',
      subject: { kind: 'member' as const, id: 'alice' },
      action: 'deploy.release',
    }
    expect(authorization.actionIds()).toContain('deploy.release')
    expect(authorization.authorize(input)).toBe(true)
    unregister()
    expect(authorization.actionIds()).not.toContain('deploy.release')
    expect(authorization.authorize(input)).toBe(false)
    expect(() => permissions.setMember('team-1', 'alice', {
      groups: [], grants: ['deploy.release'], denies: [], toolGroups: [], denyToolGroups: [],
    })).toThrow(/unknown Fleet action deploy\.release/)
  })

  it('does not let OP bypass an installed concrete-resource policy', () => {
    const { authorization, permissions } = fixture()
    authorization.installBaseline({
      resolveSubject: () => alice,
      authorizeResource: () => true,
    })
    authorization.installResourcePolicy({
      authorize: input => input.resource?.id !== '/workspace/restricted.md',
    })
    permissions.setOp('team-1', 'alice', true)
    const request = {
      teamId: 'team-1',
      subject: { kind: 'member' as const, id: 'alice' },
      action: 'resource.read',
    }
    expect(authorization.authorize({
      ...request, resource: { kind: 'file', id: '/workspace/public.md' },
    })).toBe(true)
    expect(authorization.authorize({
      ...request, resource: { kind: 'file', id: '/workspace/restricted.md' },
    })).toBe(false)
  })

  it('rejects cyclic custom group inheritance', () => {
    const { permissions } = fixture()
    permissions.upsertGroup('team-1', {
      id: 'alpha', name: 'Alpha', parents: [], toolGroups: [], actions: [],
    })
    permissions.upsertGroup('team-1', {
      id: 'beta', name: 'Beta', parents: ['alpha'], toolGroups: [], actions: [],
    })
    expect(() => permissions.upsertGroup('team-1', {
      id: 'alpha', name: 'Alpha', parents: ['beta'], toolGroups: [], actions: [],
    })).toThrow(/cyclic/)
  })
})
