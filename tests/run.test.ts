import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
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
} from '@dsh-agent-fleet/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FleetRunService } from '../src/run.js'
import type { FleetRunMember } from '../src/run.js'
import { FleetArchiveRegistry } from '../src/archive.js'
import { FleetAuthorizationService } from '../src/authorization.js'
import { FleetCollaborationService } from '../src/collaboration.js'
import { normalizeFleetSetupConfiguration } from '../src/setup.js'

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
    const agent = this.add(input.id, input.cwd ?? '')
    return Promise.resolve({
      agent,
      dispose: async () => { this.agents.delete(agent.id) },
    })
  }

  resume(_owner: RuntimeAgent, input: ResumeRuntimeAgentInput): Promise<RuntimeAgentHandle> {
    this.resumes.push(input)
    const agent = this.add(this.resumedIds.get(input.id) ?? input.id, '')
    const pending = this.resumeInboxes.get(input.id)
    if (pending !== undefined) {
      agent.inbox.nextTurn.push(...(pending.nextTurn ?? []))
      agent.inbox.nextStep.push(...(pending.nextStep ?? []))
    }
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
        toolGroups: ['messages', 'coordination', 'resources', 'status', 'schedule', 'tasks', 'calendar', 'documents', 'git'],
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
        toolGroups: ['messages', 'coordination', 'resources', 'status', 'schedule', 'tasks', 'calendar', 'documents', 'git'],
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
  disconnect(): void
} {
  const runtime = new FakeRuntime(options?.resumeInboxes, options?.resumedIds)
  const launcher = runtime.add(options?.launcherId ?? 'launcher', root, options?.launcherOptions)
  const core = new FleetCore(runtime)
  const persisted = options?.persisted ?? new Map<string, FakeEvent[]>()
  const persistedHeaders = options?.persistedHeaders ?? new Map<string, SessionHeader>()
  const context = {
    on: () => () => {},
    get: (name: string) => name === 'sessionPersistence'
      ? {
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
        }
      : undefined,
    agents: { get: (id: string) => runtime.get(id) },
    sessions: {
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
    },
    fs: {
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
    },
  } as unknown as Context
  const collaboration = new FleetCollaborationService(context, new FleetAuthorizationService())
  const service = new FleetRunService(context, core, collaboration, {
    registryDirectory: join(root, '.fleet-registry'),
    ...(options?.archives === undefined ? {} : { archives: options.archives }),
  })
  return {
    service,
    core,
    runtime,
    launcher,
    persisted,
    persistedHeaders,
    disconnect: () => { service.close() },
  }
}

describe('FleetRunService', () => {
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
    const copiedResumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: copied.run.id,
      projectRoot: copiedRoot,
    })
    expect(copiedResumed).toMatchObject({ status: 'running', runtimeState: 'active' })
    expect(readFileSync(join(copiedRoot, '.fleet', copied.run.id, 'decision-log.md'), 'utf8'))
      .toBe('Keep this document across archive import.\n')

    const restoringAssistant = second.runtime.add('restoring-assistant-2', restoredRoot)
    const resumed = await second.service.resume(restoringAssistant as unknown as Agent, {
      runId: run.id,
      projectRoot: restoredRoot,
    })
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
    const { service, runtime, launcher, disconnect } = setup(root, {
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
    expect(runtime.creates[0]?.persona).toContain('## Responsibility\n\nOwn lasting product direction.')
    expect(runtime.creates[0]?.persona).toContain('Configured Fleet tool groups: messages, coordination. Optional groups are available only when their sub-plugin is installed.')
    expect(runtime.creates[0]?.persona).toContain('No Fleet member is a default coordinator.')
    expect(service.memberViews(run.id)[0]).toMatchObject({
      id: 'product-lead',
      toolGroups: ['messages', 'coordination'],
      permissions: ['vote.create'],
      contacts: { members: [], channels: ['delivery'] },
    })
    const register = vi.fn(() => () => {})
    const restrict = vi.fn(() => () => {})
    await runtime.creates[0]?.setup?.({
      inject: (_deps: readonly string[], callback: (scope: Context) => void) => {
        callback({ tools: { register, restrict } } as unknown as Context)
        return Promise.resolve()
      },
    } as unknown as Context)
    expect(restrict).toHaveBeenCalledWith({
      deny: ['fleet_agent', 'fleet_run', 'fleet_archive', 'fleet_assistant', 'fleet_trace', 'fleet_setup', 'fleet_member'],
    })
    expect(register.mock.calls.map(call => (call[0] as { name: string }).name)).toEqual([
      'fleet_send',
      'fleet_followup',
      'fleet_messages',
      'fleet_wait',
      'fleet_tools',
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
      'fleet_channel',
      'fleet_vote',
      'fleet_meeting',
    ])
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
      history: [{
        id: revision.id,
        updatedBy: run.members[0]?.sessionId ?? String(launcher.id),
        operation: 'updated',
      }],
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
        from: launcher.id,
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
    expect(() => service.uploadResource(launcher as unknown as Agent, {
      runId: run.id,
      name: '../outside.txt',
      base64: '',
    })).toThrow('plain file name')

    service.start(launcher as unknown as Agent, { runId: run.id, taskPath, projectRoot: root })
    service.sendAssistantMessage(launcher as unknown as Agent, {
      runId: run.id,
      kind: 'directive',
      text: 'Pause feature expansion and finish the requested file only.',
      projectRoot: root,
    })
    expect(lead.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Pause feature expansion') }),
    ])
    expect(reviewer.messages.at(-1)?.content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Pause feature expansion') }),
    ])

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
    })
    expect(attached.run.assistants).toHaveLength(2)
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
    expect(rebound.assistant).toMatchObject({
      sessionId: replacementAssistant.id,
      view: { id: attached.assistant.view.id, name: 'Maya' },
    })
    expect(hub.listMeetings(replacementAssistant)).toContainEqual(expect.objectContaining({
      id: 'user-review',
      participants: expect.arrayContaining([replacementAssistant.id]),
    }))

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
    service.messageHub(run.id).read(reviewer, { conversation: '#main', limit: 100 })
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

    const projection = service.readWebTeamProjection(run.id, 0, 1_000)
    expect(journalReads).toBe(0)
    expect(projection.events.filter(event => event.type === 'coordination.message')).toHaveLength(500)
    expect(projection.events.filter(event => event.type === 'coordination.inbox')).toHaveLength(100)
    expect(projection.events).toContainEqual(expect.objectContaining({
      type: 'member_status.updated',
      data: expect.objectContaining({
        status: expect.objectContaining({ member: 'lead', message: 'Reviewing the long-running projection' }),
      }),
    }))
    expect(projection.events.some(event => event.type.startsWith('session.'))).toBe(false)
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
    expect(resumedLead.messages).toHaveLength(1)
    expect(resumedLead.inbox.nextTurn).toHaveLength(1)
    expect(resumedLead.inbox.nextStep).toEqual([pendingLeadWork])
    expect(resumedReviewer.messages).toHaveLength(1)
    expect(resumedReviewer.inbox.nextTurn).toHaveLength(1)
    expect(resumedReviewer.inbox.nextStep).toEqual([pendingReviewerWork])
    expect(second.service.readTrace(run.id, 0, 100).events
      .filter(event => event.type === 'coordination.message')).toHaveLength(coordinationMessagesBefore)
    expect(second.service.readTrace(run.id, 0, 100).events)
      .toContainEqual(expect.objectContaining({ type: 'team_resumed' }))

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
      'team_resumed',
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

  it('pauses and resumes a Team without resuming members that were already paused individually', async () => {
    const { root, configPath } = fixture()
    const { service, runtime, launcher, disconnect } = setup(root)
    const run = await service.create(launcher as unknown as Agent, {
      configPath,
      projectRoot: root,
      requiredPaths: [],
    })

    await service.pauseMember(launcher as unknown as Agent, run.id, 'reviewer')
    const paused = await service.pauseTeam(launcher as unknown as Agent, run.id)

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

    const resumed = await service.resumeTeam(launcher as unknown as Agent, run.id)
    expect(resumed).toMatchObject({
      status: 'idle',
      teamPausedMembers: [],
      members: [
        expect.objectContaining({ name: 'lead', status: 'idle' }),
        expect.objectContaining({ name: 'reviewer', status: 'paused' }),
      ],
    })
    expect(runtime.get(run.members.find(member => member.name === 'lead')?.sessionId ?? '')).toBeDefined()
    expect(runtime.get(run.members.find(member => member.name === 'reviewer')?.sessionId ?? '')).toBeUndefined()

    service.end(launcher as unknown as Agent, 'Team pause controls verified.', run.id)
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

    const second = setup(root, { launcherId: 'replacement-launcher', persisted: first.persisted })
    expect(second.service.status(run.id)).toMatchObject({ status: 'paused', runtimeState: 'dormant' })

    const resumed = await second.service.resume(second.launcher as unknown as Agent, {
      runId: run.id,
      projectRoot: root,
    })
    expect(resumed).toMatchObject({
      status: 'idle',
      runtimeState: 'active',
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
    expect(messages.read(reviewer, { conversation: '@lead', limit: 100 }).messages).toHaveLength(100)

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
