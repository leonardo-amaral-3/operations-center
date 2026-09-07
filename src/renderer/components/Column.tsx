import type { JSX } from 'react'

import type { BoardCard, BoardColumn } from '../../shared/board'
import { Badge } from '../ui/badge'
import { Card } from '../ui/card'
import { BoardCardView } from './BoardCardView'
import type { CardSession, CardSessions } from './CardChat'

interface ColumnProps {
  column: BoardColumn
  /** Já filtrados para esta coluna, **na ordem em que o board os devolveu**. */
  cards: readonly BoardCard[]
  /** O cartão aberto do kanban inteiro — pode não estar nesta coluna, ou não existir. */
  expandedItemId: string | null
  sessions: CardSessions
  /** Os cartões com conversa a retomar — do kanban inteiro, não só desta coluna. */
  conversations: readonly string[]
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
  conversations,
  onToggle,
  onSession,
}: ColumnProps): JSX.Element {
  const hosting = cards.some((card) => card.itemId === expandedItemId)

  return (
    // A raia não se separa do canvas pela cor — as duas são `bg-background`, que é o que a `Card` já
    // dá. Quem a recorta é a borda de 2px e a sombra dura, e é essa a troca de pele do card #8.
    //
    // `overflow-hidden` para o `border-b-2` do cabeçalho encostar nos cantos arredondados: sem ele o
    // separador atravessa o raio e sobra um bico preto em cada ponta.
    <Card asChild className={`${hosting ? 'w-[34rem]' : 'w-72'} shrink-0 overflow-hidden`}>
      <section
        data-testid="column"
        data-column-id={column.id}
        data-column-name={column.name}
        data-column-count={String(cards.length)}
      >
        {/* O violet mora aqui e só aqui: o acento marca **a esteira**, e as cores de estado marcam o
            que a sessão quer de você. Misturar os dois é o que os tokens de estado existem para
            impedir. */}
        <header className="flex items-center justify-between gap-2 border-b-2 border-border bg-main px-3 py-2">
          <h2 className="truncate text-xs font-heading" title={column.name}>
            {column.name}
          </h2>
          <Badge variant="neutral" className="px-2 py-0 font-mono text-[10px]">
            {cards.length}
          </Badge>
        </header>

        {/* O scroll é da coluna, não da página: as 8 estações precisam continuar lado a lado enquanto
            a mais cheia cresce.

            O `p-2` **não muda**, e é ele que faz o CA-3 fechar sem tocar em largura nenhuma: o
            recorte do `overflow` acontece na padding box, então os 8px acomodam os 4px de sombra do
            cartão sem clipá-la. */}
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
              // O conjunto vem inteiro e a coluna só pergunta por este cartão: a conversa é do
              // cartão, e ele pode ter andado de coluna desde que ela aconteceu.
              dormant={conversations.includes(card.itemId)}
              onToggle={onToggle}
              onSession={onSession}
            />
          ))}
        </div>
      </section>
    </Card>
  )
}
