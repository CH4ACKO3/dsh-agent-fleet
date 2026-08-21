import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { FleetCore } from '@dsh-agent-fleet/core'
import type { FleetCoordinationEvent, MessageHub } from '@dsh-agent-fleet/message'
import type { FleetResourceEvent, FleetResources } from '@dsh-agent-fleet/resources'

export type FleetRunStatus = 'starting' | 'running' | 'finished' | 'blocked' | 'failed' | 'cancelled'

export interface FleetRunMember {
  readonly name: string
  readonly role: string
  readonly sessionId: string
  readonly status?: 'idle' | 'running' | 'offline'
}

export interface FleetRunRecord {
  readonly id: string
  readonly team: string
  readonly name: string
  readonly configPath: string
  readonly taskPath: string
  readonly projectRoot: string
  readonly coordinator: string
  readonly launcherSessionId: string
  readonly agentOptions?: {
    readonly provider?: string
    readonly model?: string
    readonly maxTokens?: number
  }
  readonly members: FleetRunMember[]
  readonly status: FleetRunStatus
  readonly settled: boolean
  readonly startedAt: string
  readonly endedAt?: string
  readonly summary?: string
  readonly error?: string
}

export interface FleetTraceEvent {
  readonly sequence: number
  readonly createdAt: string
  readonly type: string
  readonly data: string
}

interface TeamMemberTemplate {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly prompt: string
  readonly readableChannels: string[]
}

interface TeamChannelTemplate {
  readonly id: string
  readonly name: string
  readonly initialMessage: string
  readonly summary: string
  readonly body: string
}

interface TeamTemplate {
  readonly team: string
  readonly name: string
  readonly startupCoordinator: string
  readonly operatingPrompt: string
  readonly channels: TeamChannelTemplate[]
  readonly members: TeamMemberTemplate[]
}

interface StoredFleetEvent {
  readonly sequence: number
  readonly createdAt: string
  readonly type: string
  readonly data: unknown
}

interface SessionEventLike {
  readonly seq: number
  readonly time: number
  readonly type: string
  readonly data: unknown
}

interface SessionPersistenceLike {
  inspect(id: ReturnType<typeof SessionId>): Promise<{ readonly events: readonly SessionEventLike[] }>
}

interface RunWaiter {
  readonly runId: string
  finish(record: FleetRunRecord): void
  fail(error: unknown): void
}

interface StartRunInput {
  readonly configPath: string
  readonly taskPath: string
  readonly projectRoot: string
  readonly requiredPaths: readonly string[]
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
}

interface ResumeRunInput {
  readonly runId: string
  readonly projectRoot: string
}

const TERMINAL = new Set<FleetRunStatus>(['finished', 'blocked', 'failed', 'cancelled'])

function recordSnapshot(record: FleetRunRecord): FleetRunRecord {
  return structuredClone(record)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function optionalText(value: unknown, label: string): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value.trim()
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function parseTeamTemplate(value: unknown): TeamTemplate {
  const root = object(value, 'Team template')
  const members = array(root.members, 'members').map((rawMember, index): TeamMemberTemplate => {
    const member = object(rawMember, `members[${index}]`)
    const identity = object(member.identity, `members[${index}].identity`)
    const access = member.access === undefined ? undefined : object(member.access, `members[${index}].access`)
    const channels = access?.channels === undefined ? undefined : object(access.channels, `members[${index}].access.channels`)
    const reads = channels?.read === undefined
      ? []
      : array(channels.read, `members[${index}].access.channels.read`).map((item, readIndex) =>
        text(item, `members[${index}].access.channels.read[${readIndex}]`),
      )
    return {
      id: text(member.id, `members[${index}].id`),
      name: text(member.name, `members[${index}].name`),
      role: text(identity.role, `members[${index}].identity.role`),
      prompt: text(identity.prompt, `members[${index}].identity.prompt`),
      readableChannels: reads,
    }
  })
  const ids = new Set(members.map(member => member.id))
  if (ids.size !== members.length) throw new Error('Team member ids must be unique')

  const channels = array(root.channels, 'channels').map((rawChannel, index): TeamChannelTemplate => {
    const channel = object(rawChannel, `channels[${index}]`)
    return {
      id: text(channel.id, `channels[${index}].id`),
      name: text(channel.name, `channels[${index}].name`),
      initialMessage: optionalText(channel.initial_message, `channels[${index}].initial_message`),
      summary: optionalText(channel.summary, `channels[${index}].summary`),
      body: optionalText(channel.body, `channels[${index}].body`),
    }
  })
  const startupCoordinator = text(root.startup_coordinator, 'startup_coordinator')
  if (!ids.has(startupCoordinator)) throw new Error(`startup coordinator ${startupCoordinator} is not a Team member`)
  return {
    team: text(root.team, 'team'),
    name: text(root.name, 'name'),
    startupCoordinator,
    operatingPrompt: text(root.operating_prompt, 'operating_prompt'),
    channels,
    members,
  }
}

function persona(template: TeamTemplate, member: TeamMemberTemplate): string {
  return [
    template.operatingPrompt,
    '## Fleet identity',
    `You are @${member.id} (${member.name}), one peer in Fleet Team ${template.team}.`,
    'No member is your parent. Use Fleet Channels, direct messages, Meetings, Votes, shared files, and resource references to coordinate.',
    'The startup coordinator only begins the first coordination round and does not own the other members.',
    '## Role',
    member.prompt,
  ].join('\n\n')
}

function isTerminal(status: FleetRunStatus): boolean {
  return TERMINAL.has(status)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class FleetRunService {
  private readonly records = new Map<string, FleetRunRecord>()
  private readonly eventSequences = new Map<string, number>()
  private readonly waiters = new Set<RunWaiter>()
  private readonly finalizations = new Map<string, Promise<void>>()
  private activeRunId: string | undefined
  private resumingRunId: string | undefined

  constructor(
    private readonly ctx: Context,
    private readonly core: FleetCore,
    private readonly messages: MessageHub,
    private readonly resources: FleetResources,
  ) {}

  async start(launcher: Agent, input: StartRunInput): Promise<FleetRunRecord> {
    if (this.resumingRunId !== undefined) throw new Error(`Fleet run ${this.resumingRunId} is currently resuming`)
    const active = this.activeRunId === undefined ? undefined : this.records.get(this.activeRunId)
    if (active !== undefined && !isTerminal(active.status)) throw new Error(`Fleet run ${active.id} is still ${active.status}`)
    if (active !== undefined && !active.settled) throw new Error(`Fleet run ${active.id} is still settling`)
    if (this.persistence() === undefined) throw new Error('fleet_run requires a DSH session persistence provider')
    if (active !== undefined) {
      this.messages.reset()
      this.resources.reset()
    }

    const configPath = isAbsolute(input.configPath) ? input.configPath : resolve(input.projectRoot, input.configPath)
    const taskPath = isAbsolute(input.taskPath) ? input.taskPath : resolve(input.projectRoot, input.taskPath)
    const template = parseTeamTemplate(JSON.parse(readFileSync(configPath, 'utf8')) as unknown)
    const task = readFileSync(taskPath, 'utf8').trim()
    if (task.length === 0) throw new Error('Fleet task cannot be empty')
    const provider = input.provider ?? launcher.options.provider
    const model = input.model ?? launcher.options.model
    const maxTokens = input.maxTokens ?? launcher.options.maxTokens

    const record: FleetRunRecord = {
      id: `run_${randomUUID()}`,
      team: template.team,
      name: template.name,
      configPath,
      taskPath,
      projectRoot: input.projectRoot,
      coordinator: template.startupCoordinator,
      launcherSessionId: String(launcher.id),
      agentOptions: {
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
      },
      members: [],
      status: 'starting',
      settled: false,
      startedAt: new Date().toISOString(),
    }
    this.records.set(record.id, record)
    this.activeRunId = record.id
    this.eventSequences.set(record.id, 0)
    this.writeRecord(record)
    this.appendEvent(record.id, 'run_started', {
      team: template.team,
      configPath,
      taskPath,
      launcherSessionId: String(launcher.id),
    })

    const missing = input.requiredPaths
      .map(path => isAbsolute(path) ? path : resolve(input.projectRoot, path))
      .filter(path => !existsSync(path))
    if (missing.length > 0) {
      return this.setTerminal(record.id, 'blocked', `Missing required paths: ${missing.join(', ')}`, String(launcher.id))
    }

    const created: string[] = []
    try {
      this.core.resetProjectRoot(input.projectRoot)
      const members: FleetRunMember[] = []
      for (const member of template.members) {
        const agent = await this.core.create(launcher, {
          name: member.id,
          role: member.role,
          cwd: input.projectRoot,
          persona: persona(template, member),
          ...(input.provider === undefined ? {} : { provider: input.provider }),
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
        })
        created.push(member.id)
        members.push({ name: member.id, role: member.role, sessionId: agent.id })
        this.replaceRecord(record.id, { members: [...members] })
        this.appendEvent(record.id, 'member_attached', members.at(-1))
      }

      for (const channel of template.channels) {
        const readableNames = template.members
          .filter(member => member.readableChannels.length === 0 || member.readableChannels.includes(channel.id))
          .map(member => `@${member.id}`)
        this.messages.initializeChannel({
          id: channel.id,
          name: channel.name,
          members: readableNames,
          summary: channel.summary,
          body: channel.body,
          ...(channel.initialMessage.length === 0 ? {} : { initialMessage: channel.initialMessage }),
        })
      }

      const roster = members.map(member => `@${member.name}: ${member.role}`).join('\n')
      for (const member of members) {
        const prompt = createUserMessage({
          content: [{
            type: 'text',
            text: [
              `[Fleet run ${record.id}]`,
              `Team: ${template.name}`,
              `Your Fleet identity: @${member.name}`,
              `Startup coordinator: @${template.startupCoordinator}`,
              `Members:\n${roster}`,
              `Read #${template.channels[0]?.id ?? 'general'} before acting.`,
              `Task:\n${task}`,
            ].join('\n\n'),
          }],
          source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'instructions' },
        })
        if (member.name === template.startupCoordinator) this.core.followup(member.name, prompt)
        else this.core.inject(member.name, prompt)
      }
      const running = this.replaceRecord(record.id, { status: 'running' })
      this.appendEvent(record.id, 'run_status', { status: 'running' })
      return this.describeRecord(running)
    } catch (error) {
      for (const name of created.reverse()) {
        try {
          await this.core.stopManaged(name)
        } catch {}
      }
      const failed = this.replaceRecord(record.id, {
        status: 'failed',
        settled: true,
        endedAt: new Date().toISOString(),
        error: errorMessage(error),
      })
      this.appendEvent(record.id, 'run_status', { status: 'failed', error: failed.error })
      this.notify(failed)
      throw error
    }
  }

  async resume(launcher: Agent, input: ResumeRunInput): Promise<FleetRunRecord> {
    if (this.resumingRunId !== undefined) throw new Error(`Fleet run ${this.resumingRunId} is already resuming`)
    const currentActive = this.activeRecord()
    if (currentActive !== undefined) throw new Error(`Fleet run ${currentActive.id} is still active in this process`)

    let record = this.requireRecord(input.runId, input.projectRoot)
    if (isTerminal(record.status)) {
      if (record.settled) throw new Error(`Fleet run ${record.id} is already ${record.status} and settled`)
      return this.settleInterruptedTerminal(record)
    }
    if (record.status !== 'starting' && record.status !== 'running') {
      throw new Error(`Fleet run ${record.id} cannot resume from ${record.status}`)
    }
    if (this.persistence() === undefined) throw new Error('fleet_run requires a DSH session persistence provider')

    const template = parseTeamTemplate(JSON.parse(readFileSync(record.configPath, 'utf8')) as unknown)
    if (template.team !== record.team) throw new Error(`Fleet run ${record.id} Team config no longer matches ${record.team}`)
    if (template.startupCoordinator !== record.coordinator) {
      throw new Error(`Fleet run ${record.id} startup coordinator no longer matches its Team config`)
    }
    const templates = new Map(template.members.map(member => [member.id, member]))
    const events = this.storedEvents(record)
    const attached = new Map(record.members.map(member => [member.name, member]))
    for (const event of events) {
      if (event.type !== 'member_attached') continue
      const member = event.data as FleetRunMember
      if (!attached.has(member.name)) attached.set(member.name, member)
    }
    if ([...attached.keys()].some(name => !templates.has(name))) {
      throw new Error(`Fleet run ${record.id} member list no longer matches its Team config`)
    }
    if (record.status === 'running' && attached.size !== templates.size) {
      throw new Error(`Fleet run ${record.id} is missing persisted member Sessions`)
    }
    const members = template.members.flatMap(member => {
      const attachedMember = attached.get(member.id)
      return attachedMember === undefined ? [] : [attachedMember]
    })
    if (members.length !== record.members.length) record = this.replaceRecord(record.id, { members })

    const coordination = events
      .filter(event => event.type.startsWith('coordination.'))
      .map(event => event.data as FleetCoordinationEvent)
    const resourceReferences = events
      .filter(event => event.type === 'resource.resource_added')
      .map(event => (event.data as Extract<FleetResourceEvent, { type: 'resource_added' }>).resource)
    const provider = record.agentOptions?.provider ?? launcher.options.provider
    const model = record.agentOptions?.model ?? launcher.options.model
    const maxTokens = record.agentOptions?.maxTokens ?? launcher.options.maxTokens
    const agentOptions = {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    }
    const managed: string[] = []
    this.resumingRunId = record.id
    try {
      this.core.resetProjectRoot(record.projectRoot)
      for (const member of members) {
        const memberTemplate = templates.get(member.name)
        if (memberTemplate === undefined) throw new Error(`missing Team member ${member.name}`)
        await this.core.resume(launcher, {
          id: member.sessionId,
          name: member.name,
          role: member.role,
          persona: persona(template, memberTemplate),
          ...agentOptions,
        })
        managed.push(member.name)
      }
      if (record.status === 'starting') {
        for (const memberTemplate of template.members) {
          if (members.some(member => member.name === memberTemplate.id)) continue
          const agent = await this.core.create(launcher, {
            name: memberTemplate.id,
            role: memberTemplate.role,
            cwd: record.projectRoot,
            persona: persona(template, memberTemplate),
            ...agentOptions,
          })
          const member = { name: memberTemplate.id, role: memberTemplate.role, sessionId: agent.id }
          members.push(member)
          managed.push(member.name)
          record = this.replaceRecord(record.id, { members: [...members] })
          this.appendEvent(record.id, 'member_attached', member)
        }
      }

      this.messages.restore(coordination)
      this.resources.reset()
      this.resources.restoreResources(resourceReferences)
      const previousLauncherSessionId = record.launcherSessionId
      this.activeRunId = record.id
      this.eventSequences.set(record.id, this.lastStoredSequence(record))

      const firstMember = members[0]
      if (firstMember === undefined) throw new Error(`Fleet run ${record.id} has no members to resume`)
      const firstAgent = this.ctx.agents.get(SessionId(firstMember.sessionId))
      if (firstAgent === undefined) throw new Error(`Fleet member ${firstMember.name} did not resume`)
      const restoredChannels = new Set(this.messages.listChannels(firstAgent).map(channel => channel.id))
      for (const channel of template.channels) {
        if (restoredChannels.has(channel.id)) continue
        const readableNames = template.members
          .filter(member => member.readableChannels.length === 0 || member.readableChannels.includes(channel.id))
          .map(member => `@${member.id}`)
        this.messages.initializeChannel({
          id: channel.id,
          name: channel.name,
          members: readableNames,
          summary: channel.summary,
          body: channel.body,
          ...(channel.initialMessage.length === 0 ? {} : { initialMessage: channel.initialMessage }),
        })
      }

      const task = readFileSync(record.taskPath, 'utf8').trim()
      const roster = members.map(member => `@${member.name}: ${member.role}`).join('\n')
      for (const member of members) {
        const recovery = createUserMessage({
          content: [{
            type: 'text',
            text: [
              `[Fleet run ${record.id} resumed after a process restart.]`,
              `Your Fleet identity: @${member.name}`,
              `Members:\n${roster}`,
              'Your persisted Session context is available. Inspect current Fleet Channels, Meetings, Votes, shared plan/checklist, and resource references before continuing.',
              'Previous advisory work claims were released by the restart; declare your current paths again before editing.',
              'The previous turn may have been interrupted; verify external side effects before retrying any tool action.',
              `Task:\n${task}`,
            ].join('\n\n'),
          }],
          source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'instructions' },
        })
        if (member.name === record.coordinator) this.core.followup(member.name, recovery)
        else this.core.inject(member.name, recovery)
      }

      this.appendEvent(record.id, 'run_resumed', {
        launcherSessionId: String(launcher.id),
        previousLauncherSessionId,
        members: members.map(member => member.name),
      })
      if (record.status === 'starting') this.appendEvent(record.id, 'run_status', { status: 'running' })
      const restored = this.replaceRecord(record.id, {
        launcherSessionId: String(launcher.id),
        agentOptions,
        members: [...members],
        status: 'running',
      })
      return this.describeRecord(restored)
    } catch (error) {
      this.activeRunId = undefined
      for (const name of managed.reverse()) {
        try {
          await this.core.stopManaged(name)
        } catch {}
      }
      this.messages.reset()
      this.resources.reset()
      throw error
    } finally {
      this.resumingRunId = undefined
    }
  }

  list(projectRoot?: string): FleetRunRecord[] {
    const root = this.runsRoot(projectRoot ?? this.core.projectRoot())
    if (root !== undefined && existsSync(root)) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const path = join(root, entry.name, 'run.json')
        if (!existsSync(path)) continue
        const record = JSON.parse(readFileSync(path, 'utf8')) as FleetRunRecord
        this.records.set(record.id, record)
      }
    }
    return [...this.records.values()]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map(record => this.describeRecord(record))
  }

  status(runId?: string, projectRoot?: string): FleetRunRecord {
    return this.describeRecord(this.requireRecord(runId, projectRoot))
  }

  async wait(
    runId: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
    projectRoot?: string,
  ): Promise<FleetRunRecord> {
    const record = this.requireRecord(runId, projectRoot)
    if (isTerminal(record.status)) {
      const finalization = this.finalizations.get(record.id)
      if (finalization !== undefined) await finalization
      const current = this.requireRecord(record.id, projectRoot)
      return current.settled
        ? this.describeRecord(current)
        : this.settleInterruptedTerminal(current)
    }
    if (signal?.aborted === true) throw signal.reason ?? new Error('fleet_run wait aborted')
    return new Promise<FleetRunRecord>((resolvePromise, rejectPromise) => {
      let settled = false
      const settle = (operation: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        this.waiters.delete(waiter)
        operation()
      }
      const waiter: RunWaiter = {
        runId: record.id,
        finish: value => { settle(() => { resolvePromise(this.describeRecord(value)) }) },
        fail: error => { settle(() => { rejectPromise(error) }) },
      }
      const onAbort = (): void => { waiter.fail(signal?.reason ?? new Error('fleet_run wait aborted')) }
      const timer = setTimeout(() => { waiter.fail(new Error(`Fleet run ${record.id} did not finish before timeout`)) }, timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.waiters.add(waiter)
    })
  }

  finish(caller: Agent, status: Exclude<FleetRunStatus, 'starting' | 'running'>, summary: string): FleetRunRecord {
    const record = this.requireRecord()
    const memberIds = new Set(record.members.map(member => member.sessionId))
    if (record.launcherSessionId !== String(caller.id) && !memberIds.has(String(caller.id))) {
      throw new Error(`Agent ${String(caller.id)} does not belong to Fleet run ${record.id}`)
    }
    return this.setTerminal(record.id, status, summary, String(caller.id))
  }

  recordCoordination(event: FleetCoordinationEvent): void {
    const record = this.activeRecord()
    if (record === undefined) return
    this.appendEvent(record.id, `coordination.${event.type}`, event)
    if (event.type === 'vote' && event.action === 'closed' && event.vote.status === 'approved') {
      if (event.vote.kind === 'finish' || event.vote.kind === 'blocked') {
        this.setTerminal(
          record.id,
          event.vote.kind === 'finish' ? 'finished' : 'blocked',
          event.vote.statement,
          event.vote.initiator,
        )
      }
    }
  }

  recordResource(event: FleetResourceEvent): void {
    const record = this.activeRecord()
    if (record !== undefined) this.appendEvent(record.id, `resource.${event.type}`, event)
  }

  readTrace(runId: string | undefined, afterSequence: number, limit: number, projectRoot?: string): {
    readonly runId: string
    readonly events: FleetTraceEvent[]
    readonly hasMore: boolean
  } {
    const record = this.requireRecord(runId, projectRoot)
    const path = join(this.runDirectory(record), 'events.jsonl')
    const stored = existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as StoredFleetEvent)
      : []
    const matching = stored.filter(event => event.sequence > afterSequence)
    return {
      runId: record.id,
      events: matching.slice(0, limit).map(event => ({
        sequence: event.sequence,
        createdAt: event.createdAt,
        type: event.type,
        data: JSON.stringify(event.data),
      })),
      hasMore: matching.length > limit,
    }
  }

  async readMemberTrace(
    runId: string | undefined,
    memberName: string,
    afterSequence: number,
    limit: number,
    projectRoot?: string,
  ): Promise<{
    readonly runId: string
    readonly member: string
    readonly events: FleetTraceEvent[]
    readonly hasMore: boolean
  }> {
    const record = this.requireRecord(runId, projectRoot)
    const member = record.members.find(candidate => candidate.name === memberName)
    if (member === undefined) throw new Error(`unknown Fleet run member ${memberName}`)
    const live = this.ctx.agents.get(SessionId(member.sessionId))
    const events: readonly SessionEventLike[] = live === undefined
      ? (await this.requirePersistence().inspect(SessionId(member.sessionId))).events
      : live.session.events
    const matching = events.filter(event => event.seq > afterSequence)
    return {
      runId: record.id,
      member: member.name,
      events: matching.slice(0, limit).map(event => ({
        sequence: event.seq,
        createdAt: new Date(event.time).toISOString(),
        type: `session.${event.type}`,
        data: JSON.stringify(event.data),
      })),
      hasMore: matching.length > limit,
    }
  }

  close(): void {
    for (const waiter of [...this.waiters]) waiter.fail(new Error('Fleet Run service stopped'))
  }

  private setTerminal(
    runId: string,
    status: Exclude<FleetRunStatus, 'starting' | 'running'>,
    summary: string,
    callerId: string,
  ): FleetRunRecord {
    const current = this.requireRecord(runId)
    if (isTerminal(current.status)) return this.describeRecord(current)
    const terminalSummary = summary.trim()
    if (terminalSummary.length === 0) throw new Error('Fleet run terminal summary cannot be empty')
    const record = this.replaceRecord(runId, {
      status,
      settled: current.members.length === 0,
      endedAt: new Date().toISOString(),
      summary: terminalSummary,
    })
    this.appendEvent(runId, 'run_status', { status, summary: record.summary, callerId })
    if (record.members.length === 0) {
      this.notify(record)
      return this.describeRecord(record)
    }
    for (const member of record.members) {
      try {
        this.core.cancelManaged(member.name, callerId)
      } catch (error) {
        if (!errorMessage(error).includes('unknown Fleet Agent')) throw error
      }
    }
    const finalization = this.finalize(record, callerId)
    this.finalizations.set(record.id, finalization)
    return this.describeRecord(record)
  }

  private settleInterruptedTerminal(record: FleetRunRecord): FleetRunRecord {
    if (!isTerminal(record.status)) throw new Error(`Fleet run ${record.id} is not terminal`)
    if (record.settled) return this.describeRecord(record)
    const settled = this.replaceRecord(record.id, { settled: true })
    this.appendEvent(record.id, 'run_settled', { recoveredAfterRestart: true })
    this.notify(settled)
    return this.describeRecord(settled)
  }

  private async finalize(record: FleetRunRecord, _callerId: string): Promise<void> {
    let error: string | undefined
    const remember = (failure: unknown): void => { error ??= errorMessage(failure) }
    await Promise.all(record.members.map(async member => {
      try {
        await this.core.whenIdle(member.name)
      } catch (idleError) {
        if (!errorMessage(idleError).includes('unknown Fleet Agent')) remember(idleError)
      }
    }))
    for (const member of record.members) {
      try {
        const agent = this.ctx.agents.get(SessionId(member.sessionId))
        if (agent !== undefined) await this.ctx.sessions.flush(agent.session)
      } catch (flushError) {
        remember(flushError)
      }
    }
    for (const member of record.members) {
      try {
        await this.core.stopManaged(member.name)
      } catch (stopError) {
        if (!errorMessage(stopError).includes('unknown Fleet Agent')) remember(stopError)
      }
    }
    const settled = this.replaceRecord(record.id, {
      settled: true,
      ...(error === undefined ? {} : { error }),
    })
    this.appendEvent(record.id, 'run_settled', error === undefined ? {} : { error })
    this.notify(settled)
  }

  private activeRecord(): FleetRunRecord | undefined {
    const record = this.activeRunId === undefined ? undefined : this.records.get(this.activeRunId)
    return record?.settled === true ? undefined : record
  }

  private describeRecord(record: FleetRunRecord): FleetRunRecord {
    const live = new Map(this.core.list().map(member => [member.name, member.status]))
    return recordSnapshot({
      ...record,
      members: record.members.map(member => ({
        ...member,
        status: live.get(member.name) ?? 'offline',
      })),
    })
  }

  private requireRecord(runId?: string, projectRoot?: string): FleetRunRecord {
    let id = runId ?? this.activeRunId
    if (id === undefined && projectRoot !== undefined) id = this.list(projectRoot)[0]?.id
    if (id === undefined) throw new Error('no Fleet run is available')
    let record = this.records.get(id)
    if (record === undefined) {
      const root = this.runsRoot(projectRoot ?? this.core.projectRoot())
      if (root !== undefined) {
        const path = join(root, id, 'run.json')
        if (existsSync(path)) {
          record = JSON.parse(readFileSync(path, 'utf8')) as FleetRunRecord
          this.records.set(id, record)
        }
      }
    }
    if (record === undefined) throw new Error(`unknown Fleet run ${id}`)
    return record
  }

  private replaceRecord(runId: string, change: Partial<FleetRunRecord>): FleetRunRecord {
    const record = { ...this.requireRecord(runId), ...change }
    this.records.set(runId, record)
    this.writeRecord(record)
    return record
  }

  private writeRecord(record: FleetRunRecord): void {
    const directory = this.runDirectory(record)
    mkdirSync(directory, { recursive: true })
    const target = join(directory, 'run.json')
    const temporary = join(directory, `.run.${process.pid}.tmp`)
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    renameSync(temporary, target)
  }

  private appendEvent(runId: string, type: string, data: unknown): void {
    const record = this.requireRecord(runId)
    const sequence = (this.eventSequences.get(runId) ?? this.lastStoredSequence(record)) + 1
    this.eventSequences.set(runId, sequence)
    const event: StoredFleetEvent = {
      sequence,
      createdAt: new Date().toISOString(),
      type,
      data,
    }
    appendFileSync(join(this.runDirectory(record), 'events.jsonl'), `${JSON.stringify(event)}\n`, 'utf8')
  }

  private lastStoredSequence(record: FleetRunRecord): number {
    const path = join(this.runDirectory(record), 'events.jsonl')
    if (!existsSync(path)) return 0
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    const last = lines.at(-1)
    return last === undefined || last.length === 0 ? 0 : (JSON.parse(last) as StoredFleetEvent).sequence
  }

  private storedEvents(record: FleetRunRecord): StoredFleetEvent[] {
    const path = join(this.runDirectory(record), 'events.jsonl')
    return existsSync(path)
      ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as StoredFleetEvent)
      : []
  }

  private runDirectory(record: FleetRunRecord): string {
    return join(record.projectRoot, '.fleet', 'runs', record.id)
  }

  private runsRoot(projectRoot: string | undefined): string | undefined {
    return projectRoot === undefined ? undefined : join(projectRoot, '.fleet', 'runs')
  }

  private persistence(): SessionPersistenceLike | undefined {
    return (this.ctx as unknown as { get(name: string): unknown }).get('sessionPersistence') as
      | SessionPersistenceLike
      | undefined
  }

  private requirePersistence(): SessionPersistenceLike {
    const persistence = this.persistence()
    if (persistence === undefined) throw new Error('DSH session persistence is unavailable')
    return persistence
  }

  private notify(record: FleetRunRecord): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.runId === record.id) waiter.finish(record)
    }
  }
}

const RUN_MEMBER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    role: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    status: { type: 'string', enum: ['idle', 'running', 'offline'] },
  },
} as const

const RUN_AGENT_OPTIONS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string' },
    model: { type: 'string' },
    maxTokens: { type: 'integer' },
  },
} as const

const RUN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    team: { type: 'string', required: true },
    name: { type: 'string', required: true },
    configPath: { type: 'string', required: true },
    taskPath: { type: 'string', required: true },
    projectRoot: { type: 'string', required: true },
    coordinator: { type: 'string', required: true },
    launcherSessionId: { type: 'string', required: true },
    agentOptions: RUN_AGENT_OPTIONS_SCHEMA,
    members: { type: 'array', required: true, items: RUN_MEMBER_SCHEMA },
    status: {
      type: 'string',
      required: true,
      enum: ['starting', 'running', 'finished', 'blocked', 'failed', 'cancelled'],
    },
    settled: { type: 'boolean', required: true },
    startedAt: { type: 'string', required: true },
    endedAt: { type: 'string' },
    summary: { type: 'string' },
    error: { type: 'string' },
  },
} as const

const RUN_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['start', 'resume', 'list', 'status', 'wait', 'finish'] },
    runs: { type: 'array', items: RUN_SCHEMA },
    run: RUN_SCHEMA,
  },
} as const

const TRACE_EVENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sequence: { type: 'integer', required: true },
    createdAt: { type: 'string', required: true },
    type: { type: 'string', required: true },
    data: { type: 'string', required: true },
  },
} as const

const TRACE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    runId: { type: 'string', required: true },
    member: { type: 'string' },
    events: { type: 'array', required: true, items: TRACE_EVENT_SCHEMA },
    hasMore: { type: 'boolean', required: true },
  },
} as const

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function callingAgent(agent: Agent | undefined, tool: string): Agent {
  if (agent === undefined) throw new Error(`${tool} requires a calling Agent`)
  return agent
}

export function installRunTools(ctx: Context, service: FleetRunService): void {
  ctx.tools.register(defineTool({
    name: 'fleet_run',
    description: 'Start or resume a persistent Fleet Team, inspect or wait for its terminal status, or end it explicitly.',
    parameters: {
      action: { type: 'string', required: true, enum: ['start', 'resume', 'list', 'status', 'wait', 'finish'] },
      run_id: { type: 'string', description: 'Run id for resume, status, or wait. Defaults to the active run where supported.' },
      team_config: { type: 'string', description: 'Team JSON path required for start.' },
      task: { type: 'string', description: 'Task Markdown path required for start.' },
      cwd: { type: 'string', description: 'Shared project root. Defaults to the calling session cwd.' },
      required_paths: { type: 'array', items: { type: 'string' }, description: 'Optional paths that must exist before Agents start.' },
      provider: { type: 'string', description: 'Optional provider route for every member.' },
      model: { type: 'string', description: 'Optional model for every member.' },
      max_tokens: { type: 'integer', description: 'Optional positive output-token limit per member request.' },
      status: { type: 'string', enum: ['finished', 'blocked', 'failed', 'cancelled'], description: 'Terminal status required for finish.' },
      summary: { type: 'string', description: 'Terminal summary required for finish.' },
      timeout_ms: { type: 'integer', description: 'Wait timeout from 10000 through 3600000 milliseconds.' },
    },
    output: jsonOutput(RUN_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_run')
      const callerRoot = caller.session.header.cwd
      if (args.action === 'list') return { action: 'list' as const, runs: service.list(callerRoot) }
      if (args.action === 'status') {
        return { action: 'status' as const, run: service.status(args.run_id, callerRoot) }
      }
      if (args.action === 'wait') {
        const timeout = args.timeout_ms ?? 3_600_000
        if (!Number.isSafeInteger(timeout) || timeout < 10_000 || timeout > 3_600_000) {
          throw new Error('timeout_ms must be an integer from 10000 through 3600000')
        }
        return {
          action: 'wait' as const,
          run: await service.wait(args.run_id, timeout, exec.signal, callerRoot),
        }
      }
      if (args.action === 'finish') {
        if (args.status === undefined || args.summary === undefined) {
          throw new Error('fleet_run finish requires status and summary')
        }
        return { action: 'finish' as const, run: service.finish(caller, args.status, args.summary) }
      }
      if (args.action === 'resume') {
        if (args.run_id === undefined) throw new Error('fleet_run resume requires run_id')
        const projectRoot = args.cwd ?? caller.session.header.cwd
        if (projectRoot === undefined || !isAbsolute(projectRoot)) {
          throw new Error('fleet_run resume requires an absolute cwd or a calling session cwd')
        }
        return {
          action: 'resume' as const,
          run: await service.resume(caller, { runId: args.run_id, projectRoot }),
        }
      }
      if (args.team_config === undefined || args.task === undefined) {
        throw new Error('fleet_run start requires team_config and task')
      }
      const projectRoot = args.cwd ?? caller.session.header.cwd
      if (projectRoot === undefined || !isAbsolute(projectRoot)) {
        throw new Error('fleet_run start requires an absolute cwd or a calling session cwd')
      }
      return {
        action: 'start' as const,
        run: await service.start(caller, {
          configPath: args.team_config,
          taskPath: args.task,
          projectRoot,
          requiredPaths: args.required_paths ?? [],
          ...(args.provider === undefined ? {} : { provider: args.provider }),
          ...(args.model === undefined ? {} : { model: args.model }),
          ...(args.max_tokens === undefined ? {} : { maxTokens: args.max_tokens }),
        }),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'fleet_trace',
    description: 'Read the durable Fleet collaboration timeline, or one member\'s native DSH Session events, in sequence order.',
    parameters: {
      run_id: { type: 'string', description: 'Run id. Defaults to the active run.' },
      member: { type: 'string', description: 'Optional Fleet member name; omit for Team collaboration events.' },
      after_sequence: { type: 'integer', description: 'Return events after this sequence. Defaults to -1 for member Session events and 0 for Team events.' },
      limit: { type: 'integer', description: 'Maximum events from 1 through 200. Defaults to 100.' },
    },
    output: jsonOutput(TRACE_RESULT_SCHEMA),
    async execute(args, exec) {
      const caller = callingAgent(exec.agent, 'fleet_trace')
      const projectRoot = caller.session.header.cwd
      const limit = args.limit ?? 100
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('limit must be an integer from 1 through 200')
      if (args.after_sequence !== undefined && (!Number.isSafeInteger(args.after_sequence) || args.after_sequence < -1)) {
        throw new Error('after_sequence must be an integer greater than or equal to -1')
      }
      return args.member === undefined
        ? service.readTrace(args.run_id, args.after_sequence ?? 0, limit, projectRoot)
        : service.readMemberTrace(args.run_id, args.member, args.after_sequence ?? -1, limit, projectRoot)
    },
  }))
}

export function connectRunObservers(
  service: FleetRunService,
  messages: MessageHub,
  resources: FleetResources,
): () => void {
  const stopMessages = messages.onEvent(event => { service.recordCoordination(event) })
  const stopResources = resources.onEvent(event => { service.recordResource(event) })
  return () => {
    stopMessages()
    stopResources()
  }
}
