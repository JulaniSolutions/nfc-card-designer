export interface MaterialVariation {
  id: string
  name: string
  description: string
  colorHint: string // hex color for UI preview swatch
  backgroundImage?: string // path relative to public/, e.g. '/materials/plastic-standard.jpg'
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
        backgroundImage: '/materials/plastic-standard.jpg',
      },
      {
        id: 'plastic-premium',
        name: 'Premium',
        description: 'Glossy finish with rounded edges',
        colorHint: '#e8e8e8',
        backgroundImage: '/materials/plastic-premium.jpg',
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
        backgroundImage: '/materials/bamboo-natural.jpg',
      },
      {
        id: 'bamboo-dark',
        name: 'Dark',
        description: 'Carbonised dark bamboo',
        colorHint: '#8b6914',
        backgroundImage: '/materials/bamboo-dark.jpg',
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
        backgroundImage: '/materials/full-metal-black.jpg',
      },
      {
        id: 'full-metal-silver',
        name: 'Silver',
        description: 'Brushed stainless steel',
        colorHint: '#c0c0c0',
        backgroundImage: '/materials/full-metal-silver.jpg',
      },
      {
        id: 'full-metal-gold',
        name: 'Gold',
        description: 'Gold-plated stainless steel',
        colorHint: '#d4af37',
        backgroundImage: '/materials/full-metal-gold.jpg',
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
        backgroundImage: '/materials/metal-hybrid-black.jpg',
      },
      {
        id: 'metal-hybrid-silver',
        name: 'Silver',
        description: 'Silver metal face with white PVC back',
        colorHint: '#b8b8b8',
        backgroundImage: '/materials/metal-hybrid-silver.jpg',
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
