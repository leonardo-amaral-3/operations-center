/**
 * A `GraphQLFn` de fixture: o mesmo contrato, servido de arquivo.
 *
 * É a porta que torna os smokes determinísticos — sem rede, sem token e sem cota. Os arquivos
 * guardam o **envelope cru da API**, e não um `Board` ou um `CardContent` já traduzido, de
 * propósito: uma fixture do objeto pronto pularia o parsing, que é a parte que mais tem como
 * quebrar.
 */

import { readFile } from 'node:fs/promises'

import { CARD_QUERY } from '../../core'
import type { GraphQLFn, GraphQLResponse } from '../../core'

export interface FixtureFiles {
  /** O envelope do `BOARD_QUERY`. */
  board: string
  /** Mapa `número da issue` → envelope do `CARD_QUERY`. Ausente = nenhum card tem conteúdo. */
  cards?: string
}

/**
 * Lê e parseia a cada chamada — um app apontado para fixture não tem por que ficar mais rápido, e
 * reler deixa trocar o arquivo com o app de pé.
 *
 * O despacho é por **igualdade de documento**, e não por `includes` de um trecho: com dois
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

    return readEnvelope(files.board)
  }
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

async function readEnvelope(path: string): Promise<GraphQLResponse> {
  return narrow(JSON.parse(await readFile(path, 'utf8')) as GraphQLResponse)
}

/** Só `data` e `errors` saem daqui: chaves de topo desconhecidas no arquivo são ignoradas. */
function narrow(parsed: GraphQLResponse): GraphQLResponse {
  return { data: parsed.data, errors: parsed.errors }
}
