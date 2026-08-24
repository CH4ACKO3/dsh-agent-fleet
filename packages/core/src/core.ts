import { randomUUID } from 'node:crypto'

import type {
  AgentRuntime,
  CreateFleetAgentInput,
  FleetAgent,
  RegisterFleetAgentInput,
  ResumeFleetAgentInput,
  RuntimeAgent,
  RuntimeAgentHandle,
  UpdateFleetAgentInput,
} from './types.js'
import {
  generateFleetMemberColor,
  generateMemberDisplayName,
  normalizeFleetMemberColor,
} from './names.js'

const MEMBER_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface MemberRecord {
  readonly id: string
  readonly name: string
  readonly displayName: string
  readonly color: FleetAgent['color']
  readonly role: string
  readonly capabilities: string[]
  readonly createdBy?: string
  readonly registeredAt: string
}

interface ManagedAgent {
  readonly handle: RuntimeAgentHandle
  readonly archiveId?: string
  readonly setup?: CreateFleetAgentInput['setup']
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new Error(`${label} cannot be empty`)
  return normalized
}

function memberName(value: string): string {
  const normalized = value.trim()
  if (!MEMBER_NAME.test(normalized)) throw new Error('Fleet Agent name must use lower-kebab-case')
  return normalized
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = requiredText(value, 'capability')
    if (!seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}

export class FleetCore {
  private readonly members = new Map<string, MemberRecord>()
  private readonly memberNamesByAgent = new Map<string, string>()
  private readonly handles = new Map<string, ManagedAgent>()
  private readonly creatingNames = new Set<string>()
  private readonly rotatingAgentIds = new Set<string>()
  private sharedRoot: string | undefined
  private closed = false

  constructor(private readonly runtime: AgentRuntime) {}

  list(): FleetAgent[] {
    this.assertOpen()
    return [...this.members.values()].map(member => this.describe(member))
  }

  get(name: string): FleetAgent {
    this.assertOpen()
    return this.describe(this.requireMember(memberName(name)))
  }

  resolveTarget(reference: string): `@${string}` {
    this.assertOpen()
    const value = reference.trim()
    const id = value.startsWith('@') ? value.slice(1) : value
    if (id.length === 0) throw new Error('Fleet Agent target cannot be empty')
    return `@${this.members.get(id)?.id ?? id}`
  }

  nameForAgent(id: string): string | undefined {
    this.assertOpen()
    return this.memberNamesByAgent.get(id)
  }

  displayNameForAgent(id: string): string | undefined {
    this.assertOpen()
    const name = this.memberNamesByAgent.get(id)
    return name === undefined ? undefined : this.members.get(name)?.displayName
  }

  bindProjectRoot(path: string): string {
    this.assertOpen()
    this.sharedRoot ??= requiredText(path, 'project root')
    return this.sharedRoot
  }

  resetProjectRoot(path: string): string {
    this.assertOpen()
    if (this.members.size > 0) throw new Error('cannot reset the Fleet project root while members are registered')
    this.sharedRoot = requiredText(path, 'project root')
    return this.sharedRoot
  }

  projectRoot(): string | undefined {
    this.assertOpen()
    return this.sharedRoot
  }

  register(agent: RuntimeAgent, input: RegisterFleetAgentInput): FleetAgent {
    this.assertOpen()
    this.requireLive(agent.id)
    if (this.memberNamesByAgent.has(agent.id)) throw new Error(`Agent ${agent.id} is already registered`)

    const name = memberName(input.name)
    this.requireAvailableName(name)
    const member: MemberRecord = {
      id: agent.id,
      name,
      displayName: input.displayName === undefined
        ? generateMemberDisplayName([...this.members.values()].map(member => member.displayName))
        : requiredText(input.displayName, 'display name'),
      color: input.color === undefined
        ? generateFleetMemberColor([...this.members.values()].map(member => member.color))
        : normalizeFleetMemberColor(input.color),
      role: requiredText(input.role, 'role'),
      capabilities: uniqueStrings(input.capabilities ?? []),
      registeredAt: new Date().toISOString(),
    }
    this.members.set(name, member)
    this.memberNamesByAgent.set(agent.id, name)
    return this.describe(member)
  }

  update(agent: RuntimeAgent, input: UpdateFleetAgentInput): FleetAgent {
    this.assertOpen()
    const member = this.requireSelf(agent)
    if (input.role === undefined && input.capabilities === undefined) {
      throw new Error('Fleet Agent update requires role or capabilities')
    }
    const updated: MemberRecord = {
      ...member,
      role: input.role === undefined ? member.role : requiredText(input.role, 'role'),
      capabilities: input.capabilities === undefined
        ? member.capabilities
        : uniqueStrings(input.capabilities),
    }
    this.members.set(member.name, updated)
    return this.describe(updated)
  }

  unregister(agent: RuntimeAgent): FleetAgent {
    this.assertOpen()
    const member = this.requireSelf(agent)
    if (this.handles.has(member.name)) {
      throw new Error(`managed Fleet Agent ${member.name} must be stopped by its creator`)
    }
    const result = this.describe(member)
    this.members.delete(member.name)
    this.memberNamesByAgent.delete(member.id)
    return result
  }

  disposed(id: string): void {
    if (this.rotatingAgentIds.has(id)) return
    const name = this.memberNamesByAgent.get(id)
    if (name === undefined) return
    this.members.delete(name)
    this.memberNamesByAgent.delete(id)
    this.handles.delete(name)
  }

  async create(owner: RuntimeAgent, input: CreateFleetAgentInput): Promise<FleetAgent> {
    this.assertOpen()
    this.requireLive(owner.id)
    const name = memberName(input.name)
    this.requireAvailableName(name)
    const role = requiredText(input.role, 'role')
    const capabilities = uniqueStrings(input.capabilities ?? [])
    const displayName = input.displayName === undefined
      ? generateMemberDisplayName([...this.members.values()].map(member => member.displayName))
      : requiredText(input.displayName, 'display name')
    this.creatingNames.add(name)

    let handle: RuntimeAgentHandle | undefined
    try {
      handle = await this.runtime.create(owner, {
        id: randomUUID(),
        ...(input.archiveId === undefined ? {} : { archiveId: input.archiveId }),
        label: displayName,
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
        ...(input.persona === undefined ? {} : { persona: input.persona }),
        ...(input.setup === undefined ? {} : { setup: input.setup }),
      })
      this.assertOpen()
      if (this.memberNamesByAgent.has(handle.agent.id)) {
        throw new Error(`Agent ${handle.agent.id} is already registered`)
      }
      const member: MemberRecord = {
        id: handle.agent.id,
        name,
        displayName,
        color: input.color === undefined
          ? generateFleetMemberColor([...this.members.values()].map(member => member.color))
          : normalizeFleetMemberColor(input.color),
        role,
        capabilities,
        createdBy: owner.id,
        registeredAt: new Date().toISOString(),
      }
      this.members.set(name, member)
      this.memberNamesByAgent.set(member.id, name)
      this.handles.set(name, {
        handle,
        ...(input.archiveId === undefined ? {} : { archiveId: input.archiveId }),
        ...(input.setup === undefined ? {} : { setup: input.setup }),
      })
      return this.describe(member)
    } catch (error) {
      if (handle !== undefined) await handle.dispose()
      throw error
    } finally {
      this.creatingNames.delete(name)
    }
  }

  async resume(owner: RuntimeAgent, input: ResumeFleetAgentInput): Promise<FleetAgent> {
    this.assertOpen()
    this.requireLive(owner.id)
    const name = memberName(input.name)
    this.requireAvailableName(name)
    const role = requiredText(input.role, 'role')
    const capabilities = uniqueStrings(input.capabilities ?? [])
    const displayName = requiredText(input.displayName, 'display name')
    this.creatingNames.add(name)

    let handle: RuntimeAgentHandle | undefined
    try {
      handle = await this.runtime.resume(owner, {
        id: requiredText(input.id, 'Agent id'),
        ...(input.archiveId === undefined ? {} : { archiveId: input.archiveId }),
        label: displayName,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
        ...(input.persona === undefined ? {} : { persona: input.persona }),
        ...(input.setup === undefined ? {} : { setup: input.setup }),
      })
      this.assertOpen()
      if (this.memberNamesByAgent.has(handle.agent.id)) {
        throw new Error(`Agent ${handle.agent.id} is already registered`)
      }
      const member: MemberRecord = {
        id: handle.agent.id,
        name,
        displayName,
        color: normalizeFleetMemberColor(input.color),
        role,
        capabilities,
        createdBy: owner.id,
        registeredAt: new Date().toISOString(),
      }
      this.members.set(name, member)
      this.memberNamesByAgent.set(member.id, name)
      this.handles.set(name, {
        handle,
        ...(input.archiveId === undefined ? {} : { archiveId: input.archiveId }),
        ...(input.setup === undefined ? {} : { setup: input.setup }),
      })
      return this.describe(member)
    } catch (error) {
      if (handle !== undefined) await handle.dispose()
      throw error
    } finally {
      this.creatingNames.delete(name)
    }
  }

  cancel(caller: RuntimeAgent, name: string): FleetAgent {
    this.assertOpen()
    const member = this.requireMember(memberName(name))
    if (caller.id !== member.id && caller.id !== member.createdBy) {
      throw new Error(`Agent ${caller.id} cannot cancel Fleet Agent ${member.name}`)
    }
    const target = this.requireLive(member.id)
    target.cancel({ kind: caller.id === member.id ? 'user' : 'parent' })
    return this.describe(member)
  }

  async stop(caller: RuntimeAgent, name: string): Promise<FleetAgent> {
    this.assertOpen()
    const member = this.requireMember(memberName(name))
    if (caller.id !== member.createdBy) {
      throw new Error(`only creator ${member.createdBy ?? 'unknown'} can stop Fleet Agent ${member.name}`)
    }
    return this.stopManaged(member.name)
  }

  whenIdle(name: string): Promise<void> {
    return this.requireLive(this.requireMember(memberName(name)).id).whenIdle()
  }

  cancelManaged(name: string, exceptAgentId?: string): void {
    const member = this.requireMember(memberName(name))
    if (member.id === exceptAgentId) return
    const agent = this.runtime.get(member.id)
    if (agent?.status === 'running') agent.cancel({ kind: 'parent' })
  }

  clearManagedInbox(name: string): void {
    const member = this.requireMember(memberName(name))
    this.requireLive(member.id).inbox?.clear()
  }

  async rotateManaged(name: string): Promise<FleetAgent | undefined> {
    const member = this.requireMember(memberName(name))
    const managed = this.handles.get(member.name)
    if (managed?.archiveId === undefined || this.runtime.rotate === undefined) return undefined
    const previousId = member.id
    this.rotatingAgentIds.add(previousId)
    let handle: RuntimeAgentHandle | undefined
    try {
      handle = await this.runtime.rotate(managed.handle, {
        archiveId: managed.archiveId,
        ...(managed.setup === undefined ? {} : { setup: managed.setup }),
      })
    } finally {
      this.rotatingAgentIds.delete(previousId)
    }
    if (handle === undefined) return undefined
    const updated: MemberRecord = { ...member, id: handle.agent.id }
    this.members.set(member.name, updated)
    this.memberNamesByAgent.delete(previousId)
    this.memberNamesByAgent.set(updated.id, updated.name)
    this.handles.set(member.name, { ...managed, handle })
    return this.describe(updated)
  }

  async stopManaged(name: string): Promise<FleetAgent> {
    const member = this.requireMember(memberName(name))
    const handle = this.handles.get(member.name)
    if (handle === undefined) throw new Error(`Fleet Agent ${member.name} is not managed by Core`)
    await handle.handle.dispose()
    this.handles.delete(member.name)
    this.members.delete(member.name)
    this.memberNamesByAgent.delete(member.id)
    return { ...this.describe(member), status: 'offline' }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const handles = [...this.handles.values()]
    this.handles.clear()
    this.members.clear()
    this.memberNamesByAgent.clear()
    this.sharedRoot = undefined
    await Promise.all(handles.map(managed => managed.handle.dispose()))
  }

  private describe(member: MemberRecord): FleetAgent {
    return {
      id: member.id,
      target: `@${member.id}`,
      name: member.name,
      displayName: member.displayName,
      color: member.color,
      role: member.role,
      capabilities: [...member.capabilities],
      status: this.runtime.get(member.id)?.status ?? 'offline',
      managed: this.handles.has(member.name),
      ...(member.createdBy === undefined ? {} : { createdBy: member.createdBy }),
      registeredAt: member.registeredAt,
    }
  }

  private requireAvailableName(name: string): void {
    if (this.members.has(name) || this.creatingNames.has(name)) {
      throw new Error(`Fleet Agent name ${name} already exists`)
    }
  }

  private requireMember(name: string): MemberRecord {
    const member = this.members.get(name)
    if (member === undefined) throw new Error(`unknown Fleet Agent ${name}`)
    return member
  }

  private requireSelf(agent: RuntimeAgent): MemberRecord {
    const name = this.memberNamesByAgent.get(agent.id)
    if (name === undefined) throw new Error(`Agent ${agent.id} is not registered with Fleet`)
    return this.requireMember(name)
  }

  private requireLive(id: string): RuntimeAgent {
    const agent = this.runtime.get(id)
    if (agent === undefined) throw new Error(`Agent ${id} is not running in this process`)
    return agent
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Fleet Core service is stopped')
  }
}
