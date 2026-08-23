export const FLEET_MEMBER_TOOL_GROUPS = [
  'messages',
  'coordination',
  'resources',
  'status',
] as const

export type FleetMemberToolGroup = string

export const FLEET_MEMBER_TOOL_GROUP_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  messages: ['message.read', 'message.post'],
  coordination: ['meeting.join'],
  resources: ['resource.read', 'work.read', 'work.claim'],
  status: ['member-status.read', 'member-status.write'],
}

export const FLEET_MEMBER_PERMISSIONS = [
  'channel.manage',
  'meeting.manage',
  'vote.create',
  'resource.write',
  'team.manage',
] as const

/** Registered action id. Feature plugins own their namespaced actions. */
export type FleetMemberPermission = string

export interface FleetMemberContacts {
  readonly members: '*' | string[]
  readonly channels: '*' | string[]
}

/** Persistent identity fields shared by ordinary members and user-facing assistants. */
export interface FleetActorProfile {
  readonly id: string
  readonly name: string
  readonly color?: string
  readonly role: string
  readonly responsibility?: string
  readonly prompt: string
  readonly provider?: string
  readonly model?: string
}

/** Serializable source of truth for one Fleet member's runtime view. */
export interface FleetMemberView extends FleetActorProfile {
  /** False for non-voting assistants and observers represented inside the Team runtime. */
  readonly canVote?: boolean
  readonly toolGroups: FleetMemberToolGroup[]
  readonly permissions: FleetMemberPermission[]
  readonly contacts: FleetMemberContacts
}

export function fleetMemberHasPermission(
  view: FleetMemberView,
  permission: FleetMemberPermission,
): boolean {
  return view.permissions.includes(permission)
}

export function fleetMemberCanContact(view: FleetMemberView, member: string): boolean {
  return view.contacts.members === '*' || view.contacts.members.includes(member)
}

export function fleetMemberCanAccessChannel(view: FleetMemberView, channel: string): boolean {
  return view.contacts.channels === '*' || view.contacts.channels.includes(channel)
}
