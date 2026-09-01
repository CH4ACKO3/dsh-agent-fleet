import { describe, expect, it, vi } from 'vitest'
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
  it('projects a live Team and routes operator actions through FleetWebRemote', async () => {
    const sent: unknown[] = []
    const uploaded: unknown[] = []
    const removed: unknown[] = []
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
        name: 'builder', displayName: 'Avery Stone', color: '#527FCA', role: '实现工程师',
        sessionId: 'member-session', status: 'error', provider: 'deepseek', model: 'deepseek-chat',
        reasoningEffort: 'high', maxTokens: 4_096,
      }],
      assistants: [{
        sessionId: 'observer-session', status: 'idle',
        view: { id: 'assistant', name: 'You', role: '外部观察者' },
      }],
      budget: {
        mode: 'tokens',
        rates: [{ provider: 'deepseek', model: 'deepseek-chat', multiplier: 2 }],
        team: {
          limit: 1_000, startedAt: '2026-08-21T10:00:00.000Z', used: 600,
          inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0,
          reasoningTokens: 40, calls: 3, unmeteredCalls: 0, models: [],
        },
        members: [
          {
            memberId: 'builder', limit: 500, startedAt: '2026-08-21T10:00:00.000Z', used: 500,
            inputTokens: 150, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0,
            reasoningTokens: 40, calls: 2, unmeteredCalls: 0, models: [],
          },
          {
            memberId: 'former-reviewer', name: 'Morgan', role: '前评审者', color: '#846BB3', assistant: false,
            startedAt: '2026-08-21T10:00:00.000Z', used: 100,
            inputTokens: 50, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
            reasoningTokens: 0, calls: 1, unmeteredCalls: 0, models: [],
          },
        ],
      },
    }
    const remote = {
      list: async () => ok([run]),
      project: async input => {
        const request = input as { readonly view?: string; readonly resource?: string; readonly revision?: string }
        if (request.view === 'configuration') {
          return ok({ core: { name: 'Runtime Team', members: [] }, modules: {} })
        }
        if (request.view === 'settings') {
          return ok({
            name: 'Runtime Team', positioning: 'Runtime operations', rules: '', collaborationMethod: '',
            visibilityReminderContextGrowthTokens: 16_000,
            updateDensity: 'balanced', notificationPolicy: 'milestones', contentPreference: '',
            projectRoot: '/workspace/fleet',
            budget: {
              mode: 'tokens', rates: [], configuredModels: [{ provider: 'deepseek', model: 'deepseek-chat' }],
              team: {
                limit: 1000, startedAt: '2026-08-21T10:00:00.000Z', used: 250,
                inputTokens: 150, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0,
                reasoningTokens: 40, calls: 2, unmeteredCalls: 0, models: [], remaining: 750, state: 'normal',
              },
              members: [{
                memberId: 'builder', name: 'Avery Stone', role: '实现工程师', assistant: false,
                limit: 500, startedAt: '2026-08-21T10:00:00.000Z', used: 250,
                inputTokens: 150, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0,
                reasoningTokens: 40, calls: 2, unmeteredCalls: 0, models: [], remaining: 250, state: 'normal',
              }],
            },
            request: { provider: 'deepseek', model: 'deepseek-chat', mixed: {
              model: false, reasoningEffort: false, maxTokens: false,
            } },
          })
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
            createdAt: '2026-08-21T10:04:01.000Z',
            type: 'coordination.inbox',
            data: {
              type: 'inbox', action: 'delivered', agentId: 'member-session', messageId: 'message-user',
              contextMessageId: 'context-message-user',
            },
          },
          {
            sequence: 7,
            createdAt: '2026-08-21T10:05:00.000Z',
            type: 'coordination.message',
            data: {
              type: 'message',
              message: {
                id: 'message-reply', conversation: '@fleet-user:team-1', from: 'member-session',
                kind: 'reply', replyTo: 'message-user', text: 'Direct reply received.', mentions: [], resources: [],
                createdAt: '2026-08-21T10:05:00.000Z',
              },
            },
          },
          {
            sequence: 8,
            createdAt: '2026-08-21T10:05:30.000Z',
            type: 'coordination.inbox',
            data: {
              type: 'inbox', action: 'read', agentId: 'member-session', messageId: 'message-user', through: 29,
            },
          },
          {
            sequence: 9,
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
            sequence: 10,
            createdAt: '2026-08-21T10:05:46.000Z',
            type: 'coordination.inbox',
            data: {
              type: 'inbox', action: 'delivered', agentId: 'member-session', messageId: 'message-unread',
              contextMessageId: 'context-message-unread',
            },
          },
          {
            sequence: 11,
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
          {
            sequence: 14,
            createdAt: '2026-08-21T10:10:30.000Z',
            type: 'coordination.message',
            data: {
              type: 'message',
              message: {
                id: 'message-blocked', conversation: '@member-session', from: 'fleet-user:team-1', fromName: 'User',
                recipientIds: ['builder'], text: 'This delivery is blocked.', mentions: [], resources: [],
                createdAt: '2026-08-21T10:10:30.000Z',
              },
            },
          },
          {
            sequence: 15,
            createdAt: '2026-08-21T10:10:31.000Z',
            type: 'coordination.inbox',
            data: {
              type: 'inbox', action: 'blocked', agentId: 'builder', messageId: 'message-blocked',
              reason: 'inbox_delivery_failed', detail: 'native inbox is closed',
              blockedAt: '2026-08-21T10:10:31.000Z',
            },
          },
          {
            sequence: 16,
            createdAt: '2026-08-21T10:11:00.000Z',
            type: 'task.completed',
            data: {
              action: 'completed',
              task: {
                id: 'interaction-1',
                title: 'assistant user interaction',
                domain: {
                  kind: 'interaction', owner: 'assistant', inputRevision: 1, settledRevision: 1,
                  latestMessageId: 'native-user-1', waitingTaskIds: [],
                },
                stableState: { kind: 'completed', reason: 'Direct response completed.', result: 'Team status is healthy.' },
                entries: [
                  {
                    id: 'entry-user', kind: 'comment', author: 'User', text: 'Check Team status.', resources: [],
                    createdAt: '2026-08-21T10:10:40.000Z', interactionRevision: 1,
                    interactionMessageId: 'native-user-1',
                  },
                  {
                    id: 'entry-output', kind: 'comment', author: 'assistant', text: 'Team status is healthy.', resources: [],
                    createdAt: '2026-08-21T10:11:00.000Z', interactionRevision: 1,
                  },
                ],
                updatedAt: '2026-08-21T10:11:00.000Z',
              },
            },
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
        if ((input as { readonly action?: string }).action === 'configure') {
          return ok({
            ...(input as { readonly settings: object }).settings,
            projectRoot: '/workspace/fleet',
            request: { provider: 'deepseek', model: 'deepseek-chat', mixed: {
              model: false, reasoningEffort: false, maxTokens: false,
            } },
          })
        }
        if ((input as { readonly action?: string }).action === 'budget') {
          return ok({
            mode: 'tokens', rates: [], configuredModels: [{ provider: 'deepseek', model: 'deepseek-chat' }],
            team: {
              limit: 1000, startedAt: '2026-08-21T10:00:00.000Z', used: 250,
              inputTokens: 150, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0,
              reasoningTokens: 40, calls: 2, unmeteredCalls: 0, models: [], remaining: 750, state: 'normal',
            },
            members: [],
          })
        }
        return ok({})
      },
      upload: async input => {
        uploaded.push(input)
        return ok({
          id: 'resource-note',
          path: '/project/.fleet/team-1/note.txt',
          label: 'note.txt',
          mediaType: 'text/plain',
          size: 5,
          createdBy: 'fleet-user:observer-session',
          createdAt: '2026-08-21T10:11:00.000Z',
        })
      },
      removeResource: async input => {
        removed.push(input)
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
      directory: { teams: [{
        teamId: 'team-1', teamName: 'Runtime Team', primaryWorkspace: 'fleet',
        memberStatuses: ['error'],
        assistantSessionIds: ['observer-session'],
        assistantConnections: [{ assistantId: 'assistant', assistantName: 'You', sessionId: 'observer-session' }],
      }] },
      team: {
        teamId: 'team-1',
        members: [{
          id: 'builder', name: 'Avery Stone', responsibility: '实现并验证运行时功能',
          presence: 'error', statusText: '正在验证团队运行时状态投影',
          statusUpdatedAt: '2026-08-21T10:06:00.000Z', provider: 'deepseek', model: 'deepseek-chat',
          reasoningEffort: 'high', maxTokens: 4_096,
        }],
        assistants: [{
          id: 'assistant', name: 'You', role: '外部观察者', responsibility: '外部观察者',
          presence: 'active', runtimeStatus: 'idle', sessionId: 'observer-session',
        }],
        assistantInteractions: [{
          assistantId: 'assistant', pending: false, turns: [{
            revision: 1, messageId: 'native-user-1', input: 'Check Team status.',
            inputAt: '2026-08-21T10:10:40.000Z', output: 'Team status is healthy.',
            outputAt: '2026-08-21T10:11:00.000Z',
          }],
        }],
        resources: [{ id: 'plan', name: 'plan.md', kind: 'plan', path: '/workspace/fleet/.fleet/plan.md' }],
        workspaces: [{ id: 'workspace:/workspace/fleet/src', name: 'source', path: '/workspace/fleet/src' }],
        messages: expect.arrayContaining([
          expect.objectContaining({ id: 'message-1', conversationId: '#general', senderId: 'builder' }),
        ]),
        budget: {
          mode: 'tokens',
          team: { limit: 1_000, used: 600, remaining: 400, state: 'normal' },
          members: expect.arrayContaining([expect.objectContaining({
            memberId: 'builder', name: 'Avery Stone', role: '实现工程师', color: '#527FCA',
            limit: 500, used: 500, remaining: 0, state: 'exhausted',
          }), expect.objectContaining({
            memberId: 'former-reviewer', name: 'Morgan', role: '前评审者', color: '#846BB3',
            used: 100, state: 'unlimited', active: false,
          })]),
        },
      },
    })
    expect(snapshot.team?.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '#general', name: 'general', participantIds: ['builder', 'assistant'], memberCount: 2, activeCount: 2,
      }),
      expect.objectContaining({ id: '@builder', name: 'Avery Stone' }),
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
        id: 'message-user', conversationId: '@builder', sender: expect.objectContaining({ operator: true }),
        receipt: {
          visibleMemberIds: ['builder'], readMemberIds: ['builder'], unreadMemberIds: [],
          deliveredMemberIds: [], pendingMemberIds: [], pendingDeliveries: [],
          sources: [{ memberId: 'builder', sessionId: 'member-session', contextMessageId: 'context-message-user' }],
        },
      }),
      expect.objectContaining({
        id: 'message-unread', conversationId: '@builder',
        receipt: {
          visibleMemberIds: ['builder'], readMemberIds: [], unreadMemberIds: ['builder'],
          deliveredMemberIds: ['builder'], pendingMemberIds: [], pendingDeliveries: [],
          sources: [{ memberId: 'builder', sessionId: 'member-session', contextMessageId: 'context-message-unread' }],
        },
      }),
      expect.objectContaining({
        id: 'message-blocked', conversationId: '@builder',
        receipt: {
          visibleMemberIds: ['builder'], readMemberIds: [], unreadMemberIds: ['builder'],
          deliveredMemberIds: [], pendingMemberIds: ['builder'],
          pendingDeliveries: [{
            memberId: 'builder', reason: 'inbox_delivery_failed', detail: 'native inbox is closed',
            blockedAt: '2026-08-21T10:10:31.000Z',
          }],
        },
      }),
      expect.objectContaining({
        id: 'message-reply', conversationId: '@builder', senderId: 'builder',
        kind: 'reply', replyTo: 'message-user',
      }),
    ]))
    expect(snapshot.team?.activity.filter(item => item.kind === 'decision')).toHaveLength(3)
    expect(snapshot.team?.activity.some(item => item.text.includes('user interaction'))).toBe(false)
    expect(snapshot.team?.activity.some(item => item.kind === 'resource')).toBe(true)
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
      conversationId: '@builder',
      content: [{ type: 'text', text: 'Please respond directly.' }],
    })
    expect(sent.at(-1)).toEqual({
      sessionId: 'observer-session',
      teamId: 'team-1',
      mode: 'conversation',
      to: '@builder',
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

    await source.controlTeam?.({ sessionId: 'observer-session', teamId: 'team-1', action: 'load' })
    await source.controlTeam?.({ sessionId: 'observer-session', teamId: 'team-1', action: 'pause' })
    await source.controlTeam?.({ sessionId: 'observer-session', teamId: 'team-1', action: 'wake' })
    await source.controlTeam?.({ sessionId: 'observer-session', teamId: 'team-1', action: 'detach' })
    await expect(source.loadTeamSettings?.('team-1')).resolves.toMatchObject({
      name: 'Runtime Team', updateDensity: 'balanced', projectRoot: '/workspace/fleet',
      budget: { mode: 'tokens', team: { limit: 1000, used: 250 }, members: [expect.objectContaining({ memberId: 'builder', limit: 500 })] },
    })
    await expect(source.updateTeamSettings?.({
      sessionId: 'observer-session', teamId: 'team-1', settings: {
        name: 'Runtime Team', positioning: 'Runtime operations', rules: '', collaborationMethod: '',
        visibilityReminderContextGrowthTokens: 16_000,
        updateDensity: 'detailed', notificationPolicy: 'decisions', contentPreference: 'Lead with outcomes.',
      },
    })).resolves.toMatchObject({ updateDensity: 'detailed', notificationPolicy: 'decisions' })
    await expect(source.updateBudget?.({
      sessionId: 'observer-session', teamId: 'team-1', scope: 'member', member: 'builder', limit: 500,
    })).resolves.toMatchObject({ team: { limit: 1000, used: 250 } })
    await source.configureTeamRequest?.({
      sessionId: 'observer-session', teamId: 'team-1',
      request: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
    })
    await source.configureMemberRequest?.({
      sessionId: 'observer-session', teamId: 'team-1', memberId: 'builder', assistant: false,
      request: { provider: 'deepseek', model: 'deepseek-reasoner', maxTokens: 8_192 },
    })
    await source.configureMemberRequest?.({
      sessionId: 'observer-session', teamId: 'team-1', memberId: 'assistant', assistant: true,
      request: { reasoningEffort: 'medium', maxTokens: null },
    })
    await source.controlMember?.({
      sessionId: 'observer-session', teamId: 'team-1', memberId: 'builder', action: 'resume',
    })
    await source.controlMember?.({
      sessionId: 'observer-session', teamId: 'team-1', memberId: 'builder', action: 'wake',
    })
    expect(controlled).toContainEqual({ sessionId: 'observer-session', teamId: 'team-1', action: 'load' })
    expect(controlled).toContainEqual({ sessionId: 'observer-session', teamId: 'team-1', action: 'pause' })
    expect(controlled).toContainEqual({ sessionId: 'observer-session', teamId: 'team-1', action: 'wake' })
    expect(controlled).toContainEqual({ sessionId: 'observer-session', teamId: 'team-1', action: 'detach' })
    expect(controlled).toContainEqual(expect.objectContaining({
      sessionId: 'observer-session', teamId: 'team-1', action: 'configure',
      settings: expect.objectContaining({ updateDensity: 'detailed' }),
    }))
    expect(controlled).toContainEqual({
      sessionId: 'observer-session', teamId: 'team-1', action: 'budget',
      budget: { scope: 'member', member: 'builder', limit: 500 },
    })
    expect(membersControlled).toContainEqual({
      sessionId: 'observer-session', teamId: 'team-1', action: 'configure_all',
      request: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
    })
    expect(membersControlled).toContainEqual({
      sessionId: 'observer-session', teamId: 'team-1', action: 'configure', member: 'builder',
      request: { provider: 'deepseek', model: 'deepseek-reasoner', maxTokens: 8_192 },
    })
    expect(membersControlled).toContainEqual({
      sessionId: 'observer-session', teamId: 'team-1', action: 'configure_assistant', member: 'assistant',
      request: { reasoningEffort: 'medium', maxTokens: null },
    })
    expect(membersControlled).toContainEqual({
      sessionId: 'observer-session', teamId: 'team-1', member: 'builder', action: 'resume',
    })
    expect(membersControlled).toContainEqual({
      sessionId: 'observer-session', teamId: 'team-1', member: 'builder', action: 'wake',
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
    await source.removeResource?.({
      sessionId: 'observer-session',
      teamId: 'team-1',
      resourceId: 'plan',
    })
    expect(removed).toEqual([{
      sessionId: 'observer-session',
      teamId: 'team-1',
      resourceId: 'plan',
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

  it('removes a passively discovered Team file when the filesystem projection reports deletion', async () => {
    const run = {
      id: 'team-1', name: 'Runtime Team', projectRoot: '/workspace/fleet', status: 'idle',
      startedAt: '2026-08-21T10:00:00.000Z', members: [], assistants: [],
    }
    const resource = {
      id: 'shared:notes/progress.md', path: '/workspace/fleet/.fleet/team-1/notes/progress.md',
      label: 'notes/progress.md', createdBy: 'fleet-filesystem', createdAt: '2026-08-21T10:01:00.000Z',
    }
    const remote = {
      list: async () => ok([run]),
      project: async () => ok({
        run, memberViews: [], hasMore: false,
        events: [
          {
            sequence: 1, createdAt: '2026-08-21T10:01:00.000Z', type: 'resource.resource_added',
            data: { type: 'resource_added', resource },
          },
          {
            sequence: 2, createdAt: '2026-08-21T10:02:00.000Z', type: 'resource.resource_removed',
            data: {
              type: 'resource_removed',
              removal: { resource, removedBy: 'builder', removedAt: '2026-08-21T10:02:00.000Z' },
            },
          },
        ],
      }),
      send: async () => ok({}), member: async () => ok({}), control: async () => ok({}),
      upload: async () => ok({}), uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
      archive: async () => ok({}),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    await source.refresh()
    expect(source.getSnapshot().team?.resources).toEqual([])
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

  it('notifies only matching live member trace subscribers', () => {
    const remote = {
      list: async () => ok([]), project: async () => ok({}), send: async () => ok({}),
      member: async () => ok({}), control: async () => ok({}), upload: async () => ok({}),
      uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
      archive: async () => ok({}),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))
    const builder = vi.fn()
    const reviewer = vi.fn()
    const unsubscribe = source.subscribeMemberTrace('team-1', 'builder', builder)
    source.subscribeMemberTrace('team-1', 'reviewer', reviewer)

    source.invalidateTraces([
      { teamId: 'team-1', memberId: 'builder' },
      { teamId: 'team-2', memberId: 'reviewer' },
    ])
    expect(builder).toHaveBeenCalledOnce()
    expect(reviewer).not.toHaveBeenCalled()

    unsubscribe()
    source.invalidateTraces([{ teamId: 'team-1', memberId: 'builder' }])
    expect(builder).toHaveBeenCalledOnce()
    source.dispose()
  })

  it('separates operator direct chats from each member-to-member conversation', async () => {
    const sent: unknown[] = []
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
          message(5, 'user-to-assistant', 'fleet-user:team-1', '@assistant-session'),
          {
            sequence: 6,
            createdAt: '2026-08-21T10:06:00.000Z',
            type: 'coordination.inbox',
            data: {
              type: 'inbox', action: 'delivered', agentId: 'assistant-session', messageId: 'user-to-assistant',
              contextMessageId: 'assistant-context-message',
            },
          },
          {
            sequence: 7,
            createdAt: '2026-08-21T10:07:00.000Z',
            type: 'coordination.inbox',
            data: { type: 'inbox', action: 'read', agentId: 'assistant-session', messageId: 'user-to-assistant', through: 100 },
          },
          message(8, 'assistant-to-user', 'assistant-session', '@fleet-user:team-1'),
        ],
        hasMore: false,
      }),
      send: async input => { sent.push(input); return ok({}) }, member: async () => ok({}), control: async () => ok({}),
      upload: async () => ok({}), uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    await source.refresh()

    const team = source.getSnapshot().team
    const memberDirectId = 'dm:member:builder:member:reviewer'
    const assistantDirectId = 'dm:assistant:assistant:member:builder'
    expect(team?.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '@builder', peerId: 'builder' }),
      expect.objectContaining({ id: '@reviewer', peerId: 'reviewer' }),
      expect.objectContaining({ id: '@assistant', peerId: 'assistant' }),
      expect.objectContaining({ id: memberDirectId, participantIds: ['builder', 'reviewer'] }),
      expect.objectContaining({ id: assistantDirectId }),
    ]))
    expect(team?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'builder-to-reviewer', conversationId: memberDirectId }),
      expect.objectContaining({ id: 'reviewer-to-builder', conversationId: memberDirectId }),
      expect.objectContaining({ id: 'user-to-builder', conversationId: '@builder' }),
      expect.objectContaining({ id: 'assistant-to-builder', conversationId: assistantDirectId }),
      expect.objectContaining({
        id: 'user-to-assistant', conversationId: '@assistant',
        sender: expect.objectContaining({ id: 'operator', operator: true }),
        receipt: {
          visibleMemberIds: ['assistant'], readMemberIds: ['assistant'], unreadMemberIds: [],
          deliveredMemberIds: [], pendingMemberIds: [], pendingDeliveries: [],
          sources: [{ memberId: 'assistant', sessionId: 'assistant-session', contextMessageId: 'assistant-context-message' }],
        },
      }),
      expect.objectContaining({
        id: 'assistant-to-user', conversationId: '@assistant',
        sender: expect.objectContaining({ id: 'assistant' }),
      }),
    ]))
    expect(team?.messages.find(item => item.id === 'assistant-to-user')?.sender)
      .not.toEqual(expect.objectContaining({ operator: true }))
    expect(team?.members.find(member => member.id === 'builder')?.visibleConversationIds)
      .toEqual(expect.arrayContaining(['@builder', memberDirectId, assistantDirectId]))
    expect(team?.members.find(member => member.id === 'reviewer')?.visibleConversationIds)
      .toEqual(expect.arrayContaining(['@reviewer', memberDirectId]))
    expect(team?.activity.map(item => item.id)).toEqual(['team-1:3', 'team-1:5', 'team-1:8'])
    await source.sendMessage({
      sessionId: 'assistant-session',
      teamId: 'team-1',
      conversationId: '@assistant',
      content: [{ type: 'text', text: 'mailbox input' }],
    })
    expect(sent).toContainEqual(expect.objectContaining({
      teamId: 'team-1', mode: 'conversation', to: '@assistant', text: 'mailbox input', delivery: 'wakeup',
    }))
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
    expect(source.getSnapshot().team?.messages).toHaveLength(100)
    expect(source.getSnapshot().team?.messages[0]?.id).toBe('message-461')

    const trace = await source.loadMemberTrace('team-1', 'builder')
    expect(trace.truncated).toBe(true)
    expect(trace.events).toHaveLength(240)
    expect(trace.events[0]?.sequence).toBe(10)
    source.dispose()
  })

  it('loads an older conversation page without retaining it in the live Team snapshot', async () => {
    const run = {
      id: 'team-1', name: 'Paged Team', projectRoot: '/workspace/fleet', status: 'running',
      startedAt: '2026-08-21T10:00:00.000Z',
      members: [{ name: 'builder', displayName: 'Avery', role: 'Engineer', sessionId: 'member-new', status: 'idle' }],
      assistants: [],
    }
    const message = (sequence: number, id: string, from = 'member-old') => ({
      sequence,
      createdAt: '2026-08-21T10:00:00.000Z',
      type: 'coordination.message',
      data: {
        type: 'message',
        message: { id, conversation: '#general', from, text: id, mentions: [], resources: [] },
      },
    })
    const rotation = {
      sequence: 90,
      createdAt: '2026-08-21T10:00:00.000Z',
      type: 'member_session_rotated',
      data: { member: 'builder', previousSessionId: 'member-old', sessionId: 'member-new' },
    }
    const remote = {
      list: async () => ok([run]),
      project: async input => {
        const view = typeof input === 'object' && input !== null && 'view' in input
          ? (input as { readonly view?: string }).view
          : undefined
        return ok(view === 'conversation'
          ? {
              run,
              memberViews: [{ id: 'builder', name: 'Avery', role: 'Engineer', contacts: { members: '*', channels: '*' } }],
              events: [
                message(4, 'old-message', 'fleet-user:team-1'),
                {
                  sequence: 5,
                  createdAt: '2026-08-21T10:00:01.000Z',
                  type: 'coordination.inbox',
                  data: {
                    type: 'inbox', action: 'delivered', agentId: 'member-old', messageId: 'old-message',
                    contextMessageId: 'context-old',
                  },
                },
              ],
              hasMore: false,
              previousSequence: 4,
            }
          : {
              run,
              memberViews: [{ id: 'builder', name: 'Avery', role: 'Engineer', contacts: { members: '*', channels: '*' } }],
              events: [rotation, message(100, 'recent-message', 'member-new')],
              hasMore: false,
            })
      },
      send: async () => ok({}), member: async () => ok({}), control: async () => ok({}),
      upload: async () => ok({}), uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
      archive: async () => ok({}),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    await source.refresh()
    const page = await source.loadConversationMessages('team-1', '#general', 100)

    expect(page.messages).toEqual([
      expect.objectContaining({
        id: 'old-message', senderId: 'operator', sequence: 4,
        receipt: expect.objectContaining({
          sources: [{ memberId: 'builder', sessionId: 'member-old', contextMessageId: 'context-old' }],
        }),
      }),
    ])
    expect(source.getSnapshot().team?.messages.map(item => item.id)).toEqual(['recent-message'])
    source.dispose()
  })

  it('collapses rebound assistant sessions into one private conversation and scopes the assistant view', async () => {
    const run = {
      id: 'team-1', name: 'Assistant Team', projectRoot: '/workspace/fleet', status: 'running',
      startedAt: '2026-08-21T10:00:00.000Z',
      members: [
        { name: 'builder', displayName: 'Avery', role: 'Engineer', sessionId: 'member-builder', status: 'idle' },
        { name: 'reviewer', displayName: 'Robin', role: 'Reviewer', sessionId: 'member-reviewer', status: 'idle' },
      ],
      assistants: [{
        sessionId: 'assistant-current', status: 'idle',
        view: { id: 'team-assistant', name: 'Hailey', role: 'Assistant' },
      }],
      assistantSessionAliases: [
        { sessionId: 'assistant-old', currentSessionId: 'assistant-current' },
        { sessionId: 'assistant-current', currentSessionId: 'assistant-current' },
      ],
    }
    const message = (sequence: number, id: string, from: string, recipient: string) => ({
      sequence,
      createdAt: `2026-08-21T10:00:${String(sequence).padStart(2, '0')}.000Z`,
      type: 'coordination.message',
      data: {
        type: 'message',
        message: { id, conversation: `@${recipient}`, from, text: id, mentions: [], resources: [] },
      },
    })
    const remote = {
      list: async () => ok([run]),
      project: async () => ok({
        run,
        memberViews: [
          { id: 'builder', name: 'Avery', role: 'Engineer', contacts: { members: '*', channels: '*' } },
          { id: 'reviewer', name: 'Robin', role: 'Reviewer', contacts: { members: '*', channels: '*' } },
        ],
        events: [
          {
            sequence: 1,
            createdAt: '2026-08-21T10:00:01.000Z',
            type: 'assistant_rebound',
            data: {
              previousSessionId: 'assistant-old', sessionId: 'assistant-current',
              view: { id: 'team-assistant', name: 'Hailey', role: 'Assistant' },
            },
          },
          message(2, 'hailey-old', 'assistant-old', 'member-builder'),
          message(3, 'hailey-current', 'member-builder', 'assistant-current'),
          message(4, 'member-private', 'member-builder', 'member-reviewer'),
        ],
        hasMore: false,
      }),
      send: async () => ok({}), member: async () => ok({}), control: async () => ok({}),
      upload: async () => ok({}), uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
      archive: async () => ok({}),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    await source.refresh()
    const team = source.getSnapshot().team
    expect(source.getSnapshot().directory.teams[0]).toMatchObject({
      assistantConnections: [{
        assistantId: 'team-assistant', assistantName: 'Hailey', sessionId: 'assistant-current',
      }],
      assistantSessionIds: ['assistant-current', 'assistant-old'],
      assistantSessionAliases: {
        'assistant-old': 'assistant-current',
        'assistant-current': 'assistant-current',
      },
      assistantParticipantIds: {
        'assistant-old': 'team-assistant',
        'assistant-current': 'team-assistant',
      },
    })
    const haileyMessages = team?.messages.filter(item => item.id.startsWith('hailey-')) ?? []
    expect(new Set(haileyMessages.map(item => item.conversationId)).size).toBe(1)
    expect(haileyMessages[0]?.conversationId).toBe('dm:assistant:team-assistant:member:builder')
    expect(team?.conversations.filter(item => item.id === haileyMessages[0]?.conversationId)).toHaveLength(1)
    const hailey = team?.assistants?.find(item => item.id === 'team-assistant')
    expect(hailey?.visibleConversationIds).toContain(haileyMessages[0]?.conversationId)
    expect(hailey?.visibleConversationIds).not.toContain('dm:member:builder:member:reviewer')
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

  it('loads cold trace cursors and redirects a receipt source to its archived Session event', async () => {
    const requests: unknown[] = []
    const remote = {
      list: async () => ok([]),
      project: async input => {
        requests.push(input)
        const source = typeof input === 'object' && input !== null && 'sourceSessionId' in input
        return ok(source
          ? {
              events: [{
                sequence: 12,
                sessionId: 'old-session',
                createdAt: '2026-08-21T10:00:00.000Z',
                type: 'session.user/message',
                data: '{}',
              }],
              hasMore: false,
              targetSessionId: 'old-session',
              targetSequence: 12,
            }
          : {
              events: [],
              hasMore: true,
              previous: { segment: 1, beforeSeq: 40 },
            })
      },
      send: async () => ok({}), member: async () => ok({}), control: async () => ok({}),
      upload: async () => ok({}), uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
      archive: async () => ok({}),
    } satisfies FleetWebClient
    const panel = createFleetWebPanelSource(() => Promise.resolve(remote))

    const cold = await panel.loadMemberTrace('team-1', 'builder', undefined, {
      cursor: { segment: 1, beforeSeq: 80 },
    })
    const redirected = await panel.loadMemberTrace('team-1', 'builder', undefined, {
      source: { memberId: 'builder', sessionId: 'old-session', contextMessageId: 'message-old' },
    })

    expect(cold.previous).toEqual({ segment: 1, beforeSeq: 40 })
    expect(redirected.events).toEqual([expect.objectContaining({
      sessionId: 'old-session', sequence: 12, target: true,
    })])
    expect(requests).toEqual([
      expect.objectContaining({ archiveCursor: { segment: 1, beforeSeq: 80 }, tail: true }),
      expect.objectContaining({ sourceSessionId: 'old-session', contextMessageId: 'message-old' }),
    ])
    panel.dispose()
  })

  it('loads and updates member permission groups through Fleet Web', async () => {
    const memberCalls: unknown[] = []
    const projection = {
      run: { id: 'team-1' },
      view: { id: 'builder' },
      events: [],
      hasMore: false,
      authorization: {
        configured: false,
        assignment: {
          groups: ['observer'], grants: [], denies: [], toolGroups: [], denyToolGroups: [],
        },
        effective: { actions: ['message.read'], toolGroups: ['messages'], op: false },
        availableActions: ['message.read', 'message.wakeup'],
        availableToolGroups: ['messages', 'resources'],
        groups: [{
          id: 'observer', name: 'Observer', parents: [], preset: true,
          toolGroups: ['messages'], actions: ['message.read'],
        }],
      },
    }
    const remote = {
      list: async () => ok([]),
      project: async () => ok(projection),
      send: async () => ok({}),
      member: async input => {
        memberCalls.push(input)
        return ok({ ...projection.authorization, configured: true })
      },
      control: async () => ok({}),
      upload: async () => ok({}),
      uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
      archive: async () => ok({}),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    await expect(source.loadMemberAuthorization?.('team-1', 'builder')).resolves.toMatchObject({
      assignment: {
        groups: ['observer'], grants: [], denies: [], toolGroups: [], denyToolGroups: [], op: false,
      },
      availableActions: ['message.read', 'message.wakeup'],
      availableToolGroups: ['messages', 'resources'],
      effectiveActions: ['message.read'],
      groups: [{
        id: 'observer', name: 'Observer', toolGroups: ['messages'], actions: ['message.read'],
      }],
    })
    await expect(source.updateMemberPermissions?.({
      sessionId: 'ui-session', teamId: 'team-1', memberId: 'builder',
      assignment: {
        groups: ['observer'], grants: ['message.wakeup'], denies: [],
        toolGroups: ['resources'], denyToolGroups: [], op: false,
      },
    })).resolves.toMatchObject({ configured: true, assignment: { groups: ['observer'] } })
    expect(memberCalls).toEqual([{
      sessionId: 'ui-session', teamId: 'team-1', action: 'permissions', member: 'builder',
      assignment: {
        groups: ['observer'], grants: ['message.wakeup'], denies: [],
        toolGroups: ['resources'], denyToolGroups: [], op: false,
      },
    }])
    source.dispose()
  })

  it('loads and updates member resource Access through Fleet Web', async () => {
    const memberCalls: unknown[] = []
    const access = {
      resourceKinds: ['file', 'workspace'],
      modes: [
        { resourceKind: 'file', mode: 'restricted' },
        { resourceKind: 'workspace', mode: 'inherit' },
      ],
      rules: [{
        id: 'source', resourceKind: 'file', resourceId: 'workspace:src',
        scope: 'tree', effect: 'allow', levels: ['write'],
      }],
    }
    const remote = {
      list: async () => ok([]),
      project: async () => ok({}),
      send: async () => ok({}),
      member: async input => {
        memberCalls.push(input)
        return ok(access)
      },
      control: async () => ok({}),
      upload: async () => ok({}),
      uploadSetup: async () => ok({ path: '/tmp/file', label: 'file', size: 0 }),
      archive: async () => ok({}),
    } satisfies FleetWebClient
    const source = createFleetWebPanelSource(() => Promise.resolve(remote))

    await expect(source.loadMemberAccess?.({
      sessionId: 'ui-session', teamId: 'team-1', memberId: 'builder',
    })).resolves.toEqual(access)
    await expect(source.updateMemberAccess?.({
      sessionId: 'ui-session', teamId: 'team-1', memberId: 'builder',
      change: {
        action: 'add_rule', resourceKind: 'file', resourceId: 'src',
        scope: 'tree', effect: 'deny', levels: ['read'],
      },
    })).resolves.toEqual(access)
    expect(memberCalls).toEqual([
      { sessionId: 'ui-session', teamId: 'team-1', action: 'get_access', member: 'builder' },
      {
        sessionId: 'ui-session', teamId: 'team-1', member: 'builder', action: 'add_access_rule',
        accessRule: {
          resourceKind: 'file', resourceId: 'src', scope: 'tree', effect: 'deny', levels: ['read'],
        },
      },
    ])
    source.dispose()
  })
})
