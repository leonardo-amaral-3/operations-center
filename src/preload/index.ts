import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

import type { BoardsSnapshot } from '../shared/board'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type {
  AnswerQuestionRequest,
  ChooseFolderRequest,
  ChooseFolderResult,
  CloseRequest,
  ConversationsSnapshot,
  OcApi,
  ReadCardRequest,
  ReadCardResult,
  RespondPermissionRequest,
  Screen,
  SendRequest,
  SessionActivityEvent,
  SessionInitEvent,
  SessionMessageEvent,
  SessionStateEvent,
  StartRequest,
  StartResult,
  StopRequest,
} from '../shared/ipc'

const SCREEN_FLAG = '--oc-screen='

/**
 * Lido de `process.argv`, preenchido por `additionalArguments` no main — e não de `process.env`,
 * que num preload sandboxado depende de um polyfill que não é contrato.
 *
 * Default `kanban`: uma flag ausente ou desconhecida abre o app, não a porta de teste.
 */
function resolveScreen(): Screen {
  const arg = process.argv.find((value) => value.startsWith(SCREEN_FLAG))

  return arg?.slice(SCREEN_FLAG.length) === 'chat' ? 'chat' : 'kanban'
}

/**
 * Assina um canal do main e devolve o cancelamento. O `IpcRendererEvent` fica aqui: o renderer
 * recebe só a carga, porque o resto do evento é detalhe do Electron e ele não deve saber que existe.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => {
    listener(payload)
  }

  ipcRenderer.on(channel, handler)

  return () => {
    ipcRenderer.off(channel, handler)
  }
}

/**
 * A ponte. É exatamente o contrato — nem um canal a mais, e nada do `ipcRenderer` cru: expor o
 * objeto do Electron daria ao renderer um canal para qualquer `handle` registrado no main, hoje e
 * no futuro, que é o buraco que `contextIsolation` existe para fechar.
 */
const api: OcApi = {
  // Resolvido aqui, antes do `exposeInMainWorld`: o primeiro render já sabe o que desenhar, e não
  // há uma tela piscando enquanto uma promessa de configuração volta.
  screen: resolveScreen(),
  start: (request?: StartRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.start, request) as Promise<StartResult>,
  send: (request: SendRequest) => ipcRenderer.invoke(IPC_INVOKE.send, request) as Promise<void>,
  stop: (request: StopRequest) => ipcRenderer.invoke(IPC_INVOKE.stop, request) as Promise<void>,
  respondPermission: (request: RespondPermissionRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.respondPermission, request) as Promise<void>,
  answerQuestion: (request: AnswerQuestionRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.answerQuestion, request) as Promise<void>,
  close: (request: CloseRequest) => ipcRenderer.invoke(IPC_INVOKE.close, request) as Promise<void>,
  chooseFolder: (request: ChooseFolderRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.chooseFolder, request) as Promise<ChooseFolderResult>,
  onInit: (listener) => subscribe<SessionInitEvent>(IPC_EVENT.init, listener),
  onMessage: (listener) => subscribe<SessionMessageEvent>(IPC_EVENT.message, listener),
  onState: (listener) => subscribe<SessionStateEvent>(IPC_EVENT.state, listener),
  onActivity: (listener) => subscribe<SessionActivityEvent>(IPC_EVENT.activity, listener),
  readBoards: () => ipcRenderer.invoke(IPC_INVOKE.readBoards) as Promise<BoardsSnapshot>,
  onBoards: (listener) => subscribe<BoardsSnapshot>(IPC_EVENT.boards, listener),
  readCard: (request: ReadCardRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.readCard, request) as Promise<ReadCardResult>,
  readConversations: () =>
    ipcRenderer.invoke(IPC_INVOKE.readConversations) as Promise<ConversationsSnapshot>,
  onConversations: (listener) =>
    subscribe<ConversationsSnapshot>(IPC_EVENT.conversations, listener),
}

contextBridge.exposeInMainWorld('oc', api)
