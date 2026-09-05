import type { JSX } from 'react'

import type { SessionInit } from '../../shared/session'

interface StatusBarProps {
  init: SessionInit | null
}

/**
 * O que a sessão informou de si ao nascer: em que modelo roda, sobre qual pasta, e por qual
 * credencial. O `apiKeySource` está na tela por uma razão que não é decorativa — é a asserção do
 * CA-2, e o Playwright só enxerga o renderer.
 *
 * O elemento com `data-testid="session-init"` **só existe depois que o `init` chega**, e é isso que
 * torna a espera do smoke determinística: um placeholder com o atributo vazio deixaria o teste ler
 * um valor que ainda não é o da sessão.
 */
export function StatusBar({ init }: StatusBarProps): JSX.Element {
  if (!init) {
    return (
      <footer className="border-t border-neutral-800 px-4 py-2 text-[11px] text-neutral-500">
        Conectando à sessão do Claude Code…
      </footer>
    )
  }

  return (
    <footer
      data-testid="session-init"
      data-api-key-source={init.apiKeySource}
      className="flex items-center gap-4 border-t border-neutral-800 px-4 py-2 text-[11px] text-neutral-500"
    >
      <span className="min-w-0 truncate" title={init.cwd}>
        pasta <span className="text-neutral-300">{init.cwd}</span>
      </span>
      <span className="shrink-0">
        modelo <span className="text-neutral-300">{init.model}</span>
      </span>
      <span className="shrink-0">
        auth <span className="text-neutral-300">{init.apiKeySource}</span>
      </span>
      {/* O id é o que torna a sessão resumível pelo Claude Code depois de a janela fechar. */}
      <span className="ml-auto shrink-0 font-mono" title={init.sessionId}>
        {init.sessionId.slice(0, 8)}
      </span>
    </footer>
  )
}
