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
import { dirname, isAbsolute, join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'

import { activateFleetAutoBootstrap } from './auto-bootstrap.js'
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
  'status' | 'subscribeChanges' | 'pauseTeam' | 'teamBudget' | 'resourceStore' | 'readTrace'
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
  '读取权威任务文件后，根据实际题目和成员职责设计完整但不过度细分的初始 DAG，并立即调用一次 fleet_run start。',
  '不要轮询、等待或向用户发送中途进展；宿主会保持进程存活并等待 Team 终态。',
  'Fleet 私聊、频道、回复、会议和共享文件是本地团队协作能力，不属于外部联网。',
  '最终结论必须进入 result Task；无法完成时明确记录可验证的阻塞原因。',
].join(' ')

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
  readonly onWorkStarted?: (run: FleetRunRecord) => void | Promise<void>
}): Promise<FleetEvaluationOutcome> {
  const expiresAt = Date.now() + input.timeoutMs
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

function writeDurableOutputs(
  runs: FleetEvaluationRuns,
  outcome: FleetEvaluationOutcome,
  configuration: FleetEvaluationConfiguration,
): void {
  atomicText(join(configuration.outputDirectory, 'answer.txt'), `${outcome.answer.trim()}\n`)
  atomicJson(join(configuration.outputDirectory, 'usage.json'), runs.teamBudget(outcome.run.id))
  const resources = runs.resourceStore(outcome.run.id).listResources().map(resource => ({
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
  const bootstrap = await activateFleetAutoBootstrap(ctx, ctx.fleetRuns, ctx.fleetAssistant, {
    id: `evaluation-${configuration.id}`,
    projectRoot: configuration.projectRoot,
    teamConfigPath: configuration.teamConfigPath,
    taskPath: configuration.taskPath,
    readyFile: join(configuration.outputDirectory, 'bootstrap.json'),
    agentPreset: configuration.agentPreset,
    bootstrapInstruction: EVALUATION_BOOTSTRAP_INSTRUCTION,
    ...(configuration.provider === undefined ? {} : { provider: configuration.provider }),
    ...(configuration.model === undefined ? {} : { model: configuration.model }),
    ...(configuration.maxTokens === undefined ? {} : { maxTokens: configuration.maxTokens }),
  })
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
      timeoutMs: configuration.timeoutMs,
      onWorkStarted: startedRun => {
        writeStatus(configuration, startedAt, 'work_started', { run: startedRun })
      },
    })
    if (outcome.phase === 'timed_out') {
      try {
        const paused = await ctx.fleetRuns.pauseTeam(assistantAgent, run.id)
        outcome = { ...outcome, run: paused }
      } catch {
        // The timeout result remains authoritative even if best-effort preservation fails.
      }
    }
    await flushFleetSessions(ctx, outcome.run)
    writeDurableOutputs(ctx.fleetRuns, outcome, configuration)
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
    await bootstrap.dispose()
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
