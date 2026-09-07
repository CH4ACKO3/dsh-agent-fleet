// Run with node --test; keep outside the root Vitest tests directory.
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLock, atomicJson, loadCurriculum, pruneCurriculum, runGeneration, sampleTasks } from '../examples/self-evolving-team/scripts/curriculum.mjs'
import { waitForTraining } from '../examples/self-evolving-team/scripts/training-feedback.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fleet-curriculum-'))
  roots.push(root)
  const stateDirectory = join(root, 'state')
  const workspace = join(stateDirectory, 'generations', 'g0001', 'workspace')
  mkdirSync(workspace, { recursive: true })
  const tasks = ['train', 'validation', 'test'].flatMap(split => ['math', 'software'].flatMap(domain => Array.from({ length: 3 }, (_, index) => ({ id: `${split}-${domain}-${index}`, split, domain }))))
  const manifest = join(root, 'manifest.json')
  atomicJson(manifest, { tasks })
  const configPath = join(root, 'config.json')
  atomicJson(configPath, { schemaVersion: 1, seed: 'fixed-seed', validationEvery: 1, testEvery: 1, samplePerBenchmark: 2, benchmarks: [{ id: 'mixed', manifest, command: ['fake-runner', '{job}'] }] })
  const config = loadCurriculum(configPath, stateDirectory)
  return { root, stateDirectory, workspace, manifest, configPath, config, tasks }
}

test('sampling is reproducible, balanced across domains, and disjoint across splits', () => {
  const { config } = fixture()
  assert.deepEqual(sampleTasks(config, 1, 'train'), sampleTasks(config, 1, 'train'))
  const selected = sampleTasks(config, 1, 'train')
  assert.equal(new Set(selected.map(entry => entry.task.domain)).size, 2)
  const train = new Set(selected.map(entry => entry.task.id))
  for (const split of ['validation', 'test']) for (const { task } of sampleTasks(config, 1, split)) assert.equal(train.has(task.id), false)
  assert.notDeepEqual(sampleTasks(config, 1, 'train'), sampleTasks(config, 2, 'train'))
})

test('duplicate problem families cannot cross explicit split boundaries', () => {
  const f = fixture()
  f.tasks[0].group = 'same-problem'
  f.tasks[6].group = 'same-problem'
  atomicJson(f.manifest, { tasks: f.tasks })
  assert.throws(() => loadCurriculum(f.configPath, f.stateDirectory), /data leakage/)
})

test('empty heldout partitions fail closed instead of silently reporting no evaluation', () => {
  const f = fixture()
  atomicJson(f.manifest, { tasks: f.tasks.filter(task => task.split !== 'test') })
  assert.throws(() => loadCurriculum(f.configPath, f.stateDirectory), /test is empty/)
})

test('task byte changes invalidate the seal and different groups cannot disguise duplicate prompts', () => {
  const f = fixture()
  const prompt = join(f.root, 'prompt.md')
  writeFileSync(prompt, 'original problem')
  f.tasks[0].task = prompt
  f.tasks[0].group = 'variant-a'
  atomicJson(f.manifest, { tasks: f.tasks })
  const before = loadCurriculum(f.configPath, f.stateDirectory).configDigest
  writeFileSync(prompt, 'modified problem')
  assert.notEqual(loadCurriculum(f.configPath, f.stateDirectory).configDigest, before)
  f.tasks[6].task = prompt
  f.tasks[6].group = 'variant-b'
  atomicJson(f.manifest, { tasks: f.tasks })
  assert.throws(() => loadCurriculum(f.configPath, f.stateDirectory), /data leakage/)
})

test('concurrent runners cannot acquire the same state lock', () => {
  const { root } = fixture()
  const release = acquireLock(root)
  assert.throws(() => acquireLock(root), /already running/)
  release()
  acquireLock(root)()
})

async function evaluatedFixture(f) {
  const repo = join(f.root, 'repo')
  mkdirSync(repo)
  const git = args => execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  git(['init'])
  git(['config', 'user.name', 'Test'])
  git(['config', 'user.email', 'test@local'])
  writeFileSync(join(repo, 'source.txt'), 'frozen')
  git(['add', '.'])
  git(['commit', '-m', 'fixture'])
  const generation = { id: 'g0001', number: 1, sourceCommit: git(['rev-parse', 'HEAD']), workspace: f.workspace }
  const state = { stateDirectory: f.stateDirectory, repository: repo }
  let calls = 0
  const execute = async argv => {
    if (argv[0] === 'git') { execFileSync(argv[0], argv.slice(1), { stdio: 'ignore' }); return }
    calls += 1
    const job = JSON.parse(readFileSync(argv[1], 'utf8'))
    assert.equal(job.sourceCommit, generation.sourceCommit)
    assert.equal(readFileSync(join(job.sourceWorkspace, 'source.txt'), 'utf8'), 'frozen')
    mkdirSync(join(job.output, 'results'), { recursive: true })
    writeFileSync(join(job.output, 'results', 'answer.txt'), job.split === 'train' ? 'training solution' : 'RAW-SEALED-ANSWER')
    atomicJson(join(job.output, 'result.json'), { status: 'completed', taskId: job.task.id, split: job.split, sourceCommit: job.sourceCommit, score: job.split === 'train' ? 0.5 : 0.125, feedback: job.split === 'train' ? 'training-analysis' : 'SEALED-ANSWER', internalSecret: 'NEVER-EXPORT', output: job.output })
  }
  return { state, generation, execute, calls: () => calls }
}

test('only allowlisted training feedback is exported; restart reuses completed episodes', async () => {
  const f = fixture()
  const run = await evaluatedFixture(f)
  await runGeneration(f.config, run.state, run.generation, { execute: run.execute })
  assert.equal(run.calls(), 6)
  const exported = readFileSync(join(f.stateDirectory, 'curriculum-feedback/g0001/feedback.json'), 'utf8')
  assert.match(exported, /training-analysis/)
  assert.doesNotMatch(exported, /SEALED-ANSWER|NEVER-EXPORT|validation|"test"/)
  const exportRoot = join(f.stateDirectory, 'curriculum-feedback/g0001')
  const evidence = readdirSync(join(exportRoot, 'episodes')).map(directory => readFileSync(join(exportRoot, 'episodes', directory, 'answer.txt'), 'utf8'))
  assert.deepEqual(evidence, ['training solution', 'training solution'])
  assert.equal(existsSync(join(f.workspace, '.self-evolve/training/feedback.json')), false)
  const ledger = readFileSync(join(f.stateDirectory, 'curriculum/ledger.json'), 'utf8')
  assert.match(ledger, /SEALED-ANSWER/)
  await runGeneration(f.config, run.state, run.generation, { execute: run.execute })
  assert.equal(run.calls(), 6)
  const changed = { ...f.config, configDigest: 'modified-config' }
  await assert.rejects(runGeneration(changed, run.state, run.generation, { execute: run.execute }), /configuration or manifests changed/)
})

test('ungraded outputs cannot unlock training or masquerade as benchmark success', async () => {
  const f = fixture()
  const run = await evaluatedFixture(f)
  const execute = async argv => {
    if (argv[0] === 'git') return run.execute(argv)
    const job = JSON.parse(readFileSync(argv[1], 'utf8'))
    atomicJson(join(job.output, 'result.json'), { status: 'completed', score: null, feedback: 'judge unavailable' })
  }
  const entry = await runGeneration(f.config, run.state, run.generation, { execute })
  assert.equal(entry.trainingComplete, false)
  assert.equal(JSON.parse(readFileSync(join(f.stateDirectory, 'curriculum-feedback/g0001/feedback.json'), 'utf8')).status, 'failed')
})

test('training wait handles existing and atomically delivered feedback with generation binding', async () => {
  const { workspace } = fixture()
  const root = join(workspace, '.self-evolve')
  atomicJson(join(root, 'generation.json'), { id: 'g0001', sourceCommit: 'abc' })
  atomicJson(join(root, 'training/feedback.json'), { generation: 'g0000', sourceCommit: 'abc', status: 'completed' })
  const pending = waitForTraining(root, 2000, join(root, 'training'))
  setTimeout(() => atomicJson(join(root, 'training/feedback.json'), { generation: 'g0001', sourceCommit: 'abc', status: 'completed', episodes: [] }), 20)
  assert.equal((await pending).generation, 'g0001')
  assert.equal((await waitForTraining(root, 2000, join(root, 'training'))).sourceCommit, 'abc')
  assert.equal(existsSync(join(root, 'training/feedback.json')), true)
})

test('a reused PID after controller restart does not preserve a stale lock', () => {
  const { root } = fixture()
  const release = acquireLock(root)
  const path = join(root, 'runner.lock')
  const previous = JSON.parse(readFileSync(path, 'utf8'))
  atomicJson(path, { ...previous, processBirth: 'old-process-start-time' })
  const releaseReplacement = acquireLock(root)
  release()
  assert.equal(existsSync(path), true)
  releaseReplacement()
})

test('changing task bytes after configuration load is detected before running a generation', async () => {
  const f = fixture()
  const prompt = join(f.root, 'task.md')
  writeFileSync(prompt, 'sealed problem')
  f.tasks[0].task = prompt
  atomicJson(f.manifest, { tasks: f.tasks })
  const config = loadCurriculum(f.configPath, f.stateDirectory)
  writeFileSync(prompt, 'changed problem')
  await assert.rejects(runGeneration(config, { stateDirectory: f.stateDirectory }, { id: 'g0001' }), /sealed dataset changed/)
})

test('retention removes only recorded retired snapshots and built images, keeping sealed evidence', async () => {
  const f = fixture()
  const root = join(f.stateDirectory, 'curriculum')
  for (const id of ['g0001', 'g0002', 'g0003']) mkdirSync(join(root, 'snapshots', id), { recursive: true })
  atomicJson(join(root, 'episodes', 'g0001', 'sealed.json'), { score: 0.5 })
  atomicJson(join(root, 'ledger.json'), { generations: Object.fromEntries(['g0001', 'g0002', 'g0003'].map(id => [id, { finishedAt: 'today', images: { benchmark: `managed:${id}` } }])) })
  const commands = []
  await pruneCurriculum({ retainGenerations: 1 }, { stateDirectory: f.stateDirectory, stable: 'g0003', guardian: 'g0002' }, async argv => { commands.push(argv) })
  assert.deepEqual(commands, [['docker', 'image', 'rm', 'managed:g0001']])
  assert.equal(existsSync(join(root, 'snapshots/g0001')), false)
  assert.equal(existsSync(join(root, 'snapshots/g0002')), true)
  assert.equal(existsSync(join(root, 'episodes/g0001/sealed.json')), true)
})
