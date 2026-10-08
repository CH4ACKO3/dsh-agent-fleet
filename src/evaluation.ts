import { createHash, randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'

import { activateFleetAutoBootstrap } from './auto-bootstrap.js'
import { bindEvaluationBudget } from './evaluation-budget.js'
import type { FleetAssistantRuntime } from './assistant.js'
import type { FleetRunRecord, FleetRunService, FleetWorkStatus } from './run.js'

export const FLEET_EVALUATION_SCHEMA_VERSION = 1

export type FleetEvaluationPhase =
  | 'initializing'
  | 'bootstrap_delivered'
  | 'work_started'
  | 'work_finished'
  | 'work_blocked'
  | 'work_failed'
  | 'bootstrap_incomplete'
  | 'timed_out'
  | 'configuration_failed'
  | 'runtime_failed'
  | 'artifacts_flushed'

export interface FleetEvaluationConfiguration {
  readonly id: string
  readonly projectRoot: string
  readonly teamConfigPath: string
  readonly taskPath: string
  readonly taskText?: string
  readonly outputDirectory: string
  readonly timeoutMs: number
  readonly agentPreset: string
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
}

export interface FleetEvaluationOutcome {
  readonly phase: Extract<
    FleetEvaluationPhase,
    'work_finished' | 'work_blocked' | 'work_failed' | 'bootstrap_incomplete' | 'timed_out'
  >
  readonly exitCode: 0 | 2 | 3 | 4 | 124
  readonly run: FleetRunRecord
  readonly answer: string
}

interface FleetEvaluationStatus {
  readonly schemaVersion: number
  readonly evaluationId: string
  readonly phase: FleetEvaluationPhase
  readonly exitCode?: number
  readonly startedAt: string
  readonly updatedAt: string
  readonly finishedAt?: string
  readonly durationMs: number
  readonly projectRoot: string
  readonly teamConfigPath: string
  readonly taskPath: string
  readonly outputDirectory: string
  readonly timeoutMs: number
  readonly teamId?: string
  readonly workId?: string
  readonly rootTaskId?: string
  readonly teamStatus?: FleetRunRecord['status']
  readonly workStatus?: FleetWorkStatus
  readonly summary?: string
  readonly error?: string
  readonly outcome?: FleetEvaluationOutcome['phase']
}

type FleetEvaluationRuns = Pick<
  FleetRunService,
  'status' | 'subscribeChanges' | 'pauseTeam' | 'teamBudget' | 'resourceSnapshot' | 'readTrace'
>

interface FleetEvaluationContext extends Context {
  readonly agents: Context['agents']
  readonly sessions: Context['sessions']
  readonly fleetRuns: FleetRunService
  readonly fleetAssistant: FleetAssistantRuntime
  readonly headlessStartup: { readonly task: string }
  readonly appExit: (code: number) => void
}

const EVALUATION_BOOTSTRAP_INSTRUCTION = [
  '这是一次无人值守评测，不会有用户在中途回答问题。',
  '整个评测期间，助理与成员都不得主动暂停 Team 或成员，也不要用 pause/resume 触发任务唤醒。检查任务依赖及成员状态；人工维护和超时中断由宿主负责。',
  '你本回合的职责是为已经创建的 Team 启动工作；题面中的角色要求（例如“你是研究数学家”）属于执行成员的任务要求，不改变你的启动助手职责。',
  '读取权威任务文件并确认必要的成员信息后，设计初始 DAG 的负责人、依赖和验收条件，在同一次 fleet_run start 中提交完整非空 stages，task 参数直接使用权威任务文件路径。运行时不会补写任务图。',
  '把求解、推导、实现和命令验证交给现有 Team 成员；启动前不要亲自解题、预先生成答案、重写题面或调用普通 subagent。初始 DAG 应完整但不过度细分，无需先知道答案才能分工。',
  '启动阶段只提供 read 和 fleet_run：read 仅用于权威题面文件。训练反馈、源码阅读、记忆检索与写入都交给执行成员，不在启动回合完成。用简短的阶段描述启动工作，不生成实现补丁或复制长文本。',
  'fleet_run start 成功后立即结束本启动回合；若调用失败，只修正启动参数或报告实际启动错误。重试时保留完整 stages、directive 和 result_stage，不要把带图启动简化成只有 action、run_id、task 的调用。',
  '不要轮询、等待或向用户发送中途进展；宿主会保持进程存活并等待 Team 终态。',
  'Fleet 私聊、频道、回复、会议和共享文件是本地团队协作能力，不属于外部联网。',
  '在 DAG 中要求执行成员把最终结论及独立验证证据写入 result Task；无法完成时明确记录可验证的阻塞原因。',
].join(' ')

/** Only the evaluation launcher is restricted; formal members keep their tools. */
export async function restrictFleetEvaluationBootstrap(
  agent: Agent,
  runs: Pick<FleetEvaluationRuns, 'status'>,
  run: FleetRunRecord,
  taskPath: string,
): Promise<() => void> {
  if (runs.status(run.id, run.projectRoot).work !== undefined) return () => {}
  let release: (() => void) | undefined
  await agent.ctx.inject(['tools'], scope => {
    const removeRestriction = scope.tools.restrict({ allow: ['read', 'fleet_run'] })
    let removeGuard: (() => void) | undefined
    try {
      removeGuard = scope.tools.guard(execution => {
        const current = runs.status(run.id, run.projectRoot)
        if (current.work !== undefined) return 'Fleet evaluation bootstrap is complete. End this turn; the host supervises the existing Work.'
        const args = execution.arguments as Record<string, unknown> | undefined
        if (execution.name === 'read' && typeof args?.file_path === 'string'
          && isAbsolute(args.file_path) && resolve(args.file_path) === resolve(taskPath)) return undefined
        if (execution.name === 'fleet_run' && args !== undefined && args !== null
          && (args.run_id === undefined || args.run_id === run.id)
          && (args.action === 'status' || (args.action === 'start'
            && typeof args.task === 'string' && isAbsolute(args.task)
            && resolve(args.task) === resolve(taskPath)))) {
          // Match fleet_run's actual default-Team lookup. Omitting run_id is
          // supported by the tool; it is safe only when that lookup resolves
          // unambiguously to this evaluation's Team in its bound workspace.
          const callerRoot = agent.session.header.cwd
          const selectionRoot = args.action === 'status' ? callerRoot : args.cwd ?? callerRoot
          if (typeof selectionRoot === 'string' && isAbsolute(selectionRoot)
            && resolve(selectionRoot) === resolve(run.projectRoot)
            && (args.cwd === undefined || (typeof args.cwd === 'string'
              && isAbsolute(args.cwd) && resolve(args.cwd) === resolve(run.projectRoot)))) {
            try {
              if (runs.status(args.run_id as string | undefined, selectionRoot).id === run.id) {
                if (args.action === 'start' && (!Array.isArray(args.stages) || args.stages.length === 0)) {
                  return 'Fleet evaluation start requires your complete non-empty stages DAG. Include it with task in the same fleet_run start call; preserve the stages, directive and result_stage when correcting parameters. The runtime does not supply a plan.'
                }
                return undefined
              }
            } catch { /* Ambiguous or unavailable default Teams must remain blocked. */ }
          }
        }
        return `Fleet evaluation bootstrap may only read ${taskPath} and call fleet_run status/start for ${run.id}. Use run_id="${run.id}" and task="${taskPath}" for start; omit cwd or use "${run.projectRoot}". Delegate feedback, memory, source edits and verification to formal members in the initial stages; do not substitute another tool.`
      })
    } catch (error) { removeRestriction(); throw error }
    let active = true
    release = () => {
      if (!active) return
      active = false
      removeGuard?.()
      removeRestriction()
    }
    return release
  })
  if (release === undefined) throw new Error('Fleet evaluation bootstrap tool boundary was not installed')
  return release
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

function positiveInteger(value: string | undefined, name: string, fallback?: number): number | undefined {
  const text = optionalText(value)
  if (text === undefined) return fallback
  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function absolutePath(value: string, name: string): string {
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`)
  return value
}

export function fleetEvaluationConfiguration(
  task: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  createId: () => string = randomUUID,
): FleetEvaluationConfiguration {
  const id = optionalText(env.FLEET_EVAL_RUN_ID) ?? createId()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new Error('FLEET_EVAL_RUN_ID must contain only letters, digits, dots, underscores, and hyphens')
  }
  const projectRoot = absolutePath(optionalText(env.FLEET_EVAL_WORKSPACE) ?? cwd, 'FLEET_EVAL_WORKSPACE')
  const teamConfig = optionalText(env.FLEET_EVAL_TEAM_CONFIG)
  if (teamConfig === undefined) throw new Error('FLEET_EVAL_TEAM_CONFIG is required')
  const outputDirectory = absolutePath(
    optionalText(env.FLEET_EVAL_OUTPUT) ?? join(projectRoot, '.fleet-evaluation', id),
    'FLEET_EVAL_OUTPUT',
  )
  const configuredTaskPath = optionalText(env.FLEET_EVAL_TASK_FILE)
  const taskPath = configuredTaskPath === undefined
    ? join(outputDirectory, 'task.md')
    : absolutePath(configuredTaskPath, 'FLEET_EVAL_TASK_FILE')
  const taskText = task.trim()
  if (configuredTaskPath === undefined && taskText.length === 0) {
    throw new Error('the headless task must not be empty when FLEET_EVAL_TASK_FILE is omitted')
  }
  const maxTokens = positiveInteger(env.FLEET_EVAL_MAX_TOKENS, 'FLEET_EVAL_MAX_TOKENS')
  const provider = optionalText(env.FLEET_EVAL_PROVIDER)
  const model = optionalText(env.FLEET_EVAL_MODEL)
  return {
    id,
    projectRoot,
    teamConfigPath: absolutePath(teamConfig, 'FLEET_EVAL_TEAM_CONFIG'),
    taskPath,
    ...(configuredTaskPath === undefined ? { taskText } : {}),
    outputDirectory,
    timeoutMs: positiveInteger(env.FLEET_EVAL_TIMEOUT_MS, 'FLEET_EVAL_TIMEOUT_MS', 3_600_000) as number,
    agentPreset: optionalText(env.FLEET_EVAL_AGENT_PRESET) ?? 'standard',
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }
}

function atomicText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, text, 'utf8')
  renameSync(temporary, path)
}

function atomicJson(path: string, value: unknown): void {
  atomicText(path, `${JSON.stringify(value, null, 2)}\n`)
}

function statusValue(
  configuration: FleetEvaluationConfiguration,
  startedAt: string,
  phase: FleetEvaluationPhase,
  input: {
    readonly run?: FleetRunRecord
    readonly exitCode?: number
    readonly error?: string
    readonly outcome?: FleetEvaluationOutcome['phase']
    readonly finished?: boolean
  } = {},
): FleetEvaluationStatus {
  const now = new Date().toISOString()
  const work = input.run?.work
  return {
    schemaVersion: FLEET_EVALUATION_SCHEMA_VERSION,
    evaluationId: configuration.id,
    phase,
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    startedAt,
    updatedAt: now,
    ...(input.finished === true ? { finishedAt: now } : {}),
    durationMs: Math.max(0, Date.parse(now) - Date.parse(startedAt)),
    projectRoot: configuration.projectRoot,
    teamConfigPath: configuration.teamConfigPath,
    taskPath: configuration.taskPath,
    outputDirectory: configuration.outputDirectory,
    timeoutMs: configuration.timeoutMs,
    ...(input.run === undefined ? {} : {
      teamId: input.run.id,
      teamStatus: input.run.status,
      ...(work === undefined ? {} : {
        workId: work.id,
        ...(work.rootTaskId === undefined ? {} : { rootTaskId: work.rootTaskId }),
        workStatus: work.status,
        ...(work.summary === undefined ? {} : { summary: work.summary }),
      }),
    }),
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
  }
}

function writeStatus(
  configuration: FleetEvaluationConfiguration,
  startedAt: string,
  phase: FleetEvaluationPhase,
  input?: Parameters<typeof statusValue>[3],
): void {
  atomicJson(join(configuration.outputDirectory, 'status.json'), statusValue(configuration, startedAt, phase, input))
}

function terminalOutcome(run: FleetRunRecord): FleetEvaluationOutcome {
  const work = run.work
  if (run.status === 'failed') {
    return { phase: 'work_failed', exitCode: 3, run, answer: run.error ?? run.summary ?? 'Fleet Team failed.' }
  }
  if (work === undefined) {
    return {
      phase: 'bootstrap_incomplete',
      exitCode: 4,
      run,
      answer: 'The Fleet assistant ended its bootstrap turn without starting Team work.',
    }
  }
  if (work.status === 'running') {
    return { phase: 'timed_out', exitCode: 124, run, answer: 'Fleet evaluation timed out while Team work was running.' }
  }
  if (work.status === 'finished') {
    return { phase: 'work_finished', exitCode: 0, run, answer: work.summary ?? '' }
  }
  if (work.status === 'blocked') {
    return { phase: 'work_blocked', exitCode: 2, run, answer: work.summary ?? 'Fleet Team work was blocked.' }
  }
  return { phase: 'work_failed', exitCode: 3, run, answer: work.summary ?? `Fleet Team work ${work.status}.` }
}

export async function superviseFleetEvaluationRun(input: {
  readonly runs: Pick<FleetEvaluationRuns, 'status' | 'subscribeChanges'>
  readonly run: FleetRunRecord
  readonly assistantAgent: Pick<Agent, 'whenIdle'>
  readonly projectRoot: string
  readonly timeoutMs: number
  /** The host timestamp before delivering this evaluation's bootstrap input. */
  readonly bootstrapStartedAt?: number
  readonly recoverBootstrap?: (input: { readonly notBefore: number; readonly signal: AbortSignal }) => boolean | Promise<boolean>
  readonly onWorkStarted?: (run: FleetRunRecord) => void | Promise<void>
}): Promise<FleetEvaluationOutcome> {
  const startedAt = Date.now()
  const expiresAt = startedAt + input.timeoutMs
  const expired = new Error('Fleet evaluation deadline expired')
  const stopWaiting = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(expired) }, input.timeoutMs)
  })
  let current = input.run
  try {
    await Promise.race([input.assistantAgent.whenIdle(), deadline])
    current = input.runs.status(input.run.id, input.projectRoot)
    while (current.work === undefined && (current.status === 'idle' || current.status === 'running')
      && Date.now() < expiresAt && input.recoverBootstrap !== undefined) {
      const recovered = await Promise.race([
        input.recoverBootstrap({ notBefore: input.bootstrapStartedAt ?? startedAt, signal: stopWaiting.signal }),
        deadline,
      ])
      if (!recovered) break
      await Promise.race([input.assistantAgent.whenIdle(), deadline])
      current = input.runs.status(input.run.id, input.projectRoot)
    }
    if (current.work?.status === 'running') {
      await Promise.race([input.onWorkStarted?.(current), deadline])
      current = await Promise.race([
        waitForFleetEvaluationWork(input.runs, current, input.projectRoot,
          Math.max(0, expiresAt - Date.now()), stopWaiting.signal),
        deadline,
      ])
    }
    if (Date.now() >= expiresAt) throw expired
    return terminalOutcome(current)
  } catch (error) {
    if (error !== expired) throw error
    // A bootstrap that never becomes idle is still a timeout, even without Work.
    // Keep the last known Team if preservation cannot read the current state.
    try { current = input.runs.status(input.run.id, input.projectRoot) } catch {}
    return {
      phase: 'timed_out', exitCode: 124, run: current,
      answer: 'Fleet evaluation timed out during bootstrap or Team work.',
    }
  } finally {
    clearTimeout(timer)
    stopWaiting.abort()
  }
}

export function waitForFleetEvaluationWork(
  runs: Pick<FleetEvaluationRuns, 'status' | 'subscribeChanges'>,
  run: FleetRunRecord,
  projectRoot: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<FleetRunRecord> {
  if (run.work?.status !== 'running' || run.status === 'failed' || signal?.aborted) return Promise.resolve(run)
  return new Promise((resolvePromise, reject) => {
    type Result = { readonly run: FleetRunRecord } | { readonly error: unknown }
    let result: Result | undefined
    let subscribing = true
    let latest = run
    let unsubscribe: (() => void) | undefined
    const complete = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      try { unsubscribe?.() } catch (error) { reject(error); return }
      if (result !== undefined && 'error' in result) reject(result.error)
      else if (result !== undefined) resolvePromise(result.run)
    }
    const finish = (value: Result): void => {
      if (result !== undefined) return
      result = value
      // A subscription may invoke inspect before returning its disposer.
      if (!subscribing) complete()
    }
    const inspect = (): void => {
      if (result !== undefined) return
      try {
        latest = runs.status(run.id, projectRoot)
        if (latest.work?.status !== 'running' || latest.status === 'failed') finish({ run: latest })
      } catch (error) { finish({ error }) }
    }
    const abort = (): void => { finish({ run: latest }) }
    const timer = setTimeout(abort, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    try { unsubscribe = runs.subscribeChanges(inspect) }
    catch (error) { result = { error } }
    subscribing = false
    if (result !== undefined) complete()
    else inspect()
  })
}

function sha256(path: string): string | undefined {
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > 100 * 1024 * 1024) return undefined
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return undefined
  }
}

export function writeFleetEvaluationOutputs(
  runs: FleetEvaluationRuns,
  outcome: FleetEvaluationOutcome,
  configuration: FleetEvaluationConfiguration,
): void {
  atomicText(join(configuration.outputDirectory, 'answer.txt'), `${outcome.answer.trim()}\n`)
  atomicJson(join(configuration.outputDirectory, 'usage.json'), runs.teamBudget(outcome.run.id))
  const resources = runs.resourceSnapshot(outcome.run.id).map(resource => ({
    ...resource,
    ...(existsSync(resource.path) ? { sha256: sha256(resource.path) } : { missing: true }),
  }))
  atomicJson(join(configuration.outputDirectory, 'artifacts.json'), {
    schemaVersion: FLEET_EVALUATION_SCHEMA_VERSION,
    teamId: outcome.run.id,
    resources,
  })
  const events: ReturnType<FleetRunService['readTrace']>['events'] = []
  let afterSequence = 0
  for (;;) {
    const page = runs.readTrace(outcome.run.id, afterSequence, 1_000, configuration.projectRoot)
    events.push(...page.events)
    const last = page.events.at(-1)
    if (!page.hasMore || last === undefined) break
    afterSequence = last.sequence
  }
  atomicText(
    join(configuration.outputDirectory, 'events.jsonl'),
    events.length === 0 ? '' : `${events.map(event => JSON.stringify(event)).join('\n')}\n`,
  )
}

export function exportFleetEvaluationState(
  run: FleetRunRecord,
  outputDirectory: string,
  dshHome = process.env.DSH_HOME,
): void {
  if (dshHome === undefined || dshHome.trim().length === 0) return
  const sessions = join(dshHome, 'sessions')
  if (existsSync(sessions)) {
    cpSync(sessions, join(outputDirectory, 'dsh-sessions'), { recursive: true, force: true })
  }
  const teams = join(dshHome, 'dsh-agent-fleet', 'teams')
  const teamDirectory = join(teams, run.id)
  const teamIndex = join(teams, `${run.id}.json`)
  const exported = join(outputDirectory, 'fleet-state')
  if (existsSync(teamDirectory) || existsSync(teamIndex)) mkdirSync(exported, { recursive: true })
  if (existsSync(teamDirectory)) {
    cpSync(teamDirectory, join(exported, run.id), { recursive: true, force: true })
  }
  if (existsSync(teamIndex)) cpSync(teamIndex, join(exported, `${run.id}.json`), { force: true })
}

async function flushFleetSessions(ctx: FleetEvaluationContext, run: FleetRunRecord): Promise<void> {
  const sessionIds = new Set([
    ...run.members.map(member => member.sessionId),
    ...run.assistants.map(assistant => assistant.sessionId),
  ])
  for (const sessionId of sessionIds) {
    const agent = ctx.agents.get(SessionId(sessionId))
    if (agent !== undefined) await ctx.sessions.flush(agent.session)
  }
}

export async function executeFleetEvaluation(
  ctx: FleetEvaluationContext,
  configuration: FleetEvaluationConfiguration,
): Promise<FleetEvaluationOutcome> {
  mkdirSync(configuration.outputDirectory, { recursive: true })
  if (configuration.taskText !== undefined) atomicText(configuration.taskPath, `${configuration.taskText}\n`)
  const startedAt = new Date().toISOString()
  writeStatus(configuration, startedAt, 'initializing')
  const sourceTeam = readFileSync(configuration.teamConfigPath, 'utf8')
  const budget = bindEvaluationBudget(JSON.parse(sourceTeam), configuration.timeoutMs, startedAt)
  const effectiveTeamPath = join(configuration.outputDirectory, 'team.runtime.json')
  atomicJson(effectiveTeamPath, budget.team)
  atomicJson(join(configuration.outputDirectory, 'host-budget.json'), {
    schemaVersion: 1, startedAt, deadlineAt: budget.deadlineAt, timeoutMs: configuration.timeoutMs,
    sourceTeamConfigPath: configuration.teamConfigPath,
    sourceTeamSha256: createHash('sha256').update(sourceTeam).digest('hex'),
    effectiveTeamSha256: createHash('sha256').update(readFileSync(effectiveTeamPath)).digest('hex'),
  })
  let releaseBootstrap = (): void => {}
  let lifecycle: ReturnType<FleetRunService['protectEvaluationLifecycle']> | undefined
  const bootstrap = await activateFleetAutoBootstrap(ctx, ctx.fleetRuns, ctx.fleetAssistant, {
    id: `evaluation-${configuration.id}`,
    projectRoot: configuration.projectRoot,
    teamConfigPath: effectiveTeamPath,
    taskPath: configuration.taskPath,
    readyFile: join(configuration.outputDirectory, 'bootstrap.json'),
    agentPreset: configuration.agentPreset,
    bootstrapInstruction: `${EVALUATION_BOOTSTRAP_INSTRUCTION}\n\n${budget.instruction}`,
    ...(configuration.provider === undefined ? {} : { provider: configuration.provider }),
    ...(configuration.model === undefined ? {} : { model: configuration.model }),
    ...(configuration.maxTokens === undefined ? {} : { maxTokens: configuration.maxTokens }),
  }, async (agent, run) => {
    lifecycle = ctx.fleetRuns.protectEvaluationLifecycle(run.id)
    releaseBootstrap = await restrictFleetEvaluationBootstrap(agent, ctx.fleetRuns, run, configuration.taskPath)
  }).catch(error => { releaseBootstrap(); lifecycle?.release(); throw error })
  const run = bootstrap.run
  if (run === undefined) throw new Error('Fleet evaluation bootstrap did not create or restore a Team')
  writeStatus(configuration, startedAt, 'bootstrap_delivered', { run })
  try {
    const assistantSession = run.assistants[0]?.sessionId
    const assistantAgent = assistantSession === undefined ? undefined : ctx.agents.get(SessionId(assistantSession))
    if (assistantAgent === undefined) throw new Error('Fleet evaluation assistant is unavailable after bootstrap')
    let outcome = await superviseFleetEvaluationRun({
      runs: ctx.fleetRuns,
      run,
      assistantAgent,
      projectRoot: configuration.projectRoot,
      timeoutMs: Math.max(1, Date.parse(budget.deadlineAt) - Date.now()),
      bootstrapStartedAt: Date.parse(startedAt),
      recoverBootstrap: input => ctx.fleetRuns.retryEvaluationBootstrap(assistantAgent, run.id, input),
      onWorkStarted: startedRun => {
        releaseBootstrap()
        writeStatus(configuration, startedAt, 'work_started', { run: startedRun })
      },
    })
    if (outcome.phase === 'timed_out') {
      try {
        if (lifecycle === undefined) throw new Error('Fleet evaluation lifecycle was not installed')
        outcome = { ...outcome, run: await lifecycle.pause(assistantAgent) }
      } catch {
        // The timeout result remains authoritative even if best-effort preservation fails.
      }
    }
    await flushFleetSessions(ctx, outcome.run)
    writeFleetEvaluationOutputs(ctx.fleetRuns, outcome, configuration)
    exportFleetEvaluationState(outcome.run, configuration.outputDirectory)
    writeStatus(configuration, startedAt, 'artifacts_flushed', {
      run: outcome.run,
      exitCode: outcome.exitCode,
      ...(outcome.exitCode === 0 ? {} : { error: outcome.answer }),
      outcome: outcome.phase,
      finished: true,
    })
    return outcome
  } finally {
    releaseBootstrap()
    try { await bootstrap.dispose() } finally { lifecycle?.release() }
  }
}

async function runFleetEvaluationApplication(ctx: FleetEvaluationContext): Promise<void> {
  let configuration: FleetEvaluationConfiguration
  try {
    configuration = fleetEvaluationConfiguration(ctx.headlessStartup.task)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`dsh-fleet-eval: ${message}\n`)
    ctx.appExit(5)
    return
  }
  try {
    const outcome = await executeFleetEvaluation(ctx, configuration)
    process.stdout.write(`${outcome.answer.trim()}\n`)
    if (outcome.exitCode !== 0) process.stderr.write(`dsh-fleet-eval: ${outcome.phase}\n`)
    ctx.appExit(outcome.exitCode)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeStatus(configuration, new Date().toISOString(), 'runtime_failed', {
      exitCode: 3,
      error: message,
      finished: true,
    })
    process.stderr.write(`dsh-fleet-eval: ${message}\n`)
    ctx.appExit(3)
  }
}

export const name = 'fleet-evaluation-runner'
export const inject = ['appExit', 'headlessStartup', 'fleetRuns', 'fleetAssistant', 'agents', 'sessions']

export function apply(ctx: Context): void {
  void runFleetEvaluationApplication(ctx as FleetEvaluationContext)
}
