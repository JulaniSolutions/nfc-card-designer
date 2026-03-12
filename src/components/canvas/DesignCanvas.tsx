import { useEffect, useRef, useCallback } from 'react'
import { Canvas, FabricObject } from 'fabric'
import { CARD_WIDTH, CARD_HEIGHT } from '@/config/canvas'
import { useDesignStore, type CardSide } from '@/store/design-store'

declare global {
  interface Window {
    __fabricCanvas: Canvas | null
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

export function DesignCanvas() {
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevSideRef = useRef<CardSide>('front')

  const activeSide = useDesignStore((s) => s.activeSide)
  const frontBgColor = useDesignStore((s) => s.frontBgColor)
  const backBgColor = useDesignStore((s) => s.backBgColor)
  const setCanvasJson = useDesignStore((s) => s.setCanvasJson)

  const bgColor = activeSide === 'front' ? frontBgColor : backBgColor

  const makeHandler = useCallback(() => {
    return () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const json = JSON.stringify(canvas.toJSON())
      const side = useDesignStore.getState().activeSide
      setCanvasJson(side, json)
    }
  }, [setCanvasJson])

  const saveCurrentState = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const json = JSON.stringify(canvas.toJSON())
    setCanvasJson(prevSideRef.current, json)
  }, [setCanvasJson])

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
    window.__fabricCanvas = canvas

    const handler = makeHandler()
    canvas.on('object:modified', handler)
    canvas.on('object:added', handler)
    canvas.on('object:removed', handler)

    const state = useDesignStore.getState()
    const parsed = safeParse(state.frontCanvasJson)
    if (parsed) {
      canvas.loadFromJSON(parsed).then(() => canvas.renderAll()).catch(console.error)
    }

    return () => {
      canvas.off('object:modified', handler)
      canvas.off('object:added', handler)
      canvas.off('object:removed', handler)
      canvas.dispose()
      canvasRef.current = null
      window.__fabricCanvas = null
    }
  }, [makeHandler])

  // Handle side switching — only triggered by activeSide change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (prevSideRef.current === activeSide) return

    saveCurrentState()

    const state = useDesignStore.getState()
    const jsonToLoad = activeSide === 'front' ? state.frontCanvasJson : state.backCanvasJson
    const parsed = safeParse(jsonToLoad)

    canvas.clear()

    const finalize = () => {
      const bg = activeSide === 'front'
        ? useDesignStore.getState().frontBgColor
        : useDesignStore.getState().backBgColor
      canvas.backgroundColor = bg
      canvas.renderAll()
      prevSideRef.current = activeSide
    }

    if (parsed) {
      canvas.loadFromJSON(parsed).then(finalize).catch((err) => {
        console.error('Failed to load canvas side:', err)
        finalize()
      })
    } else {
      finalize()
    }
  }, [activeSide, saveCurrentState])

  // Update background color
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.backgroundColor = bgColor
    canvas.renderAll()
  }, [bgColor])

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

  // Delete selected object on keypress
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [])

  return (
    <div ref={containerRef} className="w-full overflow-hidden">
      <div className="relative rounded-xl overflow-hidden shadow-lg border border-border">
        <canvas ref={canvasElRef} />
      </div>
    </div>
  )
}
