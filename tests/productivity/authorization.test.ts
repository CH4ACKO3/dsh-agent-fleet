import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import { FleetAuthorizationService } from '../../src/authorization.js'
import { FleetCollaborationService } from '../../src/collaboration.js'
import type { FleetMemberView } from '../../src/member-view.js'

const member: FleetMemberView = {
  id: 'alice', name: 'Alice', role: 'Engineer', prompt: '',
  toolGroups: ['messages', 'coordination'], permissions: [], contacts: { members: '*', channels: '*' },
}

describe('Fleet productivity authorization', () => {
  it('checks current action authorization when an already-visible tool executes', async () => {
    const agent = {
      id: 'session-alice', status: 'idle',
      inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn(),
    }
    const authorization = new FleetAuthorizationService()
    authorization.installBaseline({
      resolveSubject: (_teamId, subject) => subject.id === member.id ? member : undefined,
      actorForAgent: id => id === agent.id
        ? { teamId: 'team-1', subject: { kind: 'member', id: member.id } }
        : undefined,
      authorizeResource: () => false,
    })
    const collaboration = new FleetCollaborationService({
      agents: { get: (id: string) => id === agent.id ? agent : undefined },
      fs: { contains: () => true },
      on: () => () => {},
    } as unknown as Context, authorization)
    const team = collaboration.open({
      id: 'team-1', memberViews: [member], projectRoot: '/workspace', sharedDirectory: '/workspace/.fleet/team-1',
      defaultVoters: [member.id],
      onCoordination: () => {}, onResource: () => {}, onMemberStatus: () => {},
    })
    team.attachMember(agent.id, member)

    const registered: Array<{ readonly name: string; execute(args: unknown, context: unknown): Promise<unknown> }> = []
    team.installTools({
      tools: {
        register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} },
        restrict: () => () => {},
        guard: () => () => {},
        get: () => undefined,
      },
    } as unknown as Context, member.id)
    expect(registered.find(candidate => candidate.name === 'fleet_task')).toBeUndefined()
    team.sendUserMessage({ to: '@alice', text: 'Complete the required check.', mentions: ['@alice'], delivery: 'quiet' })
    const tool = registered.find(candidate => candidate.name === 'fleet_task')
    if (tool === undefined) throw new Error('expected fleet_task to be visible')
    await expect(tool.execute({ action: 'list' }, { agent })).resolves.toMatchObject({ action: 'list' })

    authorization.installActionPolicy({ resolve: input => ({ ...input.base, actions: [], op: false }) })
    await expect(tool.execute({ action: 'list' }, { agent })).rejects.toThrow('not authorized for task.read')
    collaboration.close()
  })
})
