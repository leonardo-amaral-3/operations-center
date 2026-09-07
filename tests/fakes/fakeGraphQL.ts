import type { GraphQLError, GraphQLFn, GraphQLResponse } from '../../src/core/board/types'

/** Uma chamada que chegou ao cliente falso — é por aqui que se verifica a paginação. */
export interface FakeGraphQLCall {
  document: string
  variables: Record<string, unknown>
}

export interface FakeGraphQL {
  /** Entra no lugar do cliente HTTP de verdade. */
  readonly graphql: GraphQLFn
  /** O que o leitor pediu, na ordem em que pediu. */
  readonly calls: readonly FakeGraphQLCall[]
}

/**
 * Um cliente GraphQL de mentira, com páginas roteirizadas.
 *
 * Cumpre para o board o mesmo papel que `fakeQuery` cumpre para sessão: é o que permite exercitar
 * a tradução inteira sem rede e sem token — a razão de a `GraphQLFn` ser injetada.
 *
 * **Esgotadas as páginas, a última se repete.** Não é preguiça: é o que deixa escrever o caso do
 * `pageInfo` malformado (uma página só, dizendo eternamente `hasNextPage: true`) sem roteiro de
 * vinte entradas — exatamente o laço infinito contra o qual o `MAX_PAGES` existe.
 */
export function createFakeGraphQL(...pages: readonly GraphQLResponse[]): FakeGraphQL {
  const calls: FakeGraphQLCall[] = []
  const roteiro = pages.length > 0 ? pages : [envelope()]

  const graphql: GraphQLFn = (document, variables) => {
    calls.push({ document, variables })
    const page = roteiro[Math.min(calls.length - 1, roteiro.length - 1)]
    return Promise.resolve(page as GraphQLResponse)
  }

  return { graphql, calls }
}

/**
 * As oito estações deste board, na ordem em que ele as declara — e o `conversable` que cada uma
 * deve sair valendo.
 *
 * O `conversable` **não** existe na resposta da API: `envelope()` o descarta ao montar as opções do
 * campo `Status`. Ele vive aqui porque é a resposta esperada da regra, ao lado do insumo que a
 * produz; separar os dois em duas listas paralelas seria convidar uma a envelhecer sem a outra.
 */
export const STATUS_OPTIONS = [
  { id: 'opt-triagem', name: '📥 Triagem', conversable: true },
  { id: 'opt-backlog', name: '📋 Backlog', conversable: true },
  { id: 'opt-spec', name: '🎯 Especificação', conversable: true },
  { id: 'opt-impl', name: '🔨 Implementação', conversable: true },
  { id: 'opt-revisao', name: '👀 Revisão', conversable: true },
  { id: 'opt-validacao', name: '🧪 Validação em Dev', conversable: false },
  { id: 'opt-release', name: '🚂 Release', conversable: true },
  { id: 'opt-producao', name: '✅ Produção', conversable: false },
] as const

export interface EnvelopeInput {
  /** Qual alias resolve. O outro vem `null`, com o `NOT_FOUND` que a API real manda junto. */
  alias?: 'user' | 'organization'
  title?: string
  /** As opções do campo `Status`, na ordem. `null` = board que não declara o campo. */
  options?: readonly { id: string; name: string }[] | null
  items?: readonly Record<string, unknown>[]
  hasNextPage?: boolean
  endCursor?: string | null
  /** Substitui os erros. O default é só o `NOT_FOUND` do alias que não resolveu. */
  errors?: readonly GraphQLError[]
}

/**
 * Uma resposta na forma em que a API de verdade a devolve: um alias preenchido, o outro `null`, e
 * o `NOT_FOUND` dele em `errors` — o erro parcial que a regra 2 tolera.
 */
export function envelope(input: EnvelopeInput = {}): GraphQLResponse {
  const {
    alias = 'user',
    title = 'Operations Center',
    options = STATUS_OPTIONS,
    items = [],
    hasNextPage = false,
    endCursor = null,
    errors,
  } = input

  const outro = alias === 'user' ? 'organization' : 'user'
  const project = {
    title,
    // Só `id` e `name`: o board de verdade não sabe o que é `conversable`, e o fake que o
    // devolvesse deixaria de provar que a conclusão é do leitor.
    field: options === null ? null : { options: options.map(({ id, name }) => ({ id, name })) },
    items: { pageInfo: { hasNextPage, endCursor }, nodes: items },
  }

  return {
    data: { [alias]: { projectV2: project }, [outro]: null },
    errors: errors ?? [notFound(outro)],
  }
}

/** O erro que a API manda para o alias que não resolveu. */
export function notFound(alias: 'user' | 'organization'): GraphQLError {
  const tipo = alias === 'user' ? 'User' : 'Organization'
  return { message: `Could not resolve to a ${tipo} with the login of 'dono'.`, path: [alias] }
}

export interface IssueItemInput {
  id: string
  number: number
  title?: string
  url?: string
  repository?: string
  closed?: boolean
  assignees?: readonly string[]
  /**
   * Os single-selects do item, na forma do board: nome do campo → `[nome da opção, optionId]`.
   * `Status` é um deles — item sem `Status` é item que a regra 4 deixa de fora.
   */
  fields?: Readonly<Record<string, readonly [value: string, optionId: string]>>
}

export function issueItem(input: IssueItemInput): Record<string, unknown> {
  const {
    id,
    number,
    title = `Card ${number}`,
    url = `https://github.com/dono/repo/issues/${number}`,
    repository = 'dono/repo',
    closed = false,
    assignees = [],
    fields = {},
  } = input

  return {
    id,
    content: {
      __typename: 'Issue',
      number,
      title,
      url,
      closed,
      repository: { nameWithOwner: repository },
      assignees: { nodes: assignees.map((login) => ({ login })) },
    },
    fieldValues: { nodes: fieldValueNodes(fields) },
  }
}

/** Um rascunho do Projects: sem número, sem repo — e **com** `Status`, para provar o filtro por tipo. */
export function draftItem(id: string, status = STATUS_OPTIONS[0].id): Record<string, unknown> {
  return {
    id,
    content: { __typename: 'DraftIssue', title: 'uma ideia solta' },
    fieldValues: { nodes: fieldValueNodes({ Status: ['📥 Triagem', status] }) },
  }
}

/** Uma pull request no board — também com `Status`, e também fora da esteira. */
export function pullRequestItem(
  id: string,
  number: number,
  status = STATUS_OPTIONS[3].id,
): Record<string, unknown> {
  return {
    id,
    content: {
      __typename: 'PullRequest',
      number,
      title: `PR ${number}`,
      url: `https://github.com/dono/repo/pull/${number}`,
      closed: false,
      repository: { nameWithOwner: 'dono/repo' },
      assignees: { nodes: [] },
    },
    fieldValues: { nodes: fieldValueNodes({ Status: ['🔨 Implementação', status] }) },
  }
}

/**
 * Os nós de `fieldValues`. O primeiro é sempre um nó vazio: o documento só pede o fragmento de
 * single-select, então todo campo de outro tipo (texto, número, data) chega assim na resposta real
 * e o leitor tem de ignorá-lo sem tropeçar.
 */
function fieldValueNodes(
  fields: Readonly<Record<string, readonly [value: string, optionId: string]>>,
): readonly Record<string, unknown>[] {
  return [
    {},
    ...Object.entries(fields).map(([name, [value, optionId]]) => ({
      optionId,
      name: value,
      field: { name },
    })),
  ]
}
