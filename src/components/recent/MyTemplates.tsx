import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutTemplate, Loader2, Copy, Check, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  getTemplateHistory,
  removeTemplateFromHistory,
  type TemplateHistoryEntry,
} from '@/lib/template-history'
import { buildTemplateUrl } from '@/lib/templates'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'

interface TemplateItem {
  templateId: string
  name: string
  useCount: number
  previewUrl: string | null
  updatedAt: string
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

export function MyTemplates() {
  const navigate = useNavigate()
  const [history, setHistory] = useState<TemplateHistoryEntry[]>([])
  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Read history on mount to check if we should render at all
  useEffect(() => {
    setHistory(getTemplateHistory())
  }, [])

  const fetchTemplates = useCallback(async () => {
    if (!isSupabaseConfigured() || !supabase) return

    const entries = getTemplateHistory()
    setHistory(entries)
    if (entries.length === 0) {
      setTemplates([])
      return
    }

    setLoading(true)
    try {
      const ids = entries.map((e) => e.templateId)
      const { data, error } = await supabase
        .from('templates')
        .select('template_id, name, use_count, front_preview_url, updated_at')
        .in('template_id', ids)

      if (error || !data) {
        setTemplates([])
        return
      }

      // Anything missing has been unpublished elsewhere — drop it locally too
      const foundIds = new Set(data.map((t) => t.template_id))
      for (const entry of entries) {
        if (!foundIds.has(entry.templateId)) {
          removeTemplateFromHistory(entry.templateId)
        }
      }

      // Sort by publishedAt from history
      const entryOrder = new Map(entries.map((e, i) => [e.templateId, i]))
      const sorted = data
        .slice()
        .sort((a, b) => (entryOrder.get(a.template_id) ?? 0) - (entryOrder.get(b.template_id) ?? 0))

      setTemplates(
        sorted.map((t) => ({
          templateId: t.template_id,
          name: t.name,
          useCount: t.use_count ?? 0,
          previewUrl: t.front_preview_url,
          updatedAt: t.updated_at,
        })),
      )
    } finally {
      setLoading(false)
    }
  }, [])

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      fetchTemplates()
    }
  }

  const handleOpenTemplate = (template: TemplateItem) => {
    setOpen(false)
    navigate(new URL(buildTemplateUrl(template.templateId, template.name)).pathname)
  }

  const handleCopy = async (template: TemplateItem) => {
    await navigator.clipboard.writeText(buildTemplateUrl(template.templateId, template.name))
    setCopiedId(template.templateId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  if (history.length === 0) return null

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="xs" className="gap-1 text-muted-foreground" />
        }
      >
        <LayoutTemplate className="size-3.5" />
        Templates
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={8} className="w-80 p-0">
        <div className="px-3 py-2 border-b border-border">
          <p className="text-xs font-medium text-foreground">My Templates</p>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {loading && templates.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-4 text-muted-foreground animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-xs text-muted-foreground">No published templates found</p>
            </div>
          ) : (
            <div className="py-1">
              {templates.map((template) => (
                <div
                  key={template.templateId}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/50 transition-colors"
                >
                  <div className="w-[60px] h-[38px] rounded border border-border bg-muted/30 overflow-hidden shrink-0">
                    {template.previewUrl ? (
                      <img
                        src={template.previewUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <LayoutTemplate className="size-3 text-muted-foreground/50" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {template.name || 'Untitled'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {relativeTime(template.updatedAt)}
                      {' · '}
                      used {template.useCount} {template.useCount === 1 ? 'time' : 'times'}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      onClick={() => handleCopy(template)}
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      aria-label="Copy template link"
                    >
                      {copiedId === template.templateId ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </Button>
                    <Button
                      onClick={() => handleOpenTemplate(template)}
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      aria-label="Open template"
                    >
                      <ExternalLink className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
