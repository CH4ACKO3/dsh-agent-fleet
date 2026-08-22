import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specifications = [
  ['coding-small', '小型开发团队', 'Small development Team', 'coding-small.json'],
  ['coding-medium', '中型开发团队', 'Medium development Team', 'coding-medium.json'],
  ['coding-large', '大型开发团队', 'Large development Team', 'coding-large.json'],
  ['research-full', '完整科研团队', 'Complete research Team', 'research.json'],
]

const templates = await Promise.all(specifications.map(async ([id, nameZh, nameEn, file]) => ({
  id,
  nameZh,
  nameEn,
  configuration: {
    en: JSON.parse(await readFile(resolve(root, 'examples/frontal-team/teams', file), 'utf8')),
    zh: JSON.parse(await readFile(resolve(root, 'examples/frontal-team/teams/zh-CN', file), 'utf8')),
  },
})))

const target = resolve(root, 'packages/ui/src/team-templates.generated.ts')
await mkdir(dirname(target), { recursive: true })
await writeFile(
  target,
  `// Generated from examples/frontal-team/teams by scripts/generate-team-templates.mjs.\n`
    + `export const FULL_TEAM_TEMPLATES = ${JSON.stringify(templates, null, 2)} as const\n`,
)
