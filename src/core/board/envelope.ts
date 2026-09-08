/**
 * O envelope do Projects: o alias que vale, o erro parcial que se tolera e o teto de páginas.
 *
 * São as regras de "como este app lê o Projects", e não de "o que este board significa" — por isso
 * saem do `BoardReader`, que as escreveu primeiro, no momento em que um segundo leitor passa a
 * precisar delas. O que muda na mudança de endereço é só a generalização pelo nome do campo: o
 * mesmo envelope carrega **um** board (`projectV2`) ou **a lista** deles (`projectsV2`).
 */

import { asRecord } from './narrow'
import type { GraphQLError } from './types'

/** Os dois aliases do documento, na ordem de preferência. */
export const ALIASES = ['user', 'organization'] as const

export type Alias = (typeof ALIASES)[number]

/**
 * Teto de páginas. 2000 itens é ordens de grandeza acima de qualquer caso real; o teto existe para
 * que um `pageInfo` malformado vire erro em vez de laço infinito.
 */
export const MAX_PAGES = 20

/** O campo pedido sob os dois aliases: um board, ou a lista de boards de um dono. */
export type AliasedField = 'projectV2' | 'projectsV2'

/** Quem não foi encontrado, para a mensagem dizer a verdade nos dois usos. */
const SUJEITO: Record<AliasedField, string> = { projectV2: 'board', projectsV2: 'dono' }

/** O nó que resolveu, e por qual alias — o outro é o que pode falhar impunemente. */
interface Resolved {
  alias: Alias
  node: Record<string, unknown>
}

/**
 * Regras 1 e 2: escolhe o alias que resolveu e decide quais erros são toleráveis.
 *
 * A resposta real do board deste projeto (owner usuário) vem com `data.user` preenchido,
 * `data.organization: null` **e** um `NOT_FOUND` em `errors` apontando para `["organization"]`.
 * Ignorar só esse erro — o do alias que não foi usado — é o que impede o app de engolir em
 * silêncio uma falha de verdade em algum campo.
 */
export function selectByAlias(
  response: { data: unknown; errors?: readonly GraphQLError[] },
  field: AliasedField,
): Record<string, unknown> {
  const errors = response.errors ?? []
  const resolved = pickAlias(response.data, field)

  if (!resolved) {
    throw new Error(errors[0]?.message ?? `${SUJEITO[field]} não encontrado`)
  }

  const unused: Alias = resolved.alias === 'user' ? 'organization' : 'user'
  const fatal = errors.find((error) => error.path?.[0] !== unused)
  if (fatal) throw new Error(fatal.message)

  return resolved.node
}

function pickAlias(data: unknown, field: AliasedField): Resolved | null {
  const root = asRecord(data)
  if (!root) return null

  for (const alias of ALIASES) {
    const node = asRecord(asRecord(root[alias])?.[field])
    if (node) return { alias, node }
  }

  return null
}
