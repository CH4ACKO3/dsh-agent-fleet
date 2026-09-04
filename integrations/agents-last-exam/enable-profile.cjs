const fs = require('node:fs')

const path = process.argv[2]
if (!path) throw new Error('usage: node enable-profile.cjs <profile-package.json>')

const manifest = JSON.parse(fs.readFileSync(path, 'utf8'))
const bundles = manifest?.dsh?.profile?.bundles
if (!Array.isArray(bundles)) throw new Error(`missing dsh.profile.bundles in ${path}`)

for (const name of ['dsh-harmony', 'dsh-agent-fleet', 'the-binding-of-dsh']) {
  if (!bundles.includes(name)) bundles.push(name)
}
fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)

