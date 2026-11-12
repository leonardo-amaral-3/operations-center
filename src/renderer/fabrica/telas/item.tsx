import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import type { ItemNaSala, PerguntaDaFila, SalaDaFabrica } from '../../../shared/fabrica'
import { Markdown } from '../../components/Markdown'
import { Badge } from '../../ui/badge'
import { cn } from '../../ui/cn'
import { quando } from '../Moldura'
import type { TelaDaFabrica } from '../rotas'

/**
 * O que a Pergunta e a Decisão dividem (#132, F3.5): carregar o item da rota, o chip da posição, a
 * etiqueta, o texto final e o estado fechado. Mora aqui, e não na `Moldura.tsx`, que é da F1.
 */

/**
 * A pergunta do item da rota: `undefined` enquanto chega, `null` se saiu do estado. É a leitura da
 * Pergunta da F1, movida sem mudar o comportamento.
 */
export function useItemDaFila(
  tela: TelaDaFabrica,
  sala: SalaDaFabrica | null,
  board: string,
): { id: string | null; pergunta: PerguntaDaFila | null | undefined } {
  const id = tela.tela === 'pergunta' || tela.tela === 'decisao' ? tela.item : null
  const [pergunta, setPergunta] = useState<PerguntaDaFila | null | undefined>(undefined)
  const idLido = useRef<string | null>(null)

  const itens = sala?.kind === 'ok' ? [...sala.abertos, ...sala.fechados] : []
  // Muda quando o item é fechado (pela tela ou por fora): a pergunta é relida e mostra a resolução.
  const fechadoEm = itens.find((candidato) => candidato.id === id)?.fechadoEm ?? null

  useEffect(() => {
    if (id === null) return

    let atual = true

    // Outro item: o texto do anterior não fica na tela até a resposta nova chegar. Reler o mesmo item (ele
    // fechou) mantém o texto na tela, sem piscar.
    if (idLido.current !== id) setPergunta(undefined)
    idLido.current = id

    window.oc
      .readFabricaPergunta({ board, id })
      .then((resposta) => {
        // Uma resposta de um item que já não é o atual é descartada.
        if (atual) setPergunta(resposta)
      })
      .catch(() => {
        if (atual) setPergunta(null)
      })

    return () => {
      atual = false
    }
  }, [board, id, fechadoEm])

  return { id, pergunta }
}

/** "2 de 4 na fila", "fechado" ou "fora da fila", pela lista do retrato em que o item está. */
export function ChipDaPosicao({
  id,
  sala,
}: {
  id: string | null
  sala: SalaDaFabrica | null
}): JSX.Element {
  let texto = 'fora da fila'

  if (sala?.kind === 'ok') {
    const i = sala.abertos.findIndex((candidato) => candidato.id === id)

    if (i >= 0) texto = `${i + 1} de ${sala.abertos.length} na fila`
    else if (sala.fechados.some((candidato) => candidato.id === id)) texto = 'fechado'
  }

  return (
    <Badge variant="neutral" data-testid="fabrica-chip-posicao">
      {texto}
    </Badge>
  )
}

/** A etiqueta pequena do protótipo (`.tag`). */
export function Etiqueta({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[4px] border-[1.5px] border-border bg-secondary-background px-1.5 text-[11px] leading-[18px] font-bold',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** O texto final da sessão de origem; sem ele, o aviso com o `testid` da tela. */
export function TextoFinal({
  resultado,
  testid,
}: {
  resultado: string | null
  testid: string
}): JSX.Element {
  if (resultado === null) return <p data-testid={testid}>A sessão não deixou texto final.</p>

  return (
    <div className="max-w-[760px] text-[15px] leading-[22px]">
      <Markdown text={resultado} />
    </div>
  )
}

/** O estado do item já fechado: quando e com qual resolução. */
export function ItemFechado({ item }: { item: ItemNaSala }): JSX.Element {
  return (
    <p data-testid="fabrica-item-fechado" className="text-sm">
      Fechado em {item.fechadoEm === null ? '-' : quando(item.fechadoEm)}: {item.resolucao ?? '-'}
    </p>
  )
}
