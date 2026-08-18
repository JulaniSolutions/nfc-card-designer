import { Canvas, Rect, Textbox, Group, type FabricObject } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { getVariation, isBackEngraved } from '@/config/materials'
import { useDesignStore, type VariableField, type CardData } from '@/store/design-store'

const QR_SIZE = 236 // ~20mm on CR80
const QR_LABEL_FONT = 'Arial'
const VARIABLE_FONT = 'Arial'
// ~3.7mm on CR80 (roughly 10.5pt) — reads as a name, not a footnote
const VARIABLE_FONT_SIZE = 44

// Padding from card edges
const EDGE_PAD = 60
// Metal NFC chip zone: right 1/3 of card is reserved
const METAL_USABLE_WIDTH = CARD_WIDTH * 2 / 3

// Vertical offset between stacked variable texts.
// Must stay clear of the default line height (fontSize * ~1.16) or stacked fields overlap.
const VARIABLE_STACK_OFFSET = 64

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
  if (isBackEngraved(materialId)) return getEngravedColor()
  return getDefaultPrintColor()
}

function markVariable(obj: FabricObject, layerLabel: string, variableId: string) {
  const tagged = obj as FabricObject & Record<string, unknown>
  // Only the Name variable is undeletable; custom variables can be deleted from layers
  tagged._undeletable = variableId === 'name'
  tagged._layerLabel = layerLabel
  tagged[VARIABLE_ID_PROP] = variableId
}

/**
 * Where the QR placeholder sits for a given material and back layout.
 *
 * Exported for the print export, which needs the same geometry as a fallback for
 * designs saved before the placeholder existed.
 */
export function getQrPosition(materialId: string | null, option: BackOption): { left: number; top: number; size: number } {
  const size = QR_SIZE

  if (isBackEngraved(materialId)) {
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

/** A dashed transparent Rect — the QR border as it survives serialization. */
function isGhostQrRect(obj: FabricObject): boolean {
  return obj instanceof Rect && obj.fill === 'transparent' && !!obj.strokeDashArray?.length
}

/**
 * Whether an object is part of the back-card placeholder furniture — either tagged
 * (current format) or an untagged ghost from an older serialization, which has to
 * be matched by shape because Fabric drops the custom tags.
 *
 * Shared with the print export, which strips the same set from production files.
 */
export function isPlaceholderLike(obj: FabricObject): boolean {
  const custom = obj as FabricObject & Record<string, unknown>
  // Tagged objects (current format — Group with tag, or individual tagged objects)
  if (custom[QR_BORDER_TAG] || custom[QR_LABEL_TAG]) return true
  if (custom._isLocked || custom._isPlaceholder) return true
  // Ghost QR border: transparent Rect with dashed stroke (from old serialization)
  if (isGhostQrRect(obj)) return true
  // Ghost QR label: non-editable Textbox with text "QR Code"
  if (obj instanceof Textbox && ((obj as Textbox).text === 'QR Code' || (obj as Textbox).text === 'Your QR' || (obj as Textbox).text === 'QR code added\nautomatically') && !(obj as Textbox).editable) return true
  // Ghost name text (from old serialization before _undeletable was added)
  if (obj instanceof Textbox && (obj as Textbox).text === 'Your Name Here' && obj.originY === 'center' && obj.left === 60 && !custom._undeletable) return true
  // Ghost groups (serialized Group objects)
  if (obj instanceof Group) {
    const children = obj.getObjects()
    if (children.some(isGhostQrRect)) return true
  }
  return false
}

/**
 * Whether an object is specifically the QR placeholder itself — the tagged group or
 * a ghost carrying its dashed border. Narrower than `isPlaceholderLike`, which also
 * covers labels and legacy name text, so the print export can read the QR geometry
 * off the right object.
 */
export function isQrPlaceholder(obj: FabricObject): boolean {
  if ((obj as FabricObject & Record<string, unknown>)[QR_BORDER_TAG]) return true
  if (isGhostQrRect(obj)) return true
  return obj instanceof Group && obj.getObjects().some(isGhostQrRect)
}

/**
 * Remove all placeholder-like objects — both tagged (live) and untagged (ghosts from serialization).
 */
function removeAllPlaceholders(canvas: Canvas) {
  const toRemove = canvas.getObjects().filter(isPlaceholderLike)
  for (const obj of toRemove) {
    canvas.remove(obj)
  }
}

/**
 * Add or update the QR code placeholder on the back canvas.
 *
 * When the user has deleted the QR (`qrRemoved`), this strips any placeholder
 * instead — including ones re-materialising from a loaded JSON or an undo.
 */
export function updateQrPlaceholder(canvas: Canvas) {
  const { materialId, backOption, qrRemoved } = useDesignStore.getState()

  if (qrRemoved) {
    removeAllPlaceholders(canvas)
    canvas.renderAll()
    return
  }
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
  const label = new Textbox('QR code added\nautomatically', {
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
  // Mark as undeletable (not locked) so it appears as a normal expandable layer
  const tagged = group as Group & Record<string, unknown>
  tagged[QR_BORDER_TAG] = true
  tagged._undeletable = true
  tagged._layerLabel = 'QR Code'
  tagged._layerType = 'qr'
  // Allow scaling up but not below original size; corners only, locked aspect ratio
  group.set({
    lockUniScaling: true,
    minScaleLimit: 1,
    lockRotation: true,
  })
  group.setControlsVisibility({
    ml: false, mr: false, mt: false, mb: false,  // no side handles
    tl: true, tr: true, bl: true, br: true,      // corner handles only
    mtr: false,                                    // no rotation
  })

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
  const maxWidth = isBackEngraved(materialId) ? METAL_USABLE_WIDTH - EDGE_PAD * 2 : CARD_WIDTH - EDGE_PAD * 2

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
      }
      // Always (re)bind, not just when the text changed. Objects restored from
      // saved JSON — a loaded design or a forked template — arrive with no
      // listeners at all, and if their text already matches the store the old
      // conditional never bound one, so typing into them updated nothing.
      existing.off('changed')
      existing.on('changed', () => {
        useDesignStore.getState().setCardValue(0, field.id, existing.text || '')
      })
      if (existing.fill !== color) {
        existing.set('fill', color)
      }
      // Update layer label in case it was renamed
      ;(existing as unknown as Record<string, unknown>)._layerLabel = field.label
      continue
    }

    // Create new variable text
    const pos = getVariablePosition(materialId, i)
    const initialWidth = maxWidth
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
    // Lock scaling — font size only changeable via layers panel
    textObj.set({ lockScalingX: true, lockScalingY: true })
    // Side handles for text wrapping width, no corners (scaling locked), keep rotation
    textObj.setControlsVisibility({ ml: true, mr: true, mt: false, mb: false, tl: false, tr: false, bl: false, br: false, mtr: true })

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
