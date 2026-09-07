import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  exportFleetEvaluationState,
  fleetEvaluationConfiguration,
  superviseFleetEvaluationRun,
  waitForFleetEvaluationWork,
} from '../src/evaluation.js'
import type { FleetRunRecord } from '../src/run.js'

function runRecord(overrides: Partial<FleetRunRecord> = {}): FleetRunRecord {
  return {
    id: 'team-evaluation',
    team: 'research-team',
    name: 'Research Team',
    configPath: resolve('team.json'),
    projectRoot: resolve('workspace'),
    launcherSessionId: 'assistant-session',
    members: [],
    assistants: [],
    status: 'idle',
    settled: false,
    startedAt: '2026-09-06T00:00:00.000Z',
    ...overrides,
  }
}

describe('Fleet evaluation configuration', () => {
  it('turns the positional task into a durable task file with deterministic defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'fleet-evaluation-'))
    const configuration = fleetEvaluationConfiguration('Solve the supplied problem.', {
      FLEET_EVAL_RUN_ID: 'run-001',
      FLEET_EVAL_WORKSPACE: root,
      FLEET_EVAL_TEAM_CONFIG: join(root, 'team.json'),
      FLEET_EVAL_PROVIDER: '  provider-a  ',
      FLEET_EVAL_MODEL: ' model-a ',
      FLEET_EVAL_MAX_TOKENS: '8192',
    }, root)

    expect(configuration).toMatchObject({
      id: 'run-001',
      projectRoot: root,
      taskText: 'Solve the supplied problem.',
      taskPath: join(root, '.fleet-evaluation', 'run-001', 'task.md'),
      outputDirectory: join(root, '.fleet-evaluation', 'run-001'),
      timeoutMs: 3_600_000,
      agentPreset: 'standard',
      provider: 'provider-a',
      model: 'model-a',
      maxTokens: 8192,
    })
  })

  it('requires an explicit Team configuration and validates host limits', () => {
    const root = resolve('workspace')
    expect(() => fleetEvaluationConfiguration('Task', {
      FLEET_EVAL_WORKSPACE: root,
    }, root)).toThrow('FLEET_EVAL_TEAM_CONFIG is required')
    expect(() => fleetEvaluationConfiguration('Task', {
      FLEET_EVAL_WORKSPACE: root,
      FLEET_EVAL_TEAM_CONFIG: resolve('team.json'),
      FLEET_EVAL_TIMEOUT_MS: '0',
    }, root)).toThrow('FLEET_EVAL_TIMEOUT_MS must be a positive integer')
  })
})

describe('Fleet evaluation supervision', () => {
  afterEach(() => { vi.useRealTimers() })

  it('times out a bootstrap that never becomes idle even when it never creates Work', async () => {
    vi.useFakeTimers()
    const idle = runRecord()
    const subscribeChanges = vi.fn()
    const outcome = superviseFleetEvaluationRun({
      runs: { status: () => idle, subscribeChanges } as never,
      run: idle, assistantAgent: { whenIdle: () => new Promise(() => {}) } as never,
      projectRoot: idle.projectRoot, timeoutMs: 100,
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(outcome).resolves.toMatchObject({ phase: 'timed_out', exitCode: 124, run: idle })
    expect(subscribeChanges).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('charges bootstrap time to the same deadline as Team work and releases the subscription', async () => {
    vi.useFakeTimers()
    const running = runRecord({
      status: 'running',
      work: { id: 'work-1', taskPath: resolve('task.md'), status: 'running', startedAt: '2026-09-06T00:00:01.000Z' },
    })
    const unsubscribe = vi.fn()
    const subscribeChanges = vi.fn(() => unsubscribe)
    const settled = vi.fn()
    const outcome = superviseFleetEvaluationRun({
      runs: { status: () => running, subscribeChanges } as never,
      run: running,
      assistantAgent: { whenIdle: () => new Promise(resolveIdle => { setTimeout(resolveIdle, 60) }) } as never,
      projectRoot: running.projectRoot, timeoutMs: 100,
    })
    void outcome.then(settled)
    await vi.advanceTimersByTimeAsync(60)
    expect(subscribeChanges).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(39)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(outcome).resolves.toMatchObject({ phase: 'timed_out', exitCode: 124 })
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds an asynchronous work-start hook by the shared deadline', async () => {
    vi.useFakeTimers()
    const running = runRecord({
      status: 'running',
      work: { id: 'work-1', taskPath: resolve('task.md'), status: 'running', startedAt: '2026-09-06T00:00:01.000Z' },
    })
    const subscribeChanges = vi.fn()
    const outcome = superviseFleetEvaluationRun({
      runs: { status: () => running, subscribeChanges } as never,
      run: running, assistantAgent: { whenIdle: async () => {} } as never,
      projectRoot: running.projectRoot, timeoutMs: 100,
      onWorkStarted: () => new Promise(() => {}),
    })
    await vi.advanceTimersByTimeAsync(100)
    await expect(outcome).resolves.toMatchObject({ phase: 'timed_out', exitCode: 124 })
    expect(subscribeChanges).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disposes a subscription that synchronously reports completion before returning its disposer', async () => {
    vi.useFakeTimers()
    const running = runRecord({
      work: { id: 'work-1', taskPath: resolve('task.md'), status: 'running', startedAt: '2026-09-06T00:00:01.000Z' },
    })
    const finished = { ...running, work: { ...running.work!, status: 'finished' as const } }
    const unsubscribe = vi.fn()
    const result = await waitForFleetEvaluationWork({
      status: () => finished,
      subscribeChanges: (listener: () => void) => { listener(); return unsubscribe },
    } as never, running, running.projectRoot, 100)
    expect(result).toBe(finished)
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects subscription setup errors and clears their deadline', async () => {
    vi.useFakeTimers()
    const running = runRecord({
      work: { id: 'work-1', taskPath: resolve('task.md'), status: 'running', startedAt: '2026-09-06T00:00:01.000Z' },
    })
    await expect(waitForFleetEvaluationWork({
      status: () => running,
      subscribeChanges: () => { throw new Error('subscription unavailable') },
    } as never, running, running.projectRoot, 100)).rejects.toThrow('subscription unavailable')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('turns callback inspection errors into a rejected wait and disposes the listener', async () => {
    vi.useFakeTimers()
    const running = runRecord({
      work: { id: 'work-1', taskPath: resolve('task.md'), status: 'running', startedAt: '2026-09-06T00:00:01.000Z' },
    })
    let listener: (() => void) | undefined
    const unsubscribe = vi.fn()
    const status = vi.fn(() => running)
    const result = waitForFleetEvaluationWork({
      status, subscribeChanges: (callback: () => void) => { listener = callback; return unsubscribe },
    } as never, running, running.projectRoot, 100)
    const rejected = expect(result).rejects.toThrow('Team unavailable')
    status.mockImplementationOnce(() => { throw new Error('Team unavailable') })
    expect(() => listener?.()).not.toThrow()
    await rejected
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for Team work in host code after the assistant bootstrap turn', async () => {
    const running = runRecord({
      status: 'running',
      work: {
        id: 'work-1', taskPath: resolve('task.md'), status: 'running',
        startedAt: '2026-09-06T00:00:01.000Z',
      },
    })
    const finished = runRecord({
      status: 'idle',
      work: {
        id: 'work-1', taskPath: resolve('task.md'), status: 'finished',
        startedAt: '2026-09-06T00:00:01.000Z',
        endedAt: '2026-09-06T00:01:00.000Z', summary: 'Verified answer.',
      },
    })
    const whenIdle = vi.fn(async () => {})
    let current = running
    const status = vi.fn(() => current)
    const unsubscribe = vi.fn()
    const subscribeChanges = vi.fn((listener: () => void) => {
      queueMicrotask(() => {
        current = finished
        listener()
      })
      return unsubscribe
    })
    const onWorkStarted = vi.fn()

    const outcome = await superviseFleetEvaluationRun({
      runs: { status, subscribeChanges } as never,
      run: running,
      assistantAgent: { whenIdle } as never,
      projectRoot: running.projectRoot,
      timeoutMs: 1234,
      onWorkStarted,
    })

    expect(whenIdle).toHaveBeenCalledOnce()
    expect(onWorkStarted).toHaveBeenCalledWith(running)
    expect(subscribeChanges).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(outcome).toMatchObject({ phase: 'work_finished', exitCode: 0, answer: 'Verified answer.' })
  })

  it('fails deterministically when bootstrap ends without starting Team work', async () => {
    const idle = runRecord()
    const subscribeChanges = vi.fn()
    const outcome = await superviseFleetEvaluationRun({
      runs: { status: () => idle, subscribeChanges } as never,
      run: idle,
      assistantAgent: { whenIdle: async () => {} } as never,
      projectRoot: idle.projectRoot,
      timeoutMs: 1000,
    })

    expect(subscribeChanges).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ phase: 'bootstrap_incomplete', exitCode: 4 })
  })

  it.each([
    ['blocked', 'work_blocked', 2],
    ['failed', 'work_failed', 3],
    ['cancelled', 'work_failed', 3],
  ] as const)('maps a %s Work to a stable process result', async (workStatus, phase, exitCode) => {
    const terminal = runRecord({
      work: {
        id: 'work-1', taskPath: resolve('task.md'), status: workStatus,
        startedAt: '2026-09-06T00:00:01.000Z', summary: `${workStatus} summary`,
      },
    })
    const outcome = await superviseFleetEvaluationRun({
      runs: { status: () => terminal, subscribeChanges: vi.fn() } as never,
      run: terminal,
      assistantAgent: { whenIdle: async () => {} } as never,
      projectRoot: terminal.projectRoot,
      timeoutMs: 1000,
    })
    expect(outcome).toMatchObject({ phase, exitCode, answer: `${workStatus} summary` })
  })

  it('reports a host timeout when subscribed Work remains running', async () => {
    const running = runRecord({
      status: 'running',
      work: {
        id: 'work-1', taskPath: resolve('task.md'), status: 'running',
        startedAt: '2026-09-06T00:00:01.000Z',
      },
    })
    const outcome = await superviseFleetEvaluationRun({
      runs: { status: () => running, subscribeChanges: () => () => {} } as never,
      run: running,
      assistantAgent: { whenIdle: async () => {} } as never,
      projectRoot: running.projectRoot,
      timeoutMs: 5,
    })
    expect(outcome).toMatchObject({ phase: 'timed_out', exitCode: 124 })
  })
})

describe('Fleet evaluation package profile', () => {
  it('exports flushed sessions and the exact Team state as evaluation evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'fleet-evaluation-state-'))
    const dshHome = join(root, 'dsh-home')
    const output = join(root, 'results')
    const team = runRecord({ id: 'team-evaluation' })
    mkdirSync(join(dshHome, 'sessions', 'workspace', 'session-1'), { recursive: true })
    writeFileSync(join(dshHome, 'sessions', 'workspace', 'session-1', 'session.jsonl.zstd'), 'session')
    mkdirSync(join(dshHome, 'dsh-agent-fleet', 'teams', team.id), { recursive: true })
    writeFileSync(join(dshHome, 'dsh-agent-fleet', 'teams', team.id, 'events.jsonl'), '{}\n')
    writeFileSync(join(dshHome, 'dsh-agent-fleet', 'teams', `${team.id}.json`), '{}\n')

    exportFleetEvaluationState(team, output, dshHome)

    expect(existsSync(join(output, 'dsh-sessions', 'workspace', 'session-1', 'session.jsonl.zstd'))).toBe(true)
    expect(existsSync(join(output, 'fleet-state', team.id, 'events.jsonl'))).toBe(true)
    expect(existsSync(join(output, 'fleet-state', `${team.id}.json`))).toBe(true)
  })

  it('exports the generic runner without enabling it from the default entry', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    expect(packageJson.exports).toHaveProperty('./evaluation')
    expect(readFileSync(resolve('src/index.ts'), 'utf8')).not.toContain('./evaluation.js')
  })
})
