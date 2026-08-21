import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { FleetCore } from '@dsh-agent-fleet/core'
import type {
  AgentRuntime,
  CreateRuntimeAgentInput,
  ResumeRuntimeAgentInput,
  RuntimeAgent,
  RuntimeAgentHandle,
} from '@dsh-agent-fleet/core'
import { MessageHub } from '@dsh-agent-fleet/message'
import { FleetResources } from '@dsh-agent-fleet/resources'
import { afterEach, describe, expect, it } from 'vitest'

import { connectRunObservers, FleetRunService } from '../src/run.js'

interface FakeEvent {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: unknown
}

class FakeAgent implements RuntimeAgent {
  status: 'idle' | 'running' = 'idle'
  readonly options: { readonly provider?: string; readonly model?: string; readonly maxTokens?: number }
  readonly messages: UserMessage[] = []
  readonly session: {
    readonly header: { readonly cwd: string }
    readonly events: FakeEvent[]
  }

  constructor(
    readonly id: string,
    cwd: string,
    options: { readonly provider?: string; readonly model?: string; readonly maxTokens?: number } = {},
  ) {
    this.options = options
    this.session = { header: { cwd }, events: [] }
  }

  cancel(): void {
    this.status = 'idle'
  }

  whenIdle(): Promise<void> {
    return Promise.resolve()
  }

  inject(message: UserMessage): void {
    this.accept(message)
  }

  followup(message: UserMessage): void {
    this.accept(message)
  }

  private accept(message: UserMessage): void {
    this.messages.push(message)
    this.session.events.push({
      seq: this.session.events.length,
      time: Date.now(),
      type: 'user/message',
      data: { message },
    })
  }
}

class FakeRuntime implements AgentRuntime {
  readonly agents = new Map<string, FakeAgent>()
  readonly creates: CreateRuntimeAgentInput[] = []
  readonly resumes: ResumeRuntimeAgentInput[] = []

  add(
    id: string,
    cwd: string,
    options: { readonly provider?: string; readonly model?: string; readonly maxTokens?: number } = {},
  ): FakeAgent {
    const agent = new FakeAgent(id, cwd, options)
    this.agents.set(id, agent)
    return agent
  }

  get(id: string): FakeAgent | undefined {
    return this.agents.get(id)
  }

  create(_owner: RuntimeAgent, input: CreateRuntimeAgentInput): Promise<RuntimeAgentHandle> {
    this.creates.push(input)
    const agent = this.add(input.id, input.cwd ?? '')
    return Promise.resolve({
      agent,
      dispose: async () => { this.agents.delete(agent.id) },
    })
  }

  resume(_owner: RuntimeAgent, input: ResumeRuntimeAgentInput): Promise<RuntimeAgentHandle> {
    this.resumes.push(input)
    const agent = this.add(input.id, '')
    return Promise.resolve({
      agent,
      dispose: async () => { this.agents.delete(agent.id) },
    })
  }
}

const containment: Pick<FileSystem, 'contains'> = {
  contains(parent, child) {
    const path = relative(parent.displayPath, child.displayPath)
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`))
  },
}

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true })
})

function fixture(): {
  readonly root: string
  readonly configPath: string
  readonly taskPath: string
} {
  const root = mkdtempSync(join(tmpdir(), 'fleet-run-test-'))
  temporaryDirectories.push(root)
  const configPath = join(root, 'team.json')
  const taskPath = join(root, 'task.md')
  writeFileSync(configPath, JSON.stringify({
    team: 'coding-small',
    name: 'Small Team',
    startup_coordinator: 'lead',
    operating_prompt: 'Work as peers and finish through a Vote.',
    channels: [{
      id: 'main',
      name: 'Main',
      initial_message: 'Open a kickoff meeting.',
      summary: 'Kickoff',
      body: 'Backlog: deliver one file.',
    }],
    members: [
      {
        id: 'lead',
        name: 'Lead',
        identity: { role: 'lead', prompt: 'Coordinate the first round.' },
        access: { channels: { read: ['main'], write: ['main'] } },
      },
      {
        id: 'reviewer',
        name: 'Reviewer',
        identity: { role: 'reviewer', prompt: 'Review independently.' },
        access: { channels: { read: ['main'], write: ['main'] } },
      },
    ],
  }))
  writeFileSync(taskPath, '# Task\n\nCreate and review result.txt.\n')
  return { root, configPath, taskPath }
}

function setup(root: string, options?: {
  readonly launcherId?: string
  readonly launcherOptions?: { readonly provider?: string; readonly model?: string; readonly maxTokens?: number }
  readonly persisted?: Map<string, FakeEvent[]>
}): {
  readonly service: FleetRunService
  readonly core: FleetCore
  readonly messages: MessageHub
  readonly resources: FleetResources
  readonly runtime: FakeRuntime
  readonly launcher: FakeAgent
  readonly persisted: Map<string, FakeEvent[]>
  disconnect(): void
} {
  const runtime = new FakeRuntime()
  const launcher = runtime.add(options?.launcherId ?? 'launcher', root, options?.launcherOptions)
  const core = new FleetCore(runtime)
  const messages = new MessageHub({
    get: id => core.nameForAgent(id) === undefined ? undefined : runtime.get(id),
    list: () => [...runtime.agents.values()].filter(agent => core.nameForAgent(agent.id) !== undefined),
    resolve: reference => core.resolveTarget(reference).slice(1),
    displayName: id => core.nameForAgent(id),
  })
  const resources = new FleetResources(containment)
  const persisted = options?.persisted ?? new Map<string, FakeEvent[]>()
  const context = {
    get: (name: string) => name === 'sessionPersistence'
      ? {
          inspect: (id: string) => Promise.resolve({ events: persisted.get(id) ?? [] }),
        }
      : undefined,
    agents: { get: (id: string) => runtime.get(id) },
    sessions: {
      flush: (session: FakeAgent['session']) => {
        const agent = [...runtime.agents.values()].find(candidate => candidate.session === session)
        if (agent !== undefined) persisted.set(agent.id, structuredClone(session.events))
        return Promise.resolve()
      },
    },
  } as unknown as Context
  const service = new FleetRunService(context, core, messages, resources)
  const disconnect = connectRunObservers(service, messages, resources)
  return { service, core, messages, resources, runtime, launcher, persisted, disconnect }
}

describe('FleetRunService', () => {
  it('loads a Team, injects member personas and task context, then persists a terminal trace', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, core, messages, runtime, launcher, persisted, disconnect } = setup(root)

    const run = await service.start(launcher as unknown as Agent, {
      configPath,
      taskPath,
      projectRoot: root,
      requiredPaths: [],
    })

    expect(run).toMatchObject({
      status: 'running',
      coordinator: 'lead',
      members: [{ name: 'lead' }, { name: 'reviewer' }],
    })
    expect(runtime.creates.map(create => create.persona)).toEqual([
      expect.stringContaining('You are @lead'),
      expect.stringContaining('You are @reviewer'),
    ])
    expect(runtime.get(run.members[0]?.sessionId ?? '')?.messages[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Create and review result.txt.'),
    })
    expect(messages.listChannels(runtime.get(run.members[0]?.sessionId ?? '') ?? launcher)
      .find(channel => channel.id === 'main')).toMatchObject({
      id: 'main',
      summary: 'Kickoff',
      body: 'Backlog: deliver one file.',
    })

    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    const vote = messages.createVote(lead, {
      channel: '#main',
      kind: 'finish',
      statement: 'result.txt was independently reviewed.',
    })
    messages.castVote(reviewer, { id: vote.id, response: 'approve' })

    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({
      status: 'finished',
      settled: true,
      summary: 'result.txt was independently reviewed.',
    })
    expect(persisted.size).toBe(2)
    expect(core.list()).toEqual([])
    expect(service.readTrace(run.id, 0, 100).events.map(event => event.type)).toContain('coordination.vote')
    const memberTrace = await service.readMemberTrace(run.id, 'reviewer', -1, 100)
    expect(memberTrace.events).toContainEqual(expect.objectContaining({ type: 'session.user/message' }))
    expect(readFileSync(join(root, '.fleet', 'runs', run.id, 'run.json'), 'utf8')).toContain('"settled": true')
    disconnect()
  })

  it('records a blocked run without creating Agents when preflight paths are missing', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const required = join(root, 'missing-corpus')

    const run = await service.start(launcher as unknown as Agent, {
      configPath,
      taskPath,
      projectRoot: root,
      requiredPaths: [required],
    })

    expect(run).toMatchObject({ status: 'blocked', settled: true, members: [] })
    expect(run.summary).toContain(required)
    expect(runtime.creates).toEqual([])
    expect(service.readTrace(run.id, 0, 20).events.map(event => event.type)).toEqual([
      'run_started',
      'run_status',
    ])
    disconnect()
  })

  it('resumes the same member Sessions and restores collaboration state after a process restart', async () => {
    const { root, configPath, taskPath } = fixture()
    const first = setup(root)
    const run = await first.service.start(first.launcher as unknown as Agent, {
      configPath,
      taskPath,
      projectRoot: root,
      requiredPaths: [],
      provider: 'test-provider',
      model: 'test-model',
    })
    const leadId = run.members.find(member => member.name === 'lead')?.sessionId ?? ''
    const reviewerId = run.members.find(member => member.name === 'reviewer')?.sessionId ?? ''
    const lead = first.runtime.get(leadId)
    if (lead === undefined) throw new Error('expected live lead')
    first.messages.send(lead, {
      to: '#main',
      text: 'Implementation is half complete.',
      delivery: 'quiet',
    })
    const resource = first.resources.addResource(leadId, {
      path: join(root, 'result.bin'),
      label: 'partial output',
      mediaType: 'application/octet-stream',
    })
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    const coordinationBefore = first.service.readTrace(run.id, 0, 100).events
      .filter(event => event.type.startsWith('coordination.')).length
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })

    expect(resumed).toMatchObject({
      id: run.id,
      status: 'running',
      settled: false,
      launcherSessionId: 'replacement-launcher',
    })
    expect(second.runtime.resumes).toEqual([
      expect.objectContaining({ id: leadId, provider: 'test-provider', model: 'test-model' }),
      expect.objectContaining({ id: reviewerId, provider: 'test-provider', model: 'test-model' }),
    ])
    expect(second.core.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'lead', id: leadId, managed: true }),
      expect.objectContaining({ name: 'reviewer', id: reviewerId, managed: true }),
    ]))
    const resumedLead = second.runtime.get(leadId)
    const resumedReviewer = second.runtime.get(reviewerId)
    if (resumedLead === undefined || resumedReviewer === undefined) throw new Error('expected resumed members')
    expect(second.messages.read(resumedReviewer, { conversation: '#main' }).messages)
      .toContainEqual(expect.objectContaining({ text: 'Implementation is half complete.' }))
    expect(second.resources.getResource(resource.id)).toEqual(resource)
    expect(resumedLead.messages).toHaveLength(1)
    expect(resumedReviewer.messages).toHaveLength(1)
    expect(second.service.readTrace(run.id, 0, 100).events
      .filter(event => event.type.startsWith('coordination.'))).toHaveLength(coordinationBefore)
    expect(second.service.readTrace(run.id, 0, 100).events.at(-1)?.type).toBe('run_resumed')

    second.service.finish(second.launcher as unknown as Agent, 'cancelled', 'Resume test complete.')
    await expect(second.service.wait(run.id, 1_000)).resolves.toMatchObject({ settled: true })
    second.disconnect()
  })

  it('uses and persists the replacement launcher route when resuming a legacy run', async () => {
    const { root, configPath, taskPath } = fixture()
    const first = setup(root)
    const run = await first.service.start(first.launcher as unknown as Agent, {
      configPath,
      taskPath,
      projectRoot: root,
      requiredPaths: [],
    })
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    const runPath = join(root, '.fleet', 'runs', run.id, 'run.json')
    const legacyRecord = JSON.parse(readFileSync(runPath, 'utf8')) as Record<string, unknown>
    delete legacyRecord.agentOptions
    writeFileSync(runPath, `${JSON.stringify(legacyRecord, null, 2)}\n`)
    first.disconnect()
    await first.core.close()

    const second = setup(root, {
      launcherId: 'replacement-launcher',
      launcherOptions: { provider: 'fallback-provider', model: 'fallback-model', maxTokens: 4_096 },
      persisted: first.persisted,
    })
    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })

    expect(second.runtime.resumes).toEqual([
      expect.objectContaining({ provider: 'fallback-provider', model: 'fallback-model', maxTokens: 4_096 }),
      expect.objectContaining({ provider: 'fallback-provider', model: 'fallback-model', maxTokens: 4_096 }),
    ])
    expect(resumed.agentOptions).toEqual({
      provider: 'fallback-provider',
      model: 'fallback-model',
      maxTokens: 4_096,
    })
    expect(JSON.parse(readFileSync(runPath, 'utf8'))).toMatchObject({ agentOptions: resumed.agentOptions })

    second.service.finish(second.launcher as unknown as Agent, 'cancelled', 'Legacy resume route test complete.')
    await expect(second.service.wait(run.id, 1_000)).resolves.toMatchObject({ settled: true })
    second.disconnect()
  })

  it('completes an interrupted start by resuming attached members and creating the missing members', async () => {
    const { root, configPath, taskPath } = fixture()
    const first = setup(root)
    const run = await first.service.start(first.launcher as unknown as Agent, {
      configPath,
      taskPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = run.members.find(member => member.name === 'lead')
    if (lead === undefined) throw new Error('expected lead member')
    first.persisted.set(lead.sessionId, structuredClone(first.runtime.get(lead.sessionId)?.session.events ?? []))
    const runPath = join(root, '.fleet', 'runs', run.id, 'run.json')
    const eventsPath = join(root, '.fleet', 'runs', run.id, 'events.jsonl')
    writeFileSync(runPath, `${JSON.stringify({
      ...JSON.parse(readFileSync(runPath, 'utf8')),
      members: [lead],
      status: 'starting',
    }, null, 2)}\n`)
    const startupEvents = readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as { readonly type: string; readonly data: { readonly name?: string } })
      .filter(event => event.type === 'run_started' || (event.type === 'member_attached' && event.data.name === 'lead'))
    writeFileSync(eventsPath, `${startupEvents.map(event => JSON.stringify(event)).join('\n')}\n`)
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })

    expect(resumed).toMatchObject({ status: 'running', settled: false })
    expect(second.runtime.resumes).toEqual([expect.objectContaining({ id: lead.sessionId })])
    expect(second.runtime.creates).toHaveLength(1)
    expect(resumed.members.map(member => member.name)).toEqual(['lead', 'reviewer'])
    const resumedLead = second.runtime.get(lead.sessionId)
    if (resumedLead === undefined) throw new Error('expected resumed lead')
    expect(second.messages.listChannels(resumedLead).map(channel => channel.id)).toContain('main')
    expect(resumed.members.every(member =>
      second.runtime.get(member.sessionId)?.messages.some(message =>
        message.content[0]?.type === 'text' && message.content[0].text.includes('Create and review result.txt.'),
      ) === true,
    )).toBe(true)
    expect(second.service.readTrace(run.id, 0, 100).events.map(event => event.type)).toEqual(expect.arrayContaining([
      'run_resumed',
      'run_status',
    ]))
    second.disconnect()
  })

  it('settles a terminal run whose cleanup was interrupted by a process restart', async () => {
    const { root, configPath, taskPath } = fixture()
    const first = setup(root)
    const run = await first.service.start(first.launcher as unknown as Agent, {
      configPath,
      taskPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const runPath = join(root, '.fleet', 'runs', run.id, 'run.json')
    writeFileSync(runPath, `${JSON.stringify({
      ...JSON.parse(readFileSync(runPath, 'utf8')),
      status: 'cancelled',
      settled: false,
      summary: 'Cancelled before cleanup completed.',
      endedAt: new Date().toISOString(),
    }, null, 2)}\n`)
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    await expect(second.service.wait(run.id, 1_000, undefined, root)).resolves.toMatchObject({
      status: 'cancelled',
      settled: true,
    })
    expect(second.service.readTrace(run.id, 0, 100).events.at(-1)).toMatchObject({
      type: 'run_settled',
      data: JSON.stringify({ recoveredAfterRestart: true }),
    })
    second.disconnect()
  })
})
