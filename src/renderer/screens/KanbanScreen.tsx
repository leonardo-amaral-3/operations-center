import { useEffect, useReducer } from 'react'
import type { JSX } from 'react'

import type { BoardSnapshot } from '../../shared/board'
import { Column } from '../components/Column'
import { Freshness } from '../components/Freshness'

type BoardAction = { type: 'snapshot'; snapshot: BoardSnapshot }

/** Antes de qualquer leitura a tela não sabe nada do board — e é isso que o retrato vazio diz. */
const INITIAL_SNAPSHOT: BoardSnapshot = { board: null, readAt: null, error: null }

function reduce(_snapshot: BoardSnapshot, action: BoardAction): BoardSnapshot {
  // O retrato chega inteiro do main, que é quem decide o que sobrevive a uma falha. A tela não
  // recompõe nada: se ela mesclasse `board` antigo com `error` novo, existiriam duas regras de
  // preservação — uma aqui e outra lá — e um dia elas divergiriam.
  return action.snapshot
}

/**
 * O kanban: o board do GitHub desenhado em colunas, somente leitura.
 *
 * Quatro estados possíveis, e o par `board`/`error` é o que os separa: erro só toma a tela quando
 * não há primeira leitura a preservar. Nos demais casos os cartões ficam e quem acusa a idade é o
 * carimbo.
 */
export function KanbanScreen(): JSX.Element {
  const [snapshot, dispatch] = useReducer(reduce, INITIAL_SNAPSHOT)

  useEffect(() => {
    // Assinar vem **antes** de pedir, como no `ChatScreen`: uma leitura que termine entre o pedido
    // e a assinatura chegaria a ninguém.
    let pushed = false

    const unsubscribe = window.oc.onBoard((next) => {
      pushed = true
      dispatch({ type: 'snapshot', snapshot: next })
    })

    void window.oc.readBoard().then((next) => {
      // O retrato do `invoke` é o estado no instante em que o main atendeu; um evento publicado
      // enquanto a resposta voltava é mais novo que ele. Sem esta guarda, a resposta em trânsito
      // sobrescreveria uma leitura mais fresca — e a tela retrocederia no tempo.
      if (!pushed) dispatch({ type: 'snapshot', snapshot: next })
    })

    return unsubscribe
  }, [])

  const { board, readAt, error } = snapshot

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-800 px-4 py-3">
        {/* O título do board, e não "Operations Center": é o que faz o app dizer **qual** board
            está olhando — hoje isso vem de uma variável de ambiente invisível. */}
        <h1 className="truncate text-sm font-semibold tracking-tight">
          {board?.title ?? 'Operations Center'}
        </h1>
        <Freshness readAt={readAt} error={error} />
      </header>

      {board ? (
        <main className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
          {board.columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              // Filtra por `columnId`, nunca pelo nome — renomear a estação no board não pode
              // reposicionar cartão nenhum —, e `filter` preserva a ordem que o board devolveu.
              cards={board.cards.filter((card) => card.columnId === column.id)}
            />
          ))}
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 items-center justify-center p-8">
          {error === null ? (
            <p className="text-sm text-neutral-600">Lendo o board…</p>
          ) : (
            // O único caso em que o erro toma a tela: sem primeira leitura não há cartão a
            // preservar, e um vazio silencioso pareceria um board sem cards.
            <div className="max-w-lg text-center">
              <p className="text-sm text-neutral-300">Não foi possível ler o board.</p>
              <p className="mt-2 text-xs break-words text-neutral-500">{error}</p>
            </div>
          )}
        </main>
      )}
    </div>
  )
}
