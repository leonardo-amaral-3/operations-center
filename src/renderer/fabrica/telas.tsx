import type { JSX } from 'react'

import type { ComandoDaFabrica, SalaDaFabrica } from '../../shared/fabrica'
import { CabecalhoInterno, TelaPorVir } from './Moldura'
import { trilhaDa, type NomeDaTela, type TelaDaFabrica } from './rotas'
import { Agentes } from './telas/Agentes'
import { CardEmVoo } from './telas/Card'
import { Decisao } from './telas/Decisao'
import { Entrada } from './telas/Entrada'
import { Pergunta } from './telas/Pergunta'
import { Relatorio } from './telas/Relatorio'
import { Sala } from './telas/Sala'

/** O que toda tela recebe da raiz (`Fabrica.tsx`). */
export interface PropsDaTela {
  tela: TelaDaFabrica
  sala: SalaDaFabrica | null
  ir: (tela: TelaDaFabrica) => void
  comando: (comando: ComandoDaFabrica) => Promise<void>
  emVoo: boolean
}

/** Uma tela interna ainda sem corpo: o cabeçalho com a trilha e o marcador da fase dona dela. */
function porVir(fase: string) {
  return (p: PropsDaTela): JSX.Element => (
    <>
      <CabecalhoInterno trilha={trilhaDa(p.tela, new Date())} onIr={p.ir} />
      <TelaPorVir fase={fase} />
    </>
  )
}

/**
 * O registro das 11 telas (#130, §F1.7). Cada tela devolve o seu cabeçalho e o seu corpo: o da Sala é
 * diferente do das internas. Cada fase troca o `porVir` da sua tela pelo corpo de verdade.
 */
export const TELAS: Record<NomeDaTela, (p: PropsDaTela) => JSX.Element> = {
  sala: Sala,
  pergunta: Pergunta,
  relatorio: Relatorio,
  agentes: Agentes,
  decisao: Decisao,
  card: CardEmVoo,
  entrada: Entrada,
  portfolio: porVir('F5'),
  mandato: porVir('F5'),
  briefing: porVir('F6'),
  release: porVir('F6'),
}
