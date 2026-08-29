import { parseFleetActivation, type FleetActivationRequest } from '@dsh-agent-fleet/core/activation'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'

import type { FleetSetupCreation, FleetSetupRecord, FleetSetupService } from './setup.js'
import type { FleetAssistantRuntime } from './assistant.js'
import type { FleetMetaAssistantService } from './meta.js'
import type { FleetRunService } from './run.js'

interface FleetActivationSetups {
  begin(agent: Agent, input?: { readonly initialIdea?: string }): FleetSetupRecord
  stage(agent: Agent, input: { readonly configuration: unknown }): FleetSetupRecord
  create(agent: Agent): Promise<FleetSetupCreation>
}

interface FleetConnectionServices {
  readonly runs: Pick<FleetRunService, 'attachAssistant' | 'sendUserConversationMessage'> & {
    agentSessionStarted?(agent: Agent): void
  }
  readonly assistant: Pick<FleetAssistantRuntime, 'activate'>
  readonly meta: Pick<FleetMetaAssistantService, 'activate'>
}

function activatedMessage(message: UserMessage): {
  readonly message: UserMessage
  readonly request: FleetActivationRequest
  readonly initialIdea?: string
} | undefined {
  if (message.source.kind !== 'user') return undefined
  const index = message.content.findIndex(block => block.type === 'text')
  if (index < 0) return undefined
  const block = message.content[index]
  if (block?.type !== 'text') return undefined
  const parsed = parseFleetActivation(block.text)
  if (parsed === undefined) return undefined
  const content = message.content.map((candidate, candidateIndex) => candidateIndex === index
    ? { type: 'text' as const, text: parsed.text }
    : candidate)
  const initialIdea = parsed.text.trim()
  return {
    message: freezeMessage({ ...message, content }),
    request: parsed.request,
    ...(initialIdea.length === 0 ? {} : { initialIdea }),
  }
}

function requeueAfterActivation(agent: Agent, message: UserMessage): PreStepDecision {
  agent.followup(createUserMessage({ source: message.source, content: [...message.content] }))
  return { kind: 'reject' }
}

/** Activate a staged Fleet request and return clean messages for the durable turn. */
export async function activateFleetFromMessages(
  setups: FleetActivationSetups,
  agent: Agent,
  messages: readonly UserMessage[],
  signal?: AbortSignal,
  connection?: FleetConnectionServices,
): Promise<PreStepDecision> {
  const index = messages.findIndex(message => activatedMessage(message) !== undefined)
  if (index < 0) return { kind: 'enter', messages: [...messages] }
  const activation = activatedMessage(messages[index]!)
  if (activation === undefined) return { kind: 'enter', messages: [...messages] }
  signal?.throwIfAborted()
  if (activation.request.mode === 'meta') {
    if (connection === undefined) throw new Error('Fleet Meta assistant service is unavailable')
    connection.meta.activate(agent)
    return requeueAfterActivation(agent, activation.message)
  } else if (activation.request.mode === 'connection') {
    if (connection === undefined) throw new Error('Fleet connection services are unavailable')
    const attached = await connection.runs.attachAssistant(agent, {
      runId: activation.request.teamId,
      ...(activation.request.assistantId === undefined ? {} : { assistantId: activation.request.assistantId }),
    })
    connection.assistant.activate(agent, attached.run.id, attached.assistant.view)
    connection.runs.agentSessionStarted?.(agent)
    if (activation.initialIdea !== undefined) {
      connection.runs.sendUserConversationMessage({
        runId: attached.run.id,
        to: `@${attached.assistant.view.id}`,
        text: activation.initialIdea,
        delivery: 'wakeup',
      })
      return { kind: 'reject' }
    }
  } else {
    const setup = setups.begin(agent, {
      ...(activation.initialIdea === undefined ? {} : { initialIdea: activation.initialIdea }),
    })
    if (activation.request.mode === 'configuration' && setup.phase !== 'operating') {
      setups.stage(agent, { configuration: activation.request.configuration })
      signal?.throwIfAborted()
      const created = await setups.create(agent)
      if (activation.initialIdea !== undefined
        && created.setup.phase === 'operating'
        && connection !== undefined) {
        const assistant = created.run.assistants.find(candidate => candidate.sessionId === String(agent.id))
          ?? created.run.assistants[0]
        if (assistant !== undefined) {
          connection.runs.sendUserConversationMessage({
            runId: created.run.id,
            to: `@${assistant.view.id}`,
            text: activation.initialIdea,
            delivery: 'wakeup',
          })
          return { kind: 'reject' }
        }
      }
    }
    if (activation.request.mode === 'interactive') {
      return requeueAfterActivation(agent, activation.message)
    }
  }
  const clean = [...messages]
  clean[index] = activation.message
  return { kind: 'enter', messages: clean }
}

/** Install the one-shot UI activation bridge on the native Agent loop. */
export function installFleetActivationBridge(
  ctx: Context,
  setups: FleetSetupService,
  runs: FleetRunService,
  assistant: FleetAssistantRuntime,
  meta: FleetMetaAssistantService,
): void {
  ctx.on('agent/pre-step', async (payload: {
    readonly agent: Agent
    readonly signal: AbortSignal
  }, next: () => Promise<PreStepDecision>) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    return activateFleetFromMessages(setups, payload.agent, decision.messages, payload.signal, { runs, assistant, meta })
  })
}
