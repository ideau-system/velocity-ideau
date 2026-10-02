import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// O estilo global vem antes do App: o CSS de cada tela, importado por ela, vence os empates.
import './styles.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
