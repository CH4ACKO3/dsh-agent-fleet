import { describe, expect, it } from 'vitest'

import { FULL_TEAM_TEMPLATES } from '../packages/ui/src/team-templates.generated.js'
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
        if (template.id === 'research-livestream') expect(maintainers).toEqual([])
        else expect(maintainers.length).toBeGreaterThan(0)
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

  it('keeps the research assistant observational instead of making it a research coordinator', () => {
    const research = FULL_TEAM_TEMPLATES.find(template => template.id === 'research-full')
    if (research === undefined) throw new Error('missing research Team template')
    for (const assistant of [research.configuration.en.core.assistant, research.configuration.zh.core.assistant]) {
      expect(assistant.toolGroups).toEqual([
        'messages', 'status', 'resources', 'documents', 'tasks', 'calendar', 'schedule',
      ])
      expect(assistant.permissions).toEqual(['message.wakeup', 'team.manage'])
      expect(assistant.prompt.length).toBeGreaterThan(200)
      expect(assistant.prompt).toMatch(/default state is quiet|默认保持安静/u)
      expect(assistant.prompt).toMatch(/Do not interpret|不要解释/u)
    }
  })

  it('provides a non-voting VTuber frontend and passive research assistant for livestreams', () => {
    const livestream = FULL_TEAM_TEMPLATES.find(template => template.id === 'research-livestream')
    if (livestream === undefined) throw new Error('missing livestream research Team template')
    for (const configuration of [livestream.configuration.en, livestream.configuration.zh]) {
      expect(configuration.core.assistant).toMatchObject({
        id: 'livestream-vtuber',
        permissions: [],
        contacts: { members: ['team-assistant'], channels: ['main'] },
      })
      const assistant = configuration.core.members.find(member => member.id === 'team-assistant')
      expect(assistant).toMatchObject({
        canVote: false,
        permissions: ['message.wakeup'],
      })
      expect(assistant?.toolGroups).not.toContain('coordination')
      expect(assistant?.prompt).toMatch(/default state is quiet|默认保持安静/u)
      expect(configuration.core.members.filter(member => member.id !== 'team-assistant').map(member => member.id))
        .toEqual([
          'theory-lead',
          'data-evaluation-scientist',
          'literature-researcher',
          'experiment-model-researcher',
          'reproducibility-engineer',
        ])
    }
  })
})
