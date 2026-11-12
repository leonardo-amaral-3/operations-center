import { MAX_PAGES, selectByAlias } from '../board/envelope'
import { asArray, asNumber, asRecord, asString } from '../board/narrow'
import type { GraphQLFn } from '../board/types'
import type { CardLido, EventoDeStatus } from './tipos'

/**
 * Os cards que tiveram mudança de Status no dia. Só lê: o documento é uma consulta, e nada aqui
 * escreve no board. `timelineItems(since:)` serve para saber se há ALGUM evento no dia (`nodes`
 * vazio ou não), nunca para contar: o `totalCount` ignora o `since` (R10).
 */
export const RELATORIO_MOVIDOS_QUERY = `query RelatorioMovidos($owner: String!, $number: Int!, $cursor: String, $inicio: DateTime!) {
  user(login: $owner) { projectV2(number: $number) { ...Movidos } }
  organization(login: $owner) { projectV2(number: $number) { ...Movidos } }
}
fragment Movidos on ProjectV2 {
  items(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      content {
        __typename
        ... on Issue { number repository { nameWithOwner } timelineItems(since: $inicio, first: 1, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]) { nodes { ... on ProjectV2ItemStatusChangedEvent { createdAt } } } }
        ... on PullRequest { number repository { nameWithOwner } timelineItems(since: $inicio, first: 1, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]) { nodes { ... on ProjectV2ItemStatusChangedEvent { createdAt } } } }
      }
    }
  }
}`

const FRAGMENTOS_DO_CARD = `fragment CardIssue on Issue { __typename number title url parent { number repository { nameWithOwner } }
  timelineItems(first: 100, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemStatusChangedEvent { createdAt previousStatus status project { number } } } } }
fragment CardPr on PullRequest { __typename number title url
  timelineItems(first: 100, itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]) { pageInfo { hasNextPage } nodes { ... on ProjectV2ItemStatusChangedEvent { createdAt previousStatus status project { number } } } } }`

/** O limite de números por documento. */
const LOTE = 50

/** No máximo 4 rodadas: o card e três gerações de pai. */
const MAX_RODADAS = 4

/** Um alias por número. Até 50 números por documento. */
export function documentoDosCards(numeros: readonly number[]): string {
  const aliases = numeros
    .map((n) => `  c${n}: issueOrPullRequest(number: ${n}) { ...CardIssue ...CardPr }`)
    .join('\n')

  return `query RelatorioCards($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
${aliases}
  }
}
${FRAGMENTOS_DO_CARD}`
}

export async function lerNumerosMovidos(
  graphql: GraphQLFn,
  input: { owner: string; repo: string; projeto: number; inicio: string },
): Promise<number[]> {
  const movidos = new Set<number>()
  let cursor: string | null = null

  for (let pagina = 0; pagina < MAX_PAGES; pagina++) {
    const resposta = await graphql(RELATORIO_MOVIDOS_QUERY, {
      owner: input.owner,
      number: input.projeto,
      cursor,
      inicio: input.inicio,
    })
    const board = selectByAlias(resposta, 'projectV2')
    const items = asRecord(board['items'])

    for (const item of asArray(items?.['nodes'])) {
      const conteudo = asRecord(asRecord(item)?.['content'])
      if (!conteudo) continue

      const numero = asNumber(conteudo['number'])
      if (numero === null) continue
      if (asString(asRecord(conteudo['repository'])?.['nameWithOwner']) !== input.repo) continue

      const eventos = asArray(asRecord(conteudo['timelineItems'])?.['nodes'])
      if (eventos.length > 0) movidos.add(numero)
    }

    const pageInfo = asRecord(items?.['pageInfo'])
    if (pageInfo?.['hasNextPage'] !== true) return [...movidos].sort((a, b) => a - b)

    cursor = asString(pageInfo['endCursor'])
  }

  throw new Error(`o board passou de ${MAX_PAGES} páginas`)
}

export async function lerCards(
  graphql: GraphQLFn,
  input: { owner: string; name: string; projeto: number; numeros: readonly number[] },
): Promise<Map<number, CardLido>> {
  const cards = new Map<number, CardLido>()
  if (input.numeros.length === 0) return cards

  const pedidos = new Set<number>()
  let rodada: number[] = [...new Set(input.numeros)]

  for (let i = 0; i < MAX_RODADAS && rodada.length > 0; i++) {
    for (const n of rodada) pedidos.add(n)

    for (let ini = 0; ini < rodada.length; ini += LOTE) {
      const lote = rodada.slice(ini, ini + LOTE)
      for (const card of await lerLote(graphql, input, lote)) cards.set(card.numero, card)
    }

    const pais = new Set<number>()
    for (const n of rodada) {
      const pai = cards.get(n)?.pai
      if (pai != null && !pedidos.has(pai)) pais.add(pai)
    }
    rodada = [...pais]
  }

  return cards
}

async function lerLote(
  graphql: GraphQLFn,
  input: { owner: string; name: string; projeto: number },
  lote: readonly number[],
): Promise<CardLido[]> {
  const resposta = await graphql(documentoDosCards(lote), { owner: input.owner, name: input.name })

  const ausentes = new Set<number>()
  for (const erro of resposta.errors ?? []) {
    const alvo = lote.find(
      (n) =>
        erro.path?.length === 2 &&
        erro.path[0] === 'repository' &&
        erro.path[1] === `c${n}` &&
        asRecord(erro)?.['type'] === 'NOT_FOUND',
    )
    if (alvo === undefined) throw new Error(erro.message)
    ausentes.add(alvo)
  }

  const repositorio = asRecord(asRecord(resposta.data)?.['repository'])
  const lidos: CardLido[] = []

  for (const n of lote) {
    if (ausentes.has(n)) continue
    lidos.push(lerCard(n, repositorio?.[`c${n}`], input))
  }

  return lidos
}

function lerCard(
  n: number,
  bruto: unknown,
  input: { owner: string; name: string; projeto: number },
): CardLido {
  const inesperada = () => new Error(`resposta inesperada do GitHub para o card #${n}`)

  const card = asRecord(bruto)
  const tipo = asString(card?.['__typename'])
  if (!card || (tipo !== 'Issue' && tipo !== 'PullRequest')) throw inesperada()

  const numero = asNumber(card['number'])
  const titulo = asString(card['title'])
  const url = asString(card['url'])
  if (numero === null || titulo === null || url === null) throw inesperada()

  const linha = asRecord(card['timelineItems'])
  if (asRecord(linha?.['pageInfo'])?.['hasNextPage'] === true) {
    throw new Error(
      `o card #${n} tem mais de 100 mudanças de Status, e o relatório não lê além disso`,
    )
  }

  const eventos: EventoDeStatus[] = []
  for (const no of asArray(linha?.['nodes'])) {
    const evento = asRecord(no)
    if (asNumber(asRecord(evento?.['project'])?.['number']) !== input.projeto) continue

    const em = asString(evento?.['createdAt'])
    const para = asString(evento?.['status'])
    if (em === null || para === null) throw inesperada()

    eventos.push({ em, de: asString(evento?.['previousStatus']) ?? '', para })
  }
  eventos.sort((a, b) => Date.parse(a.em) - Date.parse(b.em))

  return { numero, titulo, url, pai: lerPai(card, tipo, input, inesperada), eventos }
}

function lerPai(
  card: Record<string, unknown>,
  tipo: 'Issue' | 'PullRequest',
  input: { owner: string; name: string },
  inesperada: () => Error,
): number | null {
  if (tipo === 'PullRequest') return null
  if (!('parent' in card)) throw inesperada()

  const parent = asRecord(card['parent'])
  if (!parent) return null

  const repo = asString(asRecord(parent['repository'])?.['nameWithOwner'])
  return repo === `${input.owner}/${input.name}` ? asNumber(parent['number']) : null
}
