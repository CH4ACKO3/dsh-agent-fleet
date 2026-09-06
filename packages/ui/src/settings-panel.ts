/**
 * Settings, import, and end-team dialogs for the Fleet UI.
 *
 * Dialog-domain code kept in one module with the same external behaviour.
 */
import type { ChangeEvent, FocusEvent, KeyboardEvent, ReactElement } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { PanelIcon } from './panel-icons.js'
import { panelText, type TeamSettingsTab } from './panel-utils.js'
import {
  type FleetPanelArchiveFile,
  type FleetPanelBudgetInput,
  type FleetPanelTeamBudget,
  type FleetPanelTeamRequestInput,
  type FleetPanelTeamSettings,
  type FleetPanelTeamSettingsInput,
  type FleetPanelTeamSummary,
  type FleetPanelSource,
  BudgetSettings,
  downloadFleetBlob,
  downloadFleetTeamConfiguration,
  useFleetPanelModelDirectory,
} from './team-panel.js'

// ---------------------------------------------------------------------------
// TeamSettingsDialog
// ---------------------------------------------------------------------------

export function TeamSettingsDialog({ sessionId, team, initialTab = 'general', loadSettings, updateSettings, updateBudget, configureRequest, exportTeam, exportArchive, finishTeam, onClose }: {
  readonly sessionId: string
  readonly team: FleetPanelTeamSummary
  readonly initialTab?: TeamSettingsTab
  readonly loadSettings?: FleetPanelSource['loadTeamSettings']
  readonly updateSettings?: (settings: FleetPanelTeamSettingsInput['settings']) => Promise<FleetPanelTeamSettings>
  readonly updateBudget?: (input: Omit<FleetPanelBudgetInput, 'sessionId' | 'teamId'>) => Promise<FleetPanelTeamBudget>
  readonly configureRequest?: (request: FleetPanelTeamRequestInput['request']) => Promise<void>
  readonly exportTeam?: FleetPanelSource['exportTeam']
  readonly exportArchive?: (teamId: string, includeWorkspace: boolean) => Promise<FleetPanelArchiveFile>
  readonly finishTeam?: (summary: string) => Promise<void>
  readonly onClose: () => void
}): ReactElement {
  const dialog = useRef<HTMLElement>(null)
  const [tab, setTab] = useState<TeamSettingsTab>(initialTab)
  const [settings, setSettings] = useState<FleetPanelTeamSettings>()
  const [savedSettings, setSavedSettings] = useState<FleetPanelTeamSettings>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [configurationExporting, setConfigurationExporting] = useState(false)
  const [archiveExporting, setArchiveExporting] = useState(false)
  const [includeWorkspace, setIncludeWorkspace] = useState(false)
  const [modelKey, setModelKey] = useState('')
  const [providerName, setProviderName] = useState('')
  const [modelName, setModelName] = useState('')
  const [modelDirty, setModelDirty] = useState(false)
  const [effort, setEffort] = useState('')
  const [effortDirty, setEffortDirty] = useState(false)
  const [maxTokens, setMaxTokens] = useState('')
  const [maxTokensDirty, setMaxTokensDirty] = useState(false)
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [modelDirectory, modelDirectoryState] = useFleetPanelModelDirectory(sessionId)

  const load = useCallback(async (): Promise<void> => {
    if (loadSettings === undefined) {
      setLoading(false)
      setError(panelText('当前 Fleet 实例不支持运行期团队设置。', 'This Fleet instance does not support runtime Team settings.'))
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const value = await loadSettings(team.teamId)
      setSettings(value)
      setSavedSettings(value)
      setModelKey(value.request.mixed.model || value.request.provider === undefined || value.request.model === undefined
        ? ''
        : JSON.stringify([value.request.provider, value.request.model]))
      setProviderName(value.request.mixed.model ? '' : value.request.provider ?? '')
      setModelName(value.request.mixed.model ? '' : value.request.model ?? '')
      setEffort(value.request.mixed.reasoningEffort ? '' : value.request.reasoningEffort ?? '')
      setMaxTokens(value.request.mixed.maxTokens ? '' : value.request.maxTokens?.toString() ?? '')
      setModelDirty(false)
      setEffortDirty(false)
      setMaxTokensDirty(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法读取团队设置', 'Could not load Team settings'))
    } finally {
      setLoading(false)
    }
  }, [loadSettings, team.teamId])

  useEffect(() => { void load() }, [load])

  const downloadConfiguration = async (): Promise<void> => {
    if (exportTeam === undefined || configurationExporting) return
    setConfigurationExporting(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const configuration = await exportTeam(team.teamId)
      downloadFleetTeamConfiguration(settings?.name ?? team.teamName, configuration)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('团队导出失败', 'Team export failed'))
    } finally {
      setConfigurationExporting(false)
    }
  }

  const downloadArchive = async (): Promise<void> => {
    if (exportArchive === undefined || archiveExporting || team.status !== 'paused') return
    setArchiveExporting(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const archive = await exportArchive(team.teamId, includeWorkspace)
      downloadFleetBlob(archive.blob, archive.name)
      setNotice(panelText('团队存档已导出。', 'Team archive exported.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('团队存档导出失败', 'Team archive export failed'))
    } finally {
      setArchiveExporting(false)
    }
  }

  const profile = (value: FleetPanelTeamSettings): FleetPanelTeamSettingsInput['settings'] => ({
    name: value.name,
    positioning: value.positioning,
    rules: value.rules,
    collaborationMethod: value.collaborationMethod,
    visibilityReminderContextGrowthTokens: value.visibilityReminderContextGrowthTokens,
    updateDensity: value.updateDensity,
    notificationPolicy: value.notificationPolicy,
    contentPreference: value.contentPreference,
  })
  const profileDirty = settings !== undefined && savedSettings !== undefined
    && JSON.stringify(profile(settings)) !== JSON.stringify(profile(savedSettings))
  const manualModelEntry = modelDirectory === undefined
    || (modelDirectoryState.status === 'error' && modelDirectoryState.groups.length === 0)

  const saveProfile = async (): Promise<void> => {
    if (settings === undefined || updateSettings === undefined || saving || settings.name.trim() === '') return
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const updated = await updateSettings(profile(settings))
      setSettings(updated)
      setSavedSettings(updated)
      setNotice(panelText('团队设置已保存；已加载成员将在下一次模型调用中接收更新。', 'Team settings saved. Loaded members will receive the update on their next model call.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法保存团队设置', 'Could not save Team settings'))
    } finally {
      setSaving(false)
    }
  }

  const saveRequest = async (): Promise<void> => {
    if (configureRequest === undefined || saving || (!modelDirty && !effortDirty && !maxTokensDirty)) return
    const request: FleetPanelTeamRequestInput['request'] = {}
    if (modelDirty) {
      if (manualModelEntry) {
        if (providerName.trim() === '' || modelName.trim() === '') {
          setError(panelText('Provider 和模型名称都不能为空。', 'Provider and model name are both required.'))
          return
        }
        Object.assign(request, { provider: providerName.trim(), model: modelName.trim() })
      } else {
        const selected = modelDirectoryState.groups.flatMap(group => group.models.map(model => ({
          key: JSON.stringify([group.id, model.id]), provider: group.id, model: model.id,
        }))).find(choice => choice.key === modelKey)
        if (selected === undefined) return
        Object.assign(request, { provider: selected.provider, model: selected.model })
      }
    }
    if (effortDirty) Object.assign(request, { reasoningEffort: effort === '' ? null : effort })
    if (maxTokensDirty) {
      const normalized = maxTokens.trim()
      if (normalized !== '' && (!Number.isSafeInteger(Number(normalized)) || Number(normalized) <= 0)) {
        setError(panelText('最大 Token 必须是正整数。', 'Maximum tokens must be a positive integer.'))
        return
      }
      Object.assign(request, { maxTokens: normalized === '' ? null : Number(normalized) })
    }
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await configureRequest(request)
      await load()
      setNotice(panelText('整队模型配置已更新，从下一次模型调用开始生效。', 'Team model configuration updated. It takes effect on the next model call.'))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('无法更新整队模型配置', 'Could not update Team model configuration'))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus()
    }
  }, [onClose])

  return jsx('div', {
    className: 'dsh-fleet-panel-settings-overlay',
    children: jsxs('section', {
      ref: dialog,
      className: 'dsh-fleet-panel-settings-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': panelText(`${settings?.name ?? team.teamName} 团队设置`, `${settings?.name ?? team.teamName} Team settings`),
      tabIndex: -1,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'Tab') return
        const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'))
        const first = focusable[0]
        const last = focusable.at(-1)
        if (first === undefined || last === undefined) return
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      },
      children: [
        jsxs('header', {
          className: 'dsh-fleet-panel-settings-head',
          children: [
            jsx('h2', {
              className: 'dsh-fleet-panel-settings-title',
              children: panelText(`${settings?.name ?? team.teamName} · 团队设置`, `${settings?.name ?? team.teamName} · Team settings`),
            }),
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-settings-close',
              'aria-label': panelText('关闭团队设置', 'Close Team settings'),
              title: panelText('关闭', 'Close'),
              onClick: onClose,
              children: jsx(PanelIcon, { name: 'close', size: 16 }),
            }),
          ],
        }),
        loading ? jsx('div', { className: 'dsh-fleet-panel-settings-empty', children: panelText('正在读取团队设置…', 'Loading Team settings…') }) : jsxs('div', {
          className: 'dsh-fleet-panel-settings-workspace',
          children: [
            jsx('nav', {
              className: 'dsh-fleet-panel-settings-nav',
              'aria-label': panelText('团队设置分区', 'Team settings sections'),
              children: ([
                ['general', panelText('常规', 'General')], ['model', panelText('模型与推理', 'Model & reasoning')],
                ['budget', panelText('预算', 'Budget')],
                ['access', panelText('用户接入', 'User access')], ['collaboration', panelText('协作约定', 'Collaboration')],
                ['data', panelText('数据与存档', 'Data & archives')], ['danger', panelText('危险操作', 'Danger zone')],
              ] as const).map(([id, label]) => jsx('button', {
                type: 'button', className: 'dsh-fleet-panel-settings-nav-item',
                'aria-current': tab === id ? 'page' : undefined,
                'data-danger': id === 'danger' ? 'true' : undefined,
                onClick: () => { setTab(id); setError(undefined); setNotice(undefined) }, children: label,
              }, id)),
            }),
            jsx('div', {
              className: 'dsh-fleet-panel-settings-content',
              children: settings === undefined ? jsx('p', { className: 'dsh-fleet-panel-settings-error', children: error })
                : tab === 'general' ? jsxs('section', { children: [
                  jsx('h3', { children: panelText('常规', 'General') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('修改团队在 Fleet 中的名称与长期定位；稳定的 Team ID 不会改变。', 'Change how the Team is named and positioned in Fleet. Its stable Team ID does not change.') }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('团队名称', 'Team name') }), jsx('input', { value: settings.name, onChange: (event: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, name: event.currentTarget.value }) })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('团队定位', 'Team positioning') }), jsx('textarea', { value: settings.positioning, rows: 5, placeholder: panelText('描述团队长期负责什么，以及不负责什么', 'Describe what the Team owns over time and what it does not own'), onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setSettings({ ...settings, positioning: event.currentTarget.value }) })] }),
                  jsxs('dl', { className: 'dsh-fleet-panel-settings-facts', children: [jsx('dt', { children: 'Team ID' }), jsx('dd', { children: team.teamId }), jsx('dt', { children: panelText('主要工作区', 'Primary Workspace') }), jsx('dd', { children: settings.projectRoot })] }),
                ] }) : tab === 'access' ? jsxs('section', { children: [
                  jsx('h3', { children: panelText('用户接入', 'User access') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('控制团队向你汇报的详细程度、通知时机和内容表达偏好。', 'Control how much detail the Team reports, when it notifies you, and how it presents content.') }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('更新详细度', 'Update detail') }), jsx('select', { value: settings.updateDensity, onChange: (event: ChangeEvent<HTMLSelectElement>) => setSettings({ ...settings, updateDensity: event.currentTarget.value as FleetPanelTeamSettings['updateDensity'] }), children: [jsx('option', { value: 'concise', children: panelText('简洁', 'Concise') }), jsx('option', { value: 'balanced', children: panelText('均衡', 'Balanced') }), jsx('option', { value: 'detailed', children: panelText('详细', 'Detailed') })] })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('通知时机', 'Notification timing') }), jsx('select', { value: settings.notificationPolicy, onChange: (event: ChangeEvent<HTMLSelectElement>) => setSettings({ ...settings, notificationPolicy: event.currentTarget.value as FleetPanelTeamSettings['notificationPolicy'] }), children: [jsx('option', { value: 'decisions', children: panelText('仅需决策时', 'Decisions only') }), jsx('option', { value: 'milestones', children: panelText('重要里程碑', 'Important milestones') }), jsx('option', { value: 'continuous', children: panelText('持续更新', 'Continuous updates') })] })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('内容偏好', 'Content preference') }), jsx('textarea', { value: settings.contentPreference, rows: 5, placeholder: panelText('例如：结论优先，技术细节按需展开', 'For example: lead with conclusions and expand technical detail on demand'), onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setSettings({ ...settings, contentPreference: event.currentTarget.value }) })] }),
                ] }) : tab === 'collaboration' ? jsxs('section', { children: [
                  jsx('h3', { children: panelText('协作约定', 'Collaboration') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('这些约定会作为团队长期指导，并发送给当前已加载的成员。', 'These agreements become durable Team guidance and are sent to currently loaded members.') }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('规则与偏好', 'Rules and preferences') }), jsx('textarea', { value: settings.rules, rows: 6, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setSettings({ ...settings, rules: event.currentTarget.value }) })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('协作方式', 'Collaboration method') }), jsx('textarea', { value: settings.collaborationMethod, rows: 7, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setSettings({ ...settings, collaborationMethod: event.currentTarget.value }) })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('可见性提醒首个增量（Token）', 'First visibility reminder growth (tokens)') }), jsx('input', { type: 'number', min: 0, step: 1000, value: settings.visibilityReminderContextGrowthTokens, onChange: (event: ChangeEvent<HTMLInputElement>) => setSettings({ ...settings, visibilityReminderContextGrowthTokens: Number(event.currentTarget.value) }) }), jsx('small', { children: panelText('初始及压缩后首个上下文只建立基线；之后未共享输出的提醒间隔按 1×、2×、4× 递增。0 表示关闭。', 'The initial and first post-compaction context only establish a baseline; later unshared-output reminder intervals grow by 1×, 2×, and 4×. 0 disables them.') })] }),
                ] }) : tab === 'model' ? jsxs('section', { children: [
                  jsx('h3', { children: panelText('模型与推理', 'Model & reasoning') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('统一修改普通成员和团队助理；不会暂停或重启 Agent，从下一次模型调用开始生效。', 'Apply one configuration to members and Team assistants without pausing or restarting Agents. It takes effect on the next model call.') }),
                  manualModelEntry ? jsxs('div', { className: 'dsh-fleet-panel-settings-model-grid', children: [
                    jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: 'Provider' }), jsx('input', { value: providerName, placeholder: settings.request.mixed.model && !modelDirty ? panelText('当前成员配置不一致', 'Current member settings differ') : 'provider-id', onChange: (event: ChangeEvent<HTMLInputElement>) => { setProviderName(event.currentTarget.value); setModelDirty(true) } })] }),
                    jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('模型名称', 'Model name') }), jsx('input', { value: modelName, placeholder: settings.request.mixed.model && !modelDirty ? panelText('当前成员配置不一致', 'Current member settings differ') : 'deepseek-v4-flash', onChange: (event: ChangeEvent<HTMLInputElement>) => { setModelName(event.currentTarget.value); setModelDirty(true) } })] }),
                  ] }) : jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('模型', 'Model') }), jsx('select', { value: modelKey, disabled: modelDirectoryState.status === 'loading', onChange: (event: ChangeEvent<HTMLSelectElement>) => { setModelKey(event.currentTarget.value); setModelDirty(true) }, children: [
                    settings.request.mixed.model && !modelDirty && jsx('option', { value: '', children: panelText('当前成员配置不一致', 'Current member settings differ') }),
                    !settings.request.mixed.model && modelKey !== '' && jsx('option', { value: modelKey, children: `${settings.request.provider ?? '—'} · ${settings.request.model ?? '—'}` }),
                    ...modelDirectoryState.groups.map(group => jsx('optgroup', { label: group.name, children: group.models.map(model => jsx('option', { value: JSON.stringify([group.id, model.id]), children: model.name }, model.id)) }, group.id)),
                  ] })] }),
                  manualModelEntry && jsx('p', { className: 'dsh-fleet-panel-settings-field-note', children: panelText('当前实例未提供模型目录，请填写 DSH 中已配置的 Provider 和模型标识。', 'This instance does not provide a model catalog. Enter a Provider and model identifier configured in DSH.') }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('推理强度', 'Reasoning effort') }), jsx('select', { value: effort, onChange: (event: ChangeEvent<HTMLSelectElement>) => { setEffort(event.currentTarget.value); setEffortDirty(true) }, children: [settings.request.mixed.reasoningEffort && !effortDirty && jsx('option', { value: '', children: panelText('当前成员配置不一致', 'Current member settings differ') }), !settings.request.mixed.reasoningEffort && jsx('option', { value: '', children: panelText('使用模型默认值', 'Use model default') }), ...['low', 'medium', 'high', 'xhigh', 'max'].map(value => jsx('option', { value, children: value }, value))] })] }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('最大 Token', 'Maximum tokens') }), jsx('input', { type: 'number', min: 1, step: 1, value: maxTokens, placeholder: settings.request.mixed.maxTokens && !maxTokensDirty ? panelText('当前成员配置不一致', 'Current member settings differ') : panelText('使用模型默认值', 'Use model default'), onChange: (event: ChangeEvent<HTMLInputElement>) => { setMaxTokens(event.currentTarget.value); setMaxTokensDirty(true) } })] }),
                  modelDirectoryState.status === 'error' && jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-inline-action', onClick: () => { void modelDirectory?.load() }, children: panelText('重新读取模型目录', 'Reload model catalog') }),
                ] }) : tab === 'budget' ? jsx(BudgetSettings, {
                  budget: settings.budget,
                  updateBudget,
                  onUpdated: (budget: FleetPanelTeamBudget) => {
                    setSettings(current => current === undefined ? current : { ...current, budget })
                    setSavedSettings(current => current === undefined ? current : { ...current, budget })
                  },
                  setError,
                  setNotice,
                }) : tab === 'data' ? jsxs('section', { children: [
                  jsx('h3', { children: panelText('数据与存档', 'Data & archives') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('配置导出用于创建同类团队；完整存档包含运行上下文和插件数据。', 'Configuration export creates similar Teams. A complete archive includes runtime context and plugin data.') }),
                  jsxs('div', { className: 'dsh-fleet-panel-settings-action-row', children: [jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-export', disabled: exportTeam === undefined || configurationExporting, onClick: () => { void downloadConfiguration() }, children: [jsx(PanelIcon, { name: 'download', size: 16 }), configurationExporting ? panelText('正在导出…', 'Exporting…') : panelText('导出团队配置', 'Export Team configuration')] })] }),
                  jsx('hr', {}),
                  jsx('h4', { children: panelText('完整团队存档', 'Complete Team archive') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: team.status === 'paused'
                    ? panelText('团队已暂停，可以生成一致的完整存档。', 'The Team is paused and ready for a consistent archive.')
                    : team.status === 'closed'
                      ? panelText('团队已终结，仍可保存完整运行记录；导入后会以暂停状态打开。', 'The Team is finished, but its complete run record can still be archived and will import as paused.')
                      : panelText('请先在团队概况中暂停或终结团队，再导出完整存档。', 'Pause or finish the Team from its overview before exporting a complete archive.') }),
                  jsxs('label', { className: 'dsh-fleet-panel-settings-check', children: [jsx('input', { type: 'checkbox', checked: includeWorkspace, disabled: archiveExporting, onChange: (event: ChangeEvent<HTMLInputElement>) => { setIncludeWorkspace(event.currentTarget.checked) } }), jsx('span', { children: panelText('同时打包工作区文件', 'Include Workspace files') })] }),
                  jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-export', disabled: (team.status !== 'paused' && team.status !== 'closed') || exportArchive === undefined || archiveExporting, title: team.status === 'paused' || team.status === 'closed' ? undefined : panelText('请先暂停或终结团队', 'Pause or finish the Team first'), onClick: () => { void downloadArchive() }, children: [jsx(PanelIcon, { name: 'download', size: 16 }), archiveExporting ? panelText('正在生成存档…', 'Creating archive…') : panelText('导出完整存档', 'Export complete archive')] }),
                ] }) : jsxs('section', { className: 'dsh-fleet-panel-settings-danger', children: [
                  jsx('h3', { children: panelText('危险操作', 'Danger zone') }),
                  jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('终结后团队进入归档，成员会话和历史记录仍会保留，但不能继续运行。', 'Finishing archives the Team. Member Sessions and history remain, but the Team can no longer run.') }),
                  jsx('button', { type: 'button', disabled: finishTeam === undefined, onClick: () => { setEnding(true) }, children: panelText('终结团队', 'Finish Team') }),
                ] }),
            }),
          ],
        }),
        !loading && jsxs('footer', { className: 'dsh-fleet-panel-settings-footer', children: [
          jsxs('div', { className: 'dsh-fleet-panel-settings-feedback', children: [error !== undefined && jsx('span', { 'data-error': 'true', role: 'alert', children: error }), notice !== undefined && jsx('span', { role: 'status', children: notice })] }),
          jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-secondary', onClick: onClose, children: panelText('关闭', 'Close') }),
          (tab === 'general' || tab === 'access' || tab === 'collaboration') && jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-primary', disabled: !profileDirty || saving || settings?.name.trim() === '' || updateSettings === undefined, onClick: () => { void saveProfile() }, children: saving ? panelText('正在保存…', 'Saving…') : panelText('保存设置', 'Save settings') }),
          tab === 'model' && jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-primary', disabled: saving || (!modelDirty && !effortDirty && !maxTokensDirty) || configureRequest === undefined, onClick: () => { void saveRequest() }, children: saving ? panelText('正在应用…', 'Applying…') : panelText('应用到整队', 'Apply to Team') }),
        ] }),
        ending && finishTeam !== undefined && jsx(EndTeamDialog, { teamName: settings?.name ?? team.teamName, onClose: () => { setEnding(false) }, onConfirm: finishTeam }),
      ],
    }),
  })
}

// ---------------------------------------------------------------------------
// TeamImportDialog
// ---------------------------------------------------------------------------

export function TeamImportDialog({ importArchive, onClose }: {
  readonly importArchive: (file: File, projectRoot: string, mode: 'copy' | 'restore') => Promise<void>
  readonly onClose: () => void
}): ReactElement {
  const dialog = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'copy' | 'restore'>('copy')
  const [root, setRoot] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const importFile = async (file: File): Promise<void> => {
    if (busy || root.trim() === '') return
    setBusy(true); setError(undefined)
    try { await importArchive(file, root.trim(), mode); onClose() } catch (reason) {
      setError(reason instanceof Error ? reason.message : panelText('团队存档导入失败', 'Team archive import failed'))
    } finally { setBusy(false); if (input.current !== null) input.current.value = '' }
  }

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.focus()
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus()
    }
  }, [busy, onClose])

  return jsx('div', { className: 'dsh-fleet-panel-settings-overlay', children: jsxs('section', { ref: dialog, className: 'dsh-fleet-panel-settings-dialog dsh-fleet-panel-import-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': panelText('导入团队', 'Import Team'), tabIndex: -1, onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (first === undefined || last === undefined) return
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault(); last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus()
    }
  }, children: [
    jsxs('header', { className: 'dsh-fleet-panel-settings-head', children: [jsx('h2', { className: 'dsh-fleet-panel-settings-title', children: panelText('导入团队', 'Import Team') }), jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-close', 'aria-label': panelText('关闭导入', 'Close import'), onClick: onClose, children: jsx(PanelIcon, { name: 'close', size: 16 }) })] }),
    jsxs('div', { className: 'dsh-fleet-panel-settings-body', children: [
      jsx('p', { className: 'dsh-fleet-panel-settings-section-copy', children: panelText('从完整团队存档创建副本，或在当前实例中恢复原团队身份。', 'Create a copy from a complete Team archive, or restore its original identity in this instance.') }),
      jsxs('fieldset', { className: 'dsh-fleet-panel-settings-import-mode', disabled: busy, children: [jsx('legend', { children: panelText('导入方式', 'Import mode') }), ...([['copy', panelText('创建为新团队', 'Create as new Team'), panelText('分配新的团队和成员身份。', 'Assign new Team and member identities.')], ['restore', panelText('恢复原团队', 'Restore original Team'), panelText('保留存档中的原始身份。', 'Keep the original archived identities.')]] as const).map(([value, title, copy]) => jsxs('label', { className: 'dsh-fleet-panel-settings-import-choice', children: [jsx('input', { type: 'radio', name: 'fleet-import-mode', checked: mode === value, onChange: () => { setMode(value) } }), jsxs('span', { children: [jsx('strong', { children: title }), jsx('small', { children: copy })] })] }, value))] }),
      jsxs('label', { className: 'dsh-fleet-panel-settings-form-field', children: [jsx('span', { children: panelText('目标工作区路径', 'Destination Workspace path') }), jsx('input', { value: root, disabled: busy, placeholder: '/path/to/project', onChange: (event: ChangeEvent<HTMLInputElement>) => { setRoot(event.currentTarget.value) } })] }),
      jsx('input', { ref: input, className: 'dsh-fleet-panel-settings-file-input', type: 'file', accept: '.fleet.tar.gz,.tar.gz,.tgz,application/gzip', onChange: (event: ChangeEvent<HTMLInputElement>) => { const file = event.currentTarget.files?.[0]; if (file !== undefined) void importFile(file) } }),
      error !== undefined && jsx('p', { className: 'dsh-fleet-panel-settings-error', role: 'alert', children: error }),
    ] }),
    jsxs('footer', { className: 'dsh-fleet-panel-settings-footer', children: [jsx('span', { className: 'dsh-fleet-panel-settings-feedback' }), jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-secondary', disabled: busy, onClick: onClose, children: panelText('取消', 'Cancel') }), jsx('button', { type: 'button', className: 'dsh-fleet-panel-settings-primary', disabled: busy || root.trim() === '', onClick: () => { input.current?.click() }, children: busy ? panelText('正在导入…', 'Importing…') : panelText('选择存档', 'Choose archive') })] }),
  ] }) })
}

// ---------------------------------------------------------------------------
// EndTeamDialog
// ---------------------------------------------------------------------------

export function EndTeamDialog({ teamName, onClose, onConfirm }: {
  readonly teamName: string
  readonly onClose: () => void
  readonly onConfirm: (summary: string) => Promise<void>
}): ReactElement {
  const dialog = useRef<HTMLElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [summary, setSummary] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    input.current?.focus()
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || submitting) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      previousFocus?.focus()
    }
  }, [onClose, submitting])

  const confirm = (): void => {
    const reason = summary.trim()
    if (reason === '' || submitting) return
    setSubmitting(true)
    setError(undefined)
    void onConfirm(reason).then(onClose).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : panelText('无法终结团队', 'Could not finish Team'))
    }).finally(() => { setSubmitting(false) })
  }

  return jsx('div', {
    className: 'dsh-fleet-panel-settings-overlay',
    children: jsxs('section', {
      ref: dialog,
      className: 'dsh-fleet-panel-settings-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': panelText(`终结 ${teamName}`, `Finish ${teamName}`),
      tabIndex: -1,
      children: [
        jsxs('header', {
          className: 'dsh-fleet-panel-settings-head',
          children: [
            jsx('h2', { className: 'dsh-fleet-panel-settings-title', children: panelText(`终结 ${teamName}`, `Finish ${teamName}`) }),
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-settings-close',
              'aria-label': panelText('取消终结团队', 'Cancel finishing Team'),
              disabled: submitting,
              onClick: onClose,
              children: jsx(PanelIcon, { name: 'close', size: 16 }),
            }),
          ],
        }),
        jsxs('div', {
          className: 'dsh-fleet-panel-control-dialog-body',
          children: [
            jsx('p', {
              className: 'dsh-fleet-panel-control-dialog-copy',
              children: panelText('终结会结束当前工作并关闭团队成员。团队记录仍会保留在已归档列表中，但不能继续运行。', 'Finishing ends current work and closes Team members. Team records remain in the archived list but cannot resume.'),
            }),
            jsxs('label', {
              className: 'dsh-fleet-panel-control-dialog-label',
              children: [
                panelText('终结摘要', 'Finish summary'),
                jsx('textarea', {
                  ref: input,
                  className: 'dsh-fleet-panel-control-dialog-input',
                  value: summary,
                  disabled: submitting,
                  placeholder: panelText('说明终结原因和需要保留的状态', 'Explain why the Team is finishing and what state should be preserved'),
                  onChange: (event: { readonly currentTarget: { readonly value: string } }) => { setSummary(event.currentTarget.value) },
                }),
              ],
            }),
            error !== undefined && jsx('p', { className: 'dsh-fleet-panel-control-error', role: 'alert', children: error }),
          ],
        }),
        jsxs('div', {
          className: 'dsh-fleet-panel-control-dialog-actions',
          children: [
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-control-button',
              disabled: submitting,
              onClick: onClose,
              children: panelText('取消', 'Cancel'),
            }),
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-control-button',
              'data-danger': 'true',
              disabled: submitting || summary.trim() === '',
              onClick: confirm,
              children: submitting ? panelText('正在终结…', 'Finishing…') : panelText('终结团队', 'Finish Team'),
            }),
          ],
        }),
      ],
    }),
  })
}
