import { materials, type Material, type MaterialVariation } from '@/config/materials'
import { useDesignStore } from '@/store/design-store'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

export function MaterialSelector() {
  const { materialId, variationId, setMaterial } = useDesignStore()
  const selectedMaterial = materials.find((m) => m.id === materialId)

  return (
    <div className="space-y-4">
      {/* Material type */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
          Material
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
          {materials.map((material) => (
            <MaterialChip
              key={material.id}
              material={material}
              selected={materialId === material.id}
              onClick={() => setMaterial(material.id, material.variations[0].id)}
            />
          ))}
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
                onClick={() => setMaterial(selectedMaterial.id, variation.id)}
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
  onClick,
}: {
  material: Material
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
        'hover:bg-muted/80',
        selected
          ? 'border-foreground bg-foreground/[0.03]'
          : 'border-border bg-card'
      )}
    >
      <div
        className="size-3 rounded-full ring-1 ring-border shrink-0"
        style={{ backgroundColor: material.variations[0].colorHint }}
      />
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
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 w-full rounded-lg px-3 py-2 text-left transition-colors',
        'hover:bg-muted/80',
        selected ? 'bg-muted' : 'bg-transparent'
      )}
    >
      <div
        className="size-5 rounded-md ring-1 ring-border shrink-0"
        style={{ backgroundColor: variation.colorHint }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">{variation.name}</p>
        <p className="text-[11px] text-muted-foreground truncate">{variation.description}</p>
      </div>
      {selected && <Check className="size-3.5 text-foreground shrink-0" />}
    </button>
  )
}
