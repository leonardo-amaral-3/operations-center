import { describe, expect, it } from 'vitest'

import {
  diaCurto,
  diaLongo,
  ehChave,
  estadoDaDecisao,
  hojeEmUtc,
  numerosDoDia,
  objetivosDoDia,
  passaNoFiltro,
  quemDecidiu,
  rotuloDaFrente,
  rotuloDoReversivel,
  segmentosDoEsforco,
  semObjetivoDoDia,
  tiposDoDia,
  FILTROS,
} from '../../src/renderer/fabrica/decisoes'
import type { DecisaoDoDia, PainelDoDia, RevisaoNaSala } from '../../src/shared/fabrica'
import { A1, A2, A3, A4, A5, A6, A7, A8, A9, PAINEL_F5, REVISAO_A4 } from './painel-f5'

const por = (arquivo: string): DecisaoDoDia => {
  const d = PAINEL_F5.decisoes.find((x) => x.arquivo === arquivo)
  if (d === undefined) throw new Error(arquivo)
  return d
}
const REVS = new Map([[A4, REVISAO_A4]])
const CONTESTADA: RevisaoNaSala = { ...REVISAO_A4, veredito: 'contestada', motivo: 'não' }

describe('datas', () => {
  it('hojeEmUtc, diaCurto e diaLongo', () => {
    expect(hojeEmUtc(new Date('2026-11-11T23:30:00.000Z'))).toBe('2026-11-11')
    expect(diaCurto('2026-11-10')).toBe('10/11')
    expect(diaLongo('2026-11-10')).toBe('10/11/2026')
  })
})

describe('estadoDaDecisao', () => {
  it('as sete saídas', () => {
    expect(estadoDaDecisao(por(A4), REVISAO_A4)).toBe('confirmada')
    expect(estadoDaDecisao(por(A4), CONTESTADA)).toBe('contestada')
    expect(estadoDaDecisao(por(A9), undefined)).toBe('alerta')
    expect(estadoDaDecisao(por(A2), undefined)).toBe('provisória')
    expect(estadoDaDecisao(por(A5), undefined)).toBe('estacionada')
    expect(estadoDaDecisao(por(A6), undefined)).toBe('rotina')
    expect(estadoDaDecisao(por(A1), undefined)).toBe('decidida')
  })

  it('a precedência: revisão > sem-repo > provisória', () => {
    expect(estadoDaDecisao(por(A9), REVISAO_A4)).toBe('confirmada')
    const semRepoProvisoria = { ...por(A9), provisoria: true }
    expect(estadoDaDecisao(semRepoProvisoria, undefined)).toBe('alerta')
    expect(estadoDaDecisao({ ...por(A5), provisoria: true }, undefined)).toBe('provisória')
  })
})

describe('rótulos', () => {
  it('frente, quem decidiu e reversível', () => {
    expect(rotuloDaFrente(por(A1))).toBe('operations-center#118')
    expect(rotuloDaFrente(por(A9))).toBe('46 (sem repo)')
    expect(rotuloDaFrente({ ...por(A1), card: null })).toBe('operations-center, sem card')
    expect(quemDecidiu(por(A1))).toBe('mandato #1439')
    expect(quemDecidiu(por(A7))).toBe('sem «sob:»')
    expect(rotuloDoReversivel(por(A1))).toBe('reversível')
    expect(rotuloDoReversivel(por(A3))).toBe('irreversível')
    expect(rotuloDoReversivel({ ...por(A3), reversivel: null })).toBe('sem marca')
  })

  it('ehChave: chave, provisória e desvio', () => {
    expect([A1, A2, A8].every((a) => ehChave(por(a)))).toBe(true)
    expect([A5, A6, A9].some((a) => ehChave(por(a)))).toBe(false)
  })
})

describe('passaNoFiltro', () => {
  const quais = (f: (typeof FILTROS)[number]) =>
    PAINEL_F5.decisoes.filter((d) => passaNoFiltro(f, d, REVS.get(d.arquivo))).map((d) => d.arquivo)

  it('os seis filtros', () => {
    expect(quais('Todas')).toHaveLength(9)
    expect(quais('Chave')).toHaveLength(5)
    expect(quais('Provisórias')).toEqual([A2, A3])
    expect(quais('Suas')).toEqual([A4])
    expect(quais('Sem objetivo').sort()).toEqual([A7, A9].sort())
    expect(quais('Alertas')).toEqual([A9])
  })
})

describe('numerosDoDia', () => {
  it('com a revisão da fixture: 12 / 5 / 2 / 1 / 1', () => {
    expect(numerosDoDia(PAINEL_F5, REVS)).toEqual({
      cofre: 12,
      chaves: 5,
      provisorias: 2,
      estacionadas: 1,
      semRepo: 1,
    })
  })

  it('sem revisão, a confirmada volta a ser provisória', () => {
    expect(numerosDoDia(PAINEL_F5, new Map()).provisorias).toBe(3)
  })
})

describe('segmentosDoEsforco', () => {
  const painel = (porRepo: PainelDoDia['porRepo'], noCofre: number, semRepo = 0): PainelDoDia => ({
    ...PAINEL_F5,
    porRepo,
    noCofre,
    decisoes: PAINEL_F5.decisoes.filter((d) => (d.secao === 'sem-repo' ? semRepo > 0 : false)),
  })

  it('três repos mais o sem repo', () => {
    const s = segmentosDoEsforco(PAINEL_F5)
    expect(s.map((x) => x.rotulo)).toEqual([
      'operations-center · 8',
      'claude-brain · 2',
      'extractor · 1',
      'sem repo, 1',
    ])
    expect(s.map((x) => x.classe)).toEqual(['bg-main', 'bg-main/60', 'bg-main/25', 'bg-danger'])
    expect(s[0]?.largura).toBe(66.7)
    expect(s[3]?.semRepo).toBe(true)
  })

  it('cinco repos: os dois primeiros e "outros"', () => {
    const s = segmentosDoEsforco(
      painel(
        [
          { repo: 'a', decisoes: 5 },
          { repo: 'b', decisoes: 4 },
          { repo: 'c', decisoes: 3 },
          { repo: 'd', decisoes: 2 },
          { repo: 'operations-center', decisoes: 1 },
        ],
        15,
      ),
    )
    expect(s.map((x) => x.rotulo)).toEqual([
      'operations-center · 1',
      'a · 5',
      'b · 4',
      'outros · 5',
    ])
    expect(s[3]?.classe).toBe('bg-secondary-background')
  })

  it('sem operations-center os três primeiros levam as três classes', () => {
    const s = segmentosDoEsforco(
      painel(
        [
          { repo: 'a', decisoes: 2 },
          { repo: 'b', decisoes: 1 },
          { repo: 'c', decisoes: 1 },
        ],
        4,
      ),
    )
    expect(s.map((x) => x.classe)).toEqual(['bg-main', 'bg-main/60', 'bg-main/25'])
  })

  it('total zero: nada', () => {
    expect(segmentosDoEsforco(painel([], 0))).toEqual([])
  })
})

describe('tiposDoDia', () => {
  it('7 decisões e 1 pendência', () => {
    expect(tiposDoDia(PAINEL_F5)).toBe(
      'Tipos: 7 decisões, 0 descobertas, 1 pendência, 0 restrições.',
    )
  })

  it('outro tipo entra no fim', () => {
    const p = { ...PAINEL_F5, decisoes: [{ ...por(A1), tipo: 'nota' }] }
    expect(tiposDoDia(p)).toBe(
      'Tipos: 0 decisões, 0 descobertas, 0 pendências, 0 restrições, 1 de outro tipo.',
    )
  })
})

describe('objetivos', () => {
  it('por objetivo, com as frentes em ordem numérica', () => {
    const o = objetivosDoDia(PAINEL_F5)
    expect(o?.map((x) => [x.codigo, x.decisoes, x.frentes])).toEqual([
      ['P0', 0, []],
      ['P1', 2, ['#120']],
      ['P2', 1, ['#121']],
      ['P3', 4, ['#118', '#122']],
    ])
  })

  it('sem DIRECAO.md: null', () => {
    expect(objetivosDoDia({ ...PAINEL_F5, objetivos: null })).toBeNull()
  })

  it('sem objetivo: a rotina sem marca, com "sem card" no fim', () => {
    expect(semObjetivoDoDia(PAINEL_F5)).toEqual({ frentes: ['#122'], decisoes: 1, doRepo: 8 })
    const p = { ...PAINEL_F5, decisoes: [{ ...por(A7), frente: null }, por(A1)] }
    expect(semObjetivoDoDia(p).frentes).toEqual(['sem card'])
  })
})
