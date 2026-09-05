import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
  readonly controlDirectory?: string
  readonly generation?: string
}

interface FleetGenerationManifest {
  readonly role?: string
}

interface FleetAutoBootstrapMarker {
  readonly id: string
  readonly runId: string
  readonly taskPath: string
  readonly startedAt: string
  readonly eventSequence?: number
  readonly waitingForCandidate?: string
}

interface FleetGenerationEvent {
  readonly sequence: number
  readonly generation: string
  readonly type: string
  readonly createdAt: string
  readonly data?: Record<string, unknown>
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
    readonly continuous?: boolean
    readonly provider?: string
    readonly model?: string
    readonly maxTokens?: number
  }): Promise<FleetRunRecord>
  agentSessionStarted(agent: Agent): void
  setGenerationEventWait?(runId: string, waitingForCandidate?: string): void
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
  const controlDirectory = optionalText(env.SELF_EVOLVE_CONTROL_DIR)
  const generation = optionalText(env.SELF_EVOLVE_GENERATION)
  if ((controlDirectory === undefined) !== (generation === undefined)) {
    throw new Error('SELF_EVOLVE_CONTROL_DIR and SELF_EVOLVE_GENERATION must be configured together')
  }
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
    ...(controlDirectory === undefined ? {} : {
      controlDirectory: requiredAbsolutePath(controlDirectory, 'SELF_EVOLVE_CONTROL_DIR'),
      generation: generation as string,
    }),
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

function readMarker(configuration: FleetAutoBootstrapConfiguration): FleetAutoBootstrapMarker | undefined {
  const path = markerPath(configuration)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as FleetAutoBootstrapMarker : undefined
}

function writeMarker(
  configuration: FleetAutoBootstrapConfiguration,
  run: FleetRunRecord,
  eventSequence = readMarker(configuration)?.eventSequence,
  waitingForCandidate?: string | null,
): void {
  const previous = readMarker(configuration)
  const candidateWait = waitingForCandidate === undefined
    ? previous?.waitingForCandidate
    : waitingForCandidate ?? undefined
  const value: FleetAutoBootstrapMarker = {
    id: configuration.id,
    runId: run.id,
    taskPath: configuration.taskPath,
    startedAt: previous?.startedAt ?? new Date().toISOString(),
    ...(eventSequence === undefined ? {} : { eventSequence }),
    ...(candidateWait === undefined ? {} : { waitingForCandidate: candidateWait }),
  }
  atomicJson(markerPath(configuration), value)
  if (configuration.readyFile !== undefined) {
    rmSync(`${configuration.readyFile}.error.json`, { force: true })
    atomicJson(configuration.readyFile, value)
  }
}

function generationEventDirectory(configuration: FleetAutoBootstrapConfiguration): string | undefined {
  if (configuration.controlDirectory === undefined || configuration.generation === undefined) return undefined
  return join(configuration.controlDirectory, 'events', configuration.generation)
}

function generationEventsAfter(
  configuration: FleetAutoBootstrapConfiguration,
  after: number,
): FleetGenerationEvent[] {
  const directory = generationEventDirectory(configuration)
  if (directory === undefined || !existsSync(directory)) return []
  return readdirSync(directory)
    .filter(name => /^\d+-.*\.json$/.test(name))
    .sort()
    .map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')) as FleetGenerationEvent)
    .filter(event => event.generation === configuration.generation && event.sequence > after)
}

export function fleetGenerationEventInstruction(event: FleetGenerationEvent): string | undefined {
  const data = event.data ?? {}
  const detail = JSON.stringify(Object.fromEntries(Object.entries(data).map(([key, value]) => {
    if ((key === 'evidence' || key === 'handoff') && value !== null && typeof value === 'object') {
      const file = value as Record<string, unknown>
      return [key, { name: file.name, path: file.path }]
    }
    return [key, value]
  }))).slice(0, 2_000)
  const actions: Record<string, string> = {
    'candidate.ready': '候选代已经声明 ready。立即建立两个有依赖的单 owner 持久 Goal：先由一名独立审查者从宿主数据给出的 gitBranch/sourceCommit 读取候选提交与 evidence，核对测试、记忆继承、协作链和交接能力；再建立平台工程师单 owner 的最终决定 Goal，依赖该审查，负责根据审查终态写交接并实际执行 promote 或 destroy-candidate。两个节点必须在同一次建图时创建，不要等审查结束后再依赖助理被唤醒补建。回复或开工确认不算审查完成。',
    'candidate.failed': '候选代启动失败。立即读取失败证据，清理失败候选，并在修复基座原因后从同一稳定提交重试。',
    'candidate.destroyed': '候选代已销毁。若全局迭代目标仍存在，立即修复已记录原因并启动替代候选。',
    'candidate.self_rejected': '候选代已自我拒绝。立即审查拒绝原因，修复后启动替代候选。',
    'generation.promoted': '你已晋升为新的稳定代。先确认 guardian、继承材料与当前 Git 状态，再进入正常稳定代工作流：从 backlog 形成一批通常包含 2–4 个边界清楚的实际改进，每项保持单 owner 实现和作者之外的独立审查；任务可以相关或无关，也可以并行或按依赖推进。只有整批改进、各项审查和一次组合集成检查均完成、工作区干净后，才启动下一候选；不要因第一项完成就交接，也不要用纯自检或交接文档空转出下一代。高风险隔离、紧急基座修复或资源不足时可单项成代，但要记录原因。成功启动并验收下一代之前不要把交接链视为完成。',
    'generation.recovered': '保障代已因稳定代故障恢复。立即检查失败代与被丢弃候选，修复根因后重新建立候选链。',
    'generation.peer_exited': '关联代容器异常退出。立即读取退出证据，恢复代际窗口并记录根因。',
    'guardian.exited': '保障代异常退出。立即记录保护窗口降级，并在继续晋升前恢复可靠的保障路径。',
    'guardian.retirement_failed': '旧保障代清理失败。立即检查归档与容器/卷清理，不要让遗留资源持续累积。',
    'request.rejected': '一个代际控制请求被宿主拒绝。读取拒绝原因并纠正请求；不要盲目重复同一命令。',
  }
  const generationStarted = event.type === 'generation.started' ? generationRoleInstruction(data.role) : undefined
  const action = generationStarted ?? actions[event.type]
  if (action === undefined) return undefined
  return [
    '[Fleet generation lifecycle event]',
    `事件 ${event.sequence}: ${event.type}`,
    action,
    `宿主数据：${detail}`,
    '这是状态机事件，不是频道消息；无需报告“已读”，直接完成所需生命周期动作。',
  ].join('\n\n')
}

function generationRoleInstruction(role: unknown): string | undefined {
  if (role === 'candidate') {
    return '你是候选代，不是稳定代。只验证父代冻结提交与交付：确认身份和源码提交，运行构建、相关测试、团队启动、协作链与跨代记忆自检；用少量单 owner Goal 分配验证和独立复核。复核者应优先复用前置 Goal 产出的可检查证据，只有在证据缺失或相互矛盾时才重跑已验证的全量测试；不要把属于下游平台就绪节点的 readiness、handoff 或 backlog 收尾当作当前复核的缺失。不得选择新的改进主题、修改产品代码或 backlog 业务项、启动下一候选，也不要让全体成员重新读源码讨论方向。初始 DAG 的最后一个节点必须是平台工程师单 owner Goal，依赖独立复核，负责写入 readiness 证据、确认工作区干净并实际执行 ready 或 reject；不能只用 Vote 表态后结束工作。提交后等待父代决定。'
  }
  if (role === 'stable') {
    return '你是活跃稳定代。先确认身份、Git 状态和继承材料，再从 backlog 形成一批通常包含 2–4 个边界清楚的实际改进；每项都要有单 owner、可检查提交和作者之外的独立审查，相关或无关均可。整批完成并通过一次组合集成检查前不要启动候选；高风险隔离、紧急基座修复或资源不足时可单项成代，但必须记录原因。'
  }
  return undefined
}

export async function deliverPendingFleetGenerationEvents(
  agent: Agent,
  run: FleetRunRecord,
  configuration: FleetAutoBootstrapConfiguration,
  runs?: FleetAutoBootstrapRuns,
): Promise<number> {
  if (generationEventDirectory(configuration) === undefined) return 0
  const sequence = readMarker(configuration)?.eventSequence ?? 0
  const events = generationEventsAfter(configuration, sequence)
  if (events.length === 0) return 0
  let waitingForCandidate = readMarker(configuration)?.waitingForCandidate
  for (const event of events) {
    if (event.type === 'candidate.started') {
      const candidate = event.data?.candidate
      waitingForCandidate = typeof candidate === 'string' && candidate.trim().length > 0
        ? candidate
        : 'candidate'
    } else if (event.type === 'candidate.ready'
      || event.type === 'candidate.failed'
      || event.type === 'candidate.destroyed'
      || event.type === 'candidate.self_rejected'
      || event.type === 'generation.peer_exited') {
      waitingForCandidate = undefined
    }
  }
  runs?.setGenerationEventWait?.(run.id, waitingForCandidate)
  const instructions = events
    .map(fleetGenerationEventInstruction)
    .filter((instruction): instruction is string => instruction !== undefined)
  if (instructions.length > 0) {
    await agent.followup(createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-agent-fleet', form: 'instructions' },
      content: [{ type: 'text', text: instructions.join('\n\n---\n\n') }],
    }))
  }
  writeMarker(configuration, run, events.at(-1)?.sequence ?? sequence, waitingForCandidate ?? null)
  return instructions.length
}

function startGenerationEventRelay(
  agent: Agent,
  run: FleetRunRecord,
  configuration: FleetAutoBootstrapConfiguration,
  runs: FleetAutoBootstrapRuns,
): { dispose(): Promise<void> } {
  if (generationEventDirectory(configuration) === undefined) return { dispose: () => Promise.resolve() }
  let active = false
  const drain = async (): Promise<void> => {
    if (active) return
    active = true
    try {
      await deliverPendingFleetGenerationEvents(agent, run, configuration, runs)
    } catch (error) {
      process.stderr.write(`Fleet generation event relay failed: ${error instanceof Error ? error.message : String(error)}\n`)
    } finally {
      active = false
    }
  }
  const interval = setInterval(() => { void drain() }, 1_000)
  interval.unref()
  void drain()
  return {
    dispose: () => {
      clearInterval(interval)
      return Promise.resolve()
    },
  }
}

function startDeferredGenerationEventRelay(
  ctx: FleetAutoBootstrapContext,
  run: FleetRunRecord,
  configuration: FleetAutoBootstrapConfiguration,
  runs: FleetAutoBootstrapRuns,
): { dispose(): Promise<void> } {
  const attached = run.assistants[0]
  if (attached === undefined || generationEventDirectory(configuration) === undefined) {
    return { dispose: () => Promise.resolve() }
  }
  let relay: { dispose(): Promise<void> } | undefined
  let interval: NodeJS.Timeout | undefined
  const attach = (): void => {
    if (relay !== undefined) return
    const agent = ctx.agents.get(SessionId(attached.sessionId))
    if (agent !== undefined) {
      relay = startGenerationEventRelay(agent, run, configuration, runs)
      if (interval !== undefined) clearInterval(interval)
    }
  }
  attach()
  if (relay === undefined) {
    interval = setInterval(attach, 1_000)
    interval.unref()
  }
  return {
    dispose: async () => {
      if (interval !== undefined) clearInterval(interval)
      await relay?.dispose()
    },
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
  const manifestPath = join(configuration.projectRoot, '.self-evolve', 'generation.json')
  const manifest = configuration.generation !== undefined && existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')) as FleetGenerationManifest
    : undefined
  const roleInstruction = generationRoleInstruction(manifest?.role)
  return [
    '[Fleet automatic bootstrap]',
    `按 ${configuration.taskPath} 开始任务。`,
    ...(roleInstruction === undefined ? [] : ['[Fleet generation role]', roleInstruction]),
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
    runs.setGenerationEventWait?.(existing.id, readMarker(configuration)?.waitingForCandidate)
    const relay = startDeferredGenerationEventRelay(ctx, existing, configuration, runs)
    return { run: existing, dispose: () => relay.dispose() }
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
    const relay = startGenerationEventRelay(agent, existing, configuration, runs)
    return { run: existing, dispose: () => relay.dispose() }
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
      ...(configuration.generation === undefined ? {} : { continuous: true }),
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
    const relay = startGenerationEventRelay(handle.agent, run, configuration, runs)
    const owned = handle
    return {
      run,
      dispose: async () => {
        await relay.dispose()
        await owned.dispose()
      },
    }
  } catch (error) {
    await handle?.dispose()
    throw error
  }
}

export function readFleetAutoBootstrapMarker(configuration: FleetAutoBootstrapConfiguration): unknown {
  return readMarker(configuration)
}

export type FleetAutoBootstrapRunService = Pick<FleetRunService,
  'list' | 'create' | 'agentSessionStarted' | 'setGenerationEventWait'>
export type FleetAutoBootstrapAssistantRuntime = Pick<FleetAssistantRuntime, 'activate'>
