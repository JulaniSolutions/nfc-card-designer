import type { Page } from '@playwright/test'

/**
 * A seeded `designs` row served to `/design/:id`, without Supabase.
 *
 * The production panel (PLAN-02) only exists on a *saved* design, so testing it
 * means loading one — and this environment has no `.env`, which leaves
 * `src/lib/supabase.ts` exporting `null` and the shared page erroring out before
 * any of the app under test runs. Ordinary network interception cannot fix that:
 * with no URL there is no request to intercept.
 *
 * So the interception happens one level up, at the Vite dev server's module
 * response for `/src/lib/supabase.ts`. The stub keeps that module's whole export
 * surface (`supabase`, `isSupabaseConfigured`) and answers the single query
 * `loadDesign` makes — `.from('designs').select('*').eq('design_id', id).single()`
 * — from rows seeded into the page. Everything downstream is the real app: the
 * real route, the real row → store mapping in `save-design.ts`, the real
 * `DesignPreview`, the real panel.
 */

const MODULE_PATH = '/src/lib/supabase.ts'

/** Only the shape `save-design.ts` actually calls. */
const STUB_MODULE = `
const rows = () => (window.__seededDesignRows ?? {})
const answer = (row) => ({ data: row ?? null, error: row ? null : { message: 'Row not found' } })

export const supabase = {
  from() {
    return {
      select() {
        return {
          eq(_column, value) {
            return {
              single: async () => answer(rows()[value]),
              maybeSingle: async () => answer(rows()[value]),
            }
          },
        }
      },
    }
  },
}

export function isSupabaseConfigured() {
  return true
}
`

/**
 * Serve `rows` (keyed by `design_id`) to the app for the rest of this page's life.
 * Call before `page.goto` — both the seed and the module stub have to be in place
 * before the app's first import.
 */
export async function stubSupabaseDesigns(
  page: Page,
  rows: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((seeded) => {
    ;(window as unknown as { __seededDesignRows: unknown }).__seededDesignRows = seeded
  }, rows)

  await page.route(
    (url) => url.pathname === MODULE_PATH,
    (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: STUB_MODULE }),
  )
}
