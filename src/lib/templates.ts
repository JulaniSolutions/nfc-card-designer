import { isSupabaseConfigured, supabase } from './supabase'
import { useDesignStore, type DesignMethod, type BackOption, type VariableField } from '@/store/design-store'
import { getMaterial, getVariation } from '@/config/materials'
import { isLegacyPrintedMetal } from './design-method'
import { fetchWithTimeout } from './fetch-with-timeout'
import { CUSTOM_PROPS } from './save-design'
import { addTemplateToHistory, removeTemplateFromHistory } from './template-history'
import { clearDraft, loadDraft } from './auto-save'
import { renderCanvasToImage } from './render-preview'

export interface Template {
  template_id: string
  name: string
  description: string | null
  material_id: string
  variation_id: string
  front_canvas_json: string | null
  back_canvas_json: string | null
  front_bg_color: string
  back_bg_color: string
  design_method: string
  back_option: string
  variable_fields: VariableField[] | null
  front_preview_url: string | null
  back_preview_url: string | null
  use_count: number
  created_at: string
  updated_at: string
}

function getEdgeFunctionUrl(name: string): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  return `${supabaseUrl}/functions/v1/${name}`
}

/** 8-char base36 short id, same shape and entropy profile as a design id. */
function generateTemplateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let id = ''
  for (let i = 0; i < 8; i++) id += chars[bytes[i] % chars.length]
  return id
}

/** 128-bit ownership secret. With no auth, this is the only thing gating edit/unpublish. */
function generateEditToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function slugifyTemplateName(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function buildTemplateUrl(templateId: string, name: string): string {
  const slug = slugifyTemplateName(name)
  const path = slug ? `/template/${templateId}/${slug}` : `/template/${templateId}`
  return `${window.location.origin}${path}`
}

/** Link that carries the edit token, so the author can manage the template from another device. */
export function buildManageUrl(templateId: string, editToken: string): string {
  return `${window.location.origin}/template/${templateId}?k=${encodeURIComponent(editToken)}`
}

/**
 * Strip anything personal or author-private from a canvas snapshot.
 *
 * The edge function repeats all of this — it is authoritative. Doing it here
 * too keeps the payload clean and means a server regression can't be the only
 * thing standing between a user and a leaked name.
 */
function sanitizeObject(obj: Record<string, unknown>, labelById: Map<string, string>): void {
  // The author's untouched source upload — not theirs to redistribute via a template.
  delete obj._originalAssetUrl
  // Pre-background-removal copy of the image, kept for undo. It is a full-resolution
  // data URL of the ORIGINAL photo, background and all — the part the author
  // deliberately cut out. It must never leave their browser.
  delete obj._originalSrc

  // Variable text renders the real card holder's value into the object.
  const variableId = obj._variableId as string | undefined
  if (variableId) {
    obj.text = labelById.get(variableId) ?? ''
  }

  // saveDesign swaps base64 image data for the Storage URL when it serialises
  // (save-design.ts), but it never writes that back to the live Fabric object —
  // so re-serialising here brings the multi-megabyte data URL back. Without this
  // pass a design that saved fine is rejected as "canvas data too large".
  const assetUrl = obj._assetUrl as string | undefined
  const src = obj.src as string | undefined
  if (assetUrl && typeof src === 'string' && src.startsWith('data:')) {
    obj.src = assetUrl
  }

  // Groups nest their own objects.
  const nested = obj.objects as Record<string, unknown>[] | undefined
  if (Array.isArray(nested)) {
    for (const child of nested) sanitizeObject(child, labelById)
  }
}

function sanitizeCanvasJson(json: string | null, variableFields: VariableField[]): string | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as { objects?: Record<string, unknown>[] }
    const labelById = new Map(variableFields.map((f) => [f.id, f.label]))
    for (const obj of parsed.objects ?? []) sanitizeObject(obj, labelById)
    return JSON.stringify(parsed)
  } catch {
    return json
  }
}

/**
 * Shrink a full-size card render (1012px wide PNG) into something that fits
 * alongside two canvas JSON blobs inside the 5MB edge function body limit.
 * 640px wide JPEG is plenty for link unfurls and gallery cards.
 */
const PREVIEW_WIDTH = 640

function downscaleDataUrl(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve(null), 5000)
    img.onload = () => {
      clearTimeout(timer)
      try {
        const scale = PREVIEW_WIDTH / (img.naturalWidth || img.width || PREVIEW_WIDTH)
        const canvas = document.createElement('canvas')
        canvas.width = PREVIEW_WIDTH
        canvas.height = Math.round((img.naturalHeight || img.height) * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => { clearTimeout(timer); resolve(null) }
    img.src = dataUrl
  })
}

export interface PublishTemplateInput {
  name: string
  description?: string
  turnstileToken?: string | null
  /** Set to re-publish over an existing template (same link, new snapshot). */
  templateId?: string
  editToken?: string
}

export interface PublishTemplateResult {
  templateId: string
  editToken: string
  url: string
}

/**
 * Publish the current design as a template.
 *
 * Requires an already-saved design: saveDesign() is what uploads images to
 * Storage and rewrites the canvas JSON to point at them, so publishing a
 * never-saved design would need a second copy of that whole pipeline.
 */
export async function publishTemplate(input: PublishTemplateInput): Promise<PublishTemplateResult> {
  if (!navigator.onLine) {
    throw new Error('You appear to be offline. Please check your internet connection and try again.')
  }
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.')
  }

  const state = useDesignStore.getState()
  if (!state.designId) {
    throw new Error('Save your design before publishing it as a template.')
  }

  // Snapshot the live canvases so the template matches what's on screen — but do
  // NOT route this through store.setCanvasJson, which flips hasUnsavedChanges on
  // any design that has a designId. Publishing is a read of the design, not an
  // edit to it; dirtying it would turn the header button into "Save Changes" and
  // start warning on tab close for a design nobody touched.
  const liveFront = window.__fabricCanvasFront
    ? JSON.stringify(window.__fabricCanvasFront.toObject(CUSTOM_PROPS))
    : state.frontCanvasJson
  const liveBack = window.__fabricCanvasBack
    ? JSON.stringify(window.__fabricCanvasBack.toObject(CUSTOM_PROPS))
    : state.backCanvasJson

  const frontJson = sanitizeCanvasJson(liveFront, state.variableFields)
  const backJson = sanitizeCanvasJson(liveBack, state.variableFields)

  // Mint the id and secret client-side, before the first attempt, so a retry
  // after a lost response updates the same row instead of publishing a second,
  // orphaned template whose edit token exists nowhere. saveDesign pins its short
  // id for the same reason.
  const templateId = input.templateId || generateTemplateId()
  const editToken = input.editToken || generateEditToken()

  // Previews power link unfurls and any future gallery. Never block publishing on them.
  let frontPreview: string | null = null
  let backPreview: string | null = null
  try {
    const [front, back] = await Promise.all([
      renderCanvasToImage(frontJson, state.frontBgColor, state.variationId, 'front'),
      renderCanvasToImage(backJson, state.backBgColor, state.variationId, 'back'),
    ])
    ;[frontPreview, backPreview] = await Promise.all([
      downscaleDataUrl(front),
      downscaleDataUrl(back),
    ])
  } catch {
    // previews are optional
  }

  const payload = {
    name: input.name,
    description: input.description || null,
    source_design_id: state.designId,
    material_id: state.materialId,
    variation_id: state.variationId,
    front_canvas_json: frontJson,
    back_canvas_json: backJson,
    front_bg_color: state.frontBgColor,
    back_bg_color: state.backBgColor,
    design_method: state.designMethod,
    back_option: state.backOption,
    variable_fields: state.variableFields,
    front_preview: frontPreview,
    back_preview: backPreview,
    turnstile_token: input.turnstileToken,
    template_id: templateId,
    edit_token: editToken,
    // Distinguishes "create this id" from "update the id I already own", so the
    // server can reject an edit token that doesn't match an existing row.
    is_new: !input.templateId,
  }

  // Record the token BEFORE the request. If the row commits but the response is
  // lost to a timeout, the template is live and this is the only copy of the
  // secret that can unpublish it.
  addTemplateToHistory({
    templateId,
    editToken,
    name: input.name,
    publishedAt: new Date().toISOString(),
    sourceDesignId: state.designId,
  })

  const res = await fetchWithTimeout(getEdgeFunctionUrl('publish-template'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  }, 45_000)

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to publish template' }))
    // A never-created template shouldn't linger in the local list, but a failed
    // RE-publish must keep its entry — the original is still live and owned.
    if (!input.templateId) removeTemplateFromHistory(templateId)
    throw new Error(err.error || `Failed to publish template (${res.status})`)
  }

  await res.json().catch(() => ({}))

  return {
    templateId,
    editToken,
    url: buildTemplateUrl(templateId, input.name),
  }
}

export async function unpublishTemplate(templateId: string, editToken: string): Promise<void> {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured.')

  const res = await fetchWithTimeout(getEdgeFunctionUrl('unpublish-template'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ template_id: templateId, edit_token: editToken }),
  }, 20_000)

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to unpublish template' }))
    throw new Error(err.error || `Failed to unpublish template (${res.status})`)
  }

  removeTemplateFromHistory(templateId)
}

/**
 * Fetch a published template. Reads go direct — the select policy is public.
 *
 * The column list is explicit and must stay that way: anon holds a column-level
 * grant, not a table-level one, so `select('*')` fails by design. edit_token_hash
 * and source_design_id are deliberately not readable.
 */
export async function loadTemplate(templateId: string): Promise<Template | null> {
  if (!isSupabaseConfigured() || !supabase) return null

  const { data, error } = await supabase
    .from('templates')
    .select('template_id, name, description, material_id, variation_id, front_canvas_json, back_canvas_json, front_bg_color, back_bg_color, design_method, back_option, variable_fields, front_preview_url, back_preview_url, use_count, created_at, updated_at')
    .eq('template_id', templateId)
    .single()

  if (error || !data) return null
  return data as Template
}

export interface ApplyTemplateResult {
  /** Non-fatal problems the user should see (material retired, out of stock, ...). */
  warning: string | null
}

/**
 * True if forking would destroy work the user hasn't saved to the server.
 *
 * Must consider the localStorage draft, not just the store. A template link
 * opened cold — pasted into a fresh tab, or followed from an email — is a full
 * page load, so the store is at its defaults and only the draft holds the
 * previous session's unsaved design. Checking the store alone let the fork
 * proceed silently and then clearDraft() destroyed the draft unrecoverably.
 */
export function hasUnsavedWork(): boolean {
  const state = useDesignStore.getState()
  const storeHasWork =
    Boolean(state.frontCanvasJson || state.backCanvasJson) &&
    (!state.designId || state.hasUnsavedChanges)
  return storeHasWork || loadDraft() !== null
}

/**
 * Fork a template into the editor as a fresh unsaved design.
 *
 * Callers must populate the store BEFORE mounting DesignerPage — CardCanvas
 * reads the store on its init effect. Setting state into an already-mounted
 * editor races the material effects (wave icon / QR placeholder) and needs the
 * deferred-load hack that restoreDraft carries.
 */
export function applyTemplateToStore(template: Template): ApplyTemplateResult {
  let warning: string | null = null

  // Materials can be retired or go out of stock long after a template is published.
  let materialId = template.material_id
  let variationId = template.variation_id
  const material = getMaterial(materialId)
  const variation = getVariation(variationId)

  if (!material || !variation) {
    materialId = 'plastic'
    variationId = 'pvc-white'
    warning = 'The material this template used is no longer available, so it opened in Matte White PVC.'
  } else if (variation.inStock === false) {
    warning = `${variation.name} is currently out of stock — you can still design with it.`
  }

  // Passed through as published. The editor clamps it to what the material allows
  // on entry, and converts the artwork if the template predates engrave-only metal.
  const designMethod = (template.design_method as DesignMethod) || 'printed'

  if (isLegacyPrintedMetal(materialId, designMethod)) {
    warning = warning
      ? `${warning} It has also been converted to engraved, as printed metal is no longer available.`
      : 'This template was made when metal could be printed, so it has been converted to engraved.'
  }

  clearDraft()

  useDesignStore.getState().loadFromTemplate({
    materialId,
    variationId,
    frontCanvasJson: template.front_canvas_json,
    backCanvasJson: template.back_canvas_json,
    frontBgColor: template.front_bg_color,
    backBgColor: template.back_bg_color,
    designName: template.name ? `${template.name} (copy)` : '',
    designMethod,
    backOption: (template.back_option as BackOption) || 'qr-only',
    variableFields: template.variable_fields ?? undefined,
    sourceTemplateId: template.template_id,
  })

  return { warning }
}
