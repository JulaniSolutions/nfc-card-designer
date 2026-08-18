import { useDesignStore } from '@/store/design-store'
import { isQrPlaceholder } from '@/lib/back-card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TriangleAlert } from 'lucide-react'

/**
 * The "are you sure" step between asking to delete the QR code and it actually
 * going. Opened from the layers panel or the Delete key via
 * `setQrDeletePromptOpen`; confirming removes the placeholder from the back
 * canvas and records the choice so it stays gone across saves and reloads.
 */
export function QrDeleteDialog() {
  const open = useDesignStore((s) => s.qrDeletePromptOpen)
  const setOpen = useDesignStore((s) => s.setQrDeletePromptOpen)
  const setQrRemoved = useDesignStore((s) => s.setQrRemoved)

  const handleConfirm = () => {
    const canvas = window.__fabricCanvasBack
    if (canvas) {
      for (const obj of canvas.getObjects().filter(isQrPlaceholder)) {
        canvas.remove(obj)
      }
      canvas.discardActiveObject()
      canvas.renderAll()
    }
    setQrRemoved(true)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-amber-500" />
            Remove the QR code?
          </DialogTitle>
          <DialogDescription>
            We highly recommend keeping it. The QR code lets people connect with
            a scan when tapping the NFC chip isn&rsquo;t an option — without it,
            your card only works by tap. If you remove it, your cards will be
            produced without a QR code on the back.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep QR code
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            Remove it anyway
          </Button>
        </DialogFooter>
        <p className="text-[11px] text-muted-foreground">
          Changed your mind later? Restore it any time from the Back Layout
          options.
        </p>
      </DialogContent>
    </Dialog>
  )
}
