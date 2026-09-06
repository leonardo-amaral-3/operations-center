import { useEffect, useReducer, useRef, useState } from 'react'

import type { SessionSnapshot, StartRequest, StartResult } from '../../shared/ipc'
import type {
  ChatMessage,
  PermissionDecision,
  PermissionRequest,
  QuestionAnswers,
  QuestionRequest,
  SessionInit,
  SessionState,
} from '../../shared/session'

/** Tudo que a tela sabe da sessão. Nada aqui é derivado: é o que chegou pela ponte, e só. */
export interface SessionView {
  id: string | null
  init: SessionInit | null
  state: SessionState
  messages: readonly ChatMessage[]
  permission: PermissionRequest | null
  question: QuestionRequest | null
  /**
   * O `started: false` do `start`: o main não sabe em que pasta o repo daquele cartão vive.
   *
   * Não é falha, é resposta prevista (CA-5) — e por isso tem campo próprio em vez de virar `failed`:
   * quem a recebe troca o chat pelo pedido da pasta, e o `restart()` é o caminho de volta depois que
   * o humano a aponta.
   */
  unknownFolder: boolean
}

type SessionAction =
  | { type: 'reset' }
  | { type: 'snapshot'; snapshot: SessionSnapshot }
  | { type: 'init'; init: SessionInit }
  | { type: 'message'; message: ChatMessage }
  | { type: 'state'; state: SessionState }
  | { type: 'permission'; request: PermissionRequest | null }
  | { type: 'question'; request: QuestionRequest | null }
  | { type: 'unknown-folder' }

/** Antes do retrato a tela não tem sessão nenhuma — e `starting` é exatamente o que o core diz. */
const INITIAL_VIEW: SessionView = {
  id: null,
  init: null,
  state: { kind: 'starting' },
  messages: [],
  permission: null,
  question: null,
  unknownFolder: false,
}

function reduce(view: SessionView, action: SessionAction): SessionView {
  switch (action.type) {
    case 'reset':
      // A mesma referência de sempre, de propósito: no primeiro monte o React a compara com o
      // estado inicial e não re-renderiza por causa dela.
      return INITIAL_VIEW
    case 'snapshot':
      // O pedido pendente sai **do próprio retrato**, e não só do evento. Enquanto `start` criava
      // sempre uma sessão nova, o retrato era o do nascimento dela e nunca esperava por nada; agora
      // ele pode ser o de uma sessão que já estava parada num pedido cujo evento foi disparado
      // quando esta tela ainda nem existia. Sem isto, reabrir um cartão travado não mostraria o que
      // o destrava.
      return {
        id: action.snapshot.id,
        init: action.snapshot.init ?? null,
        state: action.snapshot.state,
        messages: [...action.snapshot.messages],
        permission:
          action.snapshot.state.kind === 'awaiting_decision' ? action.snapshot.state.request : null,
        question:
          action.snapshot.state.kind === 'awaiting_answer' ? action.snapshot.state.request : null,
        unknownFolder: false,
      }
    case 'init':
      return { ...view, init: action.init }
    case 'message':
      // Mensagem já vista não entra de novo: o retrato e os eventos represados podem descrever o
      // mesmo fato, e o `id` (o `uuid` do SDK, ou o do envio) é o que decide se é o mesmo.
      return view.messages.some((message) => message.id === action.message.id)
        ? view
        : { ...view, messages: [...view.messages, action.message] }
    case 'state':
      return {
        ...view,
        state: action.state,
        // Sair de `awaiting_decision` é o que aposenta o pedido: sessão que voltou a trabalhar (ou
        // que morreu) não tem mais decisão a receber, e o prompt não pode sobreviver a ela.
        permission: action.state.kind === 'awaiting_decision' ? view.permission : null,
        // A pergunta sai pela mesma porta, pelo mesmo motivo.
        question: action.state.kind === 'awaiting_answer' ? view.question : null,
      }
    case 'permission':
      return { ...view, permission: action.request }
    case 'question':
      return { ...view, question: action.request }
    case 'unknown-folder':
      return { ...view, unknownFolder: true }
  }
}

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
      window.oc.onPermissionRequest((event) => {
        deliver(event.sessionId, { type: 'permission', request: event.request })
      }),
      window.oc.onQuestionRequest((event) => {
        deliver(event.sessionId, { type: 'question', request: event.request })
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

      // Some da tela na hora: a confirmação volta pelo `state`, e até lá o botão continuaria clicável
      // para um pedido que já foi respondido.
      dispatch({ type: 'permission', request: null })
      void window.oc.respondPermission({ sessionId: id, requestId: permission.id, decision })
    },

    answer(answers: QuestionAnswers): void {
      const { id, question } = view
      if (!id || !question) return

      // Some pela mesma razão da decisão de permissão: pergunta respondida não se responde duas
      // vezes, e a confirmação vem pelo `state`.
      dispatch({ type: 'question', request: null })
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
