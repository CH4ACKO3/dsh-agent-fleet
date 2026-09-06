/**
 * Budget and context-usage panel for the Fleet UI.
 *
 * Budget-domain code kept in one module with the same external behaviour.
 */
import type { ChangeEvent, ComponentType, CSSProperties, MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react'
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import { useFleetAnchoredPopover } from './anchored-popover.js'
import { installPanelStyles, panelText } from './panel-utils.js'
import {
  type FleetContextBreakdown,
  type FleetContextOccupancy,
  type FleetContextPressure,
  type FleetContextProjectionHook,
  type FleetPanelBudgetAccount,
  type FleetPanelBudgetInput,
  type FleetPanelBudgetMode,
  type FleetPanelBudgetModelRate,
  type FleetPanelBudgetModelUsage,
  type FleetPanelBudgetState,
  type FleetPanelParticipantBudget,
  type FleetPanelTeamBudget,
  type FleetPanelTeamSettings,
  EMPTY_UNSUBSCRIBE,
  teamDirectorySource,
  requestFleetTeamSettings,
} from './team-panel.js'
import { FLEET_TUTORIAL_TEAM_ID } from './tutorial-team.js'

// ---------------------------------------------------------------------------
// Formatter helpers
// ---------------------------------------------------------------------------

function formatBudgetTokens(value: number): string {
  return new Intl.NumberFormat(panelText('zh-CN', 'en-US'), { notation: value >= 1_000_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function formatBudgetAmount(value: number, mode: FleetPanelBudgetMode): string {
  if (mode === 'tokens') return `${formatBudgetTokens(value)} Token`
  return new Intl.NumberFormat(panelText('zh-CN', 'en-US'), {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6,
  }).format(value / 1_000_000)
}

function formatBudgetCompactTokens(value: number): string {
  const scaled = value >= 1_000_000
    ? { value: value / 1_000_000, suffix: 'M' }
    : value >= 1_000
      ? { value: value / 1_000, suffix: 'K' }
      : { value, suffix: '' }
  return `${new Intl.NumberFormat(panelText('zh-CN', 'en-US'), { maximumFractionDigits: scaled.value < 10 ? 1 : 0 }).format(scaled.value)}${scaled.suffix}`
}

function formatBudgetPopoverAmount(value: number, mode: FleetPanelBudgetMode): string {
  return mode === 'tokens' ? formatBudgetCompactTokens(value) : formatBudgetAmount(value, mode)
}

function formatApproximateBudgetAmount(value: number, mode: FleetPanelBudgetMode): string {
  const amount = formatBudgetPopoverAmount(value, mode)
  return value === 0 ? amount : `~${amount}`
}

// ---------------------------------------------------------------------------
// Context occupancy
// ---------------------------------------------------------------------------

export function fleetContextOccupancy(
  pressure: FleetContextPressure | undefined,
): FleetContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  const contextWindow = pressure?.contextWindow
  if (usedTokens === undefined || contextWindow === undefined || contextWindow <= 0) return null
  return {
    percent: Math.min(100, Math.max(0, Math.round(usedTokens / contextWindow * 100))),
    usedTokens: Math.max(0, usedTokens),
    contextWindow,
  }
}

function ContextUsage({ useProjection }: {
  readonly useProjection?: FleetContextProjectionHook
}): ReactElement {
  const pressure = useProjection?.<FleetContextPressure>('contextPressure')
  const breakdown = useProjection?.<FleetContextBreakdown>('contextBreakdown')
  const context = fleetContextOccupancy(pressure)
  if (context === null) return jsx('p', {
    className: 'dsh-fleet-budget-popover-empty',
    role: 'status',
    children: panelText('当前还没有可用的上下文用量。完成一次模型调用后会自动显示。', 'Context usage is not available yet. It will appear after a model call completes.'),
  })

  const rows = [
    { key: 'system', label: panelText('系统提示词', 'System prompt'), value: breakdown?.systemTokens ?? 0 },
    { key: 'tools', label: panelText('工具', 'Tools'), value: breakdown?.toolsTokens ?? 0 },
    { key: 'messages', label: panelText('会话', 'Conversation'), value: breakdown?.messageTokens ?? 0 },
  ] as const
  const breakdownTotal = rows.reduce((total, row) => total + row.value, 0)
  const segments = breakdown === undefined || breakdownTotal === 0
    ? [{ key: 'total', width: context.percent }]
    : rows.filter(row => row.value > 0).map(row => ({
        key: row.key,
        width: context.percent * row.value / breakdownTotal,
      }))

  return jsxs(Fragment, { children: [
    jsxs('div', { className: 'dsh-fleet-budget-popover-header', children: [
      jsx('span', { className: 'dsh-fleet-budget-popover-headline', children: panelText('上下文已用', '') }),
      jsx('span', { className: 'dsh-fleet-budget-popover-percent', children: `${context.percent}%` }),
      jsx('span', { className: 'dsh-fleet-budget-popover-headline', children: panelText('', 'of context used') }),
      jsx('span', {
        className: 'dsh-fleet-budget-popover-figures',
        children: `~${formatBudgetCompactTokens(context.usedTokens)} / ${formatBudgetCompactTokens(context.contextWindow)}`,
      }),
    ] }),
    jsx('div', {
      className: 'dsh-fleet-budget-popover-progress',
      'data-context': 'true',
      role: 'progressbar',
      'aria-label': panelText('上下文用量', 'Context usage'),
      'aria-valuemin': 0,
      'aria-valuemax': context.contextWindow,
      'aria-valuenow': Math.min(context.usedTokens, context.contextWindow),
      children: segments.map(segment => jsx('span', {
        'data-kind': segment.key,
        style: { width: `${segment.width}%` },
      }, segment.key)),
    }),
    breakdown !== undefined && jsx('dl', {
      className: 'dsh-fleet-budget-popover-members',
      children: rows.map(row => jsxs('div', {
        className: 'dsh-fleet-budget-popover-member',
        children: [
          jsxs('dt', { children: [
            jsx('span', {
              className: 'dsh-fleet-budget-popover-member-dot',
              'data-kind': row.key,
              'aria-hidden': 'true',
            }),
            jsx('span', { className: 'dsh-fleet-budget-popover-member-name', children: row.label }),
          ] }),
          jsx('dd', {
            className: 'dsh-fleet-budget-popover-member-usage',
            children: `~${formatBudgetCompactTokens(row.value)}`,
          }),
        ],
      }, row.key)),
    }),
  ] })
}

function budgetStateText(account: FleetPanelBudgetAccount): string {
  if (account.state === 'exhausted') return panelText('已用尽', 'Exhausted')
  if (account.state === 'danger') return panelText('即将用尽', 'Nearly exhausted')
  if (account.state === 'warning') return panelText('接近上限', 'Near limit')
  if (account.state === 'unlimited') return panelText('无限制', 'Unlimited')
  return panelText('正常', 'Normal')
}

function BudgetUsage({ account, mode }: {
  readonly account: FleetPanelBudgetAccount
  readonly mode: FleetPanelBudgetMode
}): ReactElement {
  const percent = account.limit === undefined ? 0 : Math.min(100, account.used / account.limit * 100)
  return jsxs('div', { className: 'dsh-fleet-panel-budget-usage', children: [
    jsxs('div', { className: 'dsh-fleet-panel-budget-usage-head', children: [
      account.limit === undefined
        ? panelText(`已使用 ${formatBudgetAmount(account.used, mode)}`, `${formatBudgetAmount(account.used, mode)} used`)
        : panelText(`已使用 ${formatBudgetAmount(account.used, mode)} / ${formatBudgetAmount(account.limit, mode)}`, `${formatBudgetAmount(account.used, mode)} / ${formatBudgetAmount(account.limit, mode)} used`),
      jsx('span', { 'data-state': account.state, children: budgetStateText(account) }),
    ] }),
    percent > 0 && jsx('div', {
      className: 'dsh-fleet-panel-budget-progress', role: 'progressbar',
      'aria-valuemin': 0, 'aria-valuemax': account.limit ?? undefined,
      'aria-valuenow': Math.min(account.used, account.limit ?? Infinity),
      children: jsx('span', { 'data-state': account.state, style: { width: `${percent}%` } }),
    }),
  ] })
}

// ---------------------------------------------------------------------------
// Budget rate draft (local state shape)
// ---------------------------------------------------------------------------

interface BudgetRateDraft {
  readonly multiplier: string
  readonly input: string
  readonly output: string
  readonly cacheRead: string
  readonly cacheWrite: string
}

function budgetModelKey(provider: string, model: string): string {
  return `${provider}:${model}`
}

// ---------------------------------------------------------------------------
// FleetBudgetMeter (ring + popover, the main exported component)
// ---------------------------------------------------------------------------

export function FleetBudgetMeter({ teamId, budget: suppliedBudget, memberId, contextUsage = false, useProjection, Tooltip }: {
  readonly teamId: string
  readonly budget?: FleetPanelTeamBudget
  readonly memberId?: string
  readonly contextUsage?: boolean
  readonly useProjection?: FleetContextProjectionHook
  readonly Tooltip?: ComponentType<{
    readonly label: string
    readonly side: 'top'
    readonly delayMs: number
    readonly disabled: boolean
    readonly children: ReactElement
  }>
}): ReactElement {
  installPanelStyles()
  const popover = useFleetAnchoredPopover('below-end')
  const [popoverView, setPopoverView] = useState<'budget' | 'context'>('budget')
  const subscribe = useCallback((listener: () => void) => teamDirectorySource?.subscribe(listener) ?? EMPTY_UNSUBSCRIBE, [])
  const liveBudget = useSyncExternalStore(
    subscribe,
    () => teamDirectorySource?.getSnapshot().team?.teamId === teamId
      ? teamDirectorySource.getSnapshot().team?.budget
      : undefined,
    () => undefined,
  )
  const budget = suppliedBudget ?? liveBudget
  const member = memberId === undefined ? undefined : budget?.members.find(candidate => candidate.memberId === memberId)
  const account = memberId === undefined ? budget?.team : member
  const scopeName = member === undefined
    ? panelText('团队预算', 'Team budget')
    : panelText(`${member.name} 的预算`, `${member.name} budget`)
  const activePopoverView = contextUsage ? popoverView : 'budget'
  const popoverLabel = activePopoverView === 'context'
    ? panelText('上下文用量', 'Context usage')
    : scopeName

  const percent = account?.limit === undefined || account.limit === 0
    ? 0
    : Math.min(100, account.used / account.limit * 100)
  const circumference = 2 * Math.PI * 6
  const ringOffset = account?.limit === undefined ? circumference : circumference * (1 - percent / 100)
  const state = account?.state ?? 'unlimited'
  const tooltipLabel = account === undefined
    ? panelText('正在载入预算', 'Loading budget')
    : account.limit === undefined
      ? panelText('预算未设置上限', 'No budget limit set')
      : panelText(`预算已使用 ${Math.round(percent)}%`, `${Math.round(percent)}% of budget used`)
  const displayedMembers = member === undefined ? budget?.members ?? [] : [member]
  const displayedMemberUsage = displayedMembers.reduce((total, candidate) => total + candidate.used, 0)
  const progressSegments = displayedMemberUsage === 0 || account === undefined || account.limit === undefined
    ? []
    : displayedMembers.filter(candidate => candidate.used > 0).map(candidate => ({
        member: candidate,
        width: percent * candidate.used / displayedMemberUsage,
      }))
  const figures = account === undefined || budget === undefined
    ? '—'
    : `${formatApproximateBudgetAmount(account.used, budget.mode)} / ${account.limit === undefined ? '∞' : formatBudgetPopoverAmount(account.limit, budget.mode)}`
  const trigger = jsx('button', {
    type: 'button',
    className: 'dsh-fleet-budget-meter-button',
    'aria-label': tooltipLabel,
    'aria-haspopup': 'dialog',
    'aria-expanded': popover.open,
    'aria-controls': popover.popoverId,
    ...(Tooltip === undefined ? { title: tooltipLabel } : {}),
    onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (account !== undefined) popover.toggleAt(event.currentTarget)
    },
    children: jsxs('svg', { className: 'dsh-fleet-budget-meter-ring', viewBox: '0 0 16 16', 'aria-hidden': 'true', children: [
      jsx('circle', { className: 'dsh-fleet-budget-meter-track', cx: 8, cy: 8, r: 6 }),
      jsx('circle', {
        className: 'dsh-fleet-budget-meter-value', cx: 8, cy: 8, r: 6,
        'data-state': state,
        strokeDasharray: circumference,
        strokeDashoffset: ringOffset,
      }),
    ] }),
  })

  return jsxs('span', { className: 'dsh-fleet-budget-meter', children: [
    Tooltip === undefined ? trigger : jsx(Tooltip, {
      label: tooltipLabel,
      side: 'top',
      delayMs: 200,
      disabled: popover.open,
      children: trigger,
    }),
    popover.mounted && account !== undefined && budget !== undefined && jsxs('section', {
      ref: popover.popover,
      id: popover.popoverId,
      popover: 'auto',
      className: 'dsh-fleet-budget-popover',
      role: 'dialog',
      'aria-label': popoverLabel,
      onClick: (event: ReactMouseEvent<HTMLElement>) => { event.stopPropagation() },
      children: [
        contextUsage && jsxs('div', {
          className: 'dsh-fleet-budget-popover-switch',
          role: 'group',
          'aria-label': panelText('用量视图', 'Usage view'),
          children: [
            jsx('button', {
              type: 'button',
              'aria-pressed': activePopoverView === 'budget',
              'data-active': activePopoverView === 'budget' ? 'true' : undefined,
              onClick: () => { setPopoverView('budget') },
              children: panelText('成本用量', 'Cost'),
            }),
            jsx('button', {
              type: 'button',
              'aria-pressed': activePopoverView === 'context',
              'data-active': activePopoverView === 'context' ? 'true' : undefined,
              onClick: () => { setPopoverView('context') },
              children: panelText('上下文用量', 'Context'),
            }),
          ],
        }),
        activePopoverView === 'context'
          ? jsx(ContextUsage, { useProjection })
          : jsxs(Fragment, { children: [
              jsxs('div', { className: 'dsh-fleet-budget-popover-header', children: [
                jsx('span', { className: 'dsh-fleet-budget-popover-headline', children: account.limit === undefined
                  ? panelText('预算未设置上限', 'No budget limit set')
                  : panelText('预算已用', '') }),
                account.limit !== undefined && jsx('span', { className: 'dsh-fleet-budget-popover-percent', children: `${Math.round(percent)}%` }),
                account.limit !== undefined && jsx('span', { className: 'dsh-fleet-budget-popover-headline', children: panelText('', 'of budget used') }),
                jsx('span', { className: 'dsh-fleet-budget-popover-figures', children: figures }),
              ] }),
              jsx('div', { className: 'dsh-fleet-budget-popover-progress', role: 'progressbar',
                'aria-label': panelText('成本用量', 'Cost usage'),
                'aria-valuemin': 0, 'aria-valuemax': account.limit ?? undefined, 'aria-valuenow': account.limit === undefined ? undefined : Math.min(account.used, account.limit),
                children: progressSegments.map(segment => jsx('span', {
                  title: `${segment.member.name} · ${formatBudgetPopoverAmount(segment.member.used, budget.mode)}`,
                  style: { width: `${segment.width}%`, '--budget-member-color': segment.member.color ?? '#737985' } as CSSProperties,
                }, segment.member.memberId)),
              }),
              jsx('dl', { className: 'dsh-fleet-budget-popover-members', children: displayedMembers.map(candidate => jsxs('div', {
                className: 'dsh-fleet-budget-popover-member',
                children: [
                  jsxs('dt', { children: [
                    jsx('span', { className: 'dsh-fleet-budget-popover-member-dot', style: { '--budget-member-color': candidate.color ?? '#737985' } as CSSProperties, 'aria-hidden': 'true' }),
                    jsx('span', { className: 'dsh-fleet-budget-popover-member-name', children: candidate.name }),
                    jsx('span', {
                      className: 'dsh-fleet-budget-popover-member-role',
                      children: candidate.active
                        ? candidate.role
                        : `${candidate.role}${candidate.role === '' ? '' : ' · '}${panelText('已移除', 'Removed')}`,
                    }),
                  ] }),
                  jsx('dd', {
                    className: 'dsh-fleet-budget-popover-member-usage',
                    children: formatApproximateBudgetAmount(candidate.used, budget.mode),
                  }),
                ],
              }, candidate.memberId)) }),
              teamId !== FLEET_TUTORIAL_TEAM_ID && jsx('button', {
                type: 'button', className: 'dsh-fleet-budget-popover-manage',
                onClick: () => { popover.close(); requestFleetTeamSettings(teamId, 'budget') },
                children: panelText('管理预算与模型计费', 'Manage budget and model pricing'),
              }),
            ] }),
      ],
    }),
  ] })
}

// ---------------------------------------------------------------------------
// BudgetSettings (rendered inside TeamSettingsDialog)
// ---------------------------------------------------------------------------

export function BudgetSettings({ budget, updateBudget, onUpdated, setError, setNotice }: {
  readonly budget: FleetPanelTeamBudget
  readonly updateBudget?: (input: Omit<FleetPanelBudgetInput, 'sessionId' | 'teamId'>) => Promise<FleetPanelTeamBudget>
  readonly onUpdated: (budget: FleetPanelTeamBudget) => void
  readonly setError: (error: string | undefined) => void
  readonly setNotice: (notice: string | undefined) => void
}): ReactElement {
  const [limits, setLimits] = useState<Readonly<Record<string, string>>>({})
  const [mode, setMode] = useState<FleetPanelBudgetMode>(budget.mode)
  const [rates, setRates] = useState<Readonly<Record<string, BudgetRateDraft>>>({})
  const [busy, setBusy] = useState<string>()

  const models = [...new Map([
    ...budget.configuredModels,
    ...budget.rates,
    ...budget.team.models,
    ...budget.members.flatMap(member => member.models),
  ].map(item => [budgetModelKey(item.provider, item.model), { provider: item.provider, model: item.model }] as const)).values()]
    .sort((left, right) => left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model))

  useEffect(() => {
    setMode(budget.mode)
    setLimits({
      team: budget.team.limit === undefined ? '' : budget.mode === 'cost' ? String(budget.team.limit / 1_000_000) : String(budget.team.limit),
      ...Object.fromEntries(budget.members.map(member => [member.memberId, member.limit === undefined ? '' : budget.mode === 'cost' ? String(member.limit / 1_000_000) : String(member.limit)])),
    })
    setRates(Object.fromEntries(models.map(model => {
      const configured = budget.rates.find(rate => rate.provider === model.provider && rate.model === model.model)
      return [budgetModelKey(model.provider, model.model), {
        multiplier: configured?.multiplier?.toString() ?? '',
        input: configured?.inputUsdPerMillion?.toString() ?? '',
        output: configured?.outputUsdPerMillion?.toString() ?? '',
        cacheRead: configured?.cacheReadUsdPerMillion?.toString() ?? '',
        cacheWrite: configured?.cacheWriteUsdPerMillion?.toString() ?? '',
      }]
    })))
  }, [budget])

  const change = async (scope: 'team' | 'member', member: string | undefined, reset: boolean): Promise<void> => {
    if (updateBudget === undefined || busy !== undefined) return
    const key = member ?? 'team'
    const normalized = (limits[key] ?? '').trim()
    const parsed = normalized === '' ? undefined : Number(normalized)
    const limit = parsed === undefined ? undefined : budget.mode === 'cost' ? Math.round(parsed * 1_000_000) : parsed
    if (!reset && normalized !== '' && (!Number.isFinite(parsed) || parsed! <= 0
      || !Number.isSafeInteger(limit))) {
      setError(budget.mode === 'cost'
        ? panelText('成本额度必须是大于 0 的美元金额；留空表示无限制。', 'The cost limit must be a USD amount above 0. Leave blank for unlimited.')
        : panelText('Token 额度必须是正整数；留空表示无限制。', 'The token limit must be a positive integer. Leave blank for unlimited.'))
      return
    }
    setBusy(`${reset ? 'reset' : 'save'}:${key}`)
    setError(undefined)
    setNotice(undefined)
    try {
      const updated = await updateBudget({
        scope,
        ...(member === undefined ? {} : { member }),
        ...(reset ? { reset: true as const } : { limit: limit ?? null }),
      })
      onUpdated(updated)
      setNotice(reset
        ? scope === 'team'
          ? panelText('团队和全部成员已开始新的预算周期。', 'The Team and all members started a new budget cycle.')
          : panelText('成员已开始新的独立预算周期；团队累计用量不变。', 'The member started a new budget cycle. Team usage is unchanged.')
        : panelText('预算上限已更新，从下一次模型调用开始生效。', 'Budget limit updated for the next model call.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法更新预算', 'Could not update budget'))
    } finally {
      setBusy(undefined)
    }
  }

  const updateRate = (key: string, field: keyof BudgetRateDraft, value: string): void => {
    setRates(current => ({
      ...current,
      [key]: { multiplier: '', input: '', output: '', cacheRead: '', cacheWrite: '', ...current[key], [field]: value },
    }))
  }

  const saveAccounting = async (): Promise<void> => {
    if (updateBudget === undefined || busy !== undefined) return
    const configured: FleetPanelBudgetModelRate[] = []
    for (const model of models) {
      const key = budgetModelKey(model.provider, model.model)
      const draft = rates[key] ?? { multiplier: '', input: '', output: '', cacheRead: '', cacheWrite: '' }
      if (mode === 'tokens') {
        const multiplier = draft.multiplier.trim() === '' ? 1 : Number(draft.multiplier)
        if (!Number.isFinite(multiplier) || multiplier <= 0) {
          setError(panelText(`${model.provider} · ${model.model} 的倍率必须大于 0。`, `The multiplier for ${model.provider} · ${model.model} must be above 0.`))
          return
        }
        configured.push({ provider: model.provider, model: model.model, ...(multiplier === 1 ? {} : { multiplier }) })
        continue
      }
      const values = [draft.input, draft.output, draft.cacheRead, draft.cacheWrite]
      if (values.some(value => value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0)) {
        setError(panelText(`${model.provider} · ${model.model} 需要填写四项非负价格。`, `${model.provider} · ${model.model} requires all four non-negative prices.`))
        return
      }
      configured.push({
        provider: model.provider,
        model: model.model,
        inputUsdPerMillion: Number(draft.input),
        outputUsdPerMillion: Number(draft.output),
        cacheReadUsdPerMillion: Number(draft.cacheRead),
        cacheWriteUsdPerMillion: Number(draft.cacheWrite),
      })
    }
    setBusy('accounting')
    setError(undefined)
    setNotice(undefined)
    try {
      const updated = await updateBudget({ scope: 'team', accounting: { mode, rates: configured } })
      onUpdated(updated)
      setNotice(mode !== budget.mode
        ? panelText('计量模式已切换，团队和成员已开始新预算周期；请设置新单位下的额度。', 'Accounting mode changed. The Team and members started new budget cycles; set limits in the new unit.')
        : panelText('模型计费配置已更新，从下一次模型调用开始生效。', 'Model accounting updated for the next model call.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法更新计量模式', 'Could not update accounting mode'))
    } finally {
      setBusy(undefined)
    }
  }

  const limitEditor = (scope: 'team' | 'member', member?: string): ReactElement => {
    const key = member ?? 'team'
    return jsxs('div', { className: 'dsh-fleet-panel-budget-actions', children: [
      jsx('input', {
        type: 'number', min: budget.mode === 'cost' ? 0.000001 : 1, step: budget.mode === 'cost' ? 0.01 : 1,
        inputMode: 'decimal', value: limits[key] ?? '',
        disabled: updateBudget === undefined || busy !== undefined,
        'aria-label': scope === 'team' ? panelText('团队预算上限', 'Team budget limit') : panelText('成员预算上限', 'Member budget limit'),
        placeholder: panelText('无限制', 'Unlimited'),
        onChange: (event: ChangeEvent<HTMLInputElement>) => { setLimits(current => ({ ...current, [key]: event.currentTarget.value })) },
      }),
      jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-inline-action', disabled: updateBudget === undefined || busy !== undefined, onClick: () => { void change(scope, member, false) }, children: busy === `save:${key}` ? panelText('正在保存…', 'Saving…') : panelText('应用', 'Apply') }),
      jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-secondary', disabled: updateBudget === undefined || busy !== undefined, onClick: () => { void change(scope, member, true) }, children: busy === `reset:${key}` ? panelText('正在重置…', 'Resetting…') : panelText('新周期', 'New cycle') }),
    ] })
  }

  return jsxs('section', { children: [
    jsx('h3', { children: panelText('预算', 'Budget') }),
    jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('团队共享总额度和成员独立额度同时生效。预算可以按 Token 倍率折算，也可以按模型详细价格累计实际成本。', 'The shared Team limit and each member limit apply together. Account with token multipliers or detailed model costs.') }),
    jsxs('div', { className: 'dsh-fleet-panel-budget-accounting', children: [
      jsxs('div', { className: 'dsh-fleet-panel-budget-mode', role: 'radiogroup', 'aria-label': panelText('预算计量模式', 'Budget accounting mode'), children: [
        jsx('button', { type: 'button', role: 'radio', 'aria-checked': mode === 'tokens', disabled: busy !== undefined, onClick: () => { setMode('tokens') }, children: panelText('Token × 倍率', 'Tokens × multiplier') }),
        jsx('button', { type: 'button', role: 'radio', 'aria-checked': mode === 'cost', disabled: busy !== undefined, onClick: () => { setMode('cost') }, children: panelText('成本', 'Cost') }),
      ] }),
      mode !== budget.mode && jsx('p', { className: 'dsh-fleet-panel-settings-error', role: 'status', children: panelText('切换计量模式会开始新周期，并清空当前团队与成员额度。', 'Changing accounting mode starts a new cycle and clears current Team and member limits.') }),
      models.length === 0
        ? jsx('p', { className: 'dsh-fleet-panel-settings-field-note', children: panelText('团队尚未配置可计费模型。', 'The Team has no configured models yet.') })
        : jsx('div', { className: 'dsh-fleet-panel-budget-rate-list', children: models.map(model => {
            const key = budgetModelKey(model.provider, model.model)
            const draft = rates[key] ?? { multiplier: '', input: '', output: '', cacheRead: '', cacheWrite: '' }
            return jsxs('div', { className: 'dsh-fleet-panel-budget-rate', children: [
              jsxs('div', { className: 'dsh-fleet-panel-budget-rate-name', children: [jsx('strong', { children: model.model }), jsx('small', { children: model.provider })] }),
              mode === 'tokens'
                ? jsxs('label', { children: [jsx('span', { children: panelText('倍率', 'Multiplier') }), jsx('input', { type: 'number', min: 0.000001, step: 0.1, value: draft.multiplier, placeholder: '1', disabled: busy !== undefined, onChange: (event: ChangeEvent<HTMLInputElement>) => { updateRate(key, 'multiplier', event.currentTarget.value) } })] })
                : jsx('div', { className: 'dsh-fleet-panel-budget-price-grid', children: ([['input', panelText('输入', 'Input')], ['output', panelText('输出', 'Output')], ['cacheRead', panelText('缓存读取', 'Cache read')], ['cacheWrite', panelText('缓存写入', 'Cache write')]] as const).map(([field, label]) => jsxs('label', { children: [jsx('span', { children: label }), jsx('input', { type: 'number', min: 0, step: 0.01, value: draft[field], placeholder: '$ / 1M', disabled: busy !== undefined, onChange: (event: ChangeEvent<HTMLInputElement>) => { updateRate(key, field, event.currentTarget.value) } })] }, field)) }),
            ] }, key)
          }) }),
      jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-inline-action', disabled: updateBudget === undefined || busy !== undefined, onClick: () => { void saveAccounting() }, children: busy === 'accounting' ? panelText('正在保存…', 'Saving…') : mode === budget.mode ? panelText('应用计费配置', 'Apply accounting') : panelText('切换并开始新周期', 'Switch and start new cycle') }),
    ] }),
    jsxs('div', { className: 'dsh-fleet-panel-budget-team', children: [
      jsxs('div', { className: 'dsh-fleet-panel-budget-title', children: [jsx('strong', { children: panelText('团队总额度', 'Team total') }), jsx('small', { children: panelText(`本周期 ${budget.team.calls} 次调用`, `${budget.team.calls} calls this cycle`) })] }),
      jsx(BudgetUsage, { account: budget.team, mode: budget.mode }),
      limitEditor('team'),
    ] }),
    jsxs('div', { className: 'dsh-fleet-panel-budget-members', children: [
      jsx('h4', { children: panelText('成员额度', 'Member limits') }),
      jsx('p', { className: 'dsh-fleet-panel-settings-field-note', children: panelText('成员新周期只清零该成员的独立计数，不会返还团队已用额度。团队助理也作为成员计费。', 'A member cycle clears only that member counter and does not refund Team usage. Team assistants are metered as members too.') }),
      ...budget.members.filter(member => member.active).map(member => jsxs('div', { className: 'dsh-fleet-panel-budget-member', children: [
        jsxs('div', { className: 'dsh-fleet-panel-budget-title', children: [
          jsxs('span', { children: [jsx('strong', { children: member.name }), jsx('small', { children: `${member.role}${member.assistant ? panelText(' · 助理', ' · Assistant') : ''}` })] }),
          jsx('small', { children: panelText(`${member.calls} 次调用`, `${member.calls} calls`) }),
        ] }),
        jsx(BudgetUsage, { account: member, mode: budget.mode }),
        limitEditor('member', member.memberId),
      ] }, member.memberId)),
    ] }),
    (budget.team.unmeteredCalls > 0 || budget.members.some(member => member.unmeteredCalls > 0)) && jsx('p', { className: 'dsh-fleet-panel-settings-error', role: 'status', children: panelText('部分模型调用没有返回 Token usage，已记录调用次数但无法计入 Token 总量。', 'Some model calls returned no token usage. Their call counts are recorded, but their tokens cannot be included.') }),
  ] })
}
