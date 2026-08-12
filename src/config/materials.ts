/**
 * How the front of a card is decorated. Derived from the material — never chosen
 * by the user. Metal materials are laser engraved; plastic and bamboo are printed.
 *
 * Defined here rather than in the design store so that `getDefaultDesignMethod`
 * can reference it without the store/config import cycle.
 */
export type DesignMethod = 'engraved' | 'printed'

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
  /**
   * Whether the front is always laser engraved. Printing is not offered on these
   * materials — this is not a user-facing choice.
   */
  frontAlwaysEngraved: boolean
  /** Whether the back side always uses engraved color (e.g. Full Metal) */
  backAlwaysEngraved: boolean
  /** Whether to hide the NFC wave icon on the front */
  hideWaveIcon: boolean
}

export const materials: Material[] = [
  {
    id: 'plastic',
    name: 'Plastic',
    description: 'Lightweight and durable PVC cards',
    frontAlwaysEngraved: false,
    backAlwaysEngraved: false,
    hideWaveIcon: false,
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
    frontAlwaysEngraved: false,
    backAlwaysEngraved: false,
    hideWaveIcon: false,
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
    name: 'Full Metal',
    description: 'Premium solid metal cards',
    frontAlwaysEngraved: true,
    backAlwaysEngraved: true,
    hideWaveIcon: true,
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
  {
    id: 'hybrid-metal',
    name: 'Hybrid Metal',
    description: 'Metal-PVC hybrid cards',
    frontAlwaysEngraved: true,
    backAlwaysEngraved: false,
    hideWaveIcon: true,
    variations: [
      {
        id: 'hybrid-metal-black-steel',
        name: 'Matte Black Steel',
        description: 'Matte black steel hybrid',
        colorHint: '#1a1a1a',
        frontImage: '/materials/hybridmetal-black-front.webp',
        backImage: '/materials/hybridmetal-black-back.webp',
        engravedColor: '#C0C0C0',
        defaultPrintColor: '#FFFFFF',
        swatch: '/materials/swatch-hybridmetal-black-steel.webp',
      },
    ],
  },
  {
    id: '24k-gold',
    name: '24k Gold',
    description: 'Premium 24k gold plated cards',
    frontAlwaysEngraved: true,
    backAlwaysEngraved: false,
    hideWaveIcon: true,
    variations: [
      {
        id: '24k-gold',
        name: '24k Gold',
        description: 'Stainless steel core with 24k gold plating',
        colorHint: '#D4AF37',
        frontImage: '/materials/24kgold-front.webp',
        backImage: '/materials/24kgold-back.webp',
        engravedColor: '#4E4743',
        defaultPrintColor: '#000000',
        swatch: '/materials/swatch-24kgold.png',
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

/** Whether this material's front is laser engraved rather than printed. */
export function isFrontEngraved(materialId: string | null): boolean {
  if (!materialId) return false
  const mat = getMaterial(materialId)
  return mat?.frontAlwaysEngraved ?? false
}

/**
 * The only design method a material can be designed in. Printing on metal is no
 * longer offered, so this is the single source of truth for new work — the
 * stored `design_method` is only authoritative for designs saved before that
 * change, which stay readable exactly as they were saved.
 */
export function getDefaultDesignMethod(materialId: string | null): DesignMethod {
  return isFrontEngraved(materialId) ? 'engraved' : 'printed'
}

/**
 * Whether a given side of the card is laser engraved.
 *
 * The two sides can disagree: Hybrid Metal and 24k Gold have an engraved metal
 * front but a printed back, so anything that applies engraved styling has to ask
 * per side rather than reading the design method, which describes the front.
 */
export function isSideEngraved(materialId: string | null, side: 'front' | 'back'): boolean {
  return side === 'front' ? isFrontEngraved(materialId) : isBackEngraved(materialId)
}

export function isBackEngraved(materialId: string | null): boolean {
  if (!materialId) return false
  const mat = getMaterial(materialId)
  return mat?.backAlwaysEngraved ?? false
}

export function shouldHideWaveIcon(materialId: string | null): boolean {
  if (!materialId) return false
  const mat = getMaterial(materialId)
  return mat?.hideWaveIcon ?? false
}
