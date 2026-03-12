export interface MaterialVariation {
  id: string
  name: string
  description: string
  colorHint: string // hex color for UI preview swatch
}

export interface Material {
  id: string
  name: string
  description: string
  variations: MaterialVariation[]
}

export const materials: Material[] = [
  {
    id: 'plastic',
    name: 'Plastic',
    description: 'Lightweight and durable PVC cards',
    variations: [
      {
        id: 'plastic-standard',
        name: 'Standard',
        description: 'Matte white PVC',
        colorHint: '#f5f5f5',
      },
      {
        id: 'plastic-premium',
        name: 'Premium',
        description: 'Glossy finish with rounded edges',
        colorHint: '#e8e8e8',
      },
    ],
  },
  {
    id: 'bamboo',
    name: 'Bamboo',
    description: 'Eco-friendly natural bamboo cards',
    variations: [
      {
        id: 'bamboo-natural',
        name: 'Natural',
        description: 'Light natural bamboo finish',
        colorHint: '#d4a76a',
      },
      {
        id: 'bamboo-dark',
        name: 'Dark',
        description: 'Carbonised dark bamboo',
        colorHint: '#8b6914',
      },
    ],
  },
  {
    id: 'full-metal',
    name: 'Full Metal',
    description: 'Premium solid metal cards',
    variations: [
      {
        id: 'full-metal-black',
        name: 'Black',
        description: 'Matte black anodised metal',
        colorHint: '#1a1a1a',
      },
      {
        id: 'full-metal-silver',
        name: 'Silver',
        description: 'Brushed stainless steel',
        colorHint: '#c0c0c0',
      },
      {
        id: 'full-metal-gold',
        name: 'Gold',
        description: 'Gold-plated stainless steel',
        colorHint: '#d4af37',
      },
    ],
  },
  {
    id: 'metal-hybrid',
    name: 'Metal Hybrid',
    description: 'Metal front with PVC backing',
    variations: [
      {
        id: 'metal-hybrid-black',
        name: 'Black',
        description: 'Black metal face with white PVC back',
        colorHint: '#2d2d2d',
      },
      {
        id: 'metal-hybrid-silver',
        name: 'Silver',
        description: 'Silver metal face with white PVC back',
        colorHint: '#b8b8b8',
      },
    ],
  },
]

export function getMaterial(materialId: string): Material | undefined {
  return materials.find((m) => m.id === materialId)
}

export function getVariation(variationId: string): MaterialVariation | undefined {
  for (const material of materials) {
    const variation = material.variations.find((v) => v.id === variationId)
    if (variation) return variation
  }
  return undefined
}
