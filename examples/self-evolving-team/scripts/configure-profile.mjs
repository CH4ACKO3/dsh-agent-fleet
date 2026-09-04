import { readFile, writeFile } from 'node:fs/promises'

const packagePath = process.argv[2]
if (packagePath === undefined) throw new Error('profile package path is required')
const patchPath = process.argv[3]
if (patchPath === undefined) throw new Error('profile patch path is required')

const profile = JSON.parse(await readFile(packagePath, 'utf8'))
profile.dsh ??= {}
profile.dsh.profile ??= {}
profile.dsh.profile.bundles = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-harmony',
  'dsh-agent-fleet',
  'dsh-patchouli',
  'dsh-patchouli-native-context-service',
  'dsh-agent-fleet-patchouli',
  'dsh-llm-memorax',
  '@ch4acko3/dsh-turn-fold',
  '@ch4acko3/dsh-shiki',
  '@ch4acko3/dsh-syntax-highlight',
  '@ch4acko3/dsh-code-render',
  '@ch4acko3/dsh-mermaid-render',
  '@ch4acko3/dsh-math-render',
  '@ch4acko3/dsh-markdown-render',
  '@ch4acko3/dsh-structured-render',
  '@ch4acko3/dsh-table-render',
  '@ch4acko3/dsh-code-frame-render',
  '@ch4acko3/dsh-diff-engine',
  '@ch4acko3/dsh-diff-render',
  '@ch4acko3/dsh-ansi-render',
]

await writeFile(packagePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8')
await writeFile(patchPath, `# Container-local overrides. The internal model provider is not part of Fleet.
- id: agent-default-model
  config:
    provider: memorax
    model: deepseek-v4-flash

- id: llm-pi-ai
  config:
    providers:
      memorax:
        displayName: DeepSeek V4 Flash
        apiKeyEnv: DEEPSEEK_FLASH_API_KEY
        api: openai-responses
        baseURL: http://127.0.0.1:3082/v1
        defaultContextWindow: 393216
        defaultMaxTokens: 131072
        defaultInput: [text]
        models:
          - id: deepseek-v4-flash
            name: DeepSeek V4 Flash
            contextWindow: 393216
            maxTokens: 131072
            input: [text]
            reasoningEfforts:
              off: high
              high: high
              max: max

- id: patchouli-storage
  config:
    endpoint: /data/.patchouli/run/patchouli.sock
    providerConfigPath: /data/.patchouli/providers.json
    backendConfigPath: /data/.patchouli/config.json
    artifactRootPath: /data/.patchouli/data/artifacts
    autoStart: true
`, 'utf8')
