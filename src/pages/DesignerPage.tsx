import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DesignCanvas } from '@/components/canvas/DesignCanvas'
import { DesignToolbar } from '@/components/toolbar/DesignToolbar'
import { MaterialSelector } from '@/components/material/MaterialSelector'
import { ActionBar } from '@/components/toolbar/ActionBar'
import { RecentDesigns } from '@/components/recent/RecentDesigns'
import { MyTemplates } from '@/components/recent/MyTemplates'
import { useDesignStore } from '@/store/design-store'
import { startAutoSave, loadDraft, restoreDraft, clearDraft } from '@/lib/auto-save'
import { CreditCard, Plus, Loader2, RotateCcw, X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

type DesignerLocationState = {
  fromTemplate?: boolean
  warning?: string
}

export function DesignerPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const designName = useDesignStore((s) => s.designName)
  const designId = useDesignStore((s) => s.designId)
  const isSaving = useDesignStore((s) => s.isSaving)
  const resetDesign = useDesignStore((s) => s.resetDesign)
  // Snapshotted on first render: the clearing effect below wipes location.state,
  // so later renders must not re-read it.
  const [navState] = useState<DesignerLocationState | null>(
    () => (location.state as DesignerLocationState | null) ?? null
  )
  const [templateWarning, setTemplateWarning] = useState<string | null>(() => {
    const warning = navState?.warning
    return typeof warning === 'string' && warning.trim().length > 0 ? warning : null
  })
  // Checked once on mount: not on shared design URLs, and never on top of a
  // design just forked from a template.
  const [draftAvailable, setDraftAvailable] = useState(() => {
    if (/^\/design\//.test(window.location.pathname)) return false
    if (navState?.fromTemplate) return false
    if (useDesignStore.getState().sourceTemplateId) return false
    return loadDraft() !== null
  })

  // Start auto-save on mount
  useEffect(() => {
    const cleanup = startAutoSave()
    return cleanup
  }, [])

  // Drop the router state once read so the notice cannot reappear on re-render
  // or back-navigation
  useEffect(() => {
    if (!navState) return
    navigate(location.pathname, { replace: true, state: null })
  }, [navState, navigate, location.pathname])

  // beforeunload warning for unsaved work
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const state = useDesignStore.getState()
      // Warn if there's canvas content that hasn't been saved to server
      const hasWork = state.frontCanvasJson || state.backCanvasJson
      const isUnsaved = !state.designId || state.hasUnsavedChanges
      if (hasWork && isUnsaved) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const handleRestoreDraft = () => {
    const draft = loadDraft()
    if (draft) {
      restoreDraft(draft)
      setDraftAvailable(false)
    }
  }

  const handleDismissDraft = () => {
    clearDraft()
    setDraftAvailable(false)
  }

  const handleNew = () => {
    // Briefly null out the variation to force effects to re-fire after reset
    useDesignStore.getState().setMaterial('', '')
    resetDesign()
    for (const canvas of [window.__fabricCanvasFront, window.__fabricCanvasBack]) {
      if (canvas) {
        canvas.getObjects().slice().forEach((obj) => canvas.remove(obj))
        canvas.backgroundColor = '#ffffff'
        canvas.renderAll()
      }
    }
    // Navigate to root if on a shared design URL
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', '/')
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      {/* Saving overlay — only for Update (designId exists), not Generate Link */}
      {isSaving && designId && (
        <div className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-5 text-foreground animate-spin" />
            <p className="text-sm text-muted-foreground">Saving design...</p>
          </div>
        </div>
      )}
      {/* Draft restoration toast */}
      {draftAvailable && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-card border border-border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3">
            <p className="text-sm text-foreground">Restore your previous design?</p>
            <Button onClick={handleRestoreDraft} size="sm" variant="default" className="gap-1.5 h-7">
              <RotateCcw className="size-3" />
              Restore
            </Button>
            <button onClick={handleDismissDraft} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
      {/* Template warning notice */}
      {templateWarning && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-card border border-border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="size-4 text-foreground shrink-0" />
            <p className="text-sm text-foreground">{templateWarning}</p>
            <button
              onClick={() => setTemplateWarning(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-border bg-card shrink-0 sticky top-0 z-40 lg:relative">
        <div className="h-14 flex items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <CreditCard className="size-5 text-foreground" />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              NFC Card Designer
            </span>
            {/* Desktop only: design name, new, recent */}
            <div className="hidden lg:contents">
              {designName && (
                <>
                  <span className="text-muted-foreground/40">/</span>
                  <span className="text-sm text-muted-foreground">{designName}</span>
                </>
              )}
              <Button onClick={handleNew} variant="ghost" size="xs" className="gap-1 ml-1 text-muted-foreground">
                <Plus className="size-3" />
                New
              </Button>
              <RecentDesigns />
              <MyTemplates />
            </div>
          </div>
          <ActionBar />
        </div>
        {/* Mobile sub-bar: design name, new, recent */}
        <div className="flex items-center gap-2 px-5 pb-2.5 -mt-1 lg:hidden">
          {designName && (
            <span className="text-xs text-muted-foreground truncate">{designName}</span>
          )}
          <Button onClick={handleNew} variant="ghost" size="xs" className="gap-1 text-muted-foreground shrink-0">
            <Plus className="size-3" />
            New
          </Button>
          <RecentDesigns />
          <MyTemplates />
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Sidebar */}
        <aside className="w-full lg:w-[280px] border-b lg:border-b-0 lg:border-r border-border bg-card overflow-y-auto order-2 lg:order-1">
          <div className="p-4 pb-20 lg:pb-8 space-y-5">
            <MaterialSelector />
            <div className="h-px bg-border" />
            <DesignToolbar />
          </div>
        </aside>

        {/* Canvas area */}
        <main className="flex-1 order-1 lg:order-2 bg-muted/50 flex p-6 lg:p-8 overflow-auto">
          <div className="w-full max-w-[580px] mx-auto xl:ml-[calc(50%-290px-110px)] xl:mr-0">
            <DesignCanvas />
          </div>
        </main>
      </div>
    </div>
  )
}
