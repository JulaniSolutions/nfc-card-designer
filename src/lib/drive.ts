/**
 * Google Drive delivery for the production bundle (PLAN-04).
 *
 * The browser never holds a Google credential. The `drive-upload` edge function
 * verifies the WordPress-minted token, finds-or-creates the order folder and
 * hands back one **resumable session URL per file**; the bytes then go straight
 * from here to Google. Afterwards the folder link is POSTed back to WordPress so
 * it lands on the order's proof links.
 *
 * Two failures that look alike to a user are kept apart on purpose: an upload
 * that stops part-way leaves a folder with some files in it and is *resumable*
 * (sessions stay valid roughly a week), while a write-back that fails has cost
 * nothing but the link — the operator pastes it into the order by hand. Neither
 * ever forces a re-upload of what already landed.
 */

import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import type { BundleFile } from '@/lib/download'

/** The one file that changes if the CORS spike fails — see `uploadFile`. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000
const INIT_TIMEOUT_MS = 60_000
const WRITE_BACK_TIMEOUT_MS = 20_000

/** Two retries per file (three attempts), with a short backoff between them. */
const UPLOAD_RETRIES = 2
const RETRY_BACKOFF_MS = [800, 2_000]

const WP_WRITE_BACK_PATH = '/wp-json/nfc-ordering/v1/production-link'

/** The re-auth code the edge function returns when the refresh token is dead. */
export const DRIVE_REAUTH_CODE = 'drive-reauth-required'

/** Where a human goes to fix a dead refresh token. */
export const DRIVE_SETUP_DOC = 'scripts/google-drive-setup.md'

function getEdgeFunctionUrl(name: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  return `${supabaseUrl}/functions/v1/${name}`
}

/** An error carrying the edge function's status so the panel can react to it. */
export class DriveError extends Error {
  status: number
  /** Machine-readable code when the function sent one (e.g. `drive-reauth-required`). */
  code?: string

  constructor(message: string, status = 0, code?: string) {
    super(message)
    this.name = 'DriveError'
    this.status = status
    this.code = code
  }

  /** The refresh token was revoked — no retry helps, the setup script must re-run. */
  get reauthRequired(): boolean {
    return this.code === DRIVE_REAUTH_CODE
  }
}

// ---------------------------------------------------------------------------
// Edge function: mint sessions
// ---------------------------------------------------------------------------

export interface DriveSession {
  /** Bundle-relative path, exactly as it was requested (`print/back-01.png`). */
  name: string
  uploadUrl: string
}

export interface DriveInitResult {
  folderId: string
  folderUrl: string
  sessions: DriveSession[]
}

/** Order context from the deep link. `token`/`exp` are opaque — relayed, never read. */
export interface DriveOrderContext {
  order: string
  item: string
  exp?: number
  token: string
  /** The white-label domain from `d` — the only origin the WP write-back can use. */
  wpDomain?: string
}

/**
 * Ask the edge function for a folder and one upload session per file.
 *
 * Idempotent server-side: a second call for the same order returns the same
 * folder and *update* sessions for files already there, which is what makes
 * "Retry remaining" safe to implement as a re-init over the leftovers.
 */
export async function initDriveUpload(
  context: DriveOrderContext,
  folderName: string,
  files: BundleFile[],
): Promise<DriveInitResult> {
  let res: Response
  try {
    res = await fetchWithTimeout(
      getEdgeFunctionUrl('drive-upload'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          order: context.order,
          item: context.item,
          exp: context.exp,
          token: context.token,
          folderName,
          files: files.map((file) => ({
            name: file.path,
            mime: file.blob.type,
            size: file.blob.size,
          })),
        }),
      },
      INIT_TIMEOUT_MS,
    )
  } catch (err) {
    throw new DriveError(err instanceof Error ? err.message : 'Could not reach Google Drive.')
  }

  const body = (await res.json().catch(() => null)) as
    | { error?: string; message?: string; reason?: string; folderId?: string; folderUrl?: string; sessions?: DriveSession[] }
    | null

  if (!res.ok) {
    // 409 `drive-reauth-required` carries a human-readable `message` beside the
    // code; every other status puts its explanation in `error`.
    if (body?.error === DRIVE_REAUTH_CODE) {
      throw new DriveError(
        body.message || 'Google Drive access has been revoked.',
        res.status,
        DRIVE_REAUTH_CODE,
      )
    }
    throw new DriveError(
      body?.error || body?.message || `Google Drive upload failed (${res.status})`,
      res.status,
      body?.reason,
    )
  }

  if (!body?.folderId || !body?.folderUrl || !Array.isArray(body.sessions)) {
    throw new DriveError('Google Drive returned an unexpected response.', res.status)
  }
  return { folderId: body.folderId, folderUrl: body.folderUrl, sessions: body.sessions }
}

// ---------------------------------------------------------------------------
// The transport seam
// ---------------------------------------------------------------------------

/**
 * **The single transport seam.** Sends one file's bytes to Google.
 *
 * A resumable session accepts the whole file in one `PUT` when the body is the
 * complete content, which is all this needs — the session exists for the CORS
 * grant and the retry window, not for chunking. XHR rather than `fetch` because
 * only XHR reports *upload* progress in browsers.
 *
 * If the PLAN-04 CORS spike fails with real credentials (browser `PUT` to
 * `uploadUrl` blocked cross-origin), **this function is the only thing that
 * changes**: swap the direct `PUT` for a POST of the same bytes to the
 * `drive-upload` edge function acting as a proxy, one file per request, and
 * everything above and below keeps working unchanged. In that mode the Supabase
 * body limit becomes the ceiling, so `source/` originals (up to 10 MB) are the
 * files to watch.
 */
export function uploadFile(
  session: DriveSession,
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', session.uploadUrl, true)
    xhr.timeout = UPLOAD_TIMEOUT_MS
    if (blob.type) xhr.setRequestHeader('Content-Type', blob.type)

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total))
      }
    }
    xhr.onload = () => {
      // A completed resumable upload answers 200/201. A 308 means Google is
      // still waiting for bytes — treat it as a failure so the retry resends.
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1)
        resolve()
      } else {
        reject(new Error(`Google rejected ${session.name} (${xhr.status}).`))
      }
    }
    xhr.onerror = () => reject(new Error(`The connection to Google dropped while sending ${session.name}.`))
    xhr.ontimeout = () => reject(new Error(`Sending ${session.name} to Google timed out.`))
    xhr.onabort = () => reject(new Error(`Sending ${session.name} was cancelled.`))

    xhr.send(blob)
  })
}

// ---------------------------------------------------------------------------
// Sequential upload driver
// ---------------------------------------------------------------------------

export interface DriveUploadProgress {
  /** Bundle-relative path of the file in flight. */
  name: string
  /** 1-based position in this run. */
  index: number
  total: number
  /** 0–1 for the current file. */
  fraction: number
}

export interface DriveUploadOutcome {
  uploaded: string[]
  /** Everything that did not land — the failed file first. Empty ⇒ complete. */
  remaining: string[]
  /** Why the run stopped, if it did. */
  error?: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Upload one file at a time, each retried twice before the run pauses.
 *
 * Sequential on purpose: an order can be 150 MB and the operator wants to see
 * which file is moving. Stopping at the first hard failure (rather than pushing
 * on) keeps the folder's state easy to describe — everything before the failure
 * is in Drive, everything from it onwards is `remaining`, and the sessions for
 * those stay valid long enough to just click again.
 */
export async function uploadFiles(
  sessions: DriveSession[],
  blobs: Map<string, Blob>,
  onProgress?: (progress: DriveUploadProgress) => void,
): Promise<DriveUploadOutcome> {
  const uploaded: string[] = []
  const total = sessions.length

  for (const [position, session] of sessions.entries()) {
    const blob = blobs.get(session.name)
    if (!blob) {
      return {
        uploaded,
        remaining: sessions.slice(position).map((s) => s.name),
        error: `${session.name} is missing from the generated files.`,
      }
    }

    const index = position + 1
    onProgress?.({ name: session.name, index, total, fraction: 0 })

    let lastError: unknown
    for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 2_000)
      try {
        await uploadFile(session, blob, (fraction) =>
          onProgress?.({ name: session.name, index, total, fraction }),
        )
        lastError = undefined
        break
      } catch (err) {
        lastError = err
      }
    }

    if (lastError) {
      return {
        uploaded,
        remaining: sessions.slice(position).map((s) => s.name),
        error: lastError instanceof Error ? lastError.message : `Could not upload ${session.name}.`,
      }
    }
    uploaded.push(session.name)
  }

  return { uploaded, remaining: [] }
}

// ---------------------------------------------------------------------------
// WordPress write-back
// ---------------------------------------------------------------------------

/**
 * Tell WordPress where the files went, so the link is prepended to the order
 * item's proof links (and the supplier send picks it up as `design_url`).
 *
 * Throws on any failure — the caller keeps that apart from an upload failure,
 * because the files are already safely in Drive by this point.
 */
export async function postProductionLink(
  wpDomain: string | undefined,
  payload: { order: string; item: string; exp?: number; token: string; drive_url: string },
): Promise<void> {
  if (!wpDomain) {
    throw new Error('This link carries no partner domain, so the order could not be updated.')
  }

  let res: Response
  try {
    res = await fetchWithTimeout(
      `${wpDomain.replace(/\/+$/, '')}${WP_WRITE_BACK_PATH}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      WRITE_BACK_TIMEOUT_MS,
    )
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Could not reach the order site.')
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new Error(body?.message || body?.error || `The order site returned ${res.status}.`)
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type DriveWriteBackStatus = 'ok' | 'failed' | 'skipped'

export interface DriveSaveResult {
  folderId: string
  folderUrl: string
  uploaded: string[]
  /** Files still to send. Empty ⇒ the bundle is complete in Drive. */
  remaining: string[]
  /** Why the upload paused, if it did. */
  uploadError?: string
  /** `skipped` ⇒ the upload never completed, so nothing was claimed to the order. */
  writeBack: DriveWriteBackStatus
  writeBackError?: string
}

export interface DriveSaveRequest {
  context: DriveOrderContext
  /** Drive folder name — `Order-<order>-<partner>`, the ZIP's bundle name. */
  folderName: string
  /** The bundle exactly as the ZIP path built it. */
  files: BundleFile[]
  /** Restrict the run to these bundle paths (resuming a paused upload). */
  only?: string[]
  onProgress?: (progress: DriveUploadProgress) => void
}

/**
 * Init → sequential uploads → write-back, with the two failure modes reported
 * separately in the result rather than as one thrown error. Only a failure to
 * *start* throws: at that point there is no folder and nothing to tell the
 * operator except what went wrong.
 */
export async function saveBundleToDrive(request: DriveSaveRequest): Promise<DriveSaveResult> {
  const { context, folderName, files, only, onProgress } = request
  const wanted = only ? files.filter((file) => only.includes(file.path)) : files

  if (wanted.length === 0) {
    throw new DriveError('There are no files to upload.')
  }

  const init = await initDriveUpload(context, folderName, wanted)

  const blobs = new Map(wanted.map((file) => [file.path, file.blob]))
  const outcome = await uploadFiles(init.sessions, blobs, onProgress)

  const base = {
    folderId: init.folderId,
    folderUrl: init.folderUrl,
    uploaded: outcome.uploaded,
    remaining: outcome.remaining,
  }

  // A half-uploaded folder is not a proof link — don't put it on the order.
  if (outcome.remaining.length > 0) {
    return { ...base, uploadError: outcome.error, writeBack: 'skipped' }
  }

  try {
    await postProductionLink(context.wpDomain, {
      order: context.order,
      item: context.item,
      exp: context.exp,
      token: context.token,
      drive_url: init.folderUrl,
    })
    return { ...base, writeBack: 'ok' }
  } catch (err) {
    return {
      ...base,
      writeBack: 'failed',
      writeBackError: err instanceof Error ? err.message : 'The order could not be updated.',
    }
  }
}
