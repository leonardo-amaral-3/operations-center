/**
 * O estado da sessão na tela, e a regra que o move — sem React, sem `window`, sem DOM.
 *
 * Mora num arquivo próprio, e não junto do hook, por um motivo medido: `tests/` está no `include`
 * do `tsconfig.node.json`, que não tem `lib: DOM`. Um teste que importasse o `useSessionView`
 * levaria junto o `window.oc` da assinatura de eventos, e o programa do Node não teria o que fazer
 * com ele. Separada, a parte pura entra nos **dois** programas — exatamente o arranjo que
 * `src/shared/` já tem — e a regra do redutor ganha teste unitário sem subir Electron.
 *
 * Quem consome de fora continua importando do `useSessionView`, que reexporta o que sempre expôs.
 */

import type { SessionSnapshot } from '../../shared/ipc'
import type {
  ChatMessage,
  PermissionRequest,
  QuestionRequest,
  SessionInit,
  SessionState,
  TurnActivity,
} from '../../shared/session'
import { IDLE_ACTIVITY } from '../../shared/session'

/**
 * Tudo que a tela sabe da sessão.
 *
 * `permission`, `question` e `queued` saem do `SessionState` e de mais nada: são a frente da fila
 * de pedidos que o core publica, e ter **uma** fonte para eles é o conserto do #11 — enquanto
 * havia duas (o estado e um canal IPC à parte), um segundo pedido concorrente apagava o primeiro.
 */
export interface SessionView {
  id: string | null
  init: SessionInit | null
  state: SessionState
  messages: readonly ChatMessage[]
  permission: PermissionRequest | null
  question: QuestionRequest | null
  /** Quantos pedidos esperam **atrás** do que está em cartaz; `0` quando ele é o único. */
  queued: number
  /** O pulso do turno corrente; `IDLE_ACTIVITY` enquanto não há turno nenhum. */
  activity: TurnActivity
  /**
   * O `started: false` do `start`: o main não sabe em que pasta o repo daquele cartão vive.
   *
   * Não é falha, é resposta prevista (CA-5) — e por isso tem campo próprio em vez de virar `failed`:
   * quem a recebe troca o chat pelo pedido da pasta, e o `restart()` é o caminho de volta depois que
   * o humano a aponta.
   */
  unknownFolder: boolean
}

export type SessionAction =
  | { type: 'reset' }
  | { type: 'snapshot'; snapshot: SessionSnapshot }
  | { type: 'init'; init: SessionInit }
  | { type: 'message'; message: ChatMessage }
  | { type: 'state'; state: SessionState }
  /**
   * O prompt sai da tela no clique, antes de a confirmação voltar.
   *
   * Sem isto o botão continuaria clicável para um pedido já respondido. O que vier depois é o
   * `state` do core — que pode trazer o **próximo** da fila, e é ele quem manda.
   */
  | { type: 'hide-prompt' }
  | { type: 'activity'; activity: TurnActivity }
  | { type: 'unknown-folder' }

/** Antes do retrato a tela não tem sessão nenhuma — e `starting` é exatamente o que o core diz. */
export const INITIAL_VIEW: SessionView = {
  id: null,
  init: null,
  state: { kind: 'starting' },
  messages: [],
  permission: null,
  question: null,
  queued: 0,
  activity: IDLE_ACTIVITY,
  unknownFolder: false,
}

/**
 * As três derivações do estado. Ficam aqui, ao lado do redutor, porque são a regra de que só o
 * `SessionState` diz quem está em cartaz — e é essa unicidade que impede o bug do #11 de voltar.
 */
function permissionOf(state: SessionState): PermissionRequest | null {
  return state.kind === 'awaiting_decision' ? state.request : null
}

function questionOf(state: SessionState): QuestionRequest | null {
  return state.kind === 'awaiting_answer' ? state.request : null
}

function queuedOf(state: SessionState): number {
  return state.kind === 'awaiting_decision' || state.kind === 'awaiting_answer' ? state.queued : 0
}

export function reduce(view: SessionView, action: SessionAction): SessionView {
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
        permission: permissionOf(action.snapshot.state),
        question: questionOf(action.snapshot.state),
        queued: queuedOf(action.snapshot.state),
        // O pulso vem no retrato pela mesma razão do pedido pendente: um cartão reaberto no meio do
        // turno nasce com o relógio certo, em vez de contar do zero e mentir sobre a idade dele.
        activity: action.snapshot.activity,
        unknownFolder: false,
      }
    case 'init':
      return { ...view, init: action.init }
    case 'message': {
      const chegou = action.message
      const posicao = view.messages.findIndex((message) => message.id === chegou.id)

      // Id novo é o caso comum: entra no fim, e a ordem da conversa é a ordem de chegada.
      if (posicao === -1) return { ...view, messages: [...view.messages, chegou] }

      const atual = view.messages[posicao]

      // Fala já vista não entra de novo: o retrato e os eventos represados descrevem os mesmos
      // fatos, e texto é imutável. Vale também para o par desencontrado (fala de um lado, ação do
      // outro), que não deveria existir e, se existir, não vira troca silenciosa.
      if (atual === undefined || atual.role !== 'tool' || chegou.role !== 'tool') return view

      // **Status nunca retrocede.** Uma ação é um fato só que muda de status, então o resultado
      // substitui a entrada em vez de acrescentar outra — mas o `held` do hook guarda eventos
      // disparados **antes** do retrato e os drena **depois** dele. Sem este degrau, um `running`
      // represado sobrescreveria o `done` que veio no retrato e a entrada ficaria rodando para
      // sempre. `running` é o único degrau de ida; os outros três são terminais.
      if (chegou.status === 'running' && atual.status !== 'running') return view

      const messages = [...view.messages]
      messages[posicao] = chegou

      return { ...view, messages }
    }
    case 'state':
      // **É aqui que o bug da tela morre.** Antes, o pedido em cartaz era só *preservado* enquanto o
      // `kind` não mudasse, porque quem o punha na tela era um canal IPC à parte — e um segundo
      // pedido concorrente chegava por esse canal e apagava o primeiro. Agora o estado é a única
      // fonte, e ele carrega a frente da fila: adotar é o que faz o próximo aparecer.
      return {
        ...view,
        state: action.state,
        permission: permissionOf(action.state),
        question: questionOf(action.state),
        queued: queuedOf(action.state),
      }
    case 'hide-prompt':
      // `queued` fica como está de propósito: há mesmo mais um esperando, e o `state` seguinte
      // corrige o número em milissegundos.
      return { ...view, permission: null, question: null }
    case 'activity':
      // Substitui, e não acumula: o pulso atravessa a ponte inteiro a cada batida, e um evento
      // perdido não deixa a tela contando a partir de um valor que nunca mais será corrigido.
      return { ...view, activity: action.activity }
    case 'unknown-folder':
      return { ...view, unknownFolder: true }
  }
}

/**
 * 60s. Com nada rodando, o silêncio normal é da ordem de segundos — os quadros de raciocínio batem
 * a cada ~1,3s, e o intervalo entre a permissão e o começo da ferramenta foi de 3,8s. Com
 * ferramenta rodando o silêncio é esperado (17s medidos dentro de um `Bash`), e por isso a regra
 * abaixo só vale quando nada está `running`.
 */
export const SILENCIO_MS = 60_000

/**
 * O CA-4: turno em curso, nada `running`, e nenhum sinal do SDK há mais de `SILENCIO_MS`.
 *
 * `now` entra por parâmetro em vez de sair de um `Date.now()` daqui porque quem desenha a linha
 * viva já tem relógio próprio de 1s — e porque regra que lê o relógio sozinha não se testa.
 *
 * As duas saídas antecipadas são as duas metades que o critério exige antes da conta: sem turno em
 * curso não há silêncio a acusar (sessão parada está parada, e isso é o normal dela), e sem nenhum
 * sinal recebido não há idade a comparar com coisa nenhuma.
 */
export function isSilent(activity: TurnActivity, somethingRunning: boolean, now: number): boolean {
  if (activity.startedAt === null || somethingRunning) return false
  if (activity.lastSignalAt === null) return false

  return now - activity.lastSignalAt >= SILENCIO_MS
}
