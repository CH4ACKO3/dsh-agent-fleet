import { randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  TypertRemoteService,
} from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types'
import type {} from '@deepseek-ai/dsh-typert-registry'
import {
  FLEET_WEB_INVOCATIONS,
  FLEET_WEB_REMOTE,
  type FleetWebSetupUploadInput,
} from '@dsh-agent-fleet/core/web'

import type { FleetMemberView } from './member-view.js'
import type { FleetAssistantRuntime } from './assistant.js'
import type {
  FleetAccessEffect,
  FleetAccessLevel,
  FleetAccessScope,
  FleetAccessService,
} from './authorization/access.js'
import { fleetPrivateGroupId } from './authorization/groups.js'
import type { FleetMemberAccess, FleetPermissionService } from './authorization/permissions.js'
import type {
  ConfigureFleetBudgetInput,
  FleetMemberRequestPatch,
  FleetRunService,
  FleetTeamSettings,
  FleetWorkStatus,
} from './run.js'
import type { FleetSetupService } from './setup.js'

export interface FleetWebProjectInput {
  readonly teamId: string
  readonly view?: 'team' | 'member' | 'trace' | 'conversation' | 'resource' | 'configuration' | 'settings'
  readonly member?: string
  readonly conversation?: string
  readonly resource?: string
  readonly revision?: string
  readonly tail?: boolean
  readonly afterSequence?: number
  readonly beforeSequence?: number
  readonly archiveCursor?: { readonly segment: number; readonly beforeSeq: number }
  readonly sourceSessionId?: string
  readonly contextMessageId?: string
  readonly limit?: number
}

export interface FleetWebSendInput {
  readonly sessionId: string
  readonly teamId: string
  readonly mode: 'conversation' | 'relay'
  readonly text: string
  readonly to?: `@${string}` | `#${string}` | `meeting:${string}`
  readonly kind?: 'collaboration' | 'directive'
  readonly mentions?: readonly string[]
  readonly resources?: readonly string[]
  readonly delivery?: 'quiet' | 'wakeup' | 'interrupt'
}

export interface FleetWebMemberInput {
  readonly sessionId: string
  readonly teamId: string
  readonly action: 'add' | 'update' | 'configure' | 'configure_assistant' | 'configure_all' | 'pause' | 'resume' | 'wake' | 'remove' | 'permissions' | 'reset_permissions' | 'get_access' | 'set_access_mode' | 'add_access_rule' | 'remove_access_rule'
  readonly member?: string
  readonly view?: FleetMemberView
  readonly request?: FleetMemberRequestPatch
  readonly assignment?: FleetMemberAccess
  readonly resourceKind?: string
  readonly accessMode?: 'inherit' | 'restricted'
  readonly accessRule?: {
    readonly resourceKind: string
    readonly resourceId: string
    readonly scope: FleetAccessScope
    readonly effect: FleetAccessEffect
    readonly levels: readonly FleetAccessLevel[]
  }
  readonly accessRuleId?: string
}

export interface FleetWebControlInput {
  readonly sessionId: string
  readonly teamId: string
  readonly action: 'start' | 'finish' | 'load' | 'pause' | 'resume' | 'wake' | 'close' | 'configure' | 'budget'
  readonly taskPath?: string
  readonly status?: Exclude<FleetWorkStatus, 'running'>
  readonly summary?: string
  readonly settings?: FleetTeamSettings
  readonly budget?: Omit<ConfigureFleetBudgetInput, 'runId'>
}

export interface FleetWebUploadInput {
  readonly sessionId: string
  readonly teamId: string
  readonly name: string
  readonly base64: string
  readonly label?: string
  readonly mediaType?: string
}

export interface FleetWebRemoveResourceInput {
  readonly sessionId: string
  readonly teamId: string
  readonly resourceId: string
}

export interface FleetWebArchiveInput {
  readonly sessionId: string
  readonly action: 'export' | 'read' | 'begin_import' | 'write' | 'finish_import' | 'cancel'
  readonly teamId?: string
  readonly includeWorkspace?: boolean
  readonly transferId?: string
  readonly offset?: number
  readonly base64?: string
  readonly name?: string
  readonly projectRoot?: string
  readonly importMode?: 'copy' | 'restore'
}

interface FleetWebArchiveTransfer {
  readonly id: string
  readonly sessionId: string
  readonly kind: 'export' | 'import'
  readonly path: string
  readonly name: string
}

const ARCHIVE_CHUNK_BYTES = 512 * 1024

export { FLEET_WEB_INVOCATIONS, FLEET_WEB_REMOTE }

export const FLEET_WEB_LOCAL: TypertContribution = {
  package: 'dsh-agent-fleet/web',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: FLEET_WEB_INVOCATIONS,
}

function required(value: string | undefined, label: string): string {
  const result = value?.trim() ?? ''
  if (result.length === 0) throw new Error(`${label} cannot be empty`)
  return result
}

export class FleetWebRemote extends TypertRemoteService {
  private readonly archiveTransfers = new Map<string, FleetWebArchiveTransfer>()

  constructor(
    private readonly host: Context,
    private readonly runs: FleetRunService,
    private readonly setups: FleetSetupService,
    private readonly permissions?: FleetPermissionService,
    private readonly assistant?: FleetAssistantRuntime,
    private readonly access?: FleetAccessService,
  ) {
    super(host, 'fleetWeb', { namespace: 'fleet' })
    host.effect(() => () => {
      for (const transfer of this.archiveTransfers.values()) this.removeArchiveTransfer(transfer)
      this.archiveTransfers.clear()
    }, 'fleetWeb archive transfers')
  }

  list(signal: AbortSignal) {
    signal.throwIfAborted()
    return this.runs.list()
  }

  project(input: FleetWebProjectInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const teamId = required(input.teamId, 'teamId')
    const after = input.afterSequence ?? (input.view === 'trace' ? -1 : 0)
    const limit = input.limit ?? 200
    if (!Number.isSafeInteger(after) || after < (input.view === 'trace' ? -1 : 0)) {
      throw new Error(`afterSequence must be at least ${input.view === 'trace' ? '-1' : '0'}`)
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be from 1 through 500')
    if (input.tail === true && input.view !== 'trace') throw new Error('tail projection is only available for member traces')
    if (input.view === 'resource') {
      return this.runs.readResourcePreview(teamId, required(input.resource, 'resource'), signal, input.revision)
    }
    if (input.view === 'configuration') return this.runs.exportConfiguration(teamId)
    if (input.view === 'settings') return this.runs.teamSettings(teamId)
    if (input.view === 'trace') {
      const member = required(input.member, 'member')
      if (input.sourceSessionId !== undefined || input.contextMessageId !== undefined) {
        return this.runs.readMemberSourceTrace(
          teamId,
          member,
          required(input.sourceSessionId, 'sourceSessionId'),
          required(input.contextMessageId, 'contextMessageId'),
          limit,
        )
      }
      return input.tail === true || input.archiveCursor !== undefined
        ? this.runs.readMemberTracePage(teamId, member, limit, input.archiveCursor, signal)
        : this.runs.readMemberTrace(teamId, member, after, limit)
    }
    if (input.view === 'conversation') {
      const before = input.beforeSequence ?? Number.MAX_SAFE_INTEGER
      if (!Number.isSafeInteger(before) || before < 1) throw new Error('beforeSequence must be a positive safe integer')
      return this.runs.readConversationProjection(
        teamId,
        required(input.conversation, 'conversation'),
        before,
        limit,
      )
    }
    if (input.view === 'member') {
      const member = required(input.member, 'member')
      const projection = this.runs.readMemberProjection(teamId, member, after, limit)
      return this.permissions === undefined
        ? projection
        : { ...projection, authorization: this.permissions.inspectMember(teamId, member) }
    }
    if (input.view === undefined || input.view === 'team') return this.runs.readWebTeamProjection(teamId, after, limit)
    throw new Error(`unknown Fleet project view ${String(input.view)}`)
  }

  send(input: FleetWebSendInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const teamId = required(input.teamId, 'teamId')
    if (input.mode === 'relay') {
      const caller = this.caller(input.sessionId)
      this.runs.requireAssistantConnection(caller, teamId)
      return this.runs.sendAssistantMessage(caller, {
        runId: teamId,
        kind: input.kind ?? 'collaboration',
        text: input.text,
      })
    }
    if (input.mode === 'conversation') {
      const to = required(input.to, 'to') as `@${string}` | `#${string}` | `meeting:${string}`
      const send = (target: typeof to) => this.runs.sendUserConversationMessage({
        runId: teamId,
        to: target,
        text: input.text,
        delivery: input.delivery ?? 'quiet',
        ...(input.mentions === undefined ? {} : { mentions: input.mentions }),
        ...(input.resources === undefined ? {} : { resources: input.resources }),
      })
      if (!to.startsWith('@') || this.assistant === undefined) return send(to)
      const team = this.runs.status(teamId)
      const target = to.slice(1)
      const offlineAssistant = team.assistants.find(candidate =>
        (candidate.sessionId === target || candidate.view.id === target) && candidate.status === 'offline')
      if (offlineAssistant === undefined) return send(to)
      const caller = this.caller(input.sessionId)
      if (team.members.some(member => member.sessionId === String(caller.id))) return send(to)
      const connectedAssistant = team.assistants.find(candidate => candidate.sessionId === String(caller.id))
      if (connectedAssistant !== undefined && connectedAssistant.view.id !== offlineAssistant.view.id) return send(to)
      return this.runs.attachAssistant(caller, {
        runId: teamId,
        assistantId: offlineAssistant.view.id,
      }).then(attached => {
        this.assistant?.activate(caller, attached.run.id, attached.assistant.view)
        return send(`@${attached.assistant.sessionId}`)
      })
    }
    throw new Error(`unknown Fleet send mode ${String(input.mode)}`)
  }

  member(input: FleetWebMemberInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const caller = this.caller(input.sessionId)
    const teamId = required(input.teamId, 'teamId')
    if (input.action === 'resume') {
      return this.runs.resumeMemberAsExternal(caller, teamId, required(input.member, 'member'))
    }
    if (input.action === 'wake') {
      return this.runs.wakeMemberAsExternal(caller, teamId, required(input.member, 'member'))
    }
    if (input.action === 'pause') {
      return this.runs.pauseMemberAsExternal(caller, teamId, required(input.member, 'member'))
    }
    if (input.action === 'permissions' || input.action === 'reset_permissions') {
      if (this.permissions === undefined) throw new Error('Fleet permissions are unavailable')
      const member = required(input.member, 'member')
      if (input.action === 'permissions') {
        if (input.assignment === undefined) throw new Error('member permissions requires assignment')
        this.permissions.setMember(teamId, member, input.assignment)
      } else {
        this.permissions.resetMember(teamId, member)
      }
      return this.permissions.inspectMember(teamId, member)
    }
    if (input.action === 'get_access') {
      return this.memberAccess(teamId, required(input.member, 'member'))
    }
    if (input.action === 'set_access_mode') {
      const member = required(input.member, 'member')
      if (this.access === undefined) throw new Error('Fleet Access is unavailable')
      if (input.accessMode === undefined) throw new Error('member Access mode requires accessMode')
      this.access.setMode(teamId, { kind: 'group', id: fleetPrivateGroupId(member) },
        required(input.resourceKind, 'resourceKind'), input.accessMode)
      return this.memberAccess(teamId, member)
    }
    if (input.action === 'add_access_rule') {
      const member = required(input.member, 'member')
      if (this.access === undefined) throw new Error('Fleet Access is unavailable')
      if (input.accessRule === undefined) throw new Error('member Access rule requires accessRule')
      this.access.putRule(teamId, {
        principal: { kind: 'group', id: fleetPrivateGroupId(member) },
        resource: { kind: input.accessRule.resourceKind, id: input.accessRule.resourceId },
        scope: input.accessRule.scope,
        effect: input.accessRule.effect,
        levels: input.accessRule.levels,
      })
      return this.memberAccess(teamId, member)
    }
    if (input.action === 'remove_access_rule') {
      const member = required(input.member, 'member')
      if (this.access === undefined) throw new Error('Fleet Access is unavailable')
      const id = required(input.accessRuleId, 'accessRuleId')
      const principal = { kind: 'group' as const, id: fleetPrivateGroupId(member) }
      if (!this.access.rules(teamId, principal).some(rule => rule.id === id)) {
        throw new Error(`unknown Fleet Access rule ${id} for member ${member}`)
      }
      this.access.removeRule(teamId, id)
      return this.memberAccess(teamId, member)
    }
    this.runs.requireAssistantConnection(caller, teamId)
    switch (input.action) {
      case 'add':
        if (input.view === undefined) throw new Error('member add requires view')
        return this.runs.addMember(caller, { runId: teamId, view: input.view })
      case 'update':
        if (input.view === undefined) throw new Error('member update requires view')
        return this.runs.updateMember(caller, {
          runId: teamId, member: required(input.member, 'member'), view: input.view,
        })
      case 'configure':
        if (input.request === undefined) throw new Error('member configure requires request')
        return this.runs.configureMember(caller, {
          runId: teamId, member: required(input.member, 'member'), request: input.request,
        })
      case 'configure_assistant':
        if (input.request === undefined) throw new Error('assistant configure requires request')
        return this.runs.configureAssistant(caller, {
          runId: teamId,
          ...(input.member === undefined ? {} : { assistant: input.member }),
          request: input.request,
        })
      case 'configure_all':
        if (input.request === undefined) throw new Error('Team configure requires request')
        return this.runs.configureTeam(caller, { runId: teamId, request: input.request })
      case 'remove': return this.runs.removeMember(caller, teamId, required(input.member, 'member'))
      default: throw new Error(`unknown Fleet member action ${String(input.action)}`)
    }
  }

  private memberAccess(teamId: string, member: string) {
    const access = this.access
    if (access === undefined) throw new Error('Fleet Access is unavailable')
    if (!this.runs.memberViews(teamId).some(view => view.id === member)) {
      throw new Error(`unknown Fleet member ${member}`)
    }
    const principal = { kind: 'group' as const, id: fleetPrivateGroupId(member) }
    const resourceKinds = access.adapterKinds()
    return {
      resourceKinds,
      modes: resourceKinds.map(resourceKind => ({
        resourceKind,
        mode: access.mode(teamId, principal, resourceKind),
      })),
      rules: access.rules(teamId, principal).map(rule => ({
        id: rule.id,
        resourceKind: rule.resource.kind,
        resourceId: rule.resource.id,
        scope: rule.scope,
        effect: rule.effect,
        levels: rule.levels,
      })),
    }
  }

  control(input: FleetWebControlInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const caller = this.caller(input.sessionId)
    const team = this.runs.status(required(input.teamId, 'teamId'))
    if (input.action === 'configure') {
      if (input.settings === undefined) throw new Error('Team configure requires settings')
      return this.runs.configureTeamSettings(caller, { runId: team.id, settings: input.settings })
    }
    if (input.action === 'budget') {
      if (input.budget === undefined) throw new Error('Team budget update requires budget')
      return this.runs.configureBudget(caller, { runId: team.id, ...input.budget })
    }
    if (input.action === 'wake') return this.runs.wakeTeamAsExternal(caller, team.id)
    if (input.action === 'load') return this.runs.loadTeamMembersAsExternal(caller, team.id)
    if (input.action === 'pause') return this.runs.pauseTeamAsExternal(caller, team.id)
    this.runs.requireAssistantConnection(caller, team.id)
    switch (input.action) {
      case 'resume': return this.runs.resumeTeam(caller, team.id)
      case 'start': return Promise.resolve(this.runs.start(caller, {
        runId: team.id, projectRoot: team.projectRoot, taskPath: required(input.taskPath, 'taskPath'),
      }))
      case 'close': return Promise.resolve(this.runs.end(caller, required(input.summary, 'summary'), team.id))
      case 'finish':
        if (input.status === undefined) throw new Error('work finish requires status')
        return Promise.resolve(this.runs.finish(caller, input.status, required(input.summary, 'summary'), team.id))
      default: throw new Error(`unknown Fleet control action ${String(input.action)}`)
    }
  }

  upload(input: FleetWebUploadInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const caller = this.caller(input.sessionId)
    const teamId = required(input.teamId, 'teamId')
    this.runs.requireAssistantConnection(caller, teamId)
    return this.runs.uploadResource(caller, {
      runId: teamId,
      name: input.name,
      base64: input.base64,
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
    })
  }

  removeResource(input: FleetWebRemoveResourceInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const caller = this.caller(input.sessionId)
    const teamId = required(input.teamId, 'teamId')
    this.runs.requireAssistantConnection(caller, teamId)
    return this.runs.removeResource(caller, {
      runId: teamId,
      resourceId: required(input.resourceId, 'resourceId'),
    })
  }

  uploadSetup(input: FleetWebSetupUploadInput, signal: AbortSignal) {
    signal.throwIfAborted()
    return this.setups.uploadResource(this.caller(input.sessionId), input)
  }

  async archive(input: FleetWebArchiveInput, signal: AbortSignal) {
    signal.throwIfAborted()
    const caller = this.caller(input.sessionId)
    if (input.action === 'export') {
      const teamId = required(input.teamId, 'teamId')
      const id = randomUUID()
      const name = `${teamId}.fleet.tar.gz`
      const path = join(tmpdir(), `dsh-agent-fleet-${id}.tar.gz`)
      const exported = await this.runs.exportArchive(caller, {
        runId: teamId,
        destination: path,
        includeWorkspace: input.includeWorkspace ?? false,
      })
      const transfer: FleetWebArchiveTransfer = { id, sessionId: input.sessionId, kind: 'export', path, name }
      this.archiveTransfers.set(id, transfer)
      return { transferId: id, name, size: statSync(exported.path).size }
    }
    if (input.action === 'begin_import') {
      const name = required(input.name, 'name')
      const id = randomUUID()
      const directory = join(tmpdir(), 'dsh-agent-fleet-imports')
      mkdirSync(directory, { recursive: true })
      const path = join(directory, `${id}.tar.gz`)
      writeFileSync(path, '')
      this.archiveTransfers.set(id, { id, sessionId: input.sessionId, kind: 'import', path, name })
      return { transferId: id }
    }
    const transfer = this.requireArchiveTransfer(input.sessionId, required(input.transferId, 'transferId'))
    if (input.action === 'cancel') {
      this.removeArchiveTransfer(transfer)
      return { cancelled: true }
    }
    if (input.action === 'read') {
      if (transfer.kind !== 'export') throw new Error('Fleet archive transfer is not an export')
      const size = statSync(transfer.path).size
      const offset = input.offset ?? 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) throw new Error('invalid Fleet archive read offset')
      const length = Math.min(ARCHIVE_CHUNK_BYTES, size - offset)
      const bytes = Buffer.allocUnsafe(length)
      const descriptor = openSync(transfer.path, 'r')
      let read = 0
      try {
        while (read < length) {
          const count = readSync(descriptor, bytes, read, length - read, offset + read)
          if (count === 0) break
          read += count
        }
      } finally {
        closeSync(descriptor)
      }
      const nextOffset = offset + read
      const done = nextOffset >= size
      const result = { base64: bytes.subarray(0, read).toString('base64'), nextOffset, done }
      if (done) this.removeArchiveTransfer(transfer)
      return result
    }
    if (input.action === 'write') {
      if (transfer.kind !== 'import') throw new Error('Fleet archive transfer is not an import')
      const offset = input.offset ?? -1
      const size = statSync(transfer.path).size
      if (offset !== size) throw new Error(`Fleet archive write offset ${String(offset)} does not match ${String(size)}`)
      const base64 = input.base64 ?? ''
      if (base64.length > 750_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
        throw new Error('invalid Fleet archive chunk')
      }
      const bytes = Buffer.from(base64, 'base64')
      if (bytes.byteLength > ARCHIVE_CHUNK_BYTES) throw new Error('Fleet archive chunk is too large')
      appendFileSync(transfer.path, bytes)
      return { nextOffset: size + bytes.byteLength }
    }
    if (input.action === 'finish_import') {
      if (transfer.kind !== 'import') throw new Error('Fleet archive transfer is not an import')
      try {
        return await this.runs.importArchive(caller, {
          archivePath: transfer.path,
          projectRoot: required(input.projectRoot, 'projectRoot'),
          mode: input.importMode ?? 'copy',
        })
      } finally {
        this.removeArchiveTransfer(transfer)
      }
    }
    throw new Error(`unknown Fleet archive action ${String(input.action)}`)
  }

  private requireArchiveTransfer(sessionId: string, id: string): FleetWebArchiveTransfer {
    const transfer = this.archiveTransfers.get(id)
    if (transfer === undefined || transfer.sessionId !== sessionId) throw new Error(`unknown Fleet archive transfer ${id}`)
    return transfer
  }

  private removeArchiveTransfer(transfer: FleetWebArchiveTransfer): void {
    this.archiveTransfers.delete(transfer.id)
    if (existsSync(transfer.path)) unlinkSync(transfer.path)
  }

  private caller(sessionId: string): Agent {
    const id = required(sessionId, 'sessionId')
    const agent = this.host.agents.get(SessionId(id))
    if (agent === undefined) throw new Error(`DSH Session ${id} is not online`)
    return agent
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    fleetWeb: FleetWebRemote
  }
}
