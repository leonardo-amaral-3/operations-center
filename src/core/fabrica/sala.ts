import type {
  DecisaoNaSala,
  DespachoNaSala,
  EstacaoDaFabrica,
  EstadoDoDespachante,
  ItemNaSala,
  PausaDaFabrica,
  PerguntaDaFila,
  RecursosDaFabrica,
  SalaDaFabrica,
} from '../../shared/fabrica'
import { REPO_DA_FABRICA } from './mandato'
import type { EstadoDaFabrica, ItemDaFila } from './tipos'

/**
 * O retrato da sala da fábrica (card 122, spec P3 §A2): a transformação pura do `EstadoDaFabrica`
 * da P2 no que a tela mostra. Não lê disco nem relógio; a casca em `main/fabrica/sala.ts` traz os
 * dois. Os tipos vêm de `shared`, que é folha (O20).
 */

/** O corte dos itens fechados que a sala mostra (e dos fechados de "O que a fábrica decidiu"). */
const FECHADOS_NA_SALA = 10

/** Quantos passos da esteira entram em "O que a fábrica decidiu". */
export const PASSOS_NA_SALA = 8

export function urlDoCard(card: number): string {
  return `https://github.com/${REPO_DA_FABRICA.owner}/${REPO_DA_FABRICA.name}/issues/${card}`
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** O tipo do item da fila; na F1 é sempre pergunta (a F3 é dona da classificação). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- a F3 classifica por aqui
export function tipoDoItem(_item: ItemDaFila): 'pergunta' | 'decisao' {
  return 'pergunta'
}

const ESTACAO_DA_SKILL: Record<string, EstacaoDaFabrica> = {
  '/gm-triage': 'entrada',
  '/gm-card': 'card',
  '/gm-spec': 'spec',
  '/gm-plan-tasks': 'tasks',
  '/gm-implement': 'implementacao',
  '/gm-correcao': 'implementacao',
  '/gm-ship': 'revisao',
}

/** A estação pela skill do começo do comando; qualquer outro comando → `null`. */
export function estacaoDoComando(comando: string): EstacaoDaFabrica | null {
  const skill = comando.trimStart().split(/\s+/)[0] ?? ''
  return ESTACAO_DA_SKILL[skill] ?? null
}

/**
 * Onde roda a sessão de um despacho, sem caminho absoluto: spec e tasks rodam em `planning/`;
 * implementação e revisão, na worktree do card (`<repo>-<n>-<slug>`); o resto não tem worktree.
 */
export function ondeRodaDo(
  estacao: EstacaoDaFabrica | null,
  card: number,
  worktrees: readonly string[],
): string {
  if (estacao === 'spec' || estacao === 'tasks') return 'planning/'
  if (estacao === 'implementacao' || estacao === 'revisao') {
    const prefixo = `${REPO_DA_FABRICA.name}-${card}-`
    const achadas = worktrees.filter((w) => w.startsWith(prefixo)).sort(comparar)
    if (achadas.length === 0) return 'worktree ainda não criada'
    const primeiro = achadas[0] as string
    return achadas.length === 1 ? primeiro : `${primeiro} +${achadas.length - 1}`
  }
  return 'sem worktree'
}

function skillDe(comando: string): string {
  return /^\/(\S+)/.exec(comando)?.[1] ?? comando
}

/**
 * "O que a fábrica decidiu": os passos recentes que seguiram sozinhos, todo item aberto e os
 * fechados mais recentes, do mais novo ao mais velho (empate por id, decrescente).
 */
export function montarDecisoes(e: EstadoDaFabrica): DecisaoNaSala[] {
  const comItem = new Set(e.fila.map((i) => i.despacho))
  const passos: DecisaoNaSala[] = e.despachos
    .flatMap((d) =>
      d.estado === 'concluido' && d.desfecho?.tipo === 'proximo' && !comItem.has(d.id)
        ? [{ d, seguinte: d.desfecho.comando }]
        : [],
    )
    .map(({ d, seguinte }) => ({
      tipo: 'passou' as const,
      id: d.id,
      card: d.card,
      skill: skillDe(d.comando),
      seguinte: skillDe(seguinte),
      em: d.concluidoEm ?? d.criadoEm,
    }))
    .sort((a, b) => comparar(b.em, a.em) || comparar(b.id, a.id))
    .slice(0, PASSOS_NA_SALA)
  const abertos: DecisaoNaSala[] = e.fila
    .filter((i) => i.fechadoEm === null)
    .map((i) => ({
      tipo: 'fila' as const,
      id: i.id,
      card: i.card,
      item: paraItem(e, i),
      em: i.criadoEm,
    }))
  const fechados: DecisaoNaSala[] = e.fila
    .filter((i) => i.fechadoEm !== null)
    .sort((a, b) => comparar(b.fechadoEm ?? '', a.fechadoEm ?? '') || comparar(b.id, a.id))
    .slice(0, FECHADOS_NA_SALA)
    .map((i) => ({
      tipo: 'fila' as const,
      id: i.id,
      card: i.card,
      item: paraItem(e, i),
      em: i.criadoEm,
    }))
  return [...passos, ...abertos, ...fechados].sort(
    (a, b) => comparar(b.em, a.em) || comparar(b.id, a.id),
  )
}

function paraItem(e: EstadoDaFabrica, item: ItemDaFila): ItemNaSala {
  const origem = e.despachos.find((d) => d.id === item.despacho)
  const comando = origem?.comando ?? null
  return {
    id: item.id,
    tipo: tipoDoItem(item),
    card: item.card,
    cardUrl: urlDoCard(item.card),
    motivo: item.motivo,
    despacho: item.despacho,
    comando,
    sessaoClaude: item.sessaoClaude,
    criadoEm: item.criadoEm,
    fechadoEm: item.fechadoEm,
    resolucao: item.resolucao,
    estacao: comando === null ? null : estacaoDoComando(comando),
    sessaoQuebrada: origem?.desfecho?.tipo === 'falha',
  }
}

export function montarSala(
  e: EstadoDaFabrica,
  ctx: {
    despachante: EstadoDoDespachante
    lidoEm: string
    projeto: string
    pausa: PausaDaFabrica | null
    recursos: RecursosDaFabrica
    /** Nomes de pasta das worktrees do workspace, sem caminho. */
    worktrees: readonly string[]
    /** Ids dos despachos com sessão viva; `null` = não se sabe. */
    vivos: ReadonlySet<string> | null
  },
): Extract<SalaDaFabrica, { kind: 'ok' }> {
  const abertos = e.fila
    .filter((i) => i.fechadoEm === null)
    .sort((a, b) => comparar(a.criadoEm, b.criadoEm) || comparar(a.id, b.id))
    .map((i) => paraItem(e, i))
  const fechados = e.fila
    .filter((i) => i.fechadoEm !== null)
    .sort((a, b) => comparar(b.fechadoEm ?? '', a.fechadoEm ?? '') || comparar(b.id, a.id))
    .slice(0, FECHADOS_NA_SALA)
    .map((i) => paraItem(e, i))
  const emVoo: DespachoNaSala[] = e.despachos
    .filter((d) => d.estado !== 'concluido')
    .sort((a, b) => comparar(a.criadoEm, b.criadoEm) || comparar(a.id, b.id))
    .map((d): DespachoNaSala => {
      const estacao = estacaoDoComando(d.comando)
      return {
        id: d.id,
        card: d.card,
        cardUrl: urlDoCard(d.card),
        comando: d.comando,
        estacao,
        estado: d.estado as DespachoNaSala['estado'],
        criadoEm: d.criadoEm,
        lancadoEm: d.lancadoEm,
        ondeRoda: ondeRodaDo(estacao, d.card, ctx.worktrees),
        viva: d.estado === 'pendente' || ctx.vivos === null ? null : ctx.vivos.has(d.id),
      }
    })
  return {
    kind: 'ok',
    lidoEm: ctx.lidoEm,
    projeto: ctx.projeto,
    despachante: ctx.despachante,
    pausa: ctx.pausa,
    recursos: ctx.recursos,
    emVoo,
    abertos,
    fechados,
    decisoes: montarDecisoes(e),
    frentesAbertas: e.frentes.filter((f) => f.encerradaEm === null).length,
  }
}

/** O `result` da saída JSON da sessão, inteiro e sem `trim`; qualquer coisa fora do formato → `null`. */
function resultadoDaSaida(saida: string | null): string | null {
  if (saida === null) return null
  let bruto: unknown
  try {
    bruto = JSON.parse(saida)
  } catch {
    return null
  }
  if (typeof bruto !== 'object' || bruto === null) return null
  const result = (bruto as Record<string, unknown>).result
  return typeof result === 'string' && result.trim() !== '' ? result : null
}

export function montarPergunta(
  e: EstadoDaFabrica,
  id: string,
  saida: string | null,
): PerguntaDaFila | null {
  const item = e.fila.find((i) => i.id === id)
  if (item === undefined) return null
  return {
    item: paraItem(e, item),
    resultado: resultadoDaSaida(saida),
    fechar: `yarn fabrica fechar ${id} "<resolução>"`,
  }
}
