import type { JSX } from 'react'

import { Button } from '../ui/button'

interface SemPastaProps {
  texto: string
  onCollapse?: () => void
  onEnded?: () => void
  /** Abre o diálogo de pasta; quem chama decide o que fazer com a escolha. */
  onChoose: () => void
}

/**
 * A vista de quem não tem pasta: extraída do ramo `unknownFolder` do `Chat` (#97 §11) para o
 * `ClaudeTerminal` reusar o mesmo JSX e os mesmos `data-testid`.
 */
export function SemPasta({ texto, onCollapse, onEnded, onChoose }: SemPastaProps): JSX.Element {
  return (
    <div className="mt-3 border-t-2 border-border pt-3">
      {/* Sem `card-chat` aqui, de propósito: não há sessão e não há conversa. O cartão está aberto
          para pedir a pasta, e é só isso que ele oferece (CA-5). */}
      <p className="text-xs break-words text-foreground/60">{texto}</p>

      <div className="mt-2 flex items-center justify-end gap-2">
        {/* A saída, e ela nunca falta — metade da Decisão 11 do #27. Aqui a sessão nem subiu (é o
            `view.id === null` da régua do rodapé, verdadeiro por construção neste ramo), então
            quem tem `onEnded` sai por ele direto: não há o que encerrar. Sem este botão, um painel
            que caísse aqui ficaria preso na coluna para sempre. */}
        {onCollapse ? (
          <Button
            type="button"
            data-testid="card-collapse"
            variant="neutral"
            size="xs"
            onClick={onCollapse}
          >
            Fechar
          </Button>
        ) : null}
        {onEnded ? (
          <Button
            type="button"
            data-testid="card-end-session"
            variant="neutral"
            size="xs"
            className="bg-danger text-danger-foreground"
            onClick={onEnded}
          >
            Fechar
          </Button>
        ) : null}
        {/* A ação primária desta vista, e a única que leva a algum lugar: sem pasta não há
            conversa, e o violet é o que separa "faça isto" de "saia daqui". */}
        <Button
          type="button"
          data-testid="choose-folder"
          size="xs"
          onClick={onChoose}
        >
          Escolher a pasta…
        </Button>
      </div>
    </div>
  )
}
