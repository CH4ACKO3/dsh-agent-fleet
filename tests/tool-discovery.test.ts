import { describe, expect, it } from 'vitest'

import { searchFleetTools } from '../src/tool-discovery.js'
import type { FleetMemberToolGroup } from '../src/member-view.js'

describe('Fleet tool discovery', () => {
  const allowed = new Set<FleetMemberToolGroup>([
    'messages', 'coordination', 'resources', 'status',
  ])

  it('finds optional tools by English or Chinese intent without an LLM', () => {
    expect(searchFleetTools('consensus vote', allowed, new Set())[0]).toMatchObject({
      name: 'fleet_vote', group: 'coordination', loaded: false,
    })
    expect(searchFleetTools('共享文件', allowed, new Set()).map(match => match.name)).toContain('fleet_shared')
  })

  it('does not reveal groups unavailable to the member', () => {
    expect(searchFleetTools('external deployment', new Set(['messages']), new Set())).toEqual([])
  })

  it('reports only actions granted by member permissions', () => {
    expect(searchFleetTools('resource', allowed, new Set()).find(match => match.name === 'fleet_resource'))
      .toMatchObject({
        actions: ['list', 'get'],
        restrictedActions: [{ action: 'add', permissions: ['resource.write'] }],
      })
    expect(searchFleetTools('resource', allowed, new Set(), new Set(['resource.write']))
      .find(match => match.name === 'fleet_resource')?.actions).toEqual(['list', 'get', 'add'])
  })
})
