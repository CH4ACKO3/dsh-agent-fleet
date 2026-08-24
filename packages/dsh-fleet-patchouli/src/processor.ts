import type { Context } from '@deepseek-ai/cordis'

import type { MemoryPlugin, PatchouliCore } from './patchouli.js'

export const name = 'dsh-fleet-patchouli/processor'

const processor: MemoryPlugin = {
  id: 'dsh-fleet-patchouli',
  filter: call => call.meta.source.type === 'fleet',
  async update(request, context) {
    context.signal?.throwIfAborted()
    return {
      handled: false,
      reason: 'Fleet memory processing is not configured yet.',
      sourceType: request.meta.source.type,
      scope: request.meta.scope,
    }
  },
  async retrieve(request, context) {
    context.signal?.throwIfAborted()
    return {
      handled: false,
      reason: 'Fleet memory processing is not configured yet.',
      sourceType: request.meta.source.type,
      scope: request.meta.scope,
      items: [],
    }
  },
}

export function apply(ctx: Context): void {
  const host = ctx as unknown as {
    inject(
      services: readonly string[],
      callback: (scope: Context & { readonly patchouli: PatchouliCore }) => () => void,
    ): void
  }
  host.inject(['patchouli'], scope => scope.patchouli.register(processor))
}
