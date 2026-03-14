import { useDesignStore } from '@/store/design-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Minus, Plus } from 'lucide-react'

export function BackCardOptions() {
  const backOption = useDesignStore((s) => s.backOption)
  const setBackOption = useDesignStore((s) => s.setBackOption)
  const quantity = useDesignStore((s) => s.quantity)
  const setQuantity = useDesignStore((s) => s.setQuantity)
  const cardNames = useDesignStore((s) => s.cardNames)
  const setCardName = useDesignStore((s) => s.setCardName)

  return (
    <div className="space-y-4">
      {/* Back layout option */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
          Back Layout
        </h3>
        <div className="flex gap-1.5">
          <button
            onClick={() => setBackOption('qr-only')}
            className={cn(
              'flex-1 text-xs py-1.5 px-3 rounded-md border transition-colors',
              backOption === 'qr-only'
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-foreground border-border hover:bg-muted'
            )}
          >
            QR Only
          </button>
          <button
            onClick={() => setBackOption('qr-name')}
            className={cn(
              'flex-1 text-xs py-1.5 px-3 rounded-md border transition-colors',
              backOption === 'qr-name'
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-foreground border-border hover:bg-muted'
            )}
          >
            QR + Name
          </button>
        </div>
      </div>

      {/* Quantity */}
      {backOption === 'qr-name' && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
            Quantity
          </h3>
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
            >
              <Minus className="size-3" />
            </Button>
            <span className="text-sm font-medium w-8 text-center">{quantity}</span>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              onClick={() => setQuantity(Math.min(50, quantity + 1))}
              disabled={quantity >= 50}
            >
              <Plus className="size-3" />
            </Button>
          </div>

          {/* Name inputs */}
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {cardNames.map((name, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground w-5 shrink-0 text-right">
                  {i + 1}.
                </span>
                <Input
                  type="text"
                  value={name}
                  onChange={(e) => setCardName(i, e.target.value)}
                  placeholder="Card holder name"
                  className="text-xs h-7"
                />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            The first name is shown on the back preview. All names will be used at production.
          </p>
        </div>
      )}
    </div>
  )
}
