import type { JSX } from 'react'

import type { BoardCard } from '../../shared/board'

interface BoardCardViewProps {
  card: BoardCard
}

/**
 * O cartão fechado: o número e as etiquetas, o título, o responsável.
 *
 * Card fechado recebe tratamento apagado — menos contraste — para não competir com o que ainda está
 * em voo. É o caso da coluna ✅ Produção, que tende a crescer para sempre.
 */
export function BoardCardView({ card }: BoardCardViewProps): JSX.Element {
  return (
    <article
      data-testid="board-card"
      data-card-number={String(card.number)}
      data-card-column={card.columnId}
      data-card-closed={card.closed ? 'true' : 'false'}
      // Vazio quando sem dono, e não ausente: é o que deixa o teste afirmar "não tem responsável"
      // em vez de só não achar o atributo.
      data-card-assignees={card.assignees.join(',')}
      className={`rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2.5 ${
        card.closed ? 'opacity-55' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-neutral-500">#{card.number}</span>
        {card.fields.map((field) => (
          // A chave é o nome do campo, não o `optionId`: um card tem no máximo uma opção por campo,
          // e o nome é o que continua único mesmo se duas opções compartilharem rótulo.
          <span
            key={field.name}
            title={`${field.name}: ${field.value}`}
            className="rounded border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-[10px] text-neutral-400"
          >
            {field.value}
          </span>
        ))}
      </div>

      {/* `line-clamp` porque a legibilidade da coluna é NFR do PRD: um título de duas linhas não
          pode empurrar o cartão seguinte para fora da vista. O `title` devolve o texto inteiro. */}
      <p
        title={card.title}
        className={`mt-1.5 line-clamp-3 text-sm leading-snug ${
          card.closed ? 'text-neutral-400' : 'text-neutral-100'
        }`}
      >
        {card.title}
      </p>

      <p className="mt-2 text-[11px] text-neutral-500">
        {card.assignees.length === 0 ? (
          // Visível de propósito: hoje não distingue nada neste board, mas é o campo que a RF-4 vai
          // usar para decidir quem abre chat sozinho — e o cartão sem responsável é o convite da F5.
          <span className="text-neutral-600 italic">sem dono</span>
        ) : (
          card.assignees.join(', ')
        )}
      </p>
    </article>
  )
}
