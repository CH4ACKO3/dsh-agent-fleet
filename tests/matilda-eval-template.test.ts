import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface TeamMember {
  id: string
  prompt: string
  provider: string
  model: string
}

interface MatildaTeamConfig {
  core: {
    assistant: { prompt: string; provider: string; model: string }
    members: TeamMember[]
  }
  modules: {
    'dsh-agent-fleet/message': { collaborationMethod: string; rules: string }
    'dsh-agent-fleet/resources': { policy: string }
    'dsh-agent-fleet/ui': {
      editor: { rules: string }
    }
  }
}

const config = JSON.parse(
  readFileSync(resolve('examples/matilda-eval/team.local.json'), 'utf8'),
) as MatildaTeamConfig

describe('Matilda blind evaluation Team template', () => {
  it('lets the assistant derive the topology while requiring durable links', () => {
    const prompt = config.core.assistant.prompt

    expect(prompt).toContain('Do not call `todo_write`')
    expect(prompt).toContain('call `fleet_run start` immediately without visible narration')
    expect(prompt).toContain('no mandatory stage names, lane count, algorithm, or round count')
    expect(prompt).toContain('Activate a member only for a concrete deliverable')
    expect(prompt).toContain('Set `result_stage` to a dedicated packaging Goal')
    expect(prompt).toContain('never use an independent evidence lane as `result_stage`')
    expect(prompt).toContain('long work retains a formal continuation or recovery path')
    expect(prompt).toContain('keep at least one evidence-driven continuation')
    expect(prompt).toContain('Files created or changed during the run appear automatically in Team files')
    expect(prompt).toContain('Preserve every authoritative quantifier and acceptance condition')
    expect(prompt).toContain('A Task entering a terminal state proves workflow settlement')
    expect(prompt).toContain('copy the exact `budget.team` counters')
    expect(prompt).not.toContain('adaptive-refinement Goal')
    expect(prompt).not.toContain('globally decide the immediately adjacent value')
    expect(prompt).not.toContain('every configured formal member exactly one independent zero-dependency first-pass Goal')
    expect(prompt).not.toMatch(/mod 17|LIS|LDS|\b21\b|\b22\b/)
  })

  it('keeps packaging and independent acceptance separate without fixing their owners', () => {
    const assistantPrompt = config.core.assistant.prompt
    const auditor = config.core.members.find(member => member.id === 'adversarial-reproducer')

    expect(assistantPrompt).toContain('No member approves its own unchecked package')
    expect(assistantPrompt).toContain('Choose owners and voters from the actual roster')
    expect(auditor?.prompt).toContain('full authoritative task')
    expect(auditor?.prompt).toContain('return REJECT or INDETERMINATE')
    expect(auditor?.prompt).toContain('APPROVE only the complete requested claim')
    expect(auditor?.prompt).toContain('Never silently repair a producer\'s artifact')
    expect(auditor?.prompt).toContain('not merely the producer\'s narrowed claim')
    expect(auditor?.prompt).toContain('cannot make omitted legal cases out of scope')
    expect(auditor?.prompt).toContain('compile any submitted Lean evidence with `lean-mathlib`')
  })

  it('keeps methods task-derived and members inside their assigned responsibility', () => {
    const collaboration = config.modules['dsh-agent-fleet/message'].collaborationMethod
    const exact = config.core.members.find(member => member.id === 'exact-solver-engineer')
    const construction = config.core.members.find(member => member.id === 'construction-searcher')
    const theory = config.core.members.find(member => member.id === 'lower-bound-theorist')

    expect(collaboration).toContain('does not prescribe solution-specific algorithms or answers')
    expect(collaboration).toContain('formal continuation or terminal handoff')
    expect(construction?.prompt).toContain('Derive validity conditions from the authoritative task')
    expect(theory?.prompt).toContain('Start from the authoritative quantified domain')
    expect(theory?.prompt).toContain('pinned local Mathlib installation through `lean-mathlib`')
    expect(theory?.prompt).toContain('an unproved axiom, `sorry`')
    expect(theory?.prompt).toContain('exact statement and hypotheses are locally inspectable')
    expect(theory?.prompt).toContain('immediate constructions, trivial bounds, and small instances')
    expect(exact?.prompt).toContain('Choose validation sizes, solver form, and decision sequence')
    expect(exact?.prompt).toContain('construction and formal-proof lanes feed this Goal')
    expect(exact?.prompt).not.toContain('U-1')
    expect(config.core.members.every(member => member.prompt.includes('Own only'))).toBe(true)
    expect(config.core.members.every(member => member.prompt.includes('optional private scratch state'))).toBe(true)
    expect(config.core.members.every(member => member.prompt.includes('appear automatically in Team files'))).toBe(true)
    expect([config.core.assistant, ...config.core.members].every(member =>
      member.provider === 'memorax' && member.model === 'deepseek-v4-flash')).toBe(true)
  })

  it('audits the claim actually proved instead of trusting labels or unavailable citations', () => {
    const rules = config.modules['dsh-agent-fleet/message'].rules
    const auditor = config.core.members.find(member => member.id === 'adversarial-reproducer')

    expect(rules).toContain('external result is unverified unless its exact statement and hypotheses are locally inspectable')
    expect(rules).toContain('formal compilation certifies only the theorem that was actually stated')
    expect(auditor?.prompt).toContain('inspect the actual theorem statements, quantifiers, assumptions, and axioms')
    expect(auditor?.prompt).toContain('Reject any citation-dependent step')
    expect(auditor?.prompt).toContain('immediate constructions, trivial bounds, and small instances')
  })

  it('relies on the container network boundary without disabling Fleet communication', () => {
    const rules = config.modules['dsh-agent-fleet/message'].rules
    const collaboration = config.modules['dsh-agent-fleet/message'].collaborationMethod
    const resourcePolicy = config.modules['dsh-agent-fleet/resources'].policy
    const editorRules = config.modules['dsh-agent-fleet/ui'].editor.rules
    const task = readFileSync(resolve('examples/matilda-eval/task.md'), 'utf8')
    const compose = readFileSync(resolve('examples/matilda-eval/compose.yaml'), 'utf8')
    const dockerfile = readFileSync(resolve('examples/matilda-eval/Dockerfile'), 'utf8')

    expect(rules).toContain('container network boundary permits only the configured model inference service')
    expect(rules).toContain('Fleet messaging and shared local artifacts remain available')
    expect(rules).toContain("Use Chinese as the Team's working language")
    expect(collaboration).toContain('send that owner one focused message instead of waiting for a milestone')
    expect(collaboration).toContain('at least one evidence-driven continuation before packaging')
    expect(collaboration).toContain('independent construction lane and formal-proof/Lean lane')
    expect(collaboration).toContain('A settled DAG does not by itself satisfy the task')
    expect(collaboration).toContain('finish with a Vote over the complete authoritative claim')
    expect(rules).toContain('at most one concise message per distinct evidence change')
    expect(resourcePolicy).toContain('workspace files appear automatically in Team files')
    expect(editorRules).toContain('Fleet messaging and shared local artifacts remain available')
    expect(task).toContain('容器网络边界仅允许访问已经配置的模型推理服务')
    expect(task).toContain('Fleet 内部协作功能可正常使用')
    expect(task).toContain('团队工作语言使用中文')
    expect(task).toContain('至少继续一个由当前证据驱动的改进阶段')
    expect(compose).toContain('FLEET_MEMBER_DENY_HOST_TOOLS: "web_search"')
    expect(compose).toContain('cpus: ${MATILDA_CPUS:-4}')
    expect(compose).toContain('mem_limit: ${MATILDA_MEMORY:-12g}')
    expect(dockerfile).toContain(
      'DSH_HARMONY_ACTIVE_DSH_ENTRY=/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/index.js',
    )
  })
})
