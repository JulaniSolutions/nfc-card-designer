import { useDesignStore } from '@/store/design-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textbox, FabricImage } from 'fabric'
import { useRef } from 'react'

export function DesignToolbar() {
  const { activeSide, setActiveSide, frontBgColor, backBgColor, setBgColor } =
    useDesignStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentBgColor = activeSide === 'front' ? frontBgColor : backBgColor

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
        // Scale to fit within card
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

    // Reset input so the same file can be uploaded again
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
      <div>
        <h3 className="text-sm font-medium mb-2">Card Side</h3>
        <Tabs
          value={activeSide}
          onValueChange={(v) => setActiveSide(v as 'front' | 'back')}
        >
          <TabsList className="w-full">
            <TabsTrigger value="front" className="flex-1">
              Front
            </TabsTrigger>
            <TabsTrigger value="back" className="flex-1">
              Back
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Add Elements</h3>
        <div className="flex gap-2">
          <Button onClick={addText} variant="outline" size="sm" className="flex-1">
            + Text
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="outline"
            size="sm"
            className="flex-1"
          >
            + Image
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

      <div className="space-y-2">
        <Label htmlFor="bg-color" className="text-sm font-medium">
          Background
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="bg-color"
            type="color"
            value={currentBgColor}
            onChange={handleBgColorChange}
            className="w-10 h-10 p-1 cursor-pointer"
          />
          <Input
            type="text"
            value={currentBgColor}
            onChange={handleBgColorChange}
            className="font-mono text-sm"
            maxLength={7}
          />
        </div>
      </div>

      <div>
        <Button
          onClick={deleteSelected}
          variant="destructive"
          size="sm"
          className="w-full"
        >
          Delete Selected
        </Button>
      </div>
    </div>
  )
}
