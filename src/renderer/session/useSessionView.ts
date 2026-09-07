import { useEffect, useReducer, useRef, useState } from 'react'

import type { SessionSnapshot, StartRequest, StartResult } from '../../shared/ipc'
import type { PermissionDecision, QuestionAnswers } from '../../shared/session'
import { INITIAL_VIEW, reduce } from './sessionView'
import type { SessionAction, SessionView } from './sessionView'

// O estado e a regra que o move são puros e moram ao lado; o que sobrou aqui é a assinatura dos
// canais e a corrida de montagem, que é a parte que precisa de `window`. Quem importa daqui não
// enxerga a mudança — ver o cabeçalho do `sessionView`.
export type { SessionView }

export interface SessionViewOptions {
  /** De qual cartão é a sessão. Ausente = a tela de chat da fatia vertical, que roda em `OC_CWD`. */
  itemId?: string
  /**
   * Se a saída de cena encerra a sessão.
   *
   * `true` na tela de chat, dona da sessão que pediu; `false` no cartão do kanban, onde colapsar
   * fecha a vista e não a conversa (CA-6). A mesma chave decide o descarte da corrida de montagem:
   * quem não encerra ao sair também não encerra a sessão cujo retrato voltou tarde demais.
   */
  closeOnUnmount: boolean
}

export interface SessionViewHandle {
  view: SessionView
  send: (text: string) => void
  decide: (decision: PermissionDecision) => void
  answer: (answers: QuestionAnswers) => void
  /** Para o turno em curso; a sessão continua viva. Quem a encerra é o `end`. */
  stop: () => void
  /** O encerramento do CA-6: ação minha, e só minha. */
  end: () => void
  /** Pede a sessão de novo — o caminho de volta depois de o humano apontar a pasta (CA-5). */
  restart: () => void
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : 'não foi possível iniciar a sessão'
}

/**
 * O estado de uma sessão na tela, e o roteamento de eventos que o mantém.
 *
 * Mora aqui, e não dentro de cada tela, porque o cartão-chat do kanban seria uma cópia do
 * `ChatScreen` com um `sessionId` diferente — e duas cópias da mesma corrida divergem na primeira
 * correção que só uma delas receber.
 *
 * A corrida é esta: **assinar vem antes de pedir**, porque um evento disparado entre a criação da
 * sessão e a assinatura chegaria a ninguém; e o que chega antes de o retrato voltar fica represado,
 * porque só com o id na mão dá para saber de quem o evento é.
 */
export function useSessionView({ itemId, closeOnUnmount }: SessionViewOptions): SessionViewHandle {
  const [view, dispatch] = useReducer(reduce, INITIAL_VIEW)
  const [attempt, setAttempt] = useState(0)

  // Lido só na limpeza, e por isso num ref: não é dependência do efeito. Nas dependências, uma troca
  // de dono derrubaria e recriaria a sessão em vez de mudar apenas quem a encerra.
  const owns = useRef(closeOnUnmount)
  owns.current = closeOnUnmount

  useEffect(() => {
    let ownId: string | null = null
    let cancelled = false
    const held: { sessionId: string; action: SessionAction }[] = []

    // Cartão trocado ou tentativa nova recomeçam do zero: o que sobrou da sessão anterior não é o
    // retrato desta.
    dispatch({ type: 'reset' })

    /**
     * O filtro por sessão não é zelo abstrato: o kanban mantém várias sessões vivas ao mesmo tempo,
     * e em desenvolvimento o StrictMode monta o efeito duas vezes — por um instante existem duas
     * mandando eventos para a mesma janela.
     */
    const deliver = (sessionId: string, action: SessionAction): void => {
      if (!ownId) {
        held.push({ sessionId, action })
        return
      }
      if (sessionId !== ownId) return

      dispatch(action)
    }

    const unsubscribes = [
      window.oc.onInit((event) => {
        deliver(event.sessionId, { type: 'init', init: event.init })
      }),
      window.oc.onMessage((event) => {
        deliver(event.sessionId, { type: 'message', message: event.message })
      }),
      window.oc.onState((event) => {
        deliver(event.sessionId, { type: 'state', state: event.state })
      }),
      // Assinado aqui, e não em quem desenha a linha viva, porque o pulso é estado da sessão como
      // qualquer outro: passa pelo mesmo filtro por id e pelo mesmo represamento até o retrato
      // chegar — sem o que uma batida disparada antes dele iria para a sessão errada.
      window.oc.onActivity((event) => {
        deliver(event.sessionId, { type: 'activity', activity: event.activity })
      }),
    ]

    // Sem cartão o pedido vai sem carga nenhuma — que é o pedido que a tela de chat sempre fez.
    const request: StartRequest | undefined = itemId === undefined ? undefined : { itemId }

    window.oc
      .start(request)
      .then((result: StartResult) => {
        if (!result.started) {
          if (!cancelled) dispatch({ type: 'unknown-folder' })

          return
        }

        const snapshot: SessionSnapshot = result.session

        if (cancelled) {
          // A vista que pediu esta sessão já saiu de cena (o duplo-monte do StrictMode, em dev). Só
          // quem encerra ao sair encerra aqui: no cartão do kanban a sessão existe para sobreviver à
          // vista, e o `start` por cartão é idempotente — o monte seguinte reencontra esta mesma.
          if (owns.current) void window.oc.close({ sessionId: snapshot.id })

          return
        }

        ownId = snapshot.id
        dispatch({ type: 'snapshot', snapshot })
        for (const event of held) {
          if (event.sessionId === snapshot.id) dispatch(event.action)
        }
        held.length = 0
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Sem isto, uma sessão que não sobe deixa a tela em `Iniciando` para sempre — o silêncio que
        // o estado `failed` existe para quebrar.
        dispatch({ type: 'state', state: { kind: 'failed', reason: reasonOf(error) } })
      })

    return () => {
      cancelled = true
      for (const unsubscribe of unsubscribes) unsubscribe()
      if (ownId && owns.current) void window.oc.close({ sessionId: ownId })
    }
  }, [itemId, attempt])

  return {
    view,

    send(text: string): void {
      if (!view.id) return

      void window.oc.send({ sessionId: view.id, text })
    },

    decide(decision: PermissionDecision): void {
      const { id, permission } = view
      if (!id || !permission) return

      // Some da tela na hora: até a resposta voltar, o botão continuaria clicável para um pedido já
      // respondido. Quem repõe a tela é o `state` seguinte — e o que ele traz pode ser o **próximo**
      // pedido da fila, não necessariamente a sessão de volta ao trabalho.
      dispatch({ type: 'hide-prompt' })
      void window.oc.respondPermission({ sessionId: id, requestId: permission.id, decision })
    },

    answer(answers: QuestionAnswers): void {
      const { id, question } = view
      if (!id || !question) return

      // Some pela mesma razão da decisão de permissão: pergunta respondida não se responde duas
      // vezes, e o `state` seguinte é quem manda — inclusive quando o que ele traz é o próximo
      // pedido da fila.
      dispatch({ type: 'hide-prompt' })
      void window.oc.answerQuestion({ sessionId: id, requestId: question.id, answers })
    },

    stop(): void {
      if (!view.id || view.state.kind !== 'working') return

      // Sem `dispatch` otimista, ao contrário de `decide` e `answer`: ali o prompt precisava sumir da
      // tela para não ser respondido duas vezes; aqui não há nada a esconder, e o `#stopping` do core
      // já engole um segundo clique dado antes de o estado voltar.
      void window.oc.stop({ sessionId: view.id })
    },

    end(): void {
      if (!view.id) return

      // O `closed` volta pelo `state`, como qualquer outra transição: quem leva a sessão ao estado
      // terminal é o core, não a tela que pediu.
      void window.oc.close({ sessionId: view.id })
    },

    restart(): void {
      setAttempt((previous) => previous + 1)
    },
  }
}
