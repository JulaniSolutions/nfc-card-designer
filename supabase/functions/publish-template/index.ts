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
const RATE_LIMIT_MAX = 3 // publishing is rarer and more abusable than saving
const RATE_LIMIT_MAX_UNVERIFIED = 1 // stricter limit when CAPTCHA is unavailable

const MAX_CANVAS_JSON_BYTES = 2_000_000 // 2MB per canvas field
const MAX_BODY_BYTES = 5_000_000 // 5MB total body
const MAX_PREVIEW_BYTES = 2_000_000 // 2MB per decoded preview image

const MAX_NAME_LENGTH = 80
const MAX_DESCRIPTION_LENGTH = 300

const UNIQUE_VIOLATION = '23505'

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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface VariableField {
  id: string
  label: string
}

/**
 * Authoritative sanitising pass. The client does the same thing before sending,
 * but a template is public and permanent — the server must not trust that.
 */
function sanitizeCanvasJson(json: unknown, variableFields: VariableField[]): string | null {
  if (typeof json !== 'string' || !json) return null
  try {
    const labelById = new Map(variableFields.map((f) => [f.id, f.label]))

    const scrub = (objects: Record<string, unknown>[]) => {
      for (const obj of objects) {
        if (!obj || typeof obj !== 'object') continue
        // The author's untouched source upload — not theirs to redistribute via a template.
        delete obj._originalAssetUrl
        // Pre-background-removal copy of the image, kept client-side for undo. It is a
        // full-resolution data URL of the ORIGINAL photo including the background the
        // author deliberately removed. It must never be published.
        delete obj._originalSrc
        // Variable text holds the real card holder's value; publish the field label instead.
        const variableId = obj._variableId
        if (typeof variableId === 'string') {
          obj.text = labelById.get(variableId) ?? ''
        }
        // Images added in the current browser session still carry a base64 data URL on
        // the live Fabric object even after saveDesign uploaded them. Swap in the
        // Storage URL, or a valid design becomes an oversized, unpublishable payload.
        const assetUrl = obj._assetUrl
        if (typeof assetUrl === 'string' && typeof obj.src === 'string' && obj.src.startsWith('data:')) {
          obj.src = assetUrl
        }
        const nested = obj.objects
        if (Array.isArray(nested)) scrub(nested as Record<string, unknown>[])
      }
    }

    const parsed = JSON.parse(json) as { objects?: Record<string, unknown>[] }
    scrub(parsed.objects ?? [])
    return JSON.stringify(parsed)
  } catch {
    return json
  }
}

/** Decode a 'data:image/...;base64,...' string, rejecting anything oversized or malformed. */
function decodePreview(dataUrl: unknown): Uint8Array | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return null
  const base64 = dataUrl.slice(comma + 1)
  // Cheap pre-check so a huge string never reaches atob
  if (base64.length > MAX_PREVIEW_BYTES * 1.4) return null
  try {
    const binary = atob(base64)
    if (binary.length > MAX_PREVIEW_BYTES) return null
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

type StorageBucket = ReturnType<ReturnType<typeof createClient>['storage']['from']>

/** Previews are cosmetic — never let one fail the publish. */
async function uploadPreview(
  bucket: StorageBucket,
  templateId: string,
  side: 'front' | 'back',
  dataUrl: unknown,
): Promise<string | null> {
  const bytes = decodePreview(dataUrl)
  if (!bytes) return null

  const path = `templates/${templateId}/${side}.jpg`
  try {
    const { error } = await bucket.upload(path, bytes, {
      contentType: 'image/jpeg',
      upsert: true, // re-publishing overwrites the previous snapshot
    })
    if (error) {
      console.error(`Template preview upload failed (${side}):`, error.message)
      return null
    }
    return bucket.getPublicUrl(path).data.publicUrl
  } catch (error) {
    console.error(`Template preview upload failed (${side}):`, (error as Error).message)
    return null
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
      name,
      description,
      source_design_id,
      material_id,
      variation_id,
      front_canvas_json,
      back_canvas_json,
      front_bg_color,
      back_bg_color,
      design_method,
      back_option,
      variable_fields,
      front_preview,
      back_preview,
      template_id,
      edit_token,
    } = body

    // Validate required fields
    const trimmedName = typeof name === 'string' ? name.trim() : ''
    if (!trimmedName || trimmedName.length > MAX_NAME_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Template name must be 1–${MAX_NAME_LENGTH} characters.` }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    let trimmedDescription: string | null = null
    if (description !== null && description !== undefined && description !== '') {
      if (typeof description !== 'string' || description.trim().length > MAX_DESCRIPTION_LENGTH) {
        return new Response(
          JSON.stringify({ error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.` }),
          { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
        )
      }
      trimmedDescription = description.trim() || null
    }

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

    const variableFields: VariableField[] = Array.isArray(variable_fields) ? variable_fields : []

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const payload = {
      name: trimmedName,
      description: trimmedDescription,
      source_design_id: typeof source_design_id === 'string' && source_design_id ? source_design_id : null,
      material_id,
      variation_id,
      front_canvas_json: sanitizeCanvasJson(front_canvas_json, variableFields),
      back_canvas_json: sanitizeCanvasJson(back_canvas_json, variableFields),
      front_bg_color: front_bg_color || '#ffffff',
      back_bg_color: back_bg_color || '#ffffff',
      design_method: design_method || 'printed',
      back_option: back_option || 'qr-only',
      variable_fields: variableFields,
      updated_at: new Date().toISOString(),
    }

    // The client mints template_id and edit_token before its first attempt, so a
    // request replayed after a lost response lands on the row it already created
    // instead of publishing a second, orphaned template whose secret is nowhere.
    if (typeof template_id !== 'string' || !/^[a-z0-9]{8}$/.test(template_id)) {
      return new Response(
        JSON.stringify({ error: 'Missing or malformed template_id.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }
    if (typeof edit_token !== 'string' || !/^[a-f0-9]{32}$/.test(edit_token)) {
      return new Response(
        JSON.stringify({ error: 'Missing or malformed edit_token.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const editTokenHash = await sha256Hex(edit_token)

    const { data: existing } = await supabase
      .from('templates')
      .select('edit_token_hash')
      .eq('template_id', template_id)
      .maybeSingle()

    // Whoever holds the matching token owns the row — that covers a deliberate
    // re-publish and a retry alike. A mismatch is someone else's template.
    if (existing && existing.edit_token_hash !== editTokenHash) {
      return new Response(
        JSON.stringify({ error: 'Invalid edit token.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 403 }
      )
    }

    const bucket = supabase.storage.from('design-assets')
    const [frontUrl, backUrl] = await Promise.all([
      uploadPreview(bucket, template_id, 'front', front_preview),
      uploadPreview(bucket, template_id, 'back', back_preview),
    ])

    // Only write preview URLs we actually produced. Preview generation is
    // best-effort on the client and can fail for a CORS-tainted canvas or a slow
    // render — writing null unconditionally would wipe a working thumbnail.
    const previewPatch: Record<string, string> = {}
    if (frontUrl) previewPatch.front_preview_url = frontUrl
    if (backUrl) previewPatch.back_preview_url = backUrl

    if (existing) {
      const { error } = await supabase
        .from('templates')
        .update({ ...payload, ...previewPatch, is_published: true })
        .eq('template_id', template_id)
      if (error) throw error
    } else {
      const { error } = await supabase
        .from('templates')
        .insert({
          template_id,
          ...payload,
          ...previewPatch,
          edit_token_hash: editTokenHash,
          is_published: true,
        })
      if (error) {
        // Lost a race against a concurrent replay of this same request. The row
        // now exists with our own token, so the retry path is the correct answer.
        if (error.code !== UNIQUE_VIOLATION) throw error
        const { error: updateError } = await supabase
          .from('templates')
          .update({ ...payload, ...previewPatch, is_published: true })
          .eq('template_id', template_id)
          .eq('edit_token_hash', editTokenHash)
        if (updateError) throw updateError
      }
    }

    return new Response(
      JSON.stringify({ template_id, edit_token }),
      { headers: { ...cors, 'Content-Type': 'application/json' }, status: 201 }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
