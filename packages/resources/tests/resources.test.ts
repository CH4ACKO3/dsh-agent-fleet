import { isAbsolute, join, relative, sep } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'

import { installResourceTools } from '../src/index.js'
import { FleetResources } from '../src/resources.js'

function target(path: string): FsTarget {
  return { targetKey: path as FsTarget['targetKey'], displayPath: path }
}

const containment: Pick<FileSystem, 'contains'> = {
  contains(parent, child) {
    const path = relative(parent.displayPath, child.displayPath)
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`))
  },
}

describe('FleetResources', () => {
  it('removes write actions from schemas for a read-only member', () => {
    const registered: Array<{ readonly name: string; readonly parameters: { readonly properties: Record<string, { readonly enum?: readonly string[] }> } }> = []
    const resources = new FleetResources(containment)
    installResourceTools({
      fs: containment,
      on: () => {},
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool) } },
    } as unknown as Context, resources, {
      resourceWrite: false,
    })
    const actions = (name: string): readonly string[] | undefined =>
      registered.find(tool => tool.name === name)?.parameters.properties.action?.enum

    expect(actions('fleet_shared')).toEqual(['list', 'read'])
    expect(actions('fleet_work')).toEqual(['list'])
    expect(actions('fleet_resource')).toEqual(['get', 'list'])
  })

  it('exposes shared-file deletion only when write access and a host delete operation are available', () => {
    const registered: Array<{ readonly name: string; readonly parameters: { readonly properties: Record<string, { readonly enum?: readonly string[] }> } }> = []
    installResourceTools({
      fs: containment,
      on: () => {},
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool) } },
    } as unknown as Context, new FleetResources(containment), {
      resourceWrite: true,
      deleteShared: () => {},
    })

    expect(registered.find(tool => tool.name === 'fleet_shared')?.parameters.properties.action?.enum)
      .toEqual(['list', 'read', 'write', 'delete'])
  })

  it('deletes a shared file through the authorized host operation and removes its resource projection', async () => {
    const registered: Array<{
      readonly name: string
      execute(args: { readonly action: string; readonly path?: string }, exec: {
        readonly agent?: Agent
        readonly signal: AbortSignal
      }): Promise<unknown>
    }> = []
    const deleted: string[] = []
    let allowed = false
    const resources = new FleetResources(containment)
    resources.addResource('builder', {
      id: 'shared:plan.md', path: '/workspace/.fleet/team-1/plan.md', label: 'plan.md',
    })
    installResourceTools({
      fs: {
        ...containment,
        resolve: async (path: string, options?: { readonly cwd?: string }) => target(
          isAbsolute(path) ? path : join(options?.cwd ?? '/workspace', path),
        ),
        stat: async () => ({ version: 'v1', type: 'file', size: 4 }),
      },
      emit: () => {},
      on: () => {},
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool) } },
    } as unknown as Context, resources, {
      projectRoot: '/workspace',
      sharedDirectory: '/workspace/.fleet/team-1',
      resourceWrite: true,
      canWrite: () => allowed,
      deleteShared: path => { deleted.push(path) },
    })
    const tool = registered.find(candidate => candidate.name === 'fleet_shared')
    if (tool === undefined) throw new Error('expected fleet_shared tool')

    const execution = { agent: { id: 'builder' } as Agent, signal: new AbortController().signal }
    await expect(tool.execute(
      { action: 'delete', path: 'plan.md' },
      execution,
    )).rejects.toThrow('cannot write Fleet shared')
    expect(deleted).toEqual([])
    expect(resources.listResources()).toHaveLength(1)

    allowed = true
    await expect(tool.execute({ action: 'delete', path: 'plan.md' }, execution))
      .resolves.toMatchObject({ action: 'delete', exists: false })
    expect(deleted).toEqual(['plan.md'])
    expect(resources.listResources()).toEqual([])
  })

  it('records disjoint work without warnings', () => {
    const resources = new FleetResources(containment)

    expect(resources.claim('builder', [target('/repo/packages/core')])).toEqual([])
    expect(resources.claim('reviewer', [target('/repo/packages/message')])).toEqual([])
    expect(resources.list()).toEqual([
      { agentId: 'builder', paths: ['/repo/packages/core'] },
      { agentId: 'reviewer', paths: ['/repo/packages/message'] },
    ])
  })

  it('warns about overlapping paths but still records both declarations', () => {
    const resources = new FleetResources(containment)
    resources.claim('builder', [target('/repo/packages/core')], 'Implement core')

    expect(resources.claim('reviewer', [target('/repo/packages/core/src/index.ts')])).toEqual([{
      agentId: 'builder',
      path: '/repo/packages/core/src/index.ts',
      conflictingPath: '/repo/packages/core',
    }])
    expect(resources.list()).toHaveLength(2)
  })

  it('replaces and releases an Agent declaration', () => {
    const resources = new FleetResources(containment)
    resources.claim('builder', [target('/repo/a')])
    resources.claim('builder', [target('/repo/b'), target('/repo/b')])

    expect(resources.list()).toEqual([{ agentId: 'builder', paths: ['/repo/b'] }])
    resources.release('builder')
    expect(resources.list()).toEqual([])
  })

  it('registers and resolves an existing file reference', () => {
    const resources = new FleetResources(containment)
    const added = resources.addResource('builder', {
      path: '/repo/artifacts/model.bin',
      label: 'model',
      mediaType: 'application/octet-stream',
      size: 128,
    })

    expect(added).toMatchObject({
      id: expect.stringMatching(/^res_/),
      path: '/repo/artifacts/model.bin',
      label: 'model',
      mediaType: 'application/octet-stream',
      size: 128,
      createdBy: 'builder',
    })
    expect(resources.getResource(added.id)).toEqual(added)
    expect(resources.listResources()).toEqual([added])
    expect(() => resources.getResource('res_missing')).toThrow('Unknown Fleet resource')

    const shared = resources.addResource('builder', {
      id: 'shared:plan',
      path: '/workspace/.fleet/plan.md',
      label: 'plan.md',
    })
    const updatedShared = resources.addResource('reviewer', {
      id: 'shared:plan',
      path: '/workspace/.fleet/plan.md',
      label: 'plan.md',
      size: 42,
    })
    expect(shared.id).toBe('shared:plan')
    expect(updatedShared).toMatchObject({ id: 'shared:plan', createdBy: 'reviewer', size: 42 })
    expect(resources.listResources().filter(resource => resource.id === 'shared:plan')).toEqual([updatedShared])
  })

  it('authorizes resource registration against the resolved file before creating the resource id', async () => {
    const registered: Array<{
      readonly name: string
      execute(args: { readonly action: string; readonly path?: string }, exec: {
        readonly agent?: Agent
        readonly signal: AbortSignal
      }): Promise<unknown>
    }> = []
    const checks: Array<{ readonly kind: string; readonly id?: string }> = []
    const expectedPath = join('/workspace', 'artifacts/result.md')
    const resources = new FleetResources(containment)
    installResourceTools({
      fs: {
        ...containment,
        resolve: async (path: string, options?: { readonly cwd?: string }) => target(
          isAbsolute(path) ? path : join(options?.cwd ?? '/workspace', path),
        ),
        stat: async () => ({ version: 'v1', type: 'file', size: 12 }),
        processPath: (value: FsTarget) => value.displayPath,
      },
      on: () => {},
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool) } },
    } as unknown as Context, resources, {
      resourceWrite: true,
      canWrite: (_agentId, kind, id) => {
        checks.push({ kind, ...(id === undefined ? {} : { id }) })
        return kind === 'file' && id === expectedPath
      },
    })
    const tool = registered.find(candidate => candidate.name === 'fleet_resource')
    if (tool === undefined) throw new Error('expected fleet_resource tool')

    await expect(tool.execute(
      { action: 'add', path: 'artifacts/result.md' },
      { agent: { id: 'builder', session: { header: { cwd: '/workspace' } } } as Agent, signal: new AbortController().signal },
    )).resolves.toMatchObject({
      action: 'add',
      resource: { path: expectedPath, createdBy: 'builder' },
    })
    expect(checks).toEqual([{ kind: 'file', id: expectedPath }])
    expect(resources.listResources()).toHaveLength(1)
  })

  it('removes a registered resource with attributable history', () => {
    const resources = new FleetResources(containment)
    const events: unknown[] = []
    resources.onEvent(event => { events.push(event) })
    const added = resources.addResource('builder', {
      id: 'shared:plan', path: '/workspace/.fleet/plan.md', label: 'plan.md',
    })

    expect(resources.removeResource('reviewer', added.id)).toEqual(added)
    expect(resources.listResources()).toEqual([])
    expect(events.at(-1)).toMatchObject({
      type: 'resource_removed',
      removal: { resource: added, removedBy: 'reviewer' },
    })
    expect(resources.removeResource('reviewer', added.id)).toBeUndefined()
  })

  it('records attributable text revisions and ignores unchanged writes', () => {
    const resources = new FleetResources(containment)
    const events: unknown[] = []
    resources.onEvent(event => { events.push(event) })
    resources.addResource('builder-session', {
      id: 'shared:plan',
      path: '/workspace/.fleet/plan.md',
      label: 'plan.md',
    })

    const revision = resources.recordRevision('builder-session', 'shared:plan', '# Draft', '# Ready')

    expect(revision).toMatchObject({
      id: expect.stringMatching(/^rev_/),
      resourceId: 'shared:plan',
      before: '# Draft',
      after: '# Ready',
      updatedBy: 'builder-session',
    })
    expect(events.at(-1)).toEqual({ type: 'resource_revised', revision })
    expect(resources.recordRevision('builder-session', 'shared:plan', '# Ready', '# Ready')).toBeUndefined()
    expect(() => resources.recordRevision('builder-session', 'missing', '', 'new')).toThrow('Unknown Fleet resource')
  })

})
