const STORAGE_PREFIX = 'dsh-hover-hint:seen:'
const seenMarkers = new Set<string>()
const listeners = new Set<() => void>()

function localStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function hasSeenHint(marker: string | undefined): boolean {
  if (marker === undefined) return false
  if (seenMarkers.has(marker)) return true
  try {
    if (localStorage()?.getItem(`${STORAGE_PREFIX}${marker}`) !== '1') return false
    seenMarkers.add(marker)
    return true
  } catch {
    return false
  }
}

export function markHintSeen(marker: string): void {
  if (hasSeenHint(marker)) return
  seenMarkers.add(marker)
  try {
    localStorage()?.setItem(`${STORAGE_PREFIX}${marker}`, '1')
  } catch {
    // The in-memory marker still keeps this page consistent when storage is unavailable.
  }
  for (const listener of listeners) listener()
}

export function subscribeSeenHints(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
