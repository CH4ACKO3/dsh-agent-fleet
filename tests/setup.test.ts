import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FleetAssistantRuntime } from '../src/assistant.js'
import type { CreateRunInput, FleetRunRecord } from '../src/run.js'
import { FleetSetupService, normalizeFleetSetupConfiguration } from '../src/setup.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true })
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-fleet-setup-'))
  temporaryDirectories.push(directory)
  return directory
}

function fakeAgent(projectRoot: string): Agent {
  return {
    id: 'assistant-session',
    options: {},
    session: { header: { cwd: projectRoot } },
    ctx: {
      systemPrompt: { section: vi.fn(() => vi.fn()) },
      tools: { restrict: vi.fn(() => vi.fn()) },
    },
  } as unknown as Agent
}

function runRecord(id: string, sourceSetupId: string, projectRoot: string): FleetRunRecord {
  return {
    id,
    sourceSetupId,
    team: 'Product engineering',
    name: 'Product engineering',
    configPath: join(projectRoot, '.fleet', 'runs', id, 'team.json'),
    projectRoot,
    coordinator: 'fleet-coordinator',
    launcherSessionId: 'assistant-session',
    members: [],
    assistants: [{
      sessionId: 'assistant-session',
      view: { id: 'team-assistant', name: 'River', role: 'Team Assistant', prompt: '' },
    }],
    status: 'idle',
    settled: true,
    startedAt: new Date().toISOString(),
  }
}

function setupFixture(): {
  readonly projectRoot: string
  readonly setupDirectory: string
  readonly agent: Agent
  readonly assistant: FleetAssistantRuntime
  readonly service: FleetSetupService
  readonly create: ReturnType<typeof vi.fn>
} {
  const projectRoot = temporaryDirectory()
  const setupDirectory = temporaryDirectory()
  const agent = fakeAgent(projectRoot)
  const assistant = new FleetAssistantRuntime()
  const runs = new Map<string, FleetRunRecord>()
  const create = vi.fn(async (_agent: Agent, input: CreateRunInput) => {
    const record = runRecord('team-1', input.sourceSetupId ?? '', projectRoot)
    runs.set(record.sourceSetupId ?? '', record)
    return record
  })
  const service = new FleetSetupService(assistant, {
    create,
    findBySetupId: (setupId: string) => runs.get(setupId),
  }, { directory: setupDirectory })
  return { projectRoot, setupDirectory, agent, assistant, service, create }
}

function configuration(members: readonly object[] = []): object {
  return {
    core: {
      name: 'Product engineering',
      positioning: 'Own the product engineering lifecycle.',
      assistant: {},
      members,
    },
    modules: {
      'dsh-agent-fleet/message': {
        defaultChannel: { id: 'main', name: 'Main' },
        rules: '',
        collaborationMethod: '',
      },
      'dsh-agent-fleet/resources': { policy: '', items: [] },
      'dsh-agent-fleet/ui': {
        userAccess: { updateDensity: 'concise', notificationPolicy: 'decisions', contentPreference: '' },
      },
    },
  }
}

describe('FleetSetupService', () => {
  it('materializes blank preset identities as distinct persistent names and colors', () => {
    const normalized = normalizeFleetSetupConfiguration(configuration([
        { id: 'lead', name: '', color: '', role: 'Product lead', responsibilities: 'Own direction.' },
        { id: 'engineer', name: '', color: '', role: 'Engineer', responsibilities: 'Own implementation.' },
      ]))
    const core = normalized.core as Record<string, unknown>
    const members = core.members as Array<{ readonly name: string; readonly color: string }>
    const assistant = core.assistant as { readonly id: string; readonly name: string; readonly color: string }

    expect(members.map(member => member.name)).not.toContain('')
    expect(new Set(members.map(member => member.name)).size).toBe(2)
    expect(members.every(member => /^#[0-9a-f]{6}$/u.test(member.color))).toBe(true)
    expect(new Set(members.map(member => member.color)).size).toBe(2)
    expect(assistant.id).toBe('team-assistant')
    expect(members.map(member => member.name)).not.toContain(assistant.name)
    expect(members.map(member => member.color)).not.toContain(assistant.color)
  })

  it('persists browser-selected setup resources before Team creation', () => {
    const fixture = setupFixture()
    const uploaded = fixture.service.uploadResource(fixture.agent, {
      sessionId: 'assistant-session',
      name: 'brief.bin',
      base64: Buffer.from([0, 1, 2, 255]).toString('base64'),
      mediaType: 'application/octet-stream',
    })

    expect(uploaded).toMatchObject({ label: 'brief.bin', mediaType: 'application/octet-stream', size: 4 })
    expect([...readFileSync(uploaded.path)]).toEqual([0, 1, 2, 255])
  })

  it('persists a staged draft and promotes the same assistant after one idempotent create', async () => {
    const fixture = setupFixture()
    const begun = fixture.service.begin(fixture.agent, { initialIdea: 'Build a lasting product team' })
    expect(begun.phase).toBe('setup')
    expect(fixture.assistant.status(fixture.agent)).toMatchObject({
      phase: 'setup',
      setupId: begun.setupId,
    })

    const staged = fixture.service.stage(fixture.agent, {
      configuration: configuration(),
    })
    expect(staged.configuration).toMatchObject({
      core: {
        name: 'Product engineering',
        assistant: {
          id: 'team-assistant',
          role: 'Team Assistant',
          name: expect.any(String),
          color: expect.stringMatching(/^#[0-9a-f]{6}$/u),
        },
        members: [],
      },
      modules: {
        'dsh-agent-fleet/message': {
          defaultChannel: { id: 'main', name: 'Main' },
        },
      },
    })

    const [first, concurrent] = await Promise.all([
      fixture.service.create(fixture.agent),
      fixture.service.create(fixture.agent),
    ])
    const second = await fixture.service.create(fixture.agent)
    expect(first.run.id).toBe('team-1')
    expect(concurrent.run.id).toBe('team-1')
    expect(second.run.id).toBe('team-1')
    expect(fixture.create).toHaveBeenCalledOnce()
    expect(fixture.create).toHaveBeenCalledWith(fixture.agent, expect.objectContaining({
      sourceSetupId: begun.setupId,
      projectRoot: fixture.projectRoot,
    }))
    expect(fixture.assistant.status(fixture.agent)).toMatchObject({
      phase: 'operating',
      runId: 'team-1',
    })
  })

  it('describes the current setup modules and preserves omitted plugin blocks across draft updates', () => {
    const fixture = setupFixture()
    fixture.service.begin(fixture.agent)
    const initial = configuration() as Record<string, unknown>
    initial.modules = {
      ...(initial.modules as Record<string, unknown>),
      'example/plugin': { enabled: true, nested: { retained: true } },
    }
    fixture.service.stage(fixture.agent, { configuration: initial })

    const updated = fixture.service.stage(fixture.agent, { configuration: configuration() })
    expect(updated.configuration).toMatchObject({
      modules: {
        'example/plugin': { enabled: true, nested: { retained: true } },
      },
    })

    const guide = fixture.service.configurationGuide()
    const template = JSON.parse(guide.configurationTemplate) as Record<string, unknown>
    expect(template).toMatchObject({
      core: { name: '', positioning: '', members: [] },
      modules: {
        'dsh-agent-fleet/message': { defaultChannel: { id: 'main', name: 'Main' } },
      },
    })
    expect(guide.modules.map(module => module.id)).toEqual(expect.arrayContaining([
      'dsh-agent-fleet/message',
      'dsh-agent-fleet/resources',
      'dsh-agent-fleet/ui',
    ]))
  })

  it('restores the durable setup instead of initializing it again', () => {
    const fixture = setupFixture()
    const begun = fixture.service.begin(fixture.agent)
    fixture.service.stage(fixture.agent, { configuration: configuration() })

    const restartedAssistant = new FleetAssistantRuntime()
    const restarted = new FleetSetupService(restartedAssistant, {
      create: fixture.create,
      findBySetupId: () => undefined,
    }, { directory: fixture.setupDirectory })
    const restored = restarted.restore(fixture.agent)

    expect(restored?.setupId).toBe(begun.setupId)
    expect(restored?.initialIdea).toBeUndefined()
    expect(restored?.configuration).toMatchObject({ core: { name: 'Product engineering' } })
    expect(restartedAssistant.status(fixture.agent).phase).toBe('setup')
  })

  it('reattaches an operating assistant before checking its pending work', async () => {
    const fixture = setupFixture()
    const begun = fixture.service.begin(fixture.agent)
    fixture.service.stage(fixture.agent, { configuration: configuration() })
    const created = await fixture.service.create(fixture.agent)
    const attachAssistant = vi.fn(async () => created)
    const agentSessionStarted = vi.fn()
    const restartedAssistant = new FleetAssistantRuntime()
    const restarted = new FleetSetupService(restartedAssistant, {
      create: fixture.create,
      findBySetupId: setupId => setupId === begun.setupId ? created.run : undefined,
      attachAssistant,
      agentSessionStarted,
    }, { directory: fixture.setupDirectory })

    const restored = restarted.restore(fixture.agent)

    expect(restored?.phase).toBe('operating')
    await vi.waitFor(() => expect(attachAssistant).toHaveBeenCalledWith(fixture.agent, {
      runId: created.run.id,
      assistantId: 'team-assistant',
    }))
    await vi.waitFor(() => expect(agentSessionStarted).toHaveBeenCalledWith(fixture.agent, true))
  })

  it('rejects incomplete members', () => {
    const fixture = setupFixture()
    fixture.service.begin(fixture.agent)
    fixture.service.stage(fixture.agent, { configuration: configuration() })
    expect(() => fixture.service.stage(fixture.agent, {
      configuration: configuration([{ id: 'developer', name: 'Morgan', role: 'Engineer' }]),
    })).toThrow(/responsibilities is required/)
  })
})
