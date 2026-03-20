import { jsPDF } from 'jspdf'
import { Canvas, Textbox, IText, Rect, Group, FabricImage, type FabricObject } from 'fabric'
import * as fabric from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { useDesignStore } from '@/store/design-store'

const CUSTOM_PROPS = [
  '_waveIcon', '_isLocked', '_layerLabel', '_isPlaceholder',
  '_qrPlaceholderBorder', '_qrPlaceholderLabel', '_backNameText',
  '_variableId',
  '_designId', '_isOpaque', '_addedInEngraved', '_originalSrc', '_layerType',
  '_assetUrl', '_assetName', '_undeletable',
]

const pxToMmX = (px: number, cardWidthMm: number) =>
  (px / CARD_WIDTH) * cardWidthMm
const pxToMmY = (px: number, cardHeightMm: number) =>
  (px / CARD_HEIGHT) * cardHeightMm

const CARD_WIDTH_MM = 85.6
const CARD_HEIGHT_MM = 54

function parseHexColor(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0,
  ]
}

/** Map canvas font family → jsPDF built-in font */
function toJsPdfFont(fontFamily: string): string {
  const lower = fontFamily.toLowerCase()
  if (lower.includes('courier')) return 'courier'
  if (lower.includes('times') || lower.includes('georgia')) return 'times'
  return 'helvetica' // Arial, Helvetica, Verdana, Trebuchet MS all map here
}

function renderTextToPdf(
  pdf: jsPDF,
  textObj: Textbox | IText,
  posX: number,
  posY: number,
  opacity: number,
  productionMode = false,
) {
  const text = textObj.text || ''
  if (!text.trim()) return

  const fontSize = (textObj.fontSize || 34) * (textObj.scaleY || 1)
  const fontSizeMm = pxToMmY(fontSize, CARD_HEIGHT_MM)
  const fill = productionMode ? '#000000' : (typeof textObj.fill === 'string' ? textObj.fill : '#000000')
  const [r, g, b] = parseHexColor(fill)

  const weight = Number(textObj.fontWeight) || 400
  const fontStyle = weight >= 700 ? 'bold' : 'normal'

  pdf.setFont(toJsPdfFont(textObj.fontFamily || 'Arial'), fontStyle)
  pdf.setFontSize(fontSizeMm * 2.835) // mm to pt
  pdf.setTextColor(r, g, b)

  if (opacity < 1) {
    pdf.setGState(pdf.GState({ opacity }))
  }

  let x = pxToMmX(posX, CARD_WIDTH_MM)
  let y = pxToMmY(posY, CARD_HEIGHT_MM)

  const originX = textObj.originX || 'left'
  const originY = textObj.originY || 'top'

  if (originY === 'center') {
    y += fontSizeMm * 0.35
  } else {
    y += fontSizeMm
  }

  let align: 'left' | 'center' | 'right' = 'left'
  if (textObj.textAlign === 'center' || originX === 'center') {
    align = 'center'
  } else if (textObj.textAlign === 'right') {
    align = 'right'
  }

  const lines = text.split('\n')
  const lineHeightMm = fontSizeMm * (textObj.lineHeight || 1.16)
  for (let li = 0; li < lines.length; li++) {
    pdf.text(lines[li], x, y + li * lineHeightMm, { align })
  }

  if (opacity < 1) {
    pdf.setGState(pdf.GState({ opacity: 1 }))
  }
}

function renderObjectsToPdf(pdf: jsPDF, objects: FabricObject[], productionMode = false) {
  for (const obj of objects) {
    const bounds = obj.getBoundingRect()
    if (bounds.width < 1 || bounds.height < 1) continue

    // QR placeholder group: render as vector rect + text
    if (obj instanceof Group && (obj as FabricObject & { _qrPlaceholderBorder?: boolean })._qrPlaceholderBorder) {
      const groupLeft = obj.left || 0
      const groupTop = obj.top || 0
      const children = obj.getObjects()

      for (const child of children) {
        if (child instanceof Rect) {
          const stroke = productionMode ? '#000000' : (typeof child.stroke === 'string' ? child.stroke : '#808080')
          const [r, g, b] = parseHexColor(stroke)

          const w = pxToMmX(child.width * (child.scaleX || 1), CARD_WIDTH_MM)
          const h = pxToMmY(child.height * (child.scaleY || 1), CARD_HEIGHT_MM)
          const rx = pxToMmX(groupLeft, CARD_WIDTH_MM) - w / 2
          const ry = pxToMmY(groupTop, CARD_HEIGHT_MM) - h / 2

          pdf.setDrawColor(r, g, b)
          pdf.setLineWidth(pxToMmX(child.strokeWidth || 2, CARD_WIDTH_MM))
          pdf.setLineDashPattern(
            (child.strokeDashArray || [16, 8]).map((d) => pxToMmX(d, CARD_WIDTH_MM)),
            0
          )
          pdf.rect(rx, ry, w, h, 'S')
          pdf.setLineDashPattern([], 0)
        }

        if (child instanceof Textbox || child instanceof IText) {
          renderTextToPdf(pdf, child, groupLeft, groupTop, child.opacity || 1, productionMode)
        }
      }
      continue
    }

    // Text objects: native PDF text (editable in Illustrator)
    if (obj instanceof Textbox || obj instanceof IText) {
      renderTextToPdf(pdf, obj as Textbox, obj.left || 0, obj.top || 0, obj.opacity ?? 1, productionMode)
      continue
    }

    // Non-text objects (images): render as PNG
    if (productionMode && obj instanceof FabricImage) {
      // Save current filters, apply black engraved filters for production
      const savedFilters = obj.filters ? [...obj.filters] : []
      obj.filters = [
        new fabric.filters.Grayscale(),
        new fabric.filters.BlendColor({ color: '#000000', mode: 'tint', alpha: 1 }),
      ]
      obj.applyFilters()

      const objDataUrl = obj.toDataURL({ format: 'png', multiplier: 1 })
      pdf.addImage(
        objDataUrl, 'PNG',
        pxToMmX(bounds.left, CARD_WIDTH_MM),
        pxToMmY(bounds.top, CARD_HEIGHT_MM),
        pxToMmX(bounds.width, CARD_WIDTH_MM),
        pxToMmY(bounds.height, CARD_HEIGHT_MM)
      )

      // Restore original filters
      obj.filters = savedFilters
      obj.applyFilters()
      continue
    }

    const objDataUrl = obj.toDataURL({
      format: 'png',
      multiplier: 1,
    })

    pdf.addImage(
      objDataUrl,
      'PNG',
      pxToMmX(bounds.left, CARD_WIDTH_MM),
      pxToMmY(bounds.top, CARD_HEIGHT_MM),
      pxToMmX(bounds.width, CARD_WIDTH_MM),
      pxToMmY(bounds.height, CARD_HEIGHT_MM)
    )
  }
}

/**
 * Render a canvas side to a temp Fabric canvas and return:
 * - bgDataUrl: low-res background JPEG
 * - objects: the Fabric objects for rendering
 * - canvas element ref for cleanup
 */
async function prepareSide(jsonStr: string | null, bgColor: string) {
  const tempCanvasEl = document.createElement('canvas')
  tempCanvasEl.width = CARD_WIDTH
  tempCanvasEl.height = CARD_HEIGHT
  document.body.appendChild(tempCanvasEl)

  const tempCanvas = new Canvas(tempCanvasEl, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: bgColor,
  })

  if (jsonStr) {
    await tempCanvas.loadFromJSON(JSON.parse(jsonStr))
  }
  tempCanvas.renderAll()

  const objects = tempCanvas.getObjects()

  // Render background as low-res JPEG — visual reference only, stripped for print
  objects.forEach((obj) => obj.set('visible', false))
  tempCanvas.renderAll()
  const bgDataUrl = tempCanvas.toDataURL({
    format: 'jpeg',
    quality: 0.4,
    multiplier: 0.5,
  })
  objects.forEach((obj) => obj.set('visible', true))

  return { tempCanvas, tempCanvasEl, bgDataUrl, objects }
}

function cleanup(tempCanvas: Canvas, tempCanvasEl: HTMLCanvasElement) {
  tempCanvas.dispose()
  if (tempCanvasEl.parentNode) {
    document.body.removeChild(tempCanvasEl)
  }
}

export async function exportDesignAsPdf(): Promise<void> {
  const state = useDesignStore.getState()

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [CARD_WIDTH_MM, CARD_HEIGHT_MM],
  })

  // Save both canvases' current state (with custom props for QR/variable tags)
  if (window.__fabricCanvasFront) {
    state.setCanvasJson('front', JSON.stringify(window.__fabricCanvasFront.toObject(CUSTOM_PROPS)))
  }
  if (window.__fabricCanvasBack) {
    state.setCanvasJson('back', JSON.stringify(window.__fabricCanvasBack.toObject(CUSTOM_PROPS)))
  }

  const { frontCanvasJson, backCanvasJson, frontBgColor, backBgColor, quantity, cardData, designMethod, materialId } = useDesignStore.getState()
  const isMetalEngraved = designMethod === 'engraved' && materialId === 'metal'

  // === Proof front page ===
  const front = await prepareSide(frontCanvasJson, frontBgColor)
  pdf.addImage(front.bgDataUrl, 'JPEG', 0, 0, CARD_WIDTH_MM, CARD_HEIGHT_MM)
  renderObjectsToPdf(pdf, front.objects)
  cleanup(front.tempCanvas, front.tempCanvasEl)

  // === Back pages ===
  const back = await prepareSide(backCanvasJson, backBgColor)

  // Split objects: variable texts vs everything else
  const variableObjs = back.objects.filter((obj) =>
    (obj as FabricObject & { _variableId?: string })._variableId
  )
  const staticObjs = back.objects.filter((obj) =>
    !(obj as FabricObject & { _variableId?: string })._variableId
  )

  // For metal engraved: proof section is just 1 back page (card 1)
  // For everything else: one back page per card (original behavior)
  const proofBackCount = isMetalEngraved ? 1 : quantity

  for (let i = 0; i < proofBackCount; i++) {
    pdf.addPage([CARD_WIDTH_MM, CARD_HEIGHT_MM], 'landscape')
    pdf.addImage(back.bgDataUrl, 'JPEG', 0, 0, CARD_WIDTH_MM, CARD_HEIGHT_MM)
    renderObjectsToPdf(pdf, staticObjs)

    const values = cardData[i] || {}
    for (const obj of variableObjs) {
      const tagged = obj as Textbox & { _variableId?: string }
      const value = values[tagged._variableId!] || ''
      const originalText = tagged.text
      tagged.set('text', value)
      renderTextToPdf(pdf, tagged, tagged.left || 0, tagged.top || 0, tagged.opacity ?? 1)
      tagged.set('text', originalText!)
    }
  }

  cleanup(back.tempCanvas, back.tempCanvasEl)

  // === Production pages for metal engraved designs ===
  if (isMetalEngraved) {
    // Production front page — white bg, black elements
    const prodFront = await prepareSide(frontCanvasJson, '#ffffff')
    pdf.addPage([CARD_WIDTH_MM, CARD_HEIGHT_MM], 'landscape')
    pdf.setFillColor(255, 255, 255)
    pdf.rect(0, 0, CARD_WIDTH_MM, CARD_HEIGHT_MM, 'F')
    renderObjectsToPdf(pdf, prodFront.objects, true)
    cleanup(prodFront.tempCanvas, prodFront.tempCanvasEl)

    // Production back pages — one per card, white bg, black elements
    const prodBack = await prepareSide(backCanvasJson, '#ffffff')
    const prodVariableObjs = prodBack.objects.filter((obj) =>
      (obj as FabricObject & { _variableId?: string })._variableId
    )
    const prodStaticObjs = prodBack.objects.filter((obj) =>
      !(obj as FabricObject & { _variableId?: string })._variableId
    )

    for (let i = 0; i < quantity; i++) {
      pdf.addPage([CARD_WIDTH_MM, CARD_HEIGHT_MM], 'landscape')
      pdf.setFillColor(255, 255, 255)
      pdf.rect(0, 0, CARD_WIDTH_MM, CARD_HEIGHT_MM, 'F')

      renderObjectsToPdf(pdf, prodStaticObjs, true)

      const values = cardData[i] || {}
      for (const obj of prodVariableObjs) {
        const tagged = obj as Textbox & { _variableId?: string }
        const value = values[tagged._variableId!] || ''
        const originalText = tagged.text
        tagged.set('text', value)
        renderTextToPdf(pdf, tagged, tagged.left || 0, tagged.top || 0, tagged.opacity ?? 1, true)
        tagged.set('text', originalText!)
      }
    }

    cleanup(prodBack.tempCanvas, prodBack.tempCanvasEl)
  }

  pdf.save('nfc-card-design.pdf')
}
