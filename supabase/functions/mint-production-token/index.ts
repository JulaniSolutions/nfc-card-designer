/**
 * mint-production-token — the staff-side twin of the WordPress mint.
 *
 * WordPress signs a production deep link as
 * `hash_hmac('sha256', "{order}.{item}.{exp}", DESIGNER_SHARED_SECRET)`, and
 * `drive-upload` verifies exactly that. This function mints the same token for
 * the `/production` staff page, so an order that never touched WordPress (a
 * direct sale, a reprint, a partner emailing refs) gets a link that is
 * byte-for-byte what the plugin would have built — and `drive-upload` needs no
 * second code path to trust it.
 *
 * Gated by `PRODUCTION_STAFF_KEY`, a long random secret only staff hold. The
 * shared secret itself never leaves this function. Minted tokens carry a fixed
 * lifetime, so a leaked link dies on its own; rotating the staff key revokes the
 * ability to mint more, not the tokens already out.
 */

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

// In-memory IP rate limiting (per edge function instance). Deliberately the
// strictest limit in the repo: the only legitimate caller is one person
// building one link at a time, and a wrong key is the thing worth slowing down.
const ipRequests = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 5

/** Mirrors `drive-upload` — what it will accept as order/item. */
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
/** Seven days: long enough to hand a link to whoever does the print run. */
const TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60
const MAX_BODY_BYTES = 10_000

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

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Compares two equal-length hex digests without leaking position via timing. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Both sides are hashed before comparing, so the comparison is constant-time
 * regardless of how the submitted key's length relates to the real one.
 */
async function staffKeyMatches(submitted: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(submitted), sha256Hex(expected)])
  return timingSafeEqualHex(a, b)
}

function readIdField(value: unknown): string | null {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return ID_PATTERN.test(trimmed) ? trimmed : null
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)
  const json = (payload: unknown, status: number) =>
    new Response(JSON.stringify(payload), {
      headers: { ...cors, 'Content-Type': 'application/json' },
      status,
    })

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405)
  }

  try {
    const staffKey = Deno.env.get('PRODUCTION_STAFF_KEY')
    const sharedSecret = Deno.env.get('DESIGNER_SHARED_SECRET')
    if (!staffKey || !sharedSecret) {
      return json({ error: 'Production link minting is not configured on the server.' }, 503)
    }

    if (isRateLimited(getClientIp(req))) {
      return json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429)
    }

    const contentLength = req.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > MAX_BODY_BYTES) {
      return json({ error: 'Request too large.' }, 413)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return json({ error: 'Invalid request body.' }, 400)
    }
    const { key, order, item } = body as Record<string, unknown>

    if (typeof key !== 'string' || !key || !(await staffKeyMatches(key, staffKey))) {
      return json({ error: 'Invalid staff key.' }, 403)
    }

    const orderId = readIdField(order)
    const itemId = readIdField(item)
    if (!orderId || !itemId) {
      return json(
        { error: 'Order and item must be 1–64 characters of letters, numbers, dots, dashes or underscores.' },
        400,
      )
    }

    // The server picks exp — a caller-chosen one would let a leaked staff key
    // mint links that never expire.
    const exp = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS
    const token = await hmacSha256Hex(sharedSecret, `${orderId}.${itemId}.${exp}`)

    return json({ order: orderId, item: itemId, exp, token }, 200)
  } catch (error) {
    return json({ error: (error as Error).message }, 500)
  }
})
