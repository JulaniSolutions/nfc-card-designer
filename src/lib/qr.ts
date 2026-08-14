import QRCode from 'qrcode'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { renderCanvasToImage } from '@/lib/render-preview'

/**
 * QR generation for production print files.
 *
 * Stateless by design: a QR is rendered on demand from a card URL, injected onto an
 * offscreen render canvas (tagged `_qrInjected`) and thrown away. Nothing here ever
 * touches the Zustand store, the live editor canvases or Supabase — the WordPress
 * ref pool stays the single source of truth for what each card points at.
 *
 * ## Colour rules (locked)
 *
 * | Side | `dark` | `light` |
 * |---|---|---|
 * | Engraved (production JPEG, black artwork on white) | `#000000` | `#FFFFFF` |
 * | Printed on a light card body (transparent PNG) | `#000000` | `#0000` |
 * | Printed on a dark card body (transparent PNG) | `#FFFFFF` | `#0000` |
 *
 * Engraved sides are never auto-contrasted: the production file is black-on-white
 * whatever the finished card looks like, because the tint is the metal itself.
 * Printed sides sample the card under the placeholder — see
 * `detectQrRegionLuminance` — so a QR over a black PVC body (or over a dark image
 * the user placed there) comes out in white modules with transparent gaps.
 */

export interface QrImage {
  dataUrl: string
  sizePx: number
}

export interface QrColors {
  /** Module colour. */
  dark: string
  /** Quiet-zone / gap colour. `'#0000'` is transparent. */
  light: string
}

/** Error correction level — `M` survives the supplier's print/engrave process. */
const ERROR_CORRECTION_LEVEL = 'M'
/** Quiet zone, in modules, kept *inside* the placeholder box. */
const QUIET_ZONE_MODULES = 2

export const QR_DARK = '#000000'
export const QR_LIGHT = '#FFFFFF'
/** Transparent gaps, so a printed PNG lets the card body show through. */
export const QR_TRANSPARENT = '#0000'

/** Below this average luminance the card body reads as dark, so modules go white. */
export const DARK_BODY_LUMINANCE = 128
/** Assumed when the region cannot be sampled: a light body, i.e. black modules. */
const ASSUMED_LUMINANCE = 255

/**
 * Long URLs still encode fine at level M inside a ~20 mm box, but the modules get
 * small enough that a worn or matte-engraved card can become unreliable to scan.
 */
export const QR_URL_WARN_LENGTH = 300

/**
 * Render a QR code as a PNG data URL.
 *
 * `sizePx` is the *final* pixel size — placeholder size × the export multiplier —
 * so modules are crisp at 600 DPI; the caller then scales the image down to the
 * placeholder's canvas geometry. The encoder honours `width` to within a pixel
 * (it floors to a whole module scale), so the returned `sizePx` is what was asked
 * for rather than a re-measurement.
 */
export async function generateQrImage(
  url: string,
  opts: { sizePx: number; dark: string; light: string },
): Promise<QrImage> {
  const value = url.trim()
  if (!value) {
    throw new Error('Cannot generate a QR code from an empty URL.')
  }

  const dataUrl = await QRCode.toDataURL(value, {
    errorCorrectionLevel: ERROR_CORRECTION_LEVEL,
    margin: QUIET_ZONE_MODULES,
    width: opts.sizePx,
    color: { dark: opts.dark, light: opts.light },
  })

  return { dataUrl, sizePx: opts.sizePx }
}

/**
 * The colours for one side, following the table at the top of this module.
 *
 * `luminance` is ignored for engraved sides and may be omitted for them; on a
 * printed side, omitting it assumes a light body (black modules).
 */
export function resolveQrColors(engraved: boolean, luminance?: number): QrColors {
  if (engraved) return { dark: QR_DARK, light: QR_LIGHT }
  const sampled = luminance ?? ASSUMED_LUMINANCE
  return {
    dark: sampled < DARK_BODY_LUMINANCE ? QR_LIGHT : QR_DARK,
    light: QR_TRANSPARENT,
  }
}

/** Scan reliability, not a hard limit — the QR still encodes. */
export function isQrUrlOverlong(url: string): boolean {
  return url.trim().length > QR_URL_WARN_LENGTH
}

/**
 * Average luminance (`0.299R + 0.587G + 0.114B`, 0–255) of the card under the QR
 * placeholder. `< 128` ⇒ dark body ⇒ white QR modules.
 *
 * Samples the *preview* render, which layers the material mockup image behind the
 * artwork — that image lives outside the canvas JSON, so it is the only thing that
 * makes pvc-black and metal read as dark when the stored background colour is
 * `#ffffff`. Any artwork the user placed behind the placeholder is included too.
 *
 * `region` is centre-origin, in canvas pixels — exactly the geometry the print
 * export reads off the placeholder.
 *
 * Never throws: an unsampleable back (dead asset, tainted canvas, no document)
 * resolves to a light body, which is the safe default of black modules.
 */
export async function detectQrRegionLuminance(
  backCanvasJson: string | null,
  backBgColor: string,
  variationId: string | null,
  region: { left: number; top: number; size: number },
): Promise<number> {
  try {
    const dataUrl = await renderCanvasToImage(backCanvasJson, backBgColor, variationId, 'back')
    const image = await loadImage(dataUrl)

    const element = document.createElement('canvas')
    element.width = image.naturalWidth || image.width
    element.height = image.naturalHeight || image.height
    const context = element.getContext('2d', { willReadFrequently: true })
    if (!context || !element.width || !element.height) return ASSUMED_LUMINANCE
    context.drawImage(image, 0, 0)

    // The preview renders the card at a multiplier, so canvas pixels are not image pixels.
    const scaleX = element.width / CARD_WIDTH
    const scaleY = element.height / CARD_HEIGHT
    const left = Math.round((region.left - region.size / 2) * scaleX)
    const top = Math.round((region.top - region.size / 2) * scaleY)
    const width = Math.round(region.size * scaleX)
    const height = Math.round(region.size * scaleY)

    // A placeholder dragged half off the card still has to yield a reading, so clamp
    // to the part that is actually on the card rather than reading out of bounds.
    const x = Math.max(0, Math.min(left, element.width - 1))
    const y = Math.max(0, Math.min(top, element.height - 1))
    const w = Math.max(1, Math.min(width, element.width - x))
    const h = Math.max(1, Math.min(height, element.height - y))

    const { data } = context.getImageData(x, y, w, h)
    let total = 0
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      // Transparent pixels mean nothing was drawn there. The mockup normally covers
      // the whole card, so this is defensive: composite over the white the printed
      // card body defaults to rather than counting the pixel as black.
      total += alpha * luminance + (1 - alpha) * ASSUMED_LUMINANCE
      count++
    }
    return count ? total / count : ASSUMED_LUMINANCE
  } catch {
    return ASSUMED_LUMINANCE
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('QR luminance sample: preview image failed to load'))
    image.src = src
  })
}
