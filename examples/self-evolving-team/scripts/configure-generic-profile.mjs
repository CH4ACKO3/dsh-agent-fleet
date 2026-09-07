import { readFileSync, writeFileSync } from 'node:fs'

const [packagePath, patchPath] = process.argv.slice(2)
if (!packagePath || !patchPath) throw new Error('profile package and patch paths are required')
const profile = JSON.parse(readFileSync(packagePath, 'utf8'))
profile.dsh ??= {}
profile.dsh.profile ??= {}
profile.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-harmony', 'dsh-agent-fleet', 'dsh-patchouli', 'dsh-patchouli-native-context-service', 'dsh-agent-fleet-patchouli']
const provider = process.env.FLEET_MODEL_PROVIDER ?? 'deepseek'
const model = process.env.FLEET_MODEL_NAME ?? 'deepseek-chat'
const api = process.env.FLEET_MODEL_API ?? 'openai-completions'
const baseURL = process.env.FLEET_MODEL_BASE_URL ?? 'https://api.deepseek.com/v1'
const apiKeyEnv = process.env.FLEET_MODEL_API_KEY_ENV ?? 'DEEPSEEK_API_KEY'
// JSON is valid YAML; escaping is exact and credential values are never serialized.
const patch = [
  { id: 'agent-default-model', config: { provider, model } },
  { id: 'llm-pi-ai', config: { providers: { [provider]: { displayName: provider, apiKeyEnv, api, baseURL, models: [{ id: model, name: model, contextWindow: 131072, maxTokens: 32768, input: ['text'] }] } } } },
  { id: 'patchouli-storage', config: { endpoint: '/data/.patchouli/run/patchouli.sock', artifactRootPath: '/data/.patchouli/data/artifacts', autoStart: true } },
]
writeFileSync(packagePath, `${JSON.stringify(profile, null, 2)}\n`)
writeFileSync(patchPath, `${JSON.stringify(patch, null, 2)}\n`)
