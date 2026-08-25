import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import type {
  FleetCollaborationTeam,
  FleetTeamLiveEvent,
} from 'dsh-agent-fleet'
import { apply } from '../src/adapter.js'
import { FLEET_MEMORY_PROCESSOR_ID } from '../src/patchouli.js'

function setup(
  updateValue: unknown = { handled: true, stored: 1 },
  providedUpdate?: ReturnType<typeof vi.fn>,
) {
  let eventListener: ((payload: { team: FleetCollaborationTeam; event: FleetTeamLiveEvent }) => void) | undefined
  let dispose: (() => Promise<void>) | undefined
  const update = providedUpdate ?? vi.fn().mockResolvedValue([{
    pluginId: FLEET_MEMORY_PROCESSOR_ID,
    ok: true,
    value: updateValue,
  }])
  const recordDataEvent = vi.fn()
  const warn = vi.fn()
  const team = {
    id: 'team-1',
    memberNamesById: new Map([['session-lead', 'lead'], ['session-reviewer', 'reviewer']]),
  } as unknown as FleetCollaborationTeam
  const scope = {
    patchouli: { update },
    fleetRuns: { recordDataEvent },
    on: (_name: string, listener: typeof eventListener) => { eventListener = listener; return () => {} },
    logger: () => ({ warn }),
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
    recordDataEvent,
    update,
    warn,
  }
}

describe('dsh-fleet-patchouli', () => {
  it('activates only after Fleet and Patchouli services are available and routes durable events by visibility scope', async () => {
    const fixture = setup()
    expect(fixture.dependencies).toEqual(['fleetRuns', 'patchouli'])

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
      meta: { attributes: { fleetPoint: 'team/event', fleetEffort: 'low', eventType: 'work_status' } },
      data: { content: expect.stringContaining('work_status') },
    })
    expect(fixture.update.mock.calls[0]?.[0].meta.attributes).not.toHaveProperty('point')
    expect(fixture.update.mock.calls[1]?.[0].meta.scope).toBe('fleet:team-1:conversation:dm:lead:reviewer')
    expect(fixture.recordDataEvent).toHaveBeenCalledTimes(1)
    expect(fixture.recordDataEvent).toHaveBeenCalledWith('team-1', 'memory.stored', {
      sourceSequence: 1,
      eventType: 'work_status',
      providers: [FLEET_MEMORY_PROCESSOR_ID],
      storedCount: 1,
    })
    await fixture.dispose()
  })

  it.each([
    { handled: false, reason: 'not configured' },
    { handled: true, stored: 0 },
  ])('does not publish timeline activity when Team memory made no write: %j', async updateValue => {
    const fixture = setup(updateValue)
    fixture.event({ sequence: 1, createdAt: '2026-08-24T00:00:00.000Z', type: 'work_status', data: { status: 'idle' } })
    await fixture.dispose()
    expect(fixture.update).toHaveBeenCalledOnce()
    expect(fixture.recordDataEvent).not.toHaveBeenCalled()
  })

  it('removes member prompts before routing a member view event to shared memory', async () => {
    const fixture = setup()
    fixture.event({
      sequence: 1,
      createdAt: '2026-08-24T00:00:00.000Z',
      type: 'member_view_updated',
      data: {
        view: {
          id: 'lead',
          name: 'Lead',
          role: 'Researcher',
          responsibility: 'Own the result.',
          prompt: 'SECRET MEMBER PROMPT',
          permissions: ['dangerous-private-detail'],
        },
      },
    })
    await fixture.dispose()
    expect(fixture.update).toHaveBeenCalledOnce()
    const routed = fixture.update.mock.calls[0]?.[0]
    expect(routed).toMatchObject({
      data: {
        event: {
          type: 'member_view_updated',
          data: { view: { id: 'lead', name: 'Lead', role: 'Researcher', responsibility: 'Own the result.' } },
        },
      },
    })
    expect(JSON.stringify(routed)).not.toContain('SECRET MEMBER PROMPT')
    expect(JSON.stringify(routed)).not.toContain('dangerous-private-detail')
  })

  it('bounds per-Team backlog and keeps the newest derived indexing events', async () => {
    let releaseFirst: (() => void) | undefined
    const first = new Promise<readonly object[]>(resolve => {
      releaseFirst = () => { resolve([{ pluginId: FLEET_MEMORY_PROCESSOR_ID, ok: true, value: { handled: false } }]) }
    })
    const update = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue([{ pluginId: FLEET_MEMORY_PROCESSOR_ID, ok: true, value: { handled: false } }])
    const fixture = setup(undefined, update)
    for (let sequence = 1; sequence <= 300; sequence += 1) {
      fixture.event({
        sequence,
        createdAt: '2026-08-24T00:00:00.000Z',
        type: 'team_status',
        data: { status: `state-${String(sequence)}` },
      })
    }
    expect(update).toHaveBeenCalledOnce()
    releaseFirst?.()
    await vi.waitFor(() => { expect(update).toHaveBeenCalledTimes(257) })
    expect(update.mock.calls[1]?.[0].meta.attributes.sequence).toBe(45)
    expect(update.mock.calls.at(-1)?.[0].meta.attributes.sequence).toBe(300)
    expect(fixture.warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 old derived indexing events'))
    await fixture.dispose()
  })
})
