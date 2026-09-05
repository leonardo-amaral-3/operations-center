/**
 * O cliente HTTP do GitHub — a `GraphQLFn` de verdade que o `core` recebe injetada.
 *
 * Mora no main porque é aqui que o mundo externo tem endereço: o `core` não fala HTTP, exatamente
 * como não conhece `electron`. E não traz dependência nova: `fetch` é global no Node 22, que já é o
 * piso do repo.
 */

import type { GraphQLFn, GraphQLResponse } from '../../core'
import type { TokenSource } from './token'

const ENDPOINT = 'https://api.github.com/graphql'

/** Quanto do corpo de uma resposta ruim entra na mensagem de erro. O bastante para diagnosticar. */
const MAX_CORPO = 500

const TOKEN_RECUSADO =
  'o GitHub recusou o token mesmo depois de relê-lo do gh (401). Rode `gh auth login`.'

export function createGitHubGraphQL(tokens: TokenSource): GraphQLFn {
  return async (document, variables) => {
    const response = await send(await tokens.get(), document, variables)
    if (response.status !== 401) return await envelope(response)

    // Um 401 com o app aberto é o token OAuth do gh expirando. Descarta o cache e tenta **uma** vez;
    // um segundo 401 é problema de login, não de cache, e insistir só empilharia chamadas.
    //
    // O corpo precisa ser drenado mesmo sem interessar: resposta não lida prende o socket.
    await response.text()
    tokens.invalidate()

    const retried = await send(await tokens.get(), document, variables)
    if (retried.status === 401) {
      await retried.text()
      throw new Error(TOKEN_RECUSADO)
    }

    return await envelope(retried)
  }
}

function send(
  token: string,
  document: string,
  variables: Record<string, unknown>,
): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'operations-center',
    },
    body: JSON.stringify({ query: document, variables }),
  })
}

/**
 * Devolve o envelope **cru**. Quem decide se um erro é tolerável é o `BoardReader`, que sabe qual
 * alias usou; o cliente HTTP não tem essa informação e não deve inventá-la.
 */
async function envelope(response: Response): Promise<GraphQLResponse> {
  if (!response.ok) {
    const corpo = (await response.text()).slice(0, MAX_CORPO)

    throw new Error(`o GitHub respondeu ${String(response.status)}: ${corpo}`)
  }

  const parsed = (await response.json()) as GraphQLResponse

  return { data: parsed.data, errors: parsed.errors }
}
