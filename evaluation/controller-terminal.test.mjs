import { test } from 'node:test'
import assert from 'node:assert/strict'
import { settleController } from '../examples/self-evolving-team/scripts/controller-lifecycle.mjs'
import { curriculumBudgetExhausted } from '../examples/self-evolving-team/scripts/curriculum.mjs'

test('generation budget includes rejected candidates and waits for an active candidate or unfinished episodes', () => {
  const config = { maxGenerations: 3, maxAttempts: 2 }
  const state = { stable: 'g0001', candidate: null, nextGeneration: 4 }
  const entry = { episodes: { train: { status: 'completed', attempts: 1 } } }
  assert.equal(curriculumBudgetExhausted(config, state, entry), true)
  assert.equal(curriculumBudgetExhausted(config, { ...state, stable: 'g0003' }, entry, 'g0001'), false)
  assert.equal(curriculumBudgetExhausted(config, { ...state, candidate: 'g0003' }, entry), false)
  assert.equal(curriculumBudgetExhausted(config, state, { episodes: { train: { status: 'failed', attempts: 1 } } }), false)
  assert.equal(curriculumBudgetExhausted(config, state, { episodes: { train: { status: 'failed', attempts: 2 } } }), true)
})

test('terminal handling stops all generation resources before parking and waits for shutdown', async () => {
  const events = []
  let state = { status: 'running' }
  let release
  const parked = new Promise(resolve => { release = resolve })
  let finished = false
  const settling = settleController({
    readState: () => state,
    stopGenerations: async () => { events.push('stopped-resources'); state = { status: 'stopped' } },
    writeTerminal: value => events.push(value),
    park: () => parked,
  }, 'generation_budget_exhausted').then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(events[0], 'stopped-resources')
  assert.deepEqual(events[1], { phase: 'stopped', runStatus: 'stopped', reason: 'generation_budget_exhausted', needsAttention: false })
  assert.equal(finished, false)
  release()
  await settling
  assert.equal(finished, true)
})

test('failed cleanup parks with failed health and preserves an actionable reason', async () => {
  let terminal
  await settleController({ readState: () => ({ status: 'stop_failed' }), stopGenerations: async () => { throw new Error('archive failed') }, writeTerminal: value => { terminal = value }, park: async () => {} }, 'initialization_failed')
  assert.equal(terminal.phase, 'failed')
  assert.equal(terminal.needsAttention, true)
  assert.equal(terminal.reason, 'initialization_failed')
})
