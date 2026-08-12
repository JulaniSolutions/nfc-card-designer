import { test, expect, Page } from '@playwright/test'

// Metal materials do not all engrave both sides. Full Metal engraves the back too
// (backAlwaysEngraved), while Hybrid Metal and 24k Gold have a printed back. The
// design method describes the FRONT, so anything applying engraved styling has to
// ask per side — src/config/materials.ts `isSideEngraved`.
//
// export-pdf.ts has always keyed its production back pages off isBackEngraved, so
// a back styled from the design method put the screen and the PDF at odds.

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

async function selectMaterial(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click()
  await page.waitForTimeout(500)
}

/**
 * Click the back card so it becomes the side the Elements panel adds to.
 * Targets `.canvas-container` rather than `canvas`: Fabric renders two canvas
 * elements per instance, so `canvas` nth(1) is still the front.
 */
async function activateBack(page: Page) {
  await page.locator('.canvas-container').nth(1).click({ position: { x: 10, y: 10 } })
  await page.waitForTimeout(300)
  await expect(page.getByText('— adds to Back')).toBeVisible()
}

async function addTextToActiveSide(page: Page) {
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await page.waitForTimeout(500)
}

function readSideFill(page: Page, side: 'front' | 'back') {
  return page.evaluate((s) => {
    const canvas = s === 'front' ? window.__fabricCanvasFront : window.__fabricCanvasBack
    const text = canvas?.getObjects().find((o) => o.type === 'textbox')
    return text?.fill as string | undefined
  }, side)
}

test.describe('Backs that are printed are not engraved', () => {
  test('Hybrid Metal: back text takes the print colour, front takes the engraved colour', async ({ page }) => {
    await waitForDesigner(page)
    await dismissDraftIfPresent(page)
    await selectMaterial(page, 'Hybrid Metal')

    await addTextToActiveSide(page)
    expect((await readSideFill(page, 'front'))?.toLowerCase()).toBe('#c0c0c0')

    await activateBack(page)
    await addTextToActiveSide(page)
    // hybrid-metal-black-steel: engravedColor #C0C0C0, defaultPrintColor #FFFFFF.
    expect((await readSideFill(page, 'back'))?.toLowerCase()).toBe('#ffffff')
  })

  test('24k Gold: back text takes the print colour', async ({ page }) => {
    await waitForDesigner(page)
    await dismissDraftIfPresent(page)
    await selectMaterial(page, '24k Gold')

    await activateBack(page)
    await addTextToActiveSide(page)
    // 24k-gold: engravedColor #4E4743, defaultPrintColor #000000.
    expect((await readSideFill(page, 'back'))?.toLowerCase()).toBe('#000000')
  })

  test('Full Metal: back text stays engraved, because its back is engraved', async ({ page }) => {
    await waitForDesigner(page)
    await dismissDraftIfPresent(page)
    await selectMaterial(page, 'Full Metal')

    await activateBack(page)
    await addTextToActiveSide(page)
    expect((await readSideFill(page, 'back'))?.toLowerCase()).toBe('#c0c0c0')
  })

  test('the colour picker follows the side, not the design method', async ({ page }) => {
    await waitForDesigner(page)
    await dismissDraftIfPresent(page)
    await selectMaterial(page, 'Hybrid Metal')

    await addTextToActiveSide(page)
    await expect(page.getByText('Color locked to engraved finish').first()).toBeVisible()

    await activateBack(page)
    await addTextToActiveSide(page)
    // The back prints, so its colour is the user's to choose.
    await expect(page.locator('input[maxlength="7"]')).not.toHaveCount(0)
  })

  test('switching Full Metal → Hybrid Metal releases the back to print colours', async ({ page }) => {
    await waitForDesigner(page)
    await dismissDraftIfPresent(page)
    await selectMaterial(page, 'Full Metal')

    await addTextToActiveSide(page)
    await activateBack(page)
    await addTextToActiveSide(page)
    // Full Metal engraves both sides.
    expect((await readSideFill(page, 'front'))?.toLowerCase()).toBe('#c0c0c0')
    expect((await readSideFill(page, 'back'))?.toLowerCase()).toBe('#c0c0c0')

    await selectMaterial(page, 'Hybrid Metal')
    expect((await readSideFill(page, 'back'))?.toLowerCase()).toBe('#ffffff')
    // …and the front is still engraved.
    expect((await readSideFill(page, 'front'))?.toLowerCase()).toBe('#c0c0c0')
  })
})

test.describe('Legacy printed metal with a printed back', () => {
  const legacyHybrid = {
    design_id: 'legacyhy',
    name: 'Legacy printed hybrid',
    material_id: 'hybrid-metal',
    variation_id: 'hybrid-metal-black-steel',
    front_canvas_json: JSON.stringify({
      version: '6.6.1',
      objects: [{
        type: 'Textbox', left: 100, top: 100, width: 300, height: 50,
        text: 'FRONT', fontSize: 36, fill: '#ff0000',
      }],
    }),
    back_canvas_json: JSON.stringify({
      version: '6.6.1',
      objects: [{
        type: 'Textbox', left: 100, top: 100, width: 300, height: 50,
        text: 'BACK', fontSize: 36, fill: '#ff0000',
      }],
    }),
    front_bg_color: '#ffffff',
    back_bg_color: '#ffffff',
    design_method: 'printed',
    back_option: 'qr-only',
    card_names: [''],
    variable_fields: [{ id: 'name', label: 'Name' }],
    card_data: [{ name: '' }],
    quantity: 1,
    source_template_id: null,
  }

  test('converts the engraved front but leaves the printed back alone', async ({ page }) => {
    await page.route('**/rest/v1/designs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(legacyHybrid),
      })
    })

    await page.goto('/design/legacyhy')
    await page.waitForSelector('text=Legacy printed hybrid', { timeout: 15_000 })
    await page.getByRole('button', { name: /Edit Design/ }).click()
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.waitForTimeout(1500)

    // Front is engrave-only now, so it converts.
    expect((await readSideFill(page, 'front'))?.toLowerCase()).toBe('#c0c0c0')
    // The back always printed on this material, so the saved artwork is still
    // valid and must survive untouched.
    expect((await readSideFill(page, 'back'))?.toLowerCase()).toBe('#ff0000')
  })
})
