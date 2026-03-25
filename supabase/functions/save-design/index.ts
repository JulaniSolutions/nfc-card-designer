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
const RATE_LIMIT_MAX = 10 // max 10 saves per minute per IP (with valid CAPTCHA)
const RATE_LIMIT_MAX_UNVERIFIED = 3 // stricter limit when CAPTCHA is unavailable

const MAX_CANVAS_JSON_BYTES = 2_000_000 // 2MB per canvas field
const MAX_BODY_BYTES = 5_000_000 // 5MB total body

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

async function verifyTurnstile(token: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!secret) return true // Skip if not configured

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }),
  })
  const data = await res.json()
  return data.success === true
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
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 429 }
      )
    }

    // Check body size before parsing
    const contentLength = req.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Request too large.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 413 }
      )
    }

    const body = await req.json()

    // Verify Turnstile CAPTCHA
    const turnstileToken = body.turnstile_token
    if (Deno.env.get('TURNSTILE_SECRET_KEY')) {
      if (turnstileToken) {
        // Token provided — verify it. Reject fake/invalid tokens (catches bots).
        const valid = await verifyTurnstile(turnstileToken)
        if (!valid) {
          return new Response(
            JSON.stringify({ error: 'CAPTCHA verification failed.' }),
            { headers: { ...cors, 'Content-Type': 'application/json' }, status: 403 }
          )
        }
      } else {
        // No token (ad blocker, privacy browser, slow network).
        // Allow but apply stricter rate limit to prevent abuse.
        if (isRateLimited(ip, RATE_LIMIT_MAX_UNVERIFIED)) {
          return new Response(
            JSON.stringify({ error: 'Too many requests. Please try again later.' }),
            { headers: { ...cors, 'Content-Type': 'application/json' }, status: 429 }
          )
        }
      }
    }

    const {
      design_id,
      name,
      material_id,
      variation_id,
      front_canvas_json,
      back_canvas_json,
      front_bg_color,
      back_bg_color,
      design_method,
      back_option,
      card_names,
      variable_fields,
      card_data,
      quantity,
    } = body

    // Validate required fields
    if (!material_id || !variation_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Validate canvas JSON sizes
    if (front_canvas_json && new TextEncoder().encode(front_canvas_json).length > MAX_CANVAS_JSON_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Front canvas data too large.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 413 }
      )
    }
    if (back_canvas_json && new TextEncoder().encode(back_canvas_json).length > MAX_CANVAS_JSON_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Back canvas data too large.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 413 }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const payload = {
      name: name || null,
      material_id,
      variation_id,
      front_canvas_json: front_canvas_json || null,
      back_canvas_json: back_canvas_json || null,
      front_bg_color: front_bg_color || '#ffffff',
      back_bg_color: back_bg_color || '#ffffff',
      design_method: design_method || 'printed',
      back_option: back_option || 'qr-only',
      card_names: card_names || [''],
      variable_fields: variable_fields || [],
      card_data: card_data || [],
      quantity: quantity || 1,
      updated_at: new Date().toISOString(),
    }

    // Update existing design
    if (design_id) {
      const { data, error } = await supabase
        .from('designs')
        .update(payload)
        .eq('design_id', design_id)
        .select('design_id')
        .single()

      if (error) throw error
      return new Response(JSON.stringify(data), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Generate short ID for new design (crypto-secure)
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const randomBytes = new Uint8Array(8)
    crypto.getRandomValues(randomBytes)
    let shortId = ''
    for (let i = 0; i < 8; i++) {
      shortId += chars[randomBytes[i] % chars.length]
    }

    const { data, error } = await supabase
      .from('designs')
      .insert({ design_id: shortId, ...payload })
      .select('design_id')
      .single()

    if (error) throw error
    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json' },
      status: 201,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
