import { Button } from '@/components/ui/button'
import { Check, X } from 'lucide-react'
import { applyCrop, cancelCrop } from '@/lib/crop-tool'

export function CropActionBar({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex items-center justify-center gap-2 py-2">
      <Button
        onClick={() => {
          applyCrop()
          onDone()
        }}
        size="sm"
        className="gap-1.5 h-8"
      >
        <Check className="size-3.5" />
        Apply Crop
      </Button>
      <Button
        onClick={() => {
          cancelCrop()
          onDone()
        }}
        variant="outline"
        size="sm"
        className="gap-1.5 h-8"
      >
        <X className="size-3.5" />
        Cancel
      </Button>
    </div>
  )
}
