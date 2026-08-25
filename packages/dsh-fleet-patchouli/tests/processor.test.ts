import type { Context } from '@deepseek-ai/cordis'
import type { FleetRunRecord } from 'dsh-agent-fleet'
import { describe, expect, it, vi } from 'vitest'

import type { FleetMemoryAlgorithm, MemoryPlugin } from '../src/patchouli.js'
import { apply, createFleetMemoryProcessor } from '../src/processor.js'

describe('Fleet Patchouli processor', () => {
  it('registers after Patchouli and Fleet are available and ignores unrelated Sessions', async () => {
    let plugin: MemoryPlugin | undefined
    const unregister = vi.fn()
    let dependencies: readonly string[] = []
    apply({
      inject: (services: readonly string[], callback: (scope: unknown) => void) => {
        dependencies = services
        callback({
          fleetRuns: { list: () => [] },
          get: () => undefined,
          patchouli: {
            register: (candidate: MemoryPlugin) => { plugin = candidate; return unregister },
          },
        })
      },
    } as unknown as Context)

    if (plugin === undefined) throw new Error('expected Fleet Patchouli processor')
    expect(dependencies).toEqual(['patchouli', 'fleetRuns'])
    const meta = { source: { type: 'fleet', id: 'adapter' }, scope: 'fleet:team-1:shared' }
    expect(plugin.filter?.({ operation: 'update', meta })).toBe(true)
    expect(plugin.filter?.({
      operation: 'update',
      meta: { ...meta, source: { type: 'session', id: 'session-1' } },
    })).toBe(false)
    await expect(plugin.update({ meta, data: { event: 'example' } }, {})).resolves.toMatchObject({
      handled: false,
      sourceType: 'fleet',
    })
    await expect(plugin.retrieve({ meta, data: { query: 'example' } }, {})).resolves.toMatchObject({
      handled: false,
      items: [],
    })
  })

  it('runs only algorithms whose minimum effort fits the request budget', async () => {
    const retrieve = vi.fn().mockResolvedValue({ handled: true, items: ['deep result'] })
    const algorithm: FleetMemoryAlgorithm = {
      id: 'deep-search',
      minimumEffort: 'high',
      filter: () => true,
      retrieve,
    }
    const plugin = createFleetMemoryProcessor([algorithm])
    const base = {
      source: { type: 'agent-loop', id: 'test' },
      scope: '/workspace',
    }

    expect(plugin.filter?.({
      operation: 'retrieve',
      meta: { ...base, attributes: { fleetEffort: 'low' } },
    })).toBe(false)
    expect(plugin.filter?.({
      operation: 'retrieve',
      meta: { ...base, attributes: { fleetEffort: 'high' } },
    })).toBe(true)
    expect(plugin.filter?.({ operation: 'retrieve', meta: base })).toBe(true)
    await expect(plugin.retrieve({
      meta: base,
      data: { query: 'deep history', metadata: { fleetEffort: 'high' } },
    }, {})).resolves.toMatchObject({
      handled: true,
      effort: 'high',
      items: ['deep result'],
    })
    expect(retrieve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ effort: 'high', deferRecallAudit: expect.any(Function) }),
    )
  })

  it('defaults native Fleet memory retrieval to medium effort without attributes', async () => {
    const low = vi.fn().mockResolvedValue({ handled: true, items: ['low'] })
    const medium = vi.fn().mockResolvedValue({ handled: true, items: ['medium'] })
    const plugin = createFleetMemoryProcessor([
      { id: 'low', minimumEffort: 'low', filter: () => true, retrieve: low },
      { id: 'medium', minimumEffort: 'medium', filter: () => true, retrieve: medium },
    ])
    const meta = { source: { type: 'agent-loop', id: 'dsh-patchouli-agent-loop' }, scope: '/workspace' }

    await expect(plugin.retrieve({ meta, data: { query: 'history' } }, {})).resolves.toMatchObject({
      effort: 'medium',
      algorithms: [{ algorithm: 'low' }, { algorithm: 'medium' }],
      items: ['low', 'medium'],
    })
    await expect(plugin.retrieve({
      meta,
      data: { query: 'history', metadata: { fleetEffort: 'invalid' } },
    }, {})).resolves.toMatchObject({
      effort: 'medium',
      algorithms: [{ algorithm: 'low' }, { algorithm: 'medium' }],
    })
    expect(medium).toHaveBeenCalledTimes(2)

    await expect(plugin.retrieve({
      meta,
      data: { query: 'history', metadata: { fleetEffort: 'low' } },
    }, {})).resolves.toMatchObject({
      effort: 'low',
      algorithms: [{ algorithm: 'low' }],
    })
    expect(medium).toHaveBeenCalledTimes(2)

    await expect(plugin.retrieve({
      meta: { ...meta, attributes: { fleetEffort: 'medium' } },
      data: { query: 'history', metadata: { fleetEffort: 'low' } },
    }, {})).resolves.toMatchObject({
      effort: 'medium',
      algorithms: [{ algorithm: 'low' }, { algorithm: 'medium' }],
    })
    expect(medium).toHaveBeenCalledTimes(3)

    const update = vi.fn().mockResolvedValue({ handled: false, stored: 0 })
    const eventProcessor = createFleetMemoryProcessor([{
      id: 'event',
      filter: () => true,
      update,
    }])
    await eventProcessor.update({
      meta: {
        source: { type: 'fleet', id: 'adapter' },
        scope: 'fleet:team-1:shared',
        attributes: { fleetEffort: 'low' },
      },
      data: { kind: 'fleet-event' },
    }, {})
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ effort: 'low' }),
    )
  })

  it('commits deferred recall audit only after a successful uncancelled request', async () => {
    const recordRecallAudit = vi.fn()
    const controller = new AbortController()
    const plugin = createFleetMemoryProcessor([{
      id: 'history',
      filter: () => true,
      async retrieve(_request, context) {
        context.deferRecallAudit?.({
          teamId: 'team-1',
          member: 'lead',
          resultCount: 2,
          conversation: '@private-peer',
        })
        return { handled: true, items: ['one', 'two'] }
      },
    }, {
      id: 'failed-history',
      filter: () => true,
      async retrieve(_request, context) {
        context.deferRecallAudit?.({ teamId: 'team-1', member: 'lead', resultCount: 99 })
        throw new Error('recall failed')
      },
    }], { recordRecallAudit })
    const request = {
      meta: { source: { type: 'agent-loop', id: 'test' }, scope: '/workspace' },
      data: { query: 'history' },
    }

    await expect(plugin.retrieve(request, {})).resolves.toMatchObject({ handled: true, items: ['one', 'two'] })
    expect(recordRecallAudit).toHaveBeenCalledWith({
      teamId: 'team-1',
      member: 'lead',
      resultCount: 2,
      algorithm: 'history',
      effort: 'medium',
    })
    expect(recordRecallAudit).toHaveBeenCalledOnce()

    recordRecallAudit.mockClear()
    const cancelled = createFleetMemoryProcessor([{
      id: 'cancelled',
      filter: () => true,
      async retrieve(_request, context) {
        context.deferRecallAudit?.({ teamId: 'team-1', member: 'lead', resultCount: 1 })
        controller.abort(new Error('cancelled'))
        return { handled: true, items: ['late'] }
      },
    }], { recordRecallAudit })
    await expect(cancelled.retrieve(request, { signal: controller.signal })).rejects.toThrow('cancelled')
    expect(recordRecallAudit).not.toHaveBeenCalled()
  })

  it('does not commit an already-finished algorithm audit when a concurrent algorithm is cancelled', async () => {
    const recordRecallAudit = vi.fn()
    const controller = new AbortController()
    let slowStarted: (() => void) | undefined
    const started = new Promise<void>(resolve => { slowStarted = resolve })
    const plugin = createFleetMemoryProcessor([
      {
        id: 'fast',
        filter: () => true,
        async retrieve(_request, context) {
          context.deferRecallAudit?.({ teamId: 'team-1', member: 'lead', resultCount: 1 })
          return { handled: true, items: ['ready'] }
        },
      },
      {
        id: 'slow',
        filter: () => true,
        async retrieve(_request, context) {
          slowStarted?.()
          await new Promise<never>((_resolve, reject) => {
            context.signal?.addEventListener('abort', () => { reject(context.signal?.reason) }, { once: true })
          })
        },
      },
    ], { recordRecallAudit })
    const pending = plugin.retrieve({
      meta: { source: { type: 'agent-loop', id: 'test' }, scope: '/workspace' },
      data: { query: 'history' },
    }, { signal: controller.signal })
    await started
    controller.abort(new Error('network cancelled'))

    await expect(pending).rejects.toThrow('network cancelled')
    expect(recordRecallAudit).not.toHaveBeenCalled()
  })

  it('reports audit persistence failure without losing successful recall results', async () => {
    const plugin = createFleetMemoryProcessor([{
      id: 'history',
      filter: () => true,
      async retrieve(_request, context) {
        context.deferRecallAudit?.({ teamId: 'team-1', member: 'lead', resultCount: 1 })
        return { handled: true, items: ['result'] }
      },
    }], {
      recordRecallAudit: () => { throw new Error('timeline unavailable') },
    })
    await expect(plugin.retrieve({
      meta: { source: { type: 'agent-loop', id: 'test' }, scope: '/workspace' },
      data: { query: 'history' },
    }, {})).resolves.toMatchObject({
      handled: true,
      items: ['result'],
      auditFailures: 1,
    })
  })

  it('isolates algorithm failures and aggregates only successful writes and retrievals', async () => {
    const request = {
      meta: { source: { type: 'agent-loop', id: 'test' }, scope: '/workspace' },
      data: { query: 'history' },
    }
    const retrieval = createFleetMemoryProcessor([
      {
        id: 'working',
        filter: () => true,
        retrieve: async () => ({ handled: true, items: ['available'] }),
      },
      {
        id: 'broken',
        filter: () => true,
        retrieve: async () => { throw new Error('index unavailable') },
      },
      {
        id: 'broken-filter',
        filter: () => { throw new Error('filter unavailable') },
      },
    ])
    await expect(retrieval.retrieve(request, {})).resolves.toMatchObject({
      handled: true,
      items: ['available'],
      algorithms: [
        { algorithm: 'broken-filter', ok: false, error: 'filter unavailable' },
        { algorithm: 'working', ok: true, value: { handled: true } },
        { algorithm: 'broken', ok: false, error: 'index unavailable' },
      ],
    })

    const update = createFleetMemoryProcessor([
      {
        id: 'stored',
        filter: () => true,
        update: async () => ({ handled: true, stored: 2 }),
      },
      {
        id: 'zero',
        filter: () => true,
        update: async () => ({ handled: true, stored: 0 }),
      },
      {
        id: 'failed-write',
        filter: () => true,
        update: async () => { throw new Error('write failed') },
      },
    ])
    await expect(update.update(request, {})).resolves.toMatchObject({
      handled: true,
      stored: 2,
      algorithms: [
        { algorithm: 'stored', ok: true },
        { algorithm: 'zero', ok: true },
        { algorithm: 'failed-write', ok: false, error: 'write failed' },
      ],
    })
  })

  it('keeps one canonical item list within the effort token budget', async () => {
    const plugin = createFleetMemoryProcessor([{
      id: 'large-history',
      filter: () => true,
      retrieve: async () => ({
        handled: true,
        count: 2,
        items: [
          { source: { kind: 'message', id: 'first' }, text: 'x'.repeat(20_000) },
          { source: { kind: 'message', id: 'second' }, text: 'later' },
        ],
      }),
    }])
    const result = await plugin.retrieve({
      meta: {
        source: { type: 'agent-loop', id: 'test' },
        scope: '/workspace',
        attributes: { fleetEffort: 'low' },
      },
      data: { query: 'history' },
    }, {}) as Record<string, unknown>

    expect(result).toMatchObject({
      tokenBudget: 2_048,
      totalItems: 2,
      truncated: true,
      algorithms: [{
        algorithm: 'large-history',
        ok: true,
        value: { handled: true, count: 2 },
      }],
      items: [{ source: { kind: 'message', id: 'first' }, truncated: true }],
    })
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(2_048 * 4)
    expect((result.algorithms as Array<{ value: Record<string, unknown> }>)[0]?.value.items).toBeUndefined()
  })

  it('registers every Fleet retrieval block and keeps Git behind its effort gate', async () => {
    let plugin: MemoryPlugin | undefined
    const team = {
      id: 'team-1',
      name: 'Research',
      status: 'running',
      startedAt: '2026-08-25T00:00:00.000Z',
      members: [{ name: 'lead', displayName: 'Lead', role: 'researcher', sessionId: 'session-lead' }],
      assistants: [{ sessionId: 'session-assistant', view: { id: 'assistant' } }],
    } as unknown as FleetRunRecord
    const fleetRuns = {
      list: () => [team],
      recordDataEvent: vi.fn(),
      memberViews: () => [],
      moduleConfiguration: () => ({}),
      exportConfiguration: () => ({}),
      searchTeamHistory: vi.fn().mockResolvedValue({ events: [], hasMore: false, truncated: false }),
      resourceStore: () => ({ listResources: () => [] }),
      readResourcePreview: vi.fn(),
    }
    const git = {
      snapshot: vi.fn().mockResolvedValue({
        status: { root: '/workspace', branch: 'main', head: 'abc123', changes: [], worktrees: [] },
        branches: [],
        commits: [],
      }),
      diff: vi.fn(),
      commit: vi.fn(),
    }
    const authorization = {
      actorForAgent: (sessionId: string) => sessionId === 'session-lead'
        ? { teamId: 'team-1', subject: { kind: 'member', id: 'lead' } }
        : sessionId === 'session-assistant'
          ? { teamId: 'team-1', subject: { kind: 'assistant', id: 'assistant' } }
          : undefined,
      authorize: () => true,
    }
    const scope = {
      fleetRuns,
      get: (service: string) => service === 'fleetGitRecall'
        ? git
        : service === 'fleetAuthorization' ? authorization : undefined,
      patchouli: {
        register: (candidate: MemoryPlugin) => { plugin = candidate; return () => {} },
      },
    }
    apply({ inject: (_services: readonly string[], callback: (value: unknown) => void) => callback(scope) } as unknown as Context)
    if (plugin === undefined) throw new Error('expected Fleet Patchouli processor')

    const retrieve = (effort: 'low' | 'medium') => plugin!.retrieve({
      meta: {
        source: { type: 'agent-loop', id: 'test' },
        scope: '/workspace',
        attributes: { sessionId: 'session-lead', fleetEffort: effort },
      },
      data: { query: 'git' },
    }, {}) as Promise<{ readonly algorithms: readonly { readonly algorithm: string }[] }>

    await expect(retrieve('low')).resolves.toMatchObject({
      algorithms: [
        { algorithm: 'fleet-conversation-history' },
        { algorithm: 'fleet-self-history' },
        { algorithm: 'fleet-team-state' },
        { algorithm: 'fleet-team-activity' },
        { algorithm: 'fleet-shared-resources' },
      ],
    })
    await expect(retrieve('medium')).resolves.toMatchObject({
      algorithms: [
        { algorithm: 'fleet-conversation-history' },
        { algorithm: 'fleet-self-history' },
        { algorithm: 'fleet-team-state' },
        { algorithm: 'fleet-team-activity' },
        { algorithm: 'fleet-shared-resources' },
        { algorithm: 'fleet-git-context' },
      ],
    })
    expect(git.snapshot).toHaveBeenCalledOnce()

    await expect(plugin.retrieve({
      meta: {
        source: { type: 'agent-loop', id: 'test' },
        scope: '/workspace',
        attributes: { sessionId: 'session-assistant', fleetEffort: 'low' },
      },
      data: { query: 'current Team state' },
    }, {})).resolves.toMatchObject({
      handled: true,
      algorithms: [
        { algorithm: 'fleet-conversation-history' },
        { algorithm: 'fleet-team-state' },
        { algorithm: 'fleet-shared-resources' },
      ],
    })
  })
})
