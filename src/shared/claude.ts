/**
 * O contrato do terminal Claude (#97), num módulo que **os dois lados importam**. Os canais moram em
 * `ipc.ts`; aqui ficam só os tipos de dado.
 */

import type { SessionScope } from './ipc'

/** Os escopos que abrem terminal Claude. A triagem fica no SDK. */
export type ClaudeScope = Extract<SessionScope, { kind: 'card' } | { kind: 'free' }>

/** O estado que o board enxerga, derivado dos hooks. Sem `failed`: o processo que morre vira `closed`. */
export type TerminalState = {
  kind:
    | 'starting'
    | 'working'
    | 'awaiting_input'
    | 'awaiting_decision'
    | 'awaiting_answer'
    | 'closed'
}

export interface OpenClaudeRequest {
  scope: ClaudeScope
  cols: number
  rows: number
}

export type OpenClaudeResult =
  /** `dangerous` = o modo em que o processo vivo NASCEU (não a marca atual). `spawned` = esta chamada criou o processo. */
  | { ok: true; id: string; state: TerminalState; dangerous: boolean; spawned: boolean }
  /** `session-busy`: a conversa lembrada deste escopo já está aberta num terminal vivo de outro escopo. */
  | { ok: false; reason: 'unknown-folder' | 'session-busy' }
  /** `detail` é texto de erro para a tela, como o de `shell-missing`/`pty-unavailable` do `terminal:open`. */
  | { ok: false; reason: 'claude-missing' | 'pty-unavailable'; detail: string }

export interface CloseClaudeRequest {
  scope: ClaudeScope
}

export interface ClaudeStateEvent {
  scope: ClaudeScope
  id: string
  state: TerminalState
  dangerous: boolean
}
