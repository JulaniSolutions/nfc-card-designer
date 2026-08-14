import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

/**
 * Reading a QR back off a finished print file (PLAN-02 testing).
 *
 * Everything here happens *in the page*: decoding needs a canvas to turn PNG/JPEG
 * bytes into pixels, and Node has neither. jsQR is injected as its UMD build with
 * `addScriptTag`, so it works on any page — the print harness or the real
 * `/design/:id` — without going through Vite's dependency optimiser (a mid-test
 * re-optimisation reloads the page, which is exactly the flake worth avoiding).
 *
 * The point of decoding rather than snapshotting: it proves the *exported back
 * file* is scannable at the placeholder's position, in the colours the material
 * chose, and that it encodes that card's URL and no other.
 */

/** Card canvas width in px (`src/config/canvas.ts`); print files are a multiple of it. */
const CARD_WIDTH = 1012

const JSQR_UMD = fileURLToPath(new URL('../../node_modules/jsqr/dist/jsQR.js', import.meta.url))

export interface QrRegion {
  /** Centre-origin, in canvas pixels — the geometry the placeholder occupied. */
  left: number
  top: number
  size: number
}

export interface QrRegionProbe {
  /** The string the QR encodes, or `null` when nothing scannable is there. */
  decoded: string | null
  /** Pixel counts inside the placeholder box, classified by what would print. */
  transparent: number
  dark: number
  light: number
  other: number
  total: number
}

interface JsQrResult {
  data: string
}

type JsQr = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts: 'attemptBoth' | 'dontInvert' | 'onlyInvert' | 'invertFirst' },
) => JsQrResult | null

/** Load jsQR into the page. Idempotent — safe to call per test. */
export async function injectQrDecoder(page: Page): Promise<void> {
  const present = await page.evaluate(() => 'jsQR' in window)
  if (!present) await page.addScriptTag({ path: JSQR_UMD })
}

/**
 * Crop the placeholder box out of a rendered print file, classify its pixels and
 * decode whatever QR is there.
 *
 * Decoding is attempted over both a white and a black ground: a printed PNG leaves
 * its gaps transparent, so white modules (dark card body) are invisible against
 * white and black modules are invisible against black.
 */
export async function probeQrRegion(
  page: Page,
  args: { base64: string; mime: string; region: QrRegion },
): Promise<QrRegionProbe> {
  return page.evaluate(async ({ base64, mime, region, cardWidth }) => {
    const response = await fetch(`data:${mime};base64,${base64}`)
    const bitmap = await createImageBitmap(await response.blob())

    // Print files are rendered at a multiplier, so scale off the raster itself.
    const scale = bitmap.width / cardWidth
    const half = (region.size / 2) * scale
    const x = Math.max(0, Math.round(region.left * scale - half))
    const y = Math.max(0, Math.round(region.top * scale - half))
    const width = Math.min(Math.round(region.size * scale), bitmap.width - x)
    const height = Math.min(Math.round(region.size * scale), bitmap.height - y)

    const crop = (background?: string) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      if (background) {
        context.fillStyle = background
        context.fillRect(0, 0, width, height)
      }
      context.drawImage(bitmap, x, y, width, height, 0, 0, width, height)
      return context.getImageData(0, 0, width, height)
    }

    // Classify on the untouched crop: alpha is meaningful on a printed PNG.
    const { data } = crop()
    let transparent = 0
    let dark = 0
    let light = 0
    let other = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 16) {
        transparent++
        continue
      }
      const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (luminance <= 90) dark++
      else if (luminance >= 200) light++
      else other++
    }

    const jsQR = (window as unknown as { jsQR: JsQr }).jsQR
    let decoded: string | null = null
    for (const background of ['#ffffff', '#000000']) {
      const image = crop(background)
      const result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
      if (result?.data) {
        decoded = result.data
        break
      }
    }
    bitmap.close()

    return { decoded, transparent, dark, light, other, total: transparent + dark + light + other }
  }, { ...args, cardWidth: CARD_WIDTH })
}
