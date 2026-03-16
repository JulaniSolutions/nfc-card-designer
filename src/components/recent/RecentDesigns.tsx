import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getDesignHistory, removeFromHistory, type DesignHistoryEntry } from '@/lib/design-history'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { getMaterial, getVariation } from '@/config/materials'
import { renderThumbnail } from '@/lib/render-preview'

interface DesignItem {
  designId: string
  name: string | null
  materialId: string
  variationId: string
  frontCanvasJson: string | null
  frontBgColor: string
  updatedAt: string
  thumbnail?: string
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

export function RecentDesigns() {
  const navigate = useNavigate()
  const [history, setHistory] = useState<DesignHistoryEntry[]>([])
  const [designs, setDesigns] = useState<DesignItem[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const thumbnailCache = useRef<Map<string, string>>(new Map())

  // Read history on mount to check if we should render at all
  useEffect(() => {
    setHistory(getDesignHistory())
  }, [])

  const fetchDesigns = useCallback(async () => {
    if (!isSupabaseConfigured() || !supabase) return

    const entries = getDesignHistory()
    setHistory(entries)
    if (entries.length === 0) {
      setDesigns([])
      return
    }

    setLoading(true)
    try {
      const ids = entries.map((e) => e.designId)
      const { data, error } = await supabase
        .from('designs')
        .select('design_id, name, material_id, variation_id, front_canvas_json, front_bg_color, updated_at')
        .in('design_id', ids)

      if (error || !data) {
        setDesigns([])
        return
      }

      // Remove entries not found in Supabase
      const foundIds = new Set(data.map((d) => d.design_id))
      for (const entry of entries) {
        if (!foundIds.has(entry.designId)) {
          removeFromHistory(entry.designId)
        }
      }

      // Sort by savedAt from history
      const entryOrder = new Map(entries.map((e, i) => [e.designId, i]))
      const sorted = data
        .filter((d) => foundIds.has(d.design_id))
        .sort((a, b) => (entryOrder.get(a.design_id) ?? 0) - (entryOrder.get(b.design_id) ?? 0))

      const items: DesignItem[] = sorted.map((d) => ({
        designId: d.design_id,
        name: d.name,
        materialId: d.material_id,
        variationId: d.variation_id,
        frontCanvasJson: d.front_canvas_json,
        frontBgColor: d.front_bg_color,
        updatedAt: d.updated_at,
        thumbnail: thumbnailCache.current.get(d.design_id),
      }))

      setDesigns(items)

      // Render thumbnails for items that don't have cached ones
      for (const item of items) {
        if (!thumbnailCache.current.has(item.designId)) {
          renderThumbnail(item.frontCanvasJson, item.frontBgColor, item.variationId)
            .then((thumb) => {
              thumbnailCache.current.set(item.designId, thumb)
              setDesigns((prev) =>
                prev.map((d) => (d.designId === item.designId ? { ...d, thumbnail: thumb } : d)),
              )
            })
            .catch(() => {})
        }
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      fetchDesigns()
    }
  }

  const handleClick = (designId: string) => {
    setOpen(false)
    navigate(`/design/${designId}`)
  }

  if (history.length === 0) return null

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="xs" className="gap-1 text-muted-foreground" />
        }
      >
        <Clock className="size-3.5" />
        Recent
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={8} className="w-80 p-0">
        <div className="px-3 py-2 border-b border-border">
          <p className="text-xs font-medium text-foreground">Recent Designs</p>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {loading && designs.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-4 text-muted-foreground animate-spin" />
            </div>
          ) : designs.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-xs text-muted-foreground">No recent designs found</p>
            </div>
          ) : (
            <div className="py-1">
              {designs.map((design) => {
                const material = getMaterial(design.materialId)
                const variation = getVariation(design.variationId)
                return (
                  <button
                    key={design.designId}
                    onClick={() => handleClick(design.designId)}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                  >
                    <div className="w-[60px] h-[38px] rounded border border-border bg-muted/30 overflow-hidden shrink-0">
                      {design.thumbnail ? (
                        <img
                          src={design.thumbnail}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Loader2 className="size-3 text-muted-foreground/50 animate-spin" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {design.name || 'Untitled'}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {material?.name} {variation?.name && `· ${variation.name}`}
                        {' · '}
                        {relativeTime(design.updatedAt)}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
