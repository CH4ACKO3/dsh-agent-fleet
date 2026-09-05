import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  activateFleetAutoBootstrap,
  deliverPendingFleetGenerationEvents,
  fleetAutoBootstrapConfiguration,
  fleetGenerationEventInstruction,
  readFleetAutoBootstrapMarker,
} from '../src/auto-bootstrap.js'

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), 'fleet-auto-bootstrap-'))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Fleet automatic bootstrap', () => {
  it('is disabled unless one of its explicit paths is configured', () => {
    expect(fleetAutoBootstrapConfiguration({})).toBeUndefined()
  })

  it('requires a complete absolute configuration and validates max tokens', () => {
    expect(() => fleetAutoBootstrapConfiguration({ FLEET_AUTO_TEAM_CONFIG: '/team.json' }))
      .toThrow('FLEET_AUTO_WORKSPACE is required')
    expect(() => fleetAutoBootstrapConfiguration({
      FLEET_AUTO_TEAM_CONFIG: '/team.json',
      FLEET_AUTO_BOOTSTRAP_TASK: '/task.md',
      FLEET_AUTO_WORKSPACE: '/workspace',
      FLEET_AUTO_MAX_TOKENS: '0',
    })).toThrow('FLEET_AUTO_MAX_TOKENS must be a positive integer')
  })

  it('creates a fresh Team, activates its assistant, and delivers one idempotent bootstrap', async () => {
    const root = temporaryDirectory()
    const workspace = join(root, 'workspace')
    const dshHome = join(root, 'dsh')
    mkdirSync(join(workspace, '.self-evolve'), { recursive: true })
    const teamConfigPath = join(root, 'team.json')
    const taskPath = join(workspace, 'task.md')
    writeFileSync(teamConfigPath, '{}')
    writeFileSync(taskPath, '# Task')
    writeFileSync(join(workspace, '.self-evolve', 'generation.json'), JSON.stringify({ role: 'candidate' }))
    vi.stubEnv('DSH_HOME', dshHome)
    const configuration = {
      id: 'generation-one',
      projectRoot: workspace, teamConfigPath, taskPath,
      agentPreset: 'standard',
      readyFile: join(workspace, '.self-evolve', 'ready.json'),
      provider: 'provider', model: 'model', maxTokens: 4096,
      controlDirectory: join(root, 'control'), generation: 'g0001',
    }
    const followup = vi.fn()
    const dispose = vi.fn(() => Promise.resolve())
    const agent = {
      id: 'assistant-session', followup,
      session: { header: { agentPreset: 'standard' }, events: [] },
    } as unknown as Agent
    const mount = vi.fn(() => Promise.resolve())
    const createAgent = vi.fn(async (options: { setup?: (ctx: Context) => unknown }) => {
      await options.setup?.({ agent, get: (name: string) => name === 'agentPresets' ? { mount } : undefined } as unknown as Context)
      return { agent, dispose }
    })
    const run = {
      id: 'team-one', sourceSetupId: 'auto-bootstrap:generation-one', status: 'idle',
      assistants: [{ sessionId: 'assistant-session', view: { id: 'assistant' } }],
    }
    const createRun = vi.fn(async () => run)
    const activate = vi.fn()
    const started = vi.fn()

    const result = await activateFleetAutoBootstrap(
      { agents: { create: createAgent, get: vi.fn() } } as unknown as Context,
      { list: () => [], create: createRun, agentSessionStarted: started } as never,
      { activate } as never,
      configuration,
    )

    expect(result.run).toBe(run)
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      meta: { cwd: workspace, agentPreset: 'standard' },
      agentOptions: { provider: 'provider', model: 'model', maxTokens: 4096 },
    }))
    expect(createRun).toHaveBeenCalledWith(agent, expect.objectContaining({
      configPath: teamConfigPath,
      projectRoot: workspace,
      sourceSetupId: 'auto-bootstrap:generation-one',
    }))
    expect(mount).toHaveBeenCalledWith(expect.anything(), 'standard')
    expect(activate).toHaveBeenCalledWith(agent, 'team-one', run.assistants[0]?.view)
    expect(started).toHaveBeenCalledWith(agent)
    expect(followup).toHaveBeenCalledOnce()
    expect(followup.mock.calls[0]?.[0]?.content?.[0]?.text).toContain('你是候选代，不是稳定代')
    expect(followup.mock.calls[0]?.[0]?.content?.[0]?.text).toContain('不得选择新的改进主题')
    expect(followup.mock.calls[0]?.[0]?.content?.[0]?.text).toContain('不能只用 Vote 表态后结束工作')
    expect(readFleetAutoBootstrapMarker(configuration)).toMatchObject({ runId: 'team-one' })
    expect(JSON.parse(readFileSync(configuration.readyFile, 'utf8'))).toMatchObject({ runId: 'team-one' })
    await result.dispose()
    expect(dispose).toHaveBeenCalledOnce()

    const repeated = await activateFleetAutoBootstrap(
      { agents: { create: createAgent, get: vi.fn() } } as unknown as Context,
      { list: () => [run], create: createRun, agentSessionStarted: started } as never,
      { activate } as never,
      configuration,
    )
    expect(repeated.run).toBe(run)
    expect(createAgent).toHaveBeenCalledOnce()
    expect(followup).toHaveBeenCalledOnce()
  })

  it('recovers a created Team whose bootstrap delivery marker was not written', async () => {
    const root = temporaryDirectory()
    const workspace = join(root, 'workspace')
    mkdirSync(workspace, { recursive: true })
    const teamConfigPath = join(root, 'team.json')
    const taskPath = join(workspace, 'task.md')
    writeFileSync(teamConfigPath, '{}')
    writeFileSync(taskPath, '# Task')
    vi.stubEnv('DSH_HOME', join(root, 'dsh'))
    const configuration = { id: 'recover', projectRoot: workspace, teamConfigPath, taskPath, agentPreset: 'standard' }
    const followup = vi.fn()
    const agent = { id: 'assistant-session', followup } as unknown as Agent
    const run = {
      id: 'team-recover', sourceSetupId: 'auto-bootstrap:recover', status: 'idle',
      assistants: [{ sessionId: 'assistant-session', view: { id: 'assistant' } }],
    }
    const createRun = vi.fn()

    await activateFleetAutoBootstrap(
      { agents: { create: vi.fn(), get: vi.fn(() => agent) } } as unknown as Context,
      { list: () => [run], create: createRun, agentSessionStarted: vi.fn() } as never,
      { activate: vi.fn() } as never,
      configuration,
    )

    expect(createRun).not.toHaveBeenCalled()
    expect(followup).toHaveBeenCalledOnce()
    expect(readFleetAutoBootstrapMarker(configuration)).toMatchObject({ runId: 'team-recover' })
  })

  it('relays actionable generation events once and advances past informational events', async () => {
    const root = temporaryDirectory()
    const workspace = join(root, 'workspace')
    const controlDirectory = join(root, 'control')
    const eventDirectory = join(controlDirectory, 'events', 'g0002')
    mkdirSync(workspace, { recursive: true })
    mkdirSync(eventDirectory, { recursive: true })
    vi.stubEnv('DSH_HOME', join(root, 'dsh'))
    const configuration = {
      id: 'generation-two', projectRoot: workspace,
      teamConfigPath: join(root, 'team.json'), taskPath: join(workspace, 'task.md'),
      agentPreset: 'standard', controlDirectory, generation: 'g0002',
    }
    writeFileSync(join(eventDirectory, '0000000001-started.json'), JSON.stringify({
      sequence: 1, generation: 'g0002', type: 'candidate.started', createdAt: '2026-09-04T00:00:00Z', data: {},
    }))
    writeFileSync(join(eventDirectory, '0000000002-ready.json'), JSON.stringify({
      sequence: 2, generation: 'g0002', type: 'candidate.ready', createdAt: '2026-09-04T00:01:00Z',
      data: {
        candidate: 'g0003',
        gitBranch: 'generations/g0003',
        sourceCommit: 'abc123',
        evidence: { name: 'ready.md', content: 'large evidence body' },
      },
    }))
    const followup = vi.fn()
    const agent = { id: 'assistant-session', followup } as unknown as Agent
    const run = { id: 'team-two' } as never

    expect(fleetGenerationEventInstruction({
      sequence: 1, generation: 'g0002', type: 'candidate.started', createdAt: '2026-09-04T00:00:00Z',
    })).toBeUndefined()
    await expect(deliverPendingFleetGenerationEvents(agent, run, configuration)).resolves.toBe(1)
    expect(followup).toHaveBeenCalledOnce()
    const relayed = followup.mock.calls[0]?.[0]
    expect(relayed).toMatchObject({
      content: [expect.objectContaining({ text: expect.stringContaining('candidate.ready') })],
    })
    expect(relayed.content[0].text).toContain('generations/g0003')
    expect(relayed.content[0].text).toContain('abc123')
    expect(relayed.content[0].text).toContain('两个有依赖的单 owner 持久 Goal')
    expect(relayed.content[0].text).toContain('最终决定 Goal')
    expect(relayed.content[0].text).toContain('两个节点必须在同一次建图时创建')
    expect(relayed.content[0].text).not.toContain('large evidence body')
    expect(readFleetAutoBootstrapMarker(configuration)).toMatchObject({ eventSequence: 2 })
    await expect(deliverPendingFleetGenerationEvents(agent, run, configuration)).resolves.toBe(0)
    expect(followup).toHaveBeenCalledOnce()
  })

  it('starts promoted generations with real stable work before another candidate', () => {
    const instruction = fleetGenerationEventInstruction({
      sequence: 3,
      generation: 'g0002',
      type: 'generation.promoted',
      createdAt: '2026-09-04T00:02:00Z',
      data: { previous: 'g0001', guardian: 'g0001' },
    })

    expect(instruction).toContain('正常稳定代工作流')
    expect(instruction).toContain('有证据的实际改进')
    expect(instruction).toContain('不要用纯自检或交接文档空转出下一代')
  })

  it('tells a freshly started candidate to verify instead of starting stable work', () => {
    const instruction = fleetGenerationEventInstruction({
      sequence: 1,
      generation: 'g0004',
      type: 'generation.started',
      createdAt: '2026-09-04T00:00:00Z',
      data: { role: 'candidate', parent: 'g0002', sourceCommit: 'abc123' },
    })

    expect(instruction).toContain('你是候选代，不是稳定代')
    expect(instruction).toContain('优先复用前置 Goal 产出的可检查证据')
    expect(instruction).toContain('只有在证据缺失或相互矛盾时才重跑')
    expect(instruction).toContain('不要把属于下游平台就绪节点')
    expect(instruction).toContain('少量单 owner Goal')
    expect(instruction).toContain('不得选择新的改进主题')
    expect(instruction).toContain('不能只用 Vote 表态后结束工作')
    expect(instruction).toContain('执行 ready 或 reject')
  })
})
