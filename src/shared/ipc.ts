/**
 * O contrato IPC, num módulo que **os dois lados importam**.
 *
 * Renderer e main não conversam por string solta: os nomes de canal e o formato de cada carga
 * moram aqui, e é o compilador que impede um lado de mudar sem o outro. É também o único módulo
 * que o renderer compartilha com o processo Node — por isso ele não conhece `electron` nem o SDK,
 * só os tipos de dado que o `core` publica.
 */

import type {
  ChatMessage,
  PermissionDecision,
  PermissionRequest,
  SessionInit,
  SessionState,
} from './session'

/** Renderer → main. Toda pergunta tem resposta, então são `invoke`. */
export const IPC_INVOKE = {
  start: 'session:start',
  send: 'session:send',
  respondPermission: 'session:respond-permission',
  close: 'session:close',
} as const

/** Main → renderer. Avisos de mão única, disparados pelo `core` quando a sessão se mexe. */
export const IPC_EVENT = {
  init: 'session:init',
  message: 'session:message',
  state: 'session:state',
  permissionRequest: 'session:permission-request',
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
  init: SessionInit | undefined
  state: SessionState
  messages: readonly ChatMessage[]
}

export interface SendRequest {
  sessionId: string
  text: string
}

export interface RespondPermissionRequest {
  sessionId: string
  requestId: string
  decision: PermissionDecision
}

export interface CloseRequest {
  sessionId: string
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

/**
 * A superfície inteira que o renderer enxerga, exposta como `window.oc` pelo preload. O que não
 * está aqui não existe do lado de lá — não há `ipcRenderer`, não há `require`, não há Node.
 *
 * Os `on*` devolvem a função de cancelamento, como os do `core`: um `useEffect` que assina precisa
 * poder desassinar sem guardar o handler.
 */
export interface OcApi {
  /**
   * Começa a sessão. Sem parâmetro de propósito: a pasta de trabalho e o modelo vêm do ambiente
   * lido no main (`OC_CWD`, `OC_MODEL`). Deixar o renderer escolher a `cwd` seria dar a uma tela
   * sandboxada o poder de apontar uma sessão do Claude Code para qualquer lugar do disco.
   */
  start(): Promise<SessionSnapshot>
  send(request: SendRequest): Promise<void>
  respondPermission(request: RespondPermissionRequest): Promise<void>
  close(request: CloseRequest): Promise<void>
  onInit(listener: (event: SessionInitEvent) => void): () => void
  onMessage(listener: (event: SessionMessageEvent) => void): () => void
  onState(listener: (event: SessionStateEvent) => void): () => void
  onPermissionRequest(listener: (event: SessionPermissionEvent) => void): () => void
}

declare global {
  interface Window {
    readonly oc: OcApi
  }
}
