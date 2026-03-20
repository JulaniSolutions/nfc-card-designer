// Fonts preloaded via <link> in index.html
const PRELOADED_FONTS = new Set(['Inter', 'Poppins', 'Montserrat', 'Arial'])

// Track injected stylesheets to avoid duplicates
const loadedFontLinks = new Set<string>()

/** Font catalog: name → available weights */
export const FONT_WEIGHTS: Record<string, number[]> = {
  'Arial':            [400, 700],
  'Bebas Neue':       [400],
  'DM Sans':          [400, 500, 600, 700],
  'Inter':            [300, 400, 500, 600, 700],
  'Montserrat':       [300, 400, 500, 600, 700],
  'Oswald':           [300, 400, 500, 600, 700],
  'Playfair Display': [400, 500, 600, 700],
  'Poppins':          [300, 400, 500, 600, 700],
  'Roboto':           [300, 400, 500, 700],
  'Space Grotesk':    [400, 500, 600, 700],
}

export const AVAILABLE_FONTS = Object.keys(FONT_WEIGHTS).sort()

/** Dynamically inject a Google Fonts stylesheet for a font not in the initial preload */
export function ensureGoogleFont(fontName: string, weights: number[]): Promise<void> {
  if (PRELOADED_FONTS.has(fontName) || loadedFontLinks.has(fontName)) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const weightStr = weights.join(';')
    const family = `${fontName.replace(/ /g, '+')}:wght@${weightStr}`
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`
    link.onload = () => resolve()
    link.onerror = () => resolve()
    document.head.appendChild(link)
    loadedFontLinks.add(fontName)
  })
}

/** Extract font families from Fabric.js canvas JSON and ensure they're all loaded */
export async function ensureFontsFromCanvasJson(canvasJson: string | null | undefined): Promise<void> {
  if (!canvasJson) return
  try {
    const parsed = JSON.parse(canvasJson)
    const objects = parsed?.objects ?? []
    const fontsToLoad: { name: string; weight: number }[] = []
    for (const obj of objects) {
      if (obj.fontFamily && typeof obj.fontFamily === 'string') {
        const weights = FONT_WEIGHTS[obj.fontFamily] ?? [400, 700]
        // Inject the stylesheet
        await ensureGoogleFont(obj.fontFamily, weights)
        const weight = obj.fontWeight ?? 400
        fontsToLoad.push({ name: obj.fontFamily, weight })
      }
    }
    // Wait for all font files to actually download
    if (fontsToLoad.length > 0) {
      await document.fonts.ready
      await Promise.all(
        fontsToLoad.map(({ name, weight }) =>
          document.fonts.load(`${weight} 16px "${name}"`).catch(() => {})
        )
      )
    }
  } catch {
    // Ignore parse errors
  }
}
