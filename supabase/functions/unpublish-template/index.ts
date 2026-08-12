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

// In-memory IP rate limiting (per edge function instance)
const ipRequests = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 10 // no CAPTCHA here — the edit token is the auth

const MAX_BODY_BYTES = 10_000

function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

function isRateLimited(ip: string, maxRequests: number = RATE_LIMIT_MAX): boolean {
  const now = Date.now()
  const timestamps = ipRequests.get(ip) || []
  // Remove entries outside the window
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= maxRequests) {
    ipRequests.set(ip, recent)
    return true
  }
  recent.push(now)
  ipRequests.set(ip, recent)
  return false
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const ip = getClientIp(req)

    // Check body size before parsing
    const contentLength = req.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Request too large.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 413 }
      )
    }

    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 429 }
      )
    }

    const body = await req.json()
    const { template_id, edit_token } = body

    if (typeof template_id !== 'string' || !template_id || typeof edit_token !== 'string' || !edit_token) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: existing } = await supabase
      .from('templates')
      .select('edit_token_hash')
      .eq('template_id', template_id)
      .maybeSingle()

    const providedHash = await sha256Hex(edit_token)
    if (!existing || existing.edit_token_hash !== providedHash) {
      return new Response(
        JSON.stringify({ error: 'Invalid edit token.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    // Soft delete only. Designs already forked from this template still point at
    // the preview/asset objects in storage — removing them would break those cards.
    const { error } = await supabase
      .from('templates')
      .update({ is_published: false, updated_at: new Date().toISOString() })
      .eq('template_id', template_id)

    if (error) throw error

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
