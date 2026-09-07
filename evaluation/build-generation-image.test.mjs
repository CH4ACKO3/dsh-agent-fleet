import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGeneration, buildPlan, parseArguments } from './build-generation-image.mjs'

const sha = 'a'.repeat(40)
const options = parseArguments(['--source', '.', '--commit', sha, '--benchmark', 'horizonmath', '--image', `fixture:${sha}`])
test('the trusted build plan rebuilds common Fleet, ALE native runtime, then HorizonMath', () => {
  const plan = buildPlan(options)
  assert.equal(plan.length, 3)
  assert.match(plan[0].file, /evaluation[\\/]runtime.Dockerfile$/)
  assert.ok(plan[1].args.includes(`FLEET_IMAGE=dsh-fleet-generation-common:${sha}`))
  assert.ok(plan[2].args.includes(`FLEET_IMAGE=dsh-fleet-generation-ale:${sha}`))
  assert.equal(buildPlan({ ...options, benchmark: 'ale' }).length, 2)
})
test('source mismatch is rejected before touching Docker', () => {
  const commands = []
  assert.throws(() => buildGeneration(options, (command, args) => { commands.push([command, args]); return 'b'.repeat(40) }), /source HEAD mismatch/)
  assert.equal(commands.length, 1)
  assert.equal(commands[0][0], 'git')
})
test('every stage builds the requested source and rejects mismatched resulting image labels', () => {
  const commands = []
  const run = (command, args) => {
    commands.push([command, args])
    if (command === 'git') return sha
    if (args[0] === 'build') return ''
    return JSON.stringify([{ Id: 'old-image', Config: { Labels: { 'org.opencontainers.image.revision': 'wrong' } } }])
  }
  assert.throws(() => buildGeneration(options, run), /built image revision mismatch/)
  const build = commands.find(([, args]) => args[0] === 'build')[1]
  assert.equal(build.at(-1), options.source)
  assert.ok(build.includes(`org.opencontainers.image.revision=${sha}`))
})
