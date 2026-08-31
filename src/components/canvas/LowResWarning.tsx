import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useDesignStore } from '@/store/design-store'
import { AlertTriangle } from 'lucide-react'
import type { FabricImage } from 'fabric'
import {
  applyEngravedFiltersToImage,
  getCurrentEngravedColor,
} from '@/lib/engraved-filters'
import { isSideEngraved } from '@/config/materials'
import { uploadOriginalSourceFile } from '@/lib/upload-asset'
import {
  CANVAS_PPI,
  MIN_PRINT_PPI,
  RECOMMENDED_UPLOAD_DIMENSION,
  acknowledgeLowRes,
  getEffectivePpi,
  getSourceDimensions,
  shouldWarnLowRes,
  type LowResTagged,
} from '@/lib/image-resolution'

export type LowResWarningState = 'detected' | 'dismissed'

interface LowResWarningProps {
  targetImage: FabricImage | null
  onStateChange: (state: LowResWarningState) => void
}

export function LowResWarning({ targetImage, onStateChange }: LowResWarningProps) {
  const { materialId, activeSide } = useDesignStore()
  const isEngraved = isSideEngraved(materialId, activeSide)
  const [error, setError] = useState<string | null>(null)
  // Replace swaps the element in place; bump to recompute the message from it
  const [, setRefresh] = useState(0)

  if (!targetImage) return null

  const ppi = Math.round(getEffectivePpi(targetImage))
  const { width, height } = getSourceDimensions(targetImage)
  const stretched = ppi < MIN_PRINT_PPI

  const message = stretched
    ? `This image is stretched beyond its resolution — at this size it comes out at about ${ppi} DPI (${CANVAS_PPI} is ideal), so it may look blurry or pixelated on the card. Make it smaller, or upload a higher-resolution version.`
    : `This image is only ${width}×${height}px, so it may look blurry if enlarged. For the sharpest result, upload a version that's at least ${RECOMMENDED_UPLOAD_DIMENSION}px on its longest side.`

  const handleDismiss = () => {
    // Remember the density this was accepted at so a small nudge doesn't re-warn
    acknowledgeLowRes(targetImage)
    onStateChange('dismissed')
  }

  const handleReplace = () => {
    if (!targetImage) return
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.jpg,.jpeg,.png,.gif,.svg,.webp'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string
        const newImg = new Image()
        newImg.crossOrigin = 'anonymous'
        newImg.onload = () => {
          // Keep the footprint the user already sized — only the source changes
          const displayedWidth = targetImage.getScaledWidth()
          targetImage.filters = []
          targetImage.setElement(newImg)
          targetImage.set({ width: newImg.width, height: newImg.height })
          targetImage.scale(displayedWidth / newImg.width)

          if (isEngraved) {
            applyEngravedFiltersToImage(targetImage, getCurrentEngravedColor())
          }

          // The stored asset no longer matches this element — clear so the next
          // save re-uploads instead of swapping the src back to the old image
          const tagged = targetImage as LowResTagged & {
            _assetUrl?: string
            _assetName?: string
            _originalAssetUrl?: string
          }
          tagged._assetUrl = undefined
          tagged._assetName = file.name
          tagged._lowResAckPpi = undefined

          // Refresh the untouched original for designer access (fire-and-forget)
          uploadOriginalSourceFile(file).then((asset) => {
            if (asset) tagged._originalAssetUrl = asset.url
          })

          const canvas = targetImage.canvas
          canvas?.renderAll()
          // setElement doesn't emit events — fire so history/save/re-check see it
          canvas?.fire('object:modified', { target: targetImage })

          setError(null)
          if (shouldWarnLowRes(targetImage)) {
            setRefresh((n) => n + 1)
          } else {
            onStateChange('dismissed')
          }
        }
        newImg.onerror = () => setError('Failed to load that image. Please try another file.')
        newImg.src = dataUrl
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  return (
    <div className="rounded-lg border p-3 mb-4 transition-all animate-in slide-in-from-top-2 duration-200 bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900">
      <div className="flex gap-2">
        <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground leading-relaxed">{message}</p>

          {error && (
            <p className="text-xs text-red-600 mt-1.5">{error}</p>
          )}

          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <Button
              onClick={handleReplace}
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
            >
              Replace
            </Button>
            <Button
              onClick={handleDismiss}
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
            >
              Looks good!
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
