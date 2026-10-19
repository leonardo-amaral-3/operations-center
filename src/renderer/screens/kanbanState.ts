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
  /**
   * O cartão expandido sobre a tela do kanban (#28), ou `null`. **Um no app inteiro**: o expandido
   * cobre a tela, então dois não caberiam. A `key` porque o cartão é de uma aba.
   *
   * Só existe enquanto o cartão está aberto **e** na aba ativa — `conferirMaximizado` zera o campo
   * nas transições que quebram uma das duas condições, em vez de cada ramo lembrar de fazê-lo.
   */
  maximizado: { key: string; itemId: string } | null
  /**
   * O foco que espera o retrato da aba `key` chegar (#100, fase 2), ou `null`. A aba de um card de
   * **outro board** pede a troca de aba ao main, e a troca volta por um retrato novo: até lá o card
   * não está na tela, então o pedido fica guardado aqui em vez de se perder.
   */
  focoPendente: { key: string; itemId: string } | null
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
  /**
   * Expande o cartão `itemId` da aba `key` (#28). Só vale para cartão **aberto**: fora disso o
   * estado volta intacto, porque expandir um cartão fechado não tem o que mostrar.
   */
  | { type: 'maximizar'; key: string; itemId: string }
  /** Devolve o cartão expandido à coluna. Sem `key`: há no máximo um. */
  | { type: 'recolher' }
  /**
   * Leva o olho ao cartão `itemId` da aba `key` (#100): abre e maximiza. Na aba ativa vale na hora;
   * em outra, guarda `focoPendente` e espera o retrato da troca de aba.
   */
  | { type: 'focar'; key: string; itemId: string }
  /**
   * Fecha o cartão `itemId` em **todas** as abas e esquece um foco pendente nele (#114, o ✕ da
   * aba). Sem `key`: a aba da faixa vale para o card em qualquer board. Idempotente.
   */
  | { type: 'fechar'; itemId: string }

export const INITIAL_KANBAN: KanbanState = {
  // Antes da descoberta a tela não sabe nem quantos boards existem — e `boards: null` é exatamente
  // isso, e não "descobri e não achei nenhum".
  snapshot: { boards: null, activeKey: null, discoveryError: null },
  expanded: {},
  triagem: null,
  maximizado: null,
  focoPendente: null,
}

export function reduceKanban(state: KanbanState, action: KanbanAction): KanbanState {
  if (action.type === 'snapshot') {
    // `expanded` **atravessa** o retrato novo: um board relido não pode fechar o cartão que o
    // usuário deixou aberto, nem quando o cartão mudou de coluna (RA-4 do #45) — fechar a conversa
    // no exato evento que este app existe para acompanhar seria o oposto do que ele faz. O que a
    // releitura tira é só o que deixou de existir.
    const novo = conferirMaximizado({
      ...state,
      snapshot: action.snapshot,
      expanded: podar(state.expanded, action.snapshot),
      // A triagem **não** atravessa a troca de aba, ao contrário de `expanded`: a decisão do card é
      // que sair da aba encerra a triagem, e quem a encerra é o painel desmontado
      // (`closeOnUnmount`). Zerar aqui é o que impede o painel de renascer — com uma sessão nova e a
      // conversa perdida — ao voltar para a aba. Aba que sumiu do retrato cai na mesma linha, porque
      // `activeKey` muda junto.
      triagem: action.snapshot.activeKey === state.triagem ? state.triagem : null,
    })

    return aplicarFocoPendente(state, novo)
  }

  if (action.type === 'abrir-triagem') return { ...state, triagem: action.key }

  // Zera e pronto: o painel já saiu de cena e a sessão dele morreu com o desmonte. Não há lista de
  // que tirar a aba, que é justamente o que o campo único compra.
  if (action.type === 'fechar-triagem') return { ...state, triagem: null }

  // Estes dois ramos precisam vir **antes** do que cai no `toggle` por exclusão: `maximizar` tem
  // `key` e `itemId`, então compilaria como `toggle` e se comportaria como um.
  if (action.type === 'maximizar') {
    if (!(state.expanded[action.key] ?? []).includes(action.itemId)) return state

    return conferirMaximizado({
      ...state,
      maximizado: { key: action.key, itemId: action.itemId },
    })
  }

  if (action.type === 'recolher') return { ...state, maximizado: null }

  // Também antes do `toggle`, que é o ramo por exclusão. Fechar via `toggle` não bastaria: um foco
  // pendente (aba de outro board clicada, retrato ainda não chegou) reabriria o cartão depois do ✕,
  // e o `attach` subiria `claude` sozinho.
  if (action.type === 'fechar') {
    let expanded = state.expanded

    for (const [key, lista] of Object.entries(state.expanded)) {
      expanded = comLista(
        expanded,
        key,
        lista.filter((id) => id !== action.itemId),
      )
    }

    const pendente = state.focoPendente?.itemId === action.itemId ? null : state.focoPendente

    return conferirMaximizado({ ...state, expanded, focoPendente: pendente })
  }

  // Também antes do `toggle`, pelo mesmo motivo: `focar` tem `key` e `itemId`.
  if (action.type === 'focar') {
    if (action.key !== state.snapshot.activeKey) {
      return { ...state, focoPendente: { key: action.key, itemId: action.itemId } }
    }

    // Card que o retrato não conhece não tem o que abrir: expandi-lo seria o `podar` desfazendo
    // no retrato seguinte.
    if (columnOf(state.snapshot, action.key, action.itemId) === null) return state

    const aberto = (state.expanded[action.key] ?? []).includes(action.itemId)
    // Abrir pela regra do `toggle` (fecha o vizinho da coluna); já aberto, não fecha.
    const base = aberto
      ? state
      : reduceKanban(state, { type: 'toggle', key: action.key, itemId: action.itemId })

    return { ...base, maximizado: { key: action.key, itemId: action.itemId } }
  }

  const abertos = state.expanded[action.key] ?? []

  if (abertos.includes(action.itemId)) {
    // Clicar no cartão aberto fecha **só ele** — não os vizinhos de coluna, não os das outras abas,
    // e não a sessão dele, que continua viva atrás do cartão fechado.
    return conferirMaximizado({
      ...state,
      expanded: comLista(
        state.expanded,
        action.key,
        abertos.filter((id) => id !== action.itemId),
      ),
    })
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
  return conferirMaximizado({
    ...state,
    expanded: comLista(state.expanded, action.key, [...sobreviventes, action.itemId]),
  })
}

/**
 * Resolve o `focoPendente` contra o retrato que acabou de entrar em `novo` (`antes` é o estado
 * anterior ao retrato). Quatro saídas:
 * - o `activeKey` é o da aba pedida: aplica o foco (se o card ainda existe) e zera;
 * - o card sumiu da aba pedida: só zera;
 * - o `activeKey` mudou para **outra** chave: só zera, para um `activateBoard` ignorado não
 *   disparar o foco numa troca manual mais tarde;
 * - o `activeKey` não mudou: mantém, porque o retrato com a troca ainda não chegou.
 */
function aplicarFocoPendente(antes: KanbanState, novo: KanbanState): KanbanState {
  const pendente = antes.focoPendente

  if (pendente === null) return novo

  const zerado = { ...novo, focoPendente: null }

  if (novo.snapshot.activeKey === pendente.key) {
    return reduceKanban(zerado, { type: 'focar', key: pendente.key, itemId: pendente.itemId })
  }

  const aba = novo.snapshot.boards?.find((candidata) => candidata.key === pendente.key)

  // Aba que saiu do retrato conta como card sumido: o `activateBoard` dela é ignorado no main, e
  // um pedido guardado dispararia se ela voltasse e o humano a ativasse à mão. Só a aba presente
  // e ainda sem leitura (`board: null`) não diz nada sobre o card.
  if (aba === undefined) return zerado
  if (aba.board && !aba.board.cards.some((card) => card.itemId === pendente.itemId)) return zerado
  if (novo.snapshot.activeKey !== antes.snapshot.activeKey) return zerado

  return novo
}

/**
 * Zera `maximizado` quando ele deixou de descrever um cartão que se possa ver expandido: a aba dele
 * não é mais a ativa, ou o cartão não está mais aberto (fechado, trocado por um vizinho da coluna,
 * ou podado do retrato — a poda já o tirou de `expanded`).
 *
 * Uma regra só, aplicada ao resultado de cada transição que mexe em `snapshot` ou `expanded`, é o
 * que cobre o CA-4 inteiro sem cada ramo ter de lembrar. Nada a zerar devolve o **mesmo** estado.
 */
function conferirMaximizado(state: KanbanState): KanbanState {
  const { maximizado } = state

  if (maximizado === null) return state

  const ativo = maximizado.key === state.snapshot.activeKey
  const aberto = (state.expanded[maximizado.key] ?? []).includes(maximizado.itemId)

  return ativo && aberto ? state : { ...state, maximizado: null }
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
