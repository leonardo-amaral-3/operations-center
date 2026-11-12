import { dirname } from 'node:path'
import type { GraphQLFn } from '../../core'
import {
  nomeDoRepo,
  resolverBoard,
  type BoardComMandato,
  type ConfiguracaoDaFabrica,
} from '../../core/fabrica/configuracao'
import type { BoardNaFabrica } from '../../shared/fabrica'
import { lerMandatoDoBoard } from './github'
import { criarMarcaEmCache, lerRecursos, portasReais, worktreesDo } from './recursos'
import type { FontesDaSala } from './sala'

/**
 * O board de cada pedido do renderer (#157). **Só lê**: nenhuma porta de escrita da pasta da fábrica
 * entra aqui, e a canária de `fabrica-sala.test.ts` guarda isso. O main não guarda board entre pedidos;
 * a única memória é a marca do mandato de cada board, em cache por chave.
 */

/** `<owner>/<projeto>`, projeto ≥ 1 sem zero à esquerda: a forma da `chave` do `boards.json`. */
export const FORMA_DA_CHAVE = /^[A-Za-z0-9-]+\/[1-9]\d*$/

function chaveDoPedido(pedido: unknown): string | null | undefined {
  if (typeof pedido !== 'object' || pedido === null || !('board' in pedido)) return undefined
  const board = pedido.board
  if (board === null) return null
  if (typeof board === 'string' && FORMA_DA_CHAVE.test(board)) return board
  return undefined
}

/**
 * O board de um pedido do renderer. `pedido` não objeto, sem a chave `board`, ou `board` que não é `null`
 * nem texto em `FORMA_DA_CHAVE` → `{ ok: false, motivo: 'pedido inválido: board' }`. `board: null` → o
 * `padrao`. Texto → `resolverBoard(c, board)`, com os motivos dele.
 */
export function boardDoPedido(
  c: ConfiguracaoDaFabrica,
  pedido: unknown,
): { ok: true; board: BoardComMandato } | { ok: false; motivo: string } {
  const chave = chaveDoPedido(pedido)
  if (chave === undefined) return { ok: false, motivo: 'pedido inválido: board' }
  return resolverBoard(c, chave)
}

/** O `BoardNaFabrica` do pedido. Recusado com pedido torto leva `chave: ''`; com chave válida, a chave pedida (ou o padrão, com `null`). */
export function boardNaFabrica(c: ConfiguracaoDaFabrica, pedido: unknown): BoardNaFabrica {
  const r = boardDoPedido(c, pedido)
  if (!r.ok) {
    const chave = chaveDoPedido(pedido)
    return {
      kind: 'recusado',
      chave: chave === undefined ? '' : (chave ?? c.padrao),
      motivo: r.motivo,
    }
  }
  const b = r.board
  return {
    kind: 'ok',
    chave: b.chave,
    nome: b.nome,
    projeto: b.projeto,
    padrao: b.chave === c.padrao,
    owner: b.owner,
    repos: b.repos.tipo === 'lista' ? b.repos.repos.map(nomeDoRepo) : null,
    unico: b.repoUnico === null ? null : nomeDoRepo(b.repoUnico),
    urlDoMandato: `https://github.com/${b.mandato.repo.owner}/${b.mandato.repo.name}/blob/${b.mandato.ref}/${b.mandato.caminho}`,
  }
}

/**
 * As fontes da Sala de cada board, para o app (#157): os recursos e as worktrees. A marca do mandato fica
 * em cache por chave (um `criarMarcaEmCache` por board, criado na primeira leitura dele).
 */
export function fontesDoApp(o: {
  env: NodeJS.ProcessEnv
  graphql: GraphQLFn
}): (board: BoardComMandato, pasta: string) => FontesDaSala {
  const marcas = new Map<string, ReturnType<typeof criarMarcaEmCache>>()
  return (board, pasta) => {
    let marca = marcas.get(board.chave)
    if (marca === undefined) {
      marca = criarMarcaEmCache(
        () => lerMandatoDoBoard(o.graphql, board),
        () => Date.now(),
      )
      marcas.set(board.chave, marca)
    }
    const marcaDoBoard = marca
    const nomesDosRepos = board.repos.tipo === 'lista' ? board.repos.repos.map((r) => r.name) : []
    const comDirEnv = o.env.OC_FABRICA_DIR !== undefined && o.env.OC_FABRICA_DIR !== ''
    return {
      recursos: () =>
        lerRecursos(
          portasReais({ env: o.env, pastaDaFabrica: pasta, marca: marcaDoBoard, nomesDosRepos }),
        ),
      worktrees: () => worktreesDo(comDirEnv ? dirname(dirname(pasta)) : board.workspace),
    }
  }
}
