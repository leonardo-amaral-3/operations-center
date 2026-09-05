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
  role: 'user' | 'assistant'
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
 * O estado exibido da sessão. `awaiting_input` e `awaiting_decision` são os dois que o kanban
 * futuro vai pintar como "esperando você" — nomeá-los agora é o que faz esse sinal ser depois um
 * problema de CSS e não de arquitetura.
 *
 * O *formato* do estado é contrato e mora aqui; as *transições* são regra do `core` e moram em
 * `src/core/session/state.ts`.
 */
export type SessionState =
  | { kind: 'starting' }
  | { kind: 'working' }
  | { kind: 'awaiting_input' }
  | { kind: 'awaiting_decision'; request: PermissionRequest }
  | { kind: 'closed' }
  | { kind: 'failed'; reason: string }
