const STORAGE_KEY = 'nfc_recent_designs'
const MAX_ENTRIES = 20
const MAX_AGE_DAYS = 30

export type DesignHistoryEntry = { designId: string; savedAt: string }

export function getDesignHistory(): DesignHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const entries: DesignHistoryEntry[] = JSON.parse(raw)
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000
    return entries
      .filter((e) => new Date(e.savedAt).getTime() > cutoff)
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
  } catch {
    return []
  }
}

export function addDesignToHistory(designId: string): void {
  try {
    const entries = getDesignHistory().filter((e) => e.designId !== designId)
    entries.unshift({ designId, savedAt: new Date().toISOString() })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // fail silently
  }
}

export function removeFromHistory(designId: string): void {
  try {
    const entries = getDesignHistory().filter((e) => e.designId !== designId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // fail silently
  }
}
