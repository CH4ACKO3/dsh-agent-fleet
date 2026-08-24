import type { Context } from '@deepseek-ai/cordis'

import * as Adapter from './adapter.js'
import * as Processor from './processor.js'

export { Adapter, Processor }
export * from './patchouli.js'

export const name = 'dsh-fleet-patchouli'

export function apply(ctx: Context): void {
  ctx.plugin(Processor)
  ctx.plugin(Adapter)
}
