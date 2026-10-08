import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FleetMemberView } from '../src/member-view.js'
import type { FleetCoordinationEvent } from '@dsh-agent-fleet/message'
import { FleetAuthorizationService } from '../src/authorization.js'
import { FleetCollaborationService } from '../src/collaboration.js'
import { NOOP_FLEET_TEAM_EVENT_BUS } from '../src/team-event-bus.js'

const view = (id: string, permissions: string[] = []): FleetMemberView => ({
  id, name: id, role: 'Member', prompt: '',
  toolGroups: ['messages', 'coordination'], permissions,
  contacts: { members: '*', channels: '*' },
})

afterEach(() => { vi.useRealTimers() })


function setupReplies() {
  const participants = ['lead', 'reviewer', 'qa'].map(id => view(id))
  const agents = new Map(participants.map(v => [v.id, {
    id: `agent-${v.id}`, inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn(),
  }]))
  const authorization = new FleetAuthorizationService()
  authorization.installBaseline({ resolveSubject: (_, subject) => participants.find(v => v.id === subject.id), authorizeResource: () => true })
  const collaboration = new FleetCollaborationService({
    agents: { get: (id: string) => [...agents.values()].find(agent => agent.id === id) },
    fs: { contains: () => true }, on: () => () => {},
  } as never, authorization)
  const coordination: FleetCoordinationEvent[] = []
  const open = () => {
    const team = collaboration.open({ id: 'review', memberViews: participants, defaultVoters: participants.map(v => v.id),
      projectRoot: '/workspace', sharedDirectory: '/workspace/.fleet/review',
      eventBus: { ...NOOP_FLEET_TEAM_EVENT_BUS, onCoordination: event => coordination.push(event) },
    })
    for (const v of participants) team.attachMember(agents.get(v.id)!.id, v)
    return team
  }
  const team = open()
  const registered: Array<{ name: string; execute(args: unknown, context: unknown): Promise<unknown> }> = []
  team.installTools({ tools: { register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} },
    restrict: () => () => {}, guard: () => () => {}, get: () => undefined,
  } } as never, 'reviewer')
  const reply = registered.find(tool => tool.name === 'fleet_reply')!
  const send = () => team.messages.send(agents.get('lead') as never, {
    to: '@reviewer', text: '@reviewer request A', delivery: 'quiet',
  })
  return { team, agents, reply, send, coordination, collaboration, open }
}

describe('durable reply protocol', () => {
  it('rejects an incorrect explicit task id without consuming another pending reply', async () => {
    const f = setupReplies()
    try {
      f.send()
      await expect(async () => f.reply.execute({ id: 'wrong-task', content: 'Answer B' }, { agent: f.agents.get('reviewer') })).rejects.toThrow()
      expect(f.team.tasks.pendingReply('reviewer')).toBeDefined()
      expect(f.team.messages.messageHistory().filter(message => message.kind === 'reply')).toEqual([])
      const receipt = await f.reply.execute({ content: 'Answer A' }, { agent: f.agents.get('reviewer') }) as { task: { id: string } }
      await expect(f.reply.execute({ id: receipt.task.id, content: 'retry' }, { agent: f.agents.get('reviewer') })).resolves.toMatchObject({ replayed: true })
      expect(f.team.messages.messageHistory().filter(message => message.kind === 'reply')).toHaveLength(1)
      expect(() => f.team.replies.resolve('agent-qa', receipt.task.id)).toThrow('not owned')
    } finally { f.collaboration.close() }
  })
  it('transfers only the source message needed by an inherited private reply, including after replay', () => {
    const f = setupReplies()
    try {
      const privateMessage = f.team.messages.send(f.agents.get('lead') as never, { to: '@reviewer', text: 'Unrelated private history', delivery: 'quiet' })
      const sent = f.send()
      const taskState = f.team.tasks.state()
      f.team.retireMember({ agentId: 'agent-reviewer', member: 'reviewer', successorAgentId: 'agent-qa', successor: 'qa' })
      expect(f.team.tasks.pendingReply('qa')).toBeDefined()
      const coordination = structuredClone(f.coordination)
      f.collaboration.closeTeam('review')
      const restored = f.open()
      restored.restoreProductivity({ tasks: taskState, schedules: { version: 1, schedules: [] }, calendar: { version: 1, events: [] } })
      restored.restore({ coordination, resources: [], memberStatuses: [] })
      expect(() => restored.messages.getMessage(f.agents.get('qa') as never, privateMessage.messageId)).toThrow('cannot access')
      const task = restored.tasks.pendingReply('qa')!
      expect(task).toBeDefined()
      restored.updateMemberView({ ...view('qa'), contacts: { members: [], channels: [] } })
      const result = restored.replies.answer(f.agents.get('qa') as never, { id: task.id, content: 'Handled by successor' })
      expect(() => restored.messages.send(f.agents.get('qa') as never, { to: '@lead', text: 'Unrelated contact', delivery: 'quiet' })).toThrow('cannot contact')
      expect(result.sourceMessageId).toBe(sent.messageId)
      expect(restored.tasks.pendingReply('qa')).toBeUndefined()
    } finally { f.collaboration.close() }
  })
  it.each([false, true])('reconciles stale snapshots from message receipts (already answered=%s)', answered => {
    const f = setupReplies()
    try {
      const before = f.team.tasks.state()
      const sent = f.send()
      if (answered) f.team.messages.reply(f.agents.get('reviewer') as never, { messageId: sent.messageId, text: 'Done' })
      const coordination = structuredClone(f.coordination)
      f.collaboration.closeTeam('review')
      const restored = f.open()
      restored.restoreProductivity({ tasks: before, schedules: { version: 1, schedules: [] }, calendar: { version: 1, events: [] } })
      restored.restore({ coordination, resources: [], memberStatuses: [] })
      const tasks = restored.tasks.state().tasks.filter(task => task.domain.kind === 'reply')
      expect(tasks).toHaveLength(1)
      expect(tasks[0]?.stableState.kind).toBe(answered ? 'completed' : 'running')
      restored.restore({ coordination, resources: [], memberStatuses: [] })
      expect(restored.tasks.state().tasks.filter(task => task.domain.kind === 'reply')).toHaveLength(1)
    } finally { f.collaboration.close() }
  })

  it('correlates native and explicit replies to exact external ingress contexts', () => {
    const f = setupReplies()
    try {
      const agent = f.agents.get('reviewer')!
      const route = { connector: 'lark', conversationId: 'room-A', externalUserId: 'user', messageId: 'external-A' }
      const first = f.team.sendUserMessage({ to: '@reviewer', text: 'Request A', delivery: 'quiet' }, route)
      const contextA = (agent.inject.mock.calls.at(-1) as unknown as [{ id: string }])[0]
      const second = f.team.sendUserMessage({ to: '@reviewer', text: 'Request B', delivery: 'quiet' }, { ...route, conversationId: 'room-B', messageId: 'external-B' })
      f.team.messages.commitExternalOutput('reviewer', contextA.id, 'Native A')
      f.team.messages.commitExternalOutput('reviewer', contextA.id, 'Repeated A')
      const reply = f.team.messages.reply(agent as never, { messageId: second.messageId, text: 'Explicit B' })
      f.team.messages.send(agent as never, { to: '@fleet-user:review', text: 'Follow-up B', replyTo: reply.messageId, delivery: 'quiet' })
      f.team.sendUserMessage({ to: '@reviewer', text: 'Local UI input', delivery: 'quiet' })
      const local = (agent.inject.mock.calls.at(-1) as unknown as [{ id: string }])[0]
      f.team.messages.commitExternalOutput('reviewer', local.id, 'Local UI result')
      expect(f.team.messages.pendingExternalReplies().map(message => [message.text, message.external?.conversationId])).toEqual([
        ['Native A', 'room-A'], ['Explicit B', 'room-B'], ['Follow-up B', 'room-B'],
      ])
      expect(f.team.messages.pendingExternalReplies()[0]?.replyTo).toBe(first.messageId)
    } finally { f.collaboration.close() }
  })

  it('withdraws an obligation returned to the original requester instead of making them reply to themselves', () => {
    const f = setupReplies()
    try {
      f.send()
      f.team.retireMember({ agentId: 'agent-reviewer', member: 'reviewer', successorAgentId: 'agent-lead', successor: 'lead' })
      const task = f.team.tasks.state().tasks.find(task => task.domain.kind === 'reply')!
      expect(task.stableState.kind).toBe('cancelled')
      expect(f.team.tasks.pendingReply('lead')).toBeUndefined()
      const coordination = structuredClone(f.coordination)
      f.team.restore({ coordination, resources: [], memberStatuses: [] })
      expect(f.team.tasks.pendingReply('lead')).toBeUndefined()
    } finally { f.collaboration.close() }
  })

  it('keeps independent channel reply ownership while handing off and handing back', () => {
    const f = setupReplies()
    try {
      const sent = f.team.messages.send(f.agents.get('lead') as never, { to: '#general', text: '@reviewer @qa review', delivery: 'quiet' })
      f.team.messages.handoffReply(sent.messageId, 'reviewer', 'qa')
      expect(f.team.tasks.ownerTasks('qa').filter(task => task.domain.kind === 'reply')).toHaveLength(1)
      f.team.messages.handoffReply(sent.messageId, 'qa', 'reviewer')
      expect(f.team.messages.replyAssignee(sent.messageId, 'reviewer')).toBe('reviewer')
      expect(f.team.messages.replyAssignee(sent.messageId, 'qa')).toBe('reviewer')
      const coordination = structuredClone(f.coordination)
      f.team.restore({ coordination, resources: [], memberStatuses: [] })
      expect(f.team.messages.replyAssignee(sent.messageId, 'qa')).toBe('reviewer')
    } finally { f.collaboration.close() }
  })


  it('retains unanswered sources and unacknowledged external responses beyond the history limit', () => {
    const f = setupReplies()
    try {
      const obligation = f.send()
      const external = { connector: 'lark', conversationId: 'room', externalUserId: 'user', messageId: 'external-pending' }
      const incoming = f.team.sendUserMessage({ to: '@reviewer', text: 'Request', delivery: 'quiet' }, external)
      const response = f.team.messages.reply(f.agents.get('reviewer') as never, { messageId: incoming.messageId, text: 'Reply waiting for connector' })
      for (let index = 0; index < 1_005; index++) f.team.messages.send(f.agents.get('lead') as never, { to: '@reviewer', text: `FYI ${index}`, delivery: 'quiet' })
      expect(f.team.messages.getMessage(f.agents.get('reviewer') as never, obligation.messageId).id).toBe(obligation.messageId)
      expect(f.team.messages.pendingExternalReplies()).toMatchObject([{ id: response.messageId }])
    } finally { f.collaboration.close() }
  })

  it('persists external provenance, deduplicates ingress across replay, and retains an outbox receipt', () => {
    const f = setupReplies()
    try {
      const external = { connector: 'lark', conversationId: 'room-A', externalUserId: 'user', messageId: 'external-1' }
      const input = { to: '@reviewer' as const, text: 'Request', delivery: 'quiet' as const }
      const sent = f.team.sendUserMessage(input, external)
      const reply = f.team.messages.reply(f.agents.get('reviewer') as never, { messageId: sent.messageId, text: 'Result' })
      expect(f.team.messages.pendingExternalReplies()).toMatchObject([{ id: reply.messageId, external }])
      const events = structuredClone(f.coordination)
      f.collaboration.closeTeam('review')
      const restored = f.open()
      restored.restore({ coordination: events, resources: [], memberStatuses: [] })
      expect(restored.sendUserMessage(input, external).messageId).toBe(sent.messageId)
      expect(restored.messages.pendingExternalReplies()).toHaveLength(1)
      restored.messages.acknowledgeExternalReply(reply.messageId)
      const acknowledged = structuredClone(f.coordination)
      restored.restore({ coordination: acknowledged, resources: [], memberStatuses: [] })
      expect(restored.messages.pendingExternalReplies()).toEqual([])
    } finally { f.collaboration.close() }
  })
})
