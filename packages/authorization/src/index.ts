import type { Context } from '@deepseek-ai/cordis'

import { applyAccess } from './access.js'
import { applyPermissions } from './permissions.js'

export * from './access.js'
export * from './permissions.js'

export const name = '@ch4acko3/dsh-agent-fleet-authorization'

export function apply(ctx: Context): void {
  applyPermissions(ctx)
  applyAccess(ctx)
}
