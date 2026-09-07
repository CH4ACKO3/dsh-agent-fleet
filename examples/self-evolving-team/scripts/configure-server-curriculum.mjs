#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function configureServer(root) {
  root = resolve(root)
  const directory = join(root, 'curriculum-config')
  mkdirSync(directory, { recursive: true })
  const ale = JSON.parse(readFileSync(join(root, 'manifests', 'ale.json'), 'utf8'))
  const aleSplits = { 'data-pipeline': 'train', 'k8s-migration': 'train', 'cost-optimization': 'validation', 'ranking-recovery': 'test' }
  for (const task of ale.tasks) {
    if (!aleSplits[task.id]) throw new Error(`unrecognized ALE fixture task: ${task.id}`)
    task.split = aleSplits[task.id]
  }
  const horizon = JSON.parse(readFileSync(join(root, 'manifests', 'horizonmath', 'manifest.json'), 'utf8'))
  // Offline grading cannot decide numeric-method compliance. Select only official modes without it.
  const eligible = horizon.tasks.filter(task => ['benchmark_best_known', 'new_construction'].includes(task.evaluationMode)).sort((a, b) => a.id.localeCompare(b.id))
  if (eligible.length < 3) throw new Error('at least three offline-gradeable HorizonMath tasks are required')
  for (const [index, task] of eligible.entries()) task.split = index % 5 === 0 ? 'validation' : index % 5 === 1 ? 'test' : 'train'
  horizon.tasks = eligible
  horizon.selection = 'offline benchmark_best_known/new_construction only; not the full numeric benchmark'
  const manifests = { ale: join(directory, 'ale.json'), horizonmath: join(directory, 'horizonmath-offline.json') }
  writeFileSync(manifests.ale, `${JSON.stringify(ale, null, 2)}\n`)
  writeFileSync(manifests.horizonmath, `${JSON.stringify(horizon, null, 2)}\n`)
  const config = {
    schemaVersion: 1, seed: 'fleet-rsi-server-20260908-v1', samplePerBenchmark: 1,
    validationEvery: 5, testEvery: 20, maxGenerations: 20, maxAttempts: 2, retainGenerations: 2,
    timeoutMs: 1800000, jobTimeoutMs: 3000000, intervalMs: 5000,
    benchmarks: ['ale', 'horizonmath'].map(id => ({
      id, manifest: manifests[id], image: `dsh-fleet-generation-${id}:{commit}`,
      buildCommand: ['node', join(root, 'source', 'evaluation', 'build-generation-image.mjs'), '--source', '{source}', '--commit', '{commit}', '--benchmark', id, '--image', '{image}'],
      command: ['python3', join(root, 'source', 'evaluation', 'batch-run.py'), '--job', '{job}'],
      runtime: { envFile: join(root, 'secrets', 'provider.env'), graderImage: 'dsh-horizonmath-grader:3259167b263e', cpus: 4, memory: '8g' },
    })),
  }
  for (const benchmark of config.benchmarks) for (const command of [benchmark.command[1], benchmark.buildCommand[1]]) {
    if (!existsSync(command)) throw new Error(`trusted runner is missing: ${command}`)
  }
  const configPath = join(directory, 'curriculum.json')
  const encoded = `${JSON.stringify(config, null, 2)}\n`
  writeFileSync(configPath, encoded)
  return { configPath, sha256: createHash('sha256').update(encoded).digest('hex'), benchmarks: { ale: { train: 2, validation: 1, test: 1 }, horizonmath: Object.fromEntries(['train', 'validation', 'test'].map(split => [split, eligible.filter(task => task.split === split).length])) } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: configure-server-curriculum.mjs ABSOLUTE_SERVER_ROOT')
    process.stdout.write(`${JSON.stringify(configureServer(process.argv[2]))}\n`)
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
