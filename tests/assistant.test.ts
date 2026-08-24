import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'

import {
  FLEET_ASSISTANT_SYSTEM_PROMPT,
  FLEET_ASSISTANT_TOOL_NAMES,
  FLEET_GUIDE_TOOL_NAMES,
  FLEET_META_ASSISTANT_SYSTEM_PROMPT,
  FLEET_TEAM_BUILDER_PROMPT,
  FleetAssistantRuntime,
} from '../src/assistant.js'

function fakeAgent(options?: { readonly restrictError?: Error }): {
  readonly agent: Agent
  readonly section: ReturnType<typeof vi.fn>
  readonly restrict: ReturnType<typeof vi.fn>
  readonly removePersona: ReturnType<typeof vi.fn>
  readonly removeRestriction: ReturnType<typeof vi.fn>
} {
  const removePersona = vi.fn()
  const removeRestriction = vi.fn()
  const section = vi.fn(() => removePersona)
  const restrict = vi.fn(() => {
    if (options?.restrictError !== undefined) throw options.restrictError
    return removeRestriction
  })
  return {
    agent: {
      id: 'assistant-session',
      ctx: { systemPrompt: { section }, tools: { restrict } },
    } as unknown as Agent,
    section,
    restrict,
    removePersona,
    removeRestriction,
  }
}

describe('FleetAssistantRuntime', () => {
  it('installs a workspace-free, tool-free Meta assistant persona', () => {
    const fixture = fakeAgent()
    const runtime = new FleetAssistantRuntime()

    expect(runtime.activateMeta(fixture.agent)).toEqual({
      active: true,
      phase: 'meta',
      sessionId: 'assistant-session',
      tools: [],
    })
    expect(fixture.section).toHaveBeenCalledWith({
      name: 'deployment:persona',
      order: 0,
      text: FLEET_META_ASSISTANT_SYSTEM_PROMPT,
    })
    expect(fixture.restrict).toHaveBeenCalledWith({ allow: [] })
  })

  it('installs and removes the native session persona without hiding inherited tools', () => {
    const fixture = fakeAgent()
    const runtime = new FleetAssistantRuntime()

    expect(runtime.activate(fixture.agent)).toEqual({
      active: true,
      phase: 'operating',
      sessionId: 'assistant-session',
      tools: [...FLEET_ASSISTANT_TOOL_NAMES],
    })
    expect(fixture.section).toHaveBeenCalledWith({
      name: 'deployment:persona',
      order: 0,
      text: FLEET_ASSISTANT_SYSTEM_PROMPT,
    })
    expect(fixture.restrict).not.toHaveBeenCalled()

    runtime.activate(fixture.agent)
    expect(fixture.section).toHaveBeenCalledTimes(1)
    expect(fixture.restrict).not.toHaveBeenCalled()

    expect(runtime.deactivate(fixture.agent)).toEqual({
      active: false,
      phase: 'inactive',
      sessionId: 'assistant-session',
      tools: [],
    })
    expect(fixture.removeRestriction).not.toHaveBeenCalled()
    expect(fixture.removePersona).toHaveBeenCalledOnce()
  })

  it('switches the same session from setup guide to the operating assistant', () => {
    const fixture = fakeAgent()
    const runtime = new FleetAssistantRuntime()

    expect(runtime.activateGuide(fixture.agent, 'setup-1')).toEqual({
      active: true,
      phase: 'setup',
      sessionId: 'assistant-session',
      setupId: 'setup-1',
      tools: [...FLEET_GUIDE_TOOL_NAMES],
    })
    expect(fixture.section).toHaveBeenLastCalledWith({
      name: 'deployment:persona',
      order: 0,
      text: FLEET_TEAM_BUILDER_PROMPT,
    })
    expect(fixture.restrict).toHaveBeenCalledWith({ allow: FLEET_GUIDE_TOOL_NAMES })

    expect(runtime.promote(fixture.agent, 'team-1')).toEqual({
      active: true,
      phase: 'operating',
      sessionId: 'assistant-session',
      runId: 'team-1',
      tools: [...FLEET_ASSISTANT_TOOL_NAMES],
    })
    expect(fixture.removePersona).toHaveBeenCalledOnce()
    expect(fixture.removeRestriction).toHaveBeenCalledOnce()
    expect(fixture.section).toHaveBeenLastCalledWith({
      name: 'deployment:persona',
      order: 0,
      text: FLEET_ASSISTANT_SYSTEM_PROMPT,
    })
  })

  it('uses the same member view to install identity and collaboration tools', () => {
    const fixture = fakeAgent()
    const runtime = new FleetAssistantRuntime()
    const view = {
      id: 'assistant-research',
      name: 'Maya',
      color: '#527fca',
      role: 'Research Assistant',
      responsibility: 'Connect research work to the user.',
      prompt: 'Surface uncertainty clearly.',
      toolGroups: ['messages', 'coordination', 'schedule'] as const,
      permissions: ['meeting.manage', 'schedule.create'] as const,
      contacts: { members: '*' as const, channels: '*' as const },
    }

    const mode = runtime.activate(fixture.agent, 'team-1', {
      ...view,
      toolGroups: [...view.toolGroups],
      permissions: [...view.permissions],
    })

    expect(mode.view).toMatchObject({ id: 'assistant-research', name: 'Maya', role: 'Research Assistant' })
    expect(mode.tools).toEqual(expect.arrayContaining([
      'fleet_assistant',
      'fleet_send',
      'fleet_meeting',
    ]))
    expect(fixture.restrict).not.toHaveBeenCalled()
    expect(fixture.section).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('Name: Maya'),
    }))
  })

  it('leaves plugin-owned tools to the native DSH tool registry', () => {
    const view = {
      id: 'assistant-extension',
      name: 'Maya',
      role: 'Specialist',
      prompt: '',
      toolGroups: ['messages', 'external-service'] as const,
      permissions: [] as const,
      contacts: { members: '*' as const, channels: '*' as const },
    }
    const mode = new FleetAssistantRuntime().activate(fakeAgent().agent, 'team-1', {
      ...view,
      toolGroups: [...view.toolGroups],
      permissions: [...view.permissions],
    })

    expect(mode.tools).toContain('fleet_send')
    expect(mode.tools).not.toContain('external_service')
  })

  it('allows a Fleet member to use the user-facing assistant surface and rolls back partial activation', () => {
    const member = fakeAgent()
    const memberRuntime = new FleetAssistantRuntime()
    expect(memberRuntime.activate(member.agent).active).toBe(true)
    expect(member.section).toHaveBeenCalledOnce()
    memberRuntime.deactivate(member.agent)

    const failed = fakeAgent({ restrictError: new Error('tool restriction failed') })
    const runtime = new FleetAssistantRuntime()
    expect(() => runtime.activateMeta(failed.agent)).toThrow('tool restriction failed')
    expect(failed.removePersona).toHaveBeenCalledOnce()
    expect(runtime.status(failed.agent).active).toBe(false)
  })
})
