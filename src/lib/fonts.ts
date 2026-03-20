/**
 * Font catalog — system fonts only.
 * All fonts are websafe and map to jsPDF built-in families for clean PDF export.
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

/** Map canvas font family → jsPDF built-in font name */
export function toJsPdfFont(fontFamily: string): string {
  const lower = fontFamily.toLowerCase()
  if (lower.includes('courier')) return 'courier'
  if (lower.includes('times') || lower.includes('georgia')) return 'times'
  return 'helvetica'
}
