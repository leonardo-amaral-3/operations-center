/**
 * O estado do kanban na tela, e a regra que o move — sem React, sem `window`, sem DOM.
 *
 * Mora num arquivo próprio, e não dentro do `KanbanScreen`, pela mesma razão medida em
 * `session/sessionView.ts`: o `useReducer` é do componente, mas a regra que ele aplica é pura e
 * merece teste sem subir Electron. O que sobra no componente é a assinatura dos canais.
 */

import type { BoardTab, BoardsSnapshot } from '../../shared/board'

export interface KanbanState {
  /**
   * O retrato como o main o publicou. É **substituído inteiro** a cada ação `snapshot`: a tela não
   * recompõe nada, porque quem decide o que sobrevive a uma falha é o main. Duas regras de
   * preservação — uma aqui e outra lá — divergiriam num dia qualquer.
   */
  snapshot: BoardsSnapshot
  /** O cartão aberto **de cada aba**, por `key`. Ausente = nenhum aberto naquela aba. */
  expanded: Readonly<Record<string, string>>
}

export type KanbanAction =
  | { type: 'snapshot'; snapshot: BoardsSnapshot }
  /** Alterna o cartão da aba `key`: abrir o segundo fecha o primeiro **daquela aba** (RF-6). */
  | { type: 'toggle'; key: string; itemId: string }

export const INITIAL_KANBAN: KanbanState = {
  // Antes da descoberta a tela não sabe nem quantos boards existem — e `boards: null` é exatamente
  // isso, e não "descobri e não achei nenhum".
  snapshot: { boards: null, activeKey: null, discoveryError: null },
  expanded: {},
}

export function reduceKanban(state: KanbanState, action: KanbanAction): KanbanState {
  if (action.type === 'snapshot') {
    // `expanded` **atravessa** o retrato novo. Um board relido não pode fechar o cartão que o
    // usuário deixou aberto: a releitura é do main, o cartão aberto é dele.
    return { ...state, snapshot: action.snapshot }
  }

  if (state.expanded[action.key] === action.itemId) {
    // Clicar no cartão aberto fecha **só a entrada daquela aba** — e não encerra a sessão dele, que
    // continua viva atrás do cartão fechado.
    const expanded = { ...state.expanded }
    delete expanded[action.key]
    return { ...state, expanded }
  }

  // Um cartão aberto **por aba** (Decisão 12): abrir o segundo fecha o primeiro daquela aba, e as
  // outras abas não sentem nada. É isto que devolve a conversa onde ela estava ao voltar para a aba.
  return { ...state, expanded: { ...state.expanded, [action.key]: action.itemId } }
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
