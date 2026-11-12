import type { Board } from '../../shared/board'
import type { BoardNaFabricaOk, SalaDaFabrica } from '../../shared/fabrica'
import { chaveDoCard, colunaDoCard, estacaoDaColuna, repoDaFabrica } from './boardDaFabrica'

/** O teto de despachos por frente do despachante (`LIMITE_DE_DESPACHOS_POR_FRENTE`). */
export const LIMITE_DE_DESPACHOS_POR_FRENTE = 20
/** O tamanho máximo da nota (`LIMITE_DA_NOTA_DO_APP` do canal). */
export const LIMITE_DA_NOTA = 1000

export interface FrenteDoBriefing {
  repo: string // repoDaFabrica(fabrica, c.repository): 'owner/name' na grafia do board
  chave: string // chaveDoCard(repo, card)
  card: number
  titulo: string
  url: string
  coluna: string // o nome da coluna como o board diz: '📋 Backlog'
  comando: string // o que o `iniciar` vai rodar: '/gm-spec #940'
  emVoo: boolean // a sala tem despacho em voo deste card
  /**
   * Os ids dos itens abertos da fila deste card (`sala.abertos`, ramo `ok`): um despacho dele parou
   * em PARADA e espera resposta. O `iniciar` abre frente nova mesmo assim; a tela avisa (G4 da PR
   * #141, menor 3).
   */
  abertos: string[]
}

/**
 * As frentes possíveis do dia: os cards abertos do repo da fábrica no Backlog e na Triagem, que são
 * os que o `iniciar` sabe começar sem `--comando`. Primeiro o Backlog, depois a Triagem, cada grupo
 * na ordem do board.
 */
export function frentesDoBriefing(
  board: Board,
  sala: SalaDaFabrica | null,
  fabrica: Pick<BoardNaFabricaOk, 'repos' | 'owner'>,
): FrenteDoBriefing[] {
  const emVoo = (chave: string): boolean =>
    sala?.kind === 'ok' && sala.emVoo.some((d) => chaveDoCard(d.repo, d.card) === chave)
  const abertos = (chave: string): string[] =>
    sala?.kind === 'ok'
      ? sala.abertos.filter((i) => chaveDoCard(i.repo, i.card) === chave).map((i) => i.id)
      : []
  const doGrupo = (estacao: 'backlog' | 'triagem'): FrenteDoBriefing[] =>
    board.cards.flatMap((c) => {
      const repo = repoDaFabrica(fabrica, c.repository)
      if (c.closed || repo === null || estacaoDaColuna(colunaDoCard(board, c)) !== estacao) {
        return []
      }
      const chave = chaveDoCard(c.repository, c.number)
      return [
        {
          repo,
          chave,
          card: c.number,
          titulo: c.title,
          url: c.url,
          coluna: colunaDoCard(board, c),
          comando: comandoDaFrente(estacao, c.number),
          emVoo: emVoo(chave),
          abertos: abertos(chave),
        },
      ]
    })
  return [...doGrupo('backlog'), ...doGrupo('triagem')]
}

/** O comando que o `iniciar` roda (o `comandoDaEstacao` do core; a canária compara). */
export function comandoDaFrente(estacao: 'backlog' | 'triagem', card: number): string {
  return estacao === 'backlog' ? `/gm-spec #${card}` : `/gm-card #${card}`
}

function limpar(texto: string): string {
  return texto
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:,]+$/, '')
}

/**
 * A nota de uma frente: uma linha só, sem quebra e sem `--` no começo (vira a linha "Nesta sessão"
 * do argumento do despacho). `dia` é `AAAA-MM-DD` e vira `DD/MM`.
 */
export function notaDoBriefing(p: { dia: string; prontoQuando: string; contexto: string }): string {
  const [, mes = '', dia = ''] = p.dia.split('-')
  const data = `${dia}/${mes}`
  const pronto = limpar(p.prontoQuando)
  const contexto = limpar(p.contexto)
  if (pronto === '' && contexto === '') return `Briefing do dia ${data}, solto pela tela Briefing.`
  if (contexto === '') return `Briefing do dia ${data}: pronto quando ${pronto}.`
  if (pronto === '') return `Briefing do dia ${data}. Contexto do dia: ${contexto}.`
  return `Briefing do dia ${data}: pronto quando ${pronto}. Contexto do dia: ${contexto}.`
}

/** As três regras que o código aplica à nota e ao comando de todo despacho. */
export const NAO_FAZER_HOJE: readonly string[] = [
  'Nada que cite main, release, tag ou hotfix: o filtro do mandato recusa a nota e o comando.',
  'Nada que cite a instalação viva, o checkout principal ou os repos da Notoria: o filtro recusa a nota e o comando.',
  'Só as skills da esteira: /gm-triage, /gm-card, /gm-spec, /gm-plan-tasks, /gm-implement, /gm-ship e /gm-correcao.',
]
