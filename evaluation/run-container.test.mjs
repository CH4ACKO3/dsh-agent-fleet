import assert from 'node:assert/strict'
import test from 'node:test'

import { dockerArguments, parseArguments } from './run-container.mjs'

test('the common launcher maps one run root to isolated mounts and limits', () => {
  const options = parseArguments([
    '--task', 'task.md',
    '--run-root', 'episode-1',
    '--image', 'fleet:benchmark',
    '--env', 'MODEL_API_KEY',
    '--mount', '/dataset:/benchmark/input:ro',
  ])
  const args = dockerArguments(options)
  assert.deepEqual(args.slice(0, 7), ['run', '--rm', '--init', '--cpus', '4', '--memory', '8g'])
  assert.ok(args.includes('MODEL_API_KEY'))
  assert.ok(args.includes('/dataset:/benchmark/input:ro'))
  assert.equal(args.at(-1), 'fleet:benchmark')
  assert.ok(args.some(value => value.endsWith(':/workspace')))
  assert.ok(args.some(value => value.endsWith(':/results')))
})

test('the dind profile selects its overlay and enables nested-container privileges', () => {
  const options = parseArguments([
    '--profile', 'dind',
    '--task', 'task.md',
    '--run-root', 'episode-dind',
  ])
  const args = dockerArguments(options)
  assert.equal(options.image, 'dsh-fleet-evaluation:dind')
  assert.ok(args.includes('--privileged'))
  assert.ok(args.includes('io.deepseek-harness.evaluation.profile=dind'))
})

test('the launcher requires a task and an explicit output location', () => {
  assert.throws(() => parseArguments(['--run-root', 'run']), /--task is required/)
  assert.throws(() => parseArguments(['--task', 'task.md']), /--run-root/)
  assert.throws(
    () => parseArguments(['--profile', 'unknown', '--task', 'task.md', '--run-root', 'run']),
    /baseline or dind/,
  )
})
