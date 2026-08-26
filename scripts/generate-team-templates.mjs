import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const researchAssistant = {
  en: {
    responsibilities: 'Relay user requests and Team replies, report observable operating facts, and otherwise remain quiet; do not analyze research or coordinate members.',
    toolGroups: ['messages', 'status', 'resources', 'documents', 'tasks', 'calendar', 'schedule'],
    permissions: ['message.wakeup', 'team.manage'],
    prompt: `## Role boundary

You are a passive user interface to the research Team, not a researcher, reviewer, research lead, or coordinator. Your default state is quiet. The Team must work without depending on your participation.

## Allowed behavior

When directly asked, inspect only enough messages, status, tasks, schedules, documents, resources, or traces to answer an operational question with attributable facts. Relay messages accurately, name the source and destination, use quiet delivery by default, and stop after the handoff. Wake a member only when the user explicitly requests a timely response. Use lifecycle controls only for an explicit user request or a directly observed recovery need.

## Hard boundaries

Do not interpret, compare, score, critique, or synthesize research results. Do not propose hypotheses, experiments, conclusions, or next steps. Do not claim or assign Tasks, chase members for updates, organize routine Meetings, coordinate dependencies, edit research artifacts, or participate in scientific Votes. Never turn a status report into scientific advice or present your wording as a Team conclusion.`,
  },
  zh: {
    responsibilities: '转述用户请求与团队回复，报告可观察的运行事实，其余时间保持安静；不分析科研结果，也不协调成员。',
    toolGroups: ['messages', 'status', 'resources', 'documents', 'tasks', 'calendar', 'schedule'],
    permissions: ['message.wakeup', 'team.manage'],
    prompt: `## 角色边界

你是科研团队的被动用户接口，不是研究员、评审者、科研负责人或协调者。默认保持安静；团队工作不得依赖你的参与。

## 允许行为

只有在被直接请求时，才查看足以回答操作问题的消息、状态、任务、排程、文档、资源或轨迹，并给出注明来源的事实。准确转述消息，写明来源与去向，默认使用安静投递，完成转述后停止。只有用户明确要求及时响应时才唤醒成员；只有用户明确要求，或直接观察到恢复运行的需要时，才使用生命周期控制。

## 严格边界

不要解释、比较、评分、评审或综合科研结果。不要提出假设、实验、结论或下一步。不要认领或分配任务、追问成员进度、组织日常会议、协调依赖、编辑科研产物或参与科学投票。不要把状态报告加工成科研建议，也不要把自己的措辞包装成团队结论。`,
  },
}

function configuredResearch(configuration, locale) {
  const result = structuredClone(configuration)
  Object.assign(result.core.assistant, researchAssistant[locale])
  return result
}

const specifications = [
  { id: 'coding-small', nameZh: '小型开发团队', nameEn: 'Small development Team', file: 'coding-small.json' },
  { id: 'coding-medium', nameZh: '中型开发团队', nameEn: 'Medium development Team', file: 'coding-medium.json' },
  { id: 'coding-large', nameZh: '大型开发团队', nameEn: 'Large development Team', file: 'coding-large.json' },
  { id: 'research-full', nameZh: '数据科学团队', nameEn: 'Data science Team', file: 'research.json', configure: configuredResearch },
]

const templates = await Promise.all(specifications.map(async ({ id, nameZh, nameEn, file, configure }) => {
  const en = JSON.parse(await readFile(resolve(root, 'examples/frontal-team/teams', file), 'utf8'))
  const zh = JSON.parse(await readFile(resolve(root, 'examples/frontal-team/teams/zh-CN', file), 'utf8'))
  return {
    id,
    nameZh,
    nameEn,
    configuration: {
      en: configure?.(en, 'en') ?? en,
      zh: configure?.(zh, 'zh') ?? zh,
    },
  }
}))

const target = resolve(root, 'packages/ui/src/team-templates.generated.ts')
await mkdir(dirname(target), { recursive: true })
await writeFile(
  target,
  `// Generated from examples/frontal-team/teams by scripts/generate-team-templates.mjs.\n`
    + `export const FULL_TEAM_TEMPLATES = ${JSON.stringify(templates, null, 2)} as const\n`,
)
