import type { FleetCoordinationEvent, FleetMessage } from '@dsh-agent-fleet/message'
import { describe, expect, it, vi } from 'vitest'

import { FleetMailboxService, type FleetMailboxGatewayOutbound } from '../src/mailbox.js'
import type { FleetRunRecord } from '../src/run.js'

function runRecord(overrides: Partial<FleetRunRecord> = {}): FleetRunRecord {
  return {
    id: 'team-1',
    team: 'team',
    name: 'Team',
    configPath: '/workspace/team.json',
    projectRoot: '/workspace',
    launcherSessionId: 'assistant-session',
    members: [],
    assistants: [{
      sessionId: 'assistant-session',
      view: {
        id: 'team-assistant',
        name: 'Maya',
        color: '#527FCA',
        role: 'Team Assistant',
        prompt: '',
        toolGroups: ['messages'],
        permissions: [],
        contacts: { members: '*', channels: '*' },
      },
    }],
    status: 'idle',
    runtimeState: 'active',
    settled: false,
    startedAt: '2026-08-24T00:00:00.000Z',
    ...overrides,
  }
}


function mailboxFixture() {
  const run = runRecord()
  let coordination!: (runId: string, event: FleetCoordinationEvent) => void
  const pending: Array<{ runId: string; message: FleetMessage }> = []
  const runs = {
    list: () => [run], status: () => run,
    sendUserConversationMessage: vi.fn(() => ({ messageId: 'accepted' })),
    pendingMailboxReplies: () => [...pending],
    acknowledgeMailboxReply: vi.fn((_runId: string, id: string) => { pending.splice(pending.findIndex(item => item.message.id === id), 1) }),
    subscribeCoordination: (listener: typeof coordination) => { coordination = listener; return () => {} },
  }
  const warn = vi.fn()
  const mailbox = new FleetMailboxService(runs, warn)
  const enqueue = (id: string, room: string, connector = 'lark') => {
    const message: FleetMessage = { id, sequence: 1, from: 'team-assistant', kind: 'reply',
      conversation: '@fleet-user:team-1', replyTo: 'source', text: id,
      resources: [], mentions: [], delivery: 'quiet', createdAt: new Date().toISOString(),
      external: { connector, conversationId: room, externalUserId: 'user', messageId: 'incoming' },
    }
    pending.push({ runId: run.id, message })
    coordination(run.id, { type: 'message', message })
  }
  return { mailbox, runs, enqueue, pending, warn }
}
const inbound = {
  connector: 'lark', payload: { kind: 'user-message', externalUserId: 'user', conversationId: 'room-A',
    messageId: 'incoming', text: 'Hello' },
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

describe('FleetMailboxService', () => {
  it('passes trusted provenance to ingress and deduplicates retries', async () => {
    const { mailbox, runs } = mailboxFixture()
    try {
      await mailbox.receive(inbound, new AbortController().signal)
      await mailbox.receive(inbound, new AbortController().signal)
      expect(runs.sendUserConversationMessage).toHaveBeenCalledTimes(1)
      expect(runs.sendUserConversationMessage).toHaveBeenCalledWith({
        runId: 'team-1', to: '@team-assistant', text: 'Hello', delivery: 'wakeup',
        external: { connector: 'lark', conversationId: 'room-A', externalUserId: 'user', messageId: 'incoming' },
      })
      await mailbox.receive({ ...inbound, payload: { ...inbound.payload, conversationId: 'room-B' } }, new AbortController().signal)
      expect(runs.sendUserConversationMessage).toHaveBeenCalledTimes(2)
    } finally { mailbox.close() }
  })
  it('allows a failed inbound to be retried', async () => {
    const { mailbox, runs } = mailboxFixture()
    try {
      runs.sendUserConversationMessage.mockImplementationOnce(() => { throw new Error('unavailable') })
      await expect(mailbox.receive(inbound, new AbortController().signal)).rejects.toThrow('unavailable')
      await mailbox.receive(inbound, new AbortController().signal)
      expect(runs.sendUserConversationMessage).toHaveBeenCalledTimes(2)
    } finally { mailbox.close() }
  })
  it('drains recovered and interleaved replies from their persisted envelopes', async () => {
    const { mailbox, runs, enqueue, pending } = mailboxFixture()
    try {
      enqueue('A', 'room-A')
      enqueue('B', 'room-B', 'other')
      const outbound = vi.fn(async (_message: FleetMailboxGatewayOutbound) => {})
      mailbox.onOutbound(outbound)
      await flush()
      expect(outbound.mock.calls).toEqual([
        [{ connector: 'lark', payload: { kind: 'user-message', conversationId: 'room-A', text: 'A' } }],
        [{ connector: 'other', payload: { kind: 'user-message', conversationId: 'room-B', text: 'B' } }],
      ])
      expect(runs.acknowledgeMailboxReply).toHaveBeenCalledTimes(2)
      expect(pending).toEqual([])
    } finally { mailbox.close() }
  })
  it('keeps failed delivery pending and records a receipt only after retry succeeds', async () => {
    vi.useFakeTimers()
    const { mailbox, runs, enqueue, pending, warn } = mailboxFixture()
    try {
      const outbound = vi.fn(async () => {}).mockRejectedValueOnce(new Error('connector unavailable'))
      mailbox.onOutbound(outbound)
      enqueue('A', 'room-A')
      await flush()
      expect(pending).toHaveLength(1)
      expect(runs.acknowledgeMailboxReply).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(pending).toEqual([])
      expect(outbound).toHaveBeenCalledTimes(2)
    } finally { mailbox.close(); vi.useRealTimers() }
  })

  it('does not let one failing connector block other pending replies', async () => {
    const { mailbox, runs, enqueue, pending } = mailboxFixture()
    try {
      const outbound = vi.fn(async (message: FleetMailboxGatewayOutbound) => {
        if (message.connector === 'offline') throw new Error('offline')
      })
      mailbox.onOutbound(outbound)
      enqueue('A', 'room-A', 'offline')
      enqueue('B', 'room-B', 'online')
      await flush()
      expect(runs.acknowledgeMailboxReply).toHaveBeenCalledWith('team-1', 'B')
      expect(pending.map(item => item.message.id)).toEqual(['A'])
    } finally { mailbox.close() }
  })

  it('requires an explicit Team when more than one is active', async () => {
    const { mailbox, runs } = mailboxFixture()
    try {
      runs.list = () => [runRecord(), runRecord({ id: 'team-2' })]
      await expect(mailbox.receive(inbound, new AbortController().signal)).rejects.toThrow('requires a teamId')
    } finally { mailbox.close() }
  })
})
