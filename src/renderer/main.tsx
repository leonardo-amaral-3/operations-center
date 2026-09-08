import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './index.css'

// A combinação escolhida chega pela ponte, e é aplicada antes do primeiro render. O `index.html` já
// nasce com a default, então nunca há um instante sem cor — no máximo um tique de lavanda antes da
// troca, e ele acontece com a janela ainda escondida: o main só a mostra no `ready-to-show`.
document.documentElement.dataset.theme = window.oc.theme

const container = document.getElementById('root')
if (!container) {
  throw new Error('Elemento #root não encontrado em index.html')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
