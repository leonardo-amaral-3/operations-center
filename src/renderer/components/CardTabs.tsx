import type { JSX } from 'react'

import type { TerminalState } from '../../shared/claude'
import { Button } from '../ui/button'
import { StateBadge } from './StateBadge'

export interface CardTab {
  itemId: string
  number: number
  title: string
  state: TerminalState
  detached: boolean
}

interface CardTabsProps {
  tabs: readonly CardTab[]
  onFocus: (itemId: string) => void
}

/**
 * A faixa de conversas (#100, fase 2): uma aba por card com terminal vivo, em qualquer board.
 *
 * A faixa **não guarda foco próprio** — o clique só avisa a tela, e quem mostra o card é o retrato,
 * como na `BoardTabs`. Lista vazia não desenha nada: uma faixa sem aba seria altura gasta à toa
 * em cima do kanban.
 */
export function CardTabs({ tabs, onFocus }: CardTabsProps): JSX.Element | null {
  if (tabs.length === 0) return null

  return (
    <nav
      aria-label="Conversas abertas"
      data-testid="card-tabs"
      // Mesmo cuidado de sombra da `BoardTabs`: o `overflow-x-auto` recorta a sombra dura da aba, e
      // os `p*-1` com `-m*-1` a devolvem sem mexer na altura da faixa.
      className="-mb-1 flex min-w-0 items-center gap-2 overflow-x-auto border-b-2 border-border px-4 py-2 pb-3"
    >
      {tabs.map((tab) => (
        <Button
          key={tab.itemId}
          type="button"
          variant="neutral"
          size="xs"
          data-testid="card-tab"
          data-item-id={tab.itemId}
          data-detached={tab.detached}
          // Toda aba é arrastável: soltar fora da janela abre o card numa janela própria. Quem decide
          // se o ponto ficou fora é o main (`atCursor`); o `dragend` chega com `dropEffect` `none`
          // tanto na soltura sobre a área de trabalho quanto no Esc, e os dois têm o mesmo efeito.
          draggable
          onDragEnd={() => {
            void window.oc.openCardWindow({ itemId: tab.itemId, atCursor: true })
          }}
          className="max-w-72 shrink-0 gap-2 font-heading"
          title={`#${tab.number} ${tab.title}`}
          onClick={() => {
            // Destacado, o card não está na principal: o clique traz a janela dele para a frente.
            if (tab.detached) void window.oc.focusCardWindow({ itemId: tab.itemId })
            else onFocus(tab.itemId)
          }}
        >
          {tab.detached ? (
            <span aria-hidden="true" title="Em outra janela">
              ⧉
            </span>
          ) : null}
          <StateBadge state={tab.state} />
          <span className="max-w-[24ch] truncate">
            #{tab.number} {tab.title}
          </span>
        </Button>
      ))}
    </nav>
  )
}
