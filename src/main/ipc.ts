import { ipcMain } from 'electron'
import type { WebContents } from 'electron'

import type { SessionHandle, SessionHost } from '../core'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type {
  CloseRequest,
  RespondPermissionRequest,
  SendRequest,
  SessionSnapshot,
} from '../shared/ipc'

export interface SessionIpcOptions {
  /** Pasta de trabalho de toda sessão criada por este registro. Vem de `OC_CWD`, lida no main. */
  cwd: string
}

export interface SessionIpc {
  /** Encerra tudo que está vivo. É o que o desligamento do app chama. */
  closeAll(): Promise<void>
}

/**
 * Liga os canais do contrato ao `core`.
 *
 * As sessões vivas moram aqui porque este é o único lugar que as cria: quem sabe abrir é quem deve
 * saber fechar. O `main` recebe de volta só o `closeAll()`, que é tudo de que o ciclo de vida
 * precisa.
 */
export function registerSessionIpc(host: SessionHost, options: SessionIpcOptions): SessionIpc {
  const sessions = new Map<string, SessionHandle>()

  ipcMain.handle(IPC_INVOKE.start, (event): SessionSnapshot => {
    const session = host.start({ cwd: options.cwd })
    sessions.set(session.id, session)
    // Os eventos vão para a janela que pediu a sessão, não para todas: é ela quem a está mostrando.
    forwardEvents(session, event.sender)

    return snapshot(session)
  })

  // As cargas abaixo são tipadas, não validadas. Do outro lado do canal está o nosso próprio bundle
  // num renderer com `contextIsolation` e `sandbox` — não há página de terceiro para forjar carga.
  // Id de sessão desconhecido é o único caso realista, e ele já é um no-op por construção.
  ipcMain.handle(IPC_INVOKE.send, (_event, request: SendRequest): void => {
    sessions.get(request.sessionId)?.send(request.text)
  })

  ipcMain.handle(
    IPC_INVOKE.respondPermission,
    (_event, request: RespondPermissionRequest): void => {
      sessions.get(request.sessionId)?.respondPermission(request.requestId, request.decision)
    },
  )

  ipcMain.handle(IPC_INVOKE.close, async (_event, request: CloseRequest): Promise<void> => {
    const session = sessions.get(request.sessionId)
    if (!session) return

    sessions.delete(request.sessionId)
    await session.close()
  })

  return {
    async closeAll(): Promise<void> {
      const living = [...sessions.values()]
      sessions.clear()
      // `allSettled`: uma sessão que falhe ao fechar não pode impedir as outras de fechar nem
      // derrubar o desligamento com uma rejeição sem dono.
      await Promise.allSettled(living.map((session) => session.close()))
    },
  }
}

function snapshot(session: SessionHandle): SessionSnapshot {
  return {
    id: session.id,
    init: session.init,
    state: session.state,
    messages: [...session.messages],
  }
}

function forwardEvents(session: SessionHandle, sender: WebContents): void {
  const emit = (channel: string, payload: unknown): void => {
    // A janela pode morrer com um turno em andamento; mandar para um `WebContents` destruído joga.
    if (sender.isDestroyed()) return
    sender.send(channel, payload)
  }

  session.on('init', (init) => {
    emit(IPC_EVENT.init, { sessionId: session.id, init })
  })

  session.on('message', (message) => {
    emit(IPC_EVENT.message, { sessionId: session.id, message })
  })

  session.on('state', (state) => {
    emit(IPC_EVENT.state, { sessionId: session.id, state })

    // O `core` não publica um canal de permissão: o pedido chega dentro do estado, porque é ele que
    // trava a sessão. O contrato o publica à parte para a tela poder abrir o prompt sem inspecionar
    // o `kind` do estado — e os dois eventos descrevem o mesmo fato, na mesma ordem.
    if (state.kind === 'awaiting_decision') {
      emit(IPC_EVENT.permissionRequest, { sessionId: session.id, request: state.request })
    }
  })
}
