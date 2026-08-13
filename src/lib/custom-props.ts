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
]
