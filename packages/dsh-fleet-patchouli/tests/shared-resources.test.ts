import type { FleetResourcePreview, FleetRunRecord } from 'dsh-agent-fleet'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import {
  createFleetSharedResourcesAlgorithm,
  FLEET_SHARED_RESOURCES_ALGORITHM_ID,
} from '../src/shared-resources.js'

const team = {
  id: 'team-1',
  projectRoot: '/workspace',
  members: [{ name: 'lead', sessionId: 'session-current' }],
  assistants: [],
} as unknown as FleetRunRecord

const request = {
  meta: {
    source: { type: 'agent-loop', id: 'dsh-patchouli-agent-loop' },
    scope: '/workspace',
    attributes: { sessionId: 'session-current' },
  },
  data: { query: 'decision', limit: 20 },
} as const

const resources = [
  {
    id: 'res-notes',
    path: '/workspace/team/notes.md',
    label: 'Decision notes',
    mediaType: 'text/markdown',
    size: 1_024,
    createdBy: 'lead',
    createdAt: '2026-08-20T00:00:00.000Z',
  },
  {
    id: 'res-image',
    path: '/workspace/team/diagram.png',
    label: 'Decision diagram',
    mediaType: 'image/png',
    size: 4_096,
    createdBy: 'reviewer',
    createdAt: '2026-08-21T00:00:00.000Z',
  },
  {
    id: 'res-report',
    path: '/workspace/team/report.txt',
    label: 'Solver report',
    mediaType: 'text/plain',
    size: 2_048,
    createdBy: 'reviewer',
    createdAt: '2026-08-22T00:00:00.000Z',
  },
] as const

function preview(id: string, revision?: string): FleetResourcePreview {
  return {
    id,
    kind: 'markdown',
    body: 'The current decision uses the stable solver.',
    size: 1_024,
    history: [{
      id: 'rev-old',
      updatedBy: 'lead',
      updatedAt: '2026-08-19T00:00:00.000Z',
      operation: 'updated',
      available: true,
      size: 512,
    }],
    historyTruncated: false,
    ...(revision === undefined ? {} : {
      revision: {
        id: revision,
        updatedBy: 'lead',
        updatedAt: '2026-08-19T00:00:00.000Z',
        operation: 'updated' as const,
        available: true as const,
        size: 512,
        before: null,
        after: 'An old decision used the baseline solver.',
      },
    }),
  }
}

function setup(options: {
  readonly deniedResources?: readonly string[]
  readonly denyAction?: boolean
  readonly failResource?: string
  readonly withoutAuthorization?: boolean
  readonly extraTextResources?: number
} = {}) {
  const recordDataEvent = vi.fn()
  const denied = new Set(options.deniedResources ?? [])
  const authorize = vi.fn((input: { readonly resource?: { readonly id: string } }) =>
    input.resource === undefined ? options.denyAction !== true : !denied.has(input.resource.id))
  const authorization = {
    actorForAgent: () => ({ teamId: 'team-1', subject: { kind: 'member', id: 'lead' } }),
    authorize,
  }
  const ctx = {
    get: (name: string) => name === 'fleetAuthorization' && options.withoutAuthorization !== true
      ? authorization
      : undefined,
  } as unknown as Context
  const readResourceContentSnippets = vi.fn(async (
    _runId: string,
    requests: readonly { readonly id: string; readonly query: string }[],
  ) => requests.map(request => {
    if (request.id === options.failResource) return {
        id: request.id,
        matched: false,
        history: [],
        historyTruncated: false,
        error: 'unavailable',
      }
    const body = 'The current decision uses the stable solver.'
    const matched = body.toLocaleLowerCase().includes(request.query.toLocaleLowerCase())
    return {
      id: request.id,
      matched,
      ...(matched ? { snippet: body } : {}),
      history: preview(request.id).history,
      historyTruncated: false,
    }
  }))
  const readResourceRevisionSnippets = vi.fn(async (
    _runId: string,
    requests: readonly { readonly id: string; readonly revisionId: string; readonly query: string }[],
  ) => requests.map(candidate => {
    const body = 'An old decision used the baseline solver.'
    const matched = body.toLocaleLowerCase().includes(candidate.query.toLocaleLowerCase())
    return {
      id: candidate.id,
      revisionId: candidate.revisionId,
      matched,
      ...(matched ? { snippet: body } : {}),
    }
  }))
  const listedResources = [
    ...resources,
    ...Array.from({ length: options.extraTextResources ?? 0 }, (_, index) => ({
      id: `extra-${String(index)}`,
      path: `/workspace/team/extra-${String(index)}.txt`,
      label: `Extra ${String(index)}`,
      mediaType: 'text/plain',
      size: 512,
      createdBy: 'lead',
      createdAt: '2026-08-22T00:00:00.000Z',
    })),
  ]
  const algorithm = createFleetSharedResourcesAlgorithm(ctx, {
    list: () => [team],
    resourceStore: () => ({ listResources: () => listedResources }),
    readResourceContentSnippets,
    readResourceRevisionSnippets,
    recordDataEvent,
  })
  return { algorithm, authorize, readResourceContentSnippets, readResourceRevisionSnippets, recordDataEvent }
}

describe('Fleet shared resource recall', () => {
  it('keeps low effort to metadata and returns binary resources without reading their bytes', async () => {
    const fixture = setup()
    const result = await fixture.algorithm.retrieve?.(request, { effort: 'low' }) as Record<string, unknown>

    expect(fixture.algorithm.id).toBe(FLEET_SHARED_RESOURCES_ALGORITHM_ID)
    expect(result).toMatchObject({ handled: true, effort: 'low', count: 2 })
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: 'res-image', mediaType: 'image/png', match: 'metadata' }),
    ]))
    expect(fixture.readResourceContentSnippets).not.toHaveBeenCalled()
  })

  it('searches bounded current text while leaving the real resource as the source', async () => {
    const fixture = setup()
    const result = await fixture.algorithm.retrieve?.(request, { effort: 'medium' }) as Record<string, unknown>
    expect(result).toMatchObject({ handled: true, effort: 'medium', count: 3 })
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceId: 'res-notes',
        match: 'current',
        source: { kind: 'fleet-resource', teamId: 'team-1', resourceId: 'res-notes' },
      }),
    ]))
    expect(fixture.readResourceContentSnippets).toHaveBeenCalledTimes(1)
    expect(fixture.readResourceContentSnippets).toHaveBeenCalledWith('team-1', [
      { id: 'res-notes', query: 'decision', maxChars: 360 },
      { id: 'res-report', query: 'decision', maxChars: 360 },
    ], undefined)
  })

  it('includes matching available historical revisions only at high effort', async () => {
    const fixture = setup()
    const deferRecallAudit = vi.fn()
    const result = await fixture.algorithm.retrieve?.(request, { effort: 'high', deferRecallAudit }) as Record<string, unknown>
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        match: 'revision',
        revision: 'rev-old',
        source: expect.objectContaining({ revision: 'rev-old' }),
      }),
    ]))
    expect(fixture.readResourceContentSnippets).toHaveBeenCalledTimes(1)
    expect(fixture.readResourceRevisionSnippets).toHaveBeenCalledWith('team-1', [
      { id: 'res-notes', revisionId: 'rev-old', query: 'decision', maxChars: 360 },
      { id: 'res-report', revisionId: 'rev-old', query: 'decision', maxChars: 360 },
    ], undefined)
    expect(deferRecallAudit).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      member: 'lead',
      resultCount: expect.any(Number),
    }))
    expect(fixture.recordDataEvent).not.toHaveBeenCalled()
  })

  it('does not publish recall activity when nothing matched', async () => {
    const fixture = setup()
    const emptyRequest = { ...request, data: { query: 'absent' } } as const
    await expect(fixture.algorithm.retrieve?.(emptyRequest, { effort: 'medium' })).resolves.toMatchObject({
      handled: false,
      items: [],
    })
    expect(fixture.recordDataEvent).not.toHaveBeenCalled()
  })

  it('filters resources through action and fine-grained resource authorization', async () => {
    const fixture = setup({ deniedResources: ['res-notes', 'res-image'] })
    const result = await fixture.algorithm.retrieve?.(request, { effort: 'medium' }) as Record<string, unknown>
    expect(result).toMatchObject({ handled: true, count: 1 })
    expect(result.items).toEqual([expect.objectContaining({ resourceId: 'res-report' })])
    expect(fixture.authorize).toHaveBeenCalledWith(expect.objectContaining({
      action: 'resource.read',
      resource: { kind: 'resource', id: 'res-notes' },
    }))
  })

  it('disables recall when the Fleet authorization seam is unavailable', async () => {
    const fixture = setup({ withoutAuthorization: true })
    expect(fixture.algorithm.filter({ operation: 'retrieve', meta: request.meta })).toBe(false)
    await expect(fixture.algorithm.retrieve?.(request, { effort: 'medium' })).resolves.toMatchObject({
      handled: false,
      items: [],
    })
    expect(fixture.readResourceContentSnippets).not.toHaveBeenCalled()
  })

  it('disables recall when the member lacks resource.read', async () => {
    const fixture = setup({ denyAction: true })
    expect(fixture.algorithm.filter({ operation: 'retrieve', meta: request.meta })).toBe(false)
    await expect(fixture.algorithm.retrieve?.(request, { effort: 'medium' })).resolves.toMatchObject({
      handled: false,
      items: [],
    })
    expect(fixture.readResourceContentSnippets).not.toHaveBeenCalled()
  })

  it('keeps successful batch entries when one resource preview fails', async () => {
    const fixture = setup({ failResource: 'res-notes' })
    const result = await fixture.algorithm.retrieve?.(request, { effort: 'medium' }) as Record<string, unknown>
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: 'res-report', match: 'current' }),
      expect.objectContaining({ resourceId: 'res-notes', match: 'metadata' }),
    ]))
    expect(result.items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: 'res-notes', match: 'current' }),
    ]))
  })

  it('uses one bounded snippet request for many current files before revision-only recall', async () => {
    const fixture = setup({ extraTextResources: 10 })
    await fixture.algorithm.retrieve?.(request, { effort: 'high' })

    expect(fixture.readResourceContentSnippets).toHaveBeenCalledTimes(1)
    expect(fixture.readResourceContentSnippets.mock.calls[0]?.[1]).toHaveLength(12)
    expect(fixture.readResourceRevisionSnippets).toHaveBeenCalled()
  })
})
