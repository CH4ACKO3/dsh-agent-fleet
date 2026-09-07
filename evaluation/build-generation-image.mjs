#!/usr/bin/env node
// Trusted host builder. Evolving files are Docker build context, never host programs.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const trustedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export function parseArguments(argv) {
  const result = { benchmark: 'horizonmath', baseImage: 'ale-ubuntu22-dsh-fleet:0.2.0', timeoutMs: 1800000 }
  const names = { '--source': 'source', '--commit': 'commit', '--benchmark': 'benchmark', '--image': 'image', '--ale-base-image': 'baseImage', '--timeout-ms': 'timeoutMs' }
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]]
    const value = argv[index + 1]
    if (!key || !value || value.startsWith('--')) throw new Error('Usage: build-generation-image.mjs --source DIR --commit SHA --benchmark ale|horizonmath --image TAG [--ale-base-image IMAGE]')
    result[key] = value
  }
  if (!result.source || !/^[a-f0-9]{40,64}$/.test(result.commit ?? '') || !result.image) throw new Error('source, full commit and image are required')
  if (!['ale', 'horizonmath'].includes(result.benchmark)) throw new Error('benchmark must be ale or horizonmath')
  result.timeoutMs = Number(result.timeoutMs)
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs <= 0) throw new Error('timeout must be a positive integer')
  result.source = resolve(result.source)
  return result
}

export function buildPlan(options, root = trustedRoot) {
  const common = `dsh-fleet-generation-common:${options.commit}`
  const ale = options.benchmark === 'ale' ? options.image : `dsh-fleet-generation-ale:${options.commit}`
  const stages = [
    { image: common, file: 'evaluation/runtime.Dockerfile', args: [`FLEET_REVISION=${options.commit}`] },
    { image: ale, file: 'integrations/agents-last-exam/server-overlay.Dockerfile', args: [`FLEET_IMAGE=${common}`, `ALE_IMAGE=${options.baseImage}`, `FLEET_REVISION=${options.commit}`] },
  ]
  if (options.benchmark === 'horizonmath') stages.push({ image: options.image, file: 'integrations/horizonmath/server-runtime.Dockerfile', args: [`FLEET_IMAGE=${ale}`] })
  return stages.map(stage => ({ ...stage, file: resolve(root, stage.file) }))
}

function execute(command, args, { timeoutMs = 1800000, inherit = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: timeoutMs, killSignal: 'SIGTERM', maxBuffer: 8 * 1024 * 1024, stdio: inherit ? 'inherit' : 'pipe' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${result.stderr ?? ''}`)
  return result.stdout?.trim() ?? ''
}

export function buildGeneration(options, run = execute, root = trustedRoot) {
  const actual = run('git', ['-C', options.source, 'rev-parse', '--verify', 'HEAD'])
  if (actual !== options.commit) throw new Error(`source HEAD mismatch: expected ${options.commit}, found ${actual}`)
  const plan = buildPlan(options, root)
  // The trusted recipe digest also invalidates cached layers/tags after a host-side recipe fix.
  const recipe = createHash('sha256')
  const images = []
  for (const stage of plan) {
    if (!existsSync(stage.file)) throw new Error(`trusted recipe is missing: ${stage.file}`)
    recipe.update(readFileSync(stage.file))
    const recipeDigest = recipe.copy().digest('hex')
    let metadata
    try { metadata = JSON.parse(run('docker', ['image', 'inspect', stage.image]))[0] } catch {}
    const labels = metadata?.Config?.Labels ?? {}
    if (labels['org.opencontainers.image.revision'] !== options.commit || labels['io.deepseek-harness.generation.recipe'] !== recipeDigest) {
      run('docker', ['build', '--file', stage.file, '--tag', stage.image,
        '--label', `org.opencontainers.image.revision=${options.commit}`,
        '--label', `io.deepseek-harness.generation.recipe=${recipeDigest}`,
        ...stage.args.flatMap(value => ['--build-arg', value]), options.source], { timeoutMs: options.timeoutMs, inherit: true })
      metadata = JSON.parse(run('docker', ['image', 'inspect', stage.image]))[0]
    }
    if (metadata?.Config?.Labels?.['org.opencontainers.image.revision'] !== options.commit) throw new Error(`built image revision mismatch: ${stage.image}`)
    images.push({ image: stage.image, id: metadata.Id, sourceCommit: options.commit, recipeDigest })
  }
  return { schemaVersion: 1, benchmark: options.benchmark, sourceCommit: options.commit, image: options.image, images }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(buildGeneration(parseArguments(process.argv.slice(2))))}\n`) }
  catch (error) { process.stderr.write(`generation image: ${error.message}\n`); process.exitCode = 1 }
}
