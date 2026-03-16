import { useState } from 'react'
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
import { Save, Share2, FileDown, Copy, Check, Mail, Loader2 } from 'lucide-react'

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

export function ActionBar() {
  const { isSaving, designId, designName, setDesignName } = useDesignStore()
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [emailTo, setEmailTo] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

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
    setNameInput(designName)

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
    try {
      setError(null)
      setDesignName(nameInput)
      // Wait a tick for store to update before saving
      useDesignStore.getState().designName = nameInput
      useDesignStore.getState().setSaving(true)
      const id = await saveDesign()
      if (id) {
        setShareUrl(buildShareUrl(id, nameInput))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
      setShareDialogOpen(false)
    } finally {
      useDesignStore.getState().setSaving(false)
    }
  }

  const handleUpdate = async () => {
    if (!isSupabaseConfigured()) return

    try {
      setError(null)
      useDesignStore.getState().setSaving(true)
      await saveDesign()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
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
        {designId && (
          <Button
            onClick={handleUpdate}
            disabled={isSaving}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <Save className="size-3.5" />
            {isSaving ? 'Saving...' : 'Update'}
          </Button>
        )}
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
      </div>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Design</DialogTitle>
            <DialogDescription>
              {shareUrl
                ? 'Anyone with this link can view your card design.'
                : 'Give your design a name, then generate a share link.'}
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
                  placeholder="e.g. Business Card v2"
                  className="text-sm"
                />
              </div>
              <div className="flex gap-1.5">
                <Button
                  onClick={handleConfirmShare}
                  disabled={isSaving}
                  className="flex-1"
                  size="sm"
                >
                  {isSaving ? 'Generating link...' : 'Generate Link'}
                </Button>
                <Button onClick={handleDownload} variant="outline" size="sm" className="gap-1.5">
                  <FileDown className="size-3.5" />
                  PDF
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input value={shareUrl} readOnly className="font-mono text-xs" />
                <Button onClick={copyShareUrl} variant="outline" size="default" className="shrink-0 gap-1.5">
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
              <Button onClick={handleDownload} variant="outline" size="sm" className="w-full gap-1.5">
                <FileDown className="size-3.5" />
                Download PDF
              </Button>

              <div className="relative flex items-center gap-2 pt-1">
                <div className="flex-1 border-t border-border" />
                <span className="text-[11px] text-muted-foreground">or email it</span>
                <div className="flex-1 border-t border-border" />
              </div>

              <div className="flex gap-2">
                <Input
                  type="email"
                  value={emailTo}
                  onChange={(e) => { setEmailTo(e.target.value); setEmailError(null) }}
                  placeholder="recipient@email.com"
                  className="text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleSendEmail()}
                />
                <Button
                  onClick={handleSendEmail}
                  disabled={emailSending || !emailTo.trim() || emailSent}
                  variant="outline"
                  size="default"
                  className="shrink-0 gap-1.5"
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
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
