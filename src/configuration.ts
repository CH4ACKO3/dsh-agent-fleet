export const FLEET_MESSAGE_MODULE = 'dsh-agent-fleet/message'
export const FLEET_RESOURCES_MODULE = 'dsh-agent-fleet/resources'
export const FLEET_UI_MODULE = 'dsh-agent-fleet/ui'

export type FleetConfigurationValue =
  | null
  | boolean
  | number
  | string
  | FleetConfigurationValue[]
  | { [key: string]: FleetConfigurationValue }

export interface FleetConfigurationModule {
  readonly id: string
  parse(value: unknown): unknown
}

export interface FleetMessageConfiguration {
  readonly defaultChannel: { readonly id: string; readonly name: string }
  readonly rules: string
  readonly collaborationMethod: string
}

export interface FleetResourcesConfiguration {
  readonly policy: string
  readonly items: readonly {
    readonly path: string
    readonly label?: string
    readonly mediaType?: string
  }[]
}

export interface FleetUiConfiguration {
  readonly userAccess: {
    readonly updateDensity: 'concise' | 'balanced' | 'detailed'
    readonly notificationPolicy: 'decisions' | 'milestones' | 'continuous'
    readonly contentPreference: string
  }
  readonly editor?: FleetConfigurationValue
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`)
  return value.trim()
}

function optionalText(value: unknown, label: string): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value.trim()
}

export function fleetConfigurationValue(value: unknown, label = 'configuration'): FleetConfigurationValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} must contain finite numbers`)
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => fleetConfigurationValue(item, `${label}[${index}]`))
  const source = object(value, label)
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [
    key,
    fleetConfigurationValue(item, `${label}.${key}`),
  ]))
}

export function parseFleetMessageConfiguration(value: unknown): FleetMessageConfiguration {
  const input = object(value, FLEET_MESSAGE_MODULE)
  const channel = object(input.defaultChannel, `${FLEET_MESSAGE_MODULE}.defaultChannel`)
  return {
    defaultChannel: {
      id: requiredText(channel.id, `${FLEET_MESSAGE_MODULE}.defaultChannel.id`),
      name: requiredText(channel.name, `${FLEET_MESSAGE_MODULE}.defaultChannel.name`),
    },
    rules: optionalText(input.rules, `${FLEET_MESSAGE_MODULE}.rules`),
    collaborationMethod: optionalText(input.collaborationMethod, `${FLEET_MESSAGE_MODULE}.collaborationMethod`),
  }
}

export function parseFleetResourcesConfiguration(value: unknown): FleetResourcesConfiguration {
  const input = object(value, FLEET_RESOURCES_MODULE)
  if (!Array.isArray(input.items)) throw new Error(`${FLEET_RESOURCES_MODULE}.items must be an array`)
  return {
    policy: optionalText(input.policy, `${FLEET_RESOURCES_MODULE}.policy`),
    items: input.items.map((value, index) => {
      const item = object(value, `${FLEET_RESOURCES_MODULE}.items[${index}]`)
      const label = optionalText(item.label, `${FLEET_RESOURCES_MODULE}.items[${index}].label`)
      const mediaType = optionalText(item.mediaType, `${FLEET_RESOURCES_MODULE}.items[${index}].mediaType`)
      return {
        path: requiredText(item.path, `${FLEET_RESOURCES_MODULE}.items[${index}].path`),
        ...(label === '' ? {} : { label }),
        ...(mediaType === '' ? {} : { mediaType }),
      }
    }),
  }
}

export function parseFleetUiConfiguration(value: unknown): FleetUiConfiguration {
  const input = object(value, FLEET_UI_MODULE)
  const access = object(input.userAccess, `${FLEET_UI_MODULE}.userAccess`)
  const updateDensity = optionalText(access.updateDensity, `${FLEET_UI_MODULE}.userAccess.updateDensity`) || 'concise'
  const notificationPolicy = optionalText(access.notificationPolicy, `${FLEET_UI_MODULE}.userAccess.notificationPolicy`) || 'decisions'
  if (updateDensity !== 'concise' && updateDensity !== 'balanced' && updateDensity !== 'detailed') {
    throw new Error(`${FLEET_UI_MODULE}.userAccess.updateDensity is invalid`)
  }
  if (notificationPolicy !== 'decisions' && notificationPolicy !== 'milestones' && notificationPolicy !== 'continuous') {
    throw new Error(`${FLEET_UI_MODULE}.userAccess.notificationPolicy is invalid`)
  }
  return {
    userAccess: {
      updateDensity,
      notificationPolicy,
      contentPreference: optionalText(access.contentPreference, `${FLEET_UI_MODULE}.userAccess.contentPreference`),
    },
    ...(input.editor === undefined ? {} : { editor: fleetConfigurationValue(input.editor, `${FLEET_UI_MODULE}.editor`) }),
  }
}

export class FleetConfigurationRegistry {
  private readonly modules = new Map<string, FleetConfigurationModule>()

  constructor() {
    this.register({ id: FLEET_MESSAGE_MODULE, parse: parseFleetMessageConfiguration })
    this.register({ id: FLEET_RESOURCES_MODULE, parse: parseFleetResourcesConfiguration })
    this.register({ id: FLEET_UI_MODULE, parse: parseFleetUiConfiguration })
  }

  register(module: FleetConfigurationModule): () => void {
    const id = module.id.trim()
    if (id.length === 0) throw new Error('Fleet configuration module id is required')
    if (this.modules.has(id)) throw new Error(`Fleet configuration module ${id} is already registered`)
    this.modules.set(id, module)
    return () => {
      if (this.modules.get(id) === module) this.modules.delete(id)
    }
  }

  parse(value: unknown): Record<string, FleetConfigurationValue> {
    const input = object(value, 'modules')
    return Object.fromEntries(Object.entries(input).map(([id, raw]) => {
      const module = this.modules.get(id)
      return [id, module === undefined
        ? fleetConfigurationValue(raw, `modules.${id}`)
        : fleetConfigurationValue(module.parse(raw), `modules.${id}`)]
    }))
  }
}
