import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseConfiguracao,
  type ConfiguracaoDaFabrica,
  type RepoDoBoard,
} from '../../src/core/fabrica/configuracao'

interface EntradaCrua {
  owner: string
  projeto: number
  [campo: string]: unknown
}

/**
 * A configuração real (`fabrica/boards.json`), com o board padrão apontado para um workspace de teste,
 * para que nenhum teste toque a pasta viva da fábrica.
 */
export function configuracaoDeTeste(p: {
  home: string
  workspace: string
  extras?: readonly unknown[]
}): ConfiguracaoDaFabrica {
  const cru = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'fabrica', 'boards.json'), 'utf8'),
  ) as { padrao: string; boards: EntradaCrua[] }
  const boards = cru.boards.map((b) =>
    `${b.owner}/${b.projeto}` === cru.padrao
      ? {
          ...b,
          workspace: p.workspace,
          checkoutPrincipal: join(p.workspace, 'operations-center'),
          pastaDoEstado: join(p.workspace, 'claude', 'despachos-fabrica'),
        }
      : b,
  )
  return parseConfiguracao({ ...cru, boards: [...boards, ...(p.extras ?? [])] }, p.home)
}

/** Entrada crua (formato do boards.json) de um board que não existe: `fulano/7`. */
export function boardFicticio(p: { home: string; raiz: string; mandato: boolean }): unknown {
  return {
    owner: 'fulano',
    projeto: 7,
    nome: 'Board Fictício',
    repo: 'fulano/repo-x',
    workspace: join(p.raiz, 'ws'),
    checkoutPrincipal: join(p.raiz, 'ws', 'repo-x'),
    pastaDoEstado: join(p.raiz, 'estado'),
    proibidos: { caminhos: [join(p.raiz, 'vivo')], motivo: 'o que o board fictício proíbe' },
    mandato: p.mandato
      ? { repo: 'fulano/repo-x', ref: 'dev', caminho: 'fabrica/MANDATO.md', aprovacao: 'teste' }
      : null,
  }
}

/** O repo do board `padrao` (`leonardo-amaral-3/operations-center`). */
export const REPO_TESTE: RepoDoBoard = { owner: 'leonardo-amaral-3', name: 'operations-center' }
