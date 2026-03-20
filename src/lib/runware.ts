function getEdgeFunctionUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  return `${supabaseUrl}/functions/v1/remove-background`
}

export function isBackgroundRemovalEnabled(): boolean {
  // Always enabled — the edge function handles the API key server-side
  return !!import.meta.env.VITE_SUPABASE_URL
}

/**
 * Remove background from an image via Supabase edge function.
 * Takes a base64 data URL, returns a base64 data URL with transparent background.
 */
export async function removeBackground(imageDataUrl: string): Promise<string> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const response = await fetch(getEdgeFunctionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ imageDataUrl }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `Background removal failed (${response.status})`)
  }

  const data = await response.json()
  if (!data.imageDataURI) {
    throw new Error('No image returned from background removal service.')
  }

  return data.imageDataURI
}
