import { execFile } from 'node:child_process'
import type { GraphQLFn } from '../../core/board/types'
import { ITEM_NO_BOARD_QUERY, type ItemNoBoard } from '../../core/fabrica/estacao'
import {
  motivoSemMandato,
  nomeDoRepo,
  type BoardDaFabrica,
  type OrigemDoMandato,
} from '../../core/fabrica/configuracao'
import { MANDATO_QUERY, textoDoMandato } from '../../core/fabrica/mandato'

/**
 * A fábrica só **lê** o GitHub (card 121, spec P2 §9): o mandato da `dev` e o Status de um card.
 * Quem move card é a sessão, pela skill.
 */

/** O caminho do `gh api` que lê o mandato na origem que o board declara. */
export function caminhoDoMandato(origem: OrigemDoMandato): string {
  return `repos/${origem.repo.owner}/${origem.repo.name}/contents/${origem.caminho}?ref=${encodeURIComponent(origem.ref)}`
}

/** O mandato do board, pelo `gh api` e não pelo `git` (Decisão 10 do épico). */
export function lerMandato(origem: OrigemDoMandato): Promise<string> {
  const caminho = caminhoDoMandato(origem)
  return new Promise((resolver, rejeitar) => {
    execFile(
      'gh',
      ['api', '-H', 'Accept: application/vnd.github.raw', caminho],
      { maxBuffer: 4 * 1024 * 1024 },
      (erro, stdout, stderr) => {
        if (erro !== null) {
          rejeitar(new Error(`mandato ilegível na ${origem.ref}: ${stderr.trim() || erro.message}`))
        } else if (stdout.trim() === '') {
          rejeitar(new Error(`mandato ilegível na ${origem.ref}: vazio`))
        } else {
          resolver(stdout)
        }
      },
    )
  })
}

/** O mesmo mandato, pela GraphQL do app: é a que tem fixture, então o smoke não toca a rede. */
export async function lerMandatoPelaGraphQL(
  graphql: GraphQLFn,
  origem: OrigemDoMandato,
): Promise<string> {
  return textoDoMandato(
    await graphql(MANDATO_QUERY, {
      owner: origem.repo.owner,
      name: origem.repo.name,
      expressao: `${origem.ref}:${origem.caminho}`,
    }),
    origem.ref,
  )
}

/** O mandato do board do app: board sem mandato aprovado rejeita sem tocar a rede. */
export async function lerMandatoDoBoard(
  graphql: GraphQLFn,
  board: BoardDaFabrica,
): Promise<string> {
  if (board.mandato === null) throw new Error(motivoSemMandato(board))
  return lerMandatoPelaGraphQL(graphql, board.mandato)
}

interface Resposta {
  repository: {
    issue: {
      state: string
      projectItems: {
        nodes: { project: { number: number }; fieldValueByName: { name?: string } | null }[]
      }
    } | null
  } | null
}

/** Onde o card está no Project do board. Card fechado ou inexistente lança. */
export async function lerItemNoBoard(
  graphql: GraphQLFn,
  board: Pick<BoardDaFabrica, 'repo' | 'projeto'>,
  card: number,
): Promise<ItemNoBoard> {
  const resposta = await graphql(ITEM_NO_BOARD_QUERY, {
    owner: board.repo.owner,
    name: board.repo.name,
    n: card,
  })
  const primeiro = resposta.errors?.[0]
  if (primeiro !== undefined) throw new Error(primeiro.message)
  const issue = (resposta.data as Resposta | null)?.repository?.issue ?? null
  if (issue === null) {
    throw new Error(`não há issue #${card} em ${nomeDoRepo(board.repo)}`)
  }
  if (issue.state === 'CLOSED') throw new Error(`o #${card} está fechado`)
  const item = issue.projectItems.nodes.find((n) => n.project.number === board.projeto)
  if (item === undefined) return { noProjeto: false }
  return { noProjeto: true, status: item.fieldValueByName?.name ?? null }
}
