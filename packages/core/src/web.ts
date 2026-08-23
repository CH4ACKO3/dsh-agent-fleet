import type {
  InvocationDescriptor,
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

export interface FleetWebSetupUploadInput {
  readonly sessionId: string
  readonly name: string
  readonly base64: string
  readonly label?: string
  readonly mediaType?: string
}

export interface FleetWebUploadedResource {
  readonly path: string
  readonly label: string
  readonly mediaType?: string
  readonly size: number
}

export interface FleetWebClient {
  list(signal?: AbortSignal): Promise<RemoteResult<unknown>>
  project(input: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  send(input: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  member(input: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  control(input: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  upload(input: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
  uploadSetup(
    input: FleetWebSetupUploadInput,
    signal?: AbortSignal,
  ): Promise<RemoteResult<FleetWebUploadedResource>>
  archive(input: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
}

export interface FleetWebPeerClient {
  invalidate(signal?: AbortSignal): Promise<RemoteResult<unknown>>
}

const JSON_CODEC = {
  mode: 'strict',
  typeSymbol: '@dsh-agent-fleet/core/web#JsonValue',
  schema: z.json(),
} as const

function invocation(method: string, input = false): InvocationDescriptor {
  const id = `dsh-agent-fleet#web/${method}`
  return {
    id,
    service: 'fleetWeb',
    namespace: 'fleet',
    method,
    invocation: { kind: 'direct' },
    parameters: input ? [{
      name: 'input', wire: 'input', source: 'json', codec: JSON_CODEC,
    }] : [],
    cancellation: { parameter: 'signal' },
    result: JSON_CODEC,
  }
}

export const FLEET_WEB_INVOCATIONS = [
  invocation('list'),
  invocation('project', true),
  invocation('send', true),
  invocation('member', true),
  invocation('control', true),
  invocation('upload', true),
  invocation('uploadSetup', true),
  invocation('archive', true),
] as const

export const FLEET_WEB_REMOTE: TypertRemoteContribution = {
  package: 'dsh-agent-fleet/web',
  descriptors: FLEET_WEB_INVOCATIONS,
}

const FLEET_WEB_PEER_INVOCATIONS = [{
  id: 'dsh-agent-fleet#web-client/invalidate',
  service: 'fleetWebPeer',
  namespace: 'fleetWebPeer',
  method: 'invalidate',
  invocation: { kind: 'direct' },
  parameters: [],
  cancellation: { parameter: 'signal' },
  result: JSON_CODEC,
}] as const satisfies readonly InvocationDescriptor[]

export const FLEET_WEB_PEER_REMOTE: TypertRemoteContribution = {
  package: 'dsh-agent-fleet/web-client',
  descriptors: FLEET_WEB_PEER_INVOCATIONS,
}

export const FLEET_WEB_PEER_LOCAL = {
  package: 'dsh-agent-fleet/web-client',
  face: 'client',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: FLEET_WEB_PEER_INVOCATIONS,
} as const
