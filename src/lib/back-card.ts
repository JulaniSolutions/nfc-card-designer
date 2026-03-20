import { Canvas, Rect, Textbox, Group, type FabricObject } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { getVariation } from '@/config/materials'
import { useDesignStore, type VariableField, type CardData } from '@/store/design-store'

const QR_SIZE = 236 // ~20mm on CR80
const QR_LABEL_FONT = 'Arial'
const VARIABLE_FONT = 'Arial'
const VARIABLE_FONT_SIZE = 34

// Padding from card edges
const EDGE_PAD = 60
// Metal NFC chip zone: right 1/3 of card is reserved
const METAL_USABLE_WIDTH = CARD_WIDTH * 2 / 3

// Vertical offset between stacked variable texts
const VARIABLE_STACK_OFFSET = 50

export type BackOption = 'qr-only' | 'qr-name'

// Tags for identifying back card objects
const QR_BORDER_TAG = '_qrPlaceholderBorder'
const QR_LABEL_TAG = '_qrPlaceholderLabel'
const NAME_TAG = '_backNameText' // legacy
const VARIABLE_ID_PROP = '_variableId'

function getEngravedColor(): string {
  const { variationId } = useDesignStore.getState()
  if (!variationId) return '#808080'
  const variation = getVariation(variationId)
  return variation?.engravedColor ?? '#808080'
}

function getDefaultPrintColor(): string {
  const { variationId } = useDesignStore.getState()
  if (!variationId) return '#000000'
  const variation = getVariation(variationId)
  return variation?.defaultPrintColor ?? '#000000'
}

function getColor(): string {
  const { materialId } = useDesignStore.getState()
  // Back of metal is always engraved style, bamboo/plastic is printed
  if (materialId === 'metal') return getEngravedColor()
  return getDefaultPrintColor()
}

function markLocked(obj: FabricObject, tag: string, layerLabel: string) {
  const tagged = obj as FabricObject & Record<string, unknown>
  tagged[tag] = true
  tagged._isLocked = true
  tagged._layerLabel = layerLabel
  obj.set({
    hasControls: false,
    lockScalingX: true,
    lockScalingY: true,
    lockRotation: true,
  })
}

function markVariable(obj: FabricObject, layerLabel: string, variableId: string) {
  const tagged = obj as FabricObject & Record<string, unknown>
  // Only the Name variable is undeletable; custom variables can be deleted from layers
  tagged._undeletable = variableId === 'name'
  tagged._layerLabel = layerLabel
  tagged[VARIABLE_ID_PROP] = variableId
}

function getQrPosition(materialId: string | null, option: BackOption): { left: number; top: number; size: number } {
  const size = QR_SIZE

  if (materialId === 'metal') {
    if (option === 'qr-only') {
      // Centered within the left 2/3 (avoiding NFC chip on right)
      return { left: METAL_USABLE_WIDTH / 2, top: CARD_HEIGHT / 2, size }
    }
    // QR + Name: top-left corner
    return { left: EDGE_PAD + size / 2, top: EDGE_PAD + size / 2, size }
  }

  // Plastic / Bamboo
  if (option === 'qr-only') {
    // Dead center
    return { left: CARD_WIDTH / 2, top: CARD_HEIGHT / 2, size }
  }
  // QR + Name: top-right corner
  return { left: CARD_WIDTH - EDGE_PAD - size / 2, top: EDGE_PAD + size / 2, size }
}

function getVariablePosition(_materialId: string | null, fieldIndex: number): { left: number; top: number } {
  // Name (index 0) at bottom within the margin, additional variables stack upward
  // Use a half-line offset so center-origin text stays inside the boundary
  const baseTop = CARD_HEIGHT - EDGE_PAD - Math.round(VARIABLE_FONT_SIZE / 2)
  const top = baseTop - (fieldIndex * VARIABLE_STACK_OFFSET)
  return { left: EDGE_PAD, top }
}

/**
 * Remove all existing instances of a tagged object.
 */
function removeAllByTag(canvas: Canvas, tag: string) {
  const toRemove = canvas.getObjects().filter((obj) => {
    return (obj as FabricObject & Record<string, unknown>)[tag] === true
  })
  for (const obj of toRemove) {
    canvas.remove(obj)
  }
}

function findByVariableId(canvas: Canvas, variableId: string): Textbox | null {
  return (canvas.getObjects().find((obj) => {
    return (obj as FabricObject & Record<string, unknown>)[VARIABLE_ID_PROP] === variableId
  }) as Textbox | null) || null
}

function findAllVariableTexts(canvas: Canvas): FabricObject[] {
  return canvas.getObjects().filter((obj) => {
    return (obj as FabricObject & Record<string, unknown>)[VARIABLE_ID_PROP] !== undefined
  })
}

/**
 * Remove all placeholder-like objects — both tagged (live) and untagged (ghosts from serialization).
 * Ghosts lose their custom tags when Fabric serializes/deserializes, so we match by shape.
 */
function removeAllPlaceholders(canvas: Canvas) {
  const toRemove = canvas.getObjects().filter((obj) => {
    const custom = obj as FabricObject & Record<string, unknown>
    // Tagged objects (current format — Group with tag, or individual tagged objects)
    if (custom[QR_BORDER_TAG] || custom[QR_LABEL_TAG]) return true
    if (custom._isLocked || custom._isPlaceholder) return true
    // Ghost QR border: transparent Rect with dashed stroke (from old serialization)
    if (obj instanceof Rect && obj.fill === 'transparent' && obj.strokeDashArray?.length) return true
    // Ghost QR label: non-editable Textbox with text "QR Code"
    if (obj instanceof Textbox && ((obj as Textbox).text === 'QR Code' || (obj as Textbox).text === 'Your QR') && !(obj as Textbox).editable) return true
    // Ghost name text (from old serialization before _undeletable was added)
    if (obj instanceof Textbox && (obj as Textbox).text === 'Your Name Here' && obj.originY === 'center' && obj.left === 60 && !custom._undeletable) return true
    // Ghost groups (serialized Group objects)
    if (obj instanceof Group) {
      const children = obj.getObjects()
      const hasQrRect = children.some((c) => c instanceof Rect && c.fill === 'transparent' && c.strokeDashArray?.length)
      if (hasQrRect) return true
    }
    return false
  })
  for (const obj of toRemove) {
    canvas.remove(obj)
  }
}

/**
 * Add or update the QR code placeholder on the back canvas.
 */
export function updateQrPlaceholder(canvas: Canvas) {
  const { materialId, backOption } = useDesignStore.getState()
  const color = getColor()
  const { left, top, size } = getQrPosition(materialId, backOption)

  // Clear all placeholder objects (tagged + untagged ghosts from serialization)
  removeAllPlaceholders(canvas)

  // Create border
  const border = new Rect({
    width: size,
    height: size,
    fill: 'transparent',
    stroke: color,
    strokeDashArray: [16, 8],
    strokeWidth: 2,
    opacity: 0.5,
    originX: 'center',
    originY: 'center',
  })

  // Create label
  const label = new Textbox('Your QR', {
    fontSize: 22,
    fontFamily: QR_LABEL_FONT,
    fill: color,
    opacity: 0.65,
    textAlign: 'center',
    originX: 'center',
    originY: 'center',
    width: size,
    editable: false,
    selectable: false,
    evented: false,
  })

  // Group border + label as a single movable unit
  const group = new Group([border, label], {
    originX: 'center',
    originY: 'center',
    left,
    top,
    subTargetCheck: false,
    interactive: false,
  })
  markLocked(group, QR_BORDER_TAG, 'QR Code')

  canvas.add(group)

  // Move QR group to bottom of stack (behind user content)
  canvas.sendObjectToBack(group)

  canvas.renderAll()
}

/**
 * Add, update, or remove variable text objects on the back canvas.
 * Each variable field gets its own Textbox tagged with _variableId.
 */
export function updateVariableTexts(canvas: Canvas, variableFields: VariableField[], cardData: CardData) {
  const { materialId, backOption } = useDesignStore.getState()
  const color = getColor()
  const maxWidth = materialId === 'metal' ? METAL_USABLE_WIDTH - EDGE_PAD * 2 : CARD_WIDTH - EDGE_PAD * 2

  // Safety: remove any stray variable objects from the OTHER canvas
  const otherCanvas = canvas === window.__fabricCanvasBack
    ? window.__fabricCanvasFront
    : window.__fabricCanvasBack
  if (otherCanvas) {
    for (const obj of findAllVariableTexts(otherCanvas)) {
      otherCanvas.remove(obj)
    }
    // Also clean up legacy name tags
    removeAllByTag(otherCanvas, NAME_TAG)
  }

  // Clean up legacy _backNameText objects (migrate to _variableId system)
  removeAllByTag(canvas, NAME_TAG)

  if (backOption !== 'qr-name') {
    // Remove all variable texts when in qr-only mode
    for (const obj of findAllVariableTexts(canvas)) {
      canvas.remove(obj)
    }
    canvas.renderAll()
    return
  }

  const firstCardValues = cardData[0] || {}
  const activeVariableIds = new Set(variableFields.map((f) => f.id))

  // Remove orphaned variable texts (fields that no longer exist)
  for (const obj of findAllVariableTexts(canvas)) {
    const varId = (obj as FabricObject & Record<string, unknown>)[VARIABLE_ID_PROP] as string
    if (!activeVariableIds.has(varId)) {
      canvas.remove(obj)
    }
  }

  // Add or update each variable field
  for (let i = 0; i < variableFields.length; i++) {
    const field = variableFields[i]
    const value = firstCardValues[field.id] || ''
    const placeholder = field.id === 'name' ? 'Your Name Here' : field.label
    const displayText = value || placeholder

    const existing = findByVariableId(canvas, field.id)
    if (existing) {
      // Update text in place (unless user is actively editing on canvas)
      const isEditing = (existing as Textbox & { isEditing?: boolean }).isEditing
      if (!isEditing && existing.text !== displayText) {
        // Temporarily remove the changed listener to avoid store → canvas → store loop
        existing.off('changed')
        existing.set('text', displayText)
        // Re-attach listener
        existing.on('changed', () => {
          useDesignStore.getState().setCardValue(0, field.id, existing.text || '')
        })
      }
      if (existing.fill !== color) {
        existing.set('fill', color)
      }
      // Update layer label in case it was renamed
      ;(existing as unknown as Record<string, unknown>)._layerLabel = field.label
      continue
    }

    // Create new variable text
    const pos = getVariablePosition(materialId, i)
    // Start at half the available width — user can drag the right handle to resize for wrapping
    const initialWidth = Math.round(maxWidth * 0.5)
    const textObj = new Textbox(displayText, {
      fontSize: VARIABLE_FONT_SIZE,
      fontFamily: VARIABLE_FONT,
      fill: color,
      originX: 'left',
      originY: 'center',
      left: pos.left,
      top: pos.top,
      width: initialWidth,
      editable: true,
    })
    markVariable(textObj, field.label, field.id)
    // Enable right-side handle for width resizing (text wrapping), hide others
    textObj.setControlsVisibility({ ml: false, mr: true, mt: false, mb: false })

    // Sync canvas edits back to the store
    textObj.on('changed', () => {
      useDesignStore.getState().setCardValue(0, field.id, textObj.text || '')
    })

    canvas.add(textObj)
  }

  canvas.renderAll()
}

/**
 * Remove all variable text objects from the canvas.
 */
export function removeAllVariableTexts(canvas: Canvas) {
  for (const obj of findAllVariableTexts(canvas)) {
    canvas.remove(obj)
  }
  // Also clean up any legacy name tags
  removeAllByTag(canvas, NAME_TAG)
  canvas.renderAll()
}

/**
 * Remove all back card placeholder elements.
 */
export function clearBackPlaceholders(canvas: Canvas) {
  removeAllPlaceholders(canvas)
  canvas.renderAll()
}

/**
 * Check if an object is a locked back-card element.
 */
export function isLockedElement(obj: FabricObject): boolean {
  const tagged = obj as FabricObject & { _isLocked?: boolean }
  return tagged._isLocked === true
}
