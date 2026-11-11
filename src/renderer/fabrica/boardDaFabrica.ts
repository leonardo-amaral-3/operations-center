import type { Board, BoardCard, BoardsSnapshot } from '../../shared/board'

/** A aba do Project 2 (`owner/number`, a `key` do `BoardTab`). O renderer não importa `src/core/`. */
export const CHAVE_DO_BOARD_DA_FABRICA = 'leonardo-amaral-3/2'
/** O repo dos cards que o `yarn fabrica iniciar` sabe ler (`REPO_DA_FABRICA`). */
export const REPO_DOS_CARDS_DA_FABRICA = 'leonardo-amaral-3/operations-center'

export type BoardDaFabrica =
  { kind: 'lendo' } | { kind: 'erro'; erro: string } | { kind: 'ok'; board: Board }

export type EstacaoDoBoard = 'triagem' | 'backlog' | 'release' | 'outra'

/**
 * O board da fábrica a partir do retrato dos boards do app. Sem retrato ou sem descoberta, `lendo`;
 * sem a aba do Project 2, `erro`; aba ainda sem leitura, `lendo` (ou o erro dela). Com board, `ok`,
 * mesmo com `error` preenchido: o board é o último lido.
 */
export function boardDaFabrica(s: BoardsSnapshot | null): BoardDaFabrica {
  if (s === null || s.boards === null) return { kind: 'lendo' }
  const aba = s.boards.find((b) => b.key === CHAVE_DO_BOARD_DA_FABRICA)
  if (aba === undefined) {
    const base = 'o board do Operations Center (Project 2) não está entre os boards do app'
    return {
      kind: 'erro',
      erro: s.discoveryError === null ? base : `${base}: ${s.discoveryError}`,
    }
  }
  if (aba.board === null) {
    return aba.error === null ? { kind: 'lendo' } : { kind: 'erro', erro: aba.error }
  }
  return { kind: 'ok', board: aba.board }
}

/** O nome da coluna do card, ou `''` quando o board não a declara. */
export function colunaDoCard(board: Board, card: BoardCard): string {
  return board.columns.find((c) => c.id === card.columnId)?.name ?? ''
}

/**
 * A estação que o nome da coluna nomeia. Mesma leitura do `normalizeStation` do core para
 * `triagem`, `backlog` e `release` (a canária de `fabrica-briefing.test.ts` compara os dois).
 */
export function estacaoDaColuna(nome: string): EstacaoDoBoard {
  const n = nome
    .replace(/^[^\p{L}]+/u, '')
    .trim()
    .toLowerCase()
  if (n === 'triagem' || n === 'backlog' || n === 'release') return n
  return 'outra'
}
