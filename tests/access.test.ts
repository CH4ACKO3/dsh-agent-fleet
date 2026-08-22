import { describe, expect, it, vi } from 'vitest'

import { FleetAccessService } from '../src/access.js'
import type { FleetMemberView } from '../src/member-view.js'

const member: FleetMemberView = {
  id: 'alice', name: 'Alice', role: 'Engineer', prompt: '',
  toolGroups: ['messages', 'resources'],
  permissions: ['resource.write'],
  contacts: { members: '*', channels: '*' },
}

describe('FleetAccessService', () => {
  it('preserves fixed member access when no policy overrides it', () => {
    const access = new FleetAccessService()
    expect(access.resolve('team-1', member)).toEqual({
      toolGroups: ['messages', 'resources'], permissions: ['resource.write'], op: false,
    })
  })

  it('expands OP across built-in and contributed permissions', () => {
    const access = new FleetAccessService()
    access.registerNamespace({
      namespace: 'deploy',
      permissions: [{ id: 'release', description: 'Release a deployment.' }],
    })
    access.installPolicy({ resolve: () => ({ toolGroups: [], permissions: [], op: true }) })
    const effective = access.resolve('team-1', member)
    expect(effective.toolGroups).toContain('messages')
    expect(effective.permissions).toContain('workspace.manage')
    expect(effective.permissions).toContain('deploy.release')
  })

  it('hides contributed capability tools until their namespace is granted', () => {
    const access = new FleetAccessService()
    const deploy = { namespace: 'deploy', permissions: [{ id: 'release', description: 'Release.' }] }
    access.registerNamespace(deploy)
    expect(access.visible(deploy, access.resolve('team-1', member))).toBe(false)
    access.installPolicy({ resolve: input => ({
      ...input.base, permissions: [...input.base.permissions, 'deploy.release'],
    }) })
    expect(access.visible(deploy, access.resolve('team-1', member))).toBe(true)
  })

  it('emits scoped changes and disposes namespaces', () => {
    const access = new FleetAccessService()
    const listener = vi.fn()
    access.onChange(listener)
    const stop = access.registerNamespace({ namespace: 'deploy', permissions: [] })
    access.changed({ teamId: 'team-1', members: ['alice'] })
    stop()
    expect(listener).toHaveBeenCalledWith({ teamId: 'team-1', members: ['alice'] })
    expect(access.namespaces()).toEqual([])
  })
})
