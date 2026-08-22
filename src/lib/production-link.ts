import { supabase, isSupabaseConfigured } from './supabase'
import { fetchWithTimeout } from './fetch-with-timeout'
import { buildCardUrl } from './production-params'

/**
 * The staff side of the production deep link (the `/production` page).
 *
 * WordPress builds these links for its own orders; this module builds the very
 * same link for everything else — direct sales, reprints, a partner who emailed
 * a list of refs. The token comes from `mint-production-token`, which signs with
 * the shared secret exactly as the plugin does, so `drive-upload` and the panel
 * cannot tell the two apart. Nothing here is persisted: the page's only state is
 * the staff key in `sessionStorage` and the link it hands back.
 */

const STAFF_KEY_STORAGE = 'nfc_production_staff_key'

function getEdgeFunctionUrl(name: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  return `${supabaseUrl}/functions/v1/${name}`
}

// Session-scoped on purpose: the key mints Drive-writing tokens, and a closed
// tab should not leave it behind for the next person at the machine.
export function getStaffKey(): string | null {
  try {
    return sessionStorage.getItem(STAFF_KEY_STORAGE)
  } catch {
    return null
  }
}

export function setStaffKey(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(STAFF_KEY_STORAGE, key)
    else sessionStorage.removeItem(STAFF_KEY_STORAGE)
  } catch {
    // Private mode — the key just has to be re-entered
  }
}

/** What `drive-upload` and the mint accept as an order / item id. */
export const PRODUCTION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

export class StaffKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StaffKeyError'
  }
}

export interface MintedToken {
  order: string
  item: string
  exp: number
  token: string
}

/**
 * Ask the server for a signed `{token, exp}`. A 403 means the key is wrong and
 * is thrown as `StaffKeyError` so the page can clear it and ask again.
 */
export async function mintProductionToken(order: string, item: string): Promise<MintedToken> {
  const key = getStaffKey()
  if (!key) throw new StaffKeyError('Enter the staff key first.')

  const res = await fetchWithTimeout(getEdgeFunctionUrl('mint-production-token'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ key, order, item }),
  }, 15_000)

  const data = await res.json().catch(() => ({}))
  if (res.status === 403) throw new StaffKeyError(data.error || 'Invalid staff key.')
  if (!res.ok) throw new Error(data.error || `Could not mint a production token (${res.status}).`)
  return data as MintedToken
}

export interface ProductionLinkInput {
  designId: string
  /** The partner's white-label card domain — where `/r/<ref>` resolves. */
  cardDomain: string
  /** Chip refs, one per card, in card order. */
  refs: string[]
  partnerSlug?: string
  minted: MintedToken
}

/**
 * The deep link in the compact `d`+`r` form WordPress uses, so refs land in the
 * back filenames and `links.csv`. With no refs the `production=1` switch opens
 * an empty panel to paste into. Never sets `wp` — there is no portal to post a
 * Drive link back to, and the panel already treats that as a finished job.
 */
export function buildProductionLink(input: ProductionLinkInput): string {
  const sp = new URLSearchParams()
  const domain = input.cardDomain.trim()
  const refs = input.refs.map((ref) => ref.trim()).filter(Boolean)

  if (domain && refs.length) {
    sp.set('d', domain)
    sp.set('r', refs.join(','))
  } else if (refs.length) {
    // Whole URLs pasted instead of refs: pass them through as-is.
    for (const ref of refs) sp.append('qr', ref)
  } else {
    sp.set('production', '1')
  }

  sp.set('order', input.minted.order)
  sp.set('item', input.minted.item)
  const partner = input.partnerSlug?.trim()
  if (partner) sp.set('partner', partner)
  sp.set('exp', String(input.minted.exp))
  sp.set('token', input.minted.token)

  return `${window.location.origin}/design/${input.designId}?${sp.toString()}`
}

/** Preview of what each ref becomes, for the form to show before minting. */
export function previewCardUrls(cardDomain: string, refs: string[]): string[] {
  const domain = cardDomain.trim()
  if (!domain) return []
  return refs.map((ref) => ref.trim()).filter(Boolean).map((ref) => buildCardUrl(domain, ref))
}

/** Split a pasted ref list on newlines, commas or whitespace. */
export function parseRefs(text: string): string[] {
  return text.split(/[\s,]+/).map((ref) => ref.trim()).filter(Boolean)
}

/** `SM-20260822` — a synthetic order ref for sales that never touched WordPress. */
export function defaultOrderRef(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `SM-${y}${m}${d}`
}

// ---------------------------------------------------------------------------
// Design list
// ---------------------------------------------------------------------------

export interface DesignSummary {
  design_id: string
  name: string | null
  material_id: string
  variation_id: string
  back_option: string
  quantity: number
  qr_removed: boolean | null
  created_at: string
  updated_at: string
}

export interface DesignFilters {
  /** Matches the name (case-insensitive) or an exact design id. */
  search?: string
  materialId?: string
  /** ISO dates (YYYY-MM-DD), inclusive. */
  createdFrom?: string
  createdTo?: string
  qrRemoved?: boolean
}

const LIST_COLUMNS =
  'design_id, name, material_id, variation_id, back_option, quantity, qr_removed, created_at, updated_at'
export const DESIGN_LIST_LIMIT = 100

/**
 * The most recently updated designs, filtered server-side. Reads the public select
 * policy directly — every design is already readable by id, and the columns here
 * carry no card-holder data.
 */
export async function listDesigns(filters: DesignFilters = {}): Promise<DesignSummary[]> {
  if (!isSupabaseConfigured() || !supabase) return []

  let query = supabase
    .from('designs')
    .select(LIST_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(DESIGN_LIST_LIMIT)

  const search = filters.search?.trim()
  if (search) {
    const escaped = search.replace(/[%_,]/g, '')
    query = /^[a-z0-9]{8}$/.test(search)
      ? query.or(`design_id.eq.${search},name.ilike.%${escaped}%`)
      : query.ilike('name', `%${escaped}%`)
  }
  if (filters.materialId) query = query.eq('material_id', filters.materialId)
  if (filters.createdFrom) query = query.gte('created_at', `${filters.createdFrom}T00:00:00Z`)
  if (filters.createdTo) query = query.lte('created_at', `${filters.createdTo}T23:59:59Z`)
  if (filters.qrRemoved !== undefined) query = query.eq('qr_removed', filters.qrRemoved)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as DesignSummary[]
}
