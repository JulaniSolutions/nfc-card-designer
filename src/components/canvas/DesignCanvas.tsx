import { useState, useEffect, useRef, useCallback } from 'react'
import { Canvas, FabricObject, FabricImage } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT, CARD_CORNER_RADIUS } from '@/config/canvas'
import { useDesignStore, type CardSide } from '@/store/design-store'
import { getVariation } from '@/config/materials'
import { cn } from '@/lib/utils'
import { LayersPanel } from '@/components/layers/LayersPanel'
import { CropActionBar } from '@/components/canvas/CropActionBar'
import { TransparencyWarning, type WarningState } from '@/components/canvas/TransparencyWarning'
import { isCropping } from '@/lib/crop-tool'
import { updateQrPlaceholder, updateNameText, isLockedElement } from '@/lib/back-card'
import { addWaveIcon, removeWaveIcon, updateWaveIconColor } from '@/lib/wave-icon'
import { pushState, undo, redo, isHistoryLocked } from '@/lib/canvas-history'

// Custom properties to preserve through Fabric.js serialization
const CUSTOM_PROPS = [
  '_waveIcon',
  '_isLocked',
  '_layerLabel',
  '_isPlaceholder',
  '_qrPlaceholderBorder',
  '_qrPlaceholderLabel',
  '_backNameText',
  '_designId',
  '_isOpaque',
  '_addedInEngraved',
  '_originalSrc',
  '_layerType',
]

declare global {
  interface Window {
    __fabricCanvas: Canvas | null
    __fabricCanvasFront: Canvas | null
    __fabricCanvasBack: Canvas | null
  }
}

function safeParse(json: string | null): object | null {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    console.error('Failed to parse canvas JSON')
    return null
  }
}

function CardCanvas({ side }: { side: CardSide }) {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeSide = useDesignStore((s) => s.activeSide)
  const variationId = useDesignStore((s) => s.variationId)
  const materialId = useDesignStore((s) => s.materialId)
  const bgColor = useDesignStore((s) => side === 'front' ? s.frontBgColor : s.backBgColor)
  const setCanvasJson = useDesignStore((s) => s.setCanvasJson)
  const setActiveSide = useDesignStore((s) => s.setActiveSide)
  const backOption = useDesignStore((s) => s.backOption)
  const cardNames = useDesignStore((s) => s.cardNames)

  const isActive = activeSide === side
  const suppressSaveRef = useRef(false)

  const saveState = useCallback(() => {
    if (suppressSaveRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    if (isHistoryLocked(canvas)) return
    const json = JSON.stringify(canvas.toObject(CUSTOM_PROPS))
    setCanvasJson(side, json)
  }, [setCanvasJson, side])

  // Initialize canvas
  useEffect(() => {
    if (!canvasElRef.current) return

    const canvas = new Canvas(canvasElRef.current, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      backgroundColor: 'transparent',
      selection: true,
    })

    canvasRef.current = canvas

    if (side === 'front') {
      window.__fabricCanvasFront = canvas
      window.__fabricCanvas = canvas
    } else {
      window.__fabricCanvasBack = canvas
    }

    // Save initial state for undo
    pushState(canvas, CUSTOM_PROPS)

    const handler = () => {
      saveState()
      pushState(canvas, CUSTOM_PROPS)
    }
    canvas.on('object:modified', handler)
    canvas.on('object:added', handler)
    canvas.on('object:removed', handler)

    // Set this canvas as active when clicked
    canvas.on('mouse:down', () => {
      window.__fabricCanvas = canvas
      setActiveSide(side)
    })

    // Load initial state
    const state = useDesignStore.getState()
    const json = side === 'front' ? state.frontCanvasJson : state.backCanvasJson
    const parsed = safeParse(json)
    if (parsed) {
      canvas.loadFromJSON(parsed).then(() => canvas.renderAll()).catch(console.error)
    }

    return () => {
      canvas.off('object:modified', handler)
      canvas.off('object:added', handler)
      canvas.off('object:removed', handler)
      canvas.dispose()
      canvasRef.current = null
      if (side === 'front') {
        window.__fabricCanvasFront = null
      } else {
        window.__fabricCanvasBack = null
      }
    }
  }, [side, setActiveSide, saveState])

  // Update background color
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.backgroundColor = bgColor
    canvas.renderAll()
  }, [bgColor])

  // Apply material background image
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !variationId) return

    const variation = getVariation(variationId)
    const imageSrc = side === 'front' ? variation?.frontImage : variation?.backImage

    if (!imageSrc) {
      canvas.backgroundImage = undefined
      canvas.renderAll()
      return
    }

    const imgEl = new Image()
    imgEl.onload = () => {
      const fabricImg = new FabricImage(imgEl, {
        originX: 'left',
        originY: 'top',
      })
      fabricImg.scaleToWidth(CARD_WIDTH)
      fabricImg.scaleToHeight(CARD_HEIGHT)
      canvas.backgroundImage = fabricImg
      canvas.renderAll()
    }
    imgEl.onerror = () => {
      canvas.backgroundImage = undefined
      canvas.renderAll()
    }
    imgEl.src = imageSrc
  }, [variationId, side])

  // Back canvas: QR placeholder + name text
  useEffect(() => {
    if (side !== 'back') return
    const canvas = canvasRef.current
    if (!canvas) return
    // Suppress saveState during placeholder updates to avoid serialization
    // of objects without custom tags (Fabric toJSON strips them)
    suppressSaveRef.current = true
    updateQrPlaceholder(canvas)
    updateNameText(canvas, cardNames[0] || '')
    suppressSaveRef.current = false
  }, [side, backOption, variationId, materialId, cardNames])

  // Front canvas: wave/NFC icon for plastic and bamboo
  useEffect(() => {
    if (side !== 'front') return
    const canvas = canvasRef.current
    if (!canvas) return

    if (materialId === 'metal') {
      removeWaveIcon(canvas)
    } else {
      const variation = variationId ? getVariation(variationId) : undefined
      const color = variation?.defaultPrintColor ?? '#000000'
      // Add if not present, or update color if variation changed
      addWaveIcon(canvas, color)
      updateWaveIconColor(canvas, color)
    }
  }, [side, materialId, variationId])

  // Responsive scaling
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const resizeObserver = new ResizeObserver(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const containerWidth = container.clientWidth
      const scale = Math.min(containerWidth / CARD_WIDTH, 1)
      const wrapper = canvasElRef.current?.parentElement
      if (wrapper) {
        wrapper.style.transform = `scale(${scale})`
        wrapper.style.transformOrigin = 'top left'
        wrapper.style.width = `${CARD_WIDTH}px`
        wrapper.style.height = `${CARD_HEIGHT}px`
        container.style.height = `${CARD_HEIGHT * scale}px`
      }
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  // Delete selected object on keypress (only if this canvas is active)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return
      if (isCropping()) return // Block during crop
      // Don't intercept when a form field or contenteditable has focus
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return
      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const canvas = canvasRef.current
        if (canvas) undo(canvas, CUSTOM_PROPS)
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' && e.shiftKey || e.key === 'y')) {
        e.preventDefault()
        const canvas = canvasRef.current
        if (canvas) redo(canvas, CUSTOM_PROPS)
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const canvas = canvasRef.current
        if (!canvas) return
        const active = canvas.getActiveObject()
        if (active && !(active as FabricObject & { isEditing?: boolean }).isEditing && !isLockedElement(active)) {
          canvas.remove(active)
          canvas.discardActiveObject()
          canvas.renderAll()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isActive])

  const label = side === 'front' ? 'Front' : 'Back'

  // Subscribe to canvas JSON changes so we re-render when objects are added/removed
  const canvasJson = useDesignStore((s) => side === 'front' ? s.frontCanvasJson : s.backCanvasJson)
  // Check if front canvas has user-added content (excluding placeholders/wave icon)
  const hasUserContent = (() => {
    if (side !== 'front') return true
    // canvasJson dependency triggers re-evaluation
    void canvasJson
    const canvas = canvasRef.current
    if (!canvas) return false
    return canvas.getObjects().some((obj) => {
      const custom = obj as FabricObject & Record<string, unknown>
      return !custom._isPlaceholder && !custom._isLocked && !custom._waveIcon
    })
  })()

  // Get placeholder text color based on material
  const variation = variationId ? getVariation(variationId) : undefined
  const placeholderColor = materialId === 'metal'
    ? (variation?.engravedColor ?? '#C0C0C0')
    : (variation?.defaultPrintColor ?? '#000000')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        {isActive && (
          <span className="text-[10px] font-medium text-foreground bg-foreground/5 border border-border rounded px-1.5 py-0.5">
            Editing
          </span>
        )}
      </div>
      <div
        ref={containerRef}
        className={cn(
          'w-full overflow-hidden cursor-pointer border transition-all relative',
          isActive ? 'border-foreground/30 shadow-lg' : 'border-border shadow-md'
        )}
        style={{ borderRadius: `${CARD_CORNER_RADIUS}px` }}
        onClick={() => {
          window.__fabricCanvas = canvasRef.current
          setActiveSide(side)
        }}
      >
        <div className="overflow-hidden" style={{ borderRadius: `${CARD_CORNER_RADIUS - 1}px` }}>
          <canvas ref={canvasElRef} />
        </div>
        {/* "Add your design" placeholder — front only, hidden when user has content */}
        {side === 'front' && !hasUserContent && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none select-none"
            style={{ opacity: 0.35 }}
          >
            <span
              className="text-2xl font-semibold tracking-[0.2em] uppercase"
              style={{ color: placeholderColor }}
            >
              Add your design
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function getOpaqueImage(imageId: string | null): FabricImage | null {
  if (!imageId) return null
  for (const canvas of [window.__fabricCanvasFront, window.__fabricCanvasBack]) {
    if (!canvas) continue
    for (const obj of canvas.getObjects()) {
      const tagged = obj as FabricImage & { _designId?: string }
      if (tagged._designId === imageId) return obj as FabricImage
    }
  }
  return null
}

export function DesignCanvas() {
  const activeSide = useDesignStore((s) => s.activeSide)
  const opaqueWarning = useDesignStore((s) => s.opaqueImageWarning)
  const opaqueImageId = useDesignStore((s) => s.opaqueImageId)
  const setOpaqueWarning = useDesignStore((s) => s.setOpaqueWarning)
  const [cropping, setCropping] = useState(false)

  // Sync cropping state
  useEffect(() => {
    const interval = setInterval(() => {
      setCropping(isCropping())
    }, 100)
    return () => clearInterval(interval)
  }, [])

  const targetImage = getOpaqueImage(opaqueImageId)

  const layersFloating = (
    <div className="absolute top-0 left-[calc(100%+16px)] w-[220px] hidden xl:block">
      <div className="bg-card border border-border rounded-lg p-3 shadow-sm">
        <LayersPanel />
      </div>
    </div>
  )

  const layersInline = (
    <div className="xl:hidden mt-3">
      <div className="bg-card border border-border rounded-lg p-3 shadow-sm">
        <LayersPanel />
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Transparency warning banner */}
      {opaqueWarning && opaqueWarning !== 'dismissed' && !cropping && (
        <TransparencyWarning
          state={opaqueWarning as WarningState}
          onStateChange={(state) => setOpaqueWarning(state)}
          targetImage={targetImage}
        />
      )}

      <div className="relative">
        <CardCanvas side="front" />
        {activeSide === 'front' && cropping && (
          <CropActionBar onDone={() => setCropping(false)} />
        )}
        {activeSide === 'front' && !cropping && (
          <>
            {layersFloating}
            {layersInline}
          </>
        )}
      </div>
      <div className="relative">
        <CardCanvas side="back" />
        {activeSide === 'back' && cropping && (
          <CropActionBar onDone={() => setCropping(false)} />
        )}
        {activeSide === 'back' && !cropping && (
          <>
            {layersFloating}
            {layersInline}
          </>
        )}
      </div>
      <div className="text-center">
        <span className="text-[11px] text-muted-foreground">
          CR80 — 85.6 × 53.98 mm
        </span>
      </div>
    </div>
  )
}
