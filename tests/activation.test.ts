import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'

import { encodeFleetActivation } from '@dsh-agent-fleet/core/activation'
import { activateFleetFromMessages } from '../src/activation.js'

const agent = {} as Agent

describe('Fleet UI activation bridge', () => {
  it('activates guide mode and strips the private envelope before the turn enters', async () => {
    const begin = vi.fn(() => ({ phase: 'setup' }))
    const setups = { begin, stage: vi.fn(), create: vi.fn() }
    const incoming = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: encodeFleetActivation({ mode: 'interactive' }, '帮我组建长期团队') }],
    })

    const decision = await activateFleetFromMessages(setups as never, agent, [incoming])

    expect(begin).toHaveBeenCalledWith(agent, { initialIdea: '帮我组建长期团队' })
    expect(setups.stage).not.toHaveBeenCalled()
    expect(decision).toMatchObject({
      kind: 'enter',
      messages: [{ id: incoming.id, content: [{ type: 'text', text: '帮我组建长期团队' }] }],
    })
  })

  it('stages and creates a configured Team before the clean first turn enters', async () => {
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
      run: { id: 'team-created', members: [{ name: 'lead' }, { name: 'reviewer' }] },
    }))
    const sendConversationMessage = vi.fn()
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
        runs: { attachAssistant: vi.fn(), sendConversationMessage } as never,
        assistant: { activate: vi.fn() } as never,
        meta: { activate: vi.fn() } as never,
      },
    )

    expect(stage).toHaveBeenCalledWith(agent, { configuration })
    expect(create).toHaveBeenCalledWith(agent)
    expect(sendConversationMessage).toHaveBeenCalledWith(agent, {
      runId: 'team-created',
      to: '#main',
      text: '开始工作',
      delivery: 'wakeup',
      mentions: ['@lead', '@reviewer'],
    })
    expect(decision).toMatchObject({
      kind: 'enter',
      messages: [{ content: [{ type: 'text', text: '开始工作' }] }],
    })
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
        text: encodeFleetActivation({ mode: 'connection', teamId: 'team-existing-42' }, '继续发布前检查'),
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
    expect(attachAssistant).toHaveBeenCalledWith(agent, { runId: 'team-existing-42' })
    expect(activate).toHaveBeenCalledWith(agent, 'team-existing-42', view)
    expect(decision).toMatchObject({
      kind: 'enter',
      messages: [{ content: [{ type: 'text', text: '继续发布前检查' }] }],
    })
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
    expect(decision).toMatchObject({
      kind: 'enter',
      messages: [{ content: [{ type: 'text', text: '团队和任务有什么区别？' }] }],
    })
  })
})
