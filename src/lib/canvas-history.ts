import type { Canvas } from 'fabric'

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
 * Undo the last action.
 */
export async function undo(canvas: Canvas, _customProps?: string[]) {
  const h = getHistory(canvas)
  if (h.undoStack.length <= 1) return // Need at least one state to revert to

  // Save current state to redo
  h.redoStack.push(h.undoStack.pop()!)

  const prev = h.undoStack[h.undoStack.length - 1]
  h.locked = true
  await canvas.loadFromJSON(JSON.parse(prev))
  canvas.renderAll()
  h.locked = false
}

/**
 * Redo the last undone action.
 */
export async function redo(canvas: Canvas, _customProps?: string[]) {
  const h = getHistory(canvas)
  if (h.redoStack.length === 0) return

  const next = h.redoStack.pop()!
  h.undoStack.push(next)
  h.locked = true
  await canvas.loadFromJSON(JSON.parse(next))
  canvas.renderAll()
  h.locked = false
}

/**
 * Check if history push is currently locked (during undo/redo).
 */
export function isHistoryLocked(canvas: Canvas): boolean {
  return getHistory(canvas).locked
}
