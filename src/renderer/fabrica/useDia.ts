import { useCallback, useEffect, useRef, useState } from 'react'

import type { RelatorioDaSala, RevisaoNaSala } from '../../shared/fabrica'

/**
 * Os dois ganchos de leitura das telas Relatório e Portfólio (#134, §F5.10): o relatório de um dia
 * (com cache dos 7 últimos) e as revisões gravadas pelo `yarn fabrica`. Só leem.
 */

const DIAS_NO_CACHE = 7

/** Só os `ok`; a ordem de inserção do `Map` é a idade: o mais velho sai primeiro. */
const cache = new Map<string, RelatorioDaSala>()

function guardar(r: RelatorioDaSala): void {
  if (r.kind !== 'ok') return
  cache.delete(r.dia)
  cache.set(r.dia, r)
  while (cache.size > DIAS_NO_CACHE) {
    const velho = cache.keys().next().value
    if (velho === undefined) break
    cache.delete(velho)
  }
}

/** Limpa o cache do módulo, para os testes. */
export function esquecerRelatorios(): void {
  cache.clear()
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro)
}

export function useRelatorioDoDia(dia: string): {
  relatorio: RelatorioDaSala | null
  gerarDeNovo: () => void
} {
  const [resposta, setResposta] = useState<RelatorioDaSala | null>(() => cache.get(dia) ?? null)
  const ultimoPedido = useRef(0)

  const pedir = useCallback((diaPedido: string) => {
    const pedido = ++ultimoPedido.current

    void Promise.resolve()
      .then(() => window.oc.readRelatorio({ dia: diaPedido }))
      .catch((erro: unknown): RelatorioDaSala => ({
        kind: 'erro',
        dia: diaPedido,
        erro: mensagem(erro),
      }))
      .then((r) => {
        if (pedido !== ultimoPedido.current) return
        guardar(r)
        setResposta(r)
      })
  }, [])

  useEffect(() => {
    const doCache = cache.get(dia)
    if (doCache !== undefined) {
      // Um pedido em voo de outro dia não pode mais chegar.
      ultimoPedido.current++
      setResposta(doCache)
    } else {
      pedir(dia)
    }
    // Um pedido em voo na desmontagem não pode mexer no estado de quem já saiu.
    return () => {
      ultimoPedido.current++
    }
  }, [dia, pedir])

  const gerarDeNovo = useCallback(() => {
    cache.delete(dia)
    setResposta(null)
    pedir(dia)
  }, [dia, pedir])

  return {
    relatorio: resposta !== null && resposta.dia === dia ? resposta : (cache.get(dia) ?? null),
    gerarDeNovo,
  }
}

export function useRevisoes(): {
  revisoes: ReadonlyMap<string, RevisaoNaSala> | null
  erro: string | null
  ilegiveis: number
  reler: () => Promise<void>
} {
  const [estado, setEstado] = useState<{
    revisoes: ReadonlyMap<string, RevisaoNaSala> | null
    erro: string | null
    ilegiveis: number
  }>({ revisoes: null, erro: null, ilegiveis: 0 })
  const vivo = useRef(true)

  const reler = useCallback(async (): Promise<void> => {
    try {
      const r = await Promise.resolve().then(() => window.oc.readFabricaRevisoes({ board: null }))
      if (!vivo.current) return
      if (r.kind === 'ok') {
        setEstado({
          revisoes: new Map(r.revisoes.map((v) => [v.arquivo, v])),
          erro: null,
          ilegiveis: r.ilegiveis,
        })
      } else {
        setEstado({ revisoes: null, erro: r.erro, ilegiveis: 0 })
      }
    } catch (erro: unknown) {
      if (!vivo.current) return
      setEstado({ revisoes: null, erro: mensagem(erro), ilegiveis: 0 })
    }
  }, [])

  useEffect(() => {
    vivo.current = true
    void reler()

    return () => {
      vivo.current = false
    }
  }, [reler])

  return { ...estado, reler }
}
