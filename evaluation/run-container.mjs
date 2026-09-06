#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaults = {
  profile: 'baseline',
  team: resolve(repositoryRoot, 'examples/frontal-team/teams/coding-small.json'),
  cpus: '4',
  memory: '8g',
  timeoutMs: '3600000',
}

function usage() {
  return `Usage: node evaluation/run-container.mjs --task FILE --run-root DIR [options]

Options:
  --profile PROFILE   Runtime profile: baseline or dind (default: baseline)
  --image IMAGE       Explicit local provider/benchmark image override
  --team FILE         Team JSON (defaults to coding-small.json)
  --workspace DIR     Workspace mount (defaults to RUN_ROOT/workspace)
  --results DIR       Result mount (defaults to RUN_ROOT/results)
  --cpus N            Docker CPU limit (default: 4)
  --memory LIMIT      Docker memory limit (default: 8g)
  --timeout-ms N      Fleet host timeout (default: 3600000)
  --env NAME          Pass one host environment variable; repeat as needed
  --env-file FILE     Docker environment file kept outside the repository
  --mount SPEC        Additional Docker volume specification; repeat as needed
  --network NAME      Docker network selection
  --name NAME         Stable container name
  --keep-container    Retain the stopped container for debugging
`
}

function take(argv, index, option) {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`)
  return value
}

export function parseArguments(argv) {
  const options = { ...defaults, image: undefined, env: [], mounts: [], keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--help' || option === '-h') return { help: true }
    if (option === '--keep-container') { options.keep = true; continue }
    if (option === '--env') { options.env.push(take(argv, index, option)); index += 1; continue }
    if (option === '--mount') { options.mounts.push(take(argv, index, option)); index += 1; continue }
    const key = new Map([
      ['--profile', 'profile'], ['--image', 'image'], ['--team', 'team'], ['--task', 'task'], ['--run-root', 'runRoot'],
      ['--workspace', 'workspace'], ['--results', 'results'], ['--cpus', 'cpus'],
      ['--memory', 'memory'], ['--timeout-ms', 'timeoutMs'], ['--env-file', 'envFile'],
      ['--network', 'network'], ['--name', 'name'],
    ]).get(option)
    if (key === undefined) throw new Error(`unknown option: ${option}`)
    options[key] = take(argv, index, option)
    index += 1
  }
  if (!options.task) throw new Error('--task is required')
  if (!['baseline', 'dind'].includes(options.profile)) {
    throw new Error('--profile must be baseline or dind')
  }
  if (!options.runRoot && (!options.workspace || !options.results)) {
    throw new Error('--run-root, or both --workspace and --results, is required')
  }
  const runRoot = options.runRoot && resolve(options.runRoot)
  options.team = resolve(options.team)
  options.task = resolve(options.task)
  options.workspace = resolve(options.workspace || runRoot, options.workspace ? '' : 'workspace')
  options.results = resolve(options.results || runRoot, options.results ? '' : 'results')
  if (options.envFile) options.envFile = resolve(options.envFile)
  if (!options.image) {
    options.image = options.profile === 'dind'
      ? process.env.FLEET_EVAL_DIND_IMAGE || 'dsh-fleet-evaluation:dind'
      : process.env.FLEET_EVAL_IMAGE || 'dsh-fleet-evaluation:baseline'
  }
  return options
}

export function dockerArguments(options) {
  const args = ['run']
  if (!options.keep) args.push('--rm')
  args.push('--init', '--cpus', options.cpus, '--memory', options.memory)
  if (options.profile === 'dind') args.push('--privileged')
  args.push('--label', `io.deepseek-harness.evaluation.profile=${options.profile}`)
  if (options.name) args.push('--name', options.name)
  if (options.network) args.push('--network', options.network)
  if (options.envFile) args.push('--env-file', options.envFile)
  for (const name of options.env) args.push('-e', name)
  args.push(
    '-e', 'FLEET_EVAL_TEAM_CONFIG=/evaluation/team.json',
    '-e', 'FLEET_EVAL_TASK_FILE=/evaluation/task.md',
    '-e', `FLEET_EVAL_TIMEOUT_MS=${options.timeoutMs}`,
    '-v', `${options.team}:/evaluation/team.json:ro`,
    '-v', `${options.task}:/evaluation/task.md:ro`,
    '-v', `${options.workspace}:/workspace`,
    '-v', `${options.results}:/results`,
  )
  for (const mount of options.mounts) args.push('-v', mount)
  args.push(options.image)
  return args
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  if (options.help) { process.stdout.write(usage()); return 0 }
  mkdirSync(options.workspace, { recursive: true })
  mkdirSync(options.results, { recursive: true })
  const result = spawnSync('docker', dockerArguments(options), { stdio: 'inherit' })
  if (result.error) throw result.error
  return result.status ?? 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (error) {
    process.stderr.write(`dsh-fleet-container: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 5
  }
}
