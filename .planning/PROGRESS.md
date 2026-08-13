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
- [ ] **P1.c** UI: DesignPreview — "Download Preview", "Download Print Files" (+ warnings), source-files button removed; ActionBar dialog renamed
- [ ] **P1.d** `supabase/functions/generate-pdf/` deleted
- [ ] **P1.d** Playwright coverage per PLAN-01 testing section
- [ ] **Gate** `npm run build` + `lint` + existing suites green; phase diff reviewed against PLAN-01

## Phase 2 — QR + production mode (PLAN-02)

- [ ] **P2.a** `qrcode` dependency added
- [ ] **P2.a** `src/lib/qr.ts` — generation at print resolution, auto-contrast via luminance sampling, colour rules, `_qrInjected` tagging (never persisted)
- [ ] **P2.a** `src/lib/production-params.ts` — compact `d`/`r` + `qr=` + `production=1` forms, validation
- [ ] **P2.b** `src/components/production/ProductionPanel.tsx` — paste box, counters, warnings, live back preview, Download Print Files
- [ ] **P2.b** `exportPrintFiles` wired to QR assignments + `links.csv` statuses + order-based bundle naming
- [ ] **P2.c** Playwright coverage per PLAN-02 testing section
- [ ] **Gate** build/lint/tests green; phase diff reviewed against PLAN-02

## Phase 3 — WordPress handoff (WP repo — out of scope for the cloud run)

Plan: `swft-nfc-ordering-wp/nfc-ordering/.planning/PLAN-03-wordpress-handoff.md`

- [ ] Settings: `designer_shared_secret`, `designer_app_origin` (+ `sanitize_settings` entries — wipe hazard)
- [ ] `class-nfc-ordering-production-token.php` — mint/verify
- [ ] `class-nfc-ordering-production-files.php` — button (parse design id, refs, compact deep link, disabled/hidden states, Drive status line)
- [ ] `class-nfc-ordering-rest.php` — `POST nfc-ordering/v1/production-link`, HMAC permission callback, Google-host allowlist, prepend/dedupe `_nfc_proof_links`, order note, scoped CORS, rate limit
- [ ] Bootstrap wiring + version bump (header **and** `NFC_ORDERING_VERSION`)

## Phase 4 — Google Drive (PLAN-04)

- [ ] CORS spike result recorded in PLAN-04 (needs credentials — leave **unresolved** if unavailable; transport stays behind the `uploadFile()` seam)
- [ ] **P4.a** `supabase/functions/drive-upload/index.ts` — HMAC auth, token refresh, find-or-create folders, idempotent resumable sessions, house CORS/rate-limit/error patterns
- [ ] **P4.b** `scripts/get-google-refresh-token.mjs` + `scripts/google-drive-setup.md`
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
- **2026-08-13 (orchestrator):** Existing Playwright baseline is NOT green in this
  environment: 4 pre-existing failures in `printed-back`/`engrave-only-metal`
  (verified identical with the P1.b diff stashed) and further env/Supabase-dependent
  failures elsewhere. Phase gates compare against this baseline rather than
  requiring an all-green suite.
- **2026-08-13 (orchestrator):** No `.env` in this environment (only `.env.example`)
  — Playwright specs needing a saved design (`/design/:id`) must stub Supabase via
  Playwright network interception; live-Supabase E2E stays manual.
