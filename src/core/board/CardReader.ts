import { asArray, asNumber, asRecord, asString } from './narrow'
import { CARD_QUERY } from './query'
import type { CardComment, CardContent, GraphQLFn } from './types'

export interface CardReaderDeps {
  /**
   * Injetado, pela mesma razão que o do `BoardReader` é: é o que mantém a tradução issue→conteúdo
   * coberta por teste sem rede e sem token. Quem sabe de HTTP, de `gh` e de ambiente é o main.
   */
  graphql: GraphQLFn
}

export interface ReadCardInput {
  /** Vêm de `BoardCard.repository`, que é `owner/name`. Quem parte a string é o main. */
  owner: string
  name: string
  number: number
}

/**
 * Teto de comentários numa leitura. Cards da esteira têm unidades deles; o teto existe para que uma
 * issue patológica não vire uma resposta de megabytes, e `truncated` existe para que o corte
 * **apareça** — conteúdo que some em silêncio é exatamente a dor que este card fecha.
 *
 * Regra 7: **uma página, e só.** Paginar exigiria um cursor atravessando a ponte para ganhar o 101º
 * comentário de um card que não existe.
 */
export const MAX_COMMENTS = 100

/**
 * O marcador que a esteira põe na primeira linha dos comentários que ela mesma escreve.
 *
 * Ancorado no início, e não solto no texto: uma spec que *fala* de `<!-- gm:tasks -->` no meio de um
 * parágrafo não é um comentário de tasks, e etiquetá-la como tal seria mentir sobre o que ela é.
 */
const MARCADOR = /^<!--\s*gm:([a-z][a-z0-9-]*)\s*-->/

/**
 * Traduz o conteúdo de uma issue no `CardContent` que a tela desenha.
 *
 * Espelha o `BoardReader` de propósito, até no formato: recebe a `GraphQLFn` injetada, não fala
 * HTTP, não lê ambiente e passa toda a resposta pelas guardas de `narrow.ts`. A extração da
 * etiqueta `gm:` mora aqui, e não na tela, porque é regra de produto — o mesmo argumento que pôs o
 * `conversable` no `BoardReader`.
 */
export class CardReader {
  readonly #graphql: GraphQLFn

  constructor(deps: CardReaderDeps) {
    this.#graphql = deps.graphql
  }

  async read(input: ReadCardInput): Promise<CardContent> {
    const response = await this.#graphql(CARD_QUERY, {
      owner: input.owner,
      name: input.name,
      number: input.number,
      comments: MAX_COMMENTS,
    })

    // Regra 1: sem alias duplo não há erro esperado, e tolerar um faria o app engolir falha de
    // campo em silêncio.
    const primeiro = response.errors?.[0]
    if (primeiro) throw new Error(primeiro.message)

    const issue = asRecord(asRecord(asRecord(response.data)?.['repository'])?.['issue'])

    // Regra 2: é o caminho do card de repo forasteiro e o do token sem acesso a repo privado.
    if (!issue) {
      throw new Error(
        `o GitHub não devolveu a issue #${input.number} de ${input.owner}/${input.name} — repo inacessível ou card removido`,
      )
    }

    const comments = asRecord(issue['comments'])
    const nodes = asArray(comments?.['nodes'])
    const lidos = readComments(nodes)

    return {
      // O número pedido é a resposta certa quando a issue não o devolve: foi por ele que a leitura
      // aconteceu, e um `0` aqui viraria um cartão sem identidade na tela.
      number: asNumber(issue['number']) ?? input.number,
      // Regra 3: card sem corpo é caso normal, não erro.
      body: asString(issue['body']) ?? '',
      comments: lidos,
      // Regra 6: o corte tem de aparecer. `totalCount` ausente não inventa corte nenhum.
      truncated: (asNumber(comments?.['totalCount']) ?? 0) > nodes.length,
    }
  }
}

/**
 * Regra 4: os comentários na ordem da resposta, que é a ordem cronológica de criação que a API
 * devolve — ordenar aqui faria a leitura deixar de espelhar a conversa do card.
 *
 * Nó sem `id` ou sem `body` é descartado em silêncio: não há o que mostrar nem por qual chave
 * renderizá-lo. `author` ausente vira `null`, e nunca `''`, porque conta removida é uma informação
 * de verdade e um autor vazio a esconderia atrás de um nome em branco.
 */
function readComments(nodes: readonly unknown[]): readonly CardComment[] {
  const comments: CardComment[] = []

  for (const raw of nodes) {
    const node = asRecord(raw)
    const id = asString(node?.['id'])
    const body = asString(node?.['body'])
    if (id === null || body === null) continue

    comments.push({
      id,
      author: asString(asRecord(node?.['author'])?.['login']),
      createdAt: asString(node?.['createdAt']) ?? '',
      body,
      kind: readKind(body),
    })
  }

  return comments
}

/**
 * Regra 5: a etiqueta sai do marcador na primeira linha, já com `trimStart()`.
 *
 * O marcador **não** é removido do `body`: quem o esconde da tela é o pipeline do `Markdown`, cujo
 * `rehype-sanitize` descarta nós de comentário. Removê-lo aqui faria o core mutilar o texto que o
 * GitHub tem.
 */
function readKind(body: string): string | null {
  return MARCADOR.exec(body.trimStart())?.[1] ?? null
}
