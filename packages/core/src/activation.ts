/** One-shot Client-to-Host activation carried by the first Fleet prompt. */
export type FleetActivationRequest =
  | { readonly mode: 'interactive' }
  | { readonly mode: 'meta' }
  | { readonly mode: 'connection'; readonly teamId: string; readonly assistantId?: string }
  | {
      readonly mode: 'configuration'
      readonly configuration: Record<string, unknown>
    }

export interface ParsedFleetActivation {
  readonly request: FleetActivationRequest
  readonly text: string
}

const ACTIVATION_PREFIX = '\u2063dsh-agent-fleet:v1:'
const MAX_ACTIVATION_JSON_LENGTH = 1_000_000

function activationRequest(value: unknown): FleetActivationRequest | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.mode === 'interactive') return { mode: 'interactive' }
  if (candidate.mode === 'meta') return { mode: 'meta' }
  if (candidate.mode === 'connection'
    && typeof candidate.teamId === 'string'
    && candidate.teamId.trim().length > 0) {
    return {
      mode: 'connection',
      teamId: candidate.teamId.trim(),
      ...(typeof candidate.assistantId === 'string' && candidate.assistantId.trim().length > 0
        ? { assistantId: candidate.assistantId.trim() }
        : {}),
    }
  }
  if (candidate.mode !== 'configuration'
    || typeof candidate.configuration !== 'object'
    || candidate.configuration === null
    || Array.isArray(candidate.configuration)) return undefined
  return {
    mode: 'configuration',
    configuration: candidate.configuration as Record<string, unknown>,
  }
}

/** Prefix a normal prompt with the private, length-delimited Fleet activation envelope. */
export function encodeFleetActivation(request: FleetActivationRequest, text: string): string {
  const payload = JSON.stringify(request)
  if (payload.length > MAX_ACTIVATION_JSON_LENGTH) throw new Error('Fleet activation configuration is too large')
  return `${ACTIVATION_PREFIX}${payload.length}:${payload}\n${text}`
}

/** Parse a Fleet activation envelope; ordinary user text is intentionally ignored. */
export function parseFleetActivation(text: string): ParsedFleetActivation | undefined {
  if (!text.startsWith(ACTIVATION_PREFIX)) return undefined
  const lengthStart = ACTIVATION_PREFIX.length
  const separator = text.indexOf(':', lengthStart)
  if (separator < 0) return undefined
  const rawLength = text.slice(lengthStart, separator)
  if (!/^(0|[1-9]\d*)$/.test(rawLength)) return undefined
  const length = Number(rawLength)
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_ACTIVATION_JSON_LENGTH) return undefined
  const payloadStart = separator + 1
  const payloadEnd = payloadStart + length
  if (payloadEnd > text.length || text[payloadEnd] !== '\n') return undefined
  let value: unknown
  try {
    value = JSON.parse(text.slice(payloadStart, payloadEnd)) as unknown
  } catch {
    return undefined
  }
  const request = activationRequest(value)
  if (request === undefined) return undefined
  return { request, text: text.slice(payloadEnd + 1) }
}
