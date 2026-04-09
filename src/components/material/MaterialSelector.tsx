import { materials, getVariation, type Material, type MaterialVariation } from '@/config/materials'
import { useDesignStore } from '@/store/design-store'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'
import {
  applyEngravedToCanvas,
  removeEngravedFromCanvas,
  resetColorsForMaterialSwitch,
} from '@/lib/engraved-filters'

function applyFiltersForVariation(
  newVariationId: string,
  method: 'engraved' | 'printed',
  oldVariationId?: string | null,
) {
  const variation = getVariation(newVariationId)
  if (!variation) return

  const oldVariation = oldVariationId ? getVariation(oldVariationId) : null

  for (const canvas of [window.__fabricCanvasFront, window.__fabricCanvasBack]) {
    if (!canvas) continue
    if (method === 'engraved') {
      applyEngravedToCanvas(canvas, variation.engravedColor)
    } else if (oldVariation) {
      // Smart reset: update text whose color matches the old material's default or engraved color
      resetColorsForMaterialSwitch(
        canvas,
        oldVariation.defaultPrintColor,
        oldVariation.engravedColor,
        variation.defaultPrintColor,
      )
    } else {
      removeEngravedFromCanvas(canvas, variation.defaultPrintColor)
    }
  }
}

export function MaterialSelector() {
  const { materialId, variationId, setMaterial, setDesignMethod, designMethod } = useDesignStore()
  const selectedMaterial = materials.find((m) => m.id === materialId)

  const handleMaterialClick = (material: Material) => {
    // Pick first in-stock variation, or first overall
    const firstAvailable = material.variations.find((v) => v.inStock !== false) ?? material.variations[0]
    const newVariationId = firstAvailable.id
    const newMethod = material.supportsEngraving ? 'engraved' : 'printed'
    const oldVarId = variationId
    setMaterial(material.id, newVariationId)
    setDesignMethod(newMethod)
    applyFiltersForVariation(newVariationId, newMethod, oldVarId)
  }

  const handleVariationClick = (material: Material, variation: MaterialVariation) => {
    if (variation.inStock === false) return
    const oldVarId = variationId
    setMaterial(material.id, variation.id)
    const currentMethod = material.supportsEngraving ? designMethod : 'printed'
    applyFiltersForVariation(variation.id, currentMethod, oldVarId)
  }

  return (
    <div className="space-y-4">
      {/* Material type */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
          Material
        </h3>
        <div className="grid grid-cols-3 lg:grid-cols-2 gap-1.5">
          {materials.map((material) => {
            const allOutOfStock = material.variations.every((v) => v.inStock === false)
            return (
              <MaterialChip
                key={material.id}
                material={material}
                selected={materialId === material.id}
                disabled={allOutOfStock}
                onClick={() => !allOutOfStock && handleMaterialClick(material)}
              />
            )
          })}
        </div>
      </div>

      {/* Variations */}
      {selectedMaterial && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
            Finish
          </h3>
          <div className="space-y-1">
            {selectedMaterial.variations.map((variation) => (
              <VariationRow
                key={variation.id}
                variation={variation}
                selected={variationId === variation.id}
                onClick={() => handleVariationClick(selectedMaterial, variation)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MaterialChip({
  material,
  selected,
  disabled,
  onClick,
}: {
  material: Material
  selected: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center rounded-lg border px-3 py-2 text-left transition-colors',
        disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-muted/80',
        selected && !disabled
          ? 'border-foreground bg-foreground/[0.03]'
          : 'border-border bg-card'
      )}
    >
      <span className="text-xs font-medium truncate">{material.name}</span>
    </button>
  )
}

function VariationRow({
  variation,
  selected,
  onClick,
}: {
  variation: MaterialVariation
  selected: boolean
  onClick: () => void
}) {
  const outOfStock = variation.inStock === false

  return (
    <button
      onClick={onClick}
      disabled={outOfStock}
      className={cn(
        'flex items-center gap-3 w-full rounded-lg px-3 py-2 text-left transition-colors',
        outOfStock
          ? 'opacity-40 cursor-not-allowed'
          : 'hover:bg-muted/80',
        selected && !outOfStock ? 'bg-muted' : 'bg-transparent'
      )}
    >
      {variation.swatch ? (
        <img
          src={variation.swatch}
          alt={variation.name}
          className="size-8 rounded-md ring-1 ring-border shrink-0 object-cover"
        />
      ) : (
        <div
          className="size-8 rounded-md ring-1 ring-border shrink-0"
          style={{ backgroundColor: variation.colorHint }}
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">
          {variation.name}
          {outOfStock && (
            <span className="text-[10px] text-muted-foreground ml-1.5">Out of stock</span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">{variation.description}</p>
      </div>
      {selected && !outOfStock && <Check className="size-3.5 text-foreground shrink-0" />}
    </button>
  )
}
