import { useDesignStore } from '@/store/design-store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Minus, Plus, X } from 'lucide-react'

export function BackCardOptions() {
  const backOption = useDesignStore((s) => s.backOption)
  const setBackOption = useDesignStore((s) => s.setBackOption)
  const quantity = useDesignStore((s) => s.quantity)
  const setQuantity = useDesignStore((s) => s.setQuantity)
  const variableFields = useDesignStore((s) => s.variableFields)
  const cardData = useDesignStore((s) => s.cardData)
  const addVariable = useDesignStore((s) => s.addVariable)
  const removeVariable = useDesignStore((s) => s.removeVariable)
  const removeCard = useDesignStore((s) => s.removeCard)
  const setCardValue = useDesignStore((s) => s.setCardValue)

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

      {/* Variable fields + quantity + data entry */}
      {backOption === 'qr-name' && (
        <>
          {/* Variable fields */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Variables
              </h3>
              <button
                onClick={() => addVariable('Variable ' + variableFields.length)}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
              >
                <Plus className="size-2.5" />
                Add
              </button>
            </div>
            <div className="space-y-0.5">
              {variableFields.map((field) => {
                const isName = field.id === 'name'

                return (
                  <div key={field.id} className="flex items-center gap-1.5">
                    <span className="text-xs flex-1 truncate pl-2 py-1">{field.label}</span>
                    <button
                      onClick={() => {
                        if (isName) return
                        removeVariable(field.id)
                      }}
                      className={cn(
                        'shrink-0 p-0.5 transition-colors',
                        isName
                          ? 'text-muted-foreground/20 cursor-default'
                          : 'text-muted-foreground hover:text-destructive'
                      )}
                      title={isName ? 'Name cannot be removed' : 'Remove'}
                      disabled={isName}
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Quantity */}
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

            {/* Per-card data entry — stacked per card */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {cardData.map((row, cardIndex) => (
                <div key={cardIndex} className="space-y-1">
                  {quantity > 1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-muted-foreground">
                        Card {cardIndex + 1}
                      </span>
                      <button
                        onClick={() => removeCard(cardIndex)}
                        className="text-muted-foreground/50 hover:text-destructive transition-colors p-0.5"
                        title="Remove card"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  )}
                  {variableFields.map((field) => (
                    <div key={field.id} className="flex items-center gap-2">
                      {variableFields.length > 1 && (
                        <span className="text-[10px] text-muted-foreground w-14 shrink-0">
                          {field.label}
                        </span>
                      )}
                      <Input
                        type="text"
                        value={row[field.id] || ''}
                        onChange={(e) => setCardValue(cardIndex, field.id, e.target.value)}
                        placeholder={variableFields.length === 1 ? 'Card holder name' : field.label}
                        className="text-xs h-7"
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Card 1 values are shown on the back preview.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
