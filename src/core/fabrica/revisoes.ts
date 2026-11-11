import type { RevisaoNaSala } from '../../shared/fabrica'

/** O nome de um arquivo do cofre: o dia e o slug do `lembrar` (M10). Sem pasta, sem `..`. */
export const NOME_DO_COFRE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/
/** O teto do motivo da contestação e da resolução do `atender`, em caracteres. */
export const LIMITE_DA_REVISAO = 2000

export type LinhaDaRevisao =
  | { tipo: 'confirmada'; arquivo: string; em: string }
  | { tipo: 'contestada'; arquivo: string; em: string; motivo: string }
  | { tipo: 'atendida'; arquivo: string; em: string; resolucao: string }

const naoVazia = (x: unknown): x is string => typeof x === 'string' && x !== ''

/** Uma linha do arquivo que vale, ou `null`. */
function linhaValida(bruta: string): LinhaDaRevisao | null {
  let x: unknown
  try {
    x = JSON.parse(bruta)
  } catch {
    return null
  }
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null
  const o = x as Record<string, unknown>
  if (typeof o.arquivo !== 'string' || !NOME_DO_COFRE.test(o.arquivo)) return null
  if (!naoVazia(o.em)) return null
  if (o.tipo === 'confirmada') return { tipo: 'confirmada', arquivo: o.arquivo, em: o.em }
  if (o.tipo === 'contestada' && naoVazia(o.motivo)) {
    return { tipo: 'contestada', arquivo: o.arquivo, em: o.em, motivo: o.motivo }
  }
  if (o.tipo === 'atendida' && naoVazia(o.resolucao)) {
    return { tipo: 'atendida', arquivo: o.arquivo, em: o.em, resolucao: o.resolucao }
  }
  return null
}

/**
 * Lê o texto do `revisoes.jsonl`. Nunca lança. A primeira revisão de cada arquivo vence, o que deixa
 * o resultado determinístico mesmo com dois escritores ao mesmo tempo (spec F5, Technical Decisions 2).
 */
export function lerRevisoes(texto: string): { revisoes: RevisaoNaSala[]; ilegiveis: number } {
  const revisoes: RevisaoNaSala[] = []
  let ilegiveis = 0
  for (const bruta of texto.split('\n')) {
    if (bruta.trim() === '') continue
    const linha = linhaValida(bruta)
    if (linha === null) {
      ilegiveis += 1
      continue
    }
    const atual = revisoes.find((r) => r.arquivo === linha.arquivo)
    if (linha.tipo === 'atendida') {
      if (atual?.veredito === 'contestada' && atual.atendida === null) {
        atual.atendida = { em: linha.em, resolucao: linha.resolucao }
      }
      continue
    }
    if (atual !== undefined) continue
    revisoes.push({
      arquivo: linha.arquivo,
      veredito: linha.tipo,
      em: linha.em,
      motivo: linha.tipo === 'contestada' ? linha.motivo : null,
      atendida: null,
    })
  }
  return { revisoes, ilegiveis }
}

type Pedido =
  | { tipo: 'confirmar'; arquivo: string; agora: string }
  | { tipo: 'contestar'; arquivo: string; motivo: string; agora: string }
  | { tipo: 'atender'; arquivo: string; resolucao: string; agora: string }

/** A linha a acrescentar, ou o motivo da recusa. Não lê disco. */
export function novaRevisao(
  atual: readonly RevisaoNaSala[],
  pedido: Pedido,
): { linha: LinhaDaRevisao } | { erro: string } {
  const { arquivo, agora } = pedido
  if (!NOME_DO_COFRE.test(arquivo)) return { erro: `nome de arquivo do cofre inválido: ${arquivo}` }
  const existente = atual.find((r) => r.arquivo === arquivo)

  if (pedido.tipo === 'atender') {
    if (existente?.veredito !== 'contestada') return { erro: `${arquivo} não tem contestação` }
    if (existente.atendida !== null) {
      return { erro: `${arquivo} já foi atendida em ${existente.atendida.em}` }
    }
    const resolucao = pedido.resolucao.trim()
    if (resolucao === '') return { erro: 'falta a resolução' }
    if (resolucao.length > LIMITE_DA_REVISAO) {
      return { erro: `a resolução passa de ${LIMITE_DA_REVISAO} caracteres` }
    }
    return { linha: { tipo: 'atendida', arquivo, em: agora, resolucao } }
  }

  if (existente !== undefined) {
    return { erro: `${arquivo} já foi ${existente.veredito} em ${existente.em}` }
  }
  if (pedido.tipo === 'confirmar') return { linha: { tipo: 'confirmada', arquivo, em: agora } }

  const motivo = pedido.motivo.trim()
  if (motivo === '') return { erro: 'falta o motivo da contestação' }
  if (motivo.length > LIMITE_DA_REVISAO) {
    return { erro: `o motivo passa de ${LIMITE_DA_REVISAO} caracteres` }
  }
  return { linha: { tipo: 'contestada', arquivo, em: agora, motivo } }
}

/** As contestações sem `atendida`, na ordem do arquivo. */
export function contestacoesAbertas(revisoes: readonly RevisaoNaSala[]): RevisaoNaSala[] {
  return revisoes.filter((r) => r.veredito === 'contestada' && r.atendida === null)
}
