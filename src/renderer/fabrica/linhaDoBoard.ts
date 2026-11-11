import type { Board, BoardCard, BoardsSnapshot } from '../../shared/board'
import { CHAVE_DO_BOARD_DA_FABRICA, colunaDoCard } from './boardDaFabrica'
import type { ColunaDaLinha } from './linha'

/**
 * A Linha da Sala segue a aba selecionada (#142, §2.2). Sem React, para o teste importá-la direto.
 * `lendo` e `erro` falam da aba selecionada; `sem-aba` é quando não há aba para falar dela.
 */
export type AbaDaLinha =
  | { kind: 'sem-aba'; motivo: 'lendo' | 'nenhuma' }
  | { kind: 'lendo'; key: string; titulo: string }
  | { kind: 'erro'; key: string; titulo: string; erro: string }
  | { kind: 'ok'; key: string; titulo: string; board: Board }

/** A aba selecionada do retrato e o que dela se sabe. */
export function abaDaLinha(s: BoardsSnapshot | null): AbaDaLinha {
  if (s === null || s.boards === null) return { kind: 'sem-aba', motivo: 'lendo' }
  const aba = s.activeKey === null ? undefined : s.boards.find((b) => b.key === s.activeKey)
  if (aba === undefined) return { kind: 'sem-aba', motivo: 'nenhuma' }
  if (aba.board !== null) return { kind: 'ok', key: aba.key, titulo: aba.title, board: aba.board }
  if (aba.error !== null) {
    return { kind: 'erro', key: aba.key, titulo: aba.title, erro: aba.error }
  }
  return { kind: 'lendo', key: aba.key, titulo: aba.title }
}

/** A camada da fábrica aparece com a aba do Project 2 ou sem aba (inclui `s === null`). */
export function mostraAFabrica(s: BoardsSnapshot | null): boolean {
  return abaDaLinha(s).kind === 'sem-aba' || s?.activeKey === CHAVE_DO_BOARD_DA_FABRICA
}

/**
 * A mesma régua do `normalizeStation` do core (o renderer não importa `src/core/`; a canária de
 * `fabrica-linha-do-board.test.ts` compara as duas): tira o que vem antes da 1ª letra, NFD, sem
 * diacríticos, minúsculas.
 */
export function normalizarEstacao(nome: string): string {
  return nome
    .replace(/^\P{L}+/u, '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

const COLUNA_DA_ESTACAO: ReadonlyMap<string, ColunaDaLinha> = new Map([
  ['triagem', 'card'],
  ['especificacao', 'spec'],
  ['implementacao', 'implementacao'],
  ['revisao', 'revisao'],
  ['validacao em dev', 'validacao'],
  ['release', 'release'],
  ['producao', 'operacao'],
])

/** A coluna da Linha da coluna do board, ou `null` (fora das estações da linha). */
export function colunaDaLinhaDoBoard(nomeDaColuna: string): ColunaDaLinha | null {
  return COLUNA_DA_ESTACAO.get(normalizarEstacao(nomeDaColuna)) ?? null
}

export interface CardNaLinha {
  card: BoardCard
  /** O nome da coluna no board; `''` quando o board não declara a opção. */
  coluna: string
}

export interface CardsDaLinha {
  porColuna: ReadonlyMap<ColunaDaLinha, readonly CardNaLinha[]>
  aParte: ReadonlyArray<{ coluna: string; cards: readonly CardNaLinha[] }>
}

/** Os cards abertos do board, menos os de URL em `jaNaLinha` (comparação em minúsculas). */
export function cardsDaLinha(board: Board, jaNaLinha: ReadonlySet<string>): CardsDaLinha {
  const porColuna = new Map<ColunaDaLinha, CardNaLinha[]>()
  const aParteBruto = new Map<string, CardNaLinha[]>()

  for (const card of board.cards) {
    if (card.closed || jaNaLinha.has(card.url.toLowerCase())) continue
    const coluna = colunaDoCard(board, card)
    const c: CardNaLinha = { card, coluna }
    const daLinha = colunaDaLinhaDoBoard(coluna)
    if (daLinha !== null) {
      const lista = porColuna.get(daLinha) ?? []
      lista.push(c)
      porColuna.set(daLinha, lista)
    } else {
      const lista = aParteBruto.get(coluna) ?? []
      lista.push(c)
      aParteBruto.set(coluna, lista)
    }
  }

  // Um grupo por coluna do board fora da linha, na ordem de `board.columns`; o grupo `''`
  // (columnId não declarado) fecha a lista. Grupo vazio não entra.
  const aParte: Array<{ coluna: string; cards: readonly CardNaLinha[] }> = []
  for (const col of board.columns) {
    if (col.name === '' || colunaDaLinhaDoBoard(col.name) !== null) continue
    const cards = aParteBruto.get(col.name)
    if (cards !== undefined && !aParte.some((g) => g.coluna === col.name)) {
      aParte.push({ coluna: col.name, cards })
    }
  }
  const semDeclarar = aParteBruto.get('')
  if (semDeclarar !== undefined) aParte.push({ coluna: '', cards: semDeclarar })

  return { porColuna, aParte }
}
