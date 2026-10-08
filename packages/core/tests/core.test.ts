import { describe, expect, it, vi } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'

import { FleetCore } from '../src/core.js'
import { generateFleetMemberColor, normalizeFleetMemberColor } from '../src/names.js'
import type {
  AgentRuntime,
  CreateRuntimeAgentInput,
  RotateRuntimeAgentInput,
  RuntimeAgent,
  RuntimeAgentHandle,
  RuntimeRequestConfig,
} from '../src/types.js'

class FakeAgent implements RuntimeAgent {
  status: 'idle' | 'running' = 'idle'
  readonly cancellations: Array<{ readonly kind: 'user' | 'parent' }> = []
  readonly injected: UserMessage[] = []
  readonly followedUp: UserMessage[] = []
  readonly configurations: Array<RuntimeRequestConfig | undefined> = []

  constructor(readonly id: string) {}

  cancel(cause: { readonly kind: 'user' | 'parent' }): void {
    this.cancellations.push(cause)
    this.status = 'idle'
  }

  whenIdle(): Promise<void> {
    return Promise.resolve()
  }

  inject(message: UserMessage): void {
    this.injected.push(message)
  }

  followup(message: UserMessage): void {
    this.followedUp.push(message)
  }
}

class FakeRuntime implements AgentRuntime {
  readonly agents = new Map<string, FakeAgent>()
  readonly creates: CreateRuntimeAgentInput[] = []
  rotateTo: string | undefined

  add(id: string): FakeAgent {
    const agent = new FakeAgent(id)
    this.agents.set(id, agent)
    return agent
  }

  get(id: string): FakeAgent | undefined {
    return this.agents.get(id)
  }

  create(_owner: RuntimeAgent, input: CreateRuntimeAgentInput): Promise<RuntimeAgentHandle> {
    this.creates.push(input)
    const agent = this.add(input.id)
    return Promise.resolve({
      agent,
      configure: config => { agent.configurations.push(config) },
      dispose: async () => {
        this.agents.delete(agent.id)
      },
    })
  }

  rotate(handle: RuntimeAgentHandle, _input: RotateRuntimeAgentInput): Promise<RuntimeAgentHandle | undefined> {
    if (this.rotateTo === undefined) return Promise.resolve(undefined)
    this.agents.delete(handle.agent.id)
    const agent = this.add(this.rotateTo)
    return Promise.resolve({
      agent,
      dispose: async () => { this.agents.delete(agent.id) },
    })
  }
}

function setup(): {
  core: FleetCore
  runtime: FakeRuntime
  lead: FakeAgent
  reviewer: FakeAgent
} {
  const runtime = new FakeRuntime()
  const lead = runtime.add('lead-id')
  const reviewer = runtime.add('reviewer-id')
  return { core: new FleetCore(runtime), runtime, lead, reviewer }
}

describe('FleetCore', () => {
  it('generates persistent hex colors and normalizes the previous palette names', () => {
    expect(generateFleetMemberColor()).toMatch(/^#[0-9a-f]{6}$/)
    expect(normalizeFleetMemberColor('blue')).toBe('#527fca')
    expect(() => normalizeFleetMemberColor('not-a-color')).toThrow('#RRGGBB')
  })

  it('registers, lists, updates, and unregisters a live Agent', () => {
    const { core, lead } = setup()
    core.register(lead, {
      name: 'tech-lead',
      displayName: 'Ada',
      color: '#408f92',
      role: 'Technical lead',
      capabilities: ['planning', 'planning', 'review'],
    })

    expect(core.list()).toMatchObject([{
      id: 'lead-id',
      target: '@lead-id',
      name: 'tech-lead',
      displayName: 'Ada',
      color: '#408f92',
      status: 'idle',
      capabilities: ['planning', 'review'],
      managed: false,
    }])
    expect(core.update(lead, { role: 'Architecture lead' })).toMatchObject({
      role: 'Architecture lead',
    })
    expect(core.unregister(lead)).toMatchObject({ name: 'tech-lead' })
    expect(core.list()).toEqual([])
  })

  it('keeps Fleet names and native Agent identities unique', () => {
    const { core, lead, reviewer } = setup()
    core.register(lead, { name: 'builder', role: 'Builder' })

    expect(() => core.register(reviewer, { name: 'builder', role: 'Reviewer' })).toThrow('already exists')
    expect(() => core.register(lead, { name: 'lead-copy', role: 'Lead' })).toThrow('already registered')
  })

  it('resolves Fleet names while preserving native Agent targets', () => {
    const { core, lead } = setup()
    core.register(lead, { name: 'tech-lead', displayName: 'Ada', role: 'Lead' })

    expect(core.resolveTarget('@tech-lead')).toBe('@lead-id')
    expect(core.resolveTarget('@native-agent-id')).toBe('@native-agent-id')
    expect(core.nameForAgent('lead-id')).toBe('tech-lead')
    expect(core.displayNameForAgent('lead-id')).toBe('Ada')
    expect(core.nameForAgent('native-agent-id')).toBeUndefined()
  })

  it('keeps the first registered project root shared by the Fleet', () => {
    const { core } = setup()

    expect(core.bindProjectRoot('/repo')).toBe('/repo')
    expect(core.bindProjectRoot('/repo/.worktrees/reviewer')).toBe('/repo')
    expect(core.projectRoot()).toBe('/repo')
  })

  it('removes member metadata when the native Agent is disposed', () => {
    const { core, lead } = setup()
    core.register(lead, { name: 'tech-lead', role: 'Lead' })

    core.disposed(lead.id)
    expect(core.list()).toEqual([])
  })

  it('creates and stops a managed Agent through its creator', async () => {
    const { core, runtime, lead, reviewer } = setup()
    const created = await core.create(lead, {
      name: 'reviewer',
      displayName: 'Grace',
      color: '#bd6578',
      role: 'Code reviewer',
      capabilities: ['review'],
      cwd: '/workspace',
      model: 'deepseek-chat',
      persona: 'Review code independently.',
    })

    expect(created).toMatchObject({
      name: 'reviewer',
      displayName: 'Grace',
      color: '#bd6578',
      createdBy: 'lead-id',
      managed: true,
      status: 'idle',
    })
    expect(runtime.creates[0]).toMatchObject({
      label: 'Grace',
      cwd: '/workspace',
      model: 'deepseek-chat',
      persona: 'Review code independently.',
    })
    await expect(core.stop(reviewer, 'reviewer')).rejects.toThrow('only creator')
    await expect(core.stop(lead, 'reviewer')).resolves.toMatchObject({ status: 'offline' })
    expect(runtime.get(created.id)).toBeUndefined()
    expect(core.list()).toEqual([])
  })

  it('allows only the Agent or its creator to cancel active work', async () => {
    const { core, runtime, lead, reviewer } = setup()
    const created = await core.create(lead, { name: 'worker', role: 'Worker' })
    const worker = runtime.get(created.id)
    if (worker === undefined) throw new Error('expected created worker')
    worker.status = 'running'

    expect(() => core.cancel(reviewer, 'worker')).toThrow('cannot cancel')
    expect(core.cancel(lead, 'worker')).toMatchObject({ name: 'worker' })
    expect(worker.cancellations).toEqual([{ kind: 'parent' }])
  })

  it('updates a managed Agent request configuration without recreating it', async () => {
    const { core, runtime, lead } = setup()
    const created = await core.create(lead, { name: 'worker', role: 'Worker' })
    const worker = runtime.get(created.id)
    if (worker === undefined) throw new Error('expected created worker')

    core.configureManaged('worker', {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      maxTokens: 2_048,
    })

    expect(runtime.creates).toHaveLength(1)
    expect(core.get('worker')).toMatchObject({ id: created.id, status: 'idle' })
    expect(worker.configurations).toEqual([{
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      maxTokens: 2_048,
    }])
  })

  it('rebinds a managed member after an archive rotation', async () => {
    const { core, runtime, lead } = setup()
    const created = await core.create(lead, {
      archiveId: 'fleet/team/member/worker',
      name: 'worker',
      role: 'Worker',
    })
    runtime.rotateTo = 'worker-hot-segment'

    await expect(core.rotateManaged('worker')).resolves.toMatchObject({ id: 'worker-hot-segment' })
    expect(core.nameForAgent(created.id)).toBeUndefined()
    expect(core.nameForAgent('worker-hot-segment')).toBe('worker')
  })

  it.each(['stop', 'close'] as const)('disposes a rotation that finishes after %s', async action => {
    const { core, runtime, lead } = setup()
    await core.create(lead, { archiveId: 'archive', name: 'worker', role: 'Worker' })
    const pending = Promise.withResolvers<RuntimeAgentHandle | undefined>()
    runtime.rotate = vi.fn(() => pending.promise)
    const rotating = core.rotateManaged('worker')
    await expect(core.rotateManaged('worker')).rejects.toThrow('already rotating')
    if (action === 'stop') await core.stopManaged('worker')
    else await core.close()
    const agent = runtime.add('late-rotation')
    const dispose = vi.fn(async () => { runtime.agents.delete(agent.id) })
    pending.resolve({ agent, dispose })
    await expect(rotating).resolves.toBeUndefined()
    expect(dispose).toHaveBeenCalledOnce()
    expect(runtime.get(agent.id)).toBeUndefined()
    if (action === 'stop') expect(core.list()).toEqual([])
    else expect(() => core.list()).toThrow('stopped')
  })

  it('does not replace a newly created member when an older rotation completes', async () => {
    const { core, runtime, lead } = setup()
    await core.create(lead, { archiveId: 'archive', name: 'worker', role: 'Worker' })
    const pending = Promise.withResolvers<RuntimeAgentHandle | undefined>()
    runtime.rotate = () => pending.promise
    const rotating = core.rotateManaged('worker')
    await core.stopManaged('worker')
    const replacement = await core.create(lead, { name: 'worker', role: 'Replacement' })
    const agent = runtime.add('late-rotation')
    pending.resolve({ agent, dispose: async () => { runtime.agents.delete(agent.id) } })
    await rotating
    expect(core.get('worker').id).toBe(replacement.id)
    expect(runtime.get(agent.id)).toBeUndefined()
  })

  it('disposes a completed rotation while the original handle is still stopping', async () => {
    const { core, runtime, lead } = setup()
    const disposing = Promise.withResolvers<void>()
    const create = runtime.create.bind(runtime)
    runtime.create = async (owner, input) => ({ ...await create(owner, input), dispose: () => disposing.promise })
    await core.create(lead, { archiveId: 'archive', name: 'worker', role: 'Worker' })
    const pending = Promise.withResolvers<RuntimeAgentHandle | undefined>()
    runtime.rotate = () => pending.promise
    const rotating = core.rotateManaged('worker')
    const stopping = core.stopManaged('worker')
    const agent = runtime.add('rotated-while-stopping')
    const dispose = vi.fn(async () => { runtime.agents.delete(agent.id) })
    pending.resolve({ agent, dispose })
    await expect(rotating).resolves.toBeUndefined()
    expect(dispose).toHaveBeenCalledOnce()
    disposing.resolve()
    await stopping
    expect(core.list()).toEqual([])
  })

  it('blocks rotation during stop and keeps failed disposal retryable', async () => {
    const { core, runtime, lead } = setup()
    const pending = Promise.withResolvers<void>()
    const create = runtime.create.bind(runtime)
    const dispose = vi.fn(() => pending.promise)
    runtime.create = async (owner, input) => ({ ...await create(owner, input), dispose })
    await core.create(lead, { archiveId: 'archive', name: 'worker', role: 'Worker' })
    runtime.rotate = vi.fn()
    const stopping = core.stopManaged('worker')
    await expect(core.rotateManaged('worker')).resolves.toBeUndefined()
    expect(runtime.rotate).not.toHaveBeenCalled()
    const rejected = expect(stopping).rejects.toThrow('dispose failed')
    pending.reject(new Error('dispose failed'))
    await rejected
    expect(core.list()).toHaveLength(1)
    dispose.mockResolvedValue(undefined)
    await core.stopManaged('worker')
    expect(core.list()).toEqual([])
  })
})
