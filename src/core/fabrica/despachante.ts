import { lerDesfecho } from './desfecho'
import { novoId } from './estado'
import { comandoDoG4, lerComandoDoG4, prAbertaDoShip } from './g4'
import {
  LIMITE_DE_DESPACHOS_POR_FRENTE,
  TETO_DE_SESSOES,
  avaliarComando,
  cardDoComando,
} from './mandato'
import type { Despacho, EstadoDaFabrica, ItemDaFila } from './tipos'

/**
 * As transições do estado da fábrica (card 121, spec P2 §5). Todas puras: recebem o estado e
 * devolvem um novo, sem mutar o recebido e sem IO. Quem grava em disco e lança processo é a casca.
 */

const EM_VOO = new Set(['pendente', 'lancando', 'rodando'])

function trocarDespacho(
  e: EstadoDaFabrica,
  id: string,
  de: Despacho['estado'],
  mudanca: Partial<Despacho>,
): EstadoDaFabrica {
  const d = e.despachos.find((x) => x.id === id)
  if (d === undefined) throw new Error(`não há despacho ${id}`)
  if (d.estado !== de) throw new Error(`o despacho ${id} está ${d.estado}, e não ${de}`)
  return { ...e, despachos: e.despachos.map((x) => (x.id === id ? { ...x, ...mudanca } : x)) }
}

export function iniciarFrente(
  e: EstadoDaFabrica,
  p: { card: number; comando: string; nota: string | null; agora: string },
): { estado: EstadoDaFabrica; frente: string; despacho: string } | { erro: string } {
  const emVoo = e.despachos.find((d) => d.card === p.card && EM_VOO.has(d.estado))
  if (emVoo) return { erro: `o #${p.card} já tem despacho em voo (${emVoo.id})` }
  const citado = cardDoComando(p.comando)
  if (citado !== null && citado !== p.card) {
    return { erro: `o comando cita o #${citado}, e a frente é do #${p.card}` }
  }
  const a = novoId(e, 'fr')
  const b = novoId(a.estado, 'd')
  const estado: EstadoDaFabrica = {
    ...b.estado,
    frentes: [
      ...b.estado.frentes,
      { id: a.id, card: p.card, criadaEm: p.agora, encerradaEm: null },
    ],
    despachos: [
      ...b.estado.despachos,
      {
        id: b.id,
        frente: a.id,
        card: p.card,
        comando: p.comando,
        nota: p.nota,
        estado: 'pendente',
        pid: null,
        criadoEm: p.agora,
        lancadoEm: null,
        concluidoEm: null,
        sessaoClaude: null,
        desfecho: null,
      },
    ],
  }
  return { estado, frente: a.id, despacho: b.id }
}

/**
 * Quais pendentes lançar agora: no máximo as vagas que o teto deixa, do mais antigo ao mais novo,
 * e uma sessão por frente (a que já tem despacho lançando ou rodando espera).
 */
export function escolherLancamentos(e: EstadoDaFabrica, sessoesDaProvaVivas: number): string[] {
  const vagas = Math.max(0, TETO_DE_SESSOES - sessoesDaProvaVivas)
  const ocupadas = new Set(
    e.despachos
      .filter((d) => d.estado === 'lancando' || d.estado === 'rodando')
      .map((d) => d.frente),
  )
  const pendentes = e.despachos
    .filter((d) => d.estado === 'pendente')
    .sort((x, y) => x.criadoEm.localeCompare(y.criadoEm) || x.id.localeCompare(y.id))
  const escolhidos: string[] = []
  for (const d of pendentes) {
    if (escolhidos.length >= vagas) break
    if (ocupadas.has(d.frente)) continue
    ocupadas.add(d.frente)
    escolhidos.push(d.id)
  }
  return escolhidos
}

export function marcarLancando(e: EstadoDaFabrica, id: string, agora: string): EstadoDaFabrica {
  return trocarDespacho(e, id, 'pendente', { estado: 'lancando', lancadoEm: agora })
}

export function marcarRodando(e: EstadoDaFabrica, id: string, pid: number): EstadoDaFabrica {
  return trocarDespacho(e, id, 'lancando', { estado: 'rodando', pid })
}

/** Só serve ao caso "nunca lançou" da recuperação de quedas (§9). */
export function voltarAPendente(e: EstadoDaFabrica, id: string): EstadoDaFabrica {
  return trocarDespacho(e, id, 'lancando', { estado: 'pendente', lancadoEm: null })
}

/** Cria, na mesma frente de `atual`, o despacho `pendente` que roda `comando`. */
function novoPendente(
  estado: EstadoDaFabrica,
  atual: Despacho,
  comando: string,
  nota: string | null,
  agora: string,
): EstadoDaFabrica {
  const novo = novoId(estado, 'd')
  return {
    ...novo.estado,
    despachos: [
      ...novo.estado.despachos,
      {
        id: novo.id,
        frente: atual.frente,
        card: atual.card,
        comando,
        nota,
        estado: 'pendente',
        pid: null,
        criadoEm: agora,
        lancadoEm: null,
        concluidoEm: null,
        sessaoClaude: null,
        desfecho: null,
      },
    ],
  }
}

/**
 * Fecha um despacho com a saída da sessão. Um `PROXIMO:` dentro do mandato vira o próximo despacho
 * da mesma frente, e a PARADA de um `/gm-ship` com `PR #<n> aberta` segue para o G4 (`/g4 #<card> PR #<n>`,
 * também na mesma frente); qualquer outro fim (PARADA, falha, `PROXIMO:` recusado ou além do limite) vira
 * item da fila e encerra a frente. Concluir duas vezes é erro de programação, e lança.
 */
export function concluirDespacho(
  e: EstadoDaFabrica,
  id: string,
  p: { saida: string; agora: string; proibidos: readonly string[] },
): EstadoDaFabrica {
  const atual = e.despachos.find((d) => d.id === id)
  if (atual === undefined) throw new Error(`não há despacho ${id}`)
  if (atual.estado === 'concluido') throw new Error(`o despacho ${id} já está concluído`)

  const { desfecho, sessaoClaude } = lerDesfecho(p.saida)
  let estado: EstadoDaFabrica = {
    ...e,
    despachos: e.despachos.map((d) =>
      d.id === id ? { ...d, estado: 'concluido', concluidoEm: p.agora, sessaoClaude, desfecho } : d,
    ),
  }

  const naFrente = e.despachos.filter((d) => d.frente === atual.frente).length
  let motivo: string | null = null
  if (desfecho.tipo === 'proximo') {
    const avaliacao = avaliarComando(desfecho.comando, p.proibidos)
    const citadoNoProximo = cardDoComando(desfecho.comando)
    if (lerComandoDoG4(atual.comando) !== null) {
      motivo = `o G4 terminou com PROXIMO, e a revisão só fecha com PARADA: ${desfecho.comando}`
    } else if (!avaliacao.ok) {
      motivo = `PROXIMO fora do mandato: ${avaliacao.motivo}: ${desfecho.comando}`
    } else if (citadoNoProximo !== null && citadoNoProximo !== atual.card) {
      motivo = `PROXIMO cita o card #${citadoNoProximo}, e a frente é do #${atual.card}: ${desfecho.comando}`
    } else if (naFrente >= LIMITE_DE_DESPACHOS_POR_FRENTE) {
      motivo = `a frente passou de ${LIMITE_DE_DESPACHOS_POR_FRENTE} despachos: ${desfecho.comando}`
    } else {
      estado = novoPendente(estado, atual, desfecho.comando, null, p.agora)
    }
  } else {
    const pr = desfecho.tipo === 'parada' ? prAbertaDoShip(desfecho.motivo) : null
    if (
      desfecho.tipo === 'parada' &&
      atual.comando.trimStart().split(/\s+/)[0] === '/gm-ship' &&
      pr !== null
    ) {
      const g4 = comandoDoG4(atual.card, pr)
      if (naFrente >= LIMITE_DE_DESPACHOS_POR_FRENTE) {
        motivo = `a frente passou de ${LIMITE_DE_DESPACHOS_POR_FRENTE} despachos: ${g4}`
      } else {
        estado = novoPendente(
          estado,
          atual,
          g4,
          `o /gm-ship terminou com: PARADA: ${desfecho.motivo}`,
          p.agora,
        )
      }
    } else {
      motivo = desfecho.motivo
    }
  }

  if (motivo === null) return estado
  const q = novoId(estado, 'q')
  const item: ItemDaFila = {
    id: q.id,
    card: atual.card,
    motivo,
    despacho: id,
    sessaoClaude,
    criadoEm: p.agora,
    fechadoEm: null,
    resolucao: null,
  }
  return {
    ...q.estado,
    frentes: q.estado.frentes.map((f) =>
      f.id === atual.frente ? { ...f, encerradaEm: p.agora } : f,
    ),
    fila: [...q.estado.fila, item],
  }
}

export function fecharItem(
  e: EstadoDaFabrica,
  id: string,
  resolucao: string,
  agora: string,
): { estado: EstadoDaFabrica } | { erro: string } {
  const item = e.fila.find((i) => i.id === id)
  if (item === undefined) return { erro: `não há item ${id} na fila` }
  if (item.fechadoEm !== null) return { erro: `o item ${id} já foi fechado` }
  return {
    estado: {
      ...e,
      fila: e.fila.map((i) => (i.id === id ? { ...i, fechadoEm: agora, resolucao } : i)),
    },
  }
}

export function emVoo(e: EstadoDaFabrica): Despacho[] {
  return e.despachos.filter((d) => d.estado === 'lancando' || d.estado === 'rodando')
}

export function ocioso(e: EstadoDaFabrica): boolean {
  return !e.despachos.some((d) => EM_VOO.has(d.estado))
}
