import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'

import {
  FLEET_ASSISTANT_SYSTEM_PROMPT,
  FLEET_ASSISTANT_TOOL_NAMES,
  FLEET_GUIDE_TOOL_NAMES,
  FLEET_META_ASSISTANT_SYSTEM_PROMPT,
  FLEET_TEAM_BUILDER_PROMPT,
  FleetAssistantRuntime,
} from '../src/assistant.js'
import { activateResidentFleetAssistants } from '../src/resident-assistants.js'

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
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'read the Inbox Task instead of inferring reply state',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Inbox and Reply Tasks are communication obligations, not automatic authorization for project work',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'A peer mention or your own proposed next step is not by itself such a basis',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Do not acknowledge another acknowledgement or confirm another confirmation',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Reply to foreground native user messages directly with ordinary native assistant output',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'do not duplicate it through `fleet_send`',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Every granted Fleet capability is resident and directly callable',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'compact thread-status view',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'one persistent Interaction Task',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Do not emit the final answer before that tool call',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      '`fleet_user_task update` only for an intentional mid-turn user progress message',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'do not call `fleet_user_task report`',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'emit the answer exactly once and end the turn',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'do not call `fleet_user_task status` merely because direct input arrived',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'not a preceding assistant message',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Before calling `fleet_run start` for a new Team work item',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'is still a request for the Team to execute',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'pass that file directly as the `fleet_run start` task source',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Use the actual roster\'s roles and responsibilities to prepare a concise provisional decomposition',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Call `fleet_run start` once',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'the complete initial `stages` DAG',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'atomically creates the zero-owner root and all initial Goal/Vote stages',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'rejection completes it with a negative acceptance result',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'do not post a separate kickoff message',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain('`fleet_goal split`')
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'A valid `@Name` or `@member-id` in the message text explicitly means "this member must answer"',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Only a domain handler, deterministic timeout fallback, or the fenced `fleet_reconcile resolve` path writes a stable state',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Fleet already claimed for this turn. Do not call `fleet_reconcile claim` again',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'with the exact Task id, exact `attempt_id`',
    )
    expect(FLEET_ASSISTANT_SYSTEM_PROMPT).toContain(
      'Quiet Channel posts remain visible in Channel history but create no Inbox obligation or wakeup',
    )
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
      'fleet_inbox',
      'fleet_reply',
      'fleet_vote',
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

describe('resident Fleet assistants', () => {
  const view = (id: string, name: string) => ({
    id,
    name,
    role: 'Team assistant',
    prompt: '',
    provider: 'provider-team',
    model: 'model-team',
    maxTokens: 2_048,
    toolGroups: ['messages'],
    permissions: [],
    contacts: { members: '*' as const, channels: '*' as const },
  })

  it('activates live and persisted assistants while owning only resumed Sessions', async () => {
    const live = { id: 'session-live' } as Agent
    const resumed = {
      id: 'session-resumed',
      session: { header: { agentPreset: 'standard' }, events: [] },
    } as unknown as Agent
    const dispose = vi.fn(() => Promise.resolve())
    const mount = vi.fn(() => Promise.resolve())
    const resumedCtx = {
      agent: resumed,
      get: (name: string) => name === 'agentPresets' ? { mount } : undefined,
    } as unknown as Context
    let resumedPublished = false
    const resume = vi.fn(async (options: ResumeAgentOptions) => {
      await options.setup?.(resumedCtx)
      resumedPublished = true
      return { agent: resumed, dispose }
    })
    const warn = vi.fn()
    const ctx = {
      agents: {
        get: (id: string) => id === 'session-live' ? live : undefined,
        resume,
      },
      logger: () => ({ warn }),
    } as unknown as Context
    const assistants = [
      { sessionId: 'session-live', view: view('assistant-live', 'Hailey') },
      { sessionId: 'session-resumed', view: view('assistant-resumed', 'Maya') },
      { sessionId: 'session-paused', view: view('assistant-paused', 'Paused'), status: 'paused' as const },
    ]
    const run = {
      id: 'team-one',
      agentOptions: { provider: 'provider-fallback', model: 'model-fallback', maxTokens: 512 },
      assistants,
    }
    const attachAssistant = vi.fn(async (agent: Agent, input: { readonly assistantId?: string }) => {
      if (agent === resumed && !resumedPublished) {
        throw new Error('resumed assistant was attached before publication')
      }
      return {
        run,
        assistant: assistants.find(assistant => assistant.view.id === input.assistantId) ?? assistants[0]!,
      }
    })
    const activate = vi.fn()
    const loadTeamMembersAtStartup = vi.fn(() => Promise.resolve(run))

    const residents = await activateResidentFleetAssistants(
      ctx,
      { list: () => [run], attachAssistant, loadTeamMembersAtStartup } as never,
      { activate } as never,
    )

    expect(attachAssistant).toHaveBeenCalledTimes(2)
    expect(resume).not.toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: 'session-paused' }))
    expect(activate).toHaveBeenCalledWith(live, 'team-one', assistants[0]?.view)
    expect(activate).toHaveBeenCalledWith(resumed, 'team-one', assistants[1]?.view)
    expect(loadTeamMembersAtStartup).toHaveBeenCalledOnce()
    expect(loadTeamMembersAtStartup).toHaveBeenCalledWith(live, 'team-one')
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({
      resumeSessionId: 'session-resumed',
      agentOptions: { provider: 'provider-team', model: 'model-team', maxTokens: 2_048 },
      setup: expect.any(Function),
    }))
    expect(mount).toHaveBeenCalledWith(resumedCtx, 'standard')
    expect(warn).not.toHaveBeenCalled()

    expect(await residents.release('session-resumed')).toBe(true)
    expect(dispose).toHaveBeenCalledOnce()
    await residents.restore('session-resumed')
    expect(resume).toHaveBeenCalledTimes(2)
    expect(mount).toHaveBeenCalledTimes(2)

    await residents.dispose()
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('continues activating other assistants when one persisted Session cannot resume', async () => {
    const available = { id: 'session-available' } as Agent
    const warn = vi.fn()
    const activate = vi.fn()
    const ctx = {
      agents: {
        get: () => undefined,
        resume: vi.fn(async (options: ResumeAgentOptions) => {
          if (String(options.resumeSessionId) === 'session-missing') throw new Error('Session is unavailable')
          await options.setup?.({ agent: available, get: () => undefined } as unknown as Context)
          return { agent: available, dispose: () => Promise.resolve() }
        }),
      },
      logger: () => ({ warn }),
    } as unknown as Context
    const assistants = [
      { sessionId: 'session-missing', view: view('assistant-missing', 'Missing') },
      { sessionId: 'session-available', view: view('assistant-available', 'Available') },
    ]
    const run = { id: 'team-one', assistants }
    const attachAssistant = vi.fn(async (_agent: Agent, input: { readonly assistantId?: string }) => ({
      run,
      assistant: assistants.find(assistant => assistant.view.id === input.assistantId)!,
    }))
    const loadTeamMembersAtStartup = vi.fn(() => Promise.resolve(run))

    const residents = await activateResidentFleetAssistants(
      ctx,
      { list: () => [run], attachAssistant, loadTeamMembersAtStartup } as never,
      { activate } as never,
    )

    expect(activate).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledWith(available, 'team-one', assistants[1]?.view)
    expect(loadTeamMembersAtStartup).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('assistant-missing'))
    await residents.dispose()
  })
})
