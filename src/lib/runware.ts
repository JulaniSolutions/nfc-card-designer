const RUNWARE_API_KEY = import.meta.env.VITE_RUNWARE_API_KEY as string | undefined

const RUNWARE_API_URL = 'https://api.runware.ai/v1'

export function isBackgroundRemovalEnabled(): boolean {
  return !!RUNWARE_API_KEY
}

/**
 * Remove background from an image using Runware API.
 * Takes a base64 data URL, returns a base64 data URL with transparent background.
 */
export async function removeBackground(imageDataUrl: string): Promise<string> {
  if (!RUNWARE_API_KEY) {
    throw new Error('Background removal is not configured. Set VITE_RUNWARE_API_KEY.')
  }

  // Extract base64 data from data URL
  const base64Match = imageDataUrl.match(/^data:image\/\w+;base64,(.+)$/)
  if (!base64Match) {
    throw new Error('Invalid image data URL')
  }

  const response = await fetch(RUNWARE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RUNWARE_API_KEY}`,
    },
    body: JSON.stringify([
      {
        taskType: 'imageBackgroundRemoval',
        taskUUID: crypto.randomUUID(),
        inputImage: imageDataUrl,
        model: 'runware:110@1',
        outputFormat: 'PNG',
        outputType: 'dataURI',
      },
    ]),
  })

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.')
    }
    const text = await response.text()
    throw new Error(`Background removal failed: ${text}`)
  }

  const data = await response.json()

  // Runware returns an array of results
  const result = data?.data?.[0]
  if (!result?.imageDataURI) {
    throw new Error('No image returned from background removal service.')
  }

  return result.imageDataURI
}
