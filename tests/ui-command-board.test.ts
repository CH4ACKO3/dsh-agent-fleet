import { describe, expect, it } from 'vitest'

import {
  fleetPrivateConversationCommands,
  parseFleetConversationCommand,
} from '../packages/ui/src/team-panel.js'

describe('Fleet conversation command board', () => {
  it('recognizes the five Session commands in a direct member conversation', () => {
    expect(fleetPrivateConversationCommands('Hailey').map(command => command.name)).toEqual([
      'compact', 'goal', 'plan', 'model', 'export',
    ])
    expect(parseFleetConversationCommand('/compact', 'direct')).toBe('compact')
    expect(parseFleetConversationCommand('/goal ship the release', 'direct')).toBe('goal')
    expect(parseFleetConversationCommand('/plan off', 'direct')).toBe('plan')
    expect(parseFleetConversationCommand('/model', 'direct')).toBe('model')
    expect(parseFleetConversationCommand('/export', 'direct')).toBe('export')
    expect(parseFleetConversationCommand('/goal', 'direct')).toBeUndefined()
    expect(parseFleetConversationCommand('/plan', 'direct')).toBeUndefined()
    expect(parseFleetConversationCommand('/model deepseek-chat', 'direct')).toBeUndefined()
    expect(parseFleetConversationCommand('/export now', 'direct')).toBeUndefined()
    expect(parseFleetConversationCommand('/permission full-access')).toBeUndefined()
  })

  it('recognizes only Team export in a Channel', () => {
    expect(parseFleetConversationCommand('  /export  ', 'channel')).toBe('export')
    expect(parseFleetConversationCommand('/compact', 'channel')).toBeUndefined()
    expect(parseFleetConversationCommand('/goal ship the release', 'channel')).toBeUndefined()
    expect(parseFleetConversationCommand('/plan off', 'channel')).toBeUndefined()
    expect(parseFleetConversationCommand('/model', 'channel')).toBeUndefined()
    expect(parseFleetConversationCommand('/export now', 'channel')).toBeUndefined()
  })
})
