import { unlinkSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { installMessageTools, MessageHub } from '@dsh-agent-fleet/message'
import type {
  FleetMessage,
  FleetMessagePermission,
  MessageAgent,
} from '@dsh-agent-fleet/message'
import { FleetMemberStatusBoard, installCollaborationTools } from '@dsh-agent-fleet/core'
import { FleetResources, installResourceTools } from '@dsh-agent-fleet/resources'

import type { FleetAuthorizationService } from './authorization.js'
import type { FleetMemberToolGroup, FleetMemberView } from './member-view.js'
import { FLEET_TOOL_CATALOG, fleetToolHasAuthorizedAction } from './tool-discovery.js'
import type { FleetTaskBoard } from './productivity/task.js'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SPECIAL_TOOL_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  'joyride.control': ['joyride_catalog', 'joyride_act', 'joyride_control'],
  'livestream.host': ['live_stream', 'live_stage'],
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ToolBinding {
  readonly ctx: Context
  readonly member: string
  readonly exposeHostFleetTools: boolean
  readonly toolGroups?: readonly FleetMemberToolGroup[]
  residentTools: Set<string>
  installTool: (name: string) => void
  stop: () => void
}

export interface ToolBindingResult {
  readonly residentTools: Set<string>
  readonly installTool: (name: string) => void
  readonly stop: () => void
}

export interface ToolBindingDependencies {
  readonly teamId: string
  readonly projectRoot: string
  readonly sharedDirectory: string
  readonly authorization: FleetAuthorizationService
  readonly memberViews: ReadonlyMap<string, FleetMemberView>
  readonly memberNamesById: ReadonlyMap<string, string>
  readonly defaultVoterNames: ReadonlySet<string>
  readonly messages: MessageHub
  readonly tasks: FleetTaskBoard
  readonly memberStatuses: FleetMemberStatusBoard
  readonly resources: FleetResources
  readonly assistantNames: ReadonlySet<string>
  readonly ensureMessageTasks: (message: FleetMessage) => string[]
  readonly hasPendingRequirement: (member: string) => boolean
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Restrict special-opt-in tools (joyride, livestream) that the member
 * has not explicitly been granted.  Combines the filtering that was
 * previously split across two separate blocks in `createToolBinding`.
 */
function restrictDeniedSpecialTools(
  ctx: Context,
  permissions: ReadonlySet<string>,
  view: FleetMemberView,
): (() => void) | void {
  const denied = Object.entries(SPECIAL_TOOL_PERMISSIONS)
    .filter(([permission]) => !permissions.has(permission))
    .flatMap(([, names]) => names)
  const stops: Array<() => void> = []

  const installedDenied = denied.filter(name => ctx.tools.get(name) !== undefined)
  if (installedDenied.length > 0) {
    const stop = ctx.tools.restrict({ deny: installedDenied })
    if (stop !== undefined) stops.push(stop)
  }

  if (denied.length > 0) {
    const deniedSet = new Set(denied)
    const stop = ctx.tools.guard(execution =>
      deniedSet.has(execution.name)
        ? `Fleet member @${view.id} is not permitted to use ${execution.name}`
        : undefined,
    )
    if (stop !== undefined) stops.push(stop)
  }

  if (stops.length === 0) return undefined
  return () => { for (const stop of stops) stop() }
}

/* ------------------------------------------------------------------ */
/*  Core binding creation                                              */
/* ------------------------------------------------------------------ */

/**
 * Create a tool binding for one Fleet member: resolve their effective
 * tool groups and permissions, install the correct tools, and return
 * a handle that the caller can refresh or dispose.
 *
 * This is a pure function — all external dependencies are passed
 * through `deps` rather than captured from a surrounding closure.
 */
export function createToolBinding(
  ctx: Context,
  member: string,
  deps: ToolBindingDependencies,
  options?: {
    readonly exposeHostFleetTools?: boolean
    readonly toolGroups?: readonly FleetMemberToolGroup[]
  },
): ToolBindingResult {
  const view = deps.memberViews.get(member)
  if (view === undefined) throw new Error(`unknown Fleet member view ${member}`)
  const effective = deps.authorization.resolve(deps.teamId, view)
  const tools = new Set(options?.toolGroups ?? effective.toolGroups)
  const permissions = new Set(effective.actions)

  const authorize = (
    agentId: string,
    action: string,
    resource?: { readonly kind: string; readonly id: string },
  ): boolean => {
    const actor = deps.memberNamesById.get(agentId)
    if (actor === undefined) return false
    return deps.authorization.authorize({
      teamId: deps.teamId,
      subject: { kind: deps.defaultVoterNames.has(actor) ? 'member' : 'assistant', id: actor },
      action,
      resource: resource ?? { kind: 'team', id: deps.teamId },
    })
  }

  const resourceTarget = (
    kind: 'shared' | 'resource' | 'file' | 'work',
    id?: string,
  ): { readonly kind: string; readonly id: string } | undefined => {
    if (kind === 'work' || (kind === 'resource' && id === undefined)) return undefined
    return { kind: kind === 'shared' ? 'file' : kind, id: id ?? '*' }
  }

  const messagePermissions = new Set<FleetMessagePermission>(
    effective.actions.filter((permission): permission is FleetMessagePermission =>
      permission === 'channel.manage' || permission === 'meeting.manage' || permission === 'vote.create',
    ),
  )

  const authorizationNamespaces = new Map(deps.authorization.namespaces()
    .map(namespace => [namespace.namespace, namespace]))
  const visibleNamespaces = new Map([...authorizationNamespaces.values()]
    .filter(namespace => deps.authorization.visible(namespace, effective))
    .map(namespace => [namespace.namespace, namespace]))

  /* Determine which tools this member is allowed to see. */
  const allowed = new Set<string>()
  for (const entry of FLEET_TOOL_CATALOG) {
    if (entry.source === 'host') {
      if (!(options?.exposeHostFleetTools ?? false) && entry.name !== 'fleet_resurrect') continue
      if (ctx.tools.get(entry.name) === undefined) continue
      if (entry.name === 'fleet_member' && !permissions.has('team.manage') && !effective.op) continue
      allowed.add(entry.name)
      continue
    }
    if (entry.source === 'namespace') {
      if (entry.namespace !== undefined && (visibleNamespaces.has(entry.namespace)
        || entry.namespace === 'task')) allowed.add(entry.name)
      continue
    }
    if (entry.source === 'messages' && tools.has('messages')) allowed.add(entry.name)
    else if (entry.source === 'status' && tools.has('status')) allowed.add(entry.name)
    else if (entry.source === 'coordination' && tools.has('coordination')) allowed.add(entry.name)
    else if (entry.source === 'resources' && tools.has('resources')) allowed.add(entry.name)
  }

  const residentTools = new Set<string>()
  const localStops: Array<() => void> = []
  const add = (stop: (() => void) | void): (() => void) | void => {
    if (stop !== undefined) localStops.push(stop)
    return stop
  }

  /* Install resident communication + task tools always present. */
  add(installTaskMessageTools(ctx, deps))
  residentTools.add('fleet_inbox')
  residentTools.add('fleet_reply')

  let hostRestrictionStop: (() => void) | undefined
  const refreshHostRestriction = (): void => {
    hostRestrictionStop?.()
    const deny = [
      'fleet_agent', 'fleet_archive', 'fleet_setup',
      'fleet_trace', 'fleet_activity',
      ...FLEET_TOOL_CATALOG
        .filter(entry =>
          entry.source === 'host'
          && (!allowed.has(entry.name) || !residentTools.has(entry.name)),
        )
        .map(entry => entry.name),
    ]
    hostRestrictionStop = ctx.tools.restrict({ deny: [...new Set(deny)] })
  }

  /* Install a single tool by name, skipping if already installed. */
  const installTool = (name: string): void => {
    if (!allowed.has(name) || residentTools.has(name)) return
    const entry = FLEET_TOOL_CATALOG.find(candidate => candidate.name === name)
    if (entry === undefined) return
    const available = entry.namespace === 'task'
      || (entry.name === 'fleet_task' && deps.hasPendingRequirement(member))
      || fleetToolHasAuthorizedAction(entry, permissions)
    if (!available) return
    let stop: (() => void) | void = undefined
    if (entry.source === 'messages' || entry.source === 'coordination') {
      stop = installMessageTools(ctx, deps.messages as never, {
        messages: entry.source === 'messages',
        coordination: entry.source === 'coordination',
        tools: new Set([name]),
        permissions: messagePermissions,
        authorize,
        directReplyByDefault: deps.assistantNames.has(member),
        reconcileMessageTasks: (caller: Agent, messageId: string) =>
          deps.ensureMessageTasks(deps.messages.getMessage(caller, messageId)),
      })
    } else if (entry.source === 'status') {
      stop = installCollaborationTools(ctx, deps.memberStatuses as never, { tools: new Set([name]), authorize })
    } else if (entry.source === 'resources') {
      stop = installResourceTools(ctx, deps.resources, {
        tools: new Set([name]),
        projectRoot: deps.projectRoot,
        sharedDirectory: deps.sharedDirectory,
        canRead: (agentId, kind, id) => authorize(
          agentId,
          kind === 'work' ? 'work.read' : 'resource.read',
          resourceTarget(kind, id),
        ),
        canWrite: (agentId, kind, id) => authorize(
          agentId,
          kind === 'work' ? 'work.claim' : 'resource.write',
          resourceTarget(kind, id),
        ),
        resourceWrite: permissions.has('resource.write'),
        deleteShared: path => {
          const root = resolve(deps.projectRoot, deps.sharedDirectory)
          const target = resolve(root, path)
          const nested = relative(root, target)
          if (nested === '' || nested === '..' || nested.startsWith(`..${sep}`) || isAbsolute(nested)) {
            throw new Error('Fleet shared delete path must stay inside the Team shared directory')
          }
          unlinkSync(target)
        },
      })
    } else if (entry.source === 'namespace' && entry.namespace !== undefined) {
      const namespace = visibleNamespaces.get(entry.namespace)
        ?? (entry.namespace === 'task'
          ? authorizationNamespaces.get(entry.namespace)
          : undefined)
      if (namespace?.installTools === undefined) return
      const namespaceTools = FLEET_TOOL_CATALOG
        .filter(candidate => candidate.source === 'namespace'
          && candidate.namespace === entry.namespace
          && allowed.has(candidate.name))
        .map(candidate => candidate.name)
      if (namespaceTools.some(tool => residentTools.has(tool))) {
        for (const tool of namespaceTools) residentTools.add(tool)
        return
      }
      stop = namespace.installTools(ctx, {
        teamId: deps.teamId,
        projectRoot: deps.projectRoot,
        member: view,
        hasMember: candidate => deps.memberViews.has(candidate),
        authorization: effective,
      })
      for (const tool of namespaceTools) residentTools.add(tool)
    } else if (entry.source === 'host') {
      residentTools.add(name)
      return
    }
    add(stop)
    residentTools.add(name)
  }

  /* Install all allowed tools with error recovery. */
  try {
    for (const name of allowed) installTool(name)
    const specialStop = restrictDeniedSpecialTools(ctx, permissions, view)
    add(specialStop)
    refreshHostRestriction()
  } catch (error) {
    hostRestrictionStop?.()
    for (const stop of localStops.reverse()) stop()
    throw error
  }

  return {
    residentTools,
    installTool,
    stop: () => {
      hostRestrictionStop?.()
      for (const stop of localStops.reverse()) stop()
    },
  }
}

/* ------------------------------------------------------------------ */
/*  Binding lifecycle manager                                          */
/* ------------------------------------------------------------------ */

/**
 * Manages the full set of tool bindings for a Fleet team, providing
 * deterministic install / refresh / dispose lifecycle.
 *
 * Replaces the earlier pattern of a bare `Set<ToolBinding>` plus
 * `revealRequiredTaskTool` empty-then-reassign and duplicate
 * `queueMicrotask` calls.
 */
export class ToolBindingManager {
  private readonly bindings = new Set<ToolBinding>()

  constructor(private readonly deps: ToolBindingDependencies) {}

  /** Create and register a binding for one member. */
  install(
    ctx: Context,
    member: string,
    options?: {
      readonly exposeHostFleetTools?: boolean
      readonly toolGroups?: readonly FleetMemberToolGroup[]
    },
  ): ToolBinding {
    const result = createToolBinding(ctx, member, this.deps, options)
    const binding: ToolBinding = {
      ctx,
      member,
      exposeHostFleetTools: options?.exposeHostFleetTools ?? false,
      ...(options?.toolGroups === undefined ? {} : { toolGroups: [...options.toolGroups] }),
      residentTools: result.residentTools,
      installTool: result.installTool,
      stop: result.stop,
    }
    this.bindings.add(binding)
    /* Single deterministic call — no queueMicrotask duplicate. */
    if (this.deps.hasPendingRequirement(member)) result.installTool('fleet_task')
    return binding
  }

  /** Unregister and stop a binding. */
  remove(binding: ToolBinding): boolean {
    if (!this.bindings.delete(binding)) return false
    binding.stop()
    return true
  }

  /** Dispose all bindings for one member. */
  dispose(member: string): void {
    for (const binding of [...this.bindings]) {
      if (binding.member === member) {
        this.bindings.delete(binding)
        binding.stop()
      }
    }
  }

  /** Destroy and recreate a single binding (rebinds tools). */
  refresh(binding: ToolBinding): void {
    binding.stop()
    const opts: Record<string, boolean | readonly string[]> = {}
    if (binding.exposeHostFleetTools !== undefined) opts.exposeHostFleetTools = binding.exposeHostFleetTools
    if (binding.toolGroups !== undefined) opts.toolGroups = binding.toolGroups
    const result = createToolBinding(binding.ctx, binding.member, this.deps, opts)
    binding.residentTools = result.residentTools
    binding.installTool = result.installTool
    binding.stop = result.stop
    if (this.deps.hasPendingRequirement(binding.member)) result.installTool('fleet_task')
  }

  /** Refresh every matching binding (used when permissions change). */
  refreshAccess(member?: string): void {
    for (const binding of [...this.bindings]) {
      if (member === undefined || binding.member === member) this.refresh(binding)
    }
  }

  /**
   * Ensure `fleet_task` is available for a member that now has a pending
   * Reply Task.  Replaces the old `revealRequiredTaskTool` pattern.
   */
  ensureFleetTaskTool(member: string): void {
    for (const binding of [...this.bindings]) {
      if (binding.member === member && this.deps.hasPendingRequirement(member)) {
        binding.installTool('fleet_task')
      }
    }
  }

  /** Close all bindings. */
  close(): void {
    for (const binding of this.bindings) binding.stop()
    this.bindings.clear()
  }

  /** Iterate over all active bindings. */
  entries(): IterableIterator<ToolBinding> {
    return this.bindings.values()
  }
}

/* ------------------------------------------------------------------ */
/*  Shared task-message tool install (moved from collaboration.ts)     */
/* ------------------------------------------------------------------ */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'

const TASK_MESSAGE_OUTPUT = {
  schema: { type: 'object', additionalProperties: true } as const,
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

function taskMessageResult(value: object): Record<string, JsonValue> {
  return structuredClone(value) as unknown as Record<string, JsonValue>
}

function taskMessageSearchView(message: FleetMessage): FleetMessage & {
  readonly textRange?: { readonly start: number; readonly end: number; readonly total: number }
} {
  const maximum = 500
  if (message.text.length <= maximum) return message
  return {
    ...message,
    text: message.text.slice(0, maximum),
    textRange: { start: 0, end: maximum, total: message.text.length },
  }
}

function taskToolCaller(agent: { readonly id: string } | undefined, tool: string): MessageAgent {
  if (agent === undefined) throw new Error(`${tool} requires a calling Agent`)
  return agent as MessageAgent
}

/**
 * Install `fleet_inbox` and `fleet_reply` tools for the calling member.
 * Extracted from `collaboration.ts` so it can be shared by the tool-binding module.
 */
export function installTaskMessageTools(
  ctx: Context,
  deps: {
    readonly messages: MessageHub
    readonly tasks: FleetTaskBoard
  },
): () => void {
  const stops: Array<() => void> = []
  const syncInbox = (agent: MessageAgent): ReturnType<NonNullable<ToolBindingDependencies['tasks']['syncInbox']>> => {
    const summary = deps.messages.taskUnreadSummary(String(agent.id))
    return deps.tasks.syncInbox(String(agent.id), summary.unreadMessages, summary.unreadChars)
  }
  stops.push(ctx.tools.register(defineTool({
    name: 'fleet_inbox',
    description: 'Inspect or consume the calling member persistent Inbox Task across all visible message sources. Reading advances durable unread progress; searching does not.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'read', 'search', 'text'] },
      max_chars: { type: 'integer' },
      query: { type: 'string' },
      conversation: { type: 'string' },
      from: { type: 'string' },
      resource: { type: 'string' },
      limit: { type: 'integer' },
      message_id: { type: 'string' },
      offset: { type: 'integer' },
    },
    output: TASK_MESSAGE_OUTPUT,
    execute(args, exec) {
      const agent = taskToolCaller(exec.agent, 'fleet_inbox')
      const callerId = String(agent.id)
      if (args.action === 'status') {
        const task = syncInbox(agent)
        return Promise.resolve(taskMessageResult({ action: 'status', task: fleetTaskToolDetail(task), summary: deps.messages.unreadSummary(callerId) }))
      }
      if (args.action === 'read') {
        const result = deps.messages.readInbox(agent, args.max_chars ?? 12_000)
        const task = syncInbox(agent)
        return Promise.resolve(taskMessageResult({ action: 'read', ...result, task: fleetTaskToolDetail(task) }))
      }
      if (args.action === 'search') {
        return Promise.resolve(taskMessageResult({ action: 'search', messages: deps.messages.search(agent, {
          ...(args.query === undefined ? {} : { query: args.query }),
          ...(args.conversation === undefined ? {} : { conversation: args.conversation as never }),
          ...(args.from === undefined ? {} : { from: args.from }),
          ...(args.resource === undefined ? {} : { resource: args.resource }),
          limit: args.limit ?? 10,
        }).map(taskMessageSearchView) }))
      }
      if (args.message_id === undefined) throw new Error('fleet_inbox text requires message_id')
      const chunk = deps.messages.readMessageText(agent, args.message_id, args.offset, args.limit ?? 12_000)
      const task = syncInbox(agent)
      return Promise.resolve(taskMessageResult({ action: 'text', chunk, task: fleetTaskToolDetail(task) }))
    },
  })))
  stops.push(ctx.tools.register(defineTool({
    name: 'fleet_reply',
    description: 'Promptly answer or acknowledge one owned Reply Task before starting long work. Omit id when exactly one Reply Task is pending; Fleet binds it automatically. The first visible reply completes the response obligation; later progress or results may be posted with fleet_send and reply_to.',
    parameters: {
      id: { type: 'string', description: 'Owned Reply Task id. Optional when exactly one Reply Task is pending.' },
      content: { type: 'string', required: true, description: 'Actual response sent back to the source conversation.' },
      resources: { type: 'array', items: { type: 'string' } },
    },
    output: TASK_MESSAGE_OUTPUT,
    execute(args, exec) {
      const agent = taskToolCaller(exec.agent, 'fleet_reply')
      const callerId = String(agent.id)
      const pending = deps.tasks.ownerTasks(callerId).filter(candidate => candidate.domain.kind === 'reply')
      let task = args.id === undefined ? undefined : pending.find(candidate => candidate.id === args.id)
      if (task === undefined && args.id !== undefined) {
        try {
          const explicit = deps.tasks.get(callerId, args.id)
          if (explicit.domain.kind === 'reply' && explicit.domain.completionMessageId !== undefined) task = explicit
        } catch {}
      }
      if (task === undefined && pending.length === 1) task = pending[0]
      if (task === undefined) {
        if (pending.length === 0) throw new Error('No owned Reply Task is pending; use fleet_send for a new or optional message')
        throw new Error(`Multiple Reply Tasks are pending; choose one of: ${pending.map(candidate => candidate.id).join(', ')}`)
      }
      if (task.domain.kind !== 'reply') throw new Error(`Fleet task ${args.id} is not a Reply Task`)
      const domain = task.domain
      const completionInstruction = deps.tasks.interactionTask(callerId) === undefined
        ? `Reply delivered and Reply Task completed. If you accepted work, continue it now and later post the result with fleet_send reply_to="${domain.messageId}". End only when no work remains.`
        : 'Reply delivered and Reply Task completed. Do not repeat or narrate a delivery confirmation. Continue only if the current user Interaction still has unfinished work.'
      if (domain.completionMessageId !== undefined) {
        return Promise.resolve(taskMessageResult({
          action: 'reply',
          task: fleetTaskToolDetail(task),
          messageId: domain.completionMessageId,
          sourceMessageId: domain.messageId,
          replayed: true,
          instruction: completionInstruction,
        }))
      }
      if (!deps.tasks.ownerTasks(callerId).some(candidate => candidate.id === task.id)) {
        throw new Error(`Fleet Reply Task ${args.id} is not owned by the calling member`)
      }
      const source = deps.messages.getMessage(agent, domain.messageId)
      const existing = deps.messages.search(agent, { conversation: domain.replyTarget as never, limit: 100 })
        .find(message => message.from === domain.assignee && message.replyTo === source.id)
      const messageId = existing?.id ?? deps.messages.reply(agent, {
        messageId: source.id,
        text: args.content,
        ...(args.resources === undefined ? {} : { resources: args.resources }),
      }).messageId
      deps.messages.completeRequiredReply(callerId, source.id)
      const result = taskMessageResult({
        action: 'reply',
        messageId,
        sourceMessageId: domain.messageId,
        replayed: existing !== undefined,
        task: fleetTaskToolDetail(deps.tasks.recordReply(callerId, task.id, messageId)),
        instruction: completionInstruction,
      })
      return Promise.resolve(result)
    },
  })))
  return () => { for (const stop of stops.reverse()) stop() }
}

/**
 * Minimal detail view needed for task message tools.
 * Imported from ./productivity/task.js in non-extracted code.
 */
import { fleetTaskToolDetail } from './productivity/task.js'