import { MAX_PAGES, selectByAlias } from './envelope'
import { asArray, asNumber, asRecord, asString } from './narrow'
import { OWNERS_QUERY, PROJECTS_QUERY } from './query'
import { runsEsteira } from './stations'
import type { GraphQLFn } from './types'

/** Um board que roda a esteira. É o insumo de uma aba. */
export interface DiscoveredBoard {
  /** `owner/number`. A chave da aba, e o que fica gravado como aba lembrada. */
  key: string
  owner: string
  number: number
  title: string
}

/** Um dono que não deu para varrer. */
export interface FailedOwner {
  owner: string
  reason: string
}

export interface Discovery {
  /** Os boards que rodam a esteira, **já ordenados**. Pode ser vazia. */
  boards: readonly DiscoveredBoard[]
  /**
   * Os donos que falharam, ou `[]`. Vem **junto** com `boards` de propósito, pela mesma razão que
   * `BoardTab` faz `board` e `error` coexistirem: um dono que caiu não pode apagar os boards
   * dos que responderam, e também não pode falhar em silêncio.
   */
  failed: readonly FailedOwner[]
}

export interface BoardFinderDeps {
  /**
   * Injetada, pela mesma razão que a do `BoardReader` é: é o que mantém a regra de discriminação
   * coberta por teste sem rede e sem token. Quem sabe de HTTP, de `gh` e de ambiente é o main.
   */
  graphql: GraphQLFn
}

/**
 * A ordem das abas. `pt-BR` porque os títulos são em português e `'Ó'` tem de ficar entre `'O'` e
 * `'P'`, e não depois de `'Z'` como a ordem de code point o poria.
 */
const ORDEM = new Intl.Collator('pt-BR')

/**
 * Descobre quais boards do GitHub rodam a esteira `gm-*`.
 *
 * Espelha o `BoardReader` e o `CardReader` até no formato: cliente injetado, zero HTTP, zero
 * ambiente, zero disco. A pergunta que ele responde é a única que separa um Project que vira aba de
 * um que não vira — e ela é de **dados**, não de configuração: nenhum título, número ou dono de
 * board aparece escrito aqui.
 */
export class BoardFinder {
  readonly #graphql: GraphQLFn

  constructor(deps: BoardFinderDeps) {
    this.#graphql = deps.graphql
  }

  async find(): Promise<Discovery> {
    const owners = await this.#readOwners()

    // Passo 2: os donos são varridos em paralelo e **isoladamente**. Uma org com SAML não
    // autorizado ou Projects restritos responde `user: null` + `organization: null` + `FORBIDDEN`,
    // e a regra 1 do envelope lança para aquele dono; com `Promise.all`, um dono irrelevante mataria
    // os boards que importam.
    const varreduras = await Promise.allSettled(owners.map((owner) => this.#readProjects(owner)))

    const nodes: unknown[] = []
    const failed: FailedOwner[] = []
    varreduras.forEach((varredura, indice) => {
      if (varredura.status === 'fulfilled') {
        nodes.push(...varredura.value)
        return
      }

      failed.push({ owner: owners[indice] ?? '', reason: motivo(varredura.reason) })
    })

    // Falharam **todos**: não houve descoberta nenhuma, e rejeitar é o que faz o gatilho seguinte
    // tentar de novo em vez de aceitar uma lista vazia como resposta.
    const primeira = failed[0]
    if (primeira && failed.length === owners.length) throw new Error(primeira.reason)

    const boards: DiscoveredBoard[] = []
    for (const node of nodes) {
      const board = toBoard(node)
      if (board) boards.push(board)
    }

    return { boards: boards.sort(porOrdemDeAba), failed }
  }

  /**
   * Passo 1: eu e as organizações a que pertenço, nesta ordem e sem repetição.
   *
   * **Falha aqui rejeita**, e sem tolerância a erro parcial: o `OWNERS_QUERY` não tem alias duplo,
   * logo não tem erro esperado — é a regra 1 do `CardReader`. Sem a lista de donos não há
   * descoberta nenhuma a relatar, e devolver `[]` faria "não consegui perguntar" passar por
   * "perguntei e não achei board nenhum".
   */
  async #readOwners(): Promise<readonly string[]> {
    const owners = new Set<string>()
    let cursor: string | null = null

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.#graphql(OWNERS_QUERY, { cursor })

      const primeiro = response.errors?.[0]
      if (primeiro) throw new Error(primeiro.message)

      const viewer = asRecord(asRecord(response.data)?.['viewer'])
      const login = asString(viewer?.['login'])
      if (login === null) {
        throw new Error('o GitHub não disse de quem é o token — sem dono não há o que varrer')
      }

      owners.add(login)

      const organizations = asRecord(viewer?.['organizations'])
      for (const raw of asArray(organizations?.['nodes'])) {
        const org = asString(asRecord(raw)?.['login'])
        if (org !== null) owners.add(org)
      }

      const pageInfo = asRecord(organizations?.['pageInfo'])
      if (pageInfo?.['hasNextPage'] !== true) return [...owners]
      cursor = asString(pageInfo['endCursor'])
    }

    throw new Error(
      `o GitHub devolveu mais de ${MAX_PAGES} páginas de organizações — pageInfo provavelmente malformado`,
    )
  }

  /**
   * Os Projects crus de um dono, página a página. O filtro não acontece aqui: quem decide o que vira
   * aba é o passo 3, sobre a lista inteira, para que a regra viva num lugar só.
   */
  async #readProjects(owner: string): Promise<readonly unknown[]> {
    const nodes: unknown[] = []
    let cursor: string | null = null

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.#graphql(PROJECTS_QUERY, { owner, cursor })
      const lista = selectByAlias(response, 'projectsV2')

      nodes.push(...asArray(lista['nodes']))

      const pageInfo = asRecord(lista['pageInfo'])
      if (pageInfo?.['hasNextPage'] !== true) return nodes
      cursor = asString(pageInfo['endCursor'])
    }

    throw new Error(
      `o dono ${owner} devolveu mais de ${MAX_PAGES} páginas de Projects — pageInfo provavelmente malformado`,
    )
  }
}

/**
 * Qual aba nasce ativa. `remembered` que não está na lista é ignorado, e vale a primeira — é o que
 * faz um board arquivado não deixar o app sem aba ativa. Lista vazia devolve `null`.
 */
export function pickActive(
  boards: readonly DiscoveredBoard[],
  remembered: string | null,
): string | null {
  if (remembered !== null && boards.some((board) => board.key === remembered)) return remembered

  return boards[0]?.key ?? null
}

/**
 * Passo 3: o filtro, em dois degraus e nesta ordem.
 *
 * O arquivado cai **antes** do teste da esteira: board arquivado não é lugar de trabalho, e uma aba
 * para ele seria um kanban que ninguém pode mover. Hoje o degrau é redundante — nenhum dos
 * arquivados roda a esteira —, e ele existe para o dia em que um da esteira for arquivado.
 *
 * Nó sem `number`, sem `title` ou sem `owner.login` cai fora em silêncio, como o `toCard` já faz com
 * rascunho e pull request: sem os três não há chave que o `BoardReader.read` consiga resolver.
 */
function toBoard(node: unknown): DiscoveredBoard | null {
  const project = asRecord(node)
  if (!project || project['closed'] === true) return null

  if (!runsEsteira(optionNames(project))) return null

  const number = asNumber(project['number'])
  const title = asString(project['title'])
  const owner = asString(asRecord(project['owner'])?.['login'])
  if (number === null || title === null || owner === null) return null

  return { key: `${owner}/${number}`, owner, number, title }
}

/** Os nomes crus das opções do campo `Status`. Board sem o campo devolve `[]` — e `[]` não é esteira. */
function optionNames(project: Record<string, unknown>): readonly string[] {
  const names: string[] = []

  for (const raw of asArray(asRecord(project['field'])?.['options'])) {
    const name = asString(asRecord(raw)?.['name'])
    if (name !== null) names.push(name)
  }

  return names
}

/**
 * Passo 4: alfabética pelo título, empate desfeito por dono e depois por número.
 *
 * O desempate existe para a ordem depender **só dos dados**: `Array.sort` é estável desde ES2019,
 * então sem ele a posição de dois boards homônimos herdaria a ordem em que os donos foram varridos —
 * um detalhe interno, e não um fato do board. Com ele, a aba lembrada não muda de lugar por causa de
 * uma refatoração na varredura.
 */
function porOrdemDeAba(a: DiscoveredBoard, b: DiscoveredBoard): number {
  const porTitulo = ORDEM.compare(a.title, b.title)
  if (porTitulo !== 0) return porTitulo

  const porDono = ORDEM.compare(a.owner, b.owner)
  if (porDono !== 0) return porDono

  return a.number - b.number
}

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
