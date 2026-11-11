import { describe, expect, it } from 'vitest'

import type { EstacaoDaFabrica } from '../../src/shared/fabrica'
import {
  COLUNAS_DA_LINHA,
  colunaDaEstacao,
  gigas,
  horaCurta,
  plural,
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
