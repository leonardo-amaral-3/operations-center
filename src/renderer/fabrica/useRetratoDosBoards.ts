import { useEffect, useState } from 'react'

import type { BoardsSnapshot } from '../../shared/board'

/**
 * O retrato dos boards do app para a Linha da Sala (#142, §2.1). O molde do `useBoardDaFabrica`:
 * assina antes de pedir e descarta a resposta do `readBoards()` se um evento chegou antes. A única
 * diferença: não há ramo de erro, e a rejeição mantém o que havia (`null` ou o último retrato).
 * Só lê.
 */
export function useRetratoDosBoards(): BoardsSnapshot | null {
  const [retrato, setRetrato] = useState<BoardsSnapshot | null>(null)

  useEffect(() => {
    let pushed = false

    const cancelar = window.oc.onBoards((next) => {
      pushed = true
      setRetrato(next)
    })

    void window.oc
      .readBoards()
      .then((next) => {
        if (!pushed) setRetrato(next)
      })
      .catch(() => undefined)

    return cancelar
  }, [])

  return retrato
}
