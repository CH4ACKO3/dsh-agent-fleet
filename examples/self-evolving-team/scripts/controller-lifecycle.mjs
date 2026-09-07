import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function settleController(operations, reason, failure = false) {
  let state = operations.readState()
  if (state.status !== 'stopped') {
    try { await operations.stopGenerations(); state = operations.readState() }
    catch { failure = true }
  }
  const phase = failure || state.status !== 'stopped' ? 'failed' : 'stopped'
  operations.writeTerminal({ phase, runStatus: state.status, reason, needsAttention: phase === 'failed' })
  await operations.park()
}

export async function main() {
  const stateDirectory = process.env.SELF_EVOLVE_STATE
  if (!stateDirectory) throw new Error('SELF_EVOLVE_STATE is required')
  mkdirSync(stateDirectory, { recursive: true })
  const statePath = join(stateDirectory, 'state.json')
  const heartbeat = join(stateDirectory, 'controller-health.json')
  const readState = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { status: 'initialization_failed' }
  if (process.argv[2] === 'health') {
    const value = existsSync(heartbeat) ? JSON.parse(readFileSync(heartbeat, 'utf8')) : undefined
    const healthy = value && Date.now() - value.updatedAt < 90000 && value.phase !== 'failed'
    process.stdout.write(`${JSON.stringify({ healthy: Boolean(healthy), phase: value?.phase ?? 'starting' })}\n`)
    process.exitCode = healthy ? 0 : 1
    return
  }
  const children = new Set()
  const shutdown = new AbortController()
  let health = { phase: 'initializing' }
  const publish = () => writeFileSync(heartbeat, JSON.stringify({ ...health, pid: process.pid, updatedAt: Date.now() }))
  const timer = setInterval(publish, 30000)
  publish()
  const terminateChildren = () => { for (const child of children) child.kill('SIGTERM') }
  const stop = () => { shutdown.abort(); terminateChildren() }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  const park = async () => {
    if (shutdown.signal.aborted) return
    await new Promise(resolvePromise => shutdown.signal.addEventListener('abort', resolvePromise, { once: true }))
  }
  function run(script, args) {
    const child = spawn(process.execPath, [join('/opt/controller/scripts', script), ...args], { stdio: 'inherit' })
    children.add(child)
    return new Promise((resolvePromise, reject) => {
      child.once('error', reject)
      child.once('close', code => { children.delete(child); code === 0 || shutdown.signal.aborted ? resolvePromise() : reject(new Error(`${script} exited ${code}`)) })
    })
  }
  const operations = {
    readState,
    stopGenerations: () => existsSync(statePath) ? run('supervisor.mjs', ['stop', '--state', stateDirectory]) : Promise.resolve(),
    writeTerminal: value => {
      health = value
      writeFileSync(join(stateDirectory, 'controller-terminal.json'), JSON.stringify({ ...value, recordedAt: new Date().toISOString() }))
      publish()
    },
    park,
  }
  try {
    if (!existsSync(statePath)) {
      const source = process.env.SELF_EVOLVE_SOURCE
      await run('supervisor.mjs', ['init', '--state', stateDirectory, '--source', source, '--ref', process.env.SELF_EVOLVE_REF ?? 'evaluation',
        '--bootstrap', join(source, 'examples/self-evolving-team/bootstrap.md'), '--curriculum', process.env.SELF_EVOLVE_CURRICULUM,
        '--build-image', process.env.SELF_EVOLVE_BUILD_IMAGE ?? 'dsh-fleet-evolution-controller:20260908',
        '--port', process.env.SELF_EVOLVE_HOST_PORT ?? '4120', '--cpus', process.env.SELF_EVOLVE_CPUS ?? '4', '--memory', process.env.SELF_EVOLVE_MEMORY ?? '8g', '--generic-runtime', '--no-serve'])
    }
    if (shutdown.signal.aborted) return
    const state = readState()
    if (state.status !== 'running') {
      await settleController(operations, `existing_${state.status}`, state.status !== 'stopped')
      return
    }
    health = { phase: 'running' }
    publish()
    const running = [run('supervisor.mjs', ['serve', '--state', stateDirectory]), run('curriculum.mjs', ['--state', stateDirectory])]
    let failure
    try { await Promise.race(running) } catch (error) { failure = error }
    finally { terminateChildren(); await Promise.allSettled(running) }
    if (shutdown.signal.aborted) return
    const completionPath = join(stateDirectory, 'curriculum', 'completion.json')
    const reason = failure?.message ?? (existsSync(completionPath) ? JSON.parse(readFileSync(completionPath, 'utf8')).reason : 'control_plane_finished')
    await settleController(operations, reason, Boolean(failure))
  } catch (error) {
    terminateChildren()
    process.stderr.write(`${error.message}\n`)
    if (!shutdown.signal.aborted) await settleController(operations, error.message, true)
  } finally {
    clearInterval(timer)
    terminateChildren()
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
  }
}
