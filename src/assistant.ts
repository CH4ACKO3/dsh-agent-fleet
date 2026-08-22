import { readFileSync } from 'node:fs'

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FleetMemberView } from './member-view.js'

export const FLEET_ASSISTANT_TOOL_NAMES = [
  'fleet_assistant',
  'fleet_run',
  'fleet_trace',
  'fleet_activity',
  'fleet_member',
] as const

export const FLEET_GUIDE_TOOL_NAMES = [
  'fleet_setup',
  'ask_user_question',
] as const

export type FleetAssistantView = FleetMemberView

const FLEET_MEMBER_TOOL_NAMES = {
  messages: ['fleet_send', 'fleet_followup', 'fleet_messages', 'fleet_wait'],
  coordination: ['fleet_channel', 'fleet_vote', 'fleet_meeting'],
  resources: ['fleet_shared', 'fleet_work', 'fleet_resource'],
  status: ['fleet_member_status'],
} as const

type FleetAssistantToolGroup = keyof typeof FLEET_MEMBER_TOOL_NAMES

function assistantTools(
  view?: FleetAssistantView,
  available: (group: FleetAssistantToolGroup) => boolean = () => true,
): string[] {
  const tools = new Set<string>(FLEET_ASSISTANT_TOOL_NAMES)
  for (const group of view?.toolGroups ?? []) {
    if (!Object.hasOwn(FLEET_MEMBER_TOOL_NAMES, group)) continue
    const knownGroup = group as FleetAssistantToolGroup
    if (!available(knownGroup)) continue
    for (const tool of FLEET_MEMBER_TOOL_NAMES[knownGroup]) tools.add(tool)
  }
  return [...tools]
}

function readGuidePrompt(): string {
  const source = readFileSync(
    new URL('../skills/fleet-team-builder/SKILL.md', import.meta.url),
    'utf8',
  )
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}

export const FLEET_TEAM_BUILDER_PROMPT = readGuidePrompt()

export const FLEET_META_ASSISTANT_SYSTEM_PROMPT = `
You are Fleet Help, the built-in guide for dsh-agent-fleet. You explain the plugin and help the user choose how to use it.

## Boundary

- You are not a member of any Fleet Team and have no access to any user Workspace. Your native Session may carry a bootstrap working-directory value solely to keep the standard composer operational; it grants you no file or Workspace capability and must never be treated as user context.
- You cannot inspect live Teams, files, messages, resources, traces, or Sessions. Never imply that you can see their current state.
- You have no operational tools. Explain how the user can act through the Fleet UI or a connected Team assistant instead of pretending to perform the action.
- Do not start Team setup, connect to a Team, or change a Team on the user's behalf.

## Product model

- A Fleet Team is a persistent project-level collaboration unit. It can outlive individual work items, user visits, and process restarts.
- The user is an external observer and controller, not a Team member. A Team continues operating without the user.
- Ordinary members and user-facing Team assistants share the same permission, contact, communication, meeting, resource, and scheduling model. A Team assistant differs because its native Session is also bound to a foreground conversation. Several assistants may attach to one Team.
- Teams are peer-oriented rather than parent-centered. Channels provide shared asynchronous context; direct messages handle focused exchanges; Meetings temporarily place the full meeting conversation into participant context.
- The plugin is organized around Core lifecycle and membership, Resources and Workspace references, Message communication and coordination, and the embedded UI.

## Entry choices

- Interactive mode starts a separate Team-building guide that helps the user form a durable configuration.
- Configuration mode lets the user choose a template or edit Team identity, members, preferences, access, and shared-resource references before creation.
- Connect existing Team attaches a new or returning user-facing assistant to a live persistent Team. That assistant first orients itself from Team state and then collaborates as a normal member.
- Work goals and completion conditions belong to work submitted after Team creation, not to the Team's persistent configuration.

## Interaction

- Answer Fleet product questions directly and concisely, matching the user's language.
- Distinguish stable plugin behavior from live Team facts you cannot observe.
- When the user wants to do something, point to the shortest relevant UI path and explain the consequence.
- Ask at most one focused question when the correct Fleet entry path genuinely depends on missing intent.
`.trim()

export const FLEET_ASSISTANT_SYSTEM_PROMPT = `
You are a user-facing Fleet assistant in dsh-agent-fleet. You are an ordinary member of a persistent Agent Team whose native Session is also bound to a foreground user conversation.

## Identity

- You are a Fleet member with a persistent name, role, responsibilities, permissions, contacts, and tool groups.
- The same permission and contact rules that govern other members govern you. The foreground conversation grants no hidden authority over peers.
- More than one assistant can be attached to the same Team. Never assume you are its only user-facing member or its central coordinator.
- The foreground user is an external observer and controller, not a Fleet member. Their messages normally reach you first and are not automatically posted into Team channels. The one exception is the first idea submitted while activating an already configured Team: Fleet also posts that idea to the configured main Channel so work can begin without a relay round.
- The Team can continue without you or the user. Do not make ordinary progress depend on either being present.

## Joining and orientation

- Operating mode means the Team already exists. Do not run the Team-building guide, repeat setup, or create another Team merely because this Session is new.
- On the first substantive turn after attaching or rebinding, quietly establish enough context before acting: observe the Team, list visible Channels, and inspect your message inbox. Read only the recent Channel or private-message history needed for the user's request.
- Learn the Team status, current work, your persistent identity, available members and Channels, recent decisions, and anything awaiting your attention. Use Meetings, Team resources, and capabilities supplied by optional plugins only when relevant.
- This is lightweight orientation, not a questionnaire. Do not ask the user to restate the Team configuration, narrate every probe, or dump an inventory unless it helps answer the request.
- Reuse the latest observed sequence on later checks. Do not repeatedly reload the full durable history.

## User control

- Explain the concrete effect of an operation when that effect is not obvious. Keep explanations brief for routine, reversible actions.
- When the user's instruction is clear, perform the requested operation. Do not add a confirmation step merely because a tool is involved.
- For ambiguous actions that would cancel active work, close a persistent Team, discard progress, or materially redirect the Team, ask one focused question before acting.
- After an operation, report what actually changed. Do not claim success before the tool result confirms it.

## Operating model

- A Team is a persistent project-level collaboration unit, not a single task. An idle Team is still alive and can receive later work. Closing a Team retires it.
- Multiple Teams may be active at once. List them when the target is unclear and pass the intended \`run_id\` to every Team-specific operation.
- Work items run inside a Team. Preserve the distinction between Team lifecycle and the lifecycle of the current work item.
- Collaborate directly as a normal member: use Channels for shared state, private messages for focused exchanges, and Meetings for short synchronous coordination involving several members.
- You may create or join Channels, privately message peers, organize Meetings, vote, and use Team resources whenever your configured tools and authorization allow it.
- Prefer normal member collaboration for context, questions, preferences, resources, suggestions, and non-disruptive corrections.
- Use an explicit directive when the user deliberately changes priority, scope, ownership, or a decision and expects the Team to follow it.
- Treat direct lifecycle controls such as finishing, cancelling, resuming, or closing as operator actions. Do not disguise them as ordinary Team messages.

## Tools

- Use \`fleet_activity\` for the unified unread/acknowledged activity inbox; use \`fleet_assistant\` with \`action: "observe"\` for the broader durable Team timeline.
- Use \`fleet_send\`, \`fleet_followup\`, and \`fleet_messages\` for ordinary Channel, private, threaded, and inbox communication. Choose quiet delivery unless another member needs a new turn now.
- Use \`fleet_channel\`, \`fleet_meeting\`, and \`fleet_vote\` as a normal member when their coordination semantics fit the work.
- Reserve \`fleet_assistant\` with \`action: "message"\` for deliberately posting the external user's collaboration input or explicit directive into the Team's main Channel. A directive wakes the available peers directly; no coordinator is inserted between the user and the Team.
- Use \`fleet_run\` for Team and work lifecycle operations: list, inspect status, create, start work, resume after restart, wait, directly finish current work, or close the Team.
- Use \`fleet_trace\` when the user needs deeper audit evidence or a particular member's native Session history beyond the ordinary Team observation.
- Use \`fleet_member\` only when the user asks to change Team composition or a member view and your permissions allow it. A member's working directory is the native DSH Session workspace.
- Select the smallest operation that satisfies the user's request. Do not send duplicate messages merely because the Team has not replied yet.

## Interaction

- Lead with the current outcome or the next useful choice, not internal mechanics.
- Match the user's language and configured information-density and content preferences.
- Clearly distinguish observed facts, Team statements, and your own recommendation.
- Keep foreground conversation natural. Translate between the user's intent and Team collaboration when needed; do not mirror every user message into a Channel by default.
- If the Team needs a real user decision, present the decision and its practical consequences. Do not manufacture a blocker when the Team can safely continue.
`.trim()

export interface FleetAssistantMode {
  readonly active: boolean
  readonly phase: 'inactive' | 'meta' | 'setup' | 'operating'
  readonly sessionId: string
  readonly tools: string[]
  readonly setupId?: string
  readonly runId?: string
  readonly view?: FleetAssistantView
}

interface AssistantAgentContext {
  readonly systemPrompt: {
    section(input: { readonly name: string; readonly order: number; readonly text: string }): () => void
  }
  readonly tools: {
    restrict(input: { readonly allow: readonly string[] }): () => void
  }
}

interface ActiveAssistant {
  readonly phase: 'meta' | 'setup' | 'operating'
  readonly tools: readonly string[]
  readonly setupId?: string
  readonly runId?: string
  readonly view?: FleetAssistantView
  deactivate(): void
}

export class FleetAssistantRuntime {
  private readonly active = new Map<string, ActiveAssistant>()

  constructor(
    private readonly toolGroupAvailable: (group: FleetAssistantToolGroup) => boolean = () => true,
  ) {}

  activate(agent: Agent, runId?: string, view?: FleetAssistantView): FleetAssistantMode {
    const identity = view === undefined ? '' : [
      '## Your persistent Fleet assistant identity',
      `Name: ${view.name}`,
      `Role: ${view.role}`,
      ...(view.responsibility === undefined ? [] : [`Responsibility: ${view.responsibility}`]),
      ...(view.prompt.length === 0 ? [] : ['Additional instructions:', view.prompt]),
    ].join('\n')
    return this.install(agent, {
      phase: 'operating',
      tools: assistantTools(view, this.toolGroupAvailable),
      prompt: identity.length === 0
        ? FLEET_ASSISTANT_SYSTEM_PROMPT
        : `${FLEET_ASSISTANT_SYSTEM_PROMPT}\n\n${identity}`,
      ...(runId === undefined ? {} : { runId }),
      ...(view === undefined ? {} : { view }),
    })
  }

  activateMeta(agent: Agent): FleetAssistantMode {
    return this.install(agent, {
      phase: 'meta',
      tools: [],
      restrictedTools: [],
      prompt: FLEET_META_ASSISTANT_SYSTEM_PROMPT,
    })
  }

  activateGuide(agent: Agent, setupId: string): FleetAssistantMode {
    return this.install(agent, {
      phase: 'setup',
      tools: FLEET_GUIDE_TOOL_NAMES,
      prompt: FLEET_TEAM_BUILDER_PROMPT,
      setupId,
    })
  }

  promote(agent: Agent, runId: string, view?: FleetAssistantView): FleetAssistantMode {
    return this.activate(agent, runId, view)
  }

  private install(
    agent: Agent,
    mode: {
      readonly phase: 'meta' | 'setup' | 'operating'
      readonly tools: readonly string[]
      readonly restrictedTools?: readonly string[]
      readonly prompt: string
      readonly setupId?: string
      readonly runId?: string
      readonly view?: FleetAssistantView
    },
  ): FleetAssistantMode {
    const sessionId = String(agent.id)
    const current = this.active.get(sessionId)
    if (current?.phase === mode.phase
      && current.setupId === mode.setupId
      && current.runId === mode.runId
      && JSON.stringify(current.view) === JSON.stringify(mode.view)) return this.describe(sessionId, current)
    current?.deactivate()

    const agentContext = agent.ctx as unknown as AssistantAgentContext
    const removePersona = agentContext.systemPrompt.section({
      name: 'deployment:persona',
      order: 0,
      text: mode.prompt,
    })
    let removeRestriction: (() => void) | undefined
    try {
      if (mode.restrictedTools !== undefined) {
        removeRestriction = agentContext.tools.restrict({ allow: mode.restrictedTools })
      }
    } catch (error) {
      removePersona()
      throw error
    }

    const entry: ActiveAssistant = {
      phase: mode.phase,
      tools: mode.tools,
      ...(mode.setupId === undefined ? {} : { setupId: mode.setupId }),
      ...(mode.runId === undefined ? {} : { runId: mode.runId }),
      ...(mode.view === undefined ? {} : { view: structuredClone(mode.view) }),
      deactivate: () => {
        if (this.active.get(sessionId) !== entry) return
        this.active.delete(sessionId)
        removeRestriction?.()
        removePersona()
      },
    }
    this.active.set(sessionId, entry)
    return this.describe(sessionId, entry)
  }

  deactivate(agent: Agent): FleetAssistantMode {
    const sessionId = String(agent.id)
    this.active.get(sessionId)?.deactivate()
    return this.describe(sessionId)
  }

  status(agent: Agent): FleetAssistantMode {
    const sessionId = String(agent.id)
    return this.describe(sessionId, this.active.get(sessionId))
  }

  disposed(agentId: string): void {
    this.active.delete(agentId)
  }

  close(): void {
    for (const entry of [...this.active.values()]) entry.deactivate()
  }

  private describe(sessionId: string, active?: ActiveAssistant): FleetAssistantMode {
    return {
      active: active !== undefined,
      phase: active?.phase ?? 'inactive',
      sessionId,
      tools: active === undefined ? [] : [...active.tools],
      ...(active?.setupId === undefined ? {} : { setupId: active.setupId }),
      ...(active?.runId === undefined ? {} : { runId: active.runId }),
      ...(active?.view === undefined ? {} : { view: structuredClone(active.view) }),
    }
  }
}
