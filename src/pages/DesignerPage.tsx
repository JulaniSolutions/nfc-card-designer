import { DesignCanvas } from '@/components/canvas/DesignCanvas'
import { DesignToolbar } from '@/components/toolbar/DesignToolbar'
import { MaterialSelector } from '@/components/material/MaterialSelector'
import { ActionBar } from '@/components/toolbar/ActionBar'
import { CreditCard } from 'lucide-react'

export function DesignerPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-2.5">
          <CreditCard className="size-5 text-foreground" />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            NFC Card Designer
          </span>
        </div>
        <ActionBar />
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Sidebar */}
        <aside className="w-full lg:w-[280px] border-b lg:border-b-0 lg:border-r border-border bg-card overflow-y-auto order-2 lg:order-1">
          <div className="p-4 space-y-5">
            <MaterialSelector />
            <div className="h-px bg-border" />
            <DesignToolbar />
          </div>
        </aside>

        {/* Canvas area */}
        <main className="flex-1 order-1 lg:order-2 bg-muted/50 flex items-start lg:items-center justify-center p-6 lg:p-10 overflow-auto">
          <div className="w-full max-w-[680px]">
            <DesignCanvas />
          </div>
        </main>
      </div>
    </div>
  )
}
