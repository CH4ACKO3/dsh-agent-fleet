import { describe, expect, it } from 'vitest'
import type { UserMessage } from '@deepseek-ai/dsh-session'

import { FleetCore } from '../src/core.js'
import type {
  AgentRuntime,
  CreateRuntimeAgentInput,
  RuntimeAgent,
  RuntimeAgentHandle,
} from '../src/types.js'

class FakeAgent implements RuntimeAgent {
  status: 'idle' | 'running' = 'idle'
  readonly cancellations: Array<{ readonly kind: 'user' | 'parent' }> = []
  readonly injected: UserMessage[] = []
  readonly followedUp: UserMessage[] = []

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
      dispose: async () => {
        this.agents.delete(agent.id)
      },
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
  it('registers, lists, updates, and unregisters a live Agent', () => {
    const { core, lead } = setup()
    core.register(lead, {
      name: 'tech-lead',
      role: 'Technical lead',
      capabilities: ['planning', 'planning', 'review'],
    })

    expect(core.list()).toMatchObject([{
      id: 'lead-id',
      target: '@lead-id',
      name: 'tech-lead',
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
    core.register(lead, { name: 'tech-lead', role: 'Lead' })

    expect(core.resolveTarget('@tech-lead')).toBe('@lead-id')
    expect(core.resolveTarget('@native-agent-id')).toBe('@native-agent-id')
    expect(core.nameForAgent('lead-id')).toBe('tech-lead')
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
      role: 'Code reviewer',
      capabilities: ['review'],
      cwd: '/workspace',
      model: 'deepseek-chat',
      persona: 'Review code independently.',
    })

    expect(created).toMatchObject({
      name: 'reviewer',
      createdBy: 'lead-id',
      managed: true,
      status: 'idle',
    })
    expect(runtime.creates[0]).toMatchObject({
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
})
