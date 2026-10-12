import { memo, useEffect, useState } from 'react'
import type { JSX } from 'react'

import { PullRequestView } from './PullRequestView'
import type { PullRequestState } from './PullRequestView'

interface PullRequestProps {
  itemId: string
}

/**
 * Quem lê o PR do card e o entrega à vista pura — a cópia do padrão do `CardContent`.
 *
 * Lê quando monta (a primeira vez que a aba PR é selecionada na expansão) e de novo a cada ⟳.
 * Sem cache: recolher o cartão desmonta este componente e descarta a leitura.
 */
export const PullRequest = memo(function PullRequest({ itemId }: PullRequestProps): JSX.Element {
  const [state, setState] = useState<PullRequestState>({ kind: 'loading' })
  const [pending, setPending] = useState(true)
  /** Só um contador: o que ele existe para fazer é disparar o efeito de novo. */
  const [reloads, setReloads] = useState(0)
  const [arquivoAberto, setArquivoAberto] = useState<string | null>(null)

  useEffect(() => {
    // A guarda de corrida do `CardContent`: a resposta de uma leitura abandonada não escreve.
    let atual = true

    setPending(true)

    void window.oc.readPullRequest({ itemId }).then((result) => {
      if (!atual) return

      setState(
        result.ok
          ? { kind: 'loaded', pr: result.pullRequest }
          : { kind: 'failed', reason: result.reason },
      )
      // Leitura nova, patch fechado: o arquivo aberto podia nem existir mais.
      setArquivoAberto(null)
      setPending(false)
    })

    return () => {
      atual = false
    }
  }, [itemId, reloads])

  return (
    <PullRequestView
      state={state}
      pending={pending}
      arquivoAberto={arquivoAberto}
      onArquivo={(caminho) => {
        setArquivoAberto((aberto) => (aberto === caminho ? null : caminho))
      }}
      onReload={() => {
        setReloads((feitas) => feitas + 1)
      }}
    />
  )
})
