import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { FleetWebClient } from '@dsh-agent-fleet/core/web'
import type { FleetChatContentBlock, FleetChatMember, FleetChatReceiptSource } from './runtime-chat.js'
import { encodeFleetFile } from './web-client.js'
import {
  type FleetPanelActivity,
  type FleetPanelArchiveFile,
  type FleetPanelConversation,
  type FleetPanelMember,
  type FleetPanelMemberAuthorization,
  type FleetPanelMemberTrace,
  type FleetPanelMessage,
  type FleetPanelResource,
  type FleetPanelResourceContent,
  type FleetPanelSnapshot,
  type FleetPanelSource,
  type FleetPanelTeamDirectory,
  type FleetPanelTeamSnapshot,
  type FleetPanelWorkspace,
} from './team-panel.js'

const PAGE_SIZE = 500
const MAX_TEAM_MESSAGES = 500
const MAX_TEAM_ACTIVITY = 250
const MAX_MEMBER_TRACE_EVENTS = 240
const MAX_TEAM_PROJECTION_CACHES = 16
const TEAM_COLORS = [
  '#527FCA', '#4C8A75', '#9A704C', '#846BB3', '#B46772', '#3F829D',
  '#737D4B', '#9B628E', '#5E7EAE', '#6F875F', '#A15F4E', '#65717D',
] as const

function decodeFleetBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function archiveObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} 无效`)
  return value as Record<string, unknown>
}

function archiveText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} 无效`)
  return value
}

function textContainsMention(text: string, references: readonly string[]): boolean {
  return references.some(reference => {
    const escaped = reference.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    return new RegExp(`@${escaped}(?=$|[\\s,.;:!?，。；：！？、）)\\]】}])`, 'iu').test(text)
  })
}

interface WireMember {
  readonly name: string
  readonly displayName?: string
  readonly color?: string
  readonly role: string
  readonly sessionId: string
  readonly provider?: string
  readonly model?: string
  readonly status?: 'idle' | 'running' | 'waiting' | 'error' | 'offline' | 'paused' | 'unknown'
}

interface WireAssistant {
  readonly sessionId: string
  readonly view?: {
    readonly id?: string
    readonly name?: string
    readonly role?: string
    readonly responsibility?: string
    readonly color?: string
    readonly provider?: string
    readonly model?: string
  }
  readonly status?: 'idle' | 'running' | 'offline'
}

interface WireRun {
  readonly id: string
  readonly name: string
  readonly projectRoot: string
  readonly members: readonly WireMember[]
  readonly assistants?: readonly WireAssistant[]
  readonly status: FleetPanelTeamSnapshot['status']
  readonly runtimeState?: 'active' | 'dormant'
  readonly startedAt: string
  readonly error?: string
}

interface WireMemberView {
  readonly id: string
  readonly name: string
  readonly color?: string
  readonly role: string
  readonly responsibility?: string
  readonly provider?: string
  readonly model?: string
  readonly contacts?: {
    readonly members?: '*' | readonly string[]
    readonly channels?: '*' | readonly string[]
  }
}

interface WireEvent {
  readonly sequence: number
  readonly sessionId?: string
  readonly createdAt: string
  readonly type: string
  readonly data: unknown
}

interface WireProjection {
  readonly run: WireRun
  readonly memberViews: readonly WireMemberView[]
  readonly events: readonly WireEvent[]
  readonly hasMore: boolean
  readonly previousSequence?: number
}

interface WireTraceProjection {
  readonly events: readonly WireEvent[]
  readonly hasMore: boolean
  readonly previous?: { readonly segment: number; readonly beforeSeq: number }
  readonly targetSessionId?: string
  readonly targetSequence?: number
}

interface ProjectionCache {
  readonly run: WireRun
  readonly memberViews: readonly WireMemberView[]
  readonly events: readonly WireEvent[]
  readonly lastSequence: number
}

const EMPTY_DIRECTORY: FleetPanelTeamDirectory = {
  teams: [],
  groups: [
    { id: 'ungrouped', name: '未分组', kind: 'ungrouped', teamIds: [] },
    { id: 'archived', name: '已归档', kind: 'archived', teamIds: [] },
  ],
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isFleetUser(sessionId: string): boolean {
  return sessionId.startsWith('fleet-user:')
}

function unwrap<T>(result: RemoteResult<unknown>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value as T
}

function wireRuns(value: unknown): WireRun[] {
  if (!Array.isArray(value)) throw new Error('Fleet list returned an invalid Team directory')
  return value.filter(isRecord).flatMap((candidate): WireRun[] => {
    const id = string(candidate.id)
    const name = string(candidate.name)
    const projectRoot = string(candidate.projectRoot)
    const status = string(candidate.status) as WireRun['status'] | undefined
    const startedAt = string(candidate.startedAt)
    if (id === undefined || name === undefined || projectRoot === undefined || status === undefined
      || startedAt === undefined || !Array.isArray(candidate.members)) return []
    return [{
      ...(candidate as unknown as WireRun),
      id,
      name,
      projectRoot,
      status,
      startedAt,
      members: candidate.members as unknown as readonly WireMember[],
    }]
  })
}

function wireProjection(value: unknown): WireProjection {
  if (!isRecord(value) || !isRecord(value.run) || !Array.isArray(value.memberViews)
    || !Array.isArray(value.events) || typeof value.hasMore !== 'boolean') {
    throw new Error('Fleet project returned an invalid Team projection')
  }
  const [run] = wireRuns([{ ...value.run, members: Array.isArray(value.run.members) ? value.run.members : [] }])
  if (run === undefined) throw new Error('Fleet project returned an invalid Team record')
  return {
    run,
    memberViews: value.memberViews as unknown as readonly WireMemberView[],
    events: value.events as unknown as readonly WireEvent[],
    hasMore: value.hasMore,
    ...(typeof value.previousSequence === 'number' ? { previousSequence: value.previousSequence } : {}),
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function memberAuthorization(value: unknown): FleetPanelMemberAuthorization {
  const container = asRecord(value)
  const authorization = asRecord(container?.authorization ?? value)
  const assignment = asRecord(authorization?.assignment)
  const effective = asRecord(authorization?.effective)
  if (authorization === undefined || assignment === undefined || effective === undefined
    || !Array.isArray(authorization.groups)) {
    throw new Error('Fleet 返回了无效的成员权限配置')
  }
  const groups = authorization.groups.flatMap((candidate): FleetPanelMemberAuthorization['groups'] => {
    const group = asRecord(candidate)
    const id = string(group?.id)
    const name = string(group?.name)
    if (id === undefined || name === undefined) return []
    return [{
      id,
      name,
      parents: stringList(group?.parents),
      preset: group?.preset === true,
      ...(group?.op === true ? { op: true } : {}),
    }]
  })
  return {
    groups,
    selectedGroups: stringList(assignment.groups),
    effectiveActions: stringList(effective.actions),
    effectiveToolGroups: stringList(effective.toolGroups),
    op: effective.op === true,
    configured: authorization.configured === true,
  }
}

function hash(value: string): number {
  let result = 2166136261
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function color(value: string): string {
  return TEAM_COLORS[hash(value) % TEAM_COLORS.length] ?? TEAM_COLORS[0]
}

function basename(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return isRecord(value) ? value : undefined
}

function nestedRecord(value: unknown, key: string): Readonly<Record<string, unknown>> | undefined {
  return asRecord(asRecord(value)?.[key])
}

function presence(status: WireMember['status']): 'active' | 'busy' | 'waiting' | 'error' | 'offline' | 'unknown' {
  if (status === 'running') return 'busy'
  if (status === 'waiting') return 'waiting'
  if (status === 'error') return 'error'
  if (status === 'offline' || status === 'paused') return 'offline'
  if (status === 'unknown') return 'unknown'
  return 'active'
}

function isPresent(member: FleetPanelMember | undefined): boolean {
  return member?.presence === 'active' || member?.presence === 'busy'
    || member?.presence === 'waiting' || member?.presence === 'error'
}

function formatBytes(size: number | undefined): string | undefined {
  if (size === undefined || !Number.isFinite(size) || size < 0) return undefined
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function activityKind(type: string): FleetPanelActivity['kind'] | undefined {
  if (type === 'coordination.message') return 'message'
  if (type.startsWith('resource.') || type.startsWith('workspace.')) return 'resource'
  if (type === 'coordination.vote' || type.startsWith('work_') || type === 'team_status'
    || type.startsWith('task.') || type.startsWith('schedule.') || type.startsWith('calendar.')) return 'decision'
  if (type.startsWith('member_') || type.startsWith('assistant_')) return 'member'
  return undefined
}

function stateEventKey(event: WireEvent): string | undefined {
  if (event.type === 'coordination.channel') {
    const id = string(nestedRecord(event.data, 'channel')?.id)
    return id === undefined ? undefined : `channel:${id}`
  }
  if (event.type === 'coordination.meeting') {
    const id = string(nestedRecord(event.data, 'meeting')?.id)
    return id === undefined ? undefined : `meeting:${id}`
  }
  if (event.type === 'resource.resource_added' || event.type === 'resource.resource_removed') {
    const data = event.type === 'resource.resource_removed'
      ? nestedRecord(event.data, 'removal')
      : asRecord(event.data)
    const id = string(nestedRecord(data, 'resource')?.id)
    return id === undefined ? undefined : `resource:${id}`
  }
  if (event.type === 'workspace.assigned') {
    const member = string(asRecord(event.data)?.member)
    return member === undefined ? undefined : `workspace:${member}`
  }
  if (event.type === 'member_status.updated') {
    const member = string(nestedRecord(event.data, 'status')?.member)
    return member === undefined ? undefined : `member-status:${member}`
  }
  if (event.type === 'member_status.cleared') {
    const member = string(asRecord(event.data)?.member)
    return member === undefined ? undefined : `member-status:${member}`
  }
  if (event.type === 'member_session_rotated') {
    const previous = string(asRecord(event.data)?.previousSessionId)
    return previous === undefined ? undefined : `member-session:${previous}`
  }
  return undefined
}

function receiptMessageId(event: WireEvent): string | undefined {
  if (event.type !== 'coordination.inbox') return undefined
  const data = asRecord(event.data)
  return data?.type === 'inbox'
    && (data.action === 'delivered' || data.action === 'read' || data.action === 'acknowledged')
    ? string(data.messageId)
    : undefined
}

function receiptKey(event: WireEvent): string | undefined {
  const messageId = receiptMessageId(event)
  const data = asRecord(event.data)
  const agentId = string(data?.agentId)
  const action = string(data?.action)
  return messageId === undefined || agentId === undefined || action === undefined
    ? undefined
    : `${action}:${agentId}:${messageId}`
}

/** Keep current entity state plus a bounded recent message/activity window; raw Session events use the trace endpoint. */
function compactTeamEvents(events: readonly WireEvent[]): WireEvent[] {
  const state = new Map<string, WireEvent>()
  const messages: WireEvent[] = []
  const receipts = new Map<string, WireEvent>()
  const activity: WireEvent[] = []
  for (const event of events) {
    if (event.type.startsWith('session.')) continue
    const key = stateEventKey(event)
    if (key !== undefined) {
      state.set(key, event)
      continue
    }
    if (event.type === 'coordination.message') {
      messages.push(event)
      continue
    }
    const currentReceiptKey = receiptKey(event)
    if (currentReceiptKey !== undefined) {
      receipts.set(currentReceiptKey, event)
      continue
    }
    if (activityKind(event.type) !== undefined) activity.push(event)
  }
  const retainedMessages = messages.slice(-MAX_TEAM_MESSAGES)
  const retainedMessageIds = new Set(retainedMessages.flatMap(event => {
    const id = string(nestedRecord(event.data, 'message')?.id)
    return id === undefined ? [] : [id]
  }))
  return [
    ...state.values(),
    ...retainedMessages,
    ...[...receipts.values()].filter(event => retainedMessageIds.has(receiptMessageId(event) ?? '')),
    ...activity.slice(-MAX_TEAM_ACTIVITY),
  ].toSorted((left, right) => left.sequence - right.sequence)
}

function traceProjection(value: unknown): WireTraceProjection {
  if (!isRecord(value) || !Array.isArray(value.events) || typeof value.hasMore !== 'boolean') {
    throw new Error('Fleet project returned an invalid member trace')
  }
  return {
    events: value.events as unknown as readonly WireEvent[],
    hasMore: value.hasMore,
    ...(isRecord(value.previous)
      && typeof value.previous.segment === 'number'
      && typeof value.previous.beforeSeq === 'number'
      ? { previous: { segment: value.previous.segment, beforeSeq: value.previous.beforeSeq } }
      : {}),
    ...(typeof value.targetSessionId === 'string' ? { targetSessionId: value.targetSessionId } : {}),
    ...(typeof value.targetSequence === 'number' ? { targetSequence: value.targetSequence } : {}),
  }
}

function resourceContent(value: unknown): FleetPanelResourceContent {
  if (!isRecord(value)) throw new Error('Fleet resource preview returned an invalid response')
  const id = string(value.id)
  const kind = string(value.kind)
  const body = string(value.body)
  if (id === undefined || (kind !== 'markdown' && kind !== 'text') || body === undefined) {
    throw new Error('Fleet resource preview returned an invalid response')
  }
  const mediaType = string(value.mediaType)
  const history = Array.isArray(value.history) ? value.history.flatMap(candidate => {
    const item = asRecord(candidate)
    const id = string(item?.id)
    const updatedBy = string(item?.updatedBy)
    const updatedAt = string(item?.updatedAt)
    const operation = string(item?.operation)
    const available = item?.available
    const size = item?.size
    return id === undefined || updatedBy === undefined || updatedAt === undefined
      || (operation !== 'created' && operation !== 'updated')
      || typeof available !== 'boolean' || typeof size !== 'number'
      ? []
      : [{ id, updatedBy, updatedAt, operation, available, size } as const]
  }) : []
  const rawRevision = asRecord(value.revision)
  const revisionId = string(rawRevision?.id)
  const revisionUpdatedBy = string(rawRevision?.updatedBy)
  const revisionUpdatedAt = string(rawRevision?.updatedAt)
  const revisionOperation = string(rawRevision?.operation)
  const revisionBefore = rawRevision?.before
  const revisionAfter = string(rawRevision?.after)
  const revisionAvailable = rawRevision?.available
  const revisionSize = rawRevision?.size
  const revision = revisionId === undefined || revisionUpdatedBy === undefined || revisionUpdatedAt === undefined
    || (revisionOperation !== 'created' && revisionOperation !== 'updated')
    || revisionAvailable !== true || typeof revisionSize !== 'number'
    || (revisionBefore !== null && typeof revisionBefore !== 'string') || revisionAfter === undefined
    ? undefined
    : {
        id: revisionId,
        updatedBy: revisionUpdatedBy,
        updatedAt: revisionUpdatedAt,
        operation: revisionOperation,
        available: true,
        size: revisionSize,
        before: revisionBefore,
        after: revisionAfter,
      } as const
  return {
    id,
    kind,
    body,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(typeof value.size === 'number' ? { size: value.size } : {}),
    history,
    historyTruncated: value.historyTruncated === true,
    ...(revision === undefined ? {} : { revision }),
  }
}

function runDirectorySignature(runs: readonly WireRun[]): string {
  return JSON.stringify(runs.map(run => [
    run.id,
    run.name,
    run.projectRoot,
    run.status,
    run.members.map(member => [member.name, member.displayName, member.role, member.sessionId, member.status]),
    (run.assistants ?? []).map(assistant => [
      assistant.sessionId,
      assistant.view?.id,
      assistant.view?.name,
      assistant.view?.role,
      assistant.status,
    ]),
  ]))
}

function activityAction(value: unknown): string {
  const action = string(value)
  return action === undefined ? '更新' : ({
    created: '创建',
    updated: '更新',
    commented: '评论',
    progressed: '更新进度',
    completed: '完成',
    reopened: '重新打开',
    due: '到期',
    triggered: '触发',
    cancelled: '取消',
    rsvp: '回复',
    started: '开始',
    closed: '结束',
  } as Readonly<Record<string, string>>)[action] ?? action
}

function activityText(event: WireEvent, membersBySession: ReadonlyMap<string, FleetPanelMember>): string {
  const data = asRecord(event.data)
  const actorName = (actorId: string | undefined): string => actorId === undefined
    ? '团队成员'
    : membersBySession.get(actorId)?.name
      ?? [...membersBySession.values()].find(member => member.id === actorId)?.name
      ?? (actorId === 'fleet-filesystem' ? '文件系统自动发现' : actorId)
  if (event.type === 'member_status.updated') {
    const status = nestedRecord(event.data, 'status')
    return `${string(status?.member) ?? '团队成员'} 更新了成员自述：${string(status?.message) ?? ''}`
  }
  if (event.type === 'member_status.cleared') {
    return `${string(data?.member) ?? '团队成员'} 清除了成员自述`
  }
  if (event.type === 'coordination.message') {
    const message = nestedRecord(event.data, 'message')
    const senderId = string(message?.from) ?? ''
    const sender = membersBySession.get(senderId)?.name ?? string(message?.fromName) ?? 'Fleet'
    return `${sender} 在 ${string(message?.conversation) ?? '团队会话'} 中发送了消息`
  }
  if (event.type === 'resource.resource_added') {
    const resource = nestedRecord(event.data, 'resource')
    return `${actorName(string(resource?.createdBy))} 添加了共享资源 ${string(resource?.label) ?? basename(string(resource?.path) ?? '文件')}`
  }
  if (event.type === 'resource.resource_removed') {
    const removal = nestedRecord(event.data, 'removal')
    const resource = nestedRecord(removal, 'resource')
    return `${actorName(string(removal?.removedBy))} 删除了共享资源 ${string(resource?.label) ?? basename(string(resource?.path) ?? '文件')}`
  }
  if (event.type === 'resource.resource_revised') {
    const revision = nestedRecord(event.data, 'revision')
    return `${actorName(string(revision?.updatedBy))} 更新了共享资源 ${string(revision?.resourceId) ?? '文件'}`
  }
  if (event.type.startsWith('resource.document_')) {
    const document = nestedRecord(event.data, 'document')
    return `更新了团队文档 ${string(document?.title) ?? string(document?.name) ?? '文档'}`
  }
  if (event.type.startsWith('workspace.')) {
    const workspace = nestedRecord(event.data, 'workspace')
    const member = string(data?.member)
    if (event.type === 'workspace.assigned') return `更新了 ${member ?? '团队成员'} 的工作区挂载`
    if (event.type === 'workspace.detached') return `移除了工作区 ${string(workspace?.name) ?? string(data?.workspaceId) ?? ''}`.trim()
    return `挂载了工作区 ${string(workspace?.name) ?? string(workspace?.path) ?? ''}`.trim()
  }
  if (event.type.startsWith('task.')) {
    const task = nestedRecord(event.data, 'task')
    return `任务已${activityAction(data?.action)}：${string(task?.title) ?? string(task?.id) ?? '未命名任务'}`
  }
  if (event.type.startsWith('schedule.')) {
    const task = nestedRecord(event.data, 'task')
    return `计划已${activityAction(data?.action)}：${string(task?.title) ?? string(task?.id) ?? '未命名计划'}`
  }
  if (event.type.startsWith('calendar.')) {
    const calendar = nestedRecord(event.data, 'event')
    return `日程已${activityAction(data?.action)}：${string(calendar?.title) ?? string(calendar?.id) ?? '未命名日程'}`
  }
  if (event.type === 'coordination.vote') {
    const vote = nestedRecord(event.data, 'vote')
    return `投票${string(data?.action) === 'closed' ? '已结束' : '已更新'}：${string(vote?.statement) ?? '团队决策'}`
  }
  if (event.type === 'team_status') return `团队状态变为 ${string(data?.status) ?? '未知'}`
  if (event.type === 'work_started') return '团队开始了一项工作'
  if (event.type === 'work_status') return `工作状态变为 ${string(data?.status) ?? '未知'}`
  const member = string(data?.displayName) ?? string(data?.name) ?? string(data?.member) ?? '团队成员'
  if (event.type === 'member_attached' || event.type === 'member_resumed') return `${member} 已加入运行`
  if (event.type === 'member_detached') return `${member} 已离开团队`
  if (event.type === 'member_paused') return `${member} 已暂停`
  return event.type.replaceAll('_', ' ')
}

function projectTeam(cache: ProjectionCache): FleetPanelTeamSnapshot {
  const views = new Map(cache.memberViews.map(view => [view.id, view]))
  const statusTexts = new Map<string, { readonly message: string; readonly updatedAt?: string }>()
  for (const event of cache.events) {
    if (event.type === 'member_status.updated') {
      const status = nestedRecord(event.data, 'status')
      const member = string(status?.member)
      const message = string(status?.message)
      const updatedAt = string(status?.updatedAt)
      if (member !== undefined && message !== undefined && message.length > 0) {
        statusTexts.set(member, {
          message,
          ...(updatedAt === undefined ? {} : { updatedAt }),
        })
      }
    } else if (event.type === 'member_status.cleared') {
      const member = string(asRecord(event.data)?.member)
      if (member !== undefined) statusTexts.delete(member)
    }
  }
  const members: FleetPanelMember[] = cache.run.members.map(member => {
    const view = views.get(member.name)
    const provider = member.provider ?? view?.provider
    const model = member.model ?? view?.model
    const memberStatus = statusTexts.get(member.name)
    return {
      id: member.name,
      name: member.displayName ?? view?.name ?? member.name,
      role: view?.role ?? member.role,
      responsibility: view?.responsibility ?? view?.role ?? member.role,
      color: member.color ?? view?.color ?? color(`${cache.run.id}:${member.name}`),
      presence: presence(member.status),
      runtimeStatus: member.status ?? 'unknown',
      ...(memberStatus === undefined ? {} : {
        statusText: memberStatus.message,
        ...(memberStatus.updatedAt === undefined ? {} : { statusUpdatedAt: memberStatus.updatedAt }),
      }),
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      sessionId: member.sessionId,
    }
  })
  const assistants: FleetPanelMember[] = (cache.run.assistants ?? []).map(assistant => {
    const id = assistant.view?.id ?? `assistant-${assistant.sessionId}`
    const role = assistant.view?.role ?? 'Team Assistant'
    return {
      id,
      name: assistant.view?.name ?? id,
      role,
      responsibility: assistant.view?.responsibility ?? role,
      color: assistant.view?.color ?? color(`${cache.run.id}:${id}`),
      presence: presence(assistant.status ?? 'offline'),
      runtimeStatus: assistant.status ?? 'offline',
      ...(assistant.view?.provider === undefined ? {} : { provider: assistant.view.provider }),
      ...(assistant.view?.model === undefined ? {} : { model: assistant.view.model }),
      sessionId: assistant.sessionId,
    }
  })
  const membersBySession = new Map(cache.run.members.flatMap((member, index) => {
    const projected = members[index]
    return projected === undefined ? [] : [[member.sessionId, projected] as const]
  }))
  for (const event of cache.events) {
    if (event.type !== 'member_session_rotated') continue
    const data = asRecord(event.data)
    const memberId = string(data?.member)
    const projected = memberId === undefined ? undefined : members.find(member => member.id === memberId)
    if (projected === undefined) continue
    const previousSessionId = string(data?.previousSessionId)
    const sessionId = string(data?.sessionId)
    if (previousSessionId !== undefined) membersBySession.set(previousSessionId, projected)
    if (sessionId !== undefined) membersBySession.set(sessionId, projected)
  }
  const assistantsBySession = new Map(assistants.flatMap(assistant => assistant.sessionId === undefined
    ? []
    : [[assistant.sessionId, assistant] as const]))
  const participantsBySession = new Map([...membersBySession, ...assistantsBySession])
  const participants = [...members, ...assistants]
  const channels = new Map<string, FleetPanelConversation>()
  const meetings = new Map<string, FleetPanelConversation>()
  const resources = new Map<string, FleetPanelResource>()
  const memberWorkspaces = new Map<string, Array<{ readonly name: string; readonly path: string; readonly access: 'read' | 'write' }>>(
    members.map(member => [member.id, [{ name: 'project', path: cache.run.projectRoot, access: 'write' }]]),
  )
  const rawMessages: Array<{ readonly event: WireEvent; readonly message: Readonly<Record<string, unknown>> }> = []
  const channelVisibleSessions = new Map<string, readonly string[]>()
  const meetingParticipants = new Map<string, readonly string[]>()
  const readThroughByMessage = new Map<string, Map<string, number>>()
  const contextSourcesByMessage = new Map<string, Map<string, FleetChatReceiptSource>>()

  for (const event of cache.events) {
    if (event.type === 'workspace.assigned') {
      const data = asRecord(event.data)
      const member = string(data?.member)
      const assigned = Array.isArray(data?.workspaces) ? data.workspaces.flatMap(candidate => {
        const workspace = asRecord(candidate)
        const name = string(workspace?.name)
        const path = string(workspace?.path)
        const access = string(workspace?.access)
        return name === undefined || path === undefined || (access !== 'read' && access !== 'write')
          ? []
          : [{ name, path, access: access as 'read' | 'write' }]
      }) : []
      if (member !== undefined) memberWorkspaces.set(member, assigned)
      continue
    }
    if (event.type === 'coordination.channel') {
      const channel = nestedRecord(event.data, 'channel')
      const id = string(channel?.id)
      if (id === undefined) continue
      if (channel?.archived === true) {
        channels.delete(`#${id}`)
        continue
      }
      const channelMembers = Array.isArray(channel?.members) ? channel.members.filter((item): item is string => typeof item === 'string') : []
      const createdBy = string(channel?.createdBy)
      const open = channel?.open === true
      channelVisibleSessions.set(`#${id}`, cache.run.members.flatMap(runMember => {
        const contacts = views.get(runMember.name)?.contacts?.channels
        const permitted = contacts === '*' || contacts?.includes(id) === true || createdBy === runMember.sessionId
        const included = open || channelMembers.includes(runMember.sessionId) || createdBy === runMember.sessionId
        return permitted && included ? [runMember.sessionId] : []
      }))
      channels.set(`#${id}`, {
        id: `#${id}`,
        kind: 'channel',
        name: string(channel?.name) ?? id,
        ...((string(channel?.topic) ?? string(channel?.summary)) === undefined
          ? {}
          : { topic: string(channel?.topic) ?? string(channel?.summary) ?? '' }),
        memberCount: channelMembers.length === 0 ? participants.length : channelMembers.length,
        activeCount: channelMembers.length === 0
          ? participants.filter(isPresent).length
          : channelMembers.filter(memberId => isPresent(participantsBySession.get(memberId))).length,
      })
      continue
    }
    if (event.type === 'coordination.meeting') {
      const meeting = nestedRecord(event.data, 'meeting')
      const id = string(meeting?.id)
      if (id === undefined) continue
      const participants = Array.isArray(meeting?.participants)
        ? meeting.participants.filter((item): item is string => typeof item === 'string')
        : []
      meetingParticipants.set(`meeting:${id}`, participants)
      meetings.set(`meeting:${id}`, {
        id: `meeting:${id}`,
        kind: 'channel',
        name: string(meeting?.title) ?? id,
        topic: string(meeting?.agenda) ?? '团队会议',
        memberCount: participants.length,
        activeCount: participants.filter(memberId => isPresent(participantsBySession.get(memberId))).length,
      })
      continue
    }
    if (event.type === 'coordination.message') {
      const message = nestedRecord(event.data, 'message')
      if (message !== undefined) rawMessages.push({ event, message })
      continue
    }
    if (event.type === 'coordination.inbox') {
      const data = asRecord(event.data)
      const messageId = string(data?.messageId)
      const agentId = string(data?.agentId)
      if (data?.type !== 'inbox' || messageId === undefined || agentId === undefined) continue
      const member = participantsBySession.get(agentId)
      if (member === undefined) continue
      if (data.action === 'delivered') {
        const contextMessageId = string(data.contextMessageId)
        if (contextMessageId === undefined) continue
        const sources = contextSourcesByMessage.get(messageId) ?? new Map<string, FleetChatReceiptSource>()
        sources.set(member.id, { memberId: member.id, sessionId: agentId, contextMessageId })
        contextSourcesByMessage.set(messageId, sources)
      } else if (data.action === 'read' || data.action === 'acknowledged') {
        const through = data.action === 'acknowledged'
          ? Number.MAX_SAFE_INTEGER
          : typeof data.through === 'number' && Number.isSafeInteger(data.through) && data.through >= 0
            ? data.through
            : undefined
        if (through === undefined) continue
        const readers = readThroughByMessage.get(messageId) ?? new Map<string, number>()
        readers.set(member.id, Math.max(readers.get(member.id) ?? 0, through))
        readThroughByMessage.set(messageId, readers)
      }
      continue
    }
    if (event.type === 'resource.resource_added') {
      const resource = nestedRecord(event.data, 'resource')
      const id = string(resource?.id)
      const path = string(resource?.path)
      if (id === undefined || path === undefined) continue
      const label = string(resource?.label) ?? basename(path)
      const mediaType = string(resource?.mediaType)
      const size = typeof resource?.size === 'number' ? resource.size : undefined
      const detail = [mediaType ?? '共享文件', formatBytes(size)].filter(Boolean).join(' · ')
      resources.set(id, {
        id,
        name: label,
        kind: label === 'plan.md' ? 'plan' : label === 'checklist.md' ? 'checklist' : 'file',
        path,
        detail,
        ...(size === undefined ? {} : { size }),
        ...(mediaType === undefined ? {} : { mediaType }),
        updatedAt: string(resource?.createdAt) ?? event.createdAt,
      })
      continue
    }
    if (event.type === 'resource.resource_removed') {
      const id = string(nestedRecord(nestedRecord(event.data, 'removal'), 'resource')?.id)
      if (id !== undefined) resources.delete(id)
      continue
    }
  }

  const workspacesByPath = new Map<string, FleetPanelWorkspace>()
  for (const [member, assigned] of memberWorkspaces) {
    for (const workspace of assigned) {
      const existing = workspacesByPath.get(workspace.path)
      workspacesByPath.set(workspace.path, {
        id: `workspace:${workspace.path}`,
        name: existing?.name ?? workspace.name,
        path: workspace.path,
        access: existing?.access === 'write' || workspace.access === 'write' ? 'write' : 'read',
        members: [...(existing?.members ?? []), member],
      })
    }
  }

  const directParticipants = new Map<string, readonly string[]>()
  for (const member of members) {
    const runMember = cache.run.members.find(candidate => candidate.name === member.id)
    if (runMember === undefined) continue
    const id = `@${runMember.sessionId}`
    directParticipants.set(id, [runMember.sessionId])
    channels.set(id, { id, kind: 'direct', name: member.name, topic: member.role, peerId: member.id })
  }
  for (const assistant of assistants) {
    if (assistant.sessionId === undefined) continue
    const id = `@${assistant.sessionId}`
    directParticipants.set(id, [assistant.sessionId])
    channels.set(id, { id, kind: 'direct', name: assistant.name, topic: assistant.role, peerId: assistant.id })
  }

  const senderFace = (sessionId: string, fromName?: string): FleetChatMember => {
    const member = membersBySession.get(sessionId)
    if (member !== undefined) return member
    const assistant = assistantsBySession.get(sessionId)
    if (assistant !== undefined) return assistant
    if (isFleetUser(sessionId)) return {
      id: 'operator',
      name: fromName ?? 'You',
      role: '外部观察者',
      color: '#737985',
      presence: 'active',
      operator: true,
    }
    return {
      id: sessionId || 'fleet',
      name: fromName ?? (sessionId === 'fleet' ? 'Fleet' : sessionId.slice(0, 8)),
      role: sessionId === 'fleet' ? '系统' : '团队接入者',
      color: color(sessionId || 'fleet'),
      presence: 'active',
    }
  }

  const privateMessageSequences = new Set<number>()
  const messages: FleetPanelMessage[] = rawMessages.flatMap(({ event, message }): FleetPanelMessage[] => {
    const id = string(message.id)
    const target = string(message.conversation)
    const from = string(message.from)
    const text = string(message.text)
    if (id === undefined || target === undefined || from === undefined || text === undefined) return []
    let conversationId = target
    if (target.startsWith('@')) {
      const recipient = target.slice(1)
      const participants = [...new Set([from, recipient])]
      const formal = [...new Map(participants.flatMap(participant => {
        const member = membersBySession.get(participant)
        return member === undefined ? [] : [[member.id, member] as const]
      })).values()]
      const attachedAssistants = participants.flatMap(participant => {
        const assistant = assistantsBySession.get(participant)
        return assistant === undefined ? [] : [assistant]
      })
      const fleetUsers = participants.filter(isFleetUser)
      if (participants.length === 2 && formal.length === 1 && fleetUsers.length === 1) {
        const currentSession = cache.run.members.find(member => member.name === formal[0]?.id)?.sessionId
        conversationId = `@${currentSession ?? recipient}`
      } else if (participants.length === 2 && attachedAssistants.length === 1 && fleetUsers.length === 1) {
        conversationId = `@${attachedAssistants[0]?.sessionId ?? recipient}`
      } else {
        const stableParticipants = participants.map(participant => {
          const member = membersBySession.get(participant)
          return member === undefined ? participant : `member:${member.id}`
        })
        conversationId = `dm:${stableParticipants.toSorted().join(':')}`
        if (!channels.has(conversationId)) {
          const labels = participants.map(participant => senderFace(participant).name)
          const participantIds = participants.flatMap(participant => {
            const member = membersBySession.get(participant)
            return member === undefined ? [] : [member.id]
          })
          channels.set(conversationId, {
            id: conversationId,
            kind: 'direct',
            name: labels.join(' ↔ '),
            topic: '团队成员私聊 · 只读观察',
            ...(participantIds.length < 2 ? {} : { participantIds }),
          })
        }
      }
      directParticipants.set(conversationId, participants.map(participant => {
        const member = membersBySession.get(participant)
        return member === undefined
          ? participant
          : cache.run.members.find(candidate => candidate.name === member.id)?.sessionId ?? participant
      }))
      if (conversationId.startsWith('dm:')) privateMessageSequences.add(event.sequence)
    } else if (target.startsWith('#') && !channels.has(target)) {
      channels.set(target, { id: target, kind: 'channel', name: target.slice(1), topic: '团队频道' })
    } else if (target.startsWith('meeting:') && !meetings.has(target)) {
      meetings.set(target, { id: target, kind: 'channel', name: target.slice('meeting:'.length), topic: '团队会议' })
    }
    const blocks: FleetChatContentBlock[] = [{ type: 'text', text }]
    const mentions = Array.isArray(message.mentions)
      ? message.mentions.filter((item): item is string => typeof item === 'string')
      : []
    for (const mention of mentions) {
      const mentioned = membersBySession.get(mention)
      if (mentioned !== undefined && textContainsMention(text, [mentioned.id, mentioned.name, mention])) continue
      blocks.push({ type: 'mention', memberId: mentioned?.id ?? mention, label: mentioned?.name ?? mention })
    }
    const resourceIds = Array.isArray(message.resources)
      ? message.resources.filter((item): item is string => typeof item === 'string')
      : []
    for (const resourceId of resourceIds) {
      const resource = resources.get(resourceId)
      blocks.push({
        type: 'resource',
        id: resourceId,
        label: resource?.name ?? resourceId,
        ...(resource?.mediaType === undefined ? {} : { mediaType: resource.mediaType }),
      })
    }
    const sender = senderFace(from, string(message.fromName))
    const senderMember = membersBySession.get(from)
    const directRecipientMember = target.startsWith('@') ? membersBySession.get(target.slice(1)) : undefined
    const directRecipientAssistant = target.startsWith('@') ? assistantsBySession.get(target.slice(1)) : undefined
    const visibleSessions = cache.run.members.flatMap(runMember => {
      if (runMember.sessionId === from || senderMember?.id === runMember.name) return []
      if (target.startsWith('@')) {
        return target.slice(1) === runMember.sessionId || directRecipientMember?.id === runMember.name
          ? [runMember.sessionId]
          : []
      }
      if (target.startsWith('meeting:')) {
        return meetingParticipants.get(target)?.includes(runMember.sessionId) === true ? [runMember.sessionId] : []
      }
      if (!target.startsWith('#')) return []
      const projected = channelVisibleSessions.get(target)
      if (projected !== undefined) return projected.includes(runMember.sessionId) ? [runMember.sessionId] : []
      const channel = target.slice(1)
      const contacts = views.get(runMember.name)?.contacts?.channels
      return contacts === '*' || contacts?.includes(channel) === true ? [runMember.sessionId] : []
    })
    if (directRecipientAssistant?.sessionId !== undefined && directRecipientAssistant.sessionId !== from) {
      visibleSessions.push(directRecipientAssistant.sessionId)
    }
    const readThrough = readThroughByMessage.get(id) ?? new Map<string, number>()
    const visibleMemberIds = visibleSessions.flatMap(sessionId => {
      const member = participantsBySession.get(sessionId)
      return member === undefined ? [] : [member.id]
    })
    const readMemberIds = visibleSessions.flatMap(sessionId => {
      const member = participantsBySession.get(sessionId)
      return member !== undefined && (readThrough.get(member.id) ?? 0) >= text.length ? [member.id] : []
    })
    const readMemberIdSet = new Set(readMemberIds)
    const sources = visibleSessions.flatMap(sessionId => {
      const member = participantsBySession.get(sessionId)
      const source = member === undefined ? undefined : contextSourcesByMessage.get(id)?.get(member.id)
      return source === undefined ? [] : [source]
    })
    return [{
      id,
      sequence: event.sequence,
      conversationId,
      senderId: sender.id,
      sender,
      sentAt: string(message.createdAt) ?? event.createdAt,
      content: blocks,
      ...(visibleMemberIds.length === 0 ? {} : {
        receipt: {
          visibleMemberIds,
          readMemberIds,
          unreadMemberIds: visibleMemberIds.filter(memberId => !readMemberIdSet.has(memberId)),
          ...(sources.length === 0 ? {} : { sources }),
        },
      }),
    }]
  })

  const conversations = [...channels.values(), ...meetings.values()]
  const projectedMembers = members.map(member => {
    const view = views.get(member.id)
    const runMember = cache.run.members.find(candidate => candidate.name === member.id)
    if (runMember === undefined) return member
    const visibleConversationIds = conversations.flatMap(conversation => {
      if (conversation.id.startsWith('#')) {
        const channel = conversation.id.slice(1)
        return view?.contacts?.channels === '*' || view?.contacts?.channels?.includes(channel) === true
          ? [conversation.id]
          : []
      }
      if (conversation.id.startsWith('meeting:')) {
        return meetingParticipants.get(conversation.id)?.includes(runMember.sessionId) === true ? [conversation.id] : []
      }
      const participants = directParticipants.get(conversation.id) ?? []
      return participants.includes(runMember.sessionId) ? [conversation.id] : []
    })
    return { ...member, visibleConversationIds }
  })

  const activity: FleetPanelActivity[] = cache.events.flatMap((event): FleetPanelActivity[] => {
    if (privateMessageSequences.has(event.sequence)) return []
    const kind = activityKind(event.type)
    return kind === undefined ? [] : [{
      id: `${cache.run.id}:${String(event.sequence)}`,
      kind,
      text: activityText(event, membersBySession),
      createdAt: event.createdAt,
    }]
  })

  return {
    teamId: cache.run.id,
    teamName: cache.run.name,
    color: color(cache.run.id),
    status: cache.run.status,
    ...(cache.run.runtimeState === undefined ? {} : { runtimeState: cache.run.runtimeState }),
    conversations,
    members: projectedMembers,
    assistants,
    messages,
    resources: [...resources.values()],
    workspaces: [...workspacesByPath.values()],
    activity,
  }
}

function directory(runs: readonly WireRun[]): FleetPanelTeamDirectory {
  const active = runs.filter(run => run.status !== 'closed').map(run => run.id)
  const archived = runs.filter(run => run.status === 'closed').map(run => run.id)
  return {
    teams: runs.map(run => ({
      teamId: run.id,
      teamName: run.name,
      assistantSessionIds: (run.assistants ?? []).map(assistant => assistant.sessionId),
      color: color(run.id),
      status: run.status,
      ...(run.runtimeState === undefined ? {} : { runtimeState: run.runtimeState }),
      primaryWorkspace: basename(run.projectRoot),
      ...(run.status === 'failed' ? { needsAttention: true } : {}),
    })),
    groups: [
      { id: 'ungrouped', name: '未分组', kind: 'ungrouped', teamIds: active },
      { id: 'archived', name: '已归档', kind: 'archived', teamIds: archived },
    ],
  }
}

export interface FleetWebPanelSource extends FleetPanelSource {
  refresh(): Promise<void>
  invalidate(): Promise<void>
  dispose(): void
}

/** Cursor-based projection refreshed by the Fleet browser-peer notification channel. */
export function createFleetWebPanelSource(
  getClient: (signal?: AbortSignal) => Promise<FleetWebClient>,
): FleetWebPanelSource {
  let snapshot: FleetPanelSnapshot = { directory: EMPTY_DIRECTORY, connection: { status: 'loading' } }
  let selectedTeamId: string | undefined
  let refreshing: Promise<void> | undefined
  let refreshAgain = false
  let disposed = false
  let signature = 'loading:'
  let dataSignature = ''
  const lifetime = new AbortController()
  const listeners = new Set<() => void>()
  const projections = new Map<string, ProjectionCache>()

  const cacheProjection = (teamId: string, projection: ProjectionCache): void => {
    projections.delete(teamId)
    projections.set(teamId, projection)
    while (projections.size > MAX_TEAM_PROJECTION_CACHES) {
      const oldest = projections.keys().next().value as string | undefined
      if (oldest === undefined) break
      projections.delete(oldest)
    }
  }

  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  const publish = (next: FleetPanelSnapshot, nextSignature: string): void => {
    if (nextSignature === signature) return
    signature = nextSignature
    snapshot = next
    emit()
  }
  const loadProjection = async (client: FleetWebClient, teamId: string): Promise<ProjectionCache> => {
    const current = projections.get(teamId)
    if (current !== undefined) cacheProjection(teamId, current)
    let afterSequence = current?.lastSequence ?? 0
    let run = current?.run
    let memberViews = current?.memberViews ?? []
    let events = current?.events ?? []
    while (true) {
      const page = wireProjection(unwrap(await client.project({
        teamId,
        view: 'team',
        afterSequence,
        limit: PAGE_SIZE,
      }, lifetime.signal)))
      run = page.run
      memberViews = page.memberViews
      if (page.events.length > 0) {
        const known = new Set(events.map(event => event.sequence))
        events = compactTeamEvents([...events, ...page.events.filter(event => !known.has(event.sequence))])
        afterSequence = events.at(-1)?.sequence ?? afterSequence
        afterSequence = Math.max(afterSequence, page.events.at(-1)?.sequence ?? afterSequence)
      }
      if (!page.hasMore || page.events.length === 0) break
    }
    if (run === undefined) throw new Error(`Fleet Team ${teamId} has no projection`)
    const result = { run, memberViews, events, lastSequence: afterSequence }
    cacheProjection(teamId, result)
    return result
  }
  const performRefresh = async (): Promise<void> => {
    const client = await getClient(lifetime.signal)
    const runs = wireRuns(unwrap(await client.list(lifetime.signal)))
    const ids = new Set(runs.map(run => run.id))
    for (const id of projections.keys()) if (!ids.has(id)) projections.delete(id)
    if (selectedTeamId === undefined || !ids.has(selectedTeamId)) selectedTeamId = runs[0]?.id
    const selected = selectedTeamId
    const nextDirectory = directory(runs)
    if (selected === undefined) {
      dataSignature = `${runDirectorySignature(runs)}:`
      const nextSignature = `connected:${dataSignature}`
      if (nextSignature === signature) return
      publish({
        directory: nextDirectory,
        connection: { status: 'connected', updatedAt: new Date().toISOString() },
      }, nextSignature)
      return
    }
    const projection = await loadProjection(client, selected)
    if (selected !== selectedTeamId) return
    const visibleSequence = projection.events.at(-1)?.sequence ?? 0
    dataSignature = `${runDirectorySignature(runs)}:${selected}:${String(visibleSequence)}`
    const nextSignature = `connected:${dataSignature}`
    if (nextSignature === signature) return
    publish({
      directory: nextDirectory,
      selectedTeamId: selected,
      team: projectTeam(projection),
      connection: { status: 'connected', updatedAt: new Date().toISOString() },
    }, nextSignature)
  }
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (refreshing !== undefined) {
      refreshAgain = true
      return refreshing
    }
    refreshing = performRefresh()
      .catch(error => {
        if (lifetime.signal.aborted) return
        const message = error instanceof Error ? error.message : 'Fleet Web Remote 请求失败'
        publish({
          ...snapshot,
          connection: { status: 'disconnected', error: message },
        }, `disconnected:${dataSignature}:${message}`)
      })
      .finally(() => {
        refreshing = undefined
        if (refreshAgain) {
          refreshAgain = false
          void refresh()
        }
      })
    return refreshing
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      if (listeners.size === 1) void refresh()
      return () => {
        listeners.delete(listener)
      }
    },
    invalidate: () => listeners.size > 0 ? refresh() : Promise.resolve(),
    selectTeam: teamId => {
      if (teamId === selectedTeamId) return
      selectedTeamId = teamId
      const cached = projections.get(teamId)
      dataSignature = `${dataSignature}:select:${teamId}`
      publish({
        directory: snapshot.directory,
        selectedTeamId: teamId,
        ...(cached === undefined ? {} : { team: projectTeam(cached) }),
        ...(snapshot.connection === undefined ? {} : { connection: snapshot.connection }),
      }, `${snapshot.connection?.status ?? 'connected'}:${dataSignature}`)
      void refresh()
    },
    retry: () => {
      publish({
        ...snapshot,
        connection: { status: 'loading' },
      }, `loading:${dataSignature}`)
      return refresh()
    },
    loadMemberTrace: async (teamId, memberId, signal, request) => {
      const client = await getClient(signal)
      const page = traceProjection(unwrap(await client.project({
        teamId,
        view: 'trace',
        member: memberId,
        ...(request?.source === undefined
          ? { tail: true, ...(request?.cursor === undefined ? {} : { archiveCursor: request.cursor }) }
          : {
              sourceSessionId: request.source.sessionId,
              contextMessageId: request.source.contextMessageId,
            }),
        afterSequence: -1,
        limit: MAX_MEMBER_TRACE_EVENTS,
      }, signal)))
      const recent = page.events
        .filter(event => event.type !== 'session.assistant/chunk' && event.type !== 'session.session/end-seed')
        .slice(-MAX_MEMBER_TRACE_EVENTS)
      return {
        events: recent.map(event => ({
          sequence: event.sequence,
          ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
          createdAt: event.createdAt,
          type: event.type,
          data: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
          target: page.targetSequence === event.sequence
            && (page.targetSessionId === undefined || page.targetSessionId === event.sessionId),
        })),
        truncated: page.hasMore || page.events.length > recent.length,
        ...(page.previous === undefined ? {} : { previous: page.previous }),
      } satisfies FleetPanelMemberTrace
    },
    loadConversationMessages: async (teamId, conversationId, beforeSequence, signal) => {
      const client = await getClient(signal ?? lifetime.signal)
      const page = wireProjection(unwrap(await client.project({
        teamId,
        view: 'conversation',
        conversation: conversationId,
        beforeSequence,
        limit: 100,
      }, signal ?? lifetime.signal)))
      const current = projections.get(teamId) ?? await loadProjection(client, teamId)
      const known = new Set<number>()
      const events = [...current.events, ...page.events].filter(event => {
        if (known.has(event.sequence)) return false
        known.add(event.sequence)
        return true
      }).toSorted((left, right) => left.sequence - right.sequence)
      const pageMessageSequences = new Set(page.events
        .filter(event => event.type === 'coordination.message')
        .map(event => event.sequence))
      const projected = projectTeam({
        run: page.run,
        memberViews: page.memberViews,
        events,
        lastSequence: current.lastSequence,
      })
      return {
        messages: projected.messages.filter(message => message.sequence !== undefined
          && pageMessageSequences.has(message.sequence)),
        hasMore: page.hasMore,
        ...(page.previousSequence === undefined ? {} : { previousSequence: page.previousSequence }),
      }
    },
    loadMemberAuthorization: async (teamId, memberId, signal) => {
      const client = await getClient(signal ?? lifetime.signal)
      return memberAuthorization(unwrap(await client.project({
        teamId,
        view: 'member',
        member: memberId,
      }, signal ?? lifetime.signal)))
    },
    loadResource: async (teamId, resourceId, signal, revisionId) => {
      const client = await getClient(signal ?? lifetime.signal)
      return resourceContent(unwrap(await client.project({
        teamId,
        view: 'resource',
        resource: resourceId,
        ...(revisionId === undefined ? {} : { revision: revisionId }),
      }, signal ?? lifetime.signal)))
    },
    exportTeam: async (teamId, signal) => {
      const client = await getClient(signal ?? lifetime.signal)
      const value = unwrap(await client.project({
        teamId,
        view: 'configuration',
      }, signal ?? lifetime.signal))
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Fleet Team 导出结果无效')
      }
      return value as Record<string, unknown>
    },
    exportArchive: async (input, signal): Promise<FleetPanelArchiveFile> => {
      const client = await getClient(signal ?? lifetime.signal)
      const started = archiveObject(unwrap(await client.archive({
        sessionId: input.sessionId,
        action: 'export',
        teamId: input.teamId,
        includeWorkspace: input.includeWorkspace,
      }, signal ?? lifetime.signal)), 'Fleet 存档导出')
      const transferId = archiveText(started.transferId, 'Fleet 存档传输标识')
      const name = archiveText(started.name, 'Fleet 存档名称')
      const size = started.size
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) throw new Error('Fleet 存档大小无效')
      const chunks: BlobPart[] = []
      let offset = 0
      try {
        while (offset < size) {
          const page = archiveObject(unwrap(await client.archive({
            sessionId: input.sessionId,
            action: 'read',
            transferId,
            offset,
          }, signal ?? lifetime.signal)), 'Fleet 存档分块')
          chunks.push(decodeFleetBase64(archiveText(page.base64, 'Fleet 存档分块内容')))
          if (typeof page.nextOffset !== 'number' || !Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) {
            throw new Error('Fleet 存档分块偏移无效')
          }
          offset = page.nextOffset
        }
      } catch (error) {
        await client.archive({ sessionId: input.sessionId, action: 'cancel', transferId }, signal).catch(() => undefined)
        throw error
      }
      return { name, blob: new Blob(chunks, { type: 'application/gzip' }) }
    },
    importArchive: async (input, signal) => {
      const client = await getClient(signal ?? lifetime.signal)
      const started = archiveObject(unwrap(await client.archive({
        sessionId: input.sessionId,
        action: 'begin_import',
        name: input.file.name,
      }, signal ?? lifetime.signal)), 'Fleet 存档导入')
      const transferId = archiveText(started.transferId, 'Fleet 存档传输标识')
      let offset = 0
      try {
        while (offset < input.file.size) {
          const chunk = input.file.slice(offset, Math.min(input.file.size, offset + 512 * 1024))
          const page = archiveObject(unwrap(await client.archive({
            sessionId: input.sessionId,
            action: 'write',
            transferId,
            offset,
            base64: encodeFleetFile(await chunk.arrayBuffer()),
          }, signal ?? lifetime.signal)), 'Fleet 存档上传分块')
          if (typeof page.nextOffset !== 'number' || !Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) {
            throw new Error('Fleet 存档上传偏移无效')
          }
          offset = page.nextOffset
        }
        unwrap(await client.archive({
          sessionId: input.sessionId,
          action: 'finish_import',
          transferId,
          projectRoot: input.projectRoot,
          importMode: input.mode,
        }, signal ?? lifetime.signal))
        await refresh()
      } catch (error) {
        await client.archive({ sessionId: input.sessionId, action: 'cancel', transferId }, signal).catch(() => undefined)
        throw error
      }
    },
    sendMessage: async input => {
      const conversation = snapshot.team?.teamId === input.teamId
        ? snapshot.team.conversations.find(candidate => candidate.id === input.conversationId)
        : undefined
      const assistantDirect = input.conversationId.startsWith('@')
        && snapshot.directory.teams.find(team => team.teamId === input.teamId)
          ?.assistantSessionIds?.includes(input.conversationId.slice(1)) === true
      if (conversation === undefined && !assistantDirect) throw new Error('当前 Fleet 会话已不可用')
      const target = conversation?.id ?? input.conversationId
      if (!target.startsWith('#') && !target.startsWith('@') && !target.startsWith('meeting:')) {
        throw new Error('团队成员之间的私聊在外部观察者视图中只读')
      }
      const text = input.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
      if (text.length === 0) throw new Error('当前 Fleet Remote 只接受可输入的文本正文')
      const resources = input.content.flatMap(block => block.type === 'resource' ? [block.id] : [])
      const mentions = (input.mentions ?? input.content.flatMap(block => block.type === 'mention' ? [block.memberId] : []))
        .map(mention => mention.startsWith('@') ? mention : `@${mention}`)
      const client = await getClient(lifetime.signal)
      unwrap(await client.send({
        sessionId: input.sessionId,
        teamId: input.teamId,
        mode: 'conversation',
        to: target,
        text,
        delivery: input.delivery ?? (conversation?.kind === 'direct' || assistantDirect ? 'wakeup' : 'quiet'),
        ...(resources.length === 0 ? {} : { resources }),
        ...(mentions.length === 0 ? {} : { mentions }),
      }, lifetime.signal))
      await refresh()
    },
    uploadResource: async input => {
      if (input.file.size > 25 * 1024 * 1024) throw new Error(`${input.file.name} 超过 Fleet 的 25 MiB 上传限制`)
      const client = await getClient(lifetime.signal)
      unwrap(await client.upload({
        sessionId: input.sessionId,
        teamId: input.teamId,
        name: input.file.name,
        base64: encodeFleetFile(await input.file.arrayBuffer()),
        label: input.file.name,
        ...(input.file.type.length === 0 ? {} : { mediaType: input.file.type }),
      }, lifetime.signal))
      await refresh()
    },
    controlTeam: async input => {
      const client = await getClient(lifetime.signal)
      unwrap(await client.control({
        sessionId: input.sessionId,
        teamId: input.teamId,
        action: input.action,
        ...(input.summary === undefined ? {} : { summary: input.summary }),
      }, lifetime.signal))
      await refresh()
    },
    controlMember: async input => {
      const client = await getClient(lifetime.signal)
      unwrap(await client.member({
        sessionId: input.sessionId,
        teamId: input.teamId,
        action: input.action,
        member: input.memberId,
      }, lifetime.signal))
      await refresh()
    },
    updateMemberPermissions: async input => {
      const client = await getClient(lifetime.signal)
      const value = unwrap(await client.member({
        sessionId: input.sessionId,
        teamId: input.teamId,
        action: input.reset === true ? 'reset_permissions' : 'permissions',
        member: input.memberId,
        ...(input.groups === undefined ? {} : { groups: input.groups }),
      }, lifetime.signal))
      await refresh()
      return memberAuthorization(value)
    },
    refresh,
    dispose: () => {
      if (disposed) return
      disposed = true
      lifetime.abort(new Error('Fleet panel source disposed'))
      listeners.clear()
    },
  }
}
