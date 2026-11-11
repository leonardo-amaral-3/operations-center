import { describe, expect, it } from 'vitest'

import { classificar } from '../../src/core/relatorio/classificar'
import type { Decisao } from '../../src/core/relatorio/tipos'

/** Uma decisão de rotina (com card, sem marca) que cada caso sobrescreve no que interessa. */
function decisao(sobre: Partial<Decisao>): Decisao {
  return {
    arquivo: 'a.md',
    data: '2026-11-10',
    tipo: 'decisao',
    escopo: 'operations-center#118',
    card: 118,
    substitui: null,
    titulo: 'Algo decidido',
    fato: 'Algo decidido',
    porque: null,
    descartado: null,
    objetivos: [],
    provisoria: false,
    irreversivel: false,
    ...sobre,
  }
}

describe('classificar (spec-p1 §3)', () => {
  it.each([
    ['pendência', { tipo: 'pendencia' }, 'estacionada', 'pendência'],
    ['provisória', { provisoria: true }, 'provisoria', 'provisória: sim'],
    ['substitui', { substitui: '1234' }, 'desvio', 'substitui a decisão #1234'],
    ['descoberta', { tipo: 'descoberta' }, 'chave', 'descoberta'],
    ['restrição', { tipo: 'restricao' }, 'chave', 'restrição'],
    ['irreversível', { irreversivel: true }, 'chave', 'reversível: não'],
    ['portão', { titulo: 'G2 do épico decidido' }, 'chave', 'portão G2'],
    ['sem card', { card: null }, 'chave', 'sem card'],
    ['rotina', {}, 'rotina', ''],
  ] as const)('%s', (_nome, sobre, classe, motivo) => {
    expect(classificar(decisao(sobre))).toEqual({ classe, motivo })
  })

  it('a pendência provisória é estacionada: a regra 1 vence a 2', () => {
    expect(classificar(decisao({ tipo: 'pendencia', provisoria: true })).classe).toBe('estacionada')
  })

  it('a provisória vence o substitui, que vence os sinais de chave', () => {
    expect(classificar(decisao({ provisoria: true, substitui: '5' })).classe).toBe('provisoria')
    expect(classificar(decisao({ substitui: '5', card: null })).classe).toBe('desvio')
  })

  it('descoberta sem card junta os sinais, na ordem', () => {
    expect(classificar(decisao({ tipo: 'descoberta', card: null }))).toEqual({
      classe: 'chave',
      motivo: 'descoberta, sem card',
    })
  })

  it('G6 no título não é portão, e G1 dentro de outra palavra também não', () => {
    expect(classificar(decisao({ titulo: 'G6 do épico' })).classe).toBe('rotina')
    expect(classificar(decisao({ titulo: 'ABG1X' })).classe).toBe('rotina')
  })

  it('restrição com reversível: não junta os dois sinais', () => {
    expect(classificar(decisao({ tipo: 'restricao', irreversivel: true }))).toEqual({
      classe: 'chave',
      motivo: 'restrição, reversível: não',
    })
  })
})
