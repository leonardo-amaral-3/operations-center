import type { UUID } from 'node:crypto'

import type {
  PermissionResult,
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
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
}

const SESSION_ID = 'fake-session'

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
  const state: { options: QueryOptions | undefined; finished: boolean } = {
    options: undefined,
    finished: false,
  }

  const query: QueryFn = ({ prompt, options }) => {
    state.options = options
    const canUseTool = options?.canUseTool
    const aborter = new AbortController()

    const tools: FakeTools = {
      askPermission: async (ask) => {
        if (!canUseTool) throw new Error('o host não passou `canUseTool` ao query()')

        const result = await canUseTool(ask.toolName, ask.input ?? {}, {
          signal: aborter.signal,
          toolUseID: ask.toolUseID,
          requestId: `req-${ask.toolUseID}`,
          title: ask.title,
          displayName: ask.displayName,
          description: ask.description,
        })
        // `null` só é válido quando o consumidor respondeu fora de banda, o que o host não faz.
        if (!result) throw new Error('`canUseTool` devolveu null')

        return result
      },
    }

    async function* run(): AsyncGenerator<SDKMessage, void> {
      try {
        if (script.failWith) throw script.failWith

        yield initMessage(script.init)

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

    // O `Query` do SDK é um AsyncGenerator mais um punhado de controles (interrupt, setModel,
    // setPermissionMode...). O core só itera, então o fake implementa a iteração de verdade e não
    // finge os controles: usar um deles aqui estoura, em vez de passar em silêncio.
    return run() as unknown as Query
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

/** O texto de uma mensagem do usuário — a `InputQueue` sempre a monta com conteúdo em string. */
function userText(message: SDKUserMessage): string {
  const payload: unknown = message.message
  if (typeof payload !== 'object' || payload === null) return ''

  const content: unknown = (payload as Record<string, unknown>)['content']
  return typeof content === 'string' ? content : ''
}
