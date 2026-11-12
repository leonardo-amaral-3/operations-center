// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { INTERVALO_DA_SALA_MS, useSala } from '../../src/renderer/fabrica/useSala'
import type { SalaDaFabrica } from '../../src/shared/fabrica'

/**
 * A releitura da sala da fábrica (#122, §A5): uma chamada na montagem e outra a cada 5 s, nunca
 * duas em voo, rejeição que não derruba nada e resposta tardia ignorada. Timers falsos e um
 * `window.oc.readFabrica` falso: o main nem entra.
 */

const lido = (lidoEm: string): SalaDaFabrica => ({
  kind: 'sem-estado',
  lidoEm,
  projeto: 'Operations Center · Project 2',
  despachante: 'parado',
  pausa: null,
  recursos: {
    sessoes: { kind: 'ok', vivas: 0, teto: 3 },
    suite: { kind: 'livre' },
    disco: { kind: 'ok', livres: 50 * 1024 ** 3, minimo: 2 * 1024 ** 3 },
  },
})

const readFabrica = vi.fn<() => Promise<SalaDaFabrica>>()

beforeEach(() => {
  vi.useFakeTimers()
  readFabrica.mockReset()
  Object.defineProperty(window, 'oc', { value: { readFabrica }, configurable: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useSala', () => {
  it('lê na montagem e de novo a cada 5000 ms', async () => {
    readFabrica.mockResolvedValue(lido('a'))

    const { result } = renderHook(() => useSala())

    expect(result.current.sala).toBeNull()
    expect(readFabrica).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.sala).toEqual(lido('a'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS - 1)
    })
    expect(readFabrica).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(readFabrica).toHaveBeenCalledTimes(2)
  })

  it('não começa outra leitura enquanto a primeira não respondeu', async () => {
    let responder: (sala: SalaDaFabrica) => void = () => {}

    readFabrica.mockImplementationOnce(
      () =>
        new Promise<SalaDaFabrica>((resolve) => {
          responder = resolve
        }),
    )
    readFabrica.mockResolvedValue(lido('b'))

    renderHook(() => useSala())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS * 3)
    })
    expect(readFabrica).toHaveBeenCalledTimes(1)

    await act(async () => {
      responder(lido('a'))
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS)
    })
    expect(readFabrica).toHaveBeenCalledTimes(2)
  })

  it('uma rejeição mantém o retrato e a leitura seguinte acontece', async () => {
    readFabrica.mockResolvedValueOnce(lido('a'))
    readFabrica.mockRejectedValueOnce(new Error('falhou'))
    readFabrica.mockResolvedValueOnce(lido('c'))

    const { result } = renderHook(() => useSala())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.sala).toEqual(lido('a'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS)
    })
    expect(readFabrica).toHaveBeenCalledTimes(2)
    expect(result.current.sala).toEqual(lido('a'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS)
    })
    expect(readFabrica).toHaveBeenCalledTimes(3)
    expect(result.current.sala).toEqual(lido('c'))
  })

  it('resposta que chega depois da desmontagem não é aplicada, e nada mais é chamado', async () => {
    let responder: (sala: SalaDaFabrica) => void = () => {}

    readFabrica.mockImplementationOnce(
      () =>
        new Promise<SalaDaFabrica>((resolve) => {
          responder = resolve
        }),
    )

    const { result, unmount } = renderHook(() => useSala())

    unmount()
    await act(async () => {
      responder(lido('tarde'))
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS * 3)
    })

    expect(result.current.sala).toBeNull()
    expect(readFabrica).toHaveBeenCalledTimes(1)
  })

  it('reler faz uma leitura fora do intervalo e resolve com o retrato novo aplicado', async () => {
    readFabrica.mockResolvedValueOnce(lido('a'))
    readFabrica.mockResolvedValueOnce(lido('b'))

    const { result } = renderHook(() => useSala())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.sala).toEqual(lido('a'))

    await act(async () => {
      await result.current.reler()
    })
    expect(readFabrica).toHaveBeenCalledTimes(2)
    expect(result.current.sala).toEqual(lido('b'))
  })

  it('reler com uma leitura em voo espera ela e faz mais uma; nunca rejeita', async () => {
    let responder: (sala: SalaDaFabrica) => void = () => {}

    readFabrica.mockImplementationOnce(
      () =>
        new Promise<SalaDaFabrica>((resolve) => {
          responder = resolve
        }),
    )
    readFabrica.mockRejectedValueOnce(new Error('falhou'))

    const { result } = renderHook(() => useSala())
    let resolvido = false
    let pedido: Promise<void> = Promise.resolve()

    act(() => {
      pedido = result.current.reler().then(() => {
        resolvido = true
      })
    })
    expect(readFabrica).toHaveBeenCalledTimes(1)
    expect(resolvido).toBe(false)

    await act(async () => {
      responder(lido('a'))
      await pedido
    })
    expect(readFabrica).toHaveBeenCalledTimes(2)
    expect(resolvido).toBe(true)
    expect(result.current.sala).toEqual(lido('a'))
  })
})
