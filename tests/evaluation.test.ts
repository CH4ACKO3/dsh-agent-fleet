import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  fleetEvaluationConfiguration,
  superviseFleetEvaluationRun,
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
  it('ships a patch that replaces the stock single-Agent headless runner', () => {
    const patch = readFileSync(resolve('evaluation/headless.patch.yml'), 'utf8')
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      exports: Record<string, unknown>
      files: string[]
    }
    expect(patch).toContain('id: headless-runner')
    expect(patch).toContain('disabled: true')
    expect(patch).toContain('name: dsh-agent-fleet/evaluation')
    expect(packageJson.exports).toHaveProperty('./evaluation')
    expect(packageJson.files).toContain('evaluation/**/*.yml')
  })

  it('keeps the ALE launcher free of model-driven polling', () => {
    const deployer = readFileSync(resolve('integrations/agents-last-exam/dsh_fleet/deployer.py'), 'utf8')
    expect(deployer).toContain('FLEET_EVAL_TEAM_CONFIG')
    expect(deployer).toContain('FLEET_EVAL_TIMEOUT_MS')
    expect(deployer).not.toContain('fleet_run wait')
    expect(deployer).not.toContain('_launcher_prompt')
  })
})
