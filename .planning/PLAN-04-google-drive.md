# PLAN-04 — Google Drive Delivery

**Repo:** `nfc-designer` (+ Supabase) · **Depends on:** PLAN-02 (panel, bundle),
PLAN-03 (token, REST write-back)

## Outcome

"Save to Google Drive" in the production panel uploads the print bundle as a
**real folder** (not zipped) into Pawan's My Drive, then writes the folder link
back to the WooCommerce order item. One-time Google sign-in ever; no Google
credentials in the browser.

## Architecture

```
Browser (production panel)                Supabase edge fn: drive-upload             Google
────────────────────────────             ───────────────────────────────            ──────
renders files (PLAN-01/02)
   │  POST action:init
   │  {order,item,exp,token,folderName,files[{name,mime,size}]}
   ├────────────────────────────────►  verify HMAC (DESIGNER_SHARED_SECRET)
   │                                   refresh→access token (offline grant)
   │                                   find-or-create folder tree
   │                                   per file: find existing (by name) →
   │                                     create resumable session (update|create)
   │  ◄──── {folderId, folderUrl, sessions:[{name, uploadUrl}]}
   │
   │  per file, sequential:
   │  PUT bytes → uploadUrl  ─────────────────────────────────────────────────►  googleapis.com
   │
   │  POST /wp-json/nfc-ordering/v1/production-link  {order,item,exp,token,drive_url}
   └────────────────────────────────►  WordPress (PLAN-03 §4)
```

Bytes go **browser → Google directly** via resumable-session URLs; the edge
function only mints sessions (small JSON), so Supabase body limits (house cap
5–10 MB) and function wall-clock never touch the uploads. A 50-card order
(~50–150 MB of PNGs) streams file-by-file with progress.

### ⚠️ Opening spike (30 min, do first)

Confirm browser `PUT` to a Google resumable `uploadUrl` works cross-origin
(Google is expected to allow it when the session is initiated with
`Origin: <app origin>` in the init request — the edge function must forward the
app origin as the `Origin` header when creating the session; Google then pins
CORS to it). If it fails in practice: **fallback** = proxy bytes through the
edge function one file per request (PNG ~1–3 MB each, within limits; slower,
still correct). The panel code should isolate the transport behind one
`uploadFile(session, blob, onProgress)` function so the fallback is a swap.

**RESULT — CORS: works.** Verified 2026-08-15 against real Google credentials on
the deployed app (`https://nfcdesigner.com`). The direct browser `PUT` is
allowed cross-origin exactly as predicted; the proxy fallback is **not** needed
and `uploadFile()` stays as the direct XHR `PUT` (`src/lib/drive.ts:175`).

Spike detail, for anyone re-verifying:

- Link: design `wzdaakaf` (bamboo-natural, printed, `qr-name`) opened with
  `?production=1&order=1&item=1&exp=…&token=…&qr=…`, token minted by hand with
  `openssl dgst -sha256 -hmac` over `1.1.<exp>` (WordPress not built yet).
- Panel rendered with the QR in the live back preview; "Save to Google Drive"
  reported **4 files uploaded**, all four confirmed present in
  `pawan@swftconnect.com`'s Drive: `print/front.png` (2.32 MB),
  `print/back-01-mecontact-test01.png` (2.25 MB), `links.csv` (127 B),
  `preview.pdf` (31.9 KB). Multi-MB payloads went through the direct path
  without trouble, so the Supabase body limit never becomes the ceiling.
- Root folder `NFC Card Production` was auto-created by the app on first upload,
  as the `drive.file` scope requires.
- The WordPress write-back failed as expected — a manual `qr=` link carries no
  partner domain, so `postProductionLink` threw and the panel showed the
  non-blocking "paste it into the order's proof links manually" fallback with a
  "Retry saving to order" button. Not a defect; Phase 3 is unbuilt. This path
  stays **unverified against a real WordPress endpoint** until Phase 3 ships.

## Edge function: `supabase/functions/drive-upload/index.ts`

Follow the house pattern exactly (see recon: copy the skeleton from
`upload-asset/index.ts` — allowed-origins CORS from `APP_ORIGIN`, in-memory IP
rate limit, secrets read per-request, JSON error convention, `_shared/` doesn't
exist so it's self-contained).

- **Secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REFRESH_TOKEN`, `DESIGNER_SHARED_SECRET`, existing `APP_ORIGIN`.
  Any missing → 503 (the `remove-background` precedent).
- **Auth:** recompute `HMAC-SHA256(secret, "{order_id}.{item_id}.{exp}")` via
  `crypto.subtle` (house WebCrypto style: `publish-template/index.ts:94`),
  constant-time compare, check `exp > now`. **Token required — no token, no
  Drive** (manual sessions get ZIP only; keeps the endpoint useless to
  strangers). Rate limit 20/min per IP.
- **Access token:** POST `https://oauth2.googleapis.com/token` with
  `grant_type=refresh_token`; cache module-level `{token, expiry}` (edge
  instances are ephemeral; refresh on 401 once). On `invalid_grant` → 409 with
  `error: 'drive-reauth-required'` so the panel can show the re-auth doc link.
- **Folder layout** (scope `drive.file` — the app only ever sees what it
  created, smallest possible blast radius):
  - Root: find-or-create `NFC Card Production` in My Drive (query
    `name = … and mimeType = folder and trashed = false`), cache the id in a
    module var. Pawan can move/rename it in Drive; `drive.file` retains access
    to app-created folders wherever they live.
  - Order folder: find-or-create `{folderName}` under root; subfolders
    `print/`, `source/`.
- **Idempotent re-upload:** for each requested file, `files.list` by name within
  its target folder — existing file → resumable **update** session
  (`PATCH /upload/drive/v3/files/{id}?uploadType=resumable`), else **create**
  session (`POST /upload/drive/v3/files?uploadType=resumable` with metadata
  `{name, parents:[folderId]}`). Re-running "Save to Drive" replaces content
  in place — no `-v2` clutter, links stay stable.
- Response: `{folderId, folderUrl: https://drive.google.com/drive/folders/{id},
  sessions:[{name, uploadUrl}]}`.
- Deno's `Date.now` is fine here (server code).

## One-time OAuth setup

`scripts/google-drive-setup.md` + `scripts/get-google-refresh-token.mjs`
(local Node helper, never deployed):

1. GCP project → enable Drive API → OAuth consent (internal is fine on
   Workspace) → **Web application** client with redirect
   `http://localhost:8765/callback`.
2. Run the script: opens the consent URL with
   `scope=https://www.googleapis.com/auth/drive.file&access_type=offline&prompt=consent`,
   catches the code on localhost, exchanges it, prints the refresh token.
3. `supabase secrets set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…
   GOOGLE_REFRESH_TOKEN=… DESIGNER_SHARED_SECRET=…` (same secret as the WP
   setting from PLAN-03 §1).

Sign in with the Google account that owns the target My Drive
(pawan@swftconnect.com). Document token revocation ("removed app access in
Google account settings → rerun step 2").

## Panel integration (`ProductionPanel.tsx`)

- **"Save to Google Drive"** button renders only when `order`/`item`/`token`
  params are present (PLAN-02 contract).
- Flow: build bundle files in memory (same renders as the ZIP path — share the
  file-list builder so ZIP and Drive can never diverge) → `init` call →
  sequential uploads with per-file progress ("Uploading back-03… 7/12") →
  each file retried ×2 on failure; a failed file after retries pauses with a
  "Retry remaining" button (sessions stay valid ~1 week) → on completion, POST
  the WP write-back → success state: folder link + "Saved to order ✓".
- **WP write-back failure ≠ upload failure**: the folder exists; show the link
  with a copy button and "Couldn't save to the order — paste it into the
  order's proof links manually", and keep the retry affordance. Never make the
  user re-upload because WordPress hiccuped.
- Warn-before-upload when QRs are incomplete (same warning set as ZIP, but
  uploading half-done production files to Drive is more consequential —
  require an explicit "Upload anyway" confirm in that case).
- Folder contents = ZIP contents exactly: `print/*`, `source/*`, `preview.pdf`,
  `links.csv`.

## Edge cases checklist

- [ ] Re-click after design edit → same folder, files replaced in place, WP
      note not duplicated (PLAN-03 dedupes move-to-front).
- [ ] Two admins uploading the same order concurrently → last write wins per
      file; acceptable (single-operator reality).
- [ ] `drive.file` scope means pre-existing folders Pawan made by hand are
      invisible to the app — the app-created root is the only entry point.
      Documented in the setup doc.
- [ ] Drive quota exhausted / 403 storageQuotaExceeded → surfaced verbatim in
      the panel.
- [ ] Refresh token revoked → 409 `drive-reauth-required` → panel links to the
      setup doc.
- [ ] Large `source/` originals (up to 10 MB per the upload-asset cap) are fine
      via resumable sessions; in proxy-fallback mode they're the size ceiling —
      note in the fallback code.
- [ ] Filename sanitisation for Drive: keep the PLAN-01 names (already
      slug-safe); Drive accepts near-anything, but `links.csv` references must
      match exactly.

## Testing

- Spike script result recorded in this file (CORS: works / fallback needed).
- Edge function local (`supabase functions serve`): bad token → 403; expired →
  403; valid → sessions minted against a test Drive account; re-run → same
  folder id, update sessions.
- End-to-end staging: WP order → button → panel → Drive upload → folder
  structure correct in Drive UI → proof link visible on the order → supplier
  panel prefills it.
- Panel failure drills: kill network mid-upload (retry works), revoke token
  (reauth message), block the WP endpoint (link + manual-paste fallback shown).

## Acceptance

- One click from the order screen → reviewed design → one click → files in
  Drive → link on the order, with no sign-in prompt and no local downloads.
- ZIP path continues to work identically for token-less manual sessions.
