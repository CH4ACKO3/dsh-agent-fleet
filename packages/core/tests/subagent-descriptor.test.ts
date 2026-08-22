import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'

import { apply } from '../src/index.js'
import type { FleetCore, RuntimeAgent } from '../src/index.js'

function runtimeAgent(id: string, session = Session.create(SessionId(id))): RuntimeAgent & { session: Session } {
  return {
    id,
    session,
    status: 'idle',
    cancel() {},
    whenIdle: () => Promise.resolve(),
    inject() {},
    followup() {},
  }
}

interface ArchiveStub {
  attach(logicalId: string, sessionId: string): Promise<unknown>
  find(logicalId: string): Promise<{
    readonly activeSessionId: string
    readonly segments: readonly { readonly sessionId: string }[]
  } | undefined>
  resume(logicalId: string, options: ResumeAgentOptions): Promise<AgentHandle>
}

function setup(archive?: ArchiveStub): {
  core: FleetCore
  owner: RuntimeAgent
  created: CreateAgentOptions[]
  resumed: ResumeAgentOptions[]
  resumedSessions: Session[]
} {
  const owner = {
    ...runtimeAgent('owner'),
    ctx: { get: () => undefined },
    options: { provider: 'test-provider', model: 'test-model' },
  } as unknown as Agent
  const created: CreateAgentOptions[] = []
  const resumed: ResumeAgentOptions[] = []
  const resumedSessions: Session[] = []
  let core: FleetCore | undefined
  const childContext = (agent: RuntimeAgent & { session: Session }) => ({
    agent,
    get: () => undefined,
    systemPrompt: { context() {}, section() {} },
    tools: { restrict() {} },
  }) as unknown as Context
  const ctx = {
    agents: {
      get: (id: string) => id === String(owner.id) ? owner : undefined,
      async create(options: CreateAgentOptions) {
        created.push(options)
        const child = runtimeAgent(String(options.sessionId), Session.create(options.sessionId, options.seed))
        await options.setup?.(childContext(child))
        return { agent: child, dispose: () => Promise.resolve() }
      },
      async resume(options: ResumeAgentOptions) {
        resumed.push(options)
        const child = runtimeAgent(String(options.resumeSessionId))
        resumedSessions.push(child.session)
        await options.setup?.(childContext(child))
        return { agent: child, dispose: () => Promise.resolve() }
      },
    },
    tools: { register() {} },
    get(name: string) {
      return name === 'sessionArchive' ? archive : undefined
    },
    provide(name: string, value: unknown) {
      if (name === 'fleetCore') core = value as FleetCore
    },
    on() {},
    effect() {},
  } as unknown as Context
  apply(ctx)
  if (core === undefined) throw new Error('Fleet Core was not provided')
  return { core, owner, created, resumed, resumedSessions }
}

describe('Fleet native subagent metadata', () => {
  it('seeds new members with a durable continuable descriptor', async () => {
    const { core, owner, created } = setup()

    await core.create(owner, { name: 'reviewer', displayName: 'Grace', role: 'Reviewer' })

    expect(foldSubagentDescriptor(created[0]?.seed ?? [])).toMatchObject({
      mode: 'continuable',
      provider: 'dsh-agent-fleet',
      label: 'Grace',
      agentProvider: 'test-provider',
      agentModel: 'test-model',
    })
  })

  it('adds the missing descriptor while an old member is unpublished for resume', async () => {
    const { core, owner, resumed, resumedSessions } = setup()

    await core.resume(owner, {
      id: 'legacy-member',
      name: 'reviewer',
      displayName: 'Grace',
      color: '#527fca',
      role: 'Reviewer',
    })

    expect(resumed).toHaveLength(1)
    expect(foldSubagentDescriptor(resumedSessions[0]?.events ?? [])).toMatchObject({
      mode: 'continuable',
      provider: 'dsh-agent-fleet',
      label: 'Grace',
    })
  })

  it('uses an installed Session Archive for stable logical member resume', async () => {
    const attach = vi.fn(async () => undefined)
    const find = vi.fn(async () => ({
      activeSessionId: 'current-segment',
      segments: [{ sessionId: 'legacy-member' }, { sessionId: 'current-segment' }],
    }))
    const archiveResume = vi.fn(async (_logicalId: string, options: ResumeAgentOptions) => {
      const child = runtimeAgent('current-segment')
      await options.setup?.({
        agent: child,
        get: () => undefined,
        systemPrompt: { context() {}, section() {} },
        tools: { restrict() {} },
      } as unknown as Context)
      return { agent: child, dispose: () => Promise.resolve() } as unknown as AgentHandle
    })
    const { core, owner, resumed } = setup({ attach, find, resume: archiveResume })

    const member = await core.resume(owner, {
      id: 'legacy-member',
      archiveId: 'fleet/team/member/reviewer',
      name: 'reviewer',
      displayName: 'Grace',
      color: '#527fca',
      role: 'Reviewer',
    })

    expect(member.id).toBe('current-segment')
    expect(find).toHaveBeenCalledWith('fleet/team/member/reviewer')
    expect(archiveResume).toHaveBeenCalledWith('fleet/team/member/reviewer', expect.objectContaining({ setup: expect.any(Function) }))
    expect(resumed).toEqual([])
    expect(attach).not.toHaveBeenCalled()
  })

  it('attaches newly created members when Session Archive is installed', async () => {
    const attach = vi.fn(async () => undefined)
    const { core, owner } = setup({
      attach,
      find: vi.fn(async () => undefined),
      resume: vi.fn(),
    })

    const member = await core.create(owner, {
      archiveId: 'fleet/team/member/reviewer',
      name: 'reviewer',
      displayName: 'Grace',
      role: 'Reviewer',
    })

    expect(attach).toHaveBeenCalledWith('fleet/team/member/reviewer', member.id)
  })
})
