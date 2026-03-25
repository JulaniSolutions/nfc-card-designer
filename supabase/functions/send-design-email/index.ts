const appOrigin = Deno.env.get('APP_ORIGIN') || 'https://nfcdesigner.com'

const allowedOrigins = [
  appOrigin,
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
const RATE_LIMIT_MAX = 3 // max 3 emails per minute per IP (with valid CAPTCHA)
const RATE_LIMIT_MAX_UNVERIFIED = 1 // stricter limit when CAPTCHA is unavailable

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

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildHtmlEmail(designUrl: string, designName?: string): string {
  const escapedUrl = escapeHtml(designUrl)
  const nameSection = designName
    ? `<p style="margin:0 0 20px;color:#555;font-size:15px;">Design: <strong>${escapeHtml(designName)}</strong></p>`
    : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="padding:40px 32px;text-align:center;">
  <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#111;">Your NFC Card Design</h1>
  <p style="margin:0 0 24px;color:#888;font-size:14px;">Your design link is ready to view</p>
  ${nameSection}
  <a href="${escapedUrl}" style="display:inline-block;padding:12px 32px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:500;">View Design</a>
  <p style="margin:20px 0 0;font-size:12px;color:#aaa;word-break:break-all;">${escapedUrl}</p>
</td></tr>
<tr><td style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;">
  <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">This email was sent because someone shared a design link via <a href="https://nfcdesigner.com" style="color:#aaa;text-decoration:underline;">NFC Card Designer</a>.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

function buildTextEmail(designUrl: string, designName?: string): string {
  const lines = ['Your NFC card design is ready.', '']
  if (designName) lines.push(`Design: ${designName}`, '')
  lines.push(`View it here: ${designUrl}`, '', '---', 'This email was sent because someone shared a design link via NFC Card Designer.')
  return lines.join('\n')
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

    const { to_email, design_url, design_name } = body

    // Validate email
    if (!to_email || typeof to_email !== 'string' || !EMAIL_REGEX.test(to_email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email address.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Validate design URL — must match APP_ORIGIN
    if (!design_url || typeof design_url !== 'string' || !design_url.startsWith(appOrigin)) {
      return new Response(
        JSON.stringify({ error: 'Invalid design URL.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Validate design name length
    const safeName = design_name && typeof design_name === 'string'
      ? design_name.slice(0, 200)
      : undefined

    // Send via Postmark
    const postmarkToken = Deno.env.get('POSTMARK_API_TOKEN')
    const fromAddress = Deno.env.get('EMAIL_FROM_ADDRESS')
    if (!postmarkToken || !fromAddress) {
      return new Response(
        JSON.stringify({ error: 'Email service not configured.' }),
        { headers: { ...cors, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const subject = safeName
      ? `NFC Card Design: ${safeName}`
      : 'Your NFC card design link'

    const postmarkRes = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': postmarkToken,
      },
      body: JSON.stringify({
        From: `NFC Card Designer <${fromAddress}>`,
        To: to_email,
        Subject: subject,
        HtmlBody: buildHtmlEmail(design_url, safeName),
        TextBody: buildTextEmail(design_url, safeName),
        MessageStream: 'outbound',
      }),
    })

    if (!postmarkRes.ok) {
      const err = await postmarkRes.json().catch(() => ({}))
      throw new Error(err.Message || `Email delivery failed (${postmarkRes.status})`)
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...cors, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
