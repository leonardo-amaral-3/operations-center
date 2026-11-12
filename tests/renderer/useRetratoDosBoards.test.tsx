// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useRetratoDosBoards } from '../../src/renderer/fabrica/useRetratoDosBoards'
import type { BoardsSnapshot } from '../../src/shared/board'

afterEach(cleanup)

const A: BoardsSnapshot = { boards: [], activeKey: 'a/1', discoveryError: null }
const B: BoardsSnapshot = { boards: [], activeKey: 'b/2', discoveryError: null }

let publicar: (s: BoardsSnapshot) => void
let resposta: Promise<BoardsSnapshot>
let cancelamentos: number
let ordem: string[]

beforeEach(() => {
  cancelamentos = 0
  ordem = []
  resposta = Promise.resolve(A)
  ;(window as unknown as { oc: unknown }).oc = {
    onBoards: (ouvinte: typeof publicar) => {
      ordem.push('assina')
      publicar = ouvinte
      return () => {
        cancelamentos += 1
      }
    },
    readBoards: () => {
      ordem.push('pede')
      return resposta
    },
  }
})

describe('useRetratoDosBoards', () => {
  it('assina antes de pedir e aplica o retrato lido', async () => {
    const { result } = renderHook(() => useRetratoDosBoards())
    expect(result.current).toBeNull()
    expect(ordem).toEqual(['assina', 'pede'])
    await waitFor(() => expect(result.current).toBe(A))
  })

  it('o evento que chegou antes vence a resposta em trânsito', async () => {
    let soltar: (s: BoardsSnapshot) => void = () => undefined
    resposta = new Promise((r) => {
      soltar = r
    })
    const { result } = renderHook(() => useRetratoDosBoards())
    act(() => publicar(B))
    expect(result.current).toBe(B)
    await act(async () => {
      soltar(A)
      await resposta
    })
    expect(result.current).toBe(B)
  })

  it('rejeição mantém null, e mantém o último retrato depois de um evento', async () => {
    resposta = Promise.reject(new Error('sem ponte'))
    const { result } = renderHook(() => useRetratoDosBoards())
    await act(async () => {
      await resposta.catch(() => undefined)
    })
    expect(result.current).toBeNull()
    act(() => publicar(B))
    expect(result.current).toBe(B)
  })

  it('cancela a assinatura ao desmontar', () => {
    const { unmount } = renderHook(() => useRetratoDosBoards())
    unmount()
    expect(cancelamentos).toBe(1)
  })
})
