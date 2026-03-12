import { create } from 'zustand'

export type CardSide = 'front' | 'back'

export interface DesignState {
  // Material selection
  materialId: string | null
  variationId: string | null

  // Active side
  activeSide: CardSide

  // Canvas JSON for each side (Fabric.js serialised state)
  frontCanvasJson: string | null
  backCanvasJson: string | null

  // Background colours
  frontBgColor: string
  backBgColor: string

  // Design name
  designName: string

  // Save state
  designId: string | null
  isSaving: boolean
  lastSaved: Date | null

  // Actions
  setDesignName: (name: string) => void
  setMaterial: (materialId: string, variationId: string) => void
  setActiveSide: (side: CardSide) => void
  setCanvasJson: (side: CardSide, json: string) => void
  setBgColor: (side: CardSide, color: string) => void
  setDesignId: (id: string) => void
  setSaving: (saving: boolean) => void
  setLastSaved: (date: Date) => void
  loadDesign: (data: {
    materialId: string
    variationId: string
    frontCanvasJson: string | null
    backCanvasJson: string | null
    frontBgColor: string
    backBgColor: string
    designId: string
    designName: string
  }) => void
}

export const useDesignStore = create<DesignState>((set) => ({
  materialId: 'plastic',
  variationId: 'plastic-standard',
  activeSide: 'front',
  frontCanvasJson: null,
  backCanvasJson: null,
  frontBgColor: '#ffffff',
  backBgColor: '#ffffff',
  designName: '',
  designId: null,
  isSaving: false,
  lastSaved: null,

  setDesignName: (name) => set({ designName: name }),

  setMaterial: (materialId, variationId) =>
    set({ materialId, variationId }),

  setActiveSide: (side) => set({ activeSide: side }),

  setCanvasJson: (side, json) =>
    set(side === 'front' ? { frontCanvasJson: json } : { backCanvasJson: json }),

  setBgColor: (side, color) =>
    set(side === 'front' ? { frontBgColor: color } : { backBgColor: color }),

  setDesignId: (id) => set({ designId: id }),

  setSaving: (saving) => set({ isSaving: saving }),

  setLastSaved: (date) => set({ lastSaved: date }),

  loadDesign: (data) =>
    set({
      materialId: data.materialId,
      variationId: data.variationId,
      frontCanvasJson: data.frontCanvasJson,
      backCanvasJson: data.backCanvasJson,
      frontBgColor: data.frontBgColor,
      backBgColor: data.backBgColor,
      designId: data.designId,
      designName: data.designName,
    }),
}))
