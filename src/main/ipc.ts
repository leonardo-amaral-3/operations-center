import { ipcMain } from 'electron'
import type { WebContents } from 'electron'

import type { SessionHandle, SessionHost } from '../core'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc'
import type {
  AnswerQuestionRequest,
  CloseRequest,
  RespondPermissionRequest,
  SendRequest,
  SessionSnapshot,
  StartRequest,
  StartResult,
} from '../shared/ipc'

export interface SessionIpcOptions {
  /**
   * Onde a sessão de um cartão roda. Devolve `null` quando o repo do card não tem pasta conhecida —
   * e aí não sobe sessão nenhuma (CA-5). O `itemId` ausente é a tela de chat da fatia vertical.
   *
   * Assíncrono porque a resolução tem uma segunda chance: ver `src/main/index.ts`.
   */
  resolveCwd(itemId: string | undefined): Promise<string | null>
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

  /**
   * Qual sessão é de qual cartão. É o que faz o cartão ter *a* sua sessão, e não uma por clique:
   * sem ele, colapsar e reabrir subiria um segundo Claude Code para o mesmo card, com o histórico
   * da conversa preso no primeiro.
   */
  const byCard = new Map<string, string>()

  /**
   * A sessão viva daquele cartão, se houver.
   *
   * **Sessão morta não é reatada.** Ela sai do índice e o clique seguinte sobe uma nova. Sem esta
   * regra, um card cuja sessão morreu sozinha — processo que não subiu, credencial que expirou —
   * ficaria preso ao cadáver até alguém reiniciar o app. `closed` por ação humana (CA-6) cai na
   * mesma regra, e é o comportamento certo: encerrei porque terminei, clico de novo porque
   * recomecei.
   */
  function livingSessionFor(itemId: string): SessionHandle | null {
    const sessionId = byCard.get(itemId)
    if (sessionId === undefined) return null

    const session = sessions.get(sessionId)
    if (session && session.state.kind !== 'closed' && session.state.kind !== 'failed') {
      return session
    }

    byCard.delete(itemId)

    return null
  }

  ipcMain.handle(
    IPC_INVOKE.start,
    async (event, request: StartRequest | undefined): Promise<StartResult> => {
      const itemId = request?.itemId

      if (itemId !== undefined) {
        const living = livingSessionFor(itemId)
        // Sem criar outra e **sem registrar os ouvintes de novo**: a tela que reabre o cartão parte
        // do retrato, e uma segunda assinatura duplicaria cada mensagem daí em diante.
        if (living) return { started: true, session: snapshot(living, itemId) }
      }

      const cwd = await options.resolveCwd(itemId)
      // **Não existe default.** Subir sessão na pasta errada é o pior modo de falha desta feature —
      // pior que não subir —, então "não sei onde é" vira resposta, e o cartão pede a pasta (CA-5).
      if (cwd === null) return { started: false, reason: 'unknown-folder' }

      const session = host.start({ cwd })
      sessions.set(session.id, session)
      if (itemId !== undefined) byCard.set(itemId, session.id)
      // Os eventos vão para a janela que pediu a sessão, não para todas: é ela quem a está mostrando.
      forwardEvents(session, event.sender)

      return { started: true, session: snapshot(session, itemId) }
    },
  )

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

  ipcMain.handle(IPC_INVOKE.answerQuestion, (_event, request: AnswerQuestionRequest): void => {
    sessions.get(request.sessionId)?.answerQuestion(request.requestId, request.answers)
  })

  ipcMain.handle(IPC_INVOKE.close, async (_event, request: CloseRequest): Promise<void> => {
    const session = sessions.get(request.sessionId)
    if (!session) return

    sessions.delete(request.sessionId)
    // Dos **dois** mapas: deixar o cartão apontando para uma sessão que já não existe faria o clique
    // seguinte cair no `livingSessionFor` de um fantasma.
    for (const [itemId, sessionId] of byCard) {
      if (sessionId === request.sessionId) byCard.delete(itemId)
    }

    await session.close()
  })

  return {
    async closeAll(): Promise<void> {
      const living = [...sessions.values()]
      sessions.clear()
      byCard.clear()
      // `allSettled`: uma sessão que falhe ao fechar não pode impedir as outras de fechar nem
      // derrubar o desligamento com uma rejeição sem dono.
      await Promise.allSettled(living.map((session) => session.close()))
    },
  }
}

function snapshot(session: SessionHandle, itemId: string | undefined): SessionSnapshot {
  return {
    id: session.id,
    itemId,
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

    // A pergunta tem o par próprio pela mesma razão, e canal próprio porque não é a mesma coisa: uma
    // permissão tem duas saídas fixas, uma pergunta tem N opções e texto livre.
    if (state.kind === 'awaiting_answer') {
      emit(IPC_EVENT.questionRequest, { sessionId: session.id, request: state.request })
    }
  })
}
