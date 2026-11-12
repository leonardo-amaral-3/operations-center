import type { ItemNaSala } from '../../shared/fabrica'

/**
 * As rotas da fábrica (#130, F1.1): puro, sem React nem `window`. O mapa das 11 telas do protótipo,
 * a navegação do cabeçalho da Sala e a trilha de cada tela. Os rótulos são os literais do protótipo.
 */
export type NomeDaTela =
  | 'sala'
  | 'agentes'
  | 'pergunta'
  | 'decisao'
  | 'card'
  | 'entrada'
  | 'relatorio'
  | 'portfolio'
  | 'mandato'
  | 'briefing'
  | 'release'

export type TelaDaFabrica =
  | { tela: 'sala' }
  | { tela: 'agentes' }
  | { tela: 'entrada' }
  | { tela: 'relatorio'; dia?: string } // dia `AAAA-MM-DD`
  | { tela: 'portfolio'; dia?: string } // dia `AAAA-MM-DD`
  | { tela: 'mandato' }
  | { tela: 'briefing' }
  | { tela: 'release' }
  | { tela: 'pergunta'; item: string } // id `q-<n>`
  | { tela: 'decisao'; item: string } // id `q-<n>`
  | { tela: 'card'; card: number }

/** Um passo da trilha; `para: null` é a tela atual. */
export interface Migalha {
  rotulo: string
  para: TelaDaFabrica | null
}

/** O arquivo do protótipo de cada tela (o harness e a canária do Fluxo leem daqui). */
export const ARQUIVO_DO_PROTOTIPO: Record<NomeDaTela, string> = {
  sala: 'Main.dc.html',
  agentes: 'Agentes.dc.html',
  pergunta: 'Pergunta.dc.html',
  decisao: 'Decisao.dc.html',
  card: 'Card.dc.html',
  entrada: 'Entrada.dc.html',
  relatorio: 'Relatorio.dc.html',
  portfolio: 'Portfolio.dc.html',
  mandato: 'Mandato.dc.html',
  briefing: 'Briefing.dc.html',
  release: 'Release.dc.html',
}

/** Os oito botões do cabeçalho da Sala, na ordem e com o texto do `Main.dc.html`. */
export const NAVEGACAO_DA_SALA: ReadonlyArray<{ tela: NomeDaTela; rotulo: string }> = [
  { tela: 'sala', rotulo: 'Sala de controle' },
  { tela: 'briefing', rotulo: 'Briefing' },
  { tela: 'relatorio', rotulo: 'Relatório' },
  { tela: 'portfolio', rotulo: 'Portfólio' },
  { tela: 'entrada', rotulo: 'Entrada' },
  { tela: 'agentes', rotulo: 'Agentes' },
  { tela: 'release', rotulo: 'Release' },
  { tela: 'mandato', rotulo: 'Mandato e placar' },
]

/** As telas que só existem com o board padrão (#157, Decisão 6): são do operations-center. */
export const TELAS_SO_DO_PADRAO = ['relatorio', 'portfolio', 'release'] as const

const SALA: TelaDaFabrica = { tela: 'sala' }

/** `dd/mm` de um dia `AAAA-MM-DD`. */
function diaMes(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
}

function restoDaTrilha(t: Exclude<TelaDaFabrica, { tela: 'sala' }>, hoje: Date): Migalha[] {
  switch (t.tela) {
    case 'agentes':
      return [{ rotulo: 'Agentes', para: null }]
    case 'pergunta':
      return [
        { rotulo: 'Esperando você', para: SALA },
        { rotulo: 'Pergunta', para: null },
      ]
    case 'decisao':
      return [
        { rotulo: 'Esperando você', para: SALA },
        { rotulo: 'Revisão · G4', para: null },
      ]
    case 'card':
      return [
        { rotulo: 'Linha', para: SALA },
        { rotulo: `#${t.card}`, para: null },
      ]
    case 'entrada':
      return [{ rotulo: 'Entrada', para: null }]
    case 'relatorio':
      // Dia em UTC, como o `RelatorioDaSalaView`.
      return [
        {
          rotulo: `Relatório de ${diaMes(t.dia ?? hoje.toISOString().slice(0, 10))}`,
          para: null,
        },
      ]
    case 'portfolio':
      return [{ rotulo: 'Portfólio', para: null }]
    case 'mandato':
      return [{ rotulo: 'Mandato', para: null }]
    case 'briefing':
      return [{ rotulo: 'Briefing do dia', para: null }]
    case 'release':
      return [{ rotulo: 'Release', para: null }]
  }
}

/** A trilha do cabeçalho: `[]` na Sala; nas outras, "Sala de controle" e o resto do protótipo. */
export function trilhaDa(t: TelaDaFabrica, hoje: Date): Migalha[] {
  if (t.tela === 'sala') return []
  return [{ rotulo: 'Sala de controle', para: SALA }, ...restoDaTrilha(t, hoje)]
}

/** A tela de um item da fila; o `tipo` vem do main (a F3 é dona da classificação). */
export function rotaDoItem(item: ItemNaSala): TelaDaFabrica {
  return { tela: item.tipo, item: item.id }
}
