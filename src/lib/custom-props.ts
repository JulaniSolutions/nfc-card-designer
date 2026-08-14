/**
 * Custom Fabric.js object properties preserved through serialization.
 *
 * Single source of truth — every `toObject()` call must pass this exact list.
 * A partial copy silently drops the missing props from the serialised JSON, and
 * anything that writes that JSON back into the store (PDF export, auto-save)
 * then destroys them for good.
 */
export const CUSTOM_PROPS = [
  '_waveIcon',
  '_isLocked',
  '_layerLabel',
  '_isPlaceholder',
  '_qrPlaceholderBorder',
  '_qrPlaceholderLabel',
  '_backNameText',
  '_variableId',
  '_designId',
  '_isOpaque',
  '_addedInEngraved',
  '_originalSrc',
  '_layerType',
  '_assetUrl',
  '_assetName',
  '_originalAssetUrl',
  '_undeletable',
  // Generated QR codes, which exist only on offscreen print/preview render canvases
  // and must never be persisted — not to the store, not to Supabase. Listed here so
  // that a leaked one stays identifiable (and strippable) through a serialization
  // round-trip instead of turning into an anonymous image nobody can clean up.
  '_qrInjected',
]
