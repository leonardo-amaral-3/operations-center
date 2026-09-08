/**
 * Os tipos que atravessam o `core`. Nenhum deles carrega estrutura do SDK: o que sai daqui vai
 * acabar cruzando a ponte IPC até o renderer, e o renderer não conhece o
 * `@anthropic-ai/claude-agent-sdk`.
 *
 * É justamente por atravessarem a ponte que eles são **declarados em `src/shared/session.ts`** e
 * apenas republicados aqui: o renderer precisa compilar contra a mesma declaração, e não pode
 * importar o `core` para isso. Este módulo mantém a superfície do `core` intacta para quem já a
 * consome.
 */

export type {
  ChatMessage,
  ChatText,
  ChatToolUse,
  DiffHunk,
  DiffLine,
  FileDiff,
  PermissionDecision,
  PermissionRequest,
  Question,
  QuestionAnswers,
  QuestionOption,
  QuestionRequest,
  SessionInit,
  SessionState,
  ToolStatus,
  TurnActivity,
} from '../../shared/session'
