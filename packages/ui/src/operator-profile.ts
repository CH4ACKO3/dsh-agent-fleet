import { useSyncExternalStore } from 'react'

import type { FleetChatMember } from './runtime-chat.js'
import { fleetText } from './locale.js'

const OPERATOR_PROFILE_KEY = 'dsh.agent-fleet.operator-profile.v1'

export interface FleetOperatorProfileUpdate {
  readonly name: string
  readonly role: string
  readonly responsibility: string
  readonly avatarUrl?: string
}

export interface FleetOperatorProfile extends FleetChatMember {
  readonly responsibility: string
  readonly operator: true
}

function defaultProfile(): FleetOperatorProfile {
  return {
    id: 'operator',
    name: fleetText('你', 'You'),
    role: fleetText('外部观察者', 'External observer'),
    responsibility: fleetText('观察并向团队提供协作输入', 'Observe the Team and provide collaboration input'),
    color: '#737985',
    presence: 'active',
    operator: true,
  }
}

function readStoredProfile(): Partial<FleetOperatorProfileUpdate> {
  if (typeof window === 'undefined') return {}
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(OPERATOR_PROFILE_KEY) ?? 'null')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const stored = value as Record<string, unknown>
    return {
      ...(typeof stored.name === 'string' && stored.name.trim() !== '' ? { name: stored.name } : {}),
      ...(typeof stored.role === 'string' && stored.role.trim() !== '' ? { role: stored.role } : {}),
      ...(typeof stored.responsibility === 'string' ? { responsibility: stored.responsibility } : {}),
      ...(typeof stored.avatarUrl === 'string' && stored.avatarUrl.startsWith('data:image/')
        ? { avatarUrl: stored.avatarUrl }
        : {}),
    }
  } catch {
    return {}
  }
}

let storedProfile = readStoredProfile()
let profile = { ...defaultProfile(), ...storedProfile }
const listeners = new Set<() => void>()

export function getFleetOperatorProfile(): FleetOperatorProfile {
  const resolved = { ...defaultProfile(), ...storedProfile }
  if (resolved.name !== profile.name || resolved.role !== profile.role
    || resolved.responsibility !== profile.responsibility || resolved.avatarUrl !== profile.avatarUrl) {
    profile = resolved
  }
  return profile
}

export function subscribeFleetOperatorProfile(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useFleetOperatorProfile(): FleetOperatorProfile {
  return useSyncExternalStore(subscribeFleetOperatorProfile, getFleetOperatorProfile, getFleetOperatorProfile)
}

export function updateFleetOperatorProfile(update: FleetOperatorProfileUpdate): void {
  const name = update.name.trim()
  const role = update.role.trim()
  if (name === '' || role === '') throw new Error(fleetText('名称和角色不能为空', 'Name and role are required'))
  const nextStored: FleetOperatorProfileUpdate = {
    name,
    role,
    responsibility: update.responsibility.trim(),
    ...(update.avatarUrl === undefined ? {} : { avatarUrl: update.avatarUrl }),
  }
  try {
    window.localStorage.setItem(OPERATOR_PROFILE_KEY, JSON.stringify({
      name: nextStored.name,
      role: nextStored.role,
      responsibility: nextStored.responsibility,
      ...(nextStored.avatarUrl === undefined ? {} : { avatarUrl: nextStored.avatarUrl }),
    }))
  } catch {
    throw new Error(fleetText('无法保存用户资料，请尝试使用更小的头像图片', 'Could not save the user profile. Try a smaller avatar image.'))
  }
  storedProfile = nextStored
  profile = { ...defaultProfile(), ...storedProfile }
  for (const listener of listeners) listener()
}
