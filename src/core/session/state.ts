import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionRequest } from './types'

/**
 * O estado exibido da sessão. `awaiting_input` e `awaiting_decision` são os dois que o kanban
 * futuro vai pintar como "esperando você" — nomeá-los agora é o que faz esse sinal ser depois um
 * problema de CSS e não de arquitetura.
 */
export type SessionState =
  | { kind: 'starting' }
  | { kind: 'working' }
  | { kind: 'awaiting_input' }
  | { kind: 'awaiting_decision'; request: PermissionRequest }
  | { kind: 'closed' }
  | { kind: 'failed'; reason: string }

/**
 * Só o que um `result` do SDK decide de estado. O resto do `SDKResultMessage` (custo, uso,
 * durações) não entra na máquina, e pedi-lo inteiro só encheria os testes de campo irrelevante.
 */
export type ResultOutcome = Pick<SDKResultMessage, 'subtype' | 'queued_turn_count'>

/** O que acontece com a sessão. O `SessionHandle` traduz o fluxo do SDK nestes eventos. */
export type SessionEvent =
  | { kind: 'init' }
  | { kind: 'result'; outcome: ResultOutcome }
  | { kind: 'permission_requested'; request: PermissionRequest }
  | { kind: 'permission_resolved' }
  | { kind: 'closed' }

/** A sessão nasce processando: o primeiro turno já está a caminho antes do `init` chegar. */
export const initialState: SessionState = { kind: 'starting' }

/**
 * A transição. Pura: mesmo estado e mesmo evento dão sempre o mesmo resultado, e nada acontece
 * fora do valor devolvido. Devolve o próprio `current` quando o evento não muda nada, para o
 * `SessionHandle` poder emitir só o que mudou.
 */
export function nextState(current: SessionState, event: SessionEvent): SessionState {
  // `closed` e `failed` são terminais. Nada que chegue depois ressuscita a sessão, e deixar um
  // `result` atrasado sobrescrever um `failed` apagaria da tela o motivo da falha.
  if (current.kind === 'closed' || current.kind === 'failed') return current

  switch (event.kind) {
    case 'init':
      return { kind: 'working' }
    case 'permission_requested':
      return { kind: 'awaiting_decision', request: event.request }
    case 'permission_resolved':
      return { kind: 'working' }
    case 'result':
      return afterResult(event.outcome)
    case 'closed':
      return { kind: 'closed' }
  }
}

function afterResult(outcome: ResultOutcome): SessionState {
  // `queued_turn_count > 0` significa que ao menos mais um turno do usuário já está na fila e vai
  // rodar sem nova digitação — este `result` não é o fim da vez dele.
  //
  // O campo é opcional no SDK (ausente em result de falha na partida e em superfícies sem fila de
  // comandos). Ausente vale como zero: é o que a doc do campo diz de `0` ("none is pending"), e a
  // alternativa — não reconhecer o fim do turno — deixaria a tela em `working` para sempre, que é
  // exatamente o sinal que o produto existe para dar certo.
  const queued = outcome.queued_turn_count ?? 0
  if (queued > 0) return { kind: 'working' }

  // Fila vazia: o turno acabou. Sucesso devolve a vez ao usuário; qualquer outro subtype é falha,
  // e o próprio subtype é o motivo exibível.
  return outcome.subtype === 'success'
    ? { kind: 'awaiting_input' }
    : { kind: 'failed', reason: outcome.subtype }
}
