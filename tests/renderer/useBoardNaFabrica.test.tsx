// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoardNaFabrica } from '../../src/shared/fabrica'
import type { AbaDaFabrica } from '../../src/renderer/fabrica/linhaDoBoard'
import { useBoardNaFabrica } from '../../src/renderer/fabrica/useBoardNaFabrica'
import { BOARD_DE_DOIS_REPOS, BOARD_DO_PROJECT_2 } from './boardNaFabrica'

/** O hook do board da aba (#157, §10): `window.oc.readFabricaBoard` falso, o main nem entra. */

const readFabricaBoard = vi.fn<(p: { board: string | null }) => Promise<BoardNaFabrica>>()

beforeEach(() => {
  readFabricaBoard.mockReset()
  Object.defineProperty(window, 'oc', { value: { readFabricaBoard }, configurable: true })
})
afterEach(cleanup)

const pronta = (chave: string | null): AbaDaFabrica => ({ kind: 'pronta', chave })

describe('useBoardNaFabrica', () => {
  it('lendo não pede nada', () => {
    const { result } = renderHook(() => useBoardNaFabrica({ kind: 'lendo' }))

    expect(result.current).toEqual({ kind: 'lendo' })
    expect(readFabricaBoard).not.toHaveBeenCalled()
  })

  it('chave nova pede uma vez; a segunda vez vem do cache', async () => {
    readFabricaBoard.mockResolvedValue(BOARD_DE_DOIS_REPOS)
    const { result, rerender } = renderHook(({ aba }) => useBoardNaFabrica(aba), {
      initialProps: { aba: pronta('fulano/8') },
    })

    expect(result.current).toEqual({ kind: 'lendo' })
    await waitFor(() => expect(result.current).toEqual(BOARD_DE_DOIS_REPOS))
    expect(readFabricaBoard).toHaveBeenCalledWith({ board: 'fulano/8' })

    readFabricaBoard.mockResolvedValue(BOARD_DO_PROJECT_2)
    rerender({ aba: pronta('leonardo-amaral-3/2') })
    await waitFor(() => expect(result.current).toEqual(BOARD_DO_PROJECT_2))
    expect(readFabricaBoard).toHaveBeenCalledTimes(2)

    rerender({ aba: pronta('fulano/8') })
    expect(result.current).toEqual(BOARD_DE_DOIS_REPOS)
    expect(readFabricaBoard).toHaveBeenCalledTimes(2)
  })

  it('a resposta de board null serve depois a chave do padrão, sem pedir', async () => {
    readFabricaBoard.mockResolvedValue(BOARD_DO_PROJECT_2)
    const { result, rerender } = renderHook(({ aba }) => useBoardNaFabrica(aba), {
      initialProps: { aba: pronta(null) },
    })

    await waitFor(() => expect(result.current).toEqual(BOARD_DO_PROJECT_2))
    expect(readFabricaBoard).toHaveBeenCalledWith({ board: null })

    rerender({ aba: pronta('leonardo-amaral-3/2') })
    expect(result.current).toEqual(BOARD_DO_PROJECT_2)
    expect(readFabricaBoard).toHaveBeenCalledTimes(1)
  })

  it('a resposta velha que chega depois da nova não vira estado', async () => {
    let soltarVelha: (b: BoardNaFabrica) => void = () => undefined
    readFabricaBoard.mockImplementationOnce(
      () =>
        new Promise((r) => {
          soltarVelha = r
        }),
    )
    const { result, rerender } = renderHook(({ aba }) => useBoardNaFabrica(aba), {
      initialProps: { aba: pronta('fulano/8') },
    })

    readFabricaBoard.mockResolvedValueOnce(BOARD_DO_PROJECT_2)
    rerender({ aba: pronta('leonardo-amaral-3/2') })
    await waitFor(() => expect(result.current).toEqual(BOARD_DO_PROJECT_2))

    await act(async () => {
      soltarVelha(BOARD_DE_DOIS_REPOS)
      await Promise.resolve()
    })
    expect(result.current).toEqual(BOARD_DO_PROJECT_2)
  })

  it('rejeição vira recusado com a mensagem, sem cache', async () => {
    readFabricaBoard.mockRejectedValueOnce(new Error('sem ponte'))
    const { result, rerender } = renderHook(({ aba }) => useBoardNaFabrica(aba), {
      initialProps: { aba: pronta('fulano/8') },
    })

    await waitFor(() =>
      expect(result.current).toEqual({ kind: 'recusado', chave: 'fulano/8', motivo: 'sem ponte' }),
    )

    readFabricaBoard.mockResolvedValue(BOARD_DE_DOIS_REPOS)
    rerender({ aba: { kind: 'lendo' } })
    rerender({ aba: pronta('fulano/8') })
    await waitFor(() => expect(result.current).toEqual(BOARD_DE_DOIS_REPOS))
    expect(readFabricaBoard).toHaveBeenCalledTimes(2)
  })
})
