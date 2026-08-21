import { relative, sep } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { describe, expect, it } from 'vitest'

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
  })
})
