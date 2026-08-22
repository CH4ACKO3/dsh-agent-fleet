import { describe, expect, it } from 'vitest'

import {
  FLEET_MESSAGE_MODULE,
  FLEET_RESOURCES_MODULE,
  FLEET_UI_MODULE,
  FleetConfigurationRegistry,
} from '../src/configuration.js'
import { FleetConfigurationModuleRegistry } from '../packages/ui/src/configuration-modules.js'

function builtIns(): Record<string, unknown> {
  return {
    [FLEET_MESSAGE_MODULE]: {
      defaultChannel: { id: 'main', name: 'Main' },
      rules: '',
      collaborationMethod: '',
    },
    [FLEET_RESOURCES_MODULE]: { policy: '', items: [] },
    [FLEET_UI_MODULE]: {
      userAccess: { updateDensity: 'concise', notificationPolicy: 'decisions', contentPreference: '' },
    },
  }
}

describe('Fleet configuration modules', () => {
  it('lets installed Host modules parse their own block while preserving unknown modules', () => {
    const registry = new FleetConfigurationRegistry()
    registry.register({
      id: 'example/plugin',
      parse(value) {
        const input = value as { readonly enabled?: unknown }
        if (typeof input.enabled !== 'boolean') throw new Error('enabled is required')
        return { enabled: input.enabled }
      },
    })

    expect(registry.parse({
      ...builtIns(),
      'example/plugin': { enabled: true, ignored: 'removed by owner' },
      'not-installed/plugin': { nested: ['kept'] },
    })).toMatchObject({
      'example/plugin': { enabled: true },
      'not-installed/plugin': { nested: ['kept'] },
    })
  })

  it('publishes only setup-aware Host modules to the Team-building guide', () => {
    const registry = new FleetConfigurationRegistry()
    registry.register({
      id: 'example/plugin',
      setup: {
        description: 'Enable the example capability.',
        defaultValue: { enabled: true },
      },
      parse: value => value,
    })
    registry.register({ id: 'internal/plugin', parse: value => value })

    expect(registry.guideModules()).toEqual(expect.arrayContaining([{
      id: 'example/plugin',
      description: 'Enable the example capability.',
      defaultValue: { enabled: true },
    }]))
    expect(registry.guideModules().some(module => module.id === 'internal/plugin')).toBe(false)
  })

  it('publishes Client editors, defaults, and templates through one registry', () => {
    const registry = new FleetConfigurationModuleRegistry()
    const dispose = registry.register({
      id: 'example/plugin',
      labelZh: '示例',
      labelEn: 'Example',
      defaultValue: { enabled: true },
      templates: [{
        id: 'sample', nameZh: '示例团队', nameEn: 'Sample Team', configuration: { core: {}, modules: {} },
      }],
    })

    expect(registry.getSnapshot()).toHaveLength(1)
    expect(registry.valuesWithDefaults({})).toEqual({
      'example/plugin': { enabled: true },
    })
    dispose()
    expect(registry.getSnapshot()).toEqual([])
  })
})
