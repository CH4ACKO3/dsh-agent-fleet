import { describe, expect, it, vi } from 'vitest'

import { FLEET_TOOL_CATALOG, installFleetToolDiscovery, searchFleetTools } from '../src/tool-discovery.js'

describe('Fleet tool discovery', () => {
  const allowed = new Set([
    'fleet_send', 'fleet_messages', 'fleet_followup', 'fleet_wait',
    'fleet_channel', 'fleet_vote', 'fleet_meeting',
    'fleet_shared', 'fleet_work', 'fleet_resource', 'fleet_workspace',
    'fleet_member_status', 'fleet_progress',
  ])

  it('finds optional tools by English or Chinese intent without an LLM', () => {
    expect(searchFleetTools('consensus vote', allowed, new Set())[0]).toMatchObject({
      name: 'fleet_vote', group: 'coordination', loaded: false,
    })
    expect(searchFleetTools('共享文件', allowed, new Set()).map(match => match.name)).toContain('fleet_shared')
  })

  it('does not reveal groups unavailable to the member', () => {
    expect(searchFleetTools('external deployment', new Set(['fleet_send']), new Set())).toEqual([])
  })

  it('reports only actions granted by member permissions', () => {
    expect(searchFleetTools('resource', allowed, new Set()).find(match => match.name === 'fleet_resource'))
      .toMatchObject({
        actions: ['list', 'get'],
        restrictedActions: [{ action: 'add', permissions: ['resource.write'] }],
      })
    expect(searchFleetTools('resource', allowed, new Set(), new Set(['resource.write']))
      .find(match => match.name === 'fleet_resource')?.actions).toEqual(['list', 'get', 'add'])
    expect(searchFleetTools('shared file', allowed, new Set())
      .find(match => match.name === 'fleet_shared')).toMatchObject({
        actions: ['list', 'read'],
        restrictedActions: [
          { action: 'write', permissions: ['resource.write'] },
          { action: 'delete', permissions: ['resource.write'] },
        ],
      })
    expect(searchFleetTools('shared file', allowed, new Set(), new Set(['resource.write']))
      .find(match => match.name === 'fleet_shared')?.actions).toEqual(['list', 'read', 'write', 'delete'])
  })

  it('segments natural Chinese queries and applies domain aliases without dependencies', () => {
    const allAllowed = new Set(FLEET_TOOL_CATALOG.map(entry => entry.name))
    const permissions = new Set(FLEET_TOOL_CATALOG.flatMap(entry =>
      Object.values(entry.privilegedActions ?? {}).flatMap(value => typeof value === 'string' ? [value] : value)))
    const cases = [
      ['查看团队目前运行状态', 'fleet_run'],
      ['谁正在做什么', 'fleet_progress'],
      ['给成员发一条私聊', 'fleet_send'],
      ['紧急叫醒审阅员', 'fleet_followup'],
      ['投票决定是否发布', 'fleet_vote'],
      ['开会讨论这个方案', 'fleet_meeting'],
      ['声明我正在编辑 src 目录', 'fleet_work'],
      ['修改成员权限组', 'fleet_permission'],
      ['看看最近发生了什么', 'fleet_activity'],
      ['启动一个用户助理会话', 'fleet_assistant'],
      ['唤醒整个团队', 'fleet_run'],
      ['恢复单个成员', 'fleet_member'],
    ] as const
    for (const [query, expected] of cases) {
      expect(searchFleetTools(query, allAllowed, new Set(), permissions)[0]?.name, query).toBe(expected)
    }
  })

  it('expands a directly matched small family while keeping related results distinguishable', () => {
    const matches = searchFleetTools(
      '投票决定是否发布',
      new Set(['fleet_channel', 'fleet_vote', 'fleet_meeting']),
      new Set(),
      new Set(['vote.create', 'channel.manage', 'meeting.manage']),
    )
    expect(matches.map(match => match.name)).toEqual(['fleet_vote', 'fleet_channel', 'fleet_meeting'])
    expect(matches[0]).toMatchObject({ family: 'coordination', matched: true })
    expect(matches.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'coordination', matched: false }),
      expect.objectContaining({ family: 'coordination', matched: false }),
    ]))
  })

  it('never expands unavailable or actionless family members', () => {
    const matches = searchFleetTools(
      '发一条私聊',
      new Set(['fleet_send', 'fleet_messages', 'fleet_followup', 'fleet_wait']),
      new Set(),
    )
    expect(matches.map(match => match.name)).toEqual(['fleet_send', 'fleet_messages', 'fleet_wait'])
    expect(matches.some(match => match.name === 'fleet_followup')).toBe(false)
  })

  it('does not expand an unrelated family from a generic Chinese noun', () => {
    const names = searchFleetTools(
      '挂载另一个工作区',
      new Set(['fleet_workspace', 'fleet_work', 'fleet_git', 'fleet_member_status', 'fleet_progress']),
      new Set(),
      new Set(['workspace.read', 'workspace.manage', 'git.inspect', 'git.scope-check', 'git.worktree-create', 'member-status.read']),
    ).map(match => match.name)
    expect(names).toEqual(['fleet_workspace', 'fleet_work', 'fleet_git'])
  })

  it('includes permission-filtered core tools and tracks exact loaded tools', () => {
    const visible = new Set(['fleet_run', 'fleet_member', 'fleet_trace'])
    expect(searchFleetTools('team run', visible, new Set(['fleet_run']))[0]).toMatchObject({
      name: 'fleet_run', loaded: true,
    })
    expect(searchFleetTools('唤醒整个团队', visible, new Set(), new Set(['team.manage']))[0])
      .toMatchObject({ name: 'fleet_run', actions: expect.arrayContaining(['wake', 'resume']) })
    expect(searchFleetTools('拉起未加载的团队成员', visible, new Set(), new Set(['team.manage']))[0])
      .toMatchObject({ name: 'fleet_member', actions: expect.arrayContaining(['resume']) })
    expect(searchFleetTools('manage members', visible, new Set(), new Set())
      .find(match => match.name === 'fleet_member')).toMatchObject({ actions: ['list'] })
    expect(searchFleetTools('manage members', visible, new Set(), new Set(['team.manage']))
      .find(match => match.name === 'fleet_member')?.actions)
      .toEqual(['list', 'add', 'update', 'configure', 'configure_all', 'pause', 'resume', 'remove'])
  })

  it('rejects an exact load when none of that tool actions are authorized', async () => {
    let discovery: { readonly description: string; execute(args: { readonly action: 'load'; readonly name: string }): Promise<unknown> } | undefined
    installFleetToolDiscovery({
      tools: {
        register: tool => {
          discovery = tool as typeof discovery
          return () => {}
        },
      },
    } as never, {
      allowedTools: new Set(['fleet_followup']),
      residentTools: new Set(),
      permissions: new Set(),
      load: () => { throw new Error('must not load') },
    })
    if (discovery === undefined) throw new Error('expected fleet_tools discovery')
    expect(discovery.description).toContain('does not list host tools such as bash')
    expect(discovery.description).toContain('already resident')
    await expect(discovery.execute({ action: 'load', name: 'fleet_followup' }))
      .rejects.toThrow('no actions available')
  })

  it('keeps compatibility load idempotent for a resident tool', async () => {
    let discovery: { execute(args: { readonly action: 'load'; readonly name: string }): Promise<unknown> } | undefined
    const load = vi.fn()
    installFleetToolDiscovery({
      tools: {
        register: tool => {
          discovery = tool as typeof discovery
          return () => {}
        },
      },
    } as never, {
      allowedTools: new Set(['fleet_vote']),
      residentTools: new Set(['fleet_vote']),
      permissions: new Set(['vote.create']),
      load,
    })
    if (discovery === undefined) throw new Error('expected fleet_tools discovery')
    await expect(discovery.execute({ action: 'load', name: 'fleet_vote' })).resolves.toMatchObject({
      loadedTools: ['fleet_vote'],
      matches: [expect.objectContaining({ name: 'fleet_vote', loaded: true })],
    })
    expect(load).not.toHaveBeenCalled()
  })
})
