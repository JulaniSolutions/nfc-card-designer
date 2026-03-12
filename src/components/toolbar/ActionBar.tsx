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
import { useDesignStore } from '@/store/design-store'
import { saveDesign } from '@/lib/save-design'
import { exportDesignAsPdf } from '@/lib/export-pdf'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Share2, FileDown, Copy, Check } from 'lucide-react'

export function ActionBar() {
  const { isSaving } = useDesignStore()
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    if (!isSupabaseConfigured()) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env')
      return
    }

    try {
      setError(null)
      useDesignStore.getState().setSaving(true)
      const id = await saveDesign()
      if (id) {
        const url = `${window.location.origin}/design/${id}`
        setShareUrl(url)
        setShareDialogOpen(true)
      }
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
        <Button
          onClick={handleShare}
          disabled={isSaving}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          <Share2 className="size-3.5" />
          {isSaving ? 'Sharing...' : 'Share'}
        </Button>
        <Button onClick={handleDownload} variant="outline" size="sm" className="gap-1.5">
          <FileDown className="size-3.5" />
          PDF
        </Button>
      </div>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Design</DialogTitle>
            <DialogDescription>
              Anyone with this link can view your card design.
            </DialogDescription>
          </DialogHeader>
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
        </DialogContent>
      </Dialog>
    </>
  )
}
