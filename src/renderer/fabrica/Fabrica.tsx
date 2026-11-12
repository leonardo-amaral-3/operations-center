import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'

import type { BoardNaFabricaOk, ComandoDaFabrica, ResultadoDoComando } from '../../shared/fabrica'
import { Card } from '../ui/card'
import { abaDaFabrica } from './linhaDoBoard'
import { MarcaDaFabrica } from './Moldura'
import type { TelaDaFabrica } from './rotas'
import { TELAS } from './telas'
import { LinhaSemFabrica } from './telas/Sala'
import { useBoardNaFabrica } from './useBoardNaFabrica'
import { useRetratoDosBoards } from './useRetratoDosBoards'
import { useSala } from './useSala'

/**
 * A raiz da fábrica no app (#130, §F1.7; #157, §11): lê a aba do retrato dos boards, pergunta ao main
 * se a fábrica atende o board dela e monta as telas, ou o motivo da recusa. Trocar de board remonta
 * tudo (`key`): nenhum retrato, marcação ou rota passa de um board para outro.
 */
export function Fabrica(): JSX.Element {
  const retrato = useRetratoDosBoards()
  const leitura = useBoardNaFabrica(abaDaFabrica(retrato))

  if (leitura.kind === 'lendo') {
    return (
      <Moldura tela="sala">
        <p data-testid="fabrica-lendo" className="text-sm">
          Lendo o estado da fábrica…
        </p>
      </Moldura>
    )
  }

  if (leitura.kind === 'recusado') {
    return (
      <Moldura tela="recusa">
        <Card
          data-testid="fabrica-cabecalho"
          className="flex-row flex-wrap items-center justify-between gap-4 bg-secondary-background px-4 py-3"
        >
          <MarcaDaFabrica />
        </Card>
        <div
          role="alert"
          data-testid="fabrica-recusa"
          data-board={leitura.chave}
          className="flex flex-col gap-1 text-sm"
        >
          <p>A fábrica não atende o board desta aba.</p>
          <p className="text-xs break-words text-foreground/75">{leitura.motivo}</p>
        </div>
        <LinhaSemFabrica />
      </Moldura>
    )
  }

  return <FabricaDoBoard key={leitura.chave} board={leitura} />
}

function Moldura({ tela, children }: { tela: string; children: ReactNode }): JSX.Element {
  return (
    <div data-testid="fabrica-sala" className="flex min-h-0 flex-1 flex-col">
      <div
        data-testid="fabrica-tela"
        data-tela={tela}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto bg-background p-5"
      >
        {children}
      </div>
    </div>
  )
}

/** O corpo de hoje da fábrica, para um board servido: o retrato lido, a tela atual e o canal de escrita. */
function FabricaDoBoard({ board }: { board: BoardNaFabricaOk }): JSX.Element {
  const { sala, reler } = useSala(board.chave)
  const [tela, setTela] = useState<TelaDaFabrica>({ tela: 'sala' })
  const [emVoo, setEmVoo] = useState(false)
  const [resultado, setResultado] = useState<ResultadoDoComando | null>(null)
  const area = useRef<HTMLDivElement>(null)

  // Mudar de tela volta ao topo.
  useEffect(() => {
    area.current?.scrollTo?.({ top: 0 })
    // O erro do último comando era da tela de onde se saiu.
    setResultado(null)
  }, [tela])

  // O botão só volta depois do retrato novo: `reler` resolve quando ele foi aplicado.
  const comando = async (pedido: ComandoDaFabrica): Promise<void> => {
    setEmVoo(true)
    try {
      let recebido: ResultadoDoComando

      try {
        recebido = await window.oc.comandoFabrica({ board: board.chave, comando: pedido })
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
        <Tela tela={tela} sala={sala} ir={setTela} comando={comando} emVoo={emVoo} board={board} />
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
