import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the evaluation distribution replaces the stock single-Agent runner', () => {
  const patch = readFileSync(new URL('./headless.patch.yml', import.meta.url), 'utf8')
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(patch, /id: headless-runner/)
  assert.match(patch, /disabled: true/)
  assert.match(patch, /name: dsh-agent-fleet\/evaluation/)
  assert.ok(manifest.files.includes('evaluation/**/*.yml'))
})

test('the ALE adapter delegates lifecycle completion to the host runner', () => {
  const deployer = readFileSync(new URL('../integrations/agents-last-exam/dsh_fleet/deployer.py', import.meta.url), 'utf8')
  assert.match(deployer, /FLEET_EVAL_TEAM_CONFIG/)
  assert.match(deployer, /FLEET_EVAL_TIMEOUT_MS/)
  assert.doesNotMatch(deployer, /fleet_run wait|_launcher_prompt/)
})
