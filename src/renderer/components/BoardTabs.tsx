import type { JSX } from 'react'

import type { BoardTab } from '../../shared/board'
import { Button } from '../ui/button'

interface BoardTabsProps {
  boards: readonly BoardTab[]
  activeKey: string | null
  onActivate: (key: string) => void
}

/**
 * A barra de abas: um board descoberto por aba, e o rótulo é o título dele.
 *
 * **Aba única continua sendo desenhada.** Uma barra que aparece com dois boards e some com um
 * mudaria a forma do app conforme o dia — e o rótulo da aba ativa é justamente o que diz *qual*
 * board está na tela agora que o cabeçalho não tem mais título fixo.
 *
 * A barra **não guarda aba ativa própria**: o clique só avisa o main, e a `activeKey` volta no
 * retrato. Um estado local aqui seria uma segunda fonte da verdade, e ela discordaria da primeira
 * no dia em que a gravação da preferência falhasse.
 *
 * Semântica antes de pele: `tablist`/`tab` com `aria-selected` é o que faz a barra ser navegável
 * sem enxergar a cor — a seleção não pode existir só no violeta do fundo.
 */
export function BoardTabs({ boards, activeKey, onActivate }: BoardTabsProps): JSX.Element {
  return (
    <nav
      role="tablist"
      aria-label="Boards"
      data-testid="board-tabs"
      // O `overflow-x-auto` recorta na padding box, e a sombra dura sai 4px para a direita e para
      // baixo de cada aba — sem os `p*-1` ela viria cortada em **toda** aba, e não só quando a
      // barra rola. Os `-m*-1` devolvem os 4px ao layout, para a barra continuar centrada com o
      // carimbo de frescor do outro lado do cabeçalho. Mesmo cuidado que o `p-2` da `Column` toma
      // com a sombra do cartão.
      className="-mr-1 -mb-1 flex min-w-0 items-center gap-2 overflow-x-auto pr-1 pb-1"
    >
      {boards.map((tab) => {
        const selected = tab.key === activeKey

        return (
          <Button
            // A `key` do board é a chave de render pela mesma razão que o `itemId` é a do cartão:
            // ela é estável, e o título muda a cada leitura bem-sucedida do board.
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid="board-tab"
            data-board-key={tab.key}
            // A casca inteira vem da primitiva — a ativa no mesmo violeta do cabeçalho de coluna,
            // que é o acento da esteira; a inativa no fundo secundário. Nenhuma cor decidida aqui.
            variant={selected ? 'default' : 'neutral'}
            size="xs"
            className="max-w-56 shrink-0 font-heading"
            // O título inteiro no `title`, porque o rótulo trunca: uma aba chamada
            // "Plataformas v2 — legado" não pode virar "Plataformas v2 —…" sem recurso.
            title={tab.title}
            onClick={() => onActivate(tab.key)}
          >
            <span className="truncate">{tab.title}</span>
          </Button>
        )
      })}
    </nav>
  )
}
