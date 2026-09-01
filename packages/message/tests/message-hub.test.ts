import { describe, expect, it } from 'vitest'
import { MessageHub } from '../src/hub.js'
import { installMessageTools } from '../src/index.js'
import type { AgentDirectory, MessageAgent } from '../src/types.js'

class FakeAgent implements MessageAgent {
  private readonly injectedMessages: Parameters<MessageAgent['inject']>[0][] = []
  private readonly pendingMessages: Parameters<MessageAgent['inject']>[0][] = []
  private readonly pendingTurnMessages: Parameters<MessageAgent['followup']>[0][] = []
  readonly followedUp: string[] = []
  readonly steered: string[] = []
  readonly cancellations: Array<{ readonly kind: 'user' | 'parent'; readonly keepInbox?: boolean }> = []
  readonly inbox: NonNullable<MessageAgent['inbox']>

  constructor(readonly id: string) {
    const pending = this.pendingMessages
    const pendingTurn = this.pendingTurnMessages
    const injected = this.injectedMessages
    this.inbox = {
      get nextTurn() { return pendingTurn },
      get nextStep() { return pending },
      replace(messageId, newMessage) {
        const queue = [pending, pendingTurn].find(messages => messages.some(message => message.id === messageId))
        if (queue === undefined) return false
        const pendingIndex = queue.findIndex(message => message.id === messageId)
        queue[pendingIndex] = newMessage
        const injectedIndex = injected.findIndex(message => message.id === messageId)
        if (injectedIndex >= 0) injected[injectedIndex] = newMessage
        return true
      },
      remove(messageId) {
        const queue = [pending, pendingTurn].find(messages => messages.some(message => message.id === messageId))
        if (queue === undefined) return false
        queue.splice(queue.findIndex(message => message.id === messageId), 1)
        return true
      },
    }
  }

  get injected(): string[] {
    return this.injectedMessages.map(message => message.content[0]?.type === 'text' ? message.content[0].text : '')
  }

  get injectedContext(): readonly Parameters<MessageAgent['inject']>[0][] {
    return this.injectedMessages
  }

  inject(message: Parameters<MessageAgent['inject']>[0]): void {
    this.injectedMessages.push(message)
    this.pendingMessages.push(message)
  }

  claimPending(): void {
    this.pendingMessages.length = 0
  }

  followup(message: Parameters<MessageAgent['followup']>[0]): void {
    this.followedUp.push(message.content[0]?.type === 'text' ? message.content[0].text : '')
    this.pendingTurnMessages.push(message)
  }

  steer(message: Parameters<MessageAgent['steer']>[0]): void {
    this.steered.push(message.content[0]?.type === 'text' ? message.content[0].text : '')
  }

  cancel(cause: { readonly kind: 'user' | 'parent' }, options?: { readonly keepInbox?: boolean }): void {
    this.cancellations.push({ ...cause, ...(options?.keepInbox === undefined ? {} : { keepInbox: options.keepInbox }) })
  }
}

function setup(): {
  hub: MessageHub
  agents: Map<string, FakeAgent>
  lead: FakeAgent
  reviewer: FakeAgent
  qa: FakeAgent
  observer: FakeAgent
} {
  const lead = new FakeAgent('lead')
  const reviewer = new FakeAgent('reviewer')
  const qa = new FakeAgent('qa')
  const observer = new FakeAgent('observer')
  const agents = new Map([lead, reviewer, qa, observer].map(agent => [agent.id, agent]))
  const directory: AgentDirectory = {
    get: id => agents.get(id),
    participantIds: () => [...agents.keys()],
    list: () => [...agents.values()],
  }
  return { hub: new MessageHub(directory), agents, lead, reviewer, qa, observer }
}

describe('MessageHub', () => {
  it('aggregates unread messages across conversations into one bounded inbox read', () => {
    const { hub, lead, reviewer, qa } = setup()
    hub.send(lead, { to: '@reviewer', text: 'Direct request.', delivery: 'quiet' })
    hub.send(qa, { to: '#general', text: 'Channel update.', delivery: 'quiet' })
    expect(hub.unreadSummary(reviewer.id)).toEqual({
      unreadMessages: 2,
      unreadChars: 'Direct request.'.length + 'Channel update.'.length,
    })
    const read = hub.readInbox(reviewer)
    expect(read.messages.map(message => [message.conversation, message.text])).toEqual([
      ['@reviewer', 'Direct request.'],
      ['#general', 'Channel update.'],
    ])
    expect(read).toMatchObject({ hasMore: false, remainingUnread: 0, remainingUnreadChars: 0 })
    expect(hub.unreadSummary(reviewer.id)).toEqual({ unreadMessages: 0, unreadChars: 0 })
  })

  it('keeps targeted Channel messages visible without waking non-mentioned inbox owners', () => {
    const { hub, lead, reviewer, qa } = setup()
    const sent = hub.send(lead, {
      to: '#general',
      text: '@reviewer Start the first phase. QA follows later.',
      mentions: ['@reviewer'],
      delivery: 'wakeup',
    })

    expect(sent).toMatchObject({ recipients: 1 })
    expect(sent.audienceHint).toBe('This post notified 1/3 Channel peers and remains visible to the full Channel. Prefer a direct message or bounded Meeting for subset work.')
    expect(hub.receipt(sent.messageId).recipientIds).toEqual(['reviewer'])
    expect(hub.unreadSummary(reviewer.id)).toEqual({
      unreadMessages: 1,
      unreadChars: '@reviewer Start the first phase. QA follows later.'.length,
    })
    expect(hub.unreadSummary(qa.id)).toEqual({ unreadMessages: 0, unreadChars: 0 })
    expect(hub.readInbox(qa)).toMatchObject({ messages: [], remainingUnread: 0 })
    expect(hub.getMessage(qa, sent.messageId)).toMatchObject({ id: sent.messageId })
  })

  it('nudges any addressed Channel subset without warning on a channel-wide address', () => {
    const { hub, lead } = setup()
    const subset = hub.send(lead, {
      to: '#general',
      text: '@reviewer and @qa align privately.',
      mentions: ['@reviewer', '@qa'],
      delivery: 'quiet',
    })
    const wholeChannel = hub.send(lead, {
      to: '#general',
      text: '@reviewer @qa @observer this affects everyone.',
      mentions: ['@reviewer', '@qa', '@observer'],
      delivery: 'quiet',
    })

    expect(subset).toMatchObject({ recipients: 2 })
    expect(subset.audienceHint).toBe('This post notified 2/3 Channel peers and remains visible to the full Channel. Prefer a direct message or bounded Meeting for subset work.')
    expect(hub.receipt(subset.messageId).recipientIds).toEqual(['reviewer', 'qa'])
    expect(wholeChannel).toMatchObject({ recipients: 3 })
    expect(wholeChannel.audienceHint).toBeUndefined()
  })

  it('keeps a Channel reply visible while addressing only the source sender', () => {
    const { hub, lead, reviewer, qa } = setup()
    const source = hub.send(lead, {
      to: '#general',
      text: '@reviewer Inspect the release.',
      mentions: ['@reviewer'],
      delivery: 'quiet',
    })
    const qaNotices = qa.injected.length

    const sent = hub.reply(reviewer, {
      messageId: source.messageId,
      text: '@lead Inspection complete.',
    })

    expect(sent).toMatchObject({ recipients: 1, delivered: 1, woken: 0 })
    expect(sent.audienceHint).toBeUndefined()
    expect(hub.getMessage(qa, sent.messageId)).toMatchObject({
      kind: 'reply',
      conversation: '#general',
      replyTo: source.messageId,
      recipientIds: ['lead'],
      mentions: [],
      text: '@lead Inspection complete.',
    })
    expect(hub.receipt(sent.messageId).recipientIds).toEqual(['lead'])
    expect(hub.pendingRequiredReply(lead.id)).toBeUndefined()
    expect(hub.unreadSummary(lead.id)).toEqual({
      unreadMessages: 1,
      unreadChars: '@lead Inspection complete.'.length,
    })
    expect(hub.unreadSummary(qa.id)).toEqual({ unreadMessages: 0, unreadChars: 0 })
    expect(qa.injected).toHaveLength(qaNotices)
    expect(hub.search(qa, { query: 'Inspection complete' })).toHaveLength(1)
  })

  it('keeps ordinary quiet direct Agent messages non-blocking', () => {
    const { hub, lead, reviewer } = setup()
    const sent = hub.send(lead, {
      to: '@reviewer',
      text: 'Please inspect the parser.',
      resources: ['res_parser'],
      delivery: 'quiet',
    })

    expect(sent).toMatchObject({ recipients: 1, woken: 0 })
    expect(sent.audienceHint).toBeUndefined()
    expect(reviewer.injected).toHaveLength(1)
    expect(reviewer.followedUp).toHaveLength(0)
    expect(reviewer.injected[0]).toContain('Please inspect the parser.')
    expect(reviewer.injected[0]).toContain('do not call fleet_inbox merely to read it again')
    expect(reviewer.injected[0]).not.toContain('reply-task')
    expect(hub.unreadSummary(reviewer.id)).toEqual({
      unreadMessages: 1,
      unreadChars: 'Please inspect the parser.'.length,
    })
    expect(hub.taskUnreadSummary(reviewer.id)).toEqual({ unreadMessages: 0, unreadChars: 0 })
    expect(hub.read(reviewer, { conversation: '@lead' }).messages[0]).toMatchObject({
      id: sent.messageId,
      from: 'lead',
      resources: ['res_parser'],
    })
    expect(hub.pendingRequiredReply(reviewer.id)).toBeUndefined()
  })

  it('keeps an FYI Channel post in shared history without creating member Inbox work', () => {
    const { hub, lead, reviewer, qa } = setup()
    const sent = hub.send(lead, {
      to: '#general',
      text: 'The alignment conclusion is available for reference.',
      delivery: 'fyi',
    })

    expect(sent).toMatchObject({ recipients: 0, delivered: 0, woken: 0 })
    expect(reviewer.injected).toHaveLength(0)
    expect(qa.injected).toHaveLength(0)
    expect(hub.taskUnreadSummary(reviewer.id)).toEqual({ unreadMessages: 0, unreadChars: 0 })
    expect(hub.search(reviewer, { conversation: '#general', query: 'alignment conclusion' }))
      .toContainEqual(expect.objectContaining({ id: sent.messageId, delivery: 'fyi' }))
  })

  it('promotes trusted direct-human messages while leaving ordinary Agent relays optional', () => {
    const { hub, lead, reviewer } = setup()

    const human = hub.sendHuman(lead, {
      to: '@reviewer',
      text: 'Create a native goal for this work.',
      delivery: 'quiet',
    })
    expect(reviewer.injectedContext[0]?.source).toEqual({ kind: 'user' })
    expect(reviewer.injected[0]).toContain('reply-task')
    expect(hub.read(reviewer, { conversation: '@lead' }).messages[0]).toMatchObject({
      id: human.messageId,
      origin: 'user',
    })
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: human.messageId })

    hub.send(lead, {
      to: '@reviewer',
      text: 'This remains an Agent relay.',
      delivery: 'quiet',
    })
    expect(reviewer.injectedContext[1]?.source).toMatchObject({
      kind: 'plugin',
      plugin: 'dsh-agent-fleet',
      form: 'relay',
    })
    expect(hub.read(reviewer, { conversation: '@lead' }).messages.at(-1)?.mentions).toEqual([])
  })

  it('keeps Reply sources pending until an explicit domain receipt completes them', () => {
    const { hub, lead, reviewer, qa } = setup()

    const direct = hub.sendHuman(lead, {
      to: '@reviewer',
      text: '@reviewer Please confirm this direct request.',
      mentions: ['@reviewer'],
      delivery: 'quiet',
    })
    hub.read(reviewer, { conversation: '@lead' })
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({
      id: direct.messageId,
    })
    expect(hub.followupRequiredReply(reviewer)).toMatchObject({ id: direct.messageId })
    expect(reviewer.followedUp.at(-1)).toContain(
      `Use fleet_reply with the Reply Task for message ${direct.messageId}.`,
    )
    expect(reviewer.followedUp.at(-1)).toContain(
      'Ordinary model output does not deliver the reply or complete its receipt.',
    )

    hub.send(reviewer, {
      to: '#general',
      text: 'An unrelated Channel update.',
      delivery: 'quiet',
    })
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: direct.messageId })

    hub.send(reviewer, {
      to: '@lead',
      text: 'Direct request confirmed.',
      delivery: 'quiet',
    })
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: direct.messageId })
    hub.completeRequiredReply(reviewer.id, direct.messageId)
    expect(hub.pendingRequiredReply(reviewer.id)).toBeUndefined()
    expect(hub.pendingRequiredReply(lead.id)).toBeUndefined()

    const userChannel = hub.sendHuman(lead, {
      to: '#general',
      text: 'User Channel updates do not require replies.',
      delivery: 'quiet',
    })
    hub.read(reviewer, { conversation: '#general' })
    expect(hub.getMessage(reviewer, userChannel.messageId).mentions).toEqual([])
    expect(hub.pendingRequiredReply(reviewer.id)).toBeUndefined()

    const channel = hub.send(lead, {
      to: '#general',
      text: '@reviewer @qa Please acknowledge this Channel update.',
      mentions: ['@reviewer', '@qa'],
      delivery: 'quiet',
    })
    hub.read(reviewer, { conversation: '#general' })
    hub.read(qa, { conversation: '#general' })
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: channel.messageId })
    expect(hub.pendingRequiredReply(qa.id)).toMatchObject({ id: channel.messageId })
    expect(reviewer.injected.at(-1)).toContain(
      `Use fleet_reply with the Reply Task for message ${channel.messageId}.`,
    )

    hub.send(reviewer, {
      to: '@lead',
      text: 'Another direct message does not satisfy the Channel.',
      delivery: 'quiet',
    })
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: channel.messageId })

    hub.send(reviewer, {
      to: '#general',
      text: 'Channel update acknowledged.',
      delivery: 'quiet',
    })
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: channel.messageId })
    hub.completeRequiredReply(reviewer.id, channel.messageId)
    expect(hub.pendingRequiredReply(reviewer.id)).toBeUndefined()
    expect(hub.pendingRequiredReply(qa.id)).toMatchObject({ id: channel.messageId })
  })

  it('requires replies only from parsed Channel mentions, regardless of delivery urgency', () => {
    const { hub, lead, reviewer, qa } = setup()
    const sent = hub.send(lead, {
      to: '#general',
      text: '@reviewer Please inspect this when available.',
      delivery: 'quiet',
    })

    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: sent.messageId })
    expect(hub.pendingRequiredReply(qa.id)).toBeUndefined()
    expect(reviewer.injected.at(-1)).toContain('does not deliver the reply')
    expect(qa.injected).toHaveLength(0)
    expect(hub.search(qa, { query: 'Please inspect this' })).toHaveLength(1)

    hub.send(reviewer, {
      to: '#general',
      text: 'The inspection is complete.',
      delivery: 'quiet',
    })
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: sent.messageId })
    hub.completeRequiredReply(reviewer.id, sent.messageId)
    expect(hub.pendingRequiredReply(reviewer.id)).toBeUndefined()
  })

  it('restores required-reply state from durable message history', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    const sent = first.hub.send(first.lead, {
      to: '@reviewer',
      text: '@reviewer Reply after restart.',
      mentions: ['@reviewer'],
      delivery: 'quiet',
    })
    first.hub.read(first.reviewer, { conversation: '@lead' })

    const second = setup()
    second.hub.restore(events)
    expect(second.hub.pendingRequiredReply(second.reviewer.id)).toMatchObject({
      id: sent.messageId,
    })
    second.hub.send(second.reviewer, {
      to: '@lead',
      text: 'Reply restored and completed.',
      delivery: 'quiet',
    })
    expect(second.hub.pendingRequiredReply(second.reviewer.id)).toMatchObject({ id: sent.messageId })
    second.hub.completeRequiredReply(second.reviewer.id, sent.messageId)
    expect(second.hub.pendingRequiredReply(second.reviewer.id)).toBeUndefined()
  })

  it('restores mention-scoped required replies from durable Channel history', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    const sent = first.hub.send(first.lead, {
      to: '#general',
      text: '@reviewer Continue after restart.',
      delivery: 'quiet',
    })

    const second = setup()
    second.hub.restore(events)
    expect(second.hub.pendingRequiredReply(second.reviewer.id)).toMatchObject({ id: sent.messageId })
    expect(second.hub.pendingRequiredReply(second.qa.id)).toBeUndefined()
  })

  it('promotes only unread text mentions from legacy durable messages', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    const sent = first.hub.send(first.lead, {
      to: '#general',
      text: '@reviewer Continue from the legacy message.',
      delivery: 'quiet',
    })
    const legacy = events.map(event => event.type === 'message' && event.message.id === sent.messageId
      ? { ...event, message: { ...event.message, mentions: [] } }
      : event)

    const unread = setup()
    unread.hub.restore(legacy)
    expect(unread.hub.pendingRequiredReply(unread.reviewer.id)).toMatchObject({ id: sent.messageId })

    first.hub.read(first.reviewer, { conversation: '#general' })
    const alreadyRead = setup()
    alreadyRead.hub.restore(events.map(event => event.type === 'message' && event.message.id === sent.messageId
      ? { ...event, message: { ...event.message, mentions: [] } }
      : event))
    expect(alreadyRead.hub.pendingRequiredReply(alreadyRead.reviewer.id)).toBeUndefined()
  })

  it('applies the send admission hook before validation and persistence', () => {
    const lead = new FakeAgent('lead')
    const reviewer = new FakeAgent('reviewer')
    const agents = new Map([lead, reviewer].map(agent => [agent.id, agent]))
    let reject = false
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [...agents.keys()],
      list: () => [...agents.values()],
    }, {
      beforeSend: (_sender, input) => reject
        ? { kind: 'reject', reason: 'Messages are paused for review.' }
        : { kind: 'send', input: { ...input, text: `[reviewed] ${input.text}` } },
    })

    hub.send(lead, { to: '@reviewer', text: 'Inspect this.', delivery: 'quiet' })
    expect(hub.read(reviewer, { conversation: '@lead' }).messages[0]?.text).toBe('[reviewed] Inspect this.')

    reject = true
    expect(() => hub.send(lead, { to: '@reviewer', text: 'Do not persist.', delivery: 'quiet' }))
      .toThrow('Messages are paused for review.')
    expect(hub.search(lead, { query: 'Do not persist.' })).toEqual([])
  })

  it('marks addressed inputs read when replying while leaving broadcasts explicit', () => {
    const { hub, lead, reviewer, qa } = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    hub.onEvent(event => { events.push(event) })

    const direct = hub.send(lead, {
      to: '@reviewer',
      text: 'Please confirm the interface boundary.',
      delivery: 'quiet',
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'inbox',
      action: 'delivered',
      agentId: reviewer.id,
      messageId: direct.messageId,
      contextMessageId: reviewer.inbox.nextStep[0]?.id,
      sessionId: reviewer.id,
      content: 'full',
    }))
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'inbox', action: 'read', agentId: reviewer.id, messageId: direct.messageId,
    }))
    const restored = setup()
    restored.hub.restore(events)
    expect(restored.hub.inbox(restored.reviewer)).toContainEqual(expect.objectContaining({
      acknowledged: false,
      message: expect.objectContaining({ id: direct.messageId }),
    }))
    expect(hub.search(reviewer, { query: 'interface boundary' })).toHaveLength(1)
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'inbox', action: 'read', agentId: reviewer.id, messageId: direct.messageId,
    }))

    hub.send(reviewer, {
      to: '@lead',
      text: 'Confirmed.',
      delivery: 'quiet',
    })
    expect(events).toContainEqual({
      type: 'inbox', action: 'read', agentId: reviewer.id, messageId: direct.messageId,
      through: 'Please confirm the interface boundary.'.length,
    })
    expect(hub.inbox(reviewer)).toContainEqual(expect.objectContaining({
      acknowledged: true,
      message: expect.objectContaining({ id: direct.messageId }),
    }))

    const channel = hub.send(lead, {
      to: '#general',
      text: 'General progress update.',
      delivery: 'quiet',
    })
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'inbox', action: 'read', agentId: qa.id, messageId: channel.messageId,
    }))
    hub.read(qa, { conversation: '#general' })
    expect(events).toContainEqual({
      type: 'inbox', action: 'read', agentId: qa.id, messageId: channel.messageId,
      through: 'General progress update.'.length,
    })
  })

  it('records an unavailable recipient as blocked and delivers after the participant binds', () => {
    const lead = new FakeAgent('lead')
    const reviewer = new FakeAgent('reviewer')
    const agents = new Map<string, FakeAgent>([[lead.id, lead]])
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [lead.id, reviewer.id],
      list: () => [...agents.values()],
    })
    hub.onEvent(event => { events.push(event) })

    const sent = hub.send(lead, {
      to: '@reviewer',
      text: 'This message should wait for a live Session.',
      delivery: 'quiet',
    })

    expect(sent).toMatchObject({ recipients: 1, delivered: 0, woken: 0 })
    expect(hub.receipt(sent.messageId)).toMatchObject({
      recipientIds: [reviewer.id],
      deliveredParticipantIds: [],
      pendingParticipantIds: [reviewer.id],
      pendingDeliveries: [{ participantId: reviewer.id, reason: 'no_active_session' }],
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'inbox',
      action: 'blocked',
      agentId: reviewer.id,
      messageId: sent.messageId,
      reason: 'no_active_session',
    }))

    agents.set(reviewer.id, reviewer)
    expect(hub.refreshAgent(reviewer.id)).toBe(1)
    expect(reviewer.injected[0]).toContain('This message should wait for a live Session.')
    expect(hub.receipt(sent.messageId)).toMatchObject({
      deliveredParticipantIds: [reviewer.id],
      pendingParticipantIds: [],
      pendingDeliveries: [],
    })

    const restored = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [lead.id, reviewer.id],
      list: () => [...agents.values()],
    })
    restored.restore(events)
    expect(restored.receipt(sent.messageId)).toMatchObject({
      recipientIds: [reviewer.id],
      deliveredParticipantIds: [reviewer.id],
      pendingParticipantIds: [],
    })
  })

  it('records the native inbox error when delivery fails', () => {
    const lead = new FakeAgent('lead')
    const failing: MessageAgent = {
      id: 'reviewer',
      inject: () => { throw new Error('native inbox is closed') },
      followup: () => { throw new Error('native inbox is closed') },
      steer: () => { throw new Error('native inbox is closed') },
      cancel: () => {},
    }
    const agents = new Map<string, MessageAgent>([[lead.id, lead], [failing.id, failing]])
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [...agents.keys()],
      list: () => [...agents.values()],
    })

    const sent = hub.send(lead, {
      to: '@reviewer',
      text: 'Record the actual delivery failure.',
      delivery: 'quiet',
    })

    expect(sent.delivered).toBe(0)
    expect(hub.receipt(sent.messageId).pendingDeliveries).toEqual([
      expect.objectContaining({
        participantId: 'reviewer',
        reason: 'inbox_delivery_failed',
        detail: 'native inbox is closed',
      }),
    ])
  })

  it('keeps the send-time Channel audience when membership availability changes', () => {
    const lead = new FakeAgent('lead')
    const reviewer = new FakeAgent('reviewer')
    const agents = new Map<string, FakeAgent>([[lead.id, lead], [reviewer.id, reviewer]])
    const participants = [lead.id, reviewer.id, 'qa']
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [...participants],
      list: () => [...agents.values()],
    })

    const sent = hub.send(lead, {
      to: '#general',
      text: 'Keep the original broadcast audience.',
      delivery: 'quiet',
    })
    participants.splice(participants.indexOf('qa'), 1, 'observer')

    expect(sent).toMatchObject({ recipients: 2, delivered: 1 })
    expect(hub.receipt(sent.messageId)).toMatchObject({
      recipientIds: [reviewer.id, 'qa'],
      deliveredParticipantIds: [reviewer.id],
      pendingParticipantIds: ['qa'],
      pendingDeliveries: [expect.objectContaining({
        participantId: 'qa',
        reason: 'no_active_session',
      })],
    })
  })

  it('does not mark a Channel message read when only its native notice is claimed', () => {
    const { hub, lead, reviewer } = setup()
    const sent = hub.send(lead, {
      to: '#general',
      text: 'The body is available only through fleet_inbox.',
      delivery: 'quiet',
    })
    const notice = reviewer.inbox.nextStep[0]
    expect(notice?.content).toEqual([
      expect.objectContaining({ text: expect.not.stringContaining('The body is available only') }),
    ])

    expect(hub.markDeliveredContextRead(reviewer.id, String(notice?.id))).toBe(false)
    expect(hub.receipt(sent.messageId)).toMatchObject({
      readParticipantIds: [],
      unreadParticipantIds: expect.arrayContaining([reviewer.id]),
      readThrough: { reviewer: 0 },
    })
    expect(hub.pendingUnread(reviewer.id)).toMatchObject({ id: sent.messageId })
    expect(hub.read(reviewer, { conversation: '#general' }).messages).toContainEqual(
      expect.objectContaining({ id: sent.messageId }),
    )
    expect(hub.pendingUnread(reviewer.id)).toBeUndefined()
  })

  it('parses display-name mentions while ignoring email text and sender self-labels', () => {
    const { lead, reviewer, qa, agents } = setup()
    const displayNames: Record<string, string> = {
      lead: 'Lead Agent', reviewer: 'Review Agent', qa: 'QA Agent',
    }
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [...agents.keys()],
      list: () => [...agents.values()],
      displayName: id => displayNames[id],
    })

    const sent = hub.send(lead, {
      to: '#general',
      text: '**@Lead Agent** reporting. Ask @Review Agent; mail reviewer@example.com.',
      delivery: 'quiet',
    })

    expect(hub.getMessage(reviewer, sent.messageId).mentions).toEqual(['reviewer'])
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: sent.messageId })
    expect(hub.pendingRequiredReply(lead.id)).toBeUndefined()
    expect(hub.pendingRequiredReply(qa.id)).toBeUndefined()
  })

  it('marks a direct message read when its full native body is claimed', () => {
    const { hub, lead, reviewer } = setup()
    const sent = hub.send(lead, {
      to: '@reviewer',
      text: 'This full body is delivered through the native inbox.',
      delivery: 'quiet',
    })

    expect(hub.markDeliveredContextRead(reviewer.id, String(reviewer.inbox.nextStep[0]?.id))).toBe(true)
    expect(hub.receipt(sent.messageId)).toMatchObject({
      readParticipantIds: [reviewer.id],
      unreadParticipantIds: [],
      readThrough: { reviewer: 'This full body is delivered through the native inbox.'.length },
    })
  })

  it('reconciles a wakeup claimed synchronously before delivery bookkeeping completes', () => {
    const lead = new FakeAgent('lead')
    const reviewer: MessageAgent = {
      id: 'reviewer',
      inbox: {
        nextTurn: [],
        nextStep: [],
        replace: () => false,
        remove: () => false,
      },
      inject: () => {},
      followup: () => {},
      steer: () => {},
      cancel: () => {},
    }
    const agents = new Map<string, MessageAgent>([[lead.id, lead], [reviewer.id, reviewer]])
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [...agents.keys()],
      list: () => [...agents.values()],
    })

    const sent = hub.send(lead, {
      to: '@reviewer',
      text: 'Start immediately without a duplicate unread wakeup.',
      delivery: 'wakeup',
    })

    expect(hub.receipt(sent.messageId)).toMatchObject({
      readParticipantIds: [reviewer.id],
      unreadParticipantIds: [],
      readThrough: { reviewer: 'Start immediately without a duplicate unread wakeup.'.length },
    })
    expect(hub.followupUnread(reviewer)).toBeUndefined()
  })

  it('coalesces direct unread wakeups by inbox and removes the notice only after the inbox is read', () => {
    const { hub, lead, reviewer } = setup()
    const first = hub.send(lead, {
      to: '@reviewer',
      text: 'Read the first review request.',
      delivery: 'quiet',
    })
    expect(hub.followupUnread(reviewer)).toMatchObject({
      conversation: '@lead', latestMessageId: first.messageId, unreadMessages: 1,
    })
    expect(reviewer.inbox.nextTurn).toHaveLength(1)
    expect(reviewer.followedUp.at(-1)).toContain(
      'Call fleet_inbox with action="read" to consume unread messages from all visible sources',
    )
    expect(reviewer.followedUp.at(-1)).toContain(
      'This notification and ordinary model output do not mark the inbox as read.',
    )
    expect(reviewer.followedUp.at(-1)).not.toContain(first.messageId)

    const second = hub.send(lead, {
      to: '@reviewer',
      text: 'Read the second review request.',
      delivery: 'quiet',
    })
    expect(hub.followupUnread(reviewer)).toMatchObject({
      conversation: '@lead', latestMessageId: second.messageId, unreadMessages: 2,
    })
    expect(reviewer.inbox.nextTurn).toHaveLength(1)
    const latestNotice = reviewer.inbox.nextTurn[0]?.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('\n') ?? ''
    expect(latestNotice).toContain('2 unread messages')
    expect(latestNotice).not.toContain(second.messageId)

    hub.readMessageText(reviewer, first.messageId, undefined, 10)
    expect(reviewer.inbox.nextTurn).toHaveLength(1)

    hub.read(reviewer, { conversation: '@lead' })
    expect(reviewer.inbox.nextTurn).toHaveLength(0)
    expect(hub.inbox(reviewer, { unreadOnly: true })).toEqual([])
  })

  it('persists partial read progress and resumes from it after restart', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    const text = 'x'.repeat(5_000)
    const sent = first.hub.send(first.lead, {
      to: '@reviewer',
      text,
      delivery: 'quiet',
    })
    expect(first.hub.read(first.reviewer, {
      conversation: '@lead', maxChars: 2_000,
    }).messages).toEqual([expect.objectContaining({
      id: sent.messageId,
      text: 'x'.repeat(2_000),
      readRange: { start: 0, end: 2_000, total: 5_000 },
    })])
    expect(first.hub.inbox(first.reviewer, { unreadOnly: true })).toHaveLength(1)
    expect(events).toContainEqual({
      type: 'inbox', action: 'read', agentId: first.reviewer.id, messageId: sent.messageId, through: 2_000,
    })

    const second = setup()
    second.hub.restore(events)
    expect(second.hub.readMessageText(second.reviewer, sent.messageId, undefined, 3_000)).toEqual({
      messageId: sent.messageId,
      offset: 2_000,
      text: 'x'.repeat(3_000),
      totalLength: 5_000,
      hasMore: false,
      readThrough: 5_000,
    })
    expect(second.hub.inbox(second.reviewer, { unreadOnly: true })).toEqual([])
  })

  it('rejects text offsets that skip unread content', () => {
    const { hub, lead, reviewer } = setup()
    const sent = hub.send(lead, { to: '@reviewer', text: 'abcdef', delivery: 'quiet' })

    expect(() => hub.readMessageText(reviewer, sent.messageId, 2, 2)).toThrow('skips unread text')
    expect(hub.readMessageText(reviewer, sent.messageId, undefined, 2)).toMatchObject({
      offset: 0, text: 'ab', readThrough: 2,
    })
    expect(() => hub.readMessageText(reviewer, sent.messageId, 4, 2)).toThrow('next unread offset is 2')
  })

  it('treats legacy acknowledged receipts as fully read during replay', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    const sent = first.hub.send(first.lead, { to: '@reviewer', text: 'Legacy receipt.', delivery: 'quiet' })
    events.push({ type: 'inbox', action: 'acknowledged', agentId: first.reviewer.id, messageId: sent.messageId })

    const second = setup()
    second.hub.restore(events)
    expect(second.hub.inbox(second.reviewer, { unreadOnly: true })).toEqual([])
  })

  it('preserves an absent recipient snapshot when replaying legacy messages', () => {
    const { hub } = setup()
    hub.restore([
      {
        type: 'message',
        message: {
          id: 'legacy-message', sequence: 1, kind: 'text', conversation: '@reviewer', from: 'lead',
          text: 'Legacy delivery.', resources: [], mentions: [], delivery: 'quiet',
          createdAt: '2026-08-26T00:00:00.000Z',
        },
      },
      {
        type: 'inbox', action: 'delivered', agentId: 'reviewer', messageId: 'legacy-message',
        contextMessageId: 'legacy-context', content: 'full',
      },
    ])

    expect(hub.receipt('legacy-message')).toMatchObject({
      recipientIds: ['reviewer'],
      deliveredParticipantIds: ['reviewer'],
      pendingParticipantIds: [],
    })
  })

  it('bounds live and restored message history while continuing to emit every persisted event', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    const oldest = first.hub.send(first.lead, {
      to: '@reviewer',
      text: 'old-message-that-will-leave-the-hot-window',
      delivery: 'wakeup',
    })
    first.hub.pin(first.lead, oldest.messageId)
    first.hub.react(first.lead, { messageId: oldest.messageId, reaction: 'reviewing' })
    first.hub.readMessageText(first.reviewer, oldest.messageId)

    for (let index = 0; index < 1_000; index += 1) {
      first.hub.send(first.lead, {
        to: '#general',
        text: `retained-message-${String(index)}`,
        delivery: 'quiet',
      })
    }

    expect(events.filter(event => event.type === 'message')).toHaveLength(1_001)
    expect(first.hub.search(first.lead, { query: 'old-message-that-will-leave' })).toEqual([])
    expect(first.hub.search(first.lead, { query: 'retained-message-999' })).toHaveLength(1)
    expect(first.hub.listPins(first.lead)).toEqual([])
    expect(first.hub.pendingWakeups(first.reviewer.id)).toEqual([])

    const restored = setup()
    restored.hub.restore(events)
    expect(restored.hub.search(restored.lead, { query: 'old-message-that-will-leave' })).toEqual([])
    expect(restored.hub.search(restored.lead, { query: 'retained-message-999' })).toHaveLength(1)
    expect(restored.hub.listPins(restored.lead)).toEqual([])
    expect(restored.hub.pendingWakeups(restored.reviewer.id)).toEqual([])
  })

  it('bounds retained message text independently of the message count', () => {
    const { hub, lead } = setup()
    for (let index = 0; index < 129; index += 1) {
      const marker = index === 0 ? 'large-old-marker' : `large-recent-marker-${String(index)}`
      hub.send(lead, {
        to: '#general',
        text: marker.padEnd(65_536, 'x'),
        delivery: 'quiet',
      })
    }

    expect(hub.search(lead, { query: 'large-old-marker' })).toEqual([])
    expect(hub.search(lead, { query: 'large-recent-marker-128' })).toHaveLength(1)
  })

  it('requires final confirmation only when direct messages and replies explicitly mention their recipient', () => {
    const { hub, lead, reviewer, observer } = setup()
    const sent = hub.send(lead, {
      to: '@reviewer',
      text: '@reviewer Please inspect the parser.',
      mentions: ['@reviewer'],
      delivery: 'quiet',
    })

    expect(sent).toMatchObject({ recipients: 1, woken: 0 })
    expect(reviewer.injected).toHaveLength(1)
    expect(observer.injected).toHaveLength(0)
    expect(hub.read(reviewer, { conversation: '@lead' }).messages[0]).toMatchObject({
      id: sent.messageId,
      mentions: ['reviewer'],
    })
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: sent.messageId })

    const reply = hub.send(reviewer, {
      to: '@lead',
      text: '@lead The parser is correct; please confirm receipt.',
      mentions: ['@lead'],
      delivery: 'quiet',
    })
    expect(hub.pendingRequiredReply(reviewer.id)).toMatchObject({ id: sent.messageId })
    hub.completeRequiredReply(reviewer.id, sent.messageId)
    expect(hub.pendingRequiredReply(reviewer.id)).toBeUndefined()
    expect(hub.pendingRequiredReply(lead.id)).toMatchObject({ id: reply.messageId })

    hub.send(lead, {
      to: '@reviewer',
      text: 'Receipt confirmed.',
      delivery: 'quiet',
    })
    expect(hub.pendingRequiredReply(lead.id)).toMatchObject({ id: reply.messageId })
    hub.completeRequiredReply(lead.id, reply.messageId)
    expect(hub.pendingRequiredReply(lead.id)).toBeUndefined()
    expect(hub.pendingRequiredReply(reviewer.id)).toBeUndefined()

    expect(() => hub.send(lead, {
      to: '@reviewer',
      text: '@observer Please also inspect this.',
      mentions: ['@observer'],
      delivery: 'quiet',
    })).toThrow('direct message can only mention its recipient')
  })

  it('shows a Fleet name while retaining the native sender id', () => {
    const lead = new FakeAgent('lead-id')
    const reviewer = new FakeAgent('reviewer-id')
    const members = new Map([lead, reviewer].map(agent => [agent.id, agent]))
    const hub = new MessageHub({
      get: id => members.get(id),
      participantIds: () => [...members.keys()],
      list: () => [...members.values()],
      displayName: id => id === 'lead-id' ? 'tech-lead' : 'reviewer',
    })

    hub.send(lead, {
      to: '@reviewer-id',
      text: 'Please review the parser.',
      delivery: 'quiet',
    })

    expect(reviewer.injected[0]).toContain('from=@tech-lead')
    expect(hub.read(reviewer, { conversation: '@lead-id' }).messages[0]).toMatchObject({
      from: 'lead-id',
      fromName: 'tech-lead',
    })
  })

  it('rejects a sender excluded by the Agent directory', () => {
    const member = new FakeAgent('member')
    const outsider = new FakeAgent('outsider')
    const hub = new MessageHub({
      get: id => id === member.id ? member : undefined,
      participantIds: () => [member.id],
      list: () => [member],
    })

    expect(() => hub.send(outsider, {
      to: '#general',
      text: 'Should not enter the Fleet channel.',
      delivery: 'quiet',
    })).toThrow('is not available to Fleet')
  })

  it('enforces member contact and coordination permissions at the hub boundary', () => {
    const lead = new FakeAgent('lead')
    const reviewer = new FakeAgent('reviewer')
    const qa = new FakeAgent('qa')
    const agents = new Map([lead, reviewer, qa].map(agent => [agent.id, agent]))
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [...agents.keys()],
      list: () => [...agents.values()],
      canContact: (sender, recipient) => sender !== 'lead' || recipient === 'reviewer',
      canAccessChannel: (agent, channel) => agent !== 'lead' || channel === 'decisions',
      hasPermission: (agent, permission) => agent !== 'lead' || permission === 'vote.create',
    })

    expect(() => hub.send(lead, {
      to: '@qa',
      text: 'Hidden peer.',
      delivery: 'quiet',
    })).toThrow('cannot contact')
    expect(() => hub.createVote(lead, {
      channel: '#general',
      kind: 'message',
      statement: 'This Channel is outside the member view.',
    })).toThrow('cannot access #general')
    hub.initializeChannel({ id: 'decisions', name: 'Decisions', members: ['@lead', '@reviewer', '@qa'] })
    expect(() => hub.openMeeting(lead, {
      id: 'review',
      title: 'Review',
      agenda: 'Inspect the result.',
      participants: ['@reviewer'],
    })).toThrow('meeting.manage')
    expect(hub.createVote(lead, {
      channel: '#decisions',
      kind: 'message',
      statement: 'Adopt the proposed naming.',
    })).toMatchObject({ initiator: 'lead', status: 'open' })
  })

  it('uses followup for direct wakeup messages', () => {
    const { hub, lead, reviewer } = setup()
    const sent = hub.send(lead, {
      to: '@reviewer',
      text: 'Continue with the review.',
      delivery: 'wakeup',
    })

    expect(reviewer.followedUp).toHaveLength(1)
    expect(reviewer.injected).toHaveLength(0)
    expect(hub.pendingWakeups(reviewer.id)).toEqual([
      expect.objectContaining({ id: sent.messageId, conversation: '@reviewer' }),
    ])

    hub.send(reviewer, {
      to: '@lead',
      text: 'The review is complete.',
      delivery: 'quiet',
    })
    expect(hub.pendingWakeups(reviewer.id)).toEqual([])
  })

  it('delivers, promotes, coalesces, and interrupts system notifications without creating Fleet messages', () => {
    const { hub, reviewer } = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    hub.onEvent(event => { events.push(event) })

    const quiet = hub.sendSystemNotification(reviewer.id, {
      kind: 'task_notice',
      text: 'Task state changed.',
      delivery: 'quiet',
      coalesceKey: 'task:task_1',
    })
    expect(quiet.disposition).toBe('injected')
    expect(reviewer.inbox.nextStep).toHaveLength(1)
    expect(reviewer.inbox.nextTurn).toHaveLength(0)

    const promoted = hub.sendSystemNotification(reviewer.id, {
      kind: 'task_notice',
      text: 'Task is now due.',
      delivery: 'wakeup',
      coalesceKey: 'task:task_1',
    })
    expect(promoted).toEqual({ contextMessageId: quiet.contextMessageId, disposition: 'followed-up' })
    expect(reviewer.inbox.nextStep).toHaveLength(0)
    expect(reviewer.inbox.nextTurn).toHaveLength(1)
    expect(reviewer.followedUp.at(-1)).toBe('Task is now due.')

    const replaced = hub.sendSystemNotification(reviewer.id, {
      kind: 'task_notice',
      text: 'Task due reminder updated.',
      delivery: 'quiet',
      coalesceKey: 'task:task_1',
    })
    expect(replaced).toEqual({ contextMessageId: quiet.contextMessageId, disposition: 'replaced' })
    expect(reviewer.inbox.nextTurn[0]?.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'Task due reminder updated.' }),
    ])

    const rewoken = hub.sendSystemNotification(reviewer.id, {
      kind: 'task_notice',
      text: 'Task is still due after reconnecting.',
      delivery: 'wakeup',
      coalesceKey: 'task:task_1',
    })
    expect(rewoken).toEqual({ contextMessageId: quiet.contextMessageId, disposition: 'replaced' })
    expect(reviewer.inbox.nextTurn).toHaveLength(1)
    expect(reviewer.inbox.nextTurn[0]?.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'Task is still due after reconnecting.' }),
    ])

    expect(hub.sendSystemNotification(reviewer.id, {
      kind: 'network_recovery',
      text: 'Retry only after checking external side effects.',
      delivery: 'interrupt',
      coalesceKey: 'task:task_1',
    }).disposition).toBe('interrupted')
    expect(reviewer.inbox.nextTurn).toHaveLength(0)
    expect(reviewer.cancellations).toEqual([{ kind: 'user', keepInbox: true }])
    expect(reviewer.steered.at(-1)).toContain('external side effects')
    expect(hub.search(reviewer)).toEqual([])
    expect(hub.inbox(reviewer)).toEqual([])
    expect(events.filter(event => event.type === 'system_notification').map(event => event.action))
      .toEqual(['injected', 'followed-up', 'replaced', 'replaced', 'interrupted'])
  })

  it('keeps quiet direct and Meeting messages non-waking across restore', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    first.hub.openMeeting(first.lead, {
      id: 'quiet-review', title: 'Quiet review', agenda: 'Share context without waking.', participants: ['@reviewer'],
    })
    const opened = first.hub.inbox(first.reviewer).find(item => item.message.kind === 'meeting_opened')
    if (opened === undefined) throw new Error('expected Meeting invitation')
    first.hub.read(first.reviewer, { conversation: 'meeting:quiet-review' })
    first.hub.send(first.lead, {
      to: '@reviewer', text: 'Read this when you next become active.', delivery: 'quiet',
    })
    first.hub.send(first.lead, {
      to: 'meeting:quiet-review', text: 'Meeting context for the next active step.', delivery: 'quiet',
    })

    expect(first.hub.pendingWakeups(first.reviewer.id)).toEqual([])
    expect(first.hub.inbox(first.reviewer, { unreadOnly: true })).toHaveLength(2)

    const restored = setup()
    restored.hub.restore(events)
    expect(restored.hub.pendingWakeups(restored.reviewer.id)).toEqual([])
    expect(restored.hub.inbox(restored.reviewer, { unreadOnly: true })).toHaveLength(2)
  })

  it('cancels the current step and steers an urgent direct message while preserving pending work', () => {
    const { hub, lead, reviewer } = setup()
    const sent = hub.send(lead, {
      to: '@reviewer',
      text: 'Stop: the target branch was replaced.',
      delivery: 'interrupt',
    })

    expect(sent).toMatchObject({ recipients: 1, woken: 1 })
    expect(reviewer.cancellations).toEqual([{ kind: 'user', keepInbox: true }])
    expect(reviewer.steered).toHaveLength(1)
    expect(reviewer.steered[0]).toContain('target branch was replaced')
    expect(reviewer.followedUp).toEqual([])
    expect(reviewer.injected).toEqual([])
  })

  it('interrupts and notifies only explicitly mentioned Channel members', () => {
    const { hub, lead, reviewer, qa } = setup()
    hub.send(lead, {
      to: '#general',
      text: '@reviewer stop editing the generated file.',
      mentions: ['@reviewer'],
      delivery: 'interrupt',
    })

    expect(reviewer.cancellations).toEqual([{ kind: 'user', keepInbox: true }])
    expect(reviewer.steered).toHaveLength(1)
    expect(qa.cancellations).toEqual([])
    expect(qa.steered).toEqual([])
    expect(qa.injected).toHaveLength(0)
  })

  it('restores unresolved wake-ups without redelivering them', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    const sent = first.hub.send(first.lead, {
      to: '@reviewer',
      text: 'Resume this after restart.',
      delivery: 'wakeup',
    })

    const second = setup()
    second.hub.restore(events)

    expect(second.hub.pendingWakeups(second.reviewer.id)).toEqual([
      expect.objectContaining({ id: sent.messageId }),
    ])
    expect(second.reviewer.followedUp).toEqual([])
  })

  it('wakes and notifies only mentioned Channel members', () => {
    const { hub, lead, reviewer, qa } = setup()
    hub.send(lead, {
      to: '#general',
      text: 'Reviewer, please check this now.',
      mentions: ['@reviewer'],
      delivery: 'wakeup',
    })

    expect(reviewer.followedUp[0]).toContain('please check this now')
    expect(qa.injected).toHaveLength(0)
    expect(qa.followedUp).toHaveLength(0)
  })

  it('coalesces unread Channel activity into one mutable pending snapshot', () => {
    const { hub, lead, reviewer, qa } = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    hub.onEvent(event => { events.push(event) })
    const first = hub.send(lead, {
      to: '#general',
      text: 'First background update.',
      delivery: 'quiet',
    })
    const sent = hub.send(reviewer, {
      to: '#general',
      text: 'Second background update.',
      delivery: 'quiet',
    })

    expect(qa.injected).toHaveLength(1)
    expect(qa.inbox.nextStep).toHaveLength(1)
    expect(qa.injected[0]).toContain(sent.messageId)
    expect(qa.injected[0]).toContain('from reviewer')
    expect(qa.injected[0]).not.toContain('First background update')
    expect(qa.injected[0]).not.toContain('Second background update')
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'inbox', action: 'read', agentId: qa.id,
    }))

    expect(hub.read(qa, { conversation: '#general', limit: 1 })).toMatchObject({
      messages: [
        expect.objectContaining({ id: first.messageId }),
        expect.objectContaining({ id: sent.messageId }),
      ],
      hasMore: false,
      remainingUnread: 0,
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'inbox', action: 'read', agentId: qa.id, messageId: sent.messageId,
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'inbox', action: 'read', agentId: qa.id, messageId: first.messageId,
    }))
  })

  it('loads an unread inbox in one character-bounded batch and keeps only older overflow unread', () => {
    const { hub, lead, reviewer } = setup()
    const messages = Array.from({ length: 15 }, (_, index) => hub.send(lead, {
      to: '#general',
      text: `update-${String(index).padStart(2, '0')}`,
      delivery: 'quiet',
    }))

    const all = hub.read(reviewer, { conversation: '#general', limit: 5 })
    expect(all.messages.map(message => message.id)).toEqual(messages.map(message => message.messageId))
    expect(all).toMatchObject({ hasMore: false, remainingUnread: 0, remainingUnreadChars: 0 })

    const older = hub.send(lead, { to: '#general', text: 'older-message', delivery: 'quiet' })
    const recent = [
      hub.send(lead, { to: '#general', text: 'recent-one', delivery: 'quiet' }),
      hub.send(lead, { to: '#general', text: 'recent-two', delivery: 'quiet' }),
    ]
    const bounded = hub.read(reviewer, { conversation: '#general', maxChars: 20 })
    expect(bounded.messages.map(message => message.id)).toEqual(recent.map(message => message.messageId))
    expect(bounded).toMatchObject({
      hasMore: true,
      remainingUnread: 1,
      remainingUnreadChars: 'older-message'.length,
    })
    expect(hub.receipt(older.messageId).unreadParticipantIds).toContain(reviewer.id)
    for (const message of recent) {
      expect(hub.receipt(message.messageId).unreadParticipantIds).not.toContain(reviewer.id)
    }

    expect(hub.read(reviewer, { conversation: '#general' })).toMatchObject({
      messages: [expect.objectContaining({ id: older.messageId })],
      hasMore: false,
      remainingUnread: 0,
      remainingUnreadChars: 0,
    })
  })

  it('starts a new Channel snapshot after the previous one was claimed', () => {
    const { hub, lead, reviewer, qa } = setup()
    hub.send(lead, { to: '#general', text: 'First update.', delivery: 'quiet' })
    qa.claimPending()
    hub.send(reviewer, { to: '#general', text: 'Update after the step boundary.', delivery: 'quiet' })

    expect(qa.injected).toHaveLength(2)
    expect(qa.inbox.nextStep).toHaveLength(1)
  })

  it('removes a pending Channel snapshot after reading through the latest message', () => {
    const { hub, lead, reviewer } = setup()
    hub.send(lead, { to: '#general', text: 'Read this update.', delivery: 'quiet' })
    expect(reviewer.inbox.nextStep).toHaveLength(1)

    expect(hub.read(reviewer, { conversation: '#general' }).hasMore).toBe(false)
    expect(reviewer.inbox.nextStep).toHaveLength(0)

    hub.send(lead, { to: '#general', text: 'A later update.', delivery: 'quiet' })
    expect(reviewer.injected).toHaveLength(2)
    expect(reviewer.inbox.nextStep).toHaveLength(1)
  })

  it('keeps a pending Channel snapshot while a character-bounded read has more messages', () => {
    const { hub, lead, reviewer } = setup()
    const first = hub.send(lead, { to: '#general', text: 'First update.', delivery: 'quiet' })
    hub.send(lead, { to: '#general', text: 'Second update.', delivery: 'quiet' })
    hub.send(lead, { to: '#general', text: 'Third update.', delivery: 'quiet' })

    expect(hub.read(reviewer, {
      conversation: '#general',
      after: first.messageId,
      maxChars: 'Third update.'.length,
    }).hasMore).toBe(true)
    expect(reviewer.inbox.nextStep).toHaveLength(1)
  })

  it('continues replacing a durable pending Channel snapshot after MessageHub restore', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    first.hub.send(first.lead, { to: '#general', text: 'Before restart.', delivery: 'quiet' })

    const restored = new MessageHub({
      get: id => first.agents.get(id),
      participantIds: () => [...first.agents.keys()],
      list: () => [...first.agents.values()],
    })
    restored.restore(events)
    const sent = restored.send(first.reviewer, {
      to: '#general',
      text: 'After restart.',
      delivery: 'quiet',
    })

    expect(first.qa.injected).toHaveLength(1)
    expect(first.qa.injected[0]).toContain(sent.messageId)
  })

  it('creates private Channels and limits their history', () => {
    const { hub, lead, reviewer, qa } = setup()
    hub.createChannel(lead, {
      name: 'review-room',
      members: ['@reviewer'],
    })
    hub.send(lead, {
      to: '#review-room',
      text: 'Private review context.',
      delivery: 'quiet',
    })

    expect(hub.listChannels(reviewer).map(channel => channel.id)).toContain('review-room')
    expect(hub.listChannels(qa).map(channel => channel.id)).not.toContain('review-room')
    expect(() => hub.read(qa, { conversation: '#review-room' })).toThrow('cannot access')
  })

  it('does not add a late Agent to runtime-created private Channels', () => {
    const { hub, lead, reviewer, qa } = setup()
    hub.createChannel(lead, {
      name: 'review-room',
      members: ['@reviewer'],
    })

    hub.connectAgent(qa.id)

    expect(hub.listChannels(reviewer).map(channel => channel.id)).toContain('review-room')
    expect(hub.listChannels(qa).map(channel => channel.id)).not.toContain('review-room')
  })

  it('lets only the creator archive a Channel', () => {
    const { hub, lead, reviewer } = setup()
    hub.createChannel(lead, { name: 'review-room' })

    expect(() => hub.archiveChannel(reviewer, 'review-room')).toThrow('only Channel creator')
    expect(hub.archiveChannel(lead, 'review-room')).toMatchObject({ archived: true })
  })

  it('keeps a revisioned current state separate from Channel messages', () => {
    const { hub, lead, reviewer } = setup()
    hub.createChannel(lead, {
      name: 'delivery',
      summary: 'Kickoff',
      body: 'Backlog: vertical slice',
    })

    expect(hub.updateChannel(reviewer, 'delivery', {
      summary: 'Implementation',
      body: 'In Progress: vertical slice',
    })).toMatchObject({
      summary: 'Implementation',
      body: 'In Progress: vertical slice',
      revision: 1,
    })
    expect(hub.read(lead, { conversation: '#delivery' }).messages).toEqual([])
  })

  it('provides a persistent inbox, search, reactions, pins, and private Channel membership updates', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    first.hub.createChannel(first.lead, { name: 'research', members: ['@reviewer'] })
    first.hub.updateChannel(first.lead, 'research', { addMembers: ['@qa'], topic: 'Evidence review' })
    const sent = first.hub.send(first.lead, {
      to: '#research',
      text: 'Reviewer, verify the benchmark evidence.',
      mentions: ['@reviewer'],
      resources: ['res_benchmark'],
      delivery: 'wakeup',
    })

    expect(first.hub.inbox(first.reviewer, { unreadOnly: true })).toEqual([
      expect.objectContaining({
        reasons: ['mention'],
        acknowledged: false,
        message: expect.objectContaining({ id: sent.messageId }),
      }),
    ])
    expect(first.hub.read(first.reviewer, { conversation: '#research' }).messages).toHaveLength(1)
    expect(first.hub.react(first.reviewer, { messageId: sent.messageId, reaction: 'ack' })).toMatchObject({
      members: ['reviewer'],
    })
    expect(first.hub.pin(first.lead, sent.messageId)).toMatchObject({ conversation: '#research' })
    expect(first.hub.search(first.qa, { query: 'benchmark', resource: 'res_benchmark' })).toHaveLength(1)
    expect(first.hub.updateChannel(first.lead, 'research', { removeMembers: ['@reviewer'] }).members)
      .toEqual(['lead', 'qa'])

    const second = setup()
    second.hub.restore(events)
    expect(second.hub.listReactions(second.qa, sent.messageId)).toEqual([
      expect.objectContaining({ reaction: 'ack', members: ['reviewer'] }),
    ])
    expect(second.hub.listPins(second.qa, '#research')).toEqual([
      expect.objectContaining({ messageId: sent.messageId }),
    ])
    expect(second.hub.inbox(second.reviewer, { unreadOnly: true })).toEqual([])
  })

  it('approves a Channel Vote only after every other readable member approves', () => {
    const { hub, lead, reviewer, qa, observer } = setup()
    hub.createChannel(lead, {
      name: 'delivery',
      members: ['@reviewer', '@qa', '@observer'],
    })
    const opened = hub.createVote(lead, {
      channel: '#delivery',
      kind: 'finish',
      statement: 'Ship artifact.zip after independent review.',
    })

    expect(opened).toMatchObject({
      status: 'open',
      initiator: 'lead',
      voters: ['reviewer', 'qa', 'observer'],
    })
    expect(reviewer.followedUp.at(-1)).toContain('Vote')
    expect(hub.castVote(reviewer, { id: opened.id, response: 'approve' }).status).toBe('open')
    expect(hub.castVote(qa, { id: opened.id, response: 'approve' }).status).toBe('open')
    expect(hub.castVote(observer, { id: opened.id, response: 'approve' })).toMatchObject({
      status: 'approved',
      approvals: ['reviewer', 'qa', 'observer'],
    })
    expect(lead.followedUp.at(-1)).toContain('approved')
  })

  it('reuses a deterministic host Vote id without opening a duplicate', () => {
    const { hub, lead, reviewer } = setup()
    const input = {
      id: 'task_vote_task_1_attempt_1',
      channel: '#general' as const,
      kind: 'finish' as const,
      statement: '[Task task_1] Evidence is complete.',
      voters: ['@reviewer'],
    }
    const opened = hub.createVote(lead, input)
    const messages = reviewer.followedUp.length
    expect(hub.createVote(lead, input)).toEqual(opened)
    expect(reviewer.followedUp).toHaveLength(messages)
    expect(() => hub.createVote(lead, { ...input, statement: 'Different result.' }))
      .toThrow('already exists with different input')
  })

  it('uses short monotonic message and Vote ids and continues them after restore', () => {
    const first = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    first.hub.onEvent(event => { events.push(event) })
    const message = first.hub.send(first.lead, {
      to: '#general',
      text: 'Record the short ids.',
      delivery: 'quiet',
    })
    const vote = first.hub.createVote(first.lead, {
      channel: '#general',
      kind: 'message',
      statement: 'Keep Team-local ordinal references.',
      voters: ['@reviewer'],
    })
    expect(message.messageId).toBe('msg_1')
    expect(vote.id).toBe('vote_1')

    const second = setup()
    second.hub.restore(events)
    expect(second.hub.send(second.lead, {
      to: '#general',
      text: 'Continue after restore.',
      delivery: 'quiet',
    }).messageId).toBe('msg_3')
    expect(second.hub.createVote(second.lead, {
      channel: '#general',
      kind: 'message',
      statement: 'Continue the Vote sequence too.',
      voters: ['@qa'],
    }).id).toBe('vote_2')
  })

  it('casts without an id when exactly one Vote awaits the member', () => {
    const { hub, lead, reviewer } = setup()
    const opened = hub.createVote(lead, {
      channel: '#general',
      kind: 'message',
      statement: 'Use the concise cast form.',
      voters: ['@reviewer'],
    })

    expect(hub.castVote(reviewer, { response: 'approve' })).toMatchObject({
      id: opened.id,
      status: 'approved',
    })
  })

  it('requires an id only when more than one Vote awaits the member', () => {
    const { hub, lead, reviewer } = setup()
    hub.createVote(lead, {
      channel: '#general', kind: 'message', statement: 'First choice.', voters: ['@reviewer'],
    })
    hub.createVote(lead, {
      channel: '#general', kind: 'message', statement: 'Second choice.', voters: ['@reviewer'],
    })

    expect(() => hub.castVote(reviewer, { response: 'approve' })).toThrow('multiple open Votes')
  })

  it('continues accepting legacy UUID Vote ids after restore', () => {
    const { hub, lead, reviewer } = setup()
    const opened = hub.createVote(lead, {
      channel: '#general', kind: 'message', statement: 'Legacy identity.', voters: ['@reviewer'],
    })
    const legacy = { ...opened, id: 'vote_12345678-1234-1234-1234-123456789abc' }
    hub.restore([{ type: 'vote', action: 'opened', vote: legacy }])

    expect(hub.castVote(reviewer, { id: legacy.id, response: 'approve' })).toMatchObject({
      id: legacy.id,
      status: 'approved',
    })
  })

  it('checks current action authorization when a previously visible tool executes', async () => {
    const { hub, lead } = setup()
    const registered: Array<{
      readonly name: string
      readonly execute: (args: Record<string, unknown>, exec: unknown) => unknown
    }> = []
    const allowed = new Set(['message.read', 'message.post'])
    installMessageTools({
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool) } },
    } as never, hub, {
      coordination: false,
      authorize: (_agentId, action) => allowed.has(action),
    })
    const send = registered.find(candidate => candidate.name === 'fleet_send')
    if (send === undefined) throw new Error('expected fleet_send')

    await expect(send.execute({ to: '#general', message: 'Allowed once.' }, { agent: lead }))
      .resolves.toMatchObject({ recipients: expect.any(Number) })
    allowed.delete('message.post')
    await expect(async () => send.execute(
      { to: '#general', message: 'Must now be denied.' },
      { agent: lead },
    )).rejects.toThrow('not authorized for message.post')
  })

  it('excludes connected observers that are not default voters', () => {
    const { agents, lead, reviewer, qa, observer } = setup()
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [...agents.keys()],
      list: () => [...agents.values()],
      defaultVoter: id => id !== observer.id,
    })

    const opened = hub.createVote(lead, {
      channel: '#general',
      kind: 'finish',
      statement: 'Finish with the core Team vote.',
    })

    expect(opened.voters).toEqual([reviewer.id, qa.id])
  })

  it('does not allow a non-voting assistant to be selected explicitly', () => {
    const { agents, lead, observer } = setup()
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [...agents.keys()],
      list: () => [...agents.values()],
      defaultVoter: id => id !== observer.id,
      canVote: id => id !== observer.id,
    })

    expect(() => hub.createVote(lead, {
      channel: '#general',
      kind: 'message',
      statement: 'Do not involve the assistant in this decision.',
      voters: ['@observer'],
    })).toThrow('is not eligible to vote')
  })

  it('supports a selected voter set within the visible Channel', () => {
    const { hub, lead, reviewer, qa } = setup()
    const opened = hub.createVote(lead, {
      channel: '#general',
      kind: 'message',
      statement: 'Use the reviewed API shape.',
      voters: ['@reviewer'],
    })

    expect(opened.voters).toEqual(['reviewer'])
    expect(qa.followedUp).toEqual([])
    expect(hub.castVote(reviewer, { id: opened.id, response: 'approve' }).status).toBe('approved')
  })

  it('removes an offline voter and closes a now-satisfied Vote', () => {
    const { hub, lead, reviewer } = setup()
    const opened = hub.createVote(lead, {
      channel: '#general',
      kind: 'finish',
      statement: 'Finish after the remaining online members agree.',
      voters: ['@reviewer'],
    })

    hub.disconnectAgent(reviewer.id)

    expect(hub.getVote(lead, opened.id)).toMatchObject({
      status: 'approved',
      voters: [],
      approvals: [],
    })
    expect(hub.pendingWakeups(reviewer.id)).toEqual([])
  })

  it('rejects a Channel Vote immediately with a required reason', () => {
    const { hub, lead, reviewer } = setup()
    const opened = hub.createVote(lead, {
      channel: '#general',
      kind: 'start_work',
      statement: 'Begin implementation.',
    })

    expect(() => hub.castVote(reviewer, { id: opened.id, response: 'reject' })).toThrow('requires a reason')
    expect(hub.castVote(reviewer, {
      id: opened.id,
      response: 'reject',
      reason: 'Acceptance criteria are missing.',
    })).toMatchObject({
      status: 'rejected',
      rejection: { voter: 'reviewer', reason: 'Acceptance criteria are missing.' },
    })
  })

  it('validates replies against the current conversation', () => {
    const { hub, lead, reviewer, qa } = setup()
    const first = hub.send(lead, {
      to: '@reviewer',
      text: 'Initial review request.',
      delivery: 'quiet',
    })

    expect(() => hub.send(lead, {
      to: '@qa',
      text: 'Wrong thread.',
      replyTo: first.messageId,
      delivery: 'quiet',
    })).toThrow('another conversation')
  })

  it('releases waiters on the next Fleet change', async () => {
    const { hub, lead, reviewer } = setup()
    const waiting = hub.wait(reviewer, undefined, 1_000)
    hub.send(lead, {
      to: '@reviewer',
      text: 'A change occurred.',
      delivery: 'quiet',
    })

    await expect(waiting).resolves.toEqual({ timedOut: false, revision: 1, reason: 'changed' })
  })

  it('does not miss a message accepted before waiting starts', async () => {
    const { hub, lead, reviewer } = setup()
    const baseline = hub.read(lead, { conversation: '@reviewer' }).revision
    hub.send(reviewer, {
      to: '@lead',
      text: 'Already arrived.',
      delivery: 'quiet',
    })

    await expect(hub.wait(lead, baseline, 1_000)).resolves.toEqual({ timedOut: false, revision: 1, reason: 'changed' })
  })

  it('does not release an Agent waiter for an unrelated private conversation', async () => {
    const { hub, lead, reviewer, observer } = setup()
    const waiting = hub.wait(observer, undefined, 10)
    hub.send(lead, {
      to: '@reviewer',
      text: 'Private review request.',
      delivery: 'quiet',
    })

    await expect(waiting).resolves.toEqual({ timedOut: true, revision: 0, reason: 'timeout' })
  })

  it('releases a waiting member when it disconnects', async () => {
    const { hub, reviewer } = setup()
    const waiting = hub.wait(reviewer, undefined, 1_000)

    hub.disconnectAgent(reviewer.id)

    await expect(waiting).resolves.toMatchObject({ timedOut: false, reason: 'disconnected' })
  })

  it('releases all waiters when the Message service stops', async () => {
    const { hub, reviewer } = setup()
    const waiting = hub.wait(reviewer, undefined, 1_000)

    hub.close()

    await expect(waiting).resolves.toMatchObject({ timedOut: false, reason: 'stopped' })
  })

  it('keeps decentralized Channel task replies visible while waking only mentioned peers', () => {
    const { hub, lead, reviewer, qa } = setup()
    const task = hub.send(lead, {
      to: '#general',
      text: 'Please claim the parser review.',
      delivery: 'quiet',
    })
    hub.send(reviewer, {
      to: '#general',
      text: 'Claimed; the parser review is complete.',
      replyTo: task.messageId,
      mentions: ['@lead'],
      delivery: 'wakeup',
    })

    expect(hub.read(qa, { conversation: '#general' }).messages.at(-1)).toMatchObject({
      from: 'reviewer',
      replyTo: task.messageId,
    })
    expect(lead.followedUp.at(-1)).toContain('parser review is complete')
    expect(qa.followedUp).toHaveLength(0)
  })

  it('opens a Meeting with an attributed agenda and wakes every participant', () => {
    const { hub, lead, reviewer, qa, observer } = setup()
    const meeting = hub.openMeeting(lead, {
      id: 'design-review',
      title: 'Design review',
      agenda: 'Agree on the storage boundary.',
      participants: ['@reviewer', '@qa'],
    })

    expect(meeting).toMatchObject({
      initiator: 'lead',
      participants: ['lead', 'reviewer', 'qa'],
      status: 'open',
    })
    expect(reviewer.followedUp[0]).toContain('Agree on the storage boundary.')
    expect(qa.followedUp[0]).toContain('Agree on the storage boundary.')
    expect(observer.followedUp).toHaveLength(0)
    expect(hub.read(reviewer, { conversation: 'meeting:design-review' }).messages[0]).toMatchObject({
      kind: 'meeting_opened',
      from: 'lead',
    })
  })

  it('injects every quiet Meeting message in full for all other participants', () => {
    const { hub, lead, reviewer, qa, observer } = setup()
    hub.openMeeting(lead, {
      id: 'design-review',
      title: 'Design review',
      agenda: 'Review the design.',
      participants: ['@reviewer', '@qa'],
    })
    hub.send(reviewer, {
      to: 'meeting:design-review',
      text: 'The transaction boundary needs one owner.',
      delivery: 'quiet',
    })

    expect(lead.injected[0]).toContain('The transaction boundary needs one owner.')
    expect(qa.injected[0]).toContain('The transaction boundary needs one owner.')
    expect(qa.injected[0]).not.toContain('Call fleet_inbox')
    expect(observer.injected).toHaveLength(0)
    expect(() => hub.read(observer, { conversation: 'meeting:design-review' })).toThrow('cannot access')
  })

  it('lets only the initiator close a Meeting and rejects later messages', () => {
    const { hub, lead, reviewer } = setup()
    hub.openMeeting(lead, {
      id: 'design-review',
      title: 'Design review',
      agenda: 'Review the design.',
      participants: ['@reviewer'],
    })

    expect(hub.joinMeeting(reviewer, 'design-review').attendance.reviewer).toMatchObject({ joinedAt: expect.any(String) })
    expect(hub.leaveMeeting(reviewer, 'design-review').attendance.reviewer).toMatchObject({ leftAt: expect.any(String) })
    expect(() => hub.closeMeeting(reviewer, 'design-review')).toThrow('only meeting initiator')
    expect(hub.closeMeeting(lead, 'design-review', {
      summary: 'The service boundary is accepted.',
      decisions: ['Keep one durable journal.'],
      actionItems: [{ text: 'Add the recovery test.', assignee: '@reviewer', taskId: 'task_recovery' }],
      resources: ['res_design'],
    })).toMatchObject({
      status: 'closed',
      summary: 'The service boundary is accepted.',
      decisions: ['Keep one durable journal.'],
      actionItems: [{ text: 'Add the recovery test.', assignee: 'reviewer', taskId: 'task_recovery' }],
      resources: ['res_design'],
    })
    expect(reviewer.followedUp.at(-1)).toContain('The meeting has ended.')
    expect(reviewer.followedUp.at(-1)).toContain('Keep one durable journal.')
    expect(hub.pendingWakeups(reviewer.id)).toEqual([])
    expect(hub.read(reviewer, { conversation: 'meeting:design-review' }).messages.at(-1)).toMatchObject({
      kind: 'meeting_closed',
    })
    expect(() => hub.send(reviewer, {
      to: 'meeting:design-review',
      text: 'Too late.',
      delivery: 'quiet',
    })).toThrow('is closed')
  })

  it('keeps a Meeting usable when a participant goes offline', () => {
    const { hub, agents, lead, reviewer, qa } = setup()
    hub.openMeeting(lead, {
      id: 'design-review',
      title: 'Design review',
      agenda: 'Review the design.',
      participants: ['@reviewer', '@qa'],
    })
    agents.delete(qa.id)

    expect(hub.send(reviewer, {
      to: 'meeting:design-review',
      text: 'The review can continue.',
      delivery: 'wakeup',
    })).toMatchObject({ recipients: 2, delivered: 1, woken: 1 })
    expect(lead.followedUp.at(-1)).toContain('The review can continue.')
    expect(hub.closeMeeting(lead, 'design-review')).toMatchObject({ status: 'closed' })
  })

  it('transfers open coordination when a member retires', () => {
    const { hub, lead, reviewer, qa } = setup()
    hub.openMeeting(lead, {
      id: 'handoff',
      title: 'Handoff',
      agenda: 'Transfer current coordination.',
      participants: ['@reviewer', '@qa'],
    })
    const vote = hub.createVote(lead, {
      channel: '#general',
      kind: 'message',
      statement: 'Continue with the reviewed plan.',
      voters: ['@reviewer', '@qa'],
    })
    hub.castVote(reviewer, { id: vote.id, response: 'approve' })

    hub.retireAgent(lead.id, reviewer.id)
    expect(hub.listMeetings(reviewer)).toContainEqual(expect.objectContaining({
      id: 'handoff', initiator: reviewer.id, participants: [reviewer.id, qa.id], status: 'open',
    }))
    hub.retireAgent(qa.id, reviewer.id)
    expect(hub.getVote(reviewer, vote.id)).toMatchObject({
      initiator: reviewer.id, voters: [], approvals: [], status: 'approved',
    })
    expect(hub.listMeetings(reviewer)).toContainEqual(expect.objectContaining({
      id: 'handoff', status: 'closed',
    }))
  })

  it('validates linked action-item tasks when the Team supplies a task resolver', () => {
    const { agents, lead, reviewer } = setup()
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [...agents.keys()],
      list: () => [...agents.values()],
    }, {
      validateTaskReference: (taskId, assignee) => {
        if (taskId !== 'task-review' || assignee !== reviewer.id) throw new Error('invalid linked task')
      },
    })
    hub.openMeeting(lead, {
      id: 'task-review', title: 'Task review', agenda: 'Close with a real task.', participants: ['@reviewer'],
    })
    expect(() => hub.closeMeeting(lead, 'task-review', {
      actionItems: [{ text: 'Review it.', assignee: '@reviewer', taskId: 'missing' }],
    })).toThrow('invalid linked task')
  })
})
