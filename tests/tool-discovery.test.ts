import { describe, expect, it } from 'vitest'

import { FLEET_TOOL_CATALOG, searchFleetTools } from '../src/tool-discovery.js'

describe('Fleet member tool catalog', () => {
  const all = new Set(FLEET_TOOL_CATALOG.map(entry => entry.name))
  const permissions = new Set(FLEET_TOOL_CATALOG.flatMap(entry =>
    Object.values(entry.privilegedActions ?? {}).flatMap(value => typeof value === 'string' ? [value] : value)))

  it('contains the Task-based collaboration surface and excludes superseded tools', () => {
    expect([...all]).toEqual(expect.arrayContaining([
      'fleet_inbox', 'fleet_send', 'fleet_reply', 'fleet_goal', 'fleet_vote',
      'fleet_task', 'fleet_reconcile', 'fleet_channel', 'fleet_resource', 'fleet_progress',
      'fleet_user_task',
    ]))
    expect([...all]).not.toEqual(expect.arrayContaining([
      'fleet_messages', 'fleet_followup', 'fleet_wait', 'fleet_member_status',
      'fleet_meeting', 'fleet_schedule', 'fleet_calendar', 'fleet_work', 'fleet_document', 'fleet_tools',
    ]))
  })

  it('finds the new domain tools by Chinese or English intent', () => {
    const cases = [
      ['查看未读收件箱', 'fleet_inbox'],
      ['完成必回消息', 'fleet_reply'],
      ['mark my goal blocked', 'fleet_goal'],
      ['投票决定是否发布', 'fleet_vote'],
      ['处理任务状态决议', 'fleet_reconcile'],
      ['谁正在做什么', 'fleet_progress'],
      ['汇报用户任务结果', 'fleet_user_task'],
      ['助理接管执行', 'fleet_user_task'],
    ] as const
    for (const [query, expected] of cases) {
      expect(searchFleetTools(query, all, new Set(), permissions)[0]?.name, query).toBe(expected)
    }
  })

  it('keeps generic Task actions read-only', () => {
    expect(searchFleetTools('task state', all, new Set(), permissions)
      .find(match => match.name === 'fleet_task')?.actions).toEqual(['list', 'owner_list', 'get'])
  })

  it('reports create permissions on Goal and Vote without restricting owner intent', () => {
    expect(searchFleetTools('goal', all, new Set())
      .find(match => match.name === 'fleet_goal')).toMatchObject({
        actions: ['list', 'get', 'split', 'complete', 'block'],
        restrictedActions: [{ action: 'create', permissions: ['task.create'] }],
      })
    expect(searchFleetTools('goal', all, new Set(), new Set(['task.create']))
      .find(match => match.name === 'fleet_goal')?.actions)
      .toEqual(['list', 'get', 'create', 'split', 'complete', 'block'])
  })

  it('tracks fleet_progress as a resident observation tool without a status-write permission', () => {
    expect(searchFleetTools('成员最近输出', all, new Set(['fleet_progress']))[0]).toMatchObject({
      name: 'fleet_progress', loaded: true, actions: ['read'], restrictedActions: [],
    })
  })
})
