import { Canvas, FabricObject, FabricImage, Textbox, IText } from 'fabric'
import * as fabric from 'fabric'
import { getVariation } from '@/config/materials'
import { useDesignStore } from '@/store/design-store'

/**
 * Apply engraved filters to a single image object.
 * Grayscale + BlendColor tint with the card type's engraved color.
 */
export function applyEngravedFiltersToImage(img: FabricImage, engravedColor: string) {
  const grayscale = new fabric.filters.Grayscale()
  const blend = new fabric.filters.BlendColor({
    color: engravedColor,
    mode: 'tint',
    alpha: 1,
  })
  img.filters = [grayscale, blend]
  img.applyFilters()
}

/**
 * Remove engraved filters from a single image object.
 */
export function removeEngravedFiltersFromImage(img: FabricImage) {
  img.filters = []
  img.applyFilters()
}

/**
 * Apply engraved mode to all objects on a canvas.
 * - Images get Grayscale + BlendColor tint
 * - Text gets forced to the engraved color
 *
 * Colors are NOT recorded here. Only a color the user picked themselves is worth
 * restoring later, and this runs over every text object including ones still on
 * the material's default — saving those would restore, say, a black card's white
 * default onto a white card, leaving the text invisible. `savePrintColor` is
 * called from the color picker instead.
 */
export function applyEngravedToCanvas(canvas: Canvas, engravedColor: string) {
  const objects = canvas.getObjects()

  for (const obj of objects) {
    if (obj instanceof FabricImage) {
      applyEngravedFiltersToImage(obj, engravedColor)
    } else if (obj instanceof Textbox || obj instanceof IText) {
      obj.set('fill', engravedColor)
    }
  }

  canvas.renderAll()
}

/**
 * Remove engraved mode from all objects on a canvas.
 * - Images have filters removed (show original colors)
 * - Text colors restored to saved printed colors
 */
export function removeEngravedFromCanvas(canvas: Canvas, defaultPrintColor: string) {
  const store = useDesignStore.getState()
  const objects = canvas.getObjects()

  for (const obj of objects) {
    if (obj instanceof FabricImage) {
      removeEngravedFiltersFromImage(obj)
    } else if (obj instanceof Textbox || obj instanceof IText) {
      const objId = getObjectId(obj)
      const savedColor = objId ? store.getPrintColor(objId) : undefined
      obj.set('fill', savedColor ?? defaultPrintColor)
    }
  }

  canvas.renderAll()
}

/**
 * Get or assign a stable ID for a fabric object (used for color preservation).
 */
export function getObjectId(obj: FabricObject): string | null {
  // Use fabric's built-in object ID or create one
  const custom = obj as FabricObject & { _designId?: string }
  if (!custom._designId) {
    custom._designId = crypto.randomUUID()
  }
  return custom._designId
}

/**
 * Reset text colors on a canvas to a new default when the material contrast changes.
 * Also removes engraved image filters.
 * Any text whose fill matches the old default (or old engraved color) is updated to the new default.
 * Text with custom user-chosen colors is preserved.
 */
export function resetColorsForMaterialSwitch(
  canvas: Canvas,
  oldDefaultPrintColor: string,
  oldEngravedColor: string,
  newDefaultPrintColor: string,
) {
  const store = useDesignStore.getState()
  const objects = canvas.getObjects()

  for (const obj of objects) {
    if (obj instanceof FabricImage) {
      removeEngravedFiltersFromImage(obj)
    } else if (obj instanceof Textbox || obj instanceof IText) {
      const fill = typeof obj.fill === 'string' ? obj.fill?.toLowerCase() : null
      const isOldDefault = fill === oldDefaultPrintColor.toLowerCase()
      const isOldEngraved = fill === oldEngravedColor.toLowerCase()
      if (!isOldDefault && !isOldEngraved) continue

      // Text sitting on the old engraved colour was overwritten when the design
      // moved to an engraved material — the user's own colour is in the store.
      // Without this, a trip through metal and back silently loses it, and with
      // the engraved/printed toggle gone there is no other way to get it back.
      const objId = (obj as FabricObject & { _designId?: string })._designId
      const savedColor = isOldEngraved && objId ? store.getPrintColor(objId) : undefined
      obj.set('fill', savedColor ?? newDefaultPrintColor)
    }
  }

  canvas.renderAll()
}

/**
 * Get the current engraved color for the selected variation.
 */
export function getCurrentEngravedColor(): string {
  const { variationId } = useDesignStore.getState()
  if (!variationId) return '#C0C0C0'
  const variation = getVariation(variationId)
  return variation?.engravedColor ?? '#C0C0C0'
}

/**
 * Get the current default print color for the selected variation.
 */
export function getCurrentDefaultPrintColor(): string {
  const { variationId } = useDesignStore.getState()
  if (!variationId) return '#000000'
  const variation = getVariation(variationId)
  return variation?.defaultPrintColor ?? '#000000'
}
