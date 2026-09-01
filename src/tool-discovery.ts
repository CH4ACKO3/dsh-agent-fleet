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
  { name: 'fleet_inbox', group: 'messages', family: 'communication', source: 'messages', description: 'Inspect, consume, search, or continue the calling member persistent Inbox Task.', keywords: 'message inbox read search unread aggregate 消息 收件箱 搜索 未读 聚合', aliases: ['未读消息', '查看收件箱'], actions: ['status', 'read', 'search', 'text'] },
  { name: 'fleet_send', group: 'messages', family: 'communication', source: 'messages', description: 'Send a quiet message; resolved mentions create Reply Tasks.', keywords: 'message chat dm channel send mention 通讯 消息 私聊 频道 发送 必回', aliases: ['发消息', '发送消息', '发私聊'], actions: ['send'] },
  { name: 'fleet_reply', group: 'messages', family: 'communication', source: 'messages', description: 'Deliver content for an owned Reply Task and record its completion receipt.', keywords: 'reply required response receipt complete 回复 必回 回执 完成', aliases: ['回复消息', '完成必回'], actions: ['reply'] },
  { name: 'fleet_progress', group: 'status', family: 'team-awareness', source: 'host', description: 'Read a reachable member current runtime state and bounded recent output.', keywords: 'member progress latest session status inspect output 成员 进度 最新 会话 输出', aliases: ['谁在做什么', '正在做什么', '当前工作', '成员进度'], actions: ['read'] },
  { name: 'fleet_assistant', group: 'core', family: 'assistant-control', source: 'host', description: 'Attach, detach, configure, observe, or relay through the user-facing Team assistant.', keywords: 'assistant attach detach configure observe message 助理 接入 离开 配置 观察 转达', aliases: ['团队助理', '接入助理', '观察团队'], actions: ['activate', 'deactivate', 'observe', 'message', 'configure'] },
  { name: 'fleet_run', group: 'core', family: 'team-awareness', source: 'host', description: 'Create, inspect, pause, resume, or close a Fleet Team lifecycle.', keywords: 'run runtime team state create pause resume close 团队 运行 状态 创建 暂停 恢复 关闭', aliases: ['团队运行状态', '团队状态', '当前运行'], actions: ['create', 'start', 'pause', 'resume', 'list', 'status', 'close'], privilegedActions: { pause: 'team.manage', resume: 'team.manage', close: 'team.manage' } },
  { name: 'fleet_user_task', group: 'core', family: 'assistant-control', source: 'host', description: 'Inspect, send a user progress update, delegate, explicitly take over, report, or block the assistant persistent foreground Interaction Task.', keywords: 'user interaction foreground update progress continue delegate take over report block task 用户 交互 前台 更新 进度 委派 接管 汇报 阻塞 任务', aliases: ['用户任务', '更新用户进度', '汇报结果', '继续团队工作', '助理接管'], actions: ['status', 'update', 'continue', 'take_over', 'report', 'block'] },
  { name: 'fleet_member', group: 'administration', family: 'governance', source: 'host', description: 'Manage Team membership and settings, or pause and resume one member runtime.', keywords: 'member manage team add remove configure pause resume 成员 管理 团队 添加 删除 配置 暂停 恢复', aliases: ['团队成员', '成员配置', '添加成员', '删除成员', '恢复单个成员'], actions: ['list', 'add', 'update', 'configure', 'configure_all', 'pause', 'resume', 'remove'], privilegedActions: { add: 'team.manage', update: 'team.manage', configure: 'team.manage', configure_all: 'team.manage', pause: 'team.manage', resume: 'team.manage', remove: 'team.manage' } },
  { name: 'fleet_channel', group: 'coordination', family: 'coordination', source: 'coordination', description: 'List and manage shared channels.', keywords: 'channel topic group archive 频道 群聊 主题 归档', aliases: ['创建频道', '频道管理', '群聊'], actions: ['list', 'create', 'update', 'archive'], privilegedActions: { create: 'channel.manage', update: 'channel.manage', archive: 'channel.manage' } },
  { name: 'fleet_vote', group: 'coordination', family: 'planning', source: 'namespace', namespace: 'task', description: 'Create, inspect, or cast a durable Vote Task with a required reason.', keywords: 'vote task ballot approve reject reason 投票 任务 同意 拒绝 理由', aliases: ['投票决定', '征求表决'], actions: ['list', 'get', 'create', 'cast'], privilegedActions: { create: 'task.create' } },
  { name: 'fleet_goal', group: 'tasks', family: 'planning', source: 'namespace', namespace: 'task', description: 'Create, inspect, or atomically split Goals, submit completed work results, or report an external blocker.', keywords: 'goal owner split complete block intent result 目标 负责人 分解 完成 阻塞 意图 结果', aliases: ['我的目标', '分解目标', '完成目标', '目标受阻'], actions: ['list', 'get', 'create', 'split', 'complete', 'block'], privilegedActions: { create: 'task.create' } },
  { name: 'fleet_task', group: 'tasks', family: 'planning', source: 'namespace', namespace: 'task', description: 'Read recursive durable Task state and the calling member owner list.', keywords: 'task owner list tree child stable state read 任务 负责人 列表 子任务 稳定状态 查看', aliases: ['我的任务', '任务状态'], actions: ['list', 'owner_list', 'get'], privilegedActions: { list: 'task.read', owner_list: 'task.read', get: 'task.read' } },
  { name: 'fleet_reconcile', group: 'tasks', family: 'planning', source: 'namespace', namespace: 'task', description: 'Inspect or atomically resolve a reserved ReconcileAttempt with a high-level outcome; Fleet derives standard continuation triggers.', keywords: 'reconcile attempt outcome resolve timeout claimed ready 调和 尝试 结果 状态 超时 已领取 就绪', aliases: ['处理调和', '任务状态决议'], actions: ['list', 'get', 'claim', 'resolve'], privilegedActions: { list: 'task.reconcile', get: 'task.reconcile', claim: 'task.reconcile', resolve: 'task.reconcile' } },
  { name: 'fleet_resource', group: 'resources', family: 'shared-content', source: 'resources', description: 'Add, list, or inspect file and binary resource references.', keywords: 'resource file binary artifact attachment 资源 文件 二进制 产物 附件', aliases: ['附件资源', '添加附件', '资源引用'], actions: ['list', 'get', 'add'], privilegedActions: { add: 'resource.write' } },
  { name: 'fleet_access', group: 'administration', family: 'governance', source: 'namespace', namespace: 'access', description: 'Inspect or manage Fleet resource access rules.', keywords: 'access acl resource permission inspect rules 访问 控制 资源 权限 规则', aliases: ['访问规则', '资源访问', '访问控制'], actions: ['inspect', 'list', 'grant', 'revoke'], privilegedActions: { inspect: 'access.inspect', list: 'access.manage', grant: 'access.manage', revoke: 'access.manage' } },
  { name: 'fleet_permission', group: 'administration', family: 'governance', source: 'namespace', namespace: 'permissions', description: 'Manage Fleet permission groups and assignments.', keywords: 'permission role group grant revoke 权限 角色 分组 授权 撤销', aliases: ['权限组', '角色授权', '成员权限', '权限分组'], actions: ['list', 'create', 'update', 'delete', 'assign', 'unassign'], privilegedActions: { list: 'permissions.manage', create: 'permissions.manage', update: 'permissions.manage', delete: 'permissions.manage', assign: 'permissions.manage', unassign: 'permissions.manage' } },
  { name: 'fleet_git', group: 'resources', family: 'workspace-development', source: 'namespace', namespace: 'git', description: 'Inspect and coordinate Git repositories, scopes, worktrees, history, and publishing.', keywords: 'git repository diff status commit branch worktree publish 仓库 差异 状态 提交 分支 工作树 推送', aliases: ['git 差异', '发布分支', '仓库状态', '创建工作树'], actions: ['status', 'diff', 'log', 'scope-check', 'worktree-create', 'publish'], privilegedActions: { status: 'git.inspect', diff: 'git.inspect', log: 'git.inspect', 'scope-check': 'git.scope-check', 'worktree-create': 'git.worktree-create', publish: 'git.publish' } },
] as const

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
