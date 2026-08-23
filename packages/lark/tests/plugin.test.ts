import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  FleetAccessService,
  FleetAuthorizationService,
  FleetGroupService,
  type FleetMemberView,
  type FleetRunService,
} from 'dsh-agent-fleet'
import { apply, FLEET_LARK_PERMISSIONS } from '../src/index.js'

const member: FleetMemberView = {
  id: 'researcher', name: 'Researcher', role: 'Researcher', prompt: '',
  toolGroups: [], permissions: ['lark.read', 'lark.act-as-user'],
  contacts: { members: '*', channels: '*' },
}

async function fixture(permissions: readonly string[] = ['lark.read', 'lark.act-as-user']) {
  const ctx = new Context()
  const authorization = new FleetAuthorizationService()
  const authorizedMember = { ...member, permissions: [...permissions] }
  authorization.installBaseline({
    resolveSubject: (_teamId, subject) => subject.id === member.id ? authorizedMember : undefined,
    actorForAgent: agentId => agentId === 'agent-1'
      ? { teamId: 'team-1', subject: { kind: 'member', id: member.id } }
      : undefined,
    authorizeResource: () => true,
  })
  const runs = {
    status: () => ({ projectRoot: '/project' }),
    readExtensionState: () => undefined,
    writeExtensionState: () => {},
    exportConfiguration: () => ({ modules: {} }),
  } as unknown as FleetRunService
  const access = new FleetAccessService(runs, new FleetGroupService(runs))
  authorization.installResourcePolicy(access)
  ctx.provide('fleetAuthorization', authorization)
  ctx.provide('fleetAccess', access)
  apply(ctx, { cli: { executable: process.execPath } })
  await new Promise<void>(resolve => { setImmediate(resolve) })
  return { ctx, authorization, access }
}

describe('Fleet Lark plugin', () => {
  it('provides both CLI identities without requiring realtime bot credentials', async () => {
    const { ctx, authorization, access } = await fixture()

    expect(ctx.fleetLark.bot.identity).toBe('bot')
    expect(ctx.fleetLark.user.identity).toBe('user')
    expect(authorization.actionIds()).toEqual(expect.arrayContaining(
      FLEET_LARK_PERMISSIONS.map(permission => `lark.${permission.id}`),
    ))
    expect(authorization.resourceKindIds()).toContain('lark-resource')
    expect(access.adapterKinds()).toContain('lark-resource')
    const result = await ctx.fleetLark.bot.execute([
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      'payload',
    ])
    expect(JSON.parse(result.stdout)).toEqual(['payload', '--as', 'bot'])
  })

  it('authorizes the business action, resource, and user identity independently', async () => {
    const { ctx, access } = await fixture()
    const command = {
      agentId: 'agent-1',
      action: 'lark.read' as const,
      resource: 'contact:directory',
      args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', 'payload'],
    }

    const bot = await ctx.fleetLark.executeForAgent({ ...command, identity: 'bot' })
    const user = await ctx.fleetLark.executeForAgent({ ...command, identity: 'user' })
    expect(JSON.parse(bot.stdout)).toEqual(['payload', '--as', 'bot'])
    expect(JSON.parse(user.stdout)).toEqual(['payload', '--as', 'user'])
    await expect(ctx.fleetLark.executeForAgent({
      ...command, identity: 'bot', action: 'lark.content-write',
    })).rejects.toThrow(/not authorized for lark\.content-write/u)
    await expect(ctx.fleetLark.executeForAgent({
      ...command, identity: 'bot', args: [...command.args, '--yes=true'],
    })).rejects.toThrow(/cannot auto-confirm/u)

    access.setMode('team-1', { kind: 'group', id: 'member:researcher' }, 'lark-resource', 'restricted')
    await expect(ctx.fleetLark.executeForAgent({ ...command, identity: 'bot' }))
      .rejects.toThrow(/not authorized for lark\.read/u)

    const withoutUserIdentity = await fixture(['lark.read'])
    await expect(withoutUserIdentity.ctx.fleetLark.executeForAgent({ ...command, identity: 'user' }))
      .rejects.toThrow(/not authorized for lark\.act-as-user/u)
  })
})
