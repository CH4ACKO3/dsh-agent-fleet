import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import type { FleetMemoryEffort } from './patchouli.js'

export const FLEET_PATCHOULI_SETTINGS_NAMESPACE = 'dsh-fleet-patchouli'

export interface FleetPatchouliSettings {
  effort: FleetMemoryEffort
  agent: boolean
}

export const DEFAULT_FLEET_PATCHOULI_SETTINGS: FleetPatchouliSettings = {
  effort: 'medium',
  agent: true,
}

export const FleetPatchouliSettings: z<FleetPatchouliSettings> = z.object({
  effort: z.union(['low', 'medium', 'high']).default('medium'),
  agent: z.boolean().default(true),
})

interface FleetPatchouliSettingsScope {
  get(): FleetPatchouliSettings
  watch(callback: (next: FleetPatchouliSettings) => void): () => void
}

interface SettingsHostContext extends Context {
  readonly settings: {
    register(
      namespace: string,
      schema: z<FleetPatchouliSettings>,
      options: { readonly base: Partial<FleetPatchouliSettings>; readonly applies: 'live' },
    ): FleetPatchouliSettingsScope
  }
}

export function installFleetPatchouliSettings(
  ctx: Context,
  base: Partial<FleetPatchouliSettings>,
  applySettings: (settings: FleetPatchouliSettings) => void,
): void {
  const host = ctx as Context & {
    inject(
      services: readonly string[],
      callback: (scope: SettingsHostContext) => (() => void) | void,
    ): void
  }
  host.inject(['settings'], (scope) => {
    const settings = scope.settings.register(
      FLEET_PATCHOULI_SETTINGS_NAMESPACE,
      FleetPatchouliSettings,
      { base, applies: 'live' },
    )
    applySettings(settings.get())
    return settings.watch(next => applySettings(next))
  })
}
