# Production Export & QR Automation — Master Plan

**Status:** Approved for build — 2026-08-14
**Repos:** `nfc-designer` (this repo) + `swft-nfc-ordering-wp/nfc-ordering` (WordPress plugin)

## Goal

Make the NFC card designer production-ready end to end: real QR codes instead of a
placeholder the designer removes in Illustrator, print-ready files per material,
one-click handoff from the WooCommerce order screen, and delivery into Google Drive
with the folder link flowing back to the order (where the supplier send already
picks it up as `design_url`).

## Locked decisions (agreed with Pawan, 2026-08-13/14)

| Decision | Choice |
|---|---|
| QR per card | **One unique QR per card** — matches the WP ref pool (`card_number` 1..N per order item, `get_refs_by_item` returns them ordered) |
| Ref ↔ card pairing | **By index** (card row 1 ↔ card_number 1). Refs are blank until activated, so pairing is arbitrary; what matters is the printed QR and the NFC chip on the *same* card match. Ref goes into every back filename + `links.csv` so the supplier can encode chips to match |
| Production UI visibility | **Hidden** — the shared design page stays clean for customers; a production panel appears only when URL params are present |
| QR state | **Stateless** — nothing saved to Supabase. The WP-built link (or manual paste) *is* the state; WordPress ref pool remains the single source of truth |
| Print resolution | **600 DPI** (Fabric `multiplier: 2` → 2024×1276 px; canvas is natively ~300 DPI at 1012×638 for 85.6×54 mm). No bleed — matches current accepted practice |
| Printed sides | **Transparent PNG**, full colour |
| Engraved sides | **JPEG, white background, black artwork** (same conversion the PDF production pages use today) |
| QR contrast | **Auto** — sample the rendered back under the placeholder; dark region → white QR modules, light → black. Engraved production JPEGs always black-on-white |
| Print files without QR | **Allowed, with a clear warning** (placeholder omitted from output) |
| Public "Download Source Files" button | **Removed** — originals ship inside the print bundle instead |
| Preview PDF | Rename button to **"Download Preview"**; PDF becomes proof-only (production pages move to print files) |
| Google Drive | **Pawan's My Drive**, one-time OAuth (refresh token held server-side in a Supabase edge function — no repeat sign-ins, no Google creds in the browser) |
| Drive folder naming | `Order-<order#>-<partner-slug>/` (fallback: design slug when opened without an order context), containing `print/`, `source/`, `preview.pdf`, `links.csv` — real folder, not zipped |

## The per-side format matrix

`design_method` describes the front; engraving is **per side** via `isSideEngraved()`
(`src/config/materials.ts:220`). Never branch on `designMethod === 'engraved'` alone.

| Material | Front file | Back files (one per card) |
|---|---|---|
| plastic (pvc-white, pvc-black), bamboo | `front.png` (transparent) | `back-NN-….png` (transparent) |
| metal — Full Metal (all 3 variations) | `front.jpg` (white bg, black art) | `back-NN-….jpg` (white bg, black art) |
| hybrid-metal, 24k-gold | `front.jpg` (white bg, black art) | `back-NN-….png` (transparent, full colour) |
| **Legacy printed metal** (`design_method='printed'` + metal material) | treat all sides as printed (PNG) + warning banner — mirrors `export-pdf.ts:275`'s "export as ordered" rule | |

## Phases

Each phase ships independently and is useful on its own.

1. **[PLAN-01](PLAN-01-print-engine.md) — Print-ready export engine** (designer repo).
   High-res PNG/JPEG renderer, ZIP bundle with sources + manifest, proof-only PDF,
   button renames, plus three housekeeping fixes found during recon.
2. **[PLAN-02](PLAN-02-qr-production-mode.md) — QR generation + production mode** (designer repo).
   Client-side QR at the placeholder's exact geometry, hidden production panel on
   `/design/:id`, URL-parameter prefill, manual paste fallback.
3. **PLAN-03 — WordPress handoff** (lives in the WP repo:
   `swft-nfc-ordering-wp/nfc-ordering/.planning/PLAN-03-wordpress-handoff.md`).
   "Production files" button per order line item; REST write-back endpoint for the
   Drive folder link; shared-secret settings.
4. **[PLAN-04](PLAN-04-google-drive.md) — Google Drive delivery** (designer repo + Supabase).
   `drive-upload` edge function holding the refresh token, browser uploads via
   resumable sessions, write-back to WP, one-time OAuth setup.

**Dependency order:** 1 → 2 → 3 → 4. Phase 2 is usable manually before Phase 3
exists (paste URLs by hand). Phase 4 needs Phase 3's token + REST endpoint.

## End-to-end flow once all phases ship

```
Customer designs card ──► saves ──► pastes share link into WooCommerce order form
                                          │
Order placed ──► ref pool auto-assigns refs (card_number 1..N per item)
                                          │
Admin opens order ──► clicks "Production files" on the line item
                                          │
  designer app opens /design/:id?d=<domain>&r=<refs>&order=…&item=…&token=…
                                          │
  production panel: QRs pre-applied at placeholder position, per card
                                          │
       ┌──────────────────┴──────────────────┐
  Download Print Files (ZIP)        Save to Google Drive
                                          │
                        Drive folder created; link POSTed back to
                        WP REST endpoint → prepended to _nfc_proof_links
                                          │
                        Supplier panel prefills design_url from that link
                        (class-nfc-ordering-supplier-order.php:639 — first
                         link of the first NFC item wins)
```

## Cross-cutting constraints (verified against code)

- **`CUSTOM_PROPS` is triplicated** (`save-design.ts:9`, `DesignCanvas.tsx:33`,
  `export-pdf.ts:8`) and `export-pdf.ts`'s copy is missing `_originalAssetUrl` —
  clicking Download PDF in the editor re-serialises the store *without* it, so a
  subsequent save silently drops the original-asset link. Phase 1 consolidates
  into one module and fixes this.
- **Material mockup images are not in the canvas JSON** — they're applied at
  runtime (`DesignCanvas.tsx:274`, `render-preview.ts:50`). An offscreen render
  from stored JSON is therefore naturally free of the card-body artwork: exactly
  what a transparent print PNG needs.
- **Background colours are effectively always `#ffffff`** — no UI calls
  `setBgColor` (only draft-restore does). Rule anyway: bg `#ffffff` → transparent;
  any other value → paint it edge-to-edge and surface a warning (defensive for
  old/hand-edited rows).
- **Do NOT swap `_originalAssetUrl` into image objects for extra resolution.**
  Originals predate background removal and cropping (`_originalSrc` marks edited
  objects); swapping would resurrect removed backgrounds. Render the whole canvas
  at `multiplier: 2` instead — compressed assets are ≤4 MB WebP q0.92 at native
  scale, ample for 600 DPI. (Future enhancement, out of scope: swap only for
  provably unedited objects.)
- **Fonts are system fonts only** (`src/lib/fonts.ts`) — raster export is
  WYSIWYG. This *fixes* fidelity vs the current PDF, which substitutes everything
  with Helvetica/Times (`export-pdf.ts:34`).
- **Ghost-placeholder sweeper** (`back-card.ts:115`) matches by shape (dashed
  transparent rects, known label strings). Injected QR images must be tagged
  `_qrInjected`, must never be persisted to store/Supabase, and must not
  resemble the placeholder shapes.
- **Quantity:** UI caps at 50 (`BackCardOptions.tsx:108`); store/DB have no cap.
  `qr-only` designs are always quantity 1 in the designer, but the Woo item
  quantity can be N — **the QR URL count drives the back-file count** (see PLAN-01
  count rules).
- **WP meta key reality check:** the white-label domain lives in order meta
  `_billing_white_label_domain` (not `_nfc_white_label_domain` as older docs say).
  Card URLs are `normalize_domain(domain) + '/r/' + rawurlencode(ref)`
  (`class-nfc-ordering-ref-pool-db.php:427`).
- **Security model:** one shared secret, configured in WP settings
  (`designer_shared_secret`) and mirrored as a Supabase secret
  (`DESIGNER_SHARED_SECRET`). WP mints `token = HMAC-SHA256(secret,
  "{order_id}.{item_id}.{exp}")` into the deep link; both the WP REST write-back
  and the Drive edge function verify it. The token authorises exactly two things
  for one order item: uploading production files to Drive and writing a proof
  link back. Manual (token-less) sessions get ZIP download only.
- **Corner radius** is CSS-only (`CARD_CORNER_RADIUS`, applied via style) — print
  files are square-cornered rasters; the supplier die-cuts. Expected; not a bug.

## Risks & spikes

| Risk | Mitigation |
|---|---|
| Google resumable-upload CORS from the browser | Phase 4 opens with a 30-min spike; fallback design (proxy bytes through the edge function per file) is specced |
| Inverted QR (white-on-dark, engraved metal) scannability | Already today's manual practice; `links.csv` gives the supplier the raw URL as a cross-check. Test one physical sample per material before relying on it |
| Deep link length at 50 cards | Compact `?d=<domain>&r=ref1,ref2,…` form (~500 chars at 50 refs) instead of 50 full URLs |
| Edge-function body limits for uploads | Files upload individually via resumable sessions direct to Google; the function only mints sessions (small JSON) |
| WP `sanitize_settings()` rebuilds the option from scratch | Any new settings key **must** be added to `sanitize_settings()` or it is wiped on every settings save (`class-nfc-ordering-settings.php:687`) |

## Autonomous execution notes (for a cloud/overnight run with no prior context)

These five plan files + `CLAUDE.md` are the complete spec — no conversation
context is required. Decisions in the table above are **final**; do not re-ask
or re-litigate them.

**Work on a feature branch** (e.g. `production-export`), not `main` — pushing
`main` auto-deploys to production Vercel. Open a PR when a phase is complete.
Commit style per repo history: conventional lowercase prefixes
(`feat:`, `fix:`, `chore:`, `copy:`).

**Track progress in [PROGRESS.md](PROGRESS.md)** — check items off and note
deviations/discoveries there as you go, so any later session (or human) can
resume without this file drifting from reality.

What's buildable without Pawan present:

| Phase | Build | Verify | Blocked on Pawan |
|---|---|---|---|
| 1 — print engine | ✅ fully | ✅ Playwright + `npm run build` / `lint` | nothing |
| 2 — QR + panel | ✅ fully (add `qrcode` dep) | ✅ Playwright with hand-built param URLs | nothing |
| 3 — WordPress | only if the WP repo (`swft-nfc-ordering-wp/nfc-ordering`) is present in the environment — **skip entirely if it isn't**; phases 1/2/4 have no runtime dependency on it | manual/WP-CLI | secret generation, staging deploy |
| 4 — Drive | ✅ edge function + panel code + setup script/doc | ❌ E2E needs Google credentials & `supabase secrets` — leave the CORS spike marked **unresolved** in PLAN-04 and keep the upload transport behind the single `uploadFile()` seam so the proxy fallback is a swap | GCP project, OAuth run, secret setting, `supabase functions deploy` |

Do **not** run `supabase functions deploy` or set secrets unless credentials
are available in the environment; instead leave a deploy checklist at the top
of PROGRESS.md. Never commit `.env` (repo rule). Verification commands:
`npm run build`, `npm run lint`, `npx playwright test` (dev server:
`npm run dev`, port 5173).

## Out of scope (this round)

- Fully server-side rendering (no-browser generation) — revisit inside SWFT Connect.
- Bleed / CMYK / ICC colour profiles — current RGB output is accepted by the supplier.
- Persisting QR assignments in Supabase.
- Supplier API changes — the Drive link flows through the existing proof-links mechanism.
