import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDesignStore } from '@/store/design-store'
import {
  publishTemplate,
  unpublishTemplate,
  buildManageUrl,
  buildTemplateUrl,
  type PublishTemplateResult,
} from '@/lib/templates'
import { findTemplateForDesign, type TemplateHistoryEntry } from '@/lib/template-history'
import { TurnstileWidget } from '@/components/ui/TurnstileWidget'
import { isTurnstileEnabled } from '@/lib/turnstile'
import { Copy, Check, Loader2, AlertCircle, RefreshCw, Trash2 } from 'lucide-react'

interface PublishTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type CopyField = 'share' | 'manage' | 'existing'

export function PublishTemplateDialog({ open, onOpenChange }: PublishTemplateDialogProps) {
  const { designId, designName } = useDesignStore()
  const [nameInput, setNameInput] = useState('')
  const [descriptionInput, setDescriptionInput] = useState('')
  const [existing, setExisting] = useState<TemplateHistoryEntry | null>(null)
  const [publishAsNew, setPublishAsNew] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [published, setPublished] = useState<PublishTemplateResult | null>(null)
  const [copiedField, setCopiedField] = useState<CopyField | null>(null)
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [unpublishError, setUnpublishError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileReady, setTurnstileReady] = useState(!isTurnstileEnabled())
  const [turnstileKey, setTurnstileKey] = useState(0)
  const wasOpen = useRef(false)

  // Reset only on the closed -> open transition, so a store update mid-edit
  // can't wipe what the user has typed.
  useEffect(() => {
    if (open && !wasOpen.current) {
      const entry = findTemplateForDesign(designId)
      setExisting(entry)
      setPublishAsNew(false)
      setNameInput(entry?.name || designName)
      setDescriptionInput('')
      setPublished(null)
      setPublishError(null)
      setCopiedField(null)
      setConfirmUnpublish(false)
      setUnpublishError(null)
      setTurnstileToken(null)
      setTurnstileReady(!isTurnstileEnabled())
      setTurnstileKey((k) => k + 1)
    }
    wasOpen.current = open
  }, [open, designId, designName])

  const isUpdate = Boolean(existing) && !publishAsNew

  const handlePublish = async () => {
    if (publishing) return

    if (!designId) {
      setPublishError('Save your design before publishing it as a template.')
      return
    }
    const name = nameInput.trim()
    if (!name) {
      setPublishError('Give your template a name so people know what it is.')
      return
    }

    try {
      setPublishError(null)
      setPublishing(true)
      const result = await publishTemplate({
        name,
        description: descriptionInput.trim() || undefined,
        turnstileToken,
        templateId: isUpdate && existing ? existing.templateId : undefined,
        editToken: isUpdate && existing ? existing.editToken : undefined,
      })
      setPublished(result)
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to publish template')
      // Force Turnstile re-verification on retry (token may have expired)
      setTurnstileToken(null)
      setTurnstileReady(!isTurnstileEnabled())
      setTurnstileKey((k) => k + 1)
    } finally {
      setPublishing(false)
    }
  }

  const copyValue = async (value: string, field: CopyField) => {
    await navigator.clipboard.writeText(value)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Ownership survives the dialog session: fall back to the stored history entry
  // so a template published earlier can still be taken down. Gating this on
  // `published` alone made the kill switch reachable only in the one session
  // that created the template.
  const owned = published
    ? { templateId: published.templateId, editToken: published.editToken }
    : existing
      ? { templateId: existing.templateId, editToken: existing.editToken }
      : null

  const handleUnpublish = async () => {
    if (!owned || unpublishing) return
    if (!confirmUnpublish) {
      setConfirmUnpublish(true)
      return
    }

    try {
      setUnpublishError(null)
      setUnpublishing(true)
      await unpublishTemplate(owned.templateId, owned.editToken)
      onOpenChange(false)
    } catch (err) {
      setUnpublishError(err instanceof Error ? err.message : 'Failed to unpublish template')
      setConfirmUnpublish(false)
    } finally {
      setUnpublishing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {published ? 'Template Published' : isUpdate ? 'Update Template' : 'Save as Template'}
          </DialogTitle>
          <DialogDescription>
            {published
              ? 'Anyone with this link can use your template to start their own design.'
              : isUpdate
                ? 'Replace the published snapshot with what you have now. The existing link keeps working, and copies people have already made are unaffected.'
                : 'Publish this design as a reusable template. Anyone with the link can use it to start their own design.'}
          </DialogDescription>
        </DialogHeader>

        {!published ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="template-name" className="text-xs">
                Template name
              </Label>
              <Input
                id="template-name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Minimal Studio Card"
                maxLength={80}
                className="text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="template-description" className="text-xs">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="template-description"
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                placeholder="What is this template good for?"
                maxLength={300}
                className="text-sm"
              />
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                Anyone with this link can view and copy this design, including any text and images
                on it. Personal details from the card list aren't included.
              </p>
            </div>

            <TurnstileWidget
              key={turnstileKey}
              onToken={(token) => { setTurnstileToken(token); setTurnstileReady(true) }}
              onError={() => { setTurnstileToken(null); setTurnstileReady(true) }}
            />

            <Button
              onClick={handlePublish}
              disabled={publishing || !turnstileReady}
              className="w-full h-8"
              size="sm"
            >
              {publishing ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  Publishing...
                </>
              ) : publishError ? (
                <>
                  <RefreshCw className="size-3.5 mr-1.5" />
                  Try Again
                </>
              ) : isUpdate ? (
                'Update Template'
              ) : (
                'Publish Template'
              )}
            </Button>

            {isUpdate && (
              <button
                onClick={() => { setPublishAsNew(true); setPublishError(null) }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Publish as new template instead
              </button>
            )}

            {isUpdate && owned && (
              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={buildTemplateUrl(owned.templateId, existing?.name ?? nameInput)}
                    readOnly
                    className="font-mono text-xs h-8"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-8 gap-1.5"
                    onClick={() => copyValue(buildTemplateUrl(owned.templateId, existing?.name ?? nameInput), 'existing')}
                  >
                    {copiedField === 'existing' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copiedField === 'existing' ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-7 text-xs gap-1.5 text-destructive hover:text-destructive"
                  disabled={unpublishing}
                  onClick={handleUnpublish}
                >
                  {unpublishing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                  {confirmUnpublish ? 'Confirm unpublish' : 'Unpublish this template'}
                </Button>
                {unpublishError && <p className="text-xs text-destructive">{unpublishError}</p>}
              </div>
            )}

            {publishError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-start gap-2 text-destructive text-xs">
                  <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                  <span>{publishError}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Public link */}
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-muted-foreground">Template Link</h4>
              <div className="flex gap-2">
                <Input value={published.url} readOnly className="font-mono text-xs h-8" />
                <Button
                  onClick={() => copyValue(published.url, 'share')}
                  variant="outline"
                  className="shrink-0 gap-1.5 h-8"
                >
                  {copiedField === 'share' ? (
                    <>
                      <Check className="size-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Private manage link — the edit token is the only proof of ownership */}
            <div className="space-y-1.5">
              <h4 className="text-xs font-medium text-muted-foreground">Manage Link</h4>
              <p className="text-xs text-muted-foreground">
                Keep this private — it's the only way to edit or unpublish this template later.
              </p>
              <div className="flex gap-2">
                <Input
                  value={buildManageUrl(published.templateId, published.editToken)}
                  readOnly
                  className="font-mono text-xs h-8"
                />
                <Button
                  onClick={() =>
                    copyValue(buildManageUrl(published.templateId, published.editToken), 'manage')
                  }
                  variant="outline"
                  className="shrink-0 gap-1.5 h-8"
                >
                  {copiedField === 'manage' ? (
                    <>
                      <Check className="size-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground/70">
                It's also saved in this browser, under Templates.
              </p>
            </div>

            {/* Unpublish */}
            <div className="space-y-1.5">
              <Button
                onClick={handleUnpublish}
                disabled={unpublishing}
                variant="outline"
                className="w-full gap-1.5 h-8 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              >
                {unpublishing ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Unpublishing...
                  </>
                ) : (
                  <>
                    <Trash2 className="size-3.5" />
                    {confirmUnpublish ? 'Confirm unpublish' : 'Unpublish'}
                  </>
                )}
              </Button>
              {unpublishError && (
                <p className="text-xs text-destructive">{unpublishError}</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
