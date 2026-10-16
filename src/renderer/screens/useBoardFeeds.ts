import { useEffect, useRef, useState } from 'react'

import type { BoardsSnapshot } from '../../shared/board'
import type { ClaudeStateEvent } from '../../shared/claude'
import type { DangerousSnapshot } from '../../shared/ipc'

/**
 * O retrato antes de o disco responder — as duas listas vazias: um cartão volta **com** portão até
 * o contrário ser sabido, nunca o inverso. Constante de módulo porque é o valor inicial de um
 * `useState`.
 */
const SEM_MARCA: DangerousSnapshot = { itemIds: [], boardKeys: [] }

/** O que cada tela faz com os feeds que **não** guardam estado no hook: ela mesma despacha. */
export type BoardFeedsHandlers = {
  /** O retrato dos boards, na leitura inicial e a cada publicação. */
  readonly onSnapshot: (snapshot: BoardsSnapshot) => void
  /** Um evento de estado do terminal Claude, na leitura inicial (um por terminal vivo) e a cada mudança. */
  readonly onClaudeState: (event: ClaudeStateEvent) => void
}

/** O que o hook guarda por conta própria: as duas listas que a tela só lê. */
export type BoardFeeds = {
  /** Os cartões com conversa a retomar. Vazio até a verificação do boot terminar. */
  readonly conversations: readonly string[]
  /** O que roda sem o portão: marcados em disco e triagens marcadas nesta execução. */
  readonly dangerous: DangerousSnapshot
}

/**
 * As quatro assinaturas que alimentam o cartão — boards, conversas, perigoso e estados do Claude —,
 * extraídas do `KanbanScreen` para a tela do card usar as mesmas.
 *
 * **O hook não despacha em reducer nenhum.** O feed dos boards alimenta o `reduceKanban`, que
 * também aplica o `focoPendente`, e o dos estados alimenta o `reduceTerminals`: quem conhece esses
 * reducers é a tela, e ela entrega callbacks. Conversas e perigoso são só valores, e voltam daqui.
 *
 * **Os callbacks passam por ref**, e as assinaturas montam uma vez: uma tela que passe uma função
 * nova a cada render não pode derrubar e refazer quatro assinaturas, e a corrida entre o pedido e a
 * primeira publicação — a guarda `pushed` de cada efeito — depende de a assinatura sobreviver.
 *
 * Cada efeito assina **antes** de pedir, e o evento mais novo vence a leitura em trânsito.
 */
export function useBoardFeeds(handlers: BoardFeedsHandlers): BoardFeeds {
  const ref = useRef(handlers)
  ref.current = handlers

  const [conversations, setConversations] = useState<readonly string[]>([])
  const [dangerous, setDangerous] = useState<DangerousSnapshot>(SEM_MARCA)

  useEffect(() => {
    let pushed = false

    const unsubscribe = window.oc.onBoards((next) => {
      pushed = true
      ref.current.onSnapshot(next)
    })

    void window.oc.readBoards().then((next) => {
      // O retrato do `invoke` é o estado no instante em que o main atendeu; um evento publicado
      // enquanto a resposta voltava é mais novo que ele. Sem esta guarda, a tela retrocederia no
      // tempo — e ela ficou **mais** importante com a descoberta assíncrona, porque a janela entre
      // o pedido e o primeiro evento é a descoberta inteira.
      if (!pushed) ref.current.onSnapshot(next)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    let pushed = false

    const unsubscribe = window.oc.onConversations((next) => {
      pushed = true
      setConversations(next.itemIds)
    })

    void window.oc.readConversations().then((next) => {
      // A verificação do boot pode terminar enquanto esta resposta volta: a mesma corrida do board.
      if (!pushed) setConversations(next.itemIds)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    let pushed = false

    const unsubscribe = window.oc.onDangerous((next) => {
      pushed = true
      setDangerous(next)
    })

    void window.oc.readDangerous().then((next) => {
      if (!pushed) setDangerous(next)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    // Acompanhar o terminal de cada cartão por conta própria, e não só através do cartão aberto:
    // sem isto o selo de um cartão fechado congelaria no instante em que ele fechou.
    let pushed = false

    const unsubscribe = window.oc.onClaudeState((event) => {
      pushed = true
      ref.current.onClaudeState(event)
    })

    void window.oc.readClaudeStates().then((eventos) => {
      if (pushed) return
      for (const evento of eventos) ref.current.onClaudeState(evento)
    })

    return unsubscribe
  }, [])

  return { conversations, dangerous }
}
