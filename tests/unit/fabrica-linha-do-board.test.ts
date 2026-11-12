import { describe, expect, it } from 'vitest'

import { normalizeStation } from '../../src/core/board/stations'
import { ESTEIRA_STATIONS } from '../../src/core/board/query'
import { CHAVE_DO_BOARD_DA_FABRICA } from '../../src/renderer/fabrica/boardDaFabrica'
import {
  abaDaLinha,
  cardsDaLinha,
  colunaDaLinhaDoBoard,
  mostraAFabrica,
  normalizarEstacao,
} from '../../src/renderer/fabrica/linhaDoBoard'
import type { Board, BoardCard, BoardTab, BoardsSnapshot } from '../../src/shared/board'

const OUTRA = 'ICSF-Solutions/19'

function card(n: number, columnId: string, extra: Partial<BoardCard> = {}): BoardCard {
  return {
    itemId: `PVTI_${n}`,
    number: n,
    title: `Card ${n}`,
    url: `https://github.com/o/r/issues/${n}`,
    repository: 'o/r',
    closed: false,
    assignees: [],
    columnId,
    fields: [],
    parent: null,
    phases: [],
    ...extra,
  }
}

function board(cards: BoardCard[], nomes: string[] = []): Board {
  return {
    title: 'B',
    columns: nomes.map((name, i) => ({ id: `c${i}`, name, conversable: false, triage: false })),
    cards,
  }
}

function aba(key: string, extra: Partial<BoardTab> = {}): BoardTab {
  return { key, title: `T ${key}`, board: null, readAt: null, error: null, ...extra }
}

function snap(boards: BoardTab[] | null, activeKey: string | null): BoardsSnapshot {
  return { boards, activeKey, discoveryError: null }
}

describe('colunaDaLinhaDoBoard (CA-1 tabela)', () => {
  it.each([
    ['📥 Triagem', 'card'],
    ['🎯 Especificação', 'spec'],
    ['🔨 Implementação', 'implementacao'],
    ['👀 Revisão', 'revisao'],
    ['🧪 Validação em Dev', 'validacao'],
    ['🚂 Release', 'release'],
    ['✅ Produção', 'operacao'],
    ['Triagem', 'card'],
    ['especificacao', 'spec'],
  ])('%s → %s', (nome, coluna) => {
    expect(colunaDaLinhaDoBoard(nome)).toBe(coluna)
  })

  it.each(['📋 Backlog', 'Coluna extra', ''])('%j → null', (nome) => {
    expect(colunaDaLinhaDoBoard(nome)).toBeNull()
  })
})

describe('normalizarEstacao (CA-1 régua)', () => {
  const nomes = [
    ...ESTEIRA_STATIONS,
    ...ESTEIRA_STATIONS.map((n) => `📌 ${n}`),
    '🧪 Validação em Dev',
    'Coluna Extra',
    '',
  ]
  it.each(nomes)('concorda com o normalizeStation do core: %j', (n) => {
    expect(normalizarEstacao(n)).toBe(normalizeStation(n))
  })
})

describe('abaDaLinha e mostraAFabrica (CA-1 aba)', () => {
  const b = board([])
  it('sem retrato ou sem descoberta → sem-aba/lendo', () => {
    expect(abaDaLinha(null)).toEqual({ kind: 'sem-aba', motivo: 'lendo' })
    expect(abaDaLinha(snap(null, OUTRA))).toEqual({ kind: 'sem-aba', motivo: 'lendo' })
  })
  it('sem activeKey ou fora das abas → sem-aba/nenhuma', () => {
    expect(abaDaLinha(snap([aba(OUTRA)], null))).toEqual({ kind: 'sem-aba', motivo: 'nenhuma' })
    expect(abaDaLinha(snap([aba(OUTRA)], 'x/1'))).toEqual({ kind: 'sem-aba', motivo: 'nenhuma' })
  })
  it('aba sem board: lendo ou erro; com board: ok mesmo com error', () => {
    expect(abaDaLinha(snap([aba(OUTRA)], OUTRA))).toEqual({
      kind: 'lendo',
      key: OUTRA,
      titulo: `T ${OUTRA}`,
    })
    expect(abaDaLinha(snap([aba(OUTRA, { error: 'falhou' })], OUTRA))).toEqual({
      kind: 'erro',
      key: OUTRA,
      titulo: `T ${OUTRA}`,
      erro: 'falhou',
    })
    expect(abaDaLinha(snap([aba(OUTRA, { board: b, error: 'velho' })], OUTRA))).toEqual({
      kind: 'ok',
      key: OUTRA,
      titulo: `T ${OUTRA}`,
      board: b,
    })
  })
  it('mostraAFabrica', () => {
    expect(mostraAFabrica(null)).toBe(true)
    expect(mostraAFabrica(snap(null, OUTRA))).toBe(true)
    expect(mostraAFabrica(snap([aba(OUTRA)], null))).toBe(true)
    expect(mostraAFabrica(snap([aba(OUTRA)], 'x/1'))).toBe(true)
    expect(mostraAFabrica(snap([aba(CHAVE_DO_BOARD_DA_FABRICA)], CHAVE_DO_BOARD_DA_FABRICA))).toBe(
      true,
    )
    expect(mostraAFabrica(snap([aba(OUTRA)], OUTRA))).toBe(false)
  })
})

describe('cardsDaLinha (CA-1 cards)', () => {
  const nomes = ['📋 Backlog', '🎯 Especificação', 'Extra B', 'Extra A']
  // c0 Backlog, c1 Spec, c2 Extra B, c3 Extra A; 'zz' não declarada
  it('só abertos, sem os já na linha, e agrupa por coluna', () => {
    const b = board(
      [
        card(1, 'c1'),
        card(2, 'c1', { closed: true }),
        card(3, 'c1', { url: 'https://github.com/o/r/issues/3' }),
        card(4, 'c1'),
      ],
      nomes,
    )
    const r = cardsDaLinha(b, new Set(['https://github.com/o/r/issues/3']))
    expect(r.porColuna.get('spec')?.map((c) => c.card.number)).toEqual([1, 4])
    expect(r.porColuna.size).toBe(1)
    expect(r.aParte).toEqual([])
  })
  it('URL com caixa diferente também sai', () => {
    const b = board([card(5, 'c1', { url: 'https://github.com/O/R/issues/5' })], nomes)
    const r = cardsDaLinha(b, new Set(['https://github.com/o/r/issues/5']))
    expect(r.porColuna.size).toBe(0)
  })
  it('Backlog e coluna extra em aParte na ordem de board.columns; não declarada no fim', () => {
    const b = board(
      [card(1, 'c3'), card(2, 'zz'), card(3, 'c0'), card(4, 'c2'), card(5, 'c3')],
      nomes,
    )
    const r = cardsDaLinha(b, new Set())
    expect(r.aParte.map((g) => [g.coluna, g.cards.map((c) => c.card.number)])).toEqual([
      ['📋 Backlog', [3]],
      ['Extra B', [4]],
      ['Extra A', [1, 5]],
      ['', [2]],
    ])
    expect(r.aParte[3]?.cards[0]?.coluna).toBe('')
  })
})
