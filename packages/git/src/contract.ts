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
