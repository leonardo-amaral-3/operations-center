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
  /**
   * Se é a estação de entrada, e portanto oferece a nova triagem (RF-9). Chega decidido do core pela
   * mesma razão do `conversable`: a régua de nome de estação mora num lugar só.
   */
  triage: boolean
}

/** Um campo single-select do card exibido como etiqueta no cartão. */
export interface BoardCardField {
  /** Nome do campo no board: 'Tipo', 'Severidade', 'Classe', 'Rota'. */
  name: string
  /** Nome da opção escolhida: '✨ Melhoria', 'S2', '⚪ Padrão', 'Completa'. */
  value: string
  optionId: string
}

/**
 * O épico de que este cartão é fase, como a API o devolve.
 *
 * Vem do `parent` da issue, e não da varredura do retrato, porque um épico pode estar **fora do
 * board** — e a fase precisa saber nomeá-lo do mesmo jeito.
 */
export interface BoardCardParent {
  number: number
  title: string
  /** `owner/name`. É o que desempata número igual em repos diferentes no mesmo board. */
  repository: string
}

/**
 * Uma fase daquele épico **que está neste board**. Derivada por inversão, no core.
 *
 * Fase fora do board, em outra aba, ou que não vira cartão não entra aqui — os três casos estão
 * nomeados no Technical Overview da spec do #41.
 */
export interface BoardPhase {
  /** Chave de render, e a mesma chave estável do `BoardCard`. */
  itemId: string
  number: number
  /** Só para o `title` do hover; a linha desenha o número e a estação. */
  title: string
  /** optionId da coluna onde a fase está — a verdade, e a âncora do smoke. */
  columnId: string
  /**
   * O nome da estação, já resolvido pelo core contra as `columns` do mesmo retrato.
   *
   * Resolvido aqui, e não na tela, pelo mesmo argumento do `conversable`: o core tem as colunas em
   * mãos no instante da leitura, e mandar a tela refazer o cruzamento criaria uma segunda cópia da
   * regra. `''` quando o board não declara a opção.
   */
  columnName: string
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
  /** O épico de que este cartão é fase, ou `null` — que é o caso da maioria. */
  parent: BoardCardParent | null
  /**
   * As fases deste cartão **que estão neste board**, em ordem crescente de número. Vazia para a
   * maioria, e é a lista vazia que faz o cartão comum desenhar exatamente como hoje (CA-3).
   */
  phases: readonly BoardPhase[]
}

export interface Board {
  /**
   * Título do Project. É a fonte **fresca** do rótulo da aba: a descoberta já dá um nome a ela antes
   * da primeira leitura, e toda leitura bem-sucedida substitui aquele nome por este, que veio do
   * board no instante em que ele foi lido.
   */
  title: string
  columns: readonly BoardColumn[]
  /**
   * **Na ordem em que o board devolveu os itens**, que é a ordem de posição no Projects. A coluna
   * apenas filtra por `columnId` preservando essa ordem — ordenar por número aqui faria o kanban
   * deixar de espelhar o board, que é o CA-1.
   */
  cards: readonly BoardCard[]
}

/** Um comentário da issue, já traduzido. */
export interface CardComment {
  id: string
  /** Login de quem escreveu, ou `null`: a API devolve `author: null` para conta removida. */
  author: string | null
  /** ISO 8601, como a API devolve. Quem formata para a tela é a tela. */
  createdAt: string
  body: string
  /**
   * O `X` do marcador `<!-- gm:X -->` na primeira linha, ou `null`. É `string` solta e não uma
   * união: a esteira ganha marcador novo sem pedir licença ao app, e um `'spec' | 'tasks'`
   * transformaria um `gm:prd` futuro em comentário sem etiqueta **em silêncio**.
   */
  kind: string | null
}

/** O conteúdo de um card: o que está escrito nele, e não os metadados que o cartão já mostra. */
export interface CardContent {
  number: number
  /** O corpo da issue. String vazia quando o card não tem corpo escrito. */
  body: string
  comments: readonly CardComment[]
  /** `true` quando a issue tem mais comentários que `MAX_COMMENTS` — a tela precisa dizer isso. */
  truncated: boolean
}

/**
 * Uma aba: o board daquele Project mais o estado da última leitura dele.
 *
 * `board` e `error` coexistem de propósito: uma releitura que falha não pode apagar cartões que
 * estavam corretos. E o par é **por aba** — uma aba que falha não afeta as outras.
 */
export interface BoardTab {
  /**
   * `owner/number`. Opaca para o renderer — ele a usa como chave de render e de estado por aba.
   * Quem a traduz em coordenada é o main, que é o único lado que conhece o GitHub.
   */
  key: string
  /**
   * O rótulo da aba. Nasce do título que a descoberta devolveu — é o que faz a aba ter nome
   * **antes** da primeira leitura — e é substituído pelo `title` do board a cada leitura
   * bem-sucedida, que é o mais fresco que existe.
   */
  title: string
  /** `null` só antes da primeira leitura bem-sucedida **desta aba**. */
  board: Board | null
  /** Epoch ms da última leitura bem-sucedida desta aba. Insumo do carimbo de frescor. */
  readAt: number | null
  /** Motivo da última falha desta aba, ou `null`. */
  error: string | null
}

/**
 * O que a tela sabe dos boards. Vem **inteiro** a cada mudança e o consumidor substitui — a mesma
 * regra do `TurnActivity` e do `ConversationsSnapshot`, e pelo mesmo motivo: evento perdido não
 * deixa a tela num estado que nunca mais será corrigido.
 */
export interface BoardsSnapshot {
  /**
   * **`null` enquanto a descoberta não terminou**; lista, possivelmente vazia, depois dela.
   *
   * O nulo é o discriminante, e ele existe porque sem ele "ainda estou descobrindo" e "descobri, e
   * nenhum board seu roda a esteira" seriam a mesma lista vazia — e a tela teria de adivinhar qual
   * das duas frases dizer. O main já tem o fato; achatá-lo na ponte seria jogá-lo fora.
   */
  boards: readonly BoardTab[] | null
  /** A `key` da aba ativa, ou `null` quando não há aba nenhuma. Quem a decide é o main. */
  activeKey: string | null
  /**
   * O que falhou na descoberta, ou `null`. **Pode vir preenchido junto com `boards`**: um dono que
   * não respondeu não apaga os boards dos que responderam, mas também não some da tela.
   */
  discoveryError: string | null
}
