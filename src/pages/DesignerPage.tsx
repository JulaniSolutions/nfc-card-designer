import { DesignCanvas } from '@/components/canvas/DesignCanvas'
import { DesignToolbar } from '@/components/toolbar/DesignToolbar'
import { MaterialSelector } from '@/components/material/MaterialSelector'
import { ActionBar } from '@/components/toolbar/ActionBar'

export function DesignerPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">NFC Card Designer</h1>
      </header>

      <div className="flex flex-col lg:flex-row gap-6 p-4 max-w-7xl mx-auto">
        {/* Sidebar */}
        <aside className="w-full lg:w-72 space-y-6 order-2 lg:order-1">
          <MaterialSelector />
          <DesignToolbar />
          <ActionBar />
        </aside>

        {/* Canvas area */}
        <main className="flex-1 order-1 lg:order-2">
          <div className="max-w-2xl mx-auto">
            <DesignCanvas />
          </div>
        </main>
      </div>
    </div>
  )
}
