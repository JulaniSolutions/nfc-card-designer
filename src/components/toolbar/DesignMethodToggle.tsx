import { useDesignStore, type DesignMethod } from '@/store/design-store'
import { getVariation, isBackEngraved } from '@/config/materials'
import { cn } from '@/lib/utils'
import {
  applyEngravedToCanvas,
  removeEngravedFromCanvas,
} from '@/lib/engraved-filters'

export function DesignMethodToggle() {
  const { designMethod, setDesignMethod, variationId, materialId } = useDesignStore()

  const variation = variationId ? getVariation(variationId) : undefined

  const handleSwitch = (method: DesignMethod) => {
    if (method === designMethod) return
    setDesignMethod(method)

    const engravedColor = variation?.engravedColor ?? '#C0C0C0'
    const defaultPrintColor = variation?.defaultPrintColor ?? '#FFFFFF'

    // Apply/remove filters on both canvases
    for (const canvas of [window.__fabricCanvasFront, window.__fabricCanvasBack]) {
      if (!canvas) continue
      if (method === 'engraved') {
        applyEngravedToCanvas(canvas, engravedColor)
      } else {
        removeEngravedFromCanvas(canvas, defaultPrintColor)
      }
    }
  }

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
        Design Method
      </h3>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => handleSwitch('engraved')}
          className={cn(
            'text-xs font-medium rounded-md px-3 py-1.5 transition-colors',
            designMethod === 'engraved'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Engraved
        </button>
        <button
          onClick={() => handleSwitch('printed')}
          className={cn(
            'text-xs font-medium rounded-md px-3 py-1.5 transition-colors',
            designMethod === 'printed'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Printed
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5">
        {designMethod === 'engraved'
          ? isBackEngraved(materialId)
            ? 'Recommended for the most premium quality finish. Single-color laser engraved. The back is always engraved.'
            : 'Single-color laser engraved front. The back will always be printed.'
          : isBackEngraved(materialId)
            ? 'Full-color UV printed front. The back is always engraved for long-lasting QR durability.'
            : 'Full-color UV printed front. The back will always be printed.'}
      </p>
    </div>
  )
}
