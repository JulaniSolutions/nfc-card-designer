import { Canvas, FabricImage, type FabricObject } from 'fabric'
import { CARD_WIDTH } from '@/config/canvas'

const WAVE_ICON_TAG = '_waveIcon'
const WAVE_ICON_SIZE = 48
const WAVE_MARGIN = 40

/**
 * Check if a wave icon already exists on the canvas.
 */
export function hasWaveIcon(canvas: Canvas): boolean {
  return canvas.getObjects().some((obj) => {
    return (obj as FabricObject & Record<string, unknown>)[WAVE_ICON_TAG] === true
  })
}

/**
 * Remove the wave icon from the canvas.
 */
export function removeWaveIcon(canvas: Canvas) {
  const toRemove = canvas.getObjects().filter((obj) => {
    return (obj as FabricObject & Record<string, unknown>)[WAVE_ICON_TAG] === true
  })
  for (const obj of toRemove) {
    canvas.remove(obj)
  }
  if (toRemove.length > 0) canvas.renderAll()
}

/**
 * Create a tinted version of the wave SVG as a data URL,
 * preserving original aspect ratio.
 */
function createTintedIcon(color: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      // Use natural dimensions to preserve aspect ratio
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      // Scale up for quality while keeping ratio
      const scale = 200 / Math.max(w, h)
      const cw = Math.round(w * scale)
      const ch = Math.round(h * scale)

      const offscreen = document.createElement('canvas')
      offscreen.width = cw
      offscreen.height = ch
      const ctx = offscreen.getContext('2d')!
      ctx.drawImage(img, 0, 0, cw, ch)
      ctx.globalCompositeOperation = 'source-in'
      ctx.fillStyle = color
      ctx.fillRect(0, 0, cw, ch)
      resolve(offscreen.toDataURL('image/png'))
    }
    img.src = '/icons/wave-icon.svg'
  })
}

function findWaveIcon(canvas: Canvas): FabricImage | null {
  const obj = canvas.getObjects().find((o) => {
    return (o as FabricObject & Record<string, unknown>)[WAVE_ICON_TAG] === true
  })
  return obj ? (obj as FabricImage) : null
}

/**
 * Add the NFC wave icon to the front canvas (plastic/bamboo only).
 * Placed in the top-right corner. User can move, resize, or delete it.
 */
export function addWaveIcon(canvas: Canvas, color: string) {
  // Don't add if already present (user may have moved/resized it)
  if (hasWaveIcon(canvas)) return

  createTintedIcon(color).then((dataUrl) => {
    // Re-check in case it was added while loading
    if (hasWaveIcon(canvas)) return

    const tinted = new Image()
    tinted.onload = () => {
      const fabricImg = new FabricImage(tinted, {
        originX: 'right',
        originY: 'top',
        left: CARD_WIDTH - WAVE_MARGIN,
        top: WAVE_MARGIN,
      })
      fabricImg.scaleToWidth(WAVE_ICON_SIZE)

      const tagged = fabricImg as FabricImage & Record<string, unknown>
      tagged[WAVE_ICON_TAG] = true
      tagged._layerLabel = 'NFC Icon'
      tagged._layerType = 'icon'

      canvas.add(fabricImg)
      canvas.renderAll()
    }
    tinted.src = dataUrl
  })
}

/**
 * Update the wave icon color when switching variations (e.g., white → black PVC).
 * Preserves user's position and scale.
 */
export function updateWaveIconColor(canvas: Canvas, color: string) {
  const existing = findWaveIcon(canvas)
  if (!existing) return

  // Save current transform
  const { left, top, scaleX, scaleY, angle } = existing

  createTintedIcon(color).then((dataUrl) => {
    const newImg = new Image()
    newImg.onload = () => {
      existing.setElement(newImg)
      existing.set({ left, top, scaleX, scaleY, angle })
      canvas.renderAll()
    }
    newImg.src = dataUrl
  })
}
