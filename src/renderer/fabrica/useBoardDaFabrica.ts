import { useEffect, useState } from 'react'

import type { BoardNaFabricaOk } from '../../shared/fabrica'
import { type BoardDaFabrica, boardDaFabrica } from './boardDaFabrica'

/**
 * O board da fábrica (o `alvo`) para o Briefing e o Release (#135, §F6.6). O molde do `useCardsDoBoard`:
 * assina antes de pedir e descarta a resposta do `readBoards()` se um evento chegou antes. Só lê.
 */
export function useBoardDaFabrica(
  alvo: Pick<BoardNaFabricaOk, 'chave' | 'nome' | 'projeto'>,
): BoardDaFabrica {
  const { chave, nome, projeto } = alvo
  const [estado, setEstado] = useState<BoardDaFabrica>({ kind: 'lendo' })

  useEffect(() => {
    let pushed = false

    const cancelar = window.oc.onBoards((next) => {
      pushed = true
      setEstado(boardDaFabrica(next, { chave, nome, projeto }))
    })

    void window.oc
      .readBoards()
      .then((next) => {
        if (!pushed) setEstado(boardDaFabrica(next, { chave, nome, projeto }))
      })
      .catch((e: unknown) => {
        setEstado({ kind: 'erro', erro: e instanceof Error ? e.message : String(e) })
      })

    return cancelar
  }, [chave, nome, projeto])

  return estado
}
