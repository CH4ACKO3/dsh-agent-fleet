export type FieldPresetTarget = 'positioning' | 'rules' | 'collaboration' | 'content' | 'resources'

export interface FieldContentPreset {
  readonly id: string
  readonly name: readonly [zh: string, en: string]
  readonly detail: readonly [zh: string, en: string]
}

export type FieldPresetCollection = Readonly<Record<FieldPresetTarget, readonly FieldContentPreset[]>>
export type FieldPresetImport = Readonly<Partial<Record<FieldPresetTarget, readonly FieldContentPreset[]>>>

const TARGETS: readonly FieldPresetTarget[] = ['positioning', 'rules', 'collaboration', 'content', 'resources']

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function localizedText(value: unknown): value is readonly [string, string] {
  return Array.isArray(value)
    && value.length === 2
    && value.every(item => typeof item === 'string' && item.trim().length > 0)
}

export function parseFieldPresetImport(value: unknown): FieldPresetImport | undefined {
  const fields = record(record(value)?.fields)
  if (fields === undefined) return undefined

  const parsed: Partial<Record<FieldPresetTarget, readonly FieldContentPreset[]>> = {}
  for (const target of TARGETS) {
    const entries = fields[target]
    if (entries === undefined) continue
    if (!Array.isArray(entries)) throw new Error(`invalid ${target} field presets`)
    parsed[target] = entries.map((entry): FieldContentPreset => {
      const candidate = record(entry)
      if (candidate === undefined
        || typeof candidate.id !== 'string'
        || candidate.id.trim().length === 0
        || !localizedText(candidate.name)
        || !localizedText(candidate.detail)) throw new Error(`invalid ${target} field preset`)
      return {
        id: candidate.id,
        name: candidate.name,
        detail: candidate.detail,
      }
    })
  }
  if (Object.keys(parsed).length === 0) throw new Error('field preset import is empty')
  return parsed
}

function samePreset(left: FieldContentPreset, right: FieldContentPreset): boolean {
  return left.id === right.id || left.name.some(name => right.name.includes(name))
}

export function mergeFieldPresetImport(
  current: FieldPresetCollection,
  imported: FieldPresetImport,
): FieldPresetCollection {
  const next: Record<FieldPresetTarget, readonly FieldContentPreset[]> = { ...current }
  for (const target of TARGETS) {
    const additions = imported[target]
    if (additions === undefined) continue
    const presets = [...current[target]]
    for (const addition of additions) {
      const index = presets.findIndex(preset => samePreset(preset, addition))
      if (index === -1) presets.push(addition)
      else presets[index] = { ...addition, id: presets[index]?.id ?? addition.id }
    }
    next[target] = presets
  }
  return next
}
