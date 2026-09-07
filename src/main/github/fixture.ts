/**
 * A `GraphQLFn` de fixture: o mesmo contrato, servido de arquivo.
 *
 * É a porta que torna os smokes determinísticos — sem rede, sem token e sem cota. Os arquivos
 * guardam o **envelope cru da API**, e não um `Board` ou um `CardContent` já traduzido, de
 * propósito: uma fixture do objeto pronto pularia o parsing, que é a parte que mais tem como
 * quebrar.
 */

import { readFile } from 'node:fs/promises'

import { CARD_QUERY, OWNERS_QUERY, PROJECTS_QUERY } from '../../core'
import type { GraphQLFn, GraphQLResponse } from '../../core'

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
}

/**
 * Lê e parseia a cada chamada — um app apontado para fixture não tem por que ficar mais rápido, e
 * reler deixa trocar o arquivo com o app de pé.
 *
 * O despacho é por **igualdade de documento**, e não por `includes` de um trecho: com quatro
 * documentos em jogo, casar por pedaço de texto é o tipo de acerto que segue verde enquanto serve o
 * envelope errado. Documento desconhecido cai no board — o comportamento único de quando não havia
 * um segundo documento.
 *
 * Os caminhos são usados como vieram: o smoke passa caminho **absoluto**, para não depender de qual
 * é a `cwd` do processo do Electron.
 */
export function createFixtureGraphQL(files: FixtureFiles): GraphQLFn {
  return async (document, variables) => {
    if (document === CARD_QUERY) return readCard(files.cards, variables['number'])
    if (document === OWNERS_QUERY) return readOwners(files.boards)
    if (document === PROJECTS_QUERY) return readProjects(files.boards, variables['owner'])

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
