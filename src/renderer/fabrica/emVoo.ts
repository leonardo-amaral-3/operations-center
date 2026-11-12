import type { DespachoDoCard, EstacaoDaFabrica } from '../../shared/fabrica'

/**
 * O que as telas Card e Entrada (#133, §F4.8) sabem calcular sem React: as estações, as tasks do
 * comentário `gm:tasks` e as frases do fim de um despacho. Puro, sem `window`.
 */

/** As nove estações da caixa do card, na ordem e com o texto do `Card.dc.html`. */
export const ESTACOES_DO_CARD: ReadonlyArray<{ estacao: EstacaoDaFabrica; rotulo: string }> = [
  { estacao: 'entrada', rotulo: 'Entrada' },
  { estacao: 'card', rotulo: 'Card · G1' },
  { estacao: 'spec', rotulo: 'Spec · G2' },
  { estacao: 'tasks', rotulo: 'Tasks · G3' },
  { estacao: 'implementacao', rotulo: 'Implementação' },
  { estacao: 'integracao', rotulo: 'Integração' },
  { estacao: 'revisao', rotulo: 'Revisão · G4' },
  { estacao: 'validacao', rotulo: 'Validação' },
  { estacao: 'release', rotulo: 'Release · G5' },
]

export type EstadoDaEstacao = 'feita' | 'atual' | 'por-vir'

/** Antes da atual, feita; a atual; depois, por vir. Fora das nove (`null`, `operacao`), tudo por vir. */
export function estadosDasEstacoes(atual: EstacaoDaFabrica | null): EstadoDaEstacao[] {
  const i = ESTACOES_DO_CARD.findIndex((e) => e.estacao === atual)
  return ESTACOES_DO_CARD.map((_, j) => {
    if (i < 0) return 'por-vir'
    if (j < i) return 'feita'
    return j === i ? 'atual' : 'por-vir'
  })
}

export interface TaskDoCard {
  numero: number
  titulo: string
  feita: boolean
}

const LINHA_DE_TASK = /^\s*- \[( |x|X)\] (\d+)\s+[—–-]\s+(.+?)\s*$/

/** As linhas `- [x] 3 — título` do comentário `gm:tasks`, na ordem do texto; o resto é ignorado. */
export function tasksDoComentario(corpo: string): TaskDoCard[] {
  const tasks: TaskDoCard[] = []
  for (const linha of corpo.split(/\r?\n/)) {
    const m = LINHA_DE_TASK.exec(linha)
    if (m === null) continue
    tasks.push({ numero: Number(m[2]), titulo: m[3] ?? '', feita: m[1] !== ' ' })
  }
  return tasks
}

export type EstadoDaTask = 'feita' | 'trabalhando' | 'na-fila'

/**
 * A feita é `feita`. A **primeira** não feita trabalha quando o atual é uma implementação rodando
 * e a sessão não está morta; as outras esperam na fila.
 */
export function estadosDasTasks(
  tasks: readonly TaskDoCard[],
  atual: Pick<DespachoDoCard, 'estacao' | 'estado'> | null,
  viva: boolean | null,
): EstadoDaTask[] {
  const trabalhando =
    atual !== null &&
    atual.estacao === 'implementacao' &&
    atual.estado === 'rodando' &&
    viva !== false
  const primeira = tasks.findIndex((t) => !t.feita)
  return tasks.map((t, i) => {
    if (t.feita) return 'feita'
    return trabalhando && i === primeira ? 'trabalhando' : 'na-fila'
  })
}

/** A linha final da caixa escura da sessão; `null` sem desfecho. */
export function linhaDoFim(d: DespachoDoCard): string | null {
  const detalhe = d.detalhe ?? '?'
  if (d.fim === 'proximo') return `→ seguiu para ${detalhe}`
  if (d.fim === 'parada') return `■ PARADA: ${detalhe}`
  if (d.fim === 'falha') return `✕ falha: ${detalhe}`
  return null
}

/** O mesmo fim, em prosa curta, para "Decisões deste card". */
export function textoDaDecisao(d: DespachoDoCard): string {
  const detalhe = d.detalhe ?? '?'
  if (d.fim === 'proximo') return `seguiu para ${detalhe}`
  if (d.fim === 'parada') return `PARADA: ${detalhe}`
  if (d.fim === 'falha') return `falha: ${detalhe}`
  return 'sem desfecho'
}

/** O primeiro `#n` que é card: um `#n` logo depois de `PR ` é PR. */
export function cardCitado(texto: string): number | null {
  const m = /(?<!PR )#([1-9]\d*)\b/.exec(texto)
  return m === null ? null : Number(m[1])
}

/**
 * O card que o texto cita: `owner/name#n` traz o repo; `#n` solto vem com `repo: null` (o repo único
 * do board). Sem citação, `null`.
 */
export function cardCitadoComRepo(texto: string): { repo: string | null; card: number } | null {
  const m = /([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)#([1-9]\d*)\b/.exec(texto)
  if (m !== null) return { repo: m[1] ?? null, card: Number(m[2]) }
  const card = cardCitado(texto)
  return card === null ? null : { repo: null, card }
}

export function rotuloDoEstado(estado: DespachoDoCard['estado']): string {
  switch (estado) {
    case 'pendente':
      return 'na fila'
    case 'lancando':
      return 'subindo'
    case 'rodando':
      return 'rodando'
    case 'concluido':
      return 'terminada'
  }
}
