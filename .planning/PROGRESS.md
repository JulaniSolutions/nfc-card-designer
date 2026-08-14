# Production Export & QR Automation — Progress

Working tracker for the plans in this directory. The Fable orchestrator checks
items off as Opus 5 implementer packets land (packet IDs → PLAN-00 "Work
packets" table); deviations, discoveries, and blockers go under **Notes** so any
fresh session can resume from this file alone. Branch: `production-export`
(do not push `main` — it auto-deploys).

## Deploy checklist (human steps — Pawan)

- [ ] Generate shared secret → WP setting `designer_shared_secret` + `supabase secrets set DESIGNER_SHARED_SECRET=…`
- [ ] GCP project + OAuth client → run `scripts/get-google-refresh-token.mjs` → `supabase secrets set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN`
- [ ] `supabase functions deploy drive-upload` (and redeploy any edited functions)
- [ ] Deploy WP plugin update (version bump) to the partner portal
- [ ] Run the PLAN-04 CORS spike with real credentials; record result in PLAN-04
- [ ] Physical QR scan test: one printed sample (pvc-black, white QR) + one engraved metal sample

## Phase 1 — Print-ready export engine (PLAN-01)

- [x] **P1.a** `src/lib/custom-props.ts` — single `CUSTOM_PROPS`, consumed by save-design / DesignCanvas / export-pdf (fixes `_originalAssetUrl` clobber bug)
- [x] **P1.a** `export-pdf.ts` refactor: `buildDesignPdf()`, proof-only (production pages removed), slug filename
- [x] **P1.b** `src/lib/download.ts` — extracted `triggerBlobDownload` + zip helpers
- [x] **P1.b** `src/lib/export-print.ts` — side renderer (600 DPI, per-side engrave/print matrix, placeholder strip + geometry capture, per-card variable substitution, count rules)
- [x] **P1.b** Bundle assembly: `print/`, `source/`, `links.csv`, `preview.pdf`, naming spec, `PrintExportResult.files` for PLAN-04
- [x] **P1.c** UI: DesignPreview — "Download Preview", "Download Print Files" (+ warnings), source-files button removed; ActionBar dialog renamed
- [x] **P1.d** `supabase/functions/generate-pdf/` deleted
- [x] **P1.d** Playwright coverage per PLAN-01 testing section (`tests/print-export.spec.ts`, 6/6 green; in-page harness under `tests/helpers/` — dev-server-only, never built)
- [x] **Gate** `npm run build` + `lint` at baseline; new spec 6/6; existing suites at recorded baseline (12 pass / 4 pre-existing env failures); phase diff reviewed against PLAN-01

## Phase 2 — QR + production mode (PLAN-02)

- [x] **P2.a** `qrcode` dependency added
- [x] **P2.a** `src/lib/qr.ts` — generation at print resolution, auto-contrast via luminance sampling, colour rules, `_qrInjected` tagging (never persisted)
- [x] **P2.a** `src/lib/production-params.ts` — compact `d`/`r` + `qr=` + `production=1` forms, validation
- [x] **P2.b** `src/components/production/ProductionPanel.tsx` — paste box, counters, warnings, live back preview, Download Print Files
- [x] **P2.b** `exportPrintFiles` wired to QR assignments + `links.csv` statuses + order-based bundle naming
- [x] **P2.c** Playwright coverage per PLAN-02 testing section (`tests/production-panel.spec.ts`, 8 tests; jsQR decode of exported back files proves scannability + contrast rules)
- [x] **Gate** build/lint at baseline; print-export + production-panel specs 14/14 (verified over multiple runs); existing suites at recorded baseline; phase diff reviewed against PLAN-02

## Phase 3 — WordPress handoff (WP repo — out of scope for the cloud run)

Plan: `swft-nfc-ordering-wp/nfc-ordering/.planning/PLAN-03-wordpress-handoff.md`

- [ ] Settings: `designer_shared_secret`, `designer_app_origin` (+ `sanitize_settings` entries — wipe hazard)
- [ ] `class-nfc-ordering-production-token.php` — mint/verify
- [ ] `class-nfc-ordering-production-files.php` — button (parse design id, refs, compact deep link, disabled/hidden states, Drive status line)
- [ ] `class-nfc-ordering-rest.php` — `POST nfc-ordering/v1/production-link`, HMAC permission callback, Google-host allowlist, prepend/dedupe `_nfc_proof_links`, order note, scoped CORS, rate limit
- [ ] Bootstrap wiring + version bump (header **and** `NFC_ORDERING_VERSION`)

## Phase 4 — Google Drive (PLAN-04)

- [ ] CORS spike result recorded in PLAN-04 (needs credentials — leave **unresolved** if unavailable; transport stays behind the `uploadFile()` seam)
- [x] **P4.a** `supabase/functions/drive-upload/index.ts` — HMAC auth, token refresh, find-or-create folders, idempotent resumable sessions, house CORS/rate-limit/error patterns (deno check/lint clean; live HTTP smoke test of every auth/validation path; mocked-Google harness proved idempotent re-run, 401-refresh-retry, invalid_grant→409, quota passthrough. NOT verified: anything against real Google, `functions serve/deploy`)
- [x] **P4.b** `scripts/get-google-refresh-token.mjs` + `scripts/google-drive-setup.md` (script dry-run verified end-to-end incl. a real token-endpoint exchange with dummy creds; no real OAuth possible in this environment)
- [ ] **P4.c** `src/lib/drive.ts` + panel: "Save to Google Drive" (token-gated), sequential uploads behind single `uploadFile()` seam, progress, per-file retry, incomplete-QR confirm
- [ ] **P4.c** WP write-back call + upload-succeeded-but-writeback-failed fallback UX
- [ ] **Gate** local verification per PLAN-04 (`supabase functions serve` where possible); E2E deferred to deploy checklist

## Notes

_(append dated entries here — implementer deviations, plan gaps, spike results)_

- **2026-08-13 (orchestrator):** Baseline `npm run lint` on main already fails with
  22 errors + 1 warning (new `react-hooks` rules: `refs`/`set-state-in-effect` in
  `DesignCanvas.tsx`, `ImageUploader`, etc. — predates this work). Lint gate for
  packets is therefore **zero new problems vs the baseline snapshot**; fixing the
  pre-existing errors is out of scope (would be a drive-by refactor of files most
  packets don't own). `npm run build` is clean and stays a hard gate.
- **2026-08-13 (P1.a):** `PdfExportSnapshot` gained optional `designName?` (filename
  only; snapshot callers never fall back to the store, preserving template-export
  isolation). `save-design.ts` re-exports `CUSTOM_PROPS` so `auto-save.ts`,
  `templates.ts`, `design-method.ts` (files outside P1.a) stay untouched. The
  now-unreachable `productionMode` branches in export-pdf's proof renderers were
  left in place — the plan says keep proof pages exactly as-is. `_qrInjected` still
  to be added to `custom-props.ts` by P2.a (flagged so it isn't lost).
- **2026-08-13 (P1.b):** Deviations, all additive: `PrintExportResult.legacyPrintedMetal?`
  flag added (PLAN-01 requires it, PLAN-00's frozen shape omitted it); `PrintQrImage`
  geometry fields optional, defaulting to the captured placeholder geometry;
  `withTimeout`/`setCrossOriginOnImages` copied from `render-preview.ts` (private
  there, file outside packet); name-slug only applied to `qr-name` filenames;
  `preview.pdf` failure is a warning, not fatal; `source/` filename collisions
  de-duplicated (`-2` suffix). Two bugs found by browser smoke test and fixed:
  `loadFromJSON` clobbers a pre-set canvas background (engraved sides rendered
  black — bg now applied post-load; same latent issue exists in `export-pdf.ts`'s
  `prepareSide`, left alone, proof-only impact), and Fabric's all-or-nothing bulk
  load meant one dead asset URL rejected the whole export (now object-by-object
  retry + count warning). P2.b's QR seam: `qrImages` array at the marked line in
  `exportPrintFiles`.
- **2026-08-13 (P1.c):** Design mode passes an explicit snapshot to
  `exportPrintFiles` (shared page must never read live editor canvases), so an
  empty-named saved design falls back to `nfc-card-print-files.zip` rather than
  the design-id name — acceptable; add `designId` to `PrintExportSnapshot` later
  if it matters. Template mode keeps its "Download PDF" label per plan. Dialog
  description and failure-fallback label in ActionBar still say "PDF" (outside
  packet scope; fallback works via the refactored wrapper). Print-file warnings
  persist until the next export (no dismiss control specced).
- **2026-08-14 (P2.a):** Additive helpers beyond the frozen `qr.ts` contract:
  `resolveQrColors(engraved, luminance?)` (single home for the locked colour
  matrix), `DARK_BODY_LUMINANCE=128`, `isQrUrlOverlong`/`QR_URL_WARN_LENGTH=300`.
  `production-params.ts` also exports `parseCardUrlLines`, `isCardUrl`,
  `buildCardUrl` and re-exports export-print's `refFromCardUrl` (one ref
  implementation; note the re-export pulls fabric/jspdf into importers — fine for
  current routes). `detectQrRegionLuminance` never throws: render failures resolve
  to 255 (light ⇒ black modules); transparent pixels composite over white.
- **2026-08-14 (P2.b, orchestrator-approved deviation):** `render-preview.ts` had
  the same `loadFromJSON`-clobbers-background bug P1.b fixed in `prepareSide` —
  the shared-page preview lost the material mockup and `detectQrRegionLuminance`
  read 255 for every design, so auto-contrast always chose black modules. Fixed
  (background colour + mockup applied post-load); required by the locked "QR
  contrast: Auto" decision. `renderThumbnail` still carries the identical bug —
  left for a follow-up, out of scope. Contrast is sampled once per export, not
  per card; `links.csv` `status` now reflects whether a QR was actually injected;
  panel live preview reuses the print renderer at multiplier 1 so preview and
  supplier output cannot drift.
- **2026-08-14 (P2.c):** Supabase is stubbed at the module level (dev-server
  interception of `/src/lib/supabase.ts`), not the network level — with no `.env`
  the client is `null` at import time so there is no request to intercept; the
  stub's export surface must track `supabase.ts` if that file grows. jsQR ships
  as a UMD `addScriptTag` injection (never in the app import graph). Not covered:
  "panel never renders on `/template/:id`" — different query chain to stub; the
  guard expression is shared with the covered no-panel case. No product bugs
  found by the Phase 2 suite.
- **2026-08-14 (P4.a):** Plan-cite correction: `publish-template/index.ts:94` is
  plain SHA-256, not HMAC — no HMAC existed in the repo; the function follows its
  hex idiom with `importKey`/`sign` added. Token format assumed **64-char hex**
  (matches `production-params.ts` docs + PHP `hash_hmac` default) — cross-check
  when PLAN-03 lands in the WP repo. Additive validation beyond spec: 250-file
  cap, 200 MB/file, 1 MB body, `print`/`source` path allowlist, duplicate-name
  rejection. Subfolders created lazily. 409 body carries a human-readable
  `message` beside the frozen `error` code. Drive find-or-create is not atomic —
  concurrent first uploads for one order can duplicate a folder (accepted,
  single-operator reality). ESLint DOES lint `supabase/functions/` — relevant to
  future edge-function work. `supabase/config.toml` has no function registration
  blocks, so none was added.
- **2026-08-13 (orchestrator):** Existing Playwright baseline is NOT green in this
  environment: 4 pre-existing failures in `printed-back`/`engrave-only-metal`
  (verified identical with the P1.b diff stashed) and further env/Supabase-dependent
  failures elsewhere. Phase gates compare against this baseline rather than
  requiring an all-green suite.
- **2026-08-13 (orchestrator):** No `.env` in this environment (only `.env.example`)
  — Playwright specs needing a saved design (`/design/:id`) must stub Supabase via
  Playwright network interception; live-Supabase E2E stays manual.
