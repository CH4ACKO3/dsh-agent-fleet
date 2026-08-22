import { describe, expect, it } from 'vitest'

import { FULL_TEAM_TEMPLATES } from '../packages/ui/src/team-templates.generated.js'
import { FLEET_MEMBER_PERMISSIONS, FLEET_MEMBER_TOOL_GROUPS } from '../src/member-view.js'

describe('complete Team template locales', () => {
  it('contains a complete native access profile without requiring the permissions plugin', () => {
    const toolGroups = new Set(FLEET_MEMBER_TOOL_GROUPS)
    const permissions = new Set(FLEET_MEMBER_PERMISSIONS)
    for (const template of FULL_TEAM_TEMPLATES) {
      for (const configuration of [template.configuration.en, template.configuration.zh]) {
        expect(configuration.modules).not.toHaveProperty('@ch4acko3/dsh-agent-fleet-permissions')
        for (const member of [configuration.core.assistant, ...configuration.core.members]) {
          expect(member.toolGroups.length).toBeGreaterThan(0)
          expect(member.toolGroups.every(group => toolGroups.has(group))).toBe(true)
          expect(member.permissions.every(permission => permissions.has(permission))).toBe(true)
        }
      }
    }
  })

  it('keeps builders bounded while giving one maintainer the management capabilities', () => {
    for (const template of FULL_TEAM_TEMPLATES) {
      for (const configuration of [template.configuration.en, template.configuration.zh]) {
        const participants = [configuration.core.assistant, ...configuration.core.members]
        const maintainers = participants.filter(member => member.permissions.includes('team.manage'))
        const builders = configuration.core.members.filter(member => member.toolGroups.includes('git'))
        expect(maintainers.length).toBeGreaterThan(0)
        expect(builders.some(member => !member.permissions.includes('team.manage'))).toBe(true)
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
})
