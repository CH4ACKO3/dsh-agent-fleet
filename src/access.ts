import type { Context } from '@deepseek-ai/cordis'

import {
  FLEET_MEMBER_PERMISSIONS,
  FLEET_MEMBER_TOOL_GROUPS,
} from './member-view.js'
import type { FleetMemberView } from './member-view.js'

export interface FleetEffectiveAccess {
  readonly toolGroups: readonly string[]
  readonly permissions: readonly string[]
  readonly op: boolean
}

export interface FleetAccessInput {
  readonly teamId: string
  readonly member: FleetMemberView
  readonly base: FleetEffectiveAccess
}

export interface FleetAccessPolicy {
  resolve(input: FleetAccessInput): FleetEffectiveAccess | undefined
}

export interface FleetCapabilityPermission {
  readonly id: string
  readonly description: string
}

export interface FleetCapabilityNamespace {
  readonly namespace: string
  readonly permissions: readonly FleetCapabilityPermission[]
  /** Install for every member even when none of this namespace's permissions are granted. */
  readonly alwaysVisible?: boolean
  readonly installTools?: (
    ctx: Context,
    input: {
      readonly teamId: string
      readonly member: FleetMemberView
      readonly access: FleetEffectiveAccess
    },
  ) => (() => void) | void
}

export interface FleetAccessChange {
  readonly teamId?: string
  readonly members?: readonly string[]
}

const NAMESPACE = /^[a-z][a-z0-9-]*$/u
const NODE = /^[a-z][a-z0-9-]*$/u

export class FleetAccessService {
  private readonly contributions = new Map<string, FleetCapabilityNamespace>()
  private readonly listeners = new Set<(change: FleetAccessChange) => void>()
  private policy: FleetAccessPolicy | undefined

  registerNamespace(contribution: FleetCapabilityNamespace): () => void {
    if (!NAMESPACE.test(contribution.namespace)) throw new Error('Fleet capability namespace must use lower-kebab-case')
    if (this.contributions.has(contribution.namespace)) {
      throw new Error(`Fleet capability namespace ${contribution.namespace} is already registered`)
    }
    const ids = new Set<string>()
    for (const permission of contribution.permissions) {
      if (!NODE.test(permission.id)) throw new Error(`Fleet permission ${permission.id} must use lower-kebab-case`)
      if (ids.has(permission.id)) throw new Error(`duplicate Fleet permission ${contribution.namespace}.${permission.id}`)
      ids.add(permission.id)
    }
    this.contributions.set(contribution.namespace, contribution)
    try {
      this.changed({})
    } catch (error) {
      this.contributions.delete(contribution.namespace)
      this.changed({})
      throw error
    }
    return () => {
      if (this.contributions.get(contribution.namespace) !== contribution) return
      this.contributions.delete(contribution.namespace)
      this.changed({})
    }
  }

  installPolicy(policy: FleetAccessPolicy): () => void {
    if (this.policy !== undefined) throw new Error('a Fleet access policy is already installed')
    this.policy = policy
    try {
      this.changed({})
    } catch (error) {
      this.policy = undefined
      this.changed({})
      throw error
    }
    return () => {
      if (this.policy !== policy) return
      this.policy = undefined
      this.changed({})
    }
  }

  resolve(teamId: string, member: FleetMemberView): FleetEffectiveAccess {
    const base: FleetEffectiveAccess = {
      toolGroups: [...member.toolGroups],
      permissions: [...member.permissions],
      op: false,
    }
    const resolved = this.policy?.resolve({ teamId, member, base }) ?? base
    if (!resolved.op) return {
      toolGroups: [...new Set(resolved.toolGroups)],
      permissions: [...new Set(resolved.permissions)],
      op: false,
    }
    return {
      toolGroups: [...new Set([...FLEET_MEMBER_TOOL_GROUPS, ...resolved.toolGroups])],
      permissions: [...new Set([...FLEET_MEMBER_PERMISSIONS, ...this.permissionIds(), ...resolved.permissions])],
      op: true,
    }
  }

  has(teamId: string, member: FleetMemberView, permission: string): boolean {
    const access = this.resolve(teamId, member)
    return access.op || access.permissions.includes(permission)
  }

  namespaces(): FleetCapabilityNamespace[] {
    return [...this.contributions.values()]
  }

  permissionIds(): string[] {
    return this.namespaces().flatMap(contribution =>
      contribution.permissions.map(permission => `${contribution.namespace}.${permission.id}`),
    )
  }

  visible(contribution: FleetCapabilityNamespace, access: FleetEffectiveAccess): boolean {
    if (contribution.alwaysVisible === true || access.op) return true
    return contribution.permissions.some(permission =>
      access.permissions.includes(`${contribution.namespace}.${permission.id}`),
    )
  }

  onChange(listener: (change: FleetAccessChange) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  changed(change: FleetAccessChange): void {
    for (const listener of [...this.listeners]) listener(change)
  }
}
