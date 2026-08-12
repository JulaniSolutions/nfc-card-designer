import { useState, useRef, useCallback } from 'react'
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
import { saveDesign } from '@/lib/save-design'
import { exportDesignAsPdf } from '@/lib/export-pdf'
import { isSupabaseConfigured } from '@/lib/supabase'
import { sendDesignEmail } from '@/lib/send-design-email'
import { TurnstileWidget } from '@/components/ui/TurnstileWidget'
import { PublishTemplateDialog } from '@/components/toolbar/PublishTemplateDialog'
import { isTurnstileEnabled, getTurnstileToken } from '@/lib/turnstile'
import { Save, Share2, FileDown, Copy, Check, Mail, Loader2, AlertCircle, RefreshCw, LayoutTemplate } from 'lucide-react'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildShareUrl(id: string, name: string): string {
  const slug = slugify(name)
  const path = slug ? `/design/${id}/${slug}` : `/design/${id}`
  return `${window.location.origin}${path}`
}

const SAFETY_TIMEOUT_MS = 120_000

export function ActionBar() {
  const { isSaving, designId, designName, setDesignName, hasUnsavedChanges } = useDesignStore()
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [failCount, setFailCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [emailTo, setEmailTo] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileReady, setTurnstileReady] = useState(!isTurnstileEnabled())
  const [turnstileKey, setTurnstileKey] = useState(0)
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSafetyTimer = useCallback(() => {
    if (safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current)
      safetyTimerRef.current = null
    }
  }, [])

  const handleShare = async () => {
    if (!isSupabaseConfigured()) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env')
      return
    }

    // Reset dialog state
    setCopied(false)
    setEmailTo('')
    setEmailSent(false)
    setEmailError(null)
    setSaveError(null)
    setFailCount(0)
    setNameInput(designName)
    setTurnstileToken(null)
    setTurnstileReady(!isTurnstileEnabled())
    setTurnstileKey((k) => k + 1)

    // If design was already saved, skip name step — show link immediately
    if (designId) {
      setShareUrl(buildShareUrl(designId, designName))
      setShareDialogOpen(true)
      return
    }

    setShareUrl('')
    setShareDialogOpen(true)
  }

  const handleConfirmShare = async () => {
    clearSafetyTimer()

    // Safety timeout — guarantees button can NEVER get permanently stuck
    safetyTimerRef.current = setTimeout(() => {
      useDesignStore.getState().setSaving(false)
      setSaveError('Save timed out. Please try again.')
      setFailCount((c) => c + 1)
    }, SAFETY_TIMEOUT_MS)

    try {
      setSaveError(null)
      setDesignName(nameInput)
      useDesignStore.getState().setSaving(true)
      const id = await saveDesign(turnstileToken)
      if (id) {
        setShareUrl(buildShareUrl(id, nameInput))
        setFailCount(0)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save'
      setSaveError(message)
      setFailCount((c) => c + 1)
      // Force Turnstile re-verification on retry (token may have expired)
      setTurnstileToken(null)
      setTurnstileReady(!isTurnstileEnabled())
      setTurnstileKey((k) => k + 1)
    } finally {
      clearSafetyTimer()
      useDesignStore.getState().setSaving(false)
    }
  }

  const handleSaveChanges = async () => {
    if (!isSupabaseConfigured()) return
    clearSafetyTimer()

    safetyTimerRef.current = setTimeout(() => {
      useDesignStore.getState().setSaving(false)
      setError('Save timed out. Please try again.')
    }, SAFETY_TIMEOUT_MS)

    try {
      setError(null)
      useDesignStore.getState().setSaving(true)
      const token = await getTurnstileToken()
      await saveDesign(token)
      // Open share dialog after successful save
      const { designId: id, designName: name } = useDesignStore.getState()
      if (id) {
        setCopied(false)
        setEmailTo('')
        setEmailSent(false)
        setEmailError(null)
        setSaveError(null)
        setFailCount(0)
        setShareUrl(buildShareUrl(id, name))
        setShareDialogOpen(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      clearSafetyTimer()
      useDesignStore.getState().setSaving(false)
    }
  }

  const handleDownload = async () => {
    try {
      await exportDesignAsPdf()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PDF')
    }
  }

  const handleBackupDownload = async () => {
    try {
      await exportDesignAsPdf()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to export PDF')
    }
  }

  const copyShareUrl = async () => {
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSendEmail = async () => {
    if (!emailTo.trim() || emailSending) return
    try {
      setEmailError(null)
      setEmailSending(true)
      await sendDesignEmail(emailTo.trim(), shareUrl, designName || undefined)
      setEmailSent(true)
      setTimeout(() => {
        setEmailSent(false)
        setEmailTo('')
      }, 3000)
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send email')
    } finally {
      setEmailSending(false)
    }
  }

  return (
    <>
      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-destructive/10 text-destructive text-xs rounded-lg px-4 py-2 border border-destructive/20 shadow-sm">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-3 text-destructive/60 hover:text-destructive"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {/* Publishing requires a saved design — saveDesign is what uploads images to Storage */}
        {designId && (
          <Button
            onClick={() => setTemplateDialogOpen(true)}
            variant="outline"
            size="sm"
            className="gap-1.5"
            aria-label="Save as template"
          >
            <LayoutTemplate className="size-3.5" />
            <span className="hidden sm:inline">Save as template</span>
          </Button>
        )}
        {designId && hasUnsavedChanges ? (
          <Button
            onClick={handleSaveChanges}
            disabled={isSaving}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <Save className="size-3.5" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        ) : (
          <Button
            onClick={handleShare}
            disabled={isSaving}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <Share2 className="size-3.5" />
            Share
          </Button>
        )}
      </div>

      <Dialog open={shareDialogOpen} onOpenChange={(open) => {
        setShareDialogOpen(open)
        if (!open) clearSafetyTimer()
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Share Design</DialogTitle>
            <DialogDescription>
              {shareUrl
                ? 'Anyone with this link can view your card design.'
                : 'Save your design to get a shareable link, download the PDF, or email it.'}
            </DialogDescription>
          </DialogHeader>

          {!shareUrl ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="design-name" className="text-xs">
                  Design name <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="design-name"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="e.g. Acme Co"
                  className="text-sm"
                />
              </div>
              <TurnstileWidget
                key={turnstileKey}
                onToken={(token) => { setTurnstileToken(token); setTurnstileReady(true) }}
                onError={() => { setTurnstileToken(null); setTurnstileReady(true) }}
              />
              <Button
                onClick={handleConfirmShare}
                disabled={isSaving || !turnstileReady}
                className="w-full h-8"
                size="sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1.5" />
                    Saving...
                  </>
                ) : saveError ? (
                  <>
                    <RefreshCw className="size-3.5 mr-1.5" />
                    Try Again
                  </>
                ) : (
                  'Save Design'
                )}
              </Button>

              {/* Inline error with retry context */}
              {saveError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                  <div className="flex items-start gap-2 text-destructive text-xs">
                    <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                    <span>{saveError}</span>
                  </div>
                  {failCount >= 2 && (
                    <div className="border-t border-destructive/20 pt-2">
                      <p className="text-xs text-muted-foreground mb-1.5">
                        Having trouble? Download your design so you don't lose your work.
                      </p>
                      <Button
                        onClick={handleBackupDownload}
                        variant="outline"
                        size="sm"
                        className="w-full h-7 text-xs gap-1.5"
                      >
                        <FileDown className="size-3" />
                        Download Design as PDF
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Copy link */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">Share Link</h4>
                <div className="flex gap-2">
                  <Input value={shareUrl} readOnly className="font-mono text-xs h-8" />
                  <Button onClick={copyShareUrl} variant="outline" className="shrink-0 gap-1.5 h-8">
                    {copied ? (
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

              {/* Email */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">Send via Email</h4>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={emailTo}
                    onChange={(e) => { setEmailTo(e.target.value); setEmailError(null) }}
                    placeholder="recipient@email.com"
                    className="text-sm h-8"
                    onKeyDown={(e) => e.key === 'Enter' && handleSendEmail()}
                  />
                  <Button
                    onClick={handleSendEmail}
                    disabled={emailSending || !emailTo.trim() || emailSent}
                    variant="outline"
                    className="shrink-0 gap-1.5 h-8"
                  >
                    {emailSent ? (
                      <>
                        <Check className="size-3.5" />
                        Sent!
                      </>
                    ) : emailSending ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Sending
                      </>
                    ) : (
                      <>
                        <Mail className="size-3.5" />
                        Send
                      </>
                    )}
                  </Button>
                </div>
                {emailError && (
                  <p className="text-xs text-destructive">{emailError}</p>
                )}
              </div>

              {/* Download */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">Download</h4>
                <Button onClick={handleDownload} variant="outline" className="w-full gap-1.5 h-8">
                  <FileDown className="size-3.5" />
                  Download PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PublishTemplateDialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen} />
    </>
  )
}
