import { useEffect, useState } from 'react'

import { type BoardDaFabrica, boardDaFabrica } from './boardDaFabrica'

/**
 * O board do Project 2 para o Briefing e o Release (#135, §F6.6). O molde do `useCardsDoBoard`:
 * assina antes de pedir e descarta a resposta do `readBoards()` se um evento chegou antes. Só lê.
 */
export function useBoardDaFabrica(): BoardDaFabrica {
  const [estado, setEstado] = useState<BoardDaFabrica>({ kind: 'lendo' })

  useEffect(() => {
    let pushed = false

    const cancelar = window.oc.onBoards((next) => {
      pushed = true
      setEstado(boardDaFabrica(next))
    })

    void window.oc
      .readBoards()
      .then((next) => {
        if (!pushed) setEstado(boardDaFabrica(next))
      })
      .catch((e: unknown) => {
        setEstado({ kind: 'erro', erro: e instanceof Error ? e.message : String(e) })
      })

    return cancelar
  }, [])

  return estado
}
