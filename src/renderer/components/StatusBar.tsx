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
      <footer className="border-t-2 border-border px-4 py-2 text-[11px] text-foreground/60">
        Conectando à sessão do Claude Code…
      </footer>
    )
  }

  return (
    <footer
      data-testid="session-init"
      data-api-key-source={init.apiKeySource}
      className="flex items-center gap-4 border-t-2 border-border px-4 py-2 text-[11px] text-foreground/60"
    >
      {/* Etiqueta e valor deixam de ser dois cinzas e passam a ser peso mais opacidade: num tema
          de uma cor de texto só, é esse o contraste que sobrevive. */}
      <span className="min-w-0 truncate" title={init.cwd}>
        pasta <span className="font-heading text-foreground">{init.cwd}</span>
      </span>
      <span className="shrink-0">
        modelo <span className="font-heading text-foreground">{init.model}</span>
      </span>
      <span className="shrink-0">
        auth <span className="font-heading text-foreground">{init.apiKeySource}</span>
      </span>
      {/* O id é o que torna a sessão resumível pelo Claude Code depois de a janela fechar. */}
      <span
        className="ml-auto shrink-0 font-mono font-heading text-foreground"
        title={init.sessionId}
      >
        {init.sessionId.slice(0, 8)}
      </span>
    </footer>
  )
}
