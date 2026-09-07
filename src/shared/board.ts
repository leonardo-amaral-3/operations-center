/**
 * O vocabulário do board, do lado de cá da ponte.
 *
 * Mora ao lado de `src/shared/session.ts` e pela mesma razão: é o único jeito de o renderer
 * compilar contra os mesmos tipos que o main. Como aquele, este arquivo **não importa nada** — nem
 * `electron`, nem o SDK, nem `node:*`, nem outra camada — e precisa continuar assim; o ESLint
 * impõe.
 *
 * O que está aqui é o board *já traduzido*: o envelope cru do GraphQL não atravessa a ponte, e o
 * renderer não sabe que GitHub existe. Ele recebe colunas, cartões e um carimbo de frescor.
 */

/** Uma estação da esteira, como o board a declara. `id` é o optionId do campo Status. */
export interface BoardColumn {
  id: string
  name: string
  /**
   * Se a estação tem skill `gm-*` dedicada e portanto conversa (CA-4). Chega decidido do core: a
   * tela não pode reimplementar a regra, senão o critério passa a existir em dois lugares e um
   * deles envelhece.
   */
  conversable: boolean
}

/** Um campo single-select do card exibido como etiqueta no cartão. */
export interface BoardCardField {
  /** Nome do campo no board: 'Tipo', 'Severidade', 'Classe', 'Rota'. */
  name: string
  /** Nome da opção escolhida: '✨ Melhoria', 'S2', '⚪ Padrão', 'Completa'. */
  value: string
  optionId: string
}

export interface BoardCard {
  /** id do item no Project (`PVTI_…`). Chave de render: estável mesmo se a issue mudar de repo. */
  itemId: string
  number: number
  title: string
  url: string
  /** `owner/name`. É o insumo do RF-10 (repo → pasta local), que não é escopo aqui. */
  repository: string
  closed: boolean
  assignees: readonly string[]
  /** optionId da coluna. É por ele que o cartão é posicionado, nunca pelo nome. */
  columnId: string
  /** Na ordem de `CARD_FIELDS`. Campo vazio no board simplesmente não entra na lista. */
  fields: readonly BoardCardField[]
}

export interface Board {
  /** Título do Project. Vai no cabeçalho da tela — e é o que vira rótulo de aba quando o RF-1 chegar. */
  title: string
  columns: readonly BoardColumn[]
  /**
   * **Na ordem em que o board devolveu os itens**, que é a ordem de posição no Projects. A coluna
   * apenas filtra por `columnId` preservando essa ordem — ordenar por número aqui faria o kanban
   * deixar de espelhar o board, que é o CA-1.
   */
  cards: readonly BoardCard[]
}

/**
 * O que a tela sabe do board. `board` e `error` coexistem de propósito: uma releitura que falha
 * não pode apagar cartões que estavam corretos.
 */
export interface BoardSnapshot {
  /** `null` só antes da primeira leitura bem-sucedida. */
  board: Board | null
  /** Epoch ms da última leitura bem-sucedida. É o insumo do carimbo de frescor. */
  readAt: number | null
  /** Motivo da última falha, ou `null` se a última leitura deu certo. */
  error: string | null
}
