/**
 * O cliente REST do GitHub — a `RestGetFn` de verdade que o `core` recebe injetada.
 *
 * Existe para o que o GraphQL não entrega: a lista de arquivos do PR com o `patch` de cada um. O
 * método é **GET e fixo**: a `RestGetFn` só tem o caminho como parâmetro, então não há como pedir
 * outro verbo — e a canária `board-readonly` prova que este é o único `method` do arquivo.
 */

import type { RestGetFn } from '../../core'
import type { TokenSource } from './token'

const BASE = 'https://api.github.com/'

/** Quanto do corpo de uma resposta ruim entra na mensagem de erro. O bastante para diagnosticar. */
const MAX_CORPO = 500

const TOKEN_RECUSADO =
  'o GitHub recusou o token mesmo depois de relê-lo do gh (401). Rode `gh auth login`.'

export function createGitHubRest(tokens: TokenSource): RestGetFn {
  return async (path) => {
    const response = await send(await tokens.get(), path)
    if (response.status !== 401) return await corpo(response)

    // Mesmo contrato do GraphQL: um 401 é o token do gh expirando. Drena, descarta o cache e tenta
    // **uma** vez; o segundo 401 é problema de login.
    await response.text()
    tokens.invalidate()

    const retried = await send(await tokens.get(), path)
    if (retried.status === 401) {
      await retried.text()
      throw new Error(TOKEN_RECUSADO)
    }

    return await corpo(retried)
  }
}

function send(token: string, path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'operations-center',
    },
  })
}

async function corpo(response: Response): Promise<unknown> {
  if (!response.ok) {
    const texto = (await response.text()).slice(0, MAX_CORPO)

    throw new Error(`o GitHub respondeu ${String(response.status)}: ${texto}`)
  }

  return await response.json()
}
