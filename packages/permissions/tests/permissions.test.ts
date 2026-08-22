import { describe, expect, it } from 'vitest'

import { FleetAuthorizationService, type FleetMemberView, type FleetRunService } from 'dsh-agent-fleet'
import {
  FLEET_PERMISSION_PRESETS,
  FleetPermissionService,
  parseFleetPermissionConfiguration,
} from '../src/index.js'

const alice: FleetMemberView = {
  id: 'alice', name: 'Alice', role: 'Engineer', prompt: '',
  toolGroups: ['messages', 'resources'], permissions: ['resource.write'],
  contacts: { members: '*', channels: '*' },
}

const builder: FleetMemberView = {
  id: 'builder', name: 'Blake', role: 'Engineer', prompt: '',
  toolGroups: ['messages', 'status', 'resources', 'coordination', 'git'],
  permissions: ['resource.write', 'git.inspect', 'git.scope-check', 'git.worktree-create'],
  contacts: { members: '*', channels: '*' },
}

function fixture(configuration: Record<string, unknown> = {}, members: FleetMemberView[] = [alice]) {
  let stored: unknown
  const runs = {
    readExtensionState: () => stored,
    writeExtensionState: (_teamId: string, _namespace: string, value: unknown) => { stored = structuredClone(value) },
    memberViews: () => structuredClone(members),
    memberViewForAgent: () => structuredClone(members[0]),
    exportConfiguration: () => structuredClone(configuration),
  } as unknown as FleetRunService
  const access = new FleetAuthorizationService()
  const permissions = new FleetPermissionService(runs, access)
  access.installActionPolicy(permissions)
  return { access, permissions, stored: () => stored }
}

describe('FleetPermissionService', () => {
  it('provides default groups for common Agent collaboration roles', () => {
    expect(FLEET_PERMISSION_PRESETS.map(group => [group.id, group.name, group.parents])).toEqual([
      ['observer', 'Observer', []],
      ['member', 'Collaborator', ['observer']],
      ['researcher', 'Researcher', ['member']],
      ['reviewer', 'Reviewer', ['researcher']],
      ['builder', 'Builder', ['reviewer']],
      ['facilitator', 'Facilitator', ['member']],
      ['maintainer', 'Maintainer', ['builder', 'facilitator']],
      ['op', 'OP', []],
    ])
  })

  it('rejects malformed Team permission modules instead of silently widening access', () => {
    expect(() => parseFleetPermissionConfiguration({})).toThrow(/members must be an object/)
    expect(() => parseFleetPermissionConfiguration({ version: 2, members: {} })).toThrow(/version must be 1/)
    expect(parseFleetPermissionConfiguration({ members: {} })).toEqual({ groups: [], members: {} })
  })

  it('adapts a native fixed profile without changing its effective access', () => {
    const { access } = fixture()
    expect(access.resolve('team-1', alice)).toEqual({
      toolGroups: ['messages', 'resources'],
      actions: expect.arrayContaining(['message.read', 'message.post', 'resource.read', 'work.read', 'work.claim', 'resource.write']),
      op: false,
    })
  })

  it('recognizes a native built-in profile as its optional permission group', () => {
    const { access, permissions } = fixture({}, [builder])
    expect(permissions.member('team-1', 'builder')?.groups).toEqual(['builder'])
    expect(access.resolve('team-1', builder)).toEqual({
      toolGroups: builder.toolGroups,
      actions: expect.arrayContaining(builder.permissions),
      op: false,
    })
  })

  it('loads an initial assignment from the Team configuration module', () => {
    const { access } = fixture({
      modules: {
        '@ch4acko3/dsh-agent-fleet-permissions': {
          members: { alice: { groups: ['observer'] } },
        },
      },
    })
    expect(access.resolve('team-1', alice)).toEqual({
      toolGroups: ['messages', 'status', 'resources'],
      actions: expect.arrayContaining(['message.read', 'message.post', 'member-status.read', 'member-status.write', 'resource.read']),
      op: false,
    })
  })

  it('uses preset inheritance as a complete dynamic profile', () => {
    const { access, permissions, stored } = fixture()
    permissions.setMember('team-1', 'alice', {
      groups: ['builder'], grants: [], denies: [], toolGroups: [], denyToolGroups: [],
    })
    const effective = access.resolve('team-1', alice)
    expect(effective.toolGroups).toEqual(expect.arrayContaining([
      'messages', 'status', 'resources', 'coordination', 'git',
    ]))
    expect(effective.actions).toEqual(expect.arrayContaining([
      'resource.write', 'git.inspect', 'git.scope-check', 'git.worktree-create',
    ]))
    expect(effective.actions).not.toContain('team.manage')
    expect(stored()).toBeDefined()
  })

  it('keeps research and review roles below implementation authority', () => {
    const { access, permissions } = fixture()
    permissions.setMember('team-1', 'alice', {
      groups: ['researcher'], grants: [], denies: [], toolGroups: [], denyToolGroups: [],
    })
    expect(access.resolve('team-1', alice)).toMatchObject({ actions: expect.arrayContaining(['resource.write']) })
    expect(access.resolve('team-1', alice).toolGroups).not.toContain('git')

    permissions.setMember('team-1', 'alice', {
      groups: ['reviewer'], grants: [], denies: [], toolGroups: [], denyToolGroups: [],
    })
    const reviewer = access.resolve('team-1', alice)
    expect(reviewer.actions).toEqual(expect.arrayContaining(['resource.write', 'git.inspect', 'git.scope-check']))
    expect(reviewer.actions).not.toContain('git.worktree-create')
    expect(reviewer.toolGroups).toContain('git')
  })

  it('supports OP, DEOP, and reset to the fixed profile', () => {
    const { access, permissions } = fixture()
    access.registerNamespace({
      namespace: 'deploy', actions: [{ id: 'release', description: 'Release.' }],
    })
    permissions.setOp('team-1', 'alice', true)
    expect(access.resolve('team-1', alice).actions).toContain('deploy.release')
    permissions.setOp('team-1', 'alice', false)
    expect(access.resolve('team-1', alice).actions).not.toContain('deploy.release')
    expect(access.resolve('team-1', alice).actions).toContain('resource.write')
    permissions.resetMember('team-1', 'alice')
    expect(access.resolve('team-1', alice).toolGroups).toEqual(['messages', 'resources'])
  })

  it('rejects cyclic custom group inheritance', () => {
    const { permissions } = fixture()
    permissions.upsertGroup('team-1', {
      id: 'alpha', name: 'Alpha', parents: [], toolGroups: [], permissions: [],
    })
    permissions.upsertGroup('team-1', {
      id: 'beta', name: 'Beta', parents: ['alpha'], toolGroups: [], permissions: [],
    })
    expect(() => permissions.upsertGroup('team-1', {
      id: 'alpha', name: 'Alpha', parents: ['beta'], toolGroups: [], permissions: [],
    })).toThrow(/cyclic/)
  })
})
