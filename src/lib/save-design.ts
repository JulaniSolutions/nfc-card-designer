import { isSupabaseConfigured, supabase } from './supabase'
import { useDesignStore } from '@/store/design-store'
import { addDesignToHistory } from './design-history'
import { uploadOriginalAsset } from './upload-asset'
import { fetchWithTimeout } from './fetch-with-timeout'
import { clearDraft } from './auto-save'
import { FabricImage } from 'fabric'

export const CUSTOM_PROPS = [
  '_waveIcon', '_isLocked', '_layerLabel', '_isPlaceholder',
  '_qrPlaceholderBorder', '_qrPlaceholderLabel', '_backNameText',
  '_variableId',
  '_designId', '_isOpaque', '_addedInEngraved', '_originalSrc', '_layerType',
  '_assetUrl', '_assetName', '_undeletable',
]

export interface SavedDesign {
  id: string
  design_id: string
  name: string | null
  material_id: string
  variation_id: string
  front_canvas_json: string | null
  back_canvas_json: string | null
  front_bg_color: string
  back_bg_color: string
  design_method: string
  back_option: string
  card_names: string[]
  variable_fields: { id: string; label: string }[] | null
  card_data: Record<string, string>[] | null
  quantity: number
  created_at: string
  updated_at: string
}

function getEdgeFunctionUrl(name: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  return `${supabaseUrl}/functions/v1/${name}`
}

function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const randomBytes = new Uint8Array(8)
  crypto.getRandomValues(randomBytes)
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars[randomBytes[i] % chars.length]
  }
  return id
}

export async function saveDesign(turnstileToken?: string | null): Promise<string | null> {
  if (!navigator.onLine) {
    throw new Error('You appear to be offline. Please check your internet connection and try again.')
  }

  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured — design not saved')
    return null
  }

  // Save both canvases' current state before persisting
  const storeState = useDesignStore.getState()
  if (window.__fabricCanvasFront) {
    storeState.setCanvasJson('front', JSON.stringify(window.__fabricCanvasFront.toObject(CUSTOM_PROPS)))
  }
  if (window.__fabricCanvasBack) {
    storeState.setCanvasJson('back', JSON.stringify(window.__fabricCanvasBack.toObject(CUSTOM_PROPS)))
  }

  // Upload any images that haven't been uploaded to Storage yet
  for (const canvas of [window.__fabricCanvasFront, window.__fabricCanvasBack]) {
    if (!canvas) continue
    for (const obj of canvas.getObjects()) {
      const tagged = obj as FabricImage & { _assetUrl?: string; _assetName?: string; _designId?: string }
      if (obj instanceof FabricImage && tagged._designId && !tagged._assetUrl) {
        // Extract image data and upload
        const el = (obj as FabricImage).getElement() as HTMLImageElement
        const src = el.src
        if (!src) continue
        let blob: Blob | null = null
        try {
          const res = await fetchWithTimeout(src, undefined, 10_000)
          blob = await res.blob()
        } catch {
          // If fetch fails (e.g. revoked blob URL), fall back to canvas with timeout
          const offscreen = document.createElement('canvas')
          offscreen.width = el.naturalWidth || el.width
          offscreen.height = el.naturalHeight || el.height
          if (offscreen.width === 0 || offscreen.height === 0) continue
          const ctx = offscreen.getContext('2d')!
          ctx.drawImage(el, 0, 0)
          blob = await new Promise<Blob | null>((resolve) => {
            const timer = setTimeout(() => resolve(null), 5000)
            offscreen.toBlob((b) => { clearTimeout(timer); resolve(b) }, 'image/png')
          })
          if (!blob) throw new Error('Failed to process image for upload. Please try again.')
        }
        if (blob) {
          const file = new File([blob], tagged._assetName || 'image.png', { type: 'image/png' })
          const asset = await uploadOriginalAsset(file)
          if (asset) {
            tagged._assetUrl = asset.url
          }
        }
      }
    }
  }

  // Re-save canvas JSON after asset URLs have been added,
  // replacing base64 image src with Storage URLs to keep JSON small
  for (const [side, canvas] of [['front', window.__fabricCanvasFront], ['back', window.__fabricCanvasBack]] as const) {
    if (!canvas) continue
    const json = canvas.toObject(CUSTOM_PROPS)
    if (json.objects) {
      for (const obj of json.objects) {
        if (obj._assetUrl && obj.src && obj.src.startsWith('data:')) {
          obj.src = obj._assetUrl
        }
      }
    }
    storeState.setCanvasJson(side, JSON.stringify(json))
  }

  const state = useDesignStore.getState()
  const { materialId, variationId, frontCanvasJson, backCanvasJson, frontBgColor, backBgColor, designId, designName, designMethod, backOption, cardNames, variableFields, cardData, quantity } = state

  // Generate a stable ID before the first attempt so retries don't create duplicates
  const effectiveId = designId || generateShortId()

  const payload = {
    design_id: effectiveId,
    name: designName || null,
    material_id: materialId,
    variation_id: variationId,
    front_canvas_json: frontCanvasJson,
    back_canvas_json: backCanvasJson,
    front_bg_color: frontBgColor,
    back_bg_color: backBgColor,
    design_method: designMethod,
    back_option: backOption,
    card_names: cardNames, // backward compat
    variable_fields: variableFields,
    card_data: cardData,
    quantity,
    turnstile_token: turnstileToken,
  }

  const MAX_ATTEMPTS = 3
  const BACKOFF_MS = [0, 1500, 3000]
  let res: Response | undefined

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]))
    }
    try {
      res = await fetchWithTimeout(getEdgeFunctionUrl('save-design'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(payload),
      }, 30_000)

      // Don't retry 4xx — these are validation/auth errors that won't resolve on retry
      if (res.ok || (res.status >= 400 && res.status < 500)) break
      // 5xx — retry
      if (attempt === MAX_ATTEMPTS - 1) break
    } catch (err) {
      // Network error or timeout — retry unless this was the last attempt
      if (attempt === MAX_ATTEMPTS - 1) throw err
    }
  }

  if (!res) {
    throw new Error('Save failed after multiple attempts. Please try again.')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Save failed' }))
    throw new Error(err.error || `Save failed (${res.status})`)
  }

  const data = await res.json()
  const savedId = data.design_id as string

  if (!designId) {
    state.setDesignId(savedId)
  }
  state.setLastSaved(new Date())
  addDesignToHistory(savedId)
  clearDraft()
  return savedId
}

export async function loadDesign(id: string): Promise<boolean> {
  if (!isSupabaseConfigured() || !supabase) {
    console.warn('Supabase not configured')
    return false
  }

  // Reads still go direct — the select policy is public
  const { data, error } = await supabase
    .from('designs')
    .select('*')
    .eq('design_id', id)
    .single()

  if (error || !data) return false

  const design = data as SavedDesign
  useDesignStore.getState().loadDesign({
    materialId: design.material_id,
    variationId: design.variation_id,
    frontCanvasJson: design.front_canvas_json,
    backCanvasJson: design.back_canvas_json,
    frontBgColor: design.front_bg_color,
    backBgColor: design.back_bg_color,
    designId: design.design_id,
    designName: design.name || '',
    designMethod: (design.design_method as 'engraved' | 'printed') || 'printed',
    backOption: (design.back_option as 'qr-only' | 'qr-name') || 'qr-only',
    cardNames: design.card_names || [''],
    variableFields: design.variable_fields || undefined,
    cardData: design.card_data || undefined,
    quantity: design.quantity || 1,
  })

  return true
}
