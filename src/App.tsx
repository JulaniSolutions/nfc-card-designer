import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { DesignerPage } from '@/pages/DesignerPage'
import { SharedDesignPage } from '@/pages/SharedDesignPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DesignerPage />} />
        <Route path="/design/:id" element={<SharedDesignPage />} />
        <Route path="/design/:id/:slug" element={<SharedDesignPage />} />
      </Routes>
      <Analytics />
    </BrowserRouter>
  )
}

export default App
