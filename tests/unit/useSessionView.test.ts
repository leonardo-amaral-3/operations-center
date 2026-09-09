import { describe, expect, it } from 'vitest'

import { INITIAL_VIEW, isSilent, reduce, SILENCIO_MS } from '../../src/renderer/session/sessionView'
import type { SessionAction, SessionView } from '../../src/renderer/session/sessionView'
import type { SessionSnapshot } from '../../src/shared/ipc'
import { IDLE_ACTIVITY } from '../../src/shared/session'
import type {
  ChatMessage,
  ChatToolUse,
  PermissionRequest,
  QuestionRequest,
  SessionState,
  ToolStatus,
  TurnActivity,
} from '../../src/shared/session'

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
    diff: null,
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

function retrato(
  messages: readonly ChatMessage[],
  activity: TurnActivity,
  state: SessionState = { kind: 'working' },
): SessionSnapshot {
  return {
    id: 'sess_01',
    itemId: 'card_14',
    init: undefined,
    state,
    messages,
    activity,
  }
}

/** Nos casos da fila o que importa de um pedido é só o id: é por ele que se sabe qual está em cartaz. */
function permissao(id: string): PermissionRequest {
  return { id, toolName: 'Read', description: 'package.json' }
}

function pergunta(id: string): QuestionRequest {
  return {
    id,
    questions: [{ question: 'Seguir?', header: 'Rota', multiSelect: false, options: [] }],
  }
}

function esperandoDecisao(id: string, queued: number): SessionState {
  return { kind: 'awaiting_decision', request: permissao(id), queued }
}

function esperandoResposta(id: string, queued: number): SessionState {
  return { kind: 'awaiting_answer', request: pergunta(id), queued }
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

describe('o pedido em cartaz sai do estado (#11)', () => {
  it('um awaiting_decision põe o pedido na tela, com o contador', () => {
    const view = apply({ type: 'state', state: esperandoDecisao('toolu_a', 1) })

    expect(view.permission).toEqual(permissao('toolu_a'))
    expect(view.question).toBeNull()
    expect(view.queued).toBe(1)
  })

  it('um segundo awaiting_decision troca o pedido em cartaz', () => {
    // **O caso que reprova o código de hoje.** O redutor antigo *preservava* `view.permission`
    // enquanto o `kind` não mudasse, contando com um canal IPC à parte para atualizá-lo — e era
    // por esse canal que um segundo pedido concorrente apagava o primeiro. Com o estado por única
    // fonte, o segundo `state` é a fila andando, e adotá-lo é o que faz o próximo aparecer.
    const view = apply(
      { type: 'state', state: esperandoDecisao('toolu_a', 0) },
      { type: 'state', state: esperandoDecisao('toolu_b', 2) },
    )

    expect(view.permission?.id).toBe('toolu_b')
    expect(view.queued).toBe(2)
  })

  it('a permissão dá lugar à pergunta quando a fila muda de tipo', () => {
    // O par misto do CA-2: a fila é FIFO e não tem prioridade por tipo, então o que sai da frente
    // pode dar lugar a um pedido de outra natureza — e os dois prompts não podem coexistir.
    const view = apply(
      { type: 'state', state: esperandoDecisao('toolu_a', 1) },
      { type: 'state', state: esperandoResposta('toolu_b', 0) },
    )

    expect(view.permission).toBeNull()
    expect(view.question).toEqual(pergunta('toolu_b'))
    expect(view.queued).toBe(0)
  })

  it('um estado que não espera ninguém limpa os dois prompts e zera o contador', () => {
    const view = apply(
      { type: 'state', state: esperandoDecisao('toolu_a', 3) },
      { type: 'state', state: { kind: 'working' } },
    )

    expect(view.permission).toBeNull()
    expect(view.question).toBeNull()
    expect(view.queued).toBe(0)
  })

  it('o retrato de uma sessão já parada num pedido já traz o prompt e o contador', () => {
    // A regressão do reabrir-cartão: o evento que parou a sessão foi disparado quando esta tela
    // ainda nem existia, e o retrato é o único lugar de onde o prompt pode vir.
    const view = apply({
      type: 'snapshot',
      snapshot: retrato([], IDLE_ACTIVITY, esperandoResposta('toolu_a', 2)),
    })

    expect(view.question).toEqual(pergunta('toolu_a'))
    expect(view.permission).toBeNull()
    expect(view.queued).toBe(2)
  })

  it('hide-prompt esconde os dois, e o estado seguinte manda', () => {
    const escondido = apply(
      { type: 'state', state: esperandoDecisao('toolu_a', 1) },
      { type: 'hide-prompt' },
    )

    expect(escondido.permission).toBeNull()
    // O contador não se mexe: há mesmo mais um esperando, e quem corrige o número é o `state` que
    // vem em seguida — não o clique.
    expect(escondido.queued).toBe(1)

    const proximo = reduce(escondido, { type: 'state', state: esperandoDecisao('toolu_b', 0) })

    expect(proximo.permission?.id).toBe('toolu_b')
    expect(proximo.queued).toBe(0)
  })
})
