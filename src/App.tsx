import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { DesignerPage } from '@/pages/DesignerPage'
import { SharedDesignPage } from '@/pages/SharedDesignPage'
import { TemplatePage } from '@/pages/TemplatePage'
import { ProductionPage } from '@/pages/ProductionPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DesignerPage />} />
        <Route path="/design/:id" element={<SharedDesignPage />} />
        <Route path="/design/:id/:slug" element={<SharedDesignPage />} />
        <Route path="/template/:id" element={<TemplatePage />} />
        <Route path="/template/:id/:slug" element={<TemplatePage />} />
        <Route path="/production" element={<ProductionPage />} />
      </Routes>
      <Analytics />
    </BrowserRouter>
  )
}

export default App
