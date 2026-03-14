import { create } from 'zustand'

export type CardSide = 'front' | 'back'
export type DesignMethod = 'engraved' | 'printed'
export type BackOption = 'qr-only' | 'qr-name'

export interface DesignState {
  // Material selection
  materialId: string | null
  variationId: string | null

  // Design method (engraved vs printed — only relevant for metal)
  designMethod: DesignMethod

  // Stored text colors from printed mode (restored when switching back from engraved)
  savedPrintColors: Map<string, string>

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

  // Back of card
  backOption: BackOption
  cardNames: string[]
  quantity: number

  // Transparency warning
  opaqueImageWarning: 'detected' | 'bg_removed' | 'printed' | 'dismissed' | null
  opaqueImageId: string | null

  // Save state
  designId: string | null
  isSaving: boolean
  lastSaved: Date | null

  // Actions
  resetDesign: () => void
  setOpaqueWarning: (state: 'detected' | 'bg_removed' | 'printed' | 'dismissed' | null, imageId?: string | null) => void
  setDesignName: (name: string) => void
  setMaterial: (materialId: string, variationId: string) => void
  setDesignMethod: (method: DesignMethod) => void
  setActiveSide: (side: CardSide) => void
  setCanvasJson: (side: CardSide, json: string) => void
  setBgColor: (side: CardSide, color: string) => void
  setDesignId: (id: string) => void
  setSaving: (saving: boolean) => void
  setLastSaved: (date: Date) => void
  setBackOption: (option: BackOption) => void
  setQuantity: (qty: number) => void
  setCardName: (index: number, name: string) => void
  savePrintColor: (objectId: string, color: string) => void
  getPrintColor: (objectId: string) => string | undefined
  loadDesign: (data: {
    materialId: string
    variationId: string
    frontCanvasJson: string | null
    backCanvasJson: string | null
    frontBgColor: string
    backBgColor: string
    designId: string
    designName: string
    designMethod?: DesignMethod
    backOption?: BackOption
    cardNames?: string[]
    quantity?: number
  }) => void
}

export const useDesignStore = create<DesignState>((set, get) => ({
  materialId: 'plastic',
  variationId: 'pvc-white',
  designMethod: 'printed' as DesignMethod,
  savedPrintColors: new Map<string, string>(),
  activeSide: 'front',
  frontCanvasJson: null,
  backCanvasJson: null,
  frontBgColor: '#ffffff',
  backBgColor: '#ffffff',
  designName: '',
  backOption: 'qr-only' as BackOption,
  cardNames: [''],
  quantity: 1,
  opaqueImageWarning: null,
  opaqueImageId: null,
  designId: null,
  isSaving: false,
  lastSaved: null,

  resetDesign: () => set({
    materialId: 'plastic',
    variationId: 'pvc-white',
    designMethod: 'printed' as DesignMethod,
    savedPrintColors: new Map<string, string>(),
    activeSide: 'front',
    frontCanvasJson: null,
    backCanvasJson: null,
    frontBgColor: '#ffffff',
    backBgColor: '#ffffff',
    designName: '',
    backOption: 'qr-only' as BackOption,
    cardNames: [''],
    quantity: 1,
    opaqueImageWarning: null,
    opaqueImageId: null,
    designId: null,
    isSaving: false,
    lastSaved: null,
  }),

  setOpaqueWarning: (state, imageId) => set({
    opaqueImageWarning: state,
    opaqueImageId: imageId ?? get().opaqueImageId,
  }),

  setDesignName: (name) => set({ designName: name }),

  setMaterial: (materialId, variationId) => {
    // Auto-switch to printed for non-metal materials
    const updates: Partial<DesignState> = { materialId, variationId }
    if (materialId !== 'metal') {
      updates.designMethod = 'printed'
    }
    set(updates)
  },

  setDesignMethod: (method) => set({ designMethod: method }),

  setActiveSide: (side) => set({ activeSide: side }),

  setCanvasJson: (side, json) =>
    set(side === 'front' ? { frontCanvasJson: json } : { backCanvasJson: json }),

  setBgColor: (side, color) =>
    set(side === 'front' ? { frontBgColor: color } : { backBgColor: color }),

  setDesignId: (id) => set({ designId: id }),

  setSaving: (saving) => set({ isSaving: saving }),

  setLastSaved: (date) => set({ lastSaved: date }),

  setBackOption: (option) => set({ backOption: option }),

  setQuantity: (qty) => {
    const current = get().cardNames
    const names = [...current]
    // Grow or shrink the names array
    while (names.length < qty) names.push('')
    set({ quantity: qty, cardNames: names.slice(0, qty) })
  },

  setCardName: (index, name) => {
    const names = [...get().cardNames]
    names[index] = name
    set({ cardNames: names })
  },

  savePrintColor: (objectId, color) => {
    const map = new Map(get().savedPrintColors)
    map.set(objectId, color)
    set({ savedPrintColors: map })
  },

  getPrintColor: (objectId) => {
    return get().savedPrintColors.get(objectId)
  },

  loadDesign: (data) =>
    set({
      materialId: data.materialId,
      variationId: data.variationId,
      designMethod: data.designMethod ?? 'printed',
      frontCanvasJson: data.frontCanvasJson,
      backCanvasJson: data.backCanvasJson,
      frontBgColor: data.frontBgColor,
      backBgColor: data.backBgColor,
      designId: data.designId,
      designName: data.designName,
      backOption: data.backOption ?? 'qr-only',
      cardNames: data.cardNames ?? [''],
      quantity: data.quantity ?? 1,
    }),
}))
