import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useDesignStore } from '@/store/design-store'
import { AlertTriangle, CheckCircle } from 'lucide-react'
import { removeBackground, isBackgroundRemovalEnabled } from '@/lib/runware'
import { FabricImage } from 'fabric'
import {
  applyEngravedFiltersToImage,
  getCurrentEngravedColor,
} from '@/lib/engraved-filters'
import { isSideEngraved } from '@/config/materials'
import { uploadOriginalSourceFile } from '@/lib/upload-asset'
import { cn } from '@/lib/utils'

export type WarningState = 'detected' | 'bg_removed' | 'dismissed'

interface TransparencyWarningProps {
  state: WarningState
  onStateChange: (state: WarningState) => void
  targetImage: FabricImage | null
}

export function TransparencyWarning({
  state,
  onStateChange,
  targetImage,
}: TransparencyWarningProps) {
  const { materialId, activeSide } = useDesignStore()
  // Per side: an image on a printed back keeps its colour even on a metal card.
  const isEngraved = isSideEngraved(materialId, activeSide)
  const [isRemoving, setIsRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bgRemovalEnabled = isBackgroundRemovalEnabled()

  if (state === 'dismissed' || !targetImage) return null

  const handleRemoveBackground = async () => {
    if (!targetImage) return
    setIsRemoving(true)
    setError(null)

    try {
      // Read from _originalElement (unfiltered source) so BG removal gets the
      // clean full-color image, not the engraved grayscale/tinted version.
      const internal = targetImage as FabricImage & { _originalElement?: HTMLImageElement }
      const sourceEl = internal._originalElement || targetImage.getElement() as HTMLImageElement

      const offscreen = document.createElement('canvas')
      offscreen.width = sourceEl.naturalWidth || sourceEl.width
      offscreen.height = sourceEl.naturalHeight || sourceEl.height
      const ctx = offscreen.getContext('2d')!
      ctx.drawImage(sourceEl, 0, 0)
      const dataUrl = offscreen.toDataURL('image/png')

      // Store original for undo
      const customImg = targetImage as FabricImage & { _originalSrc?: string }
      if (!customImg._originalSrc) {
        customImg._originalSrc = dataUrl
      }

      const resultDataUrl = await removeBackground(dataUrl)

      // Replace image with bg-removed version
      const newImg = new Image()
      newImg.crossOrigin = 'anonymous'
      newImg.onload = () => {
        // Clear filters before setElement so it doesn't re-apply stale filters.
        // setElement updates both _element and _originalElement.
        targetImage.filters = []
        targetImage.setElement(newImg)
        targetImage.set({ width: newImg.width, height: newImg.height })

        // Re-apply engraved filters on the clean BG-removed source
        if (isEngraved) {
          applyEngravedFiltersToImage(targetImage, getCurrentEngravedColor())
        }

        // Mark as not opaque. The stored asset no longer matches this element —
        // clear it, or the next save skips the upload and swaps the old image back in.
        const tagged = targetImage as FabricImage & { _isOpaque?: boolean; _assetUrl?: string }
        tagged._isOpaque = false
        tagged._assetUrl = undefined

        const activeCanvas = targetImage.canvas
        activeCanvas?.renderAll()
        // setElement emits no events — fire so history and the store see the swap
        activeCanvas?.fire('object:modified', { target: targetImage })

        setIsRemoving(false)
        onStateChange('bg_removed')
      }
      newImg.onerror = () => {
        setIsRemoving(false)
        setError('Failed to load processed image.')
      }
      newImg.src = resultDataUrl
    } catch (err) {
      setIsRemoving(false)
      setError(err instanceof Error ? err.message : 'Background removal failed.')
    }
  }

  const handleUndoBgRemoval = () => {
    if (!targetImage) return
    const customImg = targetImage as FabricImage & { _originalSrc?: string }
    if (!customImg._originalSrc) return

    const restored = new Image()
    restored.crossOrigin = 'anonymous'
    restored.onload = () => {
      targetImage.filters = []
      targetImage.setElement(restored)
      targetImage.set({ width: restored.width, height: restored.height })

      if (isEngraved) {
        applyEngravedFiltersToImage(targetImage, getCurrentEngravedColor())
      }

      // Same stale-asset rule as removal: the element changed, so force a re-upload
      const tagged = targetImage as FabricImage & { _isOpaque?: boolean; _assetUrl?: string }
      tagged._isOpaque = true
      tagged._assetUrl = undefined
      customImg._originalSrc = undefined

      const canvas = targetImage.canvas
      canvas?.renderAll()
      canvas?.fire('object:modified', { target: targetImage })
      onStateChange('detected')
    }
    restored.src = customImg._originalSrc
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
          // Clear filters and replace the element
          targetImage.filters = []
          targetImage.setElement(newImg)
          targetImage.set({ width: newImg.width, height: newImg.height })

          // Scale to fit canvas
          const canvas = targetImage.canvas
          if (canvas) {
            const maxDim = Math.max(canvas.width!, canvas.height!) * 0.6
            const imgMaxDim = Math.max(newImg.width, newImg.height)
            const scale = Math.min(maxDim / imgMaxDim, 1)
            targetImage.scale(scale)
          }

          // Re-apply engraved filters if needed
          if (isEngraved) {
            applyEngravedFiltersToImage(targetImage, getCurrentEngravedColor())
          }

          // Clear undo state, and drop the stored asset so the next save
          // re-uploads this element instead of swapping the old image back in
          const customImg = targetImage as FabricImage & {
            _originalSrc?: string
            _isOpaque?: boolean
            _assetUrl?: string
            _assetName?: string
            _originalAssetUrl?: string
          }
          customImg._originalSrc = undefined
          customImg._isOpaque = false
          customImg._assetUrl = undefined
          customImg._assetName = file.name

          // Refresh the untouched original for designer access (fire-and-forget)
          uploadOriginalSourceFile(file).then((asset) => {
            if (asset) customImg._originalAssetUrl = asset.url
          })

          canvas?.renderAll()
          canvas?.fire('object:modified', { target: targetImage })
          onStateChange('dismissed')
        }
        newImg.src = dataUrl
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const icon =
    state === 'bg_removed' ? (
      <CheckCircle className="size-4 text-green-500 shrink-0 mt-0.5" />
    ) : (
      <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
    )

  const message =
    state === 'bg_removed'
      ? "Background removed. Here's your engraved design."
      : "Your image doesn't have a transparent background, so it will engrave as a solid block. Try removing the background, or replace it with a transparent PNG."

  return (
    <div
      className={cn(
        'rounded-lg border p-3 mb-4 transition-all animate-in slide-in-from-top-2 duration-200',
        state === 'bg_removed'
          ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900'
          : 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900'
      )}
    >
      <div className="flex gap-2">
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-foreground leading-relaxed">{message}</p>

          {error && (
            <p className="text-xs text-red-600 mt-1.5">{error}</p>
          )}

          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {state === 'detected' && (
              <>
                {bgRemovalEnabled && (
                  <Button
                    onClick={handleRemoveBackground}
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={isRemoving}
                  >
                    {isRemoving ? 'Removing…' : 'Remove Background'}
                  </Button>
                )}
                <Button
                  onClick={handleReplace}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                >
                  Replace
                </Button>
                <Button
                  onClick={() => onStateChange('dismissed')}
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                >
                  Looks good!
                </Button>
              </>
            )}

            {state === 'bg_removed' && (
              <>
                <Button
                  onClick={handleUndoBgRemoval}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                >
                  Undo BG Removal
                </Button>
                <Button
                  onClick={handleReplace}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                >
                  Replace
                </Button>
                <Button
                  onClick={() => onStateChange('dismissed')}
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                >
                  Looks good!
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
