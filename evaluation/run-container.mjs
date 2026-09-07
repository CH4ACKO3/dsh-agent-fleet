#!/usr/bin/env node
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaults = {
  profile: 'baseline',
  team: resolve(repositoryRoot, 'examples/frontal-team/teams/coding-small.json'),
  cpus: '4',
  memory: '8g',
  timeoutMs: '3600000',
  graceMs: '30000',
}

const valueOptions = new Map([
  ['--profile', 'profile'], ['--image', 'image'], ['--team', 'team'], ['--task', 'task'], ['--run-root', 'runRoot'],
  ['--workspace', 'workspace'], ['--results', 'results'], ['--cpus', 'cpus'],
  ['--memory', 'memory'], ['--timeout-ms', 'timeoutMs'], ['--grace-ms', 'graceMs'], ['--env-file', 'envFile'],
  ['--network', 'network'], ['--name', 'name'],
])

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
  --grace-ms N        Export grace before host-enforced cleanup (default: 30000)
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
    const key = valueOptions.get(option)
    if (key === undefined) throw new Error(`unknown option: ${option}`)
    options[key] = take(argv, index, option)
    index += 1
  }
  if (!options.task) throw new Error('--task is required')
  if (!Number.isFinite(Number(options.cpus)) || Number(options.cpus) <= 0) throw new Error('--cpus must be positive')
  if (!/^[1-9]\d*[bkmg]?$/i.test(options.memory)) throw new Error('--memory must be a positive Docker memory limit')
  for (const key of ['timeoutMs', 'graceMs']) {
    if (!Number.isSafeInteger(Number(options[key])) || Number(options[key]) < (key === 'timeoutMs' ? 1 : 0)) {
      throw new Error(`${key} must be ${key === 'timeoutMs' ? 'positive' : 'nonnegative'} integer milliseconds`)
    }
  }
  if (Number(options.timeoutMs) + Number(options.graceMs) > 2_147_483_647) throw new Error('combined timeout exceeds the Node timer limit')
  if (options.env.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) throw new Error('--env accepts variable names only')
  if (!['baseline', 'dind'].includes(options.profile)) {
    throw new Error('--profile must be baseline or dind')
  }
  if (!options.runRoot && (!options.workspace || !options.results)) {
    throw new Error('--run-root, or both --workspace and --results, is required')
  }
  const runRoot = options.runRoot && resolve(options.runRoot)
  options.runRoot = runRoot
  options.managedMounts = Boolean(runRoot && !options.workspace && !options.results)
  options.team = resolve(options.team)
  options.task = resolve(options.task)
  options.workspace = resolve(options.workspace || runRoot, options.workspace ? '' : 'workspace')
  options.results = resolve(options.results || runRoot, options.results ? '' : 'results')
  if (options.workspace === options.results) throw new Error('workspace and results must be separate directories')
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
  if (options.cidFile) args.push('--cidfile', options.cidFile)
  if (options.runToken) args.push('--label', `io.deepseek-harness.evaluation.invocation=${options.runToken}`)
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

// The daemon can outlive its CLI. Clean up only the ID created by this invocation,
// never a requested name that might already belong to another container.
export async function executeContainer(options, runtime = { spawn, spawnSync }) {
  const temporary = mkdtempSync(resolve(tmpdir(), 'dsh-fleet-episode-'))
  const cidFile = resolve(temporary, 'container.id')
  const runToken = randomUUID()
  let child
  let timer
  let stopping = false
  let stopCode
  let exitCode
  let cleanupFailed = false
  const cleanup = () => {
    let ids = existsSync(cidFile) ? [readFileSync(cidFile, 'utf8').trim()] : []
    if (!ids.length) {
      // The daemon may create a container before the client writes its cidfile.
      const listed = runtime.spawnSync('docker', [
        'ps', '--all', '--quiet', '--no-trunc', '--filter', `label=io.deepseek-harness.evaluation.invocation=${runToken}`,
      ], { encoding: 'utf8', timeout: 15_000 })
      if (listed.error || listed.status !== 0) {
        cleanupFailed = true
        process.stderr.write(`dsh-fleet-container: cannot verify cleanup for invocation ${runToken}\n`)
        return
      }
      ids = String(listed.stdout ?? '').trim().split(/\s+/).filter(Boolean)
    }
    for (const id of ids) {
      if (!/^[a-f0-9]{64}$/.test(id)) { cleanupFailed = true; continue }
      const result = runtime.spawnSync('docker', ['rm', '--force', id], { encoding: 'utf8', timeout: 15_000 })
      if (result.error || (result.status !== 0 && !String(result.stderr).includes('No such container'))) {
        cleanupFailed = true
        process.stderr.write(`dsh-fleet-container: cleanup failed for ${id}; inspect this episode container\n`)
      }
    }
  }
  const stop = code => {
    if (stopping) return
    stopping = true
    stopCode = code
    // Terminate the client before reading its cidfile, then retry after close in
    // case the daemon finished creating the container during cancellation.
    child?.kill('SIGTERM')
    cleanup()
    timer = setTimeout(() => child?.kill('SIGKILL'), 5_000)
    timer.unref()
  }
  const interrupt = () => stop(130)
  const terminate = () => stop(143)
  try {
    exitCode = await new Promise((resolveExit, reject) => {
      child = runtime.spawn('docker', dockerArguments({ ...options, cidFile, runToken }), { stdio: 'inherit' })
      process.once('SIGINT', interrupt)
      process.once('SIGTERM', terminate)
      const deadline = setTimeout(() => stop(124), Number(options.timeoutMs) + Number(options.graceMs))
      const finish = (error, code) => {
        clearTimeout(deadline)
        clearTimeout(timer)
        if (error) reject(error)
        else resolveExit(stopCode ?? code ?? 1)
      }
      child.once('error', error => finish(error))
      child.once('close', code => finish(undefined, code))
    })
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
    if (stopping || !options.keep) cleanup()
    rmSync(temporary, { recursive: true, force: true })
  }
  return cleanupFailed && exitCode === 0 ? 125 : exitCode
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv)
  if (options.help) { process.stdout.write(usage()); return 0 }
  for (const path of [options.team, options.task, options.envFile].filter(Boolean)) {
    if (!statSync(path).isFile()) throw new Error(`expected a file: ${path}`)
  }
  prepareDirectories(options)
  return executeContainer(options)
}

export function prepareDirectories(options) {
  // Bind mounts retain host ownership. A private parent protects the host while
  // the two generated children accommodate non-root benchmark image UIDs.
  if (options.managedMounts) {
    mkdirSync(options.runRoot, { recursive: true, mode: 0o700 })
    const root = lstatSync(options.runRoot)
    if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('--run-root must be a real directory')
    if (process.platform !== 'win32' && (root.mode & 0o077) !== 0) {
      throw new Error('--run-root must be private (mode 0700); use a fresh episode directory or prepare explicit mounts')
    }
  }
  for (const path of [options.workspace, options.results]) {
    mkdirSync(path, { recursive: true })
    if (options.managedMounts) {
      if (lstatSync(path).isSymbolicLink()) throw new Error('generated mounts cannot be symlinks')
      if (process.platform !== 'win32') chmodSync(path, 0o777)
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main()
  } catch (error) {
    process.stderr.write(`dsh-fleet-container: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 5
  }
}
