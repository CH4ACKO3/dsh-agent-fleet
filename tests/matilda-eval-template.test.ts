import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface TeamMember {
  id: string
  prompt: string
}

interface MatildaTeamConfig {
  core: {
    assistant: { prompt: string }
    members: TeamMember[]
  }
  modules: {
    'dsh-agent-fleet/message': { collaborationMethod: string; rules: string }
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
    expect(prompt).toContain('your next tool call must be `fleet_run start`')
    expect(prompt).toContain('no mandatory stage names, lane count, algorithm, or round count')
    expect(prompt).toContain('Activate a member only for a concrete deliverable')
    expect(prompt).toContain('All required paths must join')
    expect(prompt).toContain('long work retains a formal continuation or recovery path')
    expect(prompt).not.toContain('adaptive-refinement Goal')
    expect(prompt).not.toContain('globally decide the immediately adjacent value')
    expect(prompt).not.toContain('every configured formal member exactly one independent zero-dependency first-pass Goal')
    expect(prompt).not.toMatch(/mod 17|LIS|LDS|\b21\b|\b22\b/)
  })

  it('keeps packaging and independent acceptance separate without fixing their owners', () => {
    const assistantPrompt = config.core.assistant.prompt
    const auditor = config.core.members.find(member => member.id === 'adversarial-reproducer')

    expect(assistantPrompt).toContain('no member approves its own unchecked package')
    expect(assistantPrompt).toContain('Choose their owners from the actual roster')
    expect(auditor?.prompt).toContain('authoritative task\'s evidence standard')
    expect(auditor?.prompt).toContain('APPROVE, REJECT, or INDETERMINATE')
    expect(auditor?.prompt).toContain('Never silently repair a producer\'s artifact')
  })

  it('keeps methods task-derived and members inside their assigned responsibility', () => {
    const collaboration = config.modules['dsh-agent-fleet/message'].collaborationMethod
    const exact = config.core.members.find(member => member.id === 'exact-solver-engineer')
    const construction = config.core.members.find(member => member.id === 'construction-searcher')
    const theory = config.core.members.find(member => member.id === 'lower-bound-theorist')

    expect(collaboration).toContain('does not prescribe stage names')
    expect(collaboration).toContain('formal continuation or terminal handoff')
    expect(construction?.prompt).toContain('Derive validity conditions from the authoritative task')
    expect(theory?.prompt).toContain('Formalize the quantified domain from the authoritative task')
    expect(exact?.prompt).toContain('Choose validation sizes, solver form, and decision sequence')
    expect(exact?.prompt).not.toContain('U-1')
    expect(config.core.members.every(member => member.prompt.includes('Own only'))).toBe(true)
    expect(config.core.members.every(member => member.prompt.includes('optional private scratch state'))).toBe(true)
  })

  it('distinguishes outbound internet access from internal Fleet communication', () => {
    const rules = config.modules['dsh-agent-fleet/message'].rules
    const editorRules = config.modules['dsh-agent-fleet/ui'].editor.rules
    const task = readFileSync(resolve('examples/matilda-eval/task.md'), 'utf8')

    expect(rules).toContain('applies only to outbound container network connections')
    expect(rules).toContain('internal Team communication, not internet access')
    expect(editorRules).toContain('Fleet Channels, direct messages, @ mentions, Reply Tasks')
    expect(task).toContain('Fleet 频道、私聊、@、Reply Task 和共享本地工件属于团队内部通信，不属于联网')
  })
})
