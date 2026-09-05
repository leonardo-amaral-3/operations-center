import { describe, expect, it } from 'vitest'

import { initialState, nextState } from '../../src/core/session/state'
import type { SessionState } from '../../src/core/session/state'
import type { PermissionRequest } from '../../src/core/session/types'

const pedido: PermissionRequest = {
  id: 'toolu_01',
  toolName: 'Write',
  title: 'Claude wants to write smoke.txt',
  displayName: 'Write file',
}

/** Atalho: aplica os eventos em sequência a partir do estado inicial. */
function apply(...events: Parameters<typeof nextState>[1][]): SessionState {
  return events.reduce<SessionState>(nextState, initialState)
}

describe('máquina de estados da sessão', () => {
  it('começa em starting', () => {
    expect(initialState).toEqual({ kind: 'starting' })
  })

  it('o init põe a sessão a trabalhar', () => {
    expect(apply({ kind: 'init' })).toEqual({ kind: 'working' })
  })

  it('result de sucesso com a fila vazia devolve a vez ao usuário', () => {
    const state = apply(
      { kind: 'init' },
      { kind: 'result', outcome: { subtype: 'success', queued_turn_count: 0 } },
    )

    expect(state).toEqual({ kind: 'awaiting_input' })
  })

  it('result de sucesso sem queued_turn_count também devolve a vez ao usuário', () => {
    const state = apply({ kind: 'init' }, { kind: 'result', outcome: { subtype: 'success' } })

    expect(state).toEqual({ kind: 'awaiting_input' })
  })

  it('result com turnos ainda na fila mantém a sessão trabalhando', () => {
    const state = apply(
      { kind: 'init' },
      { kind: 'result', outcome: { subtype: 'success', queued_turn_count: 2 } },
    )

    expect(state).toEqual({ kind: 'working' })
  })

  it('um pedido de permissão espera decisão, e a resposta volta a trabalhar', () => {
    const esperando = apply({ kind: 'init' }, { kind: 'permission_requested', request: pedido })
    expect(esperando).toEqual({ kind: 'awaiting_decision', request: pedido })

    expect(nextState(esperando, { kind: 'permission_resolved' })).toEqual({ kind: 'working' })
  })

  it('result que não é de sucesso falha a sessão, carregando o subtype como motivo', () => {
    const state = apply(
      { kind: 'init' },
      { kind: 'result', outcome: { subtype: 'error_max_turns', queued_turn_count: 0 } },
    )

    expect(state).toEqual({ kind: 'failed', reason: 'error_max_turns' })
  })

  it('a iteração terminada fecha a sessão', () => {
    expect(apply({ kind: 'init' }, { kind: 'closed' })).toEqual({ kind: 'closed' })
  })

  it('depois de falhar, um result atrasado não apaga o motivo da falha', () => {
    const falhou = apply(
      { kind: 'init' },
      { kind: 'result', outcome: { subtype: 'error_during_execution' } },
    )

    const depois = nextState(falhou, {
      kind: 'result',
      outcome: { subtype: 'success', queued_turn_count: 0 },
    })

    expect(depois).toEqual({ kind: 'failed', reason: 'error_during_execution' })
  })

  it('depois de fechada, nada ressuscita a sessão', () => {
    const fechada = apply({ kind: 'init' }, { kind: 'closed' })

    expect(nextState(fechada, { kind: 'init' })).toEqual({ kind: 'closed' })
    expect(nextState(fechada, { kind: 'permission_requested', request: pedido })).toEqual({
      kind: 'closed',
    })
  })
})
