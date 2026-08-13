# Production Export & QR Automation — Progress

Working tracker for the plans in this directory. Check items off as they land;
record deviations, discoveries, and blockers under **Notes** so any fresh
session can resume from this file alone. Branch: `production-export` (do not
push `main` — it auto-deploys).

## Deploy checklist (human steps — Pawan)

- [ ] Generate shared secret → WP setting `designer_shared_secret` + `supabase secrets set DESIGNER_SHARED_SECRET=…`
- [ ] GCP project + OAuth client → run `scripts/get-google-refresh-token.mjs` → `supabase secrets set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN`
- [ ] `supabase functions deploy drive-upload` (and redeploy any edited functions)
- [ ] Deploy WP plugin update (version bump) to the partner portal
- [ ] Run the PLAN-04 CORS spike with real credentials; record result in PLAN-04
- [ ] Physical QR scan test: one printed sample (pvc-black, white QR) + one engraved metal sample

## Phase 1 — Print-ready export engine (PLAN-01)

- [ ] `src/lib/custom-props.ts` — single `CUSTOM_PROPS`, consumed by save-design / DesignCanvas / export-pdf (fixes `_originalAssetUrl` clobber bug)
- [ ] `src/lib/download.ts` — extracted `triggerBlobDownload` + zip helpers
- [ ] `src/lib/export-print.ts` — side renderer (600 DPI, per-side engrave/print matrix, placeholder strip + geometry capture, per-card variable substitution, count rules)
- [ ] Bundle assembly: `print/`, `source/`, `links.csv`, `preview.pdf`, naming spec
- [ ] `export-pdf.ts` refactor: `buildDesignPdf()`, proof-only (production pages removed), slug filename
- [ ] `supabase/functions/generate-pdf/` deleted
- [ ] UI: DesignPreview — "Download Preview", "Download Print Files" (+ warnings), source-files button removed; ActionBar dialog renamed
- [ ] Playwright coverage per PLAN-01 testing section
- [ ] `npm run build` + `lint` + existing suites green

## Phase 2 — QR + production mode (PLAN-02)

- [ ] `qrcode` dependency added
- [ ] `src/lib/qr.ts` — generation at print resolution, auto-contrast via luminance sampling, colour rules, `_qrInjected` tagging (never persisted)
- [ ] `src/lib/production-params.ts` — compact `d`/`r` + `qr=` + `production=1` forms, validation
- [ ] `src/components/production/ProductionPanel.tsx` — paste box, counters, warnings, live back preview, Download Print Files
- [ ] `exportPrintFiles` wired to QR assignments + `links.csv` statuses + order-based bundle naming
- [ ] Playwright coverage per PLAN-02 testing section

## Phase 3 — WordPress handoff (WP repo — skip if repo absent)

Plan: `swft-nfc-ordering-wp/nfc-ordering/.planning/PLAN-03-wordpress-handoff.md`

- [ ] Settings: `designer_shared_secret`, `designer_app_origin` (+ `sanitize_settings` entries — wipe hazard)
- [ ] `class-nfc-ordering-production-token.php` — mint/verify
- [ ] `class-nfc-ordering-production-files.php` — button (parse design id, refs, compact deep link, disabled/hidden states, Drive status line)
- [ ] `class-nfc-ordering-rest.php` — `POST nfc-ordering/v1/production-link`, HMAC permission callback, Google-host allowlist, prepend/dedupe `_nfc_proof_links`, order note, scoped CORS, rate limit
- [ ] Bootstrap wiring + version bump (header **and** `NFC_ORDERING_VERSION`)

## Phase 4 — Google Drive (PLAN-04)

- [ ] CORS spike result recorded in PLAN-04 (blocked without credentials — leave unresolved if so)
- [ ] `supabase/functions/drive-upload/index.ts` — HMAC auth, token refresh, find-or-create folders, idempotent resumable sessions, house CORS/rate-limit/error patterns
- [ ] `scripts/get-google-refresh-token.mjs` + `scripts/google-drive-setup.md`
- [ ] Panel: "Save to Google Drive" (token-gated), sequential uploads behind single `uploadFile()` seam, progress, per-file retry, incomplete-QR confirm
- [ ] WP write-back call + upload-succeeded-but-writeback-failed fallback UX
- [ ] Testing per PLAN-04 (local `supabase functions serve` where possible)

## Notes

_(append dated entries here)_
