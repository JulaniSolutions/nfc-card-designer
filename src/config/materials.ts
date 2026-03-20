export interface MaterialVariation {
  id: string
  name: string
  description: string
  colorHint: string
  frontImage?: string
  backImage?: string
  /** Color used for engraved designs (laser engraving tint) */
  engravedColor: string
  /** Default text/element color in printed mode */
  defaultPrintColor: string
  /** Swatch image for the finish selector */
  swatch?: string
  /** Whether this variation is currently in stock (defaults to true) */
  inStock?: boolean
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
        id: 'pvc-white',
        name: 'Matte White',
        description: 'Matte white PVC',
        colorHint: '#f5f5f5',
        frontImage: '/materials/pvc-white-front.webp',
        backImage: '/materials/pvc-white-back.webp',
        engravedColor: '#000000',
        defaultPrintColor: '#000000',
        swatch: '/materials/swatch-pvc-white.webp',
      },
      {
        id: 'pvc-black',
        name: 'Matte Black',
        description: 'Matte black PVC',
        colorHint: '#1a1a1a',
        frontImage: '/materials/pvc-black-front.webp',
        backImage: '/materials/pvc-black-back.webp',
        engravedColor: '#FFFFFF',
        defaultPrintColor: '#FFFFFF',
        swatch: '/materials/swatch-pvc-black.png',
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
        frontImage: '/materials/bamboo-front.webp',
        backImage: '/materials/bamboo-back.webp',
        engravedColor: '#000000',
        defaultPrintColor: '#000000',
        swatch: '/materials/swatch-bamboo-natural.webp',
      },
    ],
  },
  {
    id: 'metal',
    name: 'Metal',
    description: 'Premium solid metal cards',
    variations: [
      {
        id: 'metal-black-steel',
        name: 'Matte Black Steel',
        description: 'Matte black anodised steel',
        colorHint: '#1a1a1a',
        frontImage: '/materials/metal-black-front.webp',
        backImage: '/materials/metal-black-back.webp',
        engravedColor: '#C0C0C0',
        defaultPrintColor: '#FFFFFF',
        swatch: '/materials/swatch-metal-black-steel.webp',
      },
      {
        id: 'metal-black-gold',
        name: 'Matte Black Gold',
        description: 'Matte black with gold accents',
        colorHint: '#2d2d2d',
        frontImage: '/materials/metal-black-front.webp',
        backImage: '/materials/metal-black-back.webp',
        engravedColor: '#D4AF37',
        defaultPrintColor: '#FFFFFF',
        swatch: '/materials/swatch-metal-black-gold.webp',
      },
      {
        id: 'metal-brushed-silver',
        name: 'Brushed Silver',
        description: 'Brushed stainless steel',
        colorHint: '#c0c0c0',
        frontImage: '/materials/metal-bs-front.webp',
        backImage: '/materials/metal-bs-back.webp',
        engravedColor: '#505050',
        defaultPrintColor: '#000000',
        swatch: '/materials/swatch-metal-brushed-silver.webp',
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
