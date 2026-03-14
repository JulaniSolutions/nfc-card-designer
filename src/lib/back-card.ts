import { Canvas, Rect, Textbox, Group, type FabricObject } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { getVariation } from '@/config/materials'
import { useDesignStore } from '@/store/design-store'

const QR_BASE_SIZE = 180
const QR_LABEL_FONT = 'Montserrat'
const NAME_FONT = 'Montserrat'
const NAME_FONT_SIZE = 34

export type BackOption = 'qr-only' | 'qr-name'

// Tags for identifying back card objects
const QR_BORDER_TAG = '_qrPlaceholderBorder'
const QR_LABEL_TAG = '_qrPlaceholderLabel'
const NAME_TAG = '_backNameText'

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

function getQrPosition(materialId: string | null, option: BackOption): { left: number; top: number } {
  if (materialId === 'metal') {
    if (option === 'qr-only') {
      // Center of left 2/3
      return { left: (CARD_WIDTH * 2 / 3) / 2, top: CARD_HEIGHT / 2 }
    }
    // QR + Name: top-left area
    return { left: 140, top: 160 }
  }
  // Bamboo/Plastic
  if (option === 'qr-only') {
    return { left: CARD_WIDTH / 2, top: CARD_HEIGHT / 2 }
  }
  // QR + Name: top-right
  return { left: CARD_WIDTH - 180, top: 180 }
}

function getNamePosition(): { left: number; top: number } {
  // Bottom-left
  return { left: 60, top: CARD_HEIGHT - 80 }
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

/**
 * Remove all placeholder-like objects — both tagged (live) and untagged (ghosts from serialization).
 * Ghosts lose their custom tags when Fabric serializes/deserializes, so we match by shape.
 */
function removeAllPlaceholders(canvas: Canvas) {
  const toRemove = canvas.getObjects().filter((obj) => {
    const custom = obj as FabricObject & Record<string, unknown>
    // Tagged objects (current format — Group with tag, or individual tagged objects)
    if (custom[QR_BORDER_TAG] || custom[QR_LABEL_TAG] || custom[NAME_TAG]) return true
    if (custom._isLocked || custom._isPlaceholder) return true
    // Ghost QR border: transparent Rect with dashed stroke (from old serialization)
    if (obj instanceof Rect && obj.fill === 'transparent' && obj.strokeDashArray?.length) return true
    // Ghost QR label: non-editable Textbox with text "QR Code"
    if (obj instanceof Textbox && (obj as Textbox).text === 'QR Code' && !(obj as Textbox).editable) return true
    // Ghost name text
    if (obj instanceof Textbox && (obj as Textbox).text === 'Your Name Here' && obj.originY === 'center' && obj.left === 60) return true
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
  const size = backOption === 'qr-only' ? QR_BASE_SIZE * 1.1 : QR_BASE_SIZE
  const pos = getQrPosition(materialId, backOption)

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
  const label = new Textbox('QR Code', {
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
    left: pos.left,
    top: pos.top,
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
 * Add or update the name text on the back canvas.
 */
export function updateNameText(canvas: Canvas, name: string) {
  const { backOption } = useDesignStore.getState()
  const color = getColor()
  const pos = getNamePosition()

  // Clear any leftover name objects (tagged ones — bulk cleanup done in updateQrPlaceholder)
  removeAllByTag(canvas, NAME_TAG)

  if (backOption !== 'qr-name') {
    canvas.renderAll()
    return
  }

  const displayName = name || 'Your Name Here'

  const nameObj = new Textbox(displayName, {
    fontSize: NAME_FONT_SIZE,
    fontFamily: NAME_FONT,
    fill: color,
    originX: 'left',
    originY: 'center',
    left: pos.left,
    top: pos.top,
    width: CARD_WIDTH - 120,
  })
  markLocked(nameObj, NAME_TAG, 'Name')
  canvas.add(nameObj)

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
