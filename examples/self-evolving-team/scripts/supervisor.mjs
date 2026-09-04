#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { authorizeRequest, verifyRequest } from './protocol.mjs'

const execFileAsync = promisify(execFile)
const generationMonitors = new Map()

function parseArgs(values) {
  const result = { _: [] }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) {
      result._.push(value)
      continue
    }
    const key = value.slice(2)
    const next = values[index + 1]
    if (next === undefined || next.startsWith('--')) result[key] = true
    else {
      result[key] = next
      index += 1
    }
  }
  return result
}

function requiredText(value, name) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`${name} is required`)
  return normalized
}

function requiredAbsolute(value, name) {
  const normalized = requiredText(value, name)
  if (!isAbsolute(normalized)) throw new Error(`${name} must be an absolute path`)
  return resolve(normalized)
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

function readState(stateDirectory) {
  return JSON.parse(readFileSync(join(stateDirectory, 'state.json'), 'utf8'))
}

function writeState(stateDirectory, state) {
  atomicJson(join(stateDirectory, 'state.json'), state)
}

function publicState(state) {
  return {
    ...state,
    generations: Object.fromEntries(Object.entries(state.generations).map(([id, generation]) => {
      const { token: _token, ...visible } = generation
      return [id, visible]
    })),
  }
}

async function run(command, args, options = {}) {
  let executable = command
  let commandArgs = args
  if (process.platform === 'win32' && command === 'pnpm') {
    const { stdout } = await execFileAsync('where.exe', ['pnpm.cmd'], { windowsHide: true })
    const shim = stdout.split(/\r?\n/).map(value => value.trim()).find(Boolean)
    if (shim === undefined) throw new Error('Could not locate pnpm.cmd')
    const cli = join(dirname(shim), 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    if (!existsSync(cli)) throw new Error(`Could not locate the pnpm CLI behind ${shim}`)
    executable = process.execPath
    commandArgs = [cli, ...args]
  }
  try {
    const result = await execFileAsync(executable, commandArgs, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() }
  } catch (error) {
    const output = [error?.stdout, error?.stderr].map(value => String(value ?? '').trim()).filter(Boolean).join('\n')
    if (!output) throw error
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`, { cause: error })
  }
}

function generationId(number) {
  return `g${String(number).padStart(4, '0')}`
}

function composeEnvironment(state, generation) {
  return {
    ...process.env,
    COMPOSE_PROJECT_NAME: generation.composeProject,
    SELF_EVOLVE_HOST_PORT: String(generation.port),
    SELF_EVOLVE_WORKSPACE: generation.workspace,
    SELF_EVOLVE_CONTROL_ROOT: join(state.stateDirectory, 'control'),
    SELF_EVOLVE_GENERATION: generation.id,
    SELF_EVOLVE_CONTROL_TOKEN: generation.token,
    FLEET_PACKAGE_PATH: generation.packagePath,
    FLEET_SOURCE_COMMIT: generation.sourceCommit,
    FLEET_AUTO_BOOTSTRAP_ID: generation.id,
    SELF_EVOLVE_CPUS: String(state.resources.cpus),
    SELF_EVOLVE_MEMORY: state.resources.memory,
    ...(state.provider === undefined ? {} : { FLEET_AUTO_PROVIDER: state.provider }),
    ...(state.model === undefined ? {} : { FLEET_AUTO_MODEL: state.model }),
  }
}

async function emit(stateDirectory, state, generationIdValue, type, data = {}) {
  const sequence = (state.eventSequences[generationIdValue] ?? 0) + 1
  state.eventSequences[generationIdValue] = sequence
  const event = {
    sequence,
    generation: generationIdValue,
    type,
    createdAt: new Date().toISOString(),
    data,
  }
  const directory = join(stateDirectory, 'control', 'events', generationIdValue)
  mkdirSync(directory, { recursive: true })
  atomicJson(join(directory, `${String(sequence).padStart(10, '0')}-${randomUUID()}.json`), event)
  writeState(stateDirectory, state)
  return event
}

async function resolveCommit(sourceRoot, ref) {
  const { stdout } = await run('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: sourceRoot })
  return stdout
}

async function prepareGeneration(state, number, sourceRef, bootstrapContent) {
  const id = generationId(number)
  const generationRoot = join(state.stateDirectory, 'generations', id)
  const workspace = join(generationRoot, 'workspace')
  if (existsSync(workspace)) throw new Error(`Generation workspace already exists: ${workspace}`)
  const sourceCommit = await resolveCommit(state.sourceRoot, sourceRef)
  mkdirSync(generationRoot, { recursive: true })
  await run('git', ['worktree', 'add', '--detach', workspace, sourceCommit], { cwd: state.sourceRoot })
  try {
    await run('pnpm', ['install', '--frozen-lockfile'], { cwd: workspace })
    await run('pnpm', ['build'], { cwd: workspace })
    mkdirSync(join(generationRoot, 'packages'), { recursive: true })
    await run('pnpm', ['pack', '--pack-destination', join(generationRoot, 'packages')], { cwd: workspace })
    const packageDirectory = join(generationRoot, 'packages')
    const packageName = readdirSync(packageDirectory).find(name => name.endsWith('.tgz'))
    if (packageName === undefined) throw new Error('pnpm pack did not produce a Fleet package')
    const bootstrapDirectory = join(workspace, '.self-evolve')
    mkdirSync(bootstrapDirectory, { recursive: true })
    const bootstrapPath = join(bootstrapDirectory, 'bootstrap.md')
    writeFileSync(bootstrapPath, [
      bootstrapContent.trim(),
      '',
      '## 宿主代际信息',
      '',
      `- 当前代：${id}`,
      `- 源提交：${sourceCommit}`,
      `- 控制命令：node /opt/self-evolve/scripts/generation-control.mjs`,
      '- 等待状态变化请使用 `watch`；它会阻塞直到事件到达，不要按时间轮询。',
      '',
    ].join('\n'), 'utf8')
    return {
      id,
      number,
      sourceRef,
      sourceCommit,
      workspace,
      packagePath: join(packageDirectory, packageName),
      bootstrapPath,
      composeProject: `${state.name}-${id}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
      port: state.basePort + number - 1,
      token: randomBytes(32).toString('hex'),
      phase: 'starting',
      createdAt: new Date().toISOString(),
    }
  } catch (error) {
    await run('git', ['worktree', 'remove', '--force', workspace], { cwd: state.sourceRoot }).catch(() => undefined)
    throw error
  }
}

async function compose(state, generation, args) {
  return run('docker', [
    'compose',
    '--project-directory', state.exampleRoot,
    '-f', join(state.exampleRoot, 'compose.yaml'),
    '-f', join(state.exampleRoot, 'compose.source.yaml'),
    ...args,
  ], { cwd: state.exampleRoot, env: composeEnvironment(state, generation) })
}

async function monitorGeneration(stateDirectory, state, generation) {
  if (generationMonitors.has(generation.id)) return
  const { stdout } = await compose(state, generation, ['ps', '-q', 'dsh'])
  const containerId = stdout.trim()
  if (!containerId) return
  const child = spawn('docker', ['wait', containerId], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let waitOutput = ''
  child.stdout.on('data', chunk => { waitOutput += String(chunk) })
  generationMonitors.set(generation.id, child)
  child.once('close', async waitProcessCode => {
    generationMonitors.delete(generation.id)
    try {
      const current = readState(stateDirectory)
      const stopped = current.generations[generation.id]
      if (stopped === undefined || ['retiring', 'retired', 'rejecting', 'rejected', 'failed'].includes(stopped.phase)) return
      const reportedExitCode = Number(waitOutput.trim().split(/\s+/).at(-1))
      const exitCode = Number.isInteger(reportedExitCode) ? reportedExitCode : waitProcessCode
      stopped.phase = 'failed'
      stopped.failure = `DSH container exited with code ${exitCode ?? 'unknown'}`
      writeState(stateDirectory, current)
      await emit(stateDirectory, current, stopped.id, 'generation.exited', { exitCode })
      const peer = current.stable === stopped.id ? current.candidate : current.stable
      if (peer !== null && peer !== stopped.id) {
        await emit(stateDirectory, current, peer, 'generation.peer_exited', {
          generation: stopped.id, exitCode,
        })
      }
    } catch (error) {
      process.stderr.write(`generation monitor failed: ${error instanceof Error ? error.message : String(error)}\n`)
    }
  })
}

async function launchGeneration(stateDirectory, state, generation) {
  state.generations[generation.id] = generation
  state.eventSequences[generation.id] ??= 0
  writeState(stateDirectory, state)
  try {
    await compose(state, generation, ['up', '-d', '--build', '--wait'])
    generation.phase = 'observing'
    writeState(stateDirectory, state)
    await monitorGeneration(stateDirectory, state, generation)
    return generation
  } catch (error) {
    generation.phase = 'failed'
    generation.failure = error instanceof Error ? error.message : String(error)
    writeState(stateDirectory, state)
    throw error
  }
}

async function stopGeneration(state, generation, { removeVolumes = false } = {}) {
  await compose(state, generation, [
    'down',
    '--remove-orphans',
    ...(removeVolumes ? ['--volumes'] : []),
  ])
  generation.stoppedAt = new Date().toISOString()
}

function assertManagedWorkspace(state, workspace) {
  const managedRoot = resolve(state.stateDirectory, 'generations')
  const target = resolve(workspace)
  if (target === managedRoot || !target.startsWith(`${managedRoot}${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Refusing to clean unmanaged worktree ${target}`)
  }
  return target
}

async function cleanupOldGenerations(stateDirectory, state) {
  const keep = state.retention?.generations ?? 2
  const inactive = Object.values(state.generations)
    .filter(generation => ['retired', 'rejected', 'failed'].includes(generation.phase) && generation.cleanedAt === undefined)
    .sort((left, right) => right.number - left.number)
  for (const generation of inactive.slice(keep)) {
    await run('docker', ['volume', 'rm', `${generation.composeProject}_dsh-data`]).catch(() => undefined)
    const workspace = assertManagedWorkspace(state, generation.workspace)
    if (existsSync(workspace)) {
      await run('git', ['worktree', 'remove', '--force', workspace], { cwd: state.sourceRoot })
    }
    generation.cleanedAt = new Date().toISOString()
    writeState(stateDirectory, state)
  }
}

async function startCandidate(stateDirectory, state, request) {
  const payload = request.payload ?? {}
  const sourceRef = requiredText(payload.sourceRef, 'candidate sourceRef')
  const bootstrap = payload.bootstrap?.content
  const bootstrapContent = requiredText(bootstrap, 'candidate bootstrap content')
  let candidate = state.candidate === null ? undefined : state.generations[state.candidate]
  if (candidate === undefined) {
    const number = state.nextGeneration
    state.nextGeneration += 1
    candidate = await prepareGeneration(state, number, sourceRef, bootstrapContent)
    candidate.requestId = request.id
    state.candidate = candidate.id
    writeState(stateDirectory, state)
  }
  if (candidate.phase === 'observing' || candidate.phase === 'ready') return
  try {
    await launchGeneration(stateDirectory, state, candidate)
    await emit(stateDirectory, state, state.stable, 'candidate.started', {
      candidate: candidate.id,
      sourceCommit: candidate.sourceCommit,
      port: candidate.port,
    })
    await emit(stateDirectory, state, candidate.id, 'generation.started', {
      role: 'candidate',
      parent: state.stable,
      sourceCommit: candidate.sourceCommit,
      port: candidate.port,
    })
  } catch (error) {
    await emit(stateDirectory, state, state.stable, 'candidate.failed', {
      candidate: candidate.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function destroyCandidate(stateDirectory, state, request, kind = 'candidate.destroyed') {
  const candidate = state.generations[state.candidate]
  candidate.phase = 'rejecting'
  writeState(stateDirectory, state)
  await stopGeneration(state, candidate, { removeVolumes: true })
  candidate.phase = 'rejected'
  candidate.reason = request.payload?.reason ?? kind
  state.candidate = null
  await emit(stateDirectory, state, state.stable, kind, {
    candidate: candidate.id,
    reason: candidate.reason,
  })
  await cleanupOldGenerations(stateDirectory, state)
}

async function processRequest(stateDirectory, request) {
  const state = readState(stateDirectory)
  if (state.processedRequests.includes(request.id)) return
  const sender = state.generations[request.generation]
  if (sender === undefined || !verifyRequest(request, sender.token)) {
    throw new Error(`Rejected unauthenticated request ${request.id ?? '<unknown>'}`)
  }
  authorizeRequest(state, request)
  if (request.type === 'candidate.start') await startCandidate(stateDirectory, state, request)
  else if (request.type === 'candidate.destroy') await destroyCandidate(stateDirectory, state, request)
  else if (request.type === 'candidate.reject') await destroyCandidate(stateDirectory, state, request, 'candidate.self_rejected')
  else if (request.type === 'candidate.ready') {
    const candidate = state.generations[state.candidate]
    candidate.phase = 'ready'
    candidate.readiness = request.payload ?? {}
    writeState(stateDirectory, state)
    await emit(stateDirectory, state, state.stable, 'candidate.ready', {
      candidate: candidate.id,
      summary: request.payload?.summary ?? '',
      evidence: request.payload?.evidence,
    })
  } else if (request.type === 'generation.promote') {
    const previous = state.generations[state.stable]
    const candidate = state.generations[state.candidate]
    candidate.phase = 'stable'
    candidate.promotedAt = new Date().toISOString()
    candidate.handoff = request.payload ?? {}
    previous.phase = 'retiring'
    state.stable = candidate.id
    state.candidate = null
    writeState(stateDirectory, state)
    await emit(stateDirectory, state, candidate.id, 'generation.promoted', {
      previous: previous.id,
      handoff: request.payload?.handoff,
      summary: request.payload?.summary ?? '',
    })
    await stopGeneration(state, previous)
    previous.phase = 'retired'
    writeState(stateDirectory, state)
    await cleanupOldGenerations(stateDirectory, state)
  }
  const completed = readState(stateDirectory)
  if (!completed.processedRequests.includes(request.id)) completed.processedRequests.push(request.id)
  if (completed.processedRequests.length > 5000) completed.processedRequests.splice(0, 1000)
  writeState(stateDirectory, completed)
}

async function scanRequests(stateDirectory) {
  const requestDirectory = join(stateDirectory, 'control', 'requests')
  const completedDirectory = join(stateDirectory, 'control', 'completed')
  const rejectedDirectory = join(stateDirectory, 'control', 'rejected')
  mkdirSync(requestDirectory, { recursive: true })
  for (const name of readdirSync(requestDirectory).filter(name => name.endsWith('.json')).sort()) {
    const path = join(requestDirectory, name)
    let request
    try {
      request = JSON.parse(readFileSync(path, 'utf8'))
      await processRequest(stateDirectory, request)
      mkdirSync(completedDirectory, { recursive: true })
      renameSync(path, join(completedDirectory, name))
    } catch (error) {
      const state = readState(stateDirectory)
      if (request !== undefined && state.generations[request.generation] !== undefined) {
        await emit(stateDirectory, state, request.generation, 'request.rejected', {
          requestId: request.id,
          requestType: request.type,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      mkdirSync(rejectedDirectory, { recursive: true })
      renameSync(path, join(rejectedDirectory, name))
    }
  }
}

async function serve(stateDirectory) {
  const requestDirectory = join(stateDirectory, 'control', 'requests')
  mkdirSync(requestDirectory, { recursive: true })
  let active = false
  let rerun = false
  const drain = async () => {
    if (active) {
      rerun = true
      return
    }
    active = true
    try {
      do {
        rerun = false
        await scanRequests(stateDirectory)
      } while (rerun)
    } finally {
      active = false
    }
  }
  await drain()
  const state = readState(stateDirectory)
  if (state.status === 'stopped') return
  for (const generation of Object.values(state.generations)) {
    if (['stable', 'observing', 'ready'].includes(generation.phase)) {
      await monitorGeneration(stateDirectory, state, generation)
    }
  }
  await cleanupOldGenerations(stateDirectory, state)
  process.stdout.write(`Self-evolution supervisor watching ${requestDirectory}\n`)
  await new Promise((resolvePromise, rejectPromise) => {
    const watcher = watch(requestDirectory, { persistent: true }, () => {
      void drain().then(() => {
        if (readState(stateDirectory).status === 'stopped') stop()
      }).catch(rejectPromise)
    })
    const stop = () => {
      watcher.close()
      resolvePromise()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

async function stopRun(stateDirectory) {
  const state = readState(stateDirectory)
  if (state.status === 'stopped') return state
  for (const generation of Object.values(state.generations).sort((left, right) => right.number - left.number)) {
    if (generation.cleanedAt !== undefined) continue
    generation.phase = 'retiring'
    writeState(stateDirectory, state)
    await stopGeneration(state, generation, { removeVolumes: true }).catch(() => undefined)
    generation.phase = 'stopped'
  }
  state.status = 'stopped'
  state.candidate = null
  state.stoppedAt = new Date().toISOString()
  writeState(stateDirectory, state)
  writeFileSync(join(stateDirectory, 'control', 'requests', '.supervisor-stopped'), `${state.stoppedAt}\n`, 'utf8')
  return state
}

async function initialize(args) {
  const stateDirectory = requiredAbsolute(args.state, '--state')
  const sourceRoot = requiredAbsolute(args.source, '--source')
  const bootstrapPath = requiredAbsolute(args.bootstrap, '--bootstrap')
  const exampleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (existsSync(join(stateDirectory, 'state.json'))) throw new Error(`State already exists: ${stateDirectory}`)
  if (!existsSync(bootstrapPath)) throw new Error(`Bootstrap file does not exist: ${bootstrapPath}`)
  const basePort = Number(args.port ?? 3120)
  const cpus = Number(args.cpus ?? 4)
  const retainGenerations = Number(args['retain-generations'] ?? 2)
  if (!Number.isSafeInteger(basePort) || basePort < 1024 || basePort > 65000) throw new Error('--port must be between 1024 and 65000')
  if (!Number.isFinite(cpus) || cpus <= 0) throw new Error('--cpus must be positive')
  if (!Number.isSafeInteger(retainGenerations) || retainGenerations < 0) {
    throw new Error('--retain-generations must be a non-negative integer')
  }
  mkdirSync(join(stateDirectory, 'control', 'requests'), { recursive: true })
  const state = {
    schemaVersion: 1,
    name: requiredText(args.name ?? `self-evolve-${randomUUID().slice(0, 8)}`, '--name'),
    stateDirectory,
    sourceRoot,
    exampleRoot,
    basePort,
    resources: { cpus, memory: requiredText(args.memory ?? '8g', '--memory') },
    retention: {
      generations: retainGenerations,
    },
    ...(args.provider === undefined ? {} : { provider: requiredText(args.provider, '--provider') }),
    ...(args.model === undefined ? {} : { model: requiredText(args.model, '--model') }),
    stable: generationId(1),
    candidate: null,
    nextGeneration: 2,
    generations: {},
    eventSequences: {},
    processedRequests: [],
    status: 'running',
  }
  const generation = await prepareGeneration(
    state,
    1,
    requiredText(args.ref ?? 'HEAD', '--ref'),
    readFileSync(bootstrapPath, 'utf8'),
  )
  generation.phase = 'stable'
  await launchGeneration(stateDirectory, state, generation)
  generation.phase = 'stable'
  writeState(stateDirectory, state)
  await emit(stateDirectory, state, generation.id, 'generation.started', {
    role: 'stable', sourceCommit: generation.sourceCommit, port: generation.port,
  })
  process.stdout.write(`${JSON.stringify({ state: stateDirectory, generation: generation.id, port: generation.port })}\n`)
  if (args.serve !== false && args['no-serve'] !== true) await serve(stateDirectory)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]
  if (command === 'init') return initialize(args)
  if (command === 'serve') return serve(requiredAbsolute(args.state, '--state'))
  if (command === 'stop') {
    const state = await stopRun(requiredAbsolute(args.state, '--state'))
    process.stdout.write(`${JSON.stringify(publicState(state), null, 2)}\n`)
    return
  }
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(publicState(readState(requiredAbsolute(args.state, '--state'))), null, 2)}\n`)
    return
  }
  throw new Error('Usage: supervisor <init|serve|status|stop> --state <absolute-directory> [options]')
}

main().catch(error => {
  process.stderr.write(`self-evolution supervisor: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})

export { processRequest, readState }
