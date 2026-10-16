// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useTemaAplicado } from '../../src/renderer/useTemaAplicado'
import type { ThemeSnapshot } from '../../src/shared/ipc'
import { THEMES } from '../../src/shared/theme'

/**
 * O efeito do `data-theme` fora da `ThemePicker` (#103, task 4): a tela chama o hook na raiz, e o
 * `<html>` acompanha o retrato do main sem haver seletor montado.
 */

afterEach(cleanup)

const [SEMENTE, LEITURA, PUBLICADA] = THEMES as readonly [
  (typeof THEMES)[number],
  (typeof THEMES)[number],
  (typeof THEMES)[number],
]

let publicar: (snapshot: ThemeSnapshot) => void

beforeEach(() => {
  delete document.documentElement.dataset.theme

  const ponte = {
    theme: SEMENTE,
    onTheme: (ouvinte: typeof publicar) => {
      publicar = ouvinte

      return () => {}
    },
    readTheme: () => Promise.resolve({ theme: LEITURA }),
  }

  Object.defineProperty(window, 'oc', { value: ponte, configurable: true })
})

describe('#103 task 4 — useTemaAplicado', () => {
  it('nasce com a semente da ponte, aplica a leitura e depois a publicação', async () => {
    const { result } = renderHook(() => useTemaAplicado())

    expect(document.documentElement.dataset.theme).toBe(SEMENTE)

    await waitFor(() => {
      expect(result.current).toBe(LEITURA)
    })
    expect(document.documentElement.dataset.theme).toBe(LEITURA)

    act(() => {
      publicar({ theme: PUBLICADA })
    })

    expect(result.current).toBe(PUBLICADA)
    expect(document.documentElement.dataset.theme).toBe(PUBLICADA)
  })

  it('a publicação que chega antes da leitura não é sobrescrita por ela', async () => {
    const { result } = renderHook(() => useTemaAplicado())

    act(() => {
      publicar({ theme: PUBLICADA })
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current).toBe(PUBLICADA)
    expect(document.documentElement.dataset.theme).toBe(PUBLICADA)
  })
})
