import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { DesignerPage } from '@/pages/DesignerPage'
import { SharedDesignPage } from '@/pages/SharedDesignPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DesignerPage />} />
        <Route path="/design/:id" element={<SharedDesignPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
