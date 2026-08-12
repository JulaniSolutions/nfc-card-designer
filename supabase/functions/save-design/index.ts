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

// Mirrors `frontAlwaysEngraved` in src/config/materials.ts. Edge functions deploy
// independently and can't import from src/, so keep the two in step by hand.
const ENGRAVE_ONLY_MATERIALS = ['metal', 'hybrid-metal', '24k-gold']

/**
 * Metal can no longer be printed. New rows are normalised on write so a stale
 * cached client or a direct API call can't record a combination production
 * cannot fulfil. Rows saved before the change are left untouched — reads are
 * not normalised, and there is no backfill.
 */
function normalizeDesignMethod(materialId: unknown, designMethod: unknown): string {
  if (typeof materialId === 'string' && ENGRAVE_ONLY_MATERIALS.includes(materialId)) {
    return 'engraved'
  }
  return designMethod === 'engraved' || designMethod === 'printed' ? designMethod : 'printed'
}

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

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
      signal: controller.signal,
    })
    const data = await res.json()
    return data.success === true
  } catch {
    // Fail closed — don't bypass CAPTCHA when Cloudflare is unreachable
    return false
  } finally {
    clearTimeout(timer)
  }
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

    const body = await req.json()

    // Determine rate limit threshold based on CAPTCHA status, then check once
    let rateLimit = RATE_LIMIT_MAX
    const turnstileToken = body.turnstile_token
    if (Deno.env.get('TURNSTILE_SECRET_KEY')) {
      if (turnstileToken) {
        const valid = await verifyTurnstile(turnstileToken)
        if (!valid) {
          return new Response(
            JSON.stringify({ error: 'CAPTCHA verification failed.' }),
            { headers: { ...cors, 'Content-Type': 'application/json' }, status: 403 }
          )
        }
      } else {
        // No token (ad blocker, privacy browser, slow network) — stricter limit
        rateLimit = RATE_LIMIT_MAX_UNVERIFIED
      }
    }

    if (isRateLimited(ip, rateLimit)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 429 }
      )
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
      source_template_id,
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

    // source_template_id feeds a trigger that increments a public counter, so an
    // arbitrary string from the body must not reach it. Confirming the template
    // exists and is published stops a typo or a scripted id from inflating a
    // stranger's "used N times" — it cannot stop a determined caller from
    // replaying real saves, which would need auth we don't have.
    let attribution: string | null = null
    if (typeof source_template_id === 'string' && /^[a-z0-9]{8}$/.test(source_template_id)) {
      const { data: tpl } = await supabase
        .from('templates')
        .select('template_id')
        .eq('template_id', source_template_id)
        .eq('is_published', true)
        .maybeSingle()
      if (tpl) attribution = source_template_id
    }

    const payload = {
      name: name || null,
      material_id,
      variation_id,
      front_canvas_json: front_canvas_json || null,
      back_canvas_json: back_canvas_json || null,
      front_bg_color: front_bg_color || '#ffffff',
      back_bg_color: back_bg_color || '#ffffff',
      design_method: normalizeDesignMethod(material_id, design_method),
      back_option: back_option || 'qr-only',
      card_names: card_names || [''],
      variable_fields: variable_fields || [],
      card_data: card_data || [],
      quantity: quantity || 1,
      updated_at: new Date().toISOString(),
      // Only ever set, never cleared — a plain re-save must not wipe the attribution
      // (and the use_count trigger fires once, on insert).
      ...(attribution ? { source_template_id: attribution } : {}),
    }

    if (!design_id) {
      return new Response(
        JSON.stringify({ error: 'Missing design_id.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Upsert: insert if new, update if exists — prevents duplicates on retry
    const { data, error } = await supabase
      .from('designs')
      .upsert({ design_id, ...payload }, { onConflict: 'design_id' })
      .select('design_id')
      .single()

    if (error) throw error

    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
