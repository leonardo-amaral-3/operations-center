// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { INTERVALO_DA_SALA_MS } from '../../src/renderer/fabrica/useSala'
import { useSessoesDaMaquina } from '../../src/renderer/fabrica/useSessoesDaMaquina'
import type { SessoesDaMaquina } from '../../src/shared/fabrica'

/**
 * A releitura das sessões da máquina (#142, CA-2): uma leitura na montagem e outra a cada 5 s,
 * nunca duas em voo, resposta tardia ignorada e rejeição vira `sem-leitura`. Timers falsos e um
 * `window.oc.readFabricaSessoes` falso: o main nem entra.
 */

const lido = (lidoEm: string): SessoesDaMaquina => ({ kind: 'ok', lidoEm, sessoes: [] })

const readFabricaSessoes = vi.fn<() => Promise<SessoesDaMaquina>>()

beforeEach(() => {
  vi.useFakeTimers()
  readFabricaSessoes.mockReset()
  Object.defineProperty(window, 'oc', { value: { readFabricaSessoes }, configurable: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useSessoesDaMaquina', () => {
  it('lê na montagem e de novo a cada 5000 ms', async () => {
    readFabricaSessoes.mockResolvedValue(lido('a'))

    const { result } = renderHook(() => useSessoesDaMaquina())

    expect(result.current).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(readFabricaSessoes).toHaveBeenCalledTimes(1)
    expect(result.current).toEqual(lido('a'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS - 1)
    })
    expect(readFabricaSessoes).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(readFabricaSessoes).toHaveBeenCalledTimes(2)
  })

  it('não começa outra leitura enquanto a primeira não respondeu', async () => {
    let responder: (r: SessoesDaMaquina) => void = () => {}

    readFabricaSessoes.mockImplementationOnce(
      () =>
        new Promise<SessoesDaMaquina>((resolve) => {
          responder = resolve
        }),
    )
    readFabricaSessoes.mockResolvedValue(lido('b'))

    renderHook(() => useSessoesDaMaquina())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS * 3)
    })
    expect(readFabricaSessoes).toHaveBeenCalledTimes(1)

    await act(async () => {
      responder(lido('a'))
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS)
    })
    expect(readFabricaSessoes).toHaveBeenCalledTimes(2)
  })

  it('resposta depois da desmontagem é ignorada e nada mais é chamado', async () => {
    let responder: (r: SessoesDaMaquina) => void = () => {}

    readFabricaSessoes.mockImplementationOnce(
      () =>
        new Promise<SessoesDaMaquina>((resolve) => {
          responder = resolve
        }),
    )

    const { result, unmount } = renderHook(() => useSessoesDaMaquina())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    unmount()
    await act(async () => {
      responder(lido('tarde'))
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS * 3)
    })

    expect(result.current).toBeNull()
    expect(readFabricaSessoes).toHaveBeenCalledTimes(1)
  })

  it('rejeição vira sem-leitura com a mensagem, e a leitura seguinte acontece', async () => {
    readFabricaSessoes.mockRejectedValueOnce(new Error('falhou'))
    readFabricaSessoes.mockResolvedValueOnce(lido('c'))

    const { result } = renderHook(() => useSessoesDaMaquina())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current).toEqual({ kind: 'sem-leitura', motivo: 'falhou' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_DA_SALA_MS)
    })
    expect(result.current).toEqual(lido('c'))
  })

  it('sem o método no window.oc, sem-leitura em vez de exceção', async () => {
    Object.defineProperty(window, 'oc', { value: {}, configurable: true })

    const { result } = renderHook(() => useSessoesDaMaquina())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current?.kind).toBe('sem-leitura')
  })
})
