import { useCallback, useEffect, useReducer, useState } from 'react'
import type { JSX } from 'react'

import type { BoardSnapshot } from '../../shared/board'
import type { SessionState } from '../../shared/session'
import type { CardSession, CardSessions } from '../components/CardChat'
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

type SessionsAction =
  | { type: 'card'; itemId: string; session: CardSession }
  | { type: 'state'; sessionId: string; state: SessionState }

/**
 * O registro de sessões por cartão.
 *
 * Ele existe para o cartão **fechado**: enquanto o chat está na tela, quem sabe da sessão é o
 * próprio `CardChat`. Fechado o cartão, a sessão continua viva (CA-6) e este registro é a única
 * coisa que ainda a enxerga.
 */
function reduceSessions(sessions: CardSessions, action: SessionsAction): CardSessions {
  if (action.type === 'card') {
    const known = sessions[action.itemId]
    // Devolver o **mesmo** registro quando nada mudou não é micro-otimização: o `CardChat` relata a
    // sessão de dentro de um efeito, e um registro novo a cada relato redesenharia o board em laço
    // sem a sessão ter mexido um dedo.
    if (known && known.id === action.session.id && known.state === action.session.state) {
      return sessions
    }

    return { ...sessions, [action.itemId]: action.session }
  }

  // O evento vem por `sessionId` e o registro é por cartão; quem casa os dois é o relato do
  // `CardChat`, feito assim que o retrato da sessão voltou. Evento de sessão que este kanban não
  // conhece simplesmente não tem onde entrar.
  const owner = Object.entries(sessions).find(([, session]) => session.id === action.sessionId)
  if (!owner) return sessions

  return { ...sessions, [owner[0]]: { id: action.sessionId, state: action.state } }
}

/**
 * O kanban: o board do GitHub desenhado em colunas, e o chat de cada cartão dentro do próprio
 * cartão.
 *
 * Quatro estados possíveis para o board, e o par `board`/`error` é o que os separa: erro só toma a
 * tela quando não há primeira leitura a preservar. Nos demais casos os cartões ficam e quem acusa a
 * idade é o carimbo.
 *
 * **Nenhum `close()` na saída de cena**, ao contrário do `ChatScreen`: aqui a sessão sobrevive à
 * vista, e o único encerramento é o do CA-6 — o botão do cartão, ou o desligamento do app.
 */
export function KanbanScreen(): JSX.Element {
  const [snapshot, dispatch] = useReducer(reduce, INITIAL_SNAPSHOT)
  const [sessions, dispatchSession] = useReducer(reduceSessions, {})
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)

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

  useEffect(() => {
    // O kanban acompanha o estado das sessões por conta própria, e não só através do cartão aberto:
    // sem isto o sinal de um cartão fechado congelaria no instante em que ele fechou, e ele mostraria
    // "Trabalhando" para sempre depois de a sessão já ter pedido a vez de volta.
    return window.oc.onState((event) => {
      dispatchSession({ type: 'state', sessionId: event.sessionId, state: event.state })
    })
  }, [])

  const toggle = useCallback((itemId: string) => {
    // Um cartão aberto por vez (RF-6): abrir o segundo fecha o primeiro — e **não** encerra a sessão
    // dele, que continua viva atrás do cartão fechado.
    setExpandedItemId((current) => (current === itemId ? null : itemId))
  }, [])

  const registerSession = useCallback((itemId: string, session: CardSession) => {
    dispatchSession({ type: 'card', itemId, session })
  }, [])

  const { board, readAt, error } = snapshot

  return (
    <div className="flex h-full flex-col bg-background font-base text-foreground">
      <header className="flex items-center justify-between gap-4 border-b-2 border-border px-4 py-3">
        {/* O título do board, e não "Operations Center": é o que faz o app dizer **qual** board
            está olhando — hoje isso vem de uma variável de ambiente invisível. */}
        <h1 className="truncate text-sm font-heading tracking-tight">
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
              expandedItemId={expandedItemId}
              sessions={sessions}
              onToggle={toggle}
              onSession={registerSession}
            />
          ))}
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 items-center justify-center p-8">
          {error === null ? (
            <p className="text-sm text-foreground/60">Lendo o board…</p>
          ) : (
            // O único caso em que o erro toma a tela: sem primeira leitura não há cartão a
            // preservar, e um vazio silencioso pareceria um board sem cards.
            <div className="max-w-lg text-center">
              <p className="text-sm text-foreground">Não foi possível ler o board.</p>
              <p className="mt-2 text-xs break-words text-foreground/60">{error}</p>
            </div>
          )}
        </main>
      )}
    </div>
  )
}
