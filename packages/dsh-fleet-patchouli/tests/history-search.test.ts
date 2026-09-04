import type { Context } from '@deepseek-ai/cordis'
import type { FleetRunRecord } from 'dsh-agent-fleet'
import { describe, expect, it, vi } from 'vitest'

import {
  createFleetHistorySearchAlgorithm,
  FLEET_HISTORY_SEARCH_ALGORITHM_ID,
} from '../src/history-search.js'
import { createFleetMemoryProcessor } from '../src/processor.js'

const team = {
  id: 'team-1',
  members: [{ name: 'lead', sessionId: 'session-current' }],
  assistants: [],
} as unknown as FleetRunRecord

const request = {
  meta: {
    source: { type: 'agent-loop', id: 'dsh-patchouli-agent-loop' },
    scope: '/workspace',
    attributes: { point: 'tool/memory-retrieve', sessionId: 'session-current' },
  },
  data: { query: 'decision', limit: 10 },
} as const

function setup(messages = [
  {
    id: 'message-channel', sequence: 8,
    conversation: '#general', conversationId: '#general',
    from: 'lead', text: 'Published decision summary.',
    createdAt: '2026-08-24T00:00:00.000Z',
  },
  {
    id: 'message-private', sequence: 7,
    conversation: '@reviewer', conversationId: 'dm:member:lead:member:reviewer',
    from: 'reviewer', text: 'The old decision was private.',
    createdAt: '2026-08-20T00:00:00.000Z',
  },
]) {
  const searchParticipantMessages = vi.fn(() => messages)
  const runs = {
    list: () => [team],
    recordDataEvent: vi.fn(),
    participantSessionIds: vi.fn(() => ['session-current']),
    searchParticipantMessages,
  }
  return {
    algorithm: createFleetHistorySearchAlgorithm({} as Context, runs),
    searchParticipantMessages,
  }
}

describe('Fleet conversation history search', () => {
  it('searches the stable Fleet message log instead of native Session relay records', async () => {
    const fixture = setup()
    const deferRecallAudit = vi.fn()
    expect(fixture.algorithm.id).toBe(FLEET_HISTORY_SEARCH_ALGORITHM_ID)
    expect(fixture.algorithm.filter({ operation: 'retrieve', meta: request.meta })).toBe(true)

    const result = await fixture.algorithm.retrieve?.(request, {
      effort: 'medium', deferRecallAudit,
    }) as Record<string, unknown>

    expect(fixture.searchParticipantMessages).toHaveBeenCalledWith('team-1', 'lead', 'decision', 10)
    expect(result).toMatchObject({
      handled: true,
      teamId: 'team-1',
      participant: 'lead',
      count: 2,
      effort: 'medium',
    })
    expect(result.items).toEqual([
      expect.objectContaining({
        messageId: 'message-channel', conversation: '#general', direction: 'sent',
      }),
      expect.objectContaining({
        messageId: 'message-private',
        conversation: 'dm:member:lead:member:reviewer',
        direction: 'received',
      }),
    ])
    expect(deferRecallAudit).toHaveBeenCalledWith({
      teamId: 'team-1', member: 'lead', resultCount: 2,
    })
  })

  it('records a public conversation on the recall audit when every result is in one channel', async () => {
    const fixture = setup([{
      id: 'message-channel', sequence: 8,
      conversation: '#general', conversationId: '#general',
      from: 'reviewer', text: 'Published decision summary.',
      createdAt: '2026-08-24T00:00:00.000Z',
    }])
    const deferRecallAudit = vi.fn()

    await fixture.algorithm.retrieve?.(request, { effort: 'low', deferRecallAudit })

    expect(deferRecallAudit).toHaveBeenCalledWith({
      teamId: 'team-1', member: 'lead', resultCount: 1, conversation: '#general',
    })
  })

  it('does not publish a recall when no visible Fleet message matched', async () => {
    const fixture = setup([])
    const deferRecallAudit = vi.fn()

    await expect(fixture.algorithm.retrieve?.(request, {
      effort: 'medium', deferRecallAudit,
    })).resolves.toEqual({ handled: false, items: [] })
    expect(deferRecallAudit).not.toHaveBeenCalled()
  })

  it('recalls matching Fleet history passively from a first-step Fleet message', async () => {
    const fixture = setup()
    const recordRecallAudit = vi.fn()
    const processor = createFleetMemoryProcessor([fixture.algorithm], { recordRecallAudit })

    await expect(processor.retrieve({
      meta: {
        ...request.meta,
        attributes: {
          ...request.meta.attributes,
          point: 'agent/pre-step',
          step: 1,
        },
      },
      data: {
        messages: [{
          role: 'user',
          source: { kind: 'plugin', plugin: 'dsh-agent-fleet' },
          content: [{ type: 'text', text: '[Fleet DM | msg_9 | from=@reviewer] decision' }],
        }],
      },
    }, {})).resolves.toMatchObject({
      items: [
        expect.objectContaining({ messageId: 'message-channel' }),
        expect.objectContaining({ messageId: 'message-private' }),
      ],
    })
    expect(fixture.searchParticipantMessages).toHaveBeenCalledWith('team-1', 'lead', 'decision', 20)
    expect(recordRecallAudit).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1', member: 'lead', resultCount: 2,
    }))
  })
})
