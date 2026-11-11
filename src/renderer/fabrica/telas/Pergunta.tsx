import { useEffect, useState } from 'react'
import type { JSX } from 'react'

import type { PerguntaDaFila } from '../../../shared/fabrica'
import { Markdown } from '../../components/Markdown'
import { Card } from '../../ui/card'
import { CabecalhoInterno, LinkDoCard, quando } from '../Moldura'
import { trilhaDa } from '../rotas'
import type { PropsDaTela } from '../telas'

/**
 * A tela Pergunta (#130, §F1.7): o item da fila pelo `tela.item`, com a pergunta inteira lida do
 * `readFabricaPergunta`. Só lê: fechar segue sendo `yarn fabrica fechar`, e a tela mostra o comando.
 */
export function Pergunta({ tela, sala, ir }: PropsDaTela): JSX.Element {
  const id = tela.tela === 'pergunta' ? tela.item : null
  const [pergunta, setPergunta] = useState<PerguntaDaFila | null | undefined>(undefined)

  const itens = sala?.kind === 'ok' ? [...sala.abertos, ...sala.fechados] : []
  // Muda quando o item é fechado por fora: a pergunta passa a mostrar a resolução.
  const fechadoEm = itens.find((candidato) => candidato.id === id)?.fechadoEm ?? null

  useEffect(() => {
    if (id === null) return

    let atual = true

    // Outro item: o texto do anterior não fica na tela até a resposta nova chegar.
    setPergunta(undefined)

    window.oc
      .readFabricaPergunta({ id })
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
  }, [id, fechadoEm])

  return (
    <>
      <CabecalhoInterno trilha={trilhaDa(tela, new Date())} onIr={ir} />
      <Corpo pergunta={pergunta} />
    </>
  )
}

function Corpo({ pergunta }: { pergunta: PerguntaDaFila | null | undefined }): JSX.Element | null {
  // `undefined` = a resposta do item atual ainda não chegou.
  if (pergunta === undefined) return null

  if (pergunta === null) return <p className="text-sm">O item saiu do estado da fábrica.</p>

  const { item: dado } = pergunta

  return (
    <Card data-testid="fabrica-pergunta" className="gap-3 bg-secondary-background p-4 text-sm">
      <h3 className="font-heading">
        {dado.id} · <LinkDoCard card={dado.card} url={dado.cardUrl} />
      </h3>
      <p>
        <strong>Motivo:</strong> {dado.motivo}
      </p>
      <p className="text-xs break-words">
        De: {dado.despacho} · sessão {dado.sessaoClaude ?? '-'} · {dado.comando ?? '-'}
      </p>
      <section className="flex flex-col gap-1">
        <h4 className="font-heading text-xs">Texto final da sessão</h4>
        {pergunta.resultado === null ? (
          <p data-testid="fabrica-pergunta-sem-texto">A sessão não deixou texto final.</p>
        ) : (
          <Markdown text={pergunta.resultado} />
        )}
      </section>
      {dado.fechadoEm === null ? (
        <p>
          Para fechar: <code data-testid="fabrica-pergunta-fechar">{pergunta.fechar}</code>
        </p>
      ) : (
        <p>
          Fechado em {quando(dado.fechadoEm)}: {dado.resolucao ?? '-'}
        </p>
      )}
    </Card>
  )
}
