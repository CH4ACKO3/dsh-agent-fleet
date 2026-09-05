import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []
const script = resolve('examples/self-evolving-team/scripts/generation-control.mjs')

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fleet-generation-control-'))
  roots.push(root)
  const control = join(root, 'control')
  const token = join(root, 'token')
  mkdirSync(join(control, 'requests'), { recursive: true })
  writeFileSync(token, randomBytes(32).toString('hex'))
  return { control, token }
}

async function waitForRequest(control: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = readdirSync(join(control, 'requests')).find(candidate => candidate.endsWith('.json'))
    if (name !== undefined) return name
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('generation-control did not submit a request')
}

function runReady(control: string, token: string) {
  const child = spawn(process.execPath, [script, 'ready', '--summary', 'verified'], {
    env: {
      ...process.env,
      SELF_EVOLVE_CONTROL_DIR: control,
      SELF_EVOLVE_CONTROL_TOKEN_FILE: token,
      SELF_EVOLVE_GENERATION: 'g0002',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const completed = new Promise<{ code: number | null, stdout: string, stderr: string }>(resolve => {
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
  return { child, completed }
}

describe('generation-control host acknowledgement', () => {
  it('does not report ready as accepted until the supervisor completes it', async () => {
    const { control, token } = fixture()
    const running = runReady(control, token)
    const name = await waitForRequest(control)
    expect(running.child.exitCode).toBeNull()
    mkdirSync(join(control, 'completed'), { recursive: true })
    renameSync(join(control, 'requests', name), join(control, 'completed', name))

    const result = await running.completed
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ accepted: true, finalized: true, type: 'candidate.ready' })
  })

  it('returns the supervisor rejection as a command failure', async () => {
    const { control, token } = fixture()
    const running = runReady(control, token)
    const name = await waitForRequest(control)
    const request = JSON.parse(readFileSync(join(control, 'requests', name), 'utf8'))
    const events = join(control, 'events', 'g0002')
    mkdirSync(events, { recursive: true })
    writeFileSync(join(events, '0000000001-rejected.json'), JSON.stringify({
      sequence: 1,
      type: 'request.rejected',
      data: { requestId: request.id, error: 'workspace must be clean' },
    }))
    mkdirSync(join(control, 'rejected'), { recursive: true })
    renameSync(join(control, 'requests', name), join(control, 'rejected', name))

    const result = await running.completed
    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('Host rejected candidate.ready')
    expect(result.stderr).toContain('workspace must be clean')
  })
})
