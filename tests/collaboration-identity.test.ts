import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FleetMemberView } from '../src/member-view.js'
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
    expect(vote.voters).toEqual(['agent-reviewer'])
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
})
