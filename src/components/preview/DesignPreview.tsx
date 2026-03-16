import { useEffect, useState } from 'react'
import { useDesignStore } from '@/store/design-store'
import { getMaterial, getVariation } from '@/config/materials'
import { CARD_CORNER_RADIUS } from '@/config/canvas'
import { renderCanvasToImage } from '@/lib/render-preview'
import { Loader2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DesignPreviewProps {
  onEdit: () => void
}

export function DesignPreview({ onEdit }: DesignPreviewProps) {
  const {
    frontCanvasJson,
    backCanvasJson,
    frontBgColor,
    backBgColor,
    variationId,
    materialId,
    designName,
    designMethod,
  } = useDesignStore()

  const [frontImage, setFrontImage] = useState<string | null>(null)
  const [backImage, setBackImage] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)

  const material = materialId ? getMaterial(materialId) : null
  const variation = variationId ? getVariation(variationId) : null

  useEffect(() => {
    let cancelled = false

    async function render() {
      const [front, back] = await Promise.all([
        renderCanvasToImage(frontCanvasJson, frontBgColor, variationId, 'front'),
        renderCanvasToImage(backCanvasJson, backBgColor, variationId, 'back'),
      ])

      if (!cancelled) {
        setFrontImage(front)
        setBackImage(back)
        setRendering(false)
      }
    }

    render()
    return () => { cancelled = true }
  }, [frontCanvasJson, backCanvasJson, frontBgColor, backBgColor, variationId])

  if (rendering) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-5 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">Preparing preview...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6">
      <div className="w-full max-w-4xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            {designName || 'Untitled Design'}
          </h1>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            {material && <span>{material.name}</span>}
            {material && variation && <span>&middot;</span>}
            {variation && <span>{variation.name}</span>}
            {(material || variation) && <span>&middot;</span>}
            <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize">
              {designMethod}
            </span>
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground text-center uppercase tracking-wider">
              Front
            </p>
            <img
              src={frontImage!}
              alt="Front of card"
              className="w-full shadow-lg"
              style={{ borderRadius: CARD_CORNER_RADIUS }}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground text-center uppercase tracking-wider">
              Back
            </p>
            <img
              src={backImage!}
              alt="Back of card"
              className="w-full shadow-lg"
              style={{ borderRadius: CARD_CORNER_RADIUS }}
            />
          </div>
        </div>

        {/* Edit button */}
        <div className="flex justify-center">
          <Button size="lg" onClick={onEdit} className="gap-2">
            <Pencil className="size-4" />
            Edit Design
          </Button>
        </div>
      </div>
    </div>
  )
}
