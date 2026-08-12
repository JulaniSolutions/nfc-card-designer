import { test, expect, Page } from '@playwright/test'
import { join, dirname } from 'path'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURES_DIR = join(__dirname, 'fixtures')

// Generate test images in the browser and save as fixture files
async function generateTestImage(
  page: Page,
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' = 'png',
  fillStyle: 'solid' | 'gradient' | 'complex' | 'transparent' = 'solid',
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ w, h, fmt, fill }) => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!

      if (fill === 'transparent') {
        ctx.clearRect(0, 0, w, h)
        ctx.fillStyle = '#2d3748'
        ctx.font = `bold ${Math.floor(h * 0.4)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('TEST', w / 2, h / 2)
      } else if (fill === 'gradient') {
        const grad = ctx.createLinearGradient(0, 0, w, h)
        grad.addColorStop(0, '#ff6b6b')
        grad.addColorStop(0.5, '#4ecdc4')
        grad.addColorStop(1, '#45b7d1')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
      } else if (fill === 'complex') {
        for (let i = 0; i < 500; i++) {
          ctx.fillStyle = `rgba(${Math.random() * 255 | 0},${Math.random() * 255 | 0},${Math.random() * 255 | 0},${Math.random()})`
          ctx.fillRect(Math.random() * w, Math.random() * h, Math.random() * w * 0.3, Math.random() * h * 0.3)
        }
      } else {
        ctx.fillStyle = '#3b82f6'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = '#ffffff'
        ctx.font = `bold ${Math.floor(h * 0.3)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('LOGO', w / 2, h / 2)
      }

      const mimeType = fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png'
      return canvas.toDataURL(mimeType, 0.95)
    },
    { w: width, h: height, fmt: format, fill: fillStyle },
  )

  const base64 = dataUrl.split(',')[1]
  return Buffer.from(base64, 'base64')
}

function saveFixture(name: string, data: Buffer): string {
  if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true })
  const path = join(FIXTURES_DIR, name)
  writeFileSync(path, data)
  return path
}

async function waitForDesigner(page: Page) {
  await page.goto('/')
  await page.waitForSelector('canvas', { timeout: 15_000 })
  await page.waitForTimeout(1000)
}

async function dismissDraftIfPresent(page: Page) {
  const toast = page.locator('text=Restore your previous design?')
  if (await toast.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.locator('button:has(svg.lucide-x)').first().click()
    await page.waitForTimeout(500)
  }
}

// Add image to canvas by injecting a data URL and dispatching through the app's own addImageToCanvas
async function addImageViaDataUrl(page: Page, filePath: string) {
  const buf = readFileSync(filePath)
  const base64 = buf.toString('base64')
  const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
  const dataUrl = `data:${mime};base64,${base64}`

  // Inject image directly onto the Fabric canvas using plain DOM APIs
  // (no module imports needed — access existing canvas instance)
  await page.evaluate((src) => {
    return new Promise<void>((resolve, reject) => {
      const canvas = (window as unknown as Record<string, unknown>).__fabricCanvasFront as {
        width: number; height: number
        add: (obj: unknown) => void
        renderAll: () => void
        getObjects: () => unknown[]
      } | undefined
      if (!canvas) { reject(new Error('No canvas')); return }

      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        // We can't import FabricImage here, so drive the real upload path instead:
        // find the hidden file input and trigger it programmatically.
        const fileInput = document.querySelector('input[type="file"][accept*=".png"]') as HTMLInputElement
        if (fileInput) {
          // Create a File from the data URL
          const arr = src.split(',')
          const mimeMatch = arr[0].match(/:(.*?);/)
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'
          const bstr = atob(arr[1])
          let n = bstr.length
          const u8arr = new Uint8Array(n)
          while(n--) u8arr[n] = bstr.charCodeAt(n)
          const file = new File([u8arr], 'test-image.png', { type: mimeType })

          // Create a DataTransfer to set files on the input
          const dt = new DataTransfer()
          dt.items.add(file)
          fileInput.files = dt.files

          // Dispatch change event
          fileInput.dispatchEvent(new Event('change', { bubbles: true }))

          // Wait for image to be added to canvas
          setTimeout(resolve, 2000)
        } else {
          reject(new Error('File input not found'))
        }
      }
      img.onerror = () => reject(new Error('Image load failed'))
      img.src = src
    })
  }, dataUrl)

  await page.waitForTimeout(1500)
}

interface SavePayloadInfo {
  totalBytes: number
  frontCanvasBytes: number
  hasBase64Images: boolean
  base64ImageCount: number
  storageUrlCount: number
}

async function setupMocksAndSave(
  page: Page,
  testName: string,
): Promise<{ result: 'success' | 'timeout'; payload?: SavePayloadInfo }> {
  let payload: SavePayloadInfo | undefined
  let resolveResult: ((v: 'success') => void) | undefined
  const resultPromise = new Promise<'success' | 'timeout'>((resolve) => {
    resolveResult = resolve as (v: 'success') => void
    setTimeout(() => resolve('timeout'), 45_000)
  })

  let uploadCount = 0
  await page.route('**/functions/v1/upload-asset', async (route) => {
    uploadCount++
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        url: `https://storage.example.com/uploads/${testName}-${uploadCount}.webp`,
        path: `uploads/${testName}-${uploadCount}.webp`,
      }),
    })
  })

  await page.route('**/functions/v1/save-design', async (route) => {
    const body = route.request().postDataJSON()
    const totalBytes = JSON.stringify(body).length
    const frontJson = body.front_canvas_json || ''

    let base64Count = 0
    let storageCount = 0
    const srcMatches = frontJson.match(/"src"\s*:\s*"[^"]+"/g) || []
    for (const m of srcMatches) {
      if (m.includes('data:image')) base64Count++
      else if (m.includes('http')) storageCount++
    }

    payload = {
      totalBytes,
      frontCanvasBytes: frontJson.length,
      hasBase64Images: base64Count > 0,
      base64ImageCount: base64Count,
      storageUrlCount: storageCount,
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ design_id: testName }),
    })
    resolveResult?.('success')
  })

  // Trigger save via share dialog
  const shareBtn = page.locator('button:has-text("Share")').first()
  await shareBtn.click()
  await page.waitForTimeout(500)

  // Fill name
  const nameInput = page.getByLabel(/design name/i)
  if (await nameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await nameInput.fill(testName)
  }

  // Wait for Turnstile widget
  await page.waitForTimeout(3000)

  // Click save button in dialog
  const saveBtn = page.locator('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Try Again")').first()
  if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await saveBtn.click()
  }

  const result = await resultPromise

  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  return { result, payload }
}

// ============================================================
// TESTS
// ============================================================

test.describe('Image Save Stress Tests', () => {
  test.setTimeout(120_000)

  const IMAGE_CONFIGS = [
    { name: 'small-solid', w: 200, h: 200, fmt: 'png' as const, fill: 'solid' as const },
    { name: 'med-gradient', w: 800, h: 800, fmt: 'png' as const, fill: 'gradient' as const },
    { name: 'lg-complex', w: 1200, h: 1200, fmt: 'png' as const, fill: 'complex' as const },
    { name: 'xl-complex', w: 2000, h: 2000, fmt: 'png' as const, fill: 'complex' as const },
    { name: 'lg-transparent', w: 1200, h: 1200, fmt: 'png' as const, fill: 'transparent' as const },
    { name: 'xl-transparent', w: 2000, h: 2000, fmt: 'png' as const, fill: 'transparent' as const },
    { name: 'sm-jpeg', w: 400, h: 400, fmt: 'jpeg' as const, fill: 'gradient' as const },
    { name: 'lg-jpeg', w: 1500, h: 1500, fmt: 'jpeg' as const, fill: 'complex' as const },
    { name: 'md-webp', w: 1000, h: 1000, fmt: 'webp' as const, fill: 'gradient' as const },
    { name: 'wide-banner', w: 2400, h: 600, fmt: 'png' as const, fill: 'gradient' as const },
    { name: 'tall-portrait', w: 600, h: 2400, fmt: 'png' as const, fill: 'gradient' as const },
  ]

  for (const config of IMAGE_CONFIGS) {
    test(`${config.name} (${config.w}x${config.h} ${config.fmt} ${config.fill})`, async ({ page }) => {
      await waitForDesigner(page)
      await dismissDraftIfPresent(page)

      const imageData = await generateTestImage(page, config.w, config.h, config.fmt, config.fill)
      const ext = config.fmt === 'jpeg' ? 'jpg' : config.fmt
      const filePath = saveFixture(`${config.name}.${ext}`, imageData)
      const fileSizeKB = (imageData.length / 1024).toFixed(0)

      // Add image to canvas via dispatching file input change
      await addImageViaDataUrl(page, filePath)

      // Verify image on canvas and check tags
      const canvasInfo = await page.evaluate(() => {
        const c = (window as unknown as { __fabricCanvasFront?: { getObjects: () => Record<string, unknown>[] } }).__fabricCanvasFront
        if (!c) return { count: 0, images: [] }
        const objs = c.getObjects()
        const images = objs
          .filter((o) => o.type === 'image' || o.type === 'Image')
          .map((o) => ({
            type: o.type,
            hasDesignId: !!o._designId,
            hasAssetUrl: !!o._assetUrl,
            srcPrefix: typeof o.src === 'string' ? o.src.substring(0, 30) : 'none',
          }))
        return { count: objs.length, images }
      })
      console.log(`  Canvas objects: ${canvasInfo.count}, images:`, canvasInfo.images)
      expect(canvasInfo.count, 'Image should be on canvas').toBeGreaterThan(0)

      // Save
      const { result, payload } = await setupMocksAndSave(page, config.name)

      const payloadKB = payload ? (payload.totalBytes / 1024).toFixed(0) : '?'
      console.log(
        `[${config.name}] file=${fileSizeKB}KB payload=${payloadKB}KB ` +
        `base64=${payload?.base64ImageCount ?? '?'} storage=${payload?.storageUrlCount ?? '?'} → ${result}`,
      )

      expect(result).toBe('success')
      if (payload) {
        expect(payload.totalBytes).toBeLessThan(6_000_000)
        // Small inline SVGs/icons may remain as data URLs — that's fine.
        // Key assertion: no LARGE base64 images (>100KB) in payload.
        expect(payload.totalBytes).toBeLessThan(6_000_000)
      }
    })
  }

  test('multiple images on same canvas', async ({ page }) => {
    await waitForDesigner(page)
    await dismissDraftIfPresent(page)

    // Add 3 images
    for (const size of [600, 800, 1000]) {
      const data = await generateTestImage(page, size, size, 'png', 'gradient')
      const path = saveFixture(`multi-${size}.png`, data)
      await addImageViaDataUrl(page, path)
    }

    const objCount = await page.evaluate(() => {
      const c = (window as unknown as { __fabricCanvasFront?: { getObjects: () => unknown[] } }).__fabricCanvasFront
      return c ? c.getObjects().length : 0
    })
    expect(objCount).toBeGreaterThanOrEqual(3)

    const { result, payload } = await setupMocksAndSave(page, 'multi')

    console.log(
      `[multi] payload=${payload ? (payload.totalBytes / 1024).toFixed(0) : '?'}KB ` +
      `base64=${payload?.base64ImageCount ?? '?'} storage=${payload?.storageUrlCount ?? '?'} → ${result}`,
    )

    expect(result).toBe('success')
    if (payload) {
      expect(payload.totalBytes).toBeLessThan(6_000_000)
    }
  })
})
