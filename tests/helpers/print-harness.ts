/**
 * Test-only harness for the print export (PLAN-01).
 *
 * `exportPrintFiles` is a browser-side module — it needs Fabric, a real canvas and
 * `toDataURL`, none of which exist in Node. Playwright therefore drives it *inside*
 * the page: this module is served straight from source by the Vite dev server
 * (`/tests/helpers/print-harness.html`), builds designs with the app's own
 * back-card helpers so the fixtures are the real serialisation rather than a
 * hand-written approximation, runs the export, and reports back plain JSON —
 * file names, warnings, image dimensions and sampled pixels.
 *
 * Nothing here ships: it lives outside `src`, so neither the Vite build nor
 * `tsc -b` ever sees it.
 */
import { Canvas, FabricImage, Textbox, type FabricObject } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { getDefaultDesignMethod, type DesignMethod } from '@/config/materials'
import { CUSTOM_PROPS } from '@/lib/custom-props'
import { getQrPosition, updateQrPlaceholder, updateVariableTexts } from '@/lib/back-card'
import { exportPrintFiles, type PrintExportSnapshot, type QrAssignments } from '@/lib/export-print'
import { parseProductionParams, type ProductionParams } from '@/lib/production-params'
import type { SavedDesign } from '@/lib/save-design'
import { useDesignStore, type BackOption } from '@/store/design-store'

export interface BuildDesignOptions {
  materialId: string
  variationId: string
  backOption: BackOption
  /** One row per card; `qr-name` prints `name` and drives the back-file count. */
  cardData: Record<string, string>[]
  designName?: string
  /** Stored design method — pass 'printed' on a metal material for the legacy fixture. */
  designMethod?: DesignMethod
  /** Front headline. Omitted ⇒ a front carrying nothing but the placeholder-free canvas. */
  frontText?: string
  /** Stands in for an uploaded asset (same-origin, so `source/` can be exercised offline). */
  frontImageUrl?: string
  frontImageName?: string
  /**
   * The material photo the editor parks on `canvas.backgroundImage` (see
   * `DesignCanvas.tsx`). Real saved designs always carry one; the export has to
   * drop it, so a fixture without it can't prove anything.
   */
  materialImageUrl?: string
}

export interface ImageProbe {
  path: string
  bytes: number
  format: 'png' | 'jpeg' | 'unknown'
  width: number
  height: number
  /** RGBA a few pixels in from the top-left — transparent on printed, white on engraved. */
  corner: [number, number, number, number]
  /** Inked pixels anywhere in the image. */
  ink: number
  /** Inked pixels inside the QR placeholder's box — 0 once the placeholder is stripped. */
  placeholderInk: number
}

export interface ExportProbe {
  /** Guard against a vacuous strip test: the built design really did carry a placeholder. */
  backHasPlaceholder: boolean
  filenames: string[]
  warnings: string[]
  legacyPrintedMetal: boolean
  zipFilename: string
  zipBase64: string
  images: ImageProbe[]
  linksCsv: string
}

const NAME_FIELD = { id: 'name', label: 'Name' }
/** The dashed border straddles the box edge, so probe a little beyond it. */
const PLACEHOLDER_PROBE_MARGIN = 12

function newCanvas(): { canvas: Canvas; element: HTMLCanvasElement } {
  const element = document.createElement('canvas')
  element.width = CARD_WIDTH
  element.height = CARD_HEIGHT
  document.body.appendChild(element)
  return { canvas: new Canvas(element, { width: CARD_WIDTH, height: CARD_HEIGHT }), element }
}

function disposeCanvas(canvas: Canvas, element: HTMLCanvasElement) {
  canvas.dispose()
  element.parentNode?.removeChild(element)
}

function tag(obj: FabricObject, props: Record<string, unknown>) {
  Object.assign(obj as FabricObject & Record<string, unknown>, props)
}

/**
 * Build a design the way the editor would: the store first (the back-card helpers
 * read it), then the two canvases, then the serialisation the export consumes.
 */
async function buildSnapshot(opts: BuildDesignOptions): Promise<PrintExportSnapshot> {
  useDesignStore.setState({
    materialId: opts.materialId,
    variationId: opts.variationId,
    backOption: opts.backOption,
    variableFields: [NAME_FIELD],
    cardData: opts.cardData,
    quantity: opts.cardData.length,
  })

  const front = newCanvas()
  if (opts.frontText) {
    front.canvas.add(new Textbox(opts.frontText, {
      left: 120,
      top: 260,
      width: 600,
      fontSize: 72,
      fontFamily: 'Arial',
      fill: '#111111',
    }))
  }
  if (opts.frontImageUrl) {
    const image = await FabricImage.fromURL(opts.frontImageUrl, { crossOrigin: 'anonymous' })
    image.set({ left: 120, top: 60, scaleX: 0.5, scaleY: 0.5 })
    tag(image, {
      _designId: 'test-asset',
      _assetUrl: opts.frontImageUrl,
      _assetName: opts.frontImageName ?? 'upload.png',
    })
    front.canvas.add(image)
  }

  const back = newCanvas()
  if (opts.materialImageUrl) {
    // Both sides, the way the editor applies it — front and back each get one.
    for (const target of [front.canvas, back.canvas]) {
      const material = await FabricImage.fromURL(opts.materialImageUrl, { crossOrigin: 'anonymous' })
      material.set({
        originX: 'left',
        originY: 'top',
        scaleX: CARD_WIDTH / (material.width || CARD_WIDTH),
        scaleY: CARD_HEIGHT / (material.height || CARD_HEIGHT),
      })
      target.backgroundImage = material
    }
  }
  updateQrPlaceholder(back.canvas)
  if (opts.backOption === 'qr-name') {
    updateVariableTexts(back.canvas, [NAME_FIELD], opts.cardData)
  }

  const snapshot: PrintExportSnapshot = {
    frontCanvasJson: JSON.stringify(front.canvas.toObject(CUSTOM_PROPS)),
    backCanvasJson: JSON.stringify(back.canvas.toObject(CUSTOM_PROPS)),
    frontBgColor: '#ffffff',
    backBgColor: '#ffffff',
    materialId: opts.materialId,
    variationId: opts.variationId,
    designMethod: opts.designMethod ?? getDefaultDesignMethod(opts.materialId),
    backOption: opts.backOption,
    quantity: opts.cardData.length,
    cardData: opts.cardData,
    variableFields: [NAME_FIELD],
    designName: opts.designName ?? 'Print Test',
  }

  disposeCanvas(front.canvas, front.element)
  disposeCanvas(back.canvas, back.element)
  return snapshot
}

/**
 * The same design, shaped as the Supabase row `/design/:id` loads.
 *
 * PLAN-02's panel only exists on a *saved* design, and this environment has no
 * Supabase, so the production spec stubs the client module and hands it one of
 * these. Building it from `buildSnapshot` keeps the seeded row honest: it carries
 * the real Fabric serialisation, placeholder and all, rather than a hand-written
 * approximation that could quietly drift from what the editor writes.
 */
export function buildDesignRow(designId: string, snapshot: PrintExportSnapshot): SavedDesign {
  const now = new Date().toISOString()
  return {
    id: `row-${designId}`,
    design_id: designId,
    name: snapshot.designName,
    material_id: snapshot.materialId ?? 'plastic',
    variation_id: snapshot.variationId ?? 'pvc-white',
    front_canvas_json: snapshot.frontCanvasJson,
    back_canvas_json: snapshot.backCanvasJson,
    front_bg_color: snapshot.frontBgColor,
    back_bg_color: snapshot.backBgColor,
    design_method: snapshot.designMethod,
    back_option: snapshot.backOption,
    // Legacy column, still written by the app alongside `card_data`.
    card_names: snapshot.cardData.map((row) => row['name'] ?? ''),
    variable_fields: snapshot.variableFields,
    card_data: snapshot.cardData,
    quantity: snapshot.quantity,
    source_template_id: null,
    created_at: now,
    updated_at: now,
  }
}

function detectFormat(bytes: Uint8Array): ImageProbe['format'] {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
  return 'unknown'
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Sample a rendered print file. "Ink" means a pixel that would show on press:
 * anything not transparent on a printed PNG, anything not white on an engraved JPEG.
 */
async function probeImage(path: string, blob: Blob, region: { left: number; top: number; size: number }): Promise<ImageProbe> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const format = detectFormat(bytes)
  const bitmap = await createImageBitmap(blob)
  // `close()` zeroes the bitmap's dimensions, so read them out first.
  const width = bitmap.width
  const height = bitmap.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  const { data } = ctx.getImageData(0, 0, width, height)
  bitmap.close()

  const inked = (i: number) =>
    format === 'jpeg'
      ? (data[i] + data[i + 1] + data[i + 2]) / 3 < 240
      : data[i + 3] > 16

  let ink = 0
  for (let i = 0; i < data.length; i += 4) {
    if (inked(i)) ink++
  }

  // The placeholder box, in export pixels — the design is rendered at a multiplier,
  // so scale off the actual raster rather than assuming one.
  const scale = width / CARD_WIDTH
  const half = region.size / 2 + PLACEHOLDER_PROBE_MARGIN
  const x0 = Math.max(0, Math.floor((region.left - half) * scale))
  const x1 = Math.min(width, Math.ceil((region.left + half) * scale))
  const y0 = Math.max(0, Math.floor((region.top - half) * scale))
  const y1 = Math.min(height, Math.ceil((region.top + half) * scale))
  let placeholderInk = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (inked((y * width + x) * 4)) placeholderInk++
    }
  }

  const cornerIndex = (4 * width + 4) * 4
  return {
    path,
    bytes: bytes.length,
    format,
    width,
    height,
    corner: [data[cornerIndex], data[cornerIndex + 1], data[cornerIndex + 2], data[cornerIndex + 3]],
    ink,
    placeholderInk,
  }
}

async function exportDesign(opts: BuildDesignOptions, qr?: QrAssignments): Promise<ExportProbe> {
  const snapshot = await buildSnapshot(opts)
  const result = await exportPrintFiles(snapshot, qr)

  const region = getQrPosition(opts.materialId, opts.backOption)
  const images: ImageProbe[] = []
  for (const file of result.files) {
    if (!file.path.startsWith('print/')) continue
    images.push(await probeImage(file.path, file.blob, region))
  }

  const csvFile = result.files.find((file) => file.path === 'links.csv')

  return {
    backHasPlaceholder: (snapshot.backCanvasJson ?? '').includes('_qrPlaceholderBorder'),
    filenames: result.files.map((file) => file.path),
    warnings: result.warnings,
    legacyPrintedMetal: !!result.legacyPrintedMetal,
    zipFilename: result.filename,
    zipBase64: toBase64(new Uint8Array(await result.blob.arrayBuffer())),
    images,
    linksCsv: csvFile ? await csvFile.blob.text() : '',
  }
}

declare global {
  interface Window {
    __printHarness?: {
      exportDesign: (opts: BuildDesignOptions, qr?: QrAssignments) => Promise<ExportProbe>
      qrRegion: (materialId: string, backOption: BackOption) => { left: number; top: number; size: number }
      /** A seeded `designs` row for the production panel's `/design/:id` flow. */
      designRow: (designId: string, opts: BuildDesignOptions) => Promise<SavedDesign>
      /** Parse a production query string, for asserting the link contract directly. */
      parseParams: (search: string) => ProductionParams | null
    }
  }
}

window.__printHarness = {
  exportDesign,
  qrRegion: (materialId, backOption) => getQrPosition(materialId, backOption),
  designRow: async (designId, opts) => buildDesignRow(designId, await buildSnapshot(opts)),
  parseParams: (search) => parseProductionParams(new URLSearchParams(search)),
}
