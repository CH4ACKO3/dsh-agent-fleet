import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { encodeFleetActivation } from '@dsh-agent-fleet/core/activation'
import { activateFleetFromMessages } from '../src/activation.js'

const followup = vi.fn()
const cancel = vi.fn()
const agent = { id: 'setup-session', cancel, followup } as unknown as Agent

describe('Fleet UI activation bridge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('activates guide mode and requeues the clean message after its prompt is installed', async () => {
    const begin = vi.fn(() => ({ phase: 'setup' }))
    const setups = { begin, stage: vi.fn(), create: vi.fn() }
    const incoming = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: encodeFleetActivation({ mode: 'interactive' }, '帮我组建长期团队') }],
    })

    const decision = await activateFleetFromMessages(setups as never, agent, [incoming])

    expect(begin).toHaveBeenCalledWith(agent, { initialIdea: '帮我组建长期团队' })
    expect(setups.stage).not.toHaveBeenCalled()
    expect(decision).toEqual({ kind: 'reject' })
    expect(followup).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: '帮我组建长期团队' }],
    }))
    expect(cancel).toHaveBeenCalledWith(
      { kind: 'hook', reason: 'Fleet activated a new assistant prompt for the queued message.' },
      { keepInbox: true },
    )
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(followup.mock.invocationCallOrder[0] ?? 0)
  })

  it('requeues a configured Team first input into the attached native assistant Session', async () => {
    const configuration = {
      core: { name: 'Fleet', positioning: '', assistant: {}, members: [] },
      modules: {
        'dsh-agent-fleet/message': { defaultChannel: { id: 'main', name: 'Main' }, rules: '', collaborationMethod: '' },
        'dsh-agent-fleet/resources': { policy: '', items: [] },
        'dsh-agent-fleet/ui': { userAccess: { updateDensity: 'concise', notificationPolicy: 'decisions', contentPreference: '' } },
      },
    }
    const begin = vi.fn(() => ({ phase: 'setup' }))
    const stage = vi.fn(() => ({ phase: 'setup', configuration }))
    const create = vi.fn(async () => ({
      setup: { phase: 'operating', configuration },
      run: {
        id: 'team-created',
        members: [{ name: 'lead' }, { name: 'reviewer' }],
        assistants: [{ sessionId: 'setup-session', view: { id: 'team-assistant' } }],
      },
    }))
    const incoming = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: encodeFleetActivation({ mode: 'configuration', configuration }, '开始工作') }],
    })

    const decision = await activateFleetFromMessages(
      { begin, stage, create } as never,
      agent,
      [incoming],
      undefined,
      {
        runs: { attachAssistant: vi.fn() } as never,
        assistant: { activate: vi.fn() } as never,
        meta: { activate: vi.fn() } as never,
      },
    )

    expect(stage).toHaveBeenCalledWith(agent, { configuration })
    expect(create).toHaveBeenCalledWith(agent)
    expect(followup).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: '开始工作' }],
    }))
    expect(cancel).toHaveBeenCalledWith(
      { kind: 'hook', reason: 'Fleet activated a new assistant prompt for the queued message.' },
      { keepInbox: true },
    )
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(followup.mock.invocationCallOrder[0] ?? 0)
    expect(decision).toEqual({ kind: 'reject' })
  })

  it('attaches the conversation as an assistant when connecting to an existing Team', async () => {
    const setups = { begin: vi.fn(), stage: vi.fn(), create: vi.fn() }
    const view = {
      id: 'assistant-river',
      name: 'River',
      color: '#587FA8',
      role: 'Team Assistant',
      prompt: '',
    }
    const attachAssistant = vi.fn(() => ({
      run: { id: 'team-existing-42' },
      assistant: { view },
    }))
    const activate = vi.fn()
    const incoming = createUserMessage({
      source: { kind: 'user' },
      content: [{
        type: 'text',
        text: encodeFleetActivation({
          mode: 'connection',
          teamId: 'team-existing-42',
          assistantId: 'assistant-river',
        }, '继续发布前检查'),
      }],
    })

    const decision = await activateFleetFromMessages(
      setups as never,
      agent,
      [incoming],
      undefined,
      {
        runs: { attachAssistant } as never,
        assistant: { activate } as never,
        meta: { activate: vi.fn() } as never,
      },
    )

    expect(setups.begin).not.toHaveBeenCalled()
    expect(attachAssistant).toHaveBeenCalledWith(agent, {
      runId: 'team-existing-42',
      assistantId: 'assistant-river',
    })
    expect(activate).toHaveBeenCalledWith(agent, 'team-existing-42', view)
    expect(followup).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: '继续发布前检查' }],
    }))
    expect(decision).toEqual({ kind: 'reject' })
  })

  it('activates Fleet Help without starting setup or attaching to a Team', async () => {
    const setups = { begin: vi.fn(), stage: vi.fn(), create: vi.fn() }
    const attachAssistant = vi.fn()
    const activateAssistant = vi.fn()
    const activateMeta = vi.fn()
    const incoming = createUserMessage({
      source: { kind: 'user' },
      content: [{
        type: 'text',
        text: encodeFleetActivation({ mode: 'meta' }, '团队和任务有什么区别？'),
      }],
    })

    const decision = await activateFleetFromMessages(
      setups as never,
      agent,
      [incoming],
      undefined,
      {
        runs: { attachAssistant } as never,
        assistant: { activate: activateAssistant } as never,
        meta: { activate: activateMeta } as never,
      },
    )

    expect(activateMeta).toHaveBeenCalledWith(agent)
    expect(setups.begin).not.toHaveBeenCalled()
    expect(attachAssistant).not.toHaveBeenCalled()
    expect(activateAssistant).not.toHaveBeenCalled()
    expect(decision).toEqual({ kind: 'reject' })
    expect(followup).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: '团队和任务有什么区别？' }],
    }))
  })
})
