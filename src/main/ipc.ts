import { ipcMain } from 'electron'
import type { WebContents } from 'electron'

import type { ConversationIndex, DangerIndex, SessionHandle, SessionHost } from '../core'
import { IPC_EVENT, IPC_INVOKE, scopeKey } from '../shared/ipc'
import type {
  AnswerQuestionRequest,
  CloseRequest,
  RespondPermissionRequest,
  SendRequest,
  SessionScope,
  SessionSnapshot,
  SetDangerousRequest,
  StartRequest,
  StartResult,
  StopRequest,
} from '../shared/ipc'
import { IDLE_ACTIVITY } from '../shared/session'
import type { TurnActivity } from '../shared/session'

export interface SessionIpcOptions {
  /**
   * Onde a sessão daquele escopo roda. Devolve `null` quando não há pasta conhecida — e aí não sobe
   * sessão nenhuma (CA-5). O escopo ausente é a tela de chat da fatia vertical.
   *
   * Assíncrono porque a resolução tem uma segunda chance: ver `src/main/index.ts`.
   */
  resolveCwd(scope: SessionScope | undefined): Promise<string | null>
  /** O vínculo durável. Consultado antes de criar; alimentado pelo `init`; podado pelo `close`. */
  conversations: ConversationIndex
  /**
   * A marca do modo *dangerously*, por cartão. Lida no nascimento de toda sessão e escrita pelo
   * handler `setDangerous` — e **nunca** pelo `close`/`closeAll`: a marca é decisão sobre o cartão,
   * não sobre a conversa.
   */
  danger: DangerIndex
  /**
   * Chamado quando uma sessão devolve a vez (`awaiting_input`). O main usa para reler a aba daquela
   * sessão.
   *
   * Vive aqui, e não no core, porque quem conhece board é a casca — e é injetado, e não chamado
   * direto, porque este registro não sabe que board existe: ele sabe que um turno acabou.
   *
   * Propriedade de função, e não método como o `resolveCwd` acima: este é o único do contrato que
   * **viaja** — vai como valor até o `forwardEvents` de cada sessão —, e o `unbound-method` do
   * ESLint reprova a referência solta a um método, com razão.
   */
  onTurnEnd: (scope: SessionScope | undefined) => void
}

export interface SessionIpc {
  /** Encerra tudo que está vivo. É o que o desligamento do app chama. */
  closeAll(): Promise<void>
}

/**
 * O relógio de uma sessão — o `TurnActivity` que atravessa a ponte mais o ordinal do turno.
 *
 * **O relógio mora no main, e não no core**, pelo mesmo motivo do `readAt` do board: o `core` conta
 * tokens e ordena fatos, a casca carimba tempo (`src/main/boards.ts`). É o que mantém o `yarn
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
   * Qual sessão é de qual escopo, por `scopeKey`. É o que faz o cartão ter *a* sua sessão, e não uma
   * por clique: sem ele, colapsar e reabrir subiria um segundo Claude Code para o mesmo card, com o
   * histórico da conversa preso no primeiro.
   *
   * Guarda o escopo inteiro, e não só o id da sessão: o `close` precisa saber o **tipo** do escopo
   * para decidir se esquece uma conversa, e parsear a chave de volta seria a segunda regra de
   * composição que o `scopeKey` existe para não haver.
   */
  const owners = new Map<string, { sessionId: string; scope: SessionScope }>()

  /** O relógio de cada sessão viva, alimentado pelo `forwardEvents` e lido pelo retrato. */
  const pulses = new Map<string, Pulse>()

  /** O pulso daquela sessão, ou o de quem não está em turno nenhum. */
  function activityOf(sessionId: string): TurnActivity {
    const pulse = pulses.get(sessionId)

    return pulse ? toActivity(pulse) : IDLE_ACTIVITY
  }

  /**
   * A sessão viva daquele escopo, se houver.
   *
   * **Sessão morta não é reatada.** Ela sai do índice e o clique seguinte sobe uma nova. Sem esta
   * regra, um card cuja sessão morreu sozinha — processo que não subiu, credencial que expirou —
   * ficaria preso ao cadáver até alguém reiniciar o app. `closed` por ação humana (CA-6) cai na
   * mesma regra, e é o comportamento certo: encerrei porque terminei, clico de novo porque
   * recomecei.
   */
  function livingSessionFor(scope: SessionScope): SessionHandle | null {
    const chave = scopeKey(scope)
    const owner = owners.get(chave)
    if (owner === undefined) return null

    const session = sessions.get(owner.sessionId)
    if (session && session.state.kind !== 'closed' && session.state.kind !== 'failed') {
      return session
    }

    owners.delete(chave)

    return null
  }

  /** A guarda de partida concorrente. Ver `oneStartPerScope`. */
  const gate = oneStartPerScope<StartResult>()

  /**
   * Registra a sessão recém-criada e devolve o retrato dela.
   *
   * O caminho da retomada e o da sessão nova terminam iguais — só a entrada muda —, e é por isso
   * que o fim mora aqui: as duas pontas que o `close` depois limpa (`sessions`, `owners`) e a
   * assinatura dos eventos precisam acontecer nas duas, sempre na mesma ordem.
   */
  function begin(
    session: SessionHandle,
    scope: SessionScope | undefined,
    sender: WebContents,
  ): SessionSnapshot {
    sessions.set(session.id, session)
    if (scope !== undefined) owners.set(scopeKey(scope), { sessionId: session.id, scope })
    // Os eventos vão para a janela que pediu a sessão, não para todas: é ela quem a está mostrando.
    forwardEvents(session, sender, pulses, scope, options.conversations, options.onTurnEnd)

    return snapshot(session, scope, activityOf(session.id))
  }

  /**
   * O caminho de criação inteiro — retomada **e** sessão nova. Roda dentro do `gate`, e é por isso
   * que ele está aqui e não solto no handler: é este bloco que não pode acontecer duas vezes para
   * o mesmo escopo.
   */
  async function create(
    scope: SessionScope | undefined,
    sender: WebContents,
  ): Promise<StartResult> {
    // Uma leitura só, no topo, porque os dois ramos (retomada e sessão nova) precisam dela e
    // esquecê-la num deles faria a marca valer só para metade dos cliques. Ela é aqui dentro, e não
    // no handler, porque é aqui que o `gate` já protege: duas partidas concorrentes leriam a marca
    // duas vezes e subiriam duas sessões. A marca gravada é por **cartão**: a tela de chat da fatia
    // vertical não tem onde a ter (decisão 13 do #10), e a da triagem é outra durabilidade.
    const dangerous =
      scope?.kind === 'card' ? await options.danger.isDangerous(scope.itemId) : false

    // A retomada é **só do cartão**: sem card não há vínculo durável a guardar, e um vínculo
    // sintético seria justamente o rastro que uma triagem não pode deixar para trás.
    if (scope?.kind === 'card') {
      // A retomada vem **antes** do `resolveCwd`, e essa ordem é a regra: a pasta de uma conversa
      // que existe é a pasta em que ela rodou, não a que o índice de repos apontaria agora. Um
      // clone novo virando "a pasta daquele repo" não pode mudar onde uma conversa em curso
      // continua.
      const restoration = await options.conversations.restore(scope.itemId)
      if (restoration) {
        const session = host.start({
          cwd: restoration.cwd,
          resume: restoration.sessionId,
          history: restoration.history,
          // A retomada carrega a marca junto: uma conversa que atravessou o restart volta no modo em
          // que estava, que é o par natural do CA-2 com a retomada do #22.
          dangerous,
        })

        return { started: true, session: begin(session, scope, sender) }
      }
    }

    const cwd = await options.resolveCwd(scope)
    // **Não existe default.** Subir sessão na pasta errada é o pior modo de falha desta feature —
    // pior que não subir —, então "não sei onde é" vira resposta, e o cartão pede a pasta (CA-5).
    if (cwd === null) return { started: false, reason: 'unknown-folder' }

    return { started: true, session: begin(host.start({ cwd, dangerous }), scope, sender) }
  }

  ipcMain.handle(
    IPC_INVOKE.start,
    async (event, request: StartRequest | undefined): Promise<StartResult> => {
      const scope = request?.scope

      if (scope !== undefined) {
        const living = livingSessionFor(scope)
        // Sem criar outra e **sem registrar os ouvintes de novo**: a tela que reabre o cartão parte
        // do retrato, e uma segunda assinatura duplicaria cada mensagem daí em diante.
        // O retrato leva o pulso vivo daquela sessão: reabrir o cartão no meio do turno tem de
        // continuar a contagem, e não recomeçá-la.
        //
        // Continua **antes** do `gate`, e sem `await`: sessão já viva responde direto, como hoje.
        if (living) {
          return { started: true, session: snapshot(living, scope, activityOf(living.id)) }
        }
      }

      return gate(scope, () => create(scope, event.sender))
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

  /**
   * Liga ou desliga o portão daquele cartão. **Por cartão, e não por sessão**: é o que faz a marca
   * existir num cartão que ainda não foi clicado.
   *
   * **Sem retorno**, e por isso sem estado otimista do outro lado (decisão 12): o crachá segue o
   * retrato que o `onChange` do índice publica, e só ele. Uma recusa do SDK deixa `efetivo` igual ao
   * que já vigorava, o `set` não publica, e a tela simplesmente não se move — que é a verdade.
   */
  ipcMain.handle(
    IPC_INVOKE.setDangerous,
    async (_event, request: SetDangerousRequest): Promise<void> => {
      const session = livingSessionFor(request.scope)
      // Sem sessão viva, a marca é só o registro — e ela vale: a próxima sessão daquele cartão nasce
      // com ela. Com sessão viva, quem manda é o que o SDK aceitou, não o que a tela pediu; gravar o
      // pedido faria o crachá prometer um cartão sem portão que o portão ainda guarda.
      const efetivo = session ? await session.setDangerous(request.dangerous) : request.dangerous

      // O `DangerIndex` é indexado por `itemId` e vai a disco: só o escopo de cartão tem onde gravar.
      if (request.scope.kind === 'card') options.danger.set(request.scope.itemId, efetivo)
    },
  )

  ipcMain.handle(IPC_INVOKE.close, async (_event, request: CloseRequest): Promise<void> => {
    const session = sessions.get(request.sessionId)
    if (!session) return

    sessions.delete(request.sessionId)
    // O relógio morre com a sessão: registro órfão faria o retrato do próximo clique naquele
    // cartão nascer com a idade de um turno que já acabou.
    pulses.delete(request.sessionId)
    // Dos **três** mapas: deixar o escopo apontando para uma sessão que já não existe faria o
    // clique seguinte cair no `livingSessionFor` de um fantasma.
    for (const [chave, entry] of owners) {
      if (entry.sessionId === request.sessionId) {
        // O CA-4: encerrar é definitivo. É o **único** lugar que esquece — `closeAll()` não esquece
        // nada, e é justamente essa diferença que o card do #22 existe para criar.
        //
        // E esquece **só a conversa**: o `options.danger` não é tocado aqui de propósito (decisão
        // 14 do #10). Encerrar a sessão encerra a conversa; a marca é uma decisão sobre o cartão, e
        // revogá-la de carona seria o app decidindo por conta própria.
        //
        // Só o cartão tem o que esquecer: uma triagem nunca gravou vínculo nenhum, e mandar esquecer
        // uma chave que não é cartão seria inventar entrada em índice alheio.
        if (entry.scope.kind === 'card') options.conversations.forget(entry.scope.itemId)
        owners.delete(chave)
      }
    }

    await session.close()
  })

  return {
    async closeAll(): Promise<void> {
      const living = [...sessions.values()]
      sessions.clear()
      owners.clear()
      pulses.clear()
      // `allSettled`: uma sessão que falhe ao fechar não pode impedir as outras de fechar nem
      // derrubar o desligamento com uma rejeição sem dono.
      await Promise.allSettled(living.map((session) => session.close()))
    },
  }
}

/**
 * Uma partida de cada vez por escopo: **quem chega com outra em voo pega carona nela** em vez de
 * abrir a segunda.
 *
 * Devolve o portão. Chamado com o mesmo escopo enquanto a partida anterior não terminou, ele
 * devolve a promessa da primeira e não roda `start` de novo; ao terminar, a entrada some e o
 * próximo clique parte de novo. Escopo ausente — a tela de chat da fatia vertical — não compartilha
 * nada: cada chamada é uma partida.
 *
 * A janela entre "não achei sessão viva" e "registrei a nova" já existe hoje (o `await` do
 * `resolveCwd`), e o duplo-monte do StrictMode a atravessa em desenvolvimento. Até agora o preço
 * era uma sessão órfã. Com a retomada o preço muda de natureza: **dois processos do Claude Code
 * escrevendo o mesmo transcript**, que é corrupção de dado do usuário e não desperdício de
 * processo. A leitura do transcript ainda alarga essa janela em alguns milissegundos.
 *
 * Puro e exportado de propósito: é a peça que o `tests/unit/session-ipc.test.ts` prende, porque
 * este é o pior modo de falha da retomada e ele não pode depender de revisão para não voltar.
 */
export function oneStartPerScope<T>(): (
  scope: SessionScope | undefined,
  start: () => Promise<T>,
) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>()

  return (scope, start) => {
    if (scope === undefined) return start()

    const chave = scopeKey(scope)
    const running = inFlight.get(chave)
    if (running) return running

    // A remoção no `finally` e não no `then`: uma partida que falhou não pode deixar o escopo
    // trancado até o app reiniciar.
    const started = start().finally(() => {
      inFlight.delete(chave)
    })
    inFlight.set(chave, started)

    return started
  }
}

function snapshot(
  session: SessionHandle,
  scope: SessionScope | undefined,
  activity: TurnActivity,
): SessionSnapshot {
  return {
    id: session.id,
    scope,
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
  scope: SessionScope | undefined,
  conversations: ConversationIndex,
  onTurnEnd: (scope: SessionScope | undefined) => void,
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
    // O vínculo nasce aqui porque é aqui que o `session_id` do Claude Code aparece pela primeira
    // vez — e é reescrito a cada `init` de propósito: o registro segue o que o SDK disse.
    //
    // **Só o cartão vincula.** O índice de conversas é o vínculo `cartão → sessão`; uma triagem não
    // tem cartão a que se ligar, e gravá-la ali deixaria um crachá de conversa órfão no kanban.
    if (scope?.kind === 'card') conversations.remember(scope.itemId, init.sessionId)

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

    // O fim do turno é a única transição que significa "a vez voltou para você" (`state.ts`), e é o
    // gatilho de releitura do board: o card que a skill acabou de criar (ou de mover) aparece sem
    // alt-tab. Permissão e pergunta **não** contam — ali o turno continua em curso, e reler a cada
    // prompt de `gh` seria uma leitura do GitHub por clique de permissão.
    //
    // Vale para **qualquer** sessão, e não só para a da triagem: um turno de cartão que moveu o
    // próprio card acabou de mudar o board do mesmo jeito.
    if (state.kind === 'awaiting_input') onTurnEnd(scope)

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
