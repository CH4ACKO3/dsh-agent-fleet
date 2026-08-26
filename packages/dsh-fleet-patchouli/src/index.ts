import type { Context } from '@deepseek-ai/cordis'

import * as Adapter from './adapter.js'
import * as Processor from './processor.js'
import {
  DEFAULT_FLEET_PATCHOULI_SETTINGS,
  installFleetPatchouliSettings,
  type FleetPatchouliSettings,
} from './settings.js'

export { Adapter, Processor }
export {
  createFleetGitContextAlgorithm,
  FLEET_GIT_CONTEXT_ALGORITHM_ID,
} from './git-context.js'
export {
  createFleetHistorySearchAlgorithm,
  FLEET_HISTORY_SEARCH_ALGORITHM_ID,
} from './history-search.js'
export type { FleetHistorySearchItem } from './history-search.js'
export * from './patchouli.js'
export * from './settings.js'
export {
  createFleetSelfHistoryAlgorithm,
  FLEET_SELF_HISTORY_ALGORITHM_ID,
} from './self-history.js'
export {
  createFleetSharedResourcesAlgorithm,
  FLEET_SHARED_RESOURCES_ALGORITHM_ID,
} from './shared-resources.js'
export {
  createFleetTeamActivityAlgorithm,
  FLEET_TEAM_ACTIVITY_ALGORITHM_ID,
} from './team-activity.js'
export {
  createFleetTeamStateAlgorithm,
  FLEET_TEAM_STATE_ALGORITHM_ID,
} from './team-state.js'

export const name = 'dsh-fleet-patchouli'

export type Config = Partial<FleetPatchouliSettings>

export function apply(ctx: Context, config: Config = {}): void {
  let settings = { ...DEFAULT_FLEET_PATCHOULI_SETTINGS, ...config }
  installFleetPatchouliSettings(ctx, config, next => { settings = next })
  ctx.plugin(Processor, { settings: () => settings })
  ctx.plugin(Adapter)
}
