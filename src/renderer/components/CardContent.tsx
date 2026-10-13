import { memo, useEffect, useState } from 'react'
import type { JSX } from 'react'

import type { PullRequestRef } from '../../shared/board'
import { CardContentView } from './CardContentView'
import type { AbaDoCartao, ContentState } from './CardContentView'
import { PullRequest } from './PullRequest'

interface CardContentProps {
  itemId: string
  /**
   * Há sessão viva neste cartão **no instante em que ele abre**.
   *
   * Decide só o estado inicial da seção, e nada mais — ver o `useState` abaixo. Por isso é um
   * booleano e não a sessão: o que muda a forma da tela é a existência dela, não o estado dela.
   */
  hasSession: boolean
  /** Cartão expandido (#28): abre a seção e tira o teto de altura do corpo. */
  preencher?: boolean
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
  preencher = false,
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
  const [aba, setAba] = useState<AbaDoCartao>('card')
  /**
   * O **número** do PR cujo painel já foi lido, ou `null`. Número, e não booleano: o painel montado
   * vale só para o PR que a aba nomeia, e um ⟳ que troca o PR do card não pode deixar o painel do
   * PR antigo à mostra sob a aba do novo.
   */
  const [prMontado, setPrMontado] = useState<number | null>(null)
  /**
   * O PR do card, como a **última leitura bem-sucedida** o conhece. Leitura que falha não mexe
   * aqui: é isso que impede um ⟳ falho de tirar as abas e desmontar o painel do PR.
   */
  const [prConhecido, setPrConhecido] = useState<PullRequestRef | null>(null)

  // Expandir é para ler, então abre a seção que a sessão viva deixou recolhida (#28). Só abre:
  // recolher o cartão não fecha o que o leitor deixou aberto.
  useEffect(() => {
    if (preencher) setOpen(true)
  }, [preencher])

  // As abas (#83) vivem só no cartão expandido. Recolher descarta a aba, o painel do PR e o PR
  // conhecido; expandir não relê (CA-2 do #28), então o PR conhecido vem do que já está carregado.
  useEffect(() => {
    if (!preencher) {
      setAba('card')
      setPrMontado(null)
      setPrConhecido(null)
    } else if (state.kind === 'loaded') {
      setPrConhecido(state.content.pullRequest)
    }
    // `state` fica de fora de propósito: a leitura que aterrissa já atualiza `prConhecido` no
    // `.then`; este efeito só reage à expansão e ao recolhimento.
  }, [preencher])

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
      if (result.ok) {
        setPrConhecido(result.content.pullRequest)
        // O card perdeu o PR: as abas somem, e com elas a aba e o painel. Sem isto, o PR que volta
        // num ⟳ seguinte remontaria o painel — e o leria — ainda na aba Card (CA-6).
        if (result.content.pullRequest === null) {
          setAba('card')
          setPrMontado(null)
        }
      }
      setPending(false)
    })

    return () => {
      atual = false
    }
  }, [itemId, reloads])

  const abasVisiveis = preencher && prConhecido !== null
  const numeroDoPr = prConhecido?.number ?? null

  // Na aba PR, o painel montado é sempre o do PR que a aba nomeia: selecionar a aba o monta, e um ⟳
  // que troca o PR com a aba aberta o remonta pelo `key` abaixo, que relê. Fora da aba PR, um PR
  // trocado desmonta o painel velho, e o novo só é lido quando a aba for selecionada (CA-6).
  useEffect(() => {
    if (aba === 'pr' && numeroDoPr !== null) setPrMontado(numeroDoPr)
  }, [aba, numeroDoPr])

  const painelDoPr = abasVisiveis && (aba === 'pr' || prMontado === numeroDoPr)

  return (
    <CardContentView
      state={state}
      pending={pending}
      open={open}
      preencher={preencher}
      abas={
        abasVisiveis
          ? {
              ativa: aba,
              numero: prConhecido.number,
              onSelecionar: setAba,
            }
          : null
      }
      prPanel={painelDoPr ? <PullRequest key={numeroDoPr} itemId={itemId} /> : null}
      onToggle={() => {
        setOpen((aberta) => !aberta)
      }}
      onReload={() => {
        setReloads((feitas) => feitas + 1)
      }}
    />
  )
})
