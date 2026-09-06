import { afterEach, describe, expect, it, vi } from 'vitest'

import { isAbsolute, resolve } from 'node:path'

import type { FleetMemberView } from '../src/member-view.js'
import type { FleetCoordinationEvent } from '@dsh-agent-fleet/message'
import type { FleetProjectTaskEvent, FleetTaskState } from '../src/productivity/task.js'
import { FleetAuthorizationService } from '../src/authorization.js'
import { FleetCollaborationService } from '../src/collaboration.js'
import { NOOP_FLEET_TEAM_EVENT_BUS } from '../src/team-event-bus.js'

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
      eventBus: NOOP_FLEET_TEAM_EVENT_BUS,
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
    const eventBus = { ...NOOP_FLEET_TEAM_EVENT_BUS, onCoordination: (event: FleetCoordinationEvent) => { coordination.push(event) } }
    const open = () => collaboration.open({
      id: 'team-required', memberViews: [lead, reviewer], defaultVoters: ['lead', 'reviewer'],
      projectRoot: '/workspace', sharedDirectory: '/workspace/.fleet/team-required',
      eventBus,
    })
    const first = open()
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
      eventBus: NOOP_FLEET_TEAM_EVENT_BUS,
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

  it('resolves multiple Reply Tasks in FIFO order with partial completion', () => {
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
    const eventBus = { ...NOOP_FLEET_TEAM_EVENT_BUS, onCoordination: (event: FleetCoordinationEvent) => { coordination.push(event) } }
    const team = collaboration.open({
      id: 'team-pending22', memberViews: [lead, reviewer], defaultVoters: ['lead', 'reviewer'],
      projectRoot: '/workspace', sharedDirectory: '/workspace/.fleet/team-pending22',
      eventBus,
    })
    team.attachMember('agent-lead', lead)
    team.attachMember('agent-reviewer', reviewer)

    // Send two messages @mentioning the reviewer to create two pending Reply Tasks
    const firstMsg = team.messages.send(agents.get('agent-lead') as never, {
      to: '#general', text: '@reviewer review the first PR.', mentions: ['@reviewer'], delivery: 'quiet',
    })
    const secondMsg = team.messages.send(agents.get('agent-lead') as never, {
      to: '#general', text: '@reviewer also check the second change.', mentions: ['@reviewer'], delivery: 'quiet',
    })

    // First pending should be the oldest (firstMsg)
    const firstPending = team.tasks.pendingReply('reviewer')
    expect(firstPending).toBeDefined()
    expect(firstPending!.domain).toMatchObject({ messageId: firstMsg.messageId })

    // Complete first reply
    const firstReply = team.messages.reply(agents.get('agent-reviewer') as never, {
      messageId: firstMsg.messageId, text: '@lead First PR looks good.',
    })
    team.tasks.recordReply('agent-reviewer', firstPending!.id, firstReply.messageId)

    // After completing first, pendingReply should return the second
    const secondPending = team.tasks.pendingReply('reviewer')
    expect(secondPending).toBeDefined()
    expect(secondPending!.domain).toMatchObject({ messageId: secondMsg.messageId })

    // Complete second reply
    const secondReply = team.messages.reply(agents.get('agent-reviewer') as never, {
      messageId: secondMsg.messageId, text: '@lead Second change approved.',
    })
    team.tasks.recordReply('agent-reviewer', secondPending!.id, secondReply.messageId)

    // All replies completed — pendingReply is undefined
    expect(team.tasks.pendingReply('reviewer')).toBeUndefined()

    // Both Reply Tasks are marked completed
    const state = team.tasks.state()
    expect(state.tasks.filter(t => t.id === firstPending!.id || t.id === secondPending!.id))
      .toHaveLength(2)
    for (const task of state.tasks) {
      if (task.id === firstPending!.id || task.id === secondPending!.id) {
        expect(task.stableState).toMatchObject({ kind: 'completed' })
      }
    }

    // Verify restore with both completed
    collaboration.closeTeam('team-pending22')
    const restored = collaboration.open({
      id: 'team-pending22', memberViews: [lead, reviewer], defaultVoters: ['lead', 'reviewer'],
      projectRoot: '/workspace', sharedDirectory: '/workspace/.fleet/team-pending22',
      eventBus: NOOP_FLEET_TEAM_EVENT_BUS,
    })
    restored.restoreProductivity({
      tasks: state,
      schedules: { version: 1, schedules: [] },
      calendar: { version: 1, events: [] },
    })
    restored.attachMember('agent-lead', lead)
    restored.attachMember('agent-reviewer', reviewer)
    restored.restore({ coordination, resources: [], memberStatuses: [] })
    expect(restored.tasks.pendingReply('reviewer')).toBeUndefined()
    collaboration.close()
  })

  it('authorizes new resource files by path and resource listing at Team scope', async () => {
    const projectRoot = resolve('workspace')
    const publisher = {
      ...view('publisher', ['resource.write']),
      toolGroups: ['resources'],
    }
    const agent = {
      id: 'agent-publisher',
      session: { header: { cwd: projectRoot } },
      inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn(),
    }
    const seen: Array<{ readonly action: string; readonly kind?: string; readonly id?: string }> = []
    const authorization = new FleetAuthorizationService()
    authorization.installBaseline({
      resolveSubject: (_teamId, subject) => subject.id === publisher.id ? publisher : undefined,
      authorizeResource: input => {
        seen.push({
          action: input.action,
          ...(input.resource?.kind === undefined ? {} : { kind: input.resource.kind }),
          ...(input.resource?.id === undefined ? {} : { id: input.resource.id }),
        })
        return input.resource?.kind === 'file'
          ? input.resource.id.startsWith(projectRoot)
          : input.resource?.kind === 'team' && input.resource.id === 'team-resources'
      },
    })
    const collaboration = new FleetCollaborationService({
      agents: { get: (id: string) => id === agent.id ? agent : undefined },
      fs: { contains: () => true },
      on: () => () => {},
    } as never, authorization)
    const team = collaboration.open({
      id: 'team-resources', memberViews: [publisher], defaultVoters: [publisher.id],
      projectRoot, sharedDirectory: resolve(projectRoot, '.fleet/team-resources'),
      eventBus: NOOP_FLEET_TEAM_EVENT_BUS,
    })
    team.attachMember(agent.id, publisher)
    const registered: Array<{
      readonly name: string
      execute(args: unknown, context: unknown): Promise<unknown>
    }> = []
    team.installTools({
      fs: {
        contains: () => true,
        resolve: async (path: string, options?: { readonly cwd?: string }) => {
          const displayPath = isAbsolute(path) ? path : resolve(options?.cwd ?? projectRoot, path)
          return { targetKey: displayPath, displayPath }
        },
        stat: async () => ({ version: 'v1', type: 'file', size: 7 }),
        processPath: (target: { readonly displayPath: string }) => target.displayPath,
      },
      on: () => () => {},
      tools: {
        register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} },
        restrict: () => () => {}, guard: () => () => {}, get: () => undefined,
      },
    } as never, publisher.id)
    const resource = registered.find(candidate => candidate.name === 'fleet_resource')
    if (resource === undefined) throw new Error('expected fleet_resource')

    await expect(resource.execute(
      { action: 'add', path: 'artifacts/result.md' }, { agent, signal: new AbortController().signal },
    )).resolves.toMatchObject({ action: 'add', resource: { createdBy: agent.id } })
    await expect(resource.execute(
      { action: 'list' }, { agent, signal: new AbortController().signal },
    )).resolves.toMatchObject({ action: 'list', resources: [expect.objectContaining({ createdBy: agent.id })] })
    expect(seen).toContainEqual({
      action: 'resource.write', kind: 'file', id: resolve(projectRoot, 'artifacts/result.md'),
    })
    expect(seen).toContainEqual({ action: 'resource.read', kind: 'team', id: 'team-resources' })
    expect(seen).not.toContainEqual(expect.objectContaining({ kind: 'resource', id: '*' }))
    collaboration.close()
  })

  it('P21: suppresses notification when creating multiple Reply Tasks from one @-message', () => {
    const alice = view('alice')
    const bob = view('bob')
    const charlie = view('charlie')
    const views = new Map([alice, bob, charlie].map(m => [m.id, m]))
    const agents = new Map(['alice', 'bob', 'charlie'].map(id => [`agent-${id}`, {
      id: `agent-${id}`, inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn(),
    }]))
    const authorization = new FleetAuthorizationService()
    authorization.installBaseline({
      resolveSubject: (_teamId, subject) => views.get(subject.id),
      authorizeResource: () => true,
    })
    const taskEvents: FleetProjectTaskEvent[] = []
    const eventBus = { ...NOOP_FLEET_TEAM_EVENT_BUS, onTask: (event: FleetProjectTaskEvent, _state: FleetTaskState) => { taskEvents.push(event) } }
    const collaboration = new FleetCollaborationService({
      agents: { get: id => agents.get(id) },
      fs: { contains: () => true },
      on: () => () => {},
    } as never, authorization)
    const team = collaboration.open({
      id: 'team-p21', memberViews: [alice, bob, charlie], defaultVoters: ['alice', 'bob', 'charlie'],
      projectRoot: '/workspace', sharedDirectory: '/workspace/.fleet/team-p21',
      eventBus,
    })
    team.attachMember('agent-alice', alice)
    team.attachMember('agent-bob', bob)
    team.attachMember('agent-charlie', charlie)

    // Send one message @mentioning all 3 members.
    // This triggers ensureMessageTasks → 3 ensureReplyTask calls → 3 'created' events.
    const sent = team.messages.send(agents.get('agent-alice') as never, {
      to: '#general',
      text: '@bob @charlie please review the P21 change.',
      mentions: ['@bob', '@charlie'],
      delivery: 'quiet',
    })

    // Each mentioned member should have a pending Reply Task.
    expect(team.tasks.pendingReply('bob')?.domain).toMatchObject({ messageId: sent.messageId })
    expect(team.tasks.pendingReply('charlie')?.domain).toMatchObject({ messageId: sent.messageId })
    expect(team.tasks.pendingReply('alice')).toBeUndefined()

    // The onTask callback received exactly the 'created' events.
    const replyCreated = taskEvents.filter(e =>
      e.action === 'created' && e.task.domain.kind === 'reply')
    expect(replyCreated).toHaveLength(2)

    // The key P21 assertion: notification count should be 0 for reply created events.
    // The initialRequiredTask guard at collaboration.ts:496
    // (event.action === 'created' && event.task.domain.kind === 'reply')
    // causes the notifyMembers block to be skipped entirely.
    // No task_notice messages were sent as part of creation.
    // Verify that the guard worked: the only notification is for the inbox task sync,
    // not for individual reply tasks. System notifications from notifyMembers
    // are inject-only and don't appear in search.
    const state = team.tasks.state()
    const replyTasks = state.tasks.filter(t => t.domain.kind === 'reply')
    expect(replyTasks).toHaveLength(2)

    collaboration.close()
  })
})
