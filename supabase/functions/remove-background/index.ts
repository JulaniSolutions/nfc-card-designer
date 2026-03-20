const allowedOrigins = [
  Deno.env.get('APP_ORIGIN') || 'https://nfcdesigner.com',
  'http://localhost:5173',
  'http://localhost:4173',
]

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

// Rate limiting
const ipRequests = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 5 // 5 requests per minute per IP

const MAX_BODY_BYTES = 10_000_000 // 10MB (images can be large)

function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const timestamps = ipRequests.get(ip) || []
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) {
    ipRequests.set(ip, recent)
    return true
  }
  recent.push(now)
  ipRequests.set(ip, recent)
  return false
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const apiKey = Deno.env.get('RUNWARE_API_KEY')
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Background removal is not configured.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 503 }
      )
    }

    const ip = getClientIp(req)
    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 429 }
      )
    }

    const contentLength = req.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Image too large.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 413 }
      )
    }

    const { imageDataUrl } = await req.json()
    if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:image/')) {
      return new Response(
        JSON.stringify({ error: 'Invalid image data.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const response = await fetch('https://api.runware.ai/v1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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
      const text = await response.text()
      const status = response.status === 429 ? 429 : 502
      return new Response(
        JSON.stringify({ error: status === 429 ? 'Rate limit exceeded. Please wait and try again.' : `Background removal failed: ${text}` }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status }
      )
    }

    const data = await response.json()
    const result = data?.data?.[0]
    if (!result?.imageDataURI) {
      return new Response(
        JSON.stringify({ error: 'No image returned from background removal service.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 502 }
      )
    }

    return new Response(
      JSON.stringify({ imageDataURI: result.imageDataURI }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...cors, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
