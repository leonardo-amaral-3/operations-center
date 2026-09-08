import { memo, useEffect, useState } from 'react'
import type { JSX } from 'react'

import { CardContentView } from './CardContentView'
import type { ContentState } from './CardContentView'

interface CardContentProps {
  itemId: string
  /**
   * Há sessão viva neste cartão **no instante em que ele abre**.
   *
   * Decide só o estado inicial da seção, e nada mais — ver o `useState` abaixo. Por isso é um
   * booleano e não a sessão: o que muda a forma da tela é a existência dela, não o estado dela.
   */
  hasSession: boolean
}

/**
 * Quem busca o conteúdo do card e o entrega à vista pura.
 *
 * **Memoizado, e por um motivo medido:** o kanban relê o board a cada foco de janela, e cada
 * releitura redesenha o cartão inteiro. Sem o `memo`, o `react-markdown` reparsearia o corpo da
 * issue — 44 mil caracteres, no caso do card #6 — a cada alt-tab. O `CardCommentView` já protege os
 * comentários lá dentro; é este `memo` que protege o corpo. As duas props são primitivas, então a
 * comparação rasa basta.
 *
 * **Sem cache entre aberturas**: fechar e reabrir o cartão relê. Cache traria a pergunta "quando
 * isto ficou velho?" para economizar uma requisição de 1 ponto num orçamento de 5000/hora — e a
 * resposta para "ficou velho" já está na tela, que é o ⟳.
 */
export const CardContent = memo(function CardContent({
  itemId,
  hasSession,
}: CardContentProps): JSX.Element {
  /**
   * **Quem decide se a seção nasce aberta é a sessão.**
   *
   * Cartão sem sessão viva abre com o conteúdo à mostra — foi para ler que ele foi aberto. Cartão
   * com sessão viva abre recolhido — foi para falar.
   *
   * O valor é lido **só na inicialização** (a forma funcional do `useState`), nunca num efeito: uma
   * sessão que nasce depois não pode fechar a seção na cara de quem está lendo.
   */
  const [open, setOpen] = useState(() => !hasSession)
  const [state, setState] = useState<ContentState>({ kind: 'loading' })
  const [pending, setPending] = useState(true)
  /** Só um contador: o que ele existe para fazer é disparar o efeito de novo. */
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    /**
     * A guarda de corrida.
     *
     * Sem ela, dois cliques seguidos no ⟳ — ou colapsar e reabrir o cartão depressa — deixariam a
     * resposta da leitura **antiga** aterrissar depois da nova e sobrescrevê-la. O cleanup roda
     * antes de cada reexecução e na saída de cena, então a resposta em trânsito de uma leitura
     * abandonada simplesmente não escreve.
     */
    let atual = true

    setPending(true)

    void window.oc.readCard({ itemId }).then((result) => {
      if (!atual) return

      // Falha é estado, e não exceção: o motivo é texto de tela, desenhado dentro do cartão. O
      // precedente é o `BoardTab.error`, que já é a string que o kanban mostra.
      setState(
        result.ok
          ? { kind: 'loaded', content: result.content }
          : { kind: 'failed', reason: result.reason },
      )
      setPending(false)
    })

    return () => {
      atual = false
    }
  }, [itemId, reloads])

  return (
    <CardContentView
      state={state}
      pending={pending}
      open={open}
      onToggle={() => {
        setOpen((aberta) => !aberta)
      }}
      onReload={() => {
        setReloads((feitas) => feitas + 1)
      }}
    />
  )
})
