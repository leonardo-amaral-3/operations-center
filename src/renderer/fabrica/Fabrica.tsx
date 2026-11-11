import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

import type { ComandoDaFabrica, ResultadoDoComando } from '../../shared/fabrica'
import type { TelaDaFabrica } from './rotas'
import { TELAS } from './telas'
import { useSala } from './useSala'

/**
 * A raiz da fábrica no app (#130, §F1.7), no lugar da `SalaDaFabrica`: o retrato lido, a tela atual
 * (estado em memória, sem URL nem persistência: fechar a vista volta à Sala) e o canal de escrita.
 */
export function Fabrica(): JSX.Element {
  const { sala, reler } = useSala()
  const [tela, setTela] = useState<TelaDaFabrica>({ tela: 'sala' })
  const [emVoo, setEmVoo] = useState(false)
  const [resultado, setResultado] = useState<ResultadoDoComando | null>(null)
  const area = useRef<HTMLDivElement>(null)

  // Mudar de tela volta ao topo.
  useEffect(() => {
    area.current?.scrollTo?.({ top: 0 })
  }, [tela])

  // O botão só volta depois do retrato novo: `reler` resolve quando ele foi aplicado.
  const comando = async (pedido: ComandoDaFabrica): Promise<void> => {
    setEmVoo(true)
    try {
      let recebido: ResultadoDoComando

      try {
        recebido = await window.oc.comandoFabrica(pedido)
      } catch (erro) {
        recebido = {
          ok: false,
          codigo: 1,
          argv: [],
          saida: '',
          erro: erro instanceof Error ? erro.message : String(erro),
        }
      }
      setResultado(recebido)
      await reler()
    } finally {
      setEmVoo(false)
    }
  }

  // Como componente, e não chamada: o `Pergunta` tem hooks, que não podem rodar dentro da `Fabrica`.
  const Tela = TELAS[tela.tela]

  return (
    <div data-testid="fabrica-sala" className="flex min-h-0 flex-1 flex-col">
      <div
        ref={area}
        data-testid="fabrica-tela"
        data-tela={tela.tela}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto bg-background p-5"
      >
        <Tela tela={tela} sala={sala} ir={setTela} comando={comando} emVoo={emVoo} />
        {resultado !== null && !resultado.ok && (
          <p role="alert" data-testid="fabrica-comando-erro" className="text-sm">
            {resultado.erro ||
              resultado.saida ||
              `o comando falhou (código ${String(resultado.codigo)})`}
          </p>
        )}
      </div>
    </div>
  )
}
