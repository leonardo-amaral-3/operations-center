import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type {
  CloseRequest,
  OcApi,
  RespondPermissionRequest,
  SendRequest,
  SessionInitEvent,
  SessionMessageEvent,
  SessionPermissionEvent,
  SessionSnapshot,
  SessionStateEvent,
} from '../shared/ipc'

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
}

contextBridge.exposeInMainWorld('oc', api)
