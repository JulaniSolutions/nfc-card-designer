import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { loadTemplate, applyTemplateToStore, hasUnsavedWork, unpublishTemplate, type Template } from '@/lib/templates'
import { addTemplateToHistory, getEditToken } from '@/lib/template-history'
import { isSupabaseConfigured } from '@/lib/supabase'
import { DesignPreview } from '@/components/preview/DesignPreview'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import type { BackOption, DesignMethod } from '@/store/design-store'
import { CreditCard, Loader2, KeyRound, Trash2 } from 'lucide-react'

export function TemplatePage() {
  const { id } = useParams<{ id: string }>()
  // Keyed on the id so navigating to a different template remounts with fresh
  // loading/error state instead of resetting it from an effect.
  return <TemplateView key={id ?? ''} id={id} />
}

function TemplateView({ id }: { id: string | undefined }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [template, setTemplate] = useState<Template | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [unpublishError, setUnpublishError] = useState<string | null>(null)

  // The manage link carries the ownership secret: /template/:id?k=<editToken>.
  // Without reading it here the token is inert and a template published from a
  // browser whose localStorage was cleared could never be taken down.
  const tokenFromLink = searchParams.get('k')
  const editToken = tokenFromLink || (id ? getEditToken(id) : null)

  useEffect(() => {
    if (!id) {
      navigate('/')
      return
    }

    let cancelled = false

    async function load(templateId: string): Promise<{ template: Template | null; error: string | null }> {
      if (!isSupabaseConfigured()) return { template: null, error: 'Supabase is not configured' }
      // The select policy hides unpublished rows, so "removed" and "never existed"
      // both arrive here as null.
      const found = await loadTemplate(templateId)
      return { template: found, error: found ? null : 'Template not available' }
    }

    load(id).then((result) => {
      if (cancelled) return
      setError(result.error)
      setTemplate(result.template)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [id, navigate])

  // A manage link opened on a new device is the author recovering ownership —
  // remember the token so the Templates list works here too. Only do this once
  // the template resolves, so a bogus ?k= doesn't litter localStorage.
  useEffect(() => {
    if (!id || !tokenFromLink || !template) return
    addTemplateToHistory({
      templateId: id,
      editToken: tokenFromLink,
      name: template.name,
      publishedAt: template.created_at,
    })
  }, [id, tokenFromLink, template])

  // applyTemplateToStore must run before DesignerPage mounts — CardCanvas reads
  // the store in its init effect.
  const forkTemplate = (source: Template) => {
    const { warning } = applyTemplateToStore(source)
    navigate('/', { state: { fromTemplate: true, warning } })
  }

  const handleUse = () => {
    if (!template) return
    if (hasUnsavedWork()) {
      setConfirmOpen(true)
      return
    }
    forkTemplate(template)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-5 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">Loading template...</p>
        </div>
      </div>
    )
  }

  if (error || !template) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <CreditCard className="size-8 text-muted-foreground/40 mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{error || 'Template not available'}</p>
            <p className="text-xs text-muted-foreground">
              This template may have been removed or the link is invalid.
            </p>
          </div>
          <a
            href="/"
            className="inline-block text-xs font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground transition-colors"
          >
            Create a new design
          </a>
        </div>
      </div>
    )
  }

  const handleUnpublish = async () => {
    if (!id || !editToken) return
    if (!confirmUnpublish) {
      setConfirmUnpublish(true)
      return
    }
    setUnpublishing(true)
    setUnpublishError(null)
    try {
      await unpublishTemplate(id, editToken)
      navigate('/', { replace: true })
    } catch (err) {
      setUnpublishError(err instanceof Error ? err.message : 'Failed to unpublish')
      setUnpublishing(false)
      setConfirmUnpublish(false)
    }
  }

  return (
    <>
      {editToken && (
        <div className="sticky top-0 z-40 border-b border-border bg-card">
          <div className="max-w-4xl mx-auto flex items-center gap-3 px-6 py-2.5">
            <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground flex-1">
              You own this template.{' '}
              {unpublishError && <span className="text-destructive">{unpublishError}</span>}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive"
              disabled={unpublishing}
              onClick={handleUnpublish}
            >
              {unpublishing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              {confirmUnpublish ? 'Confirm unpublish' : 'Unpublish'}
            </Button>
          </div>
        </div>
      )}

      <DesignPreview
        mode="template"
        onEdit={handleUse}
        templateName={template.name}
        useCount={template.use_count}
        frontCanvasJson={template.front_canvas_json}
        backCanvasJson={template.back_canvas_json}
        frontBgColor={template.front_bg_color}
        backBgColor={template.back_bg_color}
        materialId={template.material_id}
        variationId={template.variation_id}
        designMethod={template.design_method as DesignMethod}
        backOption={template.back_option as BackOption}
        qrRemoved={template.qr_removed === true}
        variableFields={template.variable_fields ?? []}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace your current design?</DialogTitle>
            <DialogDescription>
              You have an unsaved design in the editor. Using this template will replace it,
              and it can't be recovered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => forkTemplate(template)}>
              Use template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
