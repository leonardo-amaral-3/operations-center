import { join } from 'node:path'

import type { GraphQLFn } from '../../core/board/types'
import {
  argsDoGitLog,
  decisoesDoDia,
  emMarkdown,
  janelaDoDia,
  lerCards,
  lerCommits,
  lerNumerosMovidos,
  lerObjetivos,
  montarRelatorio,
} from '../../core/relatorio'

/**
 * O miolo do relatório (#126, spec-p3 §B1): o que o `yarn relatorio` (#120) e a sala da fábrica
 * compartilham. Só lê (cofre, board e git); nada daqui escreve em nenhum dos três. O relatório é o
 * da fábrica, que é este repo (Technical Decisions, 11).
 */

export const REPO = { owner: 'leonardo-amaral-3', name: 'operations-center' }
export const PROJETO = 2

export interface DepsDoRelatorio {
  existe: (caminho: string) => boolean
  listarPasta: (pasta: string) => Promise<string[]>
  lerArquivo: (caminho: string) => Promise<string>
  git: (args: readonly string[], cwd: string) => Promise<string>
  graphql: GraphQLFn
}

export interface PedidoDoRelatorio {
  /** `AAAA-MM-DD`, já validado. */
  dia: string
  pastaDoCofre: string
  pastaDoRepo: string
  /** ISO 8601. */
  geradoEm: string
}

/** `AAAA-MM-DD` que existe no calendário: `2026-02-30` e `2026-13-01` não passam. */
export function dataValida(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false

  const d = new Date(`${dia}T00:00:00Z`)

  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dia
}

/** Gera o markdown do dia. A exceção de qualquer leitura sobe para quem chamou. */
export async function gerarRelatorio(
  deps: DepsDoRelatorio,
  pedido: PedidoDoRelatorio,
): Promise<{ markdown: string; semFonte: number }> {
  const { dia, pastaDoCofre, pastaDoRepo, geradoEm } = pedido
  const janela = janelaDoDia(dia)
  const nomes = (await deps.listarPasta(pastaDoCofre)).filter((n) => n.endsWith('.md'))
  // Em lotes: o cofre passa de mil arquivos e abri-los todos de uma vez estoura o limite de fds.
  const arquivos: { nome: string; texto: string }[] = []
  for (let i = 0; i < nomes.length; i += 64) {
    arquivos.push(
      ...(await Promise.all(
        nomes.slice(i, i + 64).map(async (nome) => ({
          nome,
          texto: await deps.lerArquivo(join(pastaDoCofre, nome)),
        })),
      )),
    )
  }
  const { decisoes, ilegiveis } = decisoesDoDia(arquivos, dia, REPO)
  const commits = lerCommits(await deps.git(argsDoGitLog(janela), pastaDoRepo), janela)
  const movidos = await lerNumerosMovidos(deps.graphql, {
    owner: REPO.owner,
    repo: `${REPO.owner}/${REPO.name}`,
    projeto: PROJETO,
    inicio: janela.inicio,
  })
  const numeros = [
    ...new Set([
      ...decisoes.flatMap((d) => (d.card === null ? [] : [d.card])),
      ...commits.flatMap((c) => (c.card === null ? [] : [c.card])),
      ...movidos,
    ]),
  ].sort((a, b) => a - b)
  const cards = await lerCards(deps.graphql, {
    owner: REPO.owner,
    name: REPO.name,
    projeto: PROJETO,
    numeros,
  })
  const direcao = join(pastaDoRepo, 'fabrica', 'DIRECAO.md')
  const objetivos = deps.existe(direcao) ? lerObjetivos(await deps.lerArquivo(direcao)) : null
  const r = montarRelatorio({
    janela,
    repo: REPO,
    projeto: PROJETO,
    pastaDoCofre,
    pastaDoRepo,
    decisoes,
    ilegiveis,
    cards,
    commits,
    objetivos,
  })

  return { markdown: emMarkdown(r, geradoEm), semFonte: r.semFonte }
}
