import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  generateFleetMemberColor,
  generateMemberDisplayName,
  normalizeFleetMemberColor,
} from '@dsh-agent-fleet/core/names'

import type { FleetAssistantRuntime } from './assistant.js'
import {
  FLEET_MESSAGE_MODULE,
  FLEET_RESOURCES_MODULE,
  FLEET_UI_MODULE,
  FleetConfigurationRegistry,
} from './configuration.js'
import type { CreateRunInput, FleetRunRecord } from './run.js'
import type { FleetWebSetupUploadInput, FleetWebUploadedResource } from '@dsh-agent-fleet/core/web'

export type FleetSetupPhase = 'setup' | 'creating' | 'operating'

export interface FleetSetupRecord {
  readonly setupId: string
  readonly assistantSessionId: string
  readonly projectRoot: string
  readonly phase: FleetSetupPhase
  readonly initialIdea?: string
  readonly configuration?: Record<string, unknown>
  readonly runId?: string
  readonly lastError?: string
  readonly updatedAt: string
}

export interface FleetSetupServiceOptions {
  readonly directory?: string
  readonly configuration?: FleetConfigurationRegistry
}

interface FleetSetupRunService {
  create(launcher: Agent, input: CreateRunInput): Promise<FleetRunRecord>
  findBySetupId(setupId: string, projectRoot: string): FleetRunRecord | undefined
  attachAssistant?(caller: Agent, input: { readonly runId: string; readonly assistantId?: string }): Promise<unknown>
  agentSessionStarted?(agent: Agent, recoverRequiredTask?: boolean): void
}

export interface BeginFleetSetupInput {
  readonly initialIdea?: string
}

export interface StageFleetSetupInput {
  readonly configuration: unknown
}

export interface FleetSetupCreation {
  readonly setup: FleetSetupRecord
  readonly run: FleetRunRecord
}

export interface FleetSetupConfigurationGuide {
  readonly configurationTemplate: string
  readonly modules: readonly {
    readonly id: string
    readonly description: string
  }[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`)
  }
  return value.trim()
}

function optionalText(value: unknown, label: string): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value.trim()
}

function optionalStringField(
  source: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, string> {
  const value = optionalText(source[key], label)
  return value.length === 0 ? {} : { [key]: value }
}

function optionalBooleanField(
  source: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, boolean> {
  const value = source[key]
  if (value === undefined) return {}
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return { [key]: value }
}

function optionalPositiveIntegerField(
  source: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, number> {
  const value = source[key]
  if (value === undefined) return {}
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer`)
  return { [key]: Number(value) }
}

function normalizeMember(
  value: unknown,
  index: number,
  existingNames: readonly string[],
  existingColors: readonly string[],
): Record<string, unknown> {
  const member = object(value, `members[${index}]`)
  const configuredName = optionalText(member.name, `members[${index}].name`)
  const configuredColor = optionalText(member.color, `members[${index}].color`)
  return {
    id: requiredText(member.id, `members[${index}].id`),
    name: configuredName || generateMemberDisplayName(existingNames),
    color: configuredColor.length === 0
      ? generateFleetMemberColor(existingColors)
      : normalizeFleetMemberColor(configuredColor),
    role: requiredText(member.role, `members[${index}].role`),
    responsibilities: requiredText(member.responsibilities, `members[${index}].responsibilities`),
    prompt: optionalText(member.prompt, `members[${index}].prompt`),
    ...optionalStringField(member, 'provider', `members[${index}].provider`),
    ...optionalStringField(member, 'model', `members[${index}].model`),
    ...optionalStringField(member, 'reasoningEffort', `members[${index}].reasoningEffort`),
    ...optionalPositiveIntegerField(member, 'maxTokens', `members[${index}].maxTokens`),
    ...optionalBooleanField(member, 'canVote', `members[${index}].canVote`),
    ...(member.toolGroups === undefined ? {} : { toolGroups: structuredClone(member.toolGroups) }),
    ...(member.permissions === undefined ? {} : { permissions: structuredClone(member.permissions) }),
    ...(member.contacts === undefined ? {} : { contacts: structuredClone(member.contacts) }),
  }
}

function normalizeAssistant(
  value: unknown,
  existingNames: readonly string[],
  existingColors: readonly string[],
): Record<string, unknown> {
  const assistant = value === undefined ? {} : object(value, 'assistant')
  const configuredName = optionalText(assistant.name, 'assistant.name')
  const configuredColor = optionalText(assistant.color, 'assistant.color')
  return {
    id: optionalText(assistant.id, 'assistant.id') || 'team-assistant',
    name: configuredName || generateMemberDisplayName(existingNames),
    color: configuredColor.length === 0
      ? generateFleetMemberColor(existingColors)
      : normalizeFleetMemberColor(configuredColor),
    role: optionalText(assistant.role, 'assistant.role') || 'Team Assistant',
    responsibilities: optionalText(assistant.responsibilities, 'assistant.responsibilities')
      || 'Maintain the user-facing Team conversation and help the user observe, control, and collaborate with the Team.',
    prompt: optionalText(assistant.prompt, 'assistant.prompt'),
    ...optionalStringField(assistant, 'provider', 'assistant.provider'),
    ...optionalStringField(assistant, 'model', 'assistant.model'),
    ...(assistant.toolGroups === undefined ? {} : { toolGroups: structuredClone(assistant.toolGroups) }),
    ...(assistant.permissions === undefined ? {} : { permissions: structuredClone(assistant.permissions) }),
    ...(assistant.contacts === undefined ? {} : { contacts: structuredClone(assistant.contacts) }),
  }
}

export function normalizeFleetSetupConfiguration(
  value: unknown,
  configuration = new FleetConfigurationRegistry(),
): Record<string, unknown> {
  const input = object(value, 'Fleet setup configuration')
  const core = object(input.core, 'core')
  const members = core.members ?? []
  if (!Array.isArray(members)) throw new Error('members must be an array')
  const normalizedMembers: Record<string, unknown>[] = []
  for (const [index, member] of members.entries()) {
    normalizedMembers.push(normalizeMember(
      member,
      index,
      normalizedMembers.map(candidate => String(candidate.name)),
      normalizedMembers.map(candidate => String(candidate.color)),
    ))
  }
  const assistant = normalizeAssistant(
    core.assistant,
    normalizedMembers.map(candidate => String(candidate.name)),
    normalizedMembers.map(candidate => String(candidate.color)),
  )
  const participants = [assistant, ...normalizedMembers]
  const memberIds = new Set(participants.map(member => member.id))
  if (memberIds.size !== participants.length) throw new Error('Team member ids must be unique')
  const modules = configuration.parse(input.modules)
  for (const required of [FLEET_MESSAGE_MODULE, FLEET_RESOURCES_MODULE, FLEET_UI_MODULE]) {
    if (!(required in modules)) throw new Error(`Fleet setup configuration requires module ${required}`)
  }

  return {
    core: {
      name: requiredText(core.name, 'Team name'),
      positioning: optionalText(core.positioning, 'positioning'),
      assistant,
      members: normalizedMembers,
    },
    modules,
  }
}

function preserveExistingModules(
  existing: Record<string, unknown> | undefined,
  next: unknown,
): Record<string, unknown> {
  const draft = object(next, 'Fleet setup configuration')
  if (existing === undefined) return draft
  const existingModules = object(existing.modules, 'modules')
  const draftModules = object(draft.modules, 'modules')
  return {
    ...draft,
    modules: {
      ...structuredClone(existingModules),
      ...draftModules,
    },
  }
}

function recordSnapshot(record: FleetSetupRecord): FleetSetupRecord {
  return structuredClone(record)
}

function parseStoredRecord(value: unknown): FleetSetupRecord {
  const record = object(value, 'Fleet setup record')
  const phase = requiredText(record.phase, 'Fleet setup phase')
  if (phase !== 'setup' && phase !== 'creating' && phase !== 'operating') {
    throw new Error(`Unknown Fleet setup phase ${phase}`)
  }
  const configuration = record.configuration === undefined
    ? undefined
    : object(record.configuration, 'Fleet setup configuration')
  const runId = record.runId === undefined ? undefined : requiredText(record.runId, 'Fleet setup runId')
  if (phase === 'operating' && runId === undefined) throw new Error('Operating Fleet setup is missing runId')
  return {
    setupId: requiredText(record.setupId, 'Fleet setup id'),
    assistantSessionId: requiredText(record.assistantSessionId, 'Fleet setup assistant session id'),
    projectRoot: requiredText(record.projectRoot, 'Fleet setup project root'),
    phase,
    ...(record.initialIdea === undefined ? {} : { initialIdea: optionalText(record.initialIdea, 'Fleet setup initial idea') }),
    ...(configuration === undefined ? {} : { configuration }),
    ...(runId === undefined ? {} : { runId }),
    ...(record.lastError === undefined ? {} : { lastError: requiredText(record.lastError, 'Fleet setup last error') }),
    updatedAt: requiredText(record.updatedAt, 'Fleet setup updatedAt'),
  }
}

export class FleetSetupService {
  private readonly directory: string
  private readonly configuration: FleetConfigurationRegistry
  private readonly creations = new Map<string, Promise<FleetSetupCreation>>()
  private readonly reconnections = new Map<string, Promise<void>>()

  constructor(
    private readonly assistant: FleetAssistantRuntime,
    private readonly runs: FleetSetupRunService,
    options: FleetSetupServiceOptions = {},
  ) {
    const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    this.directory = options.directory ?? join(dshHome, 'dsh-agent-fleet', 'setups')
    this.configuration = options.configuration ?? new FleetConfigurationRegistry()
  }

  begin(agent: Agent, input: BeginFleetSetupInput = {}): FleetSetupRecord {
    const existing = this.restore(agent)
    if (existing !== undefined) {
      return recordSnapshot(existing)
    }
    const projectRoot = agent.session.header.cwd
    if (projectRoot === undefined || !isAbsolute(projectRoot)) {
      throw new Error('Fleet setup requires the calling session to have an absolute workspace cwd')
    }
    const initialIdea = input.initialIdea?.trim()
    const record: FleetSetupRecord = {
      setupId: `setup_${randomUUID()}`,
      assistantSessionId: String(agent.id),
      projectRoot,
      phase: 'setup',
      ...(initialIdea === undefined || initialIdea.length === 0 ? {} : { initialIdea }),
      updatedAt: new Date().toISOString(),
    }
    this.write(record)
    this.assistant.activateGuide(agent, record.setupId)
    return recordSnapshot(record)
  }

  restore(agent: Agent): FleetSetupRecord | undefined {
    const stored = this.read(agent)
    if (stored === undefined) return undefined
    const record = this.reconcile(stored)
    if (record.phase === 'operating') {
      const run = this.runs.findBySetupId(record.setupId, record.projectRoot)
      const view = run?.assistants?.find(candidate => candidate.sessionId === String(agent.id))?.view
      this.assistant.activate(agent, record.runId, view)
      const attach = this.runs.attachAssistant
      if (run === undefined || attach === undefined) {
        this.runs.agentSessionStarted?.(agent)
      } else {
        const sessionId = String(agent.id)
        if (!this.reconnections.has(sessionId)) {
          const reconnect = attach.call(this.runs, agent, {
            runId: run.id,
            ...(view === undefined ? {} : { assistantId: view.id }),
          })
            .then(() => { this.runs.agentSessionStarted?.(agent, true) })
            .finally(() => {
              if (this.reconnections.get(sessionId) === reconnect) this.reconnections.delete(sessionId)
            })
          this.reconnections.set(sessionId, reconnect)
          void reconnect.catch(() => {})
        }
      }
    }
    else this.assistant.activateGuide(agent, record.setupId)
    return recordSnapshot(record)
  }

  inspect(agent: Agent): FleetSetupRecord {
    const record = this.restore(agent)
    if (record === undefined) throw new Error('No Fleet setup exists for this session; call begin first')
    return record
  }

  stage(agent: Agent, input: StageFleetSetupInput): FleetSetupRecord {
    const current = this.reconcile(this.require(agent))
    if (current.phase === 'operating') {
      throw new Error(`Fleet setup ${current.setupId} already created Team ${current.runId}`)
    }
    const { lastError: _lastError, ...currentWithoutError } = current
    const record: FleetSetupRecord = {
      ...currentWithoutError,
      phase: 'setup',
      configuration: normalizeFleetSetupConfiguration(
        preserveExistingModules(current.configuration, input.configuration),
        this.configuration,
      ),
      updatedAt: new Date().toISOString(),
    }
    this.write(record)
    this.assistant.activateGuide(agent, record.setupId)
    return recordSnapshot(record)
  }

  configurationGuide(): FleetSetupConfigurationGuide {
    const modules = this.configuration.guideModules()
    return {
      configurationTemplate: JSON.stringify({
        core: { name: '', positioning: '', members: [] },
        modules: Object.fromEntries(modules.map(module => [module.id, module.defaultValue])),
      }),
      modules: modules.map(module => ({ id: module.id, description: module.description })),
    }
  }

  create(agent: Agent): Promise<FleetSetupCreation> {
    const stored = this.require(agent)
    const inFlight = this.creations.get(stored.setupId)
    if (inFlight !== undefined) return inFlight
    const current = this.reconcile(stored)
    if (current.phase === 'operating') {
      const run = this.runs.findBySetupId(current.setupId, current.projectRoot)
      if (run === undefined) throw new Error(`Fleet setup ${current.setupId} refers to missing Team ${current.runId}`)
      this.assistant.promote(
        agent,
        run.id,
        run.assistants?.find(candidate => candidate.sessionId === String(agent.id))?.view,
      )
      return Promise.resolve({ setup: recordSnapshot(current), run })
    }
    if (current.configuration === undefined) throw new Error('Fleet setup has no staged configuration')

    const creation = this.createOnce(agent, current)
    this.creations.set(current.setupId, creation)
    void creation.finally(() => {
      if (this.creations.get(current.setupId) === creation) this.creations.delete(current.setupId)
    }).catch(() => {})
    return creation
  }

  workspaceEntries(agent: Agent): Array<{ readonly name: string; readonly type: 'file' | 'directory' | 'other' }> {
    const root = this.require(agent).projectRoot
    return readdirSync(root, { withFileTypes: true })
      .slice(0, 80)
      .map(entry => ({
        name: entry.name,
        type: entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other',
      }))
  }

  uploadResource(agent: Agent, input: FleetWebSetupUploadInput): FleetWebUploadedResource {
    if (input.sessionId !== String(agent.id)) throw new Error('Fleet setup upload session does not match caller')
    const name = input.name.trim()
    if (name.length === 0 || name.length > 255 || basename(name) !== name || name === '.' || name === '..') {
      throw new Error('Fleet setup upload name must be a plain file name up to 255 characters')
    }
    if (input.base64.length > 35_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) {
      throw new Error('Fleet setup upload content must be valid base64')
    }
    const content = Buffer.from(input.base64, 'base64')
    if (content.byteLength > 25 * 1024 * 1024) throw new Error('Fleet setup upload cannot exceed 25 MiB')
    const directory = join(this.directory, 'uploads', this.sessionKey(String(agent.id)), randomUUID())
    mkdirSync(directory, { recursive: true })
    const path = join(directory, name)
    writeFileSync(path, content)
    return {
      path,
      label: input.label?.trim() || name,
      ...(input.mediaType === undefined || input.mediaType.trim().length === 0
        ? {}
        : { mediaType: input.mediaType.trim() }),
      size: content.byteLength,
    }
  }

  private async createOnce(agent: Agent, current: FleetSetupRecord): Promise<FleetSetupCreation> {
    const creating: FleetSetupRecord = {
      ...current,
      phase: 'creating',
      updatedAt: new Date().toISOString(),
    }
    this.write(creating)
    const configPath = this.configPath(current.assistantSessionId)
    writeFileSync(configPath, `${JSON.stringify(current.configuration, null, 2)}\n`, 'utf8')
    try {
      const run = await this.runs.create(agent, {
        configPath,
        projectRoot: current.projectRoot,
        requiredPaths: [],
        sourceSetupId: current.setupId,
      })
      if (run.status === 'failed' || run.status === 'closed') {
        const failed: FleetSetupRecord = {
          ...creating,
          phase: 'setup',
          lastError: run.error ?? run.summary ?? `Team creation ended with ${run.status}`,
          updatedAt: new Date().toISOString(),
        }
        this.write(failed)
        this.assistant.activateGuide(agent, failed.setupId)
        return { setup: recordSnapshot(failed), run }
      }
      const operating: FleetSetupRecord = {
        ...creating,
        phase: 'operating',
        runId: run.id,
        updatedAt: new Date().toISOString(),
      }
      this.write(operating)
      this.assistant.promote(
        agent,
        run.id,
        run.assistants?.find(candidate => candidate.sessionId === String(agent.id))?.view,
      )
      return { setup: recordSnapshot(operating), run }
    } catch (error) {
      const failed: FleetSetupRecord = {
        ...creating,
        phase: 'setup',
        lastError: errorMessage(error),
        updatedAt: new Date().toISOString(),
      }
      this.write(failed)
      this.assistant.activateGuide(agent, failed.setupId)
      throw error
    }
  }

  private reconcile(record: FleetSetupRecord): FleetSetupRecord {
    if (record.phase !== 'creating') return record
    const run = this.runs.findBySetupId(record.setupId, record.projectRoot)
    const reconciled: FleetSetupRecord = run === undefined || run.status === 'failed' || run.status === 'closed'
      ? {
          ...record,
          phase: 'setup',
          ...(run === undefined ? {} : { lastError: run.error ?? run.summary ?? `Team creation ended with ${run.status}` }),
          updatedAt: new Date().toISOString(),
        }
      : {
          ...record,
          phase: 'operating',
          runId: run.id,
          updatedAt: new Date().toISOString(),
        }
    this.write(reconciled)
    return reconciled
  }

  private require(agent: Agent): FleetSetupRecord {
    const record = this.read(agent)
    if (record === undefined) throw new Error('No Fleet setup exists for this session; call begin first')
    return record
  }

  private read(agent: Agent): FleetSetupRecord | undefined {
    const path = this.recordPath(String(agent.id))
    if (!existsSync(path)) return undefined
    const record = parseStoredRecord(JSON.parse(readFileSync(path, 'utf8')) as unknown)
    if (record.assistantSessionId !== String(agent.id)) {
      throw new Error('Fleet setup record does not belong to the calling session')
    }
    return record
  }

  private write(record: FleetSetupRecord): void {
    mkdirSync(this.directory, { recursive: true })
    const target = this.recordPath(record.assistantSessionId)
    const temporary = `${target}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    renameSync(temporary, target)
  }

  private recordPath(sessionId: string): string {
    return join(this.directory, `${this.sessionKey(sessionId)}.json`)
  }

  private configPath(sessionId: string): string {
    mkdirSync(this.directory, { recursive: true })
    return join(this.directory, `${this.sessionKey(sessionId)}.team.json`)
  }

  private sessionKey(sessionId: string): string {
    return createHash('sha256').update(sessionId).digest('hex')
  }
}

const SETUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    setupId: { type: 'string', required: true },
    phase: { type: 'string', required: true, enum: ['setup', 'creating', 'operating'] },
    projectRoot: { type: 'string', required: true },
    initialIdea: { type: 'string' },
    configuration: { type: 'string' },
    runId: { type: 'string' },
    lastError: { type: 'string' },
  },
} as const

const SETUP_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['begin', 'inspect', 'stage', 'create'] },
    setup: SETUP_SCHEMA,
    run: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        status: { type: 'string', required: true },
      },
    },
    workspaceEntries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          type: { type: 'string', required: true, enum: ['file', 'directory', 'other'] },
        },
      },
    },
    requiredFields: { type: 'array', items: { type: 'string' } },
    configurationTemplate: { type: 'string' },
    configurationModules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          description: { type: 'string', required: true },
        },
      },
    },
  },
} as const

function outputSetup(record: FleetSetupRecord): InferValue<typeof SETUP_SCHEMA> {
  return {
    setupId: record.setupId,
    phase: record.phase,
    projectRoot: record.projectRoot,
    ...(record.initialIdea === undefined ? {} : { initialIdea: record.initialIdea }),
    ...(record.configuration === undefined ? {} : { configuration: JSON.stringify(record.configuration) }),
    ...(record.runId === undefined ? {} : { runId: record.runId }),
    ...(record.lastError === undefined ? {} : { lastError: record.lastError }),
  }
}

function jsonOutput<const S extends ValueSchemaSpec>(schema: S): {
  schema: S
  render: (args: unknown, value: InferValue<S>) => [{ type: 'text'; text: string }]
} {
  return {
    schema,
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

function callingAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) throw new Error('fleet_setup requires a calling Agent')
  return agent
}

export function installSetupTool(ctx: Context, service: FleetSetupService): void {
  ctx.tools.register(defineTool({
    name: 'fleet_setup',
    description: 'Guide and persist Team setup for this assistant session. Stages a durable configuration and atomically transitions the same session into the formal Fleet assistant after idempotent Team creation.',
    parameters: {
      action: { type: 'string', required: true, enum: ['begin', 'inspect', 'stage', 'create'] },
      initial_idea: { type: 'string', description: 'The user\'s initial project idea, used only when beginning a new setup.' },
      configuration: { type: 'string', description: 'Modular Team configuration JSON. Required for stage.' },
    },
    output: jsonOutput(SETUP_RESULT_SCHEMA),
    async execute(args, exec) {
      const agent = callingAgent(exec.agent)
      if (args.action === 'begin') {
        const setup = service.begin(agent, {
          ...(args.initial_idea === undefined ? {} : { initialIdea: args.initial_idea }),
        })
        const guide = service.configurationGuide()
        return {
          action: 'begin' as const,
          setup: outputSetup(setup),
          workspaceEntries: service.workspaceEntries(agent),
          requiredFields: ['core.name', 'modules.dsh-agent-fleet/message.defaultChannel.id', 'modules.dsh-agent-fleet/message.defaultChannel.name'],
          configurationTemplate: guide.configurationTemplate,
          configurationModules: [...guide.modules],
        }
      }
      if (args.action === 'inspect') {
        const setup = service.inspect(agent)
        const guide = service.configurationGuide()
        return {
          action: 'inspect' as const,
          setup: outputSetup(setup),
          workspaceEntries: service.workspaceEntries(agent),
          requiredFields: ['core.name', 'modules.dsh-agent-fleet/message.defaultChannel.id', 'modules.dsh-agent-fleet/message.defaultChannel.name'],
          configurationTemplate: guide.configurationTemplate,
          configurationModules: [...guide.modules],
        }
      }
      if (args.action === 'stage') {
        if (args.configuration === undefined) throw new Error('fleet_setup stage requires configuration')
        let configuration: unknown
        try {
          configuration = JSON.parse(args.configuration) as unknown
        } catch (error) {
          throw new Error(`fleet_setup configuration is not valid JSON: ${errorMessage(error)}`)
        }
        const setup = service.stage(agent, { configuration })
        return { action: 'stage' as const, setup: outputSetup(setup) }
      }
      const created = await service.create(agent)
      return {
        action: 'create' as const,
        setup: outputSetup(created.setup),
        run: { id: created.run.id, name: created.run.name, status: created.run.status },
      }
    },
  }))
}
