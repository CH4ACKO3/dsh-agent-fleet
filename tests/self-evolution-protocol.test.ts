import { describe, expect, it } from 'vitest'

import {
  advancePromotionWindow,
  authorizeRequest,
  signRequest,
  stripHostGenerationFooter,
  verifyRequest,
} from '../examples/self-evolving-team/scripts/protocol.mjs'

function state(candidatePhase = 'observing') {
  return {
    stable: 'g0001',
    guardian: null as string | null,
    candidate: 'g0002',
    generations: {
      g0001: { id: 'g0001', phase: 'stable' },
      g0002: { id: 'g0002', phase: candidatePhase },
    } as Record<string, { id: string, phase: string }>,
  }
}

function request(generation: string, type: string) {
  return {
    id: `${generation}-${type}`,
    generation,
    type,
    createdAt: '2026-09-04T00:00:00.000Z',
    payload: {},
  }
}

describe('self-evolution generation protocol', () => {
  it('replaces inherited host generation footers instead of accumulating them', () => {
    const task = '# Task\n\nDo the work.'
    expect(stripHostGenerationFooter(`${task}\n\n<!-- self-evolve:host-generation -->\n\n## 宿主代际信息\n\n- 当前代：g0001`)).toBe(task)
    expect(stripHostGenerationFooter(`${task}\n\n## 宿主代际信息\n\n- 当前代：g0001`)).toBe(task)
  })

  it('authenticates the generation identity without exposing Docker authority', () => {
    const unsigned = request('g0001', 'candidate.destroy')
    const signed = { ...unsigned, signature: signRequest(unsigned, 'secret') }
    expect(verifyRequest(signed, 'secret')).toBe(true)
    expect(verifyRequest({ ...signed, generation: 'g0002' }, 'secret')).toBe(false)
  })

  it('keeps candidate creation and destruction under the stable generation', () => {
    expect(() => authorizeRequest(state(), request('g0002', 'candidate.start')))
      .toThrow('Only the stable generation')
    expect(() => authorizeRequest(state(), request('g0002', 'candidate.destroy')))
      .toThrow('Only the stable generation')
    expect(() => authorizeRequest(state(), request('g0001', 'candidate.destroy'))).not.toThrow()
  })

  it('requires the candidate to confirm itself before the stable generation can promote it', () => {
    expect(() => authorizeRequest(state(), request('g0001', 'candidate.ready')))
      .toThrow('Only the active candidate')
    expect(() => authorizeRequest(state(), request('g0002', 'candidate.ready'))).not.toThrow()
    expect(() => authorizeRequest(state('observing'), request('g0001', 'generation.promote')))
      .toThrow('has not confirmed readiness')
    expect(() => authorizeRequest(state('ready'), request('g0001', 'generation.promote'))).not.toThrow()
    expect(() => authorizeRequest(state('ready'), request('g0002', 'generation.promote')))
      .toThrow('Only the stable generation')
  })

  it('keeps the previous stable generation as a guardian until its child reproduces', () => {
    const first = state('ready')
    const firstAdvance = advancePromotionWindow(first)
    expect(first).toMatchObject({ stable: 'g0002', guardian: 'g0001', candidate: null })
    expect(firstAdvance.previous.phase).toBe('guardian')
    expect(firstAdvance.retiredGuardian).toBeUndefined()

    first.generations.g0003 = { id: 'g0003', phase: 'ready' }
    first.candidate = 'g0003'
    const secondAdvance = advancePromotionWindow(first)
    expect(first).toMatchObject({ stable: 'g0003', guardian: 'g0002', candidate: null })
    expect(secondAdvance.retiredGuardian?.id).toBe('g0001')
    expect(first.generations.g0002.phase).toBe('guardian')
  })
})
