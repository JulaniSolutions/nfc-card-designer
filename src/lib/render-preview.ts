import { Canvas, FabricImage } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { getVariation } from '@/config/materials'

const THUMB_WIDTH = 253
const THUMB_HEIGHT = 160

/** Timeout wrapper — resolves after ms even if the promise hangs */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ])
}

/** Ensure crossOrigin is set on all image objects so external URLs load in canvas */
function setCrossOriginOnImages(parsed: Record<string, unknown>) {
  const objects = parsed.objects as Record<string, unknown>[] | undefined
  if (!objects) return
  for (const obj of objects) {
    if (obj.type === 'image' || obj.src) {
      obj.crossOrigin = 'anonymous'
    }
    // Handle groups with nested objects
    if (obj.objects) {
      setCrossOriginOnImages(obj as Record<string, unknown>)
    }
  }
}

export async function renderCanvasToImage(
  canvasJson: string | null,
  bgColor: string,
  variationId: string | null,
  side: 'front' | 'back'
): Promise<string> {
  const tempCanvasEl = document.createElement('canvas')
  tempCanvasEl.width = CARD_WIDTH
  tempCanvasEl.height = CARD_HEIGHT
  document.body.appendChild(tempCanvasEl)

  try {
    const tempCanvas = new Canvas(tempCanvasEl, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      backgroundColor: bgColor,
    })

    // Load material background image
    if (variationId) {
      const variation = getVariation(variationId)
      const imageSrc = side === 'front' ? variation?.frontImage : variation?.backImage
      if (imageSrc) {
        await new Promise<void>((resolve) => {
          const imgEl = new Image()
          imgEl.onload = () => {
            const fabricImg = new FabricImage(imgEl, {
              originX: 'left',
              originY: 'top',
            })
            fabricImg.scaleToWidth(CARD_WIDTH)
            fabricImg.scaleToHeight(CARD_HEIGHT)
            tempCanvas.backgroundImage = fabricImg
            resolve()
          }
          imgEl.onerror = () => resolve()
          imgEl.src = imageSrc
        })
      }
    }

    if (canvasJson) {
      const parsed = JSON.parse(canvasJson)
      setCrossOriginOnImages(parsed)
      // Timeout after 10s — render what we have rather than hanging forever
      await withTimeout(tempCanvas.loadFromJSON(parsed), 10_000)
    }
    tempCanvas.renderAll()

    const dataUrl = tempCanvas.toDataURL({
      format: 'png',
      multiplier: 2,
    })

    tempCanvas.dispose()
    return dataUrl
  } finally {
    if (tempCanvasEl.parentNode) {
      document.body.removeChild(tempCanvasEl)
    }
  }
}

export async function renderThumbnail(
  canvasJson: string | null,
  bgColor: string,
  variationId: string | null,
): Promise<string> {
  const tempCanvasEl = document.createElement('canvas')
  tempCanvasEl.width = THUMB_WIDTH
  tempCanvasEl.height = THUMB_HEIGHT
  document.body.appendChild(tempCanvasEl)

  try {
    const tempCanvas = new Canvas(tempCanvasEl, {
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
      backgroundColor: bgColor,
    })

    if (variationId) {
      const variation = getVariation(variationId)
      const imageSrc = variation?.frontImage
      if (imageSrc) {
        await new Promise<void>((resolve) => {
          const imgEl = new Image()
          imgEl.onload = () => {
            const fabricImg = new FabricImage(imgEl, {
              originX: 'left',
              originY: 'top',
            })
            fabricImg.scaleToWidth(THUMB_WIDTH)
            fabricImg.scaleToHeight(THUMB_HEIGHT)
            tempCanvas.backgroundImage = fabricImg
            resolve()
          }
          imgEl.onerror = () => resolve()
          imgEl.src = imageSrc
        })
      }
    }

    if (canvasJson) {
      const parsed = JSON.parse(canvasJson)
      // Scale objects to fit thumbnail
      const scaleX = THUMB_WIDTH / CARD_WIDTH
      const scaleY = THUMB_HEIGHT / CARD_HEIGHT
      if (parsed.objects) {
        for (const obj of parsed.objects) {
          obj.left = (obj.left ?? 0) * scaleX
          obj.top = (obj.top ?? 0) * scaleY
          obj.scaleX = (obj.scaleX ?? 1) * scaleX
          obj.scaleY = (obj.scaleY ?? 1) * scaleY
        }
      }
      setCrossOriginOnImages(parsed)
      await withTimeout(tempCanvas.loadFromJSON(parsed), 10_000)
    }
    tempCanvas.renderAll()

    const dataUrl = tempCanvas.toDataURL({
      format: 'jpeg',
      quality: 0.6,
      multiplier: 1,
    })

    tempCanvas.dispose()
    return dataUrl
  } finally {
    if (tempCanvasEl.parentNode) {
      document.body.removeChild(tempCanvasEl)
    }
  }
}
