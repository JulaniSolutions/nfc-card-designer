import { useDesignStore } from '@/store/design-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textbox, FabricImage } from 'fabric'
import { useRef } from 'react'
import { Type, ImagePlus, Trash2 } from 'lucide-react'

export function DesignToolbar() {
  const { activeSide, frontBgColor, backBgColor, setBgColor } = useDesignStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentBgColor = activeSide === 'front' ? frontBgColor : backBgColor
  const sideLabel = activeSide === 'front' ? 'Front' : 'Back'

  const addText = () => {
    const canvas = window.__fabricCanvas
    if (!canvas) return

    const text = new Textbox('Your Text', {
      left: 100,
      top: 100,
      fontSize: 24,
      fontFamily: 'Arial',
      fill: '#000000',
      width: 200,
      textAlign: 'center',
    })
    canvas.add(text)
    canvas.setActiveObject(text)
    canvas.renderAll()
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const canvas = window.__fabricCanvas
    if (!canvas) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string
      const imgElement = new Image()
      imgElement.onload = () => {
        const fabricImg = new FabricImage(imgElement, {
          left: 50,
          top: 50,
        })
        const maxWidth = 300
        const maxHeight = 200
        const scaleX = maxWidth / fabricImg.width!
        const scaleY = maxHeight / fabricImg.height!
        const scale = Math.min(scaleX, scaleY, 1)
        fabricImg.scale(scale)

        canvas.add(fabricImg)
        canvas.setActiveObject(fabricImg)
        canvas.renderAll()
      }
      imgElement.src = dataUrl
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleBgColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBgColor(activeSide, e.target.value)
  }

  const deleteSelected = () => {
    const canvas = window.__fabricCanvas
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (active) {
      canvas.remove(active)
      canvas.discardActiveObject()
      canvas.renderAll()
    }
  }

  return (
    <div className="space-y-4">
      {/* Add elements */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
          Elements
          <span className="text-muted-foreground/60 normal-case tracking-normal ml-1">
            — adds to {sideLabel}
          </span>
        </h3>
        <div className="flex gap-1.5">
          <Button onClick={addText} variant="outline" size="sm" className="flex-1 gap-1.5">
            <Type className="size-3.5" />
            Text
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5"
          >
            <ImagePlus className="size-3.5" />
            Image
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="hidden"
        />
      </div>

      {/* Background color */}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
          Background
          <span className="text-muted-foreground/60 normal-case tracking-normal ml-1">
            — {sideLabel}
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="size-8 rounded-md ring-1 ring-border shrink-0 cursor-pointer relative overflow-hidden"
            onClick={() => {
              const input = document.getElementById('bg-color-input') as HTMLInputElement
              input?.click()
            }}
            style={{ backgroundColor: currentBgColor }}
          >
            <input
              id="bg-color-input"
              type="color"
              value={currentBgColor}
              onChange={handleBgColorChange}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </button>
          <Input
            type="text"
            value={currentBgColor}
            onChange={handleBgColorChange}
            className="font-mono text-xs h-8"
            maxLength={7}
          />
        </div>
      </div>

      {/* Delete */}
      <Button
        onClick={deleteSelected}
        variant="ghost"
        size="sm"
        className="w-full text-muted-foreground hover:text-destructive gap-1.5"
      >
        <Trash2 className="size-3.5" />
        Delete Selected
      </Button>
    </div>
  )
}
