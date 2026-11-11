import { useEffect, useRef, useState } from 'react'

import type { SalaDaFabrica } from '../../shared/fabrica'

/** A cada quanto a sala relê o estado (#122, CA-3a.1: um item novo aparece em até 8 s). */
export const INTERVALO_DA_SALA_MS = 5000

/**
 * O retrato da sala da fábrica, relido enquanto a tela que o usa está montada (#122, §A5).
 *
 * `null` só antes da primeira resposta. Uma chamada só começa se a anterior já respondeu, para uma
 * leitura lenta não empilhar. Uma rejeição do `invoke` não muda o retrato e não para o intervalo: o
 * que a tela mostra é o último estado lido, e a próxima volta tenta de novo. Resposta que chega
 * depois da desmontagem é ignorada, como no `useCardWindows`.
 */
export function useSala(): SalaDaFabrica | null {
  const [sala, setSala] = useState<SalaDaFabrica | null>(null)
  const emVoo = useRef(false)

  useEffect(() => {
    let vivo = true

    const ler = () => {
      if (emVoo.current) return
      emVoo.current = true
      window.oc
        .readFabrica()
        .then((retrato) => {
          if (vivo) setSala(retrato)
        })
        .catch(() => {
          // Mantém o retrato e o intervalo: a próxima volta tenta de novo.
        })
        .finally(() => {
          emVoo.current = false
        })
    }

    ler()

    const intervalo = setInterval(ler, INTERVALO_DA_SALA_MS)

    return () => {
      vivo = false
      clearInterval(intervalo)
      emVoo.current = false
    }
  }, [])

  return sala
}
