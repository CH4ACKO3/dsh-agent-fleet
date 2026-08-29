import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

test('installs and activates required Harmony Providers', () => {
  const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  expect(manifest.dsh.harmony.requires).toEqual({
    'the-binding-of-dsh': '>=0.1.7 <0.2.0',
  })
  expect(manifest.dsh.plugin.compatibility.requires).toEqual({
    'dsh-harmony': '>=0.8.8 <0.9.0',
    'the-binding-of-dsh': '>=0.1.7 <0.2.0',
  })
  expect(manifest.dependencies['dsh-harmony']).toBe('>=0.8.8 <0.9.0')
  expect(manifest.dependencies['the-binding-of-dsh']).toBe('>=0.1.7 <0.2.0')
  expect(manifest.peerDependencies?.['the-binding-of-dsh']).toBeUndefined()
  expect(readFileSync(resolve('cordis.patch.yml'), 'utf8')).not.toContain('the-binding-of-dsh')
})

test('bundles browser-only dependencies into the published client module', () => {
  const client = readFileSync(resolve('lib/client.js'), 'utf8')

  expect(client).not.toContain('require("zod")')
  expect(client).toContain('node_modules/zod/')
})

test('passes native new-Session workspace readiness into the Fleet Hero entry', () => {
  const patch = readFileSync(resolve('harmony/hero-team-entry.cjs'), 'utf8')

  expect(patch).toContain('renderSlot("conversation.hero.agentPreset", { sessionId, workspaceSelected: chipTitle !== void 0 })')
})

test('uses native assistant chat while retaining Fleet composer commands and cost usage', () => {
  const panel = readFileSync(resolve('packages/ui/src/team-panel.ts'), 'utf8')
  const entry = readFileSync(resolve('packages/ui/src/index.ts'), 'utf8')

  expect(panel).toContain('const FLEET_ASSISTANT_PRIVATE_CHAT_ENABLED = false')
  expect(panel).toContain('(!fleetAssistant || !FLEET_ASSISTANT_PRIVATE_CHAT_ENABLED)')
  expect(entry).not.toContain('sendFleetAssistantMailboxMessage')
  expect(entry).not.toContain('assistantSending')
  expect(entry).not.toContain('setAssistantSending')
  expect(entry).toContain('inputActions.submit()')
  expect(entry).toContain('disabled: teamArchived')
  expect(entry).toContain('fleetPrivateConversationCommands(')
  expect(entry).toContain('usageMeter: jsx(FleetBudgetMeter')
})
