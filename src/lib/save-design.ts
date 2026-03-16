import { isSupabaseConfigured, supabase } from './supabase'
import { useDesignStore } from '@/store/design-store'
import { getTurnstileToken } from './turnstile'
import { addDesignToHistory } from './design-history'

const CUSTOM_PROPS = [
  '_waveIcon', '_isLocked', '_layerLabel', '_isPlaceholder',
  '_qrPlaceholderBorder', '_qrPlaceholderLabel', '_backNameText',
  '_designId', '_isOpaque', '_addedInEngraved', '_originalSrc', '_layerType',
  '_assetUrl', '_assetName',
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
  quantity: number
  created_at: string
  updated_at: string
}

function getEdgeFunctionUrl(name: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  return `${supabaseUrl}/functions/v1/${name}`
}

export async function saveDesign(): Promise<string | null> {
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

  const state = useDesignStore.getState()
  const { materialId, variationId, frontCanvasJson, backCanvasJson, frontBgColor, backBgColor, designId, designName, designMethod, backOption, cardNames, quantity } = state

  // Get Turnstile CAPTCHA token
  const turnstileToken = await getTurnstileToken()

  const payload = {
    design_id: designId || undefined,
    name: designName || null,
    material_id: materialId,
    variation_id: variationId,
    front_canvas_json: frontCanvasJson,
    back_canvas_json: backCanvasJson,
    front_bg_color: frontBgColor,
    back_bg_color: backBgColor,
    design_method: designMethod,
    back_option: backOption,
    card_names: cardNames,
    quantity,
    turnstile_token: turnstileToken,
  }

  const res = await fetch(getEdgeFunctionUrl('save-design'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Save failed' }))
    throw new Error(err.error || `Save failed (${res.status})`)
  }

  const data = await res.json()
  const newId = data.design_id as string

  if (!designId) {
    state.setDesignId(newId)
  }
  state.setLastSaved(new Date())
  addDesignToHistory(newId)
  return newId
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
    quantity: design.quantity || 1,
  })

  return true
}
