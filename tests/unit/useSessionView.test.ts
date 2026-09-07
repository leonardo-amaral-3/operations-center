import { describe, expect, it } from 'vitest'

import { INITIAL_VIEW, isSilent, reduce, SILENCIO_MS } from '../../src/renderer/session/sessionView'
import type { SessionAction, SessionView } from '../../src/renderer/session/sessionView'
import type { SessionSnapshot } from '../../src/shared/ipc'
import { IDLE_ACTIVITY } from '../../src/shared/session'
import type { ChatMessage, ChatToolUse, ToolStatus, TurnActivity } from '../../src/shared/session'

/**
 * A parte pura do `useSessionView`: o estado da sessão na tela e a regra que o move.
 *
 * O que se testa aqui é o que não dá para provar por smoke sem torcer o tempo — a corrida do
 * `held` (eventos anteriores ao retrato, drenados depois dele) e a marca de silêncio do CA-4, que
 * pede um relógio de 60s. Ambos são função pura de propósito, e é isso que os torna testáveis.
 */

/** Um instante qualquer, fixo: o que importa nas contas é a distância, nunca a data. */
const AGORA = 1_700_000_000_000

function apply(...actions: SessionAction[]): SessionView {
  return actions.reduce<SessionView>(reduce, INITIAL_VIEW)
}

function ferramenta(status: ToolStatus, id = 'toolu_01'): ChatToolUse {
  return {
    id,
    role: 'tool',
    name: 'Read',
    detail: 'package.json',
    headline: '',
    parentId: null,
    status,
  }
}

/** O pulso de um turno em curso cujo último sinal tem a idade pedida. */
function pulso(idadeDoSinal: number): TurnActivity {
  return {
    startedAt: AGORA - idadeDoSinal,
    lastSignalAt: AGORA - idadeDoSinal,
    thinkingTokens: 450,
  }
}

function retrato(messages: readonly ChatMessage[], activity: TurnActivity): SessionSnapshot {
  return {
    id: 'sess_01',
    itemId: 'card_14',
    init: undefined,
    state: { kind: 'working' },
    messages,
    activity,
  }
}

describe('o pulso na vista', () => {
  it('a vista nasce sem turno nenhum', () => {
    expect(INITIAL_VIEW.activity).toEqual(IDLE_ACTIVITY)
  })

  it('a batida substitui o pulso inteiro', () => {
    const batida = pulso(1_000)

    expect(apply({ type: 'activity', activity: batida }).activity).toEqual(batida)
  })

  it('o retrato traz o pulso do instante em que foi tirado', () => {
    // É isto que faz um cartão reaberto no meio do turno já nascer com o relógio certo, em vez de
    // começar a contar do zero e mentir sobre a idade do turno.
    const batida = pulso(3_000)

    expect(apply({ type: 'snapshot', snapshot: retrato([], batida) }).activity).toEqual(batida)
  })
})

describe('a regra do redutor para a trilha', () => {
  it('ferramenta nova entra no fim da conversa', () => {
    const view = apply({ type: 'message', message: ferramenta('running') })

    expect(view.messages).toEqual([ferramenta('running')])
  })

  it('o resultado atualiza a entrada em vez de criar uma segunda', () => {
    const view = apply(
      { type: 'message', message: ferramenta('running') },
      { type: 'message', message: ferramenta('done') },
    )

    expect(view.messages).toHaveLength(1)
    expect(view.messages[0]).toEqual(ferramenta('done'))
  })

  it('status não retrocede: um running represado não desfaz o done do retrato', () => {
    // A corrida real: o `held` guarda eventos disparados **antes** do retrato e os drena **depois**
    // dele. Sem este degrau, reabrir o cartão logo depois de a ferramenta terminar deixaria a
    // entrada rodando para sempre — e com ela o CA-4 morreria em todos os turnos seguintes.
    const view = apply(
      { type: 'message', message: ferramenta('done') },
      { type: 'message', message: ferramenta('running') },
    )

    expect(view.messages).toEqual([ferramenta('done')])
  })

  it('os outros dois desfechos também substituem o running', () => {
    const comErro = apply(
      { type: 'message', message: ferramenta('running') },
      { type: 'message', message: ferramenta('error') },
    )
    const cortada = apply(
      { type: 'message', message: ferramenta('running') },
      { type: 'message', message: ferramenta('aborted') },
    )

    expect(comErro.messages).toEqual([ferramenta('error')])
    expect(cortada.messages).toEqual([ferramenta('aborted')])
  })

  it('cada ferramenta tem a sua entrada: id diferente não se sobrepõe', () => {
    const view = apply(
      { type: 'message', message: ferramenta('done', 'toolu_01') },
      { type: 'message', message: ferramenta('running', 'toolu_02') },
    )

    expect(view.messages).toHaveLength(2)
    expect(view.messages.map((message) => message.id)).toEqual(['toolu_01', 'toolu_02'])
  })

  it('fala de id repetido continua sendo ignorada', () => {
    // Texto é imutável: o retrato e o evento represado descrevem o mesmo fato, e o segundo a chegar
    // não tem nada a acrescentar.
    const view = apply(
      { type: 'message', message: { id: 'msg_01', role: 'assistant', text: 'olá' } },
      { type: 'message', message: { id: 'msg_01', role: 'assistant', text: 'outra coisa' } },
    )

    expect(view.messages).toEqual([{ id: 'msg_01', role: 'assistant', text: 'olá' }])
  })
})

describe('a marca de silêncio (CA-4)', () => {
  it('acusa o turno em que nada roda e nada chega há mais de 60s', () => {
    expect(isSilent(pulso(SILENCIO_MS + 1_000), false, AGORA)).toBe(true)
  })

  it('não acusa o mesmo pulso quando há uma ferramenta rodando', () => {
    // Silêncio com ferramenta rodando é o normal — foram medidos 17s dentro de um único `Bash`.
    expect(isSilent(pulso(SILENCIO_MS + 1_000), true, AGORA)).toBe(false)
  })

  it('não acusa sinal recente', () => {
    expect(isSilent(pulso(SILENCIO_MS - 1_000), false, AGORA)).toBe(false)
  })

  it('não acusa sessão parada: sem turno em curso não há silêncio a apontar', () => {
    const parada: TurnActivity = { ...pulso(SILENCIO_MS + 1_000), startedAt: null }

    expect(isSilent(parada, false, AGORA)).toBe(false)
  })

  it('não acusa antes do primeiro sinal: sem carimbo não há idade a comparar', () => {
    const recemNascida: TurnActivity = { startedAt: AGORA, lastSignalAt: null, thinkingTokens: 0 }

    expect(isSilent(recemNascida, false, AGORA)).toBe(false)
  })
})
