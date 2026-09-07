#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const stateDirectory = process.env.SELF_EVOLVE_STATE
if (!stateDirectory) throw new Error('SELF_EVOLVE_STATE is required')
const statePath = join(stateDirectory, 'state.json')
const heartbeat = join(stateDirectory, 'controller-health.json')
if (process.argv[2] === 'health') {
  const healthy = existsSync(heartbeat) && Date.now() - JSON.parse(readFileSync(heartbeat, 'utf8')).updatedAt < 90000
  process.exit(healthy ? 0 : 1)
}
const children = new Set()
let stopping = false
function run(script, args) {
  const child = spawn(process.execPath, [join('/opt/controller/scripts', script), ...args], { stdio: 'inherit' })
  children.add(child)
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => { children.delete(child); code === 0 || stopping ? resolve() : reject(new Error(`${script} exited ${code}`)) })
  })
}
function stop() { stopping = true; for (const child of children) child.kill('SIGTERM') }
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
try {
  if (!existsSync(statePath)) {
    const source = process.env.SELF_EVOLVE_SOURCE
    await run('supervisor.mjs', ['init', '--state', stateDirectory, '--source', source, '--ref', process.env.SELF_EVOLVE_REF ?? 'evaluation',
      '--bootstrap', join(source, 'examples/self-evolving-team/bootstrap.md'), '--curriculum', process.env.SELF_EVOLVE_CURRICULUM,
      '--build-image', process.env.SELF_EVOLVE_BUILD_IMAGE ?? 'dsh-fleet-evolution-controller:20260908',
      '--port', process.env.SELF_EVOLVE_HOST_PORT ?? '4120', '--cpus', process.env.SELF_EVOLVE_CPUS ?? '4', '--memory', process.env.SELF_EVOLVE_MEMORY ?? '8g', '--generic-runtime', '--no-serve'])
  }
  if (!stopping) {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    if (state.status !== 'running') throw new Error(`Run is ${state.status}; inspect it before resuming`)
    const timer = setInterval(() => writeFileSync(heartbeat, JSON.stringify({ pid: process.pid, updatedAt: Date.now() })), 30000)
    writeFileSync(heartbeat, JSON.stringify({ pid: process.pid, updatedAt: Date.now() }))
    try {
      // If either control plane fails, terminate the other and let Compose restart both.
      await Promise.race([run('supervisor.mjs', ['serve', '--state', stateDirectory]), run('curriculum.mjs', ['--state', stateDirectory])])
    } finally { clearInterval(timer); stop() }
  }
} catch (error) { stop(); process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
