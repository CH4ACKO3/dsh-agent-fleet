#!/usr/bin/env node
// Trusted host control plane. Never mount this state or the manifests in an Agent.
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostname } from 'node:os'

const digest = value => createHash('sha256').update(value).digest('hex')
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

export function isWithin(parent, child) {
  const path = relative(resolve(parent), resolve(child))
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function positiveInteger(value, name, fallback) {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${name} must be a positive integer`)
  return result
}

export function loadCurriculum(path, stateDirectory) {
  const raw = readJson(path)
  if (raw.schemaVersion !== 1 || typeof raw.seed !== 'string' || !raw.seed) throw new Error('curriculum requires schemaVersion 1 and a fixed seed')
  if (!Array.isArray(raw.benchmarks) || !raw.benchmarks.length) throw new Error('at least one benchmark is required')
  const benchmarks = []
  const ids = new Set()
  const identities = new Map()
  const manifestBytes = []
  const sealedFiles = []
  for (const input of raw.benchmarks) {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(input.id) || ids.has(input.id)) throw new Error('benchmark ids must be unique path-safe names')
    ids.add(input.id)
    if (!Array.isArray(input.command) || !input.command.length || input.command.some(value => typeof value !== 'string') || !input.command.includes('{job}')) throw new Error(`${input.id}: command argv must include a standalone {job}`)
    if (input.buildCommand !== undefined && (!Array.isArray(input.buildCommand) || !input.buildCommand.length || input.buildCommand.some(value => typeof value !== 'string'))) throw new Error(`${input.id}: buildCommand must be an argv array`)
    if (input.auxiliaryImages !== undefined && (!Array.isArray(input.auxiliaryImages) || input.auxiliaryImages.some(value => typeof value !== 'string' || !value))) throw new Error(`${input.id}: auxiliaryImages must contain explicit image templates`)
    const manifest = realpathSync(resolve(dirname(path), input.manifest))
    if (isWithin(join(stateDirectory, 'generations'), manifest)) throw new Error('manifests must remain outside generation workspaces')
    const bytes = readFileSync(manifest, 'utf8')
    sealedFiles.push({ path: manifest, digest: digest(bytes) })
    manifestBytes.push(bytes)
    const document = JSON.parse(bytes)
    const records = Array.isArray(document) ? document : document.tasks
    if (!Array.isArray(records) || !records.length) throw new Error(`${input.id}: manifest has no tasks`)
    const taskIds = new Set()
    const tasks = records.map(record => {
      const id = String(record.id ?? '')
      if (!id || taskIds.has(id)) throw new Error(`${input.id}: missing or duplicate task id ${id}`)
      taskIds.add(id)
      // A group denotes problem families/variants. Exact prompt duplicates share a split even across benchmarks.
      const task = record.task ? realpathSync(resolve(dirname(manifest), record.task)) : undefined
      const contentIdentity = task ? `content:${digest(readFileSync(task))}` : undefined
      const fingerprint = record.group ? `group:${record.group}` : contentIdentity ?? `${input.id}:${id}`
      if (task) manifestBytes.push(`${task}:${contentIdentity}`)
      if (task) sealedFiles.push({ path: task, digest: digest(readFileSync(task)) })
      if (record.experiment) {
        const experiment = realpathSync(resolve(dirname(manifest), record.experiment))
        manifestBytes.push(`${experiment}:${digest(readFileSync(experiment))}`)
        sealedFiles.push({ path: experiment, digest: digest(readFileSync(experiment)) })
      }
      const bucket = Number.parseInt(digest(`${raw.seed}|split|${fingerprint}`).slice(0, 8), 16) / 0x100000000
      const split = record.split ?? (bucket < 0.7 ? 'train' : bucket < 0.85 ? 'validation' : 'test')
      if (!['train', 'validation', 'test'].includes(split)) throw new Error(`unsupported split: ${split}`)
      for (const identity of new Set([fingerprint, contentIdentity].filter(Boolean))) {
        if (identities.has(identity) && identities.get(identity) !== split) throw new Error(`data leakage: problem family ${id} crosses splits`)
        identities.set(identity, split)
      }
      return { ...record, id, ...(task ? { task } : {}), benchmark: input.id, domain: String(record.domain ?? input.domain ?? input.id), split }
    })
    for (const split of ['train', 'validation', 'test']) {
      if (!tasks.some(task => task.split === split)) throw new Error(`${input.id}: ${split} is empty; provide explicit disjoint splits for small suites`)
    }
    benchmarks.push({ ...input, tasks })
  }
  return {
    ...raw, benchmarks, sealedFiles,
    configDigest: digest(JSON.stringify(raw) + manifestBytes.join('\n')),
    samplePerBenchmark: positiveInteger(raw.samplePerBenchmark, 'samplePerBenchmark', 2),
    validationEvery: positiveInteger(raw.validationEvery, 'validationEvery', 5),
    testEvery: positiveInteger(raw.testEvery, 'testEvery', 20),
    intervalMs: positiveInteger(raw.intervalMs, 'intervalMs', 5000),
    timeoutMs: positiveInteger(raw.timeoutMs, 'timeoutMs', 3600000),
    jobTimeoutMs: positiveInteger(raw.jobTimeoutMs, 'jobTimeoutMs', (raw.timeoutMs ?? 3600000) + 1080000),
    maxAttempts: positiveInteger(raw.maxAttempts, 'maxAttempts', 2),
    maxGenerations: positiveInteger(raw.maxGenerations, 'maxGenerations', 1000),
    retainGenerations: positiveInteger(raw.retainGenerations, 'retainGenerations', 2),
  }
}

export function sampleTasks(config, generation, split) {
  const result = []
  for (const benchmark of config.benchmarks) {
    const domains = new Map()
    for (const task of benchmark.tasks.filter(task => task.split === split)) {
      if (!domains.has(task.domain)) domains.set(task.domain, [])
      domains.get(task.domain).push(task)
    }
    const order = value => digest(`${config.seed}|sample|${generation}|${split}|${benchmark.id}|${value}`)
    const queues = [...domains].sort(([a], [b]) => order(a).localeCompare(order(b))).map(([, tasks]) => tasks.sort((a, b) => order(a.id).localeCompare(order(b.id))))
    let count = 0
    while (count < config.samplePerBenchmark && queues.some(queue => queue.length)) {
      for (const queue of queues) {
        if (!queue.length || count >= config.samplePerBenchmark) continue
        result.push({ benchmark, task: queue.shift() })
        count += 1
      }
    }
  }
  return result
}

export function acquireLock(directory) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'runner.lock')
  const processBirth = pid => {
    if (process.platform === 'linux') return readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')[19]
    return pid === process.pid ? String(Math.round(performance.timeOrigin)) : undefined
  }
  const owner = { pid: process.pid, hostname: hostname(), processBirth: processBirth(process.pid), id: randomUUID() }
  try { writeFileSync(path, JSON.stringify(owner), { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const previous = readJson(path)
    if (previous.hostname !== hostname()) throw new Error('curriculum lock belongs to another host; inspect before removing it')
    try {
      process.kill(previous.pid, 0)
      if (previous.processBirth && processBirth(previous.pid) !== undefined && processBirth(previous.pid) !== previous.processBirth) {
        rmSync(path)
        return acquireLock(directory)
      }
    }
    catch (failure) {
      if (failure.code !== 'ESRCH') throw failure
      rmSync(path)
      return acquireLock(directory)
    }
    throw new Error(`curriculum is already running with pid ${previous.pid}`)
  }
  return () => { if (existsSync(path) && readJson(path).id === owner.id) rmSync(path) }
}

async function command(argv, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd: options.cwd, env: process.env, windowsHide: true, stdio: options.stdio ?? 'ignore', detached: process.platform !== 'win32' })
    let forced
    const terminate = () => {
      if (forced) return
      // Let the trusted adapter reap episode containers before escalating termination.
      child.kill('SIGTERM')
      forced = setTimeout(() => {
        if (process.platform === 'win32') child.kill('SIGKILL')
        else { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
      }, 60000)
    }
    const timer = setTimeout(terminate, options.timeoutMs ?? 300000)
    const onAbort = () => terminate()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted) terminate()
    child.once('error', reject)
    child.once('close', code => {
      clearTimeout(timer)
      clearTimeout(forced)
      options.signal?.removeEventListener('abort', onAbort)
      code === 0 ? resolvePromise() : reject(new Error(`runner exited ${code ?? 'after termination'}`))
    })
  })
}

export function trainingSummary(generation, episodes) {
  return {
    schemaVersion: 1, generation: generation.id, sourceCommit: generation.sourceCommit,
    status: episodes.every(episode => episode.status === 'completed') ? 'completed' : 'failed',
    episodes: episodes.map(episode => ({
      benchmark: episode.benchmark, id: episode.taskId, domain: episode.domain,
      status: episode.status, ...(Number.isFinite(episode.result?.score) ? { score: episode.result.score } : {}),
      ...(episode.evidence ? { evidence: episode.evidence } : {}),
      // No paths, command logs, arbitrary runner metadata, validation or test objects cross this boundary.
      feedback: (typeof episode.result?.feedback === 'object' && episode.result.feedback !== null ? JSON.stringify(episode.result.feedback) : String(episode.result?.feedback ?? episode.error ?? '')).slice(0, 12000),
    })),
  }
}

function boundedFile(root, path, limit) {
  if (!isWithin(root, path)) throw new Error('training evidence must stay inside its declared root')
  let cursor = resolve(path)
  while (true) {
    if (!existsSync(cursor) || lstatSync(cursor).isSymbolicLink()) return undefined
    if (cursor === resolve(root)) break
    cursor = dirname(cursor)
  }
  if (!lstatSync(path).isFile()) return undefined
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const buffer = Buffer.alloc(limit + 1)
    const bytes = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, Math.min(bytes, limit)).toString('utf8') + (bytes > limit ? '\n[truncated by host]\n' : '')
  } finally { closeSync(fd) }
}

function exportTrainingEvidence(task, output, exportRoot, key) {
  const directory = join(exportRoot, 'episodes', digest(key).slice(0, 20))
  mkdirSync(directory, { recursive: true })
  const files = []
  const inputs = [
    task.task
      ? { root: dirname(task.task), path: task.task, name: 'task.md', limit: 64000 }
      : { root: output, path: join(output, 'results', 'task.md'), name: 'task.md', limit: 64000 },
    { root: output, path: join(output, 'results', 'answer.txt'), name: 'answer.txt', limit: 32000 },
    { root: output, path: join(output, 'results', 'events.jsonl'), name: 'events.jsonl', limit: 64000 },
    { root: output, path: join(output, 'workspace', 'solution.py'), name: 'solution.py', limit: 32000 },
    { root: output, path: join(output, 'agent.log'), name: 'agent.log', limit: 32000 },
  ]
  for (const input of inputs) {
    const content = boundedFile(input.root, input.path, input.limit)
    if (content === undefined) continue
    writeFileSync(join(directory, input.name), content, { mode: 0o600 })
    files.push(`episodes/${digest(key).slice(0, 20)}/${input.name}`)
  }
  return files
}

export async function runGeneration(config, state, generation, dependencies = {}) {
  for (const file of config.sealedFiles ?? []) {
    if (digest(readFileSync(file.path)) !== file.digest) throw new Error('sealed dataset changed while the curriculum was running')
  }
  const execute = dependencies.execute ?? command
  const root = join(state.stateDirectory, 'curriculum')
  const ledgerPath = join(root, 'ledger.json')
  const ledger = existsSync(ledgerPath) ? readJson(ledgerPath) : { schemaVersion: 1, configDigest: config.configDigest, generations: {} }
  if (ledger.configDigest !== config.configDigest) throw new Error('curriculum configuration or manifests changed; start a new run instead of changing the holdout')
  const entry = ledger.generations[generation.id] ??= { sourceCommit: generation.sourceCommit, episodes: {} }
  if (entry.sourceCommit !== generation.sourceCommit) throw new Error('generation source changed after sampling')
  if (entry.finishedAt && Object.values(entry.episodes).every(episode => episode.status === 'completed' || episode.attempts >= config.maxAttempts)) return entry
  const frozen = join(root, 'snapshots', generation.id)
  if (!existsSync(join(frozen, '.git'))) {
    mkdirSync(dirname(frozen), { recursive: true })
    await execute(['git', 'clone', '--no-hardlinks', '--no-checkout', state.repository, frozen])
  }
  await execute(['git', '-C', frozen, 'checkout', '--detach', generation.sourceCommit])
  entry.images ??= {}
  entry.auxiliaryImages ??= {}
  for (const benchmark of config.benchmarks) {
    if (!benchmark.image) continue
    const image = benchmark.image.replaceAll('{commit}', generation.sourceCommit).replaceAll('{generation}', generation.id)
    if (entry.images[benchmark.id] !== image && benchmark.buildCommand) {
      const replacements = { '{source}': frozen, '{commit}': generation.sourceCommit, '{generation}': generation.id, '{image}': image }
      const build = benchmark.buildCommand.map(value => Object.entries(replacements).reduce((text, [key, replacement]) => text.replaceAll(key, replacement), value))
      await execute(build, { timeoutMs: config.jobTimeoutMs, signal: dependencies.signal })
      entry.images[benchmark.id] = image
      entry.auxiliaryImages[benchmark.id] = (benchmark.auxiliaryImages ?? []).map(value => value.replaceAll('{commit}', generation.sourceCommit).replaceAll('{generation}', generation.id))
      atomicJson(ledgerPath, ledger)
    }
  }
  const splits = ['train']
  if (generation.number % config.validationEvery === 0) splits.push('validation')
  if (generation.number % config.testEvery === 0) splits.push('test')
  const training = []
  for (const split of splits) {
    for (const { benchmark, task } of sampleTasks(config, generation.number, split)) {
      if (dependencies.signal?.aborted) throw new Error('curriculum stopped')
      const key = `${split}:${benchmark.id}:${task.id}`
      const episode = entry.episodes[key] ??= { split, benchmark: benchmark.id, taskId: task.id, domain: task.domain, attempts: 0, status: 'pending' }
      if (episode.status !== 'completed' && episode.attempts < config.maxAttempts) {
        episode.attempts += 1
        episode.status = 'running'
        atomicJson(ledgerPath, ledger)
        const output = join(root, 'episodes', generation.id, split, digest(key).slice(0, 20), `attempt-${episode.attempts}`)
        mkdirSync(output, { recursive: true, mode: 0o700 })
        const jobPath = join(output, 'job.json')
        atomicJson(jobPath, { ...benchmark.runtime, schemaVersion: 1, generation: generation.id, split, sourceCommit: generation.sourceCommit, sourceWorkspace: frozen, task, output, timeoutMs: config.timeoutMs, ...(benchmark.image ? { image: benchmark.image.replaceAll('{commit}', generation.sourceCommit).replaceAll('{generation}', generation.id) } : {}) })
        try {
          await execute(benchmark.command.map(value => value === '{job}' ? jobPath : value), { timeoutMs: config.jobTimeoutMs, cwd: dirname(jobPath), signal: dependencies.signal })
          const result = readJson(join(output, 'result.json'))
          if (result.status !== 'completed' || !Number.isFinite(result.score)) throw new Error('runner did not produce a completed result with an authoritative finite score')
          if (result.taskId !== task.id || result.split !== split || result.sourceCommit !== generation.sourceCommit) throw new Error('runner result identity does not match its frozen episode')
          episode.result = result
          episode.status = 'completed'
          delete episode.error
        } catch (error) {
          episode.status = 'failed'
          episode.error = error instanceof Error ? error.message : String(error)
        }
        episode.finishedAt = new Date().toISOString()
        atomicJson(ledgerPath, ledger)
      }
      if (split === 'train') {
        const output = join(root, 'episodes', generation.id, split, digest(key).slice(0, 20), `attempt-${episode.attempts}`)
        episode.evidence = exportTrainingEvidence(task, output, join(state.stateDirectory, 'curriculum-feedback', generation.id), key)
        training.push(episode)
      }
    }
    if (split === 'train') {
      const summary = trainingSummary(generation, training)
      entry.trainingComplete = summary.status === 'completed'
      atomicJson(ledgerPath, ledger)
      // The one-way export is deliberately allowlisted and separate from sealed episodes.
      atomicJson(join(state.stateDirectory, 'curriculum-feedback', generation.id, 'feedback.json'), summary)
    }
  }
  entry.finishedAt = new Date().toISOString()
  atomicJson(ledgerPath, ledger)
  return entry
}

export async function pruneCurriculum(config, state, execute = command) {
  const root = join(state.stateDirectory, 'curriculum')
  const ledgerPath = join(root, 'ledger.json')
  if (!existsSync(ledgerPath)) return
  const ledger = readJson(ledgerPath)
  const active = new Set([state.stable, state.guardian, state.candidate].filter(Boolean))
  const completed = Object.entries(ledger.generations).filter(([, generation]) => generation.finishedAt).sort(([a], [b]) => b.localeCompare(a))
  const keep = new Set([...active, ...completed.slice(0, config.retainGenerations ?? 2).map(([id]) => id)])
  const imagesFor = generation => [...Object.values(generation?.images ?? {}), ...Object.values(generation?.auxiliaryImages ?? {}).flat()]
  const keptImages = new Set([...keep].flatMap(id => imagesFor(ledger.generations[id])))
  for (const [id, generation] of completed) {
    if (keep.has(id) || generation.prunedAt) continue
    try {
      for (const image of new Set(imagesFor(generation))) {
        if (!keptImages.has(image)) await execute(['docker', 'image', 'rm', image], { timeoutMs: 60000 })
      }
      const snapshots = join(root, 'snapshots')
      const target = join(snapshots, id)
      if (!/^g\d+$/.test(id) || !isWithin(snapshots, target) || target === snapshots) throw new Error('invalid managed snapshot path')
      if (existsSync(target)) {
        if (lstatSync(target).isSymbolicLink() || !isWithin(realpathSync(snapshots), realpathSync(target))) throw new Error('snapshot escaped its managed root')
        rmSync(target, { recursive: true, force: true })
      }
      generation.prunedAt = new Date().toISOString()
      delete generation.cleanupFailure
    } catch (error) { generation.cleanupFailure = error.message }
  }
  atomicJson(ledgerPath, ledger)
}

export function curriculumBudgetExhausted(config, state, entry, evaluatedGeneration = state.stable) {
  if (state.stable !== evaluatedGeneration) return false
  if (state.candidate || !(state.nextGeneration > config.maxGenerations)) return false
  const episodes = Object.values(entry?.episodes ?? {})
  return episodes.length > 0 && episodes.every(episode => episode.status === 'completed' || episode.attempts >= config.maxAttempts)
}

export async function main(argv = process.argv.slice(2)) {
  const once = argv.includes('--once')
  const stateValue = argv[argv.indexOf('--state') + 1]
  if (!argv.includes('--state') || !stateValue || !isAbsolute(stateValue)) throw new Error('Usage: curriculum.mjs --state ABSOLUTE_DIRECTORY [--once]')
  const stateDirectory = realpathSync(stateValue)
  const state = readJson(join(stateDirectory, 'state.json'))
  if (!state.curriculum?.configPath) throw new Error('initialize the supervisor with --curriculum FILE first')
  const config = loadCurriculum(state.curriculum.configPath, stateDirectory)
  const release = acquireLock(join(stateDirectory, 'curriculum'))
  const abort = new AbortController()
  const stop = () => abort.abort()
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  try {
    do {
      const current = readJson(join(stateDirectory, 'state.json'))
      if (current.status !== 'running' || abort.signal.aborted) break
      const generation = current.generations[current.stable]
      if (generation && generation.phase === 'stable') {
        const entry = await runGeneration(config, current, generation, { signal: abort.signal })
        const latest = readJson(join(stateDirectory, 'state.json'))
        await pruneCurriculum(config, latest)
        if (curriculumBudgetExhausted(config, latest, entry, generation.id)) {
          atomicJson(join(stateDirectory, 'curriculum', 'completion.json'), { reason: 'generation_budget_exhausted', generation: generation.id, sourceCommit: generation.sourceCommit, completedAt: new Date().toISOString() })
          break
        }
      }
      if (once) break
      await new Promise(resolvePromise => {
        const done = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolvePromise() }
        const timer = setTimeout(done, config.intervalMs)
        abort.signal.addEventListener('abort', done, { once: true })
      })
    } while (!abort.signal.aborted)
  } finally {
    release()
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`curriculum: ${error.message}\n`); process.exitCode = 1 })
}
