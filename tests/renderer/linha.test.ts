import { describe, expect, it } from 'vitest'

import type { DespachoNaSala, EstacaoDaFabrica, SalaDaFabrica } from '../../src/shared/fabrica'
import {
  COLUNAS_DA_LINHA,
  colunaDaEstacao,
  estadoNaLinha,
  gigas,
  horaCurta,
  plural,
  previsaoDosPendentes,
  ROTULO_DA_ESTACAO,
  ROTULO_DO_PASSO,
  rotuloDoCard,
  skillDoComando,
} from '../../src/renderer/fabrica/linha'

describe('COLUNAS_DA_LINHA', () => {
  it('são nove, na ordem da Linha, com rótulo, nível e vazio literais', () => {
    expect(COLUNAS_DA_LINHA).toEqual([
      { coluna: 'entrada', rotulo: 'Entrada', nivel: 'A', vazio: 'Nenhuma triagem em voo.' },
      { coluna: 'card', rotulo: 'Card · G1', nivel: 'A', vazio: 'Nenhum card esperando promoção.' },
      { coluna: 'spec', rotulo: 'Spec · G2', nivel: 'A', vazio: 'Nenhuma spec em voo.' },
      {
        coluna: 'implementacao',
        rotulo: 'Implementação',
        nivel: 'A',
        vazio: 'Nenhuma task em voo.',
      },
      {
        coluna: 'integracao',
        rotulo: 'Integração',
        nivel: 'A',
        vazio: 'O merge na dev é da orquestradora; nenhuma sessão da fábrica para aqui.',
      },
      { coluna: 'revisao', rotulo: 'Revisão · G4', nivel: 'A', vazio: 'Nenhuma PR em voo.' },
      {
        coluna: 'validacao',
        rotulo: 'Validação dev',
        nivel: 'C',
        vazio: 'A validação em dev é sua; a fábrica não despacha esta estação.',
      },
      {
        coluna: 'release',
        rotulo: 'Release · G5',
        nivel: 'C',
        vazio: 'Trem vazio. Release e produção são sempre seus.',
      },
      {
        coluna: 'operacao',
        rotulo: 'Operação',
        nivel: 'C',
        vazio: 'A fábrica não observa produção nesta prova.',
      },
    ])
  })
})

describe('colunaDaEstacao', () => {
  it('é a identidade, salvo tasks, que cai em spec', () => {
    const estacoes = Object.keys(ROTULO_DA_ESTACAO) as EstacaoDaFabrica[]
    expect(estacoes).toHaveLength(10)
    for (const e of estacoes) {
      expect(colunaDaEstacao(e)).toBe(e === 'tasks' ? 'spec' : e)
    }
  })

  it('null não tem coluna', () => {
    expect(colunaDaEstacao(null)).toBeNull()
  })

  it('toda coluna devolvida existe na Linha', () => {
    const colunas = COLUNAS_DA_LINHA.map((c) => c.coluna)
    for (const e of Object.keys(ROTULO_DA_ESTACAO) as EstacaoDaFabrica[]) {
      expect(colunas).toContain(colunaDaEstacao(e))
    }
  })
})

describe('rótulos', () => {
  it('ROTULO_DA_ESTACAO e ROTULO_DO_PASSO', () => {
    expect(ROTULO_DA_ESTACAO.tasks).toBe('Tasks · G3')
    expect(ROTULO_DA_ESTACAO.validacao).toBe('Validação dev')
    expect(ROTULO_DO_PASSO).toEqual({
      'gm-triage': 'Triagem',
      'gm-card': 'G1',
      'gm-spec': 'G2',
      'gm-plan-tasks': 'G3',
      'gm-implement': 'Task',
      'gm-correcao': 'Correção',
      'gm-ship': 'G4',
    })
  })
})

describe('skillDoComando', () => {
  it('pega a skill depois da barra', () => {
    expect(skillDoComando('/gm-spec #4')).toBe('gm-spec')
    expect(skillDoComando('/gm-ship')).toBe('gm-ship')
  })

  it('o que não casa volta inteiro', () => {
    expect(skillDoComando('yarn fabrica')).toBe('yarn fabrica')
    expect(skillDoComando('')).toBe('')
    expect(skillDoComando('/ vazio')).toBe('/ vazio')
  })
})

describe('rotuloDoCard', () => {
  it('com e sem título', () => {
    expect(rotuloDoCard(4, 'Ler o board')).toBe('#4 Ler o board')
    expect(rotuloDoCard(951, null)).toBe('#951')
  })
})

describe('plural', () => {
  it('o singular só quando n é 1', () => {
    expect(plural(1, 'agente', 'agentes')).toBe('agente')
    expect(plural(0, 'agente', 'agentes')).toBe('agentes')
    expect(plural(3, 'agente', 'agentes')).toBe('agentes')
  })
})

describe('horaCurta', () => {
  it('data inválida volta crua', () => {
    expect(horaCurta('ontem')).toBe('ontem')
  })

  it('data válida vira dia/mês e hora', () => {
    expect(horaCurta('2026-11-11T12:00:00.000Z')).toMatch(/^11\/11.*\d{2}:\d{2}$/)
  })
})

describe('gigas', () => {
  it('uma casa, vírgula decimal', () => {
    expect(gigas(50 * 1024 ** 3)).toBe('50,0 GB')
    expect(gigas(1.5 * 1024 ** 3)).toBe('1,5 GB')
    expect(gigas(0)).toBe('0,0 GB')
  })
})

describe('previsaoDosPendentes', () => {
  const pendente = (id: string): DespachoNaSala => ({
    id,
    card: 2,
    cardUrl: 'u',
    comando: '/gm-card #2',
    estacao: 'card',
    estado: 'pendente',
    criadoEm: '2026-11-11T09:40:00.000Z',
    lancadoEm: null,
    ondeRoda: 'sem worktree',
    viva: null,
  })
  const sala = (
    extra: Partial<Extract<SalaDaFabrica, { kind: 'ok' }>> = {},
  ): Extract<SalaDaFabrica, { kind: 'ok' }> => ({
    kind: 'ok',
    lidoEm: '2026-11-11T12:00:00.000Z',
    projeto: 'p',
    despachante: 'rodando',
    pausa: null,
    recursos: {
      sessoes: { kind: 'ok', vivas: 2, teto: 3 },
      suite: { kind: 'livre' },
      disco: { kind: 'ok', livres: 1, minimo: 1 },
    },
    emVoo: [pendente('d-1'), pendente('d-2')],
    abertos: [],
    fechados: [],
    decisoes: [],
    frentesAbertas: 2,
    ...extra,
  })

  it('dois pendentes e uma vaga: o primeiro sobe, o segundo espera', () => {
    expect(previsaoDosPendentes(sala())).toEqual([
      'sobe no próximo passo do despachante',
      'espera vaga (teto de 3)',
    ])
  })

  it('só os pendentes entram, na ordem', () => {
    const rodando = { ...pendente('d-0'), estado: 'rodando' as const }
    expect(previsaoDosPendentes(sala({ emVoo: [rodando, pendente('d-1')] }))).toEqual([
      'sobe no próximo passo do despachante',
    ])
  })

  it('pausada', () => {
    expect(previsaoDosPendentes(sala({ pausa: { desde: null } }))).toEqual([
      'espera a fábrica ser retomada',
      'espera a fábrica ser retomada',
    ])
  })

  it('despachante parado', () => {
    expect(previsaoDosPendentes(sala({ despachante: 'parado' }))[0]).toBe(
      'espera o yarn fabrica rodar',
    )
  })

  it('despachante sem leitura não afirma que está parado', () => {
    expect(previsaoDosPendentes(sala({ despachante: 'desconhecido' }))[0]).toBe(
      'sobe quando o despachante rodar (sem leitura dele)',
    )
  })

  it('sessões sem leitura', () => {
    const s = sala()
    s.recursos.sessoes = { kind: 'sem-leitura', motivo: 'x', teto: 3 }
    expect(previsaoDosPendentes(s)[0]).toBe('sobe quando houver vaga (sessões sem leitura)')
  })

  it('teto estourado (vivas > teto) nunca dá vaga negativa', () => {
    const s = sala()
    s.recursos.sessoes = { kind: 'ok', vivas: 5, teto: 3 }
    expect(previsaoDosPendentes(s)).toEqual(['espera vaga (teto de 3)', 'espera vaga (teto de 3)'])
  })
})

describe('estadoNaLinha', () => {
  const d = (estado: DespachoNaSala['estado'], viva: boolean | null): DespachoNaSala => ({
    id: 'd-1',
    card: 1,
    cardUrl: 'u',
    comando: '/gm-spec #1',
    estacao: 'spec',
    estado,
    criadoEm: '2026-11-11T09:40:00.000Z',
    lancadoEm: null,
    ondeRoda: 'planning/',
    viva,
  })

  it.each([
    ['rodando', true, 'rodando', 'trabalhando'],
    ['lancando', true, 'subindo', 'subindo a sessão'],
    ['pendente', null, 'na fila de lançamento', 'na fila de lançamento'],
    ['rodando', false, 'sem sessão viva', 'sem sessão viva; o despachante recolhe quando rodar'],
    ['lancando', false, 'sem sessão viva', 'sem sessão viva; o despachante recolhe quando rodar'],
    ['rodando', null, 'rodando', 'trabalhando'],
  ] as const)('%s, viva %s', (estado, viva, sala, agentes) => {
    expect(estadoNaLinha(d(estado, viva), 'sala')).toBe(sala)
    expect(estadoNaLinha(d(estado, viva), 'agentes')).toBe(agentes)
  })
})
