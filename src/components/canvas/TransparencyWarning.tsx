import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useDesignStore } from '@/store/design-store'
import { AlertTriangle, CheckCircle, Info } from 'lucide-react'
import { removeBackground, isBackgroundRemovalEnabled } from '@/lib/runware'
import { FabricImage } from 'fabric'
import {
  applyEngravedFiltersToImage,
  applyEngravedToCanvas,
  removeEngravedFromCanvas,
  getCurrentEngravedColor,
} from '@/lib/engraved-filters'
import { getVariation } from '@/config/materials'
import { cn } from '@/lib/utils'

export type WarningState = 'detected' | 'bg_removed' | 'printed' | 'dismissed'

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
  const { designMethod, setDesignMethod, variationId } = useDesignStore()
  const [isRemoving, setIsRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bgRemovalEnabled = isBackgroundRemovalEnabled()

  if (state === 'dismissed' || !targetImage) return null

  const handleSwitchToPrinted = () => {
    setDesignMethod('printed')
    const variation = variationId ? getVariation(variationId) : undefined
    const defaultPrintColor = variation?.defaultPrintColor ?? '#FFFFFF'
    for (const c of [window.__fabricCanvasFront, window.__fabricCanvasBack]) {
      if (c) removeEngravedFromCanvas(c, defaultPrintColor)
    }
    onStateChange('printed')
  }

  const handleSwitchToEngraved = () => {
    setDesignMethod('engraved')
    const variation = variationId ? getVariation(variationId) : undefined
    const engravedColor = variation?.engravedColor ?? '#C0C0C0'
    for (const c of [window.__fabricCanvasFront, window.__fabricCanvasBack]) {
      if (c) applyEngravedToCanvas(c, engravedColor)
    }
    onStateChange('detected')
  }

  const handleRemoveBackground = async () => {
    if (!targetImage) return
    setIsRemoving(true)
    setError(null)

    try {
      const el = targetImage.getElement() as HTMLImageElement

      // Get image as data URL
      const canvas = document.createElement('canvas')
      canvas.width = el.naturalWidth || el.width
      canvas.height = el.naturalHeight || el.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(el, 0, 0)
      const dataUrl = canvas.toDataURL('image/png')

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
        targetImage.setElement(newImg)
        targetImage.set({ width: newImg.width, height: newImg.height })

        // Re-apply engraved filters if needed
        if (designMethod === 'engraved') {
          applyEngravedFiltersToImage(targetImage, getCurrentEngravedColor())
        }

        // Mark as not opaque
        const tagged = targetImage as FabricImage & { _isOpaque?: boolean }
        tagged._isOpaque = false

        const activeCanvas = window.__fabricCanvas
        activeCanvas?.renderAll()

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
      targetImage.setElement(restored)
      targetImage.set({ width: restored.width, height: restored.height })

      if (designMethod === 'engraved') {
        applyEngravedFiltersToImage(targetImage, getCurrentEngravedColor())
      }

      const tagged = targetImage as FabricImage & { _isOpaque?: boolean }
      tagged._isOpaque = true
      customImg._originalSrc = undefined

      window.__fabricCanvas?.renderAll()
      onStateChange('detected')
    }
    restored.src = customImg._originalSrc
  }

  const handleReplace = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.jpg,.jpeg,.png,.gif,.svg,.webp'
    input.onchange = () => {
      // Trigger replacement via the existing upload flow
      // For now, dismiss the banner — the new image will trigger its own check
      onStateChange('dismissed')
    }
    input.click()
  }

  const icon =
    state === 'bg_removed' ? (
      <CheckCircle className="size-4 text-green-500 shrink-0 mt-0.5" />
    ) : state === 'printed' ? (
      <Info className="size-4 text-blue-500 shrink-0 mt-0.5" />
    ) : (
      <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
    )

  const message =
    state === 'bg_removed'
      ? "Background removed. Here's your engraved design — you can also try a printed design to compare."
      : state === 'printed'
        ? "Here's your printed design. Switch to engraved to compare the look, or click 'Looks good!' when you're happy."
        : "Your image doesn't have a transparent background, so it will engrave as a solid block. Try removing it or switch to a printed design."

  return (
    <div
      className={cn(
        'rounded-lg border p-3 mb-4 transition-all animate-in slide-in-from-top-2 duration-200',
        state === 'bg_removed'
          ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900'
          : state === 'printed'
            ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900'
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
                <Button
                  onClick={handleSwitchToPrinted}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                >
                  Switch to Printed
                </Button>
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
                  onClick={handleSwitchToPrinted}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                >
                  Switch to Printed
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

            {state === 'printed' && (
              <>
                <Button
                  onClick={handleSwitchToEngraved}
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                >
                  Switch to Engraved
                </Button>
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
