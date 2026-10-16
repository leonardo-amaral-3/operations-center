// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KanbanScreen } from '../../src/renderer/screens/KanbanScreen'
import type { BoardCard, BoardTab, BoardsSnapshot } from '../../src/shared/board'
import type { ClaudeStateEvent } from '../../src/shared/claude'

/**
 * A faixa de conversas na tela (#100, CA-1): clicar na aba de um card de **outro** board pede a
 * troca de aba ao main, e quando o retrato com aquele `activeKey` chega, o card aparece maximizado.
 *
 * O terminal e o conteúdo do card são stubs: o que se afirma é a orquestração da tela, e subir xterm
 * ou o `CardContent` aqui mediria outra coisa. A ponte é a mínima que o `KanbanScreen` toca —
 * como o `fakeOc`, sem reproduzir regra do main: quem publica o retrato é o teste.
 */

vi.mock('../../src/renderer/components/ClaudeTerminal', () => ({ ClaudeTerminal: () => null }))
vi.mock('../../src/renderer/components/CardContent', () => ({ CardContent: () => null }))

afterEach(cleanup)

const OPT = 'OPT_IMP'

function card(itemId: string, number: number): BoardCard {
  return {
    itemId,
    number,
    title: `Card ${number}`,
    url: `https://example.invalid/${number}`,
    repository: 'leonardo-amaral-3/operations-center',
    closed: false,
    assignees: [],
    columnId: OPT,
    fields: [],
    parent: null,
    phases: [],
  }
}

function aba(key: string, cards: BoardCard[]): BoardTab {
  return {
    key,
    title: key,
    readAt: 1,
    error: null,
    board: {
      title: key,
      columns: [{ id: OPT, name: '🔨 Implementação', conversable: true, triage: false }],
      cards,
    },
  }
}

const BOARDS = [aba('o/1', [card('PVTI_A', 10)]), aba('o/2', [card('PVTI_B', 20)])]

function retrato(activeKey: string): BoardsSnapshot {
  return { boards: BOARDS, activeKey, discoveryError: null }
}

let publicarBoards: (snapshot: BoardsSnapshot) => void
let publicarClaude: (event: ClaudeStateEvent) => void
const activateBoard = vi.fn()

beforeEach(() => {
  activateBoard.mockReset()

  const semAssinar = () => () => {}

  const ponte = {
    theme: { palette: 'x', mode: 'light' },
    onTheme: semAssinar,
    readTheme: () => new Promise(() => {}),
    onBoards: (ouvinte: (snapshot: BoardsSnapshot) => void) => {
      publicarBoards = ouvinte

      return () => {}
    },
    readBoards: () => Promise.resolve(retrato('o/1')),
    onConversations: semAssinar,
    readConversations: () => Promise.resolve({ itemIds: [] }),
    onDangerous: semAssinar,
    readDangerous: () => Promise.resolve({ itemIds: [], boardKeys: [] }),
    onClaudeState: (ouvinte: (event: ClaudeStateEvent) => void) => {
      publicarClaude = ouvinte

      return () => {}
    },
    readClaudeStates: () => Promise.resolve([]),
    activateBoard,
  }

  Object.defineProperty(window, 'oc', { value: ponte, configurable: true })
})

function vivo(itemId: string): ClaudeStateEvent {
  return { scope: { kind: 'card', itemId }, id: `pty_${itemId}`, state: { kind: 'working' }, dangerous: false }
}

describe('#100 CA-1 — faixa de conversas no kanban', () => {
  it('clicar na aba de card de outro board troca de aba e, no retrato novo, maximiza o card', async () => {
    render(<KanbanScreen />)
    await waitFor(() => {
      expect(screen.queryAllByTestId('board-card')).toHaveLength(1)
    })

    act(() => {
      publicarClaude(vivo('PVTI_A'))
      publicarClaude(vivo('PVTI_B'))
    })

    const abas = screen.getAllByTestId('card-tab')

    expect(abas.map((a) => a.dataset.itemId)).toEqual(['PVTI_A', 'PVTI_B'])

    fireEvent.click(abas[1] as HTMLElement)

    // Pede a troca ao main, com a chave do board do card, e a tela não adianta a aba.
    expect(activateBoard).toHaveBeenCalledExactlyOnceWith({ key: 'o/2' })
    expect(screen.queryByTestId('card-maximize')).toBeNull()

    act(() => {
      publicarBoards(retrato('o/2'))
    })

    const maximizar = await screen.findByTestId('card-maximize')

    expect(maximizar.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('board-card').dataset.cardNumber).toBe('20')
  })

  it('clicar na aba de card do board ativo maximiza na hora, sem trocar de aba', async () => {
    render(<KanbanScreen />)
    await waitFor(() => {
      expect(screen.queryAllByTestId('board-card')).toHaveLength(1)
    })

    act(() => {
      publicarClaude(vivo('PVTI_A'))
    })
    fireEvent.click(screen.getByTestId('card-tab'))

    expect(activateBoard).not.toHaveBeenCalled()
    expect((await screen.findByTestId('card-maximize')).getAttribute('aria-pressed')).toBe('true')
  })

  it('o card maximizado cobre só a área das colunas: a faixa fica fora do bloco de contenção', async () => {
    render(<KanbanScreen />)
    await waitFor(() => {
      expect(screen.queryAllByTestId('board-card')).toHaveLength(1)
    })

    act(() => {
      publicarClaude(vivo('PVTI_A'))
    })
    fireEvent.click(screen.getByTestId('card-tab'))
    await screen.findByTestId('card-maximize')

    // O jsdom não faz layout: o que se prova é a árvore. O `absolute inset-0` do cartão resolve
    // contra o ancestral posicionado mais próximo, e ele tem de ser a área, que não contém a faixa.
    const area = screen.getByTestId('kanban-area')

    expect(area.className).toContain('relative')
    expect(screen.getByTestId('kanban-screen').className).not.toContain('relative')
    expect(area.contains(screen.getByTestId('board-card'))).toBe(true)
    expect(area.contains(screen.getByTestId('card-tabs'))).toBe(false)
  })
})
