import { describe, expect, it, vi } from 'vitest'

import { installMessageTools, MessageHub } from '@dsh-agent-fleet/message'

describe('Fleet message delivery authorization', () => {
  it('separates posting, waking, and interrupting', async () => {
    const sender = { id: 'sender', inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn() }
    const recipient = { id: 'recipient', inject: vi.fn(), followup: vi.fn(), steer: vi.fn(), cancel: vi.fn() }
    const agents = new Map([[sender.id, sender], [recipient.id, recipient]])
    const hub = new MessageHub({ get: id => agents.get(id), list: () => [...agents.values()] })
    const allowed = new Set(['message.post'])
    const tools: Array<{ readonly name: string; execute(args: never, context: never): Promise<unknown> }> = []
    installMessageTools({
      tools: { register: (tool: typeof tools[number]) => { tools.push(tool); return () => {} } },
    } as never, hub, { messages: true, coordination: false, authorize: (_agent, action) => allowed.has(action) })
    const followup = tools.find(tool => tool.name === 'fleet_followup')
    if (followup === undefined) throw new Error('fleet_followup was not installed')

    await expect(followup.execute({ to: '@recipient', message: 'Wake up.' } as never, { agent: sender } as never))
      .rejects.toThrow('message.wakeup')
    allowed.add('message.wakeup')
    await expect(followup.execute({ to: '@recipient', message: 'Wake up.' } as never, { agent: sender } as never))
      .resolves.toMatchObject({ woken: 1 })
    await expect(followup.execute({ to: '@recipient', message: 'Stop.', interrupt: true } as never, { agent: sender } as never))
      .rejects.toThrow('message.interrupt')
    allowed.add('message.interrupt')
    await expect(followup.execute({ to: '@recipient', message: 'Stop.', interrupt: true } as never, { agent: sender } as never))
      .resolves.toMatchObject({ woken: 1 })
    expect(recipient.cancel).toHaveBeenCalledOnce()
    hub.close()
  })
})
