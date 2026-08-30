import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import type { FleetMemberToolGroup } from './member-view.js'

export type FleetToolSource = 'host' | 'messages' | 'status' | 'coordination' | 'resources' | 'namespace'

export interface FleetToolCatalogEntry {
  readonly name: string
  readonly group: FleetMemberToolGroup | 'core' | 'administration'
  readonly family: string
  readonly source: FleetToolSource
  readonly namespace?: string
  readonly description: string
  readonly keywords: string
  readonly aliases?: readonly string[]
  readonly actions: readonly string[]
  readonly privilegedActions?: Readonly<Record<string, string | readonly string[]>>
  readonly constraints?: readonly string[]
}

export const FLEET_TOOL_CATALOG: readonly FleetToolCatalogEntry[] = [
  { name: 'fleet_send', group: 'messages', family: 'communication', source: 'messages', description: 'Send a quiet channel or private message.', keywords: 'message chat dm channel send 通讯 消息 私聊 频道 发送', aliases: ['发消息', '发送消息', '发私聊', '发送私聊'], actions: ['send'] },
  { name: 'fleet_messages', group: 'messages', family: 'communication', source: 'messages', description: 'Progressively read, search, continue, react to, or pin messages.', keywords: 'message history inbox read search chunk text unread progress 消息 历史 收件箱 搜索 分段 续读 未读 已读', aliases: ['未读消息', '消息历史', '查看收件箱'], actions: ['read', 'search', 'inbox', 'react', 'reactions', 'pin', 'unpin', 'pins', 'text'] },
  { name: 'fleet_followup', group: 'messages', family: 'communication', source: 'messages', description: 'Wake or urgently interrupt a member with a follow-up.', keywords: 'message wake interrupt mention urgent followup 唤醒 打断 紧急 @ 跟进', aliases: ['叫醒', '催一下', '立即通知', '紧急通知'], actions: ['wakeup', 'interrupt'], privilegedActions: { wakeup: 'message.wakeup', interrupt: 'message.interrupt' } },
  { name: 'fleet_wait', group: 'messages', family: 'communication', source: 'messages', description: 'Wait briefly for visible Fleet changes.', keywords: 'wait change idle poll 等待 变化', aliases: ['等待消息', '等待变化'], actions: ['wait'] },
  { name: 'fleet_member_status', group: 'status', family: 'team-awareness', source: 'status', description: 'Read or update members current work status.', keywords: 'member status presence 状态 成员', aliases: ['成员状态', '工作状态', '状态文本'], actions: ['list', 'get', 'set', 'clear'], privilegedActions: { list: 'member-status.read', get: 'member-status.read', set: 'member-status.write', clear: 'member-status.write' } },
  { name: 'fleet_progress', group: 'status', family: 'team-awareness', source: 'host', description: 'Read a reachable member current runtime state and bounded recent Session progress.', keywords: 'member progress latest session status inspect 成员 进度 最新 会话', aliases: ['谁在做什么', '正在做什么', '当前工作', '成员进度'], actions: ['read'], privilegedActions: { read: 'member-status.read' } },
  { name: 'fleet_assistant', group: 'core', family: 'assistant-control', source: 'host', description: 'Start, inspect, steer, pause, resume, or stop assistant sessions.', keywords: 'assistant session start steer pause resume stop 助理 会话 启动 暂停 恢复', aliases: ['助理会话', '启动助理', '暂停助理'], actions: ['list', 'get', 'start', 'steer', 'pause', 'resume', 'stop'] },
  { name: 'fleet_run', group: 'core', family: 'team-awareness', source: 'host', description: 'Inspect and control the Fleet Team lifecycle, including waking or resuming all unloaded member runtimes.', keywords: 'run runtime team members state current create start pause resume wake unload reload dormant lifecycle all entire 团队 运行 成员 状态 创建 启动 暂停 恢复 唤醒 未加载 重新加载 休眠 生命周期 全体 整个', aliases: ['团队运行状态', '团队状态', '当前运行', '唤醒团队', '唤醒整个团队', '加载团队', '加载整个团队', '恢复全体成员'], actions: ['create', 'start', 'pause', 'resume', 'wake', 'list', 'status', 'wait', 'finish', 'close'], privilegedActions: { pause: 'team.manage', resume: 'team.manage', wake: 'team.manage', finish: 'team.manage', close: 'team.manage' } },
  { name: 'fleet_trace', group: 'core', family: 'team-awareness', source: 'host', description: 'Inspect bounded Fleet coordination traces when debugging collaboration.', keywords: 'trace debug coordination events diagnostics 追踪 调试 协作 事件', aliases: ['协作异常', '调试协作', '查看追踪'], actions: ['list', 'get'] },
  { name: 'fleet_activity', group: 'core', family: 'team-awareness', source: 'host', description: 'Inspect recent Fleet activity without opening full traces.', keywords: 'activity recent events audit 活动 最近 事件', aliases: ['最近动态', '最近发生了什么', '团队活动'], actions: ['list'] },
  { name: 'fleet_member', group: 'administration', family: 'governance', source: 'host', description: 'Manage Team membership and settings, or pause and resume one member runtime even when it is unloaded.', keywords: 'member manage team add remove configure pause resume wake unload reload dormant 成员 管理 团队 添加 删除 配置 暂停 恢复 唤醒 未加载 重新加载 休眠', aliases: ['团队成员', '成员配置', '添加成员', '删除成员', '恢复单个成员', '拉起成员', '唤醒成员'], actions: ['list', 'add', 'update', 'configure', 'configure_all', 'pause', 'resume', 'remove'], privilegedActions: { add: 'team.manage', update: 'team.manage', configure: 'team.manage', configure_all: 'team.manage', pause: 'team.manage', resume: 'team.manage', remove: 'team.manage' } },
  { name: 'fleet_channel', group: 'coordination', family: 'coordination', source: 'coordination', description: 'List and manage shared channels.', keywords: 'channel topic group archive 频道 群聊 主题 归档', aliases: ['创建频道', '频道管理', '群聊'], actions: ['list', 'create', 'update', 'archive'], privilegedActions: { create: 'channel.manage', update: 'channel.manage', archive: 'channel.manage' } },
  { name: 'fleet_vote', group: 'coordination', family: 'coordination', source: 'coordination', description: 'Create, inspect, or cast a Team vote.', keywords: 'vote consensus approve reject decision 投票 共识 同意 拒绝 决策', aliases: ['投票决定', '决定是否', '征求表决'], actions: ['list', 'get', 'create', 'cast'], privilegedActions: { create: 'vote.create' } },
  { name: 'fleet_meeting', group: 'coordination', family: 'coordination', source: 'coordination', description: 'Open, join, inspect, or close a meeting.', keywords: 'meeting agenda decision participants 会议 议程 决议 参会', aliases: ['开会', '讨论会', '召开会议'], actions: ['list', 'open', 'join', 'leave', 'close'], privilegedActions: { open: 'meeting.manage', close: 'meeting.manage' }, constraints: ['close is additionally limited to the meeting initiator'] },
  { name: 'fleet_shared', group: 'resources', family: 'shared-content', source: 'resources', description: 'List, read, update, and delete files in the Team resource directory.', keywords: 'team resource shared file delete remove 团队 资源 共享 文件 删除', aliases: ['共享文件', '团队文件', '读取共享文件'], actions: ['list', 'read', 'write', 'delete'], privilegedActions: { write: 'resource.write', delete: 'resource.write' } },
  { name: 'fleet_work', group: 'resources', family: 'workspace-development', source: 'resources', description: 'Claim or release workspace paths before editing.', keywords: 'work claim release conflict path workspace 占用 释放 冲突 路径 工作区', aliases: ['正在编辑', '声明编辑', '占用目录', '认领路径'], actions: ['list', 'claim', 'release'], privilegedActions: { claim: 'resource.write', release: 'resource.write' } },
  { name: 'fleet_resource', group: 'resources', family: 'shared-content', source: 'resources', description: 'Add, list, or inspect file and binary resource references.', keywords: 'resource file binary artifact attachment 资源 文件 二进制 产物 附件', aliases: ['附件资源', '添加附件', '资源引用'], actions: ['list', 'get', 'add'], privilegedActions: { add: 'resource.write' } },
  { name: 'fleet_task', group: 'tasks', family: 'planning', source: 'namespace', namespace: 'task', description: 'Read and manage recursive durable Tasks, owner task lists, stable states, trigger-driven ReconcileAttempts, Vote children, and required message obligations.', keywords: 'task owner list tree child reconcile trigger stable state event timeout vote requirement must reply complete project 任务 owner 负责人 列表 子任务 状态 调和 触发器 事件 超时 投票 必回 完成 项目', aliases: ['我的任务', 'owner任务', '必须回复', '必回任务', '完成任务'], actions: ['list', 'owner_list', 'get', 'create', 'update', 'comment', 'progress', 'claim', 'settle', 'complete', 'owner_complete', 'owner_block', 'reopen', 'signal'], privilegedActions: { list: 'task.read', owner_list: 'task.read', get: 'task.read', create: 'task.create', update: 'task.update', comment: 'task.comment', progress: 'task.progress', claim: 'task.progress', settle: 'task.update', complete: 'task.update', owner_complete: 'task.progress', owner_block: 'task.progress', reopen: 'task.update', signal: 'task.update' } },
  { name: 'fleet_schedule', group: 'coordination', family: 'planning', source: 'namespace', namespace: 'schedule', description: 'Read and manage persistent Team schedules.', keywords: 'schedule recurring due reminder automation 计划 定时 到期 提醒 自动化', aliases: ['自动提醒', '定时提醒', '周期任务', '重复计划'], actions: ['list', 'get', 'create', 'update', 'pause', 'resume', 'complete', 'cancel'], privilegedActions: { list: 'schedule.read', get: 'schedule.read', create: 'schedule.create', update: 'schedule.update', pause: 'schedule.update', resume: 'schedule.update', complete: 'schedule.update', cancel: 'schedule.update' } },
  { name: 'fleet_calendar', group: 'coordination', family: 'planning', source: 'namespace', namespace: 'calendar', description: 'Read and manage Team calendar events and availability.', keywords: 'calendar event availability rsvp meeting 日历 事件 空闲 回复 会议', aliases: ['安排会议', '明天会议', '日程安排', '空闲时间'], actions: ['list', 'get', 'freebusy', 'create', 'update', 'rsvp', 'cancel'], privilegedActions: { list: 'calendar.read', get: 'calendar.read', freebusy: 'calendar.read', create: 'calendar.create', update: 'calendar.update', rsvp: 'calendar.rsvp', cancel: 'calendar.update' } },
  { name: 'fleet_access', group: 'administration', family: 'governance', source: 'namespace', namespace: 'access', description: 'Inspect or manage Fleet resource access rules.', keywords: 'access acl resource permission inspect rules 访问 控制 资源 权限 规则', aliases: ['访问规则', '资源访问', '访问控制'], actions: ['inspect', 'list', 'grant', 'revoke'], privilegedActions: { inspect: 'access.inspect', list: 'access.manage', grant: 'access.manage', revoke: 'access.manage' } },
  { name: 'fleet_permission', group: 'administration', family: 'governance', source: 'namespace', namespace: 'permissions', description: 'Manage Fleet permission groups and assignments.', keywords: 'permission role group grant revoke 权限 角色 分组 授权 撤销', aliases: ['权限组', '角色授权', '成员权限', '权限分组'], actions: ['list', 'create', 'update', 'delete', 'assign', 'unassign'], privilegedActions: { list: 'permissions.manage', create: 'permissions.manage', update: 'permissions.manage', delete: 'permissions.manage', assign: 'permissions.manage', unassign: 'permissions.manage' } },
  { name: 'fleet_document', group: 'documents', family: 'shared-content', source: 'namespace', namespace: 'document', description: 'Read, edit, search, and review shared Team documents.', keywords: 'document edit search comment review 文档 编辑 搜索 评论 审阅', aliases: ['设计文档', '搜索文档', '编辑文档', '文档审阅'], actions: ['list', 'get', 'search', 'create', 'update', 'comment', 'resolve', 'revert'], privilegedActions: { list: 'document.read', get: 'document.read', search: 'document.read', create: 'document.write', update: 'document.write', comment: 'document.comment', resolve: 'document.comment', revert: 'document.write' } },
  { name: 'fleet_workspace', group: 'resources', family: 'workspace-development', source: 'namespace', namespace: 'workspace', description: 'Inspect or manage Team workspace mounts.', keywords: 'workspace mount allocation access 工作区 挂载 分配 访问', aliases: ['挂载工作区', '工作区分配', '附加工作区'], actions: ['list', 'attach', 'detach', 'assign'], privilegedActions: { list: 'workspace.read', attach: 'workspace.manage', detach: 'workspace.manage', assign: 'workspace.manage' }, constraints: ['native DSH Session cwd and sandbox remain authoritative'] },
  { name: 'fleet_git', group: 'resources', family: 'workspace-development', source: 'namespace', namespace: 'git', description: 'Inspect and coordinate Git repositories, scopes, worktrees, history, and publishing.', keywords: 'git repository diff status commit branch worktree publish 仓库 差异 状态 提交 分支 工作树 推送', aliases: ['git 差异', '发布分支', '仓库状态', '创建工作树'], actions: ['status', 'diff', 'log', 'scope-check', 'worktree-create', 'publish'], privilegedActions: { status: 'git.inspect', diff: 'git.inspect', log: 'git.inspect', 'scope-check': 'git.scope-check', 'worktree-create': 'git.worktree-create', publish: 'git.publish' } },
] as const

const TOOL_DISCOVERY_RESULT_SCHEMA = {
  type: 'object', additionalProperties: false, properties: {
    matches: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
      name: { type: 'string', required: true }, group: { type: 'string', required: true }, family: { type: 'string', required: true }, description: { type: 'string', required: true }, loaded: { type: 'boolean', required: true }, matched: { type: 'boolean', required: true },
      actions: { type: 'array', required: true, items: { type: 'string' } },
      restrictedActions: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { action: { type: 'string', required: true }, permissions: { type: 'array', required: true, items: { type: 'string' } } } } },
      constraints: { type: 'array', required: true, items: { type: 'string' } },
    } } },
    loadedTools: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

function normalize(value: string): string { return value.trim().toLowerCase().replaceAll('-', '_') }

const ZH_SEGMENTER = new Intl.Segmenter('zh-CN', { granularity: 'word' })
const GENERIC_TERMS = new Set([
  '一个', '一下', '什么', '当前', '目前', '相关', '查看', '检查', '成员', '团队', '用户', '工具', '资源', '会话', '状态', '工作',
  'a', 'an', 'the', 'current', 'team', 'member', 'user', 'tool', 'resource', 'session', 'state', 'status', 'work',
])

function usefulTerm(value: string): boolean {
  return /\p{Script=Han}/u.test(value) ? value.length >= 2 : value.length >= 3
}

function queryTokens(value: string): string[] {
  const lexical = value.split(/[^\p{L}\p{N}_@]+/u).filter(Boolean)
  const segmented = [...ZH_SEGMENTER.segment(value)]
    .filter(part => part.isWordLike)
    .map(part => normalize(part.segment))
  return [...new Set([...lexical, ...segmented].filter(usefulTerm))]
}

function chineseNgrams(value: string): Set<string> {
  const result = new Set<string>()
  for (const match of value.matchAll(/[\p{Script=Han}]+/gu)) {
    const text = match[0]
    for (const size of [2, 3]) {
      for (let index = 0; index <= text.length - size; index++) result.add(text.slice(index, index + size))
    }
  }
  return result
}

function grantedActions(entry: FleetToolCatalogEntry, permissions: ReadonlySet<string>): {
  readonly actions: string[]
  readonly restrictedActions: Array<{ readonly action: string; readonly permissions: string[] }>
} {
  const allowed = (action: string): boolean => {
    const required = entry.privilegedActions?.[action]
    return required === undefined || (typeof required === 'string'
      ? permissions.has(required)
      : required.every(permission => permissions.has(permission)))
  }
  return {
    actions: entry.actions.filter(allowed),
    restrictedActions: entry.actions.flatMap(action => {
      const required = entry.privilegedActions?.[action]
      if (required === undefined || allowed(action)) return []
      return [{ action, permissions: typeof required === 'string' ? [required] : [...required] }]
    }),
  }
}

export function fleetToolHasAuthorizedAction(
  entry: FleetToolCatalogEntry,
  permissions: ReadonlySet<string>,
): boolean {
  return grantedActions(entry, permissions).actions.length > 0
}

export function searchFleetTools(query: string, allowedTools: ReadonlySet<string>, residentTools: ReadonlySet<string>, permissions: ReadonlySet<string> = new Set(), catalog: readonly FleetToolCatalogEntry[] = FLEET_TOOL_CATALOG) {
  const normalized = normalize(query)
  const tokens = queryTokens(normalized)
  const queryGrams = chineseNgrams(normalized)
  const available = catalog.filter(entry => allowedTools.has(entry.name)).map(entry => ({ entry, ...grantedActions(entry, permissions) }))
    .filter(candidate => candidate.actions.length > 0)
  const ranked = available.map(candidate => {
    const { entry } = candidate
    const aliases = entry.aliases?.map(normalize) ?? []
    const keywordTerms = entry.keywords.split(/\s+/u).map(normalize).filter(usefulTerm)
    const haystack = normalize(`${entry.name} ${entry.group} ${entry.family} ${entry.description} ${entry.keywords} ${aliases.join(' ')}`)
    const compactQuery = normalized.replaceAll(' ', '')
    let score = normalized.length === 0 ? 1 : 0
    if (normalize(entry.name) === normalized || normalize(entry.group) === normalized || normalize(entry.family) === normalized) score += 100
    if (normalized.length > 0 && haystack.includes(normalized)) score += 40
    if (compactQuery.length > 0 && haystack.replaceAll(' ', '').includes(compactQuery)) score += 30
    for (const token of tokens) if (haystack.includes(token)) score += GENERIC_TERMS.has(token) ? 2 : 10
    for (const term of keywordTerms) {
      if (normalized.includes(term)) score += GENERIC_TERMS.has(term) ? 2 : 12 + Math.min(term.length, 4)
    }
    for (const alias of aliases) {
      if (normalized.includes(alias)) score += 35 + Math.min(alias.length, 8)
      else if (alias.includes(normalized) && normalized.length >= 2) score += 18
    }
    if (score === 0 && queryGrams.size > 0) {
      const entryGrams = chineseNgrams(`${entry.keywords} ${aliases.join(' ')}`)
      let overlap = 0
      for (const gram of queryGrams) if (entryGrams.has(gram)) overlap++
      if (overlap >= 2) score += Math.min(overlap, 3) * 2
    }
    return { ...candidate, score }
  }).sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name))

  const selected = new Set<string>()
  if (normalized.length === 0) {
    for (const candidate of ranked) selected.add(candidate.entry.name)
  } else {
    const familyScores = new Map<string, number>()
    const familyExpansionThreshold = Math.max(14, (ranked[0]?.score ?? 0) * 0.45)
    for (const candidate of ranked) {
      if (candidate.score < familyExpansionThreshold) continue
      familyScores.set(candidate.entry.family, Math.max(familyScores.get(candidate.entry.family) ?? 0, candidate.score))
    }
    const expandedFamilies = new Set([...familyScores.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3).map(([family]) => family))
    for (const candidate of ranked) if (expandedFamilies.has(candidate.entry.family)) selected.add(candidate.entry.name)
    const unrelatedThreshold = expandedFamilies.size === 0 ? 4 : 10
    for (const candidate of ranked) {
      if (candidate.score < unrelatedThreshold || selected.has(candidate.entry.name)) continue
      selected.add(candidate.entry.name)
      if ([...selected].filter(name => !expandedFamilies.has(available.find(item => item.entry.name === name)?.entry.family ?? '')).length >= 4) break
    }
  }

  const familyScore = (family: string): number => Math.max(0, ...ranked.filter(candidate => candidate.entry.family === family).map(candidate => candidate.score))
  return ranked.filter(candidate => selected.has(candidate.entry.name))
    .sort((left, right) => familyScore(right.entry.family) - familyScore(left.entry.family)
      || right.score - left.score || left.entry.name.localeCompare(right.entry.name))
    .map(candidate => ({
      name: candidate.entry.name,
      group: candidate.entry.group,
      family: candidate.entry.family,
      description: candidate.entry.description,
      loaded: residentTools.has(candidate.entry.name),
      matched: normalized.length === 0 || candidate.score > 0,
      actions: candidate.actions,
      restrictedActions: candidate.restrictedActions,
      constraints: [...(candidate.entry.constraints ?? [])],
    }))
}

export function installFleetToolDiscovery(ctx: Context, options: { readonly catalog?: readonly FleetToolCatalogEntry[]; readonly allowedTools: ReadonlySet<string>; readonly residentTools: Set<string>; readonly permissions: ReadonlySet<string>; readonly load: (name: string) => void }): () => void {
  const catalog = options.catalog ?? FLEET_TOOL_CATALOG
  return ctx.tools.register(defineTool({
    name: 'fleet_tools',
    description: 'Search or list the granted Fleet capabilities that are already resident for this Agent. This catalog does not list host tools such as bash, read, or edit. Search expands the small related-capability family of a direct match; matched=false marks a related suggestion. The load action is retained as an idempotent compatibility operation and does not make a tool more available.',
    parameters: { action: { type: 'string', enum: ['search', 'load', 'list'], description: 'Defaults to search. Load is an idempotent compatibility operation.' }, query: { type: 'string', description: 'Natural-language capability or tool name to search.' }, name: { type: 'string', description: 'Exact Fleet tool name returned by search; required only for the compatibility load action.' } },
    output: { schema: TOOL_DISCOVERY_RESULT_SCHEMA, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      if ((args.action ?? 'search') === 'load') {
        if (args.name === undefined) throw new Error('fleet_tools load requires name')
        const entry = catalog.find(candidate => normalize(candidate.name) === normalize(args.name ?? ''))
        if (entry === undefined || !options.allowedTools.has(entry.name)) throw new Error(`Fleet tool ${args.name} is not available to this member`)
        if (!searchFleetTools(entry.name, options.allowedTools, options.residentTools, options.permissions, catalog)
          .some(candidate => candidate.name === entry.name)) {
          throw new Error(`Fleet tool ${args.name} has no actions available to this member`)
        }
        if (!options.residentTools.has(entry.name)) options.load(entry.name)
        return { matches: searchFleetTools(entry.name, options.allowedTools, options.residentTools, options.permissions, catalog), loadedTools: [...options.residentTools].sort() }
      }
      return { matches: searchFleetTools(args.action === 'list' ? '' : (args.query ?? ''), options.allowedTools, options.residentTools, options.permissions, catalog), loadedTools: [...options.residentTools].sort() }
    },
  }))
}
