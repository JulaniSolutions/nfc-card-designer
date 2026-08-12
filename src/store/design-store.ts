import { create } from 'zustand'
import { isEngravingMaterial } from '@/config/materials'

export type CardSide = 'front' | 'back'
export type DesignMethod = 'engraved' | 'printed'
export type BackOption = 'qr-only' | 'qr-name'

export interface VariableField {
  id: string
  label: string
}

export type CardData = Record<string, string>[]

const DEFAULT_NAME_FIELD: VariableField = { id: 'name', label: 'Name' }

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
  cardNames: string[] // kept for backward compat
  variableFields: VariableField[]
  cardData: CardData
  quantity: number

  // Transparency warning
  opaqueImageWarning: 'detected' | 'bg_removed' | 'printed' | 'dismissed' | null
  opaqueImageId: string | null

  // Save state
  designId: string | null
  isSaving: boolean
  lastSaved: Date | null
  hasUnsavedChanges: boolean

  // Template this design was forked from (attribution only — never set on a template itself)
  sourceTemplateId: string | null

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
  addVariable: (label: string) => void
  removeVariable: (id: string) => void
  renameVariable: (id: string, label: string) => void
  removeCard: (cardIndex: number) => void
  setCardValue: (cardIndex: number, variableId: string, value: string) => void
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
    variableFields?: VariableField[]
    cardData?: CardData
    quantity?: number
    sourceTemplateId?: string | null
  }) => void
  /** Fork a template into a fresh, unsaved design. Never sets designId. */
  loadFromTemplate: (data: {
    materialId: string
    variationId: string
    frontCanvasJson: string | null
    backCanvasJson: string | null
    frontBgColor: string
    backBgColor: string
    designName: string
    designMethod?: DesignMethod
    backOption?: BackOption
    variableFields?: VariableField[]
    sourceTemplateId: string
  }) => void
}

function deriveCardNames(cardData: CardData): string[] {
  return cardData.map((row) => row['name'] || '')
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
  variableFields: [{ ...DEFAULT_NAME_FIELD }],
  cardData: [{ name: '' }],
  quantity: 1,
  opaqueImageWarning: null,
  opaqueImageId: null,
  designId: null,
  isSaving: false,
  lastSaved: null,
  hasUnsavedChanges: false,
  sourceTemplateId: null,

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
    variableFields: [{ ...DEFAULT_NAME_FIELD }],
    cardData: [{ name: '' }],
    quantity: 1,
    opaqueImageWarning: null,
    opaqueImageId: null,
    designId: null,
    isSaving: false,
    lastSaved: null,
    hasUnsavedChanges: false,
    sourceTemplateId: null,
  }),

  setOpaqueWarning: (state, imageId) => set({
    opaqueImageWarning: state,
    opaqueImageId: imageId ?? get().opaqueImageId,
  }),

  setDesignName: (name) => set({ designName: name }),

  setMaterial: (materialId, variationId) => {
    // Auto-switch to printed for non-metal materials
    const updates: Partial<DesignState> = { materialId, variationId }
    if (!isEngravingMaterial(materialId)) {
      updates.designMethod = 'printed'
    }
    if (get().designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  setDesignMethod: (method) => {
    const updates: Partial<DesignState> = { designMethod: method }
    if (get().designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  setActiveSide: (side) => set({ activeSide: side }),

  setCanvasJson: (side, json) => {
    const updates: Partial<DesignState> = side === 'front' ? { frontCanvasJson: json } : { backCanvasJson: json }
    if (get().designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  setBgColor: (side, color) => {
    const updates: Partial<DesignState> = side === 'front' ? { frontBgColor: color } : { backBgColor: color }
    if (get().designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  setDesignId: (id) => set({ designId: id }),

  setSaving: (saving) => set({ isSaving: saving }),

  setLastSaved: (date) => set({ lastSaved: date, hasUnsavedChanges: false }),

  setBackOption: (option) => {
    const updates: Partial<DesignState> = { backOption: option }
    if (get().designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  setQuantity: (qty) => {
    const { cardData, variableFields } = get()
    const newData = [...cardData]
    // Grow: add empty rows
    while (newData.length < qty) {
      const emptyRow: Record<string, string> = {}
      for (const field of variableFields) {
        emptyRow[field.id] = ''
      }
      newData.push(emptyRow)
    }
    // Shrink
    const trimmed = newData.slice(0, qty)
    const updates: Partial<DesignState> = { quantity: qty, cardData: trimmed, cardNames: deriveCardNames(trimmed) }
    if (get().designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  setCardName: (index, name) => {
    const cardData = [...get().cardData]
    if (!cardData[index]) cardData[index] = {}
    cardData[index] = { ...cardData[index], name }
    const updates: Partial<DesignState> = { cardData, cardNames: deriveCardNames(cardData) }
    if (get().designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  addVariable: (label: string) => {
    const id = crypto.randomUUID()
    const { variableFields, cardData, designId } = get()
    const newFields = [...variableFields, { id, label }]
    const newData = cardData.map((row) => ({ ...row, [id]: '' }))
    const updates: Partial<DesignState> = { variableFields: newFields, cardData: newData }
    if (designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  removeVariable: (id: string) => {
    if (id === 'name') return // Can't remove Name
    const { variableFields, cardData, designId } = get()
    const newFields = variableFields.filter((f) => f.id !== id)
    const newData = cardData.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => key !== id))
    )
    const updates: Partial<DesignState> = { variableFields: newFields, cardData: newData }
    if (designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  renameVariable: (id: string, label: string) => {
    const { variableFields, designId } = get()
    const newFields = variableFields.map((f) =>
      f.id === id ? { ...f, label } : f
    )
    const updates: Partial<DesignState> = { variableFields: newFields }
    if (designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  removeCard: (cardIndex: number) => {
    const { cardData, quantity } = get()
    if (quantity <= 1) return // Must keep at least 1 card
    const newData = cardData.filter((_, i) => i !== cardIndex)
    set({ cardData: newData, quantity: newData.length, cardNames: deriveCardNames(newData) })
  },

  setCardValue: (cardIndex: number, variableId: string, value: string) => {
    const cardData = [...get().cardData]
    if (!cardData[cardIndex]) cardData[cardIndex] = {}
    cardData[cardIndex] = { ...cardData[cardIndex], [variableId]: value }
    const updates: Partial<DesignState> = { cardData }
    // Keep cardNames in sync
    if (variableId === 'name') {
      updates.cardNames = deriveCardNames(cardData)
    }
    if (get().designId) updates.hasUnsavedChanges = true
    set(updates)
  },

  savePrintColor: (objectId, color) => {
    const map = new Map(get().savedPrintColors)
    map.set(objectId, color)
    set({ savedPrintColors: map })
  },

  getPrintColor: (objectId) => {
    return get().savedPrintColors.get(objectId)
  },

  loadDesign: (data) => {
    // Migrate legacy designs: if cardData not present, build from cardNames
    let variableFields = data.variableFields
    let cardData = data.cardData
    const cardNames = data.cardNames ?? ['']
    const quantity = data.quantity ?? 1

    if (!cardData || cardData.length === 0) {
      // Legacy design — migrate cardNames to structured data
      variableFields = [{ ...DEFAULT_NAME_FIELD }]
      cardData = cardNames.map((name) => ({ name }))
    }
    if (!variableFields || variableFields.length === 0) {
      variableFields = [{ ...DEFAULT_NAME_FIELD }]
    }

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
      cardNames,
      variableFields,
      cardData,
      quantity,
      sourceTemplateId: data.sourceTemplateId ?? null,
      hasUnsavedChanges: false,
    })
  },

  loadFromTemplate: (data) => {
    // A fork starts life as an unsaved design: no designId, no per-card data.
    // variableFields definitions carry over (they're design structure), values don't.
    const variableFields = data.variableFields?.length
      ? data.variableFields.map((f) => ({ ...f }))
      : [{ ...DEFAULT_NAME_FIELD }]
    const emptyRow: Record<string, string> = {}
    for (const field of variableFields) emptyRow[field.id] = ''

    set({
      materialId: data.materialId,
      variationId: data.variationId,
      designMethod: data.designMethod ?? 'printed',
      savedPrintColors: new Map<string, string>(),
      activeSide: 'front',
      frontCanvasJson: data.frontCanvasJson,
      backCanvasJson: data.backCanvasJson,
      frontBgColor: data.frontBgColor,
      backBgColor: data.backBgColor,
      designName: data.designName,
      backOption: data.backOption ?? 'qr-only',
      cardNames: [''],
      variableFields,
      cardData: [emptyRow],
      quantity: 1,
      opaqueImageWarning: null,
      opaqueImageId: null,
      designId: null,
      isSaving: false,
      lastSaved: null,
      hasUnsavedChanges: false,
      sourceTemplateId: data.sourceTemplateId,
    })
  },
}))
