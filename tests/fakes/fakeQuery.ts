import type { UUID } from 'node:crypto'

import type {
  PermissionMode,
  PermissionResult,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKTaskStartedMessage,
  SDKThinkingTokensMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'

import type { QueryFn } from '../../src/core/session/SessionHost'

/** As opções com que o host chamou o `query()`. */
export type QueryOptions = NonNullable<Parameters<QueryFn>[0]['options']>

/** O pedido de permissão que o turno faz — o que o SDK real entregaria ao `canUseTool`. */
export interface FakePermissionAsk {
  toolName: string
  toolUseID: string
  input?: Record<string, unknown>
  title?: string
  displayName?: string
  description?: string
}

export interface FakeTools {
  /** Dispara o `canUseTool` do host e devolve o que a pessoa decidiu. */
  askPermission(ask: FakePermissionAsk): Promise<PermissionResult>
  /**
   * O mesmo canal, com o nome e o payload de uma pergunta — é assim que ela chega no SDK real,
   * e por isso o roteiro não ganha porta própria: o despacho é justamente o que está sob teste.
   */
  askQuestion(ask: FakeQuestionAsk): Promise<PermissionResult>
  /**
   * Estaciona o turno até a parada chegar — o "turno que não termina sozinho" de que o card trata,
   * e a única forma de o teste ser determinístico sem timer.
   *
   * A interrupção é **contada**, não sinalizada: o `stop()` do teste pode chegar antes de esta
   * função registrar a espera, porque `send()` só enfileira e quem roda o turno é a iteração do
   * gerador, noutro tick. Um `interrupt()` que apenas acordasse a lista de esperas encontraria a
   * lista vazia, e o turno ficaria estacionado para sempre: o teste penduraria em vez de falhar.
   * Com o contador, a ordem de chegada deixa de importar.
   */
  untilInterrupt(): Promise<void>
}

/** Uma pergunta do roteiro. `questions` é `unknown` para o teste poder mandar payload torto. */
export interface FakeQuestionAsk {
  toolUseID: string
  questions: unknown
}

/** O que a sessão faz a cada mensagem do usuário. */
export type FakeTurn = (text: string, tools: FakeTools) => Promise<SDKMessage[]>

export interface FakeScript {
  /** Campos do `system`/`init` que abre a sessão. */
  init?: Partial<SDKSystemMessage>
  /** O default responde com um texto e fecha o turno com sucesso. */
  turn?: FakeTurn
  /** Quando presente, a iteração explode em vez de emitir o `init` — o processo que não sobe. */
  failWith?: Error
  /** Quando presente, `interrupt()` rejeita: é o caminho do controle que não pega. */
  interruptWith?: Error
}

export interface FakeQuery {
  /** Entra no lugar do `query()` do SDK. */
  readonly query: QueryFn
  /** Os textos que chegaram pela entrada, na ordem em que o `query()` os consumiu. */
  readonly received: string[]
  /** As opções da última chamada — é por aqui que se verifica o contrato com o SDK. */
  readonly options: QueryOptions | undefined
  /** `true` quando a iteração terminou: é o que prova que `close()` encerrou o `query()`. */
  readonly finished: boolean
  /** Quantas vezes o core pediu a interrupção — é por aqui que se prova que `stop()` chegou. */
  readonly interrupts: number
  /** O modo que vigora agora. Nasce do `permissionMode` das opções e muda por `setPermissionMode`. */
  readonly permissionMode: string
  /**
   * Todo modo que o core **pediu**, na ordem — inclusive os pedidos que rejeitaram, como o
   * `interrupts` conta o `interrupt()` que não pegou. É o que prova que um segundo clique durante
   * a troca não virou um segundo control request.
   */
  readonly permissionModes: string[]
}

const SESSION_ID = 'fake-session'

/** O nome que o SDK real usa — o mesmo que o `SessionHandle` procura para despachar a pergunta. */
const ASK_USER_QUESTION = 'AskUserQuestion'

let counter = 0

/** Um uuid no formato que o SDK usa, sequencial para o teste não depender de sorte. */
function nextUuid(): UUID {
  counter += 1
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`
}

/**
 * Um `query()` de mentira: consome a entrada de verdade, emite as mensagens que o roteiro mandar e
 * chama o `canUseTool` do host quando o turno pedir permissão.
 *
 * É o que permite exercitar o host inteiro sem rede, sem modelo e sem cota — a razão de `query` ser
 * injetado.
 */
export function createFakeQuery(script: FakeScript = {}): FakeQuery {
  const received: string[] = []
  const turn = script.turn ?? defaultTurn
  const state: {
    options: QueryOptions | undefined
    finished: boolean
    interrupts: number
    permissionMode: PermissionMode
    permissionModes: PermissionMode[]
  } = {
    options: undefined,
    finished: false,
    interrupts: 0,
    permissionMode: 'default',
    permissionModes: [],
  }

  const query: QueryFn = ({ prompt, options }) => {
    state.options = options
    state.permissionMode = options?.permissionMode ?? 'default'
    // O modo com que a sessão **nasceu**, congelado aqui: é ele que o `init` reporta. O fake emite
    // o `init` uma vez só (o SDK real manda um a cada turno, M-7), então uma troca posterior não
    // tem por onde ser anunciada — a consequência está declarada no plano de testes da spec.
    const bornMode = state.permissionMode
    const canUseTool = options?.canUseTool
    const aborter = new AbortController()

    let pendentes = 0
    const esperando: (() => void)[] = []

    /** Casa cada interrupção pendente com uma espera, em qualquer ordem de chegada. */
    function drenar(): void {
      while (pendentes > 0 && esperando.length > 0) {
        pendentes -= 1
        esperando.shift()!()
      }
    }

    const ask = async (request: FakePermissionAsk): Promise<PermissionResult> => {
      if (!canUseTool) throw new Error('o host não passou `canUseTool` ao query()')

      const result = await canUseTool(request.toolName, request.input ?? {}, {
        signal: aborter.signal,
        toolUseID: request.toolUseID,
        requestId: `req-${request.toolUseID}`,
        title: request.title,
        displayName: request.displayName,
        description: request.description,
      })
      // `null` só é válido quando o consumidor respondeu fora de banda, o que o host não faz.
      if (!result) throw new Error('`canUseTool` devolveu null')

      return result
    }

    const tools: FakeTools = {
      // Em `bypassPermissions` a ferramenta executa **sem passar pelo `canUseTool`** (M-1): o SDK
      // nem chega a consultar o callback, e por isso o fake devolve `allow` daqui mesmo. Um fake
      // que ainda assim chamasse o callback seria mais permissivo que a realidade ao contrário —
      // o modo passaria a ser um auto-allow nosso, e o CA-1 provaria a nossa vontade, não o SDK.
      askPermission: (request) =>
        state.permissionMode === 'bypassPermissions'
          ? Promise.resolve<PermissionResult>({ behavior: 'allow' })
          : ask(request),
      // A pergunta chega ao `canUseTool` **nos dois modos** (M-2), e é essa medição que autoriza o
      // modo a ser o do próprio SDK: o `AskUserQuestion` continua parando a sessão.
      askQuestion: (question) =>
        ask({
          toolName: ASK_USER_QUESTION,
          toolUseID: question.toolUseID,
          // Sem guarda: o payload torto é metade do que este canal existe para exercitar.
          input: { questions: question.questions },
        }),
      untilInterrupt: () =>
        new Promise<void>((resolve) => {
          esperando.push(resolve)
          drenar()
        }),
    }

    async function* run(): AsyncGenerator<SDKMessage, void> {
      try {
        if (script.failWith) throw script.failWith

        yield initMessage({ permissionMode: bornMode, ...script.init })

        // O host sempre passa o iterável (streaming input); a string existe só no tipo do SDK.
        if (typeof prompt === 'string') return

        for await (const userMessage of prompt) {
          const text = userText(userMessage)
          received.push(text)
          for (const message of await turn(text, tools)) yield message
        }
      } finally {
        state.finished = true
      }
    }

    const interrupt = (): Promise<undefined> => {
      state.interrupts += 1
      // O controle que não pega: conta que foi pedido, e não interrompe nada. O turno segue
      // estacionado e a sessão segue trabalhando — que é exatamente o que se quer provar.
      if (script.interruptWith) return Promise.reject(script.interruptWith)

      pendentes += 1
      drenar()

      return Promise.resolve(undefined)
    }

    /**
     * A troca de modo em voo, **com o contrato medido**.
     *
     * A rejeição sem `allowDangerouslySkipPermissions` (M-3) é o que faz esta linha do fake ter
     * dente: quem um dia remover a flag do `SessionHost` não quebra um smoke que quase ninguém
     * roda — quebra um unitário do CI. A mensagem é a do SDK real, palavra por palavra.
     */
    const setPermissionMode = (mode: PermissionMode): Promise<void> => {
      state.permissionModes.push(mode)

      if (mode === 'bypassPermissions' && options?.allowDangerouslySkipPermissions !== true) {
        return Promise.reject(
          new Error(
            `Cannot set permission mode to ${mode} because the session was not launched with --dangerously-skip-permissions`,
          ),
        )
      }

      state.permissionMode = mode

      return Promise.resolve()
    }

    // O `Query` do SDK é um AsyncGenerator mais um punhado de controles (interrupt, setModel,
    // setPermissionMode...). O core itera e usa **dois** deles, então o fake implementa a iteração,
    // o `interrupt()` e o `setPermissionMode()` de verdade, e continua não fingindo os outros: usar
    // um deles aqui estoura, em vez de passar em silêncio.
    return Object.assign(run(), { interrupt, setPermissionMode }) as unknown as Query
  }

  return {
    query,
    received,
    get options() {
      return state.options
    },
    get finished() {
      return state.finished
    },
    get interrupts() {
      return state.interrupts
    },
    get permissionMode() {
      return state.permissionMode
    },
    get permissionModes() {
      return state.permissionModes
    },
  }
}

const defaultTurn: FakeTurn = (text) =>
  Promise.resolve([assistantMessage(`eco: ${text}`), successResult()])

export function initMessage(overrides: Partial<SDKSystemMessage> = {}): SDKSystemMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'none',
    claude_code_version: '0.0.0-fake',
    cwd: '/tmp/fake-cwd',
    tools: ['Write'],
    mcp_servers: [],
    model: 'fake-model',
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: nextUuid(),
    session_id: SESSION_ID,
    ...overrides,
  }
}

export function assistantMessage(text: string): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: {
      id: `msg_${String(counter)}`,
      type: 'message',
      role: 'assistant',
      model: 'fake-model',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    parent_tool_use_id: null,
    uuid: nextUuid(),
    session_id: SESSION_ID,
  }
}

/** Uma chamada de ferramenta do roteiro: o que o bloco `tool_use` carrega. */
export interface FakeToolUse {
  id: string
  name: string
  input?: Record<string, unknown>
}

/**
 * A mensagem de assistente que chama ferramentas.
 *
 * `parentId` preenchido é o quadro de **subagente**: com `forwardSubagentText: false` o texto do
 * subagente não é encaminhado, mas os `tool_use` dele são, com o `parent_tool_use_id` do `Agent`
 * que os gerou. É essa a forma que o CA-5 exercita.
 */
export function assistantToolUse(
  uses: readonly FakeToolUse[],
  parentId: string | null = null,
): SDKAssistantMessage {
  return {
    type: 'assistant',
    message: {
      id: `msg_${String(counter)}`,
      type: 'message',
      role: 'assistant',
      model: 'fake-model',
      content: uses.map((use) => ({
        type: 'tool_use' as const,
        id: use.id,
        name: use.name,
        input: use.input ?? {},
      })),
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    parent_tool_use_id: parentId,
    uuid: nextUuid(),
    session_id: SESSION_ID,
  }
}

/**
 * O resultado de uma ferramenta, que o SDK devolve como mensagem de **usuário**.
 *
 * `is_error` só é escrito quando é `true`: no sucesso o SDK **omite** o campo em vez de mandá-lo
 * `false`, e um fake que mandasse `false` esconderia justamente o caso que a guarda `=== true`
 * existe para tratar.
 */
export function toolResult(toolUseId: string, isError = false): SDKUserMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: isError ? 'falhou' : 'ok',
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
    parent_tool_use_id: null,
    uuid: nextUuid(),
    session_id: SESSION_ID,
  }
}

/**
 * Um quadro de raciocínio — o único heartbeat que o SDK dá, a cada ~1,3s enquanto o modelo pensa.
 *
 * Os dois números são pedidos separadamente porque no SDK eles são coisas diferentes:
 * `estimated_tokens` é o **acumulado** do bloco corrente e `estimated_tokens_delta` é o incremento
 * deste quadro. Um default que derivasse um do outro esconderia justamente o caso que o core trata
 * — o quadro perdido, em que a soma dos deltas deixa de bater com o acumulado.
 */
export function thinkingTokens(estimated: number, delta: number): SDKThinkingTokensMessage {
  return {
    type: 'system',
    subtype: 'thinking_tokens',
    estimated_tokens: estimated,
    estimated_tokens_delta: delta,
    uuid: nextUuid(),
    session_id: SESSION_ID,
  }
}

/** O `task_started`, que traz a frase que o próprio Claude Code escreveu para a chamada. */
export function taskStarted(toolUseId: string, description: string): SDKTaskStartedMessage {
  return {
    type: 'system',
    subtype: 'task_started',
    task_id: `task-${toolUseId}`,
    tool_use_id: toolUseId,
    description,
    uuid: nextUuid(),
    session_id: SESSION_ID,
  }
}

/**
 * O eco do texto de um subagente, que chega como mensagem de **usuário** com bloco `text`. Existe
 * no roteiro para provar que ele **não** vira balão: é o que a regra "só `tool_result`" protege.
 */
export function userEcho(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    uuid: nextUuid(),
    session_id: SESSION_ID,
  }
}

/** O `result` que fecha um turno. `queued` > 0 significa que ainda há turnos na fila. */
export function successResult(queued = 0): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: 'ok',
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    queued_turn_count: queued,
    uuid: nextUuid(),
    session_id: SESSION_ID,
  }
}

/**
 * O `result` de um turno cortado, do jeito que o SDK o descreve. Fixar aqui a forma real é o que
 * impede o teste de provar a nossa invenção em vez do contrato do SDK.
 */
export function abortedResult(queued = 0): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: true,
    num_turns: 1,
    stop_reason: 'aborted',
    terminal_reason: 'aborted_streaming',
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    queued_turn_count: queued,
    errors: [],
    uuid: nextUuid(),
    session_id: SESSION_ID,
  }
}

/** O texto de uma mensagem do usuário — a `InputQueue` sempre a monta com conteúdo em string. */
function userText(message: SDKUserMessage): string {
  const payload: unknown = message.message
  if (typeof payload !== 'object' || payload === null) return ''

  const content: unknown = (payload as Record<string, unknown>)['content']
  return typeof content === 'string' ? content : ''
}
