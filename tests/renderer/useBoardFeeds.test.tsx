// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useBoardFeeds } from '../../src/renderer/screens/useBoardFeeds'
import type { BoardsSnapshot } from '../../src/shared/board'
import type { ClaudeStateEvent } from '../../src/shared/claude'
import type { DangerousSnapshot } from '../../src/shared/ipc'

/**
 * As quatro assinaturas extraídas do `KanbanScreen` (#103, task 4). Os testes de tela já provam
 * que nada mudou; aqui fica o contrato do hook: assinar antes de pedir, o evento mais novo vence a
 * leitura em trânsito, e os callbacks mais novos são os chamados sem refazer assinatura.
 *
 * A ponte é a mínima que o hook toca, no molde do `KanbanScreen-abas`: quem publica é o teste.
 */

afterEach(cleanup)

const VAZIO: BoardsSnapshot = { boards: null, activeKey: null, discoveryError: null }
const FRESCO: BoardsSnapshot = { boards: [], activeKey: 'o/1', discoveryError: null }

function estado(itemId: string): ClaudeStateEvent {
  return { scope: { kind: 'card', itemId }, id: `pty_${itemId}`, state: { kind: 'working' }, dangerous: false }
}

let publicarBoards: (snapshot: BoardsSnapshot) => void
let publicarConversas: (next: { itemIds: string[] }) => void
let publicarPerigo: (next: DangerousSnapshot) => void
let publicarClaude: (event: ClaudeStateEvent) => void
let respostaBoards: Promise<BoardsSnapshot>
let cancelamentos: number

beforeEach(() => {
  cancelamentos = 0
  respostaBoards = Promise.resolve(VAZIO)

  const cancelar = () => {
    cancelamentos += 1
  }

  const ponte = {
    onBoards: (ouvinte: typeof publicarBoards) => {
      publicarBoards = ouvinte

      return cancelar
    },
    readBoards: () => respostaBoards,
    onConversations: (ouvinte: typeof publicarConversas) => {
      publicarConversas = ouvinte

      return cancelar
    },
    readConversations: () => Promise.resolve({ itemIds: ['A'] }),
    onDangerous: (ouvinte: typeof publicarPerigo) => {
      publicarPerigo = ouvinte

      return cancelar
    },
    readDangerous: () => Promise.resolve({ itemIds: ['B'], boardKeys: [] }),
    onClaudeState: (ouvinte: typeof publicarClaude) => {
      publicarClaude = ouvinte

      return cancelar
    },
    readClaudeStates: () => Promise.resolve([estado('X')]),
  }

  Object.defineProperty(window, 'oc', { value: ponte, configurable: true })
})

describe('#103 task 4 — useBoardFeeds', () => {
  it('entrega a leitura inicial: retrato e estados pelos callbacks, conversas e perigo como valor', async () => {
    const onSnapshot = vi.fn()
    const onClaudeState = vi.fn()

    const { result } = renderHook(() => useBoardFeeds({ onSnapshot, onClaudeState }))

    await waitFor(() => {
      expect(result.current.conversations).toEqual(['A'])
    })

    expect(result.current.dangerous.itemIds).toEqual(['B'])
    expect(onSnapshot).toHaveBeenCalledExactlyOnceWith(VAZIO)
    expect(onClaudeState).toHaveBeenCalledExactlyOnceWith(estado('X'))
  })

  it('o evento publicado antes da resposta vence a leitura em trânsito', async () => {
    let soltar!: (snapshot: BoardsSnapshot) => void
    respostaBoards = new Promise((resolve) => {
      soltar = resolve
    })
    const onSnapshot = vi.fn()

    renderHook(() => useBoardFeeds({ onSnapshot, onClaudeState: vi.fn() }))

    act(() => {
      publicarBoards(FRESCO)
    })
    await act(async () => {
      soltar(VAZIO)
      await respostaBoards
    })

    expect(onSnapshot).toHaveBeenCalledExactlyOnceWith(FRESCO)
  })

  it('callback novo a cada render não refaz assinatura, e o mais novo é o chamado', async () => {
    const primeiro = vi.fn()
    const segundo = vi.fn()

    const { rerender, unmount } = renderHook(
      ({ cb }) => useBoardFeeds({ onSnapshot: vi.fn(), onClaudeState: cb }),
      { initialProps: { cb: primeiro } },
    )
    await waitFor(() => {
      expect(primeiro).toHaveBeenCalled()
    })

    rerender({ cb: segundo })
    expect(cancelamentos).toBe(0)

    act(() => {
      publicarClaude(estado('Y'))
    })

    expect(segundo).toHaveBeenCalledExactlyOnceWith(estado('Y'))

    act(() => {
      publicarConversas({ itemIds: ['C'] })
      publicarPerigo({ itemIds: [], boardKeys: ['k'] })
    })
    unmount()

    // Quatro assinaturas, quatro cancelamentos — e só na saída de cena.
    expect(cancelamentos).toBe(4)
  })
})
