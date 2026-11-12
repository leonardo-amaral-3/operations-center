/**
 * A `GraphQLFn` de fixture: o mesmo contrato, servido de arquivo.
 *
 * É a porta que torna os smokes determinísticos — sem rede, sem token e sem cota. Os arquivos
 * guardam o **envelope cru da API**, e não um `Board` ou um `CardContent` já traduzido, de
 * propósito: uma fixture do objeto pronto pularia o parsing, que é a parte que mais tem como
 * quebrar.
 */

import { readFile } from 'node:fs/promises'

import { CARD_QUERY, OWNERS_QUERY, PR_LINK_QUERY, PR_QUERY, PROJECTS_QUERY } from '../../core'
import type { GraphQLFn, GraphQLResponse, RestGetFn } from '../../core'
import { ITEM_NO_BOARD_QUERY } from '../../core/fabrica/estacao'
import {
  MANDATO_QUERY,
  PROJETO_DA_FABRICA,
  REPO_DA_FABRICA,
} from '../../core/fabrica/mandato'
import { RELATORIO_MOVIDOS_QUERY } from '../../core/relatorio'

export interface FixtureFiles {
  /** Mapa `"owner/number"` → envelope do `BOARD_QUERY`, sob a chave `boards`. */
  board: string
  /**
   * O envelope do `OWNERS_QUERY` sob `owners`, e o mapa `login` → envelope do `PROJECTS_QUERY` sob
   * `byOwner`. Ausente = a descoberta não tem o que responder.
   */
  boards?: string
  /** Mapa `número da issue` → envelope do `CARD_QUERY`. Ausente = nenhum card tem conteúdo. */
  cards?: string
  /**
   * `{ "pulls": { "<pr>": envelope do PR_QUERY }, "files": { "<pr>": [itens da REST] } }`. A ligação
   * card→PR **não** mora aqui: vem de `cards`, o mesmo envelope do `CARD_QUERY`.
   */
  pulls?: string
  /**
   * `{ "movidos": envelope do RELATORIO_MOVIDOS_QUERY, "cards": { "<n>": nó do issueOrPullRequest } }`.
   * Ausente = os dois documentos do relatório respondem erro.
   */
  relatorio?: string
  /** Caminho de um texto puro: o `fabrica/MANDATO.md` da `dev`. Ausente = o documento lança. */
  mandato?: string
}

/**
 * Lê e parseia a cada chamada — um app apontado para fixture não tem por que ficar mais rápido, e
 * reler deixa trocar o arquivo com o app de pé.
 *
 * O despacho é por **igualdade de documento**, e não por `includes` de um trecho: com quatro
 * documentos em jogo, casar por pedaço de texto é o tipo de acerto que segue verde enquanto serve o
 * envelope errado. Documento desconhecido cai no board — o comportamento único de quando não havia
 * um segundo documento. Serve também o Status de um card, tirado do mesmo `board.json` (F6).
 *
 * Os caminhos são usados como vieram: o smoke passa caminho **absoluto**, para não depender de qual
 * é a `cwd` do processo do Electron.
 */
export function createFixtureGraphQL(files: FixtureFiles): GraphQLFn {
  return async (document, variables) => {
    if (document === CARD_QUERY) return readCard(files.cards, variables['number'])
    // O envelope do card já carrega `timelineItems`, que é tudo que o leitor de PR lê da ligação:
    // ela existe num lugar só da fixture e não tem como divergir.
    if (document === PR_LINK_QUERY) return readCard(files.cards, variables['number'])
    if (document === PR_QUERY) return readPull(files.pulls, variables['number'])
    if (document === OWNERS_QUERY) return readOwners(files.boards)
    if (document === PROJECTS_QUERY) return readProjects(files.boards, variables['owner'])

    if (document === RELATORIO_MOVIDOS_QUERY) return readRelatorioMovidos(files.relatorio)
    if (document.startsWith('query RelatorioCards(')) {
      return readRelatorioCards(files.relatorio, document)
    }

    if (document === ITEM_NO_BOARD_QUERY) {
      return readItemNoBoard(files.board, variables['owner'], variables['name'], variables['n'])
    }

    if (document === MANDATO_QUERY) return readMandato(files.mandato)

    return readBoard(files.board, variables['owner'], variables['number'])
  }
}

/**
 * O board pedido pela **coordenada**, e não o envelope solto que a fixture servia quando só havia um
 * board possível. Chave ausente **lança**, e alto: uma aba cujo board não está na fixture tem de
 * aparecer como erro na tela do smoke, e não como um kanban vazio que passa despercebido.
 */
async function readBoard(path: string, owner: unknown, number: unknown): Promise<GraphQLResponse> {
  const key = `${String(owner)}/${String(number)}`
  const mapa = await readMap(path, 'boards')
  const envelope = mapa[key]

  if (envelope === undefined) throw new Error(`sem fixture de board para ${key}`)

  return narrow(envelope)
}

function registro(valor: unknown): Record<string, unknown> | undefined {
  return typeof valor === 'object' && valor !== null
    ? (valor as Record<string, unknown>)
    : undefined
}

/**
 * O Status de um card, tirado do envelope do board da fábrica: o item com aquele número naquele
 * repositório. Sem item → `issue: null`, porque a fixture só conhece os cards do board.
 */
async function readItemNoBoard(
  path: string,
  owner: unknown,
  name: unknown,
  n: unknown,
): Promise<GraphQLResponse> {
  const key = `${REPO_DA_FABRICA.owner}/${PROJETO_DA_FABRICA}`
  const envelope = (await readMap(path, 'boards'))[key]

  if (envelope === undefined) throw new Error(`sem fixture de board para ${key}`)

  const data = registro(envelope.data)
  const projeto = registro(
    registro(data?.['user'])?.['projectV2'] ?? registro(data?.['organization'])?.['projectV2'],
  )
  const itens = registro(projeto?.['items'])?.['nodes']
  const nome = `${String(owner)}/${String(name)}`
  const no = (Array.isArray(itens) ? itens : []).map(registro).find((item) => {
    const content = registro(item?.['content'])

    return (
      content?.['number'] === Number(n) &&
      registro(content['repository'])?.['nameWithOwner'] === nome
    )
  })

  if (no === undefined) return { data: { repository: { issue: null } } }

  const valores = registro(no['fieldValues'])?.['nodes']
  const status = (Array.isArray(valores) ? valores : [])
    .map(registro)
    .find((valor) => registro(valor?.['field'])?.['name'] === 'Status')?.['name']

  return {
    data: {
      repository: {
        issue: {
          state: registro(no['content'])?.['closed'] === true ? 'CLOSED' : 'OPEN',
          projectItems: {
            nodes: [
              {
                project: { number: PROJETO_DA_FABRICA },
                fieldValueByName: typeof status === 'string' ? { name: status } : null,
              },
            ],
          },
        },
      },
    },
  }
}

/** O texto do arquivo como o GitHub o devolveria; sem arquivo lança, como a fixture de card. */
async function readMandato(path: string | undefined): Promise<GraphQLResponse> {
  if (path === undefined) throw new Error('sem fixture do mandato (OC_FABRICA_MANDATO_FIXTURE)')

  const text = await readFile(path, 'utf8')

  return { data: { repository: { object: { text } } } }
}

const SEM_RELATORIO = 'sem fixture do relatório (OC_RELATORIO_FIXTURE)'

/** Os movidos do dia: o envelope do arquivo, como veio. */
async function readRelatorioMovidos(path: string | undefined): Promise<GraphQLResponse> {
  if (path === undefined) return { data: null, errors: [{ message: SEM_RELATORIO }] }

  const movidos = (await readJson(path))['movidos']

  if (movidos === undefined || movidos === null) {
    throw new Error(`a fixture ${path} não tem a chave \`movidos\``)
  }

  return narrow(movidos as GraphQLResponse)
}

/**
 * Um alias por número pedido. Número fora do arquivo vira `null` com o `NOT_FOUND` que o GitHub
 * devolve, que é o caso "ausente" do leitor de cards.
 */
async function readRelatorioCards(
  path: string | undefined,
  document: string,
): Promise<GraphQLResponse> {
  if (path === undefined) return { data: null, errors: [{ message: SEM_RELATORIO }] }

  const cards = (await readJson(path))['cards'] as Record<string, unknown> | undefined
  const repository: Record<string, unknown> = {}
  const errors: { message: string; type: string; path: string[] }[] = []

  for (const [, n] of document.matchAll(/\bc(\d+): issueOrPullRequest/g)) {
    const no = cards?.[String(n)]

    repository[`c${n}`] = no ?? null

    if (no === undefined) {
      errors.push({
        message: 'Could not resolve to an issue or pull request',
        type: 'NOT_FOUND',
        path: ['repository', `c${n}`],
      })
    }
  }

  return { data: { repository }, ...(errors.length > 0 ? { errors } : {}) }
}

/** Os donos a varrer. Sem fixture da descoberta não há o que responder — e calar seria pior. */
async function readOwners(path: string | undefined): Promise<GraphQLResponse> {
  const faltou = 'sem fixture de descoberta para os donos'

  if (path === undefined) throw new Error(faltou)

  const envelope = (await readJson(path))['owners']

  if (envelope === undefined || envelope === null) throw new Error(faltou)

  return narrow(envelope as GraphQLResponse)
}

/** Os Projects de **um** dono: a fixture é indexada como o `BoardFinder` pergunta, um dono por vez. */
async function readProjects(path: string | undefined, owner: unknown): Promise<GraphQLResponse> {
  const faltou = `sem fixture de descoberta para o dono ${String(owner)}`

  if (path === undefined) throw new Error(faltou)

  const mapa = await readMap(path, 'byOwner')
  const envelope = mapa[String(owner)]

  if (envelope === undefined) throw new Error(faltou)

  return narrow(envelope)
}

/**
 * Fixture de card ausente ou incompleta **lança**, e alto de propósito: ela tem de aparecer como
 * erro na tela do smoke, e não como um card vazio que passa despercebido — que é exatamente o modo
 * de falha que o conteúdo no cartão existe para acabar.
 */
async function readCard(path: string | undefined, number: unknown): Promise<GraphQLResponse> {
  const faltou = `sem fixture de conteúdo para o card #${String(number)}`

  if (path === undefined) throw new Error(faltou)

  const mapa = JSON.parse(await readFile(path, 'utf8')) as Record<string, GraphQLResponse>
  const envelope = mapa[String(number)]

  if (envelope === undefined) throw new Error(faltou)

  return narrow(envelope)
}

/** Pelo mesmo motivo do card: PR sem fixture lança, em vez de virar uma aba vazia. */
async function readPull(path: string | undefined, number: unknown): Promise<GraphQLResponse> {
  const faltou = `sem fixture de PR para o #${String(number)}`

  if (path === undefined) throw new Error(faltou)

  const envelope = (await readMap(path, 'pulls'))[String(number)]

  if (envelope === undefined) throw new Error(faltou)

  return narrow(envelope)
}

/**
 * A `RestGetFn` de fixture. Só entende a lista de arquivos do PR — o único GET que o app faz — e
 * qualquer outro caminho lança, para uma leitura nova não passar calada pela fixture.
 */
export function createFixtureRest(files: FixtureFiles): RestGetFn {
  return async (path) => {
    const pr = /^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/files\b/.exec(path)?.[1]
    if (pr === undefined) throw new Error(`sem fixture REST para o caminho ${path}`)

    if (files.pulls === undefined) throw new Error(`sem fixture de arquivos para o PR #${pr}`)

    const lista = (await readJson(files.pulls))['files']
    const itens = (lista as Record<string, unknown> | undefined)?.[pr]

    if (itens === undefined) throw new Error(`sem fixture de arquivos para o PR #${pr}`)

    return itens
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

/** O mapa sob uma chave de topo do arquivo. Chave ausente lança pelo mesmo motivo que a entrada. */
async function readMap(
  path: string,
  chave: string,
): Promise<Record<string, GraphQLResponse | undefined>> {
  const arquivo = await readJson(path)
  const mapa = arquivo[chave]

  if (mapa === undefined || mapa === null) {
    throw new Error(`a fixture ${path} não tem a chave \`${chave}\``)
  }

  return mapa as Record<string, GraphQLResponse | undefined>
}

/** Só `data` e `errors` saem daqui: chaves de topo desconhecidas no arquivo são ignoradas. */
function narrow(parsed: GraphQLResponse): GraphQLResponse {
  return { data: parsed.data, errors: parsed.errors }
}
