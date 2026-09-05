/**
 * A `GraphQLFn` de fixture: o mesmo contrato, servido de um arquivo.
 *
 * É a porta que torna o smoke do kanban determinístico — sem rede, sem token e sem cota. O arquivo
 * guarda o **envelope cru da API**, e não um `Board` já traduzido, de propósito: uma fixture do
 * objeto pronto pularia o parsing, que é a parte que mais tem como quebrar.
 */

import { readFile } from 'node:fs/promises'

import type { GraphQLFn, GraphQLResponse } from '../../core'

/**
 * Lê e parseia a cada chamada, ignorando o documento e as variáveis — um app apontado para fixture
 * não tem por que ficar mais rápido, e reler deixa trocar o arquivo com o app de pé.
 *
 * O caminho é usado como veio: o smoke passa caminho **absoluto**, para não depender de qual é a
 * `cwd` do processo do Electron.
 */
export function createFixtureGraphQL(path: string): GraphQLFn {
  return async () => {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as GraphQLResponse

    // Só `data` e `errors` saem daqui: chaves de topo desconhecidas no arquivo são ignoradas.
    return { data: parsed.data, errors: parsed.errors }
  }
}
