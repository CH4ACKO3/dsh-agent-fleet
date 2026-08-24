import { describe, expect, it } from 'vitest'

import { FULL_TEAM_TEMPLATES } from '../packages/ui/src/team-templates.generated.js'
describe('complete Team template locales', () => {
  it('uses the user-facing data science name for the research template', () => {
    const template = FULL_TEAM_TEMPLATES.find(candidate => candidate.id === 'research-full')
    expect(template?.nameZh).toBe('数据科学团队')
    expect(template?.nameEn).toBe('Data science Team')
  })

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

  it('uses the backstage Team assistant for the conversation and lists the VTuber as a member', () => {
    const livestream = FULL_TEAM_TEMPLATES.find(template => template.id === 'research-livestream')
    if (livestream === undefined) throw new Error('missing livestream research Team template')
    for (const configuration of [livestream.configuration.en, livestream.configuration.zh]) {
      expect(configuration.core.assistant).toMatchObject({
        id: 'team-assistant',
        provider: 'openai-codex',
        model: 'gpt-5.6-luna',
        canVote: false,
        permissions: ['message.wakeup'],
      })
      expect(configuration.core.members.every(member =>
        member.provider === 'openai-codex' && member.model === 'gpt-5.6-luna',
      )).toBe(true)
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
      expect(vtuber?.prompt).toMatch(/Shared persona: D chan|共享人格：小D/u)
      expect(vtuber?.prompt).toMatch(/Roleplay and audience interaction are your primary work|角色扮演和观众互动是你的主要工作/u)
      expect(vtuber?.prompt).toMatch(/Treat the research Team as something you observe|以观察者态度看待科研团队/u)
      expect(vtuber?.prompt).toMatch(/curious outsiders who do not know the current research problem|外行业余观众/u)
      expect(vtuber?.prompt).toMatch(/only when a viewer clearly asks a technical question|只有观众明确提出技术问题时/u)
      expect(vtuber?.prompt).toMatch(/completely invisible to the audience|对观众完全不可见/u)
      expect(vtuber?.prompt).toMatch(/action set to speak|action 设为 speak/u)
      expect(vtuber?.prompt).toMatch(/action mood to choose calm, happy, or disgusted|mood 动作，在 calm、happy、disgusted 中选择/u)
      expect(vtuber?.prompt).toMatch(/no Markdown, HTML, links, code, emoji, decorative symbols, or list formatting|不能包含 Markdown、HTML、链接、代码、emoji、装饰符号或列表格式/u)
      expect(configuration.core.assistant.prompt).toMatch(/Shared persona: D chan|共享人格：小D/u)
      const sharedPersona = vtuber?.prompt.split(/\n\n## Onstage surface|\n\n## 前台界面/u)[0]
      expect(configuration.core.assistant.prompt.startsWith(sharedPersona ?? '')).toBe(true)
      expect(configuration.core.assistant.prompt).toMatch(/Team progress must not depend on you|团队进展不得依赖你/u)
      expect(configuration.core.assistant.prompt).toMatch(/Compare plans, messages, code, logs, metrics, and reports|对照计划、消息、代码、日志、指标与报告/u)
      expect(configuration.core.assistant.prompt).toMatch(/Do not proactively manufacture or feed livestream material|不要主动制造或向 VTuber 投喂直播素材/u)
      expect(configuration.core.members.map(member => member.id))
        .toEqual([
          'livestream-vtuber',
          'theory-lead',
          'data-evaluation-scientist',
          'literature-researcher',
          'experiment-model-researcher',
          'reproducibility-engineer',
        ])
    }
  })
})
