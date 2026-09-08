import { describe, expect, it } from 'vitest'

import type { Board, BoardTab, BoardsSnapshot } from '../../src/shared/board'
import {
  activeTab,
  INITIAL_KANBAN,
  reduceKanban,
} from '../../src/renderer/screens/kanbanState'
import type { KanbanAction, KanbanState } from '../../src/renderer/screens/kanbanState'

/**
 * A parte pura do `KanbanScreen`: o retrato dos boards na tela e o cartão aberto de cada aba.
 *
 * O que se prova aqui é o que o smoke das abas afirma de fora — trocar de aba troca o kanban, e a
 * conversa aberta não vaza de uma aba para a outra —, só que na regra e sem subir Electron.
 */

const AGORA = 1_700_000_000_000

function board(titulo: string): Board {
  return {
    title: titulo,
    columns: [{ id: 'OPT_TRI', name: '📥 Triagem', conversable: true }],
    cards: [],
  }
}

function aba(key: string, title: string): BoardTab {
  return { key, title, board: board(title), readAt: AGORA, error: null }
}

const A = aba('leonardo-amaral-3/2', 'Operations Center')
const B = aba('ICSF-Solutions/7', 'Plataformas v2')

function retrato(activeKey: string | null, boards: readonly BoardTab[] = [A, B]): BoardsSnapshot {
  return { boards, activeKey, discoveryError: null }
}

function apply(...actions: KanbanAction[]): KanbanState {
  return actions.reduce<KanbanState>(reduceKanban, INITIAL_KANBAN)
}

describe('reduceKanban', () => {
  it('substitui o retrato inteiro, e a aba ativa sai do `activeKey`', () => {
    const state = apply({ type: 'snapshot', snapshot: retrato(B.key) })

    expect(state.snapshot.boards).toHaveLength(2)
    // A tela não escolhe aba: `activeTab` segue o `activeKey` que o main mandou, e é isso que faz
    // trocar de aba trocar o kanban inteiro.
    expect(activeTab(state.snapshot)).toBe(B)

    const trocada = reduceKanban(state, { type: 'snapshot', snapshot: retrato(A.key) })
    expect(activeTab(trocada.snapshot)).toBe(A)
  })

  it('sem `activeKey` — ou com uma chave que não está na lista — não há aba ativa', () => {
    expect(activeTab(retrato(null))).toBeNull()
    expect(activeTab(retrato('dono/404'))).toBeNull()
    // Antes da descoberta não há lista onde procurar, e o `null` do `boards` é o que separa isso de
    // "descobri e não achei nada".
    expect(activeTab(INITIAL_KANBAN.snapshot)).toBeNull()
  })

  it('o cartão aberto é por aba: abrir na B não fecha o da A', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: B.key, itemId: 'PVTI_B1' },
    )

    // A Decisão 12 inteira numa asserção: um cartão aberto no app inteiro faria a segunda linha
    // apagar a primeira, e a conversa da A não sobreviveria à troca de aba.
    expect(state.expanded).toEqual({ [A.key]: 'PVTI_A1', [B.key]: 'PVTI_B1' })
  })

  it('dentro de uma aba a regra do RF-6 não muda: o segundo cartão fecha o primeiro', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: B.key, itemId: 'PVTI_B1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A2' },
    )

    expect(state.expanded).toEqual({ [A.key]: 'PVTI_A2', [B.key]: 'PVTI_B1' })
  })

  it('clicar no cartão aberto fecha só a entrada daquela aba', () => {
    const state = apply(
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      { type: 'toggle', key: B.key, itemId: 'PVTI_B1' },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
    )

    // Ausente, e não `null`: "nenhum aberto naquela aba" é a chave não estar lá.
    expect(state.expanded).toEqual({ [B.key]: 'PVTI_B1' })
    expect(A.key in state.expanded).toBe(false)
  })

  it('retrato novo não fecha cartão aberto', () => {
    const state = apply(
      { type: 'snapshot', snapshot: retrato(A.key) },
      { type: 'toggle', key: A.key, itemId: 'PVTI_A1' },
      // Uma releitura do board, que é o que o main publica a cada foco da janela.
      { type: 'snapshot', snapshot: retrato(A.key, [aba(A.key, 'Operations Center'), B]) },
    )

    // O `snapshot` é substituído inteiro — a tela não recompõe nada —, mas o cartão aberto é do
    // usuário, não da leitura: fechá-lo a cada releitura tornaria a conversa impossível.
    expect(state.expanded).toEqual({ [A.key]: 'PVTI_A1' })
    expect(state.snapshot.boards?.[0]?.title).toBe('Operations Center')
  })
})
