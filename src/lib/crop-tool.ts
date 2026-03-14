import { Canvas, Rect, FabricImage, type FabricObject } from 'fabric'

const CROP_STROKE = '#3b82f6'
const OVERLAY_COLOR = 'rgba(0,0,0,0.5)'
const MIN_CROP_SIZE = 20

interface ImageBounds {
  left: number
  top: number
  width: number
  height: number
}

interface CropState {
  active: boolean
  targetImage: FabricImage | null
  cropRect: Rect | null
  overlays: Rect[]
  originalStates: Map<FabricObject, { selectable: boolean; evented: boolean }>
  canvas: Canvas | null
  imageBounds: ImageBounds | null
}

const cropState: CropState = {
  active: false,
  targetImage: null,
  cropRect: null,
  overlays: [],
  originalStates: new Map(),
  canvas: null,
  imageBounds: null,
}

// Store for undo crop
const cropUndoStore = new WeakMap<
  FabricImage,
  { src: string; left: number; top: number; scaleX: number; scaleY: number; width: number; height: number; originX: string; originY: string }
>()

export function isCropping(): boolean {
  return cropState.active
}

export function hasCropUndo(img: FabricImage): boolean {
  return cropUndoStore.has(img)
}

/** Get the visual top-left bounding box of an image on canvas */
function getImageVisualBounds(img: FabricImage): ImageBounds {
  const scaleX = img.scaleX ?? 1
  const scaleY = img.scaleY ?? 1
  const w = img.width! * scaleX
  const h = img.height! * scaleY

  let left: number, top: number

  if (img.originX === 'center') {
    left = img.left! - w / 2
  } else {
    left = img.left!
  }

  if (img.originY === 'center') {
    top = img.top! - h / 2
  } else {
    top = img.top!
  }

  return { left, top, width: w, height: h }
}

export function enterCropMode(canvas: Canvas, targetImage: FabricImage) {
  if (cropState.active) return

  cropState.active = true
  cropState.canvas = canvas
  cropState.targetImage = targetImage

  const bounds = getImageVisualBounds(targetImage)
  cropState.imageBounds = bounds

  // Lock all objects
  for (const obj of canvas.getObjects()) {
    cropState.originalStates.set(obj, {
      selectable: obj.selectable ?? true,
      evented: obj.evented ?? true,
    })
    obj.set({ selectable: false, evented: false })
  }

  // Create crop rectangle — flush with image edges
  const cropRect = new Rect({
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
    fill: 'transparent',
    stroke: CROP_STROKE,
    strokeWidth: 3,
    cornerSize: 14,
    cornerColor: CROP_STROKE,
    cornerStrokeColor: CROP_STROKE,
    cornerStyle: 'rect',
    transparentCorners: false,
    borderColor: CROP_STROKE,
    borderScaleFactor: 2,
    lockRotation: true,
    originX: 'left',
    originY: 'top',
  })

  cropRect.setControlsVisibility({
    tl: true, tr: true, bl: true, br: true,
    mt: true, mb: true, ml: true, mr: true,
    mtr: false,
  })

  // Tag it
  ;(cropRect as FabricObject & { _isCropRect?: boolean })._isCropRect = true

  // Constrain on move
  cropRect.on('moving', () => {
    constrainCropRect(cropRect, bounds)
    updateOverlays()
  })

  // Constrain on scale — flatten scale into width/height, clamp to image bounds
  const flattenAndConstrain = () => {
    let newW = cropRect.width! * (cropRect.scaleX ?? 1)
    let newH = cropRect.height! * (cropRect.scaleY ?? 1)
    let left = cropRect.left!
    let top = cropRect.top!

    // Enforce minimum
    newW = Math.max(newW, MIN_CROP_SIZE)
    newH = Math.max(newH, MIN_CROP_SIZE)

    // Clamp position so it can't go outside image
    left = Math.max(bounds.left, left)
    top = Math.max(bounds.top, top)

    // Clamp size so it can't extend past image
    newW = Math.min(newW, bounds.left + bounds.width - left)
    newH = Math.min(newH, bounds.top + bounds.height - top)

    // Also clamp to max image size
    newW = Math.min(newW, bounds.width)
    newH = Math.min(newH, bounds.height)

    cropRect.set({ left, top, width: newW, height: newH, scaleX: 1, scaleY: 1 })
    updateOverlays()
  }

  cropRect.on('scaling', flattenAndConstrain)
  cropRect.on('modified', flattenAndConstrain)

  // Create 4 overlay rects
  const overlays: Rect[] = []
  for (let i = 0; i < 4; i++) {
    const overlay = new Rect({
      fill: OVERLAY_COLOR,
      selectable: false,
      evented: false,
      originX: 'left',
      originY: 'top',
    })
    ;(overlay as FabricObject & { _isCropOverlay?: boolean })._isCropOverlay = true
    overlays.push(overlay)
  }

  cropState.overlays = overlays
  cropState.cropRect = cropRect

  // Add overlays first, then crop rect on top
  for (const o of overlays) canvas.add(o)
  canvas.add(cropRect)

  updateOverlays()

  canvas.setActiveObject(cropRect)
  canvas.renderAll()
}

function constrainCropRect(rect: Rect, bounds: ImageBounds) {
  const w = rect.width!
  const h = rect.height!

  let left = rect.left!
  let top = rect.top!

  left = Math.max(bounds.left, Math.min(left, bounds.left + bounds.width - w))
  top = Math.max(bounds.top, Math.min(top, bounds.top + bounds.height - h))

  rect.set({ left, top })
}

function updateOverlays() {
  const { overlays, cropRect, imageBounds } = cropState
  if (!cropRect || !imageBounds || overlays.length !== 4) return

  const cl = cropRect.left!
  const ct = cropRect.top!
  const cw = cropRect.width!
  const ch = cropRect.height!

  const bl = imageBounds.left
  const bt = imageBounds.top
  const bw = imageBounds.width
  const bh = imageBounds.height

  // Top: full width, from image top to crop top
  overlays[0].set({ left: bl, top: bt, width: bw, height: Math.max(0, ct - bt) })
  // Bottom: full width, from crop bottom to image bottom
  overlays[1].set({ left: bl, top: ct + ch, width: bw, height: Math.max(0, (bt + bh) - (ct + ch)) })
  // Left: between top and bottom overlays
  overlays[2].set({ left: bl, top: ct, width: Math.max(0, cl - bl), height: ch })
  // Right: between top and bottom overlays
  overlays[3].set({ left: cl + cw, top: ct, width: Math.max(0, (bl + bw) - (cl + cw)), height: ch })

  cropState.canvas?.renderAll()
}

export function applyCrop() {
  const { canvas, targetImage, cropRect, imageBounds } = cropState
  if (!canvas || !targetImage || !cropRect || !imageBounds) return

  // Crop rect position relative to image visual top-left
  const relX = cropRect.left! - imageBounds.left
  const relY = cropRect.top! - imageBounds.top
  const cropW = cropRect.width!
  const cropH = cropRect.height!

  const scaleX = targetImage.scaleX ?? 1
  const scaleY = targetImage.scaleY ?? 1

  // Convert display coords to source pixel coords
  const srcX = relX / scaleX
  const srcY = relY / scaleY
  const srcW = cropW / scaleX
  const srcH = cropH / scaleY

  // Store original for undo (only on first crop)
  if (!cropUndoStore.has(targetImage)) {
    const el = targetImage.getElement() as HTMLImageElement
    cropUndoStore.set(targetImage, {
      src: el.src,
      left: targetImage.left!,
      top: targetImage.top!,
      scaleX,
      scaleY,
      width: targetImage.width!,
      height: targetImage.height!,
      originX: (targetImage.originX as string) ?? 'left',
      originY: (targetImage.originY as string) ?? 'top',
    })
  }

  // Temporarily remove filters to get raw pixels
  const savedFilters = targetImage.filters?.slice() ?? []
  targetImage.filters = []
  targetImage.applyFilters()

  // Create crop canvas from source pixels
  const offscreen = document.createElement('canvas')
  offscreen.width = Math.round(srcW)
  offscreen.height = Math.round(srcH)
  const ctx = offscreen.getContext('2d')!

  const el = targetImage.getElement() as HTMLImageElement
  ctx.drawImage(
    el,
    Math.round(srcX), Math.round(srcY),
    Math.round(srcW), Math.round(srcH),
    0, 0,
    Math.round(srcW), Math.round(srcH)
  )

  const croppedImg = new Image()
  croppedImg.crossOrigin = 'anonymous'
  croppedImg.onload = () => {
    targetImage.setElement(croppedImg)

    // Position: center of where the crop rect was
    const newCenterX = cropRect.left! + cropW / 2
    const newCenterY = cropRect.top! + cropH / 2

    targetImage.set({
      width: croppedImg.width,
      height: croppedImg.height,
      left: newCenterX,
      top: newCenterY,
      originX: 'center',
      originY: 'center',
      scaleX,
      scaleY,
    })

    // Re-apply filters
    targetImage.filters = savedFilters
    targetImage.applyFilters()

    exitCropMode()
    canvas.setActiveObject(targetImage)
    canvas.renderAll()
  }
  croppedImg.src = offscreen.toDataURL('image/png')
}

export function cancelCrop() {
  exitCropMode()
}

export function undoCrop(canvas: Canvas, img: FabricImage) {
  const original = cropUndoStore.get(img)
  if (!original) return

  const savedFilters = img.filters?.slice() ?? []
  img.filters = []
  img.applyFilters()

  const restoredImg = new Image()
  restoredImg.crossOrigin = 'anonymous'
  restoredImg.onload = () => {
    img.setElement(restoredImg)
    img.set({
      width: original.width,
      height: original.height,
      left: original.left,
      top: original.top,
      scaleX: original.scaleX,
      scaleY: original.scaleY,
      originX: original.originX,
      originY: original.originY,
    })

    img.filters = savedFilters
    img.applyFilters()

    cropUndoStore.delete(img)
    canvas.renderAll()
  }
  restoredImg.src = original.src
}

function exitCropMode() {
  const { canvas, cropRect, overlays } = cropState
  if (!canvas) return

  // Remove crop rect and overlays
  if (cropRect) canvas.remove(cropRect)
  for (const overlay of overlays) canvas.remove(overlay)

  // Restore object interactivity
  for (const [obj, state] of cropState.originalStates) {
    obj.set({ selectable: state.selectable, evented: state.evented })
  }

  cropState.active = false
  cropState.targetImage = null
  cropState.cropRect = null
  cropState.overlays = []
  cropState.originalStates.clear()
  cropState.canvas = null
  cropState.imageBounds = null

  canvas.renderAll()
}
