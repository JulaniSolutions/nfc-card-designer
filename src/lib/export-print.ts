import { Canvas, FabricImage, Group, IText, Rect, Textbox, util, type FabricObject } from 'fabric'
import * as fabric from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { isSideEngraved, type DesignMethod } from '@/config/materials'
import { useDesignStore, type BackOption, type CardSide } from '@/store/design-store'
import { getQrPosition, isPlaceholderLike, isQrPlaceholder } from '@/lib/back-card'
import { isLegacyPrintedMetal } from '@/lib/design-method'
import { buildDesignPdf } from '@/lib/export-pdf'
import { extractSourceFiles, zipBundle, type BundleFile } from '@/lib/download'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { CUSTOM_PROPS } from '@/lib/custom-props'
import { slugify } from '@/lib/utils'

/**
 * 600 DPI at CR80 (85.6 × 54 mm): the canvas is natively ~300 DPI at 1012 × 638,
 * so doubling it lands on 2024 × 1276.
 */
const EXPORT_MULTIPLIER = 2
const JPEG_QUALITY = 0.92
const LOAD_TIMEOUT_MS = 10_000
/** Long names would otherwise push filenames past what some ftp/print tools accept. */
const MAX_NAME_SLUG = 40
const QR_INJECTED_TAG = '_qrInjected'

/**
 * An explicit design to export. Mirrors `PdfExportSnapshot` plus everything the
 * print bundle needs that a proof PDF does not — the variation (per-side engrave
 * rules), the back layout, the variable definitions and the design name.
 *
 * Omit it and the export reads the store, exactly as `exportDesignAsPdf` does.
 */
export interface PrintExportSnapshot {
  frontCanvasJson: string | null
  backCanvasJson: string | null
  /** '#ffffff' ⇒ transparent on printed sides. */
  frontBgColor: string
  backBgColor: string
  materialId: string | null
  variationId: string | null
  /** Legacy gate only — the per-side matrix comes from the material. */
  designMethod: DesignMethod
  backOption: BackOption
  quantity: number
  cardData: Record<string, string>[]
  variableFields: { id: string; label: string }[]
  designName: string
}

/**
 * The card URLs to print as QR codes, index-paired to card rows, plus the order
 * context that names the bundle. Stateless by design — PLAN-02's deep link (or a
 * manual paste) is the only source, nothing is persisted.
 */
export interface QrAssignments {
  cardUrls: string[]
  orderRef?: { order: string; item: string; partnerSlug?: string }
}

export interface PrintExportResult {
  /** The ZIP. */
  blob: Blob
  filename: string
  /** User-facing, already worded. */
  warnings: string[]
  /** The same content unzipped, paths relative to the bundle root. */
  files: BundleFile[]
  /**
   * The design was saved as printed metal, so every side was exported as ordered
   * (printed) rather than engraved — the UI pairs this with
   * `LEGACY_PRINTED_METAL_NOTICE`.
   */
  legacyPrintedMetal?: boolean
}

/**
 * A ready-made QR raster to drop onto a side. Placement is centre-origin in canvas
 * pixels and defaults to the geometry of the placeholder it replaces, so a caller
 * that only has the image can leave it out. PLAN-02 supplies the generator; the
 * injected object exists only on the offscreen render canvas and is never written
 * to the store or to Supabase.
 */
export interface PrintQrImage {
  dataUrl: string
  left?: number
  top?: number
  width?: number
  height?: number
}

interface QrGeometry {
  left: number
  top: number
  size: number
}

/** Timeout wrapper — resolves after ms even if the promise hangs. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ])
}

/**
 * Ensure crossOrigin is set on all image objects so external URLs load in canvas.
 * Without it `toDataURL` throws on a tainted canvas.
 */
function setCrossOriginOnImages(parsed: Record<string, unknown>) {
  const objects = parsed.objects as Record<string, unknown>[] | undefined
  if (!objects) return
  for (const obj of objects) {
    if (obj.type === 'image' || obj.src) {
      obj.crossOrigin = 'anonymous'
    }
    // Handle groups with nested objects
    if (obj.objects) {
      setCrossOriginOnImages(obj as Record<string, unknown>)
    }
  }
}

/** The stored background colour only stays out of the print file when it is white. */
function isTransparentBg(color: string): boolean {
  const value = (color || '').trim().toLowerCase()
  return value === '' || value === '#ffffff' || value === '#fff'
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(header)?.[1] ?? 'application/octet-stream'
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

/**
 * The placeholder's position and size, in canvas pixels with a centre origin —
 * the coordinate space PLAN-02's QR generator places into.
 */
function readQrGeometry(obj: FabricObject): QrGeometry {
  const centre = obj.getCenterPoint()
  const rect = obj instanceof Group
    ? (obj.getObjects().find((child) => child instanceof Rect) as Rect | undefined)
    : (obj instanceof Rect ? obj : undefined)
  const size = rect
    ? (rect.width || 0) * (rect.scaleX || 1) * (obj === rect ? 1 : (obj.scaleX || 1))
    : (obj.width || 0) * (obj.scaleX || 1)
  return { left: centre.x, top: centre.y, size }
}

/**
 * Force every object dark for an engraved side. The live JSON carries the
 * material's *coloured* engraving tint (silver, gold), so overriding it is
 * mandatory — production artwork is black on white whatever the card looks like.
 */
function forceDarkObjects(objects: FabricObject[]): () => void {
  const restorers: (() => void)[] = []

  for (const obj of objects) {
    if (obj instanceof FabricImage) {
      const savedFilters = obj.filters ? [...obj.filters] : []
      obj.filters = [
        new fabric.filters.Grayscale(),
        new fabric.filters.BlendColor({ color: '#000000', mode: 'tint', alpha: 1 }),
      ]
      obj.applyFilters()
      restorers.push(() => {
        obj.filters = savedFilters
        obj.applyFilters()
      })
      continue
    }

    if (obj instanceof Textbox || obj instanceof IText) {
      const savedFill = obj.fill
      obj.set('fill', '#000000')
      restorers.push(() => obj.set('fill', savedFill))
      continue
    }

    if (obj instanceof Group) {
      restorers.push(forceDarkObjects(obj.getObjects()))
      continue
    }

    // Defensive: the toolbar only creates text and images today, but anything
    // else that carries a colour has to go black too.
    const savedFill = obj.fill
    const savedStroke = obj.stroke
    if (savedFill && savedFill !== 'transparent') obj.set('fill', '#000000')
    if (savedStroke && savedStroke !== 'transparent') obj.set('stroke', '#000000')
    restorers.push(() => {
      obj.set('fill', savedFill)
      obj.set('stroke', savedStroke)
    })
  }

  return () => {
    for (const restore of restorers) restore()
  }
}

interface PreparedSide {
  canvas: Canvas
  element: HTMLCanvasElement
  objects: FabricObject[]
  /** Where the QR placeholder was, before it was stripped. */
  qrGeometry: QrGeometry | null
  warnings: string[]
  /** Undo the engraved overrides; the canvas is disposed straight after. */
  restore: () => void
}

/**
 * Load one side onto an offscreen canvas, ready to raster at print resolution.
 *
 * Deliberately never loads the material mockup — it lives outside the canvas JSON
 * and the print file must carry artwork only, so the supplier prints onto the real
 * card body rather than a picture of one.
 */
async function prepareSide(
  side: CardSide,
  canvasJson: string | null,
  bgColor: string,
  engraved: boolean,
): Promise<PreparedSide> {
  const warnings: string[] = []

  const element = document.createElement('canvas')
  element.width = CARD_WIDTH
  element.height = CARD_HEIGHT
  document.body.appendChild(element)

  const canvas = new Canvas(element, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  })

  if (canvasJson) {
    const parsed = JSON.parse(canvasJson)
    const objectsJson: Record<string, unknown>[] = Array.isArray(parsed.objects) ? parsed.objects : []
    const expected = objectsJson.length
    setCrossOriginOnImages(parsed)
    try {
      // Render what we have rather than hanging forever on a deleted asset
      await withTimeout(canvas.loadFromJSON(parsed), LOAD_TIMEOUT_MS)
    } catch {
      // Fabric's bulk load is all-or-nothing: a single 404 asset rejects it and
      // leaves the canvas empty. Retry object by object so one dead upload costs
      // the supplier that object rather than the whole side.
      for (const objectJson of objectsJson) {
        try {
          const [object] = await withTimeout(util.enlivenObjects([objectJson]), LOAD_TIMEOUT_MS) ?? []
          if (object) canvas.add(object as FabricObject)
        } catch { /* dead asset — the count check below warns */ }
      }
    }
    if (canvas.getObjects().length < expected) {
      warnings.push(
        `Some ${side} artwork could not be loaded and is missing from the print files — check the design opens correctly before sending it to print.`,
      )
    }
  }

  // Set the background *after* loading: `loadFromJSON` restores canvas-level
  // properties from the JSON, so anything set at construction is wiped — which on
  // an engraved side means a black JPEG instead of a white one.
  if (engraved) {
    canvas.backgroundColor = '#ffffff'
  } else if (isTransparentBg(bgColor)) {
    canvas.backgroundColor = ''
  } else {
    canvas.backgroundColor = bgColor
    warnings.push(
      `The ${side} background colour (${bgColor}) is not white, so it is printed edge-to-edge in the print file.`,
    )
  }

  // Strip the placeholder from every print render, recording the QR geometry first.
  // Filter first: `getObjects()` hands back the live array, which `remove` mutates.
  let qrGeometry: QrGeometry | null = null
  for (const obj of canvas.getObjects().filter(isPlaceholderLike)) {
    if (!qrGeometry && isQrPlaceholder(obj)) qrGeometry = readQrGeometry(obj)
    canvas.remove(obj)
  }

  // Fonts are system-only, but a still-loading face would otherwise raster as a fallback
  if (typeof document !== 'undefined' && document.fonts) {
    await document.fonts.ready
  }

  const objects = [...canvas.getObjects()]
  const restore = engraved ? forceDarkObjects(objects) : () => {}
  canvas.renderAll()

  return { canvas, element, objects, qrGeometry, warnings, restore }
}

function disposeSide(side: PreparedSide) {
  side.restore()
  side.canvas.dispose()
  if (side.element.parentNode) {
    document.body.removeChild(side.element)
  }
}

/** One whole-canvas raster at print resolution, as a blob rather than a data URL. */
function renderSideToBlob(canvas: Canvas, engraved: boolean): Blob {
  canvas.renderAll()
  const dataUrl = canvas.toDataURL(
    engraved
      ? { format: 'jpeg', quality: JPEG_QUALITY, multiplier: EXPORT_MULTIPLIER, enableRetinaScaling: false }
      : { format: 'png', multiplier: EXPORT_MULTIPLIER, enableRetinaScaling: false },
  )
  return dataUrlToBlob(dataUrl)
}

/**
 * Drop a generated QR onto the render canvas. A plain tagged image — nothing that
 * could be mistaken for the placeholder by the ghost sweeper, and nothing that ever
 * reaches the store.
 */
async function injectQrImage(
  canvas: Canvas,
  qrImage: PrintQrImage,
  geometry: QrGeometry,
): Promise<FabricImage> {
  const width = qrImage.width ?? geometry.size
  const height = qrImage.height ?? geometry.size
  const image = await FabricImage.fromURL(qrImage.dataUrl, { crossOrigin: 'anonymous' })
  image.set({
    originX: 'center',
    originY: 'center',
    left: qrImage.left ?? geometry.left,
    top: qrImage.top ?? geometry.top,
    scaleX: width / (image.width || width),
    scaleY: height / (image.height || height),
    selectable: false,
    evented: false,
  })
  ;(image as FabricImage & Record<string, unknown>)[QR_INJECTED_TAG] = true
  canvas.add(image)
  return image
}

/**
 * The supplier's chip-encoding reference: `/r/<ref>` is the last path segment.
 *
 * Exported so the production panel labels rows with the same ref that lands in the
 * filenames and `links.csv` (re-exported from `production-params.ts`).
 */
export function refFromCardUrl(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean)
    return segments.length ? decodeURIComponent(segments[segments.length - 1]) : ''
  } catch {
    return ''
  }
}

function backFileName(index: number, name: string, ref: string, extension: string): string {
  const parts = [`back-${String(index + 1).padStart(2, '0')}`]
  const nameSlug = slugify(name).slice(0, MAX_NAME_SLUG).replace(/-$/, '')
  if (nameSlug) parts.push(nameSlug)
  const refSlug = ref.replace(/[^A-Za-z0-9_-]/g, '')
  if (refSlug) parts.push(refSlug)
  return `${parts.join('-')}.${extension}`
}

function bundleName(
  qr: QrAssignments | undefined,
  designName: string,
  designId: string | null,
): string {
  const order = qr?.orderRef?.order
  if (order) {
    const partner = slugify(qr?.orderRef?.partnerSlug ?? '')
    return partner ? `Order-${order}-${partner}` : `Order-${order}`
  }
  const nameSlug = slugify(designName)
  if (nameSlug) return `${nameSlug}-print-files`
  return designId || 'nfc-card-print-files'
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

interface LinkRow {
  card: string
  name: string
  ref: string
  cardUrl: string
  backFile: string
  status: 'ok' | 'no-qr' | 'unused'
}

function buildLinksCsv(rows: LinkRow[]): Blob {
  const lines = ['card,name,ref,card_url,back_file,status']
  for (const row of rows) {
    lines.push([row.card, row.name, row.ref, row.cardUrl, row.backFile, row.status].map(csvCell).join(','))
  }
  return new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' })
}

/** Keep two uploads that happen to share a filename from overwriting each other in the zip. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) {
    taken.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  let counter = 2
  while (taken.has(`${stem}-${counter}${extension}`)) counter++
  const unique = `${stem}-${counter}${extension}`
  taken.add(unique)
  return unique
}

/**
 * Build the print bundle: per-side rasters following the engrave/print matrix, one
 * back file per card, the original uploads, a `links.csv` cross-reference and the
 * proof PDF.
 *
 * Pass a snapshot from pages that never populate the store (templates); omit it and
 * the store is used, refreshed from the live canvases first — the same rule as
 * `exportDesignAsPdf`.
 */
export async function exportPrintFiles(
  snapshot?: PrintExportSnapshot,
  qr?: QrAssignments,
): Promise<PrintExportResult> {
  // Live canvases are the freshest source, but only when exporting the store's
  // design. A snapshot caller has no mounted canvases and must not write to the store.
  if (!snapshot) {
    const state = useDesignStore.getState()
    if (window.__fabricCanvasFront) {
      state.setCanvasJson('front', JSON.stringify(window.__fabricCanvasFront.toObject(CUSTOM_PROPS)))
    }
    if (window.__fabricCanvasBack) {
      state.setCanvasJson('back', JSON.stringify(window.__fabricCanvasBack.toObject(CUSTOM_PROPS)))
    }
  }

  const store = useDesignStore.getState()
  const design: PrintExportSnapshot = snapshot ?? {
    frontCanvasJson: store.frontCanvasJson,
    backCanvasJson: store.backCanvasJson,
    frontBgColor: store.frontBgColor,
    backBgColor: store.backBgColor,
    materialId: store.materialId,
    variationId: store.variationId,
    designMethod: store.designMethod,
    backOption: store.backOption,
    quantity: store.quantity,
    cardData: store.cardData,
    variableFields: store.variableFields,
    designName: store.designName,
  }

  const warnings: string[] = []
  const files: BundleFile[] = []

  // A design saved as printed metal is exported as it was ordered — printed on
  // every side — rather than being silently re-cut as engraved artwork.
  const legacyPrintedMetal = isLegacyPrintedMetal(design.materialId, design.designMethod)
  if (legacyPrintedMetal) {
    warnings.push(
      'This design was saved as printed metal, so every side has been exported as a full-colour printed PNG, exactly as it was ordered.',
    )
  }
  const frontEngraved = !legacyPrintedMetal && isSideEngraved(design.materialId, 'front')
  const backEngraved = !legacyPrintedMetal && isSideEngraved(design.materialId, 'back')

  const cardUrls = qr?.cardUrls ?? []
  const cardData = design.cardData ?? []

  // === Front ===
  const front = await prepareSide('front', design.frontCanvasJson, design.frontBgColor, frontEngraved)
  try {
    warnings.push(...front.warnings)
    files.push({
      path: `print/front.${frontEngraved ? 'jpg' : 'png'}`,
      blob: renderSideToBlob(front.canvas, frontEngraved),
    })
  } finally {
    disposeSide(front)
  }

  // === Backs — one file per card ===
  // The designer's quantity is not the order quantity: a `qr-only` design is always
  // a single card in the editor, so the QR URL count is what drives the file count.
  const backCount = design.backOption === 'qr-name'
    ? Math.max(cardData.length, 1)
    : Math.max(cardUrls.length, 1)

  if (cardUrls.length === 0) {
    warnings.push(
      'No QR codes — the placeholder has been left out of the print files. Open this design from the order screen, or paste the card URLs, to embed QR codes.',
    )
  } else if (cardUrls.length < backCount) {
    warnings.push(
      `Only ${cardUrls.length} QR ${cardUrls.length === 1 ? 'code' : 'codes'} for ${backCount} cards — the remaining cards print without a QR code.`,
    )
  } else if (cardUrls.length > backCount) {
    const surplus = cardUrls.length - backCount
    warnings.push(
      `${cardUrls.length} QR codes for ${backCount} ${backCount === 1 ? 'card' : 'cards'} — ${surplus} surplus ${surplus === 1 ? 'code is' : 'codes are'} unused, and listed in links.csv.`,
    )
  }

  const rows: LinkRow[] = []
  const back = await prepareSide('back', design.backCanvasJson, design.backBgColor, backEngraved)
  try {
    warnings.push(...back.warnings)

    const qrGeometry = back.qrGeometry ?? getQrPosition(design.materialId, design.backOption)
    if (!back.qrGeometry) {
      warnings.push(
        'No QR placeholder was found on the back of this design, so QR codes are placed at the standard position for this material — check the proof before printing.',
      )
    }

    // PLAN-02 fills this with one rendered QR per card, generated at `qrGeometry`
    // and injected below. Until then the placeholder is simply stripped and the
    // no-QR warning above stands.
    const qrImages: (PrintQrImage | undefined)[] = []

    const variableObjects = back.objects.filter(
      (obj) => (obj as FabricObject & { _variableId?: string })._variableId,
    ) as (Textbox & { _variableId?: string })[]

    // Sequential: 50 × 2024 × 1276 renders must not hold 50 live canvases
    for (let i = 0; i < backCount; i++) {
      const values = cardData[i] || {}
      const originalText = variableObjects.map((obj) => obj.text)
      for (const obj of variableObjects) {
        obj.set('text', values[obj._variableId!] || '')
      }

      const qrImage = qrImages[i]
      const injected = qrImage ? await injectQrImage(back.canvas, qrImage, qrGeometry) : null

      const cardUrl = cardUrls[i] ?? ''
      const ref = cardUrl ? refFromCardUrl(cardUrl) : ''
      // Only `qr-name` prints a name, so only then does one belong in the filename.
      const name = design.backOption === 'qr-name' ? (values['name'] || '') : ''
      const path = `print/${backFileName(i, name, ref, backEngraved ? 'jpg' : 'png')}`

      files.push({ path, blob: renderSideToBlob(back.canvas, backEngraved) })
      rows.push({
        card: String(i + 1),
        name,
        ref,
        cardUrl,
        backFile: path,
        status: cardUrl ? 'ok' : 'no-qr',
      })

      if (injected) back.canvas.remove(injected)
      variableObjects.forEach((obj, index) => obj.set('text', originalText[index]))
    }

    for (let i = backCount; i < cardUrls.length; i++) {
      rows.push({
        card: '',
        name: '',
        ref: refFromCardUrl(cardUrls[i]),
        cardUrl: cardUrls[i],
        backFile: '',
        status: 'unused',
      })
    }
  } finally {
    disposeSide(back)
  }

  files.push({ path: 'links.csv', blob: buildLinksCsv(rows) })

  // === Original uploads ===
  const sourceFiles = extractSourceFiles(design.frontCanvasJson, design.backCanvasJson)
  const takenNames = new Set<string>()
  for (const source of sourceFiles) {
    try {
      const response = await fetchWithTimeout(source.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      files.push({ path: `source/${uniqueName(source.name, takenNames)}`, blob: await response.blob() })
    } catch {
      // A deleted asset must not cost the supplier the rest of the bundle
      warnings.push(`The original upload "${source.name}" could not be downloaded, so it is missing from source/.`)
    }
  }

  // === Proof PDF ===
  try {
    const pdf = await buildDesignPdf({
      frontCanvasJson: design.frontCanvasJson,
      backCanvasJson: design.backCanvasJson,
      frontBgColor: design.frontBgColor,
      backBgColor: design.backBgColor,
      materialId: design.materialId,
      designMethod: design.designMethod,
      quantity: design.quantity,
      cardData: design.cardData,
      designName: design.designName,
    })
    files.push({ path: 'preview.pdf', blob: pdf.output('blob') })
  } catch {
    warnings.push('The preview PDF could not be generated, so it is missing from the bundle. The print files themselves are unaffected.')
  }

  const name = bundleName(qr, design.designName, snapshot ? null : store.designId)
  const blob = await zipBundle(files, name)

  return { blob, filename: `${name}.zip`, warnings, files, legacyPrintedMetal }
}
