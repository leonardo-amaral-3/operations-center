import type { JSX } from 'react'

import type { BoardCard, BoardColumn } from '../../shared/board'
import { BoardCardView } from './BoardCardView'
import type { CardSession, CardSessions } from './CardChat'

interface ColumnProps {
  column: BoardColumn
  /** Já filtrados para esta coluna, **na ordem em que o board os devolveu**. */
  cards: readonly BoardCard[]
  /** O cartão aberto do kanban inteiro — pode não estar nesta coluna, ou não existir. */
  expandedItemId: string | null
  sessions: CardSessions
  onToggle: (itemId: string) => void
  onSession: (itemId: string, session: CardSession) => void
}

/**
 * Uma estação da esteira: o cabeçalho com o nome e a contagem, e a pilha de cartões.
 *
 * Coluna sem nenhum cartão continua sendo desenhada, com a contagem em zero. O CA-1 afirma que as 8
 * estações aparecem, não que as ocupadas aparecem — e uma coluna que some ao esvaziar faria o
 * kanban mudar de forma ao longo do dia.
 *
 * Enquanto hospeda o cartão aberto ela **alarga**, e as vizinhas escorregam: 288px não sustentam
 * mensagem do Claude, descrição de opção e prompt de permissão legíveis, que é o NFR do PRD. O
 * kanban continua rolando na horizontal, como já rola com 8 colunas.
 */
export function Column({
  column,
  cards,
  expandedItemId,
  sessions,
  onToggle,
  onSession,
}: ColumnProps): JSX.Element {
  const hosting = cards.some((card) => card.itemId === expandedItemId)

  return (
    <section
      data-testid="column"
      data-column-id={column.id}
      data-column-name={column.name}
      data-column-count={String(cards.length)}
      className={`flex ${
        hosting ? 'w-[34rem]' : 'w-72'
      } shrink-0 flex-col rounded-lg border border-neutral-800 bg-neutral-950/60`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-neutral-800 px-3 py-2">
        <h2 className="truncate text-xs font-semibold text-neutral-300" title={column.name}>
          {column.name}
        </h2>
        <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-neutral-500">
          {cards.length}
        </span>
      </header>

      {/* O scroll é da coluna, não da página: as 8 estações precisam continuar lado a lado enquanto
          a mais cheia cresce. */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {cards.map((card) => (
          // `itemId` e não o número: é a chave estável mesmo se a issue mudar de repo.
          <BoardCardView
            key={card.itemId}
            card={card}
            // A conversabilidade é da coluna e vem decidida do core — a tela não reimplementa a
            // regra, só a repassa ao cartão que está dentro dela.
            conversable={column.conversable}
            expanded={card.itemId === expandedItemId}
            session={sessions[card.itemId]}
            onToggle={onToggle}
            onSession={onSession}
          />
        ))}
      </div>
    </section>
  )
}
