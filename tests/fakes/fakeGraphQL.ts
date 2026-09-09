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
  { id: 'opt-triagem', name: '📥 Triagem', conversable: true, triage: true },
  { id: 'opt-backlog', name: '📋 Backlog', conversable: true, triage: false },
  { id: 'opt-spec', name: '🎯 Especificação', conversable: true, triage: false },
  { id: 'opt-impl', name: '🔨 Implementação', conversable: true, triage: false },
  { id: 'opt-revisao', name: '👀 Revisão', conversable: true, triage: false },
  { id: 'opt-validacao', name: '🧪 Validação em Dev', conversable: false, triage: false },
  { id: 'opt-release', name: '🚂 Release', conversable: true, triage: false },
  { id: 'opt-producao', name: '✅ Produção', conversable: false, triage: false },
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
    // Só `id` e `name`: o board de verdade não sabe o que é `conversable` nem o que é `triage`, e o
    // fake que os devolvesse deixaria de provar que as duas conclusões são do leitor.
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
  /**
   * O nó `parent`, cru. **Não passar a opção deixa a chave ausente** — que é a forma da captura
   * real de `tests/fixtures/board.json`, e o caso que `readParent` tem de narrar igual a `null`.
   *
   * `unknown` de propósito, e não um tipo montado: as formas tortas do pai (sem número, sem título,
   * sem repositório) se escrevem literalmente no teste, como o `comments` do `cardEnvelope` já faz
   * com o comentário malformado. Para a forma boa existe `parentNode`.
   */
  parent?: unknown
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
      // `in` e não `!== undefined`: é o que distingue "a issue não tem pai" (chave ausente, como na
      // captura real) de `parent: null`, e os dois são casos separados do teste.
      ...('parent' in input ? { parent: input.parent } : {}),
    },
    fieldValues: { nodes: fieldValueNodes(fields) },
  }
}

/**
 * Um nó `parent` bem formado, como a API o devolve — com o `repository` **dentro** dele.
 *
 * Existe para que o teste não repita a forma aninhada em cada caso: errar o `nameWithOwner` produz
 * um vínculo que some em silêncio, e uma helper é mais barata que descobrir isso pelo vermelho.
 */
export function parentNode(
  number: number,
  title = `Épico ${number}`,
  repository = 'dono/repo',
): Record<string, unknown> {
  return { number, title, repository: { nameWithOwner: repository } }
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

export interface CardEnvelopeInput {
  number?: number
  /** `null` reproduz a issue que veio **sem** `body` — card sem corpo escrito, que é caso normal. */
  body?: string | null
  /**
   * Os nós de `comments`, na ordem em que a API os devolve — que é a cronológica. Aceita
   * `Record<string, unknown>` solto de propósito: o nó malformado do teste de descarte se escreve
   * literalmente ali, e não atrás de uma opção do `commentNode`.
   */
  comments?: readonly Record<string, unknown>[]
  /** Quantos comentários a issue tem ao todo. O default é "todos couberam"; `null` o omite. */
  totalCount?: number | null
  /** O que a resposta não traz: `'repository'` (repo inacessível) ou `'issue'` (card removido). */
  missing?: 'repository' | 'issue'
  /** O `CARD_QUERY` não tem alias duplo, logo não tem erro esperado: o default é **nenhum**. */
  errors?: readonly GraphQLError[]
}

/**
 * Uma resposta do `CARD_QUERY`, na forma em que a API a devolve.
 *
 * Sem o `errors` de brinde que o `envelope()` do board carrega, e a diferença é o assunto da regra
 * 1 do `CardReader`: lá o `NOT_FOUND` do alias que não resolveu é esperado, aqui qualquer erro é
 * fatal.
 */
export function cardEnvelope(input: CardEnvelopeInput = {}): GraphQLResponse {
  const {
    number = 13,
    body = 'o corpo da issue',
    comments = [],
    totalCount,
    missing,
    errors,
  } = input

  const issue =
    missing === 'issue'
      ? null
      : {
          number,
          ...(body === null ? {} : { body }),
          comments: {
            ...(totalCount === null ? {} : { totalCount: totalCount ?? comments.length }),
            nodes: comments,
          },
        }

  return {
    data: { repository: missing === 'repository' ? null : { issue } },
    ...(errors ? { errors } : {}),
  }
}

export interface CommentNodeInput {
  id: string
  body: string
  /** `null` é o que a API devolve para conta removida — e não `''`. */
  author?: string | null
  createdAt?: string
}

/** Um nó de `comments`, como o documento o pede. */
export function commentNode(input: CommentNodeInput): Record<string, unknown> {
  const { id, body, author = 'leonardo-amaral-3', createdAt = '2026-09-06T12:00:00Z' } = input

  return { id, author: author === null ? null : { login: author }, createdAt, body }
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
