import type {
  DespachoNaSala,
  EstacaoDaFabrica,
  EstadoDoDespachante,
  ItemNaSala,
  PassoDaFrente,
  PausaDaFabrica,
  PerguntaDaFila,
  SalaDaFabrica,
} from '../../shared/fabrica'
import { REPO_DA_FABRICA } from './mandato'
import type { Despacho, EstadoDaFabrica, ItemDaFila } from './tipos'

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

/** O número da PR que o motivo cita (`PR #<n>`, n ≥ 1, a primeira); nenhuma → `null`. */
export function prDoMotivo(motivo: string): number | null {
  const m = /\bPR #([1-9]\d*)\b/.exec(motivo)
  return m?.[1] === undefined ? null : Number(m[1])
}

export function urlDaPr(pr: number): string {
  return `https://github.com/${REPO_DA_FABRICA.owner}/${REPO_DA_FABRICA.name}/pull/${pr}`
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Decisão: o despacho de origem é da estação `revisao` (`/gm-ship`), terminou com PARADA e o motivo
 * cita uma PR. É o único fim de sessão que entrega trabalho pronto esperando aprovação; todo o
 * resto (PARADA de outra estação, falha, PROXIMO recusado, origem fora do estado) é pergunta.
 */
export function tipoDoItem(item: ItemDaFila, origem: Despacho | undefined): 'pergunta' | 'decisao' {
  return origem !== undefined &&
    estacaoDoComando(origem.comando) === 'revisao' &&
    origem.desfecho?.tipo === 'parada' &&
    prDoMotivo(item.motivo) !== null
    ? 'decisao'
    : 'pergunta'
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
  const origem = e.despachos.find((d) => d.id === item.despacho)
  const comando = origem?.comando ?? null
  return {
    id: item.id,
    tipo: tipoDoItem(item, origem),
    card: item.card,
    cardUrl: urlDoCard(item.card),
    motivo: item.motivo,
    despacho: item.despacho,
    comando,
    sessaoClaude: item.sessaoClaude,
    criadoEm: item.criadoEm,
    fechadoEm: item.fechadoEm,
    resolucao: item.resolucao,
  }
}

export function montarSala(
  e: EstadoDaFabrica,
  ctx: {
    despachante: EstadoDoDespachante
    lidoEm: string
    projeto: string
    pausa: PausaDaFabrica | null
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
    projeto: ctx.projeto,
    despachante: ctx.despachante,
    pausa: ctx.pausa,
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

/** O primeiro termo do comando, sem a barra: `'/gm-ship /x'` → `'gm-ship'`. */
function skillDoComando(comando: string): string {
  return (comando.trimStart().split(/\s+/)[0] ?? '').replace(/^\//, '')
}

function passoDaFrente(d: Despacho): PassoDaFrente {
  const f = d.desfecho
  return {
    despacho: d.id,
    skill: skillDoComando(d.comando),
    comando: d.comando,
    fim: f?.tipo ?? null,
    detalhe: f === null ? null : f.tipo === 'proximo' ? f.comando : f.motivo,
    em: d.concluidoEm,
  }
}

export function montarPergunta(
  e: EstadoDaFabrica,
  id: string,
  saida: string | null,
): PerguntaDaFila | null {
  const achado = e.fila.find((i) => i.id === id)
  if (achado === undefined) return null
  const item = paraItem(e, achado)
  const origem = e.despachos.find((d) => d.id === achado.despacho)
  const pr = item.tipo === 'decisao' ? prDoMotivo(item.motivo) : null
  const passos =
    origem === undefined
      ? []
      : e.despachos
          .filter((d) => d.frente === origem.frente)
          .sort((a, b) => comparar(a.criadoEm, b.criadoEm) || comparar(a.id, b.id))
          .map(passoDaFrente)
  return {
    item,
    resultado: resultadoDaSaida(saida),
    fechar: `yarn fabrica fechar ${id} "<resolução>"`,
    fim: origem?.desfecho?.tipo ?? null,
    pr,
    prUrl: pr === null ? null : urlDaPr(pr),
    passos,
  }
}
