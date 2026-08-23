import { describe, expect, it, vi } from 'vitest'

import { FleetAuthorizationService } from '../src/authorization.js'
import { FleetCollaborationService } from '../src/collaboration.js'
import type { FleetMemberView } from '../src/member-view.js'

const member: FleetMemberView = {
  id: 'alice', name: 'Alice', role: 'Engineer', prompt: '',
  toolGroups: ['messages', 'resources'],
  permissions: ['resource.write'],
  contacts: { members: '*', channels: '*' },
}

describe('FleetAuthorizationService', () => {
  it('preserves fixed member access when no policy overrides it', () => {
    const access = new FleetAuthorizationService()
    expect(access.resolve('team-1', member)).toEqual({
      toolGroups: ['messages', 'resources'],
      actions: expect.arrayContaining(['message.read', 'message.post', 'resource.read', 'work.read', 'work.claim', 'resource.write']),
      op: false,
    })
  })

  it('expands OP across built-in and contributed permissions', () => {
    const access = new FleetAuthorizationService()
    access.registerNamespace({
      namespace: 'deploy',
      actions: [{ id: 'release', description: 'Release a deployment.' }],
    })
    access.installActionPolicy({ resolve: () => ({ toolGroups: [], actions: [], op: true }) })
    const effective = access.resolve('team-1', member)
    expect(effective.toolGroups).toContain('messages')
    expect(effective.actions).toContain('team.manage')
    expect(effective.actions).toContain('deploy.release')
  })

  it('hides contributed capability tools until their namespace is granted', () => {
    const access = new FleetAuthorizationService()
    const deploy = { namespace: 'deploy', actions: [{ id: 'release', description: 'Release.' }] }
    access.registerNamespace(deploy)
    expect(access.visible(deploy, access.resolve('team-1', member))).toBe(false)
    access.installActionPolicy({ resolve: input => ({
      ...input.base, actions: [...input.base.actions, 'deploy.release'],
    }) })
    expect(access.visible(deploy, access.resolve('team-1', member))).toBe(true)
  })

  it('emits scoped changes and disposes namespaces', () => {
    const access = new FleetAuthorizationService()
    const listener = vi.fn()
    access.onChange(listener)
    const stop = access.registerNamespace({ namespace: 'deploy', actions: [] })
    access.changed({ teamId: 'team-1', members: ['alice'] })
    stop()
    expect(listener).toHaveBeenCalledWith({ teamId: 'team-1', members: ['alice'] })
    expect(access.namespaces()).toEqual([])
  })

  it('requires both a known granted action and an allowed concrete resource', () => {
    const access = new FleetAuthorizationService()
    access.installBaseline({
      resolveSubject: (_teamId, subject) => subject.kind === 'member' && subject.id === member.id ? member : undefined,
      authorizeResource: input => input.resource?.kind === 'file' && input.resource.id.startsWith('/workspace/team/'),
    })

    const base = {
      teamId: 'team-1',
      subject: { kind: 'member' as const, id: 'alice' },
      action: 'resource.read',
    }
    expect(access.authorize({ ...base, resource: { kind: 'file', id: '/workspace/team/note.md' } })).toBe(true)
    expect(access.authorize({ ...base, action: 'unknown.read', resource: { kind: 'file', id: '/workspace/team/note.md' } })).toBe(false)
    expect(access.authorize({ ...base, resource: { kind: 'unknown', id: '/workspace/team/note.md' } })).toBe(false)
    expect(access.authorize({ ...base, resource: { kind: 'file', id: '/outside/note.md' } })).toBe(false)
  })

  it('lets an installed resource policy make the final resource decision without bypassing actions', () => {
    const access = new FleetAuthorizationService()
    access.installBaseline({
      resolveSubject: () => member,
      authorizeResource: () => true,
    })
    access.installResourcePolicy({
      authorize: input => input.resource?.id !== '/workspace/team/private.md',
    })

    const subject = { kind: 'member' as const, id: 'alice' }
    expect(access.authorize({
      teamId: 'team-1', subject, action: 'resource.read',
      resource: { kind: 'file', id: '/workspace/team/readme.md' },
    })).toBe(true)
    expect(access.authorize({
      teamId: 'team-1', subject, action: 'resource.read',
      resource: { kind: 'file', id: '/workspace/team/private.md' },
    })).toBe(false)
    expect(access.authorize({
      teamId: 'team-1', subject, action: 'workspace.manage',
      resource: { kind: 'file', id: '/workspace/team/readme.md' },
    })).toBe(false)
  })

  it('lets a feature plugin provide standalone action and resource defaults', () => {
    const access = new FleetAuthorizationService()
    access.installBaseline({
      resolveSubject: () => member,
      authorizeResource: () => false,
    })
    access.registerNamespace({
      namespace: 'lark-im',
      actions: [
        { id: 'message-read', description: 'Read messages.' },
        { id: 'message-send', description: 'Send messages.' },
      ],
      defaultActions: () => ['message-read', 'message-send'],
      authorizeBaseline: input => input.subject.kind === 'external' && input.action === 'lark-im.message-read',
    })
    access.registerResourceKind({ kind: 'lark-chat', authorizeBaseline: () => true })

    expect(access.authorize({
      teamId: 'team-1',
      subject: { kind: 'member', id: 'alice' },
      action: 'lark-im.message-send',
      resource: { kind: 'lark-chat', id: 'oc_example' },
    })).toBe(true)
    expect(access.authorize({
      teamId: 'team-1',
      subject: { kind: 'external', id: 'lark:user-1' },
      action: 'lark-im.message-read',
      resource: { kind: 'lark-chat', id: 'oc_example' },
    })).toBe(true)
  })

  it('resolves a native Agent to its optional Fleet actor', () => {
    const access = new FleetAuthorizationService()
    access.installBaseline({
      resolveSubject: () => undefined,
      actorForAgent: agentId => agentId === 'session-1'
        ? { teamId: 'team-1', subject: { kind: 'member', id: 'alice' } }
        : undefined,
      authorizeResource: () => false,
    })
    expect(access.actorForAgent('session-1')).toEqual({
      teamId: 'team-1', subject: { kind: 'member', id: 'alice' },
    })
    expect(access.actorForAgent('ordinary-session')).toBeUndefined()
  })

  it('defers tool visibility refresh until the running Agent reaches a step boundary', () => {
    const access = new FleetAuthorizationService()
    const agent = { id: 'session-1', status: 'running' }
    let statusListener: ((payload: { readonly agent: { readonly id: string }; readonly status: string }) => void) | undefined
    let sessionListener: ((session: { readonly id: string }, event: { readonly type: string }) => void) | undefined
    const collaboration = new FleetCollaborationService({
      agents: { get: () => agent },
      fs: { contains: () => true },
      on: (event: string, listener: typeof statusListener | typeof sessionListener) => {
        if (event === 'agent/status') statusListener = listener as typeof statusListener
        if (event === 'session/event') sessionListener = listener as typeof sessionListener
        return () => {}
      },
    } as never, access)
    const team = collaboration.open({
      id: 'team-1',
      memberViews: [member],
      defaultVoters: [member.id],
      projectRoot: '/workspace',
      sharedDirectory: '/workspace/.fleet/team-1',
      onCoordination: () => {},
      onResource: () => {},
      onMemberStatus: () => {},
    })
    team.attachMember(agent.id, member)
    const refresh = vi.spyOn(team, 'refreshAccess')

    access.changed({ teamId: 'team-1', members: ['alice'] })
    expect(refresh).not.toHaveBeenCalled()
    sessionListener?.({ id: agent.id }, { type: 'step/end' })
    expect(refresh).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledWith('alice')
    access.changed({ teamId: 'team-1', members: ['alice'] })
    agent.status = 'idle'
    statusListener?.({ agent, status: 'idle' })
    expect(refresh).toHaveBeenCalledTimes(2)
    collaboration.close()
  })
})
