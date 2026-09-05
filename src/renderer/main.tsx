import type { JSX } from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Placeholder: a tela de chat (`App.tsx` e componentes) entra na task do renderer.
function Placeholder(): JSX.Element {
  return (
    <main className="flex h-screen items-center justify-center bg-neutral-950 text-neutral-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Operations Center</h1>
        <p className="mt-2 text-sm text-neutral-400">A casca está de pé. O chat vem a seguir.</p>
      </div>
    </main>
  )
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('Elemento #root não encontrado em index.html')
}

createRoot(container).render(
  <StrictMode>
    <Placeholder />
  </StrictMode>,
)
