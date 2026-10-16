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
          className="max-w-72 shrink-0 gap-2 font-heading"
          title={`#${tab.number} ${tab.title}`}
          onClick={() => onFocus(tab.itemId)}
        >
          <StateBadge state={tab.state} />
          <span className="max-w-[24ch] truncate">
            #{tab.number} {tab.title}
          </span>
        </Button>
      ))}
    </nav>
  )
}
