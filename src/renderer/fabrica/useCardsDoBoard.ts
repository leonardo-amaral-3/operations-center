import { useEffect, useState } from 'react'

import type { BoardCard } from '../../shared/board'

/**
 * Os cards do board por URL (#131, §F2.7): o título e os campos que as telas da fábrica mostram.
 *
 * Só lê. Assina antes de pedir e descarta a resposta do `invoke` se um evento chegou antes, como o
 * `useBoardFeeds`. Nas abas repetidas o primeiro card de uma URL vence. Sem boards, mapa vazio.
 */
export function useCardsDoBoard(): ReadonlyMap<string, BoardCard> {
  const [cards, setCards] = useState<ReadonlyMap<string, BoardCard>>(() => new Map())

  useEffect(() => {
    let pushed = false

    const aplicar = (snapshot: Awaited<ReturnType<typeof window.oc.readBoards>>): void => {
      const mapa = new Map<string, BoardCard>()
      for (const aba of snapshot.boards ?? []) {
        for (const card of aba.board?.cards ?? []) {
          if (!mapa.has(card.url)) mapa.set(card.url, card)
        }
      }
      setCards(mapa)
    }

    const cancelar = window.oc.onBoards((next) => {
      pushed = true
      aplicar(next)
    })

    void window.oc
      .readBoards()
      .then((next) => {
        if (!pushed) aplicar(next)
      })
      .catch(() => {
        // Sem leitura, as telas ficam só com `#<n>`.
      })

    return cancelar
  }, [])

  return cards
}
