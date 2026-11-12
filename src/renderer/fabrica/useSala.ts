import { useCallback, useEffect, useRef, useState } from 'react'

import type { SalaDaFabrica } from '../../shared/fabrica'

/** A cada quanto a sala relê o estado (#122, CA-3a.1: um item novo aparece em até 8 s). */
export const INTERVALO_DA_SALA_MS = 5000

export interface UsoDaSala {
  sala: SalaDaFabrica | null
  /** Uma leitura fora do intervalo; resolve quando o retrato novo foi aplicado. Nunca rejeita. */
  reler: () => Promise<void>
}

/**
 * O retrato da sala da fábrica, relido enquanto a tela que o usa está montada (#122, §A5).
 *
 * `null` só antes da primeira resposta. Uma chamada só começa se a anterior já respondeu, para uma
 * leitura lenta não empilhar. Uma rejeição do `invoke` não muda o retrato e não para o intervalo: o
 * que a tela mostra é o último estado lido, e a próxima volta tenta de novo. Resposta que chega
 * depois da desmontagem é ignorada, como no `useCardWindows`.
 *
 * `reler` (#130, §F1.5) serve ao botão Pausar: com uma leitura em voo, espera ela e faz mais uma,
 * porque a em voo pode ter lido o estado de antes do comando.
 */
export function useSala(): UsoDaSala {
  const [sala, setSala] = useState<SalaDaFabrica | null>(null)
  const emVoo = useRef<Promise<void> | null>(null)
  const vivo = useRef(true)

  const ler = useCallback((): Promise<void> => {
    if (emVoo.current !== null) return emVoo.current

    const leitura: Promise<void> = window.oc
      .readFabrica({ board: null })
      .then((retrato) => {
        if (vivo.current) setSala(retrato)
      })
      .catch(() => {
        // Mantém o retrato e o intervalo: a próxima volta tenta de novo.
      })
      .finally(() => {
        // Uma leitura de um efeito já desmontado não libera a vez da leitura do efeito novo.
        if (emVoo.current === leitura) emVoo.current = null
      })

    emVoo.current = leitura

    return leitura
  }, [])

  const reler = useCallback(async (): Promise<void> => {
    if (emVoo.current !== null) await emVoo.current
    await ler()
  }, [ler])

  useEffect(() => {
    vivo.current = true
    void ler()

    const intervalo = setInterval(() => {
      void ler()
    }, INTERVALO_DA_SALA_MS)

    return () => {
      vivo.current = false
      clearInterval(intervalo)
      emVoo.current = null
    }
  }, [ler])

  return { sala, reler }
}
