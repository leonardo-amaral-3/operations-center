import type { Board, BoardCard, BoardsSnapshot } from '../../shared/board'
import type { BoardNaFabricaOk } from '../../shared/fabrica'

/**
 * O board padrão do boards.json, para os testes e o smoke: desde o #157 nenhum código do renderer
 * decide board ou repo por elas. Quem as segura iguais é a canária de
 * `tests/unit/fabrica-briefing.test.ts`. A aba do Project 2 (`owner/number`) é a `key` do `BoardTab`.
 */
export const CHAVE_DO_BOARD_DA_FABRICA = 'leonardo-amaral-3/2'
/** O repo dos cards que o `yarn fabrica iniciar` sabe ler. */
export const REPO_DOS_CARDS_DA_FABRICA = 'leonardo-amaral-3/operations-center'
/** O `fabrica/MANDATO.md` da `dev`, que a tela Mandato linka. */
export const URL_DO_MANDATO_DA_FABRICA =
  'https://github.com/leonardo-amaral-3/operations-center/blob/dev/fabrica/MANDATO.md'

export type BoardDaFabrica =
  { kind: 'lendo' } | { kind: 'erro'; erro: string } | { kind: 'ok'; board: Board }

export type EstacaoDoBoard = 'triagem' | 'backlog' | 'release' | 'outra'

/**
 * O board da fábrica a partir do retrato dos boards do app. Sem retrato ou sem descoberta, `lendo`;
 * sem a aba do board alvo, `erro`; aba ainda sem leitura, `lendo` (ou o erro dela). Com board, `ok`,
 * mesmo com `error` preenchido: o board é o último lido.
 */
export function boardDaFabrica(
  s: BoardsSnapshot | null,
  alvo: Pick<BoardNaFabricaOk, 'chave' | 'nome' | 'projeto'>,
): BoardDaFabrica {
  if (s === null || s.boards === null) return { kind: 'lendo' }
  const aba = s.boards.find((b) => b.key === alvo.chave)
  if (aba === undefined) {
    const base = `o board do ${alvo.nome} (Project ${String(alvo.projeto)}) não está entre os boards do app`
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

/**
 * O repo do board da fábrica que `repo` ('owner/name') nomeia, sem caixa, na grafia do board; senão null.
 * Lista: o item de `b.repos` igual sem caixa. Forma '<owner>/*' (`repos === null`): `repo` com uma barra só,
 * owner igual a `b.owner` sem caixa → `${b.owner}/${name}`, com o `name` como veio.
 */
export function repoDaFabrica(
  b: Pick<BoardNaFabricaOk, 'repos' | 'owner'>,
  repo: string,
): string | null {
  const minusculo = repo.toLowerCase()
  if (b.repos !== null) return b.repos.find((r) => r.toLowerCase() === minusculo) ?? null
  const partes = repo.split('/')
  const [owner, name] = partes
  if (partes.length !== 2 || owner === undefined || name === undefined || name === '') return null
  return owner.toLowerCase() === b.owner.toLowerCase() ? `${b.owner}/${name}` : null
}

/** A chave de um card no renderer: `${repo em minúsculas}#${n}`. */
export function chaveDoCard(repo: string, n: number): string {
  return `${repo.toLowerCase()}#${String(n)}`
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
