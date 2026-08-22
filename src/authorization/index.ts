import type { Context } from '@deepseek-ai/cordis'

import { applyAccess } from './access.js'
import { applyGroups } from './groups.js'
import { applyPermissions } from './permissions.js'

export * from './access.js'
export * from './groups.js'
export * from './permissions.js'

export function apply(ctx: Context): void {
  applyGroups(ctx)
  applyPermissions(ctx)
  applyAccess(ctx)
}
