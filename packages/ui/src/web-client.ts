import type { FleetWebUploadedResource } from '@dsh-agent-fleet/core/web'
import type { FleetWebClient } from '@dsh-agent-fleet/core/web'

let client: FleetWebClient | undefined

export function configureFleetWebClient(next: FleetWebClient | undefined): void {
  client = next
}

export async function getFleetWebClient(): Promise<FleetWebClient> {
  if (client === undefined) throw new Error('Fleet Web Remote is unavailable')
  return client
}

export function encodeFleetFile(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
  }
  return btoa(binary)
}

export async function uploadFleetSetupFile(
  sessionId: string,
  file: File,
  signal?: AbortSignal,
): Promise<FleetWebUploadedResource> {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} exceeds the 25 MiB Fleet upload limit`)
  const service = await getFleetWebClient()
  const result = await service.uploadSetup({
    sessionId,
    name: file.name,
    base64: encodeFleetFile(await file.arrayBuffer()),
    label: file.name,
    ...(file.type.length === 0 ? {} : { mediaType: file.type }),
  }, signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
