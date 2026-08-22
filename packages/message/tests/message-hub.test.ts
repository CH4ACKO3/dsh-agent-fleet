import { describe, expect, it } from 'vitest'

import { MessageHub } from '../src/hub.js'
import { installMessageTools } from '../src/index.js'
import type { AgentDirectory, MessageAgent } from '../src/types.js'

class FakeAgent implements MessageAgent {
  private readonly injectedMessages: Parameters<MessageAgent['inject']>[0][] = []
  private readonly pendingMessages: Parameters<MessageAgent['inject']>[0][] = []
  readonly followedUp: string[] = []
  readonly steered: string[] = []
  readonly cancellations: Array<{ readonly kind: 'user' | 'parent'; readonly keepInbox?: boolean }> = []
  readonly inbox: NonNullable<MessageAgent['inbox']>

  constructor(readonly id: string) {
    const pending = this.pendingMessages
    const injected = this.injectedMessages
    this.inbox = {
      get nextTurn() { return [] },
      get nextStep() { return pending },
      replace(messageId, newMessage) {
        const pendingIndex = pending.findIndex(message => message.id === messageId)
        if (pendingIndex < 0) return false
        pending[pendingIndex] = newMessage
        const injectedIndex = injected.findIndex(message => message.id === messageId)
        if (injectedIndex >= 0) injected[injectedIndex] = newMessage
        return true
      },
      remove(messageId) {
        const pendingIndex = pending.findIndex(message => message.id === messageId)
        if (pendingIndex < 0) return false
        pending.splice(pendingIndex, 1)
        return true
      },
    }
  }

  get injected(): string[] {
    return this.injectedMessages.map(message => message.content[0]?.type === 'text' ? message.content[0].text : '')
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
    list: () => [...agents.values()],
  }
  return { hub: new MessageHub(directory), agents, lead, reviewer, qa, observer }
}

describe('MessageHub', () => {
  it('sends quiet direct messages through inject and keeps readable history', () => {
    const { hub, lead, reviewer } = setup()
    const sent = hub.send(lead, {
      to: '@reviewer',
      text: 'Please inspect the parser.',
      resources: ['res_parser'],
      delivery: 'quiet',
    })

    expect(sent).toMatchObject({ recipients: 1, woken: 0 })
    expect(reviewer.injected).toHaveLength(1)
    expect(reviewer.followedUp).toHaveLength(0)
    expect(reviewer.injected[0]).toContain('Please inspect the parser.')
    expect(hub.read(reviewer, { conversation: '@lead' }).messages[0]).toMatchObject({
      id: sent.messageId,
      from: 'lead',
      resources: ['res_parser'],
    })
  })

  it('records read receipts only after an explicit read or a response to a full delivery', () => {
    const { hub, lead, reviewer, qa } = setup()
    const events: Parameters<MessageHub['restore']>[0][number][] = []
    hub.onEvent(event => { events.push(event) })

    const direct = hub.send(lead, {
      to: '@reviewer',
      text: 'Please confirm the interface boundary.',
      delivery: 'quiet',
    })
    expect(events).toContainEqual({
      type: 'inbox',
      action: 'delivered',
      agentId: reviewer.id,
      messageId: direct.messageId,
      contextMessageId: reviewer.inbox.nextStep[0]?.id,
    })
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'inbox', action: 'acknowledged', agentId: reviewer.id, messageId: direct.messageId,
    }))
    const restored = setup()
    restored.hub.restore(events)
    expect(restored.hub.inbox(restored.reviewer)).toContainEqual(expect.objectContaining({
      acknowledged: false,
      message: expect.objectContaining({ id: direct.messageId }),
    }))

    hub.send(reviewer, {
      to: '@lead',
      text: 'Confirmed.',
      delivery: 'quiet',
    })
    expect(events).toContainEqual({
      type: 'inbox', action: 'acknowledged', agentId: reviewer.id, messageId: direct.messageId,
    })

    const channel = hub.send(lead, {
      to: '#general',
      text: 'General progress update.',
      delivery: 'quiet',
    })
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'inbox', action: 'acknowledged', agentId: qa.id, messageId: channel.messageId,
    }))
    hub.read(qa, { conversation: '#general' })
    expect(events).toContainEqual({
      type: 'inbox', action: 'acknowledged', agentId: qa.id, messageId: channel.messageId,
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
    first.hub.acknowledge(first.reviewer, oldest.messageId)

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

  it('tolerates mentioning the recipient in a direct message without giving it extra effect', () => {
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
      mentions: [],
    })

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

  it('interrupts only explicitly mentioned Channel members', () => {
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
    expect(qa.injected[0]).toContain('Unread channel activity')
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

  it('wakes only mentioned Channel members and sends notices to the rest', () => {
    const { hub, lead, reviewer, qa } = setup()
    hub.send(lead, {
      to: '#general',
      text: 'Reviewer, please check this now.',
      mentions: ['@reviewer'],
      delivery: 'wakeup',
    })

    expect(reviewer.followedUp[0]).toContain('please check this now')
    expect(qa.injected[0]).toContain('Unread channel activity')
    expect(qa.followedUp).toHaveLength(0)
  })

  it('coalesces unread Channel activity into one mutable pending snapshot', () => {
    const { hub, lead, reviewer, qa } = setup()
    hub.send(lead, {
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

  it('keeps a pending Channel snapshot while a paged read has more messages', () => {
    const { hub, lead, reviewer } = setup()
    const first = hub.send(lead, { to: '#general', text: 'First update.', delivery: 'quiet' })
    hub.send(lead, { to: '#general', text: 'Second update.', delivery: 'quiet' })
    hub.send(lead, { to: '#general', text: 'Third update.', delivery: 'quiet' })

    expect(hub.read(reviewer, {
      conversation: '#general',
      after: first.messageId,
      limit: 1,
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
    expect(first.hub.acknowledge(first.reviewer, sent.messageId).acknowledged).toBe(true)
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

  it('renders common Vote results without repeating statements or member ids', () => {
    const { hub, lead, reviewer } = setup()
    const registered: Array<{
      readonly name: string
      readonly output: { render(args: unknown, value: unknown): readonly { readonly type: string; readonly text?: string }[] }
    }> = []
    installMessageTools({
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool) } },
    } as never, hub, { messages: false })
    const tool = registered.find(candidate => candidate.name === 'fleet_vote')
    const vote = hub.createVote(lead, {
      channel: '#general',
      kind: 'message',
      statement: 'A proposal that is already present in the tool call and should not be echoed.',
      voters: ['@reviewer'],
    })

    const text = tool?.output.render({}, { action: 'create', vote })[0]?.text ?? ''
    expect(text).toBe('{"id":"vote_1","channel":"#general","kind":"message","status":"open","approvals":"0/1"}')
    expect(text).not.toContain(vote.statement)
    expect(text).not.toContain(lead.id)
    expect(text).not.toContain(reviewer.id)
  })

  it('previews long messages and reads the remaining text in bounded chunks', () => {
    const { hub, lead, reviewer } = setup()
    const longText = 'a'.repeat(5_000)
    const sent = hub.send(lead, { to: '@reviewer', text: longText, delivery: 'quiet' })
    const page = hub.read(reviewer, { conversation: '@lead' })
    const registered: Array<{
      readonly name: string
      readonly output: { render(args: unknown, value: unknown): readonly { readonly type: string; readonly text?: string }[] }
    }> = []
    installMessageTools({
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool) } },
    } as never, hub, { coordination: false })
    const rendered = registered.find(candidate => candidate.name === 'fleet_messages')
      ?.output.render({ action: 'read' }, page)[0]?.text ?? ''

    expect(rendered).toContain('"text_more":{"action":"text","message_id":"msg_1","offset":2000,"total_length":5000}')
    expect(rendered.length).toBeLessThan(3_000)
    expect(hub.readMessageText(reviewer, sent.messageId, 2_000, 2_000)).toEqual({
      messageId: sent.messageId,
      offset: 2_000,
      text: 'a'.repeat(2_000),
      totalLength: 5_000,
      hasMore: true,
      nextOffset: 4_000,
    })
    expect(hub.readMessageText(reviewer, sent.messageId, 4_000, 2_000)).toEqual({
      messageId: sent.messageId,
      offset: 4_000,
      text: 'a'.repeat(1_000),
      totalLength: 5_000,
      hasMore: false,
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

  it('rebinds private coordination and pending messages to a replacement Session', () => {
    const { hub, agents, lead, reviewer } = setup()
    const replacement = new FakeAgent('reviewer-replacement')
    agents.set(replacement.id, replacement)
    hub.createChannel(lead, { name: 'review-room', members: ['@reviewer'] })
    hub.openMeeting(lead, {
      id: 'review', title: 'Review', agenda: 'Review the work.', participants: ['@reviewer'],
    })
    const vote = hub.createVote(lead, {
      channel: '#review-room', kind: 'message', statement: 'Accept the result.', voters: ['@reviewer'],
    })
    const sent = hub.send(lead, {
      to: '@reviewer', text: 'Continue this review.', delivery: 'wakeup',
    })

    hub.rebindAgent(reviewer.id, replacement.id)

    expect(hub.listChannels(replacement).map(channel => channel.id)).toContain('review-room')
    expect(hub.listMeetings(replacement)).toContainEqual(expect.objectContaining({
      id: 'review', participants: ['lead', replacement.id],
    }))
    expect(hub.getVote(replacement, vote.id)).toMatchObject({ voters: [replacement.id] })
    expect(hub.pendingWakeups(replacement.id)).toContainEqual(expect.objectContaining({ id: sent.messageId }))
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
    expect(qa.injected[0]).not.toContain('Call fleet_messages')
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
    })).toMatchObject({ recipients: 1, woken: 1 })
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
    const hub = new MessageHub({ get: id => agents.get(id), list: () => [...agents.values()] }, {
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
