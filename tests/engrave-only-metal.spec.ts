import { test, expect, Page } from '@playwright/test'

// Metal is engrave-only: printing on it is no longer offered. These cover the
// removal itself plus the legacy path, where designs saved as printed metal
// before the change still have to open, convert and render sensibly.

const METAL_MATERIALS = ['Full Metal', 'Hybrid Metal', '24k Gold']

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

test.describe('Metal is engrave-only', () => {
  for (const material of METAL_MATERIALS) {
    test(`${material} offers no design method choice`, async ({ page }) => {
      await waitForDesigner(page)
      await dismissDraftIfPresent(page)
      await selectMaterial(page, material)

      // The old toggle is gone entirely — neither option is clickable anywhere.
      await expect(page.getByRole('button', { name: 'Printed', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Engraved', exact: true })).toHaveCount(0)
      // …replaced by a statement of the finish.
      await expect(page.getByText('Laser engraved', { exact: true })).toBeVisible()
    })
  }

  test('plastic stays printed and never gains an engraved option', async ({ page }) => {
    await waitForDesigner(page)
    await dismissDraftIfPresent(page)
    await selectMaterial(page, 'Plastic')

    await expect(page.getByText('Laser engraved', { exact: true })).toHaveCount(0)
    const method = await page.evaluate(() => localStorage.getItem('nfc_draft_design'))
    expect(method === null || JSON.parse(method).designMethod === 'printed').toBeTruthy()
  })

  test('text added on metal is locked to the engraved colour', async ({ page }) => {
    await waitForDesigner(page)
    await dismissDraftIfPresent(page)
    await selectMaterial(page, 'Full Metal')

    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.waitForTimeout(500)

    // The layers panel exposes no colour input in engraved mode.
    await expect(page.getByText('Color locked to engraved finish').first()).toBeVisible()
    await expect(page.locator('input[type="color"]')).toHaveCount(0)
  })

  test('switching plastic → metal → plastic keeps a custom text colour', async ({ page }) => {
    await waitForDesigner(page)
    await dismissDraftIfPresent(page)
    await selectMaterial(page, 'Plastic')

    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.waitForTimeout(500)

    // The hex field beside the swatch — a plain text input, so fill() drives the
    // same React onChange a user's typing would.
    await page.locator('input[maxlength="7"]').first().fill('#ff0000')
    await page.waitForTimeout(300)

    const beforeSwitch = await page.evaluate(() => {
      const canvas = window.__fabricCanvasFront
      const text = canvas?.getObjects().find((o) => o.type === 'textbox')
      return text?.fill as string | undefined
    })
    expect(beforeSwitch?.toLowerCase()).toBe('#ff0000')

    await selectMaterial(page, 'Full Metal')
    await selectMaterial(page, 'Plastic')

    // Without the saved-print-colour lookup the text would come back black, since
    // the toggle that used to restore it no longer exists.
    const fill = await page.evaluate(() => {
      const canvas = window.__fabricCanvasFront
      const text = canvas?.getObjects().find((o) => o.type === 'textbox')
      return text?.fill as string | undefined
    })
    expect(fill?.toLowerCase()).toBe('#ff0000')
  })

  test('a default text colour is not carried across cards of different contrast', async ({ page }) => {
    await waitForDesigner(page)
    await dismissDraftIfPresent(page)
    await selectMaterial(page, 'Plastic')
    // Matte Black: default text is white.
    await page.getByText('Matte Black', { exact: true }).click()
    await page.waitForTimeout(400)

    await page.getByRole('button', { name: 'Text', exact: true }).click()
    await page.waitForTimeout(500)

    await selectMaterial(page, 'Full Metal')
    await selectMaterial(page, 'Plastic')
    // Matte White is the first variation, selected automatically.
    await page.waitForTimeout(400)

    // Only a colour the user picked is worth restoring. Restoring the black
    // card's white default here would leave the text invisible on a white card.
    const fill = await page.evaluate(() => {
      const canvas = window.__fabricCanvasFront
      const text = canvas?.getObjects().find((o) => o.type === 'textbox')
      return text?.fill as string | undefined
    })
    expect(fill?.toLowerCase()).toBe('#000000')
  })
})

test.describe('Designs saved before metal became engrave-only', () => {
  const legacyDesign = {
    design_id: 'legacy01',
    name: 'Legacy printed metal',
    material_id: 'metal',
    variation_id: 'metal-black-steel',
    front_canvas_json: JSON.stringify({
      version: '6.6.1',
      objects: [{
        type: 'Textbox',
        left: 100,
        top: 100,
        width: 300,
        height: 50,
        text: 'LEGACY',
        fontSize: 36,
        fill: '#ff0000',
      }],
    }),
    back_canvas_json: null,
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

  async function mockDesignFetch(page: Page) {
    await page.route('**/rest/v1/designs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(legacyDesign),
      })
    })
  }

  test('the read-only share page still shows them as printed', async ({ page }) => {
    await mockDesignFetch(page)
    await page.goto('/design/legacy01')
    await page.waitForSelector('text=Legacy printed metal', { timeout: 15_000 })

    // Grandfathered: what was ordered is what is shown.
    await expect(page.getByText('printed', { exact: true })).toBeVisible()
  })

  test('opening one for editing converts it to engraved and says so', async ({ page }) => {
    await mockDesignFetch(page)
    await page.goto('/design/legacy01')
    await page.waitForSelector('text=Legacy printed metal', { timeout: 15_000 })

    await page.getByRole('button', { name: /Edit Design/ }).click()
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.waitForTimeout(1500)

    await expect(page.getByText(/Printed metal is no longer available/)).toBeVisible()

    // The flag flipped *and* the artwork followed it — a flag-only change would
    // leave the text red while the editor claimed it was engraved.
    const fill = await page.evaluate(() => {
      const canvas = window.__fabricCanvasFront
      const text = canvas?.getObjects().find((o) => o.type === 'textbox')
      return text?.fill as string | undefined
    })
    expect(fill?.toLowerCase()).toBe('#c0c0c0')
  })

  test('undo cannot walk back to the printed artwork', async ({ page }) => {
    await mockDesignFetch(page)
    await page.goto('/design/legacy01')
    await page.waitForSelector('text=Legacy printed metal', { timeout: 15_000 })
    await page.getByRole('button', { name: /Edit Design/ }).click()
    await page.waitForSelector('canvas', { timeout: 15_000 })
    await page.waitForTimeout(1500)

    await page.keyboard.press('Control+z')
    await page.waitForTimeout(600)

    // The printed state predates a change the user cannot reverse, so it must not
    // be reachable — otherwise it is what gets saved under an engraved flag.
    const fill = await page.evaluate(() => {
      const canvas = window.__fabricCanvasFront
      const text = canvas?.getObjects().find((o) => o.type === 'textbox')
      return text?.fill as string | undefined
    })
    expect(fill?.toLowerCase()).toBe('#c0c0c0')
  })
})
