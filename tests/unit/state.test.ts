import { describe, expect, it } from 'vitest'

import { initialState, nextState } from '../../src/core/session/state'
import type { SessionState } from '../../src/core/session/state'
import type { PermissionRequest, QuestionRequest } from '../../src/core/session/types'

const pedido: PermissionRequest = {
  id: 'toolu_01',
  toolName: 'Write',
  title: 'Claude wants to write smoke.txt',
  displayName: 'Write file',
}

const pergunta: QuestionRequest = {
  id: 'toolu_09',
  questions: [
    {
      question: 'Qual cor?',
      header: 'Cor',
      multiSelect: false,
      options: [
        { label: 'Azul', description: 'o céu' },
        { label: 'Verde', description: 'o mato' },
      ],
    },
  ],
}

const outroPedido: PermissionRequest = {
  id: 'toolu_02',
  toolName: 'Read',
  title: 'Claude wants to read smoke.txt',
  displayName: 'Read file',
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

  it('awaiting com uma permissão vira awaiting_decision, carregando o contador', () => {
    const esperando = apply(
      { kind: 'init' },
      { kind: 'awaiting', pending: { kind: 'permission', request: pedido }, queued: 2 },
    )

    expect(esperando).toEqual({ kind: 'awaiting_decision', request: pedido, queued: 2 })
  })

  it('awaiting com uma pergunta vira awaiting_answer, carregando o contador', () => {
    const esperando = apply(
      { kind: 'init' },
      { kind: 'awaiting', pending: { kind: 'question', request: pergunta }, queued: 1 },
    )

    expect(esperando).toEqual({ kind: 'awaiting_answer', request: pergunta, queued: 1 })
  })

  it('settled devolve a sessão ao trabalho', () => {
    const esperando = apply(
      { kind: 'init' },
      { kind: 'awaiting', pending: { kind: 'permission', request: pedido }, queued: 0 },
    )

    expect(nextState(esperando, { kind: 'settled' })).toEqual({ kind: 'working' })
  })

  it('a máquina desenha sempre a frente da fila que o handle publicar', () => {
    // Quem opera a fila é o `SessionHandle`; a máquina só projeta a frente que ele publicar. Dois
    // `awaiting` seguidos são "a frente mudou", e não "um pedido sobrescreveu o outro" — a premissa
    // do sobrescrever é justamente a que produziu o travamento do #11.
    const primeiro = apply(
      { kind: 'init' },
      { kind: 'awaiting', pending: { kind: 'permission', request: pedido }, queued: 1 },
    )
    expect(primeiro).toEqual({ kind: 'awaiting_decision', request: pedido, queued: 1 })

    const segundo = nextState(primeiro, {
      kind: 'awaiting',
      pending: { kind: 'permission', request: outroPedido },
      queued: 0,
    })

    expect(segundo).toEqual({ kind: 'awaiting_decision', request: outroPedido, queued: 0 })
  })

  it('result que não é de sucesso falha a sessão, carregando o subtype como motivo', () => {
    const state = apply(
      { kind: 'init' },
      { kind: 'result', outcome: { subtype: 'error_max_turns', queued_turn_count: 0 } },
    )

    expect(state).toEqual({ kind: 'failed', reason: 'error_max_turns' })
  })

  it('um turno parado por mim devolve a vez, em vez de matar a sessão', () => {
    // É assim que o SDK relata um turno abortado: result de erro. Sem a bandeira, este mesmo evento
    // cai na regra de cima e a sessão morre — o oposto exato do que parar significa.
    const state = apply(
      { kind: 'init' },
      {
        kind: 'result',
        outcome: { subtype: 'error_during_execution', queued_turn_count: 0 },
        interrupted: true,
      },
    )

    expect(state).toEqual({ kind: 'awaiting_input' })
  })

  it('parar sem cancelar a fila deixa os turnos enfileirados rodarem', () => {
    const state = apply(
      { kind: 'init' },
      {
        kind: 'result',
        outcome: { subtype: 'error_during_execution', queued_turn_count: 1 },
        interrupted: true,
      },
    )

    expect(state).toEqual({ kind: 'working' })
  })

  it('enviar põe a sessão a trabalhar quando a vez era do usuário', () => {
    const minhaVez = apply(
      { kind: 'init' },
      { kind: 'result', outcome: { subtype: 'success', queued_turn_count: 0 } },
    )
    expect(minhaVez).toEqual({ kind: 'awaiting_input' })

    expect(nextState(minhaVez, { kind: 'sent' })).toEqual({ kind: 'working' })
  })

  it('enviar não mexe em estado que espera uma pessoa, nem nos terminais', () => {
    // Digitar durante um pedido só enfileira o texto: o turno continua parado em quem tem de
    // decidir ou responder. E em `starting` quem anuncia o trabalho é o `init`.
    const casos: SessionState[] = [
      { kind: 'starting' },
      apply(
        { kind: 'init' },
        { kind: 'awaiting', pending: { kind: 'permission', request: pedido }, queued: 0 },
      ),
      apply(
        { kind: 'init' },
        { kind: 'awaiting', pending: { kind: 'question', request: pergunta }, queued: 0 },
      ),
      apply({ kind: 'init' }, { kind: 'closed' }),
      apply({ kind: 'init' }, { kind: 'failed', reason: 'claude não encontrado' }),
    ]

    // `toBe`, e não `toEqual`: o `#apply` do `SessionHandle` decide se anuncia comparando por
    // identidade (`next === this.#state`). Devolver uma cópia igual passaria por um `toEqual` e
    // faria a sessão emitir estado repetido a cada envio.
    for (const estado of casos) {
      expect(nextState(estado, { kind: 'sent' })).toBe(estado)
    }
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
    expect(
      nextState(fechada, {
        kind: 'awaiting',
        pending: { kind: 'permission', request: pedido },
        queued: 0,
      }),
    ).toEqual({ kind: 'closed' })
    expect(
      nextState(fechada, {
        kind: 'awaiting',
        pending: { kind: 'question', request: pergunta },
        queued: 0,
      }),
    ).toEqual({ kind: 'closed' })
  })

  it('depois de falhar, uma pergunta atrasada não apaga o motivo da falha', () => {
    const falhou = apply({ kind: 'init' }, { kind: 'failed', reason: 'claude não encontrado' })

    expect(
      nextState(falhou, {
        kind: 'awaiting',
        pending: { kind: 'question', request: pergunta },
        queued: 0,
      }),
    ).toEqual({ kind: 'failed', reason: 'claude não encontrado' })
  })
})
