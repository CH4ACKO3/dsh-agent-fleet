import { Context } from '@deepseek-ai/cordis'
import { readFileSync, writeFileSync } from 'node:fs'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'

import type { FleetRunService } from '../src/run.js'
import type { FleetSetupService } from '../src/setup.js'
import type { FleetPermissionService } from '../src/authorization/permissions.js'
import { FLEET_WEB_INVOCATIONS, FleetWebRemote } from '../src/web.js'

describe('FleetWebRemote', () => {
  it('delegates directory, incremental projections, and resource previews to FleetRunService', async () => {
    const ctx = new Context()
    const runs = {
      list: vi.fn(() => [{ id: 'team-one' }]),
      readWebTeamProjection: vi.fn(() => ({ run: { id: 'team-one' }, memberViews: [], events: [], hasMore: false })),
      readMemberProjection: vi.fn(() => ({ run: { id: 'team-one' }, view: { id: 'lead' }, events: [], hasMore: false })),
      readMemberTrace: vi.fn(() => ({ run: { id: 'team-one' }, member: 'lead', events: [], hasMore: false })),
      readMemberTraceTail: vi.fn(() => ({ run: { id: 'team-one' }, member: 'lead', events: [], hasMore: false })),
      readMemberTracePage: vi.fn(() => ({ run: { id: 'team-one' }, member: 'lead', events: [], hasMore: false })),
      readConversationProjection: vi.fn(() => ({ run: { id: 'team-one' }, memberViews: [], events: [], hasMore: false })),
      exportConfiguration: vi.fn(() => ({ core: { name: 'Team One', members: [] }, modules: {} })),
      readResourcePreview: vi.fn(() => Promise.resolve({
        id: 'plan', kind: 'markdown', body: '# Plan', mediaType: 'text/markdown', history: [], historyTruncated: false,
      })),
    } as unknown as FleetRunService
    const setups = {} as FleetSetupService
    const remote = new FleetWebRemote(ctx, runs, setups)
    const signal = new AbortController().signal

    expect(remote.list(signal)).toEqual([{ id: 'team-one' }])
    expect(remote.project({ teamId: 'team-one', afterSequence: 4, limit: 20 }, signal))
      .toMatchObject({ run: { id: 'team-one' }, events: [] })
    expect(remote.project({ teamId: 'team-one', view: 'member', member: 'lead' }, signal))
      .toMatchObject({ view: { id: 'lead' }, events: [] })
    expect(remote.project({ teamId: 'team-one', view: 'trace', member: 'lead' }, signal))
      .toMatchObject({ member: 'lead', events: [] })
    expect(remote.project({ teamId: 'team-one', view: 'trace', member: 'lead', tail: true, limit: 80 }, signal))
      .toMatchObject({ member: 'lead', events: [] })
    expect(remote.project({ teamId: 'team-one', view: 'conversation', conversation: '#general', beforeSequence: 40 }, signal))
      .toMatchObject({ run: { id: 'team-one' }, events: [] })
    expect(remote.project({ teamId: 'team-one', view: 'configuration' }, signal))
      .toMatchObject({ core: { name: 'Team One' } })
    await expect(remote.project({ teamId: 'team-one', view: 'resource', resource: 'plan' }, signal))
      .resolves.toMatchObject({ id: 'plan', kind: 'markdown', body: '# Plan' })
    await remote.project({ teamId: 'team-one', view: 'resource', resource: 'plan', revision: 'rev-one' }, signal)
    expect(runs.readWebTeamProjection).toHaveBeenCalledWith('team-one', 4, 20)
    expect(runs.readMemberProjection).toHaveBeenCalledWith('team-one', 'lead', 0, 200)
    expect(runs.readMemberTrace).toHaveBeenCalledWith('team-one', 'lead', -1, 200)
    expect(runs.readMemberTracePage).toHaveBeenCalledWith('team-one', 'lead', 80, undefined, signal)
    expect(runs.readConversationProjection).toHaveBeenCalledWith('team-one', '#general', 40, 200)
    expect(runs.exportConfiguration).toHaveBeenCalledWith('team-one')
    expect(runs.readResourcePreview).toHaveBeenNthCalledWith(1, 'team-one', 'plan', signal, undefined)
    expect(runs.readResourcePreview).toHaveBeenNthCalledWith(2, 'team-one', 'plan', signal, 'rev-one')
    expect(FLEET_WEB_INVOCATIONS.map(invocation => invocation.method))
      .toEqual(['list', 'project', 'send', 'member', 'control', 'upload', 'uploadSetup', 'archive'])
    expect(FLEET_WEB_INVOCATIONS.every(invocation =>
      invocation.result.mode === 'strict'
      && invocation.parameters.every(parameter => parameter.codec.mode === 'strict'),
    )).toBe(true)
  })

  it('rejects invalid paging and observes cancellation before touching the business service', () => {
    const ctx = new Context()
    const runs = { list: vi.fn(() => []) } as unknown as FleetRunService
    const remote = new FleetWebRemote(ctx, runs, {} as FleetSetupService)
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))

    expect(() => remote.list(controller.signal)).toThrow('cancelled')
    expect(runs.list).not.toHaveBeenCalled()
    expect(() => remote.project({ teamId: 'team-one', limit: 0 }, new AbortController().signal))
      .toThrow('limit must be from 1 through 500')
  })

  it('projects and updates permission groups through the existing member endpoint', () => {
    const caller = { id: 'ui-session' } as Agent
    const ctx = new Context()
    Object.defineProperty(ctx, 'agents', { value: { get: vi.fn(() => caller) } })
    const runs = {
      readMemberProjection: vi.fn(() => ({ run: { id: 'team-one' }, view: { id: 'lead' }, events: [], hasMore: false })),
      requireAssistantConnection: vi.fn(() => ({
        sessionId: 'ui-session',
        view: { id: 'assistant', toolGroups: [], permissions: [] },
      })),
    } as unknown as FleetRunService
    const authorization = {
      inspectMember: vi.fn(() => ({
        configured: false,
        assignment: { groups: [], grants: [], denies: [], toolGroups: [], denyToolGroups: [] },
        effective: { actions: ['message.read'], toolGroups: ['messages'], op: false },
        groups: [{ id: 'observer', name: 'Observer', parents: [], preset: true, toolGroups: [], actions: [] }],
      })),
      setMemberGroups: vi.fn(() => ({ configured: true, assignment: { groups: ['observer'] } })),
      resetMember: vi.fn(),
      canManage: vi.fn(() => true),
    } as unknown as FleetPermissionService
    const remote = new FleetWebRemote(ctx, runs, {} as FleetSetupService, authorization)
    const signal = new AbortController().signal

    expect(remote.project({ teamId: 'team-one', view: 'member', member: 'lead' }, signal))
      .toMatchObject({ authorization: { effective: { actions: ['message.read'] } } })
    expect(remote.member({
      sessionId: 'ui-session', teamId: 'team-one', action: 'permissions', member: 'lead', groups: ['observer'],
    }, signal)).toEqual({ configured: true, assignment: { groups: ['observer'] } })
    expect(authorization.setMemberGroups).toHaveBeenCalledWith('team-one', 'lead', ['observer'])
    remote.member({
      sessionId: 'ui-session', teamId: 'team-one', action: 'reset_permissions', member: 'lead',
    }, signal)
    expect(authorization.resetMember).toHaveBeenCalledWith('team-one', 'lead')
    expect(runs.requireAssistantConnection).toHaveBeenCalledTimes(2)
    expect(authorization.canManage).toHaveBeenCalledTimes(2)

    authorization.canManage.mockReturnValue(false)
    expect(() => remote.member({
      sessionId: 'ui-session', teamId: 'team-one', action: 'permissions', member: 'lead', groups: ['observer'],
    }, signal)).toThrow('cannot manage permissions')
    expect(authorization.setMemberGroups).toHaveBeenCalledTimes(1)
  })

  it('sends direct UI conversations as the external user without attaching the current Session', () => {
    const ctx = new Context()
    const runs = {
      sendUserConversationMessage: vi.fn(() => ({ messageId: 'message-one', recipients: 1, woken: 0 })),
      requireAssistantConnection: vi.fn(),
      sendAssistantMessage: vi.fn(),
    } as unknown as FleetRunService
    const remote = new FleetWebRemote(ctx, runs, {} as FleetSetupService)
    const signal = new AbortController().signal

    expect(remote.send({
      sessionId: 'ui-session',
      teamId: 'team-one',
      mode: 'conversation',
      to: '@member-session',
      text: 'A direct message from the user.',
    }, signal)).toEqual({ messageId: 'message-one', recipients: 1, woken: 0 })
    expect(runs.sendUserConversationMessage).toHaveBeenCalledWith({
      runId: 'team-one',
      to: '@member-session',
      text: 'A direct message from the user.',
      delivery: 'quiet',
    })
    expect(runs.requireAssistantConnection).not.toHaveBeenCalled()

    remote.send({
      sessionId: 'ui-session',
      teamId: 'team-one',
      mode: 'conversation',
      to: '#general',
      text: '@reviewer stop using the stale branch.',
      mentions: ['@reviewer'],
      delivery: 'interrupt',
    }, signal)
    expect(runs.sendUserConversationMessage).toHaveBeenLastCalledWith({
      runId: 'team-one',
      to: '#general',
      text: '@reviewer stop using the stale branch.',
      mentions: ['@reviewer'],
      delivery: 'interrupt',
    })
  })

  it('routes lightweight member request configuration without a structural update', async () => {
    const caller = { id: 'ui-session' } as Agent
    const ctx = new Context()
    Object.defineProperty(ctx, 'agents', { value: { get: vi.fn(() => caller) } })
    const configured = {
      member: { name: 'lead', sessionId: 'lead-session', status: 'running' },
      request: { provider: 'provider-new', model: 'model-new' },
      effectiveFrom: 'next-model-step' as const,
    }
    const runs = {
      requireAssistantConnection: vi.fn(() => ({ view: { id: 'assistant' } })),
      configureMember: vi.fn(() => Promise.resolve(configured)),
    } as unknown as FleetRunService
    const remote = new FleetWebRemote(ctx, runs, {} as FleetSetupService)

    await expect(remote.member({
      sessionId: 'ui-session',
      teamId: 'team-one',
      action: 'configure',
      member: 'lead',
      request: { provider: 'provider-new', model: 'model-new', maxTokens: null },
    }, new AbortController().signal)).resolves.toEqual(configured)
    expect(runs.configureMember).toHaveBeenCalledWith(caller, {
      runId: 'team-one',
      member: 'lead',
      request: { provider: 'provider-new', model: 'model-new', maxTokens: null },
    })
  })

  it('resolves an Agent only for assistant relay messages', () => {
    const caller = { id: 'ui-session' } as Agent
    const ctx = new Context()
    Object.defineProperty(ctx, 'agents', { value: { get: vi.fn(() => caller) } })
    const runs = {
      requireAssistantConnection: vi.fn(),
      sendAssistantMessage: vi.fn(),
    } as unknown as FleetRunService
    const remote = new FleetWebRemote(ctx, runs, {} as FleetSetupService)
    const signal = new AbortController().signal

    remote.send({
      sessionId: 'ui-session',
      teamId: 'team-one',
      mode: 'relay',
      text: 'Ask the attached assistant to relay this.',
    }, signal)
    expect(runs.requireAssistantConnection).toHaveBeenCalledWith(caller, 'team-one')
    expect(runs.sendAssistantMessage).toHaveBeenCalledWith(caller, {
      runId: 'team-one',
      kind: 'collaboration',
      text: 'Ask the attached assistant to relay this.',
    })
  })

  it('routes an explicit Team wake through the existing control endpoint', () => {
    const caller = { id: 'ui-session' } as Agent
    const ctx = new Context()
    Object.defineProperty(ctx, 'agents', { value: { get: vi.fn(() => caller) } })
    const runs = {
      status: vi.fn(() => ({ id: 'team-one', status: 'running', runtimeState: 'active' })),
      requireAssistantConnection: vi.fn(),
      wakeTeam: vi.fn(() => ({ id: 'team-one', status: 'running' })),
    } as unknown as FleetRunService
    const remote = new FleetWebRemote(ctx, runs, {} as FleetSetupService)

    expect(remote.control({
      sessionId: 'ui-session', teamId: 'team-one', action: 'wake',
    }, new AbortController().signal)).toEqual({ id: 'team-one', status: 'running' })
    expect(runs.requireAssistantConnection).toHaveBeenCalledWith(caller, 'team-one', false)
    expect(runs.wakeTeam).toHaveBeenCalledWith(caller, 'team-one')
  })

  it('streams complete Team archives in bounded Web chunks', async () => {
    const caller = { id: 'ui-session', session: { header: { cwd: '/workspace' } } } as unknown as Agent
    const ctx = new Context()
    Object.defineProperty(ctx, 'agents', { value: { get: vi.fn(() => caller) } })
    const runs = {
      exportArchive: vi.fn(async (_caller: Agent, input: { destination: string; runId: string; includeWorkspace: boolean }) => {
        writeFileSync(input.destination, Buffer.from('archive payload'))
        return { path: input.destination, teamId: input.runId, includesWorkspace: input.includeWorkspace, extensions: [] }
      }),
      importArchive: vi.fn(async (_caller: Agent, input: { archivePath: string; projectRoot: string }) => ({
        run: { id: 'team-one', status: 'paused' },
        extensions: { missing: [], failed: [] },
        payload: readFileSync(input.archivePath, 'utf8'),
        projectRoot: input.projectRoot,
      })),
    } as unknown as FleetRunService
    const remote = new FleetWebRemote(ctx, runs, {} as FleetSetupService)
    const signal = new AbortController().signal

    const started = await remote.archive({
      sessionId: 'ui-session', action: 'export', teamId: 'team-one', includeWorkspace: true,
    }, signal) as { transferId: string; size: number }
    const downloaded = await remote.archive({
      sessionId: 'ui-session', action: 'read', transferId: started.transferId, offset: 0,
    }, signal) as { base64: string; nextOffset: number; done: boolean }
    expect(Buffer.from(downloaded.base64, 'base64').toString()).toBe('archive payload')
    expect(downloaded).toMatchObject({ nextOffset: started.size, done: true })

    const upload = await remote.archive({
      sessionId: 'ui-session', action: 'begin_import', name: 'team.fleet.tar.gz',
    }, signal) as { transferId: string }
    const written = await remote.archive({
      sessionId: 'ui-session', action: 'write', transferId: upload.transferId,
      offset: 0, base64: Buffer.from('import payload').toString('base64'),
    }, signal) as { nextOffset: number }
    expect(written.nextOffset).toBe(14)
    await expect(remote.archive({
      sessionId: 'ui-session', action: 'finish_import', transferId: upload.transferId,
      projectRoot: '/restored', importMode: 'copy',
    }, signal)).resolves.toMatchObject({ payload: 'import payload', projectRoot: '/restored' })
    expect(runs.importArchive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: 'copy' }))
  })

})
