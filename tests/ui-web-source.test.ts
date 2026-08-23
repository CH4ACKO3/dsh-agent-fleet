import { describe, expect, it } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { FleetWebClient } from '@dsh-agent-fleet/core/web'
import { createFleetWebPanelSource } from '../packages/ui/src/fleet-web-source.js'

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: ((value: T) => void) | undefined
  const promise = new Promise<T>(resolve => { resolvePromise = resolve })
  return {
    promise,
    resolve: value => { resolvePromise?.(value) },
  }
}

describe('Fleet Web panel source', () => {
  it('projects a live Team and routes a channel message through FleetWebRemote', async () => {
    const sent: unknown[] = []
    const uploaded: unknown[] = []
    const controlled: unknown[] = []
    const membersControlled: unknown[] = []
    const archiveCalls: unknown[] = []
    const run = {
      id: 'team-1',
      name: 'Runtime Team',
      projectRoot: '/workspace/fleet',
      status: 'running',
      startedAt: '2026-08-21T10:00:00.000Z',
      members: [{
        name: 'builder', displayName: 'Avery Stone', role: '实现工程师',
        sessionId: 'member-session', status: 'error', provider: 'deepseek', model: 'deepseek-chat',
      }],
      assistants: [{ sessionId: 'observer-session', view: { id: 'assistant', name: 'You', role: '外部观察者' } }],
    }
    const remote = {
      list: async () => ok([run]),
      project: async input => {
        const request = input as { readonly view?: string; readonly resource?: string; readonly revision?: string }
        if (request.view === 'configuration') {
          return ok({ core: { name: 'Runtime Team', members: [] }, modules: {} })
        }
        if (request.view === 'resource') {
          return ok({
            id: request.resource,
            kind: 'markdown',
            body: '# Current plan',
            mediaType: 'text/markdown',
            history: [{
              id: 'rev-1', updatedBy: 'member-session', updatedAt: '2026-08-21T10:02:00.000Z', operation: 'updated',
              available: true, size: 25,
            }],
            historyTruncated: false,
            ...(request.revision === undefined ? {} : {
              revision: {
                id: request.revision,
                updatedBy: 'member-session',
                updatedAt: '2026-08-21T10:02:00.000Z',
                operation: 'updated',
                available: true,
                size: 25,
                before: '# Draft',
                after: '# Current plan',
              },
            }),
          })
        }
        return ok({
        run,
        memberViews: [{
          id: 'builder', name: 'Avery Stone', role: '实现工程师', responsibility: '实现并验证运行时功能',
          contacts: { members: '*', channels: '*' },
        }],
        events: [
          {
            sequence: 1,
            createdAt: '2026-08-21T10:01:00.000Z',
            type: 'coordination.channel',
            data: {
              type: 'channel', action: 'created',
              channel: { id: 'general', name: 'general', topic: '团队同步', members: [], archived: false },
            },
          },
          {
            sequence: 2,
            createdAt: '2026-08-21T10:02:00.000Z',
            type: 'resource.resource_added',
            data: {
              type: 'resource_added',
              resource: { id: 'plan', path: '/workspace/fleet/.fleet/plan.md', label: 'plan.md', mediaType: 'text/markdown' },
            },
          },
          {
            sequence: 3,
            createdAt: '2026-08-21T10:02:30.000Z',
            type: 'workspace.assigned',
            data: {
              member: 'builder',
              workspaces: [{ name: 'source', path: '/workspace/fleet/src', access: 'write' }],
            },
          },
          {
            sequence: 4,
            createdAt: '2026-08-21T10:03:00.000Z',
            type: 'coordination.message',
            data: {
              type: 'message',
              message: {
                id: 'message-1', conversation: '#general', from: 'member-session', text: '@builder Runtime is connected.',
                mentions: ['member-session'], resources: ['plan'], createdAt: '2026-08-21T10:03:00.000Z',
              },
            },
          },
          {
            sequence: 5,
            createdAt: '2026-08-21T10:04:00.000Z',
            type: 'coordination.message',
            data: {
              type: 'message',
              message: {
                id: 'message-user', conversation: '@member-session', from: 'fleet-user:team-1', fromName: 'User',
                text: 'Please inspect this directly.', mentions: [], resources: [], createdAt: '2026-08-21T10:04:00.000Z',
              },
            },
          },
          {
            sequence: 6,
            createdAt: '2026-08-21T10:05:00.000Z',
            type: 'coordination.message',
            data: {
              type: 'message',
              message: {
                id: 'message-reply', conversation: '@fleet-user:team-1', from: 'member-session',
                text: 'Direct reply received.', mentions: [], resources: [], createdAt: '2026-08-21T10:05:00.000Z',
              },
            },
          },
          {
            sequence: 7,
            createdAt: '2026-08-21T10:05:30.000Z',
            type: 'coordination.inbox',
            data: {
              type: 'inbox', action: 'acknowledged', agentId: 'member-session', messageId: 'message-user',
            },
          },
          {
            sequence: 8,
            createdAt: '2026-08-21T10:05:45.000Z',
            type: 'coordination.message',
            data: {
              type: 'message',
              message: {
                id: 'message-unread', conversation: '@member-session', from: 'fleet-user:team-1', fromName: 'User',
                text: 'This one is still waiting.', mentions: [], resources: [], createdAt: '2026-08-21T10:05:45.000Z',
              },
            },
          },
          {
            sequence: 9,
            createdAt: '2026-08-21T10:06:00.000Z',
            type: 'member_status.updated',
            data: {
              action: 'updated',
              status: {
                member: 'builder',
                message: '正在验证团队运行时状态投影',
                updatedAt: '2026-08-21T10:06:00.000Z',
              },
            },
          },
          {
            sequence: 10,
            createdAt: '2026-08-21T10:07:00.000Z',
            type: 'task.created',
            data: { action: 'created', task: { id: 'task-1', title: '接通运行时投影' }, actor: 'builder' },
          },
          {
            sequence: 11,
            createdAt: '2026-08-21T10:08:00.000Z',
            type: 'schedule.triggered',
            data: { action: 'triggered', task: { id: 'schedule-1', title: '检查长跑状态' } },
          },
          {
            sequence: 12,
            createdAt: '2026-08-21T10:09:00.000Z',
            type: 'calendar.started',
            data: { action: 'started', event: { id: 'calendar-1', title: '团队同步' } },
          },
          {
            sequence: 13,
            createdAt: '2026-08-21T10:10:00.000Z',
            type: 'resource.document_updated',
            data: { action: 'updated', document: { id: 'doc-1', name: 'plan', title: '执行计划' }, actor: 'builder' },
          },
        ],
          hasMore: false,
        })
      },
      send: async input => {
        sent.push(input)
        return ok({ messageId: 'message-2', recipients: 1, woken: 0 })
      },
      member: async input => {
        membersControlled.push(input)
        return ok({})
      },
      control: async input => {
        controlled.push(input)
        return ok({})
      },
      upload: async input => {
        uploaded.push(input)
        return ok({})
      },
      uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
      archive: async input => {
        archiveCalls.push(input)
        const request = input as { readonly action: string; readonly offset?: number; readonly base64?: string }
        if (request.action === 'export') return ok({ transferId: 'export-1', name: 'team.fleet.tar.gz', size: 7 })
        if (request.action === 'read') return ok({ base64: btoa('archive'), nextOffset: 7, done: true })
        if (request.action === 'begin_import') return ok({ transferId: 'import-1' })
        if (request.action === 'write') {
          return ok({ nextOffset: (request.offset ?? 0) + atob(request.base64 ?? '').length })
        }
        return ok({})
      },
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))
    let snapshotUpdates = 0
    const unsubscribe = source.subscribe(() => { snapshotUpdates += 1 })

    await source.refresh()

    const snapshot = source.getSnapshot()
    expect(snapshot).toMatchObject({
      selectedTeamId: 'team-1',
      directory: { teams: [{ teamId: 'team-1', teamName: 'Runtime Team', primaryWorkspace: 'fleet' }] },
      team: {
        teamId: 'team-1',
        members: [{
          id: 'builder', name: 'Avery Stone', responsibility: '实现并验证运行时功能',
          presence: 'error', statusText: '正在验证团队运行时状态投影', provider: 'deepseek', model: 'deepseek-chat',
        }],
        assistants: [{
          id: 'assistant', name: 'You', role: '外部观察者', responsibility: '外部观察者',
          presence: 'offline', runtimeStatus: 'offline', sessionId: 'observer-session', operator: true,
        }],
        resources: [{ id: 'plan', name: 'plan.md', kind: 'plan', path: '/workspace/fleet/.fleet/plan.md' }],
        workspaces: [{ id: 'workspace:/workspace/fleet/src', name: 'source', path: '/workspace/fleet/src' }],
        messages: expect.arrayContaining([
          expect.objectContaining({ id: 'message-1', conversationId: '#general', senderId: 'builder' }),
        ]),
      },
    })
    expect(snapshot.team?.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '#general', name: 'general' }),
      expect.objectContaining({ id: '@member-session', name: 'Avery Stone' }),
    ]))
    expect(snapshot.team?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'message-1',
        content: [
          { type: 'text', text: '@builder Runtime is connected.' },
          expect.objectContaining({ type: 'resource', id: 'plan' }),
        ],
      }),
      expect.objectContaining({
        id: 'message-user', conversationId: '@member-session', sender: expect.objectContaining({ operator: true }),
        receipt: { visibleMemberIds: ['builder'], readMemberIds: ['builder'], unreadMemberIds: [] },
      }),
      expect.objectContaining({
        id: 'message-unread', conversationId: '@member-session',
        receipt: { visibleMemberIds: ['builder'], readMemberIds: [], unreadMemberIds: ['builder'] },
      }),
      expect.objectContaining({ id: 'message-reply', conversationId: '@member-session', senderId: 'builder' }),
    ]))
    expect(snapshot.team?.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'decision', text: '任务已创建：接通运行时投影' }),
      expect.objectContaining({ kind: 'decision', text: '计划已触发：检查长跑状态' }),
      expect.objectContaining({ kind: 'decision', text: '日程已开始：团队同步' }),
      expect.objectContaining({ kind: 'resource', text: '更新了团队文档 执行计划' }),
    ]))
    const updatesAfterInitialProjection = snapshotUpdates
    await source.refresh()
    expect(snapshotUpdates).toBe(updatesAfterInitialProjection)
    await expect(source.loadResource?.('team-1', 'plan')).resolves.toEqual({
      id: 'plan',
      kind: 'markdown',
      body: '# Current plan',
      mediaType: 'text/markdown',
      history: [{
        id: 'rev-1', updatedBy: 'member-session', updatedAt: '2026-08-21T10:02:00.000Z', operation: 'updated',
        available: true, size: 25,
      }],
      historyTruncated: false,
    })
    await expect(source.loadResource?.('team-1', 'plan', undefined, 'rev-1')).resolves.toMatchObject({
      revision: { id: 'rev-1', before: '# Draft', after: '# Current plan' },
    })
    await expect(source.exportTeam?.('team-1')).resolves.toEqual({
      core: { name: 'Runtime Team', members: [] },
      modules: {},
    })
    const archive = await source.exportArchive?.({
      sessionId: 'observer-session', teamId: 'team-1', includeWorkspace: true,
    })
    expect(archive?.name).toBe('team.fleet.tar.gz')
    expect(await archive?.blob.text()).toBe('archive')
    await source.importArchive?.({
      sessionId: 'observer-session',
      file: new File(['import'], 'team.fleet.tar.gz'),
      projectRoot: '/workspace/restored',
      mode: 'copy',
    })
    expect(archiveCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'export', includeWorkspace: true }),
      expect.objectContaining({ action: 'read', transferId: 'export-1', offset: 0 }),
      expect.objectContaining({ action: 'begin_import', name: 'team.fleet.tar.gz' }),
      expect.objectContaining({ action: 'write', transferId: 'import-1', offset: 0 }),
      expect.objectContaining({
        action: 'finish_import', transferId: 'import-1', projectRoot: '/workspace/restored', importMode: 'copy',
      }),
    ]))

    await source.sendMessage({
      sessionId: 'observer-session',
      teamId: 'team-1',
      conversationId: '#general',
      content: [{ type: 'text', text: 'Acknowledged.' }],
    })
    expect(sent).toEqual([{
      sessionId: 'observer-session',
      teamId: 'team-1',
      mode: 'conversation',
      to: '#general',
      text: 'Acknowledged.',
      delivery: 'quiet',
    }])

    await source.sendMessage({
      sessionId: 'observer-session',
      teamId: 'team-1',
      conversationId: '@member-session',
      content: [{ type: 'text', text: 'Please respond directly.' }],
    })
    expect(sent.at(-1)).toEqual({
      sessionId: 'observer-session',
      teamId: 'team-1',
      mode: 'conversation',
      to: '@member-session',
      text: 'Please respond directly.',
      delivery: 'wakeup',
    })

    await source.sendMessage({
      sessionId: 'observer-session',
      teamId: 'team-1',
      conversationId: '#general',
      content: [{ type: 'text', text: '@builder stop using the stale branch.' }],
      mentions: ['builder'],
      delivery: 'interrupt',
    })
    expect(sent.at(-1)).toEqual({
      sessionId: 'observer-session',
      teamId: 'team-1',
      mode: 'conversation',
      to: '#general',
      text: '@builder stop using the stale branch.',
      delivery: 'interrupt',
      mentions: ['@builder'],
    })

    await source.controlTeam?.({ sessionId: 'observer-session', teamId: 'team-1', action: 'pause' })
    await source.controlMember?.({
      sessionId: 'observer-session', teamId: 'team-1', memberId: 'builder', action: 'resume',
    })
    expect(controlled).toContainEqual({ sessionId: 'observer-session', teamId: 'team-1', action: 'pause' })
    expect(membersControlled).toContainEqual({
      sessionId: 'observer-session', teamId: 'team-1', member: 'builder', action: 'resume',
    })

    await source.uploadResource?.({
      sessionId: 'observer-session',
      teamId: 'team-1',
      file: new File(['hello'], 'note.txt', { type: 'text/plain' }),
    })
    expect(uploaded).toEqual([{
      sessionId: 'observer-session',
      teamId: 'team-1',
      name: 'note.txt',
      base64: 'aGVsbG8=',
      label: 'note.txt',
      mediaType: 'text/plain',
    }])

    unsubscribe()
    source.dispose()
  })

  it('keeps the last snapshot visible across a connection failure and supports retry', async () => {
    const run = {
      id: 'team-1', name: 'Runtime Team', projectRoot: '/workspace/fleet', status: 'idle',
      startedAt: '2026-08-21T10:00:00.000Z', members: [], assistants: [],
    }
    const remote = {
      list: async () => ok([run]),
      project: async () => ok({ run, memberViews: [], events: [], hasMore: false }),
      send: async () => ok({}),
      member: async () => ok({}),
      control: async () => ok({}),
      upload: async () => ok({}),
      uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
    } satisfies FleetWebClient
    let offline = true
    const source = createFleetWebPanelSource(() => {
      if (offline) return Promise.reject(new Error('Host is offline'))
      return Promise.resolve(remote)
    })

    await source.refresh()
    expect(source.getSnapshot()).toMatchObject({
      directory: { teams: [] },
      connection: { status: 'disconnected', error: 'Host is offline' },
    })

    offline = false
    await source.retry()
    expect(source.getSnapshot()).toMatchObject({
      selectedTeamId: 'team-1',
      directory: { teams: [{ teamId: 'team-1' }] },
      connection: { status: 'connected' },
    })
    source.dispose()
  })

  it('refreshes an active projection when the browser peer invalidates it', async () => {
    const run = {
      id: 'team-1', name: 'Runtime Team', projectRoot: '/workspace/fleet', status: 'idle',
      startedAt: '2026-08-21T10:00:00.000Z', members: [], assistants: [],
    }
    let lists = 0
    const remote = {
      list: async () => {
        lists += 1
        return ok([run])
      },
      project: async () => ok({ run, memberViews: [], events: [], hasMore: false }),
      send: async () => ok({}),
      member: async () => ok({}),
      control: async () => ok({}),
      upload: async () => ok({}),
      uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
      archive: async () => ok({}),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    await source.refresh()
    await source.invalidate()
    expect(lists).toBe(1)

    const unsubscribe = source.subscribe(() => undefined)
    await new Promise(resolve => setTimeout(resolve, 0))
    const beforeInvalidate = lists
    await source.invalidate()
    expect(lists).toBe(beforeInvalidate + 1)

    unsubscribe()
    source.dispose()
  })

  it('separates operator direct chats from each member-to-member conversation', async () => {
    const run = {
      id: 'team-1', name: 'Runtime Team', projectRoot: '/workspace/fleet', status: 'running',
      startedAt: '2026-08-21T10:00:00.000Z',
      members: [
        { name: 'builder', displayName: 'Avery', role: 'Engineer', sessionId: 'builder-session', status: 'running' },
        { name: 'reviewer', displayName: 'Blake', role: 'Reviewer', sessionId: 'reviewer-session', status: 'running' },
      ],
      assistants: [{ sessionId: 'assistant-session', view: { id: 'assistant', name: 'Guide', role: '助理' } }],
    }
    const message = (
      sequence: number,
      id: string,
      from: string,
      conversation: string,
    ) => ({
      sequence,
      createdAt: `2026-08-21T10:0${String(sequence)}:00.000Z`,
      type: 'coordination.message',
      data: {
        type: 'message',
        message: { id, from, conversation, text: id, mentions: [], resources: [] },
      },
    })
    const remote = {
      list: async () => ok([run]),
      project: async () => ok({
        run,
        memberViews: [
          { id: 'builder', name: 'Avery', role: 'Engineer', contacts: { members: '*', channels: '*' } },
          { id: 'reviewer', name: 'Blake', role: 'Reviewer', contacts: { members: '*', channels: '*' } },
        ],
        events: [
          message(1, 'builder-to-reviewer', 'builder-session', '@reviewer-session'),
          message(2, 'reviewer-to-builder', 'reviewer-session', '@builder-session'),
          message(3, 'user-to-builder', 'fleet-user:team-1', '@builder-session'),
          message(4, 'assistant-to-builder', 'assistant-session', '@builder-session'),
        ],
        hasMore: false,
      }),
      send: async () => ok({}), member: async () => ok({}), control: async () => ok({}),
      upload: async () => ok({}), uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    await source.refresh()

    const team = source.getSnapshot().team
    const memberDirectId = 'dm:builder-session:reviewer-session'
    const assistantDirectId = 'dm:assistant-session:builder-session'
    expect(team?.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '@builder-session', peerId: 'builder' }),
      expect.objectContaining({ id: '@reviewer-session', peerId: 'reviewer' }),
      expect.objectContaining({ id: memberDirectId, participantIds: ['builder', 'reviewer'] }),
      expect.objectContaining({ id: assistantDirectId }),
    ]))
    expect(team?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'builder-to-reviewer', conversationId: memberDirectId }),
      expect.objectContaining({ id: 'reviewer-to-builder', conversationId: memberDirectId }),
      expect.objectContaining({ id: 'user-to-builder', conversationId: '@builder-session' }),
      expect.objectContaining({ id: 'assistant-to-builder', conversationId: assistantDirectId }),
    ]))
    expect(team?.members.find(member => member.id === 'builder')?.visibleConversationIds)
      .toEqual(expect.arrayContaining(['@builder-session', memberDirectId, assistantDirectId]))
    expect(team?.members.find(member => member.id === 'reviewer')?.visibleConversationIds)
      .toEqual(expect.arrayContaining(['@reviewer-session', memberDirectId]))
    expect(team?.activity.map(item => item.id)).toEqual(['team-1:3'])
    source.dispose()
  })

  it('keeps cross-process runtime state distinct from offline presence', async () => {
    const run = {
      id: 'team-1', name: 'Runtime Team', projectRoot: '/workspace/fleet', status: 'running',
      startedAt: '2026-08-21T10:00:00.000Z',
      members: [{ name: 'builder', role: 'Engineer', sessionId: 'member-session', status: 'unknown' }],
      assistants: [],
    }
    const remote = {
      list: async () => ok([run]),
      project: async () => ok({
        run,
        memberViews: [{ id: 'builder', name: 'Builder', role: 'Engineer', contacts: { members: '*', channels: '*' } }],
        events: [],
        hasMore: false,
      }),
      send: async () => ok({}), member: async () => ok({}), control: async () => ok({}),
      upload: async () => ok({}), uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    await source.refresh()

    expect(source.getSnapshot().team?.members).toContainEqual(expect.objectContaining({
      id: 'builder', presence: 'unknown',
    }))
    source.dispose()
  })

  it('does not publish an obsolete Team projection after the selection changes', async () => {
    const runs = [
      { id: 'team-a', name: 'Team A', projectRoot: '/workspace/a', status: 'running', startedAt: '', members: [], assistants: [] },
      { id: 'team-b', name: 'Team B', projectRoot: '/workspace/b', status: 'running', startedAt: '', members: [], assistants: [] },
    ]
    const teamA = deferred<RemoteResult<unknown>>()
    const teamB = deferred<RemoteResult<unknown>>()
    const requestedA = deferred<void>()
    const remote = {
      list: async () => ok(runs),
      project: async input => {
        const teamId = typeof input === 'object' && input !== null && 'teamId' in input
          ? String((input as { readonly teamId: unknown }).teamId)
          : ''
        if (teamId === 'team-a') {
          requestedA.resolve()
          return teamA.promise
        }
        return teamB.promise
      },
      send: async () => ok({}), member: async () => ok({}), control: async () => ok({}),
      upload: async () => ok({}), uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    const firstRefresh = source.refresh()
    await requestedA.promise
    source.selectTeam('team-b')
    teamA.resolve(ok({ run: runs[0], memberViews: [], events: [], hasMore: false }))
    await firstRefresh

    expect(source.getSnapshot().selectedTeamId).toBe('team-b')
    expect(source.getSnapshot().team?.teamId).not.toBe('team-a')

    teamB.resolve(ok({ run: runs[1], memberViews: [], events: [], hasMore: false }))
    await source.refresh()
    expect(source.getSnapshot().team?.teamId).toBe('team-b')
    source.dispose()
  })

  it('bounds live Team history and reads a bounded persistent member trace on demand', async () => {
    const run = {
      id: 'team-1', name: 'Long-running Team', projectRoot: '/workspace/fleet', status: 'running',
      startedAt: '2026-08-21T10:00:00.000Z',
      members: [{ name: 'builder', role: 'Engineer', sessionId: 'member-session', status: 'idle' }],
      assistants: [],
    }
    const messages = Array.from({ length: 560 }, (_, index) => ({
      sequence: index + 1,
      createdAt: '2026-08-21T10:00:00.000Z',
      type: 'coordination.message',
      data: {
        type: 'message',
        message: {
          id: `message-${String(index + 1)}`, conversation: '#general', from: 'member-session',
          text: `Message ${String(index + 1)}`, mentions: [], resources: [], createdAt: '2026-08-21T10:00:00.000Z',
        },
      },
    }))
    const traceEvents = Array.from({ length: 250 }, (_, index) => ({
      sequence: index,
      createdAt: '2026-08-21T10:00:00.000Z',
      type: 'session.user/message',
      data: JSON.stringify({ message: { content: [{ type: 'text', text: `Context ${String(index + 1)}` }] } }),
    }))
    const remote = {
      list: async () => ok([run]),
      project: async input => {
        const view = typeof input === 'object' && input !== null && 'view' in input
          ? (input as { readonly view?: string }).view
          : undefined
        const tail = typeof input === 'object' && input !== null && 'tail' in input
          ? (input as { readonly tail?: boolean }).tail
          : false
        return view === 'trace'
          ? ok({
              runId: run.id,
              member: 'builder',
              events: tail ? traceEvents.slice(-240) : traceEvents,
              hasMore: tail && traceEvents.length > 240,
            })
          : ok({
              run,
              memberViews: [{
                id: 'builder', name: 'Builder', role: 'Engineer', responsibility: 'Implementation',
                contacts: { members: '*', channels: '*' },
              }],
              events: messages,
              hasMore: false,
            })
      },
      send: async () => ok({}),
      member: async () => ok({}),
      control: async () => ok({}),
      upload: async () => ok({}),
      uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    await source.refresh()
    expect(source.getSnapshot().team?.messages).toHaveLength(500)
    expect(source.getSnapshot().team?.messages[0]?.id).toBe('message-61')

    const trace = await source.loadMemberTrace('team-1', 'builder')
    expect(trace.truncated).toBe(true)
    expect(trace.events).toHaveLength(240)
    expect(trace.events[0]?.sequence).toBe(10)
    source.dispose()
  })

  it('requests a tail trace from before sequence zero so the first Session event is visible', async () => {
    const requests: unknown[] = []
    const remote = {
      list: async () => ok([]),
      project: async input => {
        requests.push(input)
        return ok({
          runId: 'team-1', member: 'builder', hasMore: false,
          events: [{ sequence: 0, createdAt: '2026-08-21T10:00:00.000Z', type: 'session.user/message', data: '{}' }],
        })
      },
      send: async () => ok({}), member: async () => ok({}), control: async () => ok({}),
      upload: async () => ok({}), uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    const trace = await source.loadMemberTrace('team-1', 'builder')

    expect(requests).toEqual([{
      teamId: 'team-1', view: 'trace', member: 'builder', tail: true, afterSequence: -1, limit: 240,
    }])
    expect(trace.events.map(event => event.sequence)).toEqual([0])
    source.dispose()
  })
})
