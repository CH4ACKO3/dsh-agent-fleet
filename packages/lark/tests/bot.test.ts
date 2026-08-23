import type { EventMap, LarkChannel, NormalizedMessage } from '@larksuite/channel'
import { describe, expect, it, vi } from 'vitest'
import { FleetLarkBotConnector, larkBotConnectorId } from '../src/bot.js'

function channelFake() {
  let handlers: Partial<EventMap> = {}
  const channel = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((next: Partial<EventMap>) => {
      handlers = next
      return vi.fn()
    }),
    send: vi.fn(async () => ({ messageId: 'message-1' })),
    editMessage: vi.fn(async () => {}),
    recallMessage: vi.fn(async () => {}),
    updateCard: vi.fn(async () => {}),
    addReaction: vi.fn(async () => 'reaction-1'),
    removeReaction: vi.fn(async () => {}),
    removeReactionByEmoji: vi.fn(async () => true),
  }
  return {
    channel: channel as unknown as LarkChannel,
    handlers: () => handlers,
    spies: channel,
  }
}

describe('FleetLarkBotConnector', () => {
  it('uses stable account-scoped connector ids', () => {
    expect(larkBotConnectorId()).toBe('lark-bot')
    expect(larkBotConnectorId('school')).toBe('lark-bot-school')
    expect(() => larkBotConnectorId('School Account')).toThrow(/lower-kebab-case/u)
  })

  it('delivers normalized events and disconnects with the Gateway lifecycle', async () => {
    const fake = channelFake()
    const deliver = vi.fn(async () => {})
    const connector = new FleetLarkBotConnector(fake.channel, 'default', {
      info: vi.fn(),
      warn: vi.fn(),
    })
    const stop = connector.start({ deliver })
    const message = {
      messageId: 'message-1',
      chatId: 'chat-1',
      chatType: 'group',
      senderId: 'user-1',
      content: 'hello',
      rawContentType: 'text',
      resources: [],
      mentions: [],
      mentionAll: false,
      mentionedBot: true,
      createTime: 1,
    } satisfies NormalizedMessage

    await fake.handlers().message?.(message)
    expect(deliver).toHaveBeenCalledWith({
      kind: 'message',
      identity: 'bot',
      accountId: 'default',
      message,
    })
    await stop()
    expect(fake.spies.disconnect).toHaveBeenCalledOnce()
  })

  it('routes supported outbound operations without copying Mailbox logic', async () => {
    const fake = channelFake()
    const connector = new FleetLarkBotConnector(fake.channel, 'default', {
      info: vi.fn(),
      warn: vi.fn(),
    })
    const signal = new AbortController().signal

    await connector.send({ kind: 'send', to: 'chat-1', input: { text: 'hello' } }, signal)
    await connector.send({ kind: 'add-reaction', messageId: 'message-1', emojiType: 'THUMBSUP' }, signal)

    expect(fake.spies.send).toHaveBeenCalledWith('chat-1', { text: 'hello' }, undefined)
    expect(fake.spies.addReaction).toHaveBeenCalledWith('message-1', 'THUMBSUP')
    await expect(connector.send({ kind: 'unknown' }, signal)).rejects.toThrow(/Unknown Fleet Lark/u)
  })
})
