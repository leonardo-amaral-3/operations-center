/**
 * Os tipos que atravessam a leitura do board.
 *
 * Como `src/core/session/types.ts` faz com os de sessão, o vocabulário do board é **declarado em
 * `src/shared/board.ts`** e apenas republicado aqui: o renderer precisa compilar contra a mesma
 * declaração e não pode importar o `core` para isso.
 *
 * O que é só do core é o contrato do cliente GraphQL. Ele mora aqui, e não no `shared`, porque o
 * envelope cru não atravessa a ponte: quem vê `data`/`errors` é este módulo, e mais ninguém.
 */

export type { Board, BoardCard, BoardCardField, BoardColumn } from '../../shared/board'

/** O envelope de uma resposta GraphQL. `errors` pode vir **junto** com `data` — ver `BoardReader`. */
export interface GraphQLResponse {
  data: unknown
  errors?: readonly GraphQLError[]
}

export interface GraphQLError {
  message: string
  path?: readonly (string | number)[]
}

/**
 * O cliente injetado. É este contrato que o fake dos testes e o cliente de fixture cumprem — e é
 * ele que mantém o core sem HTTP, como a injeção do `query` o manteve sem SDK.
 */
export type GraphQLFn = (
  document: string,
  variables: Record<string, unknown>,
) => Promise<GraphQLResponse>
