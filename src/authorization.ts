import type { Context } from '@deepseek-ai/cordis'

import {
  FLEET_MEMBER_PERMISSIONS,
  FLEET_MEMBER_TOOL_GROUP_ACTIONS,
  FLEET_MEMBER_TOOL_GROUPS,
  FLEET_OPT_IN_PERMISSIONS,
} from './member-view.js'
import type { FleetMemberView } from './member-view.js'

export type FleetAuthorizationSubjectKind = 'member' | 'assistant' | 'external' | 'system'

export interface FleetAuthorizationSubject {
  readonly kind: FleetAuthorizationSubjectKind
  readonly id: string
}

export interface FleetAuthorizationResource {
  readonly kind: string
  readonly id: string
}

export interface FleetAuthorizationInput {
  readonly teamId: string
  readonly subject: FleetAuthorizationSubject
  readonly action: string
  readonly resource?: FleetAuthorizationResource
}

export interface FleetAuthorizationActor {
  readonly teamId: string
  readonly subject: FleetAuthorizationSubject
}

export interface FleetEffectiveAuthorization {
  readonly toolGroups: readonly string[]
  readonly actions: readonly string[]
  readonly op: boolean
}

export interface FleetActionPolicyInput {
  readonly teamId: string
  readonly member: FleetMemberView
  readonly base: FleetEffectiveAuthorization
}

export interface FleetActionPolicy {
  resolve(input: FleetActionPolicyInput): FleetEffectiveAuthorization | undefined
}

export interface FleetResourcePolicy {
  authorize(input: FleetAuthorizationInput, baseline: boolean): boolean
}

export interface FleetAuthorizationBaseline {
  resolveSubject(teamId: string, subject: FleetAuthorizationSubject): FleetMemberView | undefined
  actorForAgent?(agentId: string): FleetAuthorizationActor | undefined
  authorizeAction?(input: FleetAuthorizationInput): boolean
  authorizeResource(input: FleetAuthorizationInput): boolean
}

export interface FleetRegisteredAction {
  readonly id: string
  readonly description: string
}

export interface FleetAuthorizationNamespace {
  readonly namespace: string
  readonly actions: readonly FleetRegisteredAction[]
  /** Default local action ids used when no action-policy plugin replaces this member's profile. */
  readonly defaultActions?: (input: {
    readonly teamId: string
    readonly member: FleetMemberView
  }) => readonly string[]
  /** Optional safe default for non-member subjects such as external integrations. */
  readonly authorizeBaseline?: (input: FleetAuthorizationInput) => boolean
  /** Install for every member even when none of this namespace's actions are granted. */
  readonly alwaysVisible?: boolean
  readonly installTools?: (
    ctx: Context,
    input: {
      readonly teamId: string
      readonly projectRoot: string
      readonly member: FleetMemberView
      readonly hasMember: (member: string) => boolean
      readonly authorization: FleetEffectiveAuthorization
    },
  ) => (() => void) | void
}

export interface FleetAuthorizationResourceKind {
  readonly kind: string
  /** Feature-owned safe default used when no resource-policy plugin overrides it. */
  readonly authorizeBaseline?: (input: FleetAuthorizationInput) => boolean
}

export interface FleetAuthorizationChange {
  readonly teamId?: string
  readonly members?: readonly string[]
}

const NAMESPACE = /^[a-z][a-z0-9-]*$/u
const NODE = /^[a-z][a-z0-9-]*$/u

export class FleetAuthorizationService {
  private readonly contributions = new Map<string, FleetAuthorizationNamespace>()
  private readonly listeners = new Set<(change: FleetAuthorizationChange) => void>()
  private readonly builtinActions = new Set<string>([
    ...FLEET_MEMBER_PERMISSIONS,
    ...FLEET_OPT_IN_PERMISSIONS,
    ...Object.values(FLEET_MEMBER_TOOL_GROUP_ACTIONS).flat(),
  ])
  private readonly resourceKinds = new Map<string, FleetAuthorizationResourceKind>(
    ['team', 'conversation', 'workspace', 'file', 'resource'].map(kind => [kind, { kind }]),
  )
  private actionPolicy: FleetActionPolicy | undefined
  private resourcePolicy: FleetResourcePolicy | undefined
  private baseline: FleetAuthorizationBaseline | undefined

  registerNamespace(contribution: FleetAuthorizationNamespace): () => void {
    if (!NAMESPACE.test(contribution.namespace)) throw new Error('Fleet authorization namespace must use lower-kebab-case')
    if (this.contributions.has(contribution.namespace)) {
      throw new Error(`Fleet authorization namespace ${contribution.namespace} is already registered`)
    }
    const ids = new Set<string>()
    for (const action of contribution.actions) {
      if (!NODE.test(action.id)) throw new Error(`Fleet action ${action.id} must use lower-kebab-case`)
      if (ids.has(action.id)) throw new Error(`duplicate Fleet action ${contribution.namespace}.${action.id}`)
      ids.add(action.id)
    }
    this.contributions.set(contribution.namespace, contribution)
    this.changed({})
    return () => {
      if (this.contributions.get(contribution.namespace) !== contribution) return
      this.contributions.delete(contribution.namespace)
      this.changed({})
    }
  }

  registerResourceKind(input: string | FleetAuthorizationResourceKind): () => void {
    const contribution = typeof input === 'string' ? { kind: input } : input
    const normalized = contribution.kind.trim()
    if (!NAMESPACE.test(normalized)) throw new Error('Fleet resource kind must use lower-kebab-case')
    if (this.resourceKinds.has(normalized)) throw new Error(`Fleet resource kind ${normalized} is already registered`)
    const registered = { ...contribution, kind: normalized }
    this.resourceKinds.set(normalized, registered)
    this.changed({})
    return () => {
      if (this.resourceKinds.get(normalized) !== registered) return
      this.resourceKinds.delete(normalized)
      this.changed({})
    }
  }

  installBaseline(baseline: FleetAuthorizationBaseline): () => void {
    if (this.baseline !== undefined) throw new Error('a Fleet authorization baseline is already installed')
    this.baseline = baseline
    return () => {
      if (this.baseline === baseline) this.baseline = undefined
    }
  }

  installActionPolicy(policy: FleetActionPolicy): () => void {
    if (this.actionPolicy !== undefined) throw new Error('a Fleet action policy is already installed')
    this.actionPolicy = policy
    this.changed({})
    return () => {
      if (this.actionPolicy !== policy) return
      this.actionPolicy = undefined
      this.changed({})
    }
  }

  installResourcePolicy(policy: FleetResourcePolicy): () => void {
    if (this.resourcePolicy !== undefined) throw new Error('a Fleet resource policy is already installed')
    this.resourcePolicy = policy
    return () => {
      if (this.resourcePolicy === policy) this.resourcePolicy = undefined
    }
  }

  resolve(teamId: string, member: FleetMemberView): FleetEffectiveAuthorization {
    const contributed = this.namespaces().flatMap(contribution => {
      const defaults = contribution.defaultActions?.({ teamId, member }) ?? []
      const known = new Set(contribution.actions.map(action => action.id))
      for (const action of defaults) {
        if (!known.has(action)) throw new Error(`unknown default Fleet action ${contribution.namespace}.${action}`)
      }
      return defaults.map(action => `${contribution.namespace}.${action}`)
    })
    const base: FleetEffectiveAuthorization = {
      toolGroups: [...member.toolGroups],
      actions: [...new Set([
        ...member.permissions,
        ...member.toolGroups.flatMap(group => FLEET_MEMBER_TOOL_GROUP_ACTIONS[group] ?? []),
        ...contributed,
      ])],
      op: false,
    }
    const resolved = this.actionPolicy?.resolve({ teamId, member, base }) ?? base
    if (!resolved.op) return {
      toolGroups: [...new Set(resolved.toolGroups)],
      actions: [...new Set(resolved.actions)],
      op: false,
    }
    return {
      toolGroups: [...new Set([...FLEET_MEMBER_TOOL_GROUPS, ...resolved.toolGroups])],
      actions: [...new Set([...this.actionIds(), ...resolved.actions])],
      op: true,
    }
  }

  authorize(input: FleetAuthorizationInput): boolean {
    if (!this.actionIds().includes(input.action)) return false
    const member = this.baseline?.resolveSubject(input.teamId, input.subject)
    const contribution = this.contributions.get(input.action.slice(0, input.action.indexOf('.')))
    const actionAllowed = member === undefined
      ? (contribution?.authorizeBaseline?.(input) ?? this.baseline?.authorizeAction?.(input) ?? false)
      : this.resolve(input.teamId, member).actions.includes(input.action)
    if (!actionAllowed) return false
    if (input.resource === undefined) return true
    const resourceKind = this.resourceKinds.get(input.resource.kind)
    if (resourceKind === undefined) return false
    const baseline = resourceKind.authorizeBaseline?.(input)
      ?? this.baseline?.authorizeResource(input)
      ?? false
    return this.resourcePolicy?.authorize(input, baseline) ?? baseline
  }

  actorForAgent(agentId: string): FleetAuthorizationActor | undefined {
    return this.baseline?.actorForAgent?.(agentId)
  }

  require(input: FleetAuthorizationInput): void {
    if (this.authorize(input)) return
    const resource = input.resource === undefined ? '' : ` on ${input.resource.kind}:${input.resource.id}`
    throw new Error(`Fleet ${input.subject.kind} ${input.subject.id} is not authorized for ${input.action}${resource}`)
  }

  has(teamId: string, member: FleetMemberView, action: string): boolean {
    return this.actionIds().includes(action) && this.resolve(teamId, member).actions.includes(action)
  }

  namespaces(): FleetAuthorizationNamespace[] {
    return [...this.contributions.values()]
  }

  actionIds(): string[] {
    return [
      ...this.builtinActions,
      ...this.namespaces().flatMap(contribution =>
        contribution.actions.map(action => `${contribution.namespace}.${action.id}`),
      ),
    ]
  }

  resourceKindIds(): string[] {
    return [...this.resourceKinds.keys()]
  }

  visible(contribution: FleetAuthorizationNamespace, authorization: FleetEffectiveAuthorization): boolean {
    if (contribution.alwaysVisible === true || authorization.op) return true
    return contribution.actions.some(action =>
      authorization.actions.includes(`${contribution.namespace}.${action.id}`),
    )
  }

  onChange(listener: (change: FleetAuthorizationChange) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  changed(change: FleetAuthorizationChange): void {
    for (const listener of [...this.listeners]) listener(change)
  }
}
