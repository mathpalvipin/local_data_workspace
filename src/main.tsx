import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import './App.css'
import { WorkerProvider } from './worker/WorkerProvider'
import { LoadPage } from './pages/LoadPage'
import { PreviewPage } from './pages/PreviewPage'
import { BenchPage } from './pages/BenchPage'

// WorkerProvider wraps the router rather than sitting inside a route: the
// worker holds the only copy of the data, and a route element is unmounted
// on navigation — which would terminate the worker and lose the file.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkerProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LoadPage />} />
          <Route path="/preview" element={<PreviewPage />} />
          <Route path="/bench" element={<BenchPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </WorkerProvider>
  </StrictMode>,
)
