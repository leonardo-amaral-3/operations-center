import type { PortaoDoMandato } from '../../shared/fabrica'

/**
 * Quem decide cada portão, lido do `fabrica/MANDATO.md` da `dev` (spec-f5 §F5.4). O mandato é prosa
 * e não tem tabela: a regra lê só o que ele diz, cada célula leva a linha que a sustenta, e o que a
 * regra não acha fica `null` ("não diz"), que é onde a sessão despachada para e espera. Puro.
 */

/** As nove linhas da tabela, na ordem e com os textos do `Mandato.dc.html` (salvo as de §F5.10). */
export const PORTOES: ReadonlyArray<Pick<PortaoDoMandato, 'id' | 'nome' | 'nota'>> = [
  { id: 'entrada', nome: 'Entrada', nota: 'o que você conta na tela Entrada' },
  { id: 'g1', nome: 'G1 · card', nota: 'promover para Backlog' },
  { id: 'g2', nome: 'G2 · spec', nota: 'depois do revisor independente' },
  { id: 'g3', nome: 'G3 · tasks', nota: 'fatiar em tasks' },
  { id: 'impl', nome: 'Implementação e integração', nota: 'commits e PR' },
  { id: 'g4', nome: 'G4 · merge na dev', nota: 'CI verde e revisão tratada' },
  { id: 'val', nome: 'Validação em dev', nota: 'roteiro da spec, evidência na PR' },
  { id: 'g5', nome: 'G5 · release e produção', nota: 'merge na main e verificação pós-deploy' },
  { id: 'op', nome: 'Operação', nota: 'abrir bug com o sinal anexado' },
]

/** A regra das paradas, que vem do `## Modo despachado` das skills `gm-*` e não do mandato. */
export const REGRA_DAS_PARADAS = 'O despacho de um card pode acrescentar paradas, nunca tirar.'

function linhasDe(texto: string): string[] {
  return texto
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim().replace(/^- /, ''))
    .filter((l) => l !== '')
}

export function portoesDoMandato(texto: string): PortaoDoMandato[] {
  const linhas = linhasDe(texto)
  const casou = linhas
    .map((l) => ({ l, m: /decide sozinho os port(?:õ|o)es[^(]*\(([^)]*)\)/i.exec(l) }))
    .find((x) => x.m !== null)
  const entregue = casou?.l ?? null
  const entregues = new Set(
    [...(casou?.m?.[1] ?? '').matchAll(/G([1-5])/g)].map((m) => `g${m[1] ?? ''}`),
  )
  const commits = entregue !== null && /decide sozinho[^.]*\bcommits\b/i.test(entregue)
  const proibido = linhas.find((l) => l.startsWith('Proibido:')) ?? null

  return PORTOES.map((p) => {
    const sem = { ...p, quem: null, travado: false, fonte: null }

    if (p.id === 'g1' || p.id === 'g2' || p.id === 'g3' || p.id === 'g4') {
      return entregues.has(p.id) ? { ...sem, quem: 'A', fonte: entregue } : sem
    }
    if (p.id === 'impl') return commits ? { ...sem, quem: 'A', fonte: entregue } : sem
    // Release e produção são sempre do Leonardo (`CLAUDE.md` e `## Modo despachado`).
    if (p.id === 'g5') return { ...sem, quem: 'C', travado: true, fonte: proibido }

    return sem
  })
}

export function regrasDoMandato(texto: string): string[] {
  return [
    REGRA_DAS_PARADAS,
    ...linhasDe(texto).filter(
      (l) => l.startsWith('Proibido:') || l.startsWith('Pare (PARADA) em:'),
    ),
  ]
}
