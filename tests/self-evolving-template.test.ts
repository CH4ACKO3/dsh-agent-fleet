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

  it('carries observed problems and role improvements across generations', () => {
    const bootstrap = readFileSync(resolve('examples/self-evolving-team/bootstrap.md'), 'utf8')
    const team = JSON.parse(readFileSync(resolve('examples/self-evolving-team/team.local.json'), 'utf8'))
    const platform = team.core.members.find((candidate: { id?: string }) => candidate.id === 'platform-engineer')
    const reliability = team.core.members.find((candidate: { id?: string }) => candidate.id === 'domain-engineer')

    expect(bootstrap).toContain('evidence/evolution-backlog.md')
    expect(bootstrap).toContain('临时规避必须同时留下永久修复入口')
    expect(bootstrap).toContain('休眠保障代、活跃稳定代、可选的活跃候选代')
    expect(platform?.prompt).toContain('建议的同角色提示词改进')
    expect(reliability?.prompt).toContain('下一代同角色')
  })
})
