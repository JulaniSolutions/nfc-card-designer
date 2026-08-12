import { useState, useEffect, useCallback, useRef } from 'react'
import { FabricImage, Textbox, IText, type FabricObject, type Canvas } from 'fabric'
import { useDesignStore } from '@/store/design-store'
import { getVariation, isSideEngraved } from '@/config/materials'
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
  // ArrowRightLeft,
  ArrowUp,
  ArrowDown,
  Minus,
  Plus,
  AlignLeft,
  AlignCenter,
  AlignRight,
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
  getObjectId,
} from '@/lib/engraved-filters'

const ALL_WEIGHTS = [
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semi Bold' },
  { value: 700, label: 'Bold' },
] as const

import { FONT_WEIGHTS, AVAILABLE_FONTS } from '@/lib/fonts'

function getWeightsForFont(fontFamily: string): typeof ALL_WEIGHTS[number][] {
  const weights = FONT_WEIGHTS[fontFamily] ?? [400]
  return ALL_WEIGHTS.filter((w) => weights.includes(w.value))
}

interface LayerInfo {
  object: FabricObject
  type: 'text' | 'image' | 'icon' | 'qr'
  label: string
  locked: boolean
  undeletable: boolean
  variableId?: string
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
      const undeletable = !!(obj as FabricObject & { _undeletable?: boolean })._undeletable
      const custom = obj as FabricObject & { _layerLabel?: string; _layerType?: string; _variableId?: string }
      if (custom._layerLabel) {
        const layerType = (custom._layerType === 'icon' ? 'icon' : custom._layerType === 'qr' ? 'qr' : 'text') as LayerInfo['type']
        return { object: obj, type: layerType, label: custom._layerLabel, locked, undeletable, variableId: custom._variableId }
      }
      if (obj instanceof FabricImage) {
        return { object: obj, type: 'image' as const, label: 'Image', locked, undeletable }
      }
      if (obj instanceof Textbox || obj instanceof IText) {
        const text = (obj as Textbox).text || 'Text'
        return {
          object: obj,
          type: 'text' as const,
          label: text.length > 24 ? text.slice(0, 24) + '…' : text,
          locked,
          undeletable,
        }
      }
      return { object: obj, type: 'image' as const, label: 'Object', locked, undeletable }
    })
    .reverse()
}

export function LayersPanel() {
  const activeSide = useDesignStore((s) => s.activeSide)
  const materialId = useDesignStore((s) => s.materialId)
  const variationId = useDesignStore((s) => s.variationId)
  // The panel lists the active canvas, so the side it is showing decides whether
  // colours are locked — the back of Hybrid Metal / 24k Gold is printed.
  const isEngraved = isSideEngraved(materialId, activeSide)
  const variableFields = useDesignStore((s) => s.variableFields)
  // Subscribe to canvas JSON changes — these fire on every object:added/modified/removed
  const frontJson = useDesignStore((s) => s.frontCanvasJson)
  const backJson = useDesignStore((s) => s.backCanvasJson)
  const [layers, setLayers] = useState<LayerInfo[]>([])
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [, forceUpdate] = useState(0)
  const prevLayerCountRef = useRef(0)

  const refreshLayers = useCallback((syncSelection = false) => {
    const canvas = getActiveCanvas()
    const newLayers = getLayers(canvas)
    const prevCount = prevLayerCountRef.current
    const newCount = newLayers.filter((l) => !l.locked).length

    // Auto-expand newly added layer (newest is at index 0 since layers are reversed)
    // Skip auto-expand if the only unlocked layers are icons (e.g. NFC wave icon on first load)
    const nonIconUnlocked = newLayers.filter((l) => !l.locked && l.type !== 'icon')
    const prevNonIconCount = newLayers.length > 0 && nonIconUnlocked.length === 0 ? 0 : newCount

    if (prevNonIconCount > prevCount && prevCount > 0) {
      setExpandedIndex(0)
    } else if (prevNonIconCount > 0 && prevCount === 0 && nonIconUnlocked.length > 0) {
      setExpandedIndex(0)
    } else if (syncSelection && canvas) {
      // Sync expanded layer with canvas selection
      const active = canvas.getActiveObject()
      if (active) {
        const idx = newLayers.findIndex((l) => l.object === active)
        if (idx !== -1 && !newLayers[idx].locked) {
          setExpandedIndex(idx)
        } else {
          // Selected a locked element — collapse any open layer
          setExpandedIndex(null)
        }
      } else {
        setExpandedIndex(null)
      }
    }

    prevLayerCountRef.current = newCount
    setLayers(newLayers)
  }, [])

  // Refresh layers whenever canvas JSON changes (objects added/removed/modified) or side switches
  useEffect(() => {
    refreshLayers()
  }, [activeSide, frontJson, backJson, variableFields, refreshLayers])

  // Also listen for selection events (these don't change JSON but affect highlighting)
  useEffect(() => {
    const events = ['selection:created', 'selection:updated', 'selection:cleared', 'text:changed'] as const
    const handler = () => {
      refreshLayers(true)
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
    if (layer.locked || layer.undeletable) return
    const canvas = getActiveCanvas()
    if (!canvas) return
    canvas.remove(layer.object)
    canvas.discardActiveObject()
    canvas.renderAll()
    // If this was a variable text, also remove it from the store
    if (layer.variableId) {
      useDesignStore.getState().removeVariable(layer.variableId)
    }
    setExpandedIndex(null)
    refreshLayers()
  }

  /* handleMoveToOtherSide — commented out, kept for future re-enablement
  const handleMoveToOtherSide = (layer: LayerInfo) => {
    if (layer.locked) return
    const { activeSide } = useDesignStore.getState()
    const sourceCanvas = getActiveCanvas()
    const targetCanvas = activeSide === 'front'
      ? window.__fabricCanvasBack
      : window.__fabricCanvasFront

    if (!sourceCanvas || !targetCanvas) return

    sourceCanvas.remove(layer.object)
    sourceCanvas.discardActiveObject()
    sourceCanvas.renderAll()

    targetCanvas.add(layer.object)
    targetCanvas.setActiveObject(layer.object)
    targetCanvas.renderAll()

    const newSide = activeSide === 'front' ? 'back' : 'front'
    window.__fabricCanvas = targetCanvas
    useDesignStore.getState().setActiveSide(newSide)

    setExpandedIndex(null)
    refreshLayers()
  }
  */

  const handleBringForward = (layer: LayerInfo) => {
    const canvas = getActiveCanvas()
    if (!canvas) return
    const obj = layer.object
    canvas.bringObjectForward(obj)
    canvas.renderAll()
    refreshLayers()
    const updated = getLayers(canvas)
    const newIdx = updated.findIndex((l) => l.object === obj)
    if (newIdx !== -1) setExpandedIndex(newIdx)
  }

  const handleSendBackward = (layer: LayerInfo) => {
    const canvas = getActiveCanvas()
    if (!canvas) return
    const obj = layer.object
    canvas.sendObjectBackwards(obj)
    canvas.renderAll()
    refreshLayers()
    const updated = getLayers(canvas)
    const newIdx = updated.findIndex((l) => l.object === obj)
    if (newIdx !== -1) setExpandedIndex(newIdx)
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
              return (
                <div key={index}>
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 opacity-60',
                      isSelected && 'opacity-100 bg-foreground/[0.08]'
                    )}
                  >
                    <div className="size-3 shrink-0" />
                    <Type className="size-3.5 text-muted-foreground shrink-0" />
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
                  {layer.type === 'qr' ? (
                    <QrCode className="size-3.5 text-muted-foreground shrink-0" />
                  ) : layer.type === 'icon' ? (
                    <Nfc className="size-3.5 text-muted-foreground shrink-0" />
                  ) : layer.type === 'text' ? (
                    <Type className="size-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ImageIcon className="size-3.5 text-muted-foreground shrink-0" />
                  )}

                  {/* Label */}
                  <span className="text-xs truncate flex-1">{layer.label}</span>
                </div>

                {/* Expanded inline controls */}
                {expandedIndex === index && (
                  <div className="pl-7 pr-2 py-2">
                    {layer.type === 'qr' ? (
                      <p className="text-[10px] text-muted-foreground">
                        QR code is added automatically. Drag to reposition.
                      </p>
                    ) : layer.type === 'icon' ? (
                      <IconLayerControls
                        object={layer.object as FabricImage}
                        onUpdate={refreshLayers}
                      />
                    ) : layer.type === 'text' ? (
                      <TextLayerControls
                        object={layer.object as Textbox}
                        onUpdate={refreshLayers}
                        isEngraved={isEngraved}
                        variationId={variationId}
                        hideTextInput={!!layer.variableId}
                      />
                    ) : (
                      <ImageLayerControls
                        object={layer.object as FabricImage}
                        onUpdate={refreshLayers}
                      />
                    )}
                    {/* Layer ordering */}
                    <div className="flex items-center gap-1 mt-2 mb-1">
                      <span className="text-[10px] text-muted-foreground shrink-0">Order</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-6"
                        title="Move Up"
                        disabled={index === 0}
                        onClick={(e) => { e.stopPropagation(); handleBringForward(layer) }}
                      >
                        <ArrowUp className="size-2.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-6"
                        title="Move Down"
                        disabled={index === layers.length - 1}
                        onClick={(e) => { e.stopPropagation(); handleSendBackward(layer) }}
                      >
                        <ArrowDown className="size-2.5" />
                      </Button>
                    </div>
                    {/* Move to other side — commented out to avoid confusion with layer ordering
                    {!layer.undeletable && (
                      <Button
                        onClick={() => handleMoveToOtherSide(layer)}
                        variant="ghost"
                        size="sm"
                        className="w-full gap-1.5 h-7 text-xs text-muted-foreground mt-1.5"
                      >
                        <ArrowRightLeft className="size-3" />
                        Move to {activeSide === 'front' ? 'Back' : 'Front'}
                      </Button>
                    )}
                    */}
                    {/* Delete */}
                    {!layer.undeletable && (
                      <Button
                        onClick={() => handleDelete(layer)}
                        variant="ghost"
                        size="sm"
                        className="w-full gap-1.5 h-7 text-xs text-destructive hover:text-destructive mt-0.5"
                      >
                        <Trash2 className="size-3" />
                        Delete
                      </Button>
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
  isEngraved,
  variationId,
  hideTextInput,
}: {
  object: Textbox
  onUpdate: () => void
  /** Whether the side this text sits on is engraved — not the design method. */
  isEngraved: boolean
  variationId: string | null
  hideTextInput?: boolean
}) {
  const textValue = object.text || ''
  const fillColor = (typeof object.fill === 'string' ? object.fill : '#000000')
  const variation = variationId ? getVariation(variationId) : undefined

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    object.set('text', e.target.value)
    const canvas = getActiveCanvas()
    canvas?.renderAll()
    onUpdate()
  }

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    object.set('fill', e.target.value)
    // Remembered so a trip through an engraved material and back restores the
    // user's own colour rather than the new material's default.
    const objId = getObjectId(object)
    if (objId) useDesignStore.getState().savePrintColor(objId, e.target.value)
    const canvas = getActiveCanvas()
    canvas?.renderAll()
    onUpdate()
  }

  const handleFontChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const font = e.target.value
    const currentWeight = Number(object.fontWeight) || 400
    const availableWeights = FONT_WEIGHTS[font] ?? [400]
    // Snap to nearest available weight
    const newWeight = availableWeights.includes(currentWeight)
      ? currentWeight
      : availableWeights.reduce((a, b) => Math.abs(b - currentWeight) < Math.abs(a - currentWeight) ? b : a)
    object.set('fontFamily', font)
    object.set('fontWeight', newWeight)
    object.initDimensions()
    const canvas = getActiveCanvas()
    canvas?.renderAll()
    onUpdate()
  }

  const handleWeightChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const weight = Number(e.target.value)
    object.set('fontWeight', weight)
    object.initDimensions()
    const canvas = getActiveCanvas()
    canvas?.renderAll()
    onUpdate()
  }

  return (
    <div className="space-y-2">
      {/* Text content — hidden for name field (editable on canvas + sidebar) */}
      {!hideTextInput && (
        <Input
          type="text"
          value={textValue}
          onChange={handleTextChange}
          className="text-xs h-7"
          placeholder="Enter text"
        />
      )}

      {/* Font selector + weight */}
      <div className="flex gap-1.5">
        <select
          value={object.fontFamily || 'Arial'}
          onChange={handleFontChange}
          className="flex-1 min-w-0 text-xs h-7 rounded-md border border-border bg-background px-2"
        >
          {AVAILABLE_FONTS.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </option>
          ))}
        </select>
        <select
          value={object.fontWeight || 400}
          onChange={handleWeightChange}
          className="w-[90px] shrink-0 text-xs h-7 rounded-md border border-border bg-background px-2"
        >
          {getWeightsForFont(object.fontFamily || 'Arial').map((w) => (
            <option key={w.value} value={w.value}>{w.label}</option>
          ))}
        </select>
      </div>

      {/* Font size */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground shrink-0">Size</span>
        <Button
          variant="outline"
          size="icon"
          className="size-6"
          onClick={() => {
            const newSize = Math.max(8, Math.round(object.fontSize - 2))
            object.set('fontSize', newSize)
            object.initDimensions()
            getActiveCanvas()?.renderAll()
            onUpdate()
          }}
        >
          <Minus className="size-2.5" />
        </Button>
        <span className="text-[11px] text-foreground tabular-nums min-w-[36px] text-center">
          {Math.round(object.fontSize)}px
        </span>
        <Button
          variant="outline"
          size="icon"
          className="size-6"
          onClick={() => {
            const newSize = Math.min(200, Math.round(object.fontSize + 2))
            object.set('fontSize', newSize)
            object.initDimensions()
            getActiveCanvas()?.renderAll()
            onUpdate()
          }}
        >
          <Plus className="size-2.5" />
        </Button>
      </div>

      {/* Text alignment */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground shrink-0">Align</span>
        {(['left', 'center', 'right'] as const).map((align) => {
          const Icon = align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : AlignRight
          return (
            <Button
              key={align}
              variant="outline"
              size="icon"
              className={cn('size-6', object.textAlign === align && 'bg-foreground/10 border-foreground/30')}
              onClick={() => {
                object.set('textAlign', align)
                getActiveCanvas()?.renderAll()
                onUpdate()
              }}
            >
              <Icon className="size-2.5" />
            </Button>
          )
        })}
      </div>

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
  const materialId = useDesignStore((s) => s.materialId)
  const activeSide = useDesignStore((s) => s.activeSide)
  const isEngraved = isSideEngraved(materialId, activeSide)
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
      // Read from _originalElement (unfiltered source) so BG removal gets the
      // clean full-color image, not the engraved grayscale/tinted version.
      const internal = object as FabricImage & { _originalElement?: HTMLImageElement }
      const sourceEl = internal._originalElement || object.getElement() as HTMLImageElement
      const offscreen = document.createElement('canvas')
      offscreen.width = sourceEl.naturalWidth || sourceEl.width
      offscreen.height = sourceEl.naturalHeight || sourceEl.height
      const ctx = offscreen.getContext('2d')!
      ctx.drawImage(sourceEl, 0, 0)
      const dataUrl = offscreen.toDataURL('image/png')

      // Store original for undo (before any processing)
      if (!customImg._originalSrc) {
        customImg._originalSrc = dataUrl
      }

      const resultUrl = await removeBackground(dataUrl)

      const newImg = new Image()
      newImg.crossOrigin = 'anonymous'
      newImg.onload = () => {
        // Clear filters before setElement so it doesn't re-apply stale filters.
        // setElement updates both _element and _originalElement.
        object.filters = []
        object.setElement(newImg)
        object.set({ width: newImg.width, height: newImg.height })

        if (isEngraved) {
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
      object.filters = []
      object.setElement(restored)
      object.set({ width: restored.width, height: restored.height })

      if (isEngraved) {
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
