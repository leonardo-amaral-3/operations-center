import { describe, expect, it } from 'vitest'

import {
  ESTACOES_DO_CARD,
  cardCitado,
  cardCitadoComRepo,
  estadosDasEstacoes,
  estadosDasTasks,
  linhaDoFim,
  rotuloDoEstado,
  tasksDoComentario,
  textoDaDecisao,
} from '../../src/renderer/fabrica/emVoo'
import type { DespachoDoCard } from '../../src/shared/fabrica'
import { CORPO_TASKS_4 } from './retrato-f4'

function d(parcial: Partial<DespachoDoCard>): DespachoDoCard {
  return {
    id: 'd-0001',
    comando: '/gm-spec #4',
    estacao: null,
    estado: 'concluido',
    criadoEm: '2026-11-11T08:00:00.000Z',
    lancadoEm: null,
    concluidoEm: null,
    sessao: null,
    fim: null,
    detalhe: null,
    ...parcial,
  }
}

describe('estadosDasEstacoes', () => {
  it('marca as feitas, a atual e as por vir, para cada uma das nove', () => {
    ESTACOES_DO_CARD.forEach(({ estacao }, i) => {
      const estados = estadosDasEstacoes(estacao)
      expect(estados).toHaveLength(9)
      expect(estados.filter((e) => e === 'feita')).toHaveLength(i)
      expect(estados[i]).toBe('atual')
      expect(estados.filter((e) => e === 'por-vir')).toHaveLength(8 - i)
    })
  })

  it('com null ou operacao, tudo por vir', () => {
    const todas = Array<string>(9).fill('por-vir')
    expect(estadosDasEstacoes(null)).toEqual(todas)
    expect(estadosDasEstacoes('operacao')).toEqual(todas)
  })
})

describe('tasksDoComentario', () => {
  it('lê o corpo da fixture f4: uma feita e quatro não', () => {
    const tasks = tasksDoComentario(CORPO_TASKS_4)
    expect(tasks.map((t) => [t.numero, t.feita])).toEqual([
      [1, true],
      [2, false],
      [3, false],
      [4, false],
      [5, false],
    ])
    expect(tasks[0]?.titulo).toBe('O leitor do board e o contrato')
  })

  it('lê as cinco marcadas do #126, X maiúsculo e hífen no lugar do travessão', () => {
    const corpo = ['- [x] 1 — a', '- [X] 2 – b', '- [x] 3 - c', '- [x] 4 — d', '- [x] 5 — e'].join(
      '\n',
    )
    const tasks = tasksDoComentario(corpo)
    expect(tasks).toHaveLength(5)
    expect(tasks.every((t) => t.feita)).toBe(true)
    expect(tasks[2]?.titulo).toBe('c')
  })

  it('ignora o que não casa', () => {
    expect(
      tasksDoComentario('<!-- gm:tasks -->\n### Tasks\n- [ ] sem número\n- [?] 1 — x\ntexto'),
    ).toEqual([])
  })
})

describe('estadosDasTasks', () => {
  const tasks = tasksDoComentario(CORPO_TASKS_4)
  const rodando = { estacao: 'implementacao', estado: 'rodando' } as const

  it('a primeira não feita trabalha só com implementação rodando e viva !== false', () => {
    expect(estadosDasTasks(tasks, rodando, true)).toEqual([
      'feita',
      'trabalhando',
      'na-fila',
      'na-fila',
      'na-fila',
    ])
    expect(estadosDasTasks(tasks, rodando, null)[1]).toBe('trabalhando')
    expect(estadosDasTasks(tasks, rodando, false)[1]).toBe('na-fila')
    expect(estadosDasTasks(tasks, { estacao: 'spec', estado: 'rodando' }, true)[1]).toBe('na-fila')
    expect(estadosDasTasks(tasks, { estacao: 'implementacao', estado: 'concluido' }, null)[1]).toBe(
      'na-fila',
    )
    expect(estadosDasTasks(tasks, null, true)[1]).toBe('na-fila')
  })
})

describe('frases do fim', () => {
  it('linhaDoFim e textoDaDecisao para os três fins e sem desfecho', () => {
    expect(linhaDoFim(d({ fim: 'proximo', detalhe: '/gm-x' }))).toBe('→ seguiu para /gm-x')
    expect(linhaDoFim(d({ fim: 'parada', detalhe: 'motivo' }))).toBe('■ PARADA: motivo')
    expect(linhaDoFim(d({ fim: 'falha', detalhe: 'caiu' }))).toBe('✕ falha: caiu')
    expect(linhaDoFim(d({ fim: 'falha' }))).toBe('✕ falha: ?')
    expect(linhaDoFim(d({}))).toBeNull()
    expect(textoDaDecisao(d({ fim: 'proximo', detalhe: '/gm-x' }))).toBe('seguiu para /gm-x')
    expect(textoDaDecisao(d({ fim: 'parada', detalhe: 'm' }))).toBe('PARADA: m')
    expect(textoDaDecisao(d({ fim: 'falha', detalhe: 'c' }))).toBe('falha: c')
    expect(textoDaDecisao(d({}))).toBe('sem desfecho')
  })
})

describe('cardCitado', () => {
  it('acha o card e pula PR', () => {
    expect(cardCitado('virou o #906')).toBe(906)
    expect(cardCitado('PR #930 do #906')).toBe(906)
    expect(cardCitado('só a PR #930')).toBeNull()
    expect(cardCitado('#0')).toBeNull()
    expect(cardCitado('sem card')).toBeNull()
  })
})

describe('cardCitadoComRepo', () => {
  it('owner/name#n traz o repo; #n solto vem com repo null', () => {
    expect(cardCitadoComRepo('virou o fulano/repo-b#910')).toEqual({
      repo: 'fulano/repo-b',
      card: 910,
    })
    expect(cardCitadoComRepo('virou o #906')).toEqual({ repo: null, card: 906 })
    expect(cardCitadoComRepo('PR #930 do #906')).toEqual({ repo: null, card: 906 })
    expect(cardCitadoComRepo('só a PR #930')).toBeNull()
    expect(cardCitadoComRepo('sem card')).toBeNull()
  })
})

describe('rotuloDoEstado', () => {
  it('traduz os quatro estados', () => {
    expect(rotuloDoEstado('pendente')).toBe('na fila')
    expect(rotuloDoEstado('lancando')).toBe('subindo')
    expect(rotuloDoEstado('rodando')).toBe('rodando')
    expect(rotuloDoEstado('concluido')).toBe('terminada')
  })
})
