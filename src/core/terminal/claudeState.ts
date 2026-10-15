/**
 * O estado do terminal Claude (#97), derivado dos hooks que o app injeta por `--settings`.
 * Função pura: o main alimenta com cada sinal e publica o que sair.
 */

import type { TerminalState } from '../../shared/claude'

export type HookEvent =
  | { name: 'UserPromptSubmit'; sessionId: string; transcriptPath: string }
  | { name: 'PreToolUse' | 'PostToolUse'; sessionId: string }
  | { name: 'PermissionRequest'; sessionId: string; toolName: string }
  | { name: 'Stop'; sessionId: string }
  | { name: 'SessionEnd'; sessionId: string }

export type ClaudeSignal = HookEvent | { name: 'interrupted' } | { name: 'output' } | { name: 'exit' }

export interface Transition {
  state: TerminalState
  turnEnded: boolean
}

const INTERRUPTIBLE: ReadonlySet<TerminalState['kind']> = new Set([
  'working',
  'awaiting_decision',
  'awaiting_answer',
])

/** O próximo estado. `closed` é terminal: nenhum sinal o tira de lá. */
export function nextTerminalState(current: TerminalState, signal: ClaudeSignal): Transition {
  const stay: Transition = { state: current, turnEnded: false }
  if (current.kind === 'closed') return stay
  switch (signal.name) {
    case 'output':
      return current.kind === 'starting'
        ? { state: { kind: 'awaiting_input' }, turnEnded: false }
        : stay
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      return { state: { kind: 'working' }, turnEnded: false }
    case 'PermissionRequest':
      return {
        state: {
          kind: signal.toolName === 'AskUserQuestion' ? 'awaiting_answer' : 'awaiting_decision',
        },
        turnEnded: false,
      }
    case 'Stop':
      return { state: { kind: 'awaiting_input' }, turnEnded: true }
    case 'interrupted':
      return INTERRUPTIBLE.has(current.kind)
        ? { state: { kind: 'awaiting_input' }, turnEnded: true }
        : stay
    case 'SessionEnd':
      return stay
    case 'exit':
      return { state: { kind: 'closed' }, turnEnded: false }
  }
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** O corpo que o hook HTTP posta, validado. `null` quando não é um evento que o app assina. */
export function parseHookBody(body: unknown): HookEvent | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = body as Record<string, unknown>
  const sessionId = text(raw.session_id)
  // O `session_id` vai para `conversations.json`: só entra o que tem forma de UUID.
  if (sessionId === null || !SESSION_ID.test(sessionId)) return null
  switch (raw.hook_event_name) {
    case 'UserPromptSubmit': {
      const transcriptPath = text(raw.transcript_path)
      return transcriptPath === null ? null : { name: 'UserPromptSubmit', sessionId, transcriptPath }
    }
    case 'PreToolUse':
    case 'PostToolUse':
      return { name: raw.hook_event_name, sessionId }
    case 'PermissionRequest':
      return { name: 'PermissionRequest', sessionId, toolName: text(raw.tool_name) ?? '' }
    case 'Stop':
    case 'SessionEnd':
      return { name: raw.hook_event_name, sessionId }
    default:
      return null
  }
}
