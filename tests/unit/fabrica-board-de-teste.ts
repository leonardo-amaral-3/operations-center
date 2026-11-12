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

/** Entrada crua de um board de dois repos: `fulano/8`, repos `fulano/repo-a` e `fulano/repo-b`. */
export function boardDeDoisRepos(p: { raiz: string }): unknown {
  return {
    owner: 'fulano',
    projeto: 8,
    nome: 'Board de Dois Repos',
    repos: ['fulano/repo-a', 'fulano/repo-b'],
    workspace: join(p.raiz, 'ws2'),
    pastaDoEstado: join(p.raiz, 'estado2'),
    proibidos: { caminhos: [join(p.raiz, 'vivo2')], motivo: 'o que o board de dois repos proíbe' },
    mandato: {
      repo: 'fulano/repo-a',
      ref: 'dev',
      caminho: 'fabrica/MANDATO.md',
      aprovacao: 'teste',
    },
  }
}

/** O repo do board `padrao` (`leonardo-amaral-3/operations-center`). */
export const REPO_TESTE: RepoDoBoard = { owner: 'leonardo-amaral-3', name: 'operations-center' }

/**
 * Duas boards (#157): o Project 2 real, com a pasta de estado em `<raiz>/estado1`, e o `fulano/8` de
 * `boardDeDoisRepos` (`<raiz>/estado2`). `semMandato` tira o `mandato` do segundo.
 */
export function configuracaoComDoisBoards(p: {
  raiz: string
  home: string
  semMandato?: boolean
}): ConfiguracaoDaFabrica {
  const cru = JSON.parse(
    readFileSync(join(__dirname, '..', '..', 'fabrica', 'boards.json'), 'utf8'),
  ) as { padrao: string; boards: EntradaCrua[] }
  const padrao = cru.boards.find((b) => `${b.owner}/${b.projeto}` === cru.padrao)!
  const segundo = boardDeDoisRepos({ raiz: p.raiz }) as Record<string, unknown>
  return parseConfiguracao(
    {
      versao: 1,
      padrao: cru.padrao,
      boards: [
        { ...padrao, pastaDoEstado: join(p.raiz, 'estado1') },
        p.semMandato ? { ...segundo, mandato: null } : segundo,
      ],
    },
    p.home,
  )
}
