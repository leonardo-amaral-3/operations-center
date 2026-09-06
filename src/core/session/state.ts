import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'

import type { PermissionRequest, QuestionRequest, SessionState } from './types'

// O formato do estado é contrato de ponte e mora em `src/shared/session.ts`; o que este módulo
// possui são as transições. Republicado aqui porque a máquina é o assunto de quem vem ler o tipo.
export type { SessionState } from './types'

/**
 * Só o que um `result` do SDK decide de estado. O resto do `SDKResultMessage` (custo, uso,
 * durações) não entra na máquina, e pedi-lo inteiro só encheria os testes de campo irrelevante.
 */
export type ResultOutcome = Pick<SDKResultMessage, 'subtype' | 'queued_turn_count'>

/** O que acontece com a sessão. O `SessionHandle` traduz o fluxo do SDK nestes eventos. */
export type SessionEvent =
  | { kind: 'init' }
  // O usuário falou. Opcional e ausente valendo `false` no `result`: os casos que falam de turnos
  // que ninguém parou não ganham nada em declarar `interrupted: false`, e o ruído esconderia os que
  // de fato tratam de parada.
  | { kind: 'sent' }
  | { kind: 'result'; outcome: ResultOutcome; interrupted?: boolean }
  | { kind: 'permission_requested'; request: PermissionRequest }
  | { kind: 'permission_resolved' }
  | { kind: 'question_requested'; request: QuestionRequest }
  | { kind: 'question_answered' }
  | { kind: 'failed'; reason: string }
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
    // O par da pergunta é simétrico ao da permissão, e por isso mesmo tem estado próprio: as duas
    // param a sessão esperando uma pessoa, mas o que a tela desenha é outra coisa.
    case 'question_requested':
      return { kind: 'awaiting_answer', request: event.request }
    case 'question_answered':
      return { kind: 'working' }
    // A iteração do `query()` também pode terminar por exceção — processo que não sobe, credencial
    // ausente — e nesse caminho não vem `result` nenhum. Sem este evento a sessão morreria como
    // `closed` e o motivo sumiria da tela, que é o mesmo silêncio que a regra do `result` de falha
    // existe para evitar.
    case 'failed':
      return { kind: 'failed', reason: event.reason }
    // Enviar é o que devolve a sessão ao trabalho — e **só** de `awaiting_input`. De
    // `awaiting_decision` ou `awaiting_answer` o que foi digitado entra na fila atrás de um pedido
    // que ninguém respondeu, e o turno continua parado numa pessoa; de `starting`, quem anuncia o
    // trabalho é o `init`. Devolver `current` nesses casos também é o que impede o `#apply` de
    // emitir estado repetido.
    case 'sent':
      return current.kind === 'awaiting_input' ? { kind: 'working' } : current
    case 'result':
      return afterResult(event.outcome, event.interrupted ?? false)
    case 'closed':
      return { kind: 'closed' }
  }
}

function afterResult(outcome: ResultOutcome, interrupted: boolean): SessionState {
  // `queued_turn_count > 0` significa que ao menos mais um turno do usuário já está na fila e vai
  // rodar sem nova digitação — este `result` não é o fim da vez dele.
  //
  // O campo é opcional no SDK (ausente em result de falha na partida e em superfícies sem fila de
  // comandos). Ausente vale como zero: é o que a doc do campo diz de `0` ("none is pending"), e a
  // alternativa — não reconhecer o fim do turno — deixaria a tela em `working` para sempre, que é
  // exatamente o sinal que o produto existe para dar certo.
  const queued = outcome.queued_turn_count ?? 0
  if (queued > 0) return { kind: 'working' }

  // Um turno cortado por `stop()` volta como result de erro — é assim que o SDK relata um turno
  // abortado. Chamar isso de `failed` mataria a sessão, que é o oposto do que parar significa: ela
  // não falhou, ela obedeceu. A regra da fila fica **antes** de propósito: interromper sem
  // `cancel_queued` (a única forma que o tipo público oferece) deixa os turnos já enfileirados
  // rodarem, e a sessão segue trabalhando neles.
  if (interrupted) return { kind: 'awaiting_input' }

  // Fila vazia: o turno acabou. Sucesso devolve a vez ao usuário; qualquer outro subtype é falha,
  // e o próprio subtype é o motivo exibível.
  return outcome.subtype === 'success'
    ? { kind: 'awaiting_input' }
    : { kind: 'failed', reason: outcome.subtype }
}
