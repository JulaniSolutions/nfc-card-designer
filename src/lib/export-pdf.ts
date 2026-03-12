import { jsPDF } from 'jspdf'
import { Canvas } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { useDesignStore } from '@/store/design-store'

export async function exportDesignAsPdf(): Promise<void> {
  const canvas = window.__fabricCanvas
  if (!canvas) throw new Error('Canvas not initialized')

  const state = useDesignStore.getState()

  const cardWidthMm = 85.6
  const cardHeightMm = 54

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  })

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()

  const x = (pageWidth - cardWidthMm) / 2
  const y = (pageHeight - cardHeightMm) / 2

  const renderSide = async (
    jsonStr: string | null,
    bgColor: string
  ): Promise<string> => {
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

  // Save current side state first
  const currentSide = state.activeSide
  const currentJson = JSON.stringify(canvas.toJSON())
  state.setCanvasJson(currentSide, currentJson)

  const latestState = useDesignStore.getState()

  const [frontDataUrl, backDataUrl] = await Promise.all([
    renderSide(latestState.frontCanvasJson, latestState.frontBgColor),
    renderSide(latestState.backCanvasJson, latestState.backBgColor),
  ])

  pdf.text('Front', pageWidth / 2, y - 4, { align: 'center' })
  pdf.addImage(frontDataUrl, 'PNG', x, y, cardWidthMm, cardHeightMm)
  pdf.setDrawColor(200, 200, 200)
  pdf.roundedRect(x, y, cardWidthMm, cardHeightMm, 2, 2)

  pdf.addPage()
  pdf.text('Back', pageWidth / 2, y - 4, { align: 'center' })
  pdf.addImage(backDataUrl, 'PNG', x, y, cardWidthMm, cardHeightMm)
  pdf.roundedRect(x, y, cardWidthMm, cardHeightMm, 2, 2)

  pdf.save('nfc-card-design.pdf')
}
