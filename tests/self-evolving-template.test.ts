import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('self-evolving Team template', () => {
  it('ships a runnable Impeccable skill for the interface engineer', () => {
    const skillRoot = resolve('.agents/skills/impeccable')
    expect(existsSync(resolve(skillRoot, 'SKILL.md'))).toBe(true)
    expect(existsSync(resolve(skillRoot, 'scripts/context.mjs'))).toBe(true)
    expect(existsSync(resolve(skillRoot, 'scripts/lib/target-args.mjs'))).toBe(true)
    expect(existsSync(resolve(skillRoot, 'reference/craft-floor.md'))).toBe(true)

    const team = JSON.parse(readFileSync(resolve('examples/self-evolving-team/team.local.json'), 'utf8'))
    const member = team.core.members.find((candidate: { id?: string }) => candidate.id === 'interface-engineer')
    expect(member?.prompt).toContain('/workspace/.agents/skills/impeccable/SKILL.md')
  })
})
