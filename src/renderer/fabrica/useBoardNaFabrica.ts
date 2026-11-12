import { useEffect, useRef, useState } from 'react'

import type { BoardNaFabrica } from '../../shared/fabrica'
import type { AbaDaFabrica } from './linhaDoBoard'

export type LeituraDoBoard = { kind: 'lendo' } | BoardNaFabrica

/**
 * O board da aba na fábrica (#157, §10). Uma leitura por chave enquanto montado; só a resposta do
 * pedido mais recente vira estado (o molde de número de geração de `telas/Card.tsx`), mas toda
 * resposta, inclusive a que chega tarde, fica no cache. Só lê.
 */
export function useBoardNaFabrica(aba: AbaDaFabrica): LeituraDoBoard {
  const cache = useRef<Map<string, BoardNaFabrica>>(new Map())
  const geracao = useRef(0)
  const [lido, setLido] = useState<BoardNaFabrica | null>(null)

  const pronta = aba.kind === 'pronta'
  const chave = aba.kind === 'pronta' ? (aba.chave ?? '') : ''
  const pedido = aba.kind === 'pronta' ? aba.chave : null

  useEffect(() => {
    if (!pronta) return
    geracao.current += 1
    const minha = geracao.current
    if (cache.current.has(chave)) {
      setLido(cache.current.get(chave) ?? null)
      return
    }
    setLido(null)
    window.oc
      .readFabricaBoard({ board: pedido })
      .then((resposta) => {
        cache.current.set(chave, resposta)
        if (resposta.chave !== '') cache.current.set(resposta.chave, resposta)
        if (geracao.current === minha) setLido(resposta)
      })
      .catch((e: unknown) => {
        if (geracao.current === minha) {
          setLido({
            kind: 'recusado',
            chave,
            motivo: e instanceof Error ? e.message : String(e),
          })
        }
      })
  }, [pronta, chave, pedido])

  if (!pronta) return { kind: 'lendo' }
  // Entre a troca de chave e o efeito, `lido` ainda é o da chave anterior: o cache responde na hora.
  return (
    cache.current.get(chave) ?? (lido !== null && lido.chave === chave ? lido : { kind: 'lendo' })
  )
}
