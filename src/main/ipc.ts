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
  StopRequest,
} from '../shared/ipc'
import { IDLE_ACTIVITY } from '../shared/session'
import type { TurnActivity } from '../shared/session'

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
 * O relógio de uma sessão — o `TurnActivity` que atravessa a ponte mais o ordinal do turno.
 *
 * **O relógio mora no main, e não no core**, pelo mesmo motivo do `readAt` do board: o `core` conta
 * tokens e ordena fatos, a casca carimba tempo (`src/main/board.ts:79`). É o que mantém o `yarn
 * test` do core sem relógio.
 *
 * O `index` não sai daqui: ele é só como o main reconhece a fronteira entre turnos. A tela não tem
 * o que fazer com o ordinal, e mandá-lo seria contrato a mais para manter.
 */
interface Pulse {
  index: number
  startedAt: number | null
  lastSignalAt: number | null
  thinkingTokens: number
}

/**
 * O ordinal com que o core começa a contar (`TurnPulseCore.index`), e com que um registro novo
 * nasce — não em zero.
 *
 * Com zero, o primeiro `turn` do primeiro turno pareceria fronteira de turno e recarimbaria o
 * `startedAt` que a entrada em `working` acabou de pôr: o relógio da tela voltaria a zero um
 * segundo depois de o turno começar, e mentiria justamente na única leitura que ele tem.
 */
const FIRST_TURN = 1

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

  /** O relógio de cada sessão viva, alimentado pelo `forwardEvents` e lido pelo retrato. */
  const pulses = new Map<string, Pulse>()

  /** O pulso daquela sessão, ou o de quem não está em turno nenhum. */
  function activityOf(sessionId: string): TurnActivity {
    const pulse = pulses.get(sessionId)

    return pulse ? toActivity(pulse) : IDLE_ACTIVITY
  }

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
        // O retrato leva o pulso vivo daquela sessão: reabrir o cartão no meio do turno tem de
        // continuar a contagem, e não recomeçá-la.
        if (living) {
          return { started: true, session: snapshot(living, itemId, activityOf(living.id)) }
        }
      }

      const cwd = await options.resolveCwd(itemId)
      // **Não existe default.** Subir sessão na pasta errada é o pior modo de falha desta feature —
      // pior que não subir —, então "não sei onde é" vira resposta, e o cartão pede a pasta (CA-5).
      if (cwd === null) return { started: false, reason: 'unknown-folder' }

      const session = host.start({ cwd })
      sessions.set(session.id, session)
      if (itemId !== undefined) byCard.set(itemId, session.id)
      // Os eventos vão para a janela que pediu a sessão, não para todas: é ela quem a está mostrando.
      forwardEvents(session, event.sender, pulses)

      return { started: true, session: snapshot(session, itemId, activityOf(session.id)) }
    },
  )

  // As cargas abaixo são tipadas, não validadas. Do outro lado do canal está o nosso próprio bundle
  // num renderer com `contextIsolation` e `sandbox` — não há página de terceiro para forjar carga.
  // Id de sessão desconhecido é o único caso realista, e ele já é um no-op por construção.
  ipcMain.handle(IPC_INVOKE.send, (_event, request: SendRequest): void => {
    sessions.get(request.sessionId)?.send(request.text)
  })

  ipcMain.handle(IPC_INVOKE.stop, (_event, request: StopRequest): void => {
    sessions.get(request.sessionId)?.stop()
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
    // O relógio morre com a sessão: registro órfão faria o retrato do próximo clique naquele
    // cartão nascer com a idade de um turno que já acabou.
    pulses.delete(request.sessionId)
    // Dos **três** mapas: deixar o cartão apontando para uma sessão que já não existe faria o
    // clique seguinte cair no `livingSessionFor` de um fantasma.
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
      pulses.clear()
      // `allSettled`: uma sessão que falhe ao fechar não pode impedir as outras de fechar nem
      // derrubar o desligamento com uma rejeição sem dono.
      await Promise.allSettled(living.map((session) => session.close()))
    },
  }
}

function snapshot(
  session: SessionHandle,
  itemId: string | undefined,
  activity: TurnActivity,
): SessionSnapshot {
  return {
    id: session.id,
    itemId,
    init: session.init,
    state: session.state,
    messages: [...session.messages],
    activity,
  }
}

/** O que atravessa a ponte: o registro sem o ordinal, que é assunto interno do main. */
function toActivity(pulse: Pulse): TurnActivity {
  return {
    startedAt: pulse.startedAt,
    lastSignalAt: pulse.lastSignalAt,
    thinkingTokens: pulse.thinkingTokens,
  }
}

function forwardEvents(
  session: SessionHandle,
  sender: WebContents,
  pulses: Map<string, Pulse>,
): void {
  const emit = (channel: string, payload: unknown): void => {
    // A janela pode morrer com um turno em andamento; mandar para um `WebContents` destruído joga.
    if (sender.isDestroyed()) return
    sender.send(channel, payload)
  }

  // O registro nasce junto com a assinatura, e não na primeira batida: o `start` monta o retrato
  // logo depois desta chamada, e um registro ausente ali faria a sessão nova nascer `IDLE` por um
  // instante em que ela já está de pé.
  const pulse: Pulse = {
    index: FIRST_TURN,
    startedAt: null,
    lastSignalAt: null,
    thinkingTokens: 0,
  }
  pulses.set(session.id, pulse)

  /**
   * Carimba o sinal e publica o pulso inteiro.
   *
   * **Os quatro canais carimbam**, e não só o `turn`: o CA-4 pergunta "há quanto tempo esta sessão
   * não dá sinal nenhum", e uma mensagem ou uma troca de estado são sinal tanto quanto o contador
   * de raciocínio. Chamar sempre no fim do handler é o que garante que a tela receba o fato
   * (mensagem, estado) antes do pulso que o acompanha.
   */
  const publish = (): void => {
    pulse.lastSignalAt = Date.now()
    emit(IPC_EVENT.activity, { sessionId: session.id, activity: toActivity(pulse) })
  }

  session.on('init', (init) => {
    emit(IPC_EVENT.init, { sessionId: session.id, init })
    publish()
  })

  session.on('message', (message) => {
    emit(IPC_EVENT.message, { sessionId: session.id, message })
    publish()
  })

  session.on('state', (state) => {
    // A entrada em `working` é o que começa o relógio, e a saída é o que o para. `startedAt === null`
    // **é** "o kind anterior não era `working`": ele só fica não-nulo enquanto a sessão trabalha, e
    // toda saída o zera aqui — por isso o main não precisa guardar o estado anterior para saber.
    // Consequência aceita: um prompt de permissão para o relógio, porque a sessão de fato parou de
    // trabalhar e passou a esperar por gente.
    if (state.kind === 'working') {
      if (pulse.startedAt === null) pulse.startedAt = Date.now()
    } else {
      pulse.startedAt = null
    }

    emit(IPC_EVENT.state, { sessionId: session.id, state })

    publish()
  })

  session.on('turn', ({ index, thinkingTokens }) => {
    if (index === pulse.index) {
      pulse.thinkingTokens = thinkingTokens
    } else {
      // Fronteira de turno. Zerar o contador aqui, e não confiar no que vem no evento, é o que faz
      // o turno seguinte começar limpo mesmo que um quadro se perca.
      pulse.index = index
      pulse.thinkingTokens = 0
      // O ordinal mudou no `result`, que o core já passou pelo `#apply` antes de emitir — a ordem é
      // contrato dele. Seguir em `working` aqui só acontece com fila (`queued_turn_count > 0`), e é
      // o próximo turno começando: relógio novo. Fora disso o turno acabou, e o relógio some.
      pulse.startedAt = session.state.kind === 'working' ? Date.now() : null
    }

    publish()
  })
}
