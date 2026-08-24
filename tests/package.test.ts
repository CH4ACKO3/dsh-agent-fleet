import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

test('installs and activates required Harmony Providers', () => {
  const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  expect(manifest.dsh.harmony.requires).toEqual({
    'the-binding-of-dsh': '>=0.1.2 <0.2.0',
  })
  expect(manifest.dsh.plugin.compatibility.requires).toEqual({
    'dsh-harmony': '>=0.8.1 <0.9.0',
    'the-binding-of-dsh': '>=0.1.2 <0.2.0',
  })
  expect(manifest.dependencies['dsh-harmony']).toBe('>=0.8.1 <0.9.0')
  expect(manifest.dependencies['the-binding-of-dsh']).toBe('>=0.1.2 <0.2.0')
  expect(manifest.peerDependencies?.['the-binding-of-dsh']).toBeUndefined()
  expect(readFileSync(resolve('cordis.patch.yml'), 'utf8')).not.toContain('the-binding-of-dsh')
})
