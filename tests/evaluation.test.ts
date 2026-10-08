import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeFleetEvaluation,
  exportFleetEvaluationState,
  fleetEvaluationConfiguration,
  restrictFleetEvaluationBootstrap,
  superviseFleetEvaluationRun,
  waitForFleetEvaluationWork,
} from '../src/evaluation.js'
import type { FleetRunRecord } from '../src/run.js'
import { activateFleetAutoBootstrap } from '../src/auto-bootstrap.js'

vi.mock('../src/auto-bootstrap.js', () => ({ activateFleetAutoBootstrap: vi.fn() }))

describe('evaluation lifecycle wiring', () => {
  it.each(['deadline', 'bootstrap-error', 'export-error'] as const)('keeps host ownership through %s and releases it on exit', async scenario => {
    const root = mkdtempSync(join(tmpdir(), 'fleet-lifecycle-'))
    writeFileSync(join(root, 'team.json'), JSON.stringify({ core: { name: 'Fixture' }, modules: {} }))
    const config = fleetEvaluationConfiguration('Task', {
      FLEET_EVAL_WORKSPACE: root, FLEET_EVAL_TEAM_CONFIG: join(root, 'team.json'), FLEET_EVAL_TIMEOUT_MS: '10',
    }, root)
    let protectedTeam = false, bootstrapReleased = false
    const current = runRecord({ projectRoot: root, assistants: [{ sessionId: 'assistant-session' }] as never,
      work: { id: 'work-1', status: 'running', startedAt: new Date().toISOString(), taskPath: config.taskPath } })
    const lifecycle = { release: vi.fn(() => { protectedTeam = false }),
      pause: vi.fn(async () => { expect(protectedTeam).toBe(true); return { ...current, status: 'paused' } }) }
    const agent = { session: { header: { cwd: root } }, whenIdle: async () => {},
      ctx: { inject: async (_deps: unknown, install: (scope: unknown) => void) => install({ tools: {
        restrict: () => () => { bootstrapReleased = true }, guard: () => () => {},
      } }) } }
    const runs = {
      protectEvaluationLifecycle: vi.fn(() => { protectedTeam = true; return lifecycle }),
      status: () => current, pauseTeam: vi.fn(() => { throw new Error('agent pause must not be called') }),
      subscribeChanges: () => { expect(protectedTeam).toBe(true); expect(bootstrapReleased).toBe(true); return () => {} },
      teamBudget: () => ({}), resourceSnapshot: () => [], readTrace: () => ({ events: [], hasMore: false }),
    }
    const dispose = vi.fn(async () => { expect(protectedTeam).toBe(true) })
    vi.mocked(activateFleetAutoBootstrap).mockImplementationOnce(async (_ctx, _runs, _assistant, _config, beforeInput) => {
      const effective = JSON.parse(readFileSync(_config.teamConfigPath, 'utf8'))
      expect(effective.modules['dsh-agent-fleet/message'].rules).toContain('(10 ms) total')
      expect(_config.bootstrapInstruction).toContain('[Host evaluation budget]')
      expect(JSON.parse(readFileSync(join(root, 'team.json'), 'utf8'))).toEqual({ core: { name: 'Fixture' }, modules: {} })
      // At install time Work does not yet exist; it is created by the later model input.
      runs.status = () => ({ ...current, work: undefined }) as typeof current
      await beforeInput?.(agent as never, current)
      expect(protectedTeam).toBe(true)
      if (scenario === 'bootstrap-error') throw new Error('bootstrap fixture failure')
      runs.status = () => current
      return { run: current, dispose } as never
    })
    const ctx = { fleetRuns: runs, fleetAssistant: {}, agents: { get: () => agent },
      sessions: { flush: async () => { if (scenario === 'export-error') throw new Error('export fixture failure') } } } as never
    try {
      if (scenario === 'deadline') {
        expect(await executeFleetEvaluation(ctx, config)).toMatchObject({ phase: 'timed_out', exitCode: 124, run: { status: 'paused' } })
        expect(lifecycle.pause).toHaveBeenCalledOnce()
        expect(JSON.parse(readFileSync(join(config.outputDirectory, 'status.json'), 'utf8'))).toMatchObject({ outcome: 'timed_out', phase: 'artifacts_flushed' })
      } else {
        await expect(executeFleetEvaluation(ctx, config)).rejects.toThrow(`${scenario === 'bootstrap-error' ? 'bootstrap' : 'export'} fixture failure`)
      }
      expect(runs.pauseTeam).not.toHaveBeenCalled()
      expect(lifecycle.release).toHaveBeenCalledOnce()
      expect(protectedTeam).toBe(false)
      expect(bootstrapReleased).toBe(true)
    } finally { vi.mocked(activateFleetAutoBootstrap).mockReset() }
  })
})

describe('evaluation bootstrap tool boundary', () => {
  const stages = [{ key: 'work', kind: 'goal', title: 'Investigate', owners: ['lead'], dependencies: [] }]
  function fixture() {
    let current = runRecord()
    const task = resolve('evaluation/task.md')
    let guard: (execution: { name: string; arguments: unknown }) => string | undefined = () => undefined
    const removeRestriction = vi.fn(), removeGuard = vi.fn()
    const tools = {
      restrict: vi.fn(() => removeRestriction),
      guard: vi.fn((handler: typeof guard) => { guard = handler; return removeGuard }),
    }
    const inject = vi.fn(async (_dependencies: unknown, install: (scope: { tools: typeof tools }) => unknown) => install({ tools }))
    const agent = { ctx: { inject }, session: { header: { cwd: current.projectRoot } } } as never
    const status = vi.fn((_id?: string, _root?: string) => current)
    return { task, tools, agent, inject, removeRestriction, removeGuard,
      runs: { status } as never, status,
      run: current,
      start: () => { current = runRecord({ work: { id: 'work', taskPath: task, status: 'running', startedAt: new Date().toISOString() } }) },
      call: (name: string, args: unknown) => guard({ name, arguments: args }),
    }
  }

  it('allows only the authoritative task and the same Team status/start before Work', async () => {
    const f = fixture()
    const release = await restrictFleetEvaluationBootstrap(f.agent, f.runs, f.run, f.task)
    expect(f.tools.restrict).toHaveBeenCalledWith({ allow: ['read', 'fleet_run'] })
    expect(f.call('read', { file_path: f.task })).toBeUndefined()
    expect(f.call('fleet_run', { action: 'status', run_id: f.run.id })).toBeUndefined()
    expect(f.call('fleet_run', { action: 'start', run_id: f.run.id, task: f.task, stages })).toBeUndefined()
    for (const [name, args] of [
      ['read', { file_path: resolve('workspace/current-training-feedback.json') }],
      ['read', { file_path: 'evaluation/task.md' }],
      ['fleet_run', { action: 'start', run_id: 'other-team', task: f.task }],
      ['fleet_run', { action: 'start', run_id: f.run.id, task: resolve('other-task.md') }],
      ['fleet_run', { action: 'start', task: f.task, cwd: resolve('other-workspace') }],
      ['fleet_run', { action: 'status', cwd: resolve('other-workspace') }],
      ['fleet_run', { action: 'start', task: f.task, cwd: 'relative-workspace' }],
      ['fleet_run', { action: 'start', run_id: null, task: f.task }],
      ['fleet_run', { action: 'create', run_id: f.run.id }],
      ['fleet_run', { action: 'pause', run_id: f.run.id }],
      ['str_replace_editor', { command: 'str_replace', path: '/workspace/executor/src/collaboration-contract.ts' }],
      ['memory_retrieve', { query: 'prior lessons', limit: 3 }],
      ['bash', { command: 'echo edited > file' }],
      ['fleet_user_task', { action: 'take_over' }],
      ['read', null],
    ] as const) expect(f.call(name, args)).toContain('Delegate feedback, memory, source edits')
    release(); release()
    expect(f.removeRestriction).toHaveBeenCalledOnce()
    expect(f.removeGuard).toHaveBeenCalledOnce()
  })

  it('allows omitted run_id only through the same default-Team lookup as fleet_run', async () => {
    const f = fixture()
    const release = await restrictFleetEvaluationBootstrap(f.agent, f.runs, f.run, f.task)
    expect(f.call('fleet_run', { action: 'status' })).toBeUndefined()
    expect(f.status).toHaveBeenLastCalledWith(undefined, f.run.projectRoot)
    expect(f.call('fleet_run', { action: 'start', task: f.task, stages })).toBeUndefined()
    expect(f.status).toHaveBeenLastCalledWith(undefined, f.run.projectRoot)
    expect(f.call('fleet_run', { action: 'start', task: f.task, cwd: f.run.projectRoot, stages })).toBeUndefined()
    release()
  })

  it.each(['other-team', 'ambiguous', 'unavailable'] as const)('rejects unsafe implicit Team selection: %s', async scenario => {
    const f = fixture()
    f.status.mockImplementation(id => {
      if (id !== undefined) return f.run
      if (scenario === 'other-team') return { ...f.run, id: 'other-team' }
      throw new Error(scenario)
    })
    const release = await restrictFleetEvaluationBootstrap(f.agent, f.runs, f.run, f.task)
    for (const args of [{ action: 'status' }, { action: 'start', task: f.task }]) {
      expect(f.call('fleet_run', args)).toContain(`Use run_id="${f.run.id}"`)
    }
    expect(f.call('fleet_run', { action: 'start', run_id: f.run.id, task: f.task, stages })).toBeUndefined()
    release()
  })

  it('blocks duplicate start after Work exists and releases the bootstrap scope', async () => {
    const f = fixture()
    const release = await restrictFleetEvaluationBootstrap(f.agent, f.runs, f.run, f.task)
    f.start()
    expect(f.call('fleet_run', { action: 'start', run_id: f.run.id, task: f.task })).toContain('bootstrap is complete')
    release()
    expect(f.removeGuard).toHaveBeenCalledOnce()
  })

  it.each([undefined, [], null, {}, 'work'])('rejects an omitted or unusable evaluation DAG without replacing it: %j', async missingStages => {
    const f = fixture()
    const release = await restrictFleetEvaluationBootstrap(f.agent, f.runs, f.run, f.task)
    expect(f.call('fleet_run', { action: 'start', run_id: f.run.id, task: f.task, stages: missingStages })).toContain('complete non-empty stages DAG')
    expect(f.call('fleet_run', { action: 'status', run_id: f.run.id })).toBeUndefined()
    // A corrected caller-authored plan remains accepted; no roles or topology are imposed.
    expect(f.call('fleet_run', { action: 'start', run_id: f.run.id, task: f.task, stages })).toBeUndefined()
    release()
  })

  it('does not restrict an existing Work when restoring evaluation state', async () => {
    const f = fixture()
    f.start()
    const release = await restrictFleetEvaluationBootstrap(f.agent, f.runs, f.run, f.task)
    expect(f.inject).not.toHaveBeenCalled()
    release()
  })

  it('releases the restriction if guard installation fails', async () => {
    const f = fixture()
    f.tools.guard.mockImplementation(() => { throw new Error('guard unavailable') })
    await expect(restrictFleetEvaluationBootstrap(f.agent, f.runs, f.run, f.task)).rejects.toThrow('guard unavailable')
    expect(f.removeRestriction).toHaveBeenCalledOnce()
  })
})

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

  it('recovers one eligible bootstrap in the same Team before supervising its Work', async () => {
    const initial = runRecord()
    let current = initial
    const whenIdle = vi.fn(async () => {})
    const recoverBootstrap = vi.fn(async () => {
      current = { ...initial, status: 'running', work: { id: 'same-episode-work', taskPath: resolve('task.md'), status: 'running', startedAt: new Date().toISOString() } }
      return true
    })
    const unsubscribe = vi.fn()
    const subscribeChanges = vi.fn((listener: () => void) => {
      queueMicrotask(() => { current = { ...current, work: { ...current.work!, status: 'finished', summary: 'Recovered bootstrap result.' } }; listener() })
      return unsubscribe
    })
    const outcome = await superviseFleetEvaluationRun({
      runs: { status: () => current, subscribeChanges } as never, run: initial,
      assistantAgent: { whenIdle } as never, projectRoot: initial.projectRoot,
      timeoutMs: 1000, bootstrapStartedAt: 123, recoverBootstrap,
    })
    expect(outcome).toMatchObject({ phase: 'work_finished', run: { id: initial.id, work: { id: 'same-episode-work' } } })
    expect(whenIdle).toHaveBeenCalledTimes(2)
    expect(recoverBootstrap).toHaveBeenCalledExactlyOnceWith({ notBefore: 123, signal: expect.any(AbortSignal) })
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('stops recovering when the recovery policy declines another attempt', async () => {
    const idle = runRecord()
    const whenIdle = vi.fn(async () => {})
    const recoverBootstrap = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    await expect(superviseFleetEvaluationRun({
      runs: { status: () => idle, subscribeChanges: vi.fn() } as never, run: idle,
      assistantAgent: { whenIdle } as never, projectRoot: idle.projectRoot,
      timeoutMs: 1000, recoverBootstrap,
    })).resolves.toMatchObject({ phase: 'bootstrap_incomplete', exitCode: 4 })
    expect(recoverBootstrap).toHaveBeenCalledTimes(2)
    expect(whenIdle).toHaveBeenCalledTimes(2)
  })

  it('does not repeat a normal no-Work bootstrap without a fresh protocol failure', async () => {
    const idle = runRecord()
    const whenIdle = vi.fn(async () => {})
    const recoverBootstrap = vi.fn(() => false)
    await expect(superviseFleetEvaluationRun({
      runs: { status: () => idle, subscribeChanges: vi.fn() } as never, run: idle,
      assistantAgent: { whenIdle } as never, projectRoot: idle.projectRoot,
      timeoutMs: 1000, recoverBootstrap,
    })).resolves.toMatchObject({ phase: 'bootstrap_incomplete' })
    expect(whenIdle).toHaveBeenCalledOnce()
  })

  it.each([
    runRecord({ status: 'failed', error: 'Team failed' }),
    runRecord({ work: { id: 'work', taskPath: resolve('task.md'), status: 'finished', startedAt: '2026-09-06T00:00:00.000Z' } }),
    runRecord({ work: { id: 'work', taskPath: resolve('task.md'), status: 'running', startedAt: '2026-09-06T00:00:00.000Z' } }),
  ])('never retries a failed Team or any existing Work (%j)', async current => {
    const recoverBootstrap = vi.fn(() => true)
    await superviseFleetEvaluationRun({
      runs: { status: () => current, subscribeChanges: () => () => {} } as never, run: current,
      assistantAgent: { whenIdle: async () => {} } as never, projectRoot: current.projectRoot,
      timeoutMs: 5, recoverBootstrap,
    })
    expect(recoverBootstrap).not.toHaveBeenCalled()
  })

  it('charges recovery and the second bootstrap wait to the original deadline', async () => {
    vi.useFakeTimers()
    const idle = runRecord()
    const whenIdle = vi.fn().mockImplementationOnce(() => new Promise(resolveIdle => { setTimeout(resolveIdle, 60) }))
      .mockImplementationOnce(() => new Promise(() => {}))
    let recoverySignal: AbortSignal | undefined
    const recoverBootstrap = vi.fn((input: { signal: AbortSignal }) => {
      recoverySignal = input.signal
      return new Promise<boolean>(resolveRecovery => { setTimeout(() => resolveRecovery(true), 20) })
    })
    const outcome = superviseFleetEvaluationRun({
      runs: { status: () => idle, subscribeChanges: vi.fn() } as never, run: idle,
      assistantAgent: { whenIdle } as never, projectRoot: idle.projectRoot,
      timeoutMs: 100, recoverBootstrap,
    })
    await vi.advanceTimersByTimeAsync(99)
    expect(whenIdle).toHaveBeenCalledTimes(2)
    expect(recoverySignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(outcome).resolves.toMatchObject({ phase: 'timed_out', exitCode: 124 })
    expect(recoverySignal?.aborted).toBe(true)
    expect(recoverBootstrap).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
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
