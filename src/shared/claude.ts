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

/** Linhas de rolagem do terminal Claude: a do xterm da tela e a do espelho headless do main (#100). */
export const SCROLLBACK = 5000

export interface OpenClaudeRequest {
  scope: ClaudeScope
  cols: number
  rows: number
}

/** A tela serializada de um terminal adotado de outro dono: escrita num xterm de `cols`×`rows`, reproduz o buffer. */
export interface ClaudeSnapshot {
  data: string
  cols: number
  rows: number
}

/** Payload de `claude:released`: o terminal deste escopo passou a outro dono (#100). */
export interface ClaudeReleasedEvent {
  scope: ClaudeScope
}

export type OpenClaudeResult =
  /** `dangerous` = o modo em que o processo vivo NASCEU (não a marca atual). `spawned` = esta chamada criou o processo. `snapshot` só quando a chamada adotou um terminal de outro dono. */
  | {
      ok: true
      id: string
      state: TerminalState
      dangerous: boolean
      spawned: boolean
      snapshot?: ClaudeSnapshot
    }
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
