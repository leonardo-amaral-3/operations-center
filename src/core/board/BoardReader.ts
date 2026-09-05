import { BOARD_QUERY, CARD_FIELDS, STATUS_FIELD } from './query'
import type {
  Board,
  BoardCard,
  BoardCardField,
  BoardColumn,
  GraphQLError,
  GraphQLFn,
} from './types'

export interface BoardReaderDeps {
  /**
   * Injetado, pela mesma razão que o `query` do SDK é: é o que mantém a tradução board→kanban
   * coberta por teste sem rede e sem token. Quem sabe de HTTP, de `gh` e de ambiente é o main.
   */
  graphql: GraphQLFn
}

export interface ReadBoardInput {
  owner: string
  number: number
}

/**
 * Teto de páginas. 2000 cards é ordens de grandeza acima de qualquer board real; o teto existe para
 * que um `pageInfo` malformado vire erro em vez de laço infinito.
 */
export const MAX_PAGES = 20

/** Os dois aliases do documento, na ordem de preferência. */
const ALIASES = ['user', 'organization'] as const

type Alias = (typeof ALIASES)[number]

/** Um `projectV2` que resolveu, e por qual alias — o outro é o que pode falhar impunemente. */
interface ResolvedProject {
  alias: Alias
  project: Record<string, unknown>
}

/** Um valor single-select do item, já achatado. */
interface SingleSelectValue {
  value: string
  optionId: string
}

/** Uma página de itens do board. */
interface ItemsPage {
  nodes: readonly unknown[]
  hasNextPage: boolean
  endCursor: string | null
}

/**
 * Traduz o board do GitHub no `Board` que a tela desenha.
 *
 * Sabe de GraphQL o suficiente para ler um envelope, e de mais nada: não fala HTTP, não lê
 * ambiente e não spawna processo. Toda a regra de negócio deste card mora aqui.
 */
export class BoardReader {
  readonly #graphql: GraphQLFn

  constructor(deps: BoardReaderDeps) {
    this.#graphql = deps.graphql
  }

  async read(input: ReadBoardInput): Promise<Board> {
    const cards: BoardCard[] = []
    let title = ''
    let columns: readonly BoardColumn[] = []
    let cursor: string | null = null

    // Título e colunas vêm da primeira página; as demais só acrescentam cartões.
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.#graphql(BOARD_QUERY, {
        owner: input.owner,
        number: input.number,
        cursor,
      })

      const project = selectProject(response)
      if (page === 0) {
        title = asString(project['title']) ?? ''
        columns = readColumns(project)
      }

      const items = readItems(project)
      for (const node of items.nodes) {
        const card = toCard(node)
        if (card) cards.push(card)
      }

      if (!items.hasNextPage) return { title, columns, cards }
      cursor = items.endCursor
    }

    throw new Error(
      `o board devolveu mais de ${MAX_PAGES} páginas de itens — pageInfo provavelmente malformado`,
    )
  }
}

/**
 * Regras 1 e 2: escolhe o alias que resolveu e decide quais erros são toleráveis.
 *
 * A resposta real do board deste projeto (owner usuário) vem com `data.user` preenchido,
 * `data.organization: null` **e** um `NOT_FOUND` em `errors` apontando para `["organization"]`.
 * Ignorar só esse erro — o do alias que não foi usado — é o que impede o app de engolir em
 * silêncio uma falha de verdade em algum campo.
 */
function selectProject(response: {
  data: unknown
  errors?: readonly GraphQLError[]
}): Record<string, unknown> {
  const errors = response.errors ?? []
  const resolved = pickAlias(response.data)

  if (!resolved) {
    throw new Error(errors[0]?.message ?? 'board não encontrado')
  }

  const unused: Alias = resolved.alias === 'user' ? 'organization' : 'user'
  const fatal = errors.find((error) => error.path?.[0] !== unused)
  if (fatal) throw new Error(fatal.message)

  return resolved.project
}

function pickAlias(data: unknown): ResolvedProject | null {
  const root = asRecord(data)
  if (!root) return null

  for (const alias of ALIASES) {
    const project = asRecord(asRecord(root[alias])?.['projectV2'])
    if (project) return { alias, project }
  }

  return null
}

/**
 * Regra 3: as colunas são as opções do campo `Status`, na ordem em que o board as declara — nunca
 * uma lista fixa no código. Board sem o campo é board que não espelha a esteira, e vale mais
 * quebrar alto do que desenhar um kanban de uma coluna só.
 */
function readColumns(project: Record<string, unknown>): readonly BoardColumn[] {
  const options = asArray(asRecord(project['field'])?.['options'])
  const columns: BoardColumn[] = []

  for (const raw of options) {
    const option = asRecord(raw)
    const id = asString(option?.['id'])
    const name = asString(option?.['name'])
    if (id !== null && name !== null) columns.push({ id, name })
  }

  if (columns.length === 0) {
    throw new Error(
      `o board não declara o campo single-select "${STATUS_FIELD}" — sem ele não há esteira para espelhar`,
    )
  }

  return columns
}

function readItems(project: Record<string, unknown>): ItemsPage {
  const items = asRecord(project['items'])
  const pageInfo = asRecord(items?.['pageInfo'])

  return {
    nodes: asArray(items?.['nodes']),
    hasNextPage: pageInfo?.['hasNextPage'] === true,
    endCursor: asString(pageInfo?.['endCursor']),
  }
}

/**
 * Regras 4 e 5: quem vira cartão, e com quais etiquetas.
 *
 * Ficam de fora, em silêncio: rascunho do Projects (não tem número nem repo, e a unidade do
 * produto é o card), pull request (não é estação da esteira) e item sem `Status` (não pertence a
 * coluna nenhuma). Issue **fechada entra** — sem ela a coluna de Produção nasce e morre vazia, e o
 * kanban mentiria sobre a última estação.
 */
function toCard(node: unknown): BoardCard | null {
  const item = asRecord(node)
  if (!item) return null

  const itemId = asString(item['id'])
  const content = asRecord(item['content'])
  if (itemId === null || !content || content['__typename'] !== 'Issue') return null

  const number = asNumber(content['number'])
  const title = asString(content['title'])
  const url = asString(content['url'])
  if (number === null || title === null || url === null) return null

  const values = readSingleSelects(item)
  const status = values.get(STATUS_FIELD)
  if (!status) return null

  const fields: BoardCardField[] = []
  for (const name of CARD_FIELDS) {
    const chosen = values.get(name)
    if (chosen) fields.push({ name, value: chosen.value, optionId: chosen.optionId })
  }

  return {
    itemId,
    number,
    title,
    url,
    repository: asString(asRecord(content['repository'])?.['nameWithOwner']) ?? '',
    closed: content['closed'] === true,
    assignees: readAssignees(content),
    columnId: status.optionId,
    fields,
  }
}

/**
 * Os single-selects do item, por nome de campo. Valores de outros tipos de campo chegam como nós
 * vazios — o documento só pede o fragmento de single-select — e caem fora sozinhos.
 */
function readSingleSelects(item: Record<string, unknown>): Map<string, SingleSelectValue> {
  const values = new Map<string, SingleSelectValue>()

  for (const raw of asArray(asRecord(item['fieldValues'])?.['nodes'])) {
    const node = asRecord(raw)
    const field = asString(asRecord(node?.['field'])?.['name'])
    const value = asString(node?.['name'])
    const optionId = asString(node?.['optionId'])
    if (field === null || value === null || optionId === null) continue
    if (!values.has(field)) values.set(field, { value, optionId })
  }

  return values
}

function readAssignees(content: Record<string, unknown>): readonly string[] {
  const logins: string[] = []

  for (const raw of asArray(asRecord(content['assignees'])?.['nodes'])) {
    const login = asString(asRecord(raw)?.['login'])
    if (login !== null) logins.push(login)
  }

  return logins
}

/**
 * Regra 7: a resposta é dado externo e chega como `unknown`; cada acesso passa por uma destas
 * guardas. Sem biblioteca de validação, de propósito — `zod` é um dos peers ausentes do card #2, e
 * trazê-lo aqui misturaria os dois assuntos.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
