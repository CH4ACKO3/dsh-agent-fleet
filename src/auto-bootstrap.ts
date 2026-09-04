import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

import type { FleetAssistantRuntime } from './assistant.js'
import type { FleetRunRecord, FleetRunService } from './run.js'

export interface FleetAutoBootstrapConfiguration {
  readonly id: string
  readonly projectRoot: string
  readonly teamConfigPath: string
  readonly taskPath: string
  readonly readyFile?: string
  readonly agentPreset: string
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
}

interface FleetAutoBootstrapContext extends Context {
  readonly agents: Context['agents']
}

interface FleetAutoBootstrapRuns {
  list(projectRoot?: string): FleetRunRecord[]
  create(launcher: Agent, input: {
    readonly configPath: string
    readonly projectRoot: string
    readonly requiredPaths: readonly string[]
    readonly sourceSetupId?: string
    readonly provider?: string
    readonly model?: string
    readonly maxTokens?: number
  }): Promise<FleetRunRecord>
  agentSessionStarted(agent: Agent): void
}

interface FleetAutoBootstrapAssistant {
  activate(agent: Agent, runId?: string, view?: FleetRunRecord['assistants'][number]['view']): unknown
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

function requiredAbsolutePath(value: string | undefined, name: string): string {
  const normalized = optionalText(value)
  if (normalized === undefined) throw new Error(`${name} is required when Fleet auto bootstrap is enabled`)
  if (!isAbsolute(normalized)) throw new Error(`${name} must be an absolute path`)
  return normalized
}

export function fleetAutoBootstrapConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): FleetAutoBootstrapConfiguration | undefined {
  const teamConfigPath = optionalText(env.FLEET_AUTO_TEAM_CONFIG)
  const taskPath = optionalText(env.FLEET_AUTO_BOOTSTRAP_TASK)
  const projectRoot = optionalText(env.FLEET_AUTO_WORKSPACE)
  if (teamConfigPath === undefined && taskPath === undefined && projectRoot === undefined) return undefined

  const maxTokensText = optionalText(env.FLEET_AUTO_MAX_TOKENS)
  const provider = optionalText(env.FLEET_AUTO_PROVIDER)
  const model = optionalText(env.FLEET_AUTO_MODEL)
  const readyFileValue = optionalText(env.FLEET_AUTO_READY_FILE)
  const maxTokens = maxTokensText === undefined ? undefined : Number(maxTokensText)
  if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens <= 0)) {
    throw new Error('FLEET_AUTO_MAX_TOKENS must be a positive integer')
  }
  return {
    id: optionalText(env.FLEET_AUTO_BOOTSTRAP_ID) ?? 'default',
    projectRoot: requiredAbsolutePath(projectRoot, 'FLEET_AUTO_WORKSPACE'),
    teamConfigPath: requiredAbsolutePath(teamConfigPath, 'FLEET_AUTO_TEAM_CONFIG'),
    taskPath: requiredAbsolutePath(taskPath, 'FLEET_AUTO_BOOTSTRAP_TASK'),
    agentPreset: optionalText(env.FLEET_AUTO_AGENT_PRESET) ?? 'standard',
    ...(readyFileValue === undefined
      ? {}
      : { readyFile: requiredAbsolutePath(readyFileValue, 'FLEET_AUTO_READY_FILE') }),
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }
}

function markerPath(configuration: FleetAutoBootstrapConfiguration): string {
  const dshHome = optionalText(process.env.DSH_HOME) ?? join(homedir(), '.dsh')
  return join(dshHome, 'dsh-agent-fleet', 'auto-bootstrap', `${configuration.id}.json`)
}

function assertInputs(configuration: FleetAutoBootstrapConfiguration): void {
  for (const [name, path] of [
    ['Team configuration', configuration.teamConfigPath],
    ['bootstrap task', configuration.taskPath],
  ] as const) {
    if (!existsSync(path)) throw new Error(`${name} does not exist: ${path}`)
  }
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

function writeMarker(configuration: FleetAutoBootstrapConfiguration, run: FleetRunRecord): void {
  const value = {
    id: configuration.id,
    runId: run.id,
    taskPath: configuration.taskPath,
    startedAt: new Date().toISOString(),
  }
  atomicJson(markerPath(configuration), value)
  if (configuration.readyFile !== undefined) {
    rmSync(`${configuration.readyFile}.error.json`, { force: true })
    atomicJson(configuration.readyFile, value)
  }
}

export function writeFleetAutoBootstrapFailure(
  error: unknown,
  configuration = fleetAutoBootstrapConfiguration(),
): void {
  if (configuration?.readyFile === undefined) return
  atomicJson(`${configuration.readyFile}.error.json`, {
    id: configuration.id,
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
  })
}

function bootstrapMessage(configuration: FleetAutoBootstrapConfiguration): string {
  return [
    '[Fleet automatic bootstrap]',
    `按 ${configuration.taskPath} 开始任务。`,
    '这是由宿主监督器注入的一次性启动指令。请读取该文件，以实际团队成员的职责设计初始 DAG，并调用一次 fleet_run start；不要把固定流程从模板反推到任务中。',
  ].join('\n\n')
}

/**
 * Create a fresh Team and deliver one bootstrap task when all three explicit
 * FLEET_AUTO_* paths are configured. Existing Teams and completed markers make
 * the operation idempotent, so a container restart cannot duplicate work.
 */
export async function activateFleetAutoBootstrap(
  ctx: FleetAutoBootstrapContext,
  runs: FleetAutoBootstrapRuns,
  assistant: FleetAutoBootstrapAssistant,
  configuration = fleetAutoBootstrapConfiguration(),
): Promise<{ readonly run?: FleetRunRecord; dispose(): Promise<void> }> {
  if (configuration === undefined) return { dispose: () => Promise.resolve() }
  assertInputs(configuration)
  const marker = markerPath(configuration)
  const existing = runs.list(configuration.projectRoot)
    .find(run => run.sourceSetupId === `auto-bootstrap:${configuration.id}`)
  if (existsSync(marker)) {
    if (existing === undefined) {
      throw new Error(`Fleet auto bootstrap marker ${marker} refers to a missing Team`)
    }
    if (configuration.readyFile !== undefined && !existsSync(configuration.readyFile)) {
      atomicJson(configuration.readyFile, JSON.parse(readFileSync(marker, 'utf8')) as unknown)
    }
    return { run: existing, dispose: () => Promise.resolve() }
  }
  if (existing !== undefined) {
    const attached = existing.assistants[0]
    const agent = attached === undefined ? undefined : ctx.agents.get(SessionId(attached.sessionId))
    if (attached === undefined || agent === undefined) {
      throw new Error(`Fleet auto bootstrap Team ${existing.id} exists but its assistant is not available`)
    }
    assistant.activate(agent, existing.id, attached.view)
    runs.agentSessionStarted(agent)
    agent.followup(createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'instructions' },
      content: [{ type: 'text', text: bootstrapMessage(configuration) }],
    }))
    writeMarker(configuration, existing)
    return { run: existing, dispose: () => Promise.resolve() }
  }

  let handle: AgentHandle | undefined
  try {
    const agentOptions: AgentOptions = {
      ...(configuration.provider === undefined ? {} : { provider: configuration.provider }),
      ...(configuration.model === undefined ? {} : { model: configuration.model }),
      ...(configuration.maxTokens === undefined ? {} : { maxTokens: configuration.maxTokens }),
    }
    handle = await ctx.agents.create({
      sessionId: SessionId(randomUUID()),
      meta: { cwd: configuration.projectRoot, agentPreset: configuration.agentPreset },
      agentOptions,
      async setup(agentCtx) {
        const presets = agentCtx.get('agentPresets', false)
        if (presets === undefined) return
        if (agentCtx.agent === undefined) throw new Error('Fleet auto bootstrap requires ctx.agent')
        await presets.mount(agentCtx, resolveSessionPreset(agentCtx.agent.session))
      },
    })
    const run = await runs.create(handle.agent, {
      configPath: configuration.teamConfigPath,
      projectRoot: configuration.projectRoot,
      requiredPaths: [configuration.taskPath],
      sourceSetupId: `auto-bootstrap:${configuration.id}`,
      ...(configuration.provider === undefined ? {} : { provider: configuration.provider }),
      ...(configuration.model === undefined ? {} : { model: configuration.model }),
      ...(configuration.maxTokens === undefined ? {} : { maxTokens: configuration.maxTokens }),
    })
    if (run.status === 'failed' || run.status === 'closed') {
      throw new Error(run.error ?? run.summary ?? `Fleet auto bootstrap created a ${run.status} Team`)
    }
    const view = run.assistants.find(candidate => candidate.sessionId === String(handle?.agent.id))?.view
    assistant.activate(handle.agent, run.id, view)
    runs.agentSessionStarted(handle.agent)
    handle.agent.followup(createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'instructions' },
      content: [{ type: 'text', text: bootstrapMessage(configuration) }],
    }))
    writeMarker(configuration, run)
    const owned = handle
    return { run, dispose: () => owned.dispose() }
  } catch (error) {
    await handle?.dispose()
    throw error
  }
}

export function readFleetAutoBootstrapMarker(configuration: FleetAutoBootstrapConfiguration): unknown {
  const path = markerPath(configuration)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as unknown : undefined
}

export type FleetAutoBootstrapRunService = Pick<FleetRunService, 'list' | 'create' | 'agentSessionStarted'>
export type FleetAutoBootstrapAssistantRuntime = Pick<FleetAssistantRuntime, 'activate'>
