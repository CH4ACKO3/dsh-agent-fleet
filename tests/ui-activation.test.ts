import { afterEach, describe, expect, it } from 'vitest'

import { parseFleetActivation } from '@dsh-agent-fleet/core/activation'
import {
  classifyFleetExistingAssistants,
  clearFleetActivation,
  consumeFleetActivation,
  getFleetActivationSnapshot,
  recoverFleetActivationDraft,
  stageFleetActivation,
} from '../packages/ui/src/activation.js'

const firstSession = 'session-one'
const secondSession = 'session-two'

afterEach(() => {
  clearFleetActivation(firstSession)
  clearFleetActivation(secondSession)
})

describe('Fleet composer activation state', () => {
  it('is consumed exactly once by the first native submission', () => {
    stageFleetActivation(firstSession, { mode: 'interactive' })

    const encoded = consumeFleetActivation(firstSession, '组建一个长期协作团队')

    expect(encoded).toBeDefined()
    expect(parseFleetActivation(encoded!)).toEqual({
      request: { mode: 'interactive' },
      text: '组建一个长期协作团队',
    })
    expect(consumeFleetActivation(firstSession, '第二条消息')).toBeUndefined()
    expect(getFleetActivationSnapshot(firstSession)).toBeNull()
  })

  it('restages activation when the native input machine restores a failed draft', () => {
    stageFleetActivation(firstSession, { mode: 'configuration', configuration: { name: 'Fleet' } })
    const encoded = consumeFleetActivation(firstSession, '开始工作')

    expect(recoverFleetActivationDraft(firstSession, encoded!)).toBe('开始工作')
    expect(getFleetActivationSnapshot(firstSession)?.request).toEqual({
      mode: 'configuration',
      configuration: { name: 'Fleet' },
    })
  })

  it('does not consume another Session activation', () => {
    stageFleetActivation(firstSession, { mode: 'interactive' })

    expect(consumeFleetActivation(secondSession, '另一个会话的消息')).toBeUndefined()
    expect(getFleetActivationSnapshot(firstSession)?.request).toEqual({ mode: 'interactive' })
  })
})

describe('existing Team assistant routing', () => {
  const assistants = [
    { assistantId: 'assistant-one', assistantName: 'Hailey', sessionId: 'session-live' },
    { assistantId: 'assistant-two', assistantName: 'Robin', sessionId: 'session-archived' },
  ] as const

  it('keeps the current creation path when the Team has no assistant', () => {
    expect(classifyFleetExistingAssistants([], [], [])).toEqual({ kind: 'create' })
  })

  it('offers only live, unarchived assistant Sessions for direct opening', () => {
    expect(classifyFleetExistingAssistants(
      assistants,
      ['session-live', 'session-archived'],
      ['session-archived'],
    )).toEqual({ kind: 'open', assistants: [assistants[0]] })
  })

  it('reconnects a stable assistant identity when no usable Session remains', () => {
    expect(classifyFleetExistingAssistants(
      assistants,
      ['session-archived'],
      ['session-archived'],
    )).toEqual({ kind: 'reconnect', assistants })
  })
})
