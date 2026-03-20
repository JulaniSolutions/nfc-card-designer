import type { Canvas, FabricObject } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'

const MARGIN = 60
const SNAP_THRESHOLD = 8

// Guide positions
const GUIDES = {
  // Margin lines
  marginLeft: MARGIN,
  marginRight: CARD_WIDTH - MARGIN,
  marginTop: MARGIN,
  marginBottom: CARD_HEIGHT - MARGIN,
  // Center lines
  centerX: CARD_WIDTH / 2,
  centerY: CARD_HEIGHT / 2,
}

const ALL_X_GUIDES = [GUIDES.marginLeft, GUIDES.centerX, GUIDES.marginRight]
const ALL_Y_GUIDES = [GUIDES.marginTop, GUIDES.centerY, GUIDES.marginBottom]

/**
 * Draw guide overlays on the canvas (margin border + center crosshair).
 * Called from the canvas `after:render` event.
 */
export function drawGuides(canvas: Canvas) {
  const ctx = canvas.getContext()
  ctx.save()

  // Draw each line twice: once light, once dark — visible on any background
  const drawLine = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // Margin rectangle (dashed)
  ctx.lineWidth = 1
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
  ctx.strokeRect(
    GUIDES.marginLeft, GUIDES.marginTop,
    GUIDES.marginRight - GUIDES.marginLeft,
    GUIDES.marginBottom - GUIDES.marginTop,
  )
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'
  ctx.strokeRect(
    GUIDES.marginLeft, GUIDES.marginTop,
    GUIDES.marginRight - GUIDES.marginLeft,
    GUIDES.marginBottom - GUIDES.marginTop,
  )

  // Center lines (dotted)
  ctx.lineWidth = 1
  ctx.setLineDash([3, 5])

  drawLine(GUIDES.centerX, 0, GUIDES.centerX, CARD_HEIGHT)

  // Center horizontal line (dotted)
  drawLine(0, GUIDES.centerY, CARD_WIDTH, GUIDES.centerY)

  ctx.restore()
}

/**
 * Draw a highlighted snap indicator when an object is snapped to a guide.
 */
function drawSnapLine(
  canvas: Canvas,
  snappedX: number | null,
  snappedY: number | null,
) {
  const ctx = canvas.getContext()
  ctx.save()
  ctx.strokeStyle = 'rgba(37, 99, 235, 0.5)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 3])

  if (snappedX !== null) {
    ctx.beginPath()
    ctx.moveTo(snappedX, 0)
    ctx.lineTo(snappedX, CARD_HEIGHT)
    ctx.stroke()
  }

  if (snappedY !== null) {
    ctx.beginPath()
    ctx.moveTo(0, snappedY)
    ctx.lineTo(CARD_WIDTH, snappedY)
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Attach guide drawing + snapping behavior to a canvas.
 * Returns a cleanup function.
 */
export function attachGuides(canvas: Canvas): () => void {
  let snappedX: number | null = null
  let snappedY: number | null = null

  const afterRender = () => {
    const hasSelection = !!canvas.getActiveObject()
    if (hasSelection) {
      drawGuides(canvas)
    }
    if (snappedX !== null || snappedY !== null) {
      drawSnapLine(canvas, snappedX, snappedY)
    }
  }

  const onMoving = (e: { target: FabricObject }) => {
    const obj = e.target
    const center = obj.getCenterPoint()
    const w = obj.getScaledWidth()
    const h = obj.getScaledHeight()
    const leftEdge = center.x - w / 2
    const rightEdge = center.x + w / 2
    const topEdge = center.y - h / 2
    const bottomEdge = center.y + h / 2

    snappedX = null
    snappedY = null

    // Find closest X snap — prioritize center, then edges
    let bestXDist = SNAP_THRESHOLD
    let bestXShift = 0
    for (const guide of ALL_X_GUIDES) {
      const dCenter = Math.abs(center.x - guide)
      const dLeft = Math.abs(leftEdge - guide)
      const dRight = Math.abs(rightEdge - guide)

      if (dCenter < bestXDist) {
        bestXDist = dCenter
        bestXShift = guide - center.x
        snappedX = guide
      }
      if (dLeft < bestXDist) {
        bestXDist = dLeft
        bestXShift = guide - leftEdge
        snappedX = guide
      }
      if (dRight < bestXDist) {
        bestXDist = dRight
        bestXShift = guide - rightEdge
        snappedX = guide
      }
    }

    // Find closest Y snap — prioritize center, then edges
    let bestYDist = SNAP_THRESHOLD
    let bestYShift = 0
    for (const guide of ALL_Y_GUIDES) {
      const dCenter = Math.abs(center.y - guide)
      const dTop = Math.abs(topEdge - guide)
      const dBottom = Math.abs(bottomEdge - guide)

      if (dCenter < bestYDist) {
        bestYDist = dCenter
        bestYShift = guide - center.y
        snappedY = guide
      }
      if (dTop < bestYDist) {
        bestYDist = dTop
        bestYShift = guide - topEdge
        snappedY = guide
      }
      if (dBottom < bestYDist) {
        bestYDist = dBottom
        bestYShift = guide - bottomEdge
        snappedY = guide
      }
    }

    // Apply snaps by shifting from current position
    if (snappedX !== null) {
      obj.set('left', obj.left! + bestXShift)
    }
    if (snappedY !== null) {
      obj.set('top', obj.top! + bestYShift)
    }

    obj.setCoords()
  }

  const clearSnap = () => {
    snappedX = null
    snappedY = null
    canvas.requestRenderAll()
  }

  canvas.on('after:render', afterRender)
  canvas.on('object:moving', onMoving as (e: unknown) => void)
  canvas.on('object:modified', clearSnap)
  canvas.on('selection:cleared', clearSnap)

  // Initial draw
  canvas.requestRenderAll()

  return () => {
    canvas.off('after:render', afterRender)
    canvas.off('object:moving', onMoving as (e: unknown) => void)
    canvas.off('object:modified', clearSnap)
    canvas.off('selection:cleared', clearSnap)
  }
}
