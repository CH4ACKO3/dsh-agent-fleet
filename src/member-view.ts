export const FLEET_MEMBER_TOOL_GROUPS = [
  'messages',
  'coordination',
  'resources',
  'status',
  'schedule',
  'tasks',
  'calendar',
  'documents',
  'git',
] as const

export type FleetMemberToolGroup = typeof FLEET_MEMBER_TOOL_GROUPS[number]

export const FLEET_MEMBER_TOOL_GROUP_ACTIONS: Record<FleetMemberToolGroup, readonly string[]> = {
  messages: ['message.read', 'message.post'],
  coordination: ['meeting.join'],
  resources: ['resource.read', 'work.read', 'work.claim'],
  status: ['member-status.read', 'member-status.write'],
  schedule: [],
  tasks: [],
  calendar: [],
  documents: [],
  git: [],
}

export const FLEET_MEMBER_PERMISSIONS = [
  'channel.manage',
  'meeting.manage',
  'vote.create',
  'resource.write',
  'schedule.create',
  'task.manage',
  'calendar.manage',
  'document.write',
  'team.manage',
  'workspace.manage',
  'git.inspect',
  'git.scope-check',
  'git.worktree-create',
  'git.worktree-manage',
] as const

export type FleetMemberPermission = typeof FLEET_MEMBER_PERMISSIONS[number]

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
