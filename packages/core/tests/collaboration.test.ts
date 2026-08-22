import { describe, expect, it } from 'vitest'

import { FleetMemberStatusBoard, installCollaborationTools } from '../src/collaboration.js'
import type { FleetMemberDirectory, FleetMemberStatusEvent } from '../src/collaboration.js'

const members = [
  { id: 'agent-lead', name: 'lead' },
  { id: 'agent-reviewer', name: 'reviewer' },
]

const directory: FleetMemberDirectory = {
  list: () => members,
  nameForAgent: id => members.find(entry => entry.id === id)?.name,
  resolve(reference) {
    const value = reference.startsWith('@') ? reference.slice(1) : reference
    return members.find(entry => entry.name === value || entry.id === value)?.name
  },
}

describe('FleetMemberStatusBoard', () => {
  it('lets members maintain their own status while peers can read it', () => {
    const board = new FleetMemberStatusBoard(directory)
    expect(board.set('agent-lead', 'Preparing the release plan')).toMatchObject({
      member: 'lead', message: 'Preparing the release plan',
    })
    expect(board.get('agent-reviewer', '@lead')).toMatchObject({
      member: 'lead', message: 'Preparing the release plan',
    })
    expect(board.list('agent-reviewer')).toEqual(expect.arrayContaining([
      expect.objectContaining({ member: 'lead', message: 'Preparing the release plan' }),
      { member: 'reviewer', message: '' },
    ]))
    expect(() => board.set('outsider', 'Working elsewhere')).toThrow('not a member')
    expect(() => board.set('agent-lead', 'x'.repeat(241))).toThrow('cannot exceed 240 characters')
  })

  it('restores updates and clears without re-emitting them', () => {
    const events: FleetMemberStatusEvent[] = []
    const board = new FleetMemberStatusBoard(directory)
    board.onEvent(event => { events.push(event) })
    board.set('agent-lead', 'Waiting for review')
    board.clear('agent-lead')

    const restoredEvents: FleetMemberStatusEvent[] = []
    const restored = new FleetMemberStatusBoard(directory)
    restored.onEvent(event => { restoredEvents.push(event) })
    restored.restore(events)
    expect(restored.get('agent-reviewer', 'lead')).toEqual({ member: 'lead', message: '' })
    expect(restoredEvents).toEqual([])
  })

  it('restores text from older status events without reviving availability state', () => {
    const board = new FleetMemberStatusBoard(directory)
    board.restore([{
      action: 'updated',
      status: {
        member: 'lead', message: 'Reviewing the solver output', availability: 'focused',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
    } as unknown as FleetMemberStatusEvent])
    expect(board.get('agent-reviewer', 'lead')).toEqual({
      member: 'lead', message: 'Reviewing the solver output', updatedAt: '2026-08-22T00:00:00.000Z',
    })
  })

  it('checks current status authorization when a visible tool executes', async () => {
    const board = new FleetMemberStatusBoard(directory)
    const registered: Array<{
      readonly name: string
      readonly execute: (args: Record<string, unknown>, exec: unknown) => unknown
    }> = []
    const allowed = new Set(['member-status.read', 'member-status.write'])
    installCollaborationTools({
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool) } },
    } as never, board, {
      authorize: (_agentId, action) => allowed.has(action),
    })
    const status = registered.find(candidate => candidate.name === 'fleet_member_status')
    if (status === undefined) throw new Error('expected fleet_member_status')

    await expect(status.execute(
      { action: 'set', message: 'Working' },
      { agent: { id: 'agent-lead' } },
    )).resolves.toMatchObject({ action: 'set' })
    allowed.delete('member-status.write')
    await expect(async () => status.execute(
      { action: 'clear' },
      { agent: { id: 'agent-lead' } },
    )).rejects.toThrow('not authorized for member-status.write')
    await expect(status.execute(
      { action: 'get', member: 'lead' },
      { agent: { id: 'agent-reviewer' } },
    )).resolves.toMatchObject({ action: 'get' })
  })
})
