import { useDesignStore, type CardSide } from '@/store/design-store'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Textbox, FabricImage, Canvas } from 'fabric'
import { useRef, useState } from 'react'
import { Type, ImagePlus } from 'lucide-react'
import { DesignMethodToggle } from '@/components/toolbar/DesignMethodToggle'
import { BackCardOptions } from '@/components/toolbar/BackCardOptions'
import {
  applyEngravedFiltersToImage,
  getCurrentEngravedColor,
  getCurrentDefaultPrintColor,
} from '@/lib/engraved-filters'
import { isEngravingMaterial } from '@/config/materials'
import { isImageOpaque } from '@/lib/transparency'

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_IMAGES = 5
const MAX_IMAGE_DIMENSION = 2048

function countImages(): number {
  let count = 0
  for (const canvas of [window.__fabricCanvasFront, window.__fabricCanvasBack]) {
    if (!canvas) continue
    for (const obj of canvas.getObjects()) {
      if (obj instanceof FabricImage) count++
    }
  }
  return count
}

function scaleDownImage(img: HTMLImageElement): Promise<HTMLImageElement> {
  const { width, height } = img
  if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
    return Promise.resolve(img)
  }

  const scale = MAX_IMAGE_DIMENSION / Math.max(width, height)
  const newW = Math.round(width * scale)
  const newH = Math.round(height * scale)

  const offscreen = document.createElement('canvas')
  offscreen.width = newW
  offscreen.height = newH
  const ctx = offscreen.getContext('2d')!
  ctx.drawImage(img, 0, 0, newW, newH)

  return new Promise((resolve) => {
    const scaled = new Image()
    scaled.onload = () => resolve(scaled)
    scaled.src = offscreen.toDataURL('image/png')
  })
}

function getCanvasForSide(side: CardSide): Canvas | null {
  return side === 'front' ? window.__fabricCanvasFront : window.__fabricCanvasBack
}

function addTextToCanvas(canvas: Canvas, isEngraved: boolean) {
  const fillColor = isEngraved
    ? getCurrentEngravedColor()
    : getCurrentDefaultPrintColor()

  const text = new Textbox('Your Text', {
    fontSize: 36,
    fontFamily: 'Arial',
    fill: fillColor,
    width: 200,
    textAlign: 'center',
    originX: 'center',
    originY: 'center',
    left: canvas.width! / 2,
    top: canvas.height! / 2,
  })

  // Lock scaling — font size is only changeable via layers panel
  text.set({
    lockScalingX: true,
    lockScalingY: true,
  })
  // Side handles for text wrapping width, no corners (scaling locked), keep rotation
  text.setControlsVisibility({
    ml: true, mr: true, mt: false, mb: false,
    tl: false, tr: false, bl: false, br: false,
    mtr: true,
  })

  canvas.add(text)
  canvas.setActiveObject(text)
  canvas.renderAll()
}

function addImageToCanvas(
  canvas: Canvas,
  file: File,
  isEngraved: boolean,
  setOpaqueWarning: (state: 'detected' | 'bg_removed' | 'printed' | 'dismissed' | null, imageId?: string | null) => void,
) {
  const reader = new FileReader()
  reader.onload = async (event) => {
    const dataUrl = event.target?.result as string
    const imgElement = new Image()
    imgElement.crossOrigin = 'anonymous'
    imgElement.onload = async () => {
      // Scale down if too large
      const finalImg = await scaleDownImage(imgElement)

      const fabricImg = new FabricImage(finalImg, {
        originX: 'center',
        originY: 'center',
        left: canvas.width! / 2,
        top: canvas.height! / 2,
      })

      // Scale to 60% of canvas max dimension
      const maxDim = Math.max(canvas.width!, canvas.height!) * 0.6
      const imgMaxDim = Math.max(fabricImg.width!, fabricImg.height!)
      const scale = Math.min(maxDim / imgMaxDim, 1)
      fabricImg.scale(scale)

      // Corner-only handles, lock aspect ratio
      fabricImg.setControlsVisibility({
        ml: false,
        mr: false,
        mt: false,
        mb: false,
      })
      fabricImg.set({
        lockUniScaling: true,
      })

      // Tag the image with an ID for tracking
      const imgId = crypto.randomUUID()
      const tagged = fabricImg as FabricImage & { _designId?: string; _isOpaque?: boolean; _addedInEngraved?: boolean; _assetUrl?: string; _assetName?: string }
      tagged._designId = imgId
      tagged._addedInEngraved = isEngraved

      // Store file name for later upload (assets uploaded on save, not immediately)
      tagged._assetName = file.name

      // Apply engraved filters if in engraved mode
      if (isEngraved) {
        applyEngravedFiltersToImage(fabricImg, getCurrentEngravedColor())
      }

      canvas.add(fabricImg)
      canvas.setActiveObject(fabricImg)
      canvas.renderAll()

      // Async transparency check — only warn if added in engraved mode
      if (isEngraved) {
        isImageOpaque(file).then((opaque) => {
          if (opaque) {
            tagged._isOpaque = true
            setOpaqueWarning('detected', imgId)
          }
        })
      }
    }
    imgElement.src = dataUrl
  }
  reader.readAsDataURL(file)
}

export function AddElementButtons() {
  const { designMethod, setOpaqueWarning } = useDesignStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isEngraved = designMethod === 'engraved'

  const addText = () => {
    const canvas = window.__fabricCanvas
    if (!canvas) return
    addTextToCanvas(canvas, isEngraved)
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      alert(`Unsupported file type. Please use JPG, PNG, GIF, SVG, or WebP.`)
      e.target.value = ''
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      alert(`File is too large. Maximum size is 10MB.`)
      e.target.value = ''
      return
    }

    if (countImages() >= MAX_IMAGES) {
      alert(`Maximum of ${MAX_IMAGES} images allowed.`)
      e.target.value = ''
      return
    }

    const canvas = window.__fabricCanvas
    if (!canvas) return

    addImageToCanvas(canvas, file, isEngraved, setOpaqueWarning)
    e.target.value = ''
  }

  return (
    <div className="flex gap-1.5">
      <Button onClick={addText} variant="outline" size="sm" className="flex-1 gap-1.5">
        <Type className="size-3.5" />
        Text
      </Button>
      <Button
        onClick={() => fileInputRef.current?.click()}
        variant="outline"
        size="sm"
        className="flex-1 gap-1.5"
      >
        <ImagePlus className="size-3.5" />
        Image
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.gif,.svg,.webp"
        onChange={handleImageUpload}
        className="hidden"
      />
    </div>
  )
}

/** Mobile-only add elements with popover side picker (no layout shift) */
export function MobileAddElements() {
  const { designMethod, setOpaqueWarning, setActiveSide } = useDesignStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [textOpen, setTextOpen] = useState(false)
  const [imageOpen, setImageOpen] = useState(false)

  const isEngraved = designMethod === 'engraved'

  const handleAddText = (side: CardSide) => {
    const canvas = getCanvasForSide(side)
    if (!canvas) return
    window.__fabricCanvas = canvas
    setActiveSide(side)
    addTextToCanvas(canvas, isEngraved)
    setTextOpen(false)
  }

  const handlePickImageSide = (side: CardSide) => {
    const canvas = getCanvasForSide(side)
    if (!canvas) return
    window.__fabricCanvas = canvas
    setActiveSide(side)
    setImageOpen(false)
    fileInputRef.current?.click()
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      alert(`Unsupported file type. Please use JPG, PNG, GIF, SVG, or WebP.`)
      e.target.value = ''
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      alert(`File is too large. Maximum size is 10MB.`)
      e.target.value = ''
      return
    }

    if (countImages() >= MAX_IMAGES) {
      alert(`Maximum of ${MAX_IMAGES} images allowed.`)
      e.target.value = ''
      return
    }

    const canvas = window.__fabricCanvas
    if (!canvas) return

    addImageToCanvas(canvas, file, isEngraved, setOpaqueWarning)
    e.target.value = ''
  }

  const sideButtons = (onPick: (side: CardSide) => void) => (
    <div className="flex flex-col gap-1 min-w-[120px]">
      <Button
        onClick={() => onPick('front')}
        variant="ghost"
        size="sm"
        className="justify-start"
      >
        Front
      </Button>
      <Button
        onClick={() => onPick('back')}
        variant="ghost"
        size="sm"
        className="justify-start"
      >
        Back
      </Button>
    </div>
  )

  return (
    <div className="lg:hidden bg-card border border-border rounded-lg p-3 shadow-sm">
      <div className="flex gap-1.5">
        <Popover open={textOpen} onOpenChange={setTextOpen}>
          <PopoverTrigger
            render={
              <Button variant="outline" size="sm" className="flex-1 gap-1.5">
                <Type className="size-3.5" />
                Add Text
              </Button>
            }
          />
          <PopoverContent className="w-auto p-1">
            {sideButtons(handleAddText)}
          </PopoverContent>
        </Popover>

        <Popover open={imageOpen} onOpenChange={setImageOpen}>
          <PopoverTrigger
            render={
              <Button variant="outline" size="sm" className="flex-1 gap-1.5">
                <ImagePlus className="size-3.5" />
                Add Image
              </Button>
            }
          />
          <PopoverContent className="w-auto p-1">
            {sideButtons(handlePickImageSide)}
          </PopoverContent>
        </Popover>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.gif,.svg,.webp"
        onChange={handleImageUpload}
        className="hidden"
      />
    </div>
  )
}

export function DesignToolbar() {
  const { activeSide, materialId } = useDesignStore()

  const sideLabel = activeSide === 'front' ? 'Front' : 'Back'

  return (
    <div className="space-y-4">
      {/* Design method toggle — metal only */}
      {isEngravingMaterial(materialId) && <DesignMethodToggle />}

      {/* Add elements — hidden on mobile (shown near layers instead) */}
      <div className="hidden lg:block">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
          Elements
          <span className="text-muted-foreground/60 normal-case tracking-normal ml-1">
            — adds to {sideLabel}
          </span>
        </h3>
        <AddElementButtons />
      </div>

      {/* Back card options */}
      <BackCardOptions />
    </div>
  )
}
