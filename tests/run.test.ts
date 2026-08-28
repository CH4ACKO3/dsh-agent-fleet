import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import type { Agent, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, UserMessage } from '@deepseek-ai/dsh-session'
import { FleetCore } from '@dsh-agent-fleet/core'
import type {
  AgentRuntime,
  CreateRuntimeAgentInput,
  ResumeRuntimeAgentInput,
  RuntimeAgent,
  RuntimeAgentHandle,
  RuntimeRequestConfig,
} from '@dsh-agent-fleet/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FleetRunService } from '../src/run.js'
import type { FleetResourcePreview, FleetRunMember } from '../src/run.js'
import { FleetArchiveRegistry } from '../src/archive.js'
import { FleetAuthorizationService } from '../src/authorization.js'
import { FleetCollaborationService } from '../src/collaboration.js'
import { activateResidentFleetAssistants } from '../src/resident-assistants.js'
import { normalizeFleetSetupConfiguration } from '../src/setup.js'

interface FakeEvent {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: unknown
}

type FakeWaterfallListener = (...args: unknown[]) => unknown

class FakeAgentContext {
  private readonly listeners = new Map<string, FakeWaterfallListener[]>()

  on(name: string, listener: FakeWaterfallListener): () => void {
    const listeners = this.listeners.get(name) ?? []
    listeners.push(listener)
    this.listeners.set(name, listeners)
    return () => {
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    }
  }

  async assemble(base: { readonly variables: Record<string, unknown> }): Promise<{ readonly variables: Record<string, unknown> }> {
    let next = () => Promise.resolve(base)
    for (const listener of [...(this.listeners.get('system-prompt/assemble') ?? [])].reverse()) {
      const following = next
      next = () => Promise.resolve(listener({}, {}, following) as Promise<typeof base>)
    }
    return next()
  }

  async request(base: RuntimeRequestConfig): Promise<RuntimeRequestConfig> {
    let next = () => Promise.resolve(base)
    for (const listener of [...(this.listeners.get('agent/request') ?? [])].reverse()) {
      const following = next
      next = () => Promise.resolve(listener({}, following) as Promise<RuntimeRequestConfig>)
    }
    return next()
  }
}

class FakeAgent implements RuntimeAgent {
  status: 'idle' | 'running' = 'idle'
  cancelCount = 0
  readonly options: { readonly provider?: string; readonly model?: string; readonly maxTokens?: number }
  readonly messages: UserMessage[] = []
  readonly requestConfigurations: Array<RuntimeRequestConfig | undefined> = []
  ctx?: Context
  readonly inbox = {
    nextTurn: [] as UserMessage[],
    nextStep: [] as UserMessage[],
    clear: (): void => {
      this.inbox.nextTurn.length = 0
      this.inbox.nextStep.length = 0
    },
  }
  private readonly idleWaiters: Array<() => void> = []
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
    this.cancelCount += 1
    this.completeTurn()
  }

  whenIdle(): Promise<void> {
    if (this.status === 'idle') return Promise.resolve()
    return new Promise(resolvePromise => { this.idleWaiters.push(resolvePromise) })
  }

  inject(message: UserMessage): void {
    this.inbox.nextStep.push(message)
    this.accept(message)
  }

  followup(message: UserMessage): void {
    this.inbox.nextTurn.push(message)
    this.accept(message)
  }

  completeTurn(): void {
    this.status = 'idle'
    for (const resolvePromise of this.idleWaiters.splice(0)) resolvePromise()
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

  constructor(
    private readonly resumeInboxes: ReadonlyMap<string, {
      readonly nextTurn?: readonly UserMessage[]
      readonly nextStep?: readonly UserMessage[]
    }> = new Map(),
    private readonly resumedIds: ReadonlyMap<string, string> = new Map(),
  ) {}

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
    const agent = this.add(input.id, input.cwd ?? '', {
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    })
    return Promise.resolve({
      agent,
      configure: config => { agent.requestConfigurations.push(config) },
      dispose: async () => { this.agents.delete(agent.id) },
    })
  }

  resume(_owner: RuntimeAgent, input: ResumeRuntimeAgentInput): Promise<RuntimeAgentHandle> {
    this.resumes.push(input)
    const agent = this.add(this.resumedIds.get(input.id) ?? input.id, '', {
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    })
    const pending = this.resumeInboxes.get(input.id)
    if (pending !== undefined) {
      agent.inbox.nextTurn.push(...(pending.nextTurn ?? []))
      agent.inbox.nextStep.push(...(pending.nextStep ?? []))
    }
    return Promise.resolve({
      agent,
      configure: config => { agent.requestConfigurations.push(config) },
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
  vi.useRealTimers()
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true })
})

function teamConfiguration(input: {
  readonly name: string
  readonly positioning?: string
  readonly defaultChannel?: { readonly id: string; readonly name: string }
  readonly rules?: string
  readonly collaborationMethod?: string
  readonly resourcePolicy?: string
  readonly sharedResources?: readonly object[]
  readonly userAccess?: object
  readonly assistant?: object
  readonly members?: readonly object[]
  readonly modules?: Readonly<Record<string, unknown>>
}): object {
  return {
    core: {
      name: input.name,
      positioning: input.positioning ?? '',
      assistant: input.assistant ?? {
        id: 'team-assistant', name: 'Assistant', color: '#64748b', role: 'Team assistant',
        responsibilities: 'Maintain the user-facing Team conversation.', prompt: '',
      },
      members: input.members ?? [],
    },
    modules: {
      ...input.modules,
      'dsh-agent-fleet/message': {
        defaultChannel: input.defaultChannel ?? { id: 'main', name: 'Main' },
        rules: input.rules ?? '',
        collaborationMethod: input.collaborationMethod ?? '',
      },
      'dsh-agent-fleet/resources': {
        policy: input.resourcePolicy ?? '',
        items: input.sharedResources ?? [],
      },
      'dsh-agent-fleet/ui': {
        userAccess: input.userAccess ?? {
          updateDensity: 'concise', notificationPolicy: 'decisions', contentPreference: '',
        },
      },
    },
  }
}

function fixture(): {
  readonly root: string
  readonly configPath: string
  readonly taskPath: string
} {
  const root = mkdtempSync(join(tmpdir(), 'fleet-run-test-'))
  temporaryDirectories.push(root)
  const configPath = join(root, 'team.json')
  const taskPath = join(root, 'task.md')
  writeFileSync(configPath, JSON.stringify(teamConfiguration({
    name: 'Small Team',
    positioning: 'Work as peers and finish through a Vote.',
    defaultChannel: { id: 'main', name: 'Main' },
    rules: '',
    collaborationMethod: '',
    resourcePolicy: '',
    sharedResources: [],
    userAccess: {
      updateDensity: 'balanced',
      notificationPolicy: 'milestones',
      contentPreference: '',
    },
    members: [
      {
        id: 'lead',
        name: 'Lead',
        color: '#527fca',
        role: 'lead',
        responsibilities: 'Coordinate the first round.',
        prompt: 'Coordinate the first round.',
        toolGroups: ['messages', 'coordination', 'resources', 'status', 'schedule', 'tasks', 'calendar', 'documents', 'external-service'],
        permissions: ['channel.manage', 'meeting.manage', 'vote.create', 'resource.write', 'schedule.create', 'task.manage', 'calendar.manage', 'document.write'],
        contacts: { members: '*', channels: ['main'] },
      },
      {
        id: 'reviewer',
        name: 'Reviewer',
        color: '#7c68bd',
        role: 'reviewer',
        responsibilities: 'Review independently.',
        prompt: 'Review independently.',
        toolGroups: ['messages', 'coordination', 'resources', 'status', 'schedule', 'tasks', 'calendar', 'documents', 'external-service'],
        permissions: ['meeting.manage', 'vote.create', 'resource.write', 'schedule.create', 'task.manage', 'calendar.manage', 'document.write'],
        contacts: { members: '*', channels: ['main'] },
      },
    ],
  })))
  writeFileSync(taskPath, '# Task\n\nCreate and review result.txt.\n')
  return { root, configPath, taskPath }
}

function setup(root: string, options?: {
  readonly launcherId?: string
  readonly launcherOptions?: { readonly provider?: string; readonly model?: string; readonly maxTokens?: number }
  readonly persisted?: Map<string, FakeEvent[]>
  readonly persistedHeaders?: Map<string, SessionHeader>
  readonly archives?: FleetArchiveRegistry
  readonly sessionArchive?: unknown
  readonly resumeInboxes?: ReadonlyMap<string, {
    readonly nextTurn?: readonly UserMessage[]
    readonly nextStep?: readonly UserMessage[]
  }>
  readonly resumedIds?: ReadonlyMap<string, string>
}): {
  readonly service: FleetRunService
  readonly core: FleetCore
  readonly runtime: FakeRuntime
  readonly launcher: FakeAgent
  readonly persisted: Map<string, FakeEvent[]>
  readonly persistedHeaders: Map<string, SessionHeader>
  readonly context: Context
  readonly authorization: FleetAuthorizationService
  disconnect(): void
} {
  const runtime = new FakeRuntime(options?.resumeInboxes, options?.resumedIds)
  const launcher = runtime.add(options?.launcherId ?? 'launcher', root, options?.launcherOptions)
  const core = new FleetCore(runtime)
  const persisted = options?.persisted ?? new Map<string, FakeEvent[]>()
  const persistedHeaders = options?.persistedHeaders ?? new Map<string, SessionHeader>()
  const context = new Context()
  context.provide('sessionPersistence', {
    inspect: (id: string) => {
      const agent = runtime.get(id)
      const meta = persistedHeaders.get(id) ?? (agent === undefined ? undefined : {
        version: 0,
        id: SessionId(id),
        createdAt: 0,
        cwd: agent.session.header.cwd,
      })
      return Promise.resolve({ ...(meta === undefined ? {} : { meta }), events: persisted.get(id) ?? [] })
    },
    list: () => Promise.resolve([...persistedHeaders.values()]),
    create: (meta: SessionHeader) => {
      persistedHeaders.set(String(meta.id), structuredClone(meta))
      return Promise.resolve()
    },
    append: (id: string, events: readonly FakeEvent[]) => {
      persisted.set(id, structuredClone([...events]))
      return Promise.resolve()
    },
  })
  context.provide('agents', { get: (id: string) => runtime.get(id) })
  context.provide('sessions', {
    flush: (session: FakeAgent['session']) => {
      const agent = [...runtime.agents.values()].find(candidate => candidate.session === session)
      if (agent !== undefined) {
        persisted.set(agent.id, structuredClone(session.events))
        persistedHeaders.set(agent.id, {
          version: 0,
          id: SessionId(agent.id),
          createdAt: 0,
          cwd: agent.session.header.cwd,
        })
      }
      return Promise.resolve()
    },
  })
  context.provide('llm', {
    resolveCallConfig: (config: RuntimeRequestConfig) => Promise.resolve(structuredClone(config)),
  })
  context.provide('fs', {
    ...containment,
    resolve: async (path: string) => {
      const resolved = realpathSync(path)
      return { targetKey: resolved, displayPath: resolved }
    },
    stat: async (target: FsTarget) => {
      if (!existsSync(target.displayPath)) return undefined
      const info = statSync(target.displayPath)
      return {
        version: `${String(info.mtimeMs)}:${String(info.size)}`,
        type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    },
    readBytes: async (target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number) => {
      const bytes = readFileSync(target.displayPath)
      if (bytes.byteLength > maxBytes) throw new Error('file too large')
      return bytes
    },
  })
  if (options?.sessionArchive !== undefined) context.provide('sessionArchive', options.sessionArchive)
  const authorization = new FleetAuthorizationService()
  const collaboration = new FleetCollaborationService(context, authorization)
  const service = new FleetRunService(context, core, collaboration, {
    registryDirectory: join(root, '.fleet-registry'),
    ...(options?.archives === undefined ? {} : { archives: options.archives }),
    authorization,
  })
  authorization.installBaseline(service.authorizationBaseline())
  return {
    service,
    core,
    runtime,
    launcher,
    persisted,
    persistedHeaders,
    context,
    authorization,
    disconnect: () => {
      service.close()
      void context.fiber.dispose()
    },
  }
}

describe('FleetRunService', () => {
  it('injects filesystem access before installing foreground assistant resource tools', async () => {
    const { root, configPath } = fixture()
    const configuration = JSON.parse(readFileSync(configPath, 'utf8')) as {
      core: { assistant: { toolGroups?: string[] } }
    }
    configuration.core.assistant.toolGroups = ['messages', 'resources']
    writeFileSync(configPath, JSON.stringify(configuration))
    const { service, launcher, context, disconnect } = setup(root)
    const registered = new Map<string, unknown>()
    context.provide('tools', {
      register: (tool: { readonly name: string }) => {
        registered.set(tool.name, tool)
        return () => { registered.delete(tool.name) }
      },
      restrict: () => () => {},
      guard: () => () => {},
      get: (name: string) => registered.get(name),
    })
    await context.plugin((scope) => {
      launcher.ctx = scope
    })

    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    expect(run).toMatchObject({
      status: 'idle',
      assistants: [expect.objectContaining({
        view: expect.objectContaining({ toolGroups: expect.arrayContaining(['resources']) }),
      })],
    })
    expect(registered.has('fleet_messages')).toBe(true)
    expect(registered.has('fleet_tools')).toBe(true)
    disconnect()
  })

  it('interrupts a Team assistant without pausing or disconnecting it', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistant = run.assistants[0]
    if (assistant === undefined) throw new Error('expected Team assistant')
    const release = vi.fn(() => Promise.resolve(false))
    const restore = vi.fn(() => Promise.resolve())
    service.setResidentAssistantController({ release, restore })
    launcher.status = 'running'

    await expect(service.pauseMember(launcher as unknown as Agent, run.id, assistant.view.id))
      .resolves.toMatchObject({ name: assistant.view.id, status: 'idle' })
    expect(launcher.cancelCount).toBe(1)
    expect(service.status(run.id).assistants[0]).toMatchObject({ status: 'idle' })
    expect(service.requireAssistantConnection(launcher as unknown as Agent, run.id).view.id).toBe(assistant.view.id)
    expect(release).not.toHaveBeenCalled()
    expect(restore).not.toHaveBeenCalled()
    await expect(service.resumeMemberAsExternal(launcher as unknown as Agent, run.id, assistant.view.id))
      .rejects.toThrow('already online and can reply')
    disconnect()
  })

  it('does not persist an assistant interruption as a paused assistant', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistant = run.assistants[0]
    if (assistant === undefined) throw new Error('expected Team assistant')
    first.launcher.status = 'running'
    await first.service.pauseMember(first.launcher as unknown as Agent, run.id, assistant.view.id)
    first.disconnect()
    await first.core.close()

    const persisted = JSON.parse(readFileSync(join(dirname(run.configPath), 'run.json'), 'utf8')) as {
      assistants: Array<{ view: { id: string }; status?: string }>
    }
    expect(persisted.assistants.find(candidate => candidate.view.id === assistant.view.id))
      .not.toMatchObject({ status: 'paused' })

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    const activate = vi.fn()
    const sessionStarted = vi.spyOn(second.service, 'agentSessionStarted')
    const resume = vi.fn(async (options: ResumeAgentOptions) => {
      const agent = second.runtime.add(String(options.resumeSessionId), root)
      await options.setup?.({ agent } as unknown as Context)
      return {
        agent,
        dispose: async () => { second.runtime.agents.delete(agent.id) },
      }
    })
    const residents = await activateResidentFleetAssistants({
      agents: {
        get: (id: string) => second.runtime.get(String(id)),
        resume,
      },
      logger: () => ({ warn: vi.fn() }),
    } as unknown as Context, second.service, { activate } as never)
    second.service.setResidentAssistantController(residents)

    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: assistant.sessionId }))
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({ id: assistant.sessionId }), run.id, assistant.view)
    expect(sessionStarted).toHaveBeenCalledWith(expect.objectContaining({ id: assistant.sessionId }))
    expect(second.service.status(run.id).assistants[0]).toMatchObject({ status: 'idle' })

    await residents.dispose()
    second.disconnect()
  })

  it('notifies web observers after durable and live member changes', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    let changes = 0
    const traceChanges: Array<{ readonly teamId: string; readonly memberId: string }> = []
    const unsubscribe = service.subscribeChanges(() => { changes += 1 })
    const unsubscribeTrace = service.subscribeTraceChanges((teamId, memberId) => {
      traceChanges.push({ teamId, memberId })
    })
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    expect(changes).toBeGreaterThan(0)

    const member = runtime.get(run.members[0]?.sessionId ?? '')
    if (member === undefined) throw new Error('expected Fleet member')
    const afterCreate = changes
    member.status = 'running'
    service.agentStatusChanged(member as unknown as Agent)
    expect(changes).toBe(afterCreate + 1)

    service.recordMemberSessionEvent(member.id, {
      type: 'tool/call', seq: 1, time: Date.now(),
      data: { callId: 'call-1', name: 'fleet_status', arguments: '{}' },
    })
    expect(traceChanges).toEqual([{ teamId: run.id, memberId: run.members[0]?.name ?? '' }])

    unsubscribe()
    unsubscribeTrace()
    service.agentStatusChanged(member as unknown as Agent)
    expect(changes).toBe(afterCreate + 1)
    disconnect()
  })

  it('uses member display names in messages and accepts them as message targets', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const leadMember = run.members.find(member => member.name === 'lead')
    const reviewerMember = run.members.find(member => member.name === 'reviewer')
    const lead = runtime.get(leadMember?.sessionId ?? '')
    const reviewer = runtime.get(reviewerMember?.sessionId ?? '')
    if (leadMember?.displayName === undefined || reviewerMember?.displayName === undefined
      || lead === undefined || reviewer === undefined) throw new Error('expected Fleet peers')
    expect(service.authorizationBaseline().actorForAgent?.(leadMember.sessionId)).toEqual({
      teamId: run.id,
      subject: { kind: 'member', id: 'lead' },
    })

    service.messageHub(run.id).send(lead, {
      to: `@${reviewerMember.displayName}`,
      text: 'Please review this using our visible names.',
      delivery: 'quiet',
    })

    expect(reviewer.inbox.nextStep.at(-1)?.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining(`from=@${leadMember.displayName}`) }),
    ])
    expect(service.messageHub(run.id).read(reviewer, { conversation: `@${leadMember.displayName}` }).messages)
      .toContainEqual(expect.objectContaining({ fromName: leadMember.displayName }))
    expect(runtime.creates.find(input => input.label === leadMember.displayName)?.persona)
      .toContain(`You are @${leadMember.displayName}`)

    service.end(launcher as unknown as Agent, 'Display name messaging test complete.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('materializes blank preset member identities once before persisting a run', async () => {
    const { root, configPath } = fixture()
    const preset = JSON.parse(readFileSync(configPath, 'utf8')) as {
      core: { members: Array<{ name: string; color: string }> }
    }
    for (const member of preset.core.members) {
      member.name = ''
      member.color = ''
    }
    writeFileSync(configPath, JSON.stringify(preset))
    const { service, launcher, disconnect } = setup(root)

    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const names = run.members.map(member => member.displayName ?? '')
    const colors = run.members.map(member => member.color ?? '')
    const stored = JSON.parse(readFileSync(run.configPath, 'utf8')) as {
      core: { members: Array<{ name: string; color: string }> }
    }

    expect(names.every(Boolean)).toBe(true)
    expect(new Set(names).size).toBe(run.members.length)
    expect(colors.every(color => /^#[0-9a-f]{6}$/u.test(color))).toBe(true)
    expect(new Set(colors).size).toBe(run.members.length)
    expect(stored.core.members.map(member => member.name)).toEqual(names)
    expect(stored.core.members.map(member => member.color)).toEqual(colors)

    service.end(launcher as unknown as Agent, 'Generated identity test complete.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('creates a persistent Team with only its fixed configured assistant', async () => {
    const { root } = fixture()
    const configPath = join(root, 'assistant-only.json')
    writeFileSync(configPath, JSON.stringify(teamConfiguration({
      name: 'Assistant-only Team',
      defaultChannel: { id: 'main', name: 'Main' },
      userAccess: { updateDensity: 'concise', notificationPolicy: 'decisions' },
      assistant: {
        id: 'team-assistant',
        name: 'Sage',
        color: '#6b7280',
        role: 'Team assistant',
        responsibilities: 'Help the user assemble and operate the Team.',
        prompt: 'Keep setup lightweight.',
      },
      members: [],
    })))
    const { service, launcher, disconnect } = setup(root)

    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })

    expect(run).toMatchObject({
      status: 'idle',
      members: [],
      assistants: [{
        sessionId: launcher.id,
        view: {
          id: 'team-assistant',
          name: 'Sage',
          color: '#6b7280',
          role: 'Team assistant',
          responsibility: 'Help the user assemble and operate the Team.',
          prompt: 'Keep setup lightweight.',
        },
      }],
    })
    disconnect()
  })

  it('exports the current Team configuration through the setup import path', async () => {
    const { root, configPath } = fixture()
    const configured = JSON.parse(readFileSync(configPath, 'utf8')) as {
      core: { members: Array<Record<string, unknown>> }
    }
    const first = configured.core.members[0]
    if (first === undefined) throw new Error('expected a configured member')
    first.toolGroups = ['messages', 'coordination']
    first.permissions = ['vote.create']
    first.contacts = { members: '*', channels: ['main'] }
    writeFileSync(configPath, JSON.stringify(configured))
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = service.memberViews(run.id).find(member => member.id === 'lead')
    if (lead === undefined) throw new Error('expected lead member')
    await service.updateMember(launcher as unknown as Agent, {
      runId: run.id,
      member: lead.id,
      view: { ...lead, role: 'exported lead' },
    })

    const exported = service.exportConfiguration(run.id)
    expect(exported).toMatchObject({
      core: {
        name: 'Small Team',
        members: expect.arrayContaining([expect.objectContaining({
          id: 'lead',
          role: 'exported lead',
          toolGroups: ['messages', 'coordination'],
          permissions: ['vote.create'],
          contacts: { members: '*', channels: ['main'] },
        })]),
      },
      modules: {
        'dsh-agent-fleet/resources': { items: [] },
      },
      fleetExport: {
        format: 'team-configuration',
        sourceTeamId: run.id,
        exportedAt: expect.any(String),
      },
    })
    expect(normalizeFleetSetupConfiguration(exported)).toMatchObject({
      core: {
        members: expect.arrayContaining([expect.objectContaining({
          id: 'lead',
          toolGroups: ['messages', 'coordination'],
          permissions: ['vote.create'],
          contacts: { members: '*', channels: ['main'] },
        })]),
      },
    })

    service.end(launcher as unknown as Agent, 'Team export test complete.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('updates durable Team settings and queues the current guidance for loaded participants', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })

    expect(service.teamSettings(run.id)).toMatchObject({
      name: 'Small Team',
      positioning: 'Work as peers and finish through a Vote.',
      updateDensity: 'balanced',
      notificationPolicy: 'milestones',
      projectRoot: root,
    })

    const updated = service.configureTeamSettings(launcher as unknown as Agent, {
      runId: run.id,
      settings: {
        name: 'Runtime Team',
        positioning: 'Own the active runtime.',
        rules: 'Verify user-visible changes.',
        collaborationMethod: 'Coordinate through the main Channel.',
        updateDensity: 'detailed',
        notificationPolicy: 'decisions',
        contentPreference: 'Lead with outcomes.',
      },
    })

    expect(updated).toMatchObject({
      name: 'Runtime Team',
      positioning: 'Own the active runtime.',
      rules: 'Verify user-visible changes.',
      collaborationMethod: 'Coordinate through the main Channel.',
      updateDensity: 'detailed',
      notificationPolicy: 'decisions',
      contentPreference: 'Lead with outcomes.',
    })
    expect(service.status(run.id).name).toBe('Runtime Team')
    expect(service.exportConfiguration(run.id)).toMatchObject({
      core: { name: 'Runtime Team', positioning: 'Own the active runtime.' },
      modules: {
        'dsh-agent-fleet/message': {
          rules: 'Verify user-visible changes.',
          collaborationMethod: 'Coordinate through the main Channel.',
        },
        'dsh-agent-fleet/ui': { userAccess: {
          updateDensity: 'detailed', notificationPolicy: 'decisions', contentPreference: 'Lead with outcomes.',
        } },
      },
    })
    for (const member of run.members) {
      expect(runtime.get(member.sessionId)?.messages.at(-1)?.content).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('Own the active runtime.') }),
      ]))
    }
    expect(service.readTrace(run.id, 0, 100).events).toContainEqual(expect.objectContaining({
      type: 'team_settings_configured',
    }))

    service.end(launcher as unknown as Agent, 'Team settings verified.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('tracks and enforces shared Team and independent member token budgets', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root, {
      launcherOptions: { provider: 'provider-one', model: 'model-one', maxTokens: 512 },
    })
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
      provider: 'provider-one',
      model: 'model-one',
    })
    const scoped = new FakeAgentContext()
    launcher.ctx = scoped as unknown as Context
    await service.attachAssistant(launcher as unknown as Agent, { runId: run.id })
    const assistant = service.status(run.id).assistants.find(candidate => candidate.sessionId === launcher.id)
    if (assistant === undefined) throw new Error('expected attached Team assistant')

    service.configureBudget(launcher as unknown as Agent, {
      runId: run.id, scope: 'team', limit: 100,
    })
    service.configureBudget(launcher as unknown as Agent, {
      runId: run.id, scope: 'member', member: assistant.view.id, limit: 60,
    })
    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: { id: 'assistant-message', role: 'assistant', content: [], source: { provider: 'provider-one', model: 'model-one' } },
        usage: { inputTokens: 20, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 5, reasoningTokens: 7 },
      },
    } as unknown as SessionEvent)

    expect(service.teamBudget(run.id)).toMatchObject({
      mode: 'tokens',
      team: { limit: 100, used: 50, reasoningTokens: 7, calls: 1, remaining: 50 },
      members: expect.arrayContaining([expect.objectContaining({
        memberId: assistant.view.id, limit: 60, used: 50, state: 'warning', remaining: 10,
      })]),
    })
    await expect(scoped.request({ provider: 'provider-one', model: 'model-one', maxTokens: 512 }))
      .resolves.toMatchObject({ maxTokens: 10 })

    service.recordMemberSessionEvent(launcher.id, {
      seq: 2,
      time: Date.now(),
      type: 'compaction/summary',
      data: { provider: 'provider-one', model: 'model-one', usage: { inputTokens: 2, outputTokens: 3 } },
    } as unknown as SessionEvent)
    expect(service.teamBudget(run.id).members.find(member => member.memberId === assistant.view.id)).toMatchObject({
      used: 55, remaining: 5, state: 'danger',
    })
    await expect(scoped.request({ provider: 'provider-one', model: 'model-one', maxTokens: 512 }))
      .resolves.toMatchObject({ maxTokens: 5 })

    service.recordMemberSessionEvent(launcher.id, {
      seq: 3,
      time: Date.now() + 1,
      type: 'compaction/summary',
      data: { provider: 'provider-one', model: 'model-one', usage: { inputTokens: 2, outputTokens: 3 } },
    } as unknown as SessionEvent)
    await expect(scoped.request({ provider: 'provider-one', model: 'model-one', maxTokens: 512 }))
      .rejects.toThrow('member')

    const memberReset = service.configureBudget(launcher as unknown as Agent, {
      runId: run.id, scope: 'member', member: assistant.view.id, reset: true,
    })
    expect(memberReset.team).toMatchObject({ used: 60, remaining: 40 })
    expect(memberReset.members.find(member => member.memberId === assistant.view.id)).toMatchObject({
      used: 0, remaining: 60,
    })
    await expect(scoped.request({ provider: 'provider-one', model: 'model-one', maxTokens: 512 }))
      .resolves.toMatchObject({ maxTokens: 40 })

    const teamReset = service.configureBudget(launcher as unknown as Agent, {
      runId: run.id, scope: 'team', reset: true,
    })
    expect(teamReset.team).toMatchObject({ limit: 100, used: 0, remaining: 100 })
    expect(teamReset.members.find(member => member.memberId === assistant.view.id)).toMatchObject({
      limit: 60, used: 0, remaining: 60,
    })
    expect(JSON.parse(readFileSync(join(root, '.fleet-registry', run.id, 'run.json'), 'utf8')))
      .toMatchObject({ budget: { mode: 'tokens', team: { limit: 100 }, members: [expect.objectContaining({ memberId: assistant.view.id, limit: 60 })] } })

    const costMode = service.configureBudget(launcher as unknown as Agent, {
      runId: run.id,
      scope: 'team',
      accounting: {
        mode: 'cost',
        rates: [
          { provider: 'provider-one', model: 'model-one', inputUsdPerMillion: 2, outputUsdPerMillion: 4, cacheReadUsdPerMillion: 1, cacheWriteUsdPerMillion: 3 },
          { provider: 'provider-two', model: 'model-one', inputUsdPerMillion: 20, outputUsdPerMillion: 40, cacheReadUsdPerMillion: 10, cacheWriteUsdPerMillion: 30 },
        ],
      },
    })
    expect(costMode).toMatchObject({ mode: 'cost', team: { used: 0, state: 'unlimited' } })
    service.configureBudget(launcher as unknown as Agent, { runId: run.id, scope: 'team', limit: 1_000_000 })
    service.recordMemberSessionEvent(launcher.id, {
      seq: 4,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        turn: 2,
        step: 1,
        message: { id: 'cost-message', role: 'assistant', content: [], source: { provider: 'provider-one', model: 'model-one' } },
        usage: { inputTokens: 20, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 5 },
      },
    } as unknown as SessionEvent)
    expect(service.teamBudget(run.id).team).toMatchObject({
      used: 140,
      models: [expect.objectContaining({ provider: 'provider-one', model: 'model-one', charged: 140 })],
    })
    await expect(scoped.request({ provider: 'provider-two', model: 'model-one', maxTokens: 512 }))
      .resolves.toMatchObject({ provider: 'provider-two', model: 'model-one', maxTokens: 512 })
    await expect(scoped.request({ provider: 'provider-three', model: 'model-one', maxTokens: 512 }))
      .rejects.toThrow('requires prices for provider-three / model-one')
    disconnect()
  })

  it('keeps event-time charges and removed member usage in the Team budget', async () => {
    const { root, configPath } = fixture()
    const { service, core, launcher, disconnect } = setup(root, {
      launcherOptions: { provider: 'provider-one', model: 'model-one' },
    })
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
      provider: 'provider-one',
      model: 'model-one',
    })
    launcher.ctx = new FakeAgentContext() as unknown as Context
    await service.attachAssistant(launcher as unknown as Agent, { runId: run.id })
    const lead = service.status(run.id).members.find(member => member.name === 'lead')
    if (lead === undefined) throw new Error('expected lead member')

    service.configureBudget(launcher as unknown as Agent, {
      runId: run.id,
      scope: 'team',
      accounting: {
        mode: 'tokens',
        rates: [
          { provider: 'provider-one', model: 'model-one', multiplier: 2 },
          { provider: 'provider-two', model: 'model-two', multiplier: 4 },
        ],
      },
    })
    service.recordMemberSessionEvent(lead.sessionId, {
      seq: 1,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        message: { id: 'first-rate', role: 'assistant', content: [], source: { provider: 'provider-one', model: 'model-one' } },
        usage: { inputTokens: 10, outputTokens: 0 },
      },
    } as unknown as SessionEvent)

    expect(service.configureBudget(launcher as unknown as Agent, {
      runId: run.id,
      scope: 'team',
      accounting: {
        mode: 'tokens',
        rates: [
          { provider: 'provider-one', model: 'model-one', multiplier: 3 },
          { provider: 'provider-two', model: 'model-two', multiplier: 4 },
        ],
      },
    }).team.used).toBe(20)
    service.recordMemberSessionEvent(lead.sessionId, {
      seq: 2,
      time: Date.now() + 1,
      type: 'assistant/message',
      data: {
        turn: 2,
        step: 1,
        message: { id: 'changed-rate', role: 'assistant', content: [], source: { provider: 'provider-one', model: 'model-one' } },
        usage: { inputTokens: 10, outputTokens: 0 },
      },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(lead.sessionId, {
      seq: 3,
      time: Date.now() + 2,
      type: 'assistant/message',
      data: {
        turn: 3,
        step: 1,
        message: { id: 'changed-model', role: 'assistant', content: [], source: { provider: 'provider-two', model: 'model-two' } },
        usage: { inputTokens: 10, outputTokens: 0 },
      },
    } as unknown as SessionEvent)

    expect(service.teamBudget(run.id).members.find(member => member.memberId === lead.name)).toMatchObject({
      used: 90,
      inputTokens: 30,
      models: [
        expect.objectContaining({ provider: 'provider-one', model: 'model-one', charged: 50 }),
        expect.objectContaining({ provider: 'provider-two', model: 'model-two', charged: 40 }),
      ],
    })

    await service.removeMember(launcher as unknown as Agent, run.id, lead.name)
    expect(service.status(run.id).members.some(member => member.name === lead.name)).toBe(false)
    expect(service.teamBudget(run.id).members.find(member => member.memberId === lead.name)).toMatchObject({
      memberId: lead.name,
      name: lead.displayName,
      role: lead.role,
      color: lead.color,
      assistant: false,
      active: false,
      used: 90,
      inputTokens: 30,
    })
    expect(JSON.parse(readFileSync(join(root, '.fleet-registry', run.id, 'run.json'), 'utf8'))).toMatchObject({
      budget: { members: [expect.objectContaining({ memberId: lead.name, name: lead.displayName, used: 90 })] },
    })
    disconnect()
    await core.close()

    const restarted = setup(root, { launcherId: 'restarted-budget-launcher' })
    expect(restarted.service.teamBudget(run.id).members.find(member => member.memberId === lead.name)).toMatchObject({
      name: lead.displayName,
      used: 90,
      active: false,
    })
    restarted.disconnect()
    await restarted.core.close()
  })

  it('hot-configures a running member for its next model step and restores that choice', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
      provider: 'provider-old',
      model: 'model-old',
    })
    const leadMember = run.members.find(member => member.name === 'lead')
    const lead = first.runtime.get(leadMember?.sessionId ?? '')
    if (leadMember === undefined || lead === undefined) throw new Error('expected live lead member')
    lead.status = 'running'
    const createCount = first.runtime.creates.length
    const resumeCount = first.runtime.resumes.length

    await expect(first.service.configureMember(first.launcher as unknown as Agent, {
      runId: run.id,
      member: 'lead',
      request: {
        provider: 'provider-new',
        model: 'model-new',
        reasoningEffort: 'high',
        maxTokens: 2_048,
      },
    })).resolves.toMatchObject({
      member: {
        name: 'lead',
        sessionId: leadMember.sessionId,
        provider: 'provider-new',
        model: 'model-new',
        reasoningEffort: 'high',
        maxTokens: 2_048,
        status: 'running',
      },
      request: {
        provider: 'provider-new', model: 'model-new', reasoningEffort: 'high', maxTokens: 2_048,
      },
      effectiveFrom: 'next-model-step',
    })
    expect(first.runtime.creates).toHaveLength(createCount)
    expect(first.runtime.resumes).toHaveLength(resumeCount)
    expect(lead.requestConfigurations).toEqual([{
      provider: 'provider-new', model: 'model-new', reasoningEffort: 'high', maxTokens: 2_048,
    }])
    expect(first.service.readTrace(run.id, 0, 100).events).toContainEqual(expect.objectContaining({
      type: 'member_view_updated',
      data: expect.stringContaining('request_configured'),
    }))

    lead.completeTurn()
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    await second.service.resume(second.launcher as unknown as Agent, { runId: run.id, projectRoot: root })
    expect(second.runtime.resumes.find(input => input.id === leadMember.sessionId)).toMatchObject({
      provider: 'provider-new', model: 'model-new', reasoningEffort: 'high', maxTokens: 2_048,
    })
    const resumedLead = second.runtime.get(leadMember.sessionId)
    if (resumedLead === undefined) throw new Error('expected resumed lead member')
    resumedLead.status = 'running'
    await expect(second.service.configureMember(second.launcher as unknown as Agent, {
      runId: run.id,
      member: 'lead',
      request: { reasoningEffort: null, maxTokens: null },
    })).resolves.toMatchObject({
      request: { provider: 'provider-new', model: 'model-new' },
      effectiveFrom: 'next-model-step',
    })
    expect(resumedLead.requestConfigurations.at(-1)).toEqual({
      provider: 'provider-new', model: 'model-new',
    })
    second.service.end(second.launcher as unknown as Agent, 'Hot configuration verified.', run.id)
    await second.service.wait(run.id, 1_000)
    second.disconnect()
  })

  it('hot-configures the attached assistant through one model-selection snapshot', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root, {
      launcherOptions: { provider: 'provider-old', model: 'model-old', maxTokens: 512 },
    })
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
      provider: 'provider-old',
      model: 'model-old',
    })
    const scoped = new FakeAgentContext()
    launcher.ctx = scoped as unknown as Context
    await service.attachAssistant(launcher as unknown as Agent, { runId: run.id })
    const assistantId = service.status(run.id).assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected attached assistant')
    const createCount = runtime.creates.length
    const resumeCount = runtime.resumes.length

    await expect(service.configureAssistant(launcher as unknown as Agent, {
      runId: run.id,
      assistant: assistantId,
      request: {
        provider: 'provider-new',
        model: 'model-new',
        reasoningEffort: 'high',
        maxTokens: 2_048,
      },
    })).resolves.toMatchObject({
      assistant: { sessionId: launcher.id, view: {
        provider: 'provider-new', model: 'model-new', reasoningEffort: 'high', maxTokens: 2_048,
      } },
      request: {
        provider: 'provider-new', model: 'model-new', reasoningEffort: 'high', maxTokens: 2_048,
      },
      effectiveFrom: 'next-model-step',
    })
    expect(runtime.creates).toHaveLength(createCount)
    expect(runtime.resumes).toHaveLength(resumeCount)
    await expect(scoped.assemble({ variables: { provider: 'provider-old', model: 'model-old' } }))
      .resolves.toMatchObject({ variables: { provider: 'provider-new', model: 'model-new' } })
    await expect(scoped.request({ provider: 'provider-old', model: 'model-old', maxTokens: 512 }))
      .resolves.toEqual({
        provider: 'provider-new', model: 'model-new', reasoningEffort: 'high', maxTokens: 2_048,
      })
    expect(service.readTrace(run.id, 0, 100).events).toContainEqual(expect.objectContaining({
      type: 'assistant_view_updated',
      data: expect.stringContaining('request_configured'),
    }))

    service.end(launcher as unknown as Agent, 'Assistant hot configuration verified.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('hot-configures every Team member and assistant through one fast path', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root, {
      launcherOptions: { provider: 'provider-old', model: 'model-old' },
    })
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
      provider: 'provider-old',
      model: 'model-old',
    })
    const scoped = new FakeAgentContext()
    launcher.ctx = scoped as unknown as Context
    await service.attachAssistant(launcher as unknown as Agent, { runId: run.id })

    await expect(service.configureTeam(launcher as unknown as Agent, {
      runId: run.id,
      request: { provider: 'provider-team', model: 'model-team', reasoningEffort: 'medium' },
    })).resolves.toMatchObject({
      memberConfigurations: [
        { member: { name: 'lead' }, request: { provider: 'provider-team', model: 'model-team', reasoningEffort: 'medium' } },
        { member: { name: 'reviewer' }, request: { provider: 'provider-team', model: 'model-team', reasoningEffort: 'medium' } },
      ],
      assistantConfigurations: [
        { assistant: { sessionId: launcher.id }, request: { provider: 'provider-team', model: 'model-team', reasoningEffort: 'medium' } },
      ],
      effectiveFrom: 'next-model-step',
    })
    for (const member of run.members) {
      expect(runtime.get(member.sessionId)?.requestConfigurations.at(-1)).toEqual({
        provider: 'provider-team', model: 'model-team', reasoningEffort: 'medium',
      })
    }
    await scoped.assemble({ variables: { provider: 'provider-old', model: 'model-old' } })
    await expect(scoped.request({ provider: 'provider-old', model: 'model-old' })).resolves.toEqual({
      provider: 'provider-team', model: 'model-team', reasoningEffort: 'medium',
    })
    expect(service.status(run.id)).toMatchObject({
      members: [
        { name: 'lead', provider: 'provider-team', model: 'model-team', reasoningEffort: 'medium' },
        { name: 'reviewer', provider: 'provider-team', model: 'model-team', reasoningEffort: 'medium' },
      ],
      assistants: [{ view: { provider: 'provider-team', model: 'model-team', reasoningEffort: 'medium' } }],
    })
    expect(service.readTrace(run.id, 0, 100).events).toContainEqual(expect.objectContaining({
      type: 'team_requests_configured',
    }))

    service.end(launcher as unknown as Agent, 'Team hot configuration verified.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('exports and imports a paused Team archive with Sessions, shared files, workspace, and plugin data', async () => {
    const source = fixture()
    const sourceArchives = new FleetArchiveRegistry()
    sourceArchives.register({
      id: 'sample.plugin',
      save: ({ directory }) => { writeFileSync(join(directory, 'state.json'), '{"counter":7}\n') },
      restore: () => {},
    })
    sourceArchives.register({
      id: 'missing.plugin',
      save: ({ directory }) => { writeFileSync(join(directory, 'opaque.bin'), Buffer.from([1, 2, 3])) },
      restore: () => {},
    })
    const first = setup(source.root, { archives: sourceArchives })
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath: source.configPath,
      projectRoot: source.root,
      requiredPaths: [],
    })
    first.service.start(first.launcher as unknown as Agent, {
      runId: run.id,
      taskPath: source.taskPath,
      projectRoot: source.root,
    })
    const lead = run.members.find(member => member.name === 'lead')
    if (lead === undefined) throw new Error('expected lead member')
    const sharedPlan = join(source.root, '.fleet', run.id, 'plan.md')
    writeFileSync(sharedPlan, '# Persistent plan\n')
    writeFileSync(join(source.root, '.fleet', run.id, 'decision-log.md'), 'Keep this document across archive import.\n')
    writeFileSync(join(source.root, 'workspace-result.txt'), 'workspace payload\n')
    first.service.writeExtensionState(run.id, 'permissions', {
      groups: [],
      members: { lead: { groups: ['maintainer'], grants: [], denies: [], toolGroups: [], denyToolGroups: [] } },
    })
    await first.service.pauseTeam(first.launcher as unknown as Agent, run.id)
    for (const member of run.members) {
      const header = first.persistedHeaders.get(member.sessionId)
      if (header === undefined) throw new Error(`expected persisted header for ${member.sessionId}`)
      first.persistedHeaders.set(member.sessionId, {
        ...header,
        parentSession: SessionId(String(first.launcher.id)),
        origin: 'subagent',
      })
    }

    const archivePath = join(source.root, 'team.fleet.tar.gz')
    await expect(first.service.exportArchive(first.launcher as unknown as Agent, {
      runId: run.id,
      destination: archivePath,
      includeWorkspace: true,
    })).resolves.toMatchObject({
      path: archivePath,
      teamId: run.id,
      includesWorkspace: true,
      extensions: ['missing.plugin', 'sample.plugin'],
    })
    first.disconnect()

    const targetHost = fixture()
    const restoredPluginState: string[] = []
    const restoredPluginIdentities: Array<{
      readonly teamId: string
      readonly sourceTeamId: string
      readonly sessionIdMap: Readonly<Record<string, string>>
    }> = []
    const targetArchives = new FleetArchiveRegistry()
    targetArchives.register({
      id: 'sample.plugin',
      save: () => {},
      restore: ({ directory, team, sourceTeam, sessionIdMap }) => {
        restoredPluginState.push(readFileSync(join(directory, 'state.json'), 'utf8'))
        restoredPluginIdentities.push({ teamId: team.id, sourceTeamId: sourceTeam.id, sessionIdMap })
      },
    })
    const second = setup(targetHost.root, {
      launcherId: 'restoring-assistant',
      archives: targetArchives,
    })
    const restoredRoot = join(targetHost.root, 'restored-workspace')
    const imported = await second.service.importArchive(second.launcher as unknown as Agent, {
      archivePath,
      projectRoot: restoredRoot,
    })

    expect(imported.run).toMatchObject({ id: run.id, status: 'paused', runtimeState: 'dormant' })
    expect(imported.extensions).toEqual({ missing: ['missing.plugin'], failed: [] })
    expect(restoredPluginState).toEqual(['{"counter":7}\n'])
    expect(readFileSync(join(restoredRoot, 'workspace-result.txt'), 'utf8')).toBe('workspace payload\n')
    expect(readFileSync(join(restoredRoot, '.fleet', run.id, 'plan.md'), 'utf8')).toBe('# Persistent plan\n')
    expect(second.service.readExtensionState(run.id, 'permissions')).toMatchObject({
      members: { lead: { groups: ['maintainer'] } },
    })
    expect(existsSync(join(targetHost.root, '.fleet-registry', run.id, 'extensions', 'missing.plugin', 'opaque.bin')))
      .toBe(true)
    expect([...second.persistedHeaders.values()].map(header => header.cwd)).toEqual(
      run.members.map(() => restoredRoot),
    )

    const copiedRoot = join(targetHost.root, 'copied-workspace')
    const copied = await second.service.importArchive(second.launcher as unknown as Agent, {
      archivePath,
      projectRoot: copiedRoot,
      mode: 'copy',
    })
    expect(copied.run).toMatchObject({ status: 'paused', runtimeState: 'dormant' })
    expect(copied.run.id).not.toBe(run.id)
    expect(copied.run.members.map(member => member.sessionId)).not.toEqual(run.members.map(member => member.sessionId))
    expect(readFileSync(join(copiedRoot, 'workspace-result.txt'), 'utf8')).toBe('workspace payload\n')
    expect(readFileSync(join(copiedRoot, '.fleet', copied.run.id, 'plan.md'), 'utf8'))
      .toBe('# Persistent plan\n')
    expect(second.service.readExtensionState(copied.run.id, 'permissions')).toMatchObject({
      members: { lead: { groups: ['maintainer'] } },
    })
    for (const member of copied.run.members) {
      expect(second.persistedHeaders.get(member.sessionId)?.parentSession).toBeUndefined()
    }
    const copiedIdentity = restoredPluginIdentities.find(identity => identity.teamId === copied.run.id)
    expect(copiedIdentity).toMatchObject({ sourceTeamId: run.id })
    for (const member of run.members) {
      expect(copiedIdentity?.sessionIdMap[member.sessionId]).toBe(
        copied.run.members.find(candidate => candidate.name === member.name)?.sessionId,
      )
    }
    const copiedLoaded = await second.service.resume(second.launcher as unknown as Agent, {
      runId: copied.run.id,
      projectRoot: copiedRoot,
    })
    expect(copiedLoaded).toMatchObject({ status: 'paused', runtimeState: 'active' })
    const copiedResumed = await second.service.resumeTeam(second.launcher as unknown as Agent, copied.run.id)
    expect(copiedResumed).toMatchObject({ status: 'running', runtimeState: 'active' })
    expect(readFileSync(join(copiedRoot, '.fleet', copied.run.id, 'decision-log.md'), 'utf8'))
      .toBe('Keep this document across archive import.\n')

    const restoringAssistant = second.runtime.add('restoring-assistant-2', restoredRoot)
    const loaded = await second.service.resume(restoringAssistant as unknown as Agent, {
      runId: run.id,
      projectRoot: restoredRoot,
    })
    expect(loaded).toMatchObject({ status: 'paused', runtimeState: 'active' })
    const resumed = await second.service.resumeTeam(restoringAssistant as unknown as Agent, run.id)
    expect(resumed).toMatchObject({ status: 'running', runtimeState: 'active' })
    expect(readFileSync(join(restoredRoot, '.fleet', run.id, 'decision-log.md'), 'utf8'))
      .toBe('Keep this document across archive import.\n')
    expect(second.runtime.resumes.map(input => input.id)).toEqual(expect.arrayContaining([
      ...run.members.map(member => member.sessionId),
      ...copied.run.members.map(member => member.sessionId),
    ]))
    second.disconnect()
  })

  it('does not report active members as offline from a separate Web process', async () => {
    const { root, configPath, taskPath } = fixture()
    const owner = setup(root, { launcherId: 'runtime-owner' })
    const run = await owner.service.create(owner.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    owner.service.start(owner.launcher as unknown as Agent, {
      runId: run.id,
      taskPath,
      projectRoot: root,
    })

    const web = setup(root, { launcherId: 'web-process' })
    expect(web.service.list(root).find(candidate => candidate.id === run.id)?.members)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'lead', status: 'unknown' }),
        expect.objectContaining({ name: 'reviewer', status: 'unknown' }),
      ]))

    web.disconnect()
    owner.service.end(owner.launcher as unknown as Agent, 'Cross-process projection test complete.', run.id)
    await owner.service.wait(run.id, 1_000)
    owner.disconnect()
  })

  it('creates the UI-aligned peer Team shape and member-level routes', async () => {
    const { root } = fixture()
    const configPath = join(root, 'ui-team.json')
    const resourcePath = join(root, 'product-brief.pdf')
    writeFileSync(resourcePath, 'brief')
    writeFileSync(configPath, JSON.stringify(teamConfiguration({
      name: 'Product Engineering',
      positioning: 'Own the product engineering workflow over time.',
      defaultChannel: { id: 'delivery', name: 'Delivery' },
      rules: 'Important decisions include reviewable evidence.',
      collaborationMethod: 'Use explicit ownership and independent review.',
      sharedResources: [{ path: 'product-brief.pdf', label: 'Product brief', mediaType: 'application/pdf' }],
      userAccess: {
        updateDensity: 'balanced',
        notificationPolicy: 'milestones',
        contentPreference: 'Lead with decisions and visual results.',
      },
      assistant: {
        id: 'team-assistant',
        name: 'Jordan',
        color: '#64748b',
        role: 'team assistant',
        responsibilities: 'Maintain the durable user-facing Team conversation.',
        prompt: 'Lead with decisions and preserve Team autonomy.',
        provider: 'assistant-provider',
        model: 'assistant-model',
        contacts: { members: '*', channels: ['delivery'] },
      },
      members: [{
        id: 'product-lead',
        name: 'Avery',
        color: '#527fca',
        role: 'product lead',
        responsibilities: 'Own lasting product direction.',
        prompt: 'Keep implementation with its responsible owner.',
        provider: 'member-provider',
        model: 'member-model',
        toolGroups: ['messages', 'coordination'],
        permissions: ['vote.create'],
        contacts: { members: [], channels: ['delivery'] },
      }],
    })))
    const { service, runtime, launcher, context, disconnect } = setup(root, {
      launcherOptions: { provider: 'default-provider', model: 'default-model' },
    })

    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const messages = service.messageHub(run.id)
    const resources = service.resourceStore(run.id)

    expect(run).toMatchObject({
      team: 'Product Engineering',
      name: 'Product Engineering',
      status: 'idle',
      members: [
        { name: 'product-lead', displayName: 'Avery', role: 'product lead' },
      ],
      assistants: [expect.objectContaining({
        sessionId: launcher.id,
        view: expect.objectContaining({
          id: 'team-assistant',
          name: 'Jordan',
          color: '#64748b',
          role: 'team assistant',
          responsibility: 'Maintain the durable user-facing Team conversation.',
          prompt: 'Lead with decisions and preserve Team autonomy.',
          provider: 'assistant-provider',
          model: 'assistant-model',
        }),
      })],
    })
    expect(runtime.creates).toEqual([
      expect.objectContaining({
        provider: 'member-provider',
        model: 'member-model',
        persona: expect.stringContaining('You are @Avery'),
      }),
    ])
    expect(service.memberViews(run.id)[0]).toMatchObject({
      id: 'product-lead',
      toolGroups: ['messages', 'coordination'],
      permissions: ['vote.create'],
      contacts: { members: [], channels: ['delivery'] },
    })
    const register = vi.fn(() => () => {})
    const restrict = vi.fn(() => () => {})
    const guard = vi.fn(() => () => {})
    const get = vi.fn((name: string) => name.startsWith('joyride_') || name.startsWith('live_') ? { name } : undefined)
    const memberSetup = vi.fn()
    context.on('fleet/member/setup', memberSetup)
    await runtime.creates[0]?.setup?.({
      agent: runtime.get(run.members[0]?.sessionId ?? '') as unknown as Agent,
      inject: (_deps: readonly string[], callback: (scope: Context) => void) => {
        callback({ tools: { register, restrict, guard, get } } as unknown as Context)
        return Promise.resolve()
      },
    } as unknown as Context)
    expect(restrict).toHaveBeenCalledWith({
      deny: ['fleet_agent', 'fleet_run', 'fleet_archive', 'fleet_assistant', 'fleet_trace', 'fleet_setup', 'fleet_progress', 'fleet_member'],
    })
    expect(restrict).toHaveBeenCalledWith({
      deny: ['joyride_catalog', 'joyride_act', 'joyride_control', 'live_stream', 'live_stage'],
    })
    const specialToolGuard = guard.mock.calls[0]?.[0] as ((execution: { readonly name: string }) => string | undefined)
    expect(specialToolGuard({ name: 'joyride_act' })).toContain('not permitted')
    expect(specialToolGuard({ name: 'fleet_send' })).toBeUndefined()
    expect(register.mock.calls.map(call => (call[0] as { name: string }).name)).toEqual([
      'fleet_send',
      'fleet_followup',
      'fleet_messages',
      'fleet_wait',
      'fleet_tools',
      'fleet_task',
      'fleet_schedule',
      'fleet_calendar',
    ])
    const discovery = register.mock.calls[4]?.[0] as {
      execute(args: { readonly action: 'load'; readonly name: string }): Promise<unknown>
    }
    await discovery.execute({ action: 'load', name: 'fleet_vote' })
    expect(register.mock.calls.map(call => (call[0] as { name: string }).name)).toEqual([
      'fleet_send',
      'fleet_followup',
      'fleet_messages',
      'fleet_wait',
      'fleet_tools',
      'fleet_task',
      'fleet_schedule',
      'fleet_calendar',
      'fleet_channel',
      'fleet_vote',
      'fleet_meeting',
    ])
    expect(memberSetup).toHaveBeenCalledWith(expect.objectContaining({
      team: expect.objectContaining({ id: run.id }),
      member: 'product-lead',
      source: 'create',
    }))
    const actionEnum = (name: string): readonly string[] | undefined =>
      (register.mock.calls.find(call => (call[0] as { name: string }).name === name)?.[0] as {
        parameters?: { readonly properties?: { readonly action?: { readonly enum?: readonly string[] } } }
      } | undefined)?.parameters?.properties?.action?.enum
    expect(actionEnum('fleet_channel')).toEqual(['list'])
    expect(actionEnum('fleet_vote')).toEqual(['list', 'get', 'create', 'cast'])
    expect(actionEnum('fleet_meeting')).toEqual(['list', 'join', 'leave'])
    const productLead = runtime.get(run.members[0]?.sessionId ?? '')
    if (productLead === undefined) throw new Error('expected product lead')
    expect(messages.listChannels(productLead).find(channel => channel.id === 'delivery')).toMatchObject({
      name: 'Delivery',
      body: expect.stringContaining('Positioning: Own the product engineering workflow over time.'),
    })
    expect(resources.listResources()).toEqual([
      expect.objectContaining({
        path: resourcePath,
        label: 'Product brief',
        mediaType: 'application/pdf',
        size: 5,
        createdBy: productLead.id,
      }),
    ])

    service.end(launcher as unknown as Agent, 'UI-aligned Team test complete.')
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('reads registered Markdown resources on demand for the Web preview', async () => {
    const { root, configPath } = fixture()
    const planPath = join(root, 'team-plan.md')
    writeFileSync(planPath, '# Current plan\n\n- Verify the preview.\n')
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const resources = service.resourceStore(run.id)
    resources.addResource(String(launcher.id), {
      id: 'team-plan',
      path: planPath,
      label: 'Current plan',
    })
    const revision = resources.recordRevision(
      run.members[0]?.sessionId ?? String(launcher.id),
      'team-plan',
      '# Draft\n',
      '# Current plan\n\n- Verify the preview.\n',
    )
    if (revision === undefined) throw new Error('expected resource revision')

    await expect(service.readResourcePreview(run.id, 'team-plan')).resolves.toMatchObject({
      id: 'team-plan',
      kind: 'markdown',
      body: '# Current plan\n\n- Verify the preview.\n',
      size: 38,
      history: [
        { id: revision.id, updatedBy: 'lead', operation: 'updated' },
        { id: 'resource-added:team-plan', updatedBy: 'team-assistant', operation: 'created' },
      ],
    })
    await expect(service.readResourcePreview(run.id, 'team-plan', undefined, revision.id)).resolves.toMatchObject({
      revision: {
        id: revision.id,
        before: '# Draft\n',
        after: '# Current plan\n\n- Verify the preview.\n',
      },
    })

    const oversized = resources.recordRevision(
      run.members[0]?.sessionId ?? String(launcher.id),
      'team-plan',
      '',
      'x'.repeat(2 * 1024 * 1024 + 1),
    )
    if (oversized === undefined) throw new Error('expected oversized resource revision')
    const protectedPreview = await service.readResourcePreview(run.id, 'team-plan')
    expect(protectedPreview.history[0]).toMatchObject({
      id: oversized.id,
      available: false,
      size: 2 * 1024 * 1024 + 1,
    })
    expect((await service.readResourcePreview(run.id, 'team-plan', undefined, oversized.id)).revision).toBeUndefined()

    service.end(launcher as unknown as Agent, 'Resource preview test complete.')
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('builds one journal index for a batch of resource previews', async () => {
    const { root, configPath } = fixture()
    const firstPath = join(root, 'first.md')
    const secondPath = join(root, 'second.txt')
    writeFileSync(firstPath, '# First\n')
    writeFileSync(secondPath, 'Second\n')
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const resources = service.resourceStore(run.id)
    resources.addResource(String(launcher.id), { id: 'first', path: firstPath })
    resources.addResource(String(launcher.id), { id: 'second', path: secondPath })
    const eventsPath = join(root, '.fleet-registry', run.id, 'events.jsonl')
    appendFileSync(eventsPath, `${Array.from({ length: 20_000 }, (_, index) => JSON.stringify({
      sequence: 10_000 + index,
      createdAt: '2026-08-25T00:00:00.000Z',
      type: 'coordination.message',
      data: { text: `unrelated-${String(index)}`, detail: 'x'.repeat(128) },
    })).join('\n')}\n`)
    const resourceHistoryPath = join(root, '.fleet-registry', run.id, 'resource-history.jsonl')
    appendFileSync(resourceHistoryPath, `${Array.from({ length: 5_000 }, (_, index) => JSON.stringify({
      id: `revision-${String(index)}`,
      resourceId: 'first',
      updatedBy: String(launcher.id),
      updatedAt: new Date(Date.UTC(2027, 0, 1, 0, 0, index)).toISOString(),
      operation: 'updated',
      available: false,
      size: index,
    })).join('\n')}\n`)
    const internal = service as unknown as {
      storedEvents: (record: unknown) => unknown[]
      scanJsonLines: (path: string, signal: AbortSignal | undefined, visit: (line: string) => void) => Promise<void>
    }
    const scanJsonLines = internal.scanJsonLines.bind(service)
    const scans: string[] = []
    internal.storedEvents = () => {
      throw new Error('batch resource preview must not load the complete journal')
    }
    internal.scanJsonLines = async (path, signal, visit) => {
      scans.push(path)
      await scanJsonLines(path, signal, visit)
    }

    const previews = await service.readResourcePreviews(run.id, [
      { id: 'first', revisionId: 'revision-0' },
      { id: 'second' },
    ])
    expect(previews).toEqual([
      expect.objectContaining({
        id: 'first',
        body: '# First\n',
        historyTruncated: true,
      }),
      expect.objectContaining({ id: 'second', body: 'Second\n' }),
    ])
    expect(previews[0]?.history).toHaveLength(500)
    expect(scans.filter(path => path.endsWith(`${sep}events.jsonl`))).toHaveLength(1)
    expect(scans.filter(path => path.endsWith(`${sep}resource-history.jsonl`))).toHaveLength(1)

    disconnect()
  })

  it('reads only bounded revision snippets with four workers and cancellation', async () => {
    const { root, configPath } = fixture()
    const currentPath = join(root, 'revision-source.md')
    writeFileSync(currentPath, '# Current\n')
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const resources = service.resourceStore(run.id)
    resources.addResource(String(launcher.id), { id: 'revision-source', path: currentPath })
    const revisions = Array.from({ length: 12 }, (_, index) => {
      const after = index === 0
        ? `${'x'.repeat(1024 * 1024)} needle ${'y'.repeat(256 * 1024)}`
        : `revision ${String(index)} contains needle and bounded context`
      const revision = resources.recordRevision(
        run.members[0]?.sessionId ?? String(launcher.id),
        'revision-source',
        null,
        after,
      )
      if (revision === undefined) throw new Error('expected stored resource revision')
      return revision
    })
    const internal = service as unknown as {
      readStoredResourceRevision: (
        record: unknown,
        revisionId: string,
        signal?: AbortSignal,
      ) => Promise<{ readonly before: string | null; readonly after: string }>
    }
    const readStoredResourceRevision = internal.readStoredResourceRevision.bind(service)
    let active = 0
    let peak = 0
    internal.readStoredResourceRevision = async (record, revisionId, signal) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>(resolve => { setImmediate(resolve) })
      try {
        return await readStoredResourceRevision(record, revisionId, signal)
      } finally {
        active -= 1
      }
    }

    unlinkSync(currentPath)
    const snippets = await service.readResourceRevisionSnippets(run.id, [
      ...revisions.map(revision => ({
        id: 'revision-source',
        revisionId: revision.id,
        query: 'needle',
        maxChars: 180,
      })),
      { id: 'revision-source', revisionId: 'missing-revision', query: 'needle' },
    ])
    expect(peak).toBe(4)
    expect(snippets).toHaveLength(13)
    expect(snippets.slice(0, 12).every(result =>
      result.matched && (result.snippet?.length ?? Number.POSITIVE_INFINITY) <= 182)).toBe(true)
    expect(snippets[12]).toMatchObject({ matched: false, error: expect.stringContaining('Unknown Fleet resource revision') })

    const controller = new AbortController()
    controller.abort()
    await expect(service.readResourceRevisionSnippets(run.id, [{
      id: 'revision-source',
      revisionId: revisions[0]!.id,
      query: 'needle',
    }], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })

    disconnect()
  })

  it('bounds resource reads and isolates a failed batch item', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, context, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const resources = service.resourceStore(run.id)
    const requests = Array.from({ length: 9 }, (_, index) => {
      const id = `resource-${String(index)}`
      const path = join(root, `${id}.txt`)
      writeFileSync(path, `body-${String(index)}\n`)
      resources.addResource(String(launcher.id), { id, path })
      return { id }
    })
    requests.splice(4, 0, { id: 'missing-resource' })
    const internal = service as unknown as {
      readResourcePreviewFromState: (
        record: unknown,
        resourceId: string,
        state: unknown,
        signal?: AbortSignal,
        revisionId?: string,
      ) => Promise<FleetResourcePreview>
    }
    const readResourcePreviewFromState = internal.readResourcePreviewFromState.bind(service)
    let active = 0
    let peak = 0
    internal.readResourcePreviewFromState = async (record, resourceId, state, signal, revisionId) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>(resolve => { setImmediate(resolve) })
      try {
        return await readResourcePreviewFromState(record, resourceId, state, signal, revisionId)
      } finally {
        active -= 1
      }
    }

    const previews = await service.readResourcePreviews(run.id, requests)
    expect(peak).toBe(4)
    expect(previews).toHaveLength(requests.length)
    expect(previews[4]).toMatchObject({
      id: 'missing-resource',
      body: '',
      error: expect.stringContaining('Unknown Fleet resource'),
    })
    expect(previews[5]).toMatchObject({ id: 'resource-4', body: 'body-4\n' })
    await expect(service.readResourcePreview(run.id, 'missing-resource')).rejects.toThrow('Unknown Fleet resource')

    const fs = context.fs as unknown as {
      readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
    }
    const readBytes = fs.readBytes.bind(context.fs)
    let activeContentReads = 0
    let peakContentReads = 0
    fs.readBytes = async (target, signal, maxBytes) => {
      activeContentReads += 1
      peakContentReads = Math.max(peakContentReads, activeContentReads)
      await new Promise<void>(resolve => { setImmediate(resolve) })
      try {
        return await readBytes(target, signal, maxBytes)
      } finally {
        activeContentReads -= 1
      }
    }
    const snippets = await service.readResourceContentSnippets(run.id, requests.map(request => ({
      id: request.id,
      query: 'body',
      maxChars: 64,
    })))
    expect(peakContentReads).toBe(4)
    expect(snippets).toHaveLength(requests.length)
    expect(snippets[4]).toMatchObject({ id: 'missing-resource', matched: false, error: expect.any(String) })
    expect(snippets.filter(result => result.matched).every(result => (result.snippet?.length ?? 0) <= 66)).toBe(true)

    disconnect()
  })

  it('discovers shared-directory files on the host without mutating during projection reads', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const initial = service.readWebTeamProjection(run.id, 0, 1_000)
    const initialSequence = initial.events.at(-1)?.sequence ?? 0
    const sharedDirectory = join(root, '.fleet', run.id, 'notes')
    const progressPath = join(sharedDirectory, 'progress.md')
    mkdirSync(sharedDirectory, { recursive: true })
    writeFileSync(progressPath, '# Progress\n\nDirect Agent output.\n')

    expect(service.readWebTeamProjection(run.id, initialSequence, 1_000).events).toEqual([])
    await vi.waitFor(() => {
      expect(service.readWebTeamProjection(run.id, initialSequence, 1_000).events).toContainEqual(
        expect.objectContaining({
          type: 'resource.resource_added',
          data: expect.objectContaining({
            resource: expect.objectContaining({ id: 'shared:notes/progress.md' }),
          }),
        }),
      )
    }, { timeout: 2_000, interval: 20 })
    const added = service.readWebTeamProjection(run.id, initialSequence, 1_000)
    expect(added.events).toContainEqual(expect.objectContaining({
      type: 'resource.resource_added',
      data: expect.objectContaining({
        resource: expect.objectContaining({
          id: 'shared:notes/progress.md',
          label: 'notes/progress.md',
          path: progressPath,
          createdBy: 'fleet-filesystem',
        }),
      }),
    }))
    await expect(service.readResourcePreview(run.id, 'shared:notes/progress.md')).resolves.toMatchObject({
      kind: 'markdown',
      body: '# Progress\n\nDirect Agent output.\n',
      history: [{ updatedBy: 'fleet-filesystem', operation: 'created' }],
    })

    const addedSequence = added.events.at(-1)?.sequence ?? initialSequence
    writeFileSync(progressPath, '# Progress\n\nDirect Agent output updated.\n')
    expect(service.readWebTeamProjection(run.id, addedSequence, 1_000).events).toEqual([])
    await vi.waitFor(() => {
      expect(service.readWebTeamProjection(run.id, addedSequence, 1_000).events).toContainEqual(
        expect.objectContaining({
          type: 'resource.resource_added',
          data: expect.objectContaining({ resource: expect.objectContaining({ id: 'shared:notes/progress.md' }) }),
        }),
      )
    }, { timeout: 2_000, interval: 20 })
    const updated = service.readWebTeamProjection(run.id, addedSequence, 1_000)
    expect(updated.events).toContainEqual(expect.objectContaining({
      type: 'resource.resource_added',
      data: expect.objectContaining({ resource: expect.objectContaining({ id: 'shared:notes/progress.md' }) }),
    }))
    await expect(service.readResourcePreview(run.id, 'shared:notes/progress.md')).resolves.toMatchObject({
      body: '# Progress\n\nDirect Agent output updated.\n',
    })

    const updatedSequence = updated.events.at(-1)?.sequence ?? addedSequence
    unlinkSync(progressPath)
    expect(service.readWebTeamProjection(run.id, updatedSequence, 1_000).events).toEqual([])
    await vi.waitFor(() => {
      expect(service.readWebTeamProjection(run.id, updatedSequence, 1_000).events).toContainEqual(
        expect.objectContaining({
          type: 'resource.resource_removed',
          data: expect.objectContaining({
            removal: expect.objectContaining({
              resource: expect.objectContaining({ id: 'shared:notes/progress.md' }),
            }),
          }),
        }),
      )
    }, { timeout: 2_000, interval: 20 })
    expect(service.readWebTeamProjection(run.id, updatedSequence, 1_000).events).toContainEqual(
      expect.objectContaining({
        type: 'resource.resource_removed',
        data: expect.objectContaining({
          removal: expect.objectContaining({
            removedBy: 'fleet-filesystem',
            resource: expect.objectContaining({ id: 'shared:notes/progress.md' }),
          }),
        }),
      }),
    )
    expect(service.resourceStore(run.id).listResources()).not.toContainEqual(
      expect.objectContaining({ id: 'shared:notes/progress.md' }),
    )
    await expect(service.readResourcePreview(run.id, 'shared:notes/progress.md'))
      .rejects.toThrow('Unknown Fleet resource')

    disconnect()
  })

  it('gives multiple user-facing assistants normal member messaging and meeting capabilities', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, core, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected Fleet peers')

    const collaboration = service.sendAssistantMessage(launcher as unknown as Agent, {
      runId: run.id,
      kind: 'collaboration',
      text: 'The user prefers a short progress summary before implementation begins.',
      projectRoot: root,
    })

    expect(collaboration).toMatchObject({
      runId: run.id,
      kind: 'collaboration',
      recipients: ['lead', 'reviewer'],
      assistantSessionId: launcher.id,
    })
    expect(core.nameForAgent(launcher.id)).toBeUndefined()
    expect(service.messageHub(run.id).read(lead, { conversation: '#main' }).messages)
      .toContainEqual(expect.objectContaining({ text: 'The user prefers a short progress summary before implementation begins.' }))
    expect(service.status(run.id)).toMatchObject({ status: 'idle' })
    expect(service.readTrace(run.id, 0, 100).events)
      .toContainEqual(expect.objectContaining({ type: 'assistant_message' }))

    const targeted = service.sendAssistantMessage(launcher as unknown as Agent, {
      runId: run.id,
      kind: 'directive',
      text: '@reviewer Please analyze the current result.',
      recipients: ['@reviewer'],
      projectRoot: root,
    })
    expect(targeted.recipients).toEqual(['reviewer'])
    const targetedMessage = service.messageHub(run.id).read(lead, { conversation: '#main' }).messages
      .find(message => message.text === '@reviewer Please analyze the current result.')
    expect(targetedMessage).toMatchObject({
      mentions: ['reviewer'],
      delivery: 'wakeup',
    })
    expect(service.messageHub(run.id).pendingWakeups(lead.id)).toEqual([])
    expect(service.messageHub(run.id).pendingWakeups(reviewer.id))
      .toContainEqual(expect.objectContaining({ id: targetedMessage?.id }))

    const sent = service.sendConversationMessage(launcher as unknown as Agent, {
      runId: run.id,
      to: '#main',
      text: 'The foreground assistant is checking in directly.',
      delivery: 'quiet',
    })
    expect(sent).toMatchObject({ recipients: 2, woken: 0 })
    expect(service.messageHub(run.id).read(lead, { conversation: '#main' }).messages)
      .toContainEqual(expect.objectContaining({
        id: sent.messageId,
        from: 'team-assistant',
        text: 'The foreground assistant is checking in directly.',
      }))
    const userChannelMessage = service.sendUserConversationMessage({
      runId: run.id,
      to: '#main',
      text: 'A user-authored update from the Team panel.',
      delivery: 'quiet',
    })
    expect(userChannelMessage).toMatchObject({ recipients: 3, woken: 0 })
    expect(service.messageHub(run.id).read(lead, { conversation: '#main' }).messages)
      .toContainEqual(expect.objectContaining({
        id: userChannelMessage.messageId,
        from: `fleet-user:${run.id}`,
        fromName: 'User',
        text: 'A user-authored update from the Team panel.',
      }))
    const userDirectMessage = service.sendUserConversationMessage({
      runId: run.id,
      to: `@${reviewer.id}`,
      text: 'Please check the latest result.',
      delivery: 'quiet',
    })
    expect(userDirectMessage).toMatchObject({ recipients: 1, woken: 0 })
    expect(reviewer.inbox.nextStep.at(-1)?.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('Please check the latest result.') }),
    ])
    expect(reviewer.inbox.nextStep.at(-1)?.source).toEqual({ kind: 'user' })
    expect(service.messageHub(run.id).read(reviewer, { conversation: `@fleet-user:${run.id}` }).messages)
      .toContainEqual(expect.objectContaining({
        id: userDirectMessage.messageId,
        origin: 'user',
        mustReply: true,
      }))
    expect(service.messageHub(run.id).send(lead, {
      to: '@User',
      text: 'I received the user message.',
      delivery: 'quiet',
    })).toMatchObject({ recipients: 1, woken: 0 })
    service.messageHub(run.id).createChannel(lead, {
      name: 'private-review',
      members: [],
    })
    const restrictedUserMessage = service.sendUserConversationMessage({
      runId: run.id,
      to: '#private-review',
      text: 'A user-authored update in a restricted channel.',
      delivery: 'quiet',
    })
    expect(restrictedUserMessage).toMatchObject({ recipients: 1, woken: 0 })
    expect(service.messageHub(run.id).read(lead, { conversation: '#private-review' }).messages)
      .toContainEqual(expect.objectContaining({
        id: restrictedUserMessage.messageId,
        from: `fleet-user:${run.id}`,
      }))
    const uploaded = service.uploadResource(launcher as unknown as Agent, {
      runId: run.id,
      name: 'browser-note.txt',
      base64: Buffer.from('uploaded from the browser').toString('base64'),
      mediaType: 'text/plain',
    })
    expect(uploaded).toMatchObject({ label: 'browser-note.txt', mediaType: 'text/plain', size: 25 })
    expect(readFileSync(uploaded.path, 'utf8')).toBe('uploaded from the browser')
    expect(service.removeResource(launcher as unknown as Agent, {
      runId: run.id,
      resourceId: uploaded.id,
    })).toEqual(uploaded)
    expect(existsSync(uploaded.path)).toBe(false)
    expect(service.resourceStore(run.id).listResources()).not.toContainEqual(
      expect.objectContaining({ id: uploaded.id }),
    )
    expect(() => service.uploadResource(launcher as unknown as Agent, {
      runId: run.id,
      name: '../outside.txt',
      base64: '',
    })).toThrow('plain file name')

    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const directive = service.sendAssistantMessage(launcher as unknown as Agent, {
      runId: run.id,
      kind: 'directive',
      text: 'Pause feature expansion and finish the requested file only.',
      mustReply: true,
      projectRoot: root,
    })
    expect(directive).toMatchObject({ mustReply: true })
    expect(service.messageHub(run.id).read(lead, { conversation: '#main' }).messages.at(-1))
      .toMatchObject({ mustReply: true })
    expect(lead.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Pause feature expansion') }),
    ])
    expect(reviewer.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Pause feature expansion') }),
    ])

    const vtuberAssistant = runtime.add('vtuber-assistant', root)
    const vtuber = await service.attachAssistant(vtuberAssistant as unknown as Agent, {
      runId: run.id,
      name: 'Nova',
      role: 'Live Host',
      responsibility: 'Observe the Team and present progress to the audience.',
    })
    expect(vtuber.assistant.view).toMatchObject({
      toolGroups: ['messages', 'status', 'resources'],
      permissions: [],
    })
    expect(service.sendAssistantMessage(vtuberAssistant as unknown as Agent, {
      runId: run.id,
      kind: 'collaboration',
      text: 'The live audience can now see the latest Team update.',
    })).toMatchObject({ assistantName: 'Nova' })
    expect(() => service.sendAssistantMessage(vtuberAssistant as unknown as Agent, {
      runId: run.id,
      kind: 'directive',
      text: 'Interrupt the Team for the live audience.',
    })).toThrow(/message\.wakeup/)
    expect(() => service.sendConversationMessage(vtuberAssistant as unknown as Agent, {
      runId: run.id,
      to: '#main',
      text: 'Wake the Team through the direct conversation route.',
      delivery: 'wakeup',
    })).toThrow(/message\.wakeup/)
    expect(() => service.end(vtuberAssistant as unknown as Agent, 'The host should not close the Team.', run.id))
      .toThrow(/team\.manage/)
    service.detachAssistant(vtuberAssistant as unknown as Agent, run.id)

    const secondAssistant = runtime.add('other-assistant', root)
    expect(() => service.sendAssistantMessage(secondAssistant as unknown as Agent, {
      runId: run.id,
      kind: 'directive',
      text: 'Take over the Team.',
      projectRoot: root,
    })).toThrow(/not a Fleet assistant/)

    const attached = await service.attachAssistant(secondAssistant as unknown as Agent, {
      runId: run.id,
      name: 'Maya',
      role: 'Research Assistant',
      responsibility: 'Keep research questions and Team decisions connected to the user.',
      toolGroups: ['messages', 'coordination', 'resources', 'status'],
      permissions: ['meeting.manage', 'vote.create'],
    })
    secondAssistant.session.events.push({
      seq: 41,
      time: Date.now(),
      type: 'assistant/message',
      data: { message: { content: 'Context from the previous assistant Session.' } },
    })
    expect(attached.run.assistants).toHaveLength(3)
    expect(attached.assistant.view).toMatchObject({
      name: 'Maya',
      role: 'Research Assistant',
      responsibility: 'Keep research questions and Team decisions connected to the user.',
      permissions: expect.arrayContaining(['meeting.manage']),
    })
    const hub = service.messageHub(run.id)
    hub.send(lead, {
      to: `@${attached.assistant.view.id}`,
      text: 'Please surface this decision to the user.',
      delivery: 'quiet',
    })
    expect(secondAssistant.inbox.nextStep.at(-1)?.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('Please surface this decision to the user.') }),
    ])
    expect(hub.openMeeting(secondAssistant, {
      id: 'user-review',
      title: 'User review',
      agenda: 'Align the next user-facing update.',
      participants: ['@lead'],
    })).toMatchObject({ id: 'user-review', status: 'open' })
    expect(service.sendAssistantMessage(secondAssistant as unknown as Agent, {
      runId: run.id,
      kind: 'collaboration',
      text: 'The second assistant is now handling research updates.',
      projectRoot: root,
    })).toMatchObject({ assistantName: 'Maya' })

    service.detachAssistant(secondAssistant as unknown as Agent, run.id)
    expect(service.status(run.id).assistants.find(assistant => assistant.view.id === attached.assistant.view.id))
      .toMatchObject({ status: 'offline' })
    expect(() => service.sendAssistantMessage(secondAssistant as unknown as Agent, {
      runId: run.id,
      kind: 'directive',
      text: 'This detached Session must no longer control the Team.',
      projectRoot: root,
    })).toThrow('is not connected')

    const replacementAssistant = runtime.add('replacement-assistant', root)
    const rebound = await service.attachAssistant(replacementAssistant as unknown as Agent, {
      runId: run.id,
      assistantId: attached.assistant.view.id,
    })
    replacementAssistant.session.events.push({
      seq: 7,
      time: Date.now() + 1,
      type: 'assistant/message',
      data: { message: { content: 'Context from the current assistant Session.' } },
    })
    expect(rebound.assistant).toMatchObject({
      sessionId: replacementAssistant.id,
      view: { id: attached.assistant.view.id, name: 'Maya' },
    })
    expect(replacementAssistant.inbox.nextStep).toContainEqual(expect.objectContaining({
      content: [expect.objectContaining({ text: expect.stringContaining('Please surface this decision to the user.') })],
    }))
    await expect(service.readMemberTraceTail(run.id, attached.assistant.view.id, 20)).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ sessionId: secondAssistant.id, sequence: 41 }),
        expect.objectContaining({ sessionId: replacementAssistant.id, sequence: 7 }),
      ]),
    })
    expect(rebound.run.assistantSessionAliases).toEqual(expect.arrayContaining([
      { sessionId: secondAssistant.id, currentSessionId: replacementAssistant.id },
      { sessionId: replacementAssistant.id, currentSessionId: replacementAssistant.id },
    ]))
    expect(hub.listMeetings(replacementAssistant)).toContainEqual(expect.objectContaining({
      id: 'user-review',
      participants: expect.arrayContaining([attached.assistant.view.id]),
    }))

    const assistantConversation = service.readConversationProjection(
      run.id,
      `dm:assistant:${attached.assistant.view.id}:member:lead`,
      Number.MAX_SAFE_INTEGER,
      20,
    )
    expect(assistantConversation.events).toContainEqual(expect.objectContaining({
      type: 'coordination.message',
      data: expect.objectContaining({
        message: expect.objectContaining({ text: 'Please surface this decision to the user.' }),
      }),
    }))
    expect(service.participantSessionIds(run.id, attached.assistant.view.id)).toEqual(expect.arrayContaining([
      secondAssistant.id,
      replacementAssistant.id,
    ]))
    await expect(service.searchParticipantMessages(
      run.id,
      attached.assistant.view.id,
      'surface this decision',
      10,
    )).resolves.toContainEqual(expect.objectContaining({
      conversationId: `dm:assistant:${attached.assistant.view.id}:member:lead`,
      from: 'lead',
    }))

    const residentSource = runtime.add('resident-assistant-source', root)
    const residentAttached = await service.attachAssistant(residentSource as unknown as Agent, {
      runId: run.id,
      name: 'Resident',
    })
    const releaseResident = vi.fn(async (sessionId: string) => {
      runtime.agents.delete(sessionId)
      return true
    })
    const restoreResident = vi.fn(async () => {})
    service.setResidentAssistantController({ release: releaseResident, restore: restoreResident })
    const residentReplacement = runtime.add('resident-assistant-replacement', root)
    const residentRebound = await service.attachAssistant(residentReplacement as unknown as Agent, {
      runId: run.id,
      assistantId: residentAttached.assistant.view.id,
    })
    expect(releaseResident).toHaveBeenCalledWith(residentSource.id)
    expect(restoreResident).not.toHaveBeenCalled()
    expect(residentRebound.assistant).toMatchObject({
      sessionId: residentReplacement.id,
      view: { id: residentAttached.assistant.view.id, name: 'Resident' },
    })

    const finishVote = hub.createVote(replacementAssistant, {
      channel: '#main',
      kind: 'finish',
      statement: 'Assistant bridge test complete.',
    })
    hub.castVote(lead, { id: finishVote.id, response: 'approve' })
    hub.castVote(reviewer, { id: finishVote.id, response: 'approve' })
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({
      status: 'idle',
      work: { status: 'finished', summary: 'Assistant bridge test complete.' },
    })
    service.end(launcher as unknown as Agent, 'Assistant bridge Team closed.')
    expect(() => service.uploadResource(launcher as unknown as Agent, {
      runId: run.id,
      name: 'too-late.txt',
      base64: Buffer.from('closed').toString('base64'),
    })).toThrow('is closed')
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('keeps one Team alive across multiple work items and stops members only when the Team closes', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, core, runtime, launcher, persisted, disconnect } = setup(root)

    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const messages = service.messageHub(run.id)
    const resources = service.resourceStore(run.id)

    expect(run).toMatchObject({
      status: 'idle',
      members: [
        { name: 'lead', displayName: 'Lead', color: '#527fca' },
        { name: 'reviewer', displayName: 'Reviewer', color: '#7c68bd' },
      ],
    })
    expect(runtime.creates.map(create => create.persona)).toEqual([
      expect.stringContaining('You are @Lead'),
      expect.stringContaining('You are @Reviewer'),
    ])
    expect(run.members.every(member => runtime.get(member.sessionId)?.messages.length === 0)).toBe(true)
    expect(messages.listChannels(runtime.get(run.members[0]?.sessionId ?? '') ?? launcher)
      .find(channel => channel.id === 'main')).toMatchObject({
      id: 'main',
      summary: 'Small Team initialized.',
      body: expect.stringContaining('Team: Small Team'),
    })

    const work = service.start(launcher as unknown as Agent, {
      runId: run.id,
      taskPath,
      projectRoot: root,
    })
    expect(work).toMatchObject({ status: 'running', work: { status: 'running', taskPath } })

    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    resources.claim(lead.id, [{
      targetKey: 'result.txt',
      displayPath: join(root, 'result.txt'),
    } as FsTarget])
    const vote = messages.createVote(lead, {
      channel: '#main',
      kind: 'finish',
      statement: 'result.txt was independently reviewed.',
    })
    messages.castVote(reviewer, { id: vote.id, response: 'approve' })

    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({
      status: 'idle',
      settled: false,
      work: { status: 'finished', summary: 'result.txt was independently reviewed.' },
    })
    expect(persisted.size).toBe(0)
    expect(core.list()).toHaveLength(2)
    expect(resources.list()).toEqual([])
    expect(lead.inbox.nextTurn).toEqual([])
    expect(reviewer.inbox.nextStep).toEqual([])
    const secondWork = service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    expect(secondWork.work?.id).not.toBe(work.work?.id)
    expect(service.readTrace(run.id, 0, 100).events.map(event => event.type)).toContain('coordination.vote')
    const memberTrace = await service.readMemberTrace(run.id, 'reviewer', -1, 100)
    expect(memberTrace.events).toContainEqual(expect.objectContaining({ type: 'session.user/message' }))
    service.finish(launcher as unknown as Agent, 'cancelled', 'Second work cancelled.')
    service.end(launcher as unknown as Agent, 'Team retired after test.')
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({ status: 'closed', settled: true })
    expect(persisted.size).toBe(2)
    expect(core.list()).toEqual([])
    expect(readFileSync(join(root, '.fleet-registry', run.id, 'run.json'), 'utf8')).toContain('"status": "closed"')
    disconnect()
  })

  it('runs Team lifecycle, work, message, and durable-event hooks at their commit boundaries', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, context, disconnect } = setup(root)
    const starts: string[] = []
    const events: string[] = []
    const disposed: string[] = []
    let rejectWork = true

    context.on('fleet/team/session-start', ({ team, source }) => {
      starts.push(`${team.id}:${source}`)
      team.ctx.on('fleet/message/pre-send', (_payload, next) => {
        const decision = next()
        return decision.kind === 'reject'
          ? decision
          : { kind: 'send', input: { ...decision.input, text: `[hook] ${decision.input.text}` } }
      })
    })
    context.on('fleet/team/event', ({ event }) => { events.push(event.type) })
    context.on('fleet/team/disposed', ({ team }) => { disposed.push(team.id) })
    context.on('fleet/work/pre-start', (_payload, next) => {
      const decision = next()
      return decision.kind === 'reject'
        ? decision
        : { kind: 'start', task: `${decision.task}\n\nHook-added acceptance criteria.` }
    })
    context.on('fleet/work/pre-start', (_payload, next) => {
      return rejectWork ? { kind: 'reject', reason: 'Work is not admitted yet.' } : next()
    })

    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    expect(starts).toEqual([`${run.id}:create`])

    expect(() => service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root }))
      .toThrow('Work is not admitted yet.')
    expect(events).not.toContain('work_started')
    rejectWork = false
    const running = service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const acceptedTaskPath = running.work?.acceptedTaskPath
    expect(acceptedTaskPath).toBeDefined()
    expect(readFileSync(acceptedTaskPath ?? '', 'utf8')).toContain('Hook-added acceptance criteria.')
    expect(runtime.get(run.members[0]?.sessionId ?? '')?.messages.at(-1)?.content)
      .toEqual([expect.objectContaining({ text: expect.stringContaining('Hook-added acceptance criteria.') })])

    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    service.messageHub(run.id).send(lead, { to: '@reviewer', text: 'Review the hook.', delivery: 'quiet' })
    expect(service.messageHub(run.id).read(reviewer, { conversation: '@lead' }).messages.at(-1)?.text)
      .toBe('[hook] Review the hook.')
    expect(service.sendAssistantMessage(launcher as unknown as Agent, {
      runId: run.id,
      kind: 'collaboration',
      text: 'User-facing note.',
    }).text).toBe('[hook] User-facing note.')
    expect(events).toContain('work_started')
    expect(events).toContain('coordination.message')

    service.end(launcher as unknown as Agent, 'Hook lifecycle test complete.', run.id)
    await service.wait(run.id, 1_000)
    expect(disposed).toEqual([run.id])
    disconnect()
  })

  it('reads native member Session events without duplicating them in the Team journal', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')

    const leadTurn: SessionEvent = {
      type: 'turn/start',
      seq: 11,
      time: Date.now(),
      data: { turn: 2 },
    }
    const reviewerTurn: SessionEvent = {
      type: 'turn/start',
      seq: 7,
      time: Date.now(),
      data: { turn: 1 },
    }
    lead.session.events.push(leadTurn)
    reviewer.session.events.push(reviewerTurn)
    service.recordMemberSessionEvent(lead.id, leadTurn)
    service.recordMemberSessionEvent(reviewer.id, reviewerTurn)
    service.messageHub(run.id).send(lead, {
      to: '@reviewer',
      text: 'Please inspect this change.',
      delivery: 'quiet',
    })

    expect(service.readTrace(run.id, 0, 100).events.some(event => event.type.startsWith('session.'))).toBe(false)
    await expect(service.readMemberTrace(run.id, 'lead', -1, 100)).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ scope: 'member', member: 'lead', sourceSequence: 11, type: 'session.turn/start' }),
      ]),
    })
    const leadProjection = service.readMemberProjection(run.id, 'lead', 0, 100).events
    expect(leadProjection.some(event => event.type.startsWith('session.'))).toBe(false)
    expect(readFileSync(join(root, '.fleet-registry', run.id, 'events.jsonl'), 'utf8')).not.toContain('"type":"session.')

    service.end(launcher as unknown as Agent, 'Journal projection test complete.')
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('reads cold member trace pages through the optional Session archive', async () => {
    const { root, configPath } = fixture()
    const archive = {
      find: vi.fn(async () => ({ activeSessionId: 'session-new', segments: [{ sessionId: 'session-old' }] })),
      readPage: vi.fn(async () => ({
        items: [{
          sessionId: 'session-old',
          event: { seq: 8, time: Date.now(), type: 'turn/start', data: { turn: 3 } },
        }],
        previous: { segment: 0, beforeSeq: 8 },
      })),
    }
    const { service, launcher, disconnect } = setup(root, { sessionArchive: archive })
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })

    await expect(service.readMemberTracePage(run.id, 'lead', 40, { segment: 1, beforeSeq: 20 }))
      .resolves.toMatchObject({
        hasMore: true,
        previous: { segment: 0, beforeSeq: 8 },
        events: [expect.objectContaining({ sessionId: 'session-old', sequence: 8, type: 'session.turn/start' })],
      })
    expect(archive.find).toHaveBeenCalledWith(`fleet/${run.id}/members/lead`)
    expect(archive.readPage).toHaveBeenCalledWith(`fleet/${run.id}/members/lead`, expect.objectContaining({
      limit: 40,
      cursor: { segment: 1, beforeSeq: 20 },
    }))
    disconnect()
  })

  it('reads bounded recent progress without exposing reasoning or full tool output by default', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet peers')
    reviewer.status = 'running'
    service.agentStatusChanged(reviewer as unknown as Agent)
    service.memberStatusBoard(run.id).set(reviewer.id, 'Reproducing the latest result')
    reviewer.session.events.push(
      {
        seq: 1,
        time: 1_000,
        type: 'user/message',
        data: { content: [{ type: 'text', text: 'private input' }] },
      },
      {
        seq: 2,
        time: 2_000,
        type: 'assistant/message',
        data: { message: { content: [{ type: 'reasoning', text: 'private reasoning' }] } },
      },
      {
        seq: 3,
        time: 3_000,
        type: 'assistant/message',
        data: { message: { content: [{ type: 'text', text: 'Found a reproducible discrepancy.' }] } },
      },
      {
        seq: 4,
        time: 4_000,
        type: 'tool/call',
        data: { callId: 'call-1', name: 'bash', arguments: '{"command":"pnpm test --filter reproduction"}' },
      },
      {
        seq: 5,
        time: 5_000,
        type: 'tool/result',
        data: { message: { content: [{ type: 'text', text: 'All reproduction checks passed.' }] } },
      },
      {
        seq: 6,
        time: 6_000,
        type: 'assistant/message',
        data: { interrupted: true, message: { content: [{ type: 'text', text: 'partial output' }] } },
      },
    )

    await expect(service.readMemberProgress(lead as unknown as Agent, run.id, '@reviewer')).resolves.toMatchObject({
      runId: run.id,
      member: 'reviewer',
      displayName: 'Reviewer',
      runtimeStatus: 'running',
      declaredStatus: { text: 'Reproducing the latest result', updatedAt: expect.any(String) },
      cursor: 6,
      hasMore: false,
      items: [
        { sequence: 3, kind: 'output', text: 'Found a reproducible discrepancy.' },
        { sequence: 4, kind: 'tool_call', name: 'bash' },
      ],
    })

    await expect(service.readMemberProgress(lead as unknown as Agent, run.id, 'Reviewer', {
      afterSequence: 3,
      includeOutputs: true,
      maxCharsPerItem: 100,
    })).resolves.toMatchObject({
      cursor: 6,
      items: [
        { sequence: 4, kind: 'tool_call', name: 'bash', text: '{"command":"pnpm test --filter reproduction"}' },
        { sequence: 5, kind: 'tool_result', text: 'All reproduction checks passed.' },
      ],
    })
    disconnect()
  })

  it('limits progress inspection to reachable members', async () => {
    const { root, configPath } = fixture()
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      core: { members: Array<{ id: string; contacts: { members: '*' | string[] } }> }
    }
    const lead = config.core.members.find(member => member.id === 'lead')
    if (lead === undefined) throw new Error('expected lead configuration')
    lead.contacts.members = []
    writeFileSync(configPath, JSON.stringify(config))
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const leadAgent = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (leadAgent === undefined) throw new Error('expected live Fleet lead')

    await expect(service.readMemberProgress(leadAgent as unknown as Agent, run.id, '@reviewer'))
      .rejects.toThrow('cannot inspect @reviewer')
    disconnect()
  })

  it('locates a delivered message in the live native member Session', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (lead === undefined) throw new Error('expected live Fleet lead')
    lead.session.events.push({
      seq: 6,
      time: Date.now(),
      type: 'user/message',
      data: { id: 'delivered-context', role: 'user', content: [], source: { kind: 'injected' } },
    })

    await expect(service.readMemberSourceTrace(run.id, 'lead', lead.id, 'delivered-context', 20))
      .resolves.toMatchObject({
        targetSessionId: lead.id,
        targetSequence: 6,
        events: [expect.objectContaining({ sessionId: lead.id, sequence: 6, type: 'session.user/message' })],
      })
    disconnect()
  })

  it('skips legacy Session journal entries and reads the final sequence from a large tail event', async () => {
    const { root, configPath } = fixture()
    const { service, core, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const eventsPath = join(root, '.fleet-registry', run.id, 'events.jsonl')
    const legacySequence = 123_456
    const legacy = {
      sequence: legacySequence,
      createdAt: new Date().toISOString(),
      type: 'session.assistant/message',
      data: { message: { content: 'x'.repeat(130_000) } },
      member: { name: 'lead', sessionId: 'legacy-session', sequence: 99 },
    }
    writeFileSync(eventsPath, `${readFileSync(eventsPath, 'utf8')}${JSON.stringify(legacy)}\n`)

    expect(service.readTrace(run.id, 0, 1_000).events.some(event => event.type.startsWith('session.'))).toBe(false)
    const internal = service as unknown as { lastStoredSequence: (record: unknown) => number }
    expect(internal.lastStoredSequence(run)).toBe(legacySequence)

    disconnect()
    await core.close()
  })

  it('distinguishes working, waiting, and idle member runtime states without persisting the heuristic', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T00:00:00.000Z'))
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    const leadStatus = (): FleetRunMember['status'] => service.status(run.id).members
      .find(member => member.name === 'lead')?.status
    const sessionEvent = (event: unknown): SessionEvent => event as SessionEvent

    lead.status = 'running'
    service.recordMemberSessionEvent(lead.id, sessionEvent({
      type: 'tool/call',
      seq: 1,
      time: Date.now(),
      data: { turn: 1, step: 1, callId: 'wait-1', name: 'fleet_wait', arguments: '{"timeout_ms":30000}' },
    }))
    expect(leadStatus()).toBe('running')
    vi.advanceTimersByTime(2_000)
    expect(leadStatus()).toBe('waiting')

    service.recordMemberSessionEvent(lead.id, sessionEvent({
      type: 'tool/result',
      seq: 2,
      time: Date.now(),
      data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'wait-1' } } },
    }))
    expect(leadStatus()).toBe('running')

    service.recordMemberSessionEvent(lead.id, sessionEvent({
      type: 'tool/call',
      seq: 3,
      time: Date.now(),
      data: { turn: 1, step: 2, callId: 'sleep-1', name: 'bash', arguments: '{"command":"sleep 30"}' },
    }))
    vi.advanceTimersByTime(2_000)
    expect(leadStatus()).toBe('waiting')
    service.recordMemberSessionEvent(lead.id, sessionEvent({
      type: 'tool/result',
      seq: 4,
      time: Date.now(),
      data: { turn: 1, step: 2, message: { source: { kind: 'tool', callId: 'sleep-1' } } },
    }))

    service.recordMemberSessionEvent(lead.id, sessionEvent({
      type: 'tool/call',
      seq: 5,
      time: Date.now(),
      data: { turn: 1, step: 3, callId: 'build-1', name: 'bash', arguments: '{"command":"pnpm test && sleep 30"}' },
    }))
    vi.advanceTimersByTime(89_000)
    expect(leadStatus()).toBe('running')
    service.recordMemberSessionEvent(lead.id, sessionEvent({
      type: 'assistant/chunk',
      seq: 6,
      time: Date.now(),
      data: { turn: 1, step: 3, chunk: { type: 'text-delta', text: 'progress' } },
    }))
    vi.advanceTimersByTime(89_999)
    expect(leadStatus()).toBe('running')
    vi.advanceTimersByTime(1)
    expect(leadStatus()).toBe('waiting')

    lead.completeTurn()
    service.agentIdle(lead as unknown as Agent)
    expect(leadStatus()).toBe('idle')

    lead.status = 'running'
    service.recordMemberSessionEvent(lead.id, sessionEvent({
      type: 'turn/end',
      seq: 7,
      time: Date.now(),
      data: { turn: 1, reason: { kind: 'error', error: { message: 'Provider request failed', code: 'UNKNOWN' } } },
    }))
    lead.completeTurn()
    service.agentIdle(lead as unknown as Agent)
    expect(leadStatus()).toBe('error')

    lead.status = 'running'
    service.recordMemberSessionEvent(lead.id, sessionEvent({
      type: 'turn/start',
      seq: 8,
      time: Date.now(),
      data: { turn: 2 },
    }))
    expect(leadStatus()).toBe('running')
    disconnect()
  })

  it('keeps the Team projection bounded and reads only the recent member trace tail', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (lead === undefined) throw new Error('expected live Fleet lead')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (reviewer === undefined) throw new Error('expected live Fleet reviewer')
    service.readWebTeamProjection(run.id, 0, 1_000)
    service.memberStatusBoard(run.id).set(String(lead.id), 'Reviewing the long-running projection')
    service.recordDataEvent(run.id, 'resource.document_updated', {
      action: 'updated',
      document: { id: 'doc-1', name: 'plan', title: 'Execution plan' },
      actor: 'lead',
    })
    service.recordDataEvent(run.id, 'workspace.assigned', {
      member: 'lead',
      workspaces: [{ name: 'source', path: join(root, 'src'), access: 'write' }],
      actor: 'lead',
    })
    service.recordDataEvent(run.id, 'memory.stored', {
      sourceSequence: 1,
      eventType: 'work_started',
      providers: ['patchouli-test'],
      storedCount: 1,
    })
    service.recordDataEvent(run.id, 'memory.recalled', {
      member: 'lead',
      query: 'Why did we choose this plan?',
      providers: ['patchouli-test'],
      resultCount: 2,
    })
    service.recordDataEvent(run.id, 'memory.stored', {
      sourceSequence: 0,
      eventType: 'work_started',
      providers: ['patchouli-test'],
      storedCount: 0,
    })
    service.recordDataEvent(run.id, 'memory.recalled', {
      member: 'lead',
      query: 'No matching Team memory',
      providers: ['patchouli-test'],
      resultCount: 0,
    })
    const internal = service as unknown as { storedEvents: (record: unknown) => unknown[] }
    const storedEvents = internal.storedEvents.bind(service)
    let journalReads = 0
    internal.storedEvents = record => {
      journalReads += 1
      return storedEvents(record)
    }

    for (let index = 0; index < 520; index += 1) {
      service.messageHub(run.id).send(lead, {
        to: '#main',
        text: `Long-running message ${String(index)}`,
        delivery: 'quiet',
      })
    }
    service.messageHub(run.id).read(reviewer, { conversation: '#main', limit: 50 })
    for (let sequence = 0; sequence < 300; sequence += 1) {
      lead.session.events.push({
        seq: sequence,
        time: Date.now() + sequence,
        type: 'assistant/message',
        data: { message: { content: `Trace ${String(sequence)}` } },
      })
      service.recordMemberSessionEvent(lead.id, {
        seq: sequence,
        time: Date.now() + sequence,
        type: 'assistant/message',
        data: { message: { content: `Trace ${String(sequence)}` } },
      })
    }

    let projection = service.readWebTeamProjection(run.id, 0, 1_000)
    const projectedEvents = [...projection.events]
    while (projection.hasMore) {
      projection = service.readWebTeamProjection(run.id, projectedEvents.at(-1)?.sequence ?? 0, 1_000)
      projectedEvents.push(...projection.events)
    }
    expect(journalReads).toBe(0)
    expect(projectedEvents.filter(event => event.type === 'coordination.message')).toHaveLength(100)
    expect(projectedEvents.filter(event => event.type === 'coordination.inbox')).toHaveLength(200)
    expect(projectedEvents).toContainEqual(expect.objectContaining({
      type: 'member_status.updated',
      data: expect.objectContaining({
        status: expect.objectContaining({ member: 'lead', message: 'Reviewing the long-running projection' }),
      }),
    }))
    expect(projectedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'resource.document_updated' }),
      expect.objectContaining({ type: 'workspace.assigned' }),
      expect.objectContaining({ type: 'memory.stored' }),
      expect.objectContaining({ type: 'memory.recalled' }),
    ]))
    expect(projectedEvents).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'memory.stored', data: expect.objectContaining({ sourceSequence: 0 }) }),
      expect.objectContaining({ type: 'memory.recalled', data: expect.objectContaining({ query: 'No matching Team memory' }) }),
    ]))
    expect(projectedEvents.some(event => event.type.startsWith('session.'))).toBe(false)
    expect(readFileSync(join(root, '.fleet-registry', run.id, 'events.jsonl'), 'utf8')).not.toContain('"type":"session.')

    const tail = await service.readMemberTraceTail(run.id, 'lead', 240)
    expect(tail.hasMore).toBe(true)
    expect(tail.events).toHaveLength(240)
    expect(tail.events[0]?.sequence).toBe(60)
    expect(tail.events.at(-1)?.sequence).toBe(299)

    service.end(launcher as unknown as Agent, 'Projection reliability test complete.')
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('keeps legacy recipient snapshots absent in the Web Team projection', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = run.members.find(member => member.name === 'lead')
    if (lead === undefined) throw new Error('expected Fleet lead')
    const internal = service as unknown as {
      appendEvent(runId: string, type: string, data: unknown): void
    }
    internal.appendEvent(run.id, 'coordination.message', {
      type: 'message',
      message: {
        id: 'legacy-message', sequence: 1, kind: 'text', conversation: `@${lead.sessionId}`,
        from: 'fleet-user:legacy', text: 'Legacy delivery.', resources: [], mentions: [],
        delivery: 'quiet', createdAt: '2026-08-26T00:00:00.000Z',
      },
    })

    const event = service.readWebTeamProjection(run.id, 0, 1_000).events.find(candidate =>
      candidate.type === 'coordination.message'
      && (candidate.data as { readonly message?: { readonly id?: string } }).message?.id === 'legacy-message')
    expect(event).toBeDefined()
    expect((event?.data as { readonly message: object }).message).not.toHaveProperty('recipientIds')

    disconnect()
  })

  it('searches a large Team journal in one bounded newest-first pass', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const eventsPath = join(root, '.fleet-registry', run.id, 'events.jsonl')
    const lines = Array.from({ length: 20_000 }, (_, offset) => {
      const sequence = offset + 1
      const milestone = sequence % 1_000 === 0
      return JSON.stringify({
        sequence,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
        type: milestone ? 'task.updated' : 'coordination.message',
        data: milestone
          ? { member: 'lead', text: `Milestone ${String(sequence)}`, detail: 'x'.repeat(256) }
          : { member: 'reviewer', text: `Routine ${String(sequence)}` },
      })
    })
    writeFileSync(eventsPath, `${lines.join('\n')}\n`, 'utf8')

    await expect(service.searchTeamHistory(run.id, {
      query: 'milestone',
      member: 'lead',
      typePrefixes: ['task.'],
      afterSequence: 5_000,
      limit: 3,
    })).resolves.toMatchObject({
      runId: run.id,
      hasMore: true,
      events: [
        { sequence: 20_000, type: 'task.updated' },
        { sequence: 19_000, type: 'task.updated' },
        { sequence: 18_000, type: 'task.updated' },
      ],
    })

    disconnect()
  })

  it('applies workspace resource authorization to visible history events', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, authorization, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = run.members.find(member => member.name === 'lead')
    if (lead === undefined) throw new Error('expected Fleet lead')
    const allowed = join(root, 'allowed-workspace')
    const denied = join(root, 'denied-workspace')
    authorization.registerNamespace({
      namespace: 'workspace',
      actions: [{ id: 'read', description: 'Read workspace mounts.' }],
      defaultActions: ({ member }) => member.toolGroups.includes('resources') ? ['read'] : [],
    })
    authorization.installResourcePolicy({
      authorize: (input, baseline) => input.resource?.kind === 'workspace'
        ? input.resource.id === 'workspace-id-only' || (baseline && input.resource.id !== denied)
        : baseline,
    })
    service.recordDataEvent(run.id, 'workspace.attached', {
      workspace: { id: 'workspace-allowed', path: allowed },
    })
    service.recordDataEvent(run.id, 'workspace.attached', {
      workspace: { id: 'workspace-denied', path: denied },
    })
    service.recordDataEvent(run.id, 'workspace.assigned', {
      member: 'lead',
      workspaces: [
        { id: 'workspace-allowed', path: allowed },
        { id: 'workspace-denied', path: denied },
      ],
    })
    service.recordDataEvent(run.id, 'workspace.detached', { workspaceId: 'workspace-id-only' })
    service.recordDataEvent(run.id, 'workspace.detached', { actor: 'lead' })

    const result = await service.searchTeamHistory(run.id, {
      typePrefixes: ['workspace.'],
      visibleToSessionId: lead.sessionId,
      limit: 20,
    })
    expect(result.events).toHaveLength(2)
    expect(result.events).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'workspace.attached',
      data: { workspace: { id: 'workspace-allowed', path: allowed } },
    }), expect.objectContaining({
      type: 'workspace.detached',
      data: { workspaceId: 'workspace-id-only' },
    })]))

    disconnect()
  })

  it('pages older conversation messages backward without loading them into the live projection', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (lead === undefined) throw new Error('expected live Fleet lead')
    for (const text of ['one', 'two', 'three']) {
      service.messageHub(run.id).send(lead, { to: '#main', text, delivery: 'quiet' })
    }

    const latest = service.readConversationProjection(run.id, '#main', Number.MAX_SAFE_INTEGER, 2)
    expect(latest.events.filter(event => event.type === 'coordination.message').map(event => (
      event.data as { message: { text: string } }
    ).message.text)).toEqual(['two', 'three'])
    expect(latest).toMatchObject({ hasMore: true, previousSequence: expect.any(Number) })

    const older = service.readConversationProjection(run.id, '#main', latest.previousSequence ?? 0, 2)
    expect(older.events.filter(event => event.type === 'coordination.message').map(event => (
      event.data as { message: { text: string } }
    ).message.text)).toEqual(['one'])
    expect(older.hasMore).toBe(false)

    service.end(launcher as unknown as Agent, 'Conversation pagination verified.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('derives one acknowledged activity inbox from Team messages', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const leadId = run.members.find(member => member.name === 'lead')?.sessionId ?? ''
    const reviewerId = run.members.find(member => member.name === 'reviewer')?.sessionId ?? ''
    const lead = runtime.get(leadId)
    const reviewer = runtime.get(reviewerId)
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')

    service.messageHub(run.id).send(reviewer, {
      to: '@lead',
      text: 'Please review the release task.',
      delivery: 'quiet',
    })
    const inbox = service.activityInbox(lead as unknown as Agent, { runId: run.id, unreadOnly: true })
    expect(inbox.items.map(item => item.kind)).toContain('message')
    const first = inbox.items[0]
    if (first === undefined) throw new Error('expected Fleet activity')
    expect(service.acknowledgeActivity(lead as unknown as Agent, first.sequence, run.id)).toMatchObject({
      sequence: first.sequence,
      acknowledged: true,
    })
    expect(service.activityInbox(lead as unknown as Agent, { runId: run.id, unreadOnly: true }).items)
      .not.toContainEqual(expect.objectContaining({ sequence: first.sequence }))
    expect(service.readTrace(run.id, 0, 200).events).toContainEqual(
      expect.objectContaining({ type: 'activity.acknowledged' }),
    )

    service.end(launcher as unknown as Agent, 'Activity inbox test complete.')
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('keeps old work Votes from finishing new work and waits for the finishing caller to become idle', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const messages = service.messageHub(run.id)
    const firstWork = service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    const oldVote = messages.createVote(lead, {
      channel: '#main',
      kind: 'finish',
      statement: 'Finish the first work item.',
    })
    service.finish(launcher as unknown as Agent, 'cancelled', 'First work was superseded.')
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({ status: 'idle' })

    const secondWork = service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    expect(secondWork.work?.id).not.toBe(firstWork.work?.id)
    messages.castVote(reviewer, { id: oldVote.id, response: 'approve' })
    expect(service.status(run.id)).toMatchObject({ status: 'running', work: { id: secondWork.work?.id } })

    lead.status = 'running'
    const finishing = service.finish(lead as unknown as Agent, 'finished', 'Second work complete.')
    expect(finishing.status).toBe('finishing')
    expect(() => service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root }))
      .toThrow(/cannot start work while finishing/)
    lead.completeTurn()
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({ status: 'idle' })
    service.end(launcher as unknown as Agent, 'Team test complete.')
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('finishes work on resume when an approved bound Vote was persisted before its completion callback', async () => {
    const { root, configPath, taskPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    first.service.start(first.launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const lead = first.runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = first.runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    const vote = first.service.messageHub(run.id).createVote(lead, {
      channel: '#main',
      kind: 'finish',
      statement: 'Persisted approval should finish this work.',
    })
    const eventsPath = join(root, '.fleet-registry', run.id, 'events.jsonl')
    const storedEvents = readFileSync(eventsPath, 'utf8').trim().split('\n')
      .map(line => JSON.parse(line) as { readonly sequence: number })
    const sequence = (storedEvents.at(-1)?.sequence ?? 0) + 1
    const closedVote = {
      ...vote,
      approvals: [reviewer.id],
      status: 'approved',
      closedAt: new Date().toISOString(),
    }
    writeFileSync(eventsPath, `${readFileSync(eventsPath, 'utf8').trim()}\n${JSON.stringify({
      sequence,
      createdAt: new Date().toISOString(),
      type: 'coordination.vote',
      data: { type: 'vote', action: 'closed', vote: closedVote },
    })}\n`)
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })
    expect(resumed).toMatchObject({ status: 'finishing', work: { status: 'finished' } })
    await expect(second.service.wait(run.id, 1_000)).resolves.toMatchObject({ status: 'idle' })
    second.service.end(second.launcher as unknown as Agent, 'Recovered Vote Team closed.')
    await second.service.wait(run.id, 1_000)
    second.disconnect()
  })

  it('records a failed Team without creating Agents when preflight paths are missing', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const required = join(root, 'missing-corpus')

    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [required],
    })

    expect(run).toMatchObject({ status: 'failed', settled: true, members: [] })
    expect(run.summary).toContain(required)
    expect(runtime.creates).toEqual([])
    expect(service.readTrace(run.id, 0, 20).events.map(event => event.type)).toEqual([
      'team_created',
      'team_status',
    ])
    disconnect()
  })

  it('persists member-maintained status across restart', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const leadId = run.members.find(member => member.name === 'lead')?.sessionId ?? ''
    first.service.memberStatusBoard(run.id).set(leadId, 'Waiting for the architecture review')
    expect(first.service.readTrace(run.id, 0, 100).events.map(event => event.type)).toContain('member_status.updated')
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })

    const resumedReviewerId = second.service.status(run.id).members.find(member => member.name === 'reviewer')?.sessionId ?? ''
    expect(second.service.memberStatusBoard(run.id).get(resumedReviewerId, '@lead')).toMatchObject({
      message: 'Waiting for the architecture review',
    })
    expect(second.service.readTrace(run.id, 0, 100).events
      .filter(event => event.type === 'member_status.updated')).toHaveLength(1)

    second.service.end(second.launcher as unknown as Agent, 'Collaboration components restored successfully.')
    await second.service.wait(run.id, 1_000)
    second.disconnect()
  })

  it('loads dormant Team state at DSH startup and resumes it repeatedly', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    expect(existsSync(join(root, '.fleet-registry', `${run.id}.json`))).toBe(true)
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    expect(second.service.status(run.id)).toMatchObject({ id: run.id, status: 'idle' })

    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })
    const reviewer = second.runtime.get(resumed.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (reviewer === undefined) throw new Error('expected resumed reviewer')
    expect(reviewer.messages).toEqual([])
    for (const member of resumed.members) {
      const agent = second.runtime.get(member.sessionId)
      if (agent !== undefined) second.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    second.disconnect()
    await second.core.close()

    const third = setup(root, { launcherId: 'third-launcher', persisted: second.persisted })
    const resumedAgain = await third.service.resume(third.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })
    const reviewerAgain = third.runtime.get(
      resumedAgain.members.find(member => member.name === 'reviewer')?.sessionId ?? '',
    )
    if (reviewerAgain === undefined) throw new Error('expected reviewer after second restart')
    expect(reviewerAgain.messages).toEqual([])

    third.service.end(third.launcher as unknown as Agent, 'Background persistence test complete.')
    await third.service.wait(run.id, 1_000)
    expect(existsSync(join(root, '.fleet-registry', `${run.id}.json`))).toBe(false)
    third.disconnect()
  })

  it('loads only the selected member when resuming from a dormant Team', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    expect(second.service.status(run.id)).toMatchObject({
      runtimeState: 'dormant',
      members: [
        expect.objectContaining({ name: 'lead', status: 'unknown' }),
        expect.objectContaining({ name: 'reviewer', status: 'unknown' }),
      ],
    })

    await expect(second.service.resumeMemberAsExternal(second.launcher as unknown as Agent, run.id, 'lead'))
      .resolves.toMatchObject({ name: 'lead', status: 'idle' })
    const loaded = second.service.status(run.id)
    expect(loaded).toMatchObject({
      runtimeState: 'active',
      members: [
        expect.objectContaining({ name: 'lead', status: 'idle' }),
        expect.objectContaining({ name: 'reviewer', status: 'unknown' }),
      ],
    })
    expect(second.runtime.get(loaded.members.find(member => member.name === 'lead')?.sessionId ?? '')).toBeDefined()
    expect(second.runtime.get(loaded.members.find(member => member.name === 'reviewer')?.sessionId ?? '')).toBeUndefined()
    expect(second.service.readTrace(run.id, 0, 300).events).toContainEqual(expect.objectContaining({
      type: 'team_loaded',
      data: expect.stringContaining('"members":["lead"],"scope":"member"'),
    }))

    await expect(second.service.loadTeamMembersAsExternal(second.launcher as unknown as Agent, run.id))
      .resolves.toMatchObject({
        runtimeState: 'active',
        members: [
          expect.objectContaining({ name: 'lead', status: 'idle' }),
          expect.objectContaining({ name: 'reviewer', status: 'idle' }),
        ],
      })

    second.disconnect()
    await second.core.close()
  })

  it('pauses only loaded members and wakes the partially loaded Team', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'launcher', persisted: first.persisted })
    expect(second.service.status(run.id)).toMatchObject({
      runtimeState: 'dormant',
      members: [
        expect.objectContaining({ name: 'lead', status: 'unknown' }),
        expect.objectContaining({ name: 'reviewer', status: 'unknown' }),
      ],
    })

    await expect(second.service.pauseMemberAsExternal(second.launcher as unknown as Agent, run.id, 'reviewer'))
      .rejects.toThrow('Fleet member reviewer is not loaded')
    await expect(second.service.pauseTeamAsExternal(second.launcher as unknown as Agent, run.id))
      .rejects.toThrow('has no loaded, unpaused members to pause')
    await expect(second.service.resumeMemberAsExternal(second.launcher as unknown as Agent, run.id, 'lead'))
      .resolves.toMatchObject({ name: 'lead', status: 'idle' })

    await expect(second.service.pauseTeamAsExternal(second.launcher as unknown as Agent, run.id)).resolves.toMatchObject({
      status: 'paused',
      runtimeState: 'active',
      teamPausedMembers: ['lead'],
      members: [
        expect.objectContaining({ name: 'lead', status: 'paused' }),
        expect.objectContaining({ name: 'reviewer', status: 'unknown' }),
      ],
    })
    expect(second.runtime.resumes).toHaveLength(1)

    const woken = await second.service.wakeTeamAsExternal(second.launcher as unknown as Agent, run.id)
    expect(woken).toMatchObject({
      status: 'idle',
      runtimeState: 'active',
      teamPausedMembers: [],
      members: [
        expect.objectContaining({ name: 'lead', status: 'idle' }),
        expect.objectContaining({ name: 'reviewer', status: 'idle' }),
      ],
    })
    for (const member of woken.members) {
      expect(second.runtime.get(member.sessionId)?.messages.at(-1)?.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('explicitly woken') }),
      ])
    }

    second.disconnect()
    await second.core.close()
  })

  it('resumes the same member Sessions and restores collaboration state after a process restart', async () => {
    const { root, configPath, taskPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
      provider: 'test-provider',
      model: 'test-model',
    })
    first.service.start(first.launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const leadId = run.members.find(member => member.name === 'lead')?.sessionId ?? ''
    const reviewerId = run.members.find(member => member.name === 'reviewer')?.sessionId ?? ''
    const assistantBeforeRestart = run.assistants[0]
    if (assistantBeforeRestart === undefined) throw new Error('expected the default assistant')
    const lead = first.runtime.get(leadId)
    const reviewer = first.runtime.get(reviewerId)
    if (lead === undefined || reviewer === undefined) throw new Error('expected live members')
    const pendingLeadWork = lead.messages[0]
    const pendingReviewerWork = reviewer.messages[0]
    if (pendingLeadWork === undefined || pendingReviewerWork === undefined) throw new Error('expected pending member work')
    first.service.messageHub(run.id).send(lead, {
      to: '#main',
      text: 'Implementation is half complete.',
      delivery: 'quiet',
    })
    const resource = first.service.resourceStore(run.id).addResource(leadId, {
      path: join(root, 'result.bin'),
      label: 'partial output',
      mediaType: 'application/octet-stream',
    })
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    const coordinationMessagesBefore = first.service.readTrace(run.id, 0, 100).events
      .filter(event => event.type === 'coordination.message').length
    first.disconnect()
    await first.core.close()

    const changedTemplate = JSON.parse(readFileSync(configPath, 'utf8')) as {
      core: { members: Array<{ name: string; color?: string }> }
    }
    if (changedTemplate.core.members[0] !== undefined) {
      changedTemplate.core.members[0].name = 'Changed after creation'
      changedTemplate.core.members[0].color = '#bd6578'
    }
    writeFileSync(configPath, JSON.stringify(changedTemplate))

    const second = setup(root, {
      launcherId: 'replacement-launcher',
      persisted: first.persisted,
      resumeInboxes: new Map([
        [leadId, { nextStep: [pendingLeadWork] }],
        [reviewerId, { nextStep: [pendingReviewerWork] }],
      ]),
    })
    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })

    expect(resumed).toMatchObject({
      id: run.id,
      status: 'running',
      settled: false,
      launcherSessionId: 'replacement-launcher',
      members: [
        { name: 'lead', displayName: 'Lead', color: '#527fca' },
        { name: 'reviewer', displayName: 'Reviewer', color: '#7c68bd' },
      ],
      assistants: [{
        sessionId: 'replacement-launcher',
        view: {
          id: assistantBeforeRestart.view.id,
          name: assistantBeforeRestart.view.name,
          color: assistantBeforeRestart.view.color,
          role: assistantBeforeRestart.view.role,
        },
      }],
      assistantSessionAliases: expect.arrayContaining([
        { sessionId: assistantBeforeRestart.sessionId, currentSessionId: 'replacement-launcher' },
        { sessionId: 'replacement-launcher', currentSessionId: 'replacement-launcher' },
      ]),
    })
    expect(second.runtime.resumes).toEqual([
      expect.objectContaining({ id: leadId, provider: 'test-provider', model: 'test-model' }),
      expect.objectContaining({ id: reviewerId, provider: 'test-provider', model: 'test-model' }),
    ])
    expect(second.core.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: expect.stringMatching(/-lead$/),
        displayName: 'Lead',
        color: '#527fca',
        id: leadId,
        managed: true,
      }),
      expect.objectContaining({
        name: expect.stringMatching(/-reviewer$/),
        displayName: 'Reviewer',
        color: '#7c68bd',
        id: reviewerId,
        managed: true,
      }),
    ]))
    const resumedLead = second.runtime.get(leadId)
    const resumedReviewer = second.runtime.get(reviewerId)
    if (resumedLead === undefined || resumedReviewer === undefined) {
      throw new Error('expected resumed members')
    }
    expect(second.service.messageHub(run.id).read(resumedReviewer, { conversation: '#main' }).messages)
      .toContainEqual(expect.objectContaining({ text: 'Implementation is half complete.' }))
    expect(second.service.resourceStore(run.id).getResource(resource.id)).toEqual(resource)
    expect(resumedLead.messages).toHaveLength(0)
    expect(resumedLead.inbox.nextTurn).toHaveLength(0)
    expect(resumedLead.inbox.nextStep).toEqual([pendingLeadWork])
    expect(resumedReviewer.messages).toHaveLength(0)
    expect(resumedReviewer.inbox.nextTurn).toHaveLength(0)
    expect(resumedReviewer.inbox.nextStep).toEqual([pendingReviewerWork])
    second.service.recordMemberSessionEvent(second.launcher.id, {
      type: 'turn/start', seq: 1, time: Date.now(), data: { turn: 1 },
    })
    second.service.agentIdle(resumedLead as unknown as Agent)
    expect(resumedLead.messages).toHaveLength(0)
    expect(resumedReviewer.messages).toHaveLength(0)
    const afterLoadMessage = second.service.messageHub(run.id).send(resumedLead, {
      to: '@reviewer',
      text: 'A new message should still wake you while the loaded Team awaits a manual wake.',
      delivery: 'quiet',
    })
    second.service.agentIdle(resumedReviewer as unknown as Agent)
    expect(resumedReviewer.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining(afterLoadMessage.messageId) }),
    ])
    const reviewerMessagesAfterUnreadWake = resumedReviewer.messages.length
    await second.service.wakeTeam(second.launcher as unknown as Agent, run.id)
    expect(resumedLead.messages).toHaveLength(1)
    expect(resumedReviewer.messages).toHaveLength(reviewerMessagesAfterUnreadWake + 1)
    expect(second.service.readTrace(run.id, 0, 100).events
      .filter(event => event.type === 'coordination.message')).toHaveLength(coordinationMessagesBefore + 1)
    expect(second.service.readTrace(run.id, 0, 100).events)
      .toContainEqual(expect.objectContaining({ type: 'team_loaded' }))

    second.service.finish(second.launcher as unknown as Agent, 'cancelled', 'Resume test complete.')
    await expect(second.service.wait(run.id, 1_000)).resolves.toMatchObject({ status: 'idle', settled: false })
    second.service.end(second.launcher as unknown as Agent, 'Resume test Team closed.')
    await expect(second.service.wait(run.id, 1_000)).resolves.toMatchObject({ status: 'closed', settled: true })
    second.disconnect()
  })

  it('rebinds Fleet members when a Session Archive resumes a newer hot segment', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const resumedIds = new Map(run.members.map(member => [member.sessionId, `${member.sessionId}-hot`]))
    const second = setup(root, {
      launcherId: 'replacement-launcher',
      persisted: first.persisted,
      resumedIds,
    })
    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })

    for (const member of resumed.members) {
      const previous = run.members.find(candidate => candidate.name === member.name)?.sessionId
      expect(member.sessionId).toBe(`${previous}-hot`)
      expect(second.runtime.get(member.sessionId)).toBeDefined()
    }
    expect(second.runtime.resumes.every(input => input.archiveId?.startsWith(`fleet/${run.id}/members/`) === true)).toBe(true)
    const lead = second.runtime.get(resumed.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = second.runtime.get(resumed.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected rebound Fleet members')
    second.service.messageHub(run.id).send(lead, {
      to: '@reviewer',
      text: 'Archive rebind is live.',
      delivery: 'quiet',
    })
    expect(reviewer.inbox.nextStep.at(-1)?.content)
      .toEqual([expect.objectContaining({ text: expect.stringContaining('Archive rebind is live.') })])

    second.service.end(second.launcher as unknown as Agent, 'Archived Session rebind verified.', run.id)
    await second.service.wait(run.id, 1_000)
    second.disconnect()
  })

  it('restores Team messages and real resource references across restart', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const leadId = run.members.find(member => member.name === 'lead')?.sessionId ?? ''
    const reviewerId = run.members.find(member => member.name === 'reviewer')?.sessionId ?? ''
    const lead = first.runtime.get(leadId)
    const reviewer = first.runtime.get(reviewerId)
    if (lead === undefined || reviewer === undefined) throw new Error('expected live members')

    const resourcePath = join(root, '.fleet', run.id, 'release-notes.md')
    writeFileSync(resourcePath, 'The Team resource is a real file.\n')
    const resource = first.service.resourceStore(run.id).addResource(leadId, {
      path: resourcePath,
      label: 'release-notes.md',
      mediaType: 'text/markdown',
    })
    first.service.messageHub(run.id).send(lead, {
      to: '@reviewer', text: 'Review the persisted resource.', resources: [resource.id], delivery: 'quiet',
    })

    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })
    const resumedLead = second.runtime.get(leadId)
    const resumedReviewer = second.runtime.get(reviewerId)
    if (resumedLead === undefined || resumedReviewer === undefined) throw new Error('expected resumed members')

    expect(second.service.resourceStore(run.id).getResource(resource.id)).toEqual(resource)
    expect(readFileSync(resourcePath, 'utf8')).toBe('The Team resource is a real file.\n')
    expect(second.service.messageHub(run.id).inbox(resumedReviewer, { unreadOnly: true }).map(item => item.message.text))
      .toContain('Review the persisted resource.')
    second.service.end(second.launcher as unknown as Agent, 'Team service recovery verified.', resumed.id)
    await second.service.wait(resumed.id, 1_000)
    second.disconnect()
  })

  it('completes an interrupted create by resuming attached members and creating the missing members', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = run.members.find(member => member.name === 'lead')
    if (lead === undefined) throw new Error('expected lead member')
    first.persisted.set(lead.sessionId, structuredClone(first.runtime.get(lead.sessionId)?.session.events ?? []))
    const runPath = join(root, '.fleet-registry', run.id, 'run.json')
    const eventsPath = join(root, '.fleet-registry', run.id, 'events.jsonl')
    writeFileSync(runPath, `${JSON.stringify({
      ...JSON.parse(readFileSync(runPath, 'utf8')),
      members: [lead],
      status: 'starting',
    }, null, 2)}\n`)
    const startupEvents = readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as { readonly type: string; readonly data: { readonly name?: string } })
      .filter(event => event.type === 'team_created'
        || (event.type === 'member_attached' && event.data.name === 'lead'))
    writeFileSync(eventsPath, `${startupEvents.map(event => JSON.stringify(event)).join('\n')}\n`)
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })

    expect(resumed).toMatchObject({ status: 'idle', settled: false })
    expect(second.runtime.resumes).toEqual([
      expect.objectContaining({ id: lead.sessionId }),
    ])
    expect(second.runtime.creates).toHaveLength(1)
    expect(resumed.members.map(member => member.name)).toEqual(['lead', 'reviewer'])
    const resumedLead = second.runtime.get(lead.sessionId)
    if (resumedLead === undefined) throw new Error('expected resumed lead')
    expect(second.service.messageHub(run.id).listChannels(resumedLead).map(channel => channel.id)).toContain('main')
    expect(second.service.readTrace(run.id, 0, 100).events.map(event => event.type)).toEqual(expect.arrayContaining([
      'team_loaded',
      'team_status',
    ]))
    second.disconnect()
  })

  it('settles a terminal run whose cleanup was interrupted by a process restart', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const runPath = join(root, '.fleet-registry', run.id, 'run.json')
    writeFileSync(runPath, `${JSON.stringify({
      ...JSON.parse(readFileSync(runPath, 'utf8')),
      status: 'closed',
      settled: false,
      summary: 'Cancelled before cleanup completed.',
      endedAt: new Date().toISOString(),
    }, null, 2)}\n`)
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    await expect(second.service.wait(run.id, 1_000, undefined, root)).resolves.toMatchObject({
      status: 'closed',
      settled: true,
    })
    expect(second.service.readTrace(run.id, 0, 100).events.at(-1)).toMatchObject({
      type: 'team_settled',
      data: JSON.stringify({ recoveredAfterRestart: true }),
    })
    second.disconnect()
  })

  it('keeps active work moving when a wake-up is unanswered or the whole Team becomes idle', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')

    const leadMessages = lead.messages.length
    const reviewerMessagesBeforeQuiescence = reviewer.messages.length
    service.agentIdle(lead as unknown as Agent)
    expect(lead.messages).toHaveLength(leadMessages + 1)
    expect(lead.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('every member is idle') }),
    ])
    expect(reviewer.messages).toHaveLength(reviewerMessagesBeforeQuiescence + 1)

    const messages = service.messageHub(run.id)
    const sent = messages.send(lead, {
      to: '@reviewer',
      text: 'Please finish the independent review.',
      delivery: 'wakeup',
    })
    const reviewerMessages = reviewer.messages.length
    service.agentIdle(reviewer as unknown as Agent)
    expect(reviewer.messages).toHaveLength(reviewerMessages + 1)
    expect(reviewer.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining(sent.messageId) }),
    ])
    const reply = messages.send(reviewer, {
      to: '@lead',
      text: 'Independent review complete.',
      delivery: 'quiet',
    })
    expect(reply.woken).toBe(0)
    expect(messages.pendingWakeups(lead.id)).toEqual([])
    expect(messages.pendingWakeups(reviewer.id)).toEqual([])
    expect(service.readTrace(run.id, 0, 100).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'member_continued', data: expect.stringContaining('team_quiescent') }),
      expect.objectContaining({ type: 'member_continued', data: expect.stringContaining('pending_wakeup') }),
    ]))

    await service.pauseMember(launcher as unknown as Agent, run.id, 'reviewer')
    const messagesBeforePausedContinuation = lead.messages.length
    service.agentIdle(lead as unknown as Agent)
    expect(lead.messages).toHaveLength(messagesBeforePausedContinuation + 1)
    expect(lead.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining(reply.messageId) }),
    ])

    service.finish(launcher as unknown as Agent, 'cancelled', 'Continuation behavior verified.', run.id)
    await service.wait(run.id, 1_000)
    service.end(launcher as unknown as Agent, 'Continuation Team closed.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('starts another member turn with a required-reply notice for a quiet mentioned message', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    lead.status = 'running'
    reviewer.status = 'running'

    const sent = service.messageHub(run.id).send(lead, {
      to: '#main',
      text: 'Please inspect the latest result after this turn.',
      mentions: ['@reviewer'],
      delivery: 'quiet',
    })
    expect(service.messageHub(run.id).pendingWakeups(reviewer.id)).toEqual([])
    const messagesAfterInjection = reviewer.messages.length

    service.recordMemberSessionEvent(reviewer.id, {
      type: 'turn/end',
      seq: 1,
      time: Date.now(),
      data: { turn: 1, reason: { kind: 'completed' } },
    })
    reviewer.completeTurn()
    service.agentStatusChanged(reviewer as unknown as Agent)

    expect(reviewer.messages).toHaveLength(messagesAfterInjection + 2)
    expect(reviewer.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining(`Message ${sent.messageId}`),
      }),
    ])
    expect(service.readTrace(run.id, 0, 200).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'coordination.system_notification', data: expect.stringContaining('message_notice') }),
      expect.objectContaining({ type: 'member_continued', data: expect.stringContaining('required_reply') }),
    ]))

    service.finish(launcher as unknown as Agent, 'cancelled', 'Unread continuation verified.', run.id)
    await service.wait(run.id, 1_000)
    service.end(launcher as unknown as Agent, 'Unread continuation Team closed.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('keeps a member active after reading a must-reply message until it replies in that conversation', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    lead.status = 'running'
    reviewer.status = 'running'

    const messages = service.messageHub(run.id)
    const sent = service.sendUserConversationMessage({
      runId: run.id,
      to: `@${reviewer.id}`,
      text: 'Confirm the result before going idle.',
      delivery: 'quiet',
    })
    expect(messages.read(reviewer, { conversation: `@fleet-user:${run.id}` }).messages)
      .toContainEqual(expect.objectContaining({ id: sent.messageId, mustReply: true }))
    expect(messages.inbox(reviewer, { unreadOnly: true })).toEqual([])
    expect(messages.pendingRequiredReply(reviewer.id)).toMatchObject({ id: sent.messageId })

    const messagesBeforeRequiredReplyWake = reviewer.messages.length
    reviewer.completeTurn()
    service.agentStatusChanged(reviewer as unknown as Agent)
    expect(reviewer.messages).toHaveLength(messagesBeforeRequiredReplyWake + 1)
    expect(reviewer.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining(`Message ${sent.messageId}`),
      }),
    ])

    messages.send(reviewer, {
      to: '@User',
      text: 'The result is confirmed.',
      delivery: 'quiet',
    })
    expect(messages.pendingRequiredReply(reviewer.id)).toBeUndefined()
    const messagesAfterReply = reviewer.messages.length
    service.agentIdle(reviewer as unknown as Agent)
    expect(reviewer.messages).toHaveLength(messagesAfterReply)
    expect(service.readTrace(run.id, 0, 200).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'member_continued', data: expect.stringContaining('required_reply') }),
    ]))

    service.finish(launcher as unknown as Agent, 'cancelled', 'Required reply behavior verified.', run.id)
    await service.wait(run.id, 1_000)
    service.end(launcher as unknown as Agent, 'Required reply Team closed.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('keeps a user-facing assistant active for must-reply messages while the Team has no running work', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected attached Fleet assistant')
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: first.launcher.id })
    const { service, launcher } = second
    const registeredTools: string[] = []
    const scoped = new FakeAgentContext() as FakeAgentContext & {
      tools: {
        register(tool: { readonly name: string }): () => void
        restrict(): () => void
        guard(): () => void
        get(name: string): unknown
      }
    }
    launcher.ctx = scoped as unknown as Context
    await service.attachAssistant(launcher as unknown as Agent, { runId: run.id })
    expect(service.status(run.id)).toMatchObject({ runtimeState: 'dormant' })
    scoped.tools = {
      register: tool => { registeredTools.push(tool.name); return () => {} },
      restrict: () => () => {},
      guard: () => () => {},
      get: name => ['fleet_send', 'fleet_followup', 'fleet_progress'].includes(name) ? { name } : undefined,
    }
    service.agentSessionStarted(launcher as unknown as Agent)
    expect(registeredTools).toContain('fleet_send')
    expect(registeredTools).toContain('fleet_messages')
    const messages = service.messageHub(run.id)
    const sent = service.sendUserConversationMessage({
      runId: run.id,
      to: `@${assistantId}`,
      text: 'Reply before becoming idle.',
      delivery: 'wakeup',
    })
    expect(service.status(run.id)).toMatchObject({ status: 'idle' })
    expect(messages.pendingRequiredReply(assistantId)).toMatchObject({ id: sent.messageId })

    const beforeRequiredReplyWake = launcher.messages.length
    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    })
    expect(launcher.messages).toHaveLength(beforeRequiredReplyWake + 1)
    expect(launcher.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining(`Message ${sent.messageId}`),
      }),
    ])
    expect(service.readTrace(run.id, 0, 200).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'member_continued', data: expect.stringContaining('required_reply') }),
    ]))

    messages.send(launcher as unknown as Agent, {
      to: '@User',
      text: 'The required reply is complete.',
      delivery: 'quiet',
    })
    expect(messages.pendingRequiredReply(assistantId)).toBeUndefined()
    const afterReply = launcher.messages.length
    service.agentStatusChanged(launcher as unknown as Agent)
    expect(launcher.messages).toHaveLength(afterReply + 1)
    expect(launcher.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Call fleet_messages with action="read"'),
      }),
    ])
    messages.read(launcher as unknown as Agent, { conversation: '@User' })
    const afterRead = launcher.messages.length
    service.agentIdle(launcher as unknown as Agent)
    expect(launcher.messages).toHaveLength(afterRead)
    second.disconnect()
  })

  it('keeps a user-facing assistant active for unread member replies while the Team has no running work', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (assistantId === undefined || lead === undefined) throw new Error('expected assistant and lead')
    expect(service.status(run.id)).toMatchObject({ status: 'idle' })

    const sent = service.messageHub(run.id).send(lead, {
      to: '#main',
      text: '@team-assistant The requested analysis is ready.',
      mentions: [`@${assistantId}`],
      delivery: 'quiet',
    })
    const afterArrival = launcher.messages.length
    service.agentSessionStarted(launcher as unknown as Agent)

    await vi.waitFor(() => expect(launcher.messages).toHaveLength(afterArrival + 1))
    expect(launcher.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining(`Message ${sent.messageId}`),
      }),
    ])
    expect(service.readTrace(run.id, 0, 200).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'member_continued', data: expect.stringContaining(sent.messageId) }),
    ]))

    expect(service.conversationMessages(launcher as unknown as Agent, {
      action: 'read',
      conversation: '#main',
    })).toMatchObject({
      messages: [expect.objectContaining({ id: sent.messageId })],
    })
    const afterRead = launcher.messages.length
    service.agentIdle(launcher as unknown as Agent)
    expect(launcher.messages).toHaveLength(afterRead + 1)
    service.messageHub(run.id).send(launcher as unknown as Agent, {
      to: '#main',
      text: 'Analysis received; thank you.',
      delivery: 'quiet',
    })
    const afterReply = launcher.messages.length
    service.agentIdle(launcher as unknown as Agent)
    expect(launcher.messages).toHaveLength(afterReply)
    disconnect()
  })

  it('pauses and resumes a Team without resuming members that were already paused individually', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })

    await service.pauseMember(launcher as unknown as Agent, run.id, 'reviewer')
    const runningLead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (runningLead === undefined) throw new Error('expected live lead')
    runningLead.status = 'running'
    launcher.status = 'running'
    const [paused, duplicatePause] = await Promise.all([
      service.pauseTeam(launcher as unknown as Agent, run.id),
      service.pauseTeam(launcher as unknown as Agent, run.id),
    ])

    expect(paused).toMatchObject({
      status: 'paused',
      teamPausedMembers: ['lead'],
      members: [
        expect.objectContaining({ name: 'lead', status: 'paused' }),
        expect.objectContaining({ name: 'reviewer', status: 'paused' }),
      ],
    })
    expect(runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')).toBeUndefined()
    expect(runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')).toBeUndefined()
    expect(runningLead.cancelCount).toBe(1)
    expect(launcher.cancelCount).toBe(1)
    expect(paused.assistants[0]).toMatchObject({ status: 'idle' })
    expect(duplicatePause).toEqual(paused)

    const resumed = await service.resumeTeam(launcher as unknown as Agent, run.id)
    expect(resumed).toMatchObject({
      status: 'running',
      teamPausedMembers: [],
      members: [
        expect.objectContaining({ name: 'lead', status: 'idle' }),
        expect.objectContaining({ name: 'reviewer', status: 'paused' }),
      ],
    })
    const resumedLead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    expect(resumedLead?.messages).toHaveLength(0)
    expect(runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')).toBeUndefined()
    await service.wakeTeam(launcher as unknown as Agent, run.id)
    expect(resumedLead?.messages).toHaveLength(1)
    expect(service.status(run.id).members).toContainEqual(expect.objectContaining({ name: 'reviewer', status: 'idle' }))
    expect(runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')?.messages).toHaveLength(1)

    service.end(launcher as unknown as Agent, 'Team pause controls verified.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('explicitly wakes every online member without interrupting the active work', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    const leadMessages = lead.messages.length
    const reviewerMessages = reviewer.messages.length
    const assistantMessages = launcher.messages.length

    expect(await service.wakeTeam(launcher as unknown as Agent, run.id)).toMatchObject({ status: 'running' })
    expect(lead.messages).toHaveLength(leadMessages + 1)
    expect(reviewer.messages).toHaveLength(reviewerMessages + 1)
    expect(launcher.messages).toHaveLength(assistantMessages + 1)
    expect(service.readTrace(run.id, 0, 200).events).toContainEqual(expect.objectContaining({
      type: 'team_woken',
      data: expect.stringContaining('"reason":"manual"'),
    }))

    service.finish(launcher as unknown as Agent, 'cancelled', 'Team wake verified.', run.id)
    await service.wait(run.id, 1_000)
    service.end(launcher as unknown as Agent, 'Wake test Team closed.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('wakes one unpaused member without interrupting another member', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    const leadMessages = lead.messages.length
    const reviewerMessages = reviewer.messages.length

    expect(await service.wakeMember(launcher as unknown as Agent, run.id, 'lead'))
      .toMatchObject({ name: 'lead' })
    expect(lead.messages).toHaveLength(leadMessages + 1)
    expect(reviewer.messages).toHaveLength(reviewerMessages)
    expect(service.readTrace(run.id, 0, 200).events).toContainEqual(expect.objectContaining({
      type: 'member_woken',
      data: expect.stringContaining('"member":"lead"'),
    }))

    await service.pauseMember(launcher as unknown as Agent, run.id, 'reviewer')
    expect(await service.wakeMember(launcher as unknown as Agent, run.id, 'reviewer'))
      .toMatchObject({ name: 'reviewer', status: 'idle' })
    expect(runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')?.messages.at(-1)?.content)
      .toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('explicitly woken') })])

    service.finish(launcher as unknown as Agent, 'cancelled', 'Member wake verified.', run.id)
    await service.wait(run.id, 1_000)
    service.end(launcher as unknown as Agent, 'Member wake Team closed.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('restores a durably paused Team after process restart and resumes only its Team-paused members', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    await first.service.pauseMember(first.launcher as unknown as Agent, run.id, 'reviewer')
    await first.service.pauseTeam(first.launcher as unknown as Agent, run.id)
    first.disconnect()
    await first.core.close()

    const runPath = join(dirname(run.configPath), 'run.json')
    const interrupted = JSON.parse(readFileSync(runPath, 'utf8')) as {
      members: Array<{ name: string; status: string }>
    }
    const interruptedLead = interrupted.members.find(member => member.name === 'lead')
    if (interruptedLead === undefined) throw new Error('expected persisted lead member')
    interruptedLead.status = 'idle'
    writeFileSync(runPath, JSON.stringify(interrupted))

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    expect(second.service.status(run.id)).toMatchObject({
      status: 'paused',
      runtimeState: 'dormant',
      members: [
        expect.objectContaining({ name: 'lead', status: 'paused' }),
        expect.objectContaining({ name: 'reviewer', status: 'paused' }),
      ],
    })

    const loaded = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })
    expect(loaded).toMatchObject({
      status: 'paused',
      runtimeState: 'active',
      teamPausedMembers: ['lead'],
      members: [
        expect.objectContaining({ name: 'lead', status: 'paused' }),
        expect.objectContaining({ name: 'reviewer', status: 'paused' }),
      ],
    })
    expect(second.runtime.resumes).toHaveLength(0)

    const resumed = await second.service.resumeTeam(second.launcher as unknown as Agent, run.id)
    expect(resumed).toMatchObject({
      status: 'idle',
      teamPausedMembers: [],
      members: [
        expect.objectContaining({ name: 'lead', status: 'idle' }),
        expect.objectContaining({ name: 'reviewer', status: 'paused' }),
      ],
    })
    expect(second.runtime.resumes.map(input => input.id)).toContain(
      run.members.find(member => member.name === 'lead')?.sessionId,
    )
    expect(second.runtime.resumes.map(input => input.id)).not.toContain(
      run.members.find(member => member.name === 'reviewer')?.sessionId,
    )

    second.service.end(second.launcher as unknown as Agent, 'Paused restart recovery verified.', run.id)
    await second.service.wait(run.id, 1_000)
    second.disconnect()
  })

  it('backs off after exhausted network retries and wakes members when their model route recovers', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T08:00:00Z'))
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')

    const failedTurn = (seq: number): SessionEvent => ({
      seq,
      time: Date.now(),
      type: 'turn/end',
      data: {
        turn: seq,
        reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'connection reset' } },
      },
    })
    const completedTurn = (seq: number): SessionEvent => ({
      seq,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: seq, reason: { kind: 'completed' } },
    })

    const leadMessages = lead.messages.length
    const reviewerMessages = reviewer.messages.length
    service.recordMemberSessionEvent(lead.id, failedTurn(10))
    service.recordMemberSessionEvent(reviewer.id, failedTurn(10))
    service.agentIdle(lead as unknown as Agent)
    service.agentIdle(reviewer as unknown as Agent)
    expect(lead.messages).toHaveLength(leadMessages)
    expect(reviewer.messages).toHaveLength(reviewerMessages)

    service.recordMemberSessionEvent(lead.id, completedTurn(11))
    expect(lead.messages).toHaveLength(leadMessages)
    expect(reviewer.messages).toHaveLength(reviewerMessages + 1)
    expect(reviewer.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('network recovery') }),
    ])
    service.recordMemberSessionEvent(reviewer.id, completedTurn(11))
    vi.advanceTimersByTime(5 * 60_000)
    expect(reviewer.messages).toHaveLength(reviewerMessages + 1)

    service.recordMemberSessionEvent(lead.id, failedTurn(12))
    vi.advanceTimersByTime(29_999)
    expect(lead.messages).toHaveLength(leadMessages)
    vi.advanceTimersByTime(1)
    expect(lead.messages).toHaveLength(leadMessages + 1)
    service.recordMemberSessionEvent(lead.id, failedTurn(13))
    vi.advanceTimersByTime(59_999)
    expect(lead.messages).toHaveLength(leadMessages + 1)
    vi.advanceTimersByTime(1)
    expect(lead.messages).toHaveLength(leadMessages + 2)

    expect(service.readTrace(run.id, 0, 200).events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'member_network_recovery_scheduled',
        data: expect.stringContaining('"delayMs":30000'),
      }),
      expect.objectContaining({
        type: 'member_network_recovery_scheduled',
        data: expect.stringContaining('"delayMs":60000'),
      }),
      expect.objectContaining({
        type: 'member_network_recovery_woken',
        data: expect.stringContaining('"reason":"route_recovered"'),
      }),
      expect.objectContaining({
        type: 'member_network_recovery_woken',
        data: expect.stringContaining('"reason":"backoff_elapsed"'),
      }),
    ]))

    service.recordMemberSessionEvent(lead.id, failedTurn(14))
    const messagesBeforeFinish = lead.messages.length
    service.finish(launcher as unknown as Agent, 'cancelled', 'Network recovery behavior verified.', run.id)
    await service.wait(run.id, 1_000)
    vi.advanceTimersByTime(5 * 60_000)
    expect(lead.messages).toHaveLength(messagesBeforeFinish)
    service.end(launcher as unknown as Agent, 'Network recovery Team closed.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('persists dynamic formal members and paused state across restart, resume, and removal', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const view = {
      id: 'researcher',
      name: 'Morgan',
      color: '#4f8f77',
      role: 'researcher',
      responsibility: 'Maintain durable technical research.',
      prompt: 'Ground recommendations in repository evidence.',
      toolGroups: ['messages', 'resources'] as const,
      permissions: ['resource.write'] as const,
      contacts: { members: '*' as const, channels: '*' as const },
    }
    const added = await first.service.addMember(first.launcher as unknown as Agent, {
      runId: run.id,
      view: { ...view, toolGroups: [...view.toolGroups], permissions: [...view.permissions] },
    })
    expect(added).toMatchObject({ name: 'researcher', displayName: 'Morgan', role: 'researcher' })
    expect(first.runtime.creates.at(-1)).toMatchObject({ cwd: root })

    for (const member of first.service.status(run.id).members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })
    expect(resumed.members.map(member => member.name)).toEqual(['lead', 'reviewer', 'researcher'])
    expect(second.service.memberViews(run.id)).toContainEqual(expect.objectContaining({ id: 'researcher', name: 'Morgan' }))
    expect(await second.service.pauseMember(second.launcher as unknown as Agent, run.id, 'researcher'))
      .toMatchObject({ name: 'researcher', status: 'paused' })
    expect(second.runtime.get(added.sessionId)).toBeUndefined()
    const updated = await second.service.updateMember(second.launcher as unknown as Agent, {
      runId: run.id,
      member: 'researcher',
      view: {
        ...view,
        name: 'Morgan Reed',
        role: 'senior researcher',
        toolGroups: ['messages'],
        permissions: [],
      },
    })
    expect(updated).toMatchObject({
      name: 'researcher', displayName: 'Morgan Reed', role: 'senior researcher', status: 'paused',
    })
    expect(second.service.memberViews(run.id)).toContainEqual(expect.objectContaining({
      id: 'researcher', name: 'Morgan Reed', toolGroups: ['messages'],
    }))

    for (const member of second.service.status(run.id).members) {
      const agent = second.runtime.get(member.sessionId)
      if (agent !== undefined) second.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    second.disconnect()
    await second.core.close()

    const third = setup(root, { launcherId: 'third-launcher', persisted: second.persisted })
    const resumedPaused = await third.service.resume(third.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })
    expect(resumedPaused.members).toContainEqual(expect.objectContaining({
      name: 'researcher', displayName: 'Morgan Reed', role: 'senior researcher', status: 'paused',
    }))
    expect(third.runtime.resumes.some(input => input.id === added.sessionId)).toBe(false)

    expect(await third.service.resumeMember(third.launcher as unknown as Agent, run.id, 'researcher'))
      .toMatchObject({ name: 'researcher', status: 'idle' })
    expect(third.runtime.resumes.at(-1)).toMatchObject({
      id: added.sessionId,
      persona: expect.stringContaining('senior researcher'),
    })
    third.runtime.agents.delete(added.sessionId)
    expect(third.service.status(run.id).members).toContainEqual(expect.objectContaining({
      name: 'researcher', status: 'offline',
    }))
    expect(await third.service.resumeMember(third.launcher as unknown as Agent, run.id, 'researcher'))
      .toMatchObject({ name: 'researcher', status: 'idle' })
    expect(await third.service.removeMember(third.launcher as unknown as Agent, run.id, 'researcher'))
      .toMatchObject({ name: 'researcher', status: 'offline' })
    expect(third.service.status(run.id).members.map(member => member.name)).toEqual(['lead', 'reviewer'])
    expect(third.service.memberViews(run.id).some(member => member.id === 'researcher')).toBe(false)
    expect(third.service.readTrace(run.id, 0, 300).events.map(event => event.type)).toEqual(expect.arrayContaining([
      'member_view_added', 'member_paused', 'member_view_updated', 'member_resumed',
      'member_view_removed', 'member_detached',
    ]))

    for (const member of third.service.status(run.id).members) {
      const agent = third.runtime.get(member.sessionId)
      if (agent !== undefined) third.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    third.disconnect()
    await third.core.close()

    const fourth = setup(root, { launcherId: 'fourth-launcher', persisted: third.persisted })
    const resumedAgain = await fourth.service.resume(fourth.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })
    expect(resumedAgain.members.map(member => member.name)).toEqual(['lead', 'reviewer'])
    expect(fourth.runtime.resumes.some(input => input.id === added.sessionId)).toBe(false)
    fourth.service.end(fourth.launcher as unknown as Agent, 'Dynamic membership test complete.', run.id)
    await fourth.service.wait(run.id, 1_000)
    fourth.disconnect()
  })

  it('runs multiple Teams concurrently with isolated members, messages, and lifecycle controls', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, core, runtime, launcher, disconnect } = setup(root)
    const first = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    await expect(service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })).rejects.toThrow(/separate native Session/)
    const secondLauncher = runtime.add('second-launcher', root)
    const second = await service.create(secondLauncher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })

    expect(first.id).not.toBe(second.id)
    expect(core.list()).toHaveLength(4)
    expect(new Set(core.list().map(member => member.name)).size).toBe(4)
    expect(() => service.status(undefined, root)).toThrow(/run_id is required/)

    service.start(launcher as unknown as Agent, { runId: first.id, taskPath, projectRoot: root })
    service.start(secondLauncher as unknown as Agent, { runId: second.id, taskPath, projectRoot: root })
    const firstLead = runtime.get(first.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const firstReviewer = runtime.get(first.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    const secondReviewer = runtime.get(second.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (firstLead === undefined || firstReviewer === undefined || secondReviewer === undefined) {
      throw new Error('expected two live Fleet Teams')
    }
    service.messageHub(first.id).send(firstLead, {
      to: '@reviewer',
      text: 'Only the first Team should see this.',
      delivery: 'quiet',
    })
    expect(service.messageHub(first.id).read(firstReviewer, { conversation: '@lead' }).messages)
      .toContainEqual(expect.objectContaining({ text: 'Only the first Team should see this.' }))
    expect(service.messageHub(second.id).read(secondReviewer, { conversation: '@lead' }).messages).toEqual([])

    for (const [run, owner] of [[first, launcher], [second, secondLauncher]] as const) {
      service.finish(owner as unknown as Agent, 'cancelled', `Cancelled ${run.id}.`, run.id)
      await service.wait(run.id, 1_000)
      service.end(owner as unknown as Agent, `Closed ${run.id}.`, run.id)
      await service.wait(run.id, 1_000)
    }
    expect(core.list()).toEqual([])
    disconnect()
  })

  it('keeps sustained messaging, repeated work, and paged projections stable', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    const messages = service.messageHub(run.id)

    for (let index = 0; index < 1_000; index += 1) {
      messages.send(index % 2 === 0 ? lead : reviewer, {
        to: index % 2 === 0 ? '@reviewer' : '@lead',
        text: `Sustained collaboration message ${index}`,
        delivery: 'quiet',
      })
    }
    for (let cycle = 0; cycle < 25; cycle += 1) {
      service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
      service.finish(launcher as unknown as Agent, 'finished', `Completed work cycle ${cycle}.`, run.id)
      await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({ status: 'idle' })
    }

    const sequences: number[] = []
    let afterSequence = 0
    while (true) {
      const page = service.readTeamProjection(run.id, afterSequence, 127)
      sequences.push(...page.events.map(event => event.sequence))
      afterSequence = page.events.at(-1)?.sequence ?? afterSequence
      if (!page.hasMore) break
    }
    expect(sequences.length).toBeGreaterThan(1_000)
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right))
    expect(new Set(sequences).size).toBe(sequences.length)
    expect(messages.read(reviewer, { conversation: '@lead', limit: 50 }).messages).toHaveLength(50)

    service.end(launcher as unknown as Agent, 'Sustained collaboration test complete.', run.id)
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({ status: 'closed', settled: true })
    await Promise.resolve()
    const transient = service as unknown as {
      finalizations: Map<string, Promise<void>>
      teamProjectionEvents: Map<string, unknown>
      eventSequences: Map<string, number>
    }
    expect(transient.finalizations.size).toBe(0)
    expect(transient.teamProjectionEvents.has(run.id)).toBe(false)
    expect(transient.eventSequences.has(run.id)).toBe(false)
    service.readWebTeamProjection(run.id, 0, 10)
    expect(transient.teamProjectionEvents.has(run.id)).toBe(true)
    disconnect()
  })

  it('returns the existing Team when setup creation is retried with the same id', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const first = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
      sourceSetupId: 'setup-retry',
    })
    const createdMembers = runtime.creates.length
    const second = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
      sourceSetupId: 'setup-retry',
    })

    expect(second.id).toBe(first.id)
    expect(second.sourceSetupId).toBe('setup-retry')
    expect(runtime.creates).toHaveLength(createdMembers)

    service.end(launcher as unknown as Agent, 'Idempotent setup verified.', first.id)
    await service.wait(first.id, 1_000)
    disconnect()
  })

  it('resumes an existing dormant Team when setup creation is retried after restart', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
      sourceSetupId: 'setup-restart-retry',
    })
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, { persisted: first.persisted })
    const retried = await second.service.create(second.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
      sourceSetupId: 'setup-restart-retry',
    })

    expect(retried.id).toBe(run.id)
    expect(second.runtime.resumes).toHaveLength(run.members.length)
    expect(() => second.service.messageHub(run.id)).not.toThrow()

    second.service.end(second.launcher as unknown as Agent, 'Restarted setup retry verified.', run.id)
    await second.service.wait(run.id, 1_000)
    second.disconnect()
  })
})
