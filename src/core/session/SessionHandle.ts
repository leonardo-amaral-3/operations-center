import type {
  CanUseTool,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'

import { InputQueue } from './InputQueue'
import { initialState, nextState } from './state'
import type { SessionEvent, SessionState } from './state'
import type {
  ChatMessage,
  ChatToolUse,
  PermissionDecision,
  PermissionRequest,
  Question,
  QuestionAnswers,
  QuestionOption,
  QuestionRequest,
  SessionInit,
  ToolStatus,
} from './types'

/** Os três canais que uma sessão publica. */
interface SessionEvents {
  state: SessionState
  message: ChatMessage
  init: SessionInit
}

/**
 * Emissor tipado dos três canais acima. Trinta linhas em vez de uma dependência: uma biblioteca de
 * eventos traria wildcards, `once`, prioridade e tipagem por string solta — nada disso é usado
 * aqui, e a tipagem por canal é justamente o que a biblioteca genérica não dá.
 */
class Emitter {
  // Guardar o ouvinte como `(payload: never) => void` é o que permite um único mapa para canais de
  // payloads diferentes: `never` é aceito por qualquer parâmetro, então guardar é seguro; só a
  // chamada precisa recuperar o tipo do canal.
  readonly #listeners = new Map<keyof SessionEvents, Set<(payload: never) => void>>()

  on<K extends keyof SessionEvents>(
    event: K,
    listener: (payload: SessionEvents[K]) => void,
  ): () => void {
    let listeners = this.#listeners.get(event)
    if (!listeners) {
      listeners = new Set()
      this.#listeners.set(event, listeners)
    }
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  }

  emit<K extends keyof SessionEvents>(event: K, payload: SessionEvents[K]): void {
    const listeners = this.#listeners.get(event)
    if (!listeners) return

    // Cópia antes de percorrer: um ouvinte que se cancela ao ser chamado mexeria no Set em uso.
    for (const listener of [...listeners]) {
      const typed = listener as (payload: SessionEvents[K]) => void
      typed(payload)
    }
  }
}

/**
 * O que o host entrega para a sessão nascer: uma função que recebe a entrada do usuário e o
 * `canUseTool`, e devolve o `query()` já configurado.
 *
 * É esta indireção que desata o nó: o `canUseTool` precisa do handle (para pôr o pedido na tela e
 * esperar a decisão) e o handle precisa do `query()` — que precisa do `canUseTool`. Com a fábrica,
 * o handle constrói o seu lado e o host decide só as opções.
 */
export type StartQuery = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  canUseTool: CanUseTool
}) => Query

/** Motivo devolvido ao SDK quando a decisão não pode mais ser tomada por uma pessoa. */
const SESSION_CLOSED_DENIAL = 'Sessão encerrada antes da decisão.'

/** A nota que a parada deixa na conversa. Exportada porque o teste a lê daqui, e não a redigita. */
export const INTERRUPTED_NOTICE = 'Turno interrompido.'

/**
 * Os campos que identificam uma chamada, em ordem de preferência. Uma lista ordenada, e não uma
 * tabela por ferramenta: a tabela viraria dívida no primeiro release do CLI com ferramenta nova.
 *
 * `command` vem antes de `description` porque no `Bash` a descrição já chega pelo `task_started` e
 * vira `headline` — repeti-la no detalhe desperdiçaria a linha.
 */
const DETAIL_FIELDS = ['command', 'file_path', 'pattern', 'url', 'query', 'description', 'prompt']

/** O teto de uma linha de trilha. O corte é aqui, e não na tela: ver `ChatToolUse.detail`. */
const DETAIL_MAX = 120

/**
 * A ferramenta com que o Claude faz uma pergunta. Ela chega pelo mesmo `canUseTool` de qualquer
 * outra — não há canal separado no SDK —, e é este nome que separa os dois tratamentos.
 */
const ASK_USER_QUESTION = 'AskUserQuestion'

/** Uma pergunta em aberto: como devolvê-la ao SDK, e o `questions` cru que ela precisa espelhar. */
interface PendingQuestion {
  resolve: (result: PermissionResult) => void
  /**
   * O valor de `input.questions` **exatamente como veio**. O executor da ferramenta espelha este
   * campo, então devolver a versão traduzida (a que a tela desenhou) mudaria o payload por baixo
   * dele — o que se perde na tradução é justamente o que ele espera de volta.
   */
  questions: unknown
}

/**
 * Uma sessão viva: a fila de entrada, o `query()` que a consome, a máquina de estados e as
 * mensagens já vistas — mais os três canais por onde a casca observa tudo isso.
 *
 * Não conhece Electron, React nem IPC. O que sai daqui são valores simples, prontos para atravessar
 * a ponte até a tela.
 */
export class SessionHandle {
  readonly id: string

  readonly #queue = new InputQueue()
  readonly #emitter = new Emitter()
  readonly #messages: ChatMessage[] = []
  /** Decisões de permissão em aberto, por id do pedido: resolvê-las é o que destrava o turno. */
  readonly #pending = new Map<string, (result: PermissionResult) => void>()
  /** Perguntas em aberto, no mesmo papel — mapa próprio porque a resposta delas não é sim/não. */
  readonly #pendingQuestions = new Map<string, PendingQuestion>()
  readonly #query: Query
  /** A leitura do `query()`, viva enquanto a sessão existir. `close()` espera por ela. */
  readonly #pump: Promise<void>

  #state: SessionState = initialState
  #init: SessionInit | undefined
  #sentCount = 0
  /** Levantada entre o pedido de parada e o `result` que ele corta; é ela que vira `interrupted`. */
  #stopping = false
  /** Numera o id da nota de parada, como `#sentCount` numera o do envio. */
  #stopCount = 0
  #closing = false

  constructor(id: string, startQuery: StartQuery) {
    this.id = id
    this.#query = startQuery({
      prompt: this.#queue,
      canUseTool: (toolName, input, options) => this.#requestDecision(toolName, input, options),
    })
    this.#pump = this.#consume()
  }

  /** Preenchido quando o `init` do SDK chega; antes disso a sessão ainda não se apresentou. */
  get init(): SessionInit | undefined {
    return this.#init
  }

  get state(): SessionState {
    return this.#state
  }

  get messages(): readonly ChatMessage[] {
    return this.#messages
  }

  /** Assina um canal. Devolve a função de cancelamento. */
  on<K extends keyof SessionEvents>(
    event: K,
    listener: (payload: SessionEvents[K]) => void,
  ): () => void {
    return this.#emitter.on(event, listener)
  }

  /**
   * Enfileira o texto do usuário e o registra na conversa na hora — o eco do SDK chegaria depois e
   * duplicaria a mensagem na tela.
   */
  send(text: string): void {
    if (this.#closing) return

    this.#sentCount += 1
    this.#queue.push(text)
    this.#upsert({ id: `${this.id}-u${this.#sentCount}`, role: 'user', text })
    this.#apply({ kind: 'sent' })
  }

  /** A decisão humana sobre um pedido. Pedido desconhecido (ou já resolvido): no-op. */
  respondPermission(requestId: string, decision: PermissionDecision): void {
    const resolve = this.#pending.get(requestId)
    if (!resolve) return

    this.#pending.delete(requestId)
    resolve(
      decision === 'allow'
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: 'Negado pelo usuário.' },
    )
    this.#apply({ kind: 'permission_resolved' })
  }

  /**
   * A escolha humana sobre uma pergunta. Pergunta desconhecida (ou já resolvida): no-op, como o
   * `respondPermission`.
   *
   * `allow` com o `answers` no `updatedInput` é o único caminho que produz um `tool_result` limpo:
   * `allow` puro executa a ferramenta sem quem a desenhe e devolve "The user did not answer the
   * questions", e `deny` com a resposta na mensagem marca o resultado como erro — mentir para o
   * modelo sobre o que aconteceu. O `questions` volta cru; ver `PendingQuestion`.
   */
  answerQuestion(requestId: string, answers: QuestionAnswers): void {
    const pending = this.#pendingQuestions.get(requestId)
    if (!pending) return

    this.#pendingQuestions.delete(requestId)
    pending.resolve({
      behavior: 'allow',
      updatedInput: { questions: pending.questions, answers },
    })
    this.#apply({ kind: 'question_answered' })
  }

  /**
   * Para o turno em curso. **Não** é `close()`: a sessão continua viva, com o mesmo id, o mesmo
   * contexto e o mesmo histórico — o que morre é a vez que estava rodando.
   *
   * Só de `working`, e só uma vez por turno. Em `awaiting_decision`/`awaiting_answer` o turno já
   * está parado esperando uma pessoa, e a saída de lá é negar ou responder — interromper dali
   * deixaria a promessa do `canUseTool` órfã no mapa de pendentes.
   *
   * Sem `await` e sem `Promise`, como `send()`: a confirmação da parada é o `result` que volta pelo
   * canal de estado, como toda transição desta classe. Uma rejeição do controle significa que o
   * turno **não** parou; baixar a bandeira devolve o botão à tela em vez de deixar a sessão presa
   * num pedido que não pegou.
   */
  stop(): void {
    if (this.#closing || this.#stopping) return
    if (this.#state.kind !== 'working') return

    this.#stopping = true
    void this.#query.interrupt().catch(() => {
      this.#stopping = false
    })
  }

  /**
   * Encerra a sessão e espera o `query()` terminar de verdade.
   *
   * A ordem importa: negar o que estava pendente destrava o turno corrente (uma permissão sem
   * resposta trava o SDK indefinidamente — não há prazo), e só então fechar a fila termina a
   * iteração.
   */
  async close(): Promise<void> {
    this.#closing = true
    this.#denyPending()
    this.#queue.close()
    await this.#pump
  }

  async #consume(): Promise<void> {
    try {
      for await (const message of this.#query) this.#ingest(message)
    } catch (error) {
      this.#apply({ kind: 'failed', reason: describe(error) })
    } finally {
      this.#denyPending()
      this.#apply({ kind: 'closed' })
    }
  }

  #ingest(message: SDKMessage): void {
    if (message.type === 'system') {
      if (message.subtype === 'init') {
        this.#init = {
          sessionId: message.session_id,
          model: message.model,
          cwd: message.cwd,
          apiKeySource: message.apiKeySource,
        }
        this.#emitter.emit('init', this.#init)
        this.#apply({ kind: 'init' })
        return
      }

      // A frase que o próprio Claude Code escreveu para a chamada. Ela só toca o `headline`, nunca
      // o `status`: um `task_progress` atrasado não pode ressuscitar ferramenta que já terminou.
      if (message.subtype === 'task_started' || message.subtype === 'task_progress') {
        this.#patchTool(message.tool_use_id, { headline: message.description })
      }

      // `task_notification` e `task_updated` ficam de fora de propósito: o primeiro é redundante
      // com o `tool_result`, e o segundo não traz `tool_use_id` — não há a que casá-lo.
      return
    }

    if (message.type === 'assistant') {
      // O texto continua achatado numa mensagem só, com o `uuid` por id. Um `ChatText` por bloco
      // seria a mudança "natural" e é armadilha: com o `#upsert`, dois blocos de texto na mesma
      // mensagem dariam dois ids iguais e o segundo apagaria o primeiro. O id da ferramenta é o
      // `block.id`, que é sempre único — por isso só ela pode ser uma entrada por bloco.
      const text = assistantText(message.message)
      if (text) this.#upsert({ id: message.uuid, role: 'assistant', text })

      for (const use of toolUses(message.message, message.parent_tool_use_id)) this.#upsert(use)
      return
    }

    if (message.type === 'user') {
      // Só os blocos `tool_result`. A `user` também carrega texto — o eco do prompt de um subagente
      // chega assim —, e lê-lo viraria balão de uma fala que ninguém disse na conversa.
      for (const { id, status } of toolResults(message.message)) this.#patchTool(id, { status })
      return
    }

    if (message.type === 'result') {
      const interrupted = this.#stopping
      this.#stopping = false

      // A nota só existe quando a parada de fato cortou o turno. Um `result` de sucesso chegando
      // junto do pedido é um turno que terminou sozinho no mesmo instante — anunciar interrupção
      // ali seria contar na conversa uma coisa que não aconteceu.
      if (interrupted && message.subtype !== 'success') {
        this.#stopCount += 1
        this.#upsert({
          id: `${this.id}-i${this.#stopCount}`,
          role: 'notice',
          text: INTERRUPTED_NOTICE,
        })
      }

      // A nota é gravada **antes** do `#apply`: a tela recebe a mensagem e só depois o estado, na
      // mesma ordem em que o texto do assistente chega antes do `result` que fecha o turno.
      this.#apply({ kind: 'result', outcome: message, interrupted })
      this.#abortRunning()
    }
  }

  /**
   * O único canal, dois tratamentos. O SDK entrega permissão e pergunta pelo mesmo `canUseTool`,
   * e é aqui que eles se separam — uma permissão tem duas saídas fixas, uma pergunta tem N.
   *
   * Payload que não dá para desenhar cai de volta na permissão em vez de quebrar a sessão: um
   * `AskUserQuestion` ilegível ainda pode ser negado, e negar é muito melhor do que travar o turno.
   */
  #requestDecision(
    toolName: string,
    input: unknown,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> {
    if (toolName === ASK_USER_QUESTION) {
      const raw: unknown = asRecord(input)?.['questions']
      const questions = readQuestions(raw)
      if (questions) return this.#requestAnswer(questions, raw, options)
    }

    return this.#requestPermission(toolName, options)
  }

  #requestAnswer(
    questions: readonly Question[],
    raw: unknown,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> {
    const request: QuestionRequest = { id: options.toolUseID, questions }

    return new Promise<PermissionResult>((resolve) => {
      this.#pendingQuestions.set(request.id, { resolve, questions: raw })
      this.#apply({ kind: 'question_requested', request })
    })
  }

  #requestPermission(
    toolName: string,
    options: Parameters<CanUseTool>[2],
  ): Promise<PermissionResult> {
    const request: PermissionRequest = {
      id: options.toolUseID,
      toolName,
      title: options.title,
      displayName: options.displayName,
      description: options.description,
    }

    return new Promise<PermissionResult>((resolve) => {
      this.#pending.set(request.id, resolve)
      this.#apply({ kind: 'permission_requested', request })
    })
  }

  /**
   * Nega tudo que estava esperando uma pessoa — os dois mapas. Pergunta em aberto trava o turno
   * exatamente como permissão em aberto, e um `close()` que esquecesse dela esperaria para sempre.
   */
  #denyPending(): void {
    const waiting = [
      ...this.#pending.values(),
      ...[...this.#pendingQuestions.values()].map((pending) => pending.resolve),
    ]
    this.#pending.clear()
    this.#pendingQuestions.clear()
    for (const resolve of waiting) resolve({ behavior: 'deny', message: SESSION_CLOSED_DENIAL })
  }

  /**
   * Grava uma mensagem, ou **substitui no lugar** a de mesmo id, preservando a posição no array.
   *
   * Um canal só nos dois casos, e o consumidor casa por `id`: um canal separado de "atualização"
   * obrigaria toda tela a implementar a mesma junção outra vez.
   */
  #upsert(message: ChatMessage): void {
    const at = this.#messages.findIndex((existing) => existing.id === message.id)
    if (at === -1) this.#messages.push(message)
    else this.#messages[at] = message

    this.#emitter.emit('message', message)
  }

  /**
   * Muda um campo de uma entrada de ferramenta já registrada.
   *
   * Id ausente ou sem entrada correspondente é **no-op**, e não uma entrada órfã: sem o `tool_use`
   * ela não teria nome nem detalhe, e uma linha "algo terminou" não informa nada.
   */
  #patchTool(
    id: string | undefined,
    patch: Partial<Pick<ChatToolUse, 'headline' | 'status'>>,
  ): void {
    if (id === undefined) return

    const entry = this.#messages.find((message) => message.id === id)
    if (entry?.role !== 'tool') return

    this.#upsert({ ...entry, ...patch })
  }

  /**
   * O fecho do turno: o que não relatou não está mais rodando.
   *
   * Vale para o turno cortado pelo `stop()` e para qualquer caminho em que o `tool_result` não
   * chegue. Sem isto, uma entrada presa em `running` afirmaria trabalho vivo sobre uma ferramenta
   * morta — e desligaria para sempre o "nada está rodando" de que a marca de silêncio depende.
   */
  #abortRunning(): void {
    // Sobre uma cópia: o `#upsert` escreve no array enquanto ele é percorrido.
    for (const message of [...this.#messages]) {
      if (message.role === 'tool' && message.status === 'running') {
        this.#upsert({ ...message, status: 'aborted' })
      }
    }
  }

  #apply(event: SessionEvent): void {
    const next = nextState(this.#state, event)
    // A máquina devolve o próprio estado quando o evento não muda nada — não há o que anunciar.
    if (next === this.#state) return

    this.#state = next
    this.#emitter.emit('state', next)
  }
}

/**
 * O texto de uma mensagem de assistente, achatado.
 *
 * A carga é lida como `unknown` de propósito: o tipo do SDK para ela vem de um pacote que é só peer
 * dependency (`@anthropic-ai/sdk`) e por isso não se resolve aqui — sem a leitura defensiva, o que
 * atravessaria o core seria um `any`.
 */
function assistantText(payload: unknown): string {
  const message = asRecord(payload)
  if (!message) return ''

  const texts: string[] = []
  for (const raw of asArray(message['content'])) {
    const block = asRecord(raw)
    if (block?.['type'] !== 'text') continue

    const text = asString(block['text'])
    if (text !== null) texts.push(text)
  }

  return texts.join('\n')
}

/**
 * As ferramentas que uma mensagem de assistente chamou, na ordem em que aparecem no `content`.
 *
 * Mesma leitura defensiva do `assistantText`, e pelo mesmo motivo: a carga vem do modelo, não do
 * nosso código. Bloco que não dá para ler é ignorado, e nunca derruba a sessão.
 */
function toolUses(payload: unknown, parentId: string | null): ChatToolUse[] {
  const message = asRecord(payload)
  if (!message) return []

  const uses: ChatToolUse[] = []
  for (const raw of asArray(message['content'])) {
    const block = asRecord(raw)
    if (block?.['type'] !== 'tool_use') continue

    const id = asString(block['id'])
    const name = asString(block['name'])
    // Sem id o `tool_result` não teria a que casar; sem nome a entrada não diria nada. Faltando
    // qualquer um dos dois, a entrada não informa — e inventá-los informaria errado.
    if (id === null || name === null) continue

    uses.push({
      id,
      role: 'tool',
      name,
      detail: detailOf(block['input']),
      headline: '',
      parentId,
      status: 'running',
    })
  }

  return uses
}

/** O que uma ferramenta relatou: o id da chamada e o degrau em que ela parou. */
interface ToolOutcome {
  id: string
  status: ToolStatus
}

/** Os resultados de ferramenta de uma mensagem `user`, casados pelo `tool_use_id`. */
function toolResults(payload: unknown): ToolOutcome[] {
  const message = asRecord(payload)
  if (!message) return []

  const outcomes: ToolOutcome[] = []
  for (const raw of asArray(message['content'])) {
    const block = asRecord(raw)
    if (block?.['type'] !== 'tool_result') continue

    const id = asString(block['tool_use_id'])
    if (id === null) continue

    // A ausência é sucesso: no sucesso o SDK **não manda** `is_error`, em vez de mandá-lo `false`.
    outcomes.push({ id, status: block['is_error'] === true ? 'error' : 'done' })
  }

  return outcomes
}

/**
 * O argumento que identifica uma chamada: o primeiro campo de `DETAIL_FIELDS` que exista e seja
 * string, achatado numa linha só e cortado em `DETAIL_MAX`. Nenhum casa → `''`, e a entrada mostra
 * só o nome — é o que acontece com o `AskUserQuestion`, cuja pergunta o prompt logo abaixo já diz.
 */
function detailOf(input: unknown): string {
  const record = asRecord(input)
  if (!record) return ''

  for (const field of DETAIL_FIELDS) {
    const value = asString(record[field])
    if (value === null) continue

    // Um passe só resolve as duas coisas: quebra de linha e espaço repetido viram um espaço.
    const flat = value.replace(/\s+/g, ' ').trim()
    return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX)}…` : flat
  }

  return ''
}

/**
 * As perguntas de um `AskUserQuestion`, ou `null` quando o payload não dá para desenhar.
 *
 * O `input` do `canUseTool` é dado de fora — vem do modelo, não do nosso código —, então passa
 * pelas mesmas guardas que a resposta do GraphQL. A linha entre exigir e tolerar é o uso do campo:
 * o que **compõe a resposta** que volta ao modelo (a chave `question` e o `label` escolhido) tem de
 * estar lá, porque adivinhá-lo seria responder outra coisa; o que só **decora a tela** (`header`,
 * `description`) falta em silêncio, e `multiSelect` ausente vale pelo caso conservador.
 */
function readQuestions(raw: unknown): readonly Question[] | null {
  const nodes = asArray(raw)
  if (nodes.length === 0) return null

  const questions: Question[] = []
  for (const node of nodes) {
    const record = asRecord(node)
    const question = asString(record?.['question'])
    const options = readOptions(record?.['options'])
    if (question === null || options === null) return null

    questions.push({
      question,
      header: asString(record?.['header']) ?? '',
      multiSelect: record?.['multiSelect'] === true,
      options,
    })
  }

  return questions
}

function readOptions(raw: unknown): readonly QuestionOption[] | null {
  const nodes = asArray(raw)
  if (nodes.length === 0) return null

  const options: QuestionOption[] = []
  for (const node of nodes) {
    const record = asRecord(node)
    const label = asString(record?.['label'])
    if (label === null) return null

    options.push({ label, description: asString(record?.['description']) ?? '' })
  }

  return options
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'erro desconhecido no processo da sessão'
}
