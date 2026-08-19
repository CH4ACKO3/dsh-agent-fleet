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
  return { hub: new MessageHub(directory), lead, reviewer, qa, observer }
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
    const waiting = hub.wait(undefined, 1_000)
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

    await expect(hub.wait(baseline, 1_000)).resolves.toEqual({ timedOut: false, revision: 1 })
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
})
