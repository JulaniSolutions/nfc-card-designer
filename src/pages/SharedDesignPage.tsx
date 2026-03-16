import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { loadDesign } from '@/lib/save-design'
import { isSupabaseConfigured } from '@/lib/supabase'
import { DesignerPage } from './DesignerPage'
import { DesignPreview } from '@/components/preview/DesignPreview'
import { CreditCard, Loader2 } from 'lucide-react'

export function SharedDesignPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    // Reset state when navigating to a different design
    setLoading(true)
    setError(null)
    setEditing(false)

    async function load() {
      if (!id) {
        navigate('/')
        return
      }

      if (!isSupabaseConfigured()) {
        setError('Supabase is not configured')
        setLoading(false)
        return
      }

      const success = await loadDesign(id)
      if (!success) {
        setError('Design not found')
      }
      setLoading(false)
    }

    load()
  }, [id, navigate])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-5 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">Loading design...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <CreditCard className="size-8 text-muted-foreground/40 mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{error}</p>
            <p className="text-xs text-muted-foreground">
              This design may have been removed or the link is invalid.
            </p>
          </div>
          <a
            href="/"
            className="inline-block text-xs font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground transition-colors"
          >
            Create a new design
          </a>
        </div>
      </div>
    )
  }

  return editing ? <DesignerPage /> : <DesignPreview onEdit={() => setEditing(true)} />
}
