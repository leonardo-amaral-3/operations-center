import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { RelatorioDaSala } from '../../shared/fabrica'
import { Markdown } from '../components/Markdown'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

/** O dia de hoje em UTC, como o CLI do relatório (#126, §B4). */
function hojeEmUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function textoSemFonte(total: number): string {
  return total === 1
    ? '1 linha sem fonte ficou de fora'
    : `${total} linhas sem fonte ficaram de fora`
}

/**
 * A aba Relatório da sala (#126, P3b): gera o relatório de um dia com o mesmo código do
 * `yarn relatorio`. Gera o dia inicial na montagem e o dia escolhido no clique; um contador de
 * pedidos descarta a resposta de qualquer pedido que não seja o último.
 */
export function RelatorioDaSalaView(): JSX.Element {
  const [dia, setDia] = useState(hojeEmUtc)
  const [gerando, setGerando] = useState<string | null>(null)
  const [relatorio, setRelatorio] = useState<RelatorioDaSala | null>(null)
  const ultimoPedido = useRef(0)
  const diaInicial = useRef(dia)

  const gerar = (diaPedido: string) => {
    const pedido = ++ultimoPedido.current

    setGerando(diaPedido)
    window.oc
      .readRelatorio({ dia: diaPedido })
      .then((resposta) => {
        if (pedido !== ultimoPedido.current) return
        setRelatorio(resposta)
        setGerando(null)
      })
      .catch((erro: unknown) => {
        if (pedido !== ultimoPedido.current) return
        setRelatorio({
          kind: 'erro',
          dia: diaPedido,
          erro: erro instanceof Error ? erro.message : String(erro),
        })
        setGerando(null)
      })
  }

  useEffect(() => {
    gerar(diaInicial.current)
    // Um pedido em voo na desmontagem não pode mexer no estado de quem já saiu.
    return () => {
      ultimoPedido.current++
    }
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          type="date"
          data-testid="relatorio-dia"
          className="w-44"
          value={dia}
          onChange={(evento) => {
            setDia(evento.target.value)
          }}
        />
        <Button
          type="button"
          data-testid="relatorio-gerar"
          size="xs"
          disabled={gerando !== null}
          onClick={() => {
            gerar(dia)
          }}
        >
          Gerar
        </Button>
      </div>

      {gerando !== null && <p data-testid="relatorio-gerando">Gerando o relatório de {gerando}…</p>}

      {gerando === null && relatorio?.kind === 'ok' && (
        <>
          <p className="text-xs text-foreground/60">
            Gerado às {new Date(relatorio.geradoEm).toLocaleTimeString('pt-BR')}
          </p>
          {relatorio.semFonte > 0 && (
            <p data-testid="relatorio-sem-fonte" className="text-xs">
              {textoSemFonte(relatorio.semFonte)}
            </p>
          )}
          <div data-testid="relatorio-corpo" className="min-h-0 flex-1 overflow-y-auto">
            <Markdown text={relatorio.markdown} />
          </div>
        </>
      )}

      {gerando === null && relatorio?.kind === 'erro' && (
        <div data-testid="relatorio-erro" className="flex flex-col gap-1 text-sm">
          <p>Não foi possível gerar o relatório.</p>
          <p className="text-xs break-words text-foreground/60">{relatorio.erro}</p>
        </div>
      )}
    </div>
  )
}
