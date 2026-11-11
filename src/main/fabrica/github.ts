import { execFile } from 'node:child_process'
import type { GraphQLFn } from '../../core/board/types'
import { ITEM_NO_BOARD_QUERY, type ItemNoBoard } from '../../core/fabrica/estacao'
import {
  MANDATO_DA_DEV_QUERY,
  PROJETO_DA_FABRICA,
  REPO_DA_FABRICA,
  textoDoMandato,
} from '../../core/fabrica/mandato'

/**
 * A fábrica só **lê** o GitHub (card 121, spec P2 §9): o mandato da `dev` e o Status de um card.
 * Quem move card é a sessão, pela skill.
 */

/** O `fabrica/MANDATO.md` da `dev`, pelo `gh api` e não pelo `git` (Decisão 10 do épico). */
export function lerMandato(): Promise<string> {
  const caminho = `repos/${REPO_DA_FABRICA.owner}/${REPO_DA_FABRICA.name}/contents/fabrica/MANDATO.md?ref=dev`
  return new Promise((resolver, rejeitar) => {
    execFile(
      'gh',
      ['api', '-H', 'Accept: application/vnd.github.raw', caminho],
      { maxBuffer: 4 * 1024 * 1024 },
      (erro, stdout, stderr) => {
        if (erro !== null) {
          rejeitar(new Error(`mandato ilegível na dev: ${stderr.trim() || erro.message}`))
        } else if (stdout.trim() === '') {
          rejeitar(new Error('mandato ilegível na dev: vazio'))
        } else {
          resolver(stdout)
        }
      },
    )
  })
}

/** O mesmo mandato, pela GraphQL do app: é a que tem fixture, então o smoke não toca a rede. */
export async function lerMandatoPelaGraphQL(graphql: GraphQLFn): Promise<string> {
  return textoDoMandato(
    await graphql(MANDATO_DA_DEV_QUERY, {
      owner: REPO_DA_FABRICA.owner,
      name: REPO_DA_FABRICA.name,
    }),
  )
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

/** Onde o card está no Project 2. Card fechado ou inexistente lança. */
export async function lerItemNoBoard(graphql: GraphQLFn, card: number): Promise<ItemNoBoard> {
  const resposta = await graphql(ITEM_NO_BOARD_QUERY, {
    owner: REPO_DA_FABRICA.owner,
    name: REPO_DA_FABRICA.name,
    n: card,
  })
  const primeiro = resposta.errors?.[0]
  if (primeiro !== undefined) throw new Error(primeiro.message)
  const issue = (resposta.data as Resposta | null)?.repository?.issue ?? null
  if (issue === null) {
    throw new Error(`não há issue #${card} em ${REPO_DA_FABRICA.owner}/${REPO_DA_FABRICA.name}`)
  }
  if (issue.state === 'CLOSED') throw new Error(`o #${card} está fechado`)
  const item = issue.projectItems.nodes.find((n) => n.project.number === PROJETO_DA_FABRICA)
  if (item === undefined) return { noProjeto: false }
  return { noProjeto: true, status: item.fieldValueByName?.name ?? null }
}
