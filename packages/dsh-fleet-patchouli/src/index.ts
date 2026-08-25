import type { Context } from '@deepseek-ai/cordis'

import * as Adapter from './adapter.js'
import * as Processor from './processor.js'

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

export function apply(ctx: Context): void {
  ctx.plugin(Processor)
  ctx.plugin(Adapter)
}
