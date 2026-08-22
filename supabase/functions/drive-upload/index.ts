/**
 * drive-upload — mints Google Drive resumable upload sessions for a production
 * bundle (PLAN-04).
 *
 * File bytes never pass through this function: it verifies the WordPress-minted
 * token, refreshes Google access from the offline grant, finds-or-creates the
 * folder tree, and hands back one resumable session URL per file. The browser
 * then PUTs each file straight to Google, so neither the Supabase body limit nor
 * the function's wall clock ever sees a 150 MB order.
 *
 * Re-running is idempotent: a file that already exists in its target folder gets
 * an *update* session, so links stay stable and Drive never fills with `-v2`.
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

/**
 * The origin Google should pin the resumable session's CORS to — always an
 * allow-listed one, never whatever a caller claims. Forwarded as `Origin` when
 * the session is created (the mechanism the PLAN-04 spike validates).
 */
function getAppOrigin(req: Request): string {
  const origin = req.headers.get('origin') ?? ''
  return allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
}

// In-memory IP rate limiting (per edge function instance)
const ipRequests = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 20 // max 20 session mints per minute per IP

const MAX_BODY_BYTES = 1_000_000 // the body is a small JSON manifest, never bytes
const MAX_FILES = 250 // 50 cards ≈ 60 files; this is headroom, not a target
const MAX_FILE_BYTES = 200 * 1024 * 1024 // sanity bound for X-Upload-Content-Length
const MAX_FOLDER_NAME_LENGTH = 120
const MAX_FILE_NAME_LENGTH = 255

/** Bundle-relative directories the panel is allowed to write (PLAN-01 layout). */
const ALLOWED_DIRS = ['print', 'source']

const ROOT_FOLDER_NAME = 'NFC Card Production'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/** How many files to resolve in parallel — Drive is chatty (1–2 calls per file). */
const FILE_CONCURRENCY = 5

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
  // Remove entries outside the window
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) {
    ipRequests.set(ip, recent)
    return true
  }
  recent.push(now)
  ipRequests.set(ip, recent)
  return false
}

/** An error with the HTTP status (and optional machine-readable reason) to return. */
class ApiError extends Error {
  status: number
  reason?: string

  constructor(status: number, message: string, reason?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.reason = reason
  }
}

interface Secrets {
  clientId: string
  clientSecret: string
  refreshToken: string
  sharedSecret: string
}

/** Secrets are read per request — a redeploy/secret change takes effect immediately. */
function readSecrets(): Secrets | null {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const refreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN')
  const sharedSecret = Deno.env.get('DESIGNER_SHARED_SECRET')
  if (!clientId || !clientSecret || !refreshToken || !sharedSecret) return null
  return { clientId, clientSecret, refreshToken, sharedSecret }
}

// ---------------------------------------------------------------------------
// Token verification (mirrors the WordPress mint — PLAN-03 §2)
// ---------------------------------------------------------------------------

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

/** WordPress mints `hash_hmac('sha256', "{order}.{item}.{exp}", secret)` — hex. */
async function verifyToken(
  secret: string,
  order: string,
  item: string,
  exp: string,
  token: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(secret, `${order}.${item}.${exp}`)
  return timingSafeEqualHex(expected, token.toLowerCase())
}

// ---------------------------------------------------------------------------
// Request payload
// ---------------------------------------------------------------------------

interface RequestedFile {
  /** Bundle-relative path exactly as the caller asked for it, e.g. `print/back-01.png`. */
  name: string
  /** Drive file name (the last path segment). */
  baseName: string
  /** `print` | `source` | null (bundle root). */
  dir: string | null
  mime: string
  size?: number
}

const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const HEX_64_PATTERN = /^[A-Fa-f0-9]{64}$/
const MIME_PATTERN = /^[\w.+-]+\/[\w.+-]+$/
/**
 * Control characters have no place in a Drive name. Scanned rather than regexed
 * so neither `deno lint` nor the repo's ESLint config (`no-control-regex`) needs
 * an escape hatch.
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/** Reads an id-ish field that may arrive as a number (WP order/item ids are ints). */
function readIdField(value: unknown, field: string): string {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof raw !== 'string' || !ID_PATTERN.test(raw.trim())) {
    throw new ApiError(400, `Missing or malformed ${field}.`)
  }
  return raw.trim()
}

/** Mirror of the client `slugify()` — must produce the same folder-name segment. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The folder a token is allowed to write into, as the client's `bundleName()`
 * builds it: `Order-<order>[-item-<item slug>]`, optionally followed by a
 * partner slug. Binding the folder to the signed order/item is what stops a
 * token for one order from overwriting another order's print files — the
 * token proves the order, the folder name must agree with it.
 */
function requiredFolderPrefix(order: string, item: string): string {
  const itemSlug = slugify(item)
  return itemSlug ? `Order-${order}-item-${itemSlug}` : `Order-${order}`
}

function readFolderName(value: unknown, order: string, item: string): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (
    !name ||
    name.length > MAX_FOLDER_NAME_LENGTH ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    hasControlChars(name)
  ) {
    throw new ApiError(400, 'Missing or malformed folderName.')
  }
  const prefix = requiredFolderPrefix(order, item)
  if (name !== prefix && !name.startsWith(`${prefix}-`)) {
    throw new ApiError(403, 'folderName does not match the order this token was issued for.')
  }
  return name
}

/**
 * Bundle paths are one level deep at most (`links.csv`, `print/back-01.png`) and
 * only into the two known directories — anything else is a caller bug or an
 * attempt to scatter files around the Drive.
 */
function parseFiles(input: unknown): RequestedFile[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ApiError(400, 'No files requested.')
  }
  if (input.length > MAX_FILES) {
    throw new ApiError(400, `Too many files — the maximum is ${MAX_FILES}.`)
  }

  const seen = new Set<string>()
  return input.map((entry) => {
    const raw = entry as Record<string, unknown> | null
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    if (!name || name.length > MAX_FILE_NAME_LENGTH || hasControlChars(name)) {
      throw new ApiError(400, 'Missing or malformed file name.')
    }
    if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) {
      throw new ApiError(400, `Invalid file path: ${name}`)
    }

    const segments = name.split('/')
    if (segments.length > 2) {
      throw new ApiError(400, `Invalid file path: ${name}`)
    }
    const dir = segments.length === 2 ? segments[0] : null
    const baseName = segments[segments.length - 1]
    if (!baseName || (dir !== null && !ALLOWED_DIRS.includes(dir))) {
      throw new ApiError(400, `Invalid file path: ${name}`)
    }
    if (seen.has(name)) {
      throw new ApiError(400, `Duplicate file: ${name}`)
    }
    seen.add(name)

    const mimeInput = typeof raw?.mime === 'string' ? raw.mime.trim() : ''
    const mime = mimeInput && MIME_PATTERN.test(mimeInput) ? mimeInput : 'application/octet-stream'

    let size: number | undefined
    if (raw?.size !== undefined && raw?.size !== null) {
      const parsed = typeof raw.size === 'number' ? raw.size : Number(raw.size)
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_FILE_BYTES) {
        throw new ApiError(400, `Invalid size for ${name}.`)
      }
      size = parsed
    }

    return { name, baseName, dir, mime, size }
  })
}

// ---------------------------------------------------------------------------
// Google access token (offline grant)
// ---------------------------------------------------------------------------

// Module-level cache. Edge instances are ephemeral, so this is a warm-instance
// optimisation, never a correctness assumption.
let accessTokenCache: { token: string; expiry: number } | null = null
let refreshInFlight: Promise<string> | null = null

async function fetchAccessToken(secrets: Secrets): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: secrets.clientId,
      client_secret: secrets.clientSecret,
      refresh_token: secrets.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  const text = await res.text().catch(() => '')
  let data: Record<string, unknown> | null = null
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    data = null
  }

  if (!res.ok) {
    // Revoked / expired / wrong-client refresh token: no retry will fix it, a
    // human must re-run the OAuth setup script.
    if (data?.error === 'invalid_grant') {
      throw new ApiError(
        409,
        'Google Drive access has been revoked — re-run the Drive setup to issue a new refresh token.',
        'drive-reauth-required',
      )
    }
    const detail = (data?.error_description as string) || (data?.error as string) || text || String(res.status)
    throw new ApiError(502, `Google token refresh failed: ${detail}`)
  }

  const token = data?.access_token
  if (typeof token !== 'string' || !token) {
    throw new ApiError(502, 'Google token refresh returned no access token.')
  }
  const expiresIn = typeof data?.expires_in === 'number' ? data.expires_in : 3600
  // 60s safety margin so a token can't expire mid-request.
  accessTokenCache = { token, expiry: Date.now() + Math.max(0, expiresIn - 60) * 1000 }
  return token
}

async function getAccessToken(secrets: Secrets, forceRefresh = false): Promise<string> {
  if (forceRefresh) accessTokenCache = null
  const cached = accessTokenCache
  if (!forceRefresh && cached && cached.expiry > Date.now()) return cached.token

  // Collapse concurrent refreshes (files are resolved in parallel).
  if (!refreshInFlight) {
    refreshInFlight = fetchAccessToken(secrets).finally(() => {
      refreshInFlight = null
    })
  }
  return await refreshInFlight
}

// ---------------------------------------------------------------------------
// Drive helpers
// ---------------------------------------------------------------------------

/** Google API errors are surfaced verbatim (e.g. 403 storageQuotaExceeded). */
async function throwDriveError(res: Response, context: string): Promise<never> {
  const text = await res.text().catch(() => '')
  let message = text
  let reason: string | undefined
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; status?: string; errors?: { reason?: string }[] }
    }
    if (parsed?.error) {
      message = parsed.error.message || message
      reason = parsed.error.errors?.[0]?.reason || parsed.error.status
    }
  } catch {
    // Non-JSON body — keep whatever Google said.
  }
  // Pass through the statuses an operator can act on; everything else is a
  // bad gateway from the browser's point of view.
  const status = res.status === 403 || res.status === 429 || res.status === 400 ? res.status : 502
  throw new ApiError(status, `${context}: ${message || res.status}`, reason)
}

async function driveFetch(
  secrets: Secrets,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const send = async (token: string) =>
    await fetch(url, {
      method: init.method,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
      body: init.body,
    })

  let res = await send(await getAccessToken(secrets))
  if (res.status === 401) {
    // Cached token went stale (or the instance was warm across a revoke/regrant).
    await res.text().catch(() => '')
    res = await send(await getAccessToken(secrets, true))
  }
  return res
}

async function driveJson<T>(
  secrets: Secrets,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string },
  context: string,
): Promise<T> {
  const res = await driveFetch(secrets, url, init)
  if (!res.ok) await throwDriveError(res, context)
  return (await res.json()) as T
}

/** Escapes a value for a Drive `q=` search clause. */
function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function searchUrl(clauses: string[]): string {
  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name)',
    pageSize: '10',
    spaces: 'drive',
  })
  return `${DRIVE_FILES_ENDPOINT}?${params}`
}

interface FileListResponse {
  files?: { id?: string; name?: string }[]
}

async function findOrCreateFolder(
  secrets: Secrets,
  name: string,
  parentId: string | null,
): Promise<string> {
  const clauses = [
    `name = '${escapeQueryValue(name)}'`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
  ]
  if (parentId) clauses.push(`'${escapeQueryValue(parentId)}' in parents`)

  const found = await driveJson<FileListResponse>(
    secrets,
    searchUrl(clauses),
    { method: 'GET' },
    `Could not look up the "${name}" folder`,
  )
  const existingId = found.files?.[0]?.id
  if (existingId) return existingId

  const created = await driveJson<{ id?: string }>(
    secrets,
    `${DRIVE_FILES_ENDPOINT}?fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    },
    `Could not create the "${name}" folder`,
  )
  if (!created.id) throw new ApiError(502, `Google did not return an id for the "${name}" folder.`)
  return created.id
}

// The `drive.file` scope only ever sees what this app created, so the root
// folder is the single entry point. Pawan can move or rename it in Drive; we
// find it by name each cold start and cache the id per warm instance.
let rootFolderIdCache: string | null = null

async function getRootFolderId(secrets: Secrets): Promise<string> {
  if (rootFolderIdCache) return rootFolderIdCache
  rootFolderIdCache = await findOrCreateFolder(secrets, ROOT_FOLDER_NAME, null)
  return rootFolderIdCache
}

interface FolderTree {
  folderId: string
  /** Bundle directory → Drive folder id. Only the directories actually used. */
  dirs: Record<string, string>
}

async function resolveFolderTree(
  secrets: Secrets,
  folderName: string,
  dirs: string[],
): Promise<FolderTree> {
  const build = async (): Promise<FolderTree> => {
    const rootId = await getRootFolderId(secrets)
    const folderId = await findOrCreateFolder(secrets, folderName, rootId)
    const resolved: Record<string, string> = {}
    for (const dir of dirs) {
      resolved[dir] = await findOrCreateFolder(secrets, dir, folderId)
    }
    return { folderId, dirs: resolved }
  }

  const usedCache = rootFolderIdCache !== null
  try {
    return await build()
  } catch (error) {
    // A cached root id can outlive the folder (deleted or trashed by hand).
    // Drop it and rebuild from scratch once before giving up.
    if (!usedCache) throw error
    rootFolderIdCache = null
    return await build()
  }
}

/**
 * One resumable session per file. An existing file of the same name in the same
 * folder is *updated* in place, so re-running "Save to Drive" after a design
 * edit replaces content instead of piling up duplicates.
 */
async function createUploadSession(
  secrets: Secrets,
  file: RequestedFile,
  folderId: string,
  appOrigin: string,
): Promise<{ name: string; uploadUrl: string }> {
  const existing = await driveJson<FileListResponse>(
    secrets,
    searchUrl([
      `name = '${escapeQueryValue(file.baseName)}'`,
      `'${escapeQueryValue(folderId)}' in parents`,
      'trashed = false',
    ]),
    { method: 'GET' },
    `Could not look up ${file.name} in Drive`,
  )
  const existingId = existing.files?.[0]?.id

  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': file.mime,
    // Google pins the resumable session's CORS to the origin that created it —
    // forwarding the browser's app origin is what lets the browser PUT the bytes
    // directly (PLAN-04 spike; if this proves not to work, the fallback is
    // proxying bytes through this function).
    Origin: appOrigin,
  }
  if (file.size !== undefined) headers['X-Upload-Content-Length'] = String(file.size)

  const res = await driveFetch(
    secrets,
    existingId
      ? `${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(existingId)}?uploadType=resumable&fields=id`
      : `${DRIVE_UPLOAD_ENDPOINT}?uploadType=resumable&fields=id`,
    {
      method: existingId ? 'PATCH' : 'POST',
      headers,
      // Parents are fixed at create time; an update keeps the file where it is.
      body: existingId
        ? JSON.stringify({ name: file.baseName })
        : JSON.stringify({ name: file.baseName, parents: [folderId] }),
    },
  )

  if (!res.ok) await throwDriveError(res, `Could not start the upload for ${file.name}`)

  const uploadUrl = res.headers.get('location')
  await res.text().catch(() => '')
  if (!uploadUrl) {
    throw new ApiError(502, `Google did not return an upload URL for ${file.name}.`)
  }
  return { name: file.name, uploadUrl }
}

/** Runs `fn` over `items` with bounded parallelism, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  const json = (body: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(body), {
      headers: { ...cors, 'Content-Type': 'application/json' },
      status,
    })

  try {
    const secrets = readSecrets()
    if (!secrets) {
      return json({ error: 'Google Drive delivery is not configured.' }, 503)
    }

    const ip = getClientIp(req)
    if (isRateLimited(ip)) {
      return json({ error: 'Too many requests. Please try again later.' }, 429)
    }

    const contentLength = req.headers.get('content-length')
    if (contentLength && parseInt(contentLength) > MAX_BODY_BYTES) {
      return json({ error: 'Request too large.' }, 413)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return json({ error: 'Invalid request body.' }, 400)
    }

    const { order, item, exp, token, folderName, files } = body as Record<string, unknown>

    // Token required — no token, no Drive. Manual (token-less) sessions get the
    // ZIP download only, which keeps this endpoint useless to strangers.
    const orderId = readIdField(order, 'order')
    const itemId = readIdField(item, 'item')
    const expRaw = readIdField(exp, 'exp')
    const expSeconds = Number(expRaw)
    if (!Number.isInteger(expSeconds) || expSeconds <= 0) {
      return json({ error: 'Missing or malformed exp.' }, 400)
    }
    if (typeof token !== 'string' || !HEX_64_PATTERN.test(token.trim())) {
      return json({ error: 'Missing or malformed token.' }, 403)
    }
    if (expSeconds <= Math.floor(Date.now() / 1000)) {
      return json({ error: 'This production link has expired — reopen it from the order, or rebuild it on the production page.' }, 403)
    }
    if (!(await verifyToken(secrets.sharedSecret, orderId, itemId, expRaw, token.trim()))) {
      return json({ error: 'Invalid token.' }, 403)
    }

    const name = readFolderName(folderName, orderId, itemId)
    const requested = parseFiles(files)

    const usedDirs = ALLOWED_DIRS.filter((dir) => requested.some((file) => file.dir === dir))
    const tree = await resolveFolderTree(secrets, name, usedDirs)

    const appOrigin = getAppOrigin(req)
    const sessions = await mapWithConcurrency(requested, FILE_CONCURRENCY, (file) =>
      createUploadSession(
        secrets,
        file,
        file.dir ? tree.dirs[file.dir] : tree.folderId,
        appOrigin,
      ),
    )

    return json(
      {
        folderId: tree.folderId,
        folderUrl: `https://drive.google.com/drive/folders/${tree.folderId}`,
        sessions,
      },
      200,
    )
  } catch (error) {
    if (error instanceof ApiError) {
      // The panel keys its re-auth message off this exact code (PLAN-04).
      if (error.reason === 'drive-reauth-required') {
        return json({ error: 'drive-reauth-required', message: error.message }, error.status)
      }
      return json(
        { error: error.message, ...(error.reason ? { reason: error.reason } : {}) },
        error.status,
      )
    }
    return json({ error: (error as Error).message }, 500)
  }
})
