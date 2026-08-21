import { describe, expect, it } from 'vitest'

import { MessageHub } from '../src/hub.js'
import type { AgentDirectory, MessageAgent } from '../src/types.js'

class FakeAgent implements MessageAgent {
  readonly injected: string[] = []
  readonly followedUp: string[] = []

  constructor(readonly id: string) {}

  inject(message: Parameters<MessageAgent['inject']>[0]): void {
    this.injected.push(message.content[0]?.type === 'text' ? message.content[0].text : '')
  }

  followup(message: Parameters<MessageAgent['followup']>[0]): void {
    this.followedUp.push(message.content[0]?.type === 'text' ? message.content[0].text : '')
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

  it('uses followup for direct wakeup messages', () => {
    const { hub, lead, reviewer } = setup()
    hub.send(lead, {
      to: '@reviewer',
      text: 'Continue with the review.',
      delivery: 'wakeup',
    })

    expect(reviewer.followedUp).toHaveLength(1)
    expect(reviewer.injected).toHaveLength(0)
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
    expect(qa.injected[0]).toContain('Call fleet_messages')
    expect(qa.followedUp).toHaveLength(0)
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

    await expect(waiting).resolves.toEqual({ timedOut: false, revision: 1 })
  })

  it('does not miss a message accepted before waiting starts', async () => {
    const { hub, lead, reviewer } = setup()
    const baseline = hub.read(lead, { conversation: '@reviewer' }).revision
    hub.send(reviewer, {
      to: '@lead',
      text: 'Already arrived.',
      delivery: 'quiet',
    })

    await expect(hub.wait(lead, baseline, 1_000)).resolves.toEqual({ timedOut: false, revision: 1 })
  })

  it('does not release an Agent waiter for an unrelated private conversation', async () => {
    const { hub, lead, reviewer, observer } = setup()
    const waiting = hub.wait(observer, undefined, 10)
    hub.send(lead, {
      to: '@reviewer',
      text: 'Private review request.',
      delivery: 'quiet',
    })

    await expect(waiting).resolves.toEqual({ timedOut: true, revision: 0 })
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

    expect(() => hub.closeMeeting(reviewer, 'design-review')).toThrow('only meeting initiator')
    expect(hub.closeMeeting(lead, 'design-review')).toMatchObject({ status: 'closed' })
    expect(reviewer.followedUp.at(-1)).toContain('The meeting has ended.')
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
})
