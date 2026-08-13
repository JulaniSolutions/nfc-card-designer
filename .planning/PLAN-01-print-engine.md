# PLAN-01 — Print-Ready Export Engine

**Repo:** `nfc-designer` · **Depends on:** nothing · **Unblocks:** PLAN-02, PLAN-04

## Outcome

A "Download Print Files" action that produces a ZIP the supplier can use directly:
high-res per-side rasters following the per-side engrave/print matrix, one back
file per card, original source uploads, a `links.csv` manifest, and the proof PDF.
The existing PDF becomes a proof-only "Download Preview".

## New module: `src/lib/export-print.ts`

### Core renderer

`renderSideToBlob(opts)` — offscreen Fabric render of one side. Reuse the
`prepareSide` pattern from `export-pdf.ts:194` (append temp `<canvas>` to body,
`loadFromJSON`, cleanup in `finally`), with these differences:

- **Multiplier 2** → 2024×1276 px (600 DPI at 85.6×54 mm). One whole-canvas
  `toDataURL`, *not* the current per-object `multiplier: 1` compositing — this is
  the single biggest quality fix.
- Force `crossOrigin: 'anonymous'` on all image descriptors before load (reuse
  `setCrossOriginOnImages` from `render-preview.ts:17`, which recurses into
  groups) or `toDataURL` throws on a tainted canvas.
- Await `document.fonts.ready` before rendering (belt-and-braces; fonts are
  system-only per `src/lib/fonts.ts`).
- **Never load the material mockup image** (it isn't in the JSON anyway — see
  overview) and **never** set a background colour in printed/transparent mode.

**Printed side (`isSideEngraved(...) === false`):**
- Canvas background: transparent when the stored bg colour is `#ffffff`
  (case-insensitive; also treat `#fff`); otherwise set it as a real background
  colour (prints edge-to-edge) and return a `bgColorWarning` for the UI.
- Remove the QR placeholder group (see "Placeholder handling" below); inject the
  per-card QR image if provided (PLAN-02 supplies it; Phase 1 ships with
  injection support but no generator yet — `qrImage?: { dataUrl, left, top,
  width, height }` in the options).
- Export `format: 'png'`.

**Engraved side (`isSideEngraved(...) === true` **and** stored
`designMethod === 'engraved'` — same legacy gate as `export-pdf.ts:275`):**
- White background, then force every object dark, mirroring
  `export-pdf.ts:148-169`:
  - `FabricImage` → temporarily swap filters to
    `[Grayscale, BlendColor('#000000', tint, 1)]`, `applyFilters()`, restore after.
    Note the live JSON already carries a *coloured* tint (e.g. `#C0C0C0` for
    black steel — `engraved-filters.ts:10`), so the override is mandatory, not
    optional.
  - `Textbox`/`IText` → `fill: '#000000'` (restore after).
  - Any other object type (defensive; toolbar only creates text + images today)
    → override `fill`/`stroke` to black where set.
- QR (when provided) injected as pure black modules on white.
- Export `format: 'jpeg', quality: 0.92`.

**Legacy printed metal** (`designMethod === 'printed'` && `isFrontEngraved`):
all sides take the *printed* path (transparent PNG) and the export result carries
a `legacyPrintedMetal` flag so the UI can show the existing
`LEGACY_PRINTED_METAL_NOTICE` (`design-method.ts:8`).

### Placeholder handling

Strip the QR placeholder from every print render:
- Tagged form: group with `_qrPlaceholderBorder` (`back-card.ts:190`).
- Ghost forms (tags lost in old serialisations): reuse the same shape-matching
  rules as `removeAllPlaceholders` (`back-card.ts:115-138`) — transparent dashed
  `Rect`s, the known label strings, groups containing a matching rect. Extract
  that matcher into a shared helper rather than duplicating it.
- Record the placeholder's geometry **before** removing it (`left`, `top`,
  effective size = `rect.width × group.scaleX`) — PLAN-02 needs it for QR
  placement. If no placeholder exists in the JSON (very old designs), fall back
  to `getQrPosition(materialId, backOption)` (`back-card.ts:58`).

### Per-card back rendering

Reuse the variable-substitution approach from `export-pdf.ts:288-313`: split
objects into `_variableId`-tagged vs static, set each tagged Textbox's `text` to
`cardData[i][variableId] || ''` per card, render, restore.

**Back-file count rules (important — designer quantity ≠ order quantity):**

| Case | Number of back files |
|---|---|
| `qr-name` | `cardData.length` (== designer quantity, UI-capped at 50). QR *i* pairs with card row *i*. |
| `qr-only` + QR URLs provided | one per QR URL (identical art, unique QR) — the Woo item quantity arrives as the URL count; the designer-side quantity is always 1 for `qr-only` |
| `qr-only`, no QRs | 1 |
| Fewer QRs than cards | render all cards; cards without a QR get placeholder-omitted output; warning |
| More QRs than cards (`qr-name`) | render cards; surplus QRs unused; warning + listed in `links.csv` as `unused` |

Render **sequentially**, converting each data URL to a `Blob` immediately and
releasing references — 50 × 2024×1276 renders must not hold 50 live canvases.

### Naming & bundle layout

```
<bundle-name>/
  print/
    front.png | front.jpg
    back-01[-<name-slug>][-<ref>].png|jpg
    back-02[-<name-slug>][-<ref>].png|jpg
    ...
  source/
    <original upload filename>          ← _originalAssetUrl || _assetUrl, dedup by URL
  links.csv
  preview.pdf
```

- `bundle-name`: `Order-<order#>-<partner-slug>` when order context exists
  (PLAN-02 params), else `<design-name-slug>-print-files`, else the design id.
  Reuse `slugify` from `ActionBar.tsx:22` (extract to `src/lib/utils.ts`).
- `name-slug`: slugified card name, max 40 chars, omitted when the row's name is
  empty. `ref`: last path segment of the card URL (matches WP's
  `/r/<ref>` shape); omitted when unparsable or absent. Numbering `01`-padded.
  Collisions (two cards named "Jane") are already disambiguated by the `NN`.
- `links.csv` columns: `card,name,ref,card_url,back_file,status`
  (`status`: `ok` | `no-qr` | `unused`). This is the supplier's chip-encoding
  cross-reference — the printed QR and the encoded chip on the same card must
  match.
- `preview.pdf`: from the refactored builder below.
- Source fetches: reuse the `extractSourceFiles` logic (`DesignPreview.tsx:16`);
  a failed fetch (deleted asset) skips the file and adds a bundle warning rather
  than failing the export.
- ZIP via existing `jszip`; download via existing `triggerBlobDownload`
  (`DesignPreview.tsx:36`) — extract both helpers into `src/lib/download.ts`.

### Export entry point

`exportPrintFiles(snapshot, qrAssignments?) → { blob, warnings[] }` where
`snapshot` mirrors `PdfExportSnapshot` (`export-pdf.ts:239`) plus `variationId`,
`backOption`, `variableFields`, `designName`; `qrAssignments` is
`{ cardUrls: string[], orderRef?: { order, item, partnerSlug } }` (empty in
Phase 1 — the preview page can generate QR-less bundles with a warning).
Take the snapshot from the store the same way `exportDesignAsPdf` does, including
the live-canvas refresh when not given an explicit snapshot.

## Changes to `src/lib/export-pdf.ts`

1. **Refactor to `buildDesignPdf(snapshot?) → Promise<jsPDF>`**, with
   `exportDesignAsPdf` a thin wrapper that calls `.save()`. The print bundle
   calls `buildDesignPdf(...).output('blob')` for `preview.pdf`.
2. **Proof-only**: delete the production-page block (`export-pdf.ts:317-357`) —
   engraved production now lives in the print JPEGs. Keep the layered
   text-as-vector proof pages exactly as they are (safe, known-good).
3. **Filename**: `.save()` gets `<design-name-slug>-preview.pdf` instead of the
   hardcoded `nfc-card-design.pdf` (`export-pdf.ts:359`).
4. **Fix the `CUSTOM_PROPS` clobber bug**: `export-pdf.ts:8`'s list is missing
   `_originalAssetUrl`, and lines 261-267 write that stripped serialisation back
   into the store — an editor PDF export followed by a save silently drops
   original-asset links. Fix by consolidating (next section).

## Housekeeping (production readiness)

- **`src/lib/custom-props.ts`** — single exported `CUSTOM_PROPS`; consume from
  `save-design.ts:9`, `DesignCanvas.tsx:33`, `export-pdf.ts:8`, and the new
  export module. (Also add PLAN-02's `_qrInjected` here when it lands — though it
  must never be *persisted*, listing it costs nothing and documents it.)
- **Delete `supabase/functions/generate-pdf/`** — dead code (zero client
  references), wildcard CORS, no rate limit, and it queries `.eq('id', …)`
  against the uuid PK instead of `design_id`. Do not copy it, remove it.
- Keep `card_names` backward-compat writes untouched (out of scope).

## UI changes

**`src/components/preview/DesignPreview.tsx`** (design mode only — template mode
unchanged):
- "Download PDF" → **"Download Preview"** (calls the refactored PDF export).
- **Remove** "Download Source Files" and its `downloadSourceFiles` path
  (sources now live in the bundle; helper moves to `download.ts` for reuse).
- Add **"Download Print Files"** → `exportPrintFiles()` with no QR assignments;
  on completion, surface `warnings` (esp. "No QR codes — placeholder omitted.
  Open this design from the order screen, or paste card URLs, to embed QRs"
  — full wording lands with PLAN-02's panel) via the existing amber warning
  style (`DesignPreview.tsx:291`). Busy state like the current source-files
  button.
- Keep template mode's buttons as they are (`Use this template` + PDF preview);
  print files make no sense for a valueless template — guard on `mode`.

**`src/components/toolbar/ActionBar.tsx`** — share dialog download block
(`:337-409`): "Download PDF" → "Download Preview". The failure-fallback button
(`:318`) keeps working via the refactored wrapper.

## Edge cases checklist

- [ ] pvc-black: white `defaultPrintColor` text/wave-icon → white pixels on
      transparent PNG. Correct for white-ink printing; looks "blank" on a white
      viewer background. Note it in `links.csv` header comment? No — keep CSV
      clean; it's standard print practice.
- [ ] Wave icon is a base64-embedded tinted PNG (`wave-icon.ts:34`), part of the
      design — include as-is; it has no `_designId` so it never appears in
      `source/`.
- [ ] `cardData` row with empty name: filename omits the slug; text renders
      empty (current PDF behaviour, `cardData[i] || {}`).
- [ ] Design too old to have a placeholder: fallback geometry; warning.
- [ ] Asset 404 during render: Fabric skips the object silently on load-timeout —
      reuse the 10 s `withTimeout` guard from `render-preview.ts:9` and warn if
      object count after load < object count in JSON.
- [ ] SVG source uploads render fine as Fabric images; they go into `source/`
      untouched (that's the point).
- [ ] Memory: sequential rendering, one temp canvas at a time, blobs not data
      URLs in the zip assembly.
- [ ] `#fff`/`#FFFFFF` case variants in bg comparison.
- [ ] Template mode never reaches print export.

## Testing

- Playwright (extend `tests/`): export a plastic `qr-name` ×3 design → assert ZIP
  entries `front.png`, three `back-0N` PNGs, `links.csv`, `preview.pdf`,
  `source/` contents; PNG dimensions 2024×1276; front PNG has transparent corner
  pixel. Repeat for full metal (JPEGs, white corner pixel), hybrid (jpg front /
  png back), legacy printed-metal fixture (all PNG + warning).
- Unit-ish (Playwright eval): placeholder stripped from output (no dashed-rect
  pixels at placeholder location on a blank design).
- Manual: open a real saved design of each material, download both bundles,
  visually diff against the live canvas.

## Acceptance

- Print bundle downloads for every material with correct formats per the matrix.
- Preview PDF has no production pages; both download buttons renamed; source
  button gone.
- `npm run build` and `npm run lint` clean; existing Playwright suites pass.
