// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KanbanScreen } from '../../src/renderer/screens/KanbanScreen'
import type { BoardCard, BoardTab, BoardsSnapshot } from '../../src/shared/board'
import type { ClaudeStateEvent, OpenClaudeResult } from '../../src/shared/claude'

/**
 * Fechar a aba de um card (#114, CA-1/CA-2/CA-3), pela tela: o `ClaudeTerminal` é o **real** e só o
 * registro `claudeTerminals` é dublado. O bug era um `attach` extra depois do encerramento
 * republicar estado vivo e a aba voltar — só uma montagem de verdade enxerga isso, e por isso o
 * `attach` é contado.
 */

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  end: vi.fn(),
}))

vi.mock('../../src/renderer/terminal/claudeTerminals', () => ({
  attach: mocks.attach,
  end: mocks.end,
  detach: () => {},
  fit: () => {},
  focus: () => {},
}))
vi.mock('../../src/renderer/components/CardContent', () => ({ CardContent: () => null }))

afterEach(cleanup)

const OPT = 'OPT_IMP'

const CARD: BoardCard = {
  itemId: 'PVTI_A',
  number: 10,
  title: 'Card 10',
  url: 'https://example.invalid/10',
  repository: 'leonardo-amaral-3/operations-center',
  closed: false,
  assignees: [],
  columnId: OPT,
  fields: [],
  parent: null,
  phases: [],
}

const ABA: BoardTab = {
  key: 'o/1',
  title: 'o/1',
  readAt: 1,
  error: null,
  board: {
    title: 'o/1',
    columns: [{ id: OPT, name: '🔨 Implementação', conversable: true, triage: false }],
    cards: [CARD],
  },
}

const RETRATO: BoardsSnapshot = { boards: [ABA], activeKey: 'o/1', discoveryError: null }

const ABERTO: OpenClaudeResult = {
  ok: true,
  id: 'pty_PVTI_A',
  state: { kind: 'working' },
  dangerous: false,
  spawned: true,
}

let publicarClaude: (event: ClaudeStateEvent) => void
let publicarJanelas: (itemIds: string[]) => void
const focusCardWindow = vi.fn()

beforeEach(() => {
  mocks.attach.mockReset()
  mocks.attach.mockResolvedValue(ABERTO)
  mocks.end.mockReset()
  mocks.end.mockResolvedValue(undefined)
  focusCardWindow.mockReset()

  const semAssinar = () => () => {}
  // O `ClaudeTerminal` real também assina: com um ouvinte só, o `closed` não chegaria à tela.
  const ouvintes = new Set<(event: ClaudeStateEvent) => void>()

  publicarClaude = (event) => {
    for (const ouvinte of ouvintes) ouvinte(event)
  }

  const ponte = {
    theme: { palette: 'x', mode: 'light' },
    onTheme: semAssinar,
    readTheme: () => new Promise(() => {}),
    onBoards: semAssinar,
    readBoards: () => Promise.resolve(RETRATO),
    onConversations: semAssinar,
    readConversations: () => Promise.resolve({ itemIds: [] }),
    onDangerous: semAssinar,
    readDangerous: () => Promise.resolve({ itemIds: [], boardKeys: [] }),
    setDangerous: () => Promise.resolve(),
    chooseFolder: () => Promise.resolve(null),
    onClaudeState: (ouvinte: (event: ClaudeStateEvent) => void) => {
      ouvintes.add(ouvinte)

      return () => {
        ouvintes.delete(ouvinte)
      }
    },
    readClaudeStates: () => Promise.resolve([]),
    activateBoard: () => Promise.resolve(),
    onCardWindows: (ouvinte: (itemIds: string[]) => void) => {
      publicarJanelas = ouvinte

      return () => {}
    },
    readCardWindows: () => Promise.resolve([]),
    focusCardWindow,
    openCardWindow: () => Promise.resolve(),
  }

  Object.defineProperty(window, 'oc', { value: ponte, configurable: true })
})

function vivo(): ClaudeStateEvent {
  return {
    scope: { kind: 'card', itemId: 'PVTI_A' },
    id: 'pty_PVTI_A',
    state: { kind: 'working' },
    dangerous: false,
  }
}

function fechado(): ClaudeStateEvent {
  return {
    scope: { kind: 'card', itemId: 'PVTI_A' },
    id: 'pty_PVTI_A',
    state: { kind: 'closed' },
    dangerous: false,
  }
}

async function montar(): Promise<void> {
  render(<KanbanScreen />)
  await waitFor(() => {
    expect(screen.queryAllByTestId('board-card')).toHaveLength(1)
  })
  act(() => {
    publicarClaude(vivo())
  })
}

describe('#114 CA-3 — fechar a aba pela tela', () => {
  it('✕ na aba encerra o terminal e a aba some quando o closed chega', async () => {
    await montar()
    fireEvent.click(screen.getByTestId('card-tab'))
    await screen.findByTestId('card-open-body')
    await waitFor(() => {
      expect(mocks.attach).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByTestId('card-tab-close'))

    expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ kind: 'card', itemId: 'PVTI_A' })
    expect(screen.queryByTestId('card-open-body')).toBeNull()

    act(() => {
      publicarClaude(fechado())
    })

    expect(screen.queryByTestId('card-tab')).toBeNull()
    expect(mocks.attach).toHaveBeenCalledTimes(1)
  })

  it('Encerrar sessão fecha o cartão, não reanexa, e a aba some', async () => {
    await montar()
    fireEvent.click(screen.getByTestId('card-tab'))
    await screen.findByTestId('card-open-body')
    await waitFor(() => {
      expect(mocks.attach).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByTestId('card-end-session'))

    await waitFor(() => {
      expect(screen.queryByTestId('card-open-body')).toBeNull()
    })
    expect(mocks.end).toHaveBeenCalledTimes(1)
    expect(mocks.attach).toHaveBeenCalledTimes(1)

    act(() => {
      publicarClaude(fechado())
    })

    expect(screen.queryByTestId('card-tabs')).toBeNull()
  })

  it('✕ na aba destacada encerra, sem focusCardWindow', async () => {
    await montar()
    act(() => {
      publicarJanelas(['PVTI_A'])
    })

    fireEvent.click(screen.getByTestId('card-tab-close'))

    expect(mocks.end).toHaveBeenCalledExactlyOnceWith({ kind: 'card', itemId: 'PVTI_A' })
    expect(focusCardWindow).not.toHaveBeenCalled()
  })
})
