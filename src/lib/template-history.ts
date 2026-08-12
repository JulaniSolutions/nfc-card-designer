const STORAGE_KEY = 'nfc_my_templates'
const MAX_ENTRIES = 50

/**
 * Local record of templates published from this browser.
 *
 * With no auth, the edit token IS ownership. It lives here and is also shown
 * once at publish time as a manage link, so a cleared browser doesn't
 * permanently orphan the template.
 */
export interface TemplateHistoryEntry {
  templateId: string
  editToken: string
  name: string
  publishedAt: string
  sourceDesignId?: string | null
}

export function getTemplateHistory(): TemplateHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const entries: TemplateHistoryEntry[] = JSON.parse(raw)
    if (!Array.isArray(entries)) return []
    return entries
      .filter((e) => e && e.templateId && e.editToken)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
  } catch {
    return []
  }
}

export function addTemplateToHistory(entry: TemplateHistoryEntry): void {
  try {
    const entries = getTemplateHistory().filter((e) => e.templateId !== entry.templateId)
    entries.unshift(entry)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // fail silently — quota or private mode
  }
}

export function removeTemplateFromHistory(templateId: string): void {
  try {
    const entries = getTemplateHistory().filter((e) => e.templateId !== templateId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // fail silently
  }
}

/** The edit token for a template published from this browser, if we still have it. */
export function getEditToken(templateId: string): string | null {
  return getTemplateHistory().find((e) => e.templateId === templateId)?.editToken ?? null
}

/** An already-published template for this design, so re-publishing can offer "update". */
export function findTemplateForDesign(designId: string | null): TemplateHistoryEntry | null {
  if (!designId) return null
  return getTemplateHistory().find((e) => e.sourceDesignId === designId) ?? null
}
