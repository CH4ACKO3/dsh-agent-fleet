import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

test('delegates required Provider activation to Harmony', () => {
  const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
  expect(manifest.dsh.harmony.requires).toEqual({
    'the-binding-of-dsh': '>=0.1.3 <0.2.0',
  })
  expect(readFileSync(resolve('cordis.patch.yml'), 'utf8')).not.toContain('the-binding-of-dsh')
})
