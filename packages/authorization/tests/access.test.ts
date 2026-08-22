import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

import {
  FleetAuthorizationService,
  type FleetAuthorizationBaseline,
  type FleetMemberView,
  type FleetRunService,
} from 'dsh-agent-fleet'

import { FleetAccessService, applyAccess, type FleetAccessState } from '../src/access.js'

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
  } as unknown as FleetRunService
  return { runs, stored, access: new FleetAccessService(runs) }
}

function baseline(resource = true): FleetAuthorizationBaseline {
  return {
    resolveSubject: (_teamId, subject) => subject.kind === 'member' && subject.id === alice.id ? alice : undefined,
    authorizeResource: () => resource,
  }
}

const subject = { kind: 'member' as const, id: 'alice' }

describe('FleetAccessService', () => {
  it('inherits feature defaults until a resource kind is restricted', () => {
    const { access } = fixture()
    const input = {
      teamId: 'team-1', subject, action: 'resource.read',
      resource: { kind: 'file', id: '/project/one/README.md' },
    }

    expect(access.authorize(input, true)).toBe(true)
    access.setMode('team-1', subject, 'file', 'restricted')
    expect(access.authorize(input, true)).toBe(false)
    access.setMode('team-1', subject, 'file', 'inherit')
    expect(access.authorize(input, true)).toBe(true)
  })

  it('applies tree grants and lets a more specific deny win', () => {
    const { access } = fixture()
    access.setMode('team-1', subject, 'file', 'restricted')
    access.putRule('team-1', {
      id: 'source-tree', subject, resource: { kind: 'file', id: '/project/one/src' },
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
      id: 'generated-deny', subject, resource: { kind: 'file', id: '/project/one/src/generated' },
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
    access.setMode('team-1', subject, 'secret', 'restricted')
    access.putRule('team-1', {
      id: 'use-build-key', subject, resource: { kind: 'secret', id: 'build-key' },
      effect: 'allow', levels: ['use'],
    })

    expect(access.authorize({
      teamId: 'team-1', subject, action: 'secret.use', resource: { kind: 'secret', id: 'build-key' },
    }, false)).toBe(true)
    expect(access.authorize({
      teamId: 'team-1', subject, action: 'secret.read', resource: { kind: 'secret', id: 'build-key' },
    }, true)).toBe(false)
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
    first.access.setMode('team-1', subject, 'file', 'restricted')
    first.access.putRule('team-1', {
      id: 'portable-source', subject, resource: { kind: 'file', id: '/project/old/src' },
      scope: 'tree', effect: 'allow', levels: ['read'],
    })
    first.access.putRule('team-1', {
      id: 'portable-shared', subject,
      resource: { kind: 'file', id: '/project/old/.fleet/team-1/notes' },
      scope: 'tree', effect: 'allow', levels: ['write'],
    })
    const persisted = first.stored.get('team-1:access') as FleetAccessState
    expect(persisted.rules[0]?.resource.id).toBe('workspace:src')
    expect(persisted.rules[1]?.resource.id).toBe('team:notes')

    first.stored.set('team-2:access', structuredClone(persisted))
    const restored = new FleetAccessService(first.runs)
    expect(restored.authorize({
      teamId: 'team-2', subject, action: 'resource.read',
      resource: { kind: 'file', id: '/project/new/src/index.ts' },
    }, false)).toBe(true)
    expect(restored.authorize({
      teamId: 'team-2', subject, action: 'resource.write',
      resource: { kind: 'file', id: '/project/new/.fleet/team-2/notes/plan.md' },
    }, false)).toBe(true)
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
      id: 'deny-private', subject, resource: { kind: 'dataset', id: 'private' },
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
    stored.set('team-1:access', { version: 1, modes: [], rules: [{ id: 'broken' }] })
    expect(() => new FleetAccessService(runs).state('team-1')).toThrow(/resource/)
  })

  it('registers the optional Access policy and action namespace with Fleet', async () => {
    const { runs } = fixture()
    const authorization = new FleetAuthorizationService()
    const ctx = new Context()
    applyAccess(ctx)
    ctx.provide('fleetRuns', runs)
    ctx.provide('fleetAuthorization', authorization)
    await new Promise<void>(resolve => { setImmediate(resolve) })

    expect(ctx.get('fleetAccess')).toBeInstanceOf(FleetAccessService)
    expect(authorization.actionIds()).toEqual(expect.arrayContaining(['access.inspect', 'access.manage']))
    expect(() => authorization.installResourcePolicy({ authorize: () => true })).toThrow(/already installed/)
  })
})
