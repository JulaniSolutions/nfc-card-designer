import type { Canvas } from 'fabric'
import { isFrontEngraved, isSideEngraved, type DesignMethod } from '@/config/materials'
import { useDesignStore, type CardSide } from '@/store/design-store'
import { applyEngravedToCanvas, getCurrentEngravedColor } from '@/lib/engraved-filters'
import { CUSTOM_PROPS } from '@/lib/save-design'
import { resetHistory } from '@/lib/canvas-history'

export const LEGACY_PRINTED_METAL_NOTICE =
  'Printed metal is no longer available, so this design has been converted to engraved. Save to keep the change.'

/**
 * Whether a design is a metal design saved back when printing metal was still
 * offered. Flipping the stored flag is not enough on its own: the artwork itself
 * still carries full-colour images and printed text colours, so the canvases have
 * to be converted too (see `convertCanvasToEngraved`).
 */
export function isLegacyPrintedMetal(
  materialId: string | null,
  designMethod: DesignMethod,
): boolean {
  return designMethod === 'printed' && isFrontEngraved(materialId)
}

/**
 * Convert a loaded canvas to engraved styling in place, then push the result back
 * into the store so save, export and preview all agree with what is on screen.
 *
 * Call this unconditionally after a canvas load: it decides for itself, from the
 * store, whether there is anything to do. Applying it twice is harmless, which is
 * what makes it safe under StrictMode's double mount.
 *
 * Must run *after* Fabric's async `loadFromJSON` has resolved — on a canvas whose
 * objects have not landed yet it silently does nothing.
 */
export function convertCanvasToEngraved(canvas: Canvas, side: CardSide): void {
  const { legacyPrintedMetal, materialId } = useDesignStore.getState()
  // Per side, not per design: the back of Hybrid Metal and 24k Gold is printed,
  // so a legacy design's back artwork on those materials is already correct and
  // must be left alone. Re-checking the material also stops a mid-session switch
  // to plastic plus a canvas remount from engraving a printed design.
  if (!legacyPrintedMetal || !isSideEngraved(materialId, side)) return

  applyEngravedToCanvas(canvas, getCurrentEngravedColor())
  canvas.renderAll()

  // The loaded printed artwork is already on the undo stack, and printed metal is
  // no longer orderable — without this, one Ctrl+Z walks back to artwork the
  // design method now contradicts, and that is what would get saved.
  resetHistory(canvas, CUSTOM_PROPS)

  // applyEngravedToCanvas mutates objects directly and fires no Fabric events, so
  // without this the store would still hold the printed version of the JSON.
  useDesignStore.getState().setCanvasJson(side, JSON.stringify(canvas.toObject(CUSTOM_PROPS)))
}
