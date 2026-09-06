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
 * Uma mensagem já pronta para a tela. O `id` da mensagem de assistente vem do `uuid` do SDK; o da
 * mensagem do usuário é gerado pela sessão, porque ela a registra no envio e não no eco do SDK.
 */
export interface ChatMessage {
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
 */
export type SessionState =
  | { kind: 'starting' }
  | { kind: 'working' }
  | { kind: 'awaiting_input' }
  | { kind: 'awaiting_decision'; request: PermissionRequest }
  | { kind: 'awaiting_answer'; request: QuestionRequest }
  | { kind: 'closed' }
  | { kind: 'failed'; reason: string }
