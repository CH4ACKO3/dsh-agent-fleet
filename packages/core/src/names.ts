import * as humanNames from 'human-names'

export const FLEET_MEMBER_COLOR_PRESETS = [
  '#527fca', '#6f76c8', '#8968b3', '#a85f92', '#bd6578', '#c57655',
  '#b7833f', '#8b9446', '#4c9270', '#408f92', '#4d82a0', '#6f7d8f',
] as const

const LEGACY_COLORS: Readonly<Record<string, string>> = {
  blue: '#527fca',
  violet: '#7c68bd',
  green: '#4c9270',
  amber: '#b7833f',
  rose: '#bd6578',
  teal: '#408f92',
}

export function generateMemberDisplayName(existing: readonly string[] = []): string {
  const base = humanNames.allRandomEn()
  const used = new Set(existing.map(name => name.toLowerCase()))
  let candidate = base
  let suffix = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} ${suffix}`
    suffix += 1
  }
  return candidate
}

export function normalizeFleetMemberColor(value: string): string {
  const normalized = value.trim().toLowerCase()
  const color = LEGACY_COLORS[normalized] ?? normalized
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error('Fleet member color must use #RRGGBB')
  return color
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const section = hue / 60
  const x = chroma * (1 - Math.abs(section % 2 - 1))
  const [red, green, blue] = section < 1 ? [chroma, x, 0]
    : section < 2 ? [x, chroma, 0]
      : section < 3 ? [0, chroma, x]
        : section < 4 ? [0, x, chroma]
          : section < 5 ? [x, 0, chroma]
            : [chroma, 0, x]
  const offset = l - chroma / 2
  return `#${[red, green, blue]
    .map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0'))
    .join('')}`
}

export function generateFleetMemberColor(existing: readonly string[] = []): string {
  const used = new Set(existing.map(normalizeFleetMemberColor))
  let hue = Math.random() * 360
  const saturation = 44 + Math.random() * 14
  const lightness = 48 + Math.random() * 8
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = hslToHex(hue, saturation, lightness)
    if (!used.has(candidate)) return candidate
    hue = (hue + 137.508) % 360
  }
  return hslToHex(hue, saturation, lightness)
}
