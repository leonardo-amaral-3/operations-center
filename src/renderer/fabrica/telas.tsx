import type { JSX } from 'react'

import type { ComandoDaFabrica, SalaDaFabrica } from '../../shared/fabrica'
import type { NomeDaTela, TelaDaFabrica } from './rotas'
import { Agentes } from './telas/Agentes'
import { Briefing } from './telas/Briefing'
import { CardEmVoo } from './telas/Card'
import { Decisao } from './telas/Decisao'
import { Entrada } from './telas/Entrada'
import { Mandato } from './telas/Mandato'
import { Pergunta } from './telas/Pergunta'
import { Portfolio } from './telas/Portfolio'
import { Relatorio } from './telas/Relatorio'
import { Release } from './telas/Release'
import { Sala } from './telas/Sala'

/** O que toda tela recebe da raiz (`Fabrica.tsx`). */
export interface PropsDaTela {
  tela: TelaDaFabrica
  sala: SalaDaFabrica | null
  ir: (tela: TelaDaFabrica) => void
  comando: (comando: ComandoDaFabrica) => Promise<void>
  emVoo: boolean
}

/**
 * O registro das 11 telas (#130, §F1.7). Cada tela devolve o seu cabeçalho e o seu corpo: o da Sala é
 * diferente do das internas.
 */
export const TELAS: Record<NomeDaTela, (p: PropsDaTela) => JSX.Element> = {
  sala: Sala,
  pergunta: Pergunta,
  relatorio: Relatorio,
  agentes: Agentes,
  decisao: Decisao,
  card: CardEmVoo,
  entrada: Entrada,
  portfolio: Portfolio,
  mandato: Mandato,
  briefing: Briefing,
  release: Release,
}
