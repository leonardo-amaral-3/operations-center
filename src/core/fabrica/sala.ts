import type {
  DecisaoNaSala,
  DespachoNaSala,
  EstacaoDaFabrica,
  EstadoDoDespachante,
  ItemNaSala,
  PassoDaFrente,
  PausaDaFabrica,
  PerguntaDaFila,
  RecursosDaFabrica,
  SalaDaFabrica,
} from '../../shared/fabrica'
import { lerComandoDoG4, lerParecer } from './g4'
import { type RepoDoBoard, mesmoRepo, nomeDoRepo } from './configuracao'
import { type CardDaFabrica, cardDoRegistro, repoDoRegistro } from './cardDaFabrica'
import type { Despacho, EstadoDaFabrica, ItemDaFila } from './tipos'

/**
 * O retrato da sala da fábrica (card 122, spec P3 §A2): a transformação pura do `EstadoDaFabrica`
 * da P2 no que a tela mostra. Não lê disco nem relógio; a casca em `main/fabrica/sala.ts` traz os
 * dois. Os tipos vêm de `shared`, que é folha (O20).
 */

/** O corte dos itens fechados que a sala mostra (e dos fechados de "O que a fábrica decidiu"). */
const FECHADOS_NA_SALA = 10

/** Quantos passos da esteira entram em "O que a fábrica decidiu". */
export const PASSOS_NA_SALA = 8

export function urlDoCard(card: number, repo: RepoDoBoard): string {
  return `https://github.com/${nomeDoRepo(repo)}/issues/${card}`
}

/** O número da PR que o motivo cita (`PR #<n>`, n ≥ 1, a primeira); nenhuma → `null`. */
export function prDoMotivo(motivo: string): number | null {
  const m = /\bPR #([1-9]\d*)\b/.exec(motivo)
  return m?.[1] === undefined ? null : Number(m[1])
}

export function urlDaPr(pr: number, repo: RepoDoBoard): string {
  return `https://github.com/${nomeDoRepo(repo)}/pull/${pr}`
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Decisão: a origem é o despacho `/g4` (a revisão do #143), terminou em PARADA com um parecer do
 * contrato, da mesma PR do comando e sem bloqueante. Todo o resto — inclusive a PARADA de um
 * `/gm-ship`, que agora só vira item quando o G4 não pôde nascer — é pergunta.
 */
export function tipoDoItem(
  item: ItemDaFila,
  origem: Despacho | undefined,
  unico: RepoDoBoard | null,
): 'pergunta' | 'decisao' {
  if (origem === undefined || origem.desfecho?.tipo !== 'parada') return 'pergunta'
  const g4 = lerComandoDoG4(origem.comando)
  const parecer = lerParecer(item.motivo, repoDoRegistro(item, unico))
  return g4 !== null &&
    g4.card === item.card &&
    g4.card === origem.card &&
    mesmoRepo(repoDoRegistro(item, unico), repoDoRegistro(origem, unico)) &&
    parecer !== null &&
    parecer.pr === g4.pr &&
    parecer.bloqueantes === 0
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
  '/g4': 'revisao',
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
  card: CardDaFabrica,
  worktrees: readonly string[],
): string {
  if (estacao === 'spec' || estacao === 'tasks') return 'planning/'
  if (estacao === 'implementacao' || estacao === 'revisao') {
    const prefixo = `${card.repo.name}-${card.n}-`
    const achadas = worktrees.filter((w) => w.startsWith(prefixo)).sort(comparar)
    if (achadas.length === 0) return 'worktree ainda não criada'
    const primeiro = achadas[0] as string
    return achadas.length === 1 ? primeiro : `${primeiro} +${achadas.length - 1}`
  }
  return 'sem worktree'
}

/**
 * Onde roda a sessão de um despacho: a do G4 roda no workspace, sem worktree; as demais seguem
 * `ondeRodaDo` pela estação do comando.
 */
export function ondeRodaOComando(
  comando: string,
  card: CardDaFabrica,
  worktrees: readonly string[],
): string {
  return lerComandoDoG4(comando) !== null
    ? 'sem worktree'
    : ondeRodaDo(estacaoDoComando(comando), card, worktrees)
}

function skillDe(comando: string): string {
  return /^\/(\S+)/.exec(comando)?.[1] ?? comando
}

/**
 * "O que a fábrica decidiu": os passos recentes que seguiram sozinhos, todo item aberto e os
 * fechados mais recentes, do mais novo ao mais velho (empate por id, decrescente).
 */
export function montarDecisoes(e: EstadoDaFabrica, unico: RepoDoBoard | null): DecisaoNaSala[] {
  const comItem = new Set(e.fila.map((i) => i.despacho))
  const passos: DecisaoNaSala[] = e.despachos
    .flatMap((d) =>
      d.estado === 'concluido' && d.desfecho?.tipo === 'proximo' && !comItem.has(d.id)
        ? [{ d, seguinte: skillDe(d.desfecho.comando) }]
        : d.estado === 'concluido' &&
            d.desfecho?.tipo === 'parada' &&
            !comItem.has(d.id) &&
            d.comando.trimStart().split(/\s+/)[0] === '/gm-ship'
          ? [{ d, seguinte: 'g4' }]
          : [],
    )
    .map(({ d, seguinte }) => ({
      tipo: 'passou' as const,
      id: d.id,
      card: d.card,
      skill: skillDe(d.comando),
      seguinte,
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
      item: paraItem(e, i, unico),
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
      item: paraItem(e, i, unico),
      em: i.criadoEm,
    }))
  return [...passos, ...abertos, ...fechados].sort(
    (a, b) => comparar(b.em, a.em) || comparar(b.id, a.id),
  )
}

function paraItem(e: EstadoDaFabrica, item: ItemDaFila, unico: RepoDoBoard | null): ItemNaSala {
  const origem = e.despachos.find((d) => d.id === item.despacho)
  const comando = origem?.comando ?? null
  return {
    id: item.id,
    tipo: tipoDoItem(item, origem, unico),
    card: item.card,
    repo: nomeDoRepo(repoDoRegistro(item, unico)),
    cardUrl: urlDoCard(item.card, repoDoRegistro(item, unico)),
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
    unico: RepoDoBoard | null
  },
): Extract<SalaDaFabrica, { kind: 'ok' }> {
  const abertos = e.fila
    .filter((i) => i.fechadoEm === null)
    .sort((a, b) => comparar(a.criadoEm, b.criadoEm) || comparar(a.id, b.id))
    .map((i) => paraItem(e, i, ctx.unico))
  const fechados = e.fila
    .filter((i) => i.fechadoEm !== null)
    .sort((a, b) => comparar(b.fechadoEm ?? '', a.fechadoEm ?? '') || comparar(b.id, a.id))
    .slice(0, FECHADOS_NA_SALA)
    .map((i) => paraItem(e, i, ctx.unico))
  const emVoo: DespachoNaSala[] = e.despachos
    .filter((d) => d.estado !== 'concluido')
    .sort((a, b) => comparar(a.criadoEm, b.criadoEm) || comparar(a.id, b.id))
    .map((d): DespachoNaSala => {
      const estacao = estacaoDoComando(d.comando)
      return {
        id: d.id,
        card: d.card,
        repo: nomeDoRepo(repoDoRegistro(d, ctx.unico)),
        cardUrl: urlDoCard(d.card, repoDoRegistro(d, ctx.unico)),
        comando: d.comando,
        estacao,
        estado: d.estado as DespachoNaSala['estado'],
        criadoEm: d.criadoEm,
        lancadoEm: d.lancadoEm,
        ondeRoda: ondeRodaOComando(d.comando, cardDoRegistro(d, ctx.unico), ctx.worktrees),
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
    decisoes: montarDecisoes(e, ctx.unico),
    frentesAbertas: e.frentes.filter((f) => f.encerradaEm === null).length,
  }
}

/** O `result` da saída JSON da sessão, inteiro e sem `trim`; qualquer coisa fora do formato → `null`. */
export function resultadoDaSaida(saida: string | null): string | null {
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
  unico: RepoDoBoard | null,
): PerguntaDaFila | null {
  const achado = e.fila.find((i) => i.id === id)
  if (achado === undefined) return null
  const item = paraItem(e, achado, unico)
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
    prUrl: pr === null ? null : urlDaPr(pr, repoDoRegistro(achado, unico)),
    passos,
  }
}
