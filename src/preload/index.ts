import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

import type { BoardSnapshot } from '../shared/board'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type {
  CloseRequest,
  OcApi,
  RespondPermissionRequest,
  Screen,
  SendRequest,
  SessionInitEvent,
  SessionMessageEvent,
  SessionPermissionEvent,
  SessionSnapshot,
  SessionStateEvent,
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
  start: () => ipcRenderer.invoke(IPC_INVOKE.start) as Promise<SessionSnapshot>,
  send: (request: SendRequest) => ipcRenderer.invoke(IPC_INVOKE.send, request) as Promise<void>,
  respondPermission: (request: RespondPermissionRequest) =>
    ipcRenderer.invoke(IPC_INVOKE.respondPermission, request) as Promise<void>,
  close: (request: CloseRequest) => ipcRenderer.invoke(IPC_INVOKE.close, request) as Promise<void>,
  onInit: (listener) => subscribe<SessionInitEvent>(IPC_EVENT.init, listener),
  onMessage: (listener) => subscribe<SessionMessageEvent>(IPC_EVENT.message, listener),
  onState: (listener) => subscribe<SessionStateEvent>(IPC_EVENT.state, listener),
  onPermissionRequest: (listener) =>
    subscribe<SessionPermissionEvent>(IPC_EVENT.permissionRequest, listener),
  readBoard: () => ipcRenderer.invoke(IPC_INVOKE.readBoard) as Promise<BoardSnapshot>,
  onBoard: (listener) => subscribe<BoardSnapshot>(IPC_EVENT.board, listener),
}

contextBridge.exposeInMainWorld('oc', api)
