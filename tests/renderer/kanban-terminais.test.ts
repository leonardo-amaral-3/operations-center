import { describe, expect, it } from 'vitest'

import { reduceTerminals } from '../../src/renderer/screens/KanbanScreen'
import type { ClaudeStateEvent, TerminalState } from '../../src/shared/claude'

/**
 * O redutor de terminais do board (#97, R3.1): o que o cartão **fechado** enxerga do processo vivo
 * atrás dele. Só o escopo `card` entra; `closed` tira a chave; o mesmo estado é a mesma referência.
 */

function evento(scope: ClaudeStateEvent['scope'], state: TerminalState): ClaudeStateEvent {
  return { scope, id: 'pty_1', state, dangerous: false }
}

const CARD = { kind: 'card', itemId: 'PVTI_1' } as const

describe('#97 — reduceTerminals', () => {
  it('evento de card grava o estado na chave do cartão', () => {
    expect(reduceTerminals({}, evento(CARD, { kind: 'working' }))).toEqual({
      PVTI_1: { kind: 'working' },
    })
  })

  it('evento de sessão livre é ignorado: devolve o mesmo objeto', () => {
    const antes = {}

    expect(reduceTerminals(antes, evento({ kind: 'free', id: 'free_1' }, { kind: 'working' }))).toBe(
      antes,
    )
  })

  it('o mesmo estado devolve o mesmo objeto', () => {
    const antes = { PVTI_1: { kind: 'awaiting_input' } } as const

    expect(reduceTerminals(antes, evento(CARD, { kind: 'awaiting_input' }))).toBe(antes)
  })

  it('estado novo troca só a chave do cartão', () => {
    const antes = { PVTI_1: { kind: 'working' }, PVTI_2: { kind: 'working' } } as const

    expect(reduceTerminals(antes, evento(CARD, { kind: 'awaiting_input' }))).toEqual({
      PVTI_1: { kind: 'awaiting_input' },
      PVTI_2: { kind: 'working' },
    })
  })

  it('`closed` remove a chave, e `closed` de cartão sem chave devolve o mesmo objeto', () => {
    const antes = { PVTI_1: { kind: 'working' }, PVTI_2: { kind: 'working' } } as const

    expect(reduceTerminals(antes, evento(CARD, { kind: 'closed' }))).toEqual({
      PVTI_2: { kind: 'working' },
    })

    const vazio = {}
    expect(reduceTerminals(vazio, evento(CARD, { kind: 'closed' }))).toBe(vazio)
  })
})
