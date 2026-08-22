import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { FleetMemberPermission, FleetMemberToolGroup } from './member-view.js'

interface FleetToolCatalogEntry {
  readonly name: string
  readonly group: FleetMemberToolGroup
  readonly description: string
  readonly keywords: string
  readonly actions: readonly string[]
  readonly privilegedActions?: Readonly<Record<string, string | readonly string[]>>
  readonly constraints?: readonly string[]
}

const FLEET_TOOL_CATALOG: readonly FleetToolCatalogEntry[] = [
  { name: 'fleet_send', group: 'messages', description: 'Send a quiet channel or private message.', keywords: 'message chat dm channel send 通讯 消息 私聊 频道 发送', actions: ['send'] },
  { name: 'fleet_followup', group: 'messages', description: 'Wake or urgently interrupt a member with a follow-up.', keywords: 'message wake interrupt mention urgent followup 唤醒 打断 紧急 @ 跟进', actions: ['send'] },
  { name: 'fleet_messages', group: 'messages', description: 'Read, search, continue, acknowledge, react to, or pin messages.', keywords: 'message history inbox read search chunk text 消息 历史 收件箱 搜索 分段 续读', actions: ['read', 'search', 'inbox', 'ack', 'react', 'reactions', 'pin', 'unpin', 'pins', 'text'] },
  { name: 'fleet_wait', group: 'messages', description: 'Wait briefly for visible Fleet changes.', keywords: 'wait change idle poll 等待 变化', actions: ['wait'] },
  { name: 'fleet_member_status', group: 'status', description: 'Read or update members current work status.', keywords: 'member status progress presence 状态 进度 成员', actions: ['list', 'get', 'set', 'clear'] },
  { name: 'fleet_channel', group: 'coordination', description: 'List and manage shared channels.', keywords: 'channel topic group archive 频道 群聊 主题 归档', actions: ['list', 'create', 'update', 'archive'], privilegedActions: { create: 'channel.manage', update: 'channel.manage', archive: 'channel.manage' } },
  { name: 'fleet_vote', group: 'coordination', description: 'Create, inspect, or cast a Team vote.', keywords: 'vote consensus approve reject decision 投票 共识 同意 拒绝 决策', actions: ['list', 'get', 'create', 'cast'], privilegedActions: { create: 'vote.create' } },
  { name: 'fleet_meeting', group: 'coordination', description: 'Open, join, inspect, or close a meeting.', keywords: 'meeting agenda decision participants 会议 议程 决议 参会', actions: ['list', 'open', 'join', 'leave', 'close'], privilegedActions: { open: 'meeting.manage', close: 'meeting.manage' }, constraints: ['close is additionally limited to the meeting initiator'] },
  { name: 'fleet_shared', group: 'resources', description: 'List, read, and update files in the Team resource directory.', keywords: 'team resource shared file 团队 资源 共享 文件', actions: ['list', 'read', 'write'], privilegedActions: { write: 'resource.write' } },
  { name: 'fleet_work', group: 'resources', description: 'Claim or release workspace paths before editing.', keywords: 'work claim release conflict path workspace 占用 释放 冲突 路径 工作区', actions: ['list', 'claim', 'release'], privilegedActions: { claim: 'resource.write', release: 'resource.write' } },
  { name: 'fleet_resource', group: 'resources', description: 'Add, list, or inspect file and binary resource references.', keywords: 'resource file binary artifact attachment 资源 文件 二进制 产物 附件', actions: ['list', 'get', 'add'], privilegedActions: { add: 'resource.write' } },
  { name: 'fleet_git', group: 'git', description: 'Check the permitted Git scope and create member worktrees.', keywords: 'git worktree scope branch 范围 工作树 分支', actions: ['scope', 'check', 'create_worktree'], privilegedActions: { scope: 'git.inspect', check: 'git.scope-check', create_worktree: 'git.worktree-create' }, constraints: ['ordinary Git operations use the terminal after scope checking', 'another member worktree additionally requires git.worktree-manage'] },
] as const

const TOOL_DISCOVERY_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matches: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          group: { type: 'string', required: true },
          description: { type: 'string', required: true },
          loaded: { type: 'boolean', required: true },
          actions: { type: 'array', required: true, items: { type: 'string' } },
          restrictedActions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                action: { type: 'string', required: true },
                permissions: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
          constraints: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
    },
    loadedGroups: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '_')
}

export function searchFleetTools(
  query: string,
  allowedGroups: ReadonlySet<FleetMemberToolGroup>,
  loadedGroups: ReadonlySet<FleetMemberToolGroup>,
  permissions: ReadonlySet<string> = new Set(),
): Array<Omit<FleetToolCatalogEntry, 'keywords' | 'actions' | 'privilegedActions' | 'constraints'> & {
  readonly loaded: boolean
  readonly actions: string[]
  readonly restrictedActions: Array<{ readonly action: string; readonly permissions: string[] }>
  readonly constraints: string[]
}> {
  const normalized = normalize(query)
  const tokens = normalized.split(/[^\p{L}\p{N}_@]+/u).filter(Boolean)
  return FLEET_TOOL_CATALOG
    .filter(entry => allowedGroups.has(entry.group))
    .map(entry => {
      const haystack = normalize(`${entry.name} ${entry.group} ${entry.description} ${entry.keywords}`)
      const compactHaystack = haystack.replaceAll(' ', '')
      const compactQuery = normalized.replaceAll(' ', '')
      let score = normalized.length === 0 ? 1 : 0
      if (normalize(entry.name) === normalized || normalize(entry.group) === normalized) score += 100
      if (normalized.length > 0 && haystack.includes(normalized)) score += 30
      if (compactQuery.length > 0 && compactHaystack.includes(compactQuery)) score += 30
      score += tokens.filter(token => haystack.includes(token)).length * 10
      return { entry, score }
    })
    .filter(candidate => normalized.length === 0 || candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))
    .slice(0, 8)
    .map(({ entry }) => ({
      name: entry.name,
      group: entry.group,
      description: entry.description,
      loaded: loadedGroups.has(entry.group),
      actions: entry.actions.filter(action => {
        const required = entry.privilegedActions?.[action]
        return required === undefined || (typeof required === 'string'
          ? permissions.has(required)
          : required.every(permission => permissions.has(permission)))
      }),
      restrictedActions: entry.actions.flatMap(action => {
        const required = entry.privilegedActions?.[action]
        if (required === undefined) return []
        const requiredPermissions = typeof required === 'string' ? [required] : [...required]
        return requiredPermissions.every(permission => permissions.has(permission))
          ? []
          : [{ action, permissions: requiredPermissions }]
      }),
      constraints: [...(entry.constraints ?? [])],
    }))
    .filter(entry => entry.actions.length > 0)
}

export function installFleetToolDiscovery(
  ctx: Context,
  options: {
    readonly allowedGroups: ReadonlySet<FleetMemberToolGroup>
    readonly loadedGroups: Set<FleetMemberToolGroup>
    readonly permissions: ReadonlySet<string>
    readonly load: (group: FleetMemberToolGroup) => (() => void) | void
  },
): () => void {
  const loadedStops = new Map<FleetMemberToolGroup, () => void>()
  const stopDiscovery = ctx.tools.register(defineTool({
    name: 'fleet_tools',
    description: 'Discover optional Fleet capabilities without keeping every tool schema in context. Search by intent, then load a returned tool name or group. Loaded groups remain available for this Agent session.',
    parameters: {
      action: { type: 'string', enum: ['search', 'load', 'list'], description: 'Defaults to search.' },
      query: { type: 'string', description: 'Natural-language capability, tool name, or group name to search.' },
      name: { type: 'string', description: 'Exact Fleet tool name or group returned by search; required for load.' },
    },
    output: {
      schema: TOOL_DISCOVERY_RESULT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      if ((args.action ?? 'search') === 'load') {
        if (args.name === undefined) throw new Error('fleet_tools load requires name')
        const normalized = normalize(args.name)
        const entry = FLEET_TOOL_CATALOG.find(candidate => normalize(candidate.name) === normalized)
        const group = entry?.group ?? ([...options.allowedGroups].find(candidate => normalize(candidate) === normalized))
        if (group === undefined || !options.allowedGroups.has(group)) {
          throw new Error(`Fleet tool or group ${args.name} is not available to this member`)
        }
        if (!options.loadedGroups.has(group)) {
          const stop = options.load(group)
          if (stop !== undefined) loadedStops.set(group, stop)
          options.loadedGroups.add(group)
        }
        return {
          matches: searchFleetTools(group, options.allowedGroups, options.loadedGroups, options.permissions),
          loadedGroups: [...options.loadedGroups],
        }
      }
      return {
        matches: searchFleetTools(args.action === 'list' ? '' : (args.query ?? ''), options.allowedGroups, options.loadedGroups, options.permissions),
        loadedGroups: [...options.loadedGroups],
      }
    },
  }))
  return () => {
    stopDiscovery()
    for (const stop of [...loadedStops.values()].reverse()) stop()
    loadedStops.clear()
  }
}
