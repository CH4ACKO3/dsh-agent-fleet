import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FleetMemberView } from '../src/member-view.js'
import type { FleetCoordinationEvent } from '@dsh-agent-fleet/message'
import { FleetAuthorizationService } from '../src/authorization.js'
import { FleetCollaborationService } from '../src/collaboration.js'

const view = (id: string, permissions: string[] = []): FleetMemberView => ({
  id, name: id, role: 'Member', prompt: '',
  toolGroups: ['messages', 'coordination'], permissions,
  contacts: { members: '*', channels: '*' },
})

afterEach(() => { vi.useRealTimers() })

describe('Fleet collaboration identities', () => {
  it('does not turn Team lifecycle control into message interruption authority', () => {
    const authorization = new FleetAuthorizationService()
    const collaboration = new FleetCollaborationService({ on: () => () => {} } as never, authorization)
    const assistant = {
      ...view('assistant', ['message.wakeup', 'team.manage']),
      toolGroups: ['messages', 'status', 'resources'],
    }

    expect(authorization.resolve('team-1', assistant).actions).toContain('message.wakeup')
    expect(authorization.resolve('team-1', assistant).actions).not.toContain('message.interrupt')
    collaboration.close()
  })

  it('keeps assistants out of default votes and lets Calendar open a system-owned Meeting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T00:00:00.000Z'))
    const lead = view('lead', ['vote.create'])
    const reviewer = view('reviewer')
    const assistant = view('assistant')
    const views = new Map([lead, reviewer, assistant].map(member => [member.id, member]))
    const agents = new Map(['lead', 'reviewer', 'assistant'].map(id => [`agent-${id}`, {
      id: `agent-${id}`, inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn(),
    }]))
    const authorization = new FleetAuthorizationService()
    authorization.installBaseline({
      resolveSubject: (_teamId, subject) => views.get(subject.id),
      authorizeResource: () => true,
    })
    const collaboration = new FleetCollaborationService({
      agents: { get: (id: string) => agents.get(id) },
      fs: { contains: () => true },
      on: () => () => {},
    } as never, authorization)
    const team = collaboration.open({
      id: 'team-1', memberViews: [lead, reviewer, assistant], defaultVoters: ['lead', 'reviewer'],
      projectRoot: '/workspace', sharedDirectory: '/workspace/.fleet/team-1',
      onCoordination: () => {}, onResource: () => {}, onMemberStatus: () => {},
    })
    team.attachMember('agent-lead', lead)
    team.attachMember('agent-reviewer', reviewer)
    team.attachMember('agent-assistant', assistant)

    const vote = team.messages.createVote(agents.get('agent-lead') as never, {
      channel: '#general', kind: 'message', statement: 'Proceed.',
    })
    expect(vote.voters).toEqual(['reviewer'])
    expect(() => team.messages.createVote(agents.get('agent-lead') as never, {
      channel: '#general', kind: 'message', statement: 'Ask the assistant to decide.', voters: ['@assistant'],
    })).toThrow('is not eligible to vote')

    const event = team.calendar.create('agent-lead', {
      title: 'Review', agenda: 'Review the work.', attendees: ['reviewer'],
      startAt: '2026-08-21T00:01:00.000Z',
    })
    team.activateProductivity()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(team.calendar.get('agent-lead', event.id).meetingId).toBeDefined()
    expect(team.messages.listMeetings(agents.get('agent-lead') as never)).toHaveLength(1)
    collaboration.close()
  })

  it('restores completed Reply Tasks and the persistent Inbox Task independently', () => {
    const lead = view('lead')
    const reviewer = view('reviewer')
    const views = new Map([lead, reviewer].map(member => [member.id, member]))
    const agents = new Map(['lead', 'reviewer'].map(id => [`agent-${id}`, {
      id: `agent-${id}`, inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn(),
    }]))
    const authorization = new FleetAuthorizationService()
    authorization.installBaseline({
      resolveSubject: (_teamId, subject) => views.get(subject.id),
      authorizeResource: () => true,
    })
    const collaboration = new FleetCollaborationService({
      agents: { get: (id: string) => agents.get(id) },
      fs: { contains: () => true },
      on: () => () => {},
    } as never, authorization)
    const coordination: FleetCoordinationEvent[] = []
    const open = (onCoordination: (event: FleetCoordinationEvent) => void) => collaboration.open({
      id: 'team-required', memberViews: [lead, reviewer], defaultVoters: ['lead', 'reviewer'],
      projectRoot: '/workspace', sharedDirectory: '/workspace/.fleet/team-required',
      onCoordination, onResource: () => {}, onMemberStatus: () => {},
    })
    const first = open(event => { coordination.push(event) })
    first.attachMember('agent-lead', lead)
    first.attachMember('agent-reviewer', reviewer)
    const sent = first.messages.send(agents.get('agent-lead') as never, {
      to: '#general', text: '@reviewer inspect the release.', mentions: ['@reviewer'], delivery: 'quiet',
    })
    const required = first.tasks.pendingReply('reviewer')
    if (required === undefined) throw new Error('expected required task')
    const delivered = first.messages.reply(agents.get('agent-reviewer') as never, {
      messageId: sent.messageId, text: '@lead Release inspection complete.',
    })
    expect(first.messages.getMessage(agents.get('agent-lead') as never, delivered.messageId)).toMatchObject({
      kind: 'reply', recipientIds: ['lead'], mentions: [], replyTo: sent.messageId,
    })
    expect(first.tasks.pendingReply('lead')).toBeUndefined()
    const completed = first.tasks.recordReply('agent-reviewer', required.id, delivered.messageId)
    expect(completed.domain).toMatchObject({ kind: 'reply', completionMessageId: delivered.messageId })
    const taskState = first.tasks.state()
    expect(first.tasks.pendingReply('reviewer')).toBeUndefined()

    collaboration.closeTeam('team-required')
    const restored = open(() => {})
    restored.restoreProductivity({
      tasks: taskState,
      schedules: { version: 1, schedules: [] },
      calendar: { version: 1, events: [] },
    })
    restored.attachMember('agent-lead', lead)
    restored.attachMember('agent-reviewer', reviewer)
    restored.restore({ coordination, resources: [], memberStatuses: [] })
    expect(restored.tasks.pendingReply('reviewer')).toBeUndefined()
    expect(restored.tasks.state().tasks).toContainEqual(expect.objectContaining({
      id: required.id, stableState: expect.objectContaining({ kind: 'completed' }),
      domain: expect.objectContaining({ kind: 'reply', messageId: sent.messageId, completionMessageId: delivered.messageId }),
    }))
    expect(restored.tasks.state().tasks).toContainEqual(expect.objectContaining({
      domain: expect.objectContaining({ kind: 'inbox', owner: 'reviewer', unreadMessages: 0 }),
      stableState: expect.objectContaining({ kind: 'dormant' }),
    }))
    collaboration.close()
  })

  it('returns a successful terminal instruction after a formal member replies', async () => {
    const reviewer = view('reviewer')
    const agent = {
      id: 'agent-reviewer', inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn(),
    }
    const authorization = new FleetAuthorizationService()
    authorization.installBaseline({
      resolveSubject: (_teamId, subject) => subject.id === reviewer.id ? reviewer : undefined,
      authorizeResource: () => true,
    })
    const collaboration = new FleetCollaborationService({
      agents: { get: (id: string) => id === agent.id ? agent : undefined },
      fs: { contains: () => true },
      on: () => () => {},
    } as never, authorization)
    const team = collaboration.open({
      id: 'team-reply-result', memberViews: [reviewer], defaultVoters: [reviewer.id],
      projectRoot: '/workspace', sharedDirectory: '/workspace/.fleet/team-reply-result',
      onCoordination: () => {}, onResource: () => {}, onMemberStatus: () => {},
    })
    team.attachMember(agent.id, reviewer)
    const registered: Array<{
      readonly name: string
      execute(args: unknown, context: unknown): Promise<unknown>
    }> = []
    team.installTools({
      tools: {
        register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} },
        restrict: () => () => {},
        guard: () => () => {},
        get: () => undefined,
      },
    } as never, reviewer.id)
    const reply = registered.find(candidate => candidate.name === 'fleet_reply')
    if (reply === undefined) throw new Error('expected fleet_reply to be installed')
    team.sendUserMessage({
      to: '@reviewer', text: 'Please review this.', mentions: ['@reviewer'], delivery: 'quiet',
    })

    await expect(reply.execute({ content: 'Review complete.' }, { agent })).resolves.toMatchObject({
      action: 'reply',
      replayed: false,
      sourceMessageId: 'msg_1',
      instruction: expect.stringContaining('continue it now'),
      task: { stableState: { kind: 'completed' } },
    })
    expect(agent.cancel).not.toHaveBeenCalled()
    collaboration.close()
  })
})
