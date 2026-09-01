import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { SessionId } from '@deepseek-ai/dsh-session'

import type { FleetAssistantRuntime } from './assistant.js'
import type { FleetRunAssistant, FleetRunRecord, FleetRunService } from './run.js'

function assistantAgentOptions(run: FleetRunRecord, assistant: FleetRunAssistant): AgentOptions {
  const provider = assistant.view.provider ?? run.agentOptions?.provider
  const model = assistant.view.model ?? run.agentOptions?.model
  const maxTokens = assistant.view.maxTokens ?? run.agentOptions?.maxTokens
  return {
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }
}

async function mountPersistedAgentPreset(ctx: Context): Promise<void> {
  const presets = ctx.get('agentPresets', false)
  if (presets === undefined) return
  if (ctx.agent === undefined) throw new Error('Resident Fleet assistant setup requires ctx.agent')
  await presets.mount(ctx, resolveSessionPreset(ctx.agent.session))
}

/** Restore persisted Team assistants, then preload each unpaused formal-member roster once. */
export async function activateResidentFleetAssistants(
  ctx: Context,
  runs: Pick<FleetRunService, 'list' | 'attachAssistant' | 'loadTeamMembersAtStartup'> & {
    agentSessionStarted?(agent: Agent): void
  },
  runtime: Pick<FleetAssistantRuntime, 'activate'>,
): Promise<{
  agentDisposed(sessionId: string): void
  release(sessionId: string): Promise<boolean>
  restore(sessionId: string): Promise<void>
  dispose(): Promise<void>
}> {
  const handles = new Map<string, AgentHandle>()
  const restartTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const releasing = new Set<string>()
  const preloadedRunIds = new Set<string>()
  let closed = false
  const activate = async (agent: Agent, run: FleetRunRecord, assistant: FleetRunAssistant): Promise<void> => {
    const attached = await runs.attachAssistant(agent, {
      runId: run.id,
      assistantId: assistant.view.id,
    })
    runtime.activate(agent, attached.run.id, attached.assistant.view)
    if (preloadedRunIds.has(attached.run.id)) return
    preloadedRunIds.add(attached.run.id)
    try {
      await runs.loadTeamMembersAtStartup(agent, attached.run.id)
    } catch (error) {
      preloadedRunIds.delete(attached.run.id)
      ctx.logger('dsh-agent-fleet').warn(
        `Could not preload formal members for Fleet Team ${attached.run.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const restore = async (sessionId?: string): Promise<void> => {
    if (closed) return
    for (const run of runs.list()) {
      for (const assistant of run.assistants) {
        if (sessionId !== undefined && assistant.sessionId !== sessionId) continue
        if (assistant.status === 'paused') continue
        try {
          const live = ctx.agents.get(SessionId(assistant.sessionId))
          if (live !== undefined) {
            await activate(live, run, assistant)
            runs.agentSessionStarted?.(live)
            continue
          }
          if (handles.has(assistant.sessionId)) continue
          const handle = await ctx.agents.resume({
            resumeSessionId: SessionId(assistant.sessionId),
            agentOptions: assistantAgentOptions(run, assistant),
            setup: mountPersistedAgentPreset,
          })
          try {
            // The MessageHub resolves agents from the published registry, so
            // collaboration attachment must happen after resume returns.
            await activate(handle.agent, run, assistant)
          } catch (error) {
            await handle.dispose()
            throw error
          }
          handles.set(assistant.sessionId, handle)
          // Bind Fleet tools only after resume has published the Agent and
          // collaboration attachment can resolve it from the live registry.
          runs.agentSessionStarted?.(handle.agent)
        } catch (error) {
          ctx.logger('dsh-agent-fleet').warn(
            `Could not activate Fleet assistant ${assistant.view.id} for Team ${run.id}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
  }
  await restore()

  return {
    agentDisposed: sessionId => {
      if (closed || releasing.has(sessionId)) return
      handles.delete(sessionId)
      if (restartTimers.has(sessionId)) return
      const timer = setTimeout(() => {
        restartTimers.delete(sessionId)
        void restore(sessionId)
      }, 0)
      timer.unref?.()
      restartTimers.set(sessionId, timer)
    },
    release: async sessionId => {
      const handle = handles.get(sessionId)
      if (handle === undefined) return false
      handles.delete(sessionId)
      releasing.add(sessionId)
      try {
        await handle.dispose()
      } finally {
        releasing.delete(sessionId)
      }
      return true
    },
    restore: async sessionId => {
      const timer = restartTimers.get(sessionId)
      if (timer !== undefined) clearTimeout(timer)
      restartTimers.delete(sessionId)
      await restore(sessionId)
    },
    dispose: async () => {
      closed = true
      for (const timer of restartTimers.values()) clearTimeout(timer)
      restartTimers.clear()
      releasing.clear()
      preloadedRunIds.clear()
      const owned = [...handles.values()].reverse()
      handles.clear()
      await Promise.all(owned.map(handle => handle.dispose()))
    },
  }
}
