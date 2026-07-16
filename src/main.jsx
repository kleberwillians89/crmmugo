import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import { ProtectedApp } from './components/ProtectedApp.jsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary><AuthProvider><ProtectedApp><App /></ProtectedApp></AuthProvider></AppErrorBoundary>
  </StrictMode>,
)
