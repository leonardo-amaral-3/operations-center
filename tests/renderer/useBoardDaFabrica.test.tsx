// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CHAVE_DO_BOARD_DA_FABRICA } from '../../src/renderer/fabrica/boardDaFabrica'
import { useBoardDaFabrica } from '../../src/renderer/fabrica/useBoardDaFabrica'
import type { BoardsSnapshot } from '../../src/shared/board'

afterEach(cleanup)

const board = { title: 'OC', columns: [], cards: [] }
const COM_BOARD = {
  boards: [{ key: CHAVE_DO_BOARD_DA_FABRICA, title: 'OC', board, readAt: 1, error: null }],
  activeKey: null,
  discoveryError: null,
} as unknown as BoardsSnapshot
const VAZIO: BoardsSnapshot = { boards: null, activeKey: null, discoveryError: null }

let publicar: (s: BoardsSnapshot) => void
let resposta: Promise<BoardsSnapshot>
let cancelamentos: number

beforeEach(() => {
  cancelamentos = 0
  resposta = Promise.resolve(VAZIO)
  ;(window as unknown as { oc: unknown }).oc = {
    onBoards: (ouvinte: typeof publicar) => {
      publicar = ouvinte
      return () => {
        cancelamentos += 1
      }
    },
    readBoards: () => resposta,
  }
})

describe('useBoardDaFabrica', () => {
  it('começa lendo e aplica o retrato lido', async () => {
    resposta = Promise.resolve(COM_BOARD)
    const { result } = renderHook(() => useBoardDaFabrica())
    expect(result.current).toEqual({ kind: 'lendo' })
    await waitFor(() => expect(result.current).toEqual({ kind: 'ok', board }))
  })

  it('o evento que chegou antes vence a resposta em trânsito', async () => {
    let soltar: (s: BoardsSnapshot) => void = () => undefined
    resposta = new Promise((r) => {
      soltar = r
    })
    const { result } = renderHook(() => useBoardDaFabrica())
    act(() => publicar(COM_BOARD))
    expect(result.current.kind).toBe('ok')
    await act(async () => {
      soltar({ boards: [], activeKey: null, discoveryError: null })
      await resposta
    })
    expect(result.current.kind).toBe('ok')
  })

  it('rejeição vira erro com a mensagem', async () => {
    resposta = Promise.reject(new Error('sem ponte'))
    const { result } = renderHook(() => useBoardDaFabrica())
    await waitFor(() => expect(result.current).toEqual({ kind: 'erro', erro: 'sem ponte' }))
  })

  it('cancela a assinatura ao desmontar', () => {
    const { unmount } = renderHook(() => useBoardDaFabrica())
    unmount()
    expect(cancelamentos).toBe(1)
  })
})
