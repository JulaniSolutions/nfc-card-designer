import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { loadDesign } from '@/lib/save-design'
import { isSupabaseConfigured } from '@/lib/supabase'
import { DesignerPage } from './DesignerPage'

export function SharedDesignPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
        <p className="text-muted-foreground">Loading design...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-destructive">{error}</p>
          <a href="/" className="text-sm underline">
            Create a new design
          </a>
        </div>
      </div>
    )
  }

  return <DesignerPage />
}
