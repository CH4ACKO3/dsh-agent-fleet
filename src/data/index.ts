import type { Context } from '@deepseek-ai/cordis'

import { applyDocuments } from './documents.js'

export * from './documents.js'

export function apply(ctx: Context): void {
  applyDocuments(ctx)
}
