import { supabase, isSupabaseConfigured } from './supabase'
import { useDesignStore } from '@/store/design-store'

export interface SavedDesign {
  id: string
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
  const { materialId, variationId, frontCanvasJson, backCanvasJson, frontBgColor, backBgColor, designId } = state

  const payload = {
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
      .eq('id', designId)

    if (error) throw error
    state.setLastSaved(new Date())
    return designId
  }

  const { data, error } = await supabase
    .from('designs')
    .insert(payload)
    .select('id')
    .single()

  if (error) throw error

  const newId = data.id as string
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
    .eq('id', id)
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
    designId: design.id,
  })

  return true
}
