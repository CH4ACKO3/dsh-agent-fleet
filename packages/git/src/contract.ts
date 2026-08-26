import type { FleetGitCommitDetails, FleetGitDiff, FleetGitSnapshot } from './git.js'
import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

export interface FleetGitSnapshotInput {
  readonly root: string
  readonly teamId?: string
  readonly limit?: number
}

export interface FleetGitDiffInput {
  readonly root: string
  readonly path: string
  readonly staged?: boolean
}

export interface FleetGitCommitInput {
  readonly root: string
  readonly hash: string
}

export interface FleetGitFetchInput {
  readonly root: string
  readonly teamId?: string
}

export interface FleetGitWebClient {
  snapshot(input: FleetGitSnapshotInput, signal?: AbortSignal): Promise<RemoteResult<FleetGitSnapshot | null>>
  diff(input: FleetGitDiffInput, signal?: AbortSignal): Promise<RemoteResult<FleetGitDiff>>
  commit(input: FleetGitCommitInput, signal?: AbortSignal): Promise<RemoteResult<FleetGitCommitDetails>>
  fetch(input: FleetGitFetchInput, signal?: AbortSignal): Promise<RemoteResult<FleetGitSnapshot>>
}

export interface FleetGitWebPeerClient {
  invalidate(input: FleetGitInvalidation, signal?: AbortSignal): Promise<RemoteResult<unknown>>
}

export interface FleetGitInvalidation {
  readonly teamIds: readonly string[]
}

const JSON_CODEC = {
  mode: 'strict',
  typeSymbol: '@ch4acko3/dsh-agent-fleet-git#JsonValue',
  schema: z.json(),
} as const

function invocation(method: string): InvocationDescriptor {
  return {
    id: `dsh-agent-fleet-git#web/${method}`,
    service: 'fleetGitWeb',
    namespace: 'fleetGit',
    method,
    invocation: { kind: 'direct' },
    parameters: [{ name: 'input', wire: 'input', source: 'json', codec: JSON_CODEC }],
    cancellation: { parameter: 'signal' },
    result: JSON_CODEC,
  }
}

export const FLEET_GIT_WEB_INVOCATIONS = [invocation('snapshot'), invocation('diff'), invocation('commit'), invocation('fetch')] as const

export const FLEET_GIT_WEB_REMOTE: TypertRemoteContribution = {
  package: '@ch4acko3/dsh-agent-fleet-git/web',
  descriptors: FLEET_GIT_WEB_INVOCATIONS,
}

const FLEET_GIT_WEB_PEER_INVOCATIONS = [{
  id: '@ch4acko3/dsh-agent-fleet-git#web-client/invalidate',
  service: 'fleetGitWebPeer',
  namespace: 'fleetGitWebPeer',
  method: 'invalidate',
  invocation: { kind: 'direct' },
  parameters: [{ name: 'input', wire: 'input', source: 'json', codec: JSON_CODEC }],
  cancellation: { parameter: 'signal' },
  result: JSON_CODEC,
}] as const satisfies readonly InvocationDescriptor[]

export const FLEET_GIT_WEB_PEER_REMOTE: TypertRemoteContribution = {
  package: '@ch4acko3/dsh-agent-fleet-git/web-client',
  descriptors: FLEET_GIT_WEB_PEER_INVOCATIONS,
}

export const FLEET_GIT_WEB_PEER_LOCAL = {
  package: '@ch4acko3/dsh-agent-fleet-git/web-client',
  face: 'client',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: FLEET_GIT_WEB_PEER_INVOCATIONS,
} as const
