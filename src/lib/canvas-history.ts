import type { Canvas, FabricObject } from 'fabric'

const MAX_HISTORY = 30

interface HistoryStack {
  undoStack: string[]
  redoStack: string[]
  locked: boolean
}

const histories = new WeakMap<Canvas, HistoryStack>()

function getHistory(canvas: Canvas): HistoryStack {
  let h = histories.get(canvas)
  if (!h) {
    h = { undoStack: [], redoStack: [], locked: false }
    histories.set(canvas, h)
  }
  return h
}

type TaggedObject = FabricObject & {
  _isPlaceholder?: boolean
  _isLocked?: boolean
  _undeletable?: boolean
  _waveIcon?: boolean
  _qrPlaceholderBorder?: boolean
  _qrPlaceholderLabel?: boolean
  _backNameText?: boolean
}

/** Returns true for system-managed elements that undo/redo should never delete/add */
function isProtectedElement(obj: FabricObject): boolean {
  const t = obj as TaggedObject
  return !!(
    t._isPlaceholder ||
    t._isLocked ||
    t._undeletable ||
    t._waveIcon ||
    t._qrPlaceholderBorder ||
    t._qrPlaceholderLabel ||
    t._backNameText
  )
}

/** Position/transform properties to copy when restoring a protected element */
const POSITION_PROPS = [
  'left', 'top', 'scaleX', 'scaleY', 'angle', 'flipX', 'flipY',
  'originX', 'originY', 'skewX', 'skewY',
] as const

/**
 * Save the current canvas state to the undo stack.
 * Call this on object:added, object:removed, object:modified.
 */
export function pushState(canvas: Canvas, customProps: string[]) {
  const h = getHistory(canvas)
  if (h.locked) return
  const json = JSON.stringify(canvas.toObject(customProps))
  // Don't push if identical to last state
  if (h.undoStack.length > 0 && h.undoStack[h.undoStack.length - 1] === json) return
  h.undoStack.push(json)
  if (h.undoStack.length > MAX_HISTORY) h.undoStack.shift()
  // Any new action clears the redo stack
  h.redoStack.length = 0
}

/**
 * Discard all history for a canvas and seed it with the current state.
 *
 * For changes the user must not be able to undo past — the state before them is
 * no longer a valid design, so leaving it on the stack would let undo walk back
 * into it.
 */
export function resetHistory(canvas: Canvas, customProps: string[]) {
  const h = getHistory(canvas)
  h.undoStack.length = 0
  h.redoStack.length = 0
  h.undoStack.push(JSON.stringify(canvas.toObject(customProps)))
}

/**
 * Restore canvas state while preserving background and protected elements.
 * - Protected elements are never added or removed, only repositioned.
 * - User elements are fully replaced from the saved state.
 */
async function restoreState(canvas: Canvas, json: string) {
  // Save references to current protected elements
  const protectedObjects = canvas.getObjects().filter(isProtectedElement)

  // Preserve background
  const bgImage = canvas.backgroundImage
  const bgColor = canvas.backgroundColor

  // Load the full state (this replaces everything)
  await canvas.loadFromJSON(JSON.parse(json))

  // Restore background
  canvas.backgroundImage = bgImage
  canvas.backgroundColor = bgColor

  // Find any protected elements that loadFromJSON created (from the saved state)
  // and extract their positions, then remove them
  const restoredProtected = canvas.getObjects().filter(isProtectedElement)
  const positionMap = new Map<string, Record<string, unknown>>()
  for (const obj of restoredProtected) {
    const t = obj as TaggedObject
    const key = t._waveIcon ? '_waveIcon'
      : t._qrPlaceholderBorder ? '_qrPlaceholderBorder'
      : t._qrPlaceholderLabel ? '_qrPlaceholderLabel'
      : t._backNameText ? '_backNameText'
      : t._isPlaceholder ? '_isPlaceholder'
      : t._isLocked ? '_isLocked'
      : null
    if (key) {
      const pos: Record<string, unknown> = {}
      for (const prop of POSITION_PROPS) {
        pos[prop] = (obj as unknown as Record<string, unknown>)[prop]
      }
      positionMap.set(key, pos)
    }
    canvas.remove(obj)
  }

  // Re-add the original protected objects with updated positions
  for (const obj of protectedObjects) {
    const t = obj as TaggedObject
    const key = t._waveIcon ? '_waveIcon'
      : t._qrPlaceholderBorder ? '_qrPlaceholderBorder'
      : t._qrPlaceholderLabel ? '_qrPlaceholderLabel'
      : t._backNameText ? '_backNameText'
      : t._isPlaceholder ? '_isPlaceholder'
      : t._isLocked ? '_isLocked'
      : null
    if (key && positionMap.has(key)) {
      obj.set(positionMap.get(key)!)
      obj.setCoords()
    }
    canvas.add(obj)
  }

  canvas.renderAll()
}

/**
 * Undo the last action.
 * Protected elements (QR, wave icon, name) are never deleted — only repositioned.
 */
export async function undo(canvas: Canvas, _customProps?: string[]) {
  const h = getHistory(canvas)
  if (h.undoStack.length <= 1) return

  h.redoStack.push(h.undoStack.pop()!)

  const prev = h.undoStack[h.undoStack.length - 1]
  h.locked = true
  await restoreState(canvas, prev)
  h.locked = false
}

/**
 * Redo the last undone action.
 * Protected elements (QR, wave icon, name) are never deleted — only repositioned.
 */
export async function redo(canvas: Canvas, _customProps?: string[]) {
  const h = getHistory(canvas)
  if (h.redoStack.length === 0) return

  const next = h.redoStack.pop()!
  h.undoStack.push(next)
  h.locked = true
  await restoreState(canvas, next)
  h.locked = false
}

/**
 * Check if history push is currently locked (during undo/redo).
 */
export function isHistoryLocked(canvas: Canvas): boolean {
  return getHistory(canvas).locked
}
