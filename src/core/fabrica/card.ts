import type { CardNaFabrica, DespachoDoCard } from '../../shared/fabrica'
import { estacaoDoComando, ondeRodaDo, resultadoDaSaida, urlDoCard } from './sala'
import type { Despacho, EstadoDaFabrica } from './tipos'

/**
 * O card na fábrica (#133, spec F4.2): o despacho atual, o fim dele e os terminados. Puro: o main
 * lê o disco e entrega aqui o estado, as worktrees, quem está vivo e a saída da sessão.
 */

function maisNovoPrimeiro(a: Despacho, b: Despacho): number {
  const ca = a.concluidoEm ?? ''
  const cb = b.concluidoEm ?? ''
  if (ca !== cb) return ca < cb ? 1 : -1
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/** O em voo do card (há no máximo um, M14); sem ele, o concluído mais recente; senão `null`. */
export function despachoAtualDoCard(e: EstadoDaFabrica, card: number): Despacho | null {
  const doCard = e.despachos.filter((d) => d.card === card)
  const emVoo = doCard.find((d) => d.estado !== 'concluido')
  if (emVoo !== undefined) return emVoo
  return doCard.filter((d) => d.estado === 'concluido').sort(maisNovoPrimeiro)[0] ?? null
}

export function paraDespachoDoCard(d: Despacho): DespachoDoCard {
  const desfecho = d.desfecho
  return {
    id: d.id,
    comando: d.comando,
    estacao: estacaoDoComando(d.comando),
    estado: d.estado,
    criadoEm: d.criadoEm,
    lancadoEm: d.lancadoEm,
    concluidoEm: d.concluidoEm,
    sessao: d.sessaoClaude,
    fim: desfecho?.tipo ?? null,
    detalhe:
      desfecho === null ? null : desfecho.tipo === 'proximo' ? desfecho.comando : desfecho.motivo,
  }
}

export function montarCard(
  e: EstadoDaFabrica,
  card: number,
  ctx: { worktrees: readonly string[]; vivos: ReadonlySet<string> | null; saida: string | null },
): Extract<CardNaFabrica, { kind: 'ok' } | { kind: 'sem-despacho' }> {
  const cardUrl = urlDoCard(card)
  const atual = despachoAtualDoCard(e, card)
  if (atual === null) return { kind: 'sem-despacho', card, cardUrl }
  const emAndamento = atual.estado === 'lancando' || atual.estado === 'rodando'
  return {
    kind: 'ok',
    card,
    cardUrl,
    atual: paraDespachoDoCard(atual),
    ondeRoda: ondeRodaDo(estacaoDoComando(atual.comando), card, ctx.worktrees),
    viva: emAndamento && ctx.vivos !== null ? ctx.vivos.has(atual.id) : null,
    resultado: atual.estado === 'concluido' ? resultadoDaSaida(ctx.saida) : null,
    terminados: e.despachos
      .filter((d) => d.card === card && d.estado === 'concluido')
      .sort(maisNovoPrimeiro)
      .map(paraDespachoDoCard),
  }
}
