import { jsPDF } from 'jspdf'
import { Canvas } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { useDesignStore } from '@/store/design-store'

const pxToMmX = (px: number, cardWidthMm: number) =>
  (px / CARD_WIDTH) * cardWidthMm
const pxToMmY = (px: number, cardHeightMm: number) =>
  (px / CARD_HEIGHT) * cardHeightMm

export async function exportDesignAsPdf(): Promise<void> {
  const canvas = window.__fabricCanvas
  if (!canvas) throw new Error('Canvas not initialized')

  const state = useDesignStore.getState()

  const cardWidthMm = 85.6
  const cardHeightMm = 54

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [cardWidthMm, cardHeightMm],
  })

  const renderSide = async (
    jsonStr: string | null,
    bgColor: string
  ): Promise<void> => {
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

      if (jsonStr) {
        const parsed = JSON.parse(jsonStr)
        await tempCanvas.loadFromJSON(parsed)
      }
      tempCanvas.renderAll()

      const objects = tempCanvas.getObjects()

      // 1. Render background layer only (bg color + bg image, no design objects) as JPEG
      objects.forEach((obj) => obj.set('visible', false))
      tempCanvas.renderAll()
      const bgDataUrl = tempCanvas.toDataURL({
        format: 'jpeg',
        quality: 0.85,
        multiplier: 1,
      })
      pdf.addImage(bgDataUrl, 'JPEG', 0, 0, cardWidthMm, cardHeightMm)

      // Restore visibility for individual object rendering
      objects.forEach((obj) => obj.set('visible', true))

      // 2. Render each object as a separate PDF element (gives layers in Illustrator)
      for (const obj of objects) {
        const bounds = obj.getBoundingRect()
        if (bounds.width < 1 || bounds.height < 1) continue

        const objDataUrl = obj.toDataURL({
          format: 'png',
          multiplier: 1,
        })

        pdf.addImage(
          objDataUrl,
          'PNG',
          pxToMmX(bounds.left, cardWidthMm),
          pxToMmY(bounds.top, cardHeightMm),
          pxToMmX(bounds.width, cardWidthMm),
          pxToMmY(bounds.height, cardHeightMm)
        )
      }

      tempCanvas.dispose()
    } finally {
      if (tempCanvasEl.parentNode) {
        document.body.removeChild(tempCanvasEl)
      }
    }
  }

  // Save both canvases' current state
  if (window.__fabricCanvasFront) {
    state.setCanvasJson(
      'front',
      JSON.stringify(window.__fabricCanvasFront.toJSON())
    )
  }
  if (window.__fabricCanvasBack) {
    state.setCanvasJson(
      'back',
      JSON.stringify(window.__fabricCanvasBack.toJSON())
    )
  }

  const latestState = useDesignStore.getState()

  // Render front side
  await renderSide(latestState.frontCanvasJson, latestState.frontBgColor)

  // Add second page and render back side
  pdf.addPage([cardWidthMm, cardHeightMm], 'landscape')
  await renderSide(latestState.backCanvasJson, latestState.backBgColor)

  pdf.save('nfc-card-design.pdf')
}
