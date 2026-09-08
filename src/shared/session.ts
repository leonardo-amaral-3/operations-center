/**
 * O vocabulário que atravessa a ponte IPC.
 *
 * Ele mora em `src/shared/` — e não dentro do `core` — porque é o único jeito de o renderer
 * compilar contra os mesmos tipos que o main. Puxar o `core` para o programa do renderer traria
 * junto o `@anthropic-ai/claude-agent-sdk` e o `node:crypto`, que é exatamente o que
 * `contextIsolation` e `sandbox` existem para manter longe da tela.
 *
 * Por isso este arquivo **não importa nada**, e precisa continuar assim: nem `electron`, nem o SDK,
 * nem o `core`. É uma folha da árvore de dependências, e o ESLint impõe isso.
 *
 * O `core` consome estes tipos e os republica em `src/core/index.ts`, de modo que quem fala com o
 * host continua vendo uma superfície só.
 */

/**
 * Uma fala. O `id` da mensagem de assistente vem do `uuid` do SDK; o da mensagem do usuário é
 * gerado pela sessão, porque ela a registra no envio e não no eco do SDK.
 */
export interface ChatText {
  id: string
  /**
   * `notice` é o **app falando sobre a sessão**, e não alguém falando na conversa: a nota de turno
   * interrompido é a primeira dessas, e ela não foi ao modelo.
   *
   * Papel próprio, e não uma mensagem de usuário com texto marcador (que é o que o Claude Code
   * grava no transcript dele): uma bolha "você" que o usuário não digitou faz a tela mentir sobre
   * quem disse o quê, e o histórico da conversa é a coisa que este app existe para preservar.
   */
  role: 'user' | 'assistant' | 'notice'
  text: string
}

/**
 * Em que pé está uma ação. `running` é sempre o primeiro degrau; os outros três são terminais.
 *
 * `aborted` existe porque nem toda chamada devolve resultado: um turno cortado pode deixar a
 * ferramenta sem `tool_result` nenhum. Sem este valor a entrada ficaria `running` para sempre — a
 * tela afirmaria trabalho vivo sobre uma ferramenta morta, e pior, a marca de silêncio pararia de
 * funcionar em **todos** os turnos seguintes, porque "há algo rodando" nunca mais seria falso.
 * `error` seria mentira: ela não falhou, ela não chegou a relatar.
 */
export type ToolStatus = 'running' | 'done' | 'error' | 'aborted'

/**
 * Uma ferramenta que a sessão usou. É **um fato só que muda de status**, e não dois eventos: por
 * isso o `id` é o `tool_use_id` do bloco — a mesma chave que o `tool_result` referencia.
 */
export interface ChatToolUse {
  id: string
  role: 'tool'
  /** O nome cru: `Bash`, `Read`, `Agent`. Único campo garantido. */
  name: string
  /**
   * O argumento que identifica a chamada, já achatado e truncado **no core**. Truncar aqui e não na
   * tela não é estética: sem isso um `Write` de 300 linhas atravessa a ponte inteiro para caber
   * numa linha de 120 caracteres.
   */
  detail: string
  /**
   * A frase que o próprio Claude Code escreveu para esta chamada (`task_started`/`task_progress`),
   * ou `''` quando ele não mandou nenhuma. Mesmo padrão do `PermissionRequest`: usar a frase pronta
   * quando ela vem, em vez de remontá-la pior.
   */
  headline: string
  /** `tool_use_id` do `Agent` que gerou esta chamada, ou `null` no nível de cima. */
  parentId: string | null
  status: ToolStatus
}

/**
 * Uma mensagem já pronta para a tela — uma fala ou uma ação.
 *
 * União discriminada, e não um registro com campos opcionais: é o compilador que aponta cada tela
 * que precisa tratar o caso novo, e são poucas.
 */
export type ChatMessage = ChatText | ChatToolUse

/**
 * O pulso do turno corrente. **Não entra no histórico**: é o spinner, e morre com o turno.
 *
 * Os dois carimbos são epoch ms e vêm do main, não do core — mesmo arranjo do `readAt` do board.
 */
export interface TurnActivity {
  /** Quando o turno corrente começou, ou `null` quando não há turno em curso. */
  startedAt: number | null
  /** Último sinal recebido do SDK nesta sessão, ou `null` antes do primeiro. */
  lastSignalAt: number | null
  /** Tokens de raciocínio acumulados no turno corrente. Zera quando um turno começa. */
  thinkingTokens: number
}

/** O pulso de uma sessão que não está em turno nenhum. */
export const IDLE_ACTIVITY: TurnActivity = {
  startedAt: null,
  lastSignalAt: null,
  thinkingTokens: 0,
}

/**
 * Um pedido de permissão esperando decisão humana — o que o `canUseTool` do SDK entrega,
 * reduzido ao que a tela precisa mostrar.
 *
 * `title` e `description` são as frases que o próprio Claude Code monta ("Claude wants to read
 * foo.txt"); quando vierem, são o texto a exibir, em vez de remontar a frase a partir do
 * `toolName`. Ambos são opcionais no SDK, e por isso `toolName` é o único fallback garantido.
 */
export interface PermissionRequest {
  id: string
  toolName: string
  title?: string
  displayName?: string
  description?: string
}

export type PermissionDecision = 'allow' | 'deny'

/** Uma alternativa que o Claude ofereceu numa pergunta. */
export interface QuestionOption {
  label: string
  description: string
}

/**
 * Uma pergunta do `AskUserQuestion`, reduzida ao que a tela precisa desenhar.
 *
 * `multiSelect` muda o formato da resposta, e não só a interação: com ele ligado, os rótulos
 * escolhidos vão numa string separada por vírgula, que é o formato que o próprio SDK documenta
 * para o `answers` da ferramenta.
 */
export interface Question {
  question: string
  header: string
  multiSelect: boolean
  options: readonly QuestionOption[]
}

/** Um `AskUserQuestion` esperando resposta humana. `id` é o `toolUseID`, como no PermissionRequest. */
export interface QuestionRequest {
  id: string
  questions: readonly Question[]
}

/**
 * Resposta por pergunta: o texto da pergunta → o rótulo escolhido (ou o texto livre).
 *
 * A chave é o texto da pergunta porque é assim que a ferramenta casa resposta com pergunta, e o
 * valor é sempre uma string já pronta — em multi-seleção, os rótulos vêm juntos por vírgula.
 */
export type QuestionAnswers = Record<string, string>

/**
 * O que a sessão informa de si quando nasce, lido do `system`/`init` do SDK.
 *
 * `apiKeySource` é `string` de propósito: o SDK tipa como união, mas este dado atravessa o IPC
 * até o renderer, que não deve importar tipo nenhum do SDK. O valor importa por uma asserção só —
 * ser diferente de `ANTHROPIC_API_KEY` prova que a sessão subiu no login local do Claude Code.
 */
export interface SessionInit {
  sessionId: string
  model: string
  cwd: string
  apiKeySource: string
  /**
   * O modo de permissão que o **SDK** reporta — `'default'`, `'bypassPermissions'`, e o que mais
   * ele vier a ter. `string` pela mesma razão do `apiKeySource`, logo acima.
   *
   * É a segunda fonte sobre o portão, e não a primeira: ele chega num `init` novo a cada turno,
   * então entre ligar o modo e mandar o próximo prompt o valor em mãos ainda é o do nascimento.
   * O sinal humano — imediato — é o crachá, que vem da marca do cartão; este aqui é âncora de
   * máquina, legível depois de um turno ter rodado no modo novo.
   */
  permissionMode: string
}

/**
 * O estado exibido da sessão. `awaiting_input`, `awaiting_decision` e `awaiting_answer` são os três
 * que o kanban futuro vai pintar como "esperando você" — nomeá-los agora é o que faz esse sinal
 * ser depois um problema de CSS e não de arquitetura.
 *
 * `awaiting_answer` é estado próprio, e não um `awaiting_decision` com um campo a mais: uma
 * permissão tem duas saídas fixas, uma pergunta tem N opções, texto livre e possivelmente
 * multi-seleção. Colapsá-los obrigaria toda tela a inspecionar o conteúdo do pedido para saber o
 * que desenhar.
 *
 * O *formato* do estado é contrato e mora aqui; as *transições* são regra do `core` e moram em
 * `src/core/session/state.ts`.
 *
 * Nos dois estados que esperam uma pessoa, `request` é sempre **a frente da fila** de pedidos, e
 * `queued` é quantos outros esperam **atrás dele** — `0` quando o da tela é o único. Não é o total:
 * o número que a pessoa precisa ler é "quanto ainda vem depois de eu resolver este".
 *
 * A fila inteira **não** atravessa a ponte, de propósito: a tela desenha um pedido por vez, e
 * mandar a lista seria mandar dado que ninguém desenha.
 */
export type SessionState =
  | { kind: 'starting' }
  | { kind: 'working' }
  | { kind: 'awaiting_input' }
  | { kind: 'awaiting_decision'; request: PermissionRequest; queued: number }
  | { kind: 'awaiting_answer'; request: QuestionRequest; queued: number }
  | { kind: 'closed' }
  | { kind: 'failed'; reason: string }
