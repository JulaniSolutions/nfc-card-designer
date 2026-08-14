import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { injectQrDecoder, probeQrRegion, type QrRegion } from './helpers/qr-probe'
import { stubSupabaseDesigns } from './helpers/stub-supabase'

/**
 * QR generation & production mode (PLAN-02).
 *
 * Two halves, both driven against real product code:
 *
 * 1. **The panel**, on the real `/design/:id` route. The page needs a saved design
 *    and this environment has no Supabase, so `src/lib/supabase.ts` is intercepted
 *    at the dev server and answers from a seeded row (`helpers/stub-supabase.ts`).
 *    Everything after that — routing, the row → store mapping, `DesignPreview`,
 *    `ProductionPanel`, the download — is the app itself.
 * 2. **The QR codes in the bundle**, through P1.d's in-page print harness. The
 *    exported back files are unzipped in Node, then cropped and *decoded* in the
 *    browser (`helpers/qr-probe.ts`): a real decode proves the finished print file
 *    is scannable and carries that card's URL, which a pixel snapshot cannot.
 *
 * The seeded rows are built by the harness from the app's own back-card helpers,
 * so the fixture carries a genuine QR placeholder rather than an approximation.
 */

const HARNESS = '/tests/helpers/print-harness.html'
const DESIGN_ID = 'prod0001'
const PARTNER = 'https%3A%2F%2Fexample.com'
const CARD_URLS = ['https://example.com/r/aaa111', 'https://example.com/r/bbb222']

type BackOption = 'qr-only' | 'qr-name'

interface BuildDesignOptions {
  materialId: string
  variationId: string
  backOption: BackOption
  cardData: Record<string, string>[]
  designName?: string
  designMethod?: 'engraved' | 'printed'
  frontText?: string
}

interface ExportProbe {
  warnings: string[]
  zipFilename: string
  zipBase64: string
  linksCsv: string
}

interface PrintHarness {
  exportDesign: (opts: BuildDesignOptions, qr?: { cardUrls: string[] }) => Promise<ExportProbe>
  qrRegion: (materialId: string, backOption: BackOption) => QrRegion
  designRow: (designId: string, opts: BuildDesignOptions) => Promise<Record<string, unknown>>
}

type HarnessWindow = Window & { __printHarness?: PrintHarness }

/** Full-page Fabric renders at 2024 × 1276, several per export. */
test.describe.configure({ timeout: 120_000 })

const PLASTIC_DESIGN: BuildDesignOptions = {
  materialId: 'plastic',
  variationId: 'pvc-white',
  backOption: 'qr-only',
  cardData: [{ name: '' }],
  designName: 'Panel Test',
  frontText: 'ACME',
}

async function openHarness(page: Page) {
  await page.goto(HARNESS)
  await page.waitForFunction(() => !!(window as HarnessWindow).__printHarness, undefined, { timeout: 20_000 })
}

/** The seeded `designs` row and the placeholder box, built once per worker. */
async function buildFixture(page: Page): Promise<{ row: Record<string, unknown>; region: QrRegion }> {
  await openHarness(page)
  return page.evaluate(async (opts) => {
    const harness = (window as HarnessWindow).__printHarness!
    return {
      row: await harness.designRow('prod0001', opts),
      region: harness.qrRegion(opts.materialId, opts.backOption),
    }
  }, PLASTIC_DESIGN)
}

/** Bundle-root-relative contents of a real ZIP. */
async function unzip(zipBase64: string, zipFilename: string): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(Buffer.from(zipBase64, 'base64'))
  const root = `${zipFilename.replace(/\.zip$/, '')}/`
  const files = new Map<string, Buffer>()
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    files.set(entry.name.replace(root, ''), Buffer.from(await entry.async('uint8array')))
  }
  return files
}

function mimeFor(path: string): string {
  return path.endsWith('.jpg') ? 'image/jpeg' : 'image/png'
}

/**
 * The production panel: the innermost element holding both its heading and its
 * paste box. Scoping matters — `DesignPreview` has its own "Download Print Files"
 * button, and that one carries no QR codes.
 */
function productionPanel(page: Page) {
  return page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: 'Production' }) })
    .filter({ has: page.locator('#production-card-urls') })
    .last()
}

test.describe('Production panel', () => {
  let fixture!: { row: Record<string, unknown>; region: QrRegion }

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    try {
      fixture = await buildFixture(page)
    } finally {
      await page.close()
    }
  })

  test.beforeEach(async ({ page }) => {
    await stubSupabaseDesigns(page, { [DESIGN_ID]: fixture.row })
  })

  test('a production link pre-fills the panel and stamps a scannable QR on every back', async ({ page }) => {
    await page.goto(`/design/${DESIGN_ID}?d=${PARTNER}&r=aaa111,bbb222&order=99&partner=test`)

    const urls = page.locator('#production-card-urls')
    await expect(urls).toBeVisible({ timeout: 30_000 })

    // Pre-filled straight from the compact `d` + `r` form, one card per line.
    await expect(urls).toHaveValue(CARD_URLS.join('\n'))

    const panel = productionPanel(page)
    const context = (await panel.getByText(/QR codes supplied/).innerText()).replace(/\s+/g, ' ')
    expect(context).toBe('Order #99 · test · 2 QR codes supplied')
    await expect(panel.getByText('2 of 2 cards have a QR')).toBeVisible()

    // The panel's own button, not `DesignPreview`'s — only this one carries the QRs.
    const download = page.waitForEvent('download')
    await panel.getByRole('button', { name: 'Download Print Files' }).click()
    const zip = await download

    // Order context names the bundle, so it lands in the right Drive folder later.
    expect(zip.suggestedFilename()).toBe('Order-99-test.zip')
    const bytes = await readFile(await zip.path())
    const files = await unzip(bytes.toString('base64'), zip.suggestedFilename())

    expect([...files.keys()].sort()).toEqual([
      'links.csv',
      'preview.pdf',
      'print/back-01-aaa111.png',
      'print/back-02-bbb222.png',
      'print/front.png',
    ])

    // Every back carries its *own* card's QR, at the placeholder's position.
    await injectQrDecoder(page)
    for (const [index, path] of ['print/back-01-aaa111.png', 'print/back-02-bbb222.png'].entries()) {
      const probe = await probeQrRegion(page, {
        base64: files.get(path)!.toString('base64'),
        mime: mimeFor(path),
        region: fixture.region,
      })
      expect(probe.dark, `${path} has QR modules`).toBeGreaterThan(0)
      expect(probe.decoded, path).toBe(CARD_URLS[index])
    }

    // The supplier's cross-reference: the printed link and the chip ref, per card.
    expect(files.get('links.csv')!.toString().trim().split('\n')).toEqual([
      'card,name,ref,card_url,back_file,status',
      `1,,aaa111,${CARD_URLS[0]},print/back-01-aaa111.png,ok`,
      `2,,bbb222,${CARD_URLS[1]},print/back-02-bbb222.png,ok`,
    ])
  })

  test('a customer opening the plain share link sees no trace of production mode', async ({ page }) => {
    await page.goto(`/design/${DESIGN_ID}`)

    // The page really did load — the panel's absence is not just a blank screen.
    await expect(page.getByRole('heading', { name: 'Panel Test' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#production-card-urls')).toHaveCount(0)
    await expect(page.getByText('Production', { exact: true })).toHaveCount(0)
  })

  test('production=1 opens an empty panel to paste into', async ({ page }) => {
    await page.goto(`/design/${DESIGN_ID}?production=1`)

    const urls = page.locator('#production-card-urls')
    await expect(urls).toBeVisible({ timeout: 30_000 })
    await expect(urls).toHaveValue('')
    await expect(page.getByText('0 of 1 card has a QR')).toBeVisible()
    await expect(page.getByText(/the placeholder has been left out/)).toBeVisible()
  })

  test('an entry that is not a URL is flagged, not silently dropped', async ({ page }) => {
    await page.goto(`/design/${DESIGN_ID}?qr=${encodeURIComponent(CARD_URLS[0])}&qr=tap.example.com`)

    const urls = page.locator('#production-card-urls')
    await expect(urls).toBeVisible({ timeout: 30_000 })

    // The unusable entry is kept out of the card pairing but reported verbatim.
    await expect(urls).toHaveValue(CARD_URLS[0])
    await expect(page.getByText(/could not be read as a URL/)).toContainText('tap.example.com')

    // Same rule for a hand-typed line: flagged in place, the good line still counts.
    await urls.fill(`${CARD_URLS[0]}\nnot a url`)
    await expect(page.getByText('not a URL', { exact: true })).toBeVisible()
    await expect(page.getByText('1 of 1 card has a QR')).toBeVisible()
  })

  test('blank lines are ignored and a repeated link is warned about, not blocked', async ({ page }) => {
    await page.goto(`/design/${DESIGN_ID}?production=1`)

    const urls = page.locator('#production-card-urls')
    await expect(urls).toBeVisible({ timeout: 30_000 })
    await urls.fill(`  ${CARD_URLS[0]}  \n\n\n${CARD_URLS[0]}\n`)

    // Whitespace and empty lines never become cards…
    await expect(page.getByText('2 of 2 cards have a QR')).toBeVisible()
    // …but two cards pointing at one profile is a mistake worth naming.
    await expect(page.getByText(/Two cards share a QR code/)).toContainText('card 2')
    await expect(productionPanel(page).getByRole('button', { name: 'Download Print Files' })).toBeEnabled()
  })
})

test.describe('QR codes in the print bundle', () => {
  /** Export through the harness and hand back the finished back file. */
  async function exportBack(page: Page, opts: BuildDesignOptions, path: string) {
    await openHarness(page)
    await injectQrDecoder(page)

    const probe = await page.evaluate(
      (args) => (window as HarnessWindow).__printHarness!.exportDesign(args.opts, { cardUrls: args.cardUrls }),
      { opts, cardUrls: [CARD_URLS[0]] },
    )
    const files = await unzip(probe.zipBase64, probe.zipFilename)
    const back = files.get(path)
    expect(back, `${path} — got ${[...files.keys()].join(', ')}`).toBeTruthy()

    const region = await page.evaluate(
      (args) => (window as HarnessWindow).__printHarness!.qrRegion(args.materialId, args.backOption),
      opts,
    )
    return {
      probe,
      pixels: await probeQrRegion(page, {
        base64: back!.toString('base64'),
        mime: mimeFor(path),
        region,
      }),
    }
  }

  test('a light card body gets black modules with transparent gaps', async ({ page }) => {
    const { pixels } = await exportBack(
      page,
      { ...PLASTIC_DESIGN, variationId: 'pvc-white' },
      'print/back-01-aaa111.png',
    )

    expect(pixels.decoded).toBe(CARD_URLS[0])
    expect(pixels.dark).toBeGreaterThan(pixels.total * 0.1)
    // Nothing white is printed onto a white card: the gaps are the card itself.
    expect(pixels.light).toBe(0)
    expect(pixels.transparent).toBeGreaterThan(pixels.total * 0.3)
  })

  test('a dark card body gets white modules, sampled from the card under the placeholder', async ({ page }) => {
    const { pixels } = await exportBack(
      page,
      { ...PLASTIC_DESIGN, variationId: 'pvc-black' },
      'print/back-01-aaa111.png',
    )

    expect(pixels.decoded).toBe(CARD_URLS[0])
    // Auto-contrast inverted the modules; black ones would vanish into the card.
    expect(pixels.light).toBeGreaterThan(pixels.total * 0.1)
    expect(pixels.dark).toBe(0)
    expect(pixels.transparent).toBeGreaterThan(pixels.total * 0.3)
  })

  test('an engraved metal back gets black modules on white however dark the metal is', async ({ page }) => {
    const { pixels } = await exportBack(
      page,
      { ...PLASTIC_DESIGN, materialId: 'metal', variationId: 'metal-black-steel', designName: 'Metal QR' },
      'print/back-01-aaa111.jpg',
    )

    expect(pixels.decoded).toBe(CARD_URLS[0])
    // A production JPEG is opaque: black artwork on white, whatever the card looks
    // like — the tint is the metal, and the laser only sees the artwork.
    expect(pixels.transparent).toBe(0)
    expect(pixels.dark).toBeGreaterThan(pixels.total * 0.1)
    expect(pixels.light).toBeGreaterThan(pixels.dark)
  })
})
