/**
 * O contrato IPC, num módulo que **os dois lados importam**.
 *
 * Renderer e main não conversam por string solta: os nomes de canal e o formato de cada carga
 * moram aqui, e é o compilador que impede um lado de mudar sem o outro. É também o único módulo
 * que o renderer compartilha com o processo Node — por isso ele não conhece `electron` nem o SDK,
 * só os tipos de dado que o `core` publica.
 */

import type { BoardSnapshot } from './board'
import type {
  ChatMessage,
  PermissionDecision,
  PermissionRequest,
  QuestionAnswers,
  QuestionRequest,
  SessionInit,
  SessionState,
} from './session'

/**
 * Qual tela o app desenha. Decidido no main por `OC_SCREEN` e entregue ao preload por argv — o
 * renderer não escolhe, só obedece.
 */
export type Screen = 'kanban' | 'chat'

/** Renderer → main. Toda pergunta tem resposta, então são `invoke`. */
export const IPC_INVOKE = {
  start: 'session:start',
  send: 'session:send',
  respondPermission: 'session:respond-permission',
  answerQuestion: 'session:answer-question',
  close: 'session:close',
  chooseFolder: 'repo:choose-folder',
  readBoard: 'board:read',
} as const

/** Main → renderer. Avisos de mão única, disparados pelo `core` quando a sessão se mexe. */
export const IPC_EVENT = {
  init: 'session:init',
  message: 'session:message',
  state: 'session:state',
  permissionRequest: 'session:permission-request',
  questionRequest: 'session:question-request',
  board: 'board:changed',
} as const

/**
 * O retrato da sessão no instante em que ela nasce.
 *
 * `start` devolve o retrato em vez de só o id porque a assinatura dos canais e a criação da sessão
 * não são o mesmo instante: qualquer evento disparado antes de o `invoke` voltar ao renderer
 * chegaria a ninguém. Com o retrato, a tela começa do estado real e os eventos só a atualizam.
 */
export interface SessionSnapshot {
  id: string
  /**
   * De qual cartão é esta sessão, ou `undefined` na tela de chat da fatia vertical. Volta no retrato
   * porque o kanban mantém várias sessões vivas ao mesmo tempo: sem ele, uma resposta que chega
   * fora de ordem não teria como ser casada com o cartão que a pediu.
   */
  itemId: string | undefined
  init: SessionInit | undefined
  state: SessionState
  messages: readonly ChatMessage[]
}

/**
 * De qual cartão é a sessão. Ausente = a tela de chat da fatia vertical, que roda em `OC_CWD`.
 *
 * Continua sendo o main quem traduz `itemId` em pasta: o renderer manda o cartão, nunca o caminho.
 */
export interface StartRequest {
  itemId?: string
}

/**
 * "Não sei onde fica o repo" **não é exceção**: é uma resposta prevista, e o cartão sabe o que fazer
 * com ela (CA-5). Rejeitar obrigaria o renderer a farejar a mensagem do erro para distinguir isso de
 * uma falha de verdade — e mensagem de erro não é contrato. Falha real continua rejeitando.
 */
export type StartResult =
  { started: true; session: SessionSnapshot } | { started: false; reason: 'unknown-folder' }

export interface SendRequest {
  sessionId: string
  text: string
}

export interface RespondPermissionRequest {
  sessionId: string
  requestId: string
  decision: PermissionDecision
}

export interface AnswerQuestionRequest {
  sessionId: string
  requestId: string
  answers: QuestionAnswers
}

export interface CloseRequest {
  sessionId: string
}

/** Abre o seletor de diretório para o repo daquele cartão (CA-5). */
export interface ChooseFolderRequest {
  itemId: string
}

/**
 * **Sem caminho.** O renderer só precisa saber se houve escolha para chamar `start` de novo; quem
 * guarda e usa a pasta é o main. Devolver a string seria fazer um caminho de disco atravessar a
 * ponte sem nenhum uso do outro lado — e a canária do `ipc-no-path` existe para impedir justamente
 * isso. O caminho aparece na tela por outra via: o `cwd` que o próprio SDK reporta no `init`.
 */
export interface ChooseFolderResult {
  chosen: boolean
}

/**
 * Todo evento diz de qual sessão veio. Hoje há uma só na tela; o `sessionId` é o que faz o kanban
 * do PRD ser depois um problema de roteamento no renderer, e não uma troca de contrato.
 */
export interface SessionInitEvent {
  sessionId: string
  init: SessionInit
}

export interface SessionMessageEvent {
  sessionId: string
  message: ChatMessage
}

export interface SessionStateEvent {
  sessionId: string
  state: SessionState
}

export interface SessionPermissionEvent {
  sessionId: string
  request: PermissionRequest
}

export interface SessionQuestionEvent {
  sessionId: string
  request: QuestionRequest
}

/**
 * A superfície inteira que o renderer enxerga, exposta como `window.oc` pelo preload. O que não
 * está aqui não existe do lado de lá — não há `ipcRenderer`, não há `require`, não há Node.
 *
 * Os `on*` devolvem a função de cancelamento, como os do `core`: um `useEffect` que assina precisa
 * poder desassinar sem guardar o handler.
 */
export interface OcApi {
  /**
   * Qual tela desenhar. É um valor, não uma promessa: o preload o resolve de `process.argv` antes
   * de expor a ponte, então o primeiro render já sabe o que desenhar e não há tela piscando.
   */
  readonly screen: Screen

  /**
   * Começa a sessão do cartão — ou a da fatia vertical, quando `start()` vem sem cartão nenhum.
   *
   * O único parâmetro é o `itemId`: a pasta de trabalho e o modelo continuam sendo resolvidos no
   * main (`OC_CWD`, `OC_MODEL`, e o índice de repos do RF-10). Deixar o renderer escolher a `cwd`
   * seria dar a uma tela sandboxada o poder de apontar uma sessão do Claude Code para qualquer lugar
   * do disco.
   *
   * Idempotente por cartão: com sessão viva para aquele `itemId`, devolve o retrato dela em vez de
   * subir uma segunda — é o que faz colapsar e reabrir manter a conversa.
   */
  start(request?: StartRequest): Promise<StartResult>
  send(request: SendRequest): Promise<void>
  respondPermission(request: RespondPermissionRequest): Promise<void>
  answerQuestion(request: AnswerQuestionRequest): Promise<void>
  close(request: CloseRequest): Promise<void>
  /** Pergunta ao humano onde o repo daquele cartão está. A escolha fica no main (CA-5). */
  chooseFolder(request: ChooseFolderRequest): Promise<ChooseFolderResult>
  onInit(listener: (event: SessionInitEvent) => void): () => void
  onMessage(listener: (event: SessionMessageEvent) => void): () => void
  onState(listener: (event: SessionStateEvent) => void): () => void
  onPermissionRequest(listener: (event: SessionPermissionEvent) => void): () => void
  onQuestionRequest(listener: (event: SessionQuestionEvent) => void): () => void

  /** O retrato atual do board. Pode voltar com `board: null` se a primeira leitura não terminou. */
  readBoard(): Promise<BoardSnapshot>
  /** Todo fim de leitura — com sucesso ou com falha — empurra um retrato novo. */
  onBoard(listener: (snapshot: BoardSnapshot) => void): () => void
}

declare global {
  interface Window {
    readonly oc: OcApi
  }
}
