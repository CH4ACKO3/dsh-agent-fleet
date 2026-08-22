import { relative, sep } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { installResourceTools } from '../src/index.js'
import { FleetResources, sharedPath } from '../src/resources.js'

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
      documentWrite: false,
    })
    const actions = (name: string): readonly string[] | undefined =>
      registered.find(tool => tool.name === name)?.parameters.properties.action?.enum

    expect(actions('fleet_shared')).toEqual(['read'])
    expect(actions('fleet_work')).toEqual(['list'])
    expect(actions('fleet_resource')).toEqual(['get', 'list'])
    expect(actions('fleet_document')).toEqual(['list', 'search', 'get'])
  })

  it('keeps resource and document discovery groups separate', () => {
    const names = (resourcesEnabled: boolean, documentsEnabled: boolean): string[] => {
      const registered: Array<{ readonly name: string }> = []
      installResourceTools({
        fs: containment,
        on: () => {},
        tools: { register: (tool: typeof registered[number]) => { registered.push(tool) } },
      } as unknown as Context, new FleetResources(containment), {
        resources: resourcesEnabled,
        documents: documentsEnabled,
      })
      return registered.map(tool => tool.name)
    }

    expect(names(true, false)).toEqual(['fleet_shared', 'fleet_work', 'fleet_resource'])
    expect(names(false, true)).toEqual(['fleet_document'])
  })

  it('uses fixed workspace files for the shared plan and checklist', () => {
    expect(sharedPath('plan')).toBe('.fleet/plan.md')
    expect(sharedPath('checklist')).toBe('.fleet/checklist.md')
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

  it('keeps shared documents, versions, comments, replies, and restoration in the Resources service', () => {
    const resources = new FleetResources(containment)
    const events: Parameters<FleetResources['restoreDocuments']>[0] = []
    resources.onEvent(event => {
      if ('document' in event) events.push(event)
    })
    const created = resources.createDocument('lead', {
      name: 'release-notes',
      title: 'Release Notes',
      content: '# Draft',
    })
    const updated = resources.updateDocument('writer', created.id, { content: '# Ready' })
    const commented = resources.commentDocument('reviewer', created.id, 'Verify the version number.')
    const commentId = commented.comments[0]?.id
    if (commentId === undefined) throw new Error('expected document comment')
    resources.commentDocument('writer', created.id, 'Verified.', commentId)
    resources.resolveDocumentComment('reviewer', created.id, commentId)
    const reverted = resources.revertDocument('lead', created.id, 1)

    expect(updated.version).toBe(2)
    expect(reverted).toMatchObject({ version: 3, content: '# Draft' })
    expect(resources.listDocuments('release')).toHaveLength(1)
    const restored = new FleetResources(containment)
    restored.restoreDocuments(events)
    expect(restored.getDocument(created.id)).toEqual(reverted)
  })
})
