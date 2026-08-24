import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import type {
  FleetAuthorizationNamespace,
  FleetCollaborationTeam,
  FleetTeamLiveEvent,
} from 'dsh-agent-fleet'
import { apply } from '../src/adapter.js'

const member = {
  id: 'lead', name: 'Lead', role: 'Lead', prompt: '',
  toolGroups: ['messages'], permissions: [], contacts: { members: '*', channels: '*' },
} as const

function setup() {
  let namespace: FleetAuthorizationNamespace | undefined
  let eventListener: ((payload: { team: FleetCollaborationTeam; event: FleetTeamLiveEvent }) => void) | undefined
  let dispose: (() => Promise<void>) | undefined
  const update = vi.fn().mockResolvedValue([{ pluginId: 'test-memory', ok: true, value: { stored: true } }])
  const retrieve = vi.fn().mockResolvedValue([{ pluginId: 'test-memory', ok: true, value: { answer: 'remembered' } }])
  const recordDataEvent = vi.fn()
  const requireAuthorization = vi.fn()
  const team = {
    id: 'team-1',
    memberNamesById: new Map([['session-lead', 'lead'], ['session-reviewer', 'reviewer']]),
    messages: { listChannels: () => [], listMeetings: () => [] },
  } as unknown as FleetCollaborationTeam
  const scope = {
    patchouli: { update, retrieve },
    fleetAuthorization: {
      registerNamespace: (value: FleetAuthorizationNamespace) => { namespace = value; return () => {} },
      actorForAgent: (id: string) => id === 'session-lead'
        ? { teamId: 'team-1', subject: { kind: 'member', id: 'lead' } }
        : undefined,
      require: requireAuthorization,
    },
    fleetCollaboration: { require: () => team },
    fleetRuns: { recordDataEvent },
    on: (_name: string, listener: typeof eventListener) => { eventListener = listener; return () => {} },
    logger: () => ({ warn: vi.fn() }),
  }
  let dependencies: readonly string[] = []
  apply({
    inject: (names: readonly string[], callback: (ctx: typeof scope) => () => Promise<void>) => {
      dependencies = names
      dispose = callback(scope)
    },
  } as unknown as Context)
  return {
    dependencies,
    dispose: () => dispose?.(),
    event: (event: FleetTeamLiveEvent) => eventListener?.({ team, event }),
    namespace: () => namespace,
    recordDataEvent,
    requireAuthorization,
    retrieve,
    update,
  }
}

describe('dsh-fleet-patchouli', () => {
  it('activates only after Fleet and Patchouli services are available and routes durable events by visibility scope', async () => {
    const fixture = setup()
    expect(fixture.dependencies).toEqual(['fleetAuthorization', 'fleetCollaboration', 'fleetRuns', 'patchouli'])

    fixture.event({ sequence: 1, createdAt: '2026-08-24T00:00:00.000Z', type: 'work_status', data: { status: 'finished' } })
    fixture.event({
      sequence: 2,
      createdAt: '2026-08-24T00:00:01.000Z',
      type: 'coordination.message',
      data: {
        type: 'message',
        message: { from: 'session-lead', conversation: '@session-reviewer', text: 'Old decision' },
      },
    })
    fixture.event({
      sequence: 3,
      createdAt: '2026-08-24T00:00:02.000Z',
      type: 'coordination.inbox',
      data: { type: 'inbox', action: 'read', agentId: 'session-reviewer', messageId: 'message-1' },
    })
    fixture.event({
      sequence: 4,
      createdAt: '2026-08-24T00:00:03.000Z',
      type: 'resource.resource_added',
      data: { resource: { id: 'private-file' } },
    })

    await vi.waitFor(() => { expect(fixture.update).toHaveBeenCalledTimes(2) })
    expect(fixture.update.mock.calls[0]?.[0].meta.scope).toBe('fleet:team-1:shared')
    expect(fixture.update.mock.calls[0]?.[0]).toMatchObject({
      meta: { attributes: { fleetPoint: 'team/event', eventType: 'work_status' } },
      data: { content: expect.stringContaining('work_status') },
    })
    expect(fixture.update.mock.calls[0]?.[0].meta.attributes).not.toHaveProperty('point')
    expect(fixture.update.mock.calls[1]?.[0].meta.scope).toBe('fleet:team-1:conversation:dm:lead:reviewer')
    expect(fixture.recordDataEvent).toHaveBeenCalledTimes(1)
    expect(fixture.recordDataEvent).toHaveBeenCalledWith('team-1', 'memory.stored', {
      sourceSequence: 1,
      eventType: 'work_status',
      providers: ['test-memory'],
    })
    await fixture.dispose()
  })

  it('installs a visible, authorized Team recall tool with the same direct-message scope', async () => {
    const fixture = setup()
    const tools: Array<{ name: string; execute(args: unknown, exec: unknown): Promise<unknown> }> = []
    fixture.namespace()?.installTools?.({
      tools: { register: (tool: typeof tools[number]) => { tools.push(tool); return () => {} } },
    } as unknown as Context, {
      teamId: 'team-1', projectRoot: '/workspace', member,
      hasMember: candidate => candidate === 'lead' || candidate === 'reviewer',
      authorization: { toolGroups: [], actions: ['memory.recall'], op: false },
    })
    const tool = tools.find(candidate => candidate.name === 'fleet_recall')
    if (tool === undefined) throw new Error('expected fleet_recall tool')

    await expect(tool.execute(
      { query: 'Why did we choose the old design?', conversation: '@reviewer', limit: 3 },
      { agent: { id: 'session-lead' }, signal: new AbortController().signal },
    )).resolves.toContain('remembered')
    expect(fixture.retrieve.mock.calls[0]?.[0]).toMatchObject({
      meta: {
        source: { type: 'fleet', id: 'dsh-fleet-patchouli/adapter' },
        scope: 'fleet:team-1:conversation:dm:lead:reviewer',
        attributes: { fleetPoint: 'tool/recall', teamId: 'team-1', member: 'lead' },
      },
      data: { query: 'Why did we choose the old design?', limit: 3 },
    })
    expect(fixture.requireAuthorization).toHaveBeenCalledWith(expect.objectContaining({ action: 'memory.recall' }))
    expect(fixture.requireAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      action: 'message.read', resource: { kind: 'conversation', id: '@reviewer' },
    }))
    expect(fixture.recordDataEvent).not.toHaveBeenCalled()

    await expect(tool.execute(
      { query: 'What did the Team decide?', limit: 2 },
      { agent: { id: 'session-lead' }, signal: new AbortController().signal },
    )).resolves.toContain('remembered')
    expect(fixture.recordDataEvent).toHaveBeenCalledWith('team-1', 'memory.recalled', {
      member: 'lead',
      query: 'What did the Team decide?',
      providers: ['test-memory'],
    })
    await fixture.dispose()
  })
})
