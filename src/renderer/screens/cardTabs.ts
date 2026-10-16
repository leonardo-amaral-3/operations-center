/**
 * A lista de abas da faixa de conversas (#100, fase 2) — pura, sem React nem `window`.
 *
 * Mora fora do `CardTabs` pela mesma razão do `kanbanState`: a regra de quem ganha aba e em que
 * ordem merece teste sem montar tela.
 */

import type { BoardsSnapshot } from '../../shared/board'
import type { TerminalState } from '../../shared/claude'
import type { CardTerminals } from './KanbanScreen'

export interface AbaDeConversa {
  itemId: string
  number: number
  title: string
  state: TerminalState
  detached: boolean
}

/**
 * Uma aba por card com terminal vivo (estado ≠ `closed`) que o retrato resolve, em **qualquer**
 * board. `itemId` que o retrato não conhece fica de fora: sem número nem título não há o que
 * rotular.
 *
 * A ordem é a de chegada em `CardTerminals`, o primeiro aberto à esquerda: o `Record` guarda chaves
 * `PVTI_…`, não numéricas, então a ordem de inserção sobrevive ao spread do `reduceTerminals`.
 */
export function abasDeConversa(
  terminais: CardTerminals,
  snapshot: BoardsSnapshot,
  destacados: ReadonlySet<string>,
): AbaDeConversa[] {
  const cards = (snapshot.boards ?? []).flatMap((tab) => tab.board?.cards ?? [])

  return Object.entries(terminais).flatMap(([itemId, state]) => {
    if (state.kind === 'closed') return []

    const card = cards.find((candidato) => candidato.itemId === itemId)

    if (card === undefined) return []

    return [
      { itemId, number: card.number, title: card.title, state, detached: destacados.has(itemId) },
    ]
  })
}
