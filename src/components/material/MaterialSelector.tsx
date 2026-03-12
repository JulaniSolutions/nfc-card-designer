import { materials, type Material, type MaterialVariation } from '@/config/materials'
import { useDesignStore } from '@/store/design-store'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function MaterialSelector() {
  const { materialId, variationId, setMaterial } = useDesignStore()

  const selectedMaterial = materials.find((m) => m.id === materialId)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-2">Material</h3>
        <div className="grid grid-cols-2 gap-2">
          {materials.map((material) => (
            <MaterialCard
              key={material.id}
              material={material}
              selected={materialId === material.id}
              onClick={() => setMaterial(material.id, material.variations[0].id)}
            />
          ))}
        </div>
      </div>

      {selectedMaterial && (
        <div>
          <h3 className="text-sm font-medium mb-2">Variation</h3>
          <div className="grid grid-cols-2 gap-2">
            {selectedMaterial.variations.map((variation) => (
              <VariationCard
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

function MaterialCard({
  material,
  selected,
  onClick,
}: {
  material: Material
  selected: boolean
  onClick: () => void
}) {
  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:border-foreground/30',
        selected && 'border-foreground ring-1 ring-foreground'
      )}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <div
            className="w-4 h-4 rounded-full border border-border"
            style={{ backgroundColor: material.variations[0].colorHint }}
          />
          <div>
            <p className="text-sm font-medium">{material.name}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function VariationCard({
  variation,
  selected,
  onClick,
}: {
  variation: MaterialVariation
  selected: boolean
  onClick: () => void
}) {
  return (
    <Card
      className={cn(
        'cursor-pointer transition-all hover:border-foreground/30',
        selected && 'border-foreground ring-1 ring-foreground'
      )}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <div
            className="w-4 h-4 rounded-full border border-border"
            style={{ backgroundColor: variation.colorHint }}
          />
          <div>
            <p className="text-sm font-medium">{variation.name}</p>
            <p className="text-xs text-muted-foreground">{variation.description}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
