import { useEffect, useState } from 'react'

import type { SessoesDaMaquina } from '../../shared/fabrica'
import { INTERVALO_DA_SALA_MS } from './useSala'

/**
 * As sessões `claude` vivas da máquina (#142, §3.6), relidas enquanto a tela que as usa está
 * montada.
 *
 * `null` só antes da primeira resposta. Uma leitura só começa se a anterior já respondeu, para uma
 * lenta não empilhar. Rejeição (inclui o método ausente no `window.oc`) vira `sem-leitura` com a
 * mensagem do erro: a tela nunca recebe uma exceção. Resposta depois da desmontagem é ignorada.
 */
export function useSessoesDaMaquina(): SessoesDaMaquina | null {
  const [maquina, setMaquina] = useState<SessoesDaMaquina | null>(null)

  useEffect(() => {
    let vivo = true
    let emVoo = false

    const ler = (): void => {
      if (emVoo) return
      emVoo = true

      void Promise.resolve()
        .then(() => window.oc.readFabricaSessoes())
        .then(
          (lido) => lido,
          (erro: unknown): SessoesDaMaquina => ({
            kind: 'sem-leitura',
            motivo: erro instanceof Error ? erro.message : String(erro),
          }),
        )
        .then((lido) => {
          if (vivo) setMaquina(lido)
        })
        .finally(() => {
          emVoo = false
        })
    }

    ler()
    const intervalo = setInterval(ler, INTERVALO_DA_SALA_MS)

    return () => {
      vivo = false
      clearInterval(intervalo)
    }
  }, [])

  return maquina
}
