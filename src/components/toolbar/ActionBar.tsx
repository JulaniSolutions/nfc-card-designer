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

export function ActionBar() {
  const { isSaving, designId } = useDesignStore()
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      useDesignStore.getState().setSaving(false)
    }
  }

  const handleShare = async () => {
    await handleSave()
    if (!error) {
      setShareDialogOpen(true)
    }
  }

  const handleDownload = async () => {
    try {
      await exportDesignAsPdf()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export PDF')
    }
  }

  const copyShareUrl = () => {
    navigator.clipboard.writeText(shareUrl)
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-xs text-destructive bg-destructive/10 rounded p-2">{error}</p>
      )}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={isSaving} size="sm" className="flex-1">
          {isSaving ? 'Saving...' : designId ? 'Update' : 'Save'}
        </Button>
        <Button onClick={handleShare} variant="outline" size="sm" className="flex-1">
          Share
        </Button>
        <Button onClick={handleDownload} variant="outline" size="sm" className="flex-1">
          PDF
        </Button>
      </div>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Your Design</DialogTitle>
            <DialogDescription>
              Anyone with this link can view your card design.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input value={shareUrl} readOnly className="font-mono text-sm" />
            <Button onClick={copyShareUrl} variant="outline">
              Copy
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
