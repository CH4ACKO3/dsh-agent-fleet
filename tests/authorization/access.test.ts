import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

import {
  FleetAuthorizationService,
  type FleetAuthorizationBaseline,
  type FleetMemberView,
  type FleetRunService,
} from 'dsh-agent-fleet'

import { FleetAccessService, applyAccess, type FleetAccessState } from '../../src/authorization/access.js'
import { FleetGroupService, fleetPrivateGroupId } from '../../src/authorization/groups.js'
import { FleetConfigurationRegistry } from '../../src/configuration.js'

const alice: FleetMemberView = {
  id: 'alice', name: 'Alice', role: 'Engineer', prompt: '',
  toolGroups: ['messages', 'resources'], permissions: ['resource.write'],
  contacts: { members: '*', channels: '*' },
}

function fixture(projectRoots: Readonly<Record<string, string>> = { 'team-1': '/project/one' }) {
  const stored = new Map<string, unknown>()
  const runs = {
    status: (teamId: string) => ({ id: teamId, projectRoot: projectRoots[teamId] ?? '/project/default' }),
    readExtensionState: (teamId: string, namespace: string) => stored.get(`${teamId}:${namespace}`),
    writeExtensionState: (teamId: string, namespace: string, value: unknown) => {
      stored.set(`${teamId}:${namespace}`, structuredClone(value))
    },
    exportConfiguration: () => ({ modules: {} }),
  } as unknown as FleetRunService
  const groups = new FleetGroupService(runs)
  return { runs, stored, groups, access: new FleetAccessService(runs, groups) }
}

function baseline(resource = true): FleetAuthorizationBaseline {
  return {
    resolveSubject: (_teamId, subject) => subject.kind === 'member' && subject.id === alice.id ? alice : undefined,
    authorizeResource: () => resource,
  }
}

const subject = { kind: 'member' as const, id: 'alice' }
const privateGroup = { kind: 'group' as const, id: fleetPrivateGroupId('alice') }

describe('FleetAccessService', () => {
  it('inherits feature defaults until a resource kind is restricted', () => {
    const { access } = fixture()
    const input = {
      teamId: 'team-1', subject, action: 'resource.read',
      resource: { kind: 'file', id: '/project/one/README.md' },
    }

    expect(access.authorize(input, true)).toBe(true)
    access.setMode('team-1', privateGroup, 'file', 'restricted')
    expect(access.authorize(input, true)).toBe(false)
    access.setMode('team-1', privateGroup, 'file', 'inherit')
    expect(access.authorize(input, true)).toBe(true)
  })

  it('applies tree grants and lets a more specific deny win', () => {
    const { access } = fixture()
    access.setMode('team-1', privateGroup, 'file', 'restricted')
    access.putRule('team-1', {
      id: 'source-tree', principal: privateGroup, resource: { kind: 'file', id: '/project/one/src' },
      scope: 'tree', effect: 'allow', levels: ['write'],
    })

    const readSource = {
      teamId: 'team-1', subject, action: 'resource.read',
      resource: { kind: 'file', id: '/project/one/src/index.ts' },
    }
    const writeSource = { ...readSource, action: 'resource.write' }
    expect(access.authorize(readSource, false)).toBe(true)
    expect(access.authorize(writeSource, false)).toBe(true)
    expect(access.authorize({
      ...readSource, resource: { kind: 'file', id: '/project/one/tests/index.test.ts' },
    }, false)).toBe(false)

    access.putRule('team-1', {
      id: 'generated-deny', principal: privateGroup, resource: { kind: 'file', id: '/project/one/src/generated' },
      scope: 'tree', effect: 'deny', levels: ['read'],
    })
    expect(access.authorize({
      ...writeSource, resource: { kind: 'file', id: '/project/one/src/generated/client.ts' },
    }, true)).toBe(false)
  })

  it('keeps use independent from read and write', () => {
    const { access } = fixture()
    access.registerAdapter({
      kind: 'secret',
      levelFor: action => action === 'secret.use' ? 'use' : action === 'secret.read' ? 'read' : undefined,
      normalize: (_teamId, id) => id,
    })
    access.setMode('team-1', privateGroup, 'secret', 'restricted')
    access.putRule('team-1', {
      id: 'use-build-key', principal: privateGroup, resource: { kind: 'secret', id: 'build-key' },
      effect: 'allow', levels: ['use'],
    })

    expect(access.authorize({
      teamId: 'team-1', subject, action: 'secret.use', resource: { kind: 'secret', id: 'build-key' },
    }, false)).toBe(true)
    expect(access.authorize({
      teamId: 'team-1', subject, action: 'secret.read', resource: { kind: 'secret', id: 'build-key' },
    }, true)).toBe(false)
  })

  it('combines shared and private group keycards with explicit deny taking precedence', () => {
    const { access, groups, stored } = fixture()
    groups.setMembership('team-1', 'alice', ['researcher'])
    access.putRule('team-1', {
      id: 'research-source', principal: { kind: 'group', id: 'researcher' },
      resource: { kind: 'file', id: '/project/one/src' },
      scope: 'tree', effect: 'allow', levels: ['write'],
    })
    access.putRule('team-1', {
      id: 'personal-generated-deny', principal: privateGroup,
      resource: { kind: 'file', id: '/project/one/src/generated' },
      scope: 'tree', effect: 'deny', levels: ['read'],
    })

    expect(access.authorize({
      teamId: 'team-1', subject, action: 'resource.write',
      resource: { kind: 'file', id: '/project/one/src/index.ts' },
    }, false)).toBe(true)
    expect(access.authorize({
      teamId: 'team-1', subject, action: 'resource.write',
      resource: { kind: 'file', id: '/project/one/src/generated/client.ts' },
    }, true)).toBe(false)
    const persisted = stored.get('team-1:authorization-access') as FleetAccessState
    expect(persisted.rules.find(rule => rule.id === 'personal-generated-deny')?.principal)
      .toEqual({ kind: 'group', id: fleetPrivateGroupId('alice') })
  })

  it('removes orphaned keycards when a shared group is deleted', () => {
    const { access, groups } = fixture()
    groups.upsertGroup('team-1', { id: 'temporary', name: 'Temporary', parents: [] })
    access.putRule('team-1', {
      id: 'temporary-files', principal: { kind: 'group', id: 'temporary' },
      resource: { kind: 'file', id: '/project/one/tmp' },
      effect: 'allow', levels: ['write'],
    })
    const stop = groups.onChange(change => access.removeGroups(change.teamId, change.removedGroups ?? []))

    groups.deleteGroup('team-1', 'temporary')
    expect(access.rules('team-1')).toEqual([])
    stop()
  })

  it('leaves resource kinds without an Access adapter on their feature baseline', () => {
    const { access } = fixture()
    expect(access.authorize({
      teamId: 'team-1', subject, action: 'future.read', resource: { kind: 'future-resource', id: 'one' },
    }, true)).toBe(true)
    expect(access.authorize({
      teamId: 'team-1', subject, action: 'future.read', resource: { kind: 'future-resource', id: 'one' },
    }, false)).toBe(false)
  })

  it('persists keycards and keeps project paths portable across an imported Team', () => {
    const first = fixture({ 'team-1': '/project/old', 'team-2': '/project/new' })
    first.access.setMode('team-1', privateGroup, 'file', 'restricted')
    first.access.putRule('team-1', {
      id: 'portable-source', principal: privateGroup, resource: { kind: 'file', id: '/project/old/src' },
      scope: 'tree', effect: 'allow', levels: ['read'],
    })
    first.access.putRule('team-1', {
      id: 'portable-shared', principal: privateGroup,
      resource: { kind: 'file', id: '/project/old/.fleet/team-1/notes' },
      scope: 'tree', effect: 'allow', levels: ['write'],
    })
    const persisted = first.stored.get('team-1:authorization-access') as FleetAccessState
    expect(persisted.rules[0]?.resource.id).toBe('workspace:src')
    expect(persisted.rules[1]?.resource.id).toBe('team:notes')

    first.stored.set('team-2:authorization-access', structuredClone(persisted))
    const restored = new FleetAccessService(first.runs, first.groups)
    expect(restored.authorize({
      teamId: 'team-2', subject, action: 'resource.read',
      resource: { kind: 'file', id: '/project/new/src/index.ts' },
    }, false)).toBe(true)
    expect(restored.authorize({
      teamId: 'team-2', subject, action: 'resource.write',
      resource: { kind: 'file', id: '/project/new/.fleet/team-2/notes/plan.md' },
    }, false)).toBe(true)
  })

  it('uses Team initialization Access settings until a runtime edit is persisted', () => {
    const configured = {
      version: 1,
      modes: [{ principal: privateGroup, resourceKind: 'file', mode: 'restricted' }],
      rules: [{
        id: 'configured-source', principal: privateGroup,
        resource: { kind: 'file', id: '/project/one/src' },
        scope: 'tree', effect: 'allow', levels: ['read'],
      }],
    }
    const { runs, groups } = fixture()
    const configuredRuns = {
      status: (teamId: string) => ({ id: teamId, projectRoot: '/project/one' }),
      readExtensionState: runs.readExtensionState.bind(runs),
      writeExtensionState: runs.writeExtensionState.bind(runs),
      exportConfiguration: () => ({ modules: { 'dsh-agent-fleet/authorization/access': configured } }),
    } as unknown as FleetRunService
    const access = new FleetAccessService(configuredRuns, groups)

    expect(access.mode('team-1', privateGroup, 'file')).toBe('restricted')
    expect(access.authorize({
      teamId: 'team-1', subject, action: 'resource.read',
      resource: { kind: 'file', id: '/project/one/src/index.ts' },
    }, false)).toBe(true)
    expect(access.authorize({
      teamId: 'team-1', subject, action: 'resource.read',
      resource: { kind: 'file', id: '/project/one/secret.txt' },
    }, true)).toBe(false)
  })

  it('combines with Core so OP still cannot bypass a resource deny', () => {
    const { access } = fixture()
    access.registerAdapter({
      kind: 'dataset', levelFor: action => action === 'dataset.query' ? 'use' : undefined,
      normalize: (_teamId, id) => id,
    })
    const authorization = new FleetAuthorizationService()
    authorization.installBaseline(baseline())
    authorization.registerNamespace({
      namespace: 'dataset', actions: [{ id: 'query', description: 'Query a dataset.' }],
    })
    authorization.installActionPolicy({
      resolve: input => ({ ...input.base, op: true }),
    })
    authorization.installResourcePolicy(access)

    expect(authorization.authorize({
      teamId: 'team-1', subject, action: 'dataset.query', resource: { kind: 'dataset', id: 'private' },
    })).toBe(false)
    authorization.registerResourceKind({ kind: 'dataset', authorizeBaseline: () => true })
    access.putRule('team-1', {
      id: 'deny-private', principal: privateGroup, resource: { kind: 'dataset', id: 'private' },
      effect: 'deny', levels: ['use'],
    })
    expect(authorization.authorize({
      teamId: 'team-1', subject, action: 'dataset.query', resource: { kind: 'dataset', id: 'private' },
    })).toBe(false)
    access.removeRule('team-1', 'deny-private')
    expect(authorization.authorize({
      teamId: 'team-1', subject, action: 'dataset.query', resource: { kind: 'dataset', id: 'private' },
    })).toBe(true)
  })

  it('fails closed when persisted Access state is malformed', () => {
    const { runs, stored } = fixture()
    stored.set('team-1:authorization-access', { version: 1, modes: [], rules: [{ id: 'broken' }] })
    expect(() => new FleetAccessService(runs, new FleetGroupService(runs)).state('team-1')).toThrow(/resource/)
  })

  it('registers the optional Access policy and action namespace with Fleet', async () => {
    const { runs } = fixture()
    const authorization = new FleetAuthorizationService()
    const ctx = new Context()
    applyAccess(ctx)
    ctx.provide('fleetRuns', runs)
    ctx.provide('fleetAuthorization', authorization)
    ctx.provide('fleetConfiguration', new FleetConfigurationRegistry())
    ctx.provide('fleetGroups', new FleetGroupService(runs))
    await new Promise<void>(resolve => { setImmediate(resolve) })

    expect(ctx.get('fleetAccess')).toBeInstanceOf(FleetAccessService)
    expect(authorization.actionIds()).toEqual(expect.arrayContaining(['access.inspect', 'access.manage']))
    expect(() => authorization.installResourcePolicy({ authorize: () => true })).toThrow(/already installed/)
  })
})
