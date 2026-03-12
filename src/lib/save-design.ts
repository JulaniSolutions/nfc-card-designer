import { supabase, isSupabaseConfigured } from './supabase'
import { useDesignStore } from '@/store/design-store'

function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

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
  created_at: string
  updated_at: string
}

export async function saveDesign(): Promise<string | null> {
  if (!isSupabaseConfigured() || !supabase) {
    console.warn('Supabase not configured — design not saved')
    return null
  }

  const state = useDesignStore.getState()
  const { materialId, variationId, frontCanvasJson, backCanvasJson, frontBgColor, backBgColor, designId, designName } = state

  const payload = {
    name: designName || null,
    material_id: materialId,
    variation_id: variationId,
    front_canvas_json: frontCanvasJson,
    back_canvas_json: backCanvasJson,
    front_bg_color: frontBgColor,
    back_bg_color: backBgColor,
    updated_at: new Date().toISOString(),
  }

  if (designId) {
    const { error } = await supabase
      .from('designs')
      .update(payload)
      .eq('design_id', designId)

    if (error) throw error
    state.setLastSaved(new Date())
    return designId
  }

  const shortId = generateShortId()
  const { data, error } = await supabase
    .from('designs')
    .insert({ design_id: shortId, ...payload })
    .select('design_id')
    .single()

  if (error) throw error

  const newId = data.design_id as string
  state.setDesignId(newId)
  state.setLastSaved(new Date())
  return newId
}

export async function loadDesign(id: string): Promise<boolean> {
  if (!isSupabaseConfigured() || !supabase) {
    console.warn('Supabase not configured')
    return false
  }

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
  })

  return true
}
