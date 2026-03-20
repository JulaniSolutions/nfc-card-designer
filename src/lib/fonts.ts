/**
 * Font catalog — system fonts only.
 * All websafe, no external loading needed. Text is rasterized in PDF export
 * so what you see on canvas is exactly what appears in the PDF.
 */

/** Font name → available weights */
export const FONT_WEIGHTS: Record<string, number[]> = {
  'Arial':           [400, 700],
  'Helvetica':       [400, 700],
  'Verdana':         [400, 700],
  'Trebuchet MS':    [400, 700],
  'Georgia':         [400, 700],
  'Times New Roman': [400, 700],
  'Courier New':     [400, 700],
}

export const AVAILABLE_FONTS = Object.keys(FONT_WEIGHTS).sort()
