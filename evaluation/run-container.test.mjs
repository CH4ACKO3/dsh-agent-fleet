import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dockerArguments, executeContainer, parseArguments, prepareDirectories } from './run-container.mjs'

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

test('invalid limits and inline environment values fail before Docker starts', () => {
  const base = ['--task', 'task.md', '--run-root', 'run']
  for (const extra of [
    ['--cpus', '0'], ['--cpus', 'Infinity'], ['--memory', '0'],
    ['--timeout-ms', '-1'], ['--timeout-ms', '1.5'], ['--grace-ms', '-1'],
    ['--timeout-ms', '2147483648'], ['--env', 'TOKEN=do-not-log-values'],
    ['--workspace', 'same', '--results', 'same'],
  ]) assert.throws(() => parseArguments([...base, ...extra]))
})

test('the host deadline kills a stuck runtime and cleans only its recorded container ID', async () => {
  const options = parseArguments(['--task', 'task.md', '--run-root', 'run', '--timeout-ms', '400', '--grace-ms', '0'])
  const id = 'a'.repeat(64)
  const removals = []
  let cidFile
  const code = await executeContainer(options, {
    spawn(_command, args) {
      cidFile = args[args.indexOf('--cidfile') + 1]
      return spawn(process.execPath, ['-e',
        'require("node:fs").writeFileSync(process.argv[1], process.argv[2]); setInterval(() => {}, 1000)',
        cidFile, id], { stdio: 'ignore' })
    },
    spawnSync(command, args) { removals.push([command, ...args]); return { status: 0 } },
  })
  assert.equal(code, 124)
  assert.ok(removals.length > 0)
  assert.ok(removals.every(args => args.join(' ') === `docker rm --force ${id}`))
  assert.equal(existsSync(cidFile), false)
})

test('a name conflict cannot delete a preexisting container', async () => {
  const options = parseArguments(['--task', 'task.md', '--run-root', 'run', '--name', 'existing-service'])
  const code = await executeContainer(options, {
    spawn() { return spawn(process.execPath, ['-e', 'process.exit(125)'], { stdio: 'ignore' }) },
    spawnSync(_command, args) {
      assert.equal(args[0], 'ps', 'no owned container may be deleted')
      assert.ok(args.at(-1).startsWith('label=io.deepseek-harness.evaluation.invocation='))
      return { status: 0, stdout: '' }
    },
  })
  assert.equal(code, 125)
})

test('successful debug runs retain their container and return its exit code', async () => {
  const options = parseArguments(['--task', 'task.md', '--run-root', 'run', '--keep-container'])
  const code = await executeContainer(options, {
    spawn() { return spawn(process.execPath, ['-e', 'process.exit(2)'], { stdio: 'ignore' }) },
    spawnSync() { assert.fail('debug container must be retained') },
  })
  assert.equal(code, 2)
})

test('cleanup recovers a container created before its cidfile using an invocation label', async () => {
  const options = parseArguments(['--task', 'task.md', '--run-root', 'run'])
  const id = 'b'.repeat(64)
  let ownership
  const removals = []
  const code = await executeContainer(options, {
    spawn(_command, args) {
      ownership = args.find(value => value.startsWith('io.deepseek-harness.evaluation.invocation='))
      return spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
    },
    spawnSync(_command, args) {
      if (args[0] === 'ps') {
        assert.equal(args.at(-1), `label=${ownership}`)
        return { status: 0, stdout: id }
      }
      removals.push(args)
      return { status: 0 }
    },
  })
  assert.equal(code, 0)
  assert.deepEqual(removals, [['rm', '--force', id]])
})

test('unverified cleanup is not reported as successful completion', async () => {
  const options = parseArguments(['--task', 'task.md', '--run-root', 'run'])
  const code = await executeContainer(options, {
    spawn() { return spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }) },
    spawnSync() { return { status: 1, stderr: 'daemon unavailable' } },
  })
  assert.equal(code, 125)
})

test('Linux managed mounts are writable behind a private parent', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-mount-permissions-'))
  try {
    const options = parseArguments(['--task', 'task.md', '--run-root', join(root, 'episode')])
    prepareDirectories(options)
    assert.equal(statSync(options.runRoot).mode & 0o777, 0o700)
    assert.equal(statSync(options.workspace).mode & 0o777, 0o777)
    assert.equal(statSync(options.results).mode & 0o777, 0o777)
    chmodSync(options.runRoot, 0o755)
    assert.throws(() => prepareDirectories(options), /must be private/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('Linux generated mounts cannot change permissions through a symlink', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-mount-symlink-'))
  try {
    const options = parseArguments(['--task', 'task.md', '--run-root', root])
    symlinkSync(tmpdir(), options.workspace, 'dir')
    assert.throws(() => prepareDirectories(options), /cannot be symlinks/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
