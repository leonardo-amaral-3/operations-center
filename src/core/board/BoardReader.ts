import { MAX_PAGES, selectByAlias } from './envelope'
import { SEM_FASES, linkPhases } from './epics'
import { asArray, asNumber, asRecord, asString } from './narrow'
import { BOARD_QUERY, CARD_FIELDS, STATUS_FIELD } from './query'
import { CONVERSABLE, isTriage, normalizeStation } from './stations'
import type {
  Board,
  BoardCard,
  BoardCardField,
  BoardCardParent,
  BoardColumn,
  GraphQLFn,
} from './types'

/**
 * O teto de páginas mudou de casa — é regra de envelope, não de board —, mas continua visível
 * daqui: quem lê um leitor paginado procura o teto dele no próprio leitor.
 */
export { MAX_PAGES }

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

      const project = selectByAlias(response, 'projectV2')
      if (page === 0) {
        title = asString(project['title']) ?? ''
        columns = readColumns(project)
      }

      const items = readItems(project)
      for (const node of items.nodes) {
        const card = toCard(node)
        if (card) cards.push(card)
      }

      // A inversão roda **aqui**, no retorno alcançado só quando não há mais página: com `cards` já
      // acumulado de todas elas. Movê-la para dentro do corpo do laço produziria um épico com metade
      // das fases — a fase na página 2, o épico na 1 — e sem erro nenhum.
      if (!items.hasNextPage) return { title, columns, cards: linkPhases(cards, columns) }
      cursor = items.endCursor
    }

    throw new Error(
      `o board devolveu mais de ${MAX_PAGES} páginas de itens — pageInfo provavelmente malformado`,
    )
  }
}

/**
 * Regra 3: as colunas são as opções do campo `Status`, na ordem em que o board as declara — nunca
 * uma lista fixa no código. Board sem o campo é board que não espelha a esteira, e vale mais
 * quebrar alto do que desenhar um kanban de uma coluna só.
 *
 * É aqui que a coluna também descobre se conversa. A decisão nasce no core, e não na tela, porque
 * ela é regra de produto: a estação tem chat se a norma da esteira lhe dá uma skill `gm-*`.
 */
function readColumns(project: Record<string, unknown>): readonly BoardColumn[] {
  const options = asArray(asRecord(project['field'])?.['options'])
  const columns: BoardColumn[] = []

  for (const raw of options) {
    const option = asRecord(raw)
    const id = asString(option?.['id'])
    const name = asString(option?.['name'])
    if (id !== null && name !== null) {
      columns.push({
        id,
        name,
        conversable: CONVERSABLE.has(normalizeStation(name)),
        triage: isTriage(name),
      })
    }
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
    parent: readParent(content),
    // `phases` não sai daqui: um cartão sozinho não sabe quem são as filhas dele. Quem as descobre
    // precisa do retrato inteiro — de todas as páginas —, e `toCard` só enxerga um nó por vez.
    phases: SEM_FASES,
  }
}

/**
 * O épico de que este cartão é fase, ou `null`.
 *
 * `parent` **ausente** e `parent: null` caem os dois em `null` pelo `asRecord`, e é o que mantém a
 * captura real de `tests/fixtures/board.json` valendo sem retoque: os nós de lá são de antes de o
 * documento pedir o campo, e narram para o mesmo resultado que a API daria hoje.
 *
 * Pai **sem número** é descartado: sem ele não há o que desenhar no crachá nem por onde cruzar. Já
 * `title` e `repository` tortos viram `''` em vez de matar o vínculo — a mesma escolha que
 * `toCard` faz com o `repository` do próprio cartão.
 */
function readParent(content: Record<string, unknown>): BoardCardParent | null {
  const parent = asRecord(content['parent'])
  if (!parent) return null

  const number = asNumber(parent['number'])
  if (number === null) return null

  return {
    number,
    title: asString(parent['title']) ?? '',
    repository: asString(asRecord(parent['repository'])?.['nameWithOwner']) ?? '',
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
