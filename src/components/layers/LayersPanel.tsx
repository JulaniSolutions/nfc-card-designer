import { useState, useEffect, useCallback } from 'react'
import { FabricImage, Textbox, IText, type FabricObject, type Canvas } from 'fabric'
import { useDesignStore } from '@/store/design-store'
import { getVariation } from '@/config/materials'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Type,
  ImageIcon,
  Trash2,
  ChevronDown,
  ChevronRight,
  Crop,
  Undo2,
  Eraser,
  Lock,
  QrCode,
  Nfc,
} from 'lucide-react'
import {
  enterCropMode,
  undoCrop,
  isCropping,
  hasCropUndo,
} from '@/lib/crop-tool'
import { isLockedElement } from '@/lib/back-card'
import { updateWaveIconColor } from '@/lib/wave-icon'
import { removeBackground, isBackgroundRemovalEnabled } from '@/lib/runware'
import {
  applyEngravedFiltersToImage,
  getCurrentEngravedColor,
} from '@/lib/engraved-filters'

const AVAILABLE_FONTS = [
  'Anton',
  'Archivo',
  'Arial',
  'Bebas Neue',
  'Bitter',
  'Cabin',
  'Cormorant Garamond',
  'DM Sans',
  'DM Serif Display',
  'Fira Sans',
  'IBM Plex Sans',
  'Inter',
  'Josefin Sans',
  'Kanit',
  'Lato',
  'Libre Baskerville',
  'Merriweather',
  'Montserrat',
  'Nunito',
  'Open Sans',
  'Oswald',
  'Playfair Display',
  'Poppins',
  'Quicksand',
  'Raleway',
  'Roboto',
  'Roboto Condensed',
  'Roboto Slab',
  'Source Sans 3',
  'Space Grotesk',
  'Work Sans',
]

interface LayerInfo {
  object: FabricObject
  type: 'text' | 'image' | 'icon'
  label: string
  locked: boolean
}

function getActiveCanvas(): Canvas | null {
  const { activeSide } = useDesignStore.getState()
  return activeSide === 'front'
    ? window.__fabricCanvasFront
    : window.__fabricCanvasBack
}

function getLayers(canvas: Canvas | null): LayerInfo[] {
  if (!canvas) return []
  const objects = canvas.getObjects()
  // Reverse so topmost layer is first
  return objects
    .filter((obj) => {
      // Skip locked/non-interactive objects (like placeholders)
      const custom = obj as FabricObject & { _isPlaceholder?: boolean }
      return !custom._isPlaceholder
    })
    .map((obj) => {
      const locked = isLockedElement(obj)
      const custom = obj as FabricObject & { _layerLabel?: string; _layerType?: string }
      if (custom._layerLabel) {
        const layerType = (custom._layerType === 'icon' ? 'icon' : 'text') as LayerInfo['type']
        return { object: obj, type: layerType, label: custom._layerLabel, locked }
      }
      if (obj instanceof FabricImage) {
        return { object: obj, type: 'image' as const, label: 'Image', locked }
      }
      if (obj instanceof Textbox || obj instanceof IText) {
        const text = (obj as Textbox).text || 'Text'
        return {
          object: obj,
          type: 'text' as const,
          label: text.length > 24 ? text.slice(0, 24) + '…' : text,
          locked,
        }
      }
      return { object: obj, type: 'image' as const, label: 'Object', locked }
    })
    .reverse()
}

export function LayersPanel() {
  const activeSide = useDesignStore((s) => s.activeSide)
  const designMethod = useDesignStore((s) => s.designMethod)
  const variationId = useDesignStore((s) => s.variationId)
  // Subscribe to canvas JSON changes — these fire on every object:added/modified/removed
  const frontJson = useDesignStore((s) => s.frontCanvasJson)
  const backJson = useDesignStore((s) => s.backCanvasJson)
  const [layers, setLayers] = useState<LayerInfo[]>([])
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [, forceUpdate] = useState(0)

  const refreshLayers = useCallback(() => {
    const canvas = getActiveCanvas()
    setLayers(getLayers(canvas))
  }, [])

  // Refresh layers whenever canvas JSON changes (objects added/removed/modified) or side switches
  useEffect(() => {
    refreshLayers()
  }, [activeSide, frontJson, backJson, refreshLayers])

  // Also listen for selection events (these don't change JSON but affect highlighting)
  useEffect(() => {
    const events = ['selection:created', 'selection:updated', 'selection:cleared', 'text:changed'] as const
    const handler = () => {
      refreshLayers()
      forceUpdate((n) => n + 1)
    }

    const cleanups: Array<() => void> = []

    // Re-bind whenever canvases change — use an interval to catch late-initialized canvases
    const bind = () => {
      for (const canvas of [window.__fabricCanvasFront, window.__fabricCanvasBack]) {
        if (!canvas) continue
        for (const event of events) {
          canvas.on(event, handler)
        }
        cleanups.push(() => {
          for (const event of events) {
            canvas.off(event, handler)
          }
        })
      }
    }

    bind()
    // Retry once after a short delay in case canvases aren't ready yet
    const timer = setTimeout(bind, 500)

    return () => {
      clearTimeout(timer)
      cleanups.forEach((c) => c())
    }
  }, [activeSide, refreshLayers])

  const handleSelect = (layer: LayerInfo) => {
    const canvas = getActiveCanvas()
    if (!canvas) return
    canvas.setActiveObject(layer.object)
    canvas.renderAll()
    refreshLayers()
  }

  const handleDelete = (layer: LayerInfo) => {
    if (layer.locked) return
    const canvas = getActiveCanvas()
    if (!canvas) return
    canvas.remove(layer.object)
    canvas.discardActiveObject()
    canvas.renderAll()
    setExpandedIndex(null)
    refreshLayers()
  }

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index)
  }

  const sideLabel = activeSide === 'front' ? 'Front' : 'Back'

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
        Layers
        <span className="text-muted-foreground/60 normal-case tracking-normal ml-1">
          — {sideLabel}
        </span>
      </h3>

      {layers.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70 py-3">
          Add text or images to see layers here
        </p>
      ) : (
        <div className="space-y-0.5">
          {layers.map((layer, index) => {
            const canvas = getActiveCanvas()
            const isSelected = canvas?.getActiveObject() === layer.object

            // Locked layers: non-expandable row, no editing controls
            if (layer.locked) {
              const LockedIcon = layer.label === 'QR Code' ? QrCode : Type
              return (
                <div key={index}>
                  <div className="flex items-center gap-2 rounded-md px-2 py-1.5 opacity-60">
                    <div className="size-3 shrink-0" />
                    <LockedIcon className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs truncate flex-1">{layer.label}</span>
                    <Lock className="size-3 text-muted-foreground/40 shrink-0" />
                  </div>
                </div>
              )
            }

            return (
              <div key={index}>
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors group',
                    isSelected
                      ? 'bg-foreground/[0.08]'
                      : 'hover:bg-muted/80'
                  )}
                  onClick={() => handleSelect(layer)}
                >
                  {/* Expand toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleExpand(index)
                    }}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    {expandedIndex === index ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                  </button>

                  {/* Icon */}
                  {layer.type === 'icon' ? (
                    <Nfc className="size-3.5 text-muted-foreground shrink-0" />
                  ) : layer.type === 'text' ? (
                    <Type className="size-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ImageIcon className="size-3.5 text-muted-foreground shrink-0" />
                  )}

                  {/* Label */}
                  <span className="text-xs truncate flex-1">{layer.label}</span>

                  {/* Delete */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(layer)
                    }}
                    className="text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive shrink-0 transition-colors"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>

                {/* Expanded inline controls */}
                {expandedIndex === index && (
                  <div className="pl-7 pr-2 py-2">
                    {layer.type === 'icon' ? (
                      <IconLayerControls
                        object={layer.object as FabricImage}
                        onUpdate={refreshLayers}
                      />
                    ) : layer.type === 'text' ? (
                      <TextLayerControls
                        object={layer.object as Textbox}
                        onUpdate={refreshLayers}
                        designMethod={designMethod}
                        variationId={variationId}
                      />
                    ) : (
                      <ImageLayerControls
                        object={layer.object as FabricImage}
                        onUpdate={refreshLayers}
                      />
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TextLayerControls({
  object,
  onUpdate,
  designMethod,
  variationId,
}: {
  object: Textbox
  onUpdate: () => void
  designMethod: string
  variationId: string | null
}) {
  const textValue = object.text || ''
  const fillColor = (typeof object.fill === 'string' ? object.fill : '#000000')
  const isEngraved = designMethod === 'engraved'
  const variation = variationId ? getVariation(variationId) : undefined

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    object.set('text', e.target.value)
    const canvas = getActiveCanvas()
    canvas?.renderAll()
    onUpdate()
  }

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    object.set('fill', e.target.value)
    const canvas = getActiveCanvas()
    canvas?.renderAll()
    onUpdate()
  }

  const handleFontChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const font = e.target.value
    // Ensure the font is loaded before applying
    try {
      await document.fonts.load(`400 16px "${font}"`)
    } catch {
      // Font may already be loaded or unavailable — proceed anyway
    }
    object.set('fontFamily', font)
    object.initDimensions()
    const canvas = getActiveCanvas()
    canvas?.renderAll()
    onUpdate()
  }

  return (
    <div className="space-y-2">
      {/* Text content */}
      <Input
        type="text"
        value={textValue}
        onChange={handleTextChange}
        className="text-xs h-7"
        placeholder="Enter text"
      />

      {/* Font selector */}
      <select
        value={object.fontFamily || 'Arial'}
        onChange={handleFontChange}
        className="w-full text-xs h-7 rounded-md border border-border bg-background px-2"
      >
        {AVAILABLE_FONTS.map((font) => (
          <option key={font} value={font} style={{ fontFamily: font }}>
            {font}
          </option>
        ))}
      </select>

      {/* Color picker — hidden in engraved mode */}
      {!isEngraved && (
        <div className="flex items-center gap-2">
          <button
            className="size-6 rounded ring-1 ring-border shrink-0 cursor-pointer relative overflow-hidden"
            style={{ backgroundColor: fillColor }}
          >
            <input
              type="color"
              value={fillColor}
              onChange={handleColorChange}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </button>
          <Input
            type="text"
            value={fillColor}
            onChange={handleColorChange}
            className="font-mono text-[11px] h-7"
            maxLength={7}
          />
        </div>
      )}

      {isEngraved && variation && (
        <p className="text-[10px] text-muted-foreground">
          Color locked to engraved finish
          <span
            className="inline-block size-2 rounded-full ring-1 ring-border ml-1.5 align-middle"
            style={{ backgroundColor: variation.engravedColor }}
          />
        </p>
      )}
    </div>
  )
}

function ImageLayerControls({
  object,
  onUpdate,
}: {
  object: FabricImage
  onUpdate: () => void
}) {
  const [isRemoving, setIsRemoving] = useState(false)
  const designMethod = useDesignStore((s) => s.designMethod)
  const canCrop = !isCropping()
  const canUndoCrop = hasCropUndo(object)
  const bgRemovalEnabled = isBackgroundRemovalEnabled()

  const customImg = object as FabricImage & { _originalSrc?: string }
  const hasBgUndo = !!customImg._originalSrc

  const handleCrop = () => {
    const canvas = getActiveCanvas()
    if (!canvas) return
    enterCropMode(canvas, object)
    onUpdate()
  }

  const handleUndoCrop = () => {
    const canvas = getActiveCanvas()
    if (!canvas) return
    undoCrop(canvas, object)
    onUpdate()
  }

  const handleRemoveBg = async () => {
    setIsRemoving(true)
    try {
      const el = object.getElement() as HTMLImageElement
      const offscreen = document.createElement('canvas')
      offscreen.width = el.naturalWidth || el.width
      offscreen.height = el.naturalHeight || el.height
      const ctx = offscreen.getContext('2d')!
      ctx.drawImage(el, 0, 0)
      const dataUrl = offscreen.toDataURL('image/png')

      // Store original for undo
      if (!customImg._originalSrc) {
        customImg._originalSrc = dataUrl
      }

      const resultUrl = await removeBackground(dataUrl)

      const newImg = new Image()
      newImg.crossOrigin = 'anonymous'
      newImg.onload = () => {
        object.setElement(newImg)
        object.set({ width: newImg.width, height: newImg.height })

        if (designMethod === 'engraved') {
          applyEngravedFiltersToImage(object, getCurrentEngravedColor())
        }

        getActiveCanvas()?.renderAll()
        setIsRemoving(false)

        onUpdate()
      }
      newImg.onerror = () => {
        setIsRemoving(false)
        alert('Failed to load processed image.')
      }
      newImg.src = resultUrl
    } catch (err) {
      setIsRemoving(false)
      alert(err instanceof Error ? err.message : 'Background removal failed.')
    }
  }

  const handleUndoBgRemoval = () => {
    if (!customImg._originalSrc) return

    const restored = new Image()
    restored.crossOrigin = 'anonymous'
    restored.onload = () => {
      object.setElement(restored)
      object.set({ width: restored.width, height: restored.height })

      if (designMethod === 'engraved') {
        applyEngravedFiltersToImage(object, getCurrentEngravedColor())
      }

      customImg._originalSrc = undefined
      getActiveCanvas()?.renderAll()

      onUpdate()
    }
    restored.src = customImg._originalSrc
  }

  return (
    <div className="space-y-1.5">
      <Button
        onClick={handleCrop}
        variant="outline"
        size="sm"
        className="w-full gap-1.5 h-7 text-xs"
        disabled={!canCrop}
      >
        <Crop className="size-3" />
        Crop
      </Button>
      {canUndoCrop && (
        <Button
          onClick={handleUndoCrop}
          variant="ghost"
          size="sm"
          className="w-full gap-1.5 h-7 text-xs text-muted-foreground"
        >
          <Undo2 className="size-3" />
          Undo Crop
        </Button>
      )}
      {bgRemovalEnabled && (
        <Button
          onClick={handleRemoveBg}
          variant="outline"
          size="sm"
          className="w-full gap-1.5 h-7 text-xs"
          disabled={isRemoving || hasBgUndo}
        >
          <Eraser className="size-3" />
          {isRemoving ? 'Removing…' : 'Remove Background'}
        </Button>
      )}
      {hasBgUndo && (
        <Button
          onClick={handleUndoBgRemoval}
          variant="ghost"
          size="sm"
          className="w-full gap-1.5 h-7 text-xs text-muted-foreground"
        >
          <Undo2 className="size-3" />
          Undo BG Removal
        </Button>
      )}
    </div>
  )
}

function IconLayerControls({
  onUpdate,
}: {
  object: FabricImage
  onUpdate: () => void
}) {
  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value
    const canvas = getActiveCanvas()
    if (!canvas) return
    updateWaveIconColor(canvas, color)
    onUpdate()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          className="size-6 rounded ring-1 ring-border shrink-0 cursor-pointer relative overflow-hidden bg-foreground"
        >
          <input
            type="color"
            defaultValue="#000000"
            onChange={handleColorChange}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </button>
        <span className="text-[11px] text-muted-foreground">Icon colour</span>
      </div>
    </div>
  )
}
