// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CardScreen } from '../../src/renderer/screens/CardScreen'
import type { BoardCard, BoardsSnapshot } from '../../src/shared/board'

/**
 * #100 CA-2, a tela da janela do card (#103, task 6): acha o card nos boards do retrato, mostra o
 * mesmo cartão da principal (conteúdo + terminal quando a coluna conversa), e não sobe processo
 * para card sem conversa. O `ClaudeTerminal` é um dublê — quem fala com o PTY é o smoke.
 */
vi.mock('../../src/renderer/components/ClaudeTerminal', () => ({
  ClaudeTerminal: () => <div data-testid="claude-terminal" />,
}))
vi.mock('../../src/renderer/components/CardContent', () => ({
  CardContent: () => <div data-testid="card-content" />,
}))

function card(itemId: string, number: number, columnId: string): BoardCard {
  return {
    itemId,
    number,
    title: `Card ${String(number)}`,
    url: `https://github.com/o/r/issues/${String(number)}`,
    repository: 'o/r',
    closed: false,
    assignees: [],
    columnId,
    fields: [],
    parent: null,
    phases: [],
  }
}

/** Duas colunas: a de implementação conversa, a de produção não. */
function retrato(cards: BoardCard[]): BoardsSnapshot {
  return {
    boards: [
      {
        key: 'o/1',
        title: 'Board',
        readAt: 1,
        error: null,
        board: {
          columns: [
            { id: 'impl', name: 'Implementação', conversable: true, triage: false },
            { id: 'prod', name: 'Produção', conversable: false, triage: false },
          ],
          cards,
        },
      },
    ],
    activeKey: 'o/1',
    discoveryError: null,
  } as unknown as BoardsSnapshot
}

const oc = {
  cardItemId: 'PVTI_a',
  bringBackCardWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  minimizeWindow: vi.fn(() => Promise.resolve()),
  toggleMaximizeWindow: vi.fn(() => Promise.resolve()),
  setDangerous: vi.fn(() => Promise.resolve()),
  readWindow: vi.fn(() => Promise.resolve({ maximized: false })),
  onWindow: vi.fn(() => () => {}),
  readTheme: vi.fn(() => Promise.resolve({ theme: 'lavanda' })),
  onTheme: vi.fn(() => () => {}),
  theme: 'lavanda',
  readBoards: vi.fn(),
  onBoards: vi.fn(() => () => {}),
  readConversations: vi.fn(() => Promise.resolve({ itemIds: [] })),
  onConversations: vi.fn(() => () => {}),
  readDangerous: vi.fn(() => Promise.resolve({ itemIds: [], boardKeys: [] })),
  onDangerous: vi.fn(() => () => {}),
  readClaudeStates: vi.fn(() => Promise.resolve([])),
  onClaudeState: vi.fn(() => () => {}),
}

function montar(itemId: string, cards: BoardCard[]): void {
  oc.cardItemId = itemId
  oc.readBoards.mockResolvedValue(retrato(cards))
  Object.defineProperty(window, 'oc', { value: oc, configurable: true })
  // O jsdom não implementa `scrollIntoView`, que o cartão expandido chama ao abrir.
  Element.prototype.scrollIntoView = () => {}
  render(<CardScreen />)
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('#100 CA-2 — CardScreen', () => {
  it('card conversável: faixa com número e título, conteúdo e o terminal', async () => {
    montar('PVTI_a', [card('PVTI_a', 7, 'impl')])

    expect(await screen.findByTestId('claude-terminal')).toBeTruthy()
    expect(screen.getByTestId('card-content')).toBeTruthy()
    expect(screen.getByTestId('card-window-title').textContent).toBe('#7 Card 7')
    // O cartão da janela não oferece o que só faz sentido na principal.
    expect(screen.queryByTestId('card-maximize')).toBeNull()
    expect(screen.queryByTestId('card-detach')).toBeNull()
  })

  it('card sem conversa: conteúdo, mas nenhum terminal (nenhum openClaude)', async () => {
    montar('PVTI_p', [card('PVTI_p', 8, 'prod')])

    expect(await screen.findByTestId('card-content')).toBeTruthy()
    expect(screen.queryByTestId('claude-terminal')).toBeNull()
  })

  it('card sumido: mensagem, e só dá para fechar', async () => {
    montar('PVTI_x', [card('PVTI_a', 7, 'impl')])

    expect((await screen.findByTestId('card-gone')).textContent).toContain(
      'Este card não está mais no board',
    )
    expect(screen.queryByTestId('card-bring-back')).toBeNull()
    expect(screen.queryByTestId('claude-terminal')).toBeNull()

    fireEvent.click(screen.getByTestId('window-close'))

    expect(oc.closeWindow).toHaveBeenCalledOnce()
  })

  it('antes do primeiro retrato não afirma que o card sumiu', () => {
    oc.cardItemId = 'PVTI_a'
    oc.readBoards.mockReturnValue(new Promise(() => {}))
    Object.defineProperty(window, 'oc', { value: oc, configurable: true })
    render(<CardScreen />)

    expect(screen.queryByTestId('card-gone')).toBeNull()
  })

  it('"Trazer de volta" chama bringBackCardWindow com o itemId', async () => {
    montar('PVTI_a', [card('PVTI_a', 7, 'impl')])

    fireEvent.click(await screen.findByTestId('card-bring-back'))

    expect(oc.bringBackCardWindow).toHaveBeenCalledExactlyOnceWith({ itemId: 'PVTI_a' })
  })

  it('minimizar e maximizar usam os canais da janela', async () => {
    montar('PVTI_a', [card('PVTI_a', 7, 'impl')])
    await waitFor(() => {
      expect(screen.getByTestId('card-window-title')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('window-minimize'))
    fireEvent.click(screen.getByTestId('window-maximize'))

    expect(oc.minimizeWindow).toHaveBeenCalledOnce()
    expect(oc.toggleMaximizeWindow).toHaveBeenCalledOnce()
  })
})
