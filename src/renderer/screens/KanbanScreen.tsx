import { useCallback, useEffect, useReducer, useState } from 'react'
import type { JSX } from 'react'

import type { BoardTab, BoardsSnapshot } from '../../shared/board'
import type { SessionState } from '../../shared/session'
import type { CardSession, CardSessions } from '../components/CardChat'
import { Column } from '../components/Column'
import { Freshness } from '../components/Freshness'
import { Badge } from '../ui/badge'

type BoardAction = { type: 'snapshot'; snapshot: BoardsSnapshot }

/**
 * Antes da descoberta a tela não sabe nem quantos boards existem — e `boards: null` é exatamente
 * isso, e não "descobri e não achei nenhum".
 */
const INITIAL_SNAPSHOT: BoardsSnapshot = { boards: null, activeKey: null, discoveryError: null }

function reduce(_snapshot: BoardsSnapshot, action: BoardAction): BoardsSnapshot {
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
  /**
   * Os cartões com conversa a retomar. Vazio até a verificação do boot terminar — e é assim que
   * deve ser: um cartão sem conversa recuperável volta sem crachá (CA-3), e o vazio é a mesma
   * resposta que ele daria depois.
   */
  const [conversations, setConversations] = useState<readonly string[]>([])
  /**
   * Os cartões que rodam sem o portão. Vazio até a leitura do disco voltar, e é o lado seguro: um
   * cartão volta **com** portão até o contrário ser sabido, nunca o inverso.
   */
  const [dangerous, setDangerous] = useState<readonly string[]>([])

  useEffect(() => {
    // Assinar vem **antes** de pedir, como no `ChatScreen`: uma leitura que termine entre o pedido
    // e a assinatura chegaria a ninguém.
    let pushed = false

    const unsubscribe = window.oc.onBoards((next) => {
      pushed = true
      dispatch({ type: 'snapshot', snapshot: next })
    })

    void window.oc.readBoards().then((next) => {
      // O retrato do `invoke` é o estado no instante em que o main atendeu; um evento publicado
      // enquanto a resposta voltava é mais novo que ele. Sem esta guarda, a resposta em trânsito
      // sobrescreveria uma leitura mais fresca — e a tela retrocederia no tempo.
      //
      // A guarda ficou **mais** importante com a descoberta assíncrona, não menos: a janela entre o
      // pedido e o primeiro evento deixou de ser uma leitura em voo e passou a ser a descoberta
      // inteira, e o retrato que volta daqui quase sempre é o `boards: null` de antes dela.
      if (!pushed) dispatch({ type: 'snapshot', snapshot: next })
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    // Assinar antes de pedir, e pela mesma razão do board logo acima.
    let pushed = false

    const unsubscribe = window.oc.onConversations((next) => {
      pushed = true
      setConversations(next.itemIds)
    })

    void window.oc.readConversations().then((next) => {
      // A verificação do boot pode terminar enquanto esta resposta volta. Sem a guarda, o retrato
      // antigo sobrescreveria o evento mais novo — a mesma corrida do `readBoards`.
      if (!pushed) setConversations(next.itemIds)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    // Espelha o efeito das conversas linha a linha — assinar antes de pedir, e a mesma guarda —
    // porque é a mesma corrida: o `refresh` do boot pode publicar enquanto esta resposta volta.
    let pushed = false

    const unsubscribe = window.oc.onDangerous((next) => {
      pushed = true
      setDangerous(next.itemIds)
    })

    void window.oc.readDangerous().then((next) => {
      if (!pushed) setDangerous(next.itemIds)
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

  const toggleDangerous = useCallback((itemId: string, dangerous: boolean) => {
    // Sem estado otimista: o crachá segue o retrato publicado. É o que faz uma recusa do SDK
    // simplesmente não mover a tela, em vez de movê-la e ter de voltar atrás. E sem guarda de
    // clique duplo aqui: quem a tem é o `#switching` do core, num lugar só.
    void window.oc.setDangerous({ itemId, dangerous })
  }, [])

  const { boards, activeKey, discoveryError } = snapshot
  // A aba ativa sai do `activeKey`, que é do main: a tela não escolhe aba, só desenha a escolhida.
  // Na Fase 0 é sempre a primeira da ordem da descoberta, porque não há aba lembrada.
  const active = boards?.find((tab) => tab.key === activeKey) ?? null
  // Guardado num `const` de propósito: a narrowing de `active.board` se perderia dentro do `map`
  // abaixo, que é um callback, e a de um `const` não.
  const board = active?.board ?? null

  return (
    <div className="flex h-full flex-col bg-background font-base text-foreground">
      <header className="flex items-center justify-between gap-4 border-b-2 border-border px-4 py-3">
        {/* O título do board, e não "Operations Center": é o que faz o app dizer **qual** board
            está olhando. O nome do app só aparece quando não há board nenhum a nomear. */}
        <h1 className="truncate text-sm font-heading tracking-tight">
          {active?.title ?? 'Operations Center'}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {/* Um dono que não respondeu não apaga os boards dos que responderam — e também não some
              da tela. Fica ao lado do carimbo de frescor porque é a mesma frase: o que está aí é
              verdade, só que incompleta. O motivo inteiro vai no `title`, como no carimbo. */}
          {boards !== null && discoveryError !== null && (
            <Badge variant="neutral" className="bg-warning" title={discoveryError}>
              descoberta parcial
            </Badge>
          )}
          {/* Sem aba ativa não há leitura de que falar, e um carimbo dizendo "sem leitura" ali seria
              o app respondendo uma pergunta que ninguém fez. */}
          {active && <Freshness readAt={active.readAt} error={active.error} />}
        </div>
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
              conversations={conversations}
              dangerous={dangerous}
              onToggle={toggle}
              onSession={registerSession}
              onToggleDangerous={toggleDangerous}
            />
          ))}
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 items-center justify-center p-8">
          <SemKanban boards={boards} discoveryError={discoveryError} active={active} />
        </main>
      )}
    </div>
  )
}

interface SemKanbanProps {
  boards: readonly BoardTab[] | null
  discoveryError: string | null
  active: BoardTab | null
}

/**
 * A área do kanban quando não há kanban a desenhar — quatro frases, e nenhuma delas é chute.
 *
 * O `null` de `boards` é o que separa "ainda estou descobrindo" de "descobri, e nenhum board seu
 * roda a esteira": sem ele as duas seriam a mesma lista vazia e a tela teria de adivinhar qual
 * dizer. O erro só toma a área quando **não há nada a preservar** — nem aba, nem primeira leitura
 * daquela aba; nos demais casos os cartões ficam e quem acusa a idade é o carimbo.
 */
function SemKanban({ boards, discoveryError, active }: SemKanbanProps): JSX.Element {
  if (boards === null) {
    return discoveryError === null ? (
      <p className="text-sm text-foreground/60">Descobrindo os boards…</p>
    ) : (
      <Motivo titulo="Não foi possível descobrir os boards." motivo={discoveryError} />
    )
  }

  // Sem aba ativa depois da descoberta é a lista vazia: quem escolhe a ativa é o main, e ele só
  // devolve `null` quando não sobrou board nenhum. A tela não reimplementa essa escolha para
  // conferi-la — seria a segunda regra de preservação que este arquivo existe para não ter.
  if (active === null) {
    return (
      <p className="text-sm text-foreground/60">
        Nenhum board que você acessa roda a esteira <code>gm-*</code>.
      </p>
    )
  }

  return active.error === null ? (
    <p className="text-sm text-foreground/60">Lendo o board…</p>
  ) : (
    <Motivo titulo="Não foi possível ler o board." motivo={active.error} />
  )
}

/** O erro ocupando a área do kanban: o que falhou em cima, o motivo cru embaixo. */
function Motivo({ titulo, motivo }: { titulo: string; motivo: string }): JSX.Element {
  return (
    <div className="max-w-lg text-center">
      <p className="text-sm text-foreground">{titulo}</p>
      <p className="mt-2 text-xs break-words text-foreground/60">{motivo}</p>
    </div>
  )
}
