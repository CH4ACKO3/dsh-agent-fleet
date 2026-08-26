import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { FULL_TEAM_TEMPLATES } from '../packages/ui/src/team-templates.generated.js'

interface TemplateParticipant {
  readonly id: string
  readonly prompt: string
  readonly provider: string
  readonly model: string
  readonly canVote?: boolean
  readonly toolGroups: readonly string[]
  readonly permissions: readonly string[]
  readonly contacts?: { readonly members?: readonly string[]; readonly channels?: readonly string[] }
}

const LIVESTREAM_LOCAL_TEMPLATE = JSON.parse(readFileSync(
  new URL('../examples/frontal-team/teams/research-livestream.local.json', import.meta.url),
  'utf8',
)) as {
  readonly core: {
    readonly assistant: TemplateParticipant
    readonly members: readonly TemplateParticipant[]
  }
}

describe('complete Team template locales', () => {
  it('contains syntactically valid static actions without requiring the permissions plugin', () => {
    for (const template of FULL_TEAM_TEMPLATES) {
      for (const configuration of [template.configuration.en, template.configuration.zh]) {
        expect(configuration.modules).not.toHaveProperty('@ch4acko3/dsh-agent-fleet-permissions')
        for (const member of [configuration.core.assistant, ...configuration.core.members]) {
          expect(member.toolGroups.length).toBeGreaterThan(0)
          expect(member.toolGroups.every(group => /^[a-z][a-z0-9-]*$/u.test(group))).toBe(true)
          expect(member.permissions.every(permission => /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/u.test(permission))).toBe(true)
        }
      }
    }
  })

  it('keeps contributors bounded and omits management authority from the livestream interfaces', () => {
    for (const template of FULL_TEAM_TEMPLATES) {
      for (const configuration of [template.configuration.en, template.configuration.zh]) {
        const participants = [configuration.core.assistant, ...configuration.core.members]
        const maintainers = participants.filter(member => member.permissions.includes('team.manage'))
        const contributors = configuration.core.members.filter(member => member.permissions.includes('resource.write'))
        expect(maintainers.length).toBeGreaterThan(0)
        expect(contributors.some(member => !member.permissions.includes('team.manage'))).toBe(true)
      }
    }
  })

  it('keeps every member and provides a Chinese prompt for the Chinese locale', () => {
    for (const template of FULL_TEAM_TEMPLATES) {
      const englishMembers = template.configuration.en.core.members
      const chineseMembers = template.configuration.zh.core.members
      expect(chineseMembers.map(member => member.id)).toEqual(englishMembers.map(member => member.id))
      expect(chineseMembers.every(member => /[\u3400-\u9fff]/u.test(member.prompt))).toBe(true)
      expect(template.configuration.zh.modules['dsh-agent-fleet/message'].defaultChannel.id)
        .toBe(template.configuration.en.modules['dsh-agent-fleet/message'].defaultChannel.id)
    }
  })

  it('keeps display identity dynamic instead of duplicating the role in preset files', () => {
    for (const template of FULL_TEAM_TEMPLATES) {
      for (const configuration of [template.configuration.en, template.configuration.zh]) {
        expect(configuration.core.members.every(member => member.name === '' && member.color === '')).toBe(true)
      }
    }
  })
  it('keeps the research assistant operating capabilities stable', () => {
    const research = FULL_TEAM_TEMPLATES.find(template => template.id === 'research-full')
    if (research === undefined) throw new Error('missing research Team template')
    for (const assistant of [research.configuration.en.core.assistant, research.configuration.zh.core.assistant]) {
      expect(assistant.toolGroups).toEqual([
        'messages', 'status', 'resources', 'documents', 'tasks', 'calendar', 'schedule',
      ])
      expect(assistant.permissions).toEqual(['message.wakeup', 'team.manage'])
    }
  })

  it('keeps the livestream research configuration as a standalone local template', () => {
    const configuration = LIVESTREAM_LOCAL_TEMPLATE
    expect(FULL_TEAM_TEMPLATES.some(template => template.id === 'research-livestream')).toBe(false)
    expect(configuration.core.assistant).toMatchObject({
      id: 'team-assistant',
      canVote: false,
      permissions: ['message.wakeup'],
    })
    const participants = [configuration.core.assistant, ...configuration.core.members]
    expect(participants.every(member => member.provider.length > 0 && member.model.length > 0)).toBe(true)
    expect(new Set(participants.map(member => `${member.provider}/${member.model}`)).size).toBe(1)
    const vtuber = configuration.core.members.find(member => member.id === 'livestream-vtuber')
    expect(vtuber).toMatchObject({
      permissions: ['joyride.control', 'livestream.host'],
      contacts: { members: ['team-assistant'], channels: ['main'] },
    })
    expect(configuration.core.assistant.toolGroups).not.toContain('coordination')
    expect(configuration.core.assistant.permissions).not.toContain('joyride.control')
    expect(configuration.core.assistant.permissions).not.toContain('livestream.host')
    expect(configuration.core.members.filter(member => member.id !== 'livestream-vtuber')
      .every(member => !member.permissions.includes('joyride.control'))).toBe(true)
    expect(configuration.core.members.filter(member => member.id !== 'livestream-vtuber')
      .every(member => !member.permissions.includes('livestream.host'))).toBe(true)
    const sharedPersona = vtuber?.prompt.split(/\n\n## 前台界面/u)[0]
    expect(configuration.core.assistant.prompt.startsWith(sharedPersona ?? '')).toBe(true)
    expect([...configuration.core.members.map(member => member.id)].sort()).toEqual([
      'livestream-vtuber',
      'theory-lead',
      'data-evaluation-scientist',
      'literature-researcher',
      'experiment-model-researcher',
      'reproducibility-engineer',
    ].sort())
  })
})
