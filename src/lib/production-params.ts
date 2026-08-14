/**
 * The production deep link: what WordPress puts in the URL when an admin clicks
 * "Production files" on an order line item, and what a human can hand-build.
 *
 * ```
 * Compact (built by WordPress):
 *   ?d=https%3A%2F%2Fapp.partner.com&r=ab12cd,ef34gh
 *   &order=1234&item=567&partner=acme-agency&exp=1765000000&token=<hmac hex>
 *
 * Manual / generic:
 *   ?qr=<encoded url>&qr=<encoded url>…
 *   ?production=1                        → empty panel, paste by hand
 * ```
 *
 * The query contract is frozen and mirrored by the WordPress side. Presence of any
 * of `d`, `qr` or `production` is what reveals the production panel; without them
 * this returns `null` and a customer sees an ordinary shared design.
 *
 * `token`/`exp` are opaque here — the app holds no secret and never validates them,
 * it only relays them to the Drive edge function and the WordPress write-back.
 *
 * Nothing in here is persisted: the link (or the pasted list) is the whole state.
 */

export interface ProductionParams {
  /** From `d`+`r` (compact) or repeated `qr=`. Index-paired to card rows. */
  cardUrls: string[]
  order?: string
  item?: string
  partnerSlug?: string
  exp?: number
  /** Opaque — relayed, never validated client-side. */
  token?: string
  /** Inputs that failed URL parsing. Surfaced to the operator, not silently dropped. */
  invalid: string[]
}

export interface CardUrlList {
  cardUrls: string[]
  invalid: string[]
}

/** Only these turn the panel on. */
const ACTIVATING_PARAMS = ['d', 'qr', 'production'] as const

/** Whether a string is a usable card URL: parses, and is http(s). */
export function isCardUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value.trim())
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Mirror of the WordPress `normalize_domain()`: assume https when the partner
 * domain arrives bare, and never leave a trailing slash to double up on `/r/`.
 */
function normalizeDomain(domain: string): string {
  const trimmed = domain.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

/**
 * The card URL for one ref, byte-for-byte what WordPress builds
 * (`normalize_domain($domain) . '/r/' . rawurlencode($ref)`) — the printed QR has
 * to resolve to exactly the link the ref pool hands out.
 */
export function buildCardUrl(domain: string, ref: string): string {
  return `${normalizeDomain(domain)}/r/${encodeURIComponent(ref.trim())}`
}

/** Split, trim and drop the blanks a pasted list always carries. */
function cleanEntries(values: string[], separator: RegExp): string[] {
  return values
    .flatMap((value) => value.split(separator))
    .map((value) => value.trim())
    .filter(Boolean)
}

function partition(candidates: string[]): CardUrlList {
  const cardUrls: string[] = []
  const invalid: string[] = []
  for (const candidate of candidates) {
    if (isCardUrl(candidate)) cardUrls.push(candidate)
    else invalid.push(candidate)
  }
  return { cardUrls, invalid }
}

/**
 * Validate the production panel's textarea: one card URL per line, blank lines and
 * stray whitespace filtered out, bad lines returned rather than dropped so the
 * operator can see which paste went wrong.
 */
export function parseCardUrlLines(text: string): CardUrlList {
  return partition(cleanEntries([text], /[\r\n]+/))
}

/** `null` ⇒ no production params present ⇒ render no panel. */
export function parseProductionParams(sp: URLSearchParams): ProductionParams | null {
  if (!ACTIVATING_PARAMS.some((key) => sp.has(key))) return null

  const candidates: string[] = []

  // Compact form: one domain, many refs. `r` may repeat as well as be comma-joined.
  const domain = sp.get('d')?.trim()
  if (domain) {
    for (const ref of cleanEntries(sp.getAll('r'), /,/)) {
      candidates.push(buildCardUrl(domain, ref))
    }
  }

  // Generic form: whole URLs, one per `qr=`.
  candidates.push(...cleanEntries(sp.getAll('qr'), /[\r\n]+/))

  const { cardUrls, invalid } = partition(candidates)
  const params: ProductionParams = { cardUrls, invalid }

  const order = sp.get('order')?.trim()
  if (order) params.order = order
  const item = sp.get('item')?.trim()
  if (item) params.item = item
  const partnerSlug = sp.get('partner')?.trim()
  if (partnerSlug) params.partnerSlug = partnerSlug
  const exp = Number(sp.get('exp'))
  if (sp.get('exp') && Number.isFinite(exp)) params.exp = exp
  const token = sp.get('token')?.trim()
  if (token) params.token = token

  return params
}

/**
 * The chip-encoding ref behind a card URL. Re-exported from the print export, which
 * is where the same value is stamped into back filenames and `links.csv` — one
 * implementation, so a panel label can never disagree with a filename.
 */
export { refFromCardUrl } from '@/lib/export-print'
