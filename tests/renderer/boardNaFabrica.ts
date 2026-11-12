import type { BoardNaFabrica, BoardNaFabricaOk } from '../../src/shared/fabrica'

/** O board padrão do app, como o `fabrica:read-board` o devolve (#157). */
export const BOARD_DO_PROJECT_2: BoardNaFabricaOk = {
  kind: 'ok',
  chave: 'leonardo-amaral-3/2',
  nome: 'Operations Center',
  projeto: 2,
  padrao: true,
  owner: 'leonardo-amaral-3',
  repos: ['leonardo-amaral-3/operations-center'],
  unico: 'leonardo-amaral-3/operations-center',
  urlDoMandato:
    'https://github.com/leonardo-amaral-3/operations-center/blob/dev/fabrica/MANDATO.md',
}

/** O board de teste `fulano/8` (dois repos), como o `fabrica:read-board` o devolve (#157). */
export const BOARD_DE_DOIS_REPOS: BoardNaFabricaOk = {
  kind: 'ok',
  chave: 'fulano/8',
  nome: 'Board de Dois Repos',
  projeto: 8,
  padrao: false,
  owner: 'fulano',
  repos: ['fulano/repo-a', 'fulano/repo-b'],
  unico: null,
  urlDoMandato: 'https://github.com/fulano/repo-a/blob/dev/fabrica/MANDATO.md',
}

/**
 * O `readFabricaBoard` dos mocks de `window.oc` (#157), que responde por board como o main: `null` e a chave
 * do Project 2 → o padrão; `fulano/8` → o de dois repos; qualquer outra chave → recusado, com o motivo
 * "não está configurado" do `resolverBoard`.
 */
export function readFabricaBoardDeTeste(p: { board: string | null }): Promise<BoardNaFabrica> {
  if (p.board === null || p.board === BOARD_DO_PROJECT_2.chave) {
    return Promise.resolve(BOARD_DO_PROJECT_2)
  }
  if (p.board === BOARD_DE_DOIS_REPOS.chave) return Promise.resolve(BOARD_DE_DOIS_REPOS)

  return Promise.resolve({
    kind: 'recusado',
    chave: p.board,
    motivo: `o board ${p.board} não está configurado em fabrica/boards.json: falta a entrada dele (repo, workspace, pasta de estado e mandato)`,
  })
}
