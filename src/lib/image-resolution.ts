import type { FabricImage } from 'fabric'
import { CARD_WIDTH } from '@/config/canvas'

/**
 * Print-resolution rules for raster images on the card.
 *
 * The canvas is 1012px across an 85.6mm card, so one canvas pixel ≈ 1/300 inch
 * and an image drawn at scale 1 prints at ~300 DPI. Scaling an image up divides
 * that density down; Fabric draws image elements 1:1 into object units, so the
 * object's effective scale IS canvas-pixels-per-source-pixel. Vector sources
 * (SVG) rasterise at draw time and are exempt.
 */

const CARD_WIDTH_MM = 85.6
export const CANVAS_PPI = Math.round(CARD_WIDTH / (CARD_WIDTH_MM / 25.4)) // ≈ 300

/** Below this effective density the printed image looks visibly soft. */
export const MIN_PRINT_PPI = 150

/** Uploads whose longest edge is under this can't cover half the card sharply. */
export const LOW_RES_UPLOAD_DIMENSION = 500
/** What we tell users to aim for — full-bleed at the canvas's native density. */
export const RECOMMENDED_UPLOAD_DIMENSION = 1000

/**
 * Once dismissed for an image, only re-warn if the user then makes it
 * meaningfully worse (effective DPI drops another 10%+), not on every nudge.
 */
const ACK_SLACK = 0.9

/** Session-only tag: the effective PPI at which the user dismissed the warning. */
export type LowResTagged = FabricImage & { _lowResAckPpi?: number }

function sourceElement(img: FabricImage): HTMLImageElement | HTMLCanvasElement {
  // _originalElement is the unfiltered source; _element may be filter output.
  const internal = img as FabricImage & { _originalElement?: HTMLImageElement }
  return internal._originalElement ?? (img.getElement() as HTMLImageElement | HTMLCanvasElement)
}

/** SVGs rasterise at whatever size they're drawn — scaling them up is fine. */
export function isVectorImage(img: FabricImage): boolean {
  const src = (sourceElement(img) as HTMLImageElement).src ?? ''
  return src.startsWith('data:image/svg') || /\.svg([?#]|$)/i.test(src)
}

/** Source pixel dimensions of the element that will actually print. */
export function getSourceDimensions(img: FabricImage): { width: number; height: number } {
  const el = sourceElement(img)
  return {
    width: (el as HTMLImageElement).naturalWidth || el.width || 0,
    height: (el as HTMLImageElement).naturalHeight || el.height || 0,
  }
}

/** True when an upload is too small to ever cover much of the card sharply. */
export function isLowResSource(width: number, height: number): boolean {
  return Math.max(width, height) < LOW_RES_UPLOAD_DIMENSION
}

/** The density the image prints at when placed at its current on-canvas size. */
export function getEffectivePpi(img: FabricImage): number {
  let sx = Math.abs(img.scaleX ?? 1)
  let sy = Math.abs(img.scaleY ?? 1)
  // Mid-transform on a multi-select, the group's scale isn't baked in yet.
  if (img.group) {
    sx *= Math.abs(img.group.scaleX ?? 1)
    sy *= Math.abs(img.group.scaleY ?? 1)
  }
  const pixelScale = Math.max(sx, sy)
  if (!pixelScale) return CANVAS_PPI
  return CANVAS_PPI / pixelScale
}

/** Record that the user accepted the current density — see ACK_SLACK. */
export function acknowledgeLowRes(img: FabricImage): void {
  (img as LowResTagged)._lowResAckPpi = getEffectivePpi(img)
}

/** Whether the image warrants the low-res banner at its current size. */
export function shouldWarnLowRes(img: FabricImage): boolean {
  if (isVectorImage(img)) return false
  const ppi = getEffectivePpi(img)
  if (ppi >= MIN_PRINT_PPI) return false
  const ack = (img as LowResTagged)._lowResAckPpi
  if (ack != null && ppi >= ack * ACK_SLACK) return false
  return true
}
