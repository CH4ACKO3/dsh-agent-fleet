import type { ComponentType } from 'react'

export const FLEET_MESSAGE_CONFIGURATION_MODULE = 'dsh-agent-fleet/message'
export const FLEET_RESOURCES_CONFIGURATION_MODULE = 'dsh-agent-fleet/resources'
export const FLEET_UI_CONFIGURATION_MODULE = 'dsh-agent-fleet/ui'

export interface FleetConfigurationModuleEditorProps {
  readonly value: unknown
  readonly onChange: (value: unknown) => void
}

export interface FleetConfigurationTemplateContribution {
  readonly id: string
  readonly nameZh: string
  readonly nameEn: string
  readonly sourceZh?: string
  readonly sourceEn?: string
  readonly configuration: unknown
}

export interface FleetConfigurationModuleContribution {
  readonly id: string
  readonly labelZh: string
  readonly labelEn: string
  readonly order?: number
  readonly defaultValue?: unknown
  readonly Editor?: ComponentType<FleetConfigurationModuleEditorProps>
  readonly templates?: readonly FleetConfigurationTemplateContribution[]
}

export class FleetConfigurationModuleRegistry {
  private readonly modules = new Map<string, FleetConfigurationModuleContribution>()
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly FleetConfigurationModuleContribution[] = []

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): readonly FleetConfigurationModuleContribution[] => this.snapshot

  register(contribution: FleetConfigurationModuleContribution): () => void {
    const id = contribution.id.trim()
    if (id.length === 0) throw new Error('Fleet configuration module id is required')
    if (this.modules.has(id)) throw new Error(`Fleet configuration module ${id} is already registered`)
    this.modules.set(id, contribution)
    this.publish()
    return () => {
      if (this.modules.get(id) !== contribution) return
      this.modules.delete(id)
      this.publish()
    }
  }

  valuesWithDefaults(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const result: Record<string, unknown> = structuredClone(values)
    for (const module of this.snapshot) {
      if (!(module.id in result) && module.defaultValue !== undefined) {
        result[module.id] = structuredClone(module.defaultValue)
      }
    }
    return result
  }

  private publish(): void {
    this.snapshot = [...this.modules.values()].sort((left, right) => (
      (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id)
    ))
    for (const listener of this.listeners) listener()
  }
}

export const fleetConfigurationModules = new FleetConfigurationModuleRegistry()
