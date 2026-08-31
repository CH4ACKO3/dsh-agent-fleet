import { describe, expect, it, vi } from 'vitest'

import { installMessageTools, MessageHub } from '@dsh-agent-fleet/message'

describe('Fleet message delivery authorization', () => {
  it('keeps the remaining send tool quiet and checks posting authorization', async () => {
    const sender = { id: 'sender', inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn() }
    const recipient = { id: 'recipient', inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn() }
    const agents = new Map([[sender.id, sender], [recipient.id, recipient]])
    const hub = new MessageHub({
      get: id => agents.get(id),
      participantIds: () => [...agents.keys()],
      list: () => [...agents.values()],
    })
    const allowed = new Set<string>()
    const tools: Array<{ readonly name: string; execute(args: never, context: never): Promise<unknown> }> = []
    installMessageTools({
      tools: { register: (tool: typeof tools[number]) => { tools.push(tool); return () => {} } },
    } as never, hub, { messages: true, coordination: false, authorize: (_agent, action) => allowed.has(action) })
    const send = tools.find(tool => tool.name === 'fleet_send')
    if (send === undefined) throw new Error('fleet_send was not installed')

    await expect(send.execute({ to: '@recipient', message: 'FYI.' } as never, { agent: sender } as never))
      .rejects.toThrow('message.post')
    allowed.add('message.post')
    await expect(send.execute({ to: '@recipient', message: 'FYI.' } as never, { agent: sender } as never))
      .resolves.toMatchObject({ delivered: 1, woken: 0 })
    expect(recipient.cancel).not.toHaveBeenCalled()
    hub.close()
  })
})
