import { Canvas } from 'fabric'
import { useDesignStore } from '@/store/design-store'
import { CUSTOM_PROPS } from './save-design'

const DRAFT_KEY = 'nfc_draft_design'
const DEBOUNCE_MS = 2000
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let autoSavePaused = false
let unpauseTimer: ReturnType<typeof setTimeout> | null = null

interface DraftSnapshot {
  materialId: string | null
  variationId: string | null
  designMethod: string
  frontCanvasJson: string | null
  backCanvasJson: string | null
  frontBgColor: string
  backBgColor: string
  designName: string
  backOption: string
  cardNames: string[]
  variableFields: { id: string; label: string }[]
  cardData: Record<string, string>[]
  quantity: number
  savedAt: string
}

function takeSnapshot(): DraftSnapshot {
  const s = useDesignStore.getState()

  // Grab live canvas JSON if available (more current than store)
  let frontJson = s.frontCanvasJson
  let backJson = s.backCanvasJson
  try {
    if (window.__fabricCanvasFront) {
      frontJson = JSON.stringify(window.__fabricCanvasFront.toObject(CUSTOM_PROPS))
    }
    if (window.__fabricCanvasBack) {
      backJson = JSON.stringify(window.__fabricCanvasBack.toObject(CUSTOM_PROPS))
    }
  } catch {
    // Fall back to store JSON
  }

  return {
    materialId: s.materialId,
    variationId: s.variationId,
    designMethod: s.designMethod,
    frontCanvasJson: frontJson,
    backCanvasJson: backJson,
    frontBgColor: s.frontBgColor,
    backBgColor: s.backBgColor,
    designName: s.designName,
    backOption: s.backOption,
    cardNames: s.cardNames,
    variableFields: s.variableFields,
    cardData: s.cardData,
    quantity: s.quantity,
    savedAt: new Date().toISOString(),
  }
}

/** Persist current design state to localStorage. Fails silently on quota errors. */
export function saveDraft(): void {
  // Skip if auto-save is paused (e.g. right after a successful server save)
  if (autoSavePaused) return
  try {
    const snapshot = takeSnapshot()
    localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot))
  } catch {
    // Quota exceeded or serialization error — skip silently
  }
}

/** Clear the localStorage draft and suppress auto-save briefly.
 *  Post-save store mutations (setDesignId, setLastSaved, setSaving) trigger
 *  the Zustand subscriber which would re-create the draft. Pausing for a
 *  short window after clearDraft prevents that. */
export function clearDraft(): void {
  // Cancel pending debounced save
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  // Pause auto-save so post-save store mutations don't re-create the draft
  autoSavePaused = true
  if (unpauseTimer) clearTimeout(unpauseTimer)
  unpauseTimer = setTimeout(() => { autoSavePaused = false }, DEBOUNCE_MS + 500)
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Ignore
  }
}

/** Load a draft from localStorage, if one exists. */
export function loadDraft(): DraftSnapshot | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as DraftSnapshot
    // Discard drafts older than 7 days
    if (draft.savedAt) {
      const age = Date.now() - new Date(draft.savedAt).getTime()
      if (age > 7 * 24 * 60 * 60 * 1000) {
        clearDraft()
        return null
      }
    }
    // Only return if there's meaningful content
    if (!draft.frontCanvasJson && !draft.backCanvasJson) return null
    return draft
  } catch {
    return null
  }
}

/** Load JSON into a live Fabric canvas, setting crossOrigin on images. */
function loadCanvasFromJson(canvas: Canvas, json: string): void {
  try {
    const parsed = JSON.parse(json)
    const objects = parsed?.objects as Record<string, unknown>[] | undefined
    if (objects) {
      for (const obj of objects) {
        if (obj.type === 'image' || obj.src) obj.crossOrigin = 'anonymous'
      }
    }
    canvas.loadFromJSON(parsed).then(() => canvas.renderAll()).catch(console.error)
  } catch {
    // Ignore parse errors
  }
}

/** Restore a draft into the Zustand store and reload live canvases. */
export function restoreDraft(draft: DraftSnapshot): void {
  const store = useDesignStore.getState()
  store.setMaterial(draft.materialId || 'plastic', draft.variationId || 'pvc-white')
  store.setDesignMethod(draft.designMethod as 'engraved' | 'printed')
  store.setDesignName(draft.designName)
  store.setBackOption(draft.backOption as 'qr-only' | 'qr-name')

  // Set canvas JSON in store
  if (draft.frontCanvasJson) store.setCanvasJson('front', draft.frontCanvasJson)
  if (draft.backCanvasJson) store.setCanvasJson('back', draft.backCanvasJson)
  store.setBgColor('front', draft.frontBgColor)
  store.setBgColor('back', draft.backBgColor)

  // Reload live Fabric canvas instances so the UI reflects the restored state
  if (draft.frontCanvasJson && window.__fabricCanvasFront) {
    loadCanvasFromJson(window.__fabricCanvasFront, draft.frontCanvasJson)
  }
  if (draft.backCanvasJson && window.__fabricCanvasBack) {
    loadCanvasFromJson(window.__fabricCanvasBack, draft.backCanvasJson)
  }

  // Card data
  if (draft.variableFields) {
    // Set quantity first to size the cardData array
    store.setQuantity(draft.quantity || 1)
    // Then overwrite with saved data
    useDesignStore.setState({
      variableFields: draft.variableFields,
      cardData: draft.cardData || [{ name: '' }],
      cardNames: draft.cardNames || [''],
    })
  }
}

/** Start listening for store changes and auto-saving drafts. Returns an unsubscribe function. */
export function startAutoSave(): () => void {
  const unsubscribe = useDesignStore.subscribe(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(saveDraft, DEBOUNCE_MS)
  })

  // Also save on page unload
  const handleBeforeUnload = () => saveDraft()
  window.addEventListener('beforeunload', handleBeforeUnload)

  return () => {
    unsubscribe()
    window.removeEventListener('beforeunload', handleBeforeUnload)
    if (debounceTimer) clearTimeout(debounceTimer)
    if (unpauseTimer) clearTimeout(unpauseTimer)
  }
}
