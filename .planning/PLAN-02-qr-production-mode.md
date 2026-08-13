# PLAN-02 — QR Generation & Production Mode

**Repo:** `nfc-designer` · **Depends on:** PLAN-01 · **Unblocks:** PLAN-03 usage, PLAN-04

## Outcome

The shared design page grows a hidden production panel: paste card URLs (or
arrive with them pre-filled from WordPress), see real QR codes drop into the
placeholder's exact position on a live preview, download print files with QRs
embedded. Customers never see any of it.

## QR generation: `src/lib/qr.ts`

- New dependency: **`qrcode`** (npm, ~10 kB gzipped, canvas/dataURL output, no
  DOM framework coupling). Nothing QR-related exists in the repo today.
- `generateQrImage(url, { sizePx, dark, light }) → dataUrl` using
  `QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: sizePx,
  color: { dark, light } })`.
  - `margin: 2` modules of quiet zone *inside* the placeholder box (the box is
    the QR's total footprint — ~20 mm at default size, `QR_SIZE = 236` px).
  - Render at the **final print resolution**: `sizePx = placeholderSize ×
    exportMultiplier` (i.e. ≥ 472 px at multiplier 2) so modules are crisp, then
    inject scaled to placeholder geometry.
- **Colour rules:**
  - Engraved back (production JPEG): always `dark: '#000000', light: '#FFFFFF'`.
  - Printed back (PNG): auto-contrast — `dark: '#000000', light: '#0000'`
    (transparent gaps) on light card bodies; `dark: '#FFFFFF', light: '#0000'`
    on dark bodies.
- **Auto-contrast detection** (`detectQrRegionLuminance`): render the back via
  the existing `renderCanvasToImage` (`render-preview.ts:31` — includes the
  material mockup image, so pvc-black/metal read as dark even though bg colour
  is `#ffffff`), draw to an offscreen 2D canvas, average the luminance
  (`0.299R+0.587G+0.114B`) over the placeholder rect. `< 128` → dark body →
  white QR. This also handles a user-placed image behind the QR area.
- **Never persist**: injected QR objects are tagged `_qrInjected: true`, created
  only on offscreen render canvases (print export + panel preview). They are
  never added to `window.__fabricCanvasBack`, never serialised to the store, and
  never reach Supabase. (Also: they're plain `FabricImage`s, so the ghost
  sweeper in `back-card.ts:115` — which matches dashed rects and label text —
  cannot mistake them for placeholders even if one leaked.)

## Placeholder geometry

From PLAN-01's extractor: group `left`/`top` (centre origin), effective size
`= rect.width × group.scaleX` (`minScaleLimit: 1`, uniform corner scaling only,
so ≥ 236 px). Warnings surfaced in the panel:
- Placeholder partially outside the card bounds → "QR will be clipped — edit the
  design to reposition it".
- No placeholder found (ancient design) → default position used, flagged.

## URL parameters: `src/lib/production-params.ts`

Parsed from `useSearchParams` on `SharedDesignPage`. Two mutually compatible
forms:

```
Compact (built by WordPress — PLAN-03):
  ?d=https%3A%2F%2Fapp.partner.com&r=ab12cd,ef34gh,...   → urls = d + '/r/' + ref
  &order=1234&item=567&partner=acme-agency
  &exp=1765000000&token=<hmac hex>

Manual / generic:
  ?qr=<encoded url>&qr=<encoded url>...
  ?production=1                       → empty panel, paste by hand
```

- Compact form mirrors `build_card_url` exactly
  (`class-nfc-ordering-ref-pool-db.php:427`: `normalize_domain(d) + '/r/' +
  rawurlencode(ref)`). 50 refs ≈ 500 chars — no URL-length risk (vs ~2.3 kB for
  50 full `qr=` params, still fine but ugly).
- `order`, `item`, `partner` feed bundle naming and the write-back call.
  `token`/`exp` are opaque here — the app never validates them (it has no
  secret); it just relays them to the Drive function / WP endpoint (PLAN-04).
- Presence of any of `d`, `qr`, `production` activates the panel. Template
  routes and the editor never read these params.
- Validation: each resulting URL must parse as http(s) `URL`; invalid lines are
  flagged per-row, not silently dropped.

## Production panel: `src/components/production/ProductionPanel.tsx`

Rendered by `DesignPreview` (design mode only) above the action buttons when
production params are present. Visual: bordered card, `Wrench`/`QrCode` icon,
"Production" heading — clearly staff-facing, but harmless if a customer ever
lands on a production link.

Contents:
- **Context line** when order params exist: "Order #1234 · acme-agency · 10 QR
  codes supplied".
- **URL textarea** (one per line, card order) — pre-filled from params, editable.
  Placeholder text: `https://app.partner.com/r/ab12cd`.
- **Assignment status**: "7 of 10 cards have a QR" + per-row validity marks; the
  mismatch warnings from PLAN-01's count rules (fewer/more QRs than cards,
  `qr-only` multi-QR explanation).
- **Live preview**: re-render the back card image with card 1's QR injected
  (front never changes). Debounce re-renders (500 ms) — each is a full offscreen
  Fabric load.
- **Legacy printed-metal banner** when applicable (`LEGACY_PRINTED_METAL_NOTICE`).
- **Actions**: "Download Print Files" (always; warns when QRs are missing) and —
  from PLAN-04 — "Save to Google Drive" (only when a token is present).

State is component-local + derived from params. **No Zustand writes** — the
production panel must never dirty the design store (the same isolation reasoning
as template snapshots, `DesignPreview.tsx:65-80`).

## Integration with print export

`exportPrintFiles(snapshot, { cardUrls, orderRef })` (PLAN-01's entry point):
- Per back render *i*: generate the QR for `cardUrls[i]` at print resolution
  with the side-appropriate colour rule, inject at placeholder geometry.
- `links.csv` gains real `card_url` + `ref` values and per-card `status`.
- Bundle name uses `orderRef` when present.

## Edge cases checklist

- [ ] Duplicate URLs pasted → warning ("two cards share a QR — refs must be
      unique per card") but not blocked; WP-built links can't hit this.
- [ ] Whitespace/empty lines in textarea → filtered before pairing.
- [ ] `qr-only` with 10 URLs → 10 back files from one design row (rule table in
      PLAN-01).
- [ ] User clicks "Edit Design" from a production link → editor opens as today;
      params stay in the URL, panel returns when they come back to preview.
      Injected QRs never touch the editor canvas.
- [ ] Design edited & re-saved after files were generated → next click of the WP
      button regenerates from current state; Drive re-upload replaces files
      (PLAN-04 idempotency). No staleness tracking needed.
- [ ] Ref extraction for filenames: last path segment of each URL; arbitrary
      manual URLs without a path → ref omitted from filename, still listed in
      `links.csv`.
- [ ] Very long URLs (>200 chars) still QR-encode fine at EC level M within a
      20 mm module budget; warn above 300 chars (scan reliability).
- [ ] Panel never renders on `/template/:id` or for unsaved designs.

## Testing

- Playwright: open a seeded design at
  `/design/:id?d=https%3A%2F%2Fexample.com&r=aaa111,bbb222&order=99&partner=test`
  → panel visible with 2 pre-filled URLs; download → ZIP back files contain QR
  pixels at placeholder location (sample the region, assert non-uniform);
  `links.csv` rows carry the URLs. Same design without params → no panel.
- QR correctness: decode the generated QR data URL in-test (jsQR dev-dep or
  round-trip via the `qrcode` lib's own decode absence — simplest: assert the
  encoded string via a known-vector snapshot at fixed size).
- Contrast: pvc-black design → white-module QR (sample pixel colours);
  pvc-white → black modules; full-metal production JPEG → black modules on
  white regardless.

## Acceptance

- Manual flow: paste URLs on any saved design → correct per-card QRs in the
  bundle, live preview shows the QR, zero writes to Supabase.
- Param flow: a hand-built compact URL pre-fills everything.
- Customers on a plain `/design/:id` link see no trace of any of it.
