import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
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

import { FleetRunService, installRunTools } from '../src/run.js'
import type { FleetResourcePreview, FleetRunMember } from '../src/run.js'
import type { FleetTaskBoard } from '../src/productivity/task.js'
import { FleetArchiveRegistry } from '../src/archive.js'
import { FleetAuthorizationService } from '../src/authorization.js'
import { FleetCollaborationService } from '../src/collaboration.js'
import { activateResidentFleetAssistants } from '../src/resident-assistants.js'
import { normalizeFleetSetupConfiguration } from '../src/setup.js'
import type { FleetTurnReminderLists } from '../src/turn-reminders.js'

interface FakeEvent {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: unknown
}

function settleCompletedTask(
  board: FleetTaskBoard,
  actorId: string,
  taskId: string,
  attemptId: string,
  result: string,
) {
  return board.settle(actorId, taskId, {
    attemptId,
    progress: result,
    next: { kind: 'completed', reason: result, result },
  })
}

function settleDefaultCompositeWork(
  board: FleetTaskBoard,
  actorId: string,
  rootTaskId: string,
  outcome: 'complete' | 'block',
  result: string,
) {
  const delivery = board.state().tasks.find(task =>
    task.parentId === rootTaskId
      && task.domain.kind === 'goal',
  )
  if (delivery === undefined) throw new Error('expected default delivery Goal')
  board.submitGoal(actorId, delivery.id, outcome === 'complete'
    ? { kind: 'complete', reason: result, result }
    : { kind: 'block', reason: result })
  const settled = board.get(actorId, rootTaskId)
  if (settled.stableState.kind !== 'running' && settled.stableState.kind !== 'dormant') return settled
  const claimed = board.claim(actorId, rootTaskId)
  const attemptId = claimed.activeReconcile?.attemptId
  if (attemptId === undefined) throw new Error('expected root ReconcileAttempt')
  return board.settle(actorId, rootTaskId, {
    attemptId,
    progress: result,
    next: outcome === 'complete'
      ? { kind: 'completed', reason: result, result }
      : { kind: 'blocked', reason: result },
  })
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

  async assemble<T extends { readonly variables: Record<string, unknown> }>(base: T): Promise<T> {
    let next = () => Promise.resolve(base)
    for (const listener of [...(this.listeners.get('system-prompt/assemble') ?? [])].reverse()) {
      const following = next
      next = () => Promise.resolve(listener(base, {}, following) as Promise<T>)
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

  async preStep(messages: UserMessage[]): Promise<PreStepDecision> {
    let next = () => Promise.resolve({ kind: 'enter', messages } as PreStepDecision)
    for (const listener of [...(this.listeners.get('agent/pre-step') ?? [])].reverse()) {
      const following = next
      next = () => Promise.resolve(listener({}, following) as Promise<PreStepDecision>)
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
    replace: (messageId: UserMessage['id'], replacement: UserMessage): boolean => {
      const queue = [this.inbox.nextTurn, this.inbox.nextStep]
        .find(messages => messages.some(message => message.id === messageId))
      if (queue === undefined) return false
      queue[queue.findIndex(message => message.id === messageId)] = replacement
      const accepted = this.messages.findIndex(message => message.id === messageId)
      if (accepted >= 0) this.messages[accepted] = replacement
      return true
    },
    remove: (messageId: UserMessage['id']): boolean => {
      const queue = [this.inbox.nextTurn, this.inbox.nextStep]
        .find(messages => messages.some(message => message.id === messageId))
      if (queue === undefined) return false
      queue.splice(queue.findIndex(message => message.id === messageId), 1)
      return true
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

  steer(message: UserMessage): void {
    this.inbox.nextStep.push(message)
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
  readonly turnReminders?: FleetTurnReminderLists
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
    ...(options?.turnReminders === undefined ? {} : { turnReminders: options.turnReminders }),
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
  it('injects turn-start and tool-result reminders with independent slot cooldowns', async () => {
    const { root, configPath } = fixture()
    const reminder = {
      default: 'You are {name}; use {language}.',
      locales: { 'zh-CN': '你是 {name}；使用 {language}。' },
    }
    const turnReminders: FleetTurnReminderLists = {
      'turn-start': [{ id: 'shared-id', text: reminder, cooldownTurns: 5 }],
      'turn-end': [],
      'tool-result': [{ id: 'shared-id', text: reminder, cooldownTurns: 5, tools: ['bash'] }],
    }
    const { service, runtime, launcher, disconnect } = setup(root, { turnReminders })
    expect(service.setUserLocale('zh-Hans')).toBe('zh-CN')
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (lead === undefined) throw new Error('expected live Fleet lead')
    const preStep = (messages: UserMessage[]): PreStepDecision => {
      const hook = service as unknown as {
        preStepReminderDecision(agent: Agent, decision: PreStepDecision): PreStepDecision
      }
      return hook.preStepReminderDecision(lead as unknown as Agent, { kind: 'enter', messages })
    }
    lead.session.events.push({ type: 'turn/start', seq: 1, time: Date.now(), data: { turn: 1 } })
    const input = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Run the check.' }],
    })

    const atStart = preStep([input])
    if (atStart.kind === 'reject') throw new Error('unexpected rejected pre-step')
    expect(atStart.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'System reminder, no reply: 你是 Lead；使用 中文。' }),
    ])
    expect(preStep([input])).toMatchObject({ messages: [input] })

    lead.session.events.push(
      { type: 'tool/call', seq: 2, time: Date.now(), data: { turn: 1, callId: 'call-1', name: 'bash', arguments: '{}' } },
      {
        type: 'tool/result', seq: 3, time: Date.now(),
        data: {
          turn: 1,
          message: {
            source: { kind: 'tool', callId: 'call-1' },
            content: [{ type: 'text', text: 'ok' }],
          },
        },
      },
    )
    const afterTool = preStep([])
    if (afterTool.kind === 'reject') throw new Error('unexpected rejected pre-step')
    expect(afterTool.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'System reminder, no reply: 你是 Lead；使用 中文。' }),
    ])
    expect(preStep([])).toMatchObject({ messages: [] })
    disconnect()
  })

  it('injects filesystem access before installing foreground assistant resource tools', async () => {
    const { root, configPath } = fixture()
    const configuration = JSON.parse(readFileSync(configPath, 'utf8')) as {
      core: { assistant: { toolGroups?: string[] } }
    }
    configuration.core.assistant.toolGroups = ['messages', 'resources']
    writeFileSync(configPath, JSON.stringify(configuration))
    const { service, launcher, context, disconnect } = setup(root)
    const registered = new Map<string, unknown>()
    const guards: Array<(execution: { readonly name: string; readonly arguments: unknown }) => string | undefined> = []
    context.provide('tools', {
      register: (tool: { readonly name: string }) => {
        registered.set(tool.name, tool)
        return () => { registered.delete(tool.name) }
      },
      restrict: () => () => {},
      guard: (guard: (execution: { readonly name: string; readonly arguments: unknown }) => string | undefined) => {
        guards.push(guard)
        return () => { guards.splice(guards.indexOf(guard), 1) }
      },
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
    expect(registered.has('fleet_inbox')).toBe(true)
    expect(registered.has('fleet_reply')).toBe(true)
    expect(registered.has('fleet_messages')).toBe(false)
    expect(registered.has('fleet_tools')).toBe(false)

    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-route-1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Build the requested project output.' }],
      },
    } as unknown as SessionEvent)
    const guardReason = (name: string, argumentsValue: unknown = {}) => guards
      .map(guard => guard({ name, arguments: argumentsValue }))
      .find(reason => reason !== undefined)
    expect(guardReason('read', { path: 'README.md' })).toBeUndefined()
    expect(guardReason('bash', { command: 'git status --short' })).toBeUndefined()
    expect(guardReason('write', { path: 'result.txt', content: 'done' })).toContain('not routed')
    expect(guardReason('bash', { command: 'python etl.py' })).toContain('not routed')

    service.takeOverAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      reason: 'The user explicitly requested direct execution.',
    })
    expect(guardReason('write', { path: 'result.txt', content: 'done' })).toBeUndefined()

    service.recordMemberSessionEvent(launcher.id, {
      seq: 2,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-route-2', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'A separate request.' }],
      },
    } as unknown as SessionEvent)
    expect(guardReason('write', { path: 'result.txt', content: 'again' })).toContain('not routed')
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
      await options.setup?.({ agent, get: () => undefined } as unknown as Context)
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

  it('loads a persisted Team with an unfinished assistant Reply Task', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected Team assistant')
    first.service.sendUserConversationMessage({
      runId: run.id,
      to: `@${assistantId}`,
      text: 'Persist this required assistant task.',
      mentions: [`@${assistantId}`],
      delivery: 'quiet',
    })
    first.disconnect()
    await first.core.close()

    const second = setup(root, {
      launcherId: 'replacement-launcher',
      persisted: first.persisted,
      persistedHeaders: first.persistedHeaders,
    })

    expect(second.service.list().map(candidate => candidate.id)).toContain(run.id)
    expect(second.service.status(run.id).assistants[0]?.view.id).toBe(assistantId)
    second.disconnect()
    await second.core.close()
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

  it('records direct assistant input unchanged and injects its foreground protocol through the system prompt', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const scoped = new FakeAgentContext()
    launcher.ctx = scoped as unknown as Context
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected assistant')
    const incoming = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Build and review the requested change.' }],
    })

    const assembly = await scoped.assemble({
      sections: [] as Array<{ name: string; text: string }>,
      contexts: [],
      tools: [],
      variables: {},
    })
    const request = assembly.sections.find(section => section.name === 'fleet:foreground-task-request')?.text ?? ''
    expect(request).toContain('[Fleet Foreground Protocol]')
    expect(request).toContain(`Current Team: ${run.id}`)
    expect(request).toContain('do not call fleet_user_task status merely because direct input arrived')
    expect(request).toContain(`Use action="status" with run_id="${run.id}" after a Task Delivery`)
    expect(request).toContain('Do not emit the final answer before that tool call')
    expect(request).toContain('emit the answer exactly once and end the turn')
    expect(request).toContain('do not call fleet_user_task report')
    expect(request).toContain('action="update" only for an intentional mid-turn user update')
    expect(request).toContain('last non-empty native output')
    expect(request).toContain('normal project imperative remains Team work')
    expect(request).not.toContain('Build and review the requested change.')

    const decision = await scoped.preStep([incoming])
    if (decision.kind !== 'enter') throw new Error('expected step entry')
    const interaction = service.taskBoard(run.id).interactionTask(assistantId)
    expect(interaction).toMatchObject({
      stableState: { kind: 'running' },
      domain: {
        kind: 'interaction', inputRevision: 1, settledRevision: 0,
        latestMessageId: String(incoming.id),
      },
      entries: [expect.objectContaining({ text: 'Build and review the requested change.' })],
    })
    expect(decision.messages[0]).toEqual(incoming)
    const visibleText = decision.messages[0]?.content
      .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
    expect(visibleText).toBe('Build and review the requested change.')
    expect(visibleText).not.toContain('[Fleet Foreground Protocol]')

    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: incoming,
    } as unknown as SessionEvent)
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      domain: { inputRevision: 1, latestMessageId: String(incoming.id) },
      entries: [expect.objectContaining({ text: 'Build and review the requested change.' })],
    })
    service.sendUserConversationMessage({
      runId: run.id,
      to: `@${assistantId}`,
      text: 'Build and review the requested change.',
      delivery: 'quiet',
    }, launcher as unknown as Agent)
    expect(service.taskBoard(run.id).pendingReply(assistantId)).toBeUndefined()
    expect(service.taskBoard(run.id).ownerTasks(assistantId).map(task => task.domain.kind))
      .toEqual(['interaction'])
    disconnect()
  })

  it('settles only at turn end even when native output precedes the report intent', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected assistant')
    launcher.status = 'running'
    const registered: Array<{
      readonly name: string
      execute(args: unknown, context: { readonly agent: Agent }): Promise<unknown>
    }> = []
    installRunTools({
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} } },
    } as unknown as Context, service, {} as never)
    const userTask = registered.find(tool => tool.name === 'fleet_user_task')
    if (userTask === undefined) throw new Error('expected fleet_user_task')

    service.recordMemberSessionEvent(launcher.id, {
      seq: 0,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 1 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-initial', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'First request.' }],
      },
    } as unknown as SessionEvent)
    const pendingReceipt = await userTask.execute({
      action: 'report',
      run_id: run.id,
      reason: 'The first request is complete.',
      report: 'First response.',
    }, { agent: launcher as unknown as Agent })
    expect(pendingReceipt).toEqual({
      action: 'report',
      task: {
        state: 'running',
        revision: 1,
        next: 'emit_native_output_once',
      },
    })
    service.recordMemberSessionEvent(launcher.id, {
      seq: 2,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        interrupted: false,
        message: { id: 'foreground-assistant-initial', role: 'assistant', content: [{ type: 'text', text: 'First response.' }] },
      },
    } as unknown as SessionEvent)
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.stableState.kind).toBe('running')
    service.recordMemberSessionEvent(launcher.id, {
      seq: 2.5,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.stableState.kind).toBe('completed')
    const messagesBefore = launcher.messages.length

    service.recordMemberSessionEvent(launcher.id, {
      seq: 3,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 2 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 4,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-output-first', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Only reply with 好.' }],
      },
    } as unknown as SessionEvent)
    expect(launcher.messages).toHaveLength(messagesBefore)
    const updateReceipt = await userTask.execute({
      action: 'update',
      run_id: run.id,
      message: '还在处理，马上完成。',
    }, { agent: launcher as unknown as Agent })
    expect(updateReceipt).toEqual({
      action: 'update',
      task: { state: 'running', revision: 2, delivered: true },
    })
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.entries.at(-1)).toMatchObject({
      interactionDelivery: 'update',
      text: '还在处理，马上完成。',
    })

    service.recordMemberSessionEvent(launcher.id, {
      seq: 5,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        interrupted: false,
        message: { id: 'foreground-assistant-output-first', role: 'assistant', content: [{ type: 'text', text: '好' }] },
      },
    } as unknown as SessionEvent)
    const receipt = await userTask.execute({
      action: 'report',
      run_id: run.id,
      reason: 'Replied exactly as requested.',
      report: '好',
    }, { agent: launcher as unknown as Agent })
    expect(receipt).toEqual({
      action: 'report',
      task: {
        state: 'running',
        revision: 2,
        next: 'emit_native_output_once',
      },
    })
    expect(JSON.stringify(receipt).length).toBeLessThan(250)
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      stableState: { kind: 'running' },
      domain: { kind: 'interaction', inputRevision: 2, settledRevision: 1 },
    })
    await Promise.resolve()
    expect(launcher.messages).toHaveLength(messagesBefore)

    service.recordMemberSessionEvent(launcher.id, {
      seq: 6,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: 2, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      stableState: { kind: 'completed', result: '好' },
      domain: { kind: 'interaction', inputRevision: 2, settledRevision: 2 },
    })
    expect(launcher.messages).toHaveLength(messagesBefore)

    service.recordMemberSessionEvent(launcher.id, {
      seq: 7,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 3 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 8,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-cancel-fence', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Reply once more.' }],
      },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 9,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        interrupted: false,
        message: { id: 'foreground-assistant-cancel-fence', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      },
    } as unknown as SessionEvent)
    await userTask.execute({
      action: 'report',
      run_id: run.id,
      reason: 'Replied once more.',
      report: 'Done.',
    }, { agent: launcher as unknown as Agent })
    service.recordMemberSessionEvent(launcher.id, {
      seq: 10,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: 3, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 11,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 4 },
    } as unknown as SessionEvent)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(launcher.cancelCount).toBe(0)
    disconnect()
  })

  it('settles a direct Interaction from one normal native response without a report tool call', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected assistant')
    launcher.status = 'running'

    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 1 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 2,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-direct', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Only reply with 好.' }],
      },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 3,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        interrupted: false,
        message: { id: 'foreground-assistant-direct', role: 'assistant', content: [{ type: 'text', text: '好' }] },
      },
    } as unknown as SessionEvent)
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.stableState.kind).toBe('running')
    const messagesBeforeEnd = launcher.messages.length

    service.recordMemberSessionEvent(launcher.id, {
      seq: 4,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      stableState: { kind: 'completed', result: '好' },
      domain: { kind: 'interaction', inputRevision: 1, settledRevision: 1 },
    })
    expect(launcher.messages).toHaveLength(messagesBeforeEnd)
    disconnect()
  })

  it('does not settle a foreground Interaction from an internal plugin turn', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected assistant')

    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 1 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 2,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-pending', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Keep this request pending.' }],
      },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 3,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 4,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 2 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 5,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'fleet-owner-list-snapshot', role: 'user',
        source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'snapshot', sections: [] },
        content: [{ type: 'text', text: '[Fleet owner task list]' }],
      },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 6,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        interrupted: false,
        message: { id: 'internal-recovery-output', role: 'assistant', content: [{ type: 'text', text: 'Internal recovery.' }] },
      },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 7,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: 2, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)

    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      stableState: { kind: 'running' },
      domain: { kind: 'interaction', inputRevision: 1, settledRevision: 0 },
    })
    disconnect()
  })

  it('keeps assistant observe and member list receipts compact by default', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const registered: Array<{
      readonly name: string
      execute(args: unknown, context: { readonly agent: Agent }): Promise<unknown>
    }> = []
    installRunTools({
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} } },
    } as unknown as Context, service, {} as never)
    const assistantTool = registered.find(tool => tool.name === 'fleet_assistant')
    const memberTool = registered.find(tool => tool.name === 'fleet_member')
    if (assistantTool === undefined || memberTool === undefined) throw new Error('expected Fleet management tools')

    const observed = await assistantTool.execute({ action: 'observe', run_id: run.id }, {
      agent: launcher as unknown as Agent,
    }) as {
      readonly run: Readonly<Record<string, unknown>>
      readonly members: readonly Readonly<Record<string, unknown>>[]
      readonly events: readonly { readonly data: string }[]
    }
    expect(observed.run).toMatchObject({ id: run.id, name: run.name, settled: false })
    expect(observed.run).not.toHaveProperty('configPath')
    expect(observed.run).not.toHaveProperty('budget')
    expect(observed.members).toHaveLength(run.members.length + run.assistants.length)
    expect(observed.events).toHaveLength(Math.min(5, observed.events.length))
    expect(observed.events.every(event => event.data.length <= 303)).toBe(true)
    expect(JSON.stringify(observed)).not.toContain('assistantSessionAliases')
    expect(JSON.stringify(observed).length).toBeLessThan(4_000)

    const listed = await memberTool.execute({ action: 'list', run_id: run.id }, {
      agent: launcher as unknown as Agent,
    }) as {
      readonly run: Readonly<Record<string, unknown>>
      readonly members: readonly Readonly<Record<string, unknown>>[]
      readonly views?: readonly Readonly<Record<string, unknown>>[]
    }
    expect(listed.views).toBeUndefined()
    expect(listed.run).not.toHaveProperty('members')
    expect(listed.members).toHaveLength(run.members.length)
    expect(listed.members.every(member => member.prompt === undefined && member.sessionId === undefined)).toBe(true)
    expect(JSON.stringify(listed).length).toBeLessThan(3_000)

    const configured = await memberTool.execute({
      action: 'list',
      run_id: run.id,
      include_configuration: true,
    }, { agent: launcher as unknown as Agent }) as {
      readonly views?: readonly Readonly<Record<string, unknown>>[]
    }
    expect(configured.views).toHaveLength(run.members.length)
    expect(configured.views?.every(view => typeof view.prompt === 'string')).toBe(true)
    disconnect()
  })

  it('keeps one foreground Interaction alive across Team work, quiescence, and native reporting', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (assistantId === undefined || lead === undefined) throw new Error('expected assistant and lead')

    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Run the Team task and report its result.' }],
      },
    } as unknown as SessionEvent)
    const interaction = service.taskBoard(run.id).interactionTask(assistantId)
    expect(interaction).toMatchObject({
      stableState: { kind: 'running' },
      domain: { kind: 'interaction', inputRevision: 1, settledRevision: 0 },
    })

    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const rootGoalId = service.status(run.id).work?.rootTaskId
    if (rootGoalId === undefined || interaction === undefined) throw new Error('expected composite root Task and Interaction')
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      id: interaction.id,
      stableState: { kind: 'dormant' },
      domain: { kind: 'interaction', waitingTaskIds: [rootGoalId] },
    })
    expect(service.taskBoard(run.id).ownerTasks(assistantId)).toEqual([])

    settleDefaultCompositeWork(service.taskBoard(run.id), lead.id, rootGoalId, 'complete', 'Verified result.')
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({
      status: 'idle', work: { status: 'finished', summary: 'Verified result.' },
    })
    await vi.waitFor(() => {
      expect(service.taskBoard(run.id).interactionTask(assistantId)?.stableState).toMatchObject({ kind: 'running' })
      expect(launcher.messages).toContainEqual(expect.objectContaining({
        content: [expect.objectContaining({ text: expect.stringContaining('fleet_user_task action="status"') })],
      }))
    })

    service.recordMemberSessionEvent(launcher.id, {
      seq: 2,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 2 },
    } as unknown as SessionEvent)
    service.reportAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      outcome: 'complete',
      reason: 'The Team result is ready for the user.',
      report: 'Verified result.',
    })
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      stableState: { kind: 'running' },
      domain: { kind: 'interaction', reportIntent: { revision: 1, outcome: 'complete' } },
    })
    service.recordMemberSessionEvent(launcher.id, {
      seq: 3,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        interrupted: false,
        message: {
          id: 'foreground-assistant-1', role: 'assistant',
          content: [{ type: 'text', text: 'Verified result.' }],
        },
      },
    } as unknown as SessionEvent)
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.stableState.kind).toBe('running')
    service.recordMemberSessionEvent(launcher.id, {
      seq: 4,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: 2, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      id: interaction.id,
      stableState: { kind: 'completed', result: 'Verified result.' },
      domain: { kind: 'interaction', inputRevision: 1, settledRevision: 1 },
    })

    service.recordMemberSessionEvent(launcher.id, {
      seq: 3,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-2', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Check one more detail.' }],
      },
    } as unknown as SessionEvent)
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      id: interaction.id,
      stableState: { kind: 'running' },
      domain: { kind: 'interaction', inputRevision: 2, settledRevision: 1 },
    })
    disconnect()
  })

  it('reinstalls an existing live Interaction wait without creating another Goal', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected Team assistant')
    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-progress', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Keep watching the delegated check.' }],
      },
    } as unknown as SessionEvent)
    const deferred = service.continueAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      reason: 'Waiting for the delegated check.',
      goal: { title: 'Delegated check', description: 'Produce evidence.', owners: ['lead'] },
      checkAfterSeconds: 300,
    })
    const linked = deferred.goals[0]
    if (linked === undefined) throw new Error('expected linked Goal')
    service.taskBoard(run.id).signalInteractionDelivery(assistantId, 'Progress check became due.')

    const registered: Array<{
      readonly name: string
      execute(args: unknown, context: { readonly agent: Agent }): Promise<unknown>
    }> = []
    installRunTools({
      tools: { register: (tool: typeof registered[number]) => { registered.push(tool); return () => {} } },
    } as unknown as Context, service, {} as never)
    const userTask = registered.find(tool => tool.name === 'fleet_user_task')
    if (userTask === undefined) throw new Error('expected fleet_user_task')
    const result = await userTask.execute({
      action: 'continue',
      run_id: run.id,
      reason: 'The already-linked Team work is still running.',
      check_after_seconds: 300,
    }, { agent: launcher as unknown as Agent })

    expect(result).toMatchObject({ action: 'continue', goals: [] })
    expect(result).not.toHaveProperty('task.entries')
    expect(result).not.toHaveProperty('task.signals')
    expect(JSON.stringify(result).length).toBeLessThan(5_000)
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      stableState: { kind: 'dormant' },
      domain: { waitingTaskIds: [linked.id] },
    })
    expect(service.taskBoard(run.id).state().tasks
      .filter(task => task.parentId === deferred.task.id && task.domain.kind === 'goal'))
      .toHaveLength(1)
    disconnect()
  })

  it('does not publish native waiting output unless the assistant explicitly sends an update', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected Team assistant')

    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 1 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 2,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-waiting', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Delegate this check and wait for it.' }],
      },
    } as unknown as SessionEvent)
    service.continueAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      reason: 'Waiting for delegated evidence.',
      goal: { title: 'Delegated evidence', description: 'Produce evidence.', owners: ['lead'] },
      checkAfterSeconds: 300,
    })
    service.recordMemberSessionEvent(launcher.id, {
      seq: 3,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        interrupted: false,
        message: {
          id: 'foreground-assistant-waiting', role: 'assistant',
          content: [{ type: 'text', text: 'The delegated check is still running.' }],
        },
      },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      seq: 4,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)

    const interaction = service.taskBoard(run.id).interactionTask(assistantId)
    expect(interaction).toMatchObject({
      stableState: { kind: 'dormant' },
      domain: { kind: 'interaction', inputRevision: 1, settledRevision: 0 },
    })
    expect(interaction?.entries).not.toContainEqual(expect.objectContaining({
      interactionDelivery: 'update',
      text: 'The delegated check is still running.',
    }))
    disconnect()
  })

  it('accepts a foreground report when linked Tasks are terminal before work status catches up', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (assistantId === undefined || lead === undefined) throw new Error('expected assistant and lead')
    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-report-lag', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Run the Team task and report it.' }],
      },
    } as unknown as SessionEvent)
    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const rootTaskId = service.status(run.id).work?.rootTaskId
    if (rootTaskId === undefined) throw new Error('expected work root')
    lead.status = 'running'
    settleDefaultCompositeWork(service.taskBoard(run.id), lead.id, rootTaskId, 'complete', 'Verified result.')
    await vi.waitFor(() => {
      expect(service.taskBoard(run.id).interactionTask(assistantId)?.stableState.kind).toBe('running')
    })
    expect(service.status(run.id)).toMatchObject({ status: 'running', work: { status: 'running' } })

    expect(() => service.reportAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      outcome: 'complete',
      reason: 'The authoritative linked Task is terminal.',
      report: 'Verified result.',
    })).not.toThrow()
    expect(service.taskBoard(run.id).commitInteractionOutput(assistantId, 'Verified result.'))
      .toMatchObject({ stableState: { kind: 'completed' } })

    lead.completeTurn()
    service.agentStatusChanged(lead as unknown as Agent)
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({
      status: 'idle', work: { status: 'finished', summary: 'Verified result.' },
    })
    disconnect()
  })

  it('delivers linked Task completion to the assistant without waiting for unrelated Team work', async () => {
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
    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-delivery', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Complete the linked check and report it.' }],
      },
    } as unknown as SessionEvent)
    const deferred = service.continueAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      reason: 'Waiting for the linked check.',
      goal: { title: 'Linked check', description: 'Produce evidence.', owners: ['lead'] },
      checkAfterSeconds: 300,
    })
    const linked = deferred.goals[0]
    if (linked === undefined) throw new Error('expected linked Goal')
    service.taskBoard(run.id).createGoal(lead.id, {
      title: 'Unrelated long work', description: 'Remain live.', owners: ['reviewer'],
    })

    service.taskBoard(run.id).submitGoal(lead.id, linked.id, {
      kind: 'complete', reason: 'Linked check complete.', result: 'Verified linked evidence.',
    })
    await vi.waitFor(() => {
      expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
        stableState: { kind: 'running' },
        domain: {
          pendingDelivery: expect.objectContaining({
            cause: 'linked_tasks_settled',
            tasks: [expect.objectContaining({ id: linked.id, result: 'Verified linked evidence.' })],
          }),
        },
      })
    })
    expect(service.taskBoard(run.id).ownerTasks('reviewer')
      .some(task => task.title === 'Unrelated long work')).toBe(true)
    expect(launcher.messages.flatMap(message => message.content)
      .some(block => block.type === 'text' && block.text.includes('Persistent completion Delivery'))).toBe(true)
    disconnect()
  })

  it('wakes a dormant assistant after every formal member stays idle through the quiescence grace period', async () => {
    vi.useFakeTimers()
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
    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-quiescence', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Delegate this work and recover if the Team stalls.' }],
      },
    } as unknown as SessionEvent)
    const deferred = service.continueAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      reason: 'Waiting for delegated work.',
      goal: { title: 'Potentially stalled work', description: 'Produce evidence.', owners: ['lead'] },
      checkAfterSeconds: 300,
    })
    expect(deferred.task.stableState.kind).toBe('dormant')

    await vi.advanceTimersByTimeAsync(2_999)
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.stableState.kind).toBe('dormant')

    lead.status = 'running'
    service.agentStatusChanged(lead as unknown as Agent)
    await vi.advanceTimersByTimeAsync(1)
    lead.completeTurn()
    service.agentStatusChanged(lead as unknown as Agent)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.stableState.kind).toBe('dormant')

    await vi.advanceTimersByTimeAsync(1)
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      stableState: { kind: 'running' },
      domain: { pendingDelivery: { cause: 'team_quiescent' } },
    })
    const deliveryCount = launcher.messages.filter(message => message.content.some(block =>
      block.type === 'text' && block.text.includes('Persistent completion Delivery'))).length
    const firstSignalCount = service.taskBoard(run.id).interactionTask(assistantId)?.signals.length ?? 0
    service.continueAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      reason: 'The assistant chose to keep waiting without any new Team activity.',
      checkAfterSeconds: 300,
    })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.stableState.kind).toBe('dormant')
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.signals).toHaveLength(firstSignalCount)
    expect(launcher.messages.filter(message => message.content.some(block =>
      block.type === 'text' && block.text.includes('Persistent completion Delivery')))).toHaveLength(deliveryCount)

    lead.status = 'running'
    service.agentStatusChanged(lead as unknown as Agent)
    lead.completeTurn()
    service.agentStatusChanged(lead as unknown as Agent)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      stableState: { kind: 'running' },
      domain: { pendingDelivery: { cause: 'team_quiescent' } },
    })
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.signals).toHaveLength(firstSignalCount + 1)
    expect(launcher.messages.filter(message => message.content.some(block =>
      block.type === 'text' && block.text.includes('Persistent completion Delivery')))).toHaveLength(deliveryCount)
    service.agentStatusChanged(lead as unknown as Agent)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(service.taskBoard(run.id).interactionTask(assistantId)?.signals).toHaveLength(firstSignalCount + 1)
    expect(launcher.messages.filter(message => message.content.some(block =>
      block.type === 'text' && block.text.includes('Persistent completion Delivery')))).toHaveLength(deliveryCount)
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
    const leadPersona = runtime.creates.find(input => input.label === leadMember.displayName)?.persona
    expect(leadPersona).toContain(`You are @${leadMember.displayName}`)
    expect(leadPersona).toContain('Configured groups cover Fleet capabilities only')
    expect(leadPersona).toContain('Every granted Fleet capability with at least one authorized action stays directly available')
    expect(leadPersona).toContain('A valid `@Name` or `@member-id` in the message text explicitly means "this member must answer"')
    expect(leadPersona).toContain('Only a domain handler, deterministic timeout fallback, or the fenced `fleet_reconcile resolve` path writes a stable state')

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
        visibilityReminderContextGrowthTokens: 24_000,
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
      visibilityReminderContextGrowthTokens: 24_000,
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
          visibilityReminderContextGrowthTokens: 24_000,
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

    const memberUnlimited = service.configureBudget(launcher as unknown as Agent, {
      runId: run.id, scope: 'member', member: assistant.view.id, limit: null,
    })
    const unlimitedAccount = memberUnlimited.members.find(member => member.memberId === assistant.view.id)
    expect(unlimitedAccount).toMatchObject({ used: 0, state: 'unlimited' })
    expect(unlimitedAccount).not.toHaveProperty('limit')
    service.configureBudget(launcher as unknown as Agent, {
      runId: run.id, scope: 'member', member: assistant.view.id, limit: 60,
    })

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
    await expect(scoped.assemble({
      sections: [], contexts: [], tools: [],
      variables: { provider: 'provider-old', model: 'model-old' },
    }))
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
    await scoped.assemble({
      sections: [], contexts: [], tools: [],
      variables: { provider: 'provider-old', model: 'model-old' },
    })
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
  }, 15_000)

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
    const onMemberEvent = vi.fn(() => () => true)
    context.on('fleet/member/setup', memberSetup)
    const setupAgent = runtime.get(run.members[0]?.sessionId ?? '')
    if (setupAgent === undefined) throw new Error('expected setup Agent')
    await runtime.creates[0]?.setup?.({
      agent: setupAgent as unknown as Agent,
      on: onMemberEvent,
      inject: (_deps: readonly string[], callback: (scope: Context) => void) => {
        callback({ tools: { register, restrict, guard, get } } as unknown as Context)
        return Promise.resolve()
      },
    } as unknown as Context)
    expect(onMemberEvent).toHaveBeenCalledWith('agent/turn-stopping', expect.any(Function))
    expect(restrict).toHaveBeenCalledWith({
      deny: expect.arrayContaining([
        'fleet_agent', 'fleet_archive', 'fleet_setup', 'fleet_trace', 'fleet_activity',
      ]),
    })
    expect(restrict).not.toHaveBeenCalledWith({
      deny: expect.arrayContaining([
        'fleet_followup', 'fleet_messages', 'fleet_wait', 'fleet_member_status',
        'fleet_meeting', 'fleet_work', 'fleet_schedule', 'fleet_calendar',
        'fleet_document', 'fleet_tools',
      ]),
    })
    expect(restrict).toHaveBeenCalledWith({
      deny: ['joyride_catalog', 'joyride_act', 'joyride_control', 'live_stream', 'live_stage'],
    })
    const specialToolGuard = guard.mock.calls[0]?.[0] as ((execution: { readonly name: string }) => string | undefined)
    expect(specialToolGuard({ name: 'joyride_act' })).toContain('not permitted')
    expect(specialToolGuard({ name: 'fleet_send' })).toBeUndefined()
    const residentTools = register.mock.calls.map(call => (call[0] as { name: string }).name)
    expect(residentTools).toEqual(expect.arrayContaining([
      'fleet_inbox', 'fleet_reply', 'fleet_send', 'fleet_channel',
      'fleet_task', 'fleet_goal', 'fleet_vote', 'fleet_reconcile',
    ]))
    expect(residentTools).not.toEqual(expect.arrayContaining([
      'fleet_messages', 'fleet_followup', 'fleet_wait', 'fleet_meeting',
      'fleet_schedule', 'fleet_calendar', 'fleet_tools',
    ]))
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
    expect(actionEnum('fleet_task')).toEqual(['list', 'owner_list', 'get'])
    expect(actionEnum('fleet_meeting')).toBeUndefined()
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

  it('gives multiple user-facing assistants Task-based messaging and observation capabilities', async () => {
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
      messageId: expect.any(String),
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
    expect(sent).toMatchObject({ recipients: 0, delivered: 0, woken: 0 })
    expect(service.messageHub(run.id).read(lead, { conversation: '#main' }).messages)
      .toContainEqual(expect.objectContaining({
        id: sent.messageId,
        from: 'team-assistant',
        text: 'The foreground assistant is checking in directly.',
      }))
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected foreground assistant')
    const assistantMessagesBeforeChannelPost = launcher.messages.length
    const userChannelMessage = service.sendUserConversationMessage({
      runId: run.id,
      to: '#main',
      text: 'A user-authored update from the Team panel.',
      delivery: 'quiet',
    })
    expect(userChannelMessage).toMatchObject({ recipients: 3, woken: 0 })
    expect(launcher.messages.slice(assistantMessagesBeforeChannelPost)).toEqual([])
    expect(service.messageHub(run.id).unreadSummary(assistantId)).toMatchObject({ unreadMessages: 1 })
    expect(service.messageHub(run.id).taskUnreadSummary(assistantId)).toMatchObject({ unreadMessages: 0 })
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
      }))
    expect(service.taskBoard(run.id).state().tasks.some(task =>
      task.domain.kind === 'reply' && task.domain.messageId === userDirectMessage.messageId,
    )).toBe(false)
    const userMentionedDirectMessage = service.sendUserConversationMessage({
      runId: run.id,
      to: `@${reviewer.id}`,
      text: '@reviewer Please confirm the latest result.',
      delivery: 'quiet',
    })
    expect(service.taskBoard(run.id).state().tasks.some(task =>
      task.domain.kind === 'reply' && task.domain.messageId === userMentionedDirectMessage.messageId,
    )).toBe(true)
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
      projectRoot: root,
    })
    expect(directive.recipients).toEqual(['lead', 'reviewer'])
    const directiveMessage = service.messageHub(run.id).read(lead, { conversation: '#main' }).messages.at(-1)
    expect(directiveMessage).toMatchObject({ mentions: ['lead', 'reviewer'] })
    expect(service.taskBoard(run.id).state().tasks.filter(task =>
      task.domain.kind === 'reply'
      && task.domain.messageId === directiveMessage?.id,
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: expect.objectContaining({ assignee: 'lead' }) }),
      expect.objectContaining({ domain: expect.objectContaining({ assignee: 'reviewer' }) }),
    ]))
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

    const rootGoalId = service.status(run.id).work?.rootTaskId
    if (rootGoalId === undefined) throw new Error('expected composite root Task')
    settleDefaultCompositeWork(
      service.taskBoard(run.id), lead.id, rootGoalId, 'complete', 'Assistant bridge test complete.',
    )
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({
      status: 'idle',
      work: { status: 'finished', summary: 'Assistant bridge test complete.' },
    })
    expect(service.taskBoard(run.id).interactionTasks()).toEqual([])
    for (const assistant of [launcher, replacementAssistant, residentReplacement, vtuberAssistant]) {
      expect(assistant.messages).not.toContainEqual(expect.objectContaining({
        content: [expect.objectContaining({ type: 'text', text: expect.stringContaining('[Fleet work result') })],
      }))
    }
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
    const rootGoalId = work.work?.rootTaskId
    if (rootGoalId === undefined) throw new Error('expected composite root Task')
    settleDefaultCompositeWork(service.taskBoard(run.id), lead.id, rootGoalId, 'complete', 'result.txt accepted.')

    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({
      status: 'idle',
      settled: false,
      work: { status: 'finished', summary: 'result.txt accepted.' },
    })
    expect(persisted.size).toBe(0)
    expect(core.list()).toHaveLength(2)
    expect(resources.list()).toEqual([])
    const secondWork = service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    expect(secondWork.work?.id).not.toBe(work.work?.id)
    const memberTrace = await service.readMemberTrace(run.id, 'lead', -1, 100)
    expect(memberTrace.events).toContainEqual(expect.objectContaining({ type: 'session.user/message' }))
    const secondRootGoalId = secondWork.work?.rootTaskId
    if (secondRootGoalId === undefined) throw new Error('expected second composite root Task')
    settleDefaultCompositeWork(
      service.taskBoard(run.id), lead.id, secondRootGoalId, 'block', 'Second work cancelled for this test.',
    )
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({ status: 'idle', work: { status: 'blocked' } })
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
    const rootTaskId = running.work?.rootTaskId
    expect(service.taskBoard(run.id).state().tasks.find(task => task.parentId === rootTaskId)?.description)
      .toContain('Hook-added acceptance criteria.')

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

    const changed = service.waitMemberProgress(lead as unknown as Agent, run.id, 'Reviewer', {
      afterSequence: 6,
      waitMs: 1_000,
    })
    const later = {
      seq: 7,
      time: 7_000,
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'The follow-up check is complete.' }] } },
    } as unknown as SessionEvent
    reviewer.session.events.push(later)
    service.recordMemberSessionEvent(reviewer.id, later)
    await expect(changed).resolves.toMatchObject({
      cursor: 7,
      items: [{ sequence: 7, kind: 'output', text: 'The follow-up check is complete.' }],
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
      data: { turn: 1, step: 1, callId: 'wait-1', name: 'wait_threads', arguments: '{"timeoutMs":30000}' },
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

  it('privately reminds a silent formal member without creating Team messages or a reminder loop', async () => {
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
    const coordinationMessages = (): number => service.readTrace(run.id, 0, 300).events
      .filter(event => event.type === 'coordination.message').length
    const turnStopping = (turn: number): void => {
      const hook = service as unknown as {
        memberTurnStopping(agent: Agent, turn: number): void
      }
      hook.memberTurnStopping(lead as unknown as Agent, turn)
    }
    const emitSilentTurn = (turn: number, contextTokens: number, output: string): void => {
      lead.inbox.nextTurn.length = 0
      lead.inbox.nextStep.length = 0
      lead.session.events.push({
        type: 'turn/start', seq: turn * 10, time: Date.now(), data: { turn },
      })
      const outputEvent = {
        type: 'assistant/message', seq: turn * 10 + 1, time: Date.now(),
        data: {
          turn,
          interrupted: false,
          message: { content: [{ type: 'text', text: output }] },
          usage: { inputTokens: contextTokens, outputTokens: 32 },
        },
      } as unknown as SessionEvent
      lead.session.events.push(outputEvent)
      service.recordMemberSessionEvent(lead.id, outputEvent)
      turnStopping(turn)
      lead.session.events.push({
        type: 'turn/end', seq: turn * 10 + 2, time: Date.now(),
        data: { turn, reason: { kind: 'completed' } },
      })
    }
    const initialLeadMessages = lead.messages.length
    const initialReviewerMessages = reviewer.messages.length
    const initialCoordinationMessages = coordinationMessages()

    emitSilentTurn(1, 8_000, 'I finished the requested analysis.')
    turnStopping(1)

    expect(lead.messages).toHaveLength(initialLeadMessages)
    emitSilentTurn(2, 24_000, 'A larger unshared result.')

    expect(lead.messages).toHaveLength(initialLeadMessages + 1)
    expect(reviewer.messages).toHaveLength(initialReviewerMessages)
    expect(lead.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('System reminder, no reply:'),
      }),
    ])
    expect(coordinationMessages()).toBe(initialCoordinationMessages)
    expect(service.readTrace(run.id, 0, 300).events).toContainEqual(expect.objectContaining({
      type: 'coordination.system_notification',
      data: expect.stringContaining('visibility_reminder'),
    }))

    expect(lead.inbox.nextTurn).toHaveLength(0)
    expect(lead.inbox.nextStep).toHaveLength(1)

    // The second retained reminder needs twice the first context growth.
    emitSilentTurn(3, 40_000, 'Understood.')
    expect(lead.messages).toHaveLength(initialLeadMessages + 1)
    emitSilentTurn(4, 56_000, 'Another unshared result.')
    expect(lead.messages).toHaveLength(initialLeadMessages + 2)
    expect(lead.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('System reminder, no reply:'),
      }),
    ])

    lead.inbox.nextTurn.length = 0
    lead.inbox.nextStep.length = 0
    lead.session.events.push({
      type: 'turn/start', seq: 50, time: Date.now(), data: { turn: 5 },
    })
    service.messageHub(run.id).send(lead, {
      to: '#main', text: 'Shared result.', delivery: 'quiet',
    })
    const sharedOutput = {
      type: 'assistant/message', seq: 51, time: Date.now(),
      data: {
        turn: 5,
        interrupted: false,
        message: { content: [{ type: 'text', text: 'Shared result.' }] },
        usage: { inputTokens: 64_000, outputTokens: 32 },
      },
    } as unknown as SessionEvent
    lead.session.events.push(sharedOutput)
    service.recordMemberSessionEvent(lead.id, sharedOutput)
    turnStopping(5)
    lead.session.events.push({
      type: 'turn/end', seq: 52, time: Date.now(), data: { turn: 5, reason: { kind: 'completed' } },
    })
    expect(lead.messages).toHaveLength(initialLeadMessages + 2)

    // A successful Team-visible send establishes a fresh context-growth baseline.
    emitSilentTurn(6, 96_000, 'A later result was not shared.')
    expect(lead.messages).toHaveLength(initialLeadMessages + 2)

    service.recordMemberSessionEvent(lead.id, {
      type: 'compaction/summary',
      seq: 65,
      time: Date.now(),
      data: {
        compactionId: 'compact-1',
        summary: [{ type: 'text', text: 'summary' }],
        shadowedRange: { start: 1, end: 60 },
        shadowedSeqs: [1, 60],
        shadowedTokenCount: 44_000,
        provider: 'test',
        model: 'test',
      },
    } as unknown as SessionEvent)
    emitSilentTurn(7, 2_000, 'First result after compaction.')
    expect(lead.messages).toHaveLength(initialLeadMessages + 2)

    emitSilentTurn(8, 18_000, 'Later result after compaction.')
    expect(lead.messages).toHaveLength(initialLeadMessages + 3)
    expect(lead.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('System reminder, no reply:'),
      }),
    ])
    emitSilentTurn(9, 34_000, 'Below the doubled interval.')
    expect(lead.messages).toHaveLength(initialLeadMessages + 3)
    emitSilentTurn(10, 50_000, 'The doubled post-compaction interval elapsed.')
    expect(lead.messages).toHaveLength(initialLeadMessages + 4)
    disconnect()
  })

  it('reminds a Team assistant which turn output reaches the user and which remains background-only', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const turnStopping = (turn: number): void => {
      const hook = service as unknown as {
        memberTurnStopping(agent: Agent, turn: number): void
      }
      hook.memberTurnStopping(launcher as unknown as Agent, turn)
    }
    const emitOutput = (turn: number, contextTokens: number, text: string): void => {
      const event = {
        type: 'assistant/message',
        seq: turn * 10 + 2,
        time: Date.now(),
        data: {
          turn,
          interrupted: false,
          message: { content: [{ type: 'text', text }] },
          usage: { inputTokens: contextTokens, outputTokens: 16 },
        },
      } as unknown as SessionEvent
      launcher.session.events.push(event)
      service.recordMemberSessionEvent(launcher.id, event)
    }
    const initialMessages = launcher.messages.length

    service.recordMemberSessionEvent(launcher.id, {
      type: 'turn/start', seq: 10, time: Date.now(), data: { turn: 1 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      type: 'user/message',
      seq: 11,
      time: Date.now(),
      data: {
        id: 'assistant-reminder-user',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'Give me a status.' }],
      },
    } as unknown as SessionEvent)
    emitOutput(1, 16_000, 'The status is ready.')
    turnStopping(1)
    expect(launcher.messages).toHaveLength(initialMessages)
    service.recordMemberSessionEvent(launcher.id, {
      type: 'turn/end', seq: 13, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)

    service.recordMemberSessionEvent(launcher.id, {
      type: 'turn/start', seq: 20, time: Date.now(), data: { turn: 2 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(launcher.id, {
      type: 'user/message', seq: 21, time: Date.now(), data: {
        id: 'assistant-reminder-user-2', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Give me another status.' }],
      },
    } as unknown as SessionEvent)
    emitOutput(2, 32_000, 'The next status is ready.')
    turnStopping(2)
    expect(launcher.messages).toHaveLength(initialMessages + 1)
    expect(launcher.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('The last native output will reach the user, not the Team'),
      }),
    ])
    service.recordMemberSessionEvent(launcher.id, {
      type: 'turn/end', seq: 23, time: Date.now(), data: { turn: 2, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)

    service.recordMemberSessionEvent(launcher.id, {
      type: 'turn/start', seq: 30, time: Date.now(), data: { turn: 3 },
    } as unknown as SessionEvent)
    emitOutput(3, 64_000, 'Background bookkeeping.')
    turnStopping(3)
    expect(launcher.messages.length).toBeGreaterThanOrEqual(initialMessages + 1)
    expect(launcher.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Background native output reaches neither user nor Team'),
      }),
    ])
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
    const newestFiftyChars = Array.from({ length: 50 }, (_, offset) =>
      `Long-running message ${String(470 + offset)}`.length).reduce((total, length) => total + length, 0)
    service.messageHub(run.id).read(reviewer, { conversation: '#main', maxChars: newestFiftyChars })
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
    // One formal-member notice per retained message plus the 50 newest-message
    // read receipts remain inside the bounded projection. The assistant keeps
    // Channel history without receiving notice deliveries.
    expect(projectedEvents.filter(event => event.type === 'coordination.inbox')).toHaveLength(150)
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

  it('bounds Task activity and raw trace payloads exposed to models', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (lead === undefined) throw new Error('expected Fleet lead')
    const goal = service.taskBoard(run.id).createGoal(launcher.id, {
      title: 'Bounded activity task',
      description: 'd'.repeat(20_000),
      owners: ['lead'],
    })

    const activity = service.activityInbox(lead as unknown as Agent, { runId: run.id })
      .items.find(item => item.kind === 'task' && JSON.stringify(item.data).includes(goal.id))
    expect(activity).toBeDefined()
    expect(activity?.data).toMatchObject({
      task: { id: goal.id, kind: 'goal', state: 'running' },
    })
    expect(activity?.data).not.toHaveProperty('task.entries')
    expect(activity?.data).not.toHaveProperty('task.description')
    expect(JSON.stringify(activity?.data).length).toBeLessThan(2_000)

    const internal = service as unknown as {
      appendEvent(runId: string, type: string, data: unknown): void
    }
    internal.appendEvent(run.id, 'test.large', { text: 't'.repeat(20_000) })
    const trace = service.readTrace(run.id, 0, 1_000).events.find(event => event.type === 'test.large')
    expect(trace?.data.length).toBeLessThan(2_100)
    expect(trace?.data).toContain('chars omitted')

    disconnect()
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

  it('preloads every unpaused formal member after the resident assistant starts without waking idle members', async () => {
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

    const second = setup(root, { launcherId: 'resident-assistant', persisted: first.persisted })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected persisted assistant')
    await second.service.attachAssistant(second.launcher as unknown as Agent, {
      runId: run.id,
      assistantId,
    })

    const loaded = await second.service.loadTeamMembersAtStartup(second.launcher as unknown as Agent, run.id)
    expect(second.runtime.resumes.map(input => input.id)).toEqual(
      expect.arrayContaining(run.members.map(member => member.sessionId)),
    )
    expect(second.runtime.resumes).toHaveLength(run.members.length)
    expect(loaded).toMatchObject({
      runtimeState: 'active',
      members: run.members.map(member => expect.objectContaining({ name: member.name, status: 'idle' })),
    })
    for (const member of loaded.members) {
      const messages = second.runtime.get(member.sessionId)?.messages ?? []
      expect(messages.flatMap(message => message.content)
        .some(block => block.type === 'text' && block.text.includes('Team was explicitly woken'))).toBe(false)
    }
    expect(second.service.readTrace(run.id, 0, 300).events).toContainEqual(expect.objectContaining({
      type: 'team_loaded_at_startup',
      data: expect.stringContaining('"members":["lead","reviewer"]'),
    }))

    await second.service.loadTeamMembersAtStartup(second.launcher as unknown as Agent, run.id)
    expect(second.runtime.resumes).toHaveLength(run.members.length)

    second.disconnect()
    await second.core.close()
  })

  it('does not preload formal members while the Team is paused', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const paused = await first.service.pauseTeam(first.launcher as unknown as Agent, run.id)
    expect(paused.status).toBe('paused')
    for (const member of paused.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, { launcherId: 'resident-assistant', persisted: first.persisted })
    const loaded = await second.service.loadTeamMembersAtStartup(second.launcher as unknown as Agent, run.id)
    expect(loaded.status).toBe('paused')
    expect(second.runtime.resumes).toEqual([])
    expect(second.service.readTrace(run.id, 0, 300).events)
      .not.toContainEqual(expect.objectContaining({ type: 'team_loaded_at_startup' }))

    second.disconnect()
    await second.core.close()
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

  it('loads only an offline formal owner when its persistent Task list becomes non-empty', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const goal = first.service.taskBoard(run.id).createGoal(first.launcher.id, {
      title: 'Targeted dormant owner check',
      owners: ['lead'],
    })
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, {
      launcherId: 'replacement-launcher',
      persisted: first.persisted,
      persistedHeaders: first.persistedHeaders,
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected persisted assistant')
    await second.service.attachAssistant(second.launcher as unknown as Agent, {
      runId: run.id,
      assistantId,
    })
    second.service.agentSessionStarted(second.launcher as unknown as Agent)

    await vi.waitFor(() => { expect(second.runtime.resumes).toHaveLength(1) })
    expect(second.runtime.resumes[0]?.id).toBe(run.members.find(member => member.name === 'lead')?.sessionId)
    const loaded = second.service.status(run.id)
    expect(loaded).toMatchObject({
      runtimeState: 'active',
      members: [
        expect.objectContaining({ name: 'lead', status: 'idle' }),
        expect.objectContaining({ name: 'reviewer', status: 'unknown' }),
      ],
    })
    expect(second.runtime.get(loaded.members.find(member => member.name === 'lead')?.sessionId ?? '')?.messages)
      .toContainEqual(expect.objectContaining({
        content: [expect.objectContaining({ text: expect.stringContaining(goal.id) })],
      }))
    expect(second.runtime.get(loaded.members.find(member => member.name === 'reviewer')?.sessionId ?? '')).toBeUndefined()

    second.disconnect()
    await second.core.close()
  })

  it('stages work for unloaded members and wakes only the first ready Task owner', async () => {
    const { root, configPath, taskPath } = fixture()
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

    const second = setup(root, {
      launcherId: 'replacement-launcher',
      persisted: first.persisted,
      persistedHeaders: first.persistedHeaders,
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected persisted assistant')
    await second.service.attachAssistant(second.launcher as unknown as Agent, {
      runId: run.id,
      assistantId,
    })
    second.service.agentSessionStarted(second.launcher as unknown as Agent)
    expect(second.service.status(run.id)).toMatchObject({
      runtimeState: 'dormant',
      members: [
        expect.objectContaining({ name: 'lead', status: 'unknown' }),
        expect.objectContaining({ name: 'reviewer', status: 'unknown' }),
      ],
    })

    const kickoff = second.service.sendAssistantMessage(second.launcher as unknown as Agent, {
      runId: run.id,
      kind: 'directive',
      text: 'Lead implements the requested work; reviewer stays dormant until a later dependent stage.',
      stages: [{
        key: 'implementation',
        title: 'Implement the requested work',
        description: 'Produce the requested deliverable and evidence.',
        owners: ['lead'],
      }],
    })
    expect(kickoff.recipients).toEqual(['lead'])
    expect(second.service.taskBoard(run.id).state().tasks.some(task =>
      task.domain.kind === 'reply' && task.domain.messageId === kickoff.messageId,
    )).toBe(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(second.runtime.resumes).toEqual([])

    const running = second.service.start(second.launcher as unknown as Agent, {
      runId: run.id,
      taskPath,
      projectRoot: root,
    })
    const rootTaskId = running.work?.rootTaskId
    if (rootTaskId === undefined) throw new Error('expected composite root Task')
    await vi.waitFor(() => { expect(second.runtime.resumes).toHaveLength(1) })
    expect(second.runtime.resumes[0]?.id).toBe(run.members.find(member => member.name === 'lead')?.sessionId)
    expect(second.runtime.get(
      second.service.status(run.id).members.find(member => member.name === 'reviewer')?.sessionId ?? '',
    )).toBeUndefined()
    expect(second.service.taskBoard(run.id).ownerTasks('lead')).toContainEqual(expect.objectContaining({
      parentId: rootTaskId,
      title: 'Implement the requested work',
    }))
    const lead = second.runtime.get(
      second.service.status(run.id).members.find(member => member.name === 'lead')?.sessionId ?? '',
    )
    if (lead === undefined) throw new Error('expected resumed lead')
    const published = second.service.messageHub(run.id)
      .read(lead, { conversation: '#main' })
      .messages.find(message => message.text === kickoff.text)
    expect(published).toMatchObject({ kind: 'work_directive', delivery: 'quiet', mentions: ['lead'] })
    expect(second.service.taskBoard(run.id).state().tasks.some(task =>
      task.domain.kind === 'reply' && task.domain.messageId === published?.id,
    )).toBe(false)

    settleDefaultCompositeWork(second.service.taskBoard(run.id), lead.id, rootTaskId, 'complete', 'Accepted result.')
    await expect(second.service.wait(run.id, 1_000)).resolves.toMatchObject({ status: 'idle' })
    second.service.end(second.launcher as unknown as Agent, 'Staged dormant-owner test complete.', run.id)
    await second.service.wait(run.id, 1_000)
    second.disconnect()
    await second.core.close()
  })

  it('loads only the owner of a user message Inbox Task', async () => {
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

    const second = setup(root, {
      launcherId: 'replacement-launcher',
      persisted: first.persisted,
      persistedHeaders: first.persistedHeaders,
    })
    expect(second.service.status(run.id).runtimeState).toBe('dormant')

    const sent = second.service.sendUserConversationMessage({
      runId: run.id,
      to: '@lead',
      text: 'Please inspect this user request.',
      delivery: 'quiet',
    }, second.launcher as unknown as Agent)
    expect(sent).toMatchObject({ recipients: 1, woken: 0 })

    await vi.waitFor(() => { expect(second.runtime.resumes).toHaveLength(1) })
    const loaded = second.service.status(run.id)
    expect(loaded).toMatchObject({
      runtimeState: 'active',
      members: [
        expect.objectContaining({ name: 'lead', status: 'idle' }),
        expect.objectContaining({ name: 'reviewer', status: 'unknown' }),
      ],
    })
    expect(second.runtime.resumes.map(input => input.id)).toEqual([
      run.members.find(member => member.name === 'lead')?.sessionId,
    ])
    const lead = second.runtime.get(loaded.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = second.runtime.get(loaded.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    await vi.waitFor(() => {
      expect(lead?.messages.flatMap(message => message.content)
        .some(block => block.type === 'text' && block.text.includes('Please inspect this user request.'))).toBe(true)
    })
    expect(reviewer).toBeUndefined()
    expect(lead?.status).toBe('idle')
    expect(second.service.readTrace(run.id, 0, 300).events)
      .not.toContainEqual(expect.objectContaining({ type: 'team_restored_for_user_input' }))

    second.disconnect()
    await second.core.close()
  })

  it('does not reload a dormant Team when attaching an assistant replays settled user input', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected Team assistant')
    const userEvent = {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'already-settled-user-input', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'This request will be settled before restart.' }],
      },
    } as unknown as SessionEvent
    first.service.recordMemberSessionEvent(first.launcher.id, {
      seq: 0,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 1 },
    } as unknown as SessionEvent)
    first.launcher.session.events.push(userEvent as unknown as FakeEvent)
    first.service.recordMemberSessionEvent(first.launcher.id, userEvent)
    first.service.reportAssistantInteraction(first.launcher as unknown as Agent, {
      runId: run.id,
      outcome: 'complete',
      reason: 'The request is settled.',
      report: 'Settled.',
    })
    first.service.recordMemberSessionEvent(first.launcher.id, {
      seq: 2,
      time: Date.now(),
      type: 'assistant/message',
      data: {
        interrupted: false,
        message: {
          id: 'settled-assistant-output', role: 'assistant',
          content: [{ type: 'text', text: 'Settled.' }],
        },
      },
    } as unknown as SessionEvent)
    first.service.recordMemberSessionEvent(first.launcher.id, {
      seq: 3,
      time: Date.now(),
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    } as unknown as SessionEvent)
    expect(first.service.taskBoard(run.id).interactionTask(assistantId)?.stableState.kind).toBe('completed')
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, {
      launcherId: 'replacement-launcher',
      persisted: first.persisted,
      persistedHeaders: first.persistedHeaders,
    })
    second.launcher.session.events.push(userEvent as unknown as FakeEvent)
    await second.service.attachAssistant(second.launcher as unknown as Agent, {
      runId: run.id,
      assistantId,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(second.runtime.resumes).toEqual([])
    expect(second.service.status(run.id).runtimeState).toBe('dormant')
    expect(second.service.readTrace(run.id, 0, 300).events)
      .not.toContainEqual(expect.objectContaining({ type: 'team_restored_for_user_input' }))

    second.disconnect()
    await second.core.close()
  })

  it('loads every unpaused formal member for a new direct assistant input without broadcasting a wake', async () => {
    const { root, configPath } = fixture()
    const first = setup(root)
    const run = await first.service.create(first.launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected Team assistant')
    for (const member of run.members) {
      const agent = first.runtime.get(member.sessionId)
      if (agent !== undefined) first.persisted.set(member.sessionId, structuredClone(agent.session.events))
    }
    first.disconnect()
    await first.core.close()

    const second = setup(root, {
      launcherId: 'replacement-launcher',
      persisted: first.persisted,
      persistedHeaders: first.persistedHeaders,
    })
    const input = {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'new-direct-assistant-input', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Please coordinate the Team on this request.' }],
      },
    } as unknown as SessionEvent
    second.launcher.session.events.push(input as unknown as FakeEvent)

    await second.service.attachAssistant(second.launcher as unknown as Agent, {
      runId: run.id,
      assistantId,
    })

    expect(second.runtime.resumes.map(resume => resume.id)).toEqual(
      expect.arrayContaining(run.members.map(member => member.sessionId)),
    )
    expect(second.runtime.resumes).toHaveLength(run.members.length)
    expect(second.service.status(run.id)).toMatchObject({
      runtimeState: 'active',
      members: run.members.map(member => expect.objectContaining({ name: member.name, status: 'idle' })),
    })
    for (const member of second.service.status(run.id).members) {
      const messages = second.runtime.get(member.sessionId)?.messages ?? []
      expect(messages.flatMap(message => message.content)
        .some(block => block.type === 'text' && block.text.includes('Team was explicitly woken'))).toBe(false)
    }
    expect(second.service.readTrace(run.id, 0, 300).events).toContainEqual(expect.objectContaining({
      type: 'team_loaded_for_user_input',
      data: expect.stringContaining('"members":["lead","reviewer"]'),
    }))

    second.disconnect()
    await second.core.close()
  })

  it('pauses automatic owner-task continuation after a non-network turn failure', async () => {
    const { root, configPath } = fixture()
    const { service, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    if (assistantId === undefined) throw new Error('expected Team assistant')
    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'credential-failure-input', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Continue this persistent foreground request.' }],
      },
    } as unknown as SessionEvent)
    const messagesBeforeFailure = launcher.messages.length

    service.recordMemberSessionEvent(launcher.id, {
      seq: 2,
      time: Date.now(),
      type: 'turn/end',
      data: {
        turn: 1,
        reason: {
          kind: 'error',
          error: { code: 'NO_CREDENTIAL', message: 'No credential is configured for this provider route.' },
        },
      },
    } as unknown as SessionEvent)
    service.agentIdle(launcher as unknown as Agent)
    await Promise.resolve()

    expect(launcher.messages).toHaveLength(messagesBeforeFailure)
    expect(service.taskBoard(run.id).interactionTask(assistantId)).toMatchObject({
      stableState: { kind: 'running' },
      owners: [{ member: assistantId }],
    })
    expect(service.status(run.id).assistants[0]?.status).toBe('error')
    expect(service.readTrace(run.id, 0, 300).events.filter(event =>
      event.type === 'member_auto_continuation_paused')).toEqual([
      expect.objectContaining({
        data: expect.stringContaining('NO_CREDENTIAL'),
      }),
    ])

    service.recordMemberSessionEvent(launcher.id, {
      seq: 3,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 2 },
    } as unknown as SessionEvent)
    service.agentIdle(launcher as unknown as Agent)

    expect(launcher.messages).toHaveLength(messagesBeforeFailure + 1)
    expect(launcher.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('[Fleet owner task list]') }),
    ])
    expect(service.status(run.id).assistants[0]?.status).toBe('idle')
    disconnect()
  })

  it('retries malformed tool protocol twice, then escalates to one assistant without a storm', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })
    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    if (lead === undefined) throw new Error('expected live lead member')
    const messagesBeforeFailure = lead.messages.length
    const malformedTurn = (seq: number): SessionEvent => ({
      seq,
      time: Date.now(),
      type: 'turn/end',
      data: {
        turn: seq,
        reason: {
          kind: 'error',
          error: {
            code: 'PI_AI_ERROR',
            message: 'malformed_tool_protocol: Inference backend returned malformed tool-call protocol.',
          },
        },
      },
    })

    service.recordMemberSessionEvent(lead.id, malformedTurn(10))
    service.agentIdle(lead as unknown as Agent)
    await Promise.resolve()

    expect(lead.messages).toHaveLength(messagesBeforeFailure + 1)
    expect(lead.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('smallest safe next step') }),
    ])
    expect(service.readTrace(run.id, 0, 300).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'member_protocol_recovery_scheduled' }),
      expect.objectContaining({ type: 'member_protocol_recovery_woken' }),
    ]))
    expect(service.readTrace(run.id, 0, 300).events.some(event =>
      event.type === 'member_auto_continuation_paused')).toBe(false)

    service.recordMemberSessionEvent(lead.id, {
      seq: 11,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 11 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(lead.id, malformedTurn(11))
    service.agentIdle(lead as unknown as Agent)
    await Promise.resolve()

    expect(lead.messages).toHaveLength(messagesBeforeFailure + 2)
    expect(lead.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Retry 2/2') }),
    ])
    expect(service.readTrace(run.id, 0, 300).events.some(event =>
      event.type === 'member_protocol_recovery_exhausted')).toBe(false)

    const assistantMessagesBeforeEscalation = launcher.messages.length
    service.recordMemberSessionEvent(lead.id, {
      seq: 12,
      time: Date.now(),
      type: 'turn/start',
      data: { turn: 12 },
    } as unknown as SessionEvent)
    service.recordMemberSessionEvent(lead.id, malformedTurn(12))
    service.agentIdle(lead as unknown as Agent)
    await Promise.resolve()

    expect(lead.messages).toHaveLength(messagesBeforeFailure + 2)
    expect(launcher.messages).toHaveLength(assistantMessagesBeforeEscalation + 1)
    expect(launcher.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('protocol recovery required') }),
    ])
    expect(service.readTrace(run.id, 0, 300).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'member_protocol_recovery_exhausted' }),
      expect.objectContaining({ type: 'member_protocol_recovery_escalated' }),
    ]))
    expect(service.readTrace(run.id, 0, 300).events.some(event =>
      event.type === 'member_auto_continuation_paused')).toBe(false)
    disconnect()
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

  it('keeps an actionable assigned task active until its assignee settles the state', async () => {
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
    const task = service.taskBoard(run.id).create(lead.id, {
      title: 'Verify the release evidence',
      description: 'Read the existing report before running any new checks.',
      priority: 'high',
      assignees: ['reviewer'],
    })
    const messagesBefore = reviewer.messages.length

    service.agentIdle(reviewer as unknown as Agent)

    expect(reviewer.messages).toHaveLength(messagesBefore + 1)
    expect(reviewer.messages.at(-1)?.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining(`[Fleet task attempt] ${task.title}`),
      }),
    ])
    const attemptNotice = reviewer.messages.at(-1)?.content[0]
    if (attemptNotice?.type !== 'text') throw new Error('expected task-attempt notice')
    expect(attemptNotice.text).toContain('Fleet already claimed this ReconcileAttempt')
    expect(attemptNotice.text).toContain('Do not call fleet_reconcile claim')
    expect(attemptNotice.text).toContain(`action="resolve", id="${task.id}", attempt_id="attempt_`)
    expect(attemptNotice.text).toContain('The id is the Task id, not the attempt or reconciler id.')
    expect(service.readTrace(run.id, 0, 200).events).toContainEqual(expect.objectContaining({
      type: 'member_continued',
      data: expect.stringContaining('assigned_task'),
    }))

    const currentTask = service.taskBoard(run.id).get(reviewer.id, task.id)
    if (currentTask.activeReconcile?.status !== 'running') throw new Error('expected running ReconcileAttempt')
    settleCompletedTask(service.taskBoard(run.id), reviewer.id, task.id, currentTask.activeReconcile.attemptId, 'Task completed.')
    service.finish(launcher as unknown as Agent, 'cancelled', 'Assigned-task continuation verified.', run.id)
    await service.wait(run.id, 1_000)
    service.end(launcher as unknown as Agent, 'Assigned-task Team closed.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('dispatches independent ready Tasks concurrently without a Team-wide limit', async () => {
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
    lead.status = 'idle'
    reviewer.status = 'idle'
    const leadMessages = lead.messages.length
    const reviewerMessages = reviewer.messages.length

    const implementation = service.taskBoard(run.id).create(lead.id, {
      title: 'Implement independent change', assignees: ['lead'],
    })
    const review = service.taskBoard(run.id).create(lead.id, {
      title: 'Review independent evidence', assignees: ['reviewer'],
    })

    await vi.waitFor(() => {
      expect(lead.messages).toHaveLength(leadMessages + 1)
      expect(reviewer.messages).toHaveLength(reviewerMessages + 1)
    })
    expect(service.taskBoard(run.id).get(lead.id, implementation.id).activeReconcile)
      .toMatchObject({ status: 'running', target: 'lead' })
    expect(service.taskBoard(run.id).get(reviewer.id, review.id).activeReconcile)
      .toMatchObject({ status: 'running', target: 'reviewer' })

    service.finish(launcher as unknown as Agent, 'cancelled', 'Concurrent dispatch verified.', run.id)
    await service.wait(run.id, 1_000)
    service.end(launcher as unknown as Agent, 'Concurrent dispatch Team closed.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('starts work through a zero-owner composite root without waking every member', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath, projectRoot: root, requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    const running = service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    const rootTaskId = running.work?.rootTaskId
    if (rootTaskId === undefined) throw new Error('expected composite root Task')
    expect(reviewer.messages).toHaveLength(0)
    expect(service.taskBoard(run.id).get(lead.id, rootTaskId).domain).toMatchObject({
      kind: 'composite', managedChildren: true, rootWorkId: running.work?.id,
    })
    expect(service.taskBoard(run.id).get(lead.id, rootTaskId).owners).toEqual([])
    expect(service.taskBoard(run.id).ownerTasks('lead').map(task => task.parentId)).toContain(rootTaskId)

    settleDefaultCompositeWork(service.taskBoard(run.id), lead.id, rootTaskId, 'complete', 'Accepted result.')
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({
      status: 'idle', work: { status: 'finished', summary: 'Accepted result.' },
    })
    service.end(launcher as unknown as Agent, 'Composite root test complete.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('keeps work and foreground reporting open until formal-member Tasks quiesce', async () => {
    const { root, configPath, taskPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath, projectRoot: root, requiredPaths: [],
    })
    const assistantId = run.assistants[0]?.view.id
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (assistantId === undefined || lead === undefined || reviewer === undefined) {
      throw new Error('expected assistant and live Fleet members')
    }
    service.recordMemberSessionEvent(launcher.id, {
      seq: 1,
      time: Date.now(),
      type: 'user/message',
      data: {
        id: 'foreground-user-barrier', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Run the gated Team task.' }],
      },
    } as unknown as SessionEvent)
    const running = service.start(launcher as unknown as Agent, {
      runId: run.id, taskPath, projectRoot: root,
      directive: 'Plan: lead implements the change, then reviewer independently verifies the evidence.',
      resultStage: 'implementation',
      stages: [
        {
          key: 'implementation',
          kind: 'goal',
          title: 'Implement the delegated change',
          description: 'Produce the requested change and implementation evidence.',
          owners: ['lead'],
          dependencies: [],
        },
        {
          key: 'review',
          kind: 'vote',
          title: 'Independently review the change',
          description: 'Approve the implementation only when independent evidence passes.',
          owners: ['reviewer'],
          dependencies: ['implementation'],
        },
      ],
    })
    const rootTaskId = running.work?.rootTaskId
    if (rootTaskId === undefined) throw new Error('expected composite root Task')
    const implementation = service.taskBoard(run.id).state().tasks.find(task =>
      task.parentId === rootTaskId && task.title === 'Implement the delegated change')
    const review = service.taskBoard(run.id).state().tasks.find(task =>
      task.parentId === rootTaskId && task.title === 'Independently review the change')
    if (implementation === undefined || review === undefined) throw new Error('expected assistant-created cohort')
    expect(implementation).toMatchObject({
      owners: [{ member: 'lead' }], dependencies: [], domain: { kind: 'goal', rootWorkId: running.work?.id },
    })
    expect(review).toMatchObject({
      owners: [{ member: 'reviewer' }], dependencies: [implementation.id], domain: { kind: 'vote' },
    })
    expect(service.taskBoard(run.id).get(lead.id, rootTaskId)).toMatchObject({
      owners: [], decision: 'vote', domain: { kind: 'composite', managedChildren: true },
    })
    expect(() => service.taskBoard(run.id).createGoal(lead.id, {
      title: 'Duplicate planned stage', owners: ['reviewer'], parentId: rootTaskId,
    })).toThrow('accepts children only through its ReconcileAttempt')
    expect(service.taskBoard(run.id).ownerTasks('reviewer').map(task => task.id)).not.toContain(review.id)

    expect(() => service.taskBoard(run.id).claim(lead.id, rootTaskId)).toThrow('has no ready ReconcileAttempt')
    expect(service.status(run.id)).toMatchObject({ status: 'running', work: { status: 'running' } })

    service.taskBoard(run.id).signalInteractionDelivery(assistantId, 'Simulated progress deadline.')
    expect(() => service.reportAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      outcome: 'complete',
      reason: 'Too early.',
      report: 'This must not be reported.',
    })).toThrow('still waits for live Tasks')

    service.taskBoard(run.id).submitGoal(lead.id, implementation.id, {
      kind: 'complete', reason: 'Implementation complete.', result: 'Implementation evidence.',
    })
    expect(service.taskBoard(run.id).ownerTasks('lead').map(task => task.id)).not.toContain(rootTaskId)
    expect(service.taskBoard(run.id).ownerTasks('reviewer').map(task => task.id)).toContain(review.id)
    service.taskBoard(run.id).castVote(reviewer.id, review.id, 'reject', 'Independent evidence found a defect.')
    expect(service.taskBoard(run.id).readyTasks('lead')).toEqual([])
    expect(service.taskBoard(run.id).get(lead.id, rootTaskId).stableState).toMatchObject({
      kind: 'completed',
      result: expect.stringContaining('Acceptance rejected'),
    })
    await expect(service.wait(run.id, 1_000)).resolves.toMatchObject({
      status: 'idle', work: { status: 'finished', summary: expect.stringContaining('Acceptance rejected') },
    })
    expect(() => service.reportAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      outcome: 'complete',
      reason: 'All formal-member work is quiescent.',
      report: 'Final result.',
    })).not.toThrow()

    service.end(launcher as unknown as Agent, 'Work barrier test complete.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('wakes every explicit Goal owner concurrently and stops after their submissions', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath, projectRoot: root, requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    lead.status = 'idle'
    reviewer.status = 'idle'
    const leadBefore = lead.messages.length
    const reviewerBefore = reviewer.messages.length
    const goal = service.taskBoard(run.id).createGoal(lead.id, {
      title: 'Parallel sprint', owners: ['lead', 'reviewer'],
    })
    await vi.waitFor(() => {
      expect(lead.messages.length).toBeGreaterThan(leadBefore)
      expect(reviewer.messages.length).toBeGreaterThan(reviewerBefore)
    })
    expect(reviewer.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('including a reject recommendation') }),
    ])
    service.taskBoard(run.id).submitGoal(lead.id, goal.id, { kind: 'complete', reason: 'Implementation done.' })
    expect(service.taskBoard(run.id).ownerTasks('lead')).toEqual([])
    service.taskBoard(run.id).submitGoal(reviewer.id, goal.id, { kind: 'complete', reason: 'Review done.' })
    expect(service.taskBoard(run.id).get(lead.id, goal.id).stableState.kind).toBe('completed')
    expect(service.taskBoard(run.id).ownerTasks('reviewer')).toEqual([])
    service.end(launcher as unknown as Agent, 'Parallel Goal test complete.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('drives Inbox and Reply Tasks even while the outer Team has no work item', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath, projectRoot: root, requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    reviewer.status = 'idle'
    const before = reviewer.messages.length
    const sent = service.messageHub(run.id).send(lead, {
      to: '#main', text: '@reviewer please inspect this.', mentions: ['@reviewer'], delivery: 'quiet',
    })
    await vi.waitFor(() => expect(reviewer.messages.length).toBeGreaterThan(before))
    const reply = service.taskBoard(run.id).pendingReply('reviewer')
    if (reply === undefined) throw new Error('expected Reply Task')
    expect(service.taskBoard(run.id).ownerTasks('reviewer').map(task => task.domain.kind))
      .toEqual(['reply'])
    service.messageHub(run.id).readInbox(reviewer)
    service.taskBoard(run.id).syncInbox('reviewer', 0, 0)
    const delivered = service.messageHub(run.id).send(reviewer, {
      to: '#main', text: 'Inspection complete.', replyTo: sent.messageId, delivery: 'quiet',
    })
    service.taskBoard(run.id).recordReply(reviewer.id, reply.id, delivered.messageId)
    expect(service.taskBoard(run.id).ownerTasks('reviewer')).toEqual([])
    service.end(launcher as unknown as Agent, 'Inbox and Reply test complete.', run.id)
    await service.wait(run.id, 1_000)
    disconnect()
  })

  it('does not turn a complete native direct delivery into a duplicate Inbox owner task', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath, projectRoot: root, requiredPaths: [],
    })
    const lead = runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (lead === undefined || reviewer === undefined) throw new Error('expected live Fleet members')
    const pendingContext = reviewer.inbox.nextStep.length

    service.messageHub(run.id).send(lead, {
      to: '@reviewer', text: 'This complete direct context needs no second fetch.', delivery: 'quiet',
    })

    expect(service.messageHub(run.id).unreadSummary('reviewer').unreadMessages).toBe(1)
    expect(service.messageHub(run.id).taskUnreadSummary('reviewer')).toEqual({
      unreadMessages: 0, unreadChars: 0,
    })
    expect(service.taskBoard(run.id).ownerTasks('reviewer')).toEqual([])
    expect(reviewer.inbox.nextStep).toHaveLength(pendingContext + 1)
    disconnect()
  })

  it('makes private delivery optional until the assistant explicitly mentions its recipient', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath, projectRoot: root, requiredPaths: [],
    })
    const reviewer = runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')
    if (reviewer === undefined) throw new Error('expected live Fleet reviewer')
    service.taskBoard(run.id).recordInteractionInput('team-assistant', {
      messageId: 'foreground-direct-reply-test',
      text: 'Ask the reviewer for one direct response.',
    })

    const optional = service.sendConversationMessage(launcher as unknown as Agent, {
      runId: run.id,
      to: '@reviewer',
      text: 'Please return the bounded regression result.',
      delivery: 'quiet',
    })

    expect(optional.replyTaskIds).toBeUndefined()
    expect(service.taskBoard(run.id).ownerTasks('reviewer')).toEqual([])
    expect(service.messageHub(run.id).taskUnreadSummary('reviewer')).toEqual({
      unreadMessages: 0, unreadChars: 0,
    })
    expect(reviewer.inbox.nextStep.at(-1)?.content).toEqual([
      expect.objectContaining({ text: expect.not.stringContaining('reply-task') }),
    ])

    const sent = service.sendConversationMessage(launcher as unknown as Agent, {
      runId: run.id,
      to: '@reviewer',
      text: '@reviewer Please return the bounded regression result.',
      delivery: 'quiet',
    })

    expect(sent.replyTaskIds).toHaveLength(1)
    expect(service.taskBoard(run.id).ownerTasks('reviewer').map(task => task.domain.kind)).toEqual(['reply'])
    expect(reviewer.inbox.nextStep.at(-1)?.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('reply-task') }),
    ])

    const replyTaskId = sent.replyTaskIds?.[0]
    if (replyTaskId === undefined) throw new Error('expected direct Reply Task id')
    service.taskBoard(run.id).recordReply(String(reviewer.id), replyTaskId, 'msg_already_settled')
    const raced = service.continueAssistantInteraction(launcher as unknown as Agent, {
      runId: run.id,
      reason: 'The direct reply raced with continuation.',
      taskIds: [replyTaskId],
    })
    expect(raced.goals).toEqual([])
    expect(raced.task.stableState.kind).not.toBe('dormant')
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
    expect(lead.messages).toHaveLength(leadMessages + 1)
    expect(reviewer.messages).toHaveLength(reviewerMessages + 1)
    expect(reviewer.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('network recovery') }),
    ])
    service.recordMemberSessionEvent(reviewer.id, completedTurn(11))
    vi.advanceTimersByTime(5 * 60_000)
    expect(reviewer.messages).toHaveLength(reviewerMessages + 1)

    service.recordMemberSessionEvent(lead.id, failedTurn(12))
    vi.advanceTimersByTime(29_999)
    expect(lead.messages).toHaveLength(leadMessages + 1)
    vi.advanceTimersByTime(1)
    expect(lead.messages).toHaveLength(leadMessages + 2)
    service.recordMemberSessionEvent(lead.id, failedTurn(13))
    vi.advanceTimersByTime(59_999)
    expect(lead.messages).toHaveLength(leadMessages + 2)
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
    expect(messages.read(reviewer, { conversation: '@lead', limit: 50, unreadOnly: false }).messages).toHaveLength(50)

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
  }, 15_000)

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
