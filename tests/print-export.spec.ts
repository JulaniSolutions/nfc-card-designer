import { test, expect, type Page } from '@playwright/test'
import JSZip from 'jszip'

/**
 * Print-ready export engine (PLAN-01).
 *
 * The export is a browser module — Fabric, a real canvas and `toDataURL` — so it is
 * driven inside the page through `tests/helpers/print-harness.html`, which the Vite
 * dev server compiles straight from source. That keeps these tests off Supabase and
 * off the editor UI: designs are built from the app's own back-card helpers, the
 * export runs against an explicit snapshot, and the ZIP comes back as base64 for
 * Node to open. No network, no saved design, no fixtures to keep in sync.
 */

const HARNESS = '/tests/helpers/print-harness.html'
/** 600 DPI at CR80: 1012 × 638 doubled. */
const PRINT_WIDTH = 2024
const PRINT_HEIGHT = 1276

type BackOption = 'qr-only' | 'qr-name'

interface BuildDesignOptions {
  materialId: string
  variationId: string
  backOption: BackOption
  cardData: Record<string, string>[]
  designName?: string
  designMethod?: 'engraved' | 'printed'
  frontText?: string
  frontImageUrl?: string
  frontImageName?: string
  /** The material photo the editor parks on `canvas.backgroundImage`. */
  materialImageUrl?: string
}

interface QrAssignments {
  cardUrls: string[]
  orderRef?: { order: string; item: string; partnerSlug?: string }
}

interface ImageProbe {
  path: string
  bytes: number
  format: 'png' | 'jpeg' | 'unknown'
  width: number
  height: number
  corner: [number, number, number, number]
  ink: number
  placeholderInk: number
}

interface ExportProbe {
  backHasPlaceholder: boolean
  filenames: string[]
  warnings: string[]
  legacyPrintedMetal: boolean
  zipFilename: string
  zipBase64: string
  images: ImageProbe[]
  linksCsv: string
}

declare global {
  interface Window {
    __printHarness?: {
      exportDesign: (opts: BuildDesignOptions, qr?: QrAssignments) => Promise<ExportProbe>
      qrRegion: (materialId: string, backOption: BackOption) => { left: number; top: number; size: number }
      parseParams: (search: string) => { cardUrls: string[]; wpDomain?: string } | null
    }
  }
}

// Several 2024 × 1276 rasters plus a PDF per export — well past the 30 s default.
test.describe.configure({ timeout: 120_000 })

async function openHarness(page: Page) {
  await page.goto(HARNESS)
  await page.waitForFunction(() => !!window.__printHarness, undefined, { timeout: 20_000 })
}

async function exportDesign(page: Page, opts: BuildDesignOptions, qr?: QrAssignments): Promise<ExportProbe> {
  return page.evaluate(
    (args) => window.__printHarness!.exportDesign(args.opts, args.qr),
    { opts, qr },
  )
}

/** Bundle-root-relative paths of the real ZIP, so the archive itself is what is asserted. */
async function zipEntries(probe: ExportProbe): Promise<string[]> {
  const zip = await JSZip.loadAsync(Buffer.from(probe.zipBase64, 'base64'))
  const root = probe.zipFilename.replace(/\.zip$/, '')
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name.replace(`${root}/`, ''))
    .sort()
}

function probeFor(probe: ExportProbe, path: string): ImageProbe {
  const image = probe.images.find((candidate) => candidate.path === path)
  if (!image) throw new Error(`No print file at ${path} — got ${probe.images.map((i) => i.path).join(', ')}`)
  return image
}

const NAMED_CARDS = [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }, { name: 'Alan Turing' }]

test.describe('Print bundle', () => {
  test('plastic qr-name ×3 exports transparent PNGs, one back per card, csv and proof', async ({ page }) => {
    await openHarness(page)

    const probe = await exportDesign(page, {
      materialId: 'plastic',
      variationId: 'pvc-white',
      backOption: 'qr-name',
      cardData: NAMED_CARDS,
      designName: 'Print Test',
      frontText: 'ACME',
      // Same-origin stand-in for an upload, so `source/` is exercised without Supabase.
      frontImageUrl: 'http://localhost:5173/tests/fixtures/small-png.png',
      frontImageName: 'upload.png',
    })

    expect(await zipEntries(probe)).toEqual([
      'links.csv',
      'preview.pdf',
      'print/back-01-ada-lovelace.png',
      'print/back-02-grace-hopper.png',
      'print/back-03-alan-turing.png',
      'print/front.png',
      'source/upload.png',
    ])
    expect(probe.zipFilename).toBe('print-test-print-files.zip')

    // Every print file is a 600 DPI PNG — the supplier composites onto the card body.
    for (const image of probe.images) {
      expect(image.format, image.path).toBe('png')
      expect({ width: image.width, height: image.height }, image.path)
        .toEqual({ width: PRINT_WIDTH, height: PRINT_HEIGHT })
    }

    // Printed sides carry no background: the corner has to be fully transparent.
    const front = probeFor(probe, 'print/front.png')
    expect(front.corner[3]).toBe(0)
    expect(front.ink).toBeGreaterThan(0)

    // Each back renders its own card's name…
    const backs = probe.images.filter((image) => image.path.startsWith('print/back-'))
    for (const back of backs) {
      expect(back.corner[3], back.path).toBe(0)
      expect(back.ink, back.path).toBeGreaterThan(0)
      // …and none of them ships the placeholder.
      expect(back.placeholderInk, back.path).toBe(0)
    }

    const csv = probe.linksCsv.trim().split('\n')
    expect(csv[0]).toBe('card,name,ref,card_url,back_file,status')
    expect(csv).toHaveLength(4)
    expect(csv[1]).toBe('1,Ada Lovelace,,,print/back-01-ada-lovelace.png,no-qr')
    expect(probe.warnings.join(' ')).toContain('No QR codes')
  })

  test('full metal exports engraved JPEGs on white', async ({ page }) => {
    await openHarness(page)

    const probe = await exportDesign(page, {
      materialId: 'metal',
      variationId: 'metal-black-steel',
      backOption: 'qr-only',
      cardData: [{ name: '' }],
      designName: 'Metal Test',
      frontText: 'ACME',
    })

    expect(await zipEntries(probe)).toEqual([
      'links.csv',
      'preview.pdf',
      'print/back-01.jpg',
      'print/front.jpg',
    ])
    expect(probe.legacyPrintedMetal).toBe(false)

    for (const image of probe.images) {
      expect(image.format, image.path).toBe('jpeg')
      expect({ width: image.width, height: image.height }, image.path)
        .toEqual({ width: PRINT_WIDTH, height: PRINT_HEIGHT })
      // Engraved production art is black on an opaque white ground.
      const [r, g, b, a] = image.corner
      expect([r > 245, g > 245, b > 245, a], image.path).toEqual([true, true, true, 255])
    }

    const front = probeFor(probe, 'print/front.jpg')
    expect(front.ink).toBeGreaterThan(0)
    expect(probeFor(probe, 'print/back-01.jpg').placeholderInk).toBe(0)
  })

  /**
   * Every variation the shop sells, exported the way a real saved design arrives:
   * carrying the material photo on `canvas.backgroundImage`. That photo is how the
   * card *looks* in the editor, not artwork — `loadFromJSON` restores it and
   * `forceDarkObjects` can't reach it (it isn't in `getObjects()`), so it has to be
   * dropped explicitly or every print file ships a photograph of the blank card.
   *
   * Print-ready means, per side: engraved ⇒ opaque white JPEG with black artwork;
   * printed ⇒ fully transparent PNG for the supplier to composite onto the stock.
   */
  const VARIATIONS = [
    { materialId: 'plastic', variationId: 'pvc-white', image: '/materials/pvc-white-front.webp', front: 'printed', back: 'printed' },
    { materialId: 'plastic', variationId: 'pvc-black', image: '/materials/pvc-black-front.webp', front: 'printed', back: 'printed' },
    { materialId: 'bamboo', variationId: 'bamboo-natural', image: '/materials/bamboo-front.webp', front: 'printed', back: 'printed' },
    { materialId: 'metal', variationId: 'metal-black-steel', image: '/materials/metal-black-front.webp', front: 'engraved', back: 'engraved' },
    { materialId: 'metal', variationId: 'metal-black-gold', image: '/materials/metal-black-front.webp', front: 'engraved', back: 'engraved' },
    { materialId: 'metal', variationId: 'metal-brushed-silver', image: '/materials/metal-bs-front.webp', front: 'engraved', back: 'engraved' },
    { materialId: 'hybrid-metal', variationId: 'hybrid-metal-black-steel', image: '/materials/hybridmetal-black-front.webp', front: 'engraved', back: 'printed' },
    { materialId: '24k-gold', variationId: '24k-gold', image: '/materials/24kgold-front.webp', front: 'engraved', back: 'printed' },
  ] as const

  for (const variation of VARIATIONS) {
    test(`${variation.variationId} exports print-ready files`, async ({ page }) => {
      await openHarness(page)

      const probe = await exportDesign(page, {
        materialId: variation.materialId,
        variationId: variation.variationId,
        backOption: 'qr-only',
        cardData: [{ name: '' }],
        designName: `${variation.variationId} print ready`,
        frontText: 'ACME',
        materialImageUrl: variation.image,
      })

      const expectSide = (path: string, method: 'engraved' | 'printed') => {
        const image = probeFor(probe, path)
        expect({ width: image.width, height: image.height }, path)
          .toEqual({ width: PRINT_WIDTH, height: PRINT_HEIGHT })

        const [r, g, b, a] = image.corner
        if (method === 'engraved') {
          // Opaque white ground. The material photos are all mid-to-dark, so a
          // white corner is what proves the photo was dropped.
          expect({ format: image.format, white: r > 245 && g > 245 && b > 245, alpha: a }, path)
            .toEqual({ format: 'jpeg', white: true, alpha: 255 })
        } else {
          // Transparent, so the supplier composites onto the real stock. A leaked
          // photo shows up here as alpha 255.
          expect({ format: image.format, alpha: a }, path).toEqual({ format: 'png', alpha: 0 })
        }
      }

      const frontExt = variation.front === 'engraved' ? 'jpg' : 'png'
      const backExt = variation.back === 'engraved' ? 'jpg' : 'png'
      expectSide(`print/front.${frontExt}`, variation.front)
      expectSide(`print/back-01.${backExt}`, variation.back)

      // The opposite failure: dropping the artwork along with the photo.
      expect(probeFor(probe, `print/front.${frontExt}`).ink).toBeGreaterThan(0)
      expect(probeFor(probe, `print/back-01.${backExt}`).placeholderInk).toBe(0)
    })
  }

  test('hybrid metal engraves the front and prints the back', async ({ page }) => {
    await openHarness(page)

    const probe = await exportDesign(page, {
      materialId: 'hybrid-metal',
      variationId: 'hybrid-metal-black-steel',
      backOption: 'qr-name',
      cardData: [{ name: 'Ada Lovelace' }],
      designName: 'Hybrid Test',
      frontText: 'ACME',
    })

    expect(await zipEntries(probe)).toEqual([
      'links.csv',
      'preview.pdf',
      'print/back-01-ada-lovelace.png',
      'print/front.jpg',
    ])

    // The two sides disagree by design — `design_method` describes the front only.
    const front = probeFor(probe, 'print/front.jpg')
    expect(front.format).toBe('jpeg')
    expect(front.corner[3]).toBe(255)

    const back = probeFor(probe, 'print/back-01-ada-lovelace.png')
    expect(back.format).toBe('png')
    expect(back.corner[3]).toBe(0)
    expect(back.ink).toBeGreaterThan(0)
  })

  test('a design saved as printed metal exports printed, with a warning', async ({ page }) => {
    await openHarness(page)

    const probe = await exportDesign(page, {
      materialId: 'metal',
      variationId: 'metal-black-steel',
      backOption: 'qr-only',
      cardData: [{ name: '' }],
      designName: 'Legacy Test',
      // Metal + 'printed' can only come from a design saved before metal became
      // engrave-only: it ships as it was ordered rather than being re-cut.
      designMethod: 'printed',
      frontText: 'ACME',
    })

    expect(await zipEntries(probe)).toEqual([
      'links.csv',
      'preview.pdf',
      'print/back-01.png',
      'print/front.png',
    ])
    expect(probe.legacyPrintedMetal).toBe(true)
    expect(probe.warnings.join(' ')).toContain('printed metal')

    for (const image of probe.images) {
      expect(image.format, image.path).toBe('png')
      expect(image.corner[3], image.path).toBe(0)
    }
  })

  test('the QR placeholder never reaches the print files', async ({ page }) => {
    await openHarness(page)

    // A design whose back holds nothing but the placeholder: anything at all in the
    // output is the dashed rect or its label leaking into production artwork.
    const probe = await exportDesign(page, {
      materialId: 'plastic',
      variationId: 'pvc-white',
      backOption: 'qr-only',
      cardData: [{ name: '' }],
      designName: 'Blank Test',
    })

    // Both halves matter: the design had a placeholder, and the raster has none of it.
    expect(probe.backHasPlaceholder).toBe(true)
    expect(probe.warnings.join(' ')).not.toContain('No QR placeholder was found')

    const back = probeFor(probe, 'print/back-01.png')
    expect(back.placeholderInk).toBe(0)
    expect(back.ink).toBe(0)
    expect(probe.warnings.join(' ')).toContain('No QR codes')
  })

  test('qr-only back files are counted by QR URLs, not by designer quantity', async ({ page }) => {
    await openHarness(page)

    // The designer always holds a single card for `qr-only`; the order quantity
    // arrives as the URL count, and every card needs its own ref-stamped back.
    const probe = await exportDesign(
      page,
      {
        materialId: 'plastic',
        variationId: 'pvc-white',
        backOption: 'qr-only',
        cardData: [{ name: '' }],
        designName: 'Order Test',
        frontText: 'ACME',
      },
      {
        cardUrls: ['https://tap.example.com/r/AAA111', 'https://tap.example.com/r/BBB222'],
        orderRef: { order: '1042', item: '7', partnerSlug: 'Acme Partners' },
      },
    )

    expect(await zipEntries(probe)).toEqual([
      'links.csv',
      'preview.pdf',
      'print/back-01-AAA111.png',
      'print/back-02-BBB222.png',
      'print/front.png',
    ])
    // Order context names the bundle so it lands in the right Drive folder.
    // The line item is in the name: two NFC items on one order must not share a
    // Drive folder, or the second overwrites the first's front/preview/csv.
    expect(probe.zipFilename).toBe('Order-1042-item-7-acme-partners.zip')

    const csv = probe.linksCsv.trim().split('\n')
    expect(csv).toEqual([
      'card,name,ref,card_url,back_file,status',
      '1,,AAA111,https://tap.example.com/r/AAA111,print/back-01-AAA111.png,ok',
      '2,,BBB222,https://tap.example.com/r/BBB222,print/back-02-BBB222.png,ok',
    ])
  })
})

/**
 * The two domains on a production link do different jobs and must never be
 * confused: `d` is the partner's white-label *card* domain (where printed QR
 * codes resolve), `wp` is the ordering portal. The Drive write-back POSTs the
 * order ids and the live upload token, so sending it to `d` would hand a third
 * party the credential that mints Drive sessions.
 */
test.describe('Production link domains', () => {
  const parse = (page: Page, search: string) =>
    page.evaluate((s) => window.__printHarness!.parseParams(s), search)

  test.beforeEach(async ({ page }) => {
    await page.goto('/tests/helpers/print-harness.html')
    await page.waitForFunction(() => !!window.__printHarness)
  })

  test('the card domain is never used as a write-back target', async ({ page }) => {
    const params = await parse(page, '?d=app.partner.com&r=aaa111&order=99&item=7')
    expect(params?.cardUrls).toEqual(['https://app.partner.com/r/aaa111'])
    // Card URLs still built from `d` — but nothing to post to.
    expect(params?.wpDomain).toBeUndefined()
  })

  test('the portal comes from wp, normalised', async ({ page }) => {
    const params = await parse(page, '?d=app.partner.com&r=aaa111&wp=portal.example.com/')
    expect(params?.wpDomain).toBe('https://portal.example.com')
    expect(params?.cardUrls).toEqual(['https://app.partner.com/r/aaa111'])
  })
})
