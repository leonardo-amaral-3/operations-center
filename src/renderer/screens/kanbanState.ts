/**
 * O estado do kanban na tela, e a regra que o move — sem React, sem `window`, sem DOM.
 *
 * Mora num arquivo próprio, e não dentro do `KanbanScreen`, pela mesma razão medida em
 * `session/sessionView.ts`: o `useReducer` é do componente, mas a regra que ele aplica é pura e
 * merece teste sem subir Electron. O que sobra no componente é a assinatura dos canais.
 */

import type { BoardCard, BoardTab, BoardsSnapshot } from '../../shared/board'

export interface KanbanState {
  /**
   * O retrato como o main o publicou. É **substituído inteiro** a cada ação `snapshot`: a tela não
   * recompõe nada, porque quem decide o que sobrevive a uma falha é o main. Duas regras de
   * preservação — uma aqui e outra lá — divergiriam num dia qualquer.
   */
  snapshot: BoardsSnapshot
  /**
   * Os cartões abertos **de cada aba**, por `key`. Chave ausente = nenhum aberto naquela aba.
   *
   * Lista, e não um id só: a regra é **um por coluna** (#45). A chave continua sendo a aba, e não
   * `aba+coluna`, porque cartão aberto muda de coluna sozinho quando a sessão avança a esteira —
   * guardando **quem** está aberto, e não **qual slot** está ocupado, ele viaja aberto de coluna em
   * coluna sem nenhum código de remapeamento.
   */
  expanded: Readonly<Record<string, readonly string[]>>
  /**
   * A aba cuja triagem está aberta, ou `null`. **Uma no app inteiro**, e não uma por aba: trocar de
   * aba encerra a triagem (Decisão 5 do #27), então guardar uma lista descreveria um estado que não
   * existe.
   *
   * A `key` e não um booleano: é ela que compõe o `SessionScope` do painel.
   */
  triagem: string | null
}

export type KanbanAction =
  | { type: 'snapshot'; snapshot: BoardsSnapshot }
  /**
   * Alterna o cartão da aba `key`: abrir fecha os abertos **da mesma coluna** daquela aba (#45).
   *
   * A ação **não** carrega a coluna. O reducer a resolve pelo `state.snapshot` que já tem, porque
   * receber a do clique responderia só metade — a coluna dos cartões **já abertos** exigiria o
   * retrato de todo jeito.
   */
  | { type: 'toggle'; key: string; itemId: string }
  /**
   * Abre a triagem da aba `key`. Uma só no app inteiro, como o campo que ela grava.
   *
   * A `key` vem do clique, e não do `activeKey` do retrato: o reducer não escolhe aba, e só a tela
   * sabe de qual coluna partiu a ação.
   */
  | { type: 'abrir-triagem'; key: string }
  /** Fecha a triagem aberta, seja de que aba for. Sem `key`: há no máximo uma. */
  | { type: 'fechar-triagem' }

export const INITIAL_KANBAN: KanbanState = {
  // Antes da descoberta a tela não sabe nem quantos boards existem — e `boards: null` é exatamente
  // isso, e não "descobri e não achei nenhum".
  snapshot: { boards: null, activeKey: null, discoveryError: null },
  expanded: {},
  triagem: null,
}

export function reduceKanban(state: KanbanState, action: KanbanAction): KanbanState {
  if (action.type === 'snapshot') {
    // `expanded` **atravessa** o retrato novo: um board relido não pode fechar o cartão que o
    // usuário deixou aberto, nem quando o cartão mudou de coluna (RA-4 do #45) — fechar a conversa
    // no exato evento que este app existe para acompanhar seria o oposto do que ele faz. O que a
    // releitura tira é só o que deixou de existir.
    return {
      ...state,
      snapshot: action.snapshot,
      expanded: podar(state.expanded, action.snapshot),
      // A triagem **não** atravessa a troca de aba, ao contrário de `expanded`: a decisão do card é
      // que sair da aba encerra a triagem, e quem a encerra é o painel desmontado
      // (`closeOnUnmount`). Zerar aqui é o que impede o painel de renascer — com uma sessão nova e a
      // conversa perdida — ao voltar para a aba. Aba que sumiu do retrato cai na mesma linha, porque
      // `activeKey` muda junto.
      triagem: action.snapshot.activeKey === state.triagem ? state.triagem : null,
    }
  }

  if (action.type === 'abrir-triagem') return { ...state, triagem: action.key }

  // Zera e pronto: o painel já saiu de cena e a sessão dele morreu com o desmonte. Não há lista de
  // que tirar a aba, que é justamente o que o campo único compra.
  if (action.type === 'fechar-triagem') return { ...state, triagem: null }

  const abertos = state.expanded[action.key] ?? []

  if (abertos.includes(action.itemId)) {
    // Clicar no cartão aberto fecha **só ele** — não os vizinhos de coluna, não os das outras abas,
    // e não a sessão dele, que continua viva atrás do cartão fechado.
    return {
      ...state,
      expanded: comLista(
        state.expanded,
        action.key,
        abertos.filter((id) => id !== action.itemId),
      ),
    }
  }

  const coluna = columnOf(state.snapshot, action.key, action.itemId)
  // Um cartão aberto **por coluna** (#45): abrir fecha os que estavam abertos naquela mesma coluna,
  // e as outras colunas — como as outras abas — não sentem nada. Coluna irresolvível não fecha
  // ninguém: sem coluna não há regra a aplicar, e apagar por precaução seria adivinhar.
  const sobreviventes =
    coluna === null
      ? abertos
      : abertos.filter((id) => columnOf(state.snapshot, action.key, id) !== coluna)

  // No fim da lista, que é a ordem de abertura.
  return {
    ...state,
    expanded: comLista(state.expanded, action.key, [...sobreviventes, action.itemId]),
  }
}

/** Os cartões daquela aba no retrato, ou `null` se a aba não existe ou ainda não foi lida. */
function cardsOf(snapshot: BoardsSnapshot, key: string): readonly BoardCard[] | null {
  return snapshot.boards?.find((candidata) => candidata.key === key)?.board?.cards ?? null
}

/** Em que coluna daquela aba o cartão está, ou `null` se o retrato não o conhece. */
function columnOf(snapshot: BoardsSnapshot, key: string, itemId: string): string | null {
  return cardsOf(snapshot, key)?.find((card) => card.itemId === itemId)?.columnId ?? null
}

/**
 * `expanded` com a lista de uma aba trocada — e a chave **removida** quando a lista fica vazia.
 *
 * "Nenhum aberto naquela aba" continua sendo a chave não estar lá, e não uma lista vazia: duas
 * formas de dizer a mesma coisa fariam toda leitura ter de checar as duas.
 */
function comLista(
  expanded: Readonly<Record<string, readonly string[]>>,
  key: string,
  lista: readonly string[],
): Readonly<Record<string, readonly string[]>> {
  if (lista.length === 0) {
    const semAba = { ...expanded }
    delete semAba[key]

    return semAba
  }

  return { ...expanded, [key]: lista }
}

/**
 * Tira de `expanded` os ids que **sumiram** do retrato — e só eles.
 *
 * Sem isto um id que saiu do board fica preso para sempre: `columnOf` devolve `null` para ele,
 * então nenhum clique futuro o filtra, e se o cartão voltar ao board ele renasce expandido sem
 * clique nenhum. Podar não contradiz "a releitura não fecha cartão": lá o cartão existe e mudou de
 * lugar, aqui ele não existe.
 *
 * Aba sem board lido (`null`) tem a lista **mantida intacta**: "sumiu" e "ainda não sei" são
 * indistinguíveis daí, e podar no escuro fecharia tudo numa aba que ainda vai carregar.
 *
 * Nada a podar devolve a **mesma referência**: o retrato de rotina — um a cada foco da janela —
 * não precisa gerar objeto novo à toa.
 */
function podar(
  expanded: Readonly<Record<string, readonly string[]>>,
  snapshot: BoardsSnapshot,
): Readonly<Record<string, readonly string[]>> {
  const podado: Record<string, readonly string[]> = {}
  let mudou = false

  for (const [key, abertos] of Object.entries(expanded)) {
    const cards = cardsOf(snapshot, key)

    if (cards === null) {
      podado[key] = abertos
      continue
    }

    const sobreviventes = abertos.filter((id) => cards.some((card) => card.itemId === id))

    if (sobreviventes.length !== abertos.length) mudou = true
    if (sobreviventes.length > 0) podado[key] = sobreviventes
  }

  return mudou ? podado : expanded
}

/**
 * A aba ativa do retrato, ou `null`.
 *
 * A escolha é do main e chega pronta no `activeKey`; a tela só a resolve em aba. Reimplementar a
 * escolha aqui para conferi-la seria a segunda regra de preservação que este arquivo existe para
 * não ter.
 */
export function activeTab(snapshot: BoardsSnapshot): BoardTab | null {
  return snapshot.boards?.find((tab) => tab.key === snapshot.activeKey) ?? null
}
