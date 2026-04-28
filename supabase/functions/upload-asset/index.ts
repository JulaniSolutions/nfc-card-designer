import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// In-memory IP rate limiting
const ipRequests = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 20 // max 20 uploads per minute per IP

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]

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
    // Rate limit by IP
    const ip = getClientIp(req)
    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many uploads. Please try again later.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 429 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) throw new Error('No file uploaded')

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 413 }
      )
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return new Response(
        JSON.stringify({ error: `File type not allowed. Accepted: ${ALLOWED_MIME_TYPES.join(', ')}` }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 415 }
      )
    }

    // Validate file extension matches MIME
    const fileExt = file.name.split('.').pop()?.toLowerCase()
    const validExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']
    if (!fileExt || !validExtensions.includes(fileExt)) {
      return new Response(
        JSON.stringify({ error: 'Invalid file extension.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 415 }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const allowedPrefixes = ['uploads', 'originals']
    const prefix = formData.get('prefix')?.toString() || 'uploads'
    if (!allowedPrefixes.includes(prefix)) {
      return new Response(
        JSON.stringify({ error: 'Invalid upload prefix.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const fileName = `${crypto.randomUUID()}.${fileExt}`
    const filePath = `${prefix}/${fileName}`

    const { error } = await supabase.storage
      .from('design-assets')
      .upload(filePath, file, {
        contentType: file.type,
        upsert: false,
      })

    if (error) throw error

    const { data: urlData } = supabase.storage
      .from('design-assets')
      .getPublicUrl(filePath)

    return new Response(
      JSON.stringify({ url: urlData.publicUrl, path: filePath }),
      {
        headers: { ...cors, 'Content-Type': 'application/json' },
        status: 201,
      }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
