import type { Context } from '@deepseek-ai/cordis'

import { applyDocuments } from './documents.js'
import { applyWorkspaces } from './workspaces.js'

export * from './documents.js'
export * from './workspaces.js'

export function apply(ctx: Context): void {
  applyDocuments(ctx)
  applyWorkspaces(ctx)
}
