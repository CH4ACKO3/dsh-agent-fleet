import type { Context } from '@deepseek-ai/cordis'
import { FleetCore } from '@dsh-agent-fleet/core'
import type { AgentRuntime, RuntimeAgent } from '@dsh-agent-fleet/core'
import { MessageHub } from '@dsh-agent-fleet/message'
import type { MessageAgent } from '@dsh-agent-fleet/message'
import { describe, expect, it } from 'vitest'

import { apply } from '../src/index.js'

class FakeAgent implements RuntimeAgent, MessageAgent {
  readonly status = 'idle' as const
  readonly injected: string[] = []

  constructor(readonly id: string) {}

  cancel(): void {}

  whenIdle(): Promise<void> {
    return Promise.resolve()
  }

  inject(message: Parameters<MessageAgent['inject']>[0]): void {
    const content = message.content[0]
    if (content?.type === 'text') this.injected.push(content.text)
  }

  followup(message: Parameters<MessageAgent['followup']>[0]): void {
    this.inject(message)
  }

  steer(message: Parameters<MessageAgent['steer']>[0]): void {
    this.inject(message)
  }
}

describe('dsh-agent-fleet', () => {
  it('installs Core and the built-in Authorization modules', () => {
    const installed: string[] = []
    const injections: string[][] = []
    const ctx = {
      plugin(plugin: { name?: string }) {
        installed.push(plugin.name ?? '')
      },
      inject(dependencies: readonly string[]) {
        injections.push([...dependencies])
      },
    } as unknown as Context

    apply(ctx)
    expect(installed).toEqual(['dsh-agent-fleet-core'])
    expect(injections).toEqual(expect.arrayContaining([
      ['fleetRuns', 'fleetConfiguration'],
      ['fleetAuthorization', 'fleetRuns', 'fleetConfiguration', 'fleetGroups'],
      ['fleetAuthorization', 'fleetRuns', 'fleetGroups'],
    ]))
  })

  it('uses a Core Fleet name to address a Message recipient', () => {
    const lead = new FakeAgent('lead-id')
    const reviewer = new FakeAgent('reviewer-id')
    const outsider = new FakeAgent('outsider-id')
    const agents = new Map([lead, reviewer, outsider].map(agent => [agent.id, agent]))
    const runtime: AgentRuntime = {
      get: id => agents.get(id),
      create: () => Promise.reject(new Error('not used')),
    }
    const core = new FleetCore(runtime)
    core.register(lead, { name: 'tech-lead', role: 'Technical lead' })
    core.register(reviewer, { name: 'reviewer', role: 'Reviewer' })
    const messages = new MessageHub({
      get: id => core.nameForAgent(id) === undefined ? undefined : agents.get(id),
      list: () => [...agents.values()].filter(agent => core.nameForAgent(agent.id) !== undefined),
      resolve: reference => core.resolveTarget(reference).slice(1),
      displayName: id => core.nameForAgent(id),
    })

    messages.send(lead, {
      to: '@reviewer',
      text: 'Please review the change.',
      delivery: 'quiet',
    })

    expect(reviewer.injected[0]).toContain('Please review the change.')
    expect(reviewer.injected[0]).toContain('from=@tech-lead')
    expect(outsider.injected).toEqual([])
  })
})
