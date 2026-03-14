import { useDesignStore } from '@/store/design-store'
import { Button } from '@/components/ui/button'
import { Textbox, FabricImage } from 'fabric'
import { useRef } from 'react'
import { Type, ImagePlus } from 'lucide-react'
import { DesignMethodToggle } from '@/components/toolbar/DesignMethodToggle'
import { BackCardOptions } from '@/components/toolbar/BackCardOptions'
import {
  applyEngravedFiltersToImage,
  getCurrentEngravedColor,
  getCurrentDefaultPrintColor,
} from '@/lib/engraved-filters'
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

export function DesignToolbar() {
  const { activeSide, materialId, designMethod, setOpaqueWarning } = useDesignStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const sideLabel = activeSide === 'front' ? 'Front' : 'Back'

  const isEngraved = designMethod === 'engraved'

  const addText = () => {
    const canvas = window.__fabricCanvas
    if (!canvas) return

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

    // Corner-only handles, preserve aspect ratio
    text.setControlsVisibility({
      ml: false,
      mr: false,
      mt: false,
      mb: false,
    })

    canvas.add(text)
    canvas.setActiveObject(text)
    canvas.renderAll()
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      alert(`Unsupported file type. Please use JPG, PNG, GIF, SVG, or WebP.`)
      e.target.value = ''
      return
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      alert(`File is too large. Maximum size is 10MB.`)
      e.target.value = ''
      return
    }

    // Validate image count
    if (countImages() >= MAX_IMAGES) {
      alert(`Maximum of ${MAX_IMAGES} images allowed.`)
      e.target.value = ''
      return
    }

    const canvas = window.__fabricCanvas
    if (!canvas) return

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
        const tagged = fabricImg as FabricImage & { _designId?: string; _isOpaque?: boolean; _addedInEngraved?: boolean }
        tagged._designId = imgId
        tagged._addedInEngraved = isEngraved

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
    e.target.value = ''
  }

  return (
    <div className="space-y-4">
      {/* Design method toggle — metal only */}
      {materialId === 'metal' && <DesignMethodToggle />}

      {/* Add elements */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
          Elements
          <span className="text-muted-foreground/60 normal-case tracking-normal ml-1">
            — adds to {sideLabel}
          </span>
        </h3>
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
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.gif,.svg,.webp"
          onChange={handleImageUpload}
          className="hidden"
        />
      </div>

      {/* Back card options */}
      <BackCardOptions />
    </div>
  )
}
