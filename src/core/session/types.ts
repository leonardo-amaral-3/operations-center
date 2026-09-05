/**
 * Os tipos que atravessam o `core`. Nenhum deles carrega estrutura do SDK: o que sai daqui vai
 * acabar cruzando a ponte IPC até o renderer, e o renderer não conhece o `@anthropic-ai/claude-agent-sdk`.
 */

/** Uma mensagem já pronta para a tela. O `id` vem do `uuid` da mensagem do SDK. */
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
