import type { BoardNaFabricaOk } from '../../src/shared/fabrica'

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
