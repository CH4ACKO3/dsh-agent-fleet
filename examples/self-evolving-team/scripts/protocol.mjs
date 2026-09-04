import { createHmac, timingSafeEqual } from 'node:crypto'

export const REQUEST_TYPES = Object.freeze([
  'candidate.start',
  'candidate.destroy',
  'candidate.ready',
  'candidate.reject',
  'generation.promote',
])

const HOST_GENERATION_MARKER = '<!-- self-evolve:host-generation -->'

export function stripHostGenerationFooter(content) {
  const normalized = String(content ?? '').trim()
  const markedIndex = normalized.indexOf(`\n${HOST_GENERATION_MARKER}`)
  const legacyIndex = normalized.indexOf('\n## 宿主代际信息\n')
  const indexes = [markedIndex, legacyIndex].filter(index => index >= 0)
  if (indexes.length === 0) return normalized
  return normalized.slice(0, Math.min(...indexes)).trim()
}

export { HOST_GENERATION_MARKER }

export function requestBody(request) {
  return JSON.stringify({
    id: request.id,
    generation: request.generation,
    type: request.type,
    createdAt: request.createdAt,
    payload: request.payload ?? {},
  })
}

export function signRequest(request, token) {
  return createHmac('sha256', token).update(requestBody(request)).digest('hex')
}

export function verifyRequest(request, token) {
  if (!REQUEST_TYPES.includes(request?.type) || typeof request?.signature !== 'string') return false
  const actual = Buffer.from(request.signature, 'hex')
  const expected = Buffer.from(signRequest(request, token), 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function authorizeRequest(state, request) {
  const stable = state.generations[state.stable]
  const candidate = state.candidate === null ? undefined : state.generations[state.candidate]
  const sender = state.generations[request.generation]
  if (sender === undefined) throw new Error(`Unknown generation ${request.generation}`)
  if (request.type === 'candidate.start') {
    if (sender.id !== stable.id) throw new Error('Only the stable generation can start a candidate')
    if (candidate !== undefined && candidate.requestId !== request.id) {
      throw new Error(`Candidate ${candidate.id} is already active`)
    }
    return
  }
  if (request.type === 'candidate.destroy') {
    if (sender.id !== stable.id) throw new Error('Only the stable generation can destroy its candidate')
    if (candidate === undefined) throw new Error('There is no active candidate')
    return
  }
  if (request.type === 'candidate.ready' || request.type === 'candidate.reject') {
    if (candidate === undefined || sender.id !== candidate.id) {
      throw new Error('Only the active candidate can report its own readiness')
    }
    return
  }
  if (request.type === 'generation.promote') {
    if (sender.id !== stable.id) throw new Error('Only the stable generation can approve promotion')
    if (candidate === undefined) throw new Error('There is no active candidate')
    if (candidate.phase !== 'ready') throw new Error(`Candidate ${candidate.id} has not confirmed readiness`)
    return
  }
  throw new Error(`Unsupported request type ${request.type}`)
}

export function advancePromotionWindow(state) {
  const previous = state.generations[state.stable]
  const candidate = state.candidate === null ? undefined : state.generations[state.candidate]
  if (previous === undefined) throw new Error('Stable generation is unavailable')
  if (candidate === undefined || candidate.phase !== 'ready') {
    throw new Error('A ready candidate is required to advance the generation window')
  }
  const retiredGuardian = state.guardian === null || state.guardian === undefined
    ? undefined
    : state.generations[state.guardian]
  previous.phase = 'guardian'
  candidate.phase = 'stable'
  state.stable = candidate.id
  state.guardian = previous.id
  state.candidate = null
  return { previous, candidate, retiredGuardian }
}
