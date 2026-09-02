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
    'dsh-agent-fleet/message': { collaborationMethod: string }
  }
}

const config = JSON.parse(
  readFileSync(resolve('examples/matilda-eval/team.local.json'), 'utf8'),
) as MatildaTeamConfig

describe('Matilda blind evaluation Team template', () => {
  it('keeps adaptive refinement generic and durably linked', () => {
    const prompt = config.core.assistant.prompt

    expect(prompt).toContain('adaptive-refinement Goal')
    expect(prompt).toContain('fleet_goal split')
    expect(prompt).toContain('Do not call `todo_write`')
    expect(prompt).toContain('your next tool call must be `fleet_run start`')
    expect(prompt).toContain('Every Goal has exactly one owner')
    expect(prompt).toContain('adaptive-refinement Goal with exactly one non-auditor owner')
    expect(prompt).toContain('include a new continuation Goal among the children')
    expect(prompt).toContain('globally decide the immediately adjacent objective value')
    expect(prompt).not.toMatch(/mod 17|LIS|LDS|\b21\b|\b22\b/)
  })

  it('separates packaging from terminal acceptance and rejects open bounds', () => {
    const assistantPrompt = config.core.assistant.prompt
    const auditor = config.core.members.find(member => member.id === 'adversarial-reproducer')

    expect(assistantPrompt).toContain('`adversarial-reproducer` must not own packaging')
    expect(assistantPrompt).toContain('one terminal Vote after packaging, owned only by `adversarial-reproducer`')
    expect(auditor?.prompt).toContain('independent terminal voter rather than the owner of final packaging')
    expect(auditor?.prompt).toContain('If the bundle says the lower bound is open')
    expect(auditor?.prompt).toContain('REJECT')
  })

  it('requires each improved incumbent to reopen independent evidence work', () => {
    const collaboration = config.modules['dsh-agent-fleet/message'].collaborationMethod
    const exact = config.core.members.find(member => member.id === 'exact-solver-engineer')
    const construction = config.core.members.find(member => member.id === 'construction-searcher')
    const theory = config.core.members.find(member => member.id === 'lower-bound-theorist')

    expect(collaboration).toContain('each improved incumbent')
    expect(construction?.prompt).toContain('structurally different representation or candidate family')
    expect(theory?.prompt).toContain('structural quantities distinguish it from earlier witnesses')
    expect(exact?.prompt).toContain('first ask whether U-1 is feasible')
    expect(exact?.prompt).toContain('UNKNOWN leaves the interval unchanged')
  })
})
