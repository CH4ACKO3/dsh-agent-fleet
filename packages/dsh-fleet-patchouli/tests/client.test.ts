import { describe, expect, it } from 'vitest'

import { fleetMemoryEntry } from '../src/client/index.js'

describe('Fleet memory panel entries', () => {
  it('projects only committed Fleet memory interactions with their visible details', () => {
    expect(fleetMemoryEntry({
      id: 'stored-1',
      kind: 'memory',
      type: 'memory.stored',
      data: { storedCount: 2, conversation: '#research', providers: ['dsh-agent-fleet-patchouli'] },
      text: '已写入团队记忆库',
      createdAt: '2026-08-25T10:00:00.000Z',
    })).toMatchObject({ operation: 'stored', count: 2, conversation: '#research' })

    expect(fleetMemoryEntry({
      id: 'recall-1',
      kind: 'memory',
      type: 'memory.recalled',
      data: { resultCount: 4, member: 'Hailey', effort: 'medium', algorithm: 'fleet-history-search' },
      text: 'Hailey 召回了 4 条结果',
      createdAt: '2026-08-25T10:05:00.000Z',
    })).toMatchObject({ operation: 'recalled', count: 4, member: 'Hailey', effort: 'medium' })

    expect(fleetMemoryEntry({
      id: 'message-1', kind: 'message', text: '普通消息', createdAt: '2026-08-25T10:06:00.000Z',
    })).toBeUndefined()
  })
})
