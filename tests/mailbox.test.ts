import type { FleetCoordinationEvent } from '@dsh-agent-fleet/message'
import { describe, expect, it, vi } from 'vitest'

import { FleetMailboxService } from '../src/mailbox.js'
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

describe('FleetMailboxService', () => {
  it('routes a connected user message to the Team assistant and its reply back to the connector', async () => {
    const run = runRecord()
    let coordination: ((runId: string, event: FleetCoordinationEvent) => void) | undefined
    const sendUserConversationMessage = vi.fn()
    const runs = {
      list: () => [run],
      status: () => run,
      sendUserConversationMessage,
      subscribeCoordination: (listener: typeof coordination) => {
        coordination = listener
        return () => { coordination = undefined }
      },
    }
    const mailbox = new FleetMailboxService(runs)
    const outbound = vi.fn(async () => {})
    mailbox.onOutbound(outbound)

    await mailbox.receive({
      connector: 'lark-bot',
      payload: {
        kind: 'user-message',
        externalUserId: 'ou_user',
        conversationId: 'oc_private',
        messageId: 'om_1',
        text: '进度怎么样？',
      },
    }, new AbortController().signal)

    expect(sendUserConversationMessage).toHaveBeenCalledWith({
      runId: 'team-1',
      to: '@team-assistant',
      text: '进度怎么样？',
      delivery: 'wakeup',
    })

    coordination?.('team-1', {
      type: 'message',
      message: {
        id: 'fleet-message-1',
        sequence: 1,
        kind: 'text',
        conversation: '@fleet-user:team-1',
        from: 'assistant-session',
        fromName: 'Maya',
        text: '正在进行。',
        resources: [],
        mentions: [],
        delivery: 'quiet',
        createdAt: '2026-08-24T00:00:01.000Z',
      },
    })

    expect(outbound).toHaveBeenCalledWith({
      connector: 'lark-bot',
      payload: {
        kind: 'user-message',
        conversationId: 'oc_private',
        text: '正在进行。',
      },
    })
  })

  it('requires an explicit Team when several active assistants are available', async () => {
    const first = runRecord()
    const second = runRecord({ id: 'team-2' })
    const mailbox = new FleetMailboxService({
      list: () => [first, second],
      status: id => id === first.id ? first : second,
      sendUserConversationMessage: vi.fn(),
      subscribeCoordination: () => () => {},
    })

    await expect(mailbox.receive({
      connector: 'lark-bot',
      payload: {
        kind: 'user-message',
        externalUserId: 'ou_user',
        conversationId: 'oc_private',
        messageId: 'om_1',
        text: 'hello',
      },
    }, new AbortController().signal)).rejects.toThrow(/requires a teamId/u)
  })
})
