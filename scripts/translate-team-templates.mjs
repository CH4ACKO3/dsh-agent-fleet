import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = resolve(root, 'examples/frontal-team/teams')
const targetDirectory = resolve(sourceDirectory, 'zh-CN')
const files = ['coding-small.json', 'coding-medium.json', 'coding-large.json', 'research.json']
const validateOnly = process.argv.includes('--validate-only')
const apiKey = process.env.DEEPSEEK_API_KEY
const baseUrl = process.env.DEEPSEEK_BASE_URL?.replace(/\/$/, '')

if (!validateOnly && (apiKey === undefined || baseUrl === undefined)) {
  throw new Error('DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL are required')
}

function validateTranslation(source, translated, file) {
  const sameShape = (left, right, path = '$') => {
    if (Array.isArray(left)) {
      if (!Array.isArray(right) || right.length !== left.length) {
        throw new Error(`${file}: translated structure changed at ${path}`)
      }
      left.forEach((item, index) => sameShape(item, right[index], `${path}[${index}]`))
      return
    }
    if (typeof left === 'object' && left !== null) {
      if (typeof right !== 'object' || right === null || Array.isArray(right)
        || JSON.stringify(Object.keys(right)) !== JSON.stringify(Object.keys(left))) {
        throw new Error(`${file}: translated structure changed at ${path}`)
      }
      for (const key of Object.keys(left)) sameShape(left[key], right[key], `${path}.${key}`)
    }
  }
  sameShape(source, translated)
  if (!Array.isArray(translated.core.members) || translated.core.members.length !== source.core.members.length) {
    throw new Error(`${file}: translated member count changed`)
  }
  const sourceIds = source.core.members.map(member => member.id)
  const translatedIds = translated.core.members.map(member => member.id)
  if (JSON.stringify(sourceIds) !== JSON.stringify(translatedIds)) {
    throw new Error(`${file}: translated member ids changed`)
  }
  for (const member of translated.core.members) {
    if (typeof member.prompt !== 'string' || !/[\u3400-\u9fff]/u.test(member.prompt)) {
      throw new Error(`${file}: member ${member.id} has no Chinese prompt`)
    }
  }
  const machineValues = configuration => ({
    channelId: configuration.modules['dsh-agent-fleet/message'].defaultChannel.id,
    sharedResources: configuration.modules['dsh-agent-fleet/resources'].items,
    updateDensity: configuration.modules['dsh-agent-fleet/ui'].userAccess.updateDensity,
    notificationPolicy: configuration.modules['dsh-agent-fleet/ui'].userAccess.notificationPolicy,
    presetSelections: configuration.modules['dsh-agent-fleet/ui'].editor.presetSelections,
    members: configuration.core.members.map(member => ({
      id: member.id,
      color: member.color,
      provider: member.provider,
      model: member.model,
    })),
  })
  if (JSON.stringify(machineValues(source)) !== JSON.stringify(machineValues(translated))) {
    throw new Error(`${file}: translated machine values changed`)
  }
}

await mkdir(targetDirectory, { recursive: true })
for (const file of files) {
  const source = JSON.parse(await readFile(resolve(sourceDirectory, file), 'utf8'))
  if (validateOnly) {
    const translated = JSON.parse(await readFile(resolve(targetDirectory, file), 'utf8'))
    validateTranslation(source, translated, file)
    process.stdout.write(`validated ${file}\n`)
    continue
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a precise software localization translator. Return only valid JSON.',
        },
        {
          role: 'user',
          content: `Translate this Fleet Team configuration into natural Simplified Chinese without summarizing, deleting, weakening, or adding instructions. Preserve the complete JSON structure, module ids, arrays, Markdown structure, member order, and every non-human identifier or machine value. Keep ids, defaultChannel.id, colors, provider, model, updateDensity, notificationPolicy, preset selection ids, file paths, tool names, API field names, and protocol terms unchanged. Translate human-readable Team names, channel names, positioning, rules, collaboration and resource policies, content preferences, member names when they are role titles, roles, responsibilities, and every member prompt. Keep product terms Fleet, Team, Agent, Channel, Meeting, Vote, Driver, Session, and Front Desk in English when used as protocol concepts.\n\n${JSON.stringify(source)}`,
        },
      ],
    }),
  })
  if (!response.ok) throw new Error(`${file}: translation request failed (${response.status})`)
  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error(`${file}: translation response has no content`)
  const translated = JSON.parse(content)
  validateTranslation(source, translated, file)
  await writeFile(resolve(targetDirectory, file), `${JSON.stringify(translated, null, 2)}\n`)
  process.stdout.write(`translated ${file}\n`)
}
