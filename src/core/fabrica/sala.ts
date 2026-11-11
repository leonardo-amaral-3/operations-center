import type {
  DespachoNaSala,
  EstacaoDaFabrica,
  EstadoDoDespachante,
  ItemNaSala,
  PerguntaDaFila,
  SalaDaFabrica,
} from '../../shared/fabrica'
import { REPO_DA_FABRICA } from './mandato'
import type { EstadoDaFabrica, ItemDaFila } from './tipos'

/**
 * O retrato da sala da fábrica (card 122, spec P3 §A2): a transformação pura do `EstadoDaFabrica`
 * da P2 no que a tela mostra. Não lê disco nem relógio; a casca em `main/fabrica/sala.ts` traz os
 * dois. Os tipos vêm de `shared`, que é folha (O20).
 */

/** O corte dos itens fechados que a sala mostra. */
const FECHADOS_NA_SALA = 10

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

function paraItem(e: EstadoDaFabrica, item: ItemDaFila): ItemNaSala {
  return {
    id: item.id,
    tipo: tipoDoItem(item),
    card: item.card,
    cardUrl: urlDoCard(item.card),
    motivo: item.motivo,
    despacho: item.despacho,
    comando: e.despachos.find((d) => d.id === item.despacho)?.comando ?? null,
    sessaoClaude: item.sessaoClaude,
    criadoEm: item.criadoEm,
    fechadoEm: item.fechadoEm,
    resolucao: item.resolucao,
  }
}

export function montarSala(
  e: EstadoDaFabrica,
  ctx: { despachante: EstadoDoDespachante; lidoEm: string },
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
    .map((d) => ({
      id: d.id,
      card: d.card,
      cardUrl: urlDoCard(d.card),
      comando: d.comando,
      estacao: estacaoDoComando(d.comando),
      estado: d.estado as DespachoNaSala['estado'],
      criadoEm: d.criadoEm,
      lancadoEm: d.lancadoEm,
    }))
  return {
    kind: 'ok',
    lidoEm: ctx.lidoEm,
    despachante: ctx.despachante,
    emVoo,
    abertos,
    fechados,
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
