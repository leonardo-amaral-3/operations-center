import type { Decisao } from './tipos'

export type Classe = 'estacionada' | 'provisoria' | 'desvio' | 'chave' | 'rotina'

/**
 * Em qual seção do relatório uma decisão do cofre cai (#120, spec-p1 §3).
 *
 * Precedência mecânica: a primeira regra que casa decide, e por isso cada decisão cai em exatamente
 * uma seção (CA-1.3). Os sinais de chave são uma aproximação declarada de "muda escopo ou contraria a
 * spec", que o cofre não marca (Technical Decisions, 5). Sem modelo: a mesma entrada dá sempre a
 * mesma saída (Technical Decisions, 1).
 */
export function classificar(d: Decisao): { classe: Classe; motivo: string } {
  if (d.tipo === 'pendencia') return { classe: 'estacionada', motivo: 'pendência' }
  if (d.provisoria) return { classe: 'provisoria', motivo: 'provisória: sim' }
  if (d.substitui !== null) {
    return { classe: 'desvio', motivo: `substitui a decisão #${d.substitui}` }
  }

  const sinais: string[] = []

  if (d.tipo === 'descoberta') sinais.push('descoberta')
  if (d.tipo === 'restricao') sinais.push('restrição')
  if (d.irreversivel) sinais.push('reversível: não')

  const portao = /\bG([1-5])\b/.exec(d.titulo)

  if (portao?.[1] !== undefined) sinais.push(`portão G${portao[1]}`)
  if (d.card === null) sinais.push('sem card')

  return sinais.length > 0
    ? { classe: 'chave', motivo: sinais.join(', ') }
    : { classe: 'rotina', motivo: '' }
}
