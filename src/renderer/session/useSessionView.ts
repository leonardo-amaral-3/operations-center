import { useEffect, useReducer, useRef, useState } from 'react'

import { scopeKey } from '../../shared/ipc'
import type { SessionScope, SessionSnapshot, StartResult } from '../../shared/ipc'
import type { PermissionDecision, QuestionAnswers } from '../../shared/session'
import { INITIAL_VIEW, reduce } from './sessionView'
import type { SessionAction, SessionView } from './sessionView'

// O estado e a regra que o move são puros e moram ao lado; o que sobrou aqui é a assinatura dos
// canais e a corrida de montagem, que é a parte que precisa de `window`. Quem importa daqui não
// enxerga a mudança — ver o cabeçalho do `sessionView`.
export type { SessionView }

export interface SessionViewOptions {
  /** De quem é a sessão. Ausente = a tela de chat da fatia vertical, que roda em `OC_CWD`. */
  scope?: SessionScope
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
 * Quantas vistas estão montadas para cada escopo, por `scopeKey`.
 *
 * Existe por causa de uma assimetria do `start`: **sem escopo** ele cria uma sessão nova a cada
 * chamada, e o id que volta a um monte é só dele; **com escopo** ele é idempotente
 * (`livingSessionFor` e `oneStartPerScope`, em `src/main/ipc.ts`), e dois montes do mesmo escopo
 * recebem **o mesmo id**. Sem este registro, a vista descartada pelo duplo-monte do StrictMode
 * encerrava a sessão que a vista viva estava mostrando — o defeito do #63, com o painel da triagem
 * sumindo da coluna no meio da digitação.
 *
 * Estado de módulo, e não um `useRef`: a pergunta é "sobrou alguém segurando **este escopo**", e não
 * "sobrou alguém neste componente". Num ref, um efeito religado com `chave` nova contaria o monte
 * novo como se ele segurasse a sessão do escopo **antigo**, que então vazaria viva.
 *
 * O par `segurar`/`soltar` roda no corpo e na limpeza do efeito — os dois síncronos, no mesmo commit
 * do React. A promessa do `start` atravessa a ponte IPC e volta sempre depois disso: quando ela
 * chega, o monte sucessor já se registrou.
 */
const montadas = new Map<string, number>()

function segurar(chave: string): void {
  montadas.set(chave, (montadas.get(chave) ?? 0) + 1)
}

/**
 * A chave **sai** do mapa ao chegar a zero: "ninguém segura este escopo" continua sendo a ausência
 * da chave, e não um zero guardado — duas formas de dizer a mesma coisa fariam toda leitura checar
 * as duas. É a mesma régua do `comLista` em `screens/kanbanState.ts`.
 */
function soltar(chave: string): void {
  const restantes = (montadas.get(chave) ?? 1) - 1

  if (restantes > 0) montadas.set(chave, restantes)
  else montadas.delete(chave)
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
export function useSessionView({ scope, closeOnUnmount }: SessionViewOptions): SessionViewHandle {
  const [view, dispatch] = useReducer(reduce, INITIAL_VIEW)
  const [attempt, setAttempt] = useState(0)

  // Lido só na limpeza, e por isso num ref: não é dependência do efeito. Nas dependências, uma troca
  // de dono derrubaria e recriaria a sessão em vez de mudar apenas quem a encerra.
  const owns = useRef(closeOnUnmount)
  owns.current = closeOnUnmount

  // A dependência do efeito é a **chave**, e não o objeto: um `{ kind: 'card', itemId }` montado no
  // JSX é referência nova a cada render, e depender dele derrubaria e recriaria a sessão a cada
  // quadro. O escopo em si sai de um ref — como o `owns` — porque só o corpo do efeito precisa dele,
  // e ele nunca diverge da chave.
  const chave = scope === undefined ? '' : scopeKey(scope)
  const alvo = useRef(scope)
  alvo.current = scope

  useEffect(() => {
    let ownId: string | null = null
    let cancelled = false
    const held: { sessionId: string; action: SessionAction }[] = []

    // Sem escopo não entra no registro, e é essa ausência — e não uma segunda guarda lá embaixo —
    // que preserva o `ChatScreen` (RA-3): lá cada `start` cria uma sessão nova, o registro nunca
    // encontra a chave vazia, e o descarte continua encerrando a **dele** como sempre encerrou.
    if (chave !== '') segurar(chave)

    // Escopo trocado ou tentativa nova recomeçam do zero: o que sobrou da sessão anterior não é o
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

    window.oc
      // Sem escopo o pedido vai sem carga nenhuma — que é o pedido que a tela de chat sempre fez.
      .start(chave === '' ? undefined : { scope: alvo.current })
      .then((result: StartResult) => {
        if (!result.started) {
          if (!cancelled) dispatch({ type: 'unknown-folder' })

          return
        }

        const snapshot: SessionSnapshot = result.session

        if (cancelled) {
          // A vista que pediu esta sessão já saiu de cena (o duplo-monte do StrictMode, em dev).
          // Encerrar aqui exige **as duas** coisas: encerrar ao sair, e a sessão ser de fato só
          // desta vista. Com escopo o `start` é idempotente, então o monte seguinte reencontra
          // **esta mesma** sessão, com este mesmo id — encerrá-la mataria a conversa que está na
          // tela (#63). `montadas` é quem sabe se sobrou alguém segurando o escopo; a chave vazia
          // nunca está lá (ver o `segurar` no topo do efeito), então a vista sem escopo passa.
          if (owns.current && !montadas.has(chave)) {
            void window.oc.close({ sessionId: snapshot.id })
          }

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
      if (chave !== '') soltar(chave)
      for (const unsubscribe of unsubscribes) unsubscribe()
      // A mesma guarda do ramo do descarte, e pela mesma razão: com escopo, a sessão em mãos pode
      // ser de mais alguém. Num desmonte de verdade o `soltar` acima já tirou a chave, então a
      // guarda deixa passar e nada muda. O que ela impede é **duas vistas do mesmo escopo** —
      // possível hoje, porque `column.triage` é por coluna (`core/board/BoardReader.ts:120`) e um
      // board com duas colunas cujo nome case com `isTriage` renderiza dois painéis com a mesma
      // `boardKey`. Sem ela, fechar um mataria a sessão do outro: o #63 de novo, por outra porta.
      if (ownId && owns.current && !montadas.has(chave)) {
        void window.oc.close({ sessionId: ownId })
      }
    }
  }, [chave, attempt])

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
