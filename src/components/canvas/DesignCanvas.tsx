import { useEffect, useRef, useCallback } from 'react'
import { Canvas, FabricObject, FabricImage } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { useDesignStore, type CardSide } from '@/store/design-store'
import { getVariation } from '@/config/materials'
import { cn } from '@/lib/utils'

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
  const bgColor = useDesignStore((s) => side === 'front' ? s.frontBgColor : s.backBgColor)
  const setCanvasJson = useDesignStore((s) => s.setCanvasJson)
  const setActiveSide = useDesignStore((s) => s.setActiveSide)

  const isActive = activeSide === side

  const saveState = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const json = JSON.stringify(canvas.toJSON())
    setCanvasJson(side, json)
  }, [setCanvasJson, side])

  // Initialize canvas
  useEffect(() => {
    if (!canvasElRef.current) return

    const canvas = new Canvas(canvasElRef.current, {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      backgroundColor: '#ffffff',
      selection: true,
    })

    canvasRef.current = canvas

    if (side === 'front') {
      window.__fabricCanvasFront = canvas
      window.__fabricCanvas = canvas
    } else {
      window.__fabricCanvasBack = canvas
    }

    const handler = () => saveState()
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
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const canvas = canvasRef.current
        if (!canvas) return
        const active = canvas.getActiveObject()
        if (active && !(active as FabricObject & { isEditing?: boolean }).isEditing) {
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
          'w-full overflow-hidden cursor-pointer',
        )}
        onClick={() => {
          window.__fabricCanvas = canvasRef.current
          setActiveSide(side)
        }}
      >
        <div className={cn(
          'relative rounded-xl overflow-hidden shadow-md ring-1 transition-all',
          isActive ? 'ring-foreground/30 shadow-lg' : 'ring-border'
        )}>
          <canvas ref={canvasElRef} />
        </div>
      </div>
    </div>
  )
}

export function DesignCanvas() {
  return (
    <div className="space-y-6">
      <CardCanvas side="front" />
      <CardCanvas side="back" />
      <div className="text-center">
        <span className="text-[11px] text-muted-foreground">
          CR80 — 85.6 × 53.98 mm
        </span>
      </div>
    </div>
  )
}
