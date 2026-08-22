import { describe, expect, it } from 'vitest'

import { encodeFleetActivation, parseFleetActivation } from '../src/activation.js'

describe('Fleet activation envelope', () => {
  it('round-trips Unicode configuration and keeps the user prompt separate', () => {
    const encoded = encodeFleetActivation({
      mode: 'configuration',
      configuration: { name: '关羽团队', rules: '先核验，再执行' },
    }, '实现一个协作插件')

    expect(parseFleetActivation(encoded)).toEqual({
      request: {
        mode: 'configuration',
        configuration: { name: '关羽团队', rules: '先核验，再执行' },
      },
      text: '实现一个协作插件',
    })
  })

  it('round-trips a request to connect the conversation to an existing Team', () => {
    const encoded = encodeFleetActivation({
      mode: 'connection',
      teamId: 'team-existing-42',
    }, '继续完成发布前检查')

    expect(parseFleetActivation(encoded)).toEqual({
      request: { mode: 'connection', teamId: 'team-existing-42' },
      text: '继续完成发布前检查',
    })
  })

  it('round-trips the workspace-free Fleet Meta assistant activation', () => {
    const encoded = encodeFleetActivation({ mode: 'meta' }, '团队和任务有什么区别？')

    expect(parseFleetActivation(encoded)).toEqual({
      request: { mode: 'meta' },
      text: '团队和任务有什么区别？',
    })
  })

  it('does not interpret ordinary or malformed user text as activation', () => {
    expect(parseFleetActivation('hello')).toBeUndefined()
    expect(parseFleetActivation('\u2063dsh-agent-fleet:v1:10:{}\nhello')).toBeUndefined()
  })
})
